import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditableValue } from "./EditControls";
import { freezeMoney, frozenClubs } from "./editing";
import { converts, inCurrency } from "./currency";
import { describeError, formatMoney, formatNumber } from "./format";
import {
  CLUB_FACILITY_LABELS,
  clubProfileText,
  profileText,
  SUPPORTER_MIX_LABELS,
  SUPPORTER_TRAIT_LABELS,
  type SupporterMixKey,
} from "./labels";
import { ClubLogo, PICTURE_SIZE } from "./Picture";
import {
  Fact,
  ProfileFrame,
  RatingGroup,
  RatingList,
  ReputationMeter,
  useProfileDetails,
  type PanelIds,
  type RatingRow,
} from "./ProfileParts";
import { ClubStaffTab } from "./ClubStaffTab";
import { SquadTab } from "./SquadTab";
import type { ClubDetails, ClubSummary, Finances, Stadium } from "./types";
import { EditorContext, useProfileEditing } from "./useProfileEditing";

const text = clubProfileText;

/** The tabs of the profile: what the club has, and its squad. */
export type ClubTab = "overview" | "squad" | "staff";

const TABS: readonly ClubTab[] = ["overview", "squad", "staff"];

/** The tab saved before the language was switched; the overview when there is none. */
export const readTab = (value: unknown): ClubTab =>
  value === "squad" || value === "staff" ? value : "overview";

interface ClubProfileProps {
  /** The row that was picked; its fields fill the header while the full profile loads. */
  club: ClubSummary;
  /** Changes when the game data is read again, so the profile is too. */
  version: number;
  /** The open tab. The list keeps it, so that the next club picked opens on it too. */
  tab: ClubTab;
  onTab: (tab: ClubTab) => void;
  onClose: () => void;
}

/** The profile of one club. Mount it with `key={uid}` so a new club starts at the top. */
export function ClubProfile({ club, version, tab, onTab, onClose }: ClubProfileProps) {
  const loaded = useProfileDetails<ClubDetails>("club_details", club.uid, version);
  const editing = useProfileEditing("club", club.uid);
  const base = useId();
  const details = loaded?.details;
  const info: ClubSummary = details ?? club;
  const vitals = [info.founded !== null && text.founded(info.founded), `${profileText.uid} ${info.uid}`];

  // The club is edited on the Overview, which has its inputs: editing starts there, and the Squad tab is not offered
  // until it is done.
  const locked = editing.stage !== "view";
  useEffect(() => {
    if (locked) {
      onTab("overview");
    }
  }, [locked, onTab]);
  const shown = locked ? "overview" : tab;
  const panel: PanelIds = { id: `${base}-panel`, labelledBy: `${base}-${shown}` };

  return (
    <ProfileFrame
      picture={<ClubLogo uid={info.uid} name={info.name} size={PICTURE_SIZE.clubLogo} />}
      name={info.name}
      fullName={info.shortName}
      badge={info.women ? <span className="tag women">{text.womensClub}</span> : undefined}
      vitals={vitals}
      side={
        // Laid out like the abilities of a person: a label and a bar with the number on it. While the club is
        // edited the number is an input, where it is shown.
        <div className="profile-abilities">
          <abbr title={text.reputationTitle}>{text.reputationShort}</abbr>
          <EditableValue field="reputation">
            <ReputationMeter value={info.reputation} />
          </EditableValue>
        </div>
      }
      tabs={details && <ClubTabs tab={shown} base={base} locked={locked} onSelect={onTab} />}
      wide={details !== undefined && shown !== "overview"}
      loaded={loaded}
      onClose={onClose}
      editing={editing}
    >
      {details &&
        (shown === "squad" ? (
          <SquadTab clubUid={club.uid} version={version} panel={panel} />
        ) : shown === "staff" ? (
          <ClubStaffTab clubUid={club.uid} version={version} panel={panel} />
        ) : (
          <ClubBody details={details} panel={panel} />
        ))}
    </ProfileFrame>
  );
}

interface ClubTabsProps {
  tab: ClubTab;
  /** The start of the ids of the tabs, which the panel they open names itself by (see `PanelIds`). */
  base: string;
  /** Whether the club is being edited. */
  locked: boolean;
  onSelect: (tab: ClubTab) => void;
}

/** The tabs under the header. The arrow keys move between them, as in any tab list. */
function ClubTabs({ tab, base, locked, onSelect }: ClubTabsProps) {
  const buttons = useRef<Partial<Record<ClubTab, HTMLButtonElement | null>>>({});
  // The Squad tab is out of reach while the club is edited.
  const offered = TABS.filter((id) => !(locked && id !== "overview"));

  const keyDown = (event: KeyboardEvent) => {
    const at = offered.indexOf(tab);
    const target =
      event.key === "ArrowRight"
        ? offered[(at + 1) % offered.length]
        : event.key === "ArrowLeft"
          ? offered[(at - 1 + offered.length) % offered.length]
          : event.key === "Home"
            ? offered[0]
            : event.key === "End"
              ? offered[offered.length - 1]
              : undefined;
    if (target !== undefined) {
      event.preventDefault();
      onSelect(target);
      buttons.current[target]?.focus();
    }
  };

  return (
    <div className="profile-tabs" role="tablist" aria-label={text.tabsLabel} onKeyDown={keyDown}>
      {TABS.map((id) => {
        const unavailable = locked && id !== "overview";
        return (
          <button
            key={id}
            ref={(button) => {
              buttons.current[id] = button;
            }}
            type="button"
            role="tab"
            id={`${base}-${id}`}
            className="profile-tab"
            aria-selected={id === tab}
            aria-controls={`${base}-panel`}
            // Only the tab that is open is a Tab stop; the arrow keys reach the other.
            tabIndex={id === tab ? 0 : -1}
            disabled={unavailable}
            title={unavailable ? text.squadLocked : undefined}
            onClick={() => onSelect(id)}
          >
            {text.tabs[id]}
          </button>
        );
      })}
    </div>
  );
}

/** Two columns: what the club has on the left, the people around it on the right. */
function ClubBody({ details, panel }: { details: ClubDetails; panel: PanelIds }) {
  return (
    <div className="profile-split" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
      <div className="profile-stack">
        <Facilities facilities={details.facilities} />
        <FinancesGroup club={details.uid} finances={details.finances} />
        <StadiumGroup stadium={details.stadium} />
      </div>
      <div className="profile-stack">
        <Supporters traits={details.supporterTraits} mix={details.supporterMix} />
        <ClubInfo details={details} />
      </div>
    </div>
  );
}

/** The keys of `labels` that `values` has, in the order of `labels`. */
function knownKeys<K extends string>(labels: Record<K, string>, values: Record<string, number>): K[] {
  return (Object.keys(labels) as K[]).filter((key) => values[key] !== undefined);
}

/**
 * Rating rows for the keys of `labels` that `values` has; a rating the game does not give is left out. The rows of
 * values the editor can change have `fieldGroup` (e.g. "facilities"): their field is `fieldGroup.key`.
 */
function ratingRows(
  labels: Record<string, string>,
  values: Record<string, number>,
  fieldGroup?: string,
): RatingRow[] {
  return knownKeys(labels, values).map((key) => ({
    key,
    field: fieldGroup === undefined ? undefined : `${fieldGroup}.${key}`,
    label: labels[key],
    value: values[key],
  }));
}

/** The club's facilities as ratings; inputs while the club is edited. */
function Facilities({ facilities }: { facilities: Record<string, number> }) {
  const rows = ratingRows(CLUB_FACILITY_LABELS, facilities, "facilities");
  return rows.length > 0 ? <RatingGroup title={text.facilities} rows={rows} /> : null;
}

function Supporters({ traits, mix }: { traits: Record<string, number>; mix: Record<string, number> }) {
  const traitRows = ratingRows(SUPPORTER_TRAIT_LABELS, traits);
  const segments = mixSegments(mix);
  if (traitRows.length === 0 && segments.length === 0) {
    return null;
  }
  return (
    <section className="profile-group">
      <h3>{text.supporters}</h3>
      {traitRows.length > 0 && <RatingList rows={traitRows} />}
      {segments.length > 0 && <SupporterMix segments={segments} />}
    </section>
  );
}

interface MixSegment {
  key: SupporterMixKey;
  label: string;
  /** Percent of the supporters. */
  value: number;
}

/** The kinds of supporters the game gives, in the order of the bar; nothing when it gives none. */
function mixSegments(mix: Record<string, number>): MixSegment[] {
  const segments = knownKeys(SUPPORTER_MIX_LABELS, mix).map((key) => ({
    key,
    label: SUPPORTER_MIX_LABELS[key],
    value: mix[key],
  }));
  // A mix of zeroes tells no more than none at all.
  return segments.some((segment) => segment.value > 0) ? segments : [];
}

/**
 * The supporter mix as one stacked bar, split by percent, with a legend that has every share as
 * text. Each kind keeps its colour (see `.mix-*` in App.css), whatever the others are.
 */
function SupporterMix({ segments }: { segments: MixSegment[] }) {
  return (
    <div className="mix">
      <h4>{text.supporterMix}</h4>
      {/* The legend has every share as text, so the bar is only for the eye. */}
      <div className="mix-bar" aria-hidden="true">
        {segments
          .filter((segment) => segment.value > 0)
          .map(({ key, label, value }) => (
            <span
              key={key}
              className={`mix-${key}`}
              style={{ flexGrow: value }}
              title={text.mixTooltip(label, text.percent(value))}
            />
          ))}
      </div>
      <ul className="legend mix-legend">
        {segments.map(({ key, label, value }) => (
          <li key={key} className={`mix-${key}`}>
            <span className="swatch" />
            {label}
            <span className="range">{text.percent(value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The club's money; the four amounts the editor can change are inputs while the club is edited, and the money can be
 * frozen.
 */
function FinancesGroup({ club, finances }: { club: number; finances: Finances | null }) {
  return (
    <section className="profile-group">
      <h3>{text.finances}</h3>
      {finances ? (
        <>
          <dl className="stats">
            <Fact label={text.balance}>
              <EditableValue field="finance.balance">
                <span className={finances.balance < 0 ? "negative" : undefined}>{formatMoney(finances.balance)}</span>
              </EditableValue>
            </Fact>
            <Fact label={text.transferBudget}>
              <EditableValue field="finance.transfer_budget">
                {/* FM stores -1 when the board has not set a transfer budget. */}
                {finances.transferBudget < 0 ? profileText.notSet : formatMoney(finances.transferBudget)}
              </EditableValue>
            </Fact>
            <Fact label={perWeek(text.wageBudget)}>
              <EditableValue field="finance.wage_budget">{formatMoney(finances.wageBudget)}</EditableValue>
            </Fact>
            <Fact label={perWeek(text.totalWageBudget)}>
              <EditableValue field="finance.total_wage_budget">{formatMoney(finances.totalWageBudget)}</EditableValue>
            </Fact>
            <Fact label={text.ticketPrice}>{formatTicketPrice(finances.ticketPrice)}</Fact>
          </dl>
          <FreezeMoney club={club} />
          <p className="note">{profileText.wageNote(converts)}</p>
        </>
      ) : (
        <p className="note">{text.noFinances}</p>
      )}
    </section>
  );
}

/** The stadium the senior team plays at: its name, and its capacities, inputs while the club is edited. */
function StadiumGroup({ stadium }: { stadium: Stadium | null }) {
  return (
    <section className="profile-group">
      <h3>{stadium?.name ? `${text.stadium} · ${stadium.name}` : text.stadium}</h3>
      {stadium ? (
        <dl className="stats">
          <Fact label={text.capacity}>
            <EditableValue field="stadium.capacity">{formatNumber(stadium.capacity)}</EditableValue>
          </Fact>
          <Fact label={text.seating}>
            <EditableValue field="stadium.seating">{formatNumber(stadium.seating)}</EditableValue>
          </Fact>
          <Fact label={text.used} title={text.usedTitle}>
            <EditableValue field="stadium.used">{stadium.used === 0 ? text.usedAll : formatNumber(stadium.used)}</EditableValue>
          </Fact>
          <Fact label={text.expansion}>
            <EditableValue field="stadium.expansion">{formatNumber(stadium.expansion)}</EditableValue>
          </Fact>
        </dl>
      ) : (
        <p className="note">{text.noStadium}</p>
      )}
    </section>
  );
}

/**
 * Freezing the club's money: while the app is open and connected, its balance does not go down. Offered while the game
 * can be written to; once frozen, a note says what it does.
 */
function FreezeMoney({ club }: { club: number }) {
  const { editable } = useContext(EditorContext);
  // Whether the club's money is frozen; null until the app has said.
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    frozenClubs()
      .then((clubs) => alive && setFrozen(clubs.includes(club)))
      .catch(() => alive && setFrozen(false));
    return () => {
      alive = false;
    };
  }, [club]);

  if (!editable || frozen === null) {
    return null;
  }
  const toggle = async (on: boolean) => {
    setError(null);
    try {
      setFrozen((await freezeMoney(club, on)).includes(club));
    } catch (e) {
      setError(describeError(e));
    }
  };
  return (
    <>
      <label className="freeze-toggle" title={text.freezeNote}>
        <input type="checkbox" checked={frozen} onChange={(e) => void toggle(e.currentTarget.checked)} />
        <span>{text.freeze}</span>
      </label>
      {frozen && <p className="note">{text.freezeNote}</p>}
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The label of an amount per week: the name, with "per week" in small print under it. */
function perWeek(label: string): ReactNode {
  return (
    <>
      {label}
      <span className="unit">{text.perWeek}</span>
    </>
  );
}

/** A ticket price: a whole amount as it is, anything else with two decimals ("£41.80"). */
function formatTicketPrice(price: number): string {
  return Number.isInteger(inCurrency(price))
    ? formatMoney(price)
    : formatMoney(price, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ClubInfo({ details }: { details: ClubDetails }) {
  const count = (value: number | null) => (value === null ? profileText.none : formatNumber(value));
  return (
    <section className="profile-group">
      <h3>{text.info}</h3>
      <dl className="stats">
        <Fact label={text.seasonTickets}>{count(details.seasonTickets)}</Fact>
        <Fact label={text.socialMedia}>{count(details.socialMedia)}</Fact>
      </dl>
    </section>
  );
}
