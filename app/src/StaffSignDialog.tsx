// Signing a member of staff without a club: the button in the header of his profile, and the dialog it opens. The
// editor allocates nothing in the game, so he cannot get a contract of his own: he takes over the contract of a member
// of staff of your club whom you pick (its job, wage and end date, signed from today) and that one's place in the
// club's departments, and the one he replaces is left without a club. Logged like any change: one undo puts both back.

import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { call } from "./api";
import { staffJobs } from "./editing";
import { describeError, formatDate } from "./format";
import { jobLabel, staffSignText as text } from "./labels";
import type { LoggedChange, StaffSummary } from "./types";
import { useModal } from "./useModal";
import { EditorContext } from "./useProfileEditing";

interface SigningStaff {
  uid: number;
  name: string;
}

export function StaffSignButton({ member }: { member: SigningStaff }) {
  const { onEdited } = useContext(EditorContext);
  const [opened, setOpened] = useState<SigningStaff | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

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
        className="move-toggle"
        aria-haspopup="dialog"
        title={text.buttonTitle}
        onClick={() => setOpened(member)}
      >
        {text.button}
      </button>
      {opened && <StaffSignDialog member={opened} onSigned={onEdited} onClose={() => setOpened(null)} />}
    </>
  );
}

type Planned = { club: string } | { error: string };

function StaffSignDialog({
  member,
  onSigned,
  onClose,
}: {
  member: SigningStaff;
  onSigned: () => void;
  onClose: () => void;
}) {
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const running = useRef(false);

  const [clubs, setClubs] = useState<number[] | null>(null);
  const [club, setClub] = useState<number | null>(null);
  const [staff, setStaff] = useState<StaffSummary[] | null>(null);
  const [jobs, setJobs] = useState<number[]>([]);
  const [replaced, setReplaced] = useState<number | null>(null);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [replans, setReplans] = useState(0);
  const [signing, setSigning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useModal(dialog, !signing, onClose);

  useEffect(() => {
    alive.current = true;
    cancelButton.current?.focus();
    call<number[]>("human_clubs").then(
      (found) => {
        if (alive.current) {
          setClubs(found);
          setClub(found[0] ?? null);
        }
      },
      (e) => alive.current && setFailure(describeError(e)),
    );
    staffJobs().then((codes) => alive.current && setJobs(codes));
    return () => {
      alive.current = false;
    };
  }, []);

  // The club's staff whose contract can change hands: those in the jobs the editor gives and takes away.
  useEffect(() => {
    if (club === null) {
      return;
    }
    let cancelled = false;
    setStaff(null);
    setReplaced(null);
    call<StaffSummary[]>("club_staff", { club }).then(
      (rows) => !cancelled && setStaff(rows),
      (e) => !cancelled && setFailure(describeError(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [club]);

  const choices = useMemo(
    () =>
      (staff ?? [])
        .filter((s) => !s.isHuman && s.job !== null && jobs.includes(s.job))
        .sort((a, b) => jobLabel(a.job).localeCompare(jobLabel(b.job)) || a.currentAbility - b.currentAbility),
    [staff, jobs],
  );
  const picked = choices.find((s) => s.uid === replaced) ?? null;

  useEffect(() => {
    if (replaced === null) {
      setPlanned(null);
      return;
    }
    let cancelled = false;
    setPlanned(null);
    call<{ uid: number; name: string }>("plan_staff_sign", { uid: member.uid, replaced }).then(
      (found) => !cancelled && setPlanned({ club: found.name }),
      (e) => !cancelled && setPlanned({ error: describeError(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [member.uid, replaced, replans]);

  const canSign = planned !== null && "club" in planned && replaced !== null && !signing;

  const sign = async () => {
    if (!canSign || running.current) {
      return;
    }
    running.current = true;
    setSigning(true);
    setFailure(null);
    try {
      await call<LoggedChange>("sign_staff", { uid: member.uid, replaced });
      onSigned();
      onClose();
    } catch (e) {
      if (alive.current) {
        setFailure(describeError(e));
        setReplans((count) => count + 1);
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setSigning(false);
      }
    }
  };

  const plan: { tone: "pending" | "ok" | "refused"; message: string } =
    replaced === null
      ? { tone: "pending", message: text.pick }
      : planned === null
        ? { tone: "pending", message: text.checking }
        : "error" in planned
          ? { tone: "refused", message: planned.error }
          : {
              tone: "ok",
              message: text.ready(
                planned.club,
                picked?.name ?? "",
                jobLabel(picked?.job ?? null),
                formatDate(picked?.contractExpires ?? null),
              ),
            };

  const clubName = (uid: number) => staff?.find((s) => s.clubUid === uid)?.club ?? String(uid);

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
        aria-busy={signing || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={id("title")}>{text.title}</h2>
          <p id={id("member")} className="move-player">
            {member.name}
          </p>
        </header>

        <div className="modal-body">
          {clubs !== null && clubs.length > 1 && (
            <section className="move-section">
              <h3>
                <label htmlFor={id("club")}>{text.club}</label>
              </h3>
              <select
                id={id("club")}
                className="move-input room-select"
                value={club ?? ""}
                disabled={signing}
                onChange={(e) => setClub(Number(e.currentTarget.value))}
              >
                {clubs.map((uid) => (
                  <option key={uid} value={uid}>
                    {uid === club ? clubName(uid) : uid}
                  </option>
                ))}
              </select>
            </section>
          )}

          {clubs !== null && clubs.length === 0 && <p className="move-plan refused">{text.noClub}</p>}

          <section className="move-section">
            <h3>
              <label htmlFor={id("replaced")}>{text.replaces}</label>
            </h3>
            <select
              id={id("replaced")}
              className="move-input room-select"
              value={replaced ?? ""}
              disabled={signing || staff === null}
              onChange={(e) => setReplaced(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
            >
              <option value="">{staff === null ? text.loading : text.choose}</option>
              {choices.map((s) => (
                <option key={s.uid} value={s.uid}>
                  {`${jobLabel(s.job)}: ${s.name} (CA ${s.currentAbility}, ${formatDate(s.contractExpires ?? null)})`}
                </option>
              ))}
            </select>
            <p className="move-note">{text.replacesHint}</p>
          </section>

          <p className={`move-plan ${plan.tone}`} role="status">
            {plan.message}
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
          <button type="button" className="primary" disabled={!canSign} onClick={() => void sign()}>
            {signing ? text.signing : text.sign}
          </button>
          <button ref={cancelButton} type="button" disabled={signing} onClick={onClose}>
            {text.cancel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
