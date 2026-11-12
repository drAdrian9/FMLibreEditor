// Mass editing: the button in the toolbar of a list, and the dialog it opens. The dialog changes one or more fields of
// everything the list's search and filters select: it previews exactly what would be written, applies it, and can
// undo it.

import { useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { valueText } from "./editDraft";
import {
  applyMassEdit,
  changeLog,
  isoFromNumber,
  isStoredFiner,
  planMassEdit,
  shownValue,
  undoBatch,
} from "./editing";
import { fieldTable } from "./fieldTables";
import { MassPresets } from "./MassPresets";
import { currencySymbol, describeError } from "./format";
import { changesText, editText, fieldLabel, massEditText as text, profileText, valueChange } from "./labels";
import type { ListState } from "./ListBrowser";
import {
  groupFields,
  inputRange,
  judgeRow,
  MASS_LIMIT,
  MAX_OPERATIONS,
  undoFailureLines,
  type FieldGroup,
  type OperationDraft,
  type OperationKind,
  type RowVerdict,
} from "./massDraft";
import type { EditField, Entity, LoggedChange, MassFilters, MassPreview, MassReport } from "./types";
import { useModal } from "./useModal";
import { askToLeave, EditorContext } from "./useProfileEditing";

/** What a mass edit applies to: the list as it was when the dialog opened. */
interface MassScope {
  /** The list's search text. */
  query: string;
  /** The list's filter, as the list sends it to its search. */
  filters: MassFilters;
  /** How many the search and the filters select, and how many of them the list has rows for. */
  total: number;
  shown: number;
}

interface MassEditButtonProps {
  entity: Entity;
  /** The filter of the list as it sends it to its search: `{ playerFilter }`, `{ staffFilter }` or `{ clubFilter }`. */
  filters: MassFilters;
  /** The search text and the total of the list, from its toolbar. */
  list: ListState;
}

/**
 * The Mass edit button of a list's toolbar, and the dialog it opens (nothing while the game cannot be written to). The
 * dialog applies to what the list selects when it is opened; the list cannot change while the dialog is up. Edits
 * pending in the open profile are asked about before the dialog opens (see `askToLeave`).
 */
export function MassEditButton({ entity, filters, list }: MassEditButtonProps) {
  const { editable } = useContext(EditorContext);
  const [scope, setScope] = useState<MassScope | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Once the dialog is gone, focus goes back to the button that opened it. Doing it earlier, with the dialog still
  // up, would only make the dialog take focus back.
  useEffect(() => {
    if (wasOpen.current && scope === null) {
      button.current?.focus();
    }
    wasOpen.current = scope !== null;
  }, [scope]);

  if (!editable) {
    return null;
  }
  // The total is null while the list is still asking for the search and filters it shows.
  const { total } = list;
  const open = () => {
    if (total !== null) {
      // A mass edit would write under the edits pending in the open profile, which were read before it: the profile
      // asks first, and the dialog opens only if they are discarded.
      askToLeave(() => setScope({ query: list.query, filters, total, shown: list.shown }));
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="mass-edit-toggle"
        aria-haspopup="dialog"
        disabled={total === null}
        title={text.buttonTitle}
        onClick={open}
      >
        {text.button}
      </button>
      {scope && <MassEditDialog entity={entity} scope={scope} onClose={() => setScope(null)} />}
    </>
  );
}

/** What a call is under way for, while one is. */
type Busy = "preview" | "apply" | "undo";

/** What the dialog says about the undo: how many changes were taken back, and the ones that could not be. */
interface UndoOutcome {
  undone: number;
  problems: string[];
}

/** The preview of the rows as they were when Preview was pressed, with what they were (`key`, see `draftKey`). */
interface Previewed {
  data: MassPreview;
  key: string;
}

/** The operation kinds the select offers, in order; a date offers only the first. */
const KINDS: readonly OperationKind[] = ["set", "add", "scale"];

function MassEditDialog({ entity, scope, onClose }: { entity: Entity; scope: MassScope; onClose: () => void }) {
  const { onEdited } = useContext(EditorContext);
  const titleId = useId();
  const scopeId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const alive = useRef(true);
  const running = useRef(false);
  // A selector for the control that takes focus once the next render is on screen (e.g. the new row's field select).
  const pendingFocus = useRef<string | null>(null);

  const [fields, setFields] = useState<EditField[] | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [rows, setRows] = useState<OperationDraft[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [preview, setPreview] = useState<Previewed | null>(null);
  const [report, setReport] = useState<MassReport | null>(null);
  const [undone, setUndone] = useState<UndoOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nothing to change, or more than one mass edit takes: the dialog only says so.
  const blocked = scope.total === 0 || scope.total > MASS_LIMIT;
  const applied = report !== null;
  const byKey = useMemo(() => new Map((fields ?? []).map((field) => [field.key, field] as const)), [fields]);

  useModal(dialog, busy === null, onClose);

  useEffect(() => {
    alive.current = true;
    dialog.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // The field table of the list's kind of entity, without the fields a mass edit may not change (`mass: false`, such as
  // a squad number, which is changed one player at a time): one row to start with, for its first field.
  useEffect(() => {
    let cancelled = false;
    fieldTable(entity).then(
      (all) => {
        if (cancelled) {
          return;
        }
        const table = all.filter((field) => field.mass);
        setFields(table);
        if (table.length > 0) {
          setRows([{ id: nextId.current++, field: table[0].key, kind: "set", text: "" }]);
          pendingFocus.current = ".mass-field";
        }
      },
      (e) => {
        if (!cancelled) {
          setFieldsError(describeError(e));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entity]);

  // Focus that was asked for while the rows changed.
  useEffect(() => {
    if (pendingFocus.current !== null) {
      dialog.current?.querySelector<HTMLElement>(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });

  // A new preview scrolls into view: with several rows it starts below the form.
  useEffect(() => {
    if (preview !== null) {
      summary.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [preview]);

  // A disabled control cannot keep focus: when a call is over, focus that was lost with it goes to the control that
  // carries on, the outcome or Preview.
  const wasBusy = useRef(false);
  useEffect(() => {
    const was = wasBusy.current;
    wasBusy.current = busy !== null;
    if (!was || busy !== null) {
      return;
    }
    const box = dialog.current;
    const active = document.activeElement;
    if (box && active instanceof HTMLElement && box.contains(active) && !active.matches(":disabled")) {
      return;
    }
    const button = previewButton.current;
    const next = applied
      ? result.current
      : button && !button.disabled
        ? button
        : box?.querySelector<HTMLElement>(".mass-field");
    next?.focus();
  }, [busy, applied]);

  // The rows --------------------------------------------------------------------------------------------------------

  const used = new Set(rows.map((row) => row.field));
  const verdicts: RowVerdict[] = rows.map((row) => {
    const field = byKey.get(row.field);
    return field ? judgeRow(field, row.kind, row.text) : { ok: false, message: null };
  });
  const operations = verdicts.flatMap((verdict) => (verdict.ok ? [verdict.operation] : []));
  const complete = rows.length > 0 && operations.length === rows.length;
  // What the rows say, so that a preview is applicable only for them as they are.
  const draftKey = JSON.stringify(rows.map(({ field, kind, text: typed }) => [field, kind, typed.trim()]));
  const previewed = preview !== null && preview.key === draftKey ? preview.data : null;
  const current = applied ? null : previewed;

  const change = (id: number, edit: (row: OperationDraft) => OperationDraft) =>
    setRows((old) => old.map((row) => (row.id === id ? edit(row) : row)));

  const setField = (id: number, key: string) =>
    change(id, (row) => {
      // A date is typed in a date input and anything else in a number input: the text does not carry over.
      const wasDate = byKey.get(row.field)?.kind === "date";
      const isDate = byKey.get(key)?.kind === "date";
      return { ...row, field: key, kind: isDate ? "set" : row.kind, text: wasDate === isDate ? row.text : "" };
    });
  // The same number means something else for another operation: it is typed again.
  const setKind = (id: number, kind: OperationKind) => change(id, (row) => ({ ...row, kind, text: "" }));
  const setText = (id: number, typed: string) => change(id, (row) => ({ ...row, text: typed }));

  const addRow = () => {
    const free = fields?.find((field) => !used.has(field.key));
    if (free === undefined || rows.length >= MAX_OPERATIONS) {
      return;
    }
    const id = nextId.current++;
    setRows((old) => [...old, { id, field: free.key, kind: "set", text: "" }]);
    pendingFocus.current = `[data-row="${id}"] .mass-field`;
  };

  const removeRow = (id: number) => {
    const index = rows.findIndex((row) => row.id === id);
    const neighbour = rows[index + 1] ?? rows[index - 1];
    if (neighbour === undefined) {
      return;
    }
    setRows((old) => old.filter((row) => row.id !== id));
    pendingFocus.current = `[data-row="${neighbour.id}"] .mass-field`;
  };

  // The calls ---------------------------------------------------------------------------------------------------------

  /** Runs one call at a time; what it throws is shown. */
  const run = async (what: Busy, task: () => Promise<void>) => {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(what);
    setError(null);
    try {
      await task();
    } catch (e) {
      if (alive.current) {
        setError(describeError(e));
      }
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(null);
      }
    }
  };

  const showPreview = () =>
    complete &&
    run("preview", async () => {
      try {
        const data = await planMassEdit(entity, scope.query, scope.filters, operations);
        if (alive.current) {
          setPreview({ data, key: draftKey });
        }
      } catch (e) {
        if (alive.current) {
          setPreview(null);
        }
        throw e;
      }
    });

  const apply = () =>
    current !== null &&
    current.changes > 0 &&
    run("apply", async () => {
      try {
        const done = await applyMassEdit(current.id);
        // The game has changed: the lists, the profile and the change log read it again.
        if (done.applied > 0) {
          onEdited();
        }
        if (alive.current) {
          setReport(done);
          setUndone(null);
        }
      } catch (e) {
        // The plan is gone or out of date: it is previewed again.
        if (alive.current) {
          setPreview(null);
        }
        throw e;
      }
    });

  const undo = () =>
    report !== null &&
    run("undo", async () => {
      const done = await undoBatch(report.batch);
      if (done.undone > 0) {
        onEdited();
      }
      // The failures only have the numbers of the changes: the log names them.
      let log: LoggedChange[] = [];
      if (done.failed.length > 0) {
        try {
          log = await changeLog();
        } catch {
          // They are then told by number.
        }
      }
      if (alive.current) {
        setUndone({ undone: done.undone, problems: undoFailureLines(done.failed, log) });
      }
    });

  const canUndo = report !== null && report.applied > 0 && (undone === null || undone.problems.length > 0);
  const scopeText =
    scope.total === 0
      ? text.scopeNone(entity)
      : scope.total > MASS_LIMIT
        ? text.scopeTooMany(entity, scope.total, MASS_LIMIT)
        : text.scope(entity, scope.total);
  const applyTitle =
    current === null ? text.applyFirst : current.changes === 0 ? text.applyNothing : text.applyTitle(current.changes);

  return createPortal(
    // A click beside the dialog does nothing, and keeps focus where it is.
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
        className="modal mass-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={scopeId}
        aria-busy={busy !== null || undefined}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{text.title[entity]}</h2>
          <p id={scopeId} className={scope.total > MASS_LIMIT ? "mass-scope warn" : "mass-scope"}>
            {scopeText}
          </p>
          {!blocked && scope.total > scope.shown && <p className="mass-scope-note">{text.scopeAll(scope.shown)}</p>}
        </header>

        <div className="modal-body">
          {fieldsError !== null && (
            <div className="banner" role="alert">
              {text.fieldsFailed(fieldsError)}
            </div>
          )}
          {!blocked && fields === null && fieldsError === null && (
            <p className="muted" role="status">
              {text.loadingFields}
            </p>
          )}

          {!blocked && fields !== null && rows.length > 0 && (
            <>
              <MassPresets
                entity={entity}
                rows={rows}
                disabled={busy !== null || applied}
                onLoad={(saved) => {
                  // Only fields this list has, each once, as many as one mass edit takes.
                  const seen = new Set<string>();
                  const next = saved
                    .filter((row) => byKey.has(row.field) && !seen.has(row.field) && seen.add(row.field))
                    .slice(0, MAX_OPERATIONS)
                    .map((row) => ({ ...row, id: nextId.current++ }));
                  if (next.length > 0) {
                    setRows(next);
                    setPreview(null);
                  }
                }}
              />
              <form
                className="mass-form"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void showPreview();
                }}
              >
                <fieldset className="mass-fields" disabled={busy !== null || applied} aria-label={text.fieldsLabel}>
                  <div className="mass-rows">
                    {rows.map((row, index) => {
                      const field = byKey.get(row.field);
                      if (field === undefined) {
                        return null;
                      }
                      return (
                        <OperationRow
                          key={row.id}
                          entity={entity}
                          position={index + 1}
                          draft={row}
                          field={field}
                          groups={groupFields(
                            entity,
                            fields.filter((offered) => offered.key === row.field || !used.has(offered.key)),
                          )}
                          verdict={verdicts[index]}
                          canRemove={rows.length > 1}
                          onField={setField}
                          onKind={setKind}
                          onText={setText}
                          onRemove={removeRow}
                        />
                      );
                    })}
                  </div>
                  <div className="mass-form-foot">
                    <button
                      type="button"
                      className="mass-add"
                      disabled={rows.length >= MAX_OPERATIONS}
                      title={rows.length >= MAX_OPERATIONS ? text.addFieldFull(MAX_OPERATIONS) : undefined}
                      onClick={addRow}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M10 4v12M4 10h12" />
                      </svg>
                      {text.addField}
                    </button>
                    <span className="mass-hint">{complete ? "" : text.previewBlocked}</span>
                    <button
                      ref={previewButton}
                      type="submit"
                      className="mass-preview"
                      disabled={!complete}
                      title={complete ? undefined : text.previewBlocked}
                    >
                      {busy === "preview" ? text.previewing : text.preview}
                    </button>
                  </div>
                </fieldset>
              </form>

              {/* A live region that is always there, so that it is read out when the preview fills it. */}
              <p ref={summary} className="mass-summary" role="status">
                {previewed ? text.summary(entity, previewed) : ""}
              </p>
              {current !== null && <PreviewTable entity={entity} preview={current} fields={byKey} />}
              {current !== null && current.skippedCount > 0 && <SkippedList entity={entity} preview={current} />}
            </>
          )}
        </div>

        {/* What the last Apply or Undo did: outside the scrolling body, so that it is always in view. It is a Tab stop
            once it has something to say, so that a long list of problems can be scrolled with the keyboard. */}
        <div
          ref={result}
          className="mass-result"
          role="status"
          aria-live="polite"
          tabIndex={applied || undone !== null ? 0 : -1}
        >
          {report !== null && (
            <>
              <p>{text.applied(report.applied)}</p>
              <Problems
                lines={report.failed.map((failed) =>
                  text.failure(failed.name, fieldLabel(entity, failed.field), describeError(failed.error)),
                )}
              />
            </>
          )}
          {undone !== null && (
            <>
              <p>{text.undone(undone.undone)}</p>
              <Problems lines={undone.problems} />
            </>
          )}
        </div>
        {error !== null && (
          <div className="banner mass-error" role="alert">
            {error}
          </div>
        )}

        <footer className="modal-foot">
          <span className="mass-foot-note">{applied || blocked ? "" : text.hint}</span>
          {canUndo && (
            <button
              type="button"
              className="mass-undo"
              disabled={busy !== null}
              title={text.undoTitle}
              onClick={() => void undo()}
            >
              {busy === "undo" ? text.undoing : text.undo}
            </button>
          )}
          {!applied && !blocked && (
            <button
              type="button"
              className="primary mass-apply"
              disabled={current === null || current.changes === 0 || busy !== null}
              title={applyTitle}
              onClick={() => void apply()}
            >
              {busy === "apply" ? text.applying : text.apply}
            </button>
          )}
          <button type="button" className="mass-close" disabled={busy !== null} onClick={onClose}>
            {text.close}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

interface OperationRowProps {
  entity: Entity;
  /** The row's place in the list, from 1. */
  position: number;
  draft: OperationDraft;
  /** The field the row is for. */
  field: EditField;
  /** The fields its select offers: its own, and those no other row has. */
  groups: FieldGroup[];
  verdict: RowVerdict;
  canRemove: boolean;
  onField: (id: number, key: string) => void;
  onKind: (id: number, kind: OperationKind) => void;
  onText: (id: number, text: string) => void;
  onRemove: (id: number) => void;
}

/** One field to change: which field, what to do with it, and the value; an input that cannot be applied is marked. */
function OperationRow(props: OperationRowProps) {
  const { entity, position, draft, field, groups, verdict, canRemove, onField, onKind, onText, onRemove } = props;
  const noteId = useId();
  const date = field.kind === "date";
  const range = inputRange(field, draft.kind);
  const message = verdict.ok ? null : verdict.message;
  // As wide as the longest number it takes, a minus sign included.
  const digits = Math.max(String(range.min).length, String(range.max).length);
  // A Set or an Add of a percentage (energy, match sharpness) is typed in percent, an Add in percentage points.
  const percent = field.scale === "percent" && draft.kind !== "scale";
  const hover =
    draft.kind === "scale"
      ? text.percentTitle
      : draft.kind === "add"
        ? percent
          ? text.addPointsTitle
          : text.addTitle
        : undefined;

  return (
    <div className="mass-row" role="group" aria-label={text.row(position)} data-row={draft.id}>
      <select
        className="mass-field"
        aria-label={text.field}
        value={draft.field}
        onChange={(e) => onField(draft.id, e.currentTarget.value)}
      >
        {groups.map((group) => (
          <optgroup key={group.id} label={text.groups[group.id]}>
            {group.fields.map((offered) => (
              <option key={offered.key} value={offered.key}>
                {fieldLabel(entity, offered.key)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className="mass-op"
        aria-label={text.operation}
        value={draft.kind}
        onChange={(e) => onKind(draft.id, e.currentTarget.value as OperationKind)}
      >
        {(date ? KINDS.slice(0, 1) : KINDS).map((kind) => (
          <option key={kind} value={kind}>
            {text.operations[kind]}
          </option>
        ))}
      </select>

      <span className="mass-value-cell">
        {field.kind === "i32" && draft.kind !== "scale" && (
          <span className="mass-unit" aria-hidden="true">
            {currencySymbol}
          </span>
        )}
        <input
          className={message === null ? "mass-input mass-value" : "mass-input mass-value invalid"}
          style={date ? undefined : ({ "--digits": digits } as CSSProperties)}
          type={date ? "date" : "number"}
          min={date ? isoFromNumber(field.min) : range.min}
          max={date ? isoFromNumber(field.max) : range.max}
          step={date ? undefined : 1}
          placeholder={
            date ? undefined : draft.kind === "add" ? text.amountHint(range.max) : text.rangeHint(range.min, range.max)
          }
          value={draft.text}
          aria-label={text.values[draft.kind]}
          aria-invalid={message !== null || undefined}
          aria-describedby={message === null ? undefined : noteId}
          title={hover}
          onChange={(e) => onText(draft.id, e.currentTarget.value)}
          // A wheel turned over the focused input would change its value: let go of it, so the dialog scrolls instead.
          onWheel={(e) => e.currentTarget.blur()}
        />
        {draft.kind === "scale" && (
          <span className="mass-unit" title={text.percentTitle}>
            {text.ofCurrent}
          </span>
        )}
        {percent && (
          <span className="mass-unit" aria-hidden="true">
            {editText.percent}
          </span>
        )}
      </span>

      <button
        type="button"
        className="icon-button mass-remove"
        aria-label={text.remove}
        title={canRemove ? text.remove : text.removeLast}
        disabled={!canRemove}
        onClick={() => onRemove(draft.id)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>

      {message !== null && (
        <p id={noteId} className="mass-note">
          {message}
        </p>
      )}
    </div>
  );
}

/** "Name", "UID": the column heads of the tables of people and clubs. */
const idHead = (entity: Entity) => (entity === "staff" ? profileText.id : profileText.uid);

interface PreviewTableProps {
  entity: Entity;
  preview: MassPreview;
  /** The editable fields by key, to turn stored values into shown ones. */
  fields: ReadonlyMap<string, EditField>;
}

/** The first changes of a preview, as "Finishing 17 → 20", and how many more there are. */
function PreviewTable({ entity, preview, fields }: PreviewTableProps) {
  const more = preview.changes - preview.rows.length;
  if (preview.rows.length === 0) {
    return null;
  }
  return (
    <div className="mass-listing">
      <div className="mass-table-wrap" role="region" aria-label={text.tableLabel} tabIndex={0}>
        <table className="grid mass-grid mass-changes">
          <thead>
            <tr>
              <th>{text.columns.name}</th>
              <th>{idHead(entity)}</th>
              <th>{text.columns.field}</th>
              <th>{text.columns.change}</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const field = fields.get(row.field);
              const shown = (stored: number) => (field ? shownValue(field, stored) : stored);
              return (
                <tr key={`${row.uid}:${row.field}`}>
                  <td className="name">{row.name}</td>
                  <td className="uid">{row.uid}</td>
                  <td>{fieldLabel(entity, row.field)}</td>
                  {/* An attribute or a percentage is stored on a finer scale than it is shown: the hover text has the
                      stored values. */}
                  <td
                    className="change-value"
                    title={isStoredFiner(field) ? changesText.stored(valueChange(row.old, row.new)) : undefined}
                  >
                    {valueChange(valueText(field, shown(row.old)), valueText(field, shown(row.new)))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mass-more">{text.more(more)}</p>}
    </div>
  );
}

/** The values a preview leaves alone, with the reasons, behind a line that opens the list. */
function SkippedList({ entity, preview }: { entity: Entity; preview: MassPreview }) {
  const more = preview.skippedCount - preview.skipped.length;
  return (
    <details className="mass-skipped">
      <summary>{text.skippedHeading(preview.skippedCount)}</summary>
      <div className="mass-table-wrap" role="region" aria-label={text.skippedLabel} tabIndex={0}>
        <table className="grid mass-grid">
          <thead>
            <tr>
              <th>{text.columns.name}</th>
              <th>{idHead(entity)}</th>
              <th>{text.columns.field}</th>
              <th>{text.columns.reason}</th>
            </tr>
          </thead>
          <tbody>
            {preview.skipped.map((skipped) => (
              <tr key={`${skipped.uid}:${skipped.field}`}>
                <td className="name">{skipped.name}</td>
                <td className="uid">{skipped.uid}</td>
                <td>{fieldLabel(entity, skipped.field)}</td>
                <td className="reason">
                  {describeError({ code: skipped.code, params: skipped.params, message: skipped.reason })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mass-more">{text.more(more)}</p>}
    </details>
  );
}

/** Most lines of what went wrong the dialog lists; the rest is counted. */
const PROBLEMS_SHOWN = 100;

/** Lines of what went wrong, the first ones; nothing when there are none. */
function Problems({ lines }: { lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  const shown = lines.slice(0, PROBLEMS_SHOWN);
  return (
    <ul className="edit-problems mass-problems">
      {shown.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
      {lines.length > shown.length && <li>{text.more(lines.length - shown.length)}</li>}
    </ul>
  );
}
