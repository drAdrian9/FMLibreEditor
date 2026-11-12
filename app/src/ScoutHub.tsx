// The Scouting tab with this fork's Advisor in it: a switch on top between the Advisor (the whole squad at a glance:
// weak places for any team, local and foreign signings, staff, the best eleven and who is not ready) and upstream's
// Scouting (signings for one position and its roles, squad depth, players to let go). A place of the Advisor opens
// the Scouting for it, its position picked.

import { useState } from "react";
import { AdviceView } from "./AdviceView";
import { adviceText, scoutingText } from "./labels";
import { ScoutingBrowser } from "./ScoutingBrowser";

type Mode = "advice" | "scout";

export function ScoutHub({ version, active }: { version: number; active: boolean }) {
  const [mode, setMode] = useState<Mode>("advice");
  // The position the Advisor asked the Scouting for, with a count that tells one ask from the next.
  const [focus, setFocus] = useState<{ position: string; nonce: number } | null>(null);

  const className = ["workspace", "scout-hub", !active && "inactive"].filter(Boolean).join(" ");
  return (
    <div className={className} aria-hidden={!active || undefined}>
      <div className="profile-tabs hub-switch" role="tablist">
        {(["advice", "scout"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="profile-tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
          >
            {id === "advice" ? adviceText.nav : scoutingText.nav}
          </button>
        ))}
      </div>
      <div className="views hub-views">
        <AdviceView
          version={version}
          active={active && mode === "advice"}
          onScout={(position) => {
            setFocus((old) => ({ position, nonce: (old?.nonce ?? 0) + 1 }));
            setMode("scout");
          }}
        />
        <ScoutingBrowser version={version} active={active && mode === "scout"} focus={focus} />
      </div>
    </div>
  );
}
