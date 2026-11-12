//! Advice for a club, the one a human manager runs as a rule: where its senior squad is short or weak, the players
//! elsewhere who would fill those places, and the staff jobs it would do well to fill or fill better.
//!
//! The advice works on the lists already read and reads nothing from the game; the app adds what costs a read of its
//! own (the club's budgets, the asking prices of the players it suggests). It is a rule of thumb, not FM's own
//! judgement: a place counts as covered by the players rated at least [`PLAYABLE_RATING`] there, and a player as an
//! upgrade by his current ability.
//!
//! Whether a player would come is the game's to decide, on more than the editor reads (the league's reputation, his
//! favourite clubs, his agent). [`refine`] estimates it from what it does read: his reputation and his club's against
//! the club's, his ambition and loyalty, whether he is unhappy or listed, whether he would start, and whether the club
//! can pay him; and keeps to those likely to say yes.

use std::cmp::Reverse;

use serde::{Deserialize, Serialize};

use crate::clubs::{ClubIndex, ClubSummary, Finances};
use crate::date::FmDate;
use crate::details::{POSITIONS, PlayerDetails};
use crate::filter::staff_attribute;
use crate::players::{PLAYABLE_RATING, PlayerIndex, PlayerSummary};
use crate::staff::{StaffIndex, StaffSummary};

/// A place in the team, the positions that fill it and how many players a squad wants for it.
struct Role {
    key: &'static str,
    positions: &'static [&'static str],
    wanted: u8,
}

/// The places of a squad, from the goalkeeper up, as a 25-man squad covers them.
const ROLES: [Role; 10] = [
    Role { key: "gk", positions: &["gk"], wanted: 2 },
    Role { key: "dc", positions: &["dc", "sw"], wanted: 4 },
    Role { key: "dl", positions: &["dl", "wbl"], wanted: 2 },
    Role { key: "dr", positions: &["dr", "wbr"], wanted: 2 },
    Role { key: "dm", positions: &["dm"], wanted: 2 },
    Role { key: "mc", positions: &["mc"], wanted: 3 },
    Role { key: "aml", positions: &["aml", "ml"], wanted: 2 },
    Role { key: "amr", positions: &["amr", "mr"], wanted: 2 },
    Role { key: "amc", positions: &["amc"], wanted: 1 },
    Role { key: "st", positions: &["st"], wanted: 3 },
];

/// How far below the level of the club's best eleven the best player of a place may be before it counts as weak.
const WEAK_GAP: i32 = 10;

/// How far a prospect's potential must be above the team's level, and how far below it his ability may be.
const PROSPECT_HEADROOM: u16 = 15;
const PROSPECT_SHORTFALL: u16 = 25;

/// How much better than the best player of a place a signing must be to be worth suggesting.
const UPGRADE: i32 = 5;

/// How far above the club's reputation a selling club's may be for a move to be realistic (reputations are 0–10000).
const REPUTATION_REACH: u16 = 1500;

/// Days before the end of a contract from which it counts as running out: a player cheap to sign, or free soon.
const EXPIRING_DAYS: i64 = 183;

/// The best a member of staff may be at the attributes of a job (×10, so 12.0 is 120) before the job counts as weak.
const STAFF_WEAK: u16 = 120;

/// A member of staff the advice suggests must be at least this good (×10) at a job the club has no one in.
const STAFF_FLOOR: u16 = 110;

/// How the advice is drawn: who is suggested, and how many.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdviceOptions {
    /// The oldest a player suggested may be.
    pub max_age: u16,
    /// Keep to the players and staff a club of this reputation can sign: free agents, and those of clubs at most
    /// [`REPUTATION_REACH`] above it.
    pub realistic: bool,
    /// How many players to suggest per place and how many staff per job.
    pub per_role: usize,
    /// Leave out the players unlikely to want to come (see [`refine`]).
    pub interested: bool,
    /// Which of the club's teams to advise on, by its place in the club's list: 0 is the senior team.
    pub team: usize,
    /// The formation of the suggested eleven (see [`FORMATIONS`]); the first one when it names none.
    pub formation: Option<String>,
    /// Draw the eleven in the formation of the tactic the club's manager plays, where it can be read.
    pub use_tactic: bool,
}

impl Default for AdviceOptions {
    fn default() -> Self {
        Self {
            max_age: 32,
            realistic: true,
            per_role: 10,
            interested: true,
            team: 0,
            formation: None,
            use_tactic: false,
        }
    }
}

/// How many more players [`advise`] should find per place when [`refine`] will weed them out: most of the players a
/// club could use would not come to it.
pub const INTEREST_POOL: usize = 10;

/// How badly a place or a staff job wants someone, least first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Need {
    /// Enough players, and good enough.
    Covered,
    /// Fewer players than a squad wants.
    Thin,
    /// Enough players, but the best of them is well below the rest of the team.
    Weak,
    /// No one, or hardly anyone.
    Short,
}

/// Why a suggestion is a good one beyond its ability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Tag {
    FreeAgent,
    TransferListed,
    LoanListed,
    /// His contract runs out within [`EXPIRING_DAYS`].
    Expiring,
    /// Young, with room to grow well past the level of the team.
    Prospect,
}

/// The advice for one club.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubAdvice {
    pub club: ClubSummary,
    /// The club's budgets, which the app reads; none where the layout does not place them.
    pub finances: Option<Finances>,
    /// The team advised on, by its place in the club's list (0 is the senior team), and the teams there are to choose
    /// from; the app fills these in.
    pub team: usize,
    pub teams: Vec<TeamChoice>,
    /// The players of the team, those out on loan left out.
    pub squad_size: usize,
    pub average_age: Option<f32>,
    /// The average current ability of the eleven best players of the squad: the level a place is measured against.
    pub level: u16,
    /// The places of the team, from the goalkeeper up.
    pub roles: Vec<RoleAdvice>,
    /// The formation of the suggested eleven, and the eleven: the best player of the team for each place.
    pub formation: &'static str,
    pub eleven: Vec<XiPick>,
    /// Whether the eleven was drawn in the manager's own tactic, and its style as the game codes it (`CONT`...).
    pub own_tactic: bool,
    pub tactic_style: Option<String>,
    /// For an eleven drawn in the manager's own tactic: each place with its roles and how the team's players fit them.
    pub role_fits: Vec<RoleFit>,
    /// The players of the team who are not fit to play, or not happy: injured, banned, tired, short of match
    /// sharpness, low in morale or with reasons to be unhappy. The app fills it in.
    pub readiness: Vec<Readiness>,
    pub staff: Vec<StaffAdvice>,
}

/// The formations a suggested eleven can be drawn in, each place by the position it is played in, from the goalkeeper
/// up: the back line from left to right, then the midfield and the attack.
pub const FORMATIONS: [(&str, [&str; 11]); 8] = [
    ("4-3-3", ["gk", "dl", "dc", "dc", "dr", "dm", "mc", "mc", "aml", "amr", "st"]),
    ("4-2-3-1", ["gk", "dl", "dc", "dc", "dr", "dm", "dm", "aml", "amc", "amr", "st"]),
    ("4-4-2", ["gk", "dl", "dc", "dc", "dr", "ml", "mc", "mc", "mr", "st", "st"]),
    ("4-1-4-1", ["gk", "dl", "dc", "dc", "dr", "dm", "ml", "mc", "mc", "mr", "st"]),
    ("4-4-1-1", ["gk", "dl", "dc", "dc", "dr", "ml", "mc", "mc", "mr", "amc", "st"]),
    ("3-5-2", ["gk", "dc", "dc", "dc", "wbl", "dm", "mc", "mc", "wbr", "st", "st"]),
    ("3-4-3", ["gk", "dc", "dc", "dc", "wbl", "mc", "mc", "wbr", "aml", "amr", "st"]),
    ("5-3-2", ["gk", "wbl", "dc", "dc", "dc", "wbr", "mc", "mc", "mc", "st", "st"]),
];

/// One place of a suggested eleven and who plays it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XiPick {
    /// The position the place is played in (see [`POSITIONS`]).
    pub position: &'static str,
    pub player: Option<PlayerSummary>,
    /// His rating in the position, 1–20.
    pub rating: u8,
}

/// How much a player is worth in a place: his current ability, as much of it as he can bring to a position he plays
/// less well, and next to nothing where he is no more than a stopgap.
fn place_value(player: &PlayerSummary, position: usize) -> i64 {
    let rating = i64::from(player.position_ratings[position]);
    let ability = i64::from(player.current_ability);
    match rating {
        18.. => ability * 100,
        15..=17 => ability * (70 + rating),
        10..=14 => ability * rating * 3,
        _ => ability * rating,
    }
}

/// Who of `count` members fills each of `places` places so that together they are worth the most, as `value(place,
/// member)` says: the best pairs first, then any two places, or a place and a member left out, swapped while that is
/// worth more. None for a place no member is left for.
fn assign(places: usize, count: usize, value: impl Fn(usize, usize) -> i64) -> Vec<Option<usize>> {
    let mut pairs: Vec<(i64, usize, usize)> = Vec::new();
    for place in 0..places {
        for who in 0..count {
            pairs.push((value(place, who), place, who));
        }
    }
    pairs.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut chosen: Vec<Option<usize>> = vec![None; places];
    let mut used = vec![false; count];
    for (_, place, who) in pairs {
        if chosen[place].is_none() && !used[who] {
            chosen[place] = Some(who);
            used[who] = true;
        }
    }
    let worth = |place: usize, who: Option<usize>| who.map_or(0, |w| value(place, w));
    for _ in 0..10 {
        let mut better = false;
        for a in 0..places {
            for b in a + 1..places {
                if worth(a, chosen[b]) + worth(b, chosen[a]) > worth(a, chosen[a]) + worth(b, chosen[b]) {
                    chosen.swap(a, b);
                    better = true;
                }
            }
            for who in 0..count {
                if !used[who] && worth(a, Some(who)) > worth(a, chosen[a]) {
                    if let Some(old) = chosen[a] {
                        used[old] = false;
                    }
                    chosen[a] = Some(who);
                    used[who] = true;
                    better = true;
                }
            }
        }
        if !better {
            break;
        }
    }
    chosen
}

/// One place of the manager's tactic, and how the team's players fit its roles.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleFit {
    /// Its place in the tactic, the goalkeeper first, and the position it is played in.
    pub index: usize,
    pub position: &'static str,
    /// Its roles by key, where the editor knows them.
    pub in_possession: Option<&'static str>,
    pub out_of_possession: Option<&'static str>,
    /// Who the eleven puts there, and the team's best fits for it, best first (at most four).
    pub picked: Option<crate::Fitting>,
    pub best: Vec<crate::Fitting>,
}

/// A place of a tactic: its position, and its roles where known.
pub type TacticPlace = (&'static str, Option<&'static str>, Option<&'static str>);

/// The eleven of `members` for the places of a tactic, by how they fit each place's roles (see
/// [`crate::measure_fit`]), with each place's best fits.
pub fn tactic_eleven(members: &[&PlayerSummary], places: &[TacticPlace]) -> Vec<RoleFit> {
    let fits: Vec<Vec<Option<crate::Fitting>>> = places
        .iter()
        .map(|&(position, ip, oop)| members.iter().map(|p| crate::measure_fit(p, position, ip, oop)).collect())
        .collect();
    let chosen = assign(places.len(), members.len(), |place, who| {
        fits[place][who].as_ref().map_or(0, |f| i64::from(f.fit) * 1000 + i64::from(f.player.current_ability))
    });
    places
        .iter()
        .enumerate()
        .map(|(index, &(position, ip, oop))| {
            let mut best: Vec<crate::Fitting> = fits[index].iter().flatten().cloned().collect();
            best.sort_by_key(|f| (Reverse(f.fit), Reverse(f.player.current_ability)));
            best.truncate(4);
            RoleFit {
                index,
                position,
                in_possession: ip,
                out_of_possession: oop,
                picked: chosen[index].and_then(|who| fits[index][who].clone()),
                best,
            }
        })
        .collect()
}

/// The best eleven of `members` in `formation`: each player in at most one place, chosen so that the eleven together
/// are worth the most (see `place_value`): the best pairs first, then any two players who would do better swapped.
pub fn best_eleven(members: &[&PlayerSummary], formation: &[&'static str; 11]) -> Vec<XiPick> {
    let index_of = |key: &str| POSITIONS.iter().position(|&k| k == key).expect("a position");
    let places: Vec<usize> = formation.iter().map(|key| index_of(key)).collect();
    let mut pairs: Vec<(i64, usize, usize)> = Vec::new();
    for (slot, &position) in places.iter().enumerate() {
        for (who, player) in members.iter().enumerate() {
            pairs.push((place_value(player, position), slot, who));
        }
    }
    pairs.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut chosen: Vec<Option<usize>> = vec![None; 11];
    let mut used = vec![false; members.len()];
    for (_, slot, who) in pairs {
        if chosen[slot].is_none() && !used[who] {
            chosen[slot] = Some(who);
            used[who] = true;
        }
    }
    // Swaps: two places, or a place and a player left out, whenever that is worth more; a few rounds settle it.
    let value = |slot: usize, who: Option<usize>| who.map_or(0, |w| place_value(members[w], places[slot]));
    for _ in 0..10 {
        let mut better = false;
        for a in 0..11 {
            for b in a + 1..11 {
                let now = value(a, chosen[a]) + value(b, chosen[b]);
                if value(a, chosen[b]) + value(b, chosen[a]) > now {
                    chosen.swap(a, b);
                    better = true;
                }
            }
            for (who, taken) in used.clone().iter().enumerate() {
                if !taken && value(a, Some(who)) > value(a, chosen[a]) {
                    if let Some(old) = chosen[a] {
                        used[old] = false;
                    }
                    chosen[a] = Some(who);
                    used[who] = true;
                    better = true;
                }
            }
        }
        if !better {
            break;
        }
    }
    places
        .iter()
        .zip(formation)
        .zip(chosen)
        .map(|((&position, &key), who)| XiPick {
            position: key,
            player: who.map(|w| members[w].clone()),
            rating: who.map_or(0, |w| members[w].position_ratings[position]),
        })
        .collect()
}

/// A player of the team who is not fully ready, and why. The injured and the banned are left out of the eleven.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub player: PlayerSummary,
    /// His current injuries and bans.
    pub injuries: Vec<crate::Injury>,
    pub bans: Vec<crate::Ban>,
    /// Energy and match sharpness, 0–10000 (100.00%); jadedness, -500 rested and higher more worn out; morale 1–20.
    pub condition: u16,
    pub match_sharpness: u16,
    pub jadedness: i16,
    pub morale: u8,
    /// His happiness with his contract, as the game keeps it; and how many reasons to be unhappy last.
    pub happiness: Option<i8>,
    pub concerns: usize,
}

/// Energy below this (85%) counts as tired, match sharpness below this (60%) as short of it, jadedness above this
/// as jaded, and morale at or below this (of 20) as low.
pub const TIRED: u16 = 8_500;
pub const UNSHARP: u16 = 6_000;
pub const JADED: i16 = 250;
pub const LOW_MORALE: u8 = 8;

/// One of a club's teams the advice can be drawn for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamChoice {
    /// Its place in the club's list of teams: 0 is the senior team.
    pub index: usize,
    /// The game's code for the kind of team (0 the first team, 10 the under-21s, 12 the under-18s).
    pub kind: u8,
    /// The oldest its players may be; none for no limit.
    pub age_limit: Option<u8>,
    pub players: usize,
}

/// One place in the team: who covers it, how well, and who would cover it better.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleAdvice {
    pub key: &'static str,
    pub positions: &'static [&'static str],
    pub wanted: u8,
    /// Players of the squad who can play here, the one for whom it is the best place counted whole and any other half.
    pub cover: f32,
    pub need: Need,
    /// The current ability of the best player of the squad who can play here.
    pub best_ability: Option<u16>,
    /// The least current ability a suggested player has.
    pub target_ability: u16,
    /// The players of the squad who can play here, best first.
    pub members: Vec<RoleMember>,
    pub candidates: Vec<Candidate>,
}

/// A player of the squad who can play a place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMember {
    pub player: PlayerSummary,
    /// His rating at the place: the best of its positions, 1–20.
    pub rating: u8,
    /// Whether it is the place he plays best.
    pub main: bool,
}

/// A player of another club, or none, who would fill a place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub player: PlayerSummary,
    pub rating: u8,
    /// How much better he is than the best player of the squad at the place; negative for a prospect.
    pub gain: i32,
    pub club_reputation: Option<u16>,
    pub tags: Vec<Tag>,
    /// What his club asks for him, which the app reads; none for a free agent or where it is not set.
    pub asking_price: Option<i32>,
    /// How likely he is to want to come, once [`refine`] has looked; none before.
    pub interest: Option<Interest>,
    /// What speaks for his coming, and what against it.
    pub pros: Vec<Reason>,
    pub cons: Vec<Reason>,
    /// Whether he is of the club's country (see [`home_nation`]): the advice lists local players and foreign ones
    /// apart.
    pub domestic: bool,
    #[serde(skip)]
    score: i32,
}

/// How likely a player is to want to come, least first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Interest {
    Unlikely,
    Maybe,
    Likely,
}

/// Something that makes a player more or less likely to come.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// His own reputation is well above the club's.
    TooBig,
    /// The club is a step up from his, or a step down.
    StepUp,
    StepDown,
    /// Ambitious, and the move is no step up.
    Ambitious,
    /// Loyal, and settled where he is.
    Loyal,
    /// Unhappy where he is.
    Unhappy,
    Listed,
    FreeAgent,
    Expiring,
    /// He would be the best at his place, or a backup.
    Starter,
    Backup,
    /// Late in his career, when a smaller club is no shame.
    Veteran,
    /// Of the club's own country, where it plays.
    Domestic,
    /// He earns more than the club's wage budget, or costs more than its transfer budget.
    Wage,
    Fee,
}

/// What the game holds of a player that bears on whether he would come: read from his profile.
#[derive(Debug, Clone, Copy)]
pub struct Disposition {
    /// His current reputation, 0–10000, as clubs' are.
    pub reputation: u16,
    /// 1–20.
    pub ambition: u8,
    pub loyalty: u8,
    /// Morale, 1–20.
    pub morale: u8,
    /// Whether he has a reason to be unhappy that is not over.
    pub concerned: bool,
    /// Pounds per week; none without a contract.
    pub wage: Option<i32>,
    pub asking_price: Option<i32>,
}

impl Disposition {
    pub fn of(details: &PlayerDetails) -> Self {
        let personality = |key| details.personality.get(key).copied().unwrap_or(10);
        Self {
            reputation: details.reputation.current,
            ambition: personality("ambition"),
            loyalty: personality("loyalty"),
            morale: details.morale,
            concerned: details
                .contract
                .as_ref()
                .is_some_and(|c| c.concerns.iter().any(|concern| concern.ended.is_none())),
            wage: details.contract.as_ref().map(|c| c.wage),
            // Where the club sets no price, its value is what a buyer pays as a rule.
            asking_price: details.asking_price.or(details.value),
        }
    }
}

/// From what score a player counts as likely to come, and as maybe.
const LIKELY: i32 = 65;
const MAYBE: i32 = 45;

/// How far a player's reputation may be above the club's for him to come at all: players do not drop to clubs of
/// much less renown than their own, free agents no more than others.
const MOST_REPUTATION_ABOVE: i32 = 250;

/// How far his club's reputation may be above the club's: a step down only a transfer-listed player takes, and only a
/// short one.
const MOST_STEP_DOWN: i32 = 200;
const MOST_STEP_DOWN_LISTED: i32 = 800;

/// Estimates how likely `candidate`, of `disposition`, is to come to a club of `reputation` with `finances`: a score
/// from 50, and what moved it. Some things rule a move out whatever the score, as the game's own refusals do: a
/// reputation well above the club's, a step down to it, an ambitious player not stepping up, a loyal and settled one,
/// and a wage or a fee the club cannot pay.
pub fn judge(
    candidate: &Candidate,
    disposition: &Disposition,
    reputation: Option<u16>,
    finances: Option<&Finances>,
) -> (Interest, Vec<Reason>, Vec<Reason>) {
    let mut score = 50;
    let (mut pros, mut cons) = (Vec::new(), Vec::new());
    let mut ruled_out = false;
    let ours = i32::from(reputation.unwrap_or(0));
    let free = candidate.player.club_uid.is_none();
    let listed = candidate.player.transfer_listed;
    let age = candidate.player.age.unwrap_or(25);
    let unhappy = disposition.concerned || disposition.morale <= 8;

    // A player of more renown than the club does not drop down to it.
    let gap = i32::from(disposition.reputation) - ours;
    if gap > MOST_REPUTATION_ABOVE {
        ruled_out = true;
        cons.push(Reason::TooBig);
    } else if gap > 0 {
        score -= 5;
    } else if gap < -1000 {
        score += 8;
    }
    // Nor does one leave a bigger club for it, unless his club wants him gone, and then not far.
    let step = candidate.club_reputation.map(|theirs| ours - i32::from(theirs));
    match step {
        Some(step) if step < -MOST_STEP_DOWN_LISTED || (step < -MOST_STEP_DOWN && !listed) => {
            ruled_out = true;
            cons.push(Reason::StepDown);
        }
        Some(step) if step < -MOST_STEP_DOWN => {
            score -= 10;
            cons.push(Reason::StepDown);
        }
        Some(step) if step > 500 => {
            score += 12;
            pros.push(Reason::StepUp);
        }
        _ => {}
    }
    let stepping_up = step.is_some_and(|step| step > 300) || (free && gap < -500);
    if disposition.ambition >= 16 && !stepping_up {
        ruled_out = true;
        cons.push(Reason::Ambitious);
    } else if disposition.ambition >= 13 && !stepping_up {
        score -= 6;
    } else if disposition.ambition <= 8 {
        score += 5;
    }

    if unhappy && !free {
        score += 12;
        pros.push(Reason::Unhappy);
    } else if disposition.loyalty >= 15 && !free && !listed {
        ruled_out = true;
        cons.push(Reason::Loyal);
    }
    if listed {
        score += 15;
        pros.push(Reason::Listed);
    }
    if free {
        score += 10;
        pros.push(Reason::FreeAgent);
    } else if candidate.tags.contains(&Tag::Expiring) {
        score += 6;
        pros.push(Reason::Expiring);
    }
    if candidate.domestic {
        score += 8;
        pros.push(Reason::Domestic);
    }

    // Playing time: young players will wait for it, the others want it.
    if candidate.gain >= 0 {
        score += 10;
        pros.push(Reason::Starter);
    } else if candidate.gain < -10 && age > 21 {
        score -= 12;
        cons.push(Reason::Backup);
    }
    if age >= 31 {
        score += 6;
        pros.push(Reason::Veteran);
    }

    if let Some(finances) = finances {
        if disposition.wage.is_some_and(|wage| finances.wage_budget > 0 && wage > finances.wage_budget) {
            ruled_out = true;
            cons.push(Reason::Wage);
        }
        let fee = disposition.asking_price.filter(|_| !free && !candidate.tags.contains(&Tag::Expiring));
        if fee.is_some_and(|fee| fee > finances.transfer_budget.max(0)) {
            ruled_out = true;
            cons.push(Reason::Fee);
        }
    }

    let interest = if ruled_out {
        Interest::Unlikely
    } else if score >= LIKELY {
        Interest::Likely
    } else if score >= MAYBE {
        Interest::Maybe
    } else {
        Interest::Unlikely
    };
    (interest, pros, cons)
}

/// Looks at the players [`advise`] suggested, `details` reading each one's profile: fills in their asking prices and
/// how likely they are to come, leaves out the unlikely ones if `options` says so, puts the likely ones first and keeps
/// `options.per_role` of them per place. Profiles that cannot be read leave their players as they were.
pub fn refine(
    advice: &mut ClubAdvice,
    mut details: impl FnMut(&PlayerSummary) -> Option<PlayerDetails>,
    options: &AdviceOptions,
) {
    let reputation = advice.club.reputation;
    let finances = advice.finances;
    let mut read: std::collections::HashMap<u32, Option<Disposition>> = std::collections::HashMap::new();
    for role in &mut advice.roles {
        for candidate in &mut role.candidates {
            let disposition = *read
                .entry(candidate.player.uid)
                .or_insert_with(|| details(&candidate.player).map(|d| Disposition::of(&d)));
            if let Some(disposition) = disposition {
                candidate.asking_price = disposition.asking_price.filter(|_| candidate.player.club_uid.is_some());
                let (interest, pros, cons) = judge(candidate, &disposition, reputation, finances.as_ref());
                candidate.interest = Some(interest);
                candidate.pros = pros;
                candidate.cons = cons;
            }
        }
        // Only those likely to come: a player who might is one more refusal at the table.
        if options.interested {
            role.candidates.retain(|c| c.interest == Some(Interest::Likely));
        }
        role.candidates
            .sort_by_key(|c| (Reverse(c.interest), Reverse(c.score), Reverse(c.player.current_ability), c.player.uid));
        keep_each(&mut role.candidates, options.per_role);
    }
}

/// A staff job: who does it at the club, how well, and who would do it better.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffAdvice {
    pub key: &'static str,
    /// The job codes that count as this job (see [`crate::job_name`]), the head of a department first.
    pub jobs: &'static [u8],
    /// The staff attributes that matter for it.
    pub attributes: &'static [&'static str],
    pub wanted: u8,
    pub need: Need,
    /// The best of the club's staff at it, ×10.
    pub best_score: Option<u16>,
    pub members: Vec<StaffPick>,
    pub candidates: Vec<StaffPick>,
}

/// A member of staff and how good he is at a job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPick {
    pub member: StaffSummary,
    /// The average of the job's attributes, ×10 (1.0–20.0 as 10–200).
    pub score: u16,
    /// The job's attributes, in [`StaffAdvice::attributes`] order.
    pub values: Vec<u8>,
    pub club_reputation: Option<u16>,
    pub tags: Vec<Tag>,
}

/// A staff job, the codes that count as it and the attributes that matter for it.
struct StaffRole {
    key: &'static str,
    jobs: &'static [u8],
    attributes: &'static [&'static str],
    wanted: u8,
}

const STAFF_ROLES: [StaffRole; 12] = [
    StaffRole {
        key: "assistant",
        jobs: &[20],
        attributes: &["tactical_knowledge", "judging_ability", "judging_potential", "people_management", "motivating"],
        wanted: 1,
    },
    StaffRole {
        key: "coach",
        jobs: &[2],
        attributes: &["attacking", "defending", "possession", "tactical", "technical", "determination"],
        wanted: 3,
    },
    StaffRole {
        key: "goalkeeping",
        jobs: &[34],
        attributes: &["goalkeeping", "determination", "motivating"],
        wanted: 1,
    },
    StaffRole { key: "fitness", jobs: &[26], attributes: &["fitness", "determination", "motivating"], wanted: 1 },
    StaffRole { key: "setPieces", jobs: &[22], attributes: &["set_pieces", "tactical"], wanted: 1 },
    StaffRole { key: "physio", jobs: &[50, 12], attributes: &["physiotherapy", "sports_science"], wanted: 2 },
    StaffRole { key: "sportsScience", jobs: &[40, 48], attributes: &["sports_science", "physiotherapy"], wanted: 1 },
    StaffRole {
        key: "scout",
        jobs: &[44, 14],
        attributes: &["judging_ability", "judging_potential", "tactical_knowledge"],
        wanted: 2,
    },
    StaffRole { key: "performance", jobs: &[60], attributes: &["data_analysis", "tactical_knowledge"], wanted: 1 },
    StaffRole {
        key: "recruitment",
        jobs: &[58],
        attributes: &["data_analysis", "judging_ability", "judging_potential"],
        wanted: 1,
    },
    StaffRole {
        key: "youth",
        jobs: &[64],
        attributes: &["working_with_youngsters", "judging_potential", "determination"],
        wanted: 1,
    },
    StaffRole {
        key: "technicalDirector",
        jobs: &[88],
        attributes: &["judging_staff", "judging_ability", "negotiating"],
        wanted: 1,
    },
];

/// The attributes that matter for the job `job` (a contract code; its player-coach variant too), as the advice weighs
/// them; none for a job it does not weigh.
pub fn job_attributes(job: u8) -> Option<&'static [&'static str]> {
    let job = base_job(job);
    STAFF_ROLES.iter().find(|role| role.jobs.contains(&job)).map(|role| role.attributes)
}

/// How good `member` is at the job `job`, as the average of the attributes that matter for it ×10 (1.0–20.0 as
/// 10–200); none for a job the advice does not weigh, or where the layout places none of them.
pub fn job_suitability(member: &StaffSummary, job: u8) -> Option<u16> {
    staff_score(member, job_attributes(job)?).map(|(score, _)| score)
}

/// Jobs whose holders are not suggested for another club's staff: the people who run clubs, and their managers.
const NOT_FOR_HIRE: [u8; 4] = [4, 6, 16, 70];

/// The job code without its player-coach variant (see [`crate::job_name`]).
fn base_job(code: u8) -> u8 {
    if code > 1 && code % 2 == 1 { code - 1 } else { code }
}

/// A player's rating at a place: the best of its positions.
fn role_rating(player: &PlayerSummary, role: &Role) -> u8 {
    role.positions
        .iter()
        .filter_map(|key| POSITIONS.iter().position(|p| p == key))
        .map(|i| player.position_ratings[i])
        .max()
        .unwrap_or(0)
}

/// The place a player plays best, by his ratings; ties go to the place nearer the goal.
fn main_role(player: &PlayerSummary) -> Option<usize> {
    let (index, rating) = ROLES
        .iter()
        .enumerate()
        .map(|(i, role)| (i, role_rating(player, role)))
        .max_by_key(|&(i, r)| (r, Reverse(i)))?;
    (rating >= PLAYABLE_RATING).then_some(index)
}

/// The potential ability where it is a value; FM stores a range as a negative number, which says nothing exact.
fn potential(player: &PlayerSummary) -> u16 {
    u16::try_from(player.potential_ability).unwrap_or(player.current_ability).max(player.current_ability)
}

/// Whether a contract that ends on `expires` runs out soon after `today`.
fn expiring(expires: Option<FmDate>, today: Option<FmDate>) -> bool {
    matches!((expires, today), (Some(end), Some(today)) if end <= today.plus_days(EXPIRING_DAYS))
}

/// Whether the club with `reputation` can sign from a club with `theirs`.
fn within_reach(reputation: Option<u16>, theirs: Option<u16>) -> bool {
    match (reputation, theirs) {
        (Some(ours), Some(theirs)) => theirs <= ours.saturating_add(REPUTATION_REACH),
        _ => true,
    }
}

/// Whether a player's renown, and his club's, let him come to a club of `reputation` at all (see [`judge`]).
fn renown_allows(reputation: Option<u16>, player: &PlayerSummary, theirs: Option<u16>) -> bool {
    let Some(ours) = reputation.map(i32::from) else {
        return true;
    };
    let most_step_down = if player.transfer_listed { MOST_STEP_DOWN_LISTED } else { MOST_STEP_DOWN };
    i32::from(player.reputation) - ours <= MOST_REPUTATION_ABOVE
        && theirs.is_none_or(|theirs| i32::from(theirs) - ours <= most_step_down)
}

/// Keeps the first `limit` local players of `candidates` and the first `limit` foreign ones, in their order.
fn keep_each(candidates: &mut Vec<Candidate>, limit: usize) {
    let (mut local, mut foreign) = (0, 0);
    candidates.retain(|c| {
        let count = if c.domestic { &mut local } else { &mut foreign };
        *count += 1;
        *count <= limit
    });
}

/// Draws up the advice for `club`, whose team is the players `squad`, with players no older than `age_limit` where it
/// has one (a youth team); `human_clubs` are the clubs human
/// managers run, whose players and staff are not suggested. Reads nothing from the game.
#[allow(clippy::too_many_arguments)]
pub fn advise(
    club: &ClubSummary,
    squad: &[u32],
    age_limit: Option<u8>,
    players: &PlayerIndex,
    staff: &StaffIndex,
    clubs: &ClubIndex,
    human_clubs: &[u32],
    today: Option<FmDate>,
    options: &AdviceOptions,
) -> ClubAdvice {
    let members: Vec<&PlayerSummary> = squad.iter().filter_map(|&uid| players.get(uid)).collect();
    let ages: Vec<u16> = members.iter().filter_map(|p| p.age).collect();
    let average_age = (!ages.is_empty()).then(|| ages.iter().map(|&a| f32::from(a)).sum::<f32>() / ages.len() as f32);
    let mut abilities: Vec<u16> = members.iter().map(|p| p.current_ability).collect();
    abilities.sort_unstable_by(|a, b| b.cmp(a));
    let best = &abilities[..abilities.len().min(11)];
    let level =
        if best.is_empty() { 0 } else { (best.iter().map(|&a| u32::from(a)).sum::<u32>() / best.len() as u32) as u16 };

    let reputation_of = |uid: Option<u32>| uid.and_then(|uid| clubs.get(uid)).and_then(|c| c.reputation);
    let max_age = age_limit.map_or(options.max_age, |limit| options.max_age.min(u16::from(limit)));
    // Players of this club, of the other clubs human managers run and of the other kind of club (men's or women's)
    // are never suggested, nor any older than asked or out of reach.
    let pool: Vec<(&PlayerSummary, Option<u16>)> = players
        .iter()
        .filter(|p| p.club_uid != Some(club.uid) && !p.club_uid.is_some_and(|uid| human_clubs.contains(&uid)))
        .filter(|p| p.woman != Some(!club.women))
        .filter(|p| p.age.is_some_and(|age| age <= max_age))
        .map(|p| (p, reputation_of(p.club_uid)))
        .filter(|&(p, theirs)| !options.realistic || p.club_uid.is_none() || within_reach(club.reputation, theirs))
        // When only those who would come are wanted, those whom renown alone rules out are left out before the best
        // are picked: otherwise the best are nearly all of them, and none is left once they are weeded out.
        .filter(|&(p, theirs)| !options.interested || renown_allows(club.reputation, p, theirs))
        .collect();

    let nation = home_nation(&members);
    let mains: Vec<Option<usize>> = members.iter().map(|p| main_role(p)).collect();
    let roles = ROLES
        .iter()
        .enumerate()
        .map(|(index, role)| {
            let mut covering: Vec<RoleMember> = members
                .iter()
                .zip(&mains)
                .map(|(p, &main)| RoleMember {
                    player: (*p).clone(),
                    rating: role_rating(p, role),
                    main: main == Some(index),
                })
                .filter(|m| m.rating >= PLAYABLE_RATING)
                .collect();
            covering.sort_by_key(|m| (Reverse(m.player.current_ability), Reverse(m.rating)));
            let cover: f32 = covering.iter().map(|m| if m.main { 1.0 } else { 0.5 }).sum();
            let best_ability = covering.first().map(|m| m.player.current_ability);
            let wanted = f32::from(role.wanted);
            let need = if covering.is_empty() || cover < wanted / 2.0 {
                Need::Short
            } else if best_ability.is_some_and(|best| i32::from(best) < i32::from(level) - WEAK_GAP) {
                Need::Weak
            } else if cover < wanted {
                Need::Thin
            } else {
                Need::Covered
            };
            // A place short of players wants anyone near the team's level; one that has them, someone better.
            let target_ability = match need {
                Need::Short | Need::Thin => (i32::from(level) - WEAK_GAP).max(1),
                Need::Weak | Need::Covered => i32::from(best_ability.unwrap_or(0)) + UPGRADE,
            } as u16;
            let candidates =
                candidates(&pool, role, target_ability, best_ability, level, today, nation, options.per_role);
            RoleAdvice {
                key: role.key,
                positions: role.positions,
                wanted: role.wanted,
                cover,
                need,
                best_ability,
                target_ability,
                members: covering,
                candidates,
            }
        })
        .collect();

    let staff = STAFF_ROLES.iter().map(|role| staff_advice(club, role, staff, clubs, human_clubs, options)).collect();

    let (formation, shape) =
        FORMATIONS.iter().find(|(name, _)| options.formation.as_deref() == Some(name)).unwrap_or(&FORMATIONS[0]);
    let eleven = best_eleven(&members, shape);

    ClubAdvice {
        club: club.clone(),
        finances: None,
        formation,
        eleven,
        own_tactic: false,
        tactic_style: None,
        role_fits: Vec::new(),
        readiness: Vec::new(),
        team: options.team,
        teams: Vec::new(),
        squad_size: members.len(),
        average_age,
        level,
        roles,
        staff,
    }
}

/// The country a club plays in, as far as its squad tells: the nation most of its players are of. Players of its own
/// country come to it more readily.
pub fn home_nation(squad: &[&PlayerSummary]) -> Option<u32> {
    let mut counts: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
    for player in squad {
        if let Some(nation) = player.nation_uid {
            *counts.entry(nation).or_default() += 1;
        }
    }
    counts.into_iter().max_by_key(|&(nation, count)| (count, Reverse(nation))).map(|(nation, _)| nation)
}

/// The players of `pool` who would fill `role`: those at least `target` in current ability, and the young ones whose
/// potential is well above the team's `level`; the best `limit` of them.
#[allow(clippy::too_many_arguments)]
fn candidates(
    pool: &[(&PlayerSummary, Option<u16>)],
    role: &Role,
    target: u16,
    best: Option<u16>,
    level: u16,
    today: Option<FmDate>,
    nation: Option<u32>,
    limit: usize,
) -> Vec<Candidate> {
    let mut found: Vec<Candidate> = pool
        .iter()
        .filter_map(|&(player, club_reputation)| {
            let rating = role_rating(player, role);
            if rating < PLAYABLE_RATING {
                return None;
            }
            let ability = player.current_ability;
            let age = player.age.unwrap_or(30);
            let potential = potential(player);
            // A prospect: young, with room to grow well past the team, and not far below it already.
            let prospect = age <= 21 && potential >= level + PROSPECT_HEADROOM && ability + PROSPECT_SHORTFALL >= level;
            if ability < target && !prospect {
                return None;
            }
            let mut tags = Vec::new();
            let mut score = i32::from(ability) - i32::from(target);
            // Players who would make the team now come before those who might one day.
            if ability < target {
                score -= 20;
            }
            // Players of the club's own country come to it more readily.
            if nation.is_some() && player.nation_uid == nation {
                score += 15;
            }
            if player.club_uid.is_none() {
                tags.push(Tag::FreeAgent);
                score += 12;
            }
            if player.transfer_listed {
                tags.push(Tag::TransferListed);
                score += 10;
            } else if player.loan_listed {
                tags.push(Tag::LoanListed);
                score += 6;
            }
            if player.club_uid.is_some() && expiring(player.contract_expires, today) {
                tags.push(Tag::Expiring);
                score += 8;
            }
            if prospect {
                tags.push(Tag::Prospect);
            }
            if age <= 23 {
                score += (i32::from(potential) - i32::from(ability)).min(90) / 3;
            }
            if age >= 30 {
                score -= i32::from(age - 29) * 4;
            }
            let gain = i32::from(ability) - i32::from(best.unwrap_or(0));
            Some(Candidate {
                player: player.clone(),
                rating,
                gain,
                club_reputation,
                tags,
                asking_price: None,
                interest: None,
                pros: Vec::new(),
                cons: Vec::new(),
                domestic: nation.is_some() && player.nation_uid == nation,
                score,
            })
        })
        .collect();
    found.sort_by_key(|c| (Reverse(c.score), Reverse(c.player.current_ability), c.player.uid));
    keep_each(&mut found, limit);
    found
}

/// How good `member` is at the job with `attributes`: their average ×10, with their values; none where the layout
/// places none of them.
fn staff_score(member: &StaffSummary, attributes: &[&str]) -> Option<(u16, Vec<u8>)> {
    let values: Vec<u8> = attributes
        .iter()
        .map(|key| staff_attribute(key).and_then(|i| member.attributes.get(i).copied()).unwrap_or(0))
        .collect();
    let placed: Vec<u16> = values.iter().filter(|&&v| v > 0).map(|&v| u16::from(v)).collect();
    (!placed.is_empty()).then(|| ((placed.iter().sum::<u16>() * 10) / placed.len() as u16, values))
}

/// Who does the staff job `role` at `club`, and who would do it better.
fn staff_advice(
    club: &ClubSummary,
    role: &StaffRole,
    staff: &StaffIndex,
    clubs: &ClubIndex,
    human_clubs: &[u32],
    options: &AdviceOptions,
) -> StaffAdvice {
    let does_job = |member: &StaffSummary| member.job.is_some_and(|job| role.jobs.contains(&base_job(job)));
    let reputation_of = |uid: Option<u32>| uid.and_then(|uid| clubs.get(uid)).and_then(|c| c.reputation);
    let pick = |member: &StaffSummary, tags: Vec<Tag>| {
        staff_score(member, role.attributes).map(|(score, values)| StaffPick {
            member: member.clone(),
            score,
            values,
            club_reputation: reputation_of(member.club_uid),
            tags,
        })
    };

    let mut members: Vec<StaffPick> = staff
        .iter()
        .filter(|m| m.club_uid == Some(club.uid) && !m.is_human && does_job(m))
        .filter_map(|m| pick(m, Vec::new()))
        .collect();
    members.sort_by_key(|p| Reverse(p.score));
    let best_score = members.first().map(|p| p.score);
    let need = match members.len() {
        0 => Need::Short,
        n if best_score.is_some_and(|best| best < STAFF_WEAK) => {
            if n < usize::from(role.wanted) {
                Need::Short
            } else {
                Need::Weak
            }
        }
        n if n < usize::from(role.wanted) => Need::Thin,
        _ => Need::Covered,
    };
    // Someone better than the best the club has, or, for a job no one does, someone good at it.
    let floor = match need {
        Need::Short | Need::Thin => STAFF_FLOOR.max(best_score.unwrap_or(0)),
        Need::Weak | Need::Covered => best_score.unwrap_or(0) + 10,
    };

    let mut candidates: Vec<(i32, StaffPick)> = staff
        .iter()
        .filter(|m| m.club_uid != Some(club.uid) && !m.is_human)
        .filter(|m| !m.club_uid.is_some_and(|uid| human_clubs.contains(&uid)))
        .filter(|m| !m.job.is_some_and(|job| NOT_FOR_HIRE.contains(&base_job(job)) || job == 1))
        .filter(|m| m.age.is_none_or(|age| age <= 70))
        .filter(|m| {
            !options.realistic || m.club_uid.is_none() || within_reach(club.reputation, reputation_of(m.club_uid))
        })
        .filter_map(|m| {
            let free = m.club_uid.is_none();
            let pick = pick(m, if free { vec![Tag::FreeAgent] } else { Vec::new() })?;
            (pick.score >= floor).then(|| (i32::from(pick.score) + if free { 15 } else { 0 }, pick))
        })
        .collect();
    candidates.sort_by_key(|(rank, p)| (Reverse(*rank), Reverse(p.member.current_ability), p.member.uid));
    candidates.truncate(options.per_role);

    StaffAdvice {
        key: role.key,
        jobs: role.jobs,
        attributes: role.attributes,
        wanted: role.wanted,
        need,
        best_score,
        members,
        candidates: candidates.into_iter().map(|(_, p)| p).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filter::attribute_keys;
    use crate::staff::STAFF_ATTRIBUTE_GROUPS;

    fn player(uid: u32, ca: u16, age: u16, club: Option<u32>, positions: &[(&str, u8)]) -> PlayerSummary {
        let mut position_ratings = [1u8; 15];
        for &(key, rating) in positions {
            position_ratings[POSITIONS.iter().position(|p| *p == key).expect("a position")] = rating;
        }
        PlayerSummary {
            uid,
            name: format!("Player {uid}"),
            full_name: None,
            date_of_birth: None,
            age: Some(age),
            nation: None,
            nation_uid: None,
            nation_address: 0,
            club: club.map(|uid| format!("Club {uid}")),
            club_uid: club,
            positions: Vec::new(),
            contract_expires: Some(FmDate { year: 2028, month: 6, day: 30 }),
            current_ability: ca,
            potential_ability: ca as i16,
            position_ratings,
            attributes: Vec::new(),
            transfer_listed: false,
            loan_listed: false,
            woman: Some(false),
            reputation: 0,
            wage: None,
            asking_price: None,
            value: None,
            transfer_value: None,
            address: 0,
            shift: 0,
        }
    }

    fn member(uid: u32, club: Option<u32>, job: Option<u8>, value: u8) -> StaffSummary {
        StaffSummary {
            uid,
            name: format!("Staff {uid}"),
            full_name: None,
            date_of_birth: None,
            age: Some(45),
            nation: None,
            nation_uid: None,
            nation_address: 0,
            club: club.map(|uid| format!("Club {uid}")),
            club_uid: club,
            job,
            current_ability: 100,
            potential_ability: 100,
            is_human: false,
            attributes: vec![value; attribute_keys(STAFF_ATTRIBUTE_GROUPS).count()],
            contract_expires: None,
            woman: Some(false),
            address: 0,
            shift: 0,
        }
    }

    fn club(uid: u32, reputation: u16) -> ClubSummary {
        ClubSummary {
            uid,
            name: format!("Club {uid}"),
            short_name: None,
            women: false,
            reputation: Some(reputation),
            founded: None,
            address: 0,
        }
    }

    /// A squad of 22 at 120 with every place covered twice, but no goalkeeper.
    fn squad() -> Vec<PlayerSummary> {
        let mut squad = Vec::new();
        for (i, key) in
            ["dc", "dc", "dc", "dc", "dl", "dl", "dr", "dr", "dm", "dm", "mc", "mc", "mc"].iter().enumerate()
        {
            squad.push(player(i as u32 + 1, 120, 26, Some(1), &[(key, 20)]));
        }
        for (i, key) in ["aml", "aml", "amr", "amr", "amc", "st", "st", "st"].iter().enumerate() {
            squad.push(player(i as u32 + 20, 120, 26, Some(1), &[(key, 20)]));
        }
        squad
    }

    #[test]
    fn a_place_no_one_plays_is_short_and_filled_from_elsewhere() {
        let mut list = squad();
        list.push(player(100, 125, 28, Some(2), &[("gk", 20)]));
        list.push(player(101, 90, 28, Some(2), &[("gk", 20)]));
        list.push(player(102, 140, 28, Some(3), &[("gk", 20)]));
        let uids: Vec<u32> = list.iter().filter(|p| p.club_uid == Some(1)).map(|p| p.uid).collect();
        let players = PlayerIndex::new(list);
        let clubs = ClubIndex::new(vec![club(1, 5000), club(2, 5500), club(3, 9000)]);
        let staff = StaffIndex::new(Vec::new());

        // Who is within reach, not yet who would come.
        let options = AdviceOptions { interested: false, ..AdviceOptions::default() };
        let advice = advise(&club(1, 5000), &uids, None, &players, &staff, &clubs, &[1], None, &options);
        assert_eq!(advice.level, 120);
        let gk = &advice.roles[0];
        assert_eq!((gk.key, gk.need), ("gk", Need::Short));
        // 90 is too weak, and the club of reputation 9000 is out of reach.
        assert_eq!(gk.candidates.iter().map(|c| c.player.uid).collect::<Vec<_>>(), [100]);
        assert_eq!(advice.roles[1].need, Need::Covered);
    }

    #[test]
    fn a_weak_place_wants_an_upgrade() {
        let mut list = squad();
        list.push(player(50, 120, 26, Some(1), &[("gk", 20)]));
        list.push(player(51, 120, 26, Some(1), &[("gk", 20)]));
        // The strikers are poor: 95 where the team is at 120.
        for p in list.iter_mut().filter(|p| p.position_ratings[12] == 20) {
            p.current_ability = 95;
        }
        list.push(player(200, 104, 27, None, &[("st", 18)]));
        list.push(player(201, 118, 27, None, &[("st", 18)]));
        list.push(player(202, 96, 18, Some(2), &[("st", 16)]));
        list.last_mut().expect("a player").potential_ability = 160;
        let uids: Vec<u32> = list.iter().filter(|p| p.club_uid == Some(1)).map(|p| p.uid).collect();
        let players = PlayerIndex::new(list);
        let clubs = ClubIndex::new(vec![club(1, 5000), club(2, 3000)]);

        let advice = advise(
            &club(1, 5000),
            &uids,
            None,
            &players,
            &StaffIndex::new(Vec::new()),
            &clubs,
            &[1],
            None,
            &AdviceOptions::default(),
        );
        let st = advice.roles.iter().find(|r| r.key == "st").expect("strikers");
        assert_eq!(st.need, Need::Weak);
        let found: Vec<u32> = st.candidates.iter().map(|c| c.player.uid).collect();
        assert_eq!(found, [201, 200, 202]);
        assert!(st.candidates[2].tags.contains(&Tag::Prospect));
    }

    fn disposition(reputation: u16, ambition: u8) -> Disposition {
        Disposition {
            reputation,
            ambition,
            loyalty: 10,
            morale: 14,
            concerned: false,
            wage: Some(5000),
            asking_price: Some(1_000_000),
        }
    }

    fn candidate(club: Option<u32>, club_reputation: Option<u16>, gain: i32) -> Candidate {
        Candidate {
            player: player(9, 120, 26, club, &[("st", 20)]),
            rating: 20,
            gain,
            club_reputation,
            tags: if club.is_none() { vec![Tag::FreeAgent] } else { Vec::new() },
            asking_price: None,
            interest: None,
            pros: Vec::new(),
            cons: Vec::new(),
            domestic: false,
            score: 0,
        }
    }

    #[test]
    fn a_star_of_a_bigger_club_will_not_come() {
        // A club of 3000 asks a player of 6500 at a club of 6000, ambitious: no.
        let (interest, _, cons) = judge(&candidate(Some(2), Some(6000), 10), &disposition(6500, 17), Some(3000), None);
        assert_eq!(interest, Interest::Unlikely);
        assert!(
            cons.contains(&Reason::TooBig) && cons.contains(&Reason::StepDown) && cons.contains(&Reason::Ambitious)
        );
    }

    #[test]
    fn a_player_of_a_smaller_club_who_would_start_will() {
        let (interest, pros, _) = judge(&candidate(Some(2), Some(2000), 8), &disposition(2500, 12), Some(3000), None);
        assert_eq!(interest, Interest::Likely);
        assert!(pros.contains(&Reason::StepUp) && pros.contains(&Reason::Starter));
    }

    #[test]
    fn money_counts_against() {
        let finances = Finances {
            balance: 0,
            transfer_budget: 500_000,
            wage_budget: 4000,
            total_wage_budget: 100_000,
            ticket_price: 10.0,
        };
        let (_, _, cons) =
            judge(&candidate(Some(2), Some(3000), 0), &disposition(3000, 10), Some(3000), Some(&finances));
        assert!(cons.contains(&Reason::Wage) && cons.contains(&Reason::Fee));
        // A free agent costs no fee; asking more than the club can pay a week, he still will not come.
        let (interest, pros, cons) =
            judge(&candidate(None, None, 0), &disposition(3000, 10), Some(3000), Some(&finances));
        assert!(pros.contains(&Reason::FreeAgent) && !cons.contains(&Reason::Fee) && cons.contains(&Reason::Wage));
        assert_eq!(interest, Interest::Unlikely);
        // One the club can pay comes.
        let rich = Finances { wage_budget: 10_000, ..finances };
        let (interest, _, _) = judge(&candidate(None, None, 0), &disposition(3000, 10), Some(3000), Some(&rich));
        assert_eq!(interest, Interest::Likely);
    }

    #[test]
    fn free_agents_of_more_renown_than_the_club_will_not_come() {
        // Persija (4090) and the free agents who turned it down: reputations of 5500, 6059 and 6082.
        for renown in [5500, 6059, 6082] {
            let (interest, _, cons) = judge(&candidate(None, None, 10), &disposition(renown, 13), Some(4090), None);
            assert_eq!(interest, Interest::Unlikely, "a reputation of {renown}");
            assert!(cons.contains(&Reason::TooBig));
        }
        // One of the club's own renown, who would start, comes.
        let (interest, _, _) = judge(&candidate(None, None, 10), &disposition(3900, 12), Some(4090), None);
        assert_eq!(interest, Interest::Likely);
    }

    #[test]
    fn staff_jobs_no_one_does_are_short() {
        let staff = StaffIndex::new(vec![
            member(1, Some(1), Some(34), 15),
            member(2, None, Some(34), 18),
            member(3, Some(2), Some(34), 12),
            member(4, None, None, 14),
        ]);
        let clubs = ClubIndex::new(vec![club(1, 5000), club(2, 5000)]);
        let advice = advise(
            &club(1, 5000),
            &[],
            None,
            &PlayerIndex::new(Vec::new()),
            &staff,
            &clubs,
            &[1],
            None,
            &AdviceOptions::default(),
        );
        let goalkeeping = advice.staff.iter().find(|s| s.key == "goalkeeping").expect("goalkeeping coaches");
        assert_eq!((goalkeeping.need, goalkeeping.best_score), (Need::Covered, Some(150)));
        // Only the one better than 15: the free agent at 18.
        assert_eq!(goalkeeping.candidates.iter().map(|p| p.member.uid).collect::<Vec<_>>(), [2]);
        let physio = advice.staff.iter().find(|s| s.key == "physio").expect("physios");
        assert_eq!(physio.need, Need::Short);
        // Free agents first at a like score; the club's own goalkeeping coach is not suggested.
        assert_eq!(physio.candidates.iter().map(|p| p.member.uid).collect::<Vec<_>>(), [2, 4, 3]);
    }

    #[test]
    fn local_and_foreign_players_are_kept_apart() {
        let mut list: Vec<Candidate> =
            (0..6).map(|i| Candidate { domestic: i % 3 == 0, ..candidate(Some(2), Some(3000), 10) }).collect();
        keep_each(&mut list, 1);
        assert_eq!(list.len(), 2);
        assert!(list[0].domestic && !list[1].domestic);
    }

    #[test]
    fn a_youth_team_is_offered_no_one_over_its_age_limit() {
        let mut list = squad();
        list.push(player(100, 140, 25, Some(2), &[("gk", 20)]));
        list.push(player(101, 140, 18, Some(2), &[("gk", 20)]));
        let uids: Vec<u32> = (1..40).collect();
        let options = AdviceOptions { interested: false, ..AdviceOptions::default() };
        let players = PlayerIndex::new(list);
        let clubs = ClubIndex::new(vec![club(1, 5000), club(2, 3000)]);
        let staff = StaffIndex::new(Vec::new());
        let advice = advise(&club(1, 5000), &uids, Some(21), &players, &staff, &clubs, &[1], None, &options);
        let keeper = advice.roles.iter().find(|r| r.key == "gk").expect("a goalkeeper's place");
        assert!(keeper.candidates.iter().any(|c| c.player.uid == 101), "the young keeper");
        assert!(keeper.candidates.iter().all(|c| c.player.age.is_some_and(|age| age <= 21)));
    }

    #[test]
    fn the_eleven_puts_each_player_where_he_is_worth_most() {
        let keeper = player(1, 120, 25, Some(1), &[("gk", 20)]);
        let striker = player(2, 150, 25, Some(1), &[("st", 20), ("amc", 15)]);
        let playmaker = player(3, 140, 25, Some(1), &[("amc", 20), ("st", 12)]);
        let members = [&keeper, &striker, &playmaker];
        let eleven = best_eleven(&members, &FORMATIONS[1].1);
        let at =
            |key: &str| eleven.iter().find(|pick| pick.position == key).and_then(|p| p.player.as_ref()).map(|p| p.uid);
        assert_eq!(at("gk"), Some(1));
        assert_eq!(at("st"), Some(2));
        assert_eq!(at("amc"), Some(3));
        assert_eq!(eleven.iter().filter(|pick| pick.player.is_some()).count(), 3, "three players for eleven places");
    }
}
