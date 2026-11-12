// The presets of the mass-edit dialog: what its rows held, saved under a name for each kind of list (players, staff,
// clubs), to fill the rows again with one pick ("Refresh U21", "Fit before a derby"). Kept in `localStorage`, which can
// be unavailable or hold anything: every access is guarded and every entry checked, and what is wrong is left out.

import { useState } from "react";
import { massEditText } from "./labels";
import type { OperationDraft } from "./massDraft";
import type { Entity } from "./types";

const text = massEditText.presets;

/** The most presets a kind of list keeps, and the longest name one has. */
const MAX_PRESETS = 30;
const MAX_NAME = 50;

/** A row as a preset keeps it: the field, what is done to it and the value as typed. */
type PresetRow = Pick<OperationDraft, "field" | "kind" | "text">;

interface Preset {
  name: string;
  rows: PresetRow[];
}

const storageKey = (entity: Entity) => `fmlibre.massPresets.${entity}`;

const KINDS = new Set(["set", "add", "scale"]);

function readPresets(entity: Entity): Preset[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(entity)) ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry): Preset[] => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const { name, rows } = entry as { name?: unknown; rows?: unknown };
      if (typeof name !== "string" || !Array.isArray(rows)) {
        return [];
      }
      const kept = rows.flatMap((row): PresetRow[] => {
        const { field, kind, text: typed } = (row ?? {}) as Record<string, unknown>;
        return typeof field === "string" && typeof kind === "string" && KINDS.has(kind) && typeof typed === "string"
          ? [{ field, kind: kind as PresetRow["kind"], text: typed }]
          : [];
      });
      return kept.length > 0 ? [{ name: name.slice(0, MAX_NAME), rows: kept }] : [];
    });
  } catch {
    return [];
  }
}

function writePresets(entity: Entity, presets: Preset[]): boolean {
  try {
    localStorage.setItem(storageKey(entity), JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

interface MassPresetsProps {
  entity: Entity;
  /** The rows as they are now: what Save keeps. */
  rows: OperationDraft[];
  /** Whether the dialog takes changes now (not while it works, nor once applied). */
  disabled: boolean;
  /** Fills the rows with a preset's. */
  onLoad: (rows: PresetRow[]) => void;
}

/** A line above the rows: the saved presets to pick from, Delete for the one picked, and Save with a name. */
export function MassPresets({ entity, rows, disabled, onLoad }: MassPresetsProps) {
  const [presets, setPresets] = useState<Preset[]>(() => readPresets(entity));
  const [picked, setPicked] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const store = (next: Preset[]) => {
    if (writePresets(entity, next)) {
      setPresets(next);
      return true;
    }
    setNote(text.cannotSave);
    return false;
  };

  const save = () => {
    const name = (naming ?? "").trim().slice(0, MAX_NAME);
    if (name === "") {
      return;
    }
    const kept = rows.map(({ field, kind, text: typed }) => ({ field, kind, text: typed }));
    const others = presets.filter((preset) => preset.name !== name);
    if (others.length >= MAX_PRESETS) {
      setNote(text.full(MAX_PRESETS));
      return;
    }
    if (store([...others, { name, rows: kept }].sort((a, b) => a.name.localeCompare(b.name)))) {
      setPicked(name);
      setNaming(null);
      setNote(text.saved(name));
    }
  };

  const load = (name: string) => {
    setPicked(name);
    const preset = presets.find((entry) => entry.name === name);
    if (preset) {
      onLoad(preset.rows);
      setNote(null);
    }
  };

  const remove = () => {
    if (store(presets.filter((preset) => preset.name !== picked))) {
      setNote(text.deleted(picked));
      setPicked("");
    }
  };

  return (
    <div className="mass-presets">
      <select
        className="mass-preset-select"
        aria-label={text.label}
        value={picked}
        disabled={disabled || presets.length === 0}
        onChange={(e) => load(e.currentTarget.value)}
      >
        <option value="">{presets.length === 0 ? text.none : text.choose}</option>
        {presets.map((preset) => (
          <option key={preset.name} value={preset.name}>
            {preset.name}
          </option>
        ))}
      </select>
      {picked !== "" && (
        <button type="button" disabled={disabled} onClick={remove}>
          {text.delete}
        </button>
      )}
      {naming === null ? (
        <button type="button" disabled={disabled} onClick={() => setNaming(picked)}>
          {text.save}
        </button>
      ) : (
        <span className="mass-preset-name">
          <input
            type="text"
            maxLength={MAX_NAME}
            placeholder={text.namePlaceholder}
            aria-label={text.nameLabel}
            value={naming}
            autoFocus
            onChange={(e) => setNaming(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setNaming(null);
              }
            }}
          />
          <button type="button" className="primary" disabled={naming.trim() === ""} onClick={save}>
            {text.confirm}
          </button>
          <button type="button" onClick={() => setNaming(null)}>
            {text.cancel}
          </button>
        </span>
      )}
      {note !== null && (
        <span className="mass-preset-note" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
