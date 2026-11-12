// The Advisor view: what the squad and the staff of the club the user manages are short of, and who would fill those
// places, from the lists the app has read (see `club_advice`). It writes nothing; a player or a member of staff opens in
// a dialog over the view, whose profile offers editing and moving them as the lists do.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Ability } from "./Ability";
import { call } from "./api";
import { describeError, formatDate, formatMoney, formatNumber } from "./format";
import { adviceText as text, jobLabel, positionLabel, profileText, STAFF_ATTRIBUTE_LABELS, teamLabel } from "./labels";
import { ClubLogo, PICTURE_SIZE, WithPicture } from "./Picture";
import { PlayerDialog } from "./PlayerProfile";
import { tierClass } from "./ProfileParts";
import { StaffDialog } from "./StaffProfile";
import type {
  AdviceOptions,
  AdviceTag,
  Candidate,
  ClubAdvice,
  Readiness,
  ClubPage,
  Need,
  PlayerSummary,
  RoleAdvice,
  StaffAdvice,
  StaffPick,
  StaffSummary,
} from "./types";

type Section = "squad" | "eleven" | "readiness" | "staff";

/** The formations the suggested eleven can be drawn in (see `FORMATIONS` in advice.rs). */
const FORMATIONS = ["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "4-4-1-1", "3-5-2", "3-4-3", "5-3-2"];

/** The oldest a suggested player may be, as the select offers it. */
const MAX_AGES = [21, 23, 25, 28, 30, 32, 35];

const PER_ROLE = 12;

/** The most urgent need first; places of the same need in pitch order. */
const NEED_RANK: Record<Need, number> = { short: 0, weak: 1, thin: 2, covered: 3 };

/** The first place or job of the most urgent need: what the view opens on. */
function mostUrgent<T extends { key: string; need: Need }>(items: readonly T[]): string | null {
  return [...items].sort((a, b) => NEED_RANK[a.need] - NEED_RANK[b.need])[0]?.key ?? null;
}

/** A score ×10 as the 1–20 scale shows it: "13.5". */
const score = (value: number) => formatNumber(value / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Opens a row with Enter or Space, as a click does. */
const openOnKey = (open: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
};

export function AdviceView({ version, active }: { version: number; active: boolean }) {
  const [humanClubs, setHumanClubs] = useState<{ uid: number; name: string }[]>([]);
  const [club, setClub] = useState<number | null>(null);
  const [team, setTeam] = useState(0);
  const [formation, setFormation] = useState(FORMATIONS[0]);
  const [useTactic, setUseTactic] = useState(false);
  const [maxAge, setMaxAge] = useState(32);
  const [realistic, setRealistic] = useState(true);
  const [interested, setInterested] = useState(true);
  const [section, setSection] = useState<Section>("squad");
  const [advice, setAdvice] = useState<ClubAdvice | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownPlayer, setShownPlayer] = useState<PlayerSummary | null>(null);
  const [shownStaff, setShownStaff] = useState<StaffSummary | null>(null);
  // What the advice on screen was drawn from: it is drawn again only when that changes while the view is shown.
  const drawn = useRef<string | null>(null);
  const asked = useRef(0);
  const [again, setAgain] = useState(0);

  // The clubs human managers run, named, for the choice of club; read again with the game data.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const uids = await call<number[]>("human_clubs");
        const named = await Promise.all(
          uids.map(async (uid) => {
            const page = await call<ClubPage>("search_clubs", { query: String(uid), limit: 1 });
            return { uid, name: page.rows.find((c) => c.uid === uid)?.name ?? String(uid) };
          }),
        );
        if (!cancelled) {
          setHumanClubs(named);
        }
      } catch {
        // The advice says what is wrong when it cannot be drawn.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    const key = JSON.stringify([version, club, team, formation, useTactic, maxAge, realistic, interested, again]);
    if (!active || drawn.current === key) {
      return;
    }
    drawn.current = key;
    const mine = ++asked.current;
    const options: AdviceOptions = { maxAge, realistic, interested, perRole: PER_ROLE, team, formation, useTactic };
    setBusy(true);
    setError(null);
    call<ClubAdvice>("club_advice", { club, options })
      .then((next) => {
        if (mine !== asked.current) {
          return;
        }
        setAdvice(next);
        // The place and job picked stay picked when the advice is drawn again; the first time, the most urgent.
        setRole((r) => (r && next.roles.some((x) => x.key === r) ? r : mostUrgent(next.roles)));
        setJob((j) => (j && next.staff.some((x) => x.key === j) ? j : mostUrgent(next.staff)));
      })
      .catch((e) => {
        if (mine === asked.current) {
          setError(describeError(e));
        }
      })
      .finally(() => {
        if (mine === asked.current) {
          setBusy(false);
        }
      });
  }, [active, version, club, team, formation, useTactic, maxAge, realistic, interested, again]);

  const shownRole = advice?.roles.find((r) => r.key === role) ?? null;
  const shownJob = advice?.staff.find((s) => s.key === job) ?? null;

  return (
    <div className={active ? "workspace" : "workspace inactive"} aria-hidden={!active || undefined}>
      <section className="players advice">
        <div className="toolbar">
          <h2 className="view-title">{text.title}</h2>
          {humanClubs.length > 1 && (
            <label className="advice-option">
              {text.club}
              <select
                value={club ?? humanClubs[0]?.uid}
                onChange={(e) => {
                  setClub(Number(e.target.value));
                  setTeam(0);
                }}
              >
                {humanClubs.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {advice && advice.teams.length > 1 && (
            <label className="advice-option" title={text.teamTitle}>
              {text.team}
              <select value={team} onChange={(e) => setTeam(Number(e.target.value))}>
                {advice.teams.map((t) => (
                  <option key={t.index} value={t.index}>
                    {`${teamLabel({ index: t.index, kind: t.kind, ageLimit: t.ageLimit })} (${t.players})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="advice-option" title={text.maxAgeTitle}>
            {text.maxAge}
            <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
              {MAX_AGES.map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
            </select>
          </label>
          <label className="advice-option check" title={text.realisticTitle}>
            <input type="checkbox" checked={realistic} onChange={(e) => setRealistic(e.target.checked)} />
            {text.realistic}
          </label>
          <label className="advice-option check" title={text.interestedTitle}>
            <input type="checkbox" checked={interested} onChange={(e) => setInterested(e.target.checked)} />
            {text.interested}
          </label>
          <button type="button" onClick={() => setAgain((n) => n + 1)} disabled={busy}>
            {busy ? text.analysing : text.analyse}
          </button>
        </div>
        <p className="view-note">{text.intro}</p>
        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}

        {advice && (
          <>
            <Summary advice={advice} />
            <div className="profile-tabs advice-tabs" role="tablist">
              {(["squad", "eleven", "readiness", "staff"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="profile-tab"
                  aria-selected={id === section}
                  onClick={() => setSection(id)}
                >
                  {text.sections[id]}
                </button>
              ))}
            </div>
            <div className={busy ? "advice-body stale" : "advice-body"}>
              {section === "eleven" ? (
                <Eleven
                  advice={advice}
                  formation={formation}
                  onFormation={setFormation}
                  useTactic={useTactic}
                  onUseTactic={setUseTactic}
                  onOpen={setShownPlayer}
                />
              ) : section === "readiness" ? (
                <ReadinessList rows={advice.readiness} onOpen={setShownPlayer} />
              ) : section === "squad" ? (
                <>
                  <ul className="advice-list">
                    {advice.roles.map((r) => (
                      <NeedItem
                        key={r.key}
                        picked={r.key === role}
                        onPick={() => setRole(r.key)}
                        name={text.roles[r.key] ?? r.key}
                        sub={r.positions.map(positionLabel).join(" / ")}
                        need={r.need}
                        needTitle={text.needTitles[r.need]}
                        facts={[
                          <span key="cover" title={text.coverTitle}>
                            {text.cover(formatNumber(r.cover, { maximumFractionDigits: 1 }), r.wanted)}
                          </span>,
                          <span key="best">{r.bestAbility !== null ? text.best(r.bestAbility) : text.nobody}</span>,
                        ]}
                      />
                    ))}
                  </ul>
                  {shownRole && <RoleDetail role={shownRole} onOpen={setShownPlayer} />}
                </>
              ) : (
                <>
                  <ul className="advice-list">
                    {advice.staff.map((s) => (
                      <NeedItem
                        key={s.key}
                        picked={s.key === job}
                        onPick={() => setJob(s.key)}
                        name={text.staffRoles[s.key] ?? s.key}
                        sub={s.jobs.map(jobLabel).join(" / ")}
                        need={s.need}
                        needTitle={text.staffNeedTitles[s.need]}
                        facts={[
                          <span key="count">{text.cover(String(s.members.length), s.wanted)}</span>,
                          <span key="best">{s.bestScore !== null ? text.staffBest(score(s.bestScore)) : text.nobody}</span>,
                        ]}
                      />
                    ))}
                  </ul>
                  {shownJob && <JobDetail job={shownJob} onOpen={setShownStaff} />}
                </>
              )}
            </div>
          </>
        )}
      </section>
      {shownPlayer && <PlayerDialog player={shownPlayer} version={version} onClose={() => setShownPlayer(null)} />}
      {shownStaff && <StaffDialog member={shownStaff} version={version} onClose={() => setShownStaff(null)} />}
    </div>
  );
}

function Summary({ advice }: { advice: ClubAdvice }) {
  const { club, finances } = advice;
  return (
    <div className="advice-summary">
      <WithPicture picture={<ClubLogo uid={club.uid} name={club.name} size={PICTURE_SIZE.rowLogo} />}>
        <strong>{club.name}</strong>
      </WithPicture>
      <span>
        <small>
          {advice.team === 0
            ? text.summary.squad
            : teamLabel({
                index: advice.team,
                kind: advice.teams.find((t) => t.index === advice.team)?.kind,
                ageLimit: advice.teams.find((t) => t.index === advice.team)?.ageLimit,
              })}
        </small>{" "}
        {advice.squadSize}
      </span>
      {advice.averageAge !== null && (
        <span>
          <small>{text.summary.averageAge}</small>{" "}
          {formatNumber(advice.averageAge, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </span>
      )}
      <span title={text.summary.levelTitle}>
        <small>{text.summary.level}</small> <Ability value={advice.level} />
      </span>
      {finances && (
        <>
          <span>
            <small>{text.summary.transferBudget}</small> {formatMoney(finances.transferBudget)}
          </span>
          <span>
            <small>{text.summary.wageBudget}</small> {text.summary.perWeek(formatMoney(finances.wageBudget))}
          </span>
        </>
      )}
    </div>
  );
}

function NeedBadge({ need, title }: { need: Need; title: string }) {
  return (
    <span className={`need need-${need}`} title={title}>
      {text.needs[need]}
    </span>
  );
}

function NeedItem(props: {
  picked: boolean;
  onPick: () => void;
  name: string;
  sub: string;
  need: Need;
  needTitle: string;
  facts: ReactNode[];
}) {
  const { picked, onPick, name, sub, need, needTitle, facts } = props;
  return (
    <li>
      <button type="button" className={picked ? "advice-item picked" : "advice-item"} aria-pressed={picked} onClick={onPick}>
        <span className="advice-item-head">
          <span className="advice-item-name">{name}</span>
          <NeedBadge need={need} title={needTitle} />
        </span>
        <span className="advice-item-sub">{sub}</span>
        <span className="advice-item-facts">{facts}</span>
      </button>
    </li>
  );
}

function Tags({ tags }: { tags: AdviceTag[] }) {
  return (
    <span className="advice-tags">
      {tags.map((tag) => (
        <span key={tag} className={`tag advice-tag-${tag}`}>
          {text.tags[tag]}
        </span>
      ))}
    </span>
  );
}

function ClubCell({ uid, name }: { uid: number | null; name: string | null }) {
  return (
    <td className="col-club" title={name ?? undefined}>
      <WithPicture picture={<ClubLogo uid={uid} name={name} size={PICTURE_SIZE.rowLogo} />}>
        {name ?? <span className="muted">{profileText.freeAgent}</span>}
      </WithPicture>
    </td>
  );
}

function RoleDetail({ role, onOpen }: { role: RoleAdvice; onOpen: (player: PlayerSummary) => void }) {
  const c = text.columns;
  return (
    <div className="advice-detail">
      <h3>
        {text.roles[role.key] ?? role.key} <NeedBadge need={role.need} title={text.needTitles[role.need]} />
      </h3>

      <h4>{text.members}</h4>
      {role.members.length === 0 ? (
        <p className="muted">{text.noMembers}</p>
      ) : (
        <table className="grid advice-grid">
          <thead>
            <tr>
              <th>{c.name}</th>
              <th className="num">{c.age}</th>
              <th>{c.positions}</th>
              <th className="num" title={c.ratingTitle}>
                {c.rating}
              </th>
              <th className="num">{c.ca}</th>
              <th className="num">{c.pa}</th>
              <th>{c.contract}</th>
            </tr>
          </thead>
          <tbody>
            {role.members.map(({ player, rating, main }) => (
              <tr key={player.uid} tabIndex={0} onClick={() => onOpen(player)} onKeyDown={openOnKey(() => onOpen(player))}>
                <td className="col-name">
                  <div className="name">
                    {player.name}
                    {main && (
                      <span className="advice-main" title={text.mainPlace}>
                        {" ●"}
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{player.age ?? profileText.none}</td>
                <td className="col-positions">{player.positions.slice(0, 3).map(positionLabel).join(" ")}</td>
                <td className={`num value ${tierClass(rating)}`}>{rating}</td>
                <td className="num">
                  <Ability value={player.currentAbility} />
                </td>
                <td className="num">
                  <Ability value={player.potentialAbility} />
                </td>
                <td className="date">{formatDate(player.contractExpires) || profileText.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>{text.candidates}</h4>
      <p className="view-note">{text.candidatesNote(role.targetAbility)}</p>
      <CandidateTable title={text.local} candidates={role.candidates.filter((x) => x.domestic)} onOpen={onOpen} />
      <CandidateTable title={text.foreign} candidates={role.candidates.filter((x) => !x.domestic)} onOpen={onOpen} />
    </div>
  );
}

/** The suggested signings of one kind, local or foreign, under their heading. */
function CandidateTable({
  title,
  candidates,
  onOpen,
}: {
  title: string;
  candidates: Candidate[];
  onOpen: (player: PlayerSummary) => void;
}) {
  const c = text.columns;
  return (
    <>
      <h5 className="advice-group">
        {title} <span className="muted">({candidates.length})</span>
      </h5>
      {candidates.length === 0 ? (
        <p className="muted">{text.noCandidates}</p>
      ) : (
        <table className="grid advice-grid">
          <thead>
            <tr>
              <th>{c.name}</th>
              <th className="num">{c.age}</th>
              <th>{c.club}</th>
              <th className="num" title={c.ratingTitle}>
                {c.rating}
              </th>
              <th className="num">{c.ca}</th>
              <th className="num">{c.pa}</th>
              <th className="num" title={c.gainTitle}>
                {c.gain}
              </th>
              <th title={c.interestTitle}>{c.interest}</th>
              <th className="num">{c.price}</th>
              <th>{c.contract}</th>
              <th>{c.why}</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.player.uid} candidate={candidate} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CandidateRow({ candidate, onOpen }: { candidate: Candidate; onOpen: (player: PlayerSummary) => void }) {
  const { player, rating, gain, askingPrice, tags } = candidate;
  const open = () => onOpen(player);
  return (
    <tr tabIndex={0} onClick={open} onKeyDown={openOnKey(open)}>
      <td className="col-name" title={player.name}>
        <div className="name">{player.name}</div>
        <div className="sub">{player.positions.slice(0, 3).map(positionLabel).join(" ")}</div>
      </td>
      <td className="num">{player.age ?? profileText.none}</td>
      <ClubCell uid={player.clubUid} name={player.club} />
      <td className={`num value ${tierClass(rating)}`}>{rating}</td>
      <td className="num">
        <Ability value={player.currentAbility} />
      </td>
      <td className="num">
        <Ability value={player.potentialAbility} />
      </td>
      <td className={gain > 0 ? "num advice-gain up" : "num advice-gain"}>{gain > 0 ? `+${gain}` : gain}</td>
      <td>
        <InterestCell candidate={candidate} />
      </td>
      <td className="num">{askingPrice ? formatMoney(askingPrice) : profileText.none}</td>
      <td className="date">{formatDate(player.contractExpires) || profileText.none}</td>
      <td>
        <Tags tags={tags} />
      </td>
    </tr>
  );
}

/** How likely the player is to come, with what speaks for and against it in the hover text and in small print. */
function InterestCell({ candidate }: { candidate: Candidate }) {
  const { interest, pros, cons } = candidate;
  if (!interest) {
    return <span className="muted">{profileText.none}</span>;
  }
  const lines = [...pros.map((r) => `+ ${text.reasons[r]}`), ...cons.map((r) => `− ${text.reasons[r]}`)];
  return (
    <div className="advice-interest" title={lines.join("\n")}>
      <span className={`need interest-${interest}`}>{text.interestLevels[interest]}</span>
      <div className="advice-reasons">
        {pros.slice(0, 2).map((r) => (
          <span key={r} className="advice-reason pro">
            {text.reasons[r]}
          </span>
        ))}
        {cons.slice(0, 2).map((r) => (
          <span key={r} className="advice-reason con">
            {text.reasons[r]}
          </span>
        ))}
      </div>
    </div>
  );
}

function JobDetail({ job, onOpen }: { job: StaffAdvice; onOpen: (member: StaffSummary) => void }) {
  const c = text.columns;
  const labels = useMemo(
    () => job.attributes.map((key) => (STAFF_ATTRIBUTE_LABELS as Record<string, string>)[key] ?? key),
    [job.attributes],
  );
  const head = (withClub: boolean) => (
    <thead>
      <tr>
        <th>{c.name}</th>
        <th>{c.job}</th>
        {withClub && <th>{c.club}</th>}
        <th className="num">{c.age}</th>
        <th className="num" title={c.scoreTitle}>
          {c.score}
        </th>
        {labels.map((label) => (
          <th key={label} className="num advice-attr" title={label}>
            {label}
          </th>
        ))}
        {withClub && <th>{c.why}</th>}
      </tr>
    </thead>
  );
  const row = (pick: StaffPick, withClub: boolean) => {
    const open = () => onOpen(pick.member);
    return (
      <tr key={pick.member.uid} tabIndex={0} onClick={open} onKeyDown={openOnKey(open)}>
        <td className="col-name">
          <div className="name">{pick.member.name}</div>
        </td>
        <td>{jobLabel(pick.member.job)}</td>
        {withClub && <ClubCell uid={pick.member.clubUid} name={pick.member.club} />}
        <td className="num">{pick.member.age ?? profileText.none}</td>
        <td className={`num value ${tierClass(Math.round(pick.score / 10))}`}>{score(pick.score)}</td>
        {pick.values.map((value, i) => (
          <td key={job.attributes[i]} className={value > 0 ? `num value ${tierClass(value)}` : "num muted"}>
            {value > 0 ? value : profileText.none}
          </td>
        ))}
        {withClub && (
          <td>
            <Tags tags={pick.tags} />
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="advice-detail">
      <h3>
        {text.staffRoles[job.key] ?? job.key} <NeedBadge need={job.need} title={text.staffNeedTitles[job.need]} />
      </h3>

      <h4>{text.staffMembers}</h4>
      {job.members.length === 0 ? (
        <p className="muted">{text.noStaffMembers}</p>
      ) : (
        <table className="grid advice-grid">
          {head(false)}
          <tbody>{job.members.map((pick) => row(pick, false))}</tbody>
        </table>
      )}

      <h4>{text.staffCandidates}</h4>
      <p className="view-note">{text.staffCandidatesNote}</p>
      {job.candidates.length === 0 ? (
        <p className="muted">{text.noStaffCandidates}</p>
      ) : (
        <table className="grid advice-grid">
          {head(true)}
          <tbody>{job.candidates.map((pick) => row(pick, true))}</tbody>
        </table>
      )}
    </div>
  );
}

/** The line of the pitch a position is played in, from the attack down: where the suggested eleven draws it. */
function lineOf(position: string): number {
  if (position === "st") return 0;
  if (["aml", "amc", "amr"].includes(position)) return 1;
  if (["ml", "mc", "mr"].includes(position)) return 2;
  if (position === "dm") return 3;
  if (["wbl", "wbr"].includes(position)) return 3.5;
  if (["dl", "dc", "dr"].includes(position)) return 4;
  return 5;
}

/** Left to right within a line. */
function sideOf(position: string): number {
  if (["dl", "wbl", "ml", "aml"].includes(position)) return 0;
  if (["dr", "wbr", "mr", "amr"].includes(position)) return 2;
  return 1;
}

/**
 * The suggested eleven, laid out as on a pitch with the attack on top: for each place, who of the team is worth most
 * there, his rating in the position and his current ability. Only a suggestion: the game's team selection is not changed.
 */
function Eleven({
  advice,
  formation,
  onFormation,
  useTactic,
  onUseTactic,
  onOpen,
}: {
  advice: ClubAdvice;
  formation: string;
  onFormation: (formation: string) => void;
  useTactic: boolean;
  onUseTactic: (on: boolean) => void;
  onOpen: (player: PlayerSummary) => void;
}) {
  const picks = advice.eleven.map((pick, index) => ({ ...pick, index }));
  const lines = [...new Set(picks.map((pick) => lineOf(pick.position)))].sort((a, b) => a - b);
  const placed = picks.filter((pick) => pick.player !== null);
  const average = placed.length > 0 ? Math.round(placed.reduce((sum, p) => sum + p.player!.currentAbility, 0) / placed.length) : null;
  return (
    <div className="advice-eleven">
      <div className="advice-eleven-head">
        <label className="advice-option">
          {text.eleven.formation}
          <select value={formation} disabled={advice.ownTactic} onChange={(e) => onFormation(e.target.value)}>
            {FORMATIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="advice-option check" title={text.eleven.useTacticTitle}>
          <input type="checkbox" checked={useTactic} onChange={(e) => onUseTactic(e.target.checked)} />
          {text.eleven.useTactic}
        </label>
        {average !== null && <span className="muted">{text.eleven.average(average)}</span>}
      </div>
      {useTactic && (
        <p className={advice.ownTactic ? "view-note" : "view-note error"}>
          {advice.ownTactic ? text.eleven.ownTactic(advice.tacticStyle) : text.eleven.noTactic}
        </p>
      )}
      {advice.readiness.some((r) => r.injuries.length > 0 || r.bans.length > 0) && (
        <p className="view-note">
          {text.eleven.leftOut(
            advice.readiness
              .filter((r) => r.injuries.length > 0 || r.bans.length > 0)
              .map((r) => r.player.name)
              .join(", "),
          )}
        </p>
      )}
      <p className="view-note">{text.eleven.note}</p>
      <div className="eleven-pitch">
        {lines.map((line) => (
          <div key={line} className="eleven-line">
            {picks
              .filter((pick) => lineOf(pick.position) === line)
              .sort((a, b) => sideOf(a.position) - sideOf(b.position) || a.index - b.index)
              .map((pick) => {
                const player = pick.player;
                return player === null ? (
                  <div key={pick.index} className="eleven-card empty">
                    <span className="eleven-pos">{positionLabel(pick.position)}</span>
                    <span className="muted">{text.eleven.nobody}</span>
                  </div>
                ) : (
                  <button key={pick.index} type="button" className="eleven-card" onClick={() => onOpen(player)}>
                    <span className="eleven-pos">{positionLabel(pick.position)}</span>
                    <span className="eleven-name">{player.name}</span>
                    <span className="eleven-facts">
                      <span className={`value ${tierClass(pick.rating)}`} title={text.columns.ratingTitle}>
                        {pick.rating}
                      </span>
                      <Ability value={player.currentAbility} />
                      <span className="muted">{player.age ?? ""}</span>
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** What keeps a player from being fully ready, as short labelled chips: worst first. */
function readinessChips(row: Readiness): { label: string; tone: "bad" | "warn" }[] {
  const r = text.readiness;
  const chips: { label: string; tone: "bad" | "warn" }[] = [];
  for (const injury of row.injuries) {
    const back = injury.backSoonest ? formatDate(injury.backSoonest) : null;
    chips.push({ label: r.injured(injury.name ?? r.injury, back), tone: "bad" });
  }
  for (const ban of row.bans) {
    chips.push({ label: r.banned(ban.matches), tone: "bad" });
  }
  if (row.condition < 8500) chips.push({ label: r.tired(Math.round(row.condition / 100)), tone: "warn" });
  if (row.matchSharpness < 6000) chips.push({ label: r.unsharp(Math.round(row.matchSharpness / 100)), tone: "warn" });
  if (row.jadedness > 250) chips.push({ label: r.jaded, tone: "warn" });
  if (row.morale <= 8) chips.push({ label: r.lowMorale(row.morale), tone: "warn" });
  if (row.concerns > 0) chips.push({ label: r.concerns(row.concerns), tone: "warn" });
  else if (row.happiness !== null && row.happiness < 0) chips.push({ label: r.unhappy, tone: "warn" });
  return chips;
}

/** The players of the team who are not fully ready, the injured and banned first; a name opens the profile. */
function ReadinessList({ rows, onOpen }: { rows: Readiness[]; onOpen: (player: PlayerSummary) => void }) {
  const r = text.readiness;
  return (
    <div className="advice-readiness">
      <p className="view-note">{r.note}</p>
      {rows.length === 0 ? (
        <p className="muted">{r.allReady}</p>
      ) : (
        <table className="grid advice-grid">
          <thead>
            <tr>
              <th>{text.columns.name}</th>
              <th>{text.columns.positions}</th>
              <th className="num">{text.columns.ca}</th>
              <th>{r.why}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.player.uid}
                tabIndex={0}
                onClick={() => onOpen(row.player)}
                onKeyDown={openOnKey(() => onOpen(row.player))}
              >
                <td className="col-name">
                  <div className="name">{row.player.name}</div>
                </td>
                <td className="col-positions">{row.player.positions.slice(0, 3).map(positionLabel).join(" ")}</td>
                <td className="num">
                  <Ability value={row.player.currentAbility} />
                </td>
                <td>
                  <span className="readiness-chips">
                    {readinessChips(row).map((chip) => (
                      <span key={chip.label} className={`readiness-chip ${chip.tone}`}>
                        {chip.label}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

