// The currency the app shows money in. The game keeps every amount in pounds and converts it only to show it, at the
// rates its database holds for each currency, year by year; the app does the same with the latest of those rates, so
// that it shows what FM shows. Like the language, the currency is chosen once, when the app starts: changing it saves
// the choice and reloads the window (see `setCurrency`).

import { saveSnapshot } from "./restore";

/**
 * The currencies on offer, in the order of the menu, with what one pound is worth in each: FM27's own rates for 2025,
 * the last year its database holds (`db::CURRENCY_RECORD`, read from the game on 1 November 2026). With them a
 * billion euros, Kylian Mbappé's release clause, is the 859,031,872 pounds the game keeps, give or take a few million.
 *
 * To add one: each `db::CURRENCY_RECORD` holds pointers to its name (+0x18, "South Korean Won"), short name (+0x20,
 * "Won") and symbol (+0x30), each a `u32` length and the UTF-8 text, and from +0x40 the begin and end of its rates:
 * pairs of a `u32` whose low 16 bits are the year and the `f32` rate, from 1960 to 2025. The won's was read on 11
 * November 2026, on Steam build 26385295.
 */
const RATES = {
  GBP: 1,
  EUR: 1.16756499,
  USD: 1.31842196,
  CNY: 9.4739151,
  KRW: 1873.22583,
  TRY: 52.2383461,
  BRL: 7.36309385,
  ARS: 1644.82361,
  MXN: 25.3028679,
  // Worked out from what the game shows in rupiah against the pounds it keeps: Persija's transfer budget of
  // £953,781 is Rp 22,795,243,724, and its wage budget of £51,131 a week Rp 63,545,244,854 a year (7 November 2026).
  IDR: 23899.8719,
} as const;

/** The currency of the country a club plays in, by the nation's name as the game spells it; pounds elsewhere. */
const NATION_CURRENCIES: Record<string, Currency> = {
  Indonesia: "IDR",
  England: "GBP",
  Scotland: "GBP",
  Wales: "GBP",
  "Northern Ireland": "GBP",
  Spain: "EUR",
  Italy: "EUR",
  Germany: "EUR",
  France: "EUR",
  Portugal: "EUR",
  Netherlands: "EUR",
  Belgium: "EUR",
  Austria: "EUR",
  "Republic of Ireland": "EUR",
  Greece: "EUR",
  Finland: "EUR",
  Croatia: "EUR",
  Slovakia: "EUR",
  Slovenia: "EUR",
  "United States": "USD",
  USA: "USD",
  Türkiye: "TRY",
  Turkey: "TRY",
  Brazil: "BRL",
  Argentina: "ARS",
  Mexico: "MXN",
};

export type Currency = keyof typeof RATES;

export const CURRENCIES = Object.keys(RATES) as Currency[];

/** Where the chosen currency is kept, and whether the app chose it, after the save, rather than the user. */
const STORAGE_KEY = "fmlibre.currency";
const AUTO_KEY = "fmlibre.currency.auto";

function isCurrency(value: string | null): value is Currency {
  return value !== null && Object.prototype.hasOwnProperty.call(RATES, value);
}

/** The currency the user chose earlier; pounds, as the game keeps them, when none is saved or it cannot be read. */
function savedCurrency(): Currency {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isCurrency(saved) ? saved : "GBP";
  } catch {
    return "GBP";
  }
}

/** The currency of this run. */
export const currency: Currency = savedCurrency();

const rate: number = RATES[currency];

/** Whether amounts are shown in another currency than the pounds the game keeps. */
export const converts = currency !== "GBP";

/** An amount the game keeps, in pounds, in the chosen currency, unrounded: for a ticket price's decimals. */
export const inCurrency = (pounds: number): number => pounds * rate;

/** An amount the game keeps, in pounds, as shown: in the chosen currency, to the whole unit. */
export const toShown = (pounds: number): number => Math.round(pounds * rate);

/**
 * The pounds to write for an amount typed in the chosen currency: the nearest whole pound, as the game keeps no less.
 * In a currency worth less than a pound, an amount the game then shows may differ a little from the one typed.
 */
export const toPounds = (shown: number): number => Math.round(shown / rate);

/**
 * Makes `next` the currency and reloads the window to apply it, as a new language is (see `setLocale`): the choice is
 * saved first, and what the window shows too; when the choice cannot be saved, the window is left alone. `auto` when
 * the app chose it after the save (see `currencyForSave`): a later save of another country may change it again, a
 * choice of the user's may not.
 */
export function setCurrency(next: Currency, auto = false): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.localStorage.setItem(AUTO_KEY, auto ? "1" : "0");
  } catch {
    return;
  }
  saveSnapshot();
  window.location.reload();
}

/**
 * Shows money in the currency of the country the managed club plays in, `nation`, unless the user chose a currency of
 * their own: the window reloads once to apply it, and the app keeps its connection through that.
 */
export function currencyForSave(nation: string | null): void {
  let chosenByUser = false;
  try {
    chosenByUser = window.localStorage.getItem(STORAGE_KEY) !== null && window.localStorage.getItem(AUTO_KEY) !== "1";
  } catch {
    return;
  }
  const next = nation ? NATION_CURRENCIES[nation] : undefined;
  if (!chosenByUser && next && next !== currency) {
    setCurrency(next, true);
  }
}
