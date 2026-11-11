// The quick search above the player list's filters: a sentence such as "striker lokal u23 pa 140+ nilai < 5B" becomes
// the filters, which then show in the filter bar as if they had been set there. What was understood, and what was not,
// is said under it.

import { useEffect, useState } from "react";
import { call } from "./api";
import { formatAmount } from "./format";
import { playerListText } from "./labels";
import type { PlayerFilterFields } from "./PlayerFilters";
import { parseQuickSearch, type QuickResult } from "./quickSearchParse";

const text = playerListText.filters.quick;

export function QuickSearch({ version, onApply }: { version: number; onApply: (fields: PlayerFilterFields) => void }) {
  const [sentence, setSentence] = useState("");
  const [result, setResult] = useState<QuickResult | null>(null);
  // The managed club's country, for "lokal" and "asing"; read again with the game data.
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call<string | null>("human_club_nation").then(
      (nation) => !cancelled && setHome(nation),
      () => !cancelled && setHome(null),
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  const apply = () => {
    if (sentence.trim() === "") {
      return;
    }
    const read = parseQuickSearch(sentence, home, (shown) => formatAmount(shown));
    setResult(read);
    if (read.understood.length > 0) {
      onApply(read.fields);
    }
  };

  return (
    <div className="quick-search">
      <form
        className="quick-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          type="text"
          aria-label={text.label}
          placeholder={text.placeholder}
          spellCheck={false}
          value={sentence}
          onChange={(e) => setSentence(e.currentTarget.value)}
        />
        <button type="submit" disabled={sentence.trim() === ""}>
          {text.apply}
        </button>
      </form>
      {result && (
        <p className="quick-search-result" role="status">
          {result.understood.length === 0 ? (
            <span className="error">{text.nothing}</span>
          ) : (
            <>
              <span className="muted">{text.understood}</span>{" "}
              {result.understood.map((part) => (
                <span key={part} className="quick-chip">
                  {part}
                </span>
              ))}
            </>
          )}
          {result.unknown.length > 0 && (
            <span className="muted"> {text.unknown(result.unknown.join(" "))}</span>
          )}
        </p>
      )}
    </div>
  );
}
