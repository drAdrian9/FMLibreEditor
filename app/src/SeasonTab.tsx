// A player's season: the Season tab of his profile. The game keeps statistics of each competition he plays in (see
// `season.rs`); the tab adds up those of the competitions picked, shows the main figures at the top, groups the
// detailed ones with each value per 90 minutes and its percentile among the players of his league and position, and
// lists the competitions in a table.

import { useEffect, useState, type ReactNode } from "react";
import { call } from "./api";
import { describeError, formatNumber, formatPercent } from "./format";
import { profileText, seasonText as text } from "./labels";
import type { PanelIds } from "./ProfileParts";
import type { CompetitionKind, PlayerSeason, SeasonComparison, SeasonLine, SeasonStats, SeasonTeam } from "./types";

/** The competitions a view adds up: all of a club's, or those of one kind. */
type Scope = "all" | CompetitionKind;

const KINDS: readonly CompetitionKind[] = ["league", "cup", "continental", "international"];

/** The fewest minutes a value per 90 is worked out from: fewer would say more about chance than about the player. */
const MIN_PER_90 = 90;

interface SeasonTabProps {
  /** The player's UID. */
  uid: number;
  /** Changes when the game data is read again, so the season is too. */
  version: number;
  panel: PanelIds;
}

export function SeasonTab({ uid, version, panel }: SeasonTabProps) {
  const [season, setSeason] = useState<PlayerSeason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);

  useEffect(() => {
    let live = true;
    setSeason(null);
    setError(null);
    call<PlayerSeason>("player_season", { uid })
      .then((loaded) => live && setSeason(loaded))
      .catch((e: unknown) => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [uid, version]);

  const body = () => {
    if (error !== null) {
      return <p className="banner">{text.failed(error)}</p>;
    }
    if (season === null) {
      return <p className="muted">{text.loading}</p>;
    }
    if (season.lines.length === 0) {
      return <p className="muted">{text.empty}</p>;
    }
    const scopes = scopesOf(season.lines);
    const shown = scope !== null && scopes.includes(scope) ? scope : scopes[0];
    const lines = season.lines.filter((line) => inScope(line, shown));
    const stats = addUp(lines);
    return (
      <>
        <div className="season-scopes" role="group" aria-label={text.scopesLabel}>
          {scopes.map((id) => (
            <button key={id} type="button" aria-pressed={id === shown} onClick={() => setScope(id)}>
              {text.scopes[id]}
            </button>
          ))}
        </div>
        <Figures stats={stats} lines={shown === "all" ? lines : null} />
        <div className="season-groups">
          {GROUPS.map(([group, metrics]) => (
            <MetricGroup
              key={group}
              title={text.groups[group]}
              metrics={metrics}
              stats={stats}
              comparison={season.comparison}
            />
          ))}
        </div>
        <p className="note">
          {season.comparison === null
            ? text.notCompared
            : text.compared(
                season.comparison.pool.length,
                text.groupNames[season.comparison.group],
                season.comparison.competition,
                season.comparison.minMinutes,
              )}
        </p>
        <CompetitionTable lines={season.lines} />
      </>
    );
  };

  return (
    <div className="season-tab" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
      {body()}
    </div>
  );
}

/** The views on offer: all club competitions when he played in any, then each kind he played in. */
function scopesOf(lines: readonly SeasonLine[]): Scope[] {
  const kinds = KINDS.filter((kind) => lines.some((line) => line.kind === kind));
  return kinds.some((kind) => kind !== "international") ? ["all", ...kinds] : kinds;
}

function inScope(line: SeasonLine, scope: Scope): boolean {
  return scope === "all" ? line.kind !== "international" : line.kind === scope;
}

/** The statistics of `lines` added up. */
function addUp(lines: readonly SeasonLine[]): SeasonStats {
  const total = { ...EMPTY };
  for (const { stats } of lines) {
    for (const key of Object.keys(total) as (keyof SeasonStats)[]) {
      total[key] += stats[key];
    }
  }
  return total;
}

const EMPTY: SeasonStats = {
  appearances: 0,
  substitute: 0,
  rated: 0,
  ratingTenths: 0,
  minutes: 0,
  goals: 0,
  assists: 0,
  conceded: 0,
  expectedGoals: 0,
  expectedAssists: 0,
  nonPenaltyExpectedGoals: 0,
  passes: 0,
  passesCompleted: 0,
  progressivePasses: 0,
  keyPasses: 0,
  openPlayKeyPasses: 0,
  clearCutChances: 0,
  shots: 0,
  shotsOnTarget: 0,
  dribbles: 0,
  headers: 0,
  headersWon: 0,
  tackles: 0,
  tacklesWon: 0,
  keyTackles: 0,
  interceptions: 0,
  clearances: 0,
  blocks: 0,
  possessionWon: 0,
  possessionLost: 0,
  pressures: 0,
  pressuresWon: 0,
  distance: 0,
  sprints: 0,
  fouls: 0,
  foulsAgainst: 0,
  yellowCards: 0,
  redCards: 0,
  playerOfTheMatch: 0,
};

const decimals = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The average match rating, "6.71"; nothing when no match was rated. */
const rating = (stats: SeasonStats) =>
  stats.rated > 0 ? decimals(stats.ratingTenths / 10 / stats.rated) : profileText.none;

/** The main figures, as cards across the top. `lines` splits the appearances by kind, when all are shown. */
function Figures({ stats, lines }: { stats: SeasonStats; lines: readonly SeasonLine[] | null }) {
  const split =
    lines &&
    KINDS.map((kind) => [kind, addUp(lines.filter((line) => line.kind === kind)).appearances] as const)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => text.kindCount[kind](count))
      .join(" · ");
  const figures: [string, ReactNode, string | null][] = [
    [text.appearances, formatNumber(stats.appearances), split || null],
    [
      text.starts,
      formatNumber(stats.appearances - stats.substitute),
      stats.substitute > 0 ? text.offBench(stats.substitute) : null,
    ],
    [
      text.minutes,
      formatNumber(stats.minutes),
      stats.goals > 0 ? text.minutesPerGoal(Math.round(stats.minutes / stats.goals)) : null,
    ],
    [text.goals, formatNumber(stats.goals), text.expectedGoals(decimals(stats.expectedGoals))],
    [text.assists, formatNumber(stats.assists), text.expectedAssists(decimals(stats.expectedAssists))],
    [text.rating, rating(stats), text.rated(stats.rated)],
    [text.playerOfTheMatch, formatNumber(stats.playerOfTheMatch), null],
    [
      text.cards,
      <Cards yellow={stats.yellowCards} red={stats.redCards} />,
      text.fouls(stats.fouls, stats.foulsAgainst),
    ],
  ];
  return (
    <dl className="season-figures">
      {figures.map(([label, value, note]) => (
        <div key={label} className="season-figure">
          <dt>{label}</dt>
          <dd>
            <span className="season-figure-value">{value}</span>
            {note && <span className="season-figure-note">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The cards as the referee shows them, a yellow and a red one with their counts; in words for assistive technology. */
function Cards({ yellow, red }: { yellow: number; red: number }) {
  const words = text.cardsValue(yellow, red);
  return (
    <span title={words}>
      <span aria-hidden="true">
        <span className="season-card yellow" />
        {formatNumber(yellow)}
        <span className="season-card red" />
        {formatNumber(red)}
      </span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

/**
 * A value of the season: its figure, and what the percentile compares, a value per 90 minutes or a rate, with how
 * that is written. `lowerIsBetter` turns the percentile round: fewer is better there.
 */
interface Metric {
  key: keyof typeof text.rows;
  total: (stats: SeasonStats) => string;
  measure: (stats: SeasonStats) => number | null;
  show: (value: number) => string;
  lowerIsBetter?: boolean;
}

const per90 = (count: number, stats: SeasonStats) =>
  stats.minutes >= MIN_PER_90 ? (count / stats.minutes) * 90 : null;

/** A count, compared per 90 minutes. */
const count = (key: Metric["key"], of: (s: SeasonStats) => number, lowerIsBetter = false): Metric => ({
  key,
  total: (s) => formatNumber(of(s)),
  measure: (s) => per90(of(s), s),
  show: decimals,
  lowerIsBetter,
});

/** An expected value, compared per 90 minutes. */
const expected = (key: Metric["key"], of: (s: SeasonStats) => number): Metric => ({
  key,
  total: (s) => decimals(of(s)),
  measure: (s) => per90(of(s), s),
  show: decimals,
});

/** A share, "12 of 25", compared as a percentage. */
const share = (key: Metric["key"], part: (s: SeasonStats) => number, whole: (s: SeasonStats) => number): Metric => ({
  key,
  total: (s) => text.of(part(s), whole(s)),
  measure: (s) => (whole(s) > 0 ? (part(s) / whole(s)) * 100 : null),
  show: (value) => formatPercent(value, { maximumFractionDigits: 1 }),
});

const GROUPS: readonly [keyof typeof text.groups, readonly Metric[]][] = [
  [
    "creation",
    [
      count("assists", (s) => s.assists),
      expected("expectedAssists", (s) => s.expectedAssists),
      count("keyPasses", (s) => s.keyPasses),
      count("openPlayKeyPasses", (s) => s.openPlayKeyPasses),
      count("clearCutChances", (s) => s.clearCutChances),
      share("passCompletion", (s) => s.passesCompleted, (s) => s.passes),
      count("progressivePasses", (s) => s.progressivePasses),
    ],
  ],
  [
    "finishing",
    [
      count("goals", (s) => s.goals),
      expected("expectedGoals", (s) => s.expectedGoals),
      expected("nonPenaltyExpectedGoals", (s) => s.nonPenaltyExpectedGoals),
      count("shots", (s) => s.shots),
      share("shotsOnTarget", (s) => s.shotsOnTarget, (s) => s.shots),
      {
        key: "expectedGoalsPerShot",
        total: (s) => (s.shots > 0 ? decimals(s.nonPenaltyExpectedGoals / s.shots) : profileText.none),
        measure: (s) => (s.shots > 0 ? s.nonPenaltyExpectedGoals / s.shots : null),
        show: decimals,
      },
      share("conversion", (s) => s.goals, (s) => s.shots),
    ],
  ],
  [
    "duels",
    [
      share("headersWon", (s) => s.headersWon, (s) => s.headers),
      share("tacklesWon", (s) => s.tacklesWon, (s) => s.tackles),
      count("dribbles", (s) => s.dribbles),
      count("possessionLost", (s) => s.possessionLost, true),
      count("foulsWon", (s) => s.foulsAgainst),
      count("fouls", (s) => s.fouls, true),
    ],
  ],
  [
    "defending",
    [
      count("interceptions", (s) => s.interceptions),
      count("clearances", (s) => s.clearances),
      count("blocks", (s) => s.blocks),
      count("keyTackles", (s) => s.keyTackles),
      count("possessionWon", (s) => s.possessionWon),
    ],
  ],
  [
    "pressing",
    [
      {
        key: "pressures",
        total: (s) => text.of(s.pressuresWon, s.pressures),
        measure: (s) => per90(s.pressuresWon, s),
        show: decimals,
      },
      {
        key: "distance",
        total: (s) => text.km(formatNumber(s.distance / 10, { maximumFractionDigits: 1 })),
        measure: (s) => per90(s.distance / 10, s),
        show: (km) => text.km(formatNumber(km, { minimumFractionDigits: 1, maximumFractionDigits: 1 })),
      },
      count("sprints", (s) => s.sprints),
    ],
  ],
];

/** Where `value` stands among `pool`: the share of them it beats, 0–100. */
function percentile(value: number, pool: readonly number[], lowerIsBetter: boolean): number {
  const beaten = pool.filter((other) => (lowerIsBetter ? other > value : other < value)).length;
  return Math.round((beaten / pool.length) * 100);
}

interface MetricGroupProps {
  title: string;
  metrics: readonly Metric[];
  stats: SeasonStats;
  comparison: SeasonComparison | null;
}

/** A group of values: a row each, with the season's figure, the value per 90 or the rate, and its percentile. */
function MetricGroup({ title, metrics, stats, comparison }: MetricGroupProps) {
  return (
    <section className="profile-group">
      <h3>{title}</h3>
      <table className="season-metrics">
        <thead className="sr-only">
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">{text.total}</th>
            <th scope="col">{text.per90}</th>
            {comparison && <th scope="col">{text.percentile}</th>}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const value = metric.measure(stats);
            const pool = comparison?.pool.map(metric.measure).filter((v): v is number => v !== null) ?? [];
            return (
              <tr key={metric.key}>
                <th scope="row">
                  {text.rows[metric.key]}
                  {metric.lowerIsBetter && (
                    <span className="season-lower" title={text.lowerIsBetter}>
                      <span aria-hidden="true">↓</span>
                      <span className="sr-only">{text.lowerIsBetter}</span>
                    </span>
                  )}
                </th>
                <td>{metric.total(stats)}</td>
                <td className="season-measure">{value === null ? profileText.none : metric.show(value)}</td>
                {comparison && (
                  <td>
                    {value !== null && pool.length > 0 && (
                      <Percentile value={percentile(value, pool, metric.lowerIsBetter ?? false)} />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** A percentile as a bar in the band of FM's ratings it falls in, with the number. */
function Percentile({ value }: { value: number }) {
  const tier = value >= 75 ? 4 : value >= 50 ? 3 : value >= 25 ? 2 : 1;
  return (
    <span className="season-percentile" title={text.percentileTitle(value)}>
      <span className="season-percentile-track" aria-hidden="true">
        <span className={`season-percentile-fill tier-${tier}`} style={{ width: `${Math.max(value, 2)}%` }} />
      </span>
      <span className={`season-percentile-value tier-${tier}`}>{value}</span>
    </span>
  );
}

/** "Arsenal", "Arsenal U21", "Türkiye". */
function teamName(team: SeasonTeam | null): string {
  if (team === null) {
    return profileText.none;
  }
  const young = team.ageLimit > 0 && team.ageLimit < 100 && (team.national || team.kind !== 0);
  return young ? text.teamAge(team.name, team.ageLimit) : team.name;
}

/** Every competition he played in this season, by kind, then the most minutes first. */
function CompetitionTable({ lines }: { lines: readonly SeasonLine[] }) {
  const sorted = [...lines].sort(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || b.stats.minutes - a.stats.minutes,
  );
  const c = text.columns;
  return (
    <div className="season-table-wrap">
      <table className="grid season-grid" aria-label={text.tableLabel}>
        <thead>
          <tr>
            <th scope="col">{c.competition}</th>
            <th scope="col" className="num">
              {c.appearances}
            </th>
            <th scope="col" className="num">
              {c.minutes}
            </th>
            <th scope="col" className="num">
              {c.goals}
            </th>
            <th scope="col" className="num">
              {c.assists}
            </th>
            <th scope="col" className="num">
              {c.expectedGoals}
            </th>
            <th scope="col" className="num">
              {c.expectedAssists}
            </th>
            <th scope="col" className="num">
              {c.rating}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((line, i) => (
            <tr key={i}>
              <td>
                <span className="season-competition" title={line.competitionFullName}>
                  {line.competition}
                </span>
                <span className="sub">{teamName(line.team)}</span>
              </td>
              <td className="num">
                {formatNumber(line.stats.appearances)}
                {line.stats.substitute > 0 && <span className="muted"> {text.substitutes(line.stats.substitute)}</span>}
              </td>
              <td className="num">{formatNumber(line.stats.minutes)}</td>
              <td className="num">{formatNumber(line.stats.goals)}</td>
              <td className="num">{formatNumber(line.stats.assists)}</td>
              <td className="num">{decimals(line.stats.expectedGoals)}</td>
              <td className="num">{decimals(line.stats.expectedAssists)}</td>
              <td className="num">{rating(line.stats)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
