// The Staff tab of a club's profile: everyone whose contract is with the club, by department, best current ability
// first. A name opens the member of staff's profile over the tab, from where he can be moved, given another job or
// released; the tab reads the staff again after a change.

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Ability } from "./Ability";
import { call } from "./api";
import { describeError, formatDate } from "./format";
import { clubProfileText, jobLabel, profileText } from "./labels";
import { NationFlag, WithPicture } from "./Picture";
import type { PanelIds } from "./ProfileParts";
import { HumanBadge, StaffDialog } from "./StaffProfile";
import type { StaffSummary } from "./types";

const text = clubProfileText.staff;

/** The departments the tab groups the staff by, in its order. */
type Group = "management" | "coaching" | "medical" | "scouting" | "other";
const GROUPS: readonly Group[] = ["management", "coaching", "medical", "scouting", "other"];

/** The department of a job code, its player-coach variant (code + 1) as the job. */
function groupOf(job: number | null): Group {
  if (job === null) {
    return "other";
  }
  const code = job > 1 && job % 2 === 1 ? job - 1 : job;
  if ([4, 6, 16, 70, 88].includes(code)) return "management";
  if ([2, 20, 22, 26, 34, 60, 64].includes(code)) return "coaching";
  if ([12, 40, 48, 50].includes(code)) return "medical";
  if ([14, 44, 58].includes(code)) return "scouting";
  return "other";
}

const openOnKey = (open: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
};

export function ClubStaffTab({ clubUid, version, panel }: { clubUid: number; version: number; panel: PanelIds }) {
  const [members, setMembers] = useState<StaffSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<StaffSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    call<StaffSummary[]>("club_staff", { club: clubUid }).then(
      (rows) => !cancelled && setMembers(rows),
      (e) => !cancelled && setError(describeError(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [clubUid, version]);

  const grouped = useMemo(() => {
    const by = new Map<Group, StaffSummary[]>();
    for (const member of members ?? []) {
      const group = groupOf(member.job);
      by.set(group, [...(by.get(group) ?? []), member]);
    }
    return GROUPS.filter((group) => by.has(group)).map((group) => ({ group, rows: by.get(group)! }));
  }, [members]);

  return (
    <div className="club-staff" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
      {error !== null ? (
        <div className="banner">{error}</div>
      ) : members === null ? (
        <p className="muted">{text.loading}</p>
      ) : members.length === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <>
          <p className="view-note">{text.count(members.length)}</p>
          {grouped.map(({ group, rows }) => (
            <section key={group} className="club-staff-group">
              <h3>
                {text.groups[group]} <span className="muted">({rows.length})</span>
              </h3>
              <table className="grid advice-grid">
                <thead>
                  <tr>
                    <th>{text.columns.name}</th>
                    <th>{text.columns.job}</th>
                    <th className="num">{text.columns.age}</th>
                    <th>{text.columns.nation}</th>
                    <th className="num">{text.columns.ca}</th>
                    <th className="num">{text.columns.pa}</th>
                    <th>{text.columns.contractEnds}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => {
                    const open = () => setShown(member);
                    return (
                      <tr key={member.uid} tabIndex={0} onClick={open} onKeyDown={openOnKey(open)}>
                        <td className="col-name">
                          <div className="name">
                            {member.name}
                            {member.isHuman && <HumanBadge />}
                          </div>
                        </td>
                        <td>{jobLabel(member.job)}</td>
                        <td className="num">{member.age ?? profileText.none}</td>
                        <td>
                          <WithPicture picture={<NationFlag uid={member.nationUid} />}>
                            {member.nation ?? profileText.none}
                          </WithPicture>
                        </td>
                        <td className="num">
                          <Ability value={member.currentAbility} />
                        </td>
                        <td className="num">
                          <Ability value={member.potentialAbility} />
                        </td>
                        <td className="date">{formatDate(member.contractExpires ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
      {shown && <StaffDialog member={shown} version={version} onClose={() => setShown(null)} />}
    </div>
  );
}
