use serde::{Deserialize, Serialize};

/// A calendar date decoded from FM's `[u16 day_of_year][u16 year]` pair.
/// Field order makes the derived ordering chronological.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FmDate {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

const MONTH_LENGTHS: [u16; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

impl FmDate {
    /// Decodes FM's day-of-year (1-based) and year. FM27 keeps flags above bit 8 of the
    /// day field, so only its low 9 bits are the day. Returns `None` for unset dates,
    /// which FM stores as zero or as days in 1900 (e.g. rolling contracts end "1900-01-02").
    pub fn from_raw(day_field: u16, year: u16) -> Option<Self> {
        let mut day = day_field & 0x1FF;
        if year <= 1900 || day == 0 {
            return None;
        }
        for (month, &length) in MONTH_LENGTHS.iter().enumerate() {
            let length = if month == 1 && is_leap(year) { 29 } else { length };
            if day <= length {
                return Some(Self { year, month: month as u8 + 1, day: day as u8 });
            }
            day -= length;
        }
        None
    }

    /// Completed years from `self` (a birth date) to `today`; `None` if `today` is earlier.
    pub fn age_on(self, today: FmDate) -> Option<u16> {
        if today < self {
            return None;
        }
        let birthday_passed = (today.month, today.day) >= (self.month, self.day);
        Some(today.year - self.year - u16::from(!birthday_passed))
    }

    /// The day of the year, 1-based, as FM stores it.
    pub fn day_of_year(self) -> u16 {
        let before: u16 = (1..self.month).map(|month| month_length(self.year, month)).sum();
        before + u16::from(self.day)
    }

    /// The date as a number like 20290630, which orders like the date.
    pub fn to_number(self) -> i64 {
        i64::from(self.year) * 10_000 + i64::from(self.month) * 100 + i64::from(self.day)
    }

    /// The date `days` after this one (before it, for a negative count).
    pub fn plus_days(self, days: i64) -> Self {
        let mut year = self.year;
        let mut day = i64::from(self.day_of_year()) + days;
        let year_length = |year: u16| if is_leap(year) { 366 } else { 365 };
        while day > year_length(year) {
            day -= year_length(year);
            year += 1;
        }
        while day < 1 {
            year -= 1;
            day += year_length(year);
        }
        Self::from_raw(day as u16, year).expect("a day within its year")
    }

    /// The date a number like 20290630 stands for, if it is a real one.
    pub fn from_number(number: i64) -> Option<Self> {
        let year = u16::try_from(number / 10_000).ok()?;
        let month = u8::try_from(number / 100 % 100).ok()?;
        let day = u8::try_from(number % 100).ok()?;
        let real = number > 0 && (1..=12).contains(&month) && day >= 1 && u16::from(day) <= month_length(year, month);
        real.then_some(Self { year, month, day })
    }
}

pub(crate) fn is_leap(year: u16) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Days in `month` (1–12) of `year`.
fn month_length(year: u16, month: u8) -> u16 {
    if month == 2 && is_leap(year) { 29 } else { MONTH_LENGTHS[usize::from(month - 1)] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: u16, month: u8, day: u8) -> Option<FmDate> {
        Some(FmDate { year, month, day })
    }

    #[test]
    fn decodes_day_of_year() {
        assert_eq!(FmDate::from_raw(175, 1987), date(1987, 6, 24)); // Messi
        assert_eq!(FmDate::from_raw(203, 2000), date(2000, 7, 21)); // Haaland, leap year
        assert_eq!(FmDate::from_raw(1, 2001), date(2001, 1, 1));
        assert_eq!(FmDate::from_raw(60, 2000), date(2000, 2, 29));
        assert_eq!(FmDate::from_raw(60, 2001), date(2001, 3, 1));
        assert_eq!(FmDate::from_raw(366, 2000), date(2000, 12, 31));
    }

    #[test]
    fn age_counts_completed_years() {
        let today = FmDate { year: 2026, month: 7, day: 18 };
        assert_eq!(FmDate { year: 1987, month: 6, day: 24 }.age_on(today), Some(39)); // Messi
        assert_eq!(FmDate { year: 2000, month: 7, day: 21 }.age_on(today), Some(25)); // Haaland, birthday not yet
        assert_eq!(FmDate { year: 2000, month: 7, day: 18 }.age_on(today), Some(26)); // birthday today
        assert_eq!(FmDate { year: 2027, month: 1, day: 1 }.age_on(today), None);
    }

    #[test]
    fn day_of_year_and_numbers_round_trip() {
        for (year, day) in [(2026, 1), (2026, 181), (2028, 60), (2028, 366), (2030, 365)] {
            let date = FmDate::from_raw(day, year).expect("a real date");
            assert_eq!(date.day_of_year(), day);
            assert_eq!(FmDate::from_number(date.to_number()), Some(date));
        }
        assert_eq!(FmDate { year: 2029, month: 6, day: 30 }.to_number(), 20290630);
        assert_eq!(FmDate::from_number(20290631), None);
        assert_eq!(FmDate::from_number(20270229), None);
        assert_eq!(FmDate::from_number(20280229), date(2028, 2, 29));
        assert_eq!(FmDate::from_number(0), None);
        assert_eq!(FmDate::from_number(20291301), None);
    }

    #[test]
    fn adds_days_across_years() {
        // Matthijs de Ligt's injury on the test save: 30 Nov 2025, back after 265 to 295 days.
        let started = FmDate { year: 2025, month: 11, day: 30 };
        assert_eq!(started.plus_days(265), FmDate { year: 2026, month: 8, day: 22 });
        assert_eq!(started.plus_days(295), FmDate { year: 2026, month: 9, day: 21 });
        assert_eq!(started.plus_days(0), started);
        assert_eq!(FmDate { year: 2028, month: 2, day: 28 }.plus_days(1), FmDate { year: 2028, month: 2, day: 29 });
        assert_eq!(FmDate { year: 2026, month: 1, day: 1 }.plus_days(-1), FmDate { year: 2025, month: 12, day: 31 });
    }

    #[test]
    fn ignores_flag_bits_and_rejects_unset() {
        assert_eq!(FmDate::from_raw(0x200 | 175, 1987), date(1987, 6, 24));
        assert_eq!(FmDate::from_raw(0x80c7, 2026), date(2026, 7, 18)); // the game date as stored
        assert_eq!(FmDate::from_raw(0, 1987), None);
        assert_eq!(FmDate::from_raw(175, 0), None);
        assert_eq!(FmDate::from_raw(2, 1900), None);
        assert_eq!(FmDate::from_raw(366, 2001), None);
    }
}
