//! The season's statistics the game keeps for every player in every competition: appearances, minutes, goals and the
//! detailed counts behind its data hub (passes, duels, pressures, expected goals and more).
//!
//! The game keeps a `GAME_COMP_STATS` object for each competition it records statistics for, with a record for each
//! player who has played in it (see [`SeasonLayout`]). Nothing the editor reads otherwise points at them, so they are
//! found by their class (see `rtti.rs`), which takes a second or two: the app reads them all once, when they are first
//! asked for. The records name the player and the team he played for by the game's ids (`PlayerSummary::id`,
//! `TeamLayout::id`), and the competition holds the kind of season it is: a domestic league or cup, a continental
//! club competition, or one of national teams.

use std::collections::{HashMap, HashSet};

use fmlibre_mem::{Module, Process, is_user_pointer};
use serde::Serialize;

use crate::profile::{Layout, SeasonLayout, SeasonRecordLayout};
use crate::rtti;
use crate::text::read_fm_string;

/// The class of the competitions' statistics.
const STATS_CLASS: &str = "GAME_COMP_STATS";
/// The classes of teams: a club's, and a nation's.
const TEAM_CLASS: &str = "db::TEAM";
const NATIONAL_TEAM_CLASS: &str = "db::NATIONAL_TEAM";
/// The game's competitions of friendlies, which a season's statistics leave out, and of reserve and youth leagues,
/// which keep no league table of their own.
const FRIENDLY_CLASS: &str = "sicomps::FRIENDLY_ACTUAL_COMP";
const RESERVE_CLASS: &str = "sicomps::RESERVE_CHILD_COMP";

/// The most player records one competition is taken to hold; more means the list was not read right.
const MAX_RECORDS: u64 = 20_000;

/// What kind of competition a player's statistics are from, which his season is split by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompetitionKind {
    League,
    Cup,
    /// A competition of clubs from more than one nation, such as the Champions League.
    Continental,
    /// A competition of national teams.
    International,
}

/// A player's statistics in one competition, or added up over several.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonStats {
    pub appearances: u32,
    /// Appearances off the bench; the others are starts.
    pub substitute: u32,
    /// The appearances that got a match rating, and the ratings added up in tenths: 667 over 10 is an average of 6.67.
    pub rated: u32,
    pub rating_tenths: u32,
    pub minutes: u32,
    pub goals: u32,
    pub assists: u32,
    /// Goals let in, as goalkeeper.
    pub conceded: u32,
    pub expected_goals: f64,
    pub expected_assists: f64,
    pub non_penalty_expected_goals: f64,
    pub passes: u32,
    pub passes_completed: u32,
    pub progressive_passes: u32,
    pub key_passes: u32,
    pub open_play_key_passes: u32,
    pub clear_cut_chances: u32,
    pub shots: u32,
    pub shots_on_target: u32,
    pub dribbles: u32,
    pub headers: u32,
    pub headers_won: u32,
    pub tackles: u32,
    pub tackles_won: u32,
    pub key_tackles: u32,
    pub interceptions: u32,
    pub clearances: u32,
    pub blocks: u32,
    pub possession_won: u32,
    pub possession_lost: u32,
    pub pressures: u32,
    pub pressures_won: u32,
    /// Distance covered, in hundreds of metres.
    pub distance: u32,
    pub sprints: u32,
    pub fouls: u32,
    pub fouls_against: u32,
    pub yellow_cards: u32,
    pub red_cards: u32,
    pub player_of_the_match: u32,
}

macro_rules! add_fields {
    ($into:ident, $from:ident; $($field:ident),* $(,)?) => {
        $( $into.$field += $from.$field; )*
    };
}

impl SeasonStats {
    /// Adds `other` in, e.g. to make a season of all competitions out of each one's.
    pub fn add(&mut self, other: &SeasonStats) {
        add_fields!(self, other;
            appearances, substitute, rated, rating_tenths, minutes, goals, assists, conceded, expected_goals,
            expected_assists, non_penalty_expected_goals, passes, passes_completed, progressive_passes, key_passes,
            open_play_key_passes, clear_cut_chances, shots, shots_on_target, dribbles, headers, headers_won, tackles,
            tackles_won, key_tackles, interceptions, clearances, blocks, possession_won, possession_lost, pressures,
            pressures_won, distance, sprints, fouls, fouls_against, yellow_cards, red_cards, player_of_the_match,
        );
    }

    /// Reads a record of [`SeasonRecordLayout::size`] bytes.
    fn from_record(r: &SeasonRecordLayout, bytes: &[u8]) -> Self {
        let u8_at = |offset: u64| u32::from(bytes[offset as usize]);
        let u16_at = |offset: u64| u32::from(u16::from_le_bytes([bytes[offset as usize], bytes[offset as usize + 1]]));
        let f32_at = |offset: u64| {
            let value = f32::from_le_bytes(bytes[offset as usize..offset as usize + 4].try_into().expect("4 bytes"));
            if value.is_finite() && value >= 0.0 { f64::from(value) } else { 0.0 }
        };
        Self {
            appearances: u8_at(r.appearances),
            substitute: u8_at(r.substitute),
            rated: u8_at(r.rated),
            rating_tenths: u16_at(r.rating),
            minutes: u16_at(r.minutes),
            goals: u8_at(r.goals),
            assists: u8_at(r.assists),
            conceded: u8_at(r.conceded),
            expected_goals: f32_at(r.expected_goals),
            expected_assists: f32_at(r.expected_assists),
            non_penalty_expected_goals: f32_at(r.non_penalty_expected_goals),
            passes: u16_at(r.passes),
            passes_completed: u16_at(r.passes_completed),
            progressive_passes: u16_at(r.progressive_passes),
            key_passes: u16_at(r.key_passes),
            open_play_key_passes: u16_at(r.open_play_key_passes),
            clear_cut_chances: u16_at(r.clear_cut_chances),
            shots: u16_at(r.shots),
            shots_on_target: u16_at(r.shots_on_target),
            dribbles: u16_at(r.dribbles),
            headers: u16_at(r.headers),
            headers_won: u16_at(r.headers_won),
            tackles: u16_at(r.tackles),
            tackles_won: u16_at(r.tackles_won),
            key_tackles: u16_at(r.key_tackles),
            interceptions: u16_at(r.interceptions),
            clearances: u16_at(r.clearances),
            blocks: u16_at(r.blocks),
            possession_won: u16_at(r.possession_won),
            possession_lost: u16_at(r.possession_lost),
            pressures: u16_at(r.pressures),
            pressures_won: u16_at(r.pressures_won),
            distance: u16_at(r.distance),
            sprints: u16_at(r.sprints),
            fouls: u16_at(r.fouls),
            fouls_against: u16_at(r.fouls_against),
            yellow_cards: u8_at(r.yellow_cards),
            red_cards: u8_at(r.red_cards),
            player_of_the_match: u8_at(r.player_of_the_match),
        }
    }
}

/// A competition the game keeps statistics for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Competition {
    /// The name the game shows in lists ("FA Cup"), and the full one ("English FA Cup").
    pub name: String,
    pub full_name: String,
    /// Whether it belongs to a nation: a league or a cup, rather than a continental or international competition.
    pub domestic: bool,
    /// Whether it is a league: one with a table, or a reserve or youth league.
    pub league: bool,
}

/// A team that a player's statistics name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonTeam {
    /// The club's name, or the nation's for a national team.
    pub name: String,
    pub national: bool,
    /// The kind of team, 0 for a club's first team (see `TeamLayout::kind`), and the oldest its players may be: 21
    /// for an under-21 team, 100 for none.
    pub kind: u8,
    pub age_limit: u8,
}

/// A player's statistics in one competition, for one team.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonLine {
    pub competition: String,
    pub competition_full_name: String,
    pub kind: CompetitionKind,
    /// The team he played for; `None` for one that could not be read.
    pub team: Option<SeasonTeam>,
    pub stats: SeasonStats,
}

/// The broad role a player's best position gives him, which his numbers are compared within.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PositionGroup {
    Goalkeeper,
    CentreBack,
    FullBack,
    DefensiveMidfielder,
    CentralMidfielder,
    Winger,
    AttackingMidfielder,
    Striker,
}

impl PositionGroup {
    /// The group of the position he is rated best at, the first of them in [`crate::POSITIONS`] order on a tie;
    /// `None` for no ratings.
    pub fn of(ratings: &[u8; 15]) -> Option<Self> {
        let best = *ratings.iter().max()?;
        let index = ratings.iter().position(|&rating| rating == best)?;
        // GK, SW, DL, DC, DR, DM, ML, MC, MR, AML, AMC, AMR, ST, WBL, WBR
        Some(match index {
            0 => Self::Goalkeeper,
            1 | 3 => Self::CentreBack,
            2 | 4 | 13 | 14 => Self::FullBack,
            5 => Self::DefensiveMidfielder,
            7 => Self::CentralMidfielder,
            6 | 8 | 9 | 11 => Self::Winger,
            10 => Self::AttackingMidfielder,
            _ => Self::Striker,
        })
    }
}

/// The players a player's league statistics are compared with: those of his league in his position group who have
/// played enough of it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonComparison {
    pub competition: String,
    pub group: PositionGroup,
    /// The fewest minutes in the league a player needed to be compared.
    pub min_minutes: u32,
    /// Each one's statistics in the league, not his own.
    pub pool: Vec<SeasonStats>,
}

/// The fewest players a comparison is made with.
const MIN_POOL: usize = 5;

/// The most minutes a player needs to be compared; fewer while the season is young (see [`SeasonIndex::comparison`]).
const COMPARE_MINUTES: u32 = 450;

struct Line {
    competition: usize,
    team: u32,
    stats: SeasonStats,
}

/// The season's statistics of every player, read once from the running game.
pub struct SeasonIndex {
    competitions: Vec<Competition>,
    /// By person id.
    lines: HashMap<u32, Vec<Line>>,
    /// The teams the lines name, by team id.
    teams: HashMap<u32, SeasonTeam>,
}

impl SeasonIndex {
    /// The competitions it holds statistics of.
    pub fn competitions(&self) -> &[Competition] {
        &self.competitions
    }

    /// The statistics of the person with `id`, a line per competition and team, the most minutes first.
    pub fn lines(&self, id: u32) -> Vec<SeasonLine> {
        let mut lines: Vec<SeasonLine> =
            self.lines.get(&id).into_iter().flatten().map(|line| self.line(line)).collect();
        lines.sort_by_key(|line| std::cmp::Reverse(line.stats.minutes));
        lines
    }

    fn line(&self, line: &Line) -> SeasonLine {
        let competition = &self.competitions[line.competition];
        let team = self.teams.get(&line.team).cloned();
        let kind = if team.as_ref().is_some_and(|team| team.national) {
            CompetitionKind::International
        } else if !competition.domestic {
            CompetitionKind::Continental
        } else if competition.league {
            CompetitionKind::League
        } else {
            CompetitionKind::Cup
        };
        SeasonLine {
            competition: competition.name.clone(),
            competition_full_name: competition.full_name.clone(),
            kind,
            team,
            stats: line.stats.clone(),
        }
    }

    /// The players the league statistics of the person with `id` are compared with: in the league he has played most
    /// minutes of for a club, those of `group` (as `group_of` gives a person's) with at least half the minutes the
    /// most-played one has there, up to [`COMPARE_MINUTES`]. `None` when he has no league, or too few qualify.
    pub fn comparison(
        &self,
        id: u32,
        group: PositionGroup,
        group_of: impl Fn(u32) -> Option<PositionGroup>,
    ) -> Option<SeasonComparison> {
        let league = self
            .lines
            .get(&id)?
            .iter()
            .filter(|line| {
                let competition = &self.competitions[line.competition];
                competition.domestic && competition.league && !self.teams.get(&line.team).is_some_and(|t| t.national)
            })
            .max_by_key(|line| line.stats.minutes)?
            .competition;
        let played: Vec<(u32, &Line)> = self
            .lines
            .iter()
            .flat_map(|(&person, lines)| lines.iter().map(move |line| (person, line)))
            .filter(|(_, line)| line.competition == league)
            .collect();
        let most = played.iter().map(|(_, line)| line.stats.minutes).max().unwrap_or(0);
        let min_minutes = (most / 2).clamp(1, COMPARE_MINUTES);
        let pool: Vec<SeasonStats> = played
            .into_iter()
            .filter(|&(person, line)| {
                person != id && line.stats.minutes >= min_minutes && group_of(person) == Some(group)
            })
            .map(|(_, line)| line.stats.clone())
            .collect();
        (pool.len() >= MIN_POOL).then(|| SeasonComparison {
            competition: self.competitions[league].name.clone(),
            group,
            min_minutes,
            pool,
        })
    }
}

/// Reads the season's statistics of every player: `None` where the layout does not place them, or where the game
/// holds none it can find (e.g. a build whose classes this cannot name). Only reads memory.
pub fn read_season(process: &Process, plugin: &Module, layout: &Layout) -> Option<SeasonIndex> {
    let s = layout.season.as_ref()?;
    let team_id = layout.team.id?;

    let stats_vtables = rtti::vtables(process, plugin, STATS_CLASS);
    let team_vtables = rtti::vtables(process, plugin, TEAM_CLASS);
    let national_vtables = rtti::vtables(process, plugin, NATIONAL_TEAM_CLASS);
    let wanted: Vec<u64> = [&stats_vtables, &team_vtables, &national_vtables].into_iter().flatten().copied().collect();
    let objects = rtti::objects(process, plugin, &wanted).ok()?;
    let of = |vtables: &[u64]| -> Vec<u64> { vtables.iter().flat_map(|v| objects[v].iter().copied()).collect() };
    let stats_objects = of(&stats_vtables);
    if stats_objects.is_empty() {
        return None;
    }

    let friendly = rtti::mangled(FRIENDLY_CLASS);
    let reserve = rtti::mangled(RESERVE_CLASS);
    let mut competitions = Vec::new();
    let mut lines: HashMap<u32, Vec<Line>> = HashMap::new();
    let mut record = vec![0u8; s.record.size as usize];
    for stats in stats_objects {
        let Some(competition) = read_competition(process, plugin, s, stats, &friendly, &reserve) else {
            continue;
        };
        let Some(pointers) = read_list(process, stats + s.players) else {
            continue;
        };
        let index = competitions.len();
        competitions.push(competition);
        for pointer in pointers.as_chunks::<8>().0.iter().map(|chunk| u64::from_le_bytes(*chunk)) {
            // The records are 0xAC bytes long and sit one after another, so half of them start 4 bytes past a
            // multiple of 8.
            if !is_user_pointer(pointer & !7) || process.read_into(pointer, &mut record).is_err() {
                continue;
            }
            let word = |offset: u64| u32::from_le_bytes(record[offset as usize..][..4].try_into().expect("4 bytes"));
            let stats = SeasonStats::from_record(&s.record, &record);
            if stats.appearances == 0 {
                continue;
            }
            let line = Line { competition: index, team: word(s.record.team), stats };
            lines.entry(word(s.record.person)).or_default().push(line);
        }
    }

    // The teams the lines name: a club's team points at its club, a national team at the container of its nation.
    let named: HashSet<u32> = lines.values().flatten().map(|line| line.team).collect();
    let mut teams = HashMap::new();
    for (national, objects) in [(false, of(&team_vtables)), (true, of(&national_vtables))] {
        for team in objects {
            let Ok(id) = process.read_u32(team + team_id) else { continue };
            if !named.contains(&id) || teams.contains_key(&id) {
                continue;
            }
            if let Some(name) = read_team(process, layout, s, team, national) {
                teams.insert(id, name);
            }
        }
    }

    Some(SeasonIndex { competitions, lines, teams })
}

/// The competition a statistics object belongs to; `None` for friendlies, and for a stage of another competition,
/// whose players' records that competition holds again.
fn read_competition(
    process: &Process,
    plugin: &Module,
    s: &SeasonLayout,
    stats: u64,
    friendly: &str,
    reserve: &str,
) -> Option<Competition> {
    let comp = process.read_u64(stats + s.competition).ok().filter(|&p| is_user_pointer(p))?;
    read_list(process, stats + s.teams)?;
    let game = process.read_u64(comp + s.comp.game).ok().filter(|&p| is_user_pointer(p));
    let class = game.and_then(|game| rtti::class_of(process, plugin, game));
    if class.as_deref() == Some(friendly) {
        return None;
    }
    let full_name = read_fm_string(process, process.read_u64(comp + s.comp.name).ok()?)?;
    let name = process
        .read_u64(comp + s.comp.short_name)
        .ok()
        .and_then(|ptr| read_fm_string(process, ptr))
        .unwrap_or_else(|| full_name.clone());
    let domestic = process.read_u64(comp + s.comp.nation).is_ok_and(is_user_pointer);
    let league = read_list(process, stats + s.table).is_some() || class.as_deref() == Some(reserve);
    Some(Competition { name, full_name, domestic, league })
}

/// The bytes of a `(begin, end)` list of pointers at `at`; `None` when it is empty or does not look like one.
fn read_list(process: &Process, at: u64) -> Option<Vec<u8>> {
    let begin = process.read_u64(at).ok()?;
    let end = process.read_u64(at + 8).ok()?;
    let len = end.checked_sub(begin)?;
    if !is_user_pointer(begin) || len == 0 || len % 8 != 0 || len / 8 > MAX_RECORDS {
        return None;
    }
    process.read_bytes(begin, len as usize).ok()
}

fn read_team(process: &Process, layout: &Layout, s: &SeasonLayout, team: u64, national: bool) -> Option<SeasonTeam> {
    let t = &layout.team;
    let owner = process.read_u64(team + t.club).ok().filter(|&p| is_user_pointer(p))?;
    let name = if national {
        let nation = process.read_u64(owner + s.national.nation).ok().filter(|&p| is_user_pointer(p))?;
        read_fm_string(process, process.read_u64(nation + layout.nation.name).ok()?)?
    } else {
        read_fm_string(process, process.read_u64(owner + layout.club.name).ok()?)?
    };
    let byte = |offset: u64| process.read_bytes(team + offset, 1).ok().map_or(0, |b| b[0]);
    Some(SeasonTeam { name, national, kind: byte(t.kind), age_limit: byte(t.age_limit) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ratings(pairs: &[(usize, u8)]) -> [u8; 15] {
        let mut ratings = [1u8; 15];
        for &(index, rating) in pairs {
            ratings[index] = rating;
        }
        ratings
    }

    #[test]
    fn the_best_position_gives_the_group() {
        // Arda Güler: AMC 20, AMR 19, MC 18.
        assert_eq!(
            PositionGroup::of(&ratings(&[(10, 20), (11, 19), (7, 18)])),
            Some(PositionGroup::AttackingMidfielder)
        );
        assert_eq!(PositionGroup::of(&ratings(&[(0, 20)])), Some(PositionGroup::Goalkeeper));
        assert_eq!(PositionGroup::of(&ratings(&[(14, 20), (4, 18)])), Some(PositionGroup::FullBack));
        assert_eq!(PositionGroup::of(&ratings(&[(12, 20), (10, 20)])), Some(PositionGroup::AttackingMidfielder));
    }

    #[test]
    fn competitions_add_up() {
        let league = SeasonStats {
            appearances: 10,
            minutes: 613,
            rating_tenths: 667,
            expected_goals: 2.12,
            ..Default::default()
        };
        let cup = SeasonStats {
            appearances: 2,
            minutes: 180,
            rating_tenths: 138,
            expected_goals: 0.24,
            ..Default::default()
        };
        let mut all = SeasonStats::default();
        all.add(&league);
        all.add(&cup);
        assert_eq!((all.appearances, all.minutes, all.rating_tenths), (12, 793, 805));
        assert!((all.expected_goals - 2.36).abs() < 1e-9);
    }
}
