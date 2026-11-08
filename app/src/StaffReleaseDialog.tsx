// Releasing a member of staff from his club: the button beside Transfer in the header of his profile, and the dialog
// it opens. As in the game, the club either terminates the contract, paying what is left of it, or ends it by mutual
// consent, for an amount the two agree on (none, if left empty). The dialog asks the game whether he can be released
// and what the payment does to the club's balance before it offers to; he then leaves the club's departments with no
// contract, and the club pays. Logged like any change: one undo from the Changes view brings him back and the money
// with him.

import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPounds, toShown } from "./currency";
import { planStaffRelease, releaseStaff } from "./editing";
import { currencySymbol, describeError, formatDate, formatMoney, formatNumber } from "./format";
import { staffReleaseText as text } from "./labels";
import { ClubLine } from "./MoveDialog";
import type { StaffEndingKind, StaffReleasePreview } from "./types";
import { useModal } from "./useModal";
import { EditorContext } from "./useProfileEditing";

/** The member of staff the dialog releases, and the club he is at. */
interface ReleasingStaff {
  uid: number;
  name: string;
  club: string;
  /** The club's UID, for its logo. */
  clubUid: number | null;
}

/** The most a payment can be, in pounds, as the game's money fields hold it; and as typed, in the chosen currency. */
const MAX_PAYMENT_SHOWN = toShown(2_000_000_000);

/** The Release button of a member of staff's profile, and the dialog it opens. The profile decides when it is there. */
export function StaffReleaseButton({ member }: { member: ReleasingStaff }) {
  const { onEdited } = useContext(EditorContext);
  const [opened, setOpened] = useState<ReleasingStaff | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Once the dialog is gone, focus goes back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && opened === null) {
      button.current?.focus();
    }
    wasOpen.current = opened !== null;
  }, [opened]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="release-toggle"
        aria-haspopup="dialog"
        title={text.buttonTitle}
        onClick={() => setOpened(member)}
      >
        {text.button}
      </button>
      {opened && <StaffReleaseDialog member={opened} onReleased={onEdited} onClose={() => setOpened(null)} />}
    </>
  );
}

/** What the game said to the plan, or why he cannot be released. */
type Planned = { preview: StaffReleasePreview } | { error: string };

/** The amount typed for a mutual termination, in the chosen currency: none while empty, else a whole amount or bad. */
function typedAmount(typed: string): number | null | "invalid" {
  if (typed.trim() === "") {
    return null;
  }
  const value = Number(typed);
  return Number.isInteger(value) && value >= 0 && value <= MAX_PAYMENT_SHOWN ? value : "invalid";
}

interface StaffReleaseDialogProps {
  member: ReleasingStaff;
  onReleased: () => void;
  onClose: () => void;
}

function StaffReleaseDialog({ member, onReleased, onClose }: StaffReleaseDialogProps) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const running = useRef(false);

  const [kind, setKind] = useState<StaffEndingKind>("terminate");
  const [typed, setTyped] = useState("");
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [replans, setReplans] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useModal(dialog, !releasing, onClose);

  useEffect(() => {
    alive.current = true;
    cancelButton.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  const shown = typedAmount(typed);
  // The pounds a mutual termination pays: none while nothing is typed.
  const mutualPounds = shown === "invalid" ? null : shown === null ? 0 : toPounds(shown);

  // The plan, asked when the dialog opens, when the terms change, and again after a failed release. An answer for an
  // older ask is dropped.
  useEffect(() => {
    if (kind === "mutual" && mutualPounds === null) {
      return;
    }
    let cancelled = false;
    setPlanned(null);
    planStaffRelease(member.uid, kind === "mutual" ? (mutualPounds ?? 0) : undefined).then(
      (preview) => !cancelled && setPlanned({ preview }),
      (e) => !cancelled && setPlanned({ error: describeError(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [member.uid, kind, mutualPounds, replans]);

  const preview = planned !== null && "preview" in planned ? planned.preview : null;
  const amountOk = kind === "terminate" || mutualPounds !== null;
  const canRelease = preview !== null && amountOk && !releasing;
  const paying = kind === "terminate" ? (preview?.severance.remaining ?? 0) : (mutualPounds ?? 0);

  const release = async () => {
    if (!canRelease || running.current) {
      return;
    }
    running.current = true;
    setReleasing(true);
    setFailure(null);
    try {
      await releaseStaff(member.uid, kind, kind === "mutual" ? (mutualPounds ?? 0) : undefined);
      onReleased();
      onClose();
    } catch (e) {
      if (alive.current) {
        setFailure(describeError(e));
        setReplans((count) => count + 1);
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setReleasing(false);
      }
    }
  };

  const plan: { tone: "pending" | "ok" | "refused"; message: string } = !amountOk
    ? { tone: "refused", message: text.badAmount }
    : planned === null
      ? { tone: "pending", message: text.checking }
      : "error" in planned
        ? { tone: "refused", message: planned.error }
        : { tone: "ok", message: text.ready(planned.preview.club.name) };

  const severance = preview?.severance;
  const balance = preview?.balance;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
        }
      }}
    >
      <div
        ref={dialog}
        className="modal move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        aria-describedby={id("member")}
        aria-busy={releasing || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={id("title")}>{text.title}</h2>
          <p id={id("member")} className="move-player">
            {member.name}
          </p>
        </header>

        <div className="modal-body">
          <section className="move-section" aria-labelledby={id("from")}>
            <h3 id={id("from")}>{text.from}</h3>
            <div className="move-club">
              <ClubLine uid={member.clubUid} name={member.club} />
            </div>
          </section>

          <section className="move-section" aria-labelledby={id("contract")}>
            <h3 id={id("contract")}>{text.contractHeading}</h3>
            <p className="move-note">
              {severance === undefined
                ? text.checking
                : severance.weeksLeft === 0
                  ? text.nothingLeft
                  : text.left(
                      formatMoney(severance.wage),
                      formatDate(severance.expires),
                      formatNumber(severance.weeksLeft),
                      formatMoney(severance.remaining),
                    )}
            </p>
          </section>

          <fieldset className="room-choices staff-ending" disabled={releasing}>
            <legend>{text.howHeading}</legend>
            <div className="room-choice">
              <input
                type="radio"
                id={id("terminate")}
                name={id("kind")}
                checked={kind === "terminate"}
                onChange={() => setKind("terminate")}
              />
              <label htmlFor={id("terminate")}>{text.terminate}</label>
              <span className="room-outcome">{text.terminateOutcome}</span>
            </div>
            <div className="room-choice">
              <input
                type="radio"
                id={id("mutual")}
                name={id("kind")}
                checked={kind === "mutual"}
                onChange={() => setKind("mutual")}
              />
              <label htmlFor={id("mutual")}>{text.mutual}</label>
              <span className="room-outcome">{text.mutualOutcome}</span>
            </div>
            {kind === "mutual" && (
              <div className="move-term staff-payout">
                <label htmlFor={id("amount")}>{text.amount}</label>
                <span className="move-money">
                  <span className="move-unit" aria-hidden="true">
                    {currencySymbol}
                  </span>
                  <input
                    id={id("amount")}
                    className={shown === "invalid" ? "move-input invalid" : "move-input"}
                    type="number"
                    min={0}
                    max={MAX_PAYMENT_SHOWN}
                    step={1}
                    placeholder="0"
                    value={typed}
                    readOnly={releasing}
                    aria-invalid={shown === "invalid" || undefined}
                    aria-describedby={id("amount-note")}
                    onChange={(e) => setTyped(e.currentTarget.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </span>
                <p id={id("amount-note")} className="move-note">
                  {text.amountHint}
                </p>
              </div>
            )}
          </fieldset>

          <p className={`move-plan ${plan.tone}`} role="status">
            {plan.message}
            {preview !== null && amountOk && (
              <>
                <br />
                {balance
                  ? text.pays(
                      preview.club.name,
                      formatMoney(paying),
                      formatMoney(balance.before),
                      formatMoney(balance.after),
                    )
                  : text.noFinances(preview.club.name)}
              </>
            )}
          </p>

          <section className="move-section" aria-labelledby={id("does")}>
            <h3 id={id("does")}>{text.doesHeading}</h3>
            <ul className="move-facts">
              {text.does.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>

        {failure !== null && (
          <div className="banner move-error" role="alert">
            {failure}
          </div>
        )}

        <footer className="modal-foot">
          <span className="move-foot-note">{text.hint}</span>
          <button type="button" className="primary" disabled={!canRelease} onClick={() => void release()}>
            {releasing ? text.releasing : kind === "terminate" ? text.terminate : text.mutual}
          </button>
          <button ref={cancelButton} type="button" disabled={releasing} onClick={onClose}>
            {text.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
