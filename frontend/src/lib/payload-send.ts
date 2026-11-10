/**
 * Posting a module's built payloads to the customer's own AFAS.
 *
 * The step after [`module-payloads.ts`](./module-payloads.ts), which builds the
 * bodies and shows them: this sends the ones an admin picked, through the connector
 * each body's own record names, into the project's **test** or **live** environment.
 *
 * ### The send is a run, not a request
 *
 * A few hundred records is a few minutes of sequential AFAS calls, so the browser
 * does not hold the connection open for it: {@link startSendRun} returns a run id as
 * soon as the backend has accepted the work, and {@link fetchSendRun} reports how far
 * it has got. The same shape as the dossier migration's run
 * ([`dossier-migration.ts`](./dossier-migration.ts)), and for the same reason — the
 * run outlives the screen it was started from, so closing the panel or reloading the
 * page loses neither the send nor its report.
 *
 * Everything that can refuse the whole run still happens on the **start** call and
 * comes back as an `ApiError`: not an admin, a stage without credentials, a record
 * claiming to update something AFAS no longer has. A run that starts has passed all
 * of those, and from then on the only outcomes are per-record.
 *
 * ### The body that is sent is the body that was read
 *
 * `payloadJson()` writes the document line by line so a line can carry the column
 * that filled it (see [`afas-schema.ts`](./afas-schema.ts)), and the text left of
 * those notes is valid JSON — so {@link payloadBody} parses exactly what the panel
 * renders back into the object that goes over the wire. Nothing rebuilds the body
 * from the sheet a second time: what an admin checked on screen is what leaves the
 * browser, which is the only reason it is safe to look at a payload and press send.
 *
 * ### AFAS is not asked to undo anything
 *
 * Each record is one POST — an insert (docs/AFAS-Profit-API-Referentie.md §4) — and
 * AFAS has no transaction across calls. Every selected record is therefore attempted
 * and each reports for itself; a run that fails halfway leaves the records before it
 * written, and the result says exactly which those were.
 */

import { jsonBody, requestJson } from "@/lib/api";
import {
  payloadJson,
  type AfasSchemaObject,
  type AfasUpdateSchema,
} from "@/lib/afas-schema";
import type { ModulePayload, VariantContext } from "@/lib/module-payloads";
import { cellToString, type ParsedSheet } from "@/lib/excel";
import type { Issue } from "@/lib/validation/types";
import { fromMappingExport, remapToSheet } from "@/lib/field-mapping";
import type { SettingsStage } from "@/lib/project-settings";

/** Which of a project's two AFAS environments a send goes to. */
export type SendStage = SettingsStage;

/** The two environments, in the order the switch offers them — test first, and it
 *  is also the default: live writes real records into a customer's environment, so
 *  it is a thing you choose rather than a thing you find yourself in. */
export const SEND_STAGES: { id: SendStage; label: string }[] = [
  { id: "test", label: "Test" },
  { id: "live", label: "Live" },
];

/**
 * What a record does to AFAS: insert it (POST) or update the one already there (PUT).
 *
 * AFAS's verbs carry the meaning and there is no upsert
 * (docs/AFAS-Profit-API-Referentie.md §4), so this is decided per record from the
 * existence read — and re-checked server-side against the same read before anything
 * is written, so a stale panel cannot turn one into the other.
 */
export type SendAction = "insert" | "update";

/** What a result says was done — a send's two verbs, or a delete run's one. */
export type ResultAction = SendAction | "delete";

/** What a run does as a whole: send (insert/update) or remove records. */
export type RunOperation = "send" | "delete";

/** One record on its way out, as the backend takes it. */
export interface SendRecord {
  ordinal: number;
  connector: string;
  rows: number[];
  title: string;
  /** The variant label — `Project`, `Organisatie` — what the record *is*. */
  kind: string;
  action: SendAction;
  /** The record's key from the sheet, for the backend's re-check of an `update`. */
  key: string;
  body: Record<string, unknown>;
}

/** What AFAS said about one record. `ok` is the only thing the row colour reads. */
export interface SendResult {
  ordinal: number;
  rows: number[];
  title: string;
  /** The variant label the record was sent as; absent on runs from before it existed. */
  kind?: string;
  connector: string;
  ok: boolean;
  /** Which verb actually went out — the backend's word, not the browser's. */
  action: ResultAction;
  message: string;
  /** The primary key AFAS wrote, when it wrote one — `{ KnSubject: { SbId: "…" } }`. */
  keys?: Record<string, unknown>;
  logReference?: string | null;
  /** When AFAS answered on this record (UTC ISO); absent on runs from before it existed. */
  answeredAt?: string;
  /** The body as it was sent — **refusals only**, so the value AFAS objected to can
   *  be read back out of it ({@link refusedValues}). */
  body?: Record<string, unknown>;
}

/** A field AFAS named in a refusal, and what the record actually sent for it. */
export interface RefusedValue {
  /** The name as AFAS used it in its message — `Verkooprelatie`. */
  label: string;
  fieldId: string;
  /** `null` when the body didn't carry the field at all. */
  value: string | null;
}

/** The names AFAS quotes in a message: `'Verkooprelatie'`, “Land”, "Land". */
const QUOTED = /'([^']{1,80})'|‘([^’]{1,80})’|“([^”]{1,80})”|"([^"]{1,80})"/g;

/**
 * Which values a refused record sent for the fields AFAS names in its message.
 *
 * AFAS refers to a field by its **label**, as the connector's schema spells it
 * (*De ingevulde waarde bij 'Verkooprelatie' bestaat niet.*), and sometimes by its
 * code (*… (CoId)*). Neither is the value, and the value is what somebody has to
 * find in their sheet. So every quoted name is looked up in the schema, matching
 * label or field code case-insensitively, and each object in the tree that has
 * such a field is paired with its value from the body, under that same object. A
 * name that is no field (a quoted *value*, a table name) finds nothing and is
 * skipped rather than guessed at.
 */
export function refusedValues(
  message: string,
  body: Record<string, unknown> | undefined,
  schema: AfasUpdateSchema | undefined,
): RefusedValue[] {
  if (!body || !schema || !message) return [];
  const names = new Set<string>();
  for (const match of message.matchAll(QUOTED)) {
    const name = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (name) names.add(name.toLowerCase());
  }
  if (names.size === 0) return [];

  // (object name, field id) pairs the schema has under one of those names.
  const wanted: { object: string; fieldId: string; label: string }[] = [];
  const walkSchema = (object: AfasSchemaObject) => {
    for (const field of object.fields ?? []) {
      const label = field.label.trim().toLowerCase();
      const code = field.fieldId.toLowerCase();
      if (names.has(label) || names.has(code)) {
        wanted.push({ object: object.name, fieldId: field.fieldId, label: field.label });
      }
    }
    for (const child of object.objects ?? []) walkSchema(child);
  };
  walkSchema(schema);
  if (wanted.length === 0) return [];

  // Every `Fields` block in the body, by the object it belongs to. The envelope is
  // `{ <Object>: { Element: { Fields, Objects: [ { <Child>: { Element } } ] } } }`,
  // with `Element` an object or — for a repeated child — an array of them.
  const fieldsByObject = new Map<string, Record<string, unknown>[]>();
  const walkBody = (value: unknown, object: string | null) => {
    if (Array.isArray(value)) {
      for (const item of value) walkBody(item, object);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "Fields" && object && inner && typeof inner === "object") {
        const list = fieldsByObject.get(object) ?? [];
        list.push(inner as Record<string, unknown>);
        fieldsByObject.set(object, list);
      } else if (key === "Element" || key === "Objects") {
        walkBody(inner, object);
      } else {
        walkBody(inner, key);
      }
    }
  };
  walkBody(body, null);

  const found: RefusedValue[] = [];
  const seen = new Set<string>();
  for (const { object, fieldId, label } of wanted) {
    const blocks = fieldsByObject.get(object);
    // An object the body doesn't carry at all is not the one AFAS read.
    if (!blocks) continue;
    for (const fields of blocks) {
      const raw = fields[fieldId];
      const value =
        raw === undefined || raw === null || raw === "" ? null : String(raw);
      const key = `${label}\u0000${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ label, fieldId, value });
    }
  }
  // A label the body filled wins over the same label left empty elsewhere — an
  // empty twin in another object is noise next to the value AFAS actually read.
  const filled = new Set(found.filter((v) => v.value !== null).map((v) => v.label));
  return found.filter((v) => v.value !== null || !filled.has(v.label));
}

/**
 * The refused records as cells of the sheet, in the `"row:col"` shape a validation
 * run hands `downloadSheet` — so the Excel of a send's errors is written by the very
 * same export as the Excel of a check, and tints exactly the cells to fix.
 *
 * A cell is a (row, column) pair: the rows are the record's own sheet rows (several
 * for a grouped record), the columns those the mapping filled the fields AFAS named
 * from ({@link refusedValues}). A refusal naming no field it can be traced to — a
 * message about the record as a whole — marks every mapped cell of its rows
 * instead: AFAS did not say which of them, and a record left untinted would read as
 * one that went through.
 *
 * Read through the same `remapToSheet` the bodies were built with, so a column is
 * found by header on the sheet on screen rather than by the index the mapping was
 * saved with.
 */
export function refusalIssues(
  results: SendResult[],
  refused: Map<number, RefusedValue[]>,
  contexts: Map<string, VariantContext>,
  sheet: ParsedSheet,
): Map<string, Issue[]> {
  // Field code → sheet column, and every mapped column, per connector. A split
  // module's two halves share a connector, so their columns are pooled.
  const byConnector = new Map<string, { fields: Map<string, Set<number>>; all: Set<number> }>();
  for (const { mapping: stored } of contexts.values()) {
    const entry = byConnector.get(stored.connector) ?? { fields: new Map(), all: new Set() };
    byConnector.set(stored.connector, entry);
    const mapping = remapToSheet(fromMappingExport(stored), sheet.headers);
    for (const [key, source] of Object.entries(mapping)) {
      if (source.kind !== "column") continue;
      const fieldId = key.slice(key.lastIndexOf("#") + 1);
      const columns = entry.fields.get(fieldId) ?? new Set<number>();
      columns.add(source.index);
      entry.fields.set(fieldId, columns);
      entry.all.add(source.index);
    }
  }

  const gridRow = new Map(sheet.rowNumbers.map((rowNumber, index) => [rowNumber, index]));
  const issues = new Map<string, Issue[]>();
  for (const result of results) {
    if (result.ok) continue;
    const entry = byConnector.get(result.connector);
    if (!entry) continue;
    const named = new Set<number>();
    for (const value of refused.get(result.ordinal) ?? []) {
      for (const column of entry.fields.get(value.fieldId) ?? []) named.add(column);
    }
    const columns = named.size > 0 ? named : entry.all;
    const message = refusalMessage(result);
    for (const rowNumber of result.rows) {
      const row = gridRow.get(rowNumber);
      if (row === undefined) continue;
      for (const col of columns) {
        const key = `${row}:${col}`;
        issues.set(key, [...(issues.get(key) ?? []), { row, col, message }]);
      }
    }
  }
  return issues;
}

/**
 * The records a run held back (`skippedMissing`) as cells of the sheet, in the
 * shape {@link refusalIssues} hands back — so the Excel of a run marks *Niet
 * gevonden* next to *geweigerd*, and the client sees the debiteur to add as
 * plainly as the field AFAS refused.
 *
 * The cell is the lookup column whose value the reason quotes (`Debiteur "5019"
 * bestaat niet …`, the wording of `resolveLookup()`), found by value rather than
 * by re-running the lookup: the tables on screen may be another stage's than the
 * run's. A reason without a quoted value marks every filled lookup cell of the
 * record's rows instead — one of them is the cause, and an untinted row would
 * read as one that went through.
 */
export function missingIssues(
  records: SkippedRecord[],
  contexts: Map<string, VariantContext>,
  sheet: ParsedSheet,
): Map<string, Issue[]> {
  const lookupColumns = new Set<number>();
  for (const { mapping: stored } of contexts.values()) {
    const mapping = remapToSheet(fromMappingExport(stored), sheet.headers);
    for (const source of Object.values(mapping)) {
      if (source.kind === "column" && source.lookup) lookupColumns.add(source.index);
    }
  }

  const gridRow = new Map(sheet.rowNumbers.map((rowNumber, index) => [rowNumber, index]));
  const issues = new Map<string, Issue[]>();
  for (const record of records) {
    const message = record.reason.trim() || "Niet gevonden in AFAS";
    const quoted = message.match(/"([^"]*)"/)?.[1]?.trim();
    // A record of several rows names the one that failed (`… (rij 12)`).
    const failedRow = Number(message.match(/\(rij (\d+)\)$/)?.[1]);
    const rows = Number.isFinite(failedRow) && record.rows.includes(failedRow)
      ? [failedRow]
      : record.rows;
    const cells: { row: number; col: number }[] = [];
    const filled: { row: number; col: number }[] = [];
    for (const rowNumber of rows) {
      const row = gridRow.get(rowNumber);
      if (row === undefined) continue;
      for (const col of lookupColumns) {
        const text = cellToString(sheet.rows[row]?.[col] ?? null).trim();
        if (text === "") continue;
        filled.push({ row, col });
        if (quoted !== undefined && text === quoted) cells.push({ row, col });
      }
    }
    for (const { row, col } of cells.length > 0 ? cells : filled) {
      const key = `${row}:${col}`;
      issues.set(key, [...(issues.get(key) ?? []), { row, col, message }]);
    }
  }
  return issues;
}

/**
 * A refusal in parts, so each medium can set its own weight — the record
 * (`Organisatie 101`), AFAS's message untouched, and what was sent for the field
 * that message names (`[Opgestuurd 101]`, empty when it names none).
 */
export function refusalParts(
  result: SendResult,
  values: RefusedValue[] | undefined,
): { subject: string; message: string; sent: string } {
  const title = result.title || "(leeg)";
  return {
    subject: result.kind ? `${result.kind} ${title}` : title,
    message: refusalMessage(result),
    sent:
      values && values.length > 0
        ? `[Opgestuurd ${values.map((v) => v.value ?? "leeg").join(", ")}]`
        : "",
  };
}

/** AFAS's message as the grouping key and the heading — trimmed, never empty. */
function refusalMessage(result: SendResult): string {
  return result.message.trim() || "AFAS gaf geen melding terug.";
}

/** {@link refusalParts} as one sentence — for a tooltip or the single-record strip:
 *  *Organisatie 101: Waarde valt buiten de grenzen. … [Opgestuurd 101]*. */
export function refusalText(
  result: SendResult,
  values: RefusedValue[] | undefined,
): string {
  const { subject, message, sent } = refusalParts(result, values);
  return `${subject}: ${message}${sent ? ` ${sent}` : ""}`;
}

/** `Rij 5`, or `Rij 5–7` for a record built from several sheet rows. */
export function refusalRows(result: Pick<SendResult, "ordinal" | "rows">): string {
  const rows = result.rows;
  if (rows.length === 0) return `Record ${result.ordinal}`;
  return rows.length > 1
    ? `Rij ${rows[0]}–${rows[rows.length - 1]}`
    : `Rij ${rows[0]}`;
}

/** One refused record under its group's message: *Rij 5. Organisatie 101 [Opgestuurd 101]*. */
export interface RefusalItem {
  result: SendResult;
  rows: string;
  subject: string;
  sent: string;
}

/** Every record AFAS refused with the same message, under that message once. */
export interface RefusalGroup {
  message: string;
  items: RefusalItem[];
}

/**
 * The refusals of a run, grouped by AFAS's message.
 *
 * A bad value in one column fails every row that carries it, and listed record
 * by record that is forty copies of one sentence with the part that differs, the
 * row, buried at the end of each. Grouped, the sentence is read once and the rows
 * beneath it are the list to go and fix. The key is the message **as AFAS wrote
 * it**, not a pattern over it: a message that names its own value (*De waarde 'X'
 * …*) is a different finding from its neighbour, and merging those would be a
 * guess.
 *
 * Largest group first, since that is the fix that clears the most rows; ties
 * keep the order AFAS answered in. Rows within a group are in send order.
 */
export function groupRefusals(
  results: SendResult[],
  valuesByOrdinal: Map<number, RefusedValue[]>,
): RefusalGroup[] {
  const groups = new Map<string, RefusalGroup>();
  for (const result of results) {
    if (result.ok) continue;
    const { subject, message, sent } = refusalParts(
      result,
      valuesByOrdinal.get(result.ordinal),
    );
    let group = groups.get(message);
    if (!group) {
      group = { message, items: [] };
      groups.set(message, group);
    }
    group.items.push({ result, rows: refusalRows(result), subject, sent });
  }
  // `sort` is stable, so equal-sized groups stay in first-seen order.
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

/**
 * AFAS's catch-all for a failure on its own side. It names nothing in the record,
 * so it is shown in the app (the run did refuse those rows) but left out of the
 * verzendrapport, where a client would read it as something in their data to fix.
 */
const UNEXPECTED_ERROR = "er is een onverwachte fout opgetreden.";

/** Whether a group is AFAS's {@link UNEXPECTED_ERROR} rather than a finding. */
export function isUnexpectedErrorGroup(group: RefusalGroup): boolean {
  return group.message.trim().toLowerCase() === UNEXPECTED_ERROR;
}

/** An item as plain text: `Rij 5. Organisatie 101 [Opgestuurd 101]`. */
export function refusalItemText(item: Pick<RefusalItem, "rows" | "subject" | "sent">): string {
  return `${item.rows}. ${item.subject}${item.sent ? ` ${item.sent}` : ""}`;
}

/**
 * What a send's outcome is measured against once it ends: every sheet row the
 * module's records cover, sent or not, and those of them AFAS already held in this
 * stage before the run. The backend turns the run's results into the share of the
 * sheet that is in AFAS and stamps it onto the deeltaak — the sidebar's percentage
 * with the send icon (`send_progress.outcome()` in the backend).
 */
export interface SendMeasure {
  sheetRows: number[];
  existingRows: number[];
}

/** The ticked records a send leaves out, and why — reported with the run. */
export interface SendSkipped {
  existing: number;
  phase: number;
  /** Held back because something they look up isn't in AFAS — listed, not counted. */
  missing?: SkippedRecord[];
}

/**
 * A ticked record kept out of the send because a looked-up value has no answer in
 * the environment — the debiteur of a project, the project of a voorcalculatieregel.
 * `reason` is the record's `blocked` text as the panel shows it.
 */
export interface SkippedRecord {
  ordinal: number;
  rows: number[];
  title: string;
  kind: string;
  reason: string;
}

/** Records held back for the same missing thing, under that reason once. */
export interface MissingGroup {
  message: string;
  items: { ordinal: number; rows: string; subject: string; sent: string }[];
}

/**
 * The held-back records of a run, grouped the way {@link groupRefusals} groups
 * AFAS's messages — but on the reason **without its value**: `Debiteur "5019"
 * bestaat niet in …` and `Debiteur "5020" …` are one finding (that debiteur list
 * is incomplete), with the value moved onto the row as `[Gezocht 5019]`. Coupled to
 * the wording of `resolveLookup()` in `afas-lookup.ts`, which quotes the one value
 * it looked for; a reason without quotes groups as written.
 */
export function groupMissing(records: SkippedRecord[]): MissingGroup[] {
  const groups = new Map<string, MissingGroup>();
  for (const record of records) {
    const reason = record.reason.trim() || "Niet gevonden in AFAS";
    const quoted = reason.match(/"([^"]*)"/);
    const message = reason
      // A record of several rows names the one that failed; that is the row's
      // business, not the group's.
      .replace(/\s*\(rij \d+\)$/, "")
      // The connector it was looked up in (`(CON_ERP_Debiteuren)`) is ours, not
      // the reader's — the environment before it already says where.
      .replace(/\s*\([^()\s]*_[^()\s]*\)$/, "")
      .replace(/\s*"[^"]*"/, "");
    let group = groups.get(message);
    if (!group) {
      group = { message: message.charAt(0).toUpperCase() + message.slice(1), items: [] };
      groups.set(message, group);
    }
    const title = record.title || "(leeg)";
    group.items.push({
      ordinal: record.ordinal,
      rows: refusalRows({ ordinal: record.ordinal, rows: record.rows }),
      subject: record.kind ? `${record.kind} ${title}` : title,
      sent: quoted ? `[Gezocht ${quoted[1]}]` : "",
    });
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

/** Where a run is: still going, finished, stopped by something that wasn't a
 *  single record's problem (`failed`), or stopped on request (`stopped`). */
export type SendRunStatus = "running" | "done" | "failed" | "stopped";

/**
 * The whole run: what went where, how far it is, and how it ended per record.
 *
 * One shape for both halves of the send — the progress bar reads `done`/`total`
 * while `status` is `running`, and the notices read `sent`/`failed`/`results` once
 * it isn't. The per-record fields are live throughout: `results` grows as AFAS
 * answers, so a row gets its tick the moment its own record lands rather than when
 * the run ends.
 */
export interface SendOutcome {
  /** Identifies the run for polling, and for finding it again after a reload. */
  runId: string;
  status: SendRunStatus;
  /** `delete` for a run started by *Verwijderen*; absent on runs from before it. */
  operation?: RunOperation;
  moduleId: string;
  stage: SendStage;
  /** How the environment names itself, for the line above the results. */
  environment: string;
  startedAt: string;
  finishedAt: string | null;
  /** Why the run stopped early, when it did — never a single record's refusal,
   *  which is an outcome inside `results`. */
  error: string | null;
  /** A stop was asked for; the run is still `running` until the record in flight
   *  has answered. Absent on runs from before stopping existed. */
  stopRequested?: boolean;
  /** How many records the run was started with, and how many have answered. */
  total: number;
  /** Ticked but not sent: already in AFAS under *Alleen nieuwe*, or left out by the
   *  phase. Absent on runs from before they were counted. */
  skippedExisting?: number;
  skippedPhase?: number;
  /** Ticked but held back: something the record looks up isn't in AFAS. Absent on
   *  runs from before they were reported. */
  skippedMissing?: SkippedRecord[];
  /** The step of a multi-step module this run sent (`aanmaken`) and its label
   *  (`Historie`); empty for every other module, absent on older runs. */
  phase?: string;
  phaseLabel?: string;
  /**
   * The sheet rows this run's step has in AFAS once it ended, over every run of the
   * step the backend holds — how far a step that **updates** got, where existence
   * can't tell (every employee exists once *Historie* is in). `null` while running
   * or where nothing was measured; absent on older runs.
   */
  stepRows?: number[] | null;
  done: number;
  sent: number;
  failed: number;
  /** How the successful half split between the two verbs. */
  inserted: number;
  updated: number;
  /** Records removed — a delete run's only verb. Absent on runs from before it. */
  deleted?: number;
  results: SendResult[];
}

/** Whether a run removed records rather than sending them. */
export function isDeleteRun(run: SendOutcome | null | undefined): boolean {
  return run?.operation === "delete";
}

/**
 * The rendered payload as the object AFAS receives.
 *
 * Throws when the lines don't parse, which can only mean the renderer produced
 * something that isn't JSON — a bug worth surfacing rather than a body worth
 * sending. The caller turns it into a per-record failure.
 */
export function payloadBody(payload: ModulePayload): Record<string, unknown> {
  const parsed: unknown = JSON.parse(payloadJson(payload.lines));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Payload ${payload.ordinal} is geen JSON-object.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * A built payload as the record the backend sends.
 *
 * `action` defaults to `insert` — what every send did before existence checking, and
 * what a module without an existence plan keeps doing. The caller passes `update`
 * only for a record it has actually seen marked *Bestaat al*.
 */
export function toSendRecord(
  payload: ModulePayload,
  action: SendAction = "insert",
): SendRecord {
  return {
    ordinal: payload.ordinal,
    connector: payload.connector,
    rows: payload.rowNumbers,
    title: payload.title,
    kind: payload.variant.label,
    action,
    key: payload.existingKey,
    body: payloadBody(payload),
  };
}

/**
 * Start sending the selected records and return the run — it is `running` and
 * almost certainly empty at this point, and {@link fetchSendRun} carries it from
 * there. Admin-only on the backend, which also refuses a stage it wasn't given:
 * there is no default environment anywhere in this path.
 *
 * A thrown `ApiError` means the run was *refused* and nothing was sent (no
 * connection, not an admin, the project not configured for this environment, a
 * record claiming to update something AFAS no longer has, or — 409 — a send of this
 * module already in progress). Records AFAS itself refuses come back inside
 * `results` with `ok: false`, because that is an outcome, not an error.
 */
export async function startSendRun(
  projectId: string,
  moduleId: string,
  stage: SendStage,
  records: SendRecord[],
  skipped: SendSkipped = { existing: 0, phase: 0 },
  measure?: SendMeasure,
  step?: SendStep | null,
): Promise<SendOutcome> {
  const data = await requestJson<{ run: SendOutcome }>(
    "/api/afas/payloads/send",
    jsonBody("POST", {
      project_id: projectId,
      module_id: moduleId,
      stage,
      records,
      skipped_existing: skipped.existing,
      skipped_phase: skipped.phase,
      skipped_missing: skipped.missing ?? [],
      sheet_rows: measure?.sheetRows ?? [],
      existing_rows: measure?.existingRows ?? [],
      phase: step?.id ?? "",
      phase_label: step?.label ?? "",
      steps: step?.steps ?? [],
    }),
    "De payloads konden niet naar AFAS worden verstuurd.",
  );
  return data.run;
}

/** Which step of a multi-step module a send is — carried on the run so each step's
 *  last run can be found again ({@link fetchStepRuns}). */
export interface SendStep {
  id: string;
  label: string;
  /** Every step of the module, this one included, and whether each creates the
   *  records or updates what an earlier one created — so the figure the run stamps
   *  counts a row only once every step has it in AFAS. */
  steps: { id: string; verb: "insert" | "update" }[];
}

/**
 * The newest finished send of each step of this module in this stage, oldest
 * first — what the verzendrapport combines into one report for Medewerkers'
 * *Historie* and *Actueel*. Kept by the backend in memory, like every run.
 */
export async function fetchStepRuns(
  projectId: string,
  moduleId: string,
  stage: SendStage,
): Promise<SendOutcome[]> {
  const query = new URLSearchParams({ project_id: projectId, module_id: moduleId, stage });
  const data = await requestJson<{ runs: SendOutcome[] }>(
    `/api/afas/payloads/runs?${query.toString()}`,
    undefined,
    "De eerdere verzendingen konden niet worden opgehaald.",
  );
  return data.runs;
}

/** One run's progress — call this on an interval while `status === "running"`. */
export async function fetchSendRun(runId: string): Promise<SendOutcome> {
  const data = await requestJson<{ run: SendOutcome }>(
    `/api/afas/payloads/send/${encodeURIComponent(runId)}`,
    undefined,
    "De status van de verzending kon niet worden opgehaald.",
  );
  return data.run;
}

/**
 * Stop a run after the record it is on. The records already written stay in AFAS —
 * there is no undo — and the rest are never attempted; the run reads `stopped` once
 * the backend's loop has noticed, which the regular poll picks up.
 */
export async function stopSendRun(runId: string): Promise<SendOutcome> {
  const data = await requestJson<{ run: SendOutcome }>(
    `/api/afas/payloads/send/${encodeURIComponent(runId)}/stop`,
    jsonBody("POST", {}),
    "De verzending kon niet worden gestopt.",
  );
  return data.run;
}

/**
 * The send this module has going, or `null` — what the panel asks on mount.
 *
 * A run outlives the panel that started it, so a module reopened mid-send (or a
 * reloaded page) has to be able to find it again; without this the screen would
 * show an idle send button over records that are at that moment being written.
 */
export async function fetchActiveSendRun(
  projectId: string,
  moduleId: string,
): Promise<SendOutcome | null> {
  const query = new URLSearchParams({
    project_id: projectId,
    module_id: moduleId,
  });
  const data = await requestJson<{ run: SendOutcome | null }>(
    `/api/afas/payloads/send?${query.toString()}`,
    undefined,
    "De lopende verzending kon niet worden opgehaald.",
  );
  return data.run ?? null;
}

/**
 * Which AFAS a send would reach — the environment number and the stage.
 *
 * Fetched rather than derived: the omgevingsnummer is stored per project in the
 * settings table and deliberately kept out of the session's project list, which
 * every user gets, admin or not. This route is admin-only like the send itself.
 */
export interface SendEnvironment {
  projectId: string;
  stage: SendStage;
  /** The AFAS environment number, or `""` when the project has none stored. */
  omgeving: string;
  /** `38892.resttest.afas.online`, or `""` without a number to build it from. */
  host: string;
  /** The project's own name, as the settings row spells it. */
  label: string;
  /** How the backend names it in an error: `Balans - conversie — 38892 (test)`. */
  name: string;
  /** Whether this stage has credentials stored — *ingesteld*, not *werkt*. */
  configured: boolean;
}

/**
 * The environment one stage of a project points at, for the line the confirmation
 * dialog has to show before anything is written.
 *
 * `stage` is a query parameter and never optional, for the same reason the send's
 * isn't: there is no default environment anywhere in this path, and answering for
 * the wrong one is how a live send gets confirmed as a test.
 */
export async function fetchSendEnvironment(
  projectId: string,
  stage: SendStage,
): Promise<SendEnvironment> {
  return requestJson<SendEnvironment>(
    `/api/projects/${encodeURIComponent(projectId)}/environment?stage=${encodeURIComponent(stage)}`,
    undefined,
    "De AFAS-omgeving van dit project kon niet worden opgehaald.",
  );
}

/**
 * One record to remove, as the backend takes it: its **key** and its identity on
 * screen — nothing about where it goes. The connector, object and key field of the
 * DELETE are the backend's (`existing.DeleteTarget`), so a browser cannot point one
 * at another connector.
 */
export interface DeleteRecord {
  ordinal: number;
  rows: number[];
  title: string;
  kind: string;
  /** The key as the sheet spells it — the backend swaps in AFAS's own spelling. */
  key: string;
}

/** A built payload as the record a delete run removes. */
export function toDeleteRecord(payload: ModulePayload): DeleteRecord {
  return {
    ordinal: payload.ordinal,
    rows: payload.rowNumbers,
    title: payload.title,
    kind: payload.variant.label,
    key: payload.existingKey,
  };
}

/**
 * Start removing records from AFAS and return the run — the same run as a send's,
 * polled with {@link fetchSendRun} and stopped with {@link stopSendRun}, with
 * `operation: "delete"`.
 *
 * A thrown `ApiError` means nothing was deleted: not an admin, a module without a
 * delete, a stage without credentials, a key AFAS no longer holds (the marks on
 * screen are stale), or — 409 — a send or delete of this module already going.
 */
export async function startDeleteRun(
  projectId: string,
  moduleId: string,
  stage: SendStage,
  records: DeleteRecord[],
): Promise<SendOutcome> {
  const data = await requestJson<{ run: SendOutcome }>(
    "/api/afas/payloads/delete",
    jsonBody("POST", {
      project_id: projectId,
      module_id: moduleId,
      stage,
      records,
    }),
    "De records konden niet uit AFAS worden verwijderd.",
  );
  return data.run;
}
