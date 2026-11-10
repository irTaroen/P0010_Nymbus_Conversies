/**
 * Where each field of an AFAS UpdateConnector gets its value: a **column** of the
 * module's Excel sheet, or a **fixed value** typed in once.
 *
 * This is the other half of [`afas-schema.ts`](./afas-schema.ts): that module says
 * what a connector accepts, this one says what fills it. A module's template
 * (`HRM 1_Medewerkers.xlsx`) is mapped onto its connector once, and from then on
 * every row of that sheet can be written as a body — which is what the conversion
 * has to do and what today's upload can't (see docs/todo.md).
 *
 * **Two kinds of source, one per field.** Most fields come from a column; some are
 * the same for every row of the conversion — the type of a dossieritem, a
 * verwerkingscode, a flag AFAS insists on — and those are worth typing once rather
 * than adding a column of 3000 identical cells to the sheet. A field takes one
 * value, so the two are exclusive: assigning either replaces the other.
 *
 * A column can also be **looked up in AFAS** (`FieldSource.lookup`): the cell picks a
 * row of a GetConnector in the environment being sent to, and that row's value is
 * what the field receives — see [`afas-lookup.ts`](./afas-lookup.ts).
 *
 * **A fixed value is checked against the field's own type** before it is accepted
 * (`parseFixedValue`), because that is the whole difference between a constant that
 * is part of the payload and a note in a spreadsheet somewhere: AFAS rejects
 * `"morgen"` in a date and `"ja"` in an int, and it should be rejected here, where
 * the person who typed it is still looking.
 *
 * The key is the **field**, not the column: one column can feed several fields, but
 * a field takes one value. A column is stored by index *and* header — the index is
 * what reads a row, the header is what survives a re-read, so dropping the same
 * template again after an edit re-points every field to the column with its own
 * name (`remapToSheet`).
 *
 * **A record is not always a row.** A voorcalculatie-offerte carries several regels,
 * and its sheet says so flat — the offerte's own columns repeat on every one of its
 * rows. So a column can additionally be marked as part of the **group key**, and rows
 * that agree on the key become one record with one element per row underneath. That is
 * the whole of it; which object is the kop and which the regel follows from where the
 * key sits. See *Grouping* below.
 *
 * A finished mapping is **stored** — one file per group and connector, under
 * `backend/json_files/mappings/<group>/<connector>.json` (docs/afas-integration.md),
 * through the three functions at the bottom of this file. The document that is stored
 * is the same `MappingExport` the page shows, and `fromMappingExport()` reads it back,
 * so there is one shape rather than a stored one and a shown one.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { cellToString, type ParsedSheet } from "@/lib/excel";
import { headerIndex, normalizeHeader } from "@/lib/headers";
import { toDate } from "@/lib/validation/checks";
import {
  NO_LOOKUPS,
  resolveLookup,
  lookupId,
  type AfasLookup,
  type LookupTables,
} from "@/lib/afas-lookup";
import {
  fieldsOf,
  objectPath,
  objectsOf,
  type AfasSchemaField,
  type AfasSchemaObject,
  type AfasUpdateSchema,
  type FieldValueResolver,
} from "@/lib/afas-schema";

/** A value that can stand in an AFAS body. */
export type FixedValue = string | number | boolean;

/** Where one field's value comes from. */
export type FieldSource =
  | {
      kind: "column";
      /** Index into `ParsedSheet.headers`, and into every row. */
      index: number;
      /** The header it carried when it was mapped — how a re-read file re-points. */
      header: string;
      /**
       * This column is part of the **group key**: rows whose key columns all carry
       * the same values are one AFAS record, not one each. See *Grouping* below.
       *
       * Only a column can be one — a fixed value is the same on every row, so it
       * would put every row in one group and identify nothing. The type says so
       * rather than the UI having to.
       */
      key?: true;
      /**
       * A translation from a raw cell value to what AFAS actually receives instead
       * — keyed by the trimmed cell text, exact match. The sheet carries the
       * client's own codes (a Hulptabel, a legacy system's own list) and AFAS's
       * field regularly wants its own, differently spelled and not even in the same
       * order (`erp-voorcalculatie`'s *Type item*: `Wst`→`1`, `Art`→`2`, `Kst`→`6`,
       * `Sam`→`7` — see docs/todo.md item 6). A raw value with no entry here still
       * goes out as `afasValue()` would send it unmapped: visibly wrong once AFAS
       * refuses it, rather than silently guessed at.
       */
      valueMap?: Record<string, FixedValue>;
      /**
       * The cell is **looked up** in a GetConnector of the environment the payload
       * is sent to, and that row's value goes into the body instead
       * ([`afas-lookup.ts`](./afas-lookup.ts)) — `erp-abonnementen`'s `BcId`/`DbId`,
       * the relation and debiteur behind the project in the cell. Exclusive with `valueMap`:
       * both are the translation of the cell, and a field takes one.
       */
      lookup?: AfasLookup;
      /**
       * A factor the cell's number is multiplied by before it is sent — the sheet's
       * unit is not always AFAS's (`hrm-verlofsaldo`'s `HhMm`: hours in the sheet,
       * minutes in AFAS, so `60`). Only on an `int`/`decimal` field, and exclusive
       * with `valueMap` and `lookup`: those replace the cell, this scales it. See
       * {@link scaledValue}.
       */
      multiply?: number;
      /**
       * Another column read **when this one's cell is empty** — `hrm-medewerkers`'
       * *E-mail privé* falls back to *E-mail werk*, since `EmAd` sends digital
       * documents to the private address and an employee with only a work address
       * would otherwise get none. Only when the own cell is blank: a filled cell
       * always wins. Whatever else the source does (`valueMap`, `lookup`,
       * `multiply`) applies to the cell that was read, whichever column it was.
       */
      fallback?: { index: number; header: string };
    }
  | { kind: "fixed"; value: FixedValue };

/** A field that reads a column — the one kind of source that touches the sheet. */
type ColumnSource = Extract<FieldSource, { kind: "column" }>;

/** Every filled field of one connector, keyed by {@link fieldKey}. */
export type FieldMapping = Record<string, FieldSource>;

/** What the payload says about a fixed value, where a column names itself. */
export const FIXED_NOTE = "vaste waarde";

/**
 * The key one field is filled under: its object's path plus the field id, since a
 * field id is only unique within its object (`KnReactionAttachment#FileName` is not
 * `KnReaction#FileName`). `#` because AFAS uses neither it nor anything like it in a
 * name, so the two halves can always be told apart.
 */
export function fieldKey(path: string, fieldId: string): string {
  return `${path}#${fieldId}`;
}

/**
 * The same mapping against another sheet — a re-read of the template, or another
 * worksheet in the same workbook.
 *
 * A column keeps its field when the header is still where it was, follows it when it
 * moved, and is **dropped when the column is gone**: a mapping pointing at a column
 * that no longer exists would quietly write the wrong value into AFAS, which is
 * worse than having to map it again. Fixed values belong to no sheet and are kept
 * whatever the file does.
 *
 * "Still the same header" is judged case-insensitively (`lib/headers.ts`). A client
 * who re-exported with *Org. Eenheid* where the mapping says *Org. eenheid* renamed
 * nothing — and treating that as a vanished column would silently drop the field
 * from the payload, which is the one outcome this function exists to prevent.
 */
export function remapToSheet(mapping: FieldMapping, headers: string[]): FieldMapping {
  const remapped: FieldMapping = {};
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind === "fixed") {
      remapped[key] = source;
      continue;
    }
    const column = remapColumn(source, headers);
    if (!column) continue;
    // A fallback column that is gone only loses the fallback: the field's own
    // column is still there, and an empty cell then omits the field as it would
    // without one.
    const { fallback, ...rest } = source;
    const fallbackColumn = fallback ? remapColumn(fallback, headers) : null;
    remapped[key] = { ...rest, ...column, ...(fallbackColumn ? { fallback: fallbackColumn } : {}) };
  }
  return remapped;
}

/** Where one mapped column is in `headers` — see {@link remapToSheet} — or `null`. */
function remapColumn(
  column: { index: number; header: string },
  headers: string[]
): { index: number; header: string } | null {
  const atIndex = headers[column.index];
  if (atIndex !== undefined && normalizeHeader(atIndex) === normalizeHeader(column.header)) {
    // Kept with the sheet's own spelling, so everything downstream reports the
    // column the way the client's file actually names it.
    return { index: column.index, header: atIndex };
  }
  const moved = headerIndex(headers, column.header);
  return moved === -1 ? null : { index: moved, header: headers[moved] ?? column.header };
}

/**
 * The cell a column source reads in `row`, and the header to name it by: its own
 * column's, or — when that is blank — its `fallback` column's, named as such so the
 * payload view says the value is borrowed.
 */
function sourceCell(
  source: ColumnSource,
  row: ParsedSheet["rows"][number]
): { text: string; header: string } {
  const text = cellToString(row[source.index] ?? null);
  if (text.trim() !== "" || !source.fallback) return { text, header: source.header };
  const borrowed = cellToString(row[source.fallback.index] ?? null);
  return borrowed.trim() === ""
    ? { text, header: source.header }
    : { text: borrowed, header: `${source.fallback.header} (${source.header} leeg)` };
}

/**
 * The distinct values a column's cells actually carry, trimmed, in the order they
 * first appear — the raw side of a translation table (`FieldSource.valueMap`).
 *
 * A blank cell never counts: it is omitted from the payload regardless of any value
 * map (`fieldValues()` below), so there is nothing there worth offering a
 * translation for.
 */
export function distinctColumnValues(sheet: ParsedSheet, index: number): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of sheet.rows) {
    const text = cellToString(row[index] ?? null).trim();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }
  return values;
}

/**
 * The mapping read the other way round: which fields each column feeds, by column
 * index, with the field codes in the order they were mapped.
 *
 * The column list needs this and the field rows need the forward direction — same
 * mapping, two readings, and the `#` in a key is only ever taken apart here.
 */
export function columnFields(mapping: FieldMapping): Map<number, string[]> {
  const byColumn = new Map<number, string[]>();
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind !== "column") continue;
    const fieldId = key.slice(key.indexOf("#") + 1);
    byColumn.set(source.index, [...(byColumn.get(source.index) ?? []), fieldId]);
  }
  return byColumn;
}

/** How many fields each kind of source fills — the two figures above the tree. */
export function sourceCounts(mapping: FieldMapping): { columns: number; fixed: number } {
  const sources = Object.values(mapping);
  return {
    columns: sources.filter((source) => source.kind === "column").length,
    fixed: sources.filter((source) => source.kind === "fixed").length,
  };
}

// --- Grouping: several rows, one record ---------------------------------------
// Every mapping above this line reads **one row into one record**. Voorcalculatie
// doesn't fit that: one offerte carries several regels, and the sheet states it flat
// — `Projectnummer`, `Offerte`, `Begindatum Offerte` and `Einddatum Offerte` repeat
// identically on every row of one offerte, and only the regel columns differ. Three
// rows are one `KnQuotation` with three `KnQuotationLine`s, not three quotations.
//
// So a mapping has to be able to say **which columns identify the record**. That is
// the one thing added: `key: true` on a column source. Everything else is derived
// from it, because everything else already follows from the schema:
//
//   the key's own object   the **kop** — one value per group, read from its first row
//   the object below it    the **regel** — one element per row of the group
//
// `groupShape()` reads those two paths straight off the mapping, so there is no
// second control to keep in step with the first and no way to mark a key without the
// page being able to say what it made of it. A mapping with no key at all yields
// `null` and every caller falls back to one-row-one-record, which is what the other
// twelve modules are.
//
// AFAS's own form for the repeated half is `"Element": [ {…}, {…} ]` — an array of
// Elements under the sub-object, exactly as `FbSales` → `FbSalesLines` does it in
// docs/AFAS-Profit-API-Referentie.md §3.2 and §6.3. Rendering that is
// `afas-schema.ts`'s job (`PayloadRepeat`); deciding *what* repeats is this file's.

/** One column the group key is made of. */
export interface GroupKeyColumn {
  /** The field it was marked on — `KnQuotation#PrId`. */
  fieldKey: string;
  index: number;
  header: string;
}

/**
 * What the group key makes of this mapping: which columns identify a record, which
 * object is the kop and which is the repeating regel. `null` when no column is
 * marked — there is no grouping, and a row is a record as before.
 *
 * `linePath` is separately nullable: a key with nothing mapped below it is a mapping
 * that groups rows and then has nothing to repeat, which is a state worth showing
 * rather than silently treating as ungrouped.
 */
export interface GroupShape {
  /** The object the key fields live in — one record per group. */
  headerPath: string;
  /** The object one element per row is written to, if there is one. */
  linePath: string | null;
  /** The key's columns, left to right as the sheet has them. */
  keyColumns: GroupKeyColumn[];
}

/** The object path half of a `path#field` mapping key. */
function pathOf(key: string): string {
  return key.slice(0, key.indexOf("#"));
}

/**
 * The grouping this mapping describes, or `null` for an ungrouped one.
 *
 * Both paths are read off the **mapping**, not the schema: a mapping key already
 * carries its object's path, so the shape is derivable without walking the tree, and
 * a filtered schema on screen can't change the answer.
 *
 * - `headerPath` — the shallowest object any key field sits in. Normally they all
 *   share one (the four Voorcalculatie key columns are all `KnQuotation`); the
 *   shallowest wins if they don't, since a key deeper than the record it identifies
 *   is the mapping being wrong rather than something to honour.
 * - `linePath` — the shallowest object *strictly below* the kop that has a column of
 *   its own. Deeper objects than that ride along inside each regel, which is right:
 *   one row is one regel, so one row can carry at most one of whatever hangs under it.
 */
export function groupShape(mapping: FieldMapping): GroupShape | null {
  const keyColumns: GroupKeyColumn[] = [];
  const keyPaths: string[] = [];
  const columnPaths = new Set<string>();

  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind !== "column") continue;
    columnPaths.add(pathOf(key));
    if (!source.key) continue;
    keyColumns.push({ fieldKey: key, index: source.index, header: source.header });
    keyPaths.push(pathOf(key));
  }
  if (keyColumns.length === 0) return null;

  const headerPath = keyPaths.reduce((a, b) => (b.length < a.length ? b : a));
  const below = [...columnPaths]
    .filter((path) => path.startsWith(`${headerPath}.`))
    .sort((a, b) => a.length - b.length);

  return {
    headerPath,
    linePath: below[0] ?? null,
    // Left to right, so the key reads the way the sheet does rather than the order
    // the fields happened to be mapped in. Two fields fed by one column are one key
    // part, not two — the key is made of columns.
    keyColumns: keyColumns
      .filter(
        (column, index) => keyColumns.findIndex((c) => c.index === column.index) === index
      )
      .sort((a, b) => a.index - b.index),
  };
}

/** The rows that make up one record, and the key values that made them one. */
export interface RowGroup {
  /** The key's cell values, in `keyColumns` order. */
  values: string[];
  /** Indexes into `ParsedSheet.rows`, in sheet order. */
  rows: number[];
}

/**
 * The sheet's rows gathered into records. One entry per distinct key, in the order
 * the keys first appear, each holding the rows that carry that key.
 *
 * Values are compared **trimmed but case- and text-exact**: `VC001` and `vc001`
 * become two groups rather than one. That is the safer way round — the group count is
 * on screen, so two groups where one was meant is visible, where silently merging two
 * different offertes would not be. Blank rows never reach this: `parseExcelFile()`
 * has already dropped them, so there is no phantom empty-key group.
 */
export function groupRows(keyColumns: GroupKeyColumn[], sheet: ParsedSheet): RowGroup[] {
  const groups: RowGroup[] = [];
  const byKey = new Map<string, RowGroup>();
  sheet.rows.forEach((row, index) => {
    const values = keyColumns.map((column) => cellToString(row[column.index] ?? null).trim());
    // A NUL separator cannot occur in a cell, so it can't be mistaken for part of
    // a value the way any printable separator could. Written as the escape, never
    // as a literal byte: a stray control character makes the whole file read as
    // binary to git and grep (docs/todo.md).
    const identity = values.join("\u0000");
    const existing = byKey.get(identity);
    if (existing) {
      existing.rows.push(index);
      return;
    }
    const group: RowGroup = { values, rows: [index] };
    byKey.set(identity, group);
    groups.push(group);
  });
  return groups;
}

/** The group a given row belongs to — the one the payload preview shows. */
export function groupOfRow(groups: RowGroup[], rowIndex: number): RowGroup | null {
  return groups.find((group) => group.rows.includes(rowIndex)) ?? null;
}

/**
 * A kop column whose value is not the same on every row of its group — the error
 * grouping makes possible to catch.
 *
 * A column mapped into the kop but *not* marked as key still has to agree across the
 * group: it describes the one record those rows collapse into, so two rows disagreeing
 * on it means the payload would silently take the first and drop the other. A key
 * column can't disagree by construction (a different value is a different group),
 * which is the whole reason to mark identity columns as key and leave the rest as
 * ordinary kop fields — the difference decides whether a typo splits a record or is
 * reported.
 */
export interface GroupDisagreement {
  header: string;
  /** The value the payload would use — the group's first row. */
  used: string;
  /** The other values found, and the 1-based Excel rows they sit on. */
  others: { value: string; rowNumber: number }[];
}

export function groupDisagreements(
  mapping: FieldMapping,
  shape: GroupShape,
  sheet: ParsedSheet,
  group: RowGroup
): GroupDisagreement[] {
  const keyIndexes = new Set(shape.keyColumns.map((column) => column.index));
  const kopColumns = Object.entries(mapping)
    .flatMap(([key, source]) =>
      source.kind === "column" &&
      !source.key &&
      pathOf(key) === shape.headerPath &&
      !keyIndexes.has(source.index)
        ? [{ index: source.index, header: source.header }]
        : []
    )
    .filter((column, i, all) => all.findIndex((c) => c.index === column.index) === i)
    .sort((a, b) => a.index - b.index);

  const [first, ...rest] = group.rows;
  if (first === undefined) return [];

  return kopColumns.flatMap((column) => {
    const used = cellToString(sheet.rows[first]?.[column.index] ?? null).trim();
    const others = rest
      .map((rowIndex) => ({
        value: cellToString(sheet.rows[rowIndex]?.[column.index] ?? null).trim(),
        rowNumber: sheet.rowNumbers[rowIndex] ?? rowIndex + 1,
      }))
      .filter((other) => other.value !== used);
    return others.length > 0 ? [{ header: column.header, used, others }] : [];
  });
}

/**
 * The notations a date cell can carry: the two every rule set accepts
 * (`DD-MM-YYYY | DD/MM/YYYY`), the ISO one a client may have typed anyway, and each of
 * those with a time behind it — which is what the cell holds when Excel read it as a
 * moment rather than a day (`formatCellDate()` in [`excel.ts`](./excel.ts)).
 *
 * Only these. An ambiguous `01-02-26` is left alone rather than guessed into a year:
 * the sheet's own `date` check already reports it, and a wrong date that parses is
 * worse than a visible one that doesn't.
 */
const CELL_DATE_FORMATS = [
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD-MM-YYYY HH:mm",
  "DD-MM-YYYY HH:mm:ss",
  "DD/MM/YYYY HH:mm",
  "DD/MM/YYYY HH:mm:ss",
  "YYYY-MM-DDTHH:mm:ss",
].join("|");

/**
 * A sheet's date as AFAS takes it: `23-08-2026` becomes `2026-08-23`. Confirmed
 * against `KnSalesRelationOrg#CsDa` in the test environment (23-08-2026) — the
 * referentie states no format, and every example in it is ISO.
 *
 * A cell that carries a time keeps it, as `2026-08-23T08:00:00`: the form the
 * referentie's own examples use, and dropping it would throw away what the client
 * typed. Midnight is not a time — a date cell Excel parsed reads `00:00:00` — so a
 * plain day stays a plain day.
 *
 * Null when the text is no date this tool accepts, which leaves the caller to pass it
 * through unchanged. The parsing is the validation engine's own `toDate()` rather than
 * a second date parser beside it: that one already refuses a day that doesn't exist
 * (31-02) and is what the column's `date` check answers with, so the mapping and the
 * check can't drift apart on what a date is.
 */
export function afasDate(text: string): string | null {
  const ts = toDate(text.trim(), CELL_DATE_FORMATS);
  if (ts === null) return null;
  // `toDate` builds the timestamp with `Date.UTC`, so the UTC parts read back exactly
  // what the cell said — a local getter would shift the day west of Greenwich.
  const iso = new Date(ts).toISOString();
  const [day, time] = [iso.slice(0, 10), iso.slice(11, 19)];
  return time === "00:00:00" ? day : `${day}T${time}`;
}

/**
 * A cell as the field wants it. AFAS types its fields, and a numeric field handed
 * the string `"1234"` is a different body from one handed `1234` — so the text the
 * sheet carries is converted **per the field's own `dataType`**, and only where that
 * is unambiguous: a number that doesn't parse stays the text it was, which is a
 * finding to see in the preview rather than a `0` that hides it. A **date** goes the
 * same way — the sheet's `23-08-2026` is not a notation AFAS reads, so it becomes
 * `2026-08-23` ({@link afasDate}) or stays the text it was.
 *
 * This is the *sheet's* half — the cells are whatever the client typed, so nothing
 * here refuses a value. A **fixed** value goes through `parseFixedValue()` instead,
 * which does refuse: it is being typed now, by someone who can fix it now.
 */
export function afasValue(field: AfasSchemaField, text: string): FixedValue {
  const type = field.dataType.toLowerCase();
  if (type.startsWith("date")) return afasDate(text) ?? text;
  if (type === "int" || type === "decimal") {
    const number = Number(text.replace(",", "."));
    return text.trim() !== "" && Number.isFinite(number) ? number : text;
  }
  if (type === "boolean" || type === "bool") {
    const yes = ["true", "ja", "j", "1", "waar"].includes(text.trim().toLowerCase());
    const no = ["false", "nee", "n", "0", "onwaar"].includes(text.trim().toLowerCase());
    return yes ? true : no ? false : text;
  }
  return text;
}

/** Which control a fixed value for this field is typed in. */
export type FixedInputKind = "select" | "boolean" | "date" | "number" | "text";

/**
 * The narrowest control the field's own metainfo allows. A field with `values` is a
 * list and gets a list — that is a constraint AFAS states, so the input should make
 * it impossible to break rather than report it afterwards.
 */
export function fixedInputKind(field: AfasSchemaField): FixedInputKind {
  if ((field.values ?? []).length > 0) return "select";
  const type = field.dataType.toLowerCase();
  if (type === "boolean" || type === "bool") return "boolean";
  if (type.startsWith("date")) return "date";
  if (type === "int" || type === "decimal") return "number";
  return "text";
}

/** A fixed value that was accepted, or the reason it wasn't. */
export type FixedValueResult =
  | { ok: true; value: FixedValue }
  | { ok: false; message: string };

/**
 * Read what was typed as a value of **this field's type**, or say why it isn't one.
 *
 * Everything it checks, AFAS states in the connector's own metainfo: the type, the
 * length, the number of decimals, `notzero`, and the list of allowed values. So the
 * refusals here are the ones AFAS would give, minutes earlier and next to the field.
 */
export function parseFixedValue(field: AfasSchemaField, input: string): FixedValueResult {
  const text = input.trim();
  const allowed = field.values ?? [];
  if (text === "") {
    // Worded after the control it was typed in: two checkboxes, a list, or a box.
    const kind = fixedInputKind(field);
    return {
      ok: false,
      message:
        kind === "boolean"
          ? "Vink true of false aan."
          : kind === "select"
            ? "Kies een waarde uit de lijst."
            : "Vul een waarde in.",
    };
  }
  if (allowed.length > 0) {
    return allowed.some((value) => value.id === text)
      ? { ok: true, value: text }
      : { ok: false, message: `Niet toegestaan. Kies een waarde uit de lijst.` };
  }

  const type = field.dataType.toLowerCase();

  if (type === "boolean" || type === "bool") {
    if (text === "true") return { ok: true, value: true };
    if (text === "false") return { ok: true, value: false };
    return { ok: false, message: "Vink true of false aan." };
  }

  if (type === "int") {
    if (!/^-?\d+$/.test(text)) return { ok: false, message: "Alleen een heel getal." };
    const value = Number(text);
    if (field.notzero && value === 0) return { ok: false, message: "Mag niet 0 zijn." };
    const digits = text.replace("-", "").length;
    if (field.length > 0 && digits > field.length) {
      return { ok: false, message: `Maximaal ${field.length} cijfers.` };
    }
    return { ok: true, value };
  }

  if (type === "decimal") {
    if (!/^-?\d+([.,]\d+)?$/.test(text)) {
      return { ok: false, message: "Alleen een getal, met punt of komma." };
    }
    const [, decimals = ""] = text.replace(",", ".").split(".");
    if (decimals.length > field.decimals) {
      return {
        ok: false,
        message: field.decimals === 0
          ? "Dit veld heeft geen decimalen."
          : `Maximaal ${field.decimals} decimalen.`,
      };
    }
    const value = Number(text.replace(",", "."));
    if (field.notzero && value === 0) return { ok: false, message: "Mag niet 0 zijn." };
    return { ok: true, value };
  }

  if (type.startsWith("date")) {
    // What `<input type="date">` hands over. AFAS reads and writes a date as
    // `yyyy-mm-ddThh:mm:ss`, so the time is added rather than left to AFAS to guess.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { ok: false, message: "Gebruik een datum (jjjj-mm-dd)." };
    }
    return { ok: true, value: `${text}T00:00:00` };
  }

  // string, blob, and anything AFAS adds later.
  if (field.length > 0 && text.length > field.length) {
    return { ok: false, message: `Maximaal ${field.length} tekens.` };
  }
  return { ok: true, value: text };
}

/** A fixed value back in the box it is edited in — the inverse of the parse above. */
export function fixedValueInput(field: AfasSchemaField, value: FixedValue): string {
  const text = String(value);
  // A date is stored with the time AFAS wants; the date input only takes the day.
  return fixedInputKind(field) === "date" ? text.slice(0, 10) : text;
}

/**
 * The resolver the payload view fills a body with: the fixed values, plus one row of
 * the sheet read through the mapping. It has three answers, and they are three
 * different things:
 *
 * - **`undefined`** — this field isn't mapped. It keeps its placeholder, so the body
 *   always shows the whole shape and what is filled stands out in it.
 * - **`{ omit: true }`** — mapped, and this row's cell is empty. The field is left out
 *   of `Fields` altogether; see the note at the call site for why `""` won't do.
 * - **a value** — mapped and filled, converted to the field's own type.
 *
 * Every resolved value carries **where it came from** as its note — the column's
 * header, or *vaste waarde*. A value alone doesn't say whether it landed in the
 * field you meant.
 *
 * `sheet` may be null — a stored mapping is read back long before a template is
 * dropped beside it — and a column with no sheet behind it still **resolves**: to
 * `null`, with its header in the note. Leaving it unresolved would hand the field
 * back its type placeholder, and a mapped field that reads `""` like every unmapped
 * one around it is the mapping saying it isn't there. `null` is a value nothing
 * mistakes for data, and it keeps the document valid JSON.
 */
export function fieldValues(
  mapping: FieldMapping,
  sheet: ParsedSheet | null,
  rowIndex: number,
  /**
   * The AFAS tables a looked-up field reads (`FieldSource.lookup`), loaded from the
   * environment being sent to. Absent in the mapping editor, which has no stage:
   * there a looked-up field resolves to `null` with a note saying where its value
   * will come from.
   */
  lookups: LookupTables = NO_LOOKUPS
): FieldValueResolver {
  const row = sheet?.rows[rowIndex] ?? [];
  return (path, field) => {
    const source = mapping[fieldKey(path, field.fieldId)];
    if (!source) return undefined;
    if (source.kind === "fixed") return { value: source.value, note: FIXED_NOTE };
    // The note says *why* it is null, since an empty cell in an open sheet and no
    // sheet at all are two different findings.
    if (!sheet) return { value: null, note: `${source.header} — geen bestand` };
    const { text, header } = sourceCell(source, row);
    // An empty cell leaves the field out of the body rather than sending `""`. On a
    // PUT those are two different instructions — an empty value *clears* the field
    // (referentie §4) — and a conversion never means the second.
    const trimmed = text.trim();
    if (trimmed === "") return { omit: true, note: `${header} — leeg` };
    // Looked up rather than read: the cell only says *which* AFAS row to take the
    // value from. No answer is `null`, never the raw cell — see `afas-lookup.ts` for
    // why passing a debiteurnummer through as a relation number is the one thing
    // this must not do — and `lookupProblem()` keeps that record out of the send.
    if (source.lookup) {
      const answer = resolveLookup(lookups, source.lookup, trimmed);
      return answer.ok
        ? {
            value: afasValue(field, answer.value),
            note: `${header} "${trimmed}" → ${source.lookup.valueField} uit ${source.lookup.connector}`,
          }
        : { value: null, note: `${header} — ${answer.reason}` };
    }
    // A translated value already *is* the value AFAS wants — chosen by whoever
    // built the mapping, the same way a fixed value is — so it skips `afasValue()`
    // rather than being coerced a second time.
    const translated = source.valueMap ? lookupValueMap(source.valueMap, trimmed) : undefined;
    if (translated !== undefined) {
      return { value: translated, note: `${header} — "${trimmed}" vertaald` };
    }
    if (source.multiply !== undefined) {
      const scaled = scaledValue(field, trimmed, source.multiply);
      if (scaled !== null) {
        return { value: scaled, note: `${header} × ${source.multiply}` };
      }
    }
    return { value: afasValue(field, text), note: header };
  };
}

/**
 * The cell's number times `factor`, as the AFAS field takes it — or `null` when the
 * cell isn't a number, which then goes out unscaled for AFAS (and the rule set) to
 * refuse rather than be guessed at.
 *
 * Rounded, because a product of two decimals carries float noise (`37.1 × 60` is
 * `2225.9999…`): to a whole number for an `int` field, which AFAS refuses a
 * fraction for, and to six decimals otherwise.
 */
export function scaledValue(
  field: AfasSchemaField,
  text: string,
  factor: number
): number | null {
  const number = Number(text.replace(",", "."));
  if (!Number.isFinite(number)) return null;
  const product = number * factor;
  return field.dataType.toLowerCase() === "int"
    ? Math.round(product)
    : Math.round(product * 1e6) / 1e6;
}

/** Whether a field can carry a factor: AFAS stores it as a number. */
export function canMultiply(field: AfasSchemaField): boolean {
  const type = field.dataType.toLowerCase();
  return type === "int" || type === "decimal";
}

/**
 * A cell's entry in a translation table: the exact key first, then one that differs
 * only in casing. Case-insensitive for the same reason the `enum` check is — the
 * tables translate short code lists (`Wst`/`Art`/`Kst`/`Sam`) where casing carries
 * no meaning, and a sheet that says `WST` against a map keyed `Wst` otherwise sends
 * the raw code, which AFAS refuses ("De ingevulde waarde bij 'Type item' bestaat
 * niet"). An exact key still wins, so a map that does tell `a` from `A` keeps both.
 */
export function lookupValueMap(
  valueMap: Record<string, FixedValue>,
  text: string
): FixedValue | undefined {
  if (Object.prototype.hasOwnProperty.call(valueMap, text)) return valueMap[text];
  const lower = text.toLowerCase();
  const key = Object.keys(valueMap).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : valueMap[key];
}

/**
 * Why this row can't be sent as it stands because of a lookup — the first looked-up
 * field whose cell has no answer in its table — or `null` when every lookup of the
 * row resolved (or the row leaves them blank, which omits the field as any blank
 * cell does).
 *
 * Asked of the mapping directly rather than read back out of the rendered body: the
 * body's `null` could equally be a column with no sheet behind it, and a send must
 * not be blocked on a guess about which one it was.
 */
export function lookupProblem(
  mapping: FieldMapping,
  sheet: ParsedSheet,
  rowIndex: number,
  lookups: LookupTables
): string | null {
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind !== "column" || !source.lookup) continue;
    const cell = sourceCell(source, sheet.rows[rowIndex] ?? []).text.trim();
    if (cell === "") continue;
    const answer = resolveLookup(lookups, source.lookup, cell);
    if (answer.ok) continue;
    // A lookup with a `noun` already says what is missing ("Project … bestaat
    // niet"); the field id in front would only repeat it in AFAS's terms.
    return source.lookup.noun
      ? answer.reason
      : `${key.slice(key.indexOf("#") + 1)}: ${answer.reason}`;
  }
  return null;
}

/** Every distinct AFAS lookup a mapping declares — what the payload view loads. */
export function mappingLookups(mapping: FieldMapping): AfasLookup[] {
  const byId = new Map<string, AfasLookup>();
  for (const source of Object.values(mapping)) {
    if (source.kind === "column" && source.lookup) {
      byId.set(lookupId(source.lookup), source.lookup);
    }
  }
  return [...byId.values()];
}

/** One filled field, as the exported mapping states it. */
export interface MappedField {
  /** The object it lives in, root first: `["AfasEmployee", "KnPerson"]`. */
  object: string[];
  /** The AFAS field code — what ends up in `Fields`. */
  field: string;
  /** Its Dutch label, so the mapping can be read without the schema beside it. */
  label: string;
  mandatory: boolean;
  source: FieldSource["kind"];
  /** The sheet column its value comes from — `source: "column"` only. */
  column?: string;
  columnIndex?: number;
  /**
   * This column is part of the group key — `source: "column"` only, and left out
   * entirely when it isn't one, so a mapping that doesn't group reads exactly as it
   * did before the concept existed. See *Grouping* above.
   */
  key?: true;
  /** The column's translation table — `source: "column"` only. See `FieldSource.valueMap`. */
  valueMap?: Record<string, FixedValue>;
  /** Where the value is looked up in AFAS — `source: "column"` only. See `FieldSource.lookup`. */
  lookup?: AfasLookup;
  /** The factor the cell is multiplied by — `source: "column"` only. See `FieldSource.multiply`. */
  multiply?: number;
  /** The column read when this one's cell is empty — `source: "column"` only. See `FieldSource.fallback`. */
  fallback?: { column: string; columnIndex: number };
  /** The value it always carries — `source: "fixed"` only. */
  value?: FixedValue;
}

/** A whole mapping, ready to be read, copied or (later) stored per module. */
export interface MappingExport {
  connector: string;
  /** The root key of the body — `KnSubjectReaction` → `KnReaction`. */
  root: string;
  file: string;
  sheet: string;
  fields: MappedField[];
}

/** Every filled field of an object and its children, in the schema's own order. */
function collectMapped(
  object: AfasSchemaObject,
  path: string,
  trail: string[],
  mapping: FieldMapping
): MappedField[] {
  const own: MappedField[] = fieldsOf(object).flatMap((field) => {
    const source = mapping[fieldKey(path, field.fieldId)];
    if (!source) return [];
    const common = {
      object: trail,
      field: field.fieldId,
      label: field.label,
      mandatory: field.mandatory,
    };
    return [
      source.kind === "column"
        ? {
            ...common,
            source: source.kind,
            column: source.header,
            columnIndex: source.index,
            // Spread so the key is absent rather than `false` on the fields that
            // aren't part of it — the document is read in a diff.
            ...(source.key ? { key: source.key } : {}),
            ...(source.valueMap ? { valueMap: source.valueMap } : {}),
            ...(source.lookup ? { lookup: source.lookup } : {}),
            ...(source.multiply !== undefined ? { multiply: source.multiply } : {}),
            ...(source.fallback
              ? { fallback: { column: source.fallback.header, columnIndex: source.fallback.index } }
              : {}),
          }
        : { ...common, source: source.kind, value: source.value },
    ];
  });
  return objectsOf(object).reduce(
    (all, child) =>
      all.concat(
        collectMapped(child, objectPath(path, child.name), [...trail, child.name], mapping)
      ),
    own
  );
}

/**
 * The mapping as a document: which connector, which file, and every filled field
 * with the column or the constant behind it — **in schema order**, not in the order
 * they happened to be dragged, so two mappings of the same connector can be read
 * side by side.
 */
export function buildMappingExport(
  schema: AfasUpdateSchema,
  mapping: FieldMapping,
  file: string,
  sheet: string
): MappingExport {
  return {
    connector: schema.id,
    root: schema.name,
    file,
    sheet,
    fields: collectMapped(schema, schema.name, [schema.name], mapping),
  };
}

/**
 * The document read back as a mapping — the inverse of `buildMappingExport()`, and
 * what makes the stored form the *only* form: the object trail plus the field code
 * rebuild the key the page maps under, so nothing else has to be kept beside it.
 *
 * An entry this app doesn't understand is skipped rather than fatal. The backend
 * refuses those on the way in, so one here means a document from somewhere else, and
 * losing that field is better than losing the mapping around it.
 */
export function fromMappingExport(document: MappingExport): FieldMapping {
  const mapping: FieldMapping = {};
  for (const entry of document.fields) {
    const key = fieldKey(entry.object.join("."), entry.field);
    if (entry.source === "column" && entry.column !== undefined && entry.columnIndex !== undefined) {
      mapping[key] = {
        kind: "column",
        index: entry.columnIndex,
        header: entry.column,
        ...(entry.key ? { key: entry.key } : {}),
        ...(entry.valueMap ? { valueMap: entry.valueMap } : {}),
        ...(entry.lookup ? { lookup: entry.lookup } : {}),
        ...(typeof entry.multiply === "number" ? { multiply: entry.multiply } : {}),
        ...(entry.fallback
          ? { fallback: { index: entry.fallback.columnIndex, header: entry.fallback.column } }
          : {}),
      };
    } else if (entry.source === "fixed" && entry.value !== undefined) {
      mapping[key] = { kind: "fixed", value: entry.value };
    }
  }
  return mapping;
}

// --- The store ----------------------------------------------------------------
// A mapping outlives the tab it was made in: the backend keeps one file per group,
// under `json_files/mappings/<group>/<key>.json` (docs/afas-integration.md#field-mapping),
// stamped with who saved it and when. Admin-only on both sides.
//
// The key differs by group: `nymbus` files are named after the connector, `modules`
// ones after the **module** id — because a connector can serve more than one module
// (`KnEmployee` maps both `hrm-medewerkers` and `hrm-uitzendkrachten`). The page
// follows that split rather than flattening it: a `modules` mapping is opened, saved
// and deleted **by module** ({@link moduleMappingKey}), so two modules sharing a
// connector are two editable mappings, as they are two files. `connectorModules`
// below answers "which modules does this connector serve", for the rail to label its
// rows by module rather than by raw connector id.

/** A mapping as it comes back from the store. */
export interface StoredMapping extends MappingExport {
  /** Which category of connectors it belongs to — `nymbus`, `modules` or `clients`. */
  group: string;
  /** `modules` and `clients`: the app module id this file is keyed by, e.g. `hrm-medewerkers`. */
  module?: string;
  /** `clients` only: which project's own copy this is. */
  projectId?: string;
  /** When the **server** stamped it — never a browser clock. */
  savedAt: string;
  savedBy: string;
  savedByName?: string;
}

/**
 * How a stored mapping is addressed, here and in the page's own state: **group and
 * connector**, because the two groups are two AFAS environments and the same
 * connector name in each is a different schema.
 */
export function mappingKey(group: string, connector: string): string {
  return `${group}/${connector}`;
}

/**
 * How a **modules**-group mapping is addressed: by the mapping id that names its
 * file, never by connector.
 *
 * `mappingKey()` above is right for `nymbus`, where a connector is the whole
 * address. It is wrong for `modules`, where one connector serves more than one
 * module — `KnPurchaseRelationOrg` is both *Crediteuren (Organisatie)* and
 * *Contactpersonen (Crediteur)* — so a `group`+`connector` key collapses the two
 * onto one entry: whichever loads last wins, the page edits a document it didn't
 * open, and a save writes `modules/KnPurchaseRelationOrg.json`, a file beside the
 * two real ones that nothing reads back.
 *
 * Same `group/…` shape, so the two never collide in one map: a mapping id always
 * carries a category prefix and a hyphen (`erp-crediteuren-organisatie`) where a
 * connector is CamelCase with neither.
 */
export function moduleMappingKey(mappingId: string): string {
  return `modules/${mappingId}`;
}

/** The path of one stored mapping — the same two parts, as the API spells them. */
function mappingPath(group: string, connector: string): string {
  return `/api/afas/mappings/${encodeURIComponent(group)}/${encodeURIComponent(connector)}`;
}

/**
 * How a client's own copy is addressed: **project and module**, never connector —
 * two flagged modules of the same project can share one connector
 * (`KnEmployee` again), the same reason `modules` is keyed by module rather than
 * connector. Kept apart from {@link mappingKey} rather than reusing it: a
 * `group`+`connector` key for a `clients` row would collide the moment a project
 * flags two modules on one connector, which is exactly VBKRO's own case.
 */
export function clientMappingKey(projectId: string, moduleId: string): string {
  return `${projectId}::${moduleId}`;
}

/**
 * Every stored mapping, keyed the way its own group is stored: `nymbus` rows under
 * {@link mappingKey}, `modules` rows under {@link moduleMappingKey} — alongside,
 * separately, which module ids each `modules`-group connector serves.
 *
 * `byKey` holds one entry **per file**, so `KnEmployee`'s two (`hrm-medewerkers`,
 * `hrm-uitzendkrachten`) are two entries rather than one. They are two mappings on
 * disk and two rows in the rail, and collapsing them onto the connector they share
 * meant the page opened whichever loaded last under both names and saved to
 * neither. `connectorModules` stays what it was: which modules a connector serves,
 * for the rail to label its rows by module.
 *
 * `clients` rows are excluded from `byKey` rather than folded in under a colliding
 * key, and kept in `clientMappings` instead, addressed by {@link clientMappingKey}.
 */
export interface StoredMappings {
  byKey: Record<string, StoredMapping>;
  connectorModules: Record<string, string[]>;
  clientMappings: Record<string, StoredMapping>;
  /**
   * The `modules` group keyed by the **file's own name** — the `module` the backend
   * reads off the path — rather than by connector.
   *
   * `byKey` can't answer for a split module: `erp-debiteuren-organisatie` and
   * `-persoon` are two files, two connectors and two mappings, and collapsing them
   * onto a connector key means neither can be addressed by the id that names it.
   * The payload view needs exactly that ([`module-payloads.ts`](./module-payloads.ts)
   * resolves a module to one or more `mappingId`s), so the index is built here where
   * the list is already being walked, rather than by a second fetch that would ask
   * the same endpoint the same question.
   */
  byModuleFile: Record<string, StoredMapping>;
}

/**
 * The last answer from `/api/afas/mappings`, and the request in flight.
 *
 * The endpoint returns **every** stored mapping — all nineteen module files, ~200 KB
 * — and `ModulePayloadPanel` asks for it on every mount. Since the panel is mounted
 * conditionally on the *Payloads* tab, that was a fresh 200 KB on each flip between
 * *Data* and *Payloads*.
 *
 * Unlike a schema, a mapping **does** change — an admin edits one in the mapping
 * editor — so this is invalidated by both write paths ({@link saveStoredMapping},
 * {@link deleteStoredMapping}) rather than left to a TTL. The panel's own `reload`
 * counter still re-keys the fetch after a save, and now finds a cache that has
 * already been dropped, so it re-reads rather than being served the stale set.
 */
let storedMappingsCache: StoredMappings | null = null;
let storedMappingsInflight: Promise<StoredMappings> | null = null;
/**
 * Bumped by every {@link forgetStoredMappings}. A request that was already on its
 * way when a save landed carries the list from *before* it, and must not become
 * the cache the next read is served from.
 */
let storedMappingsGeneration = 0;

/** Drop the cached mapping list so the next read re-fetches it. */
export function forgetStoredMappings(): void {
  storedMappingsGeneration += 1;
  storedMappingsCache = null;
  storedMappingsInflight = null;
}

export async function fetchStoredMappings(): Promise<StoredMappings> {
  if (storedMappingsCache) return storedMappingsCache;
  if (storedMappingsInflight) return storedMappingsInflight;
  const generation = storedMappingsGeneration;
  const request: Promise<StoredMappings> = loadStoredMappings()
    .then((result) => {
      if (generation === storedMappingsGeneration) storedMappingsCache = result;
      return result;
    })
    .finally(() => {
      if (storedMappingsInflight === request) storedMappingsInflight = null;
    });
  storedMappingsInflight = request;
  return request;
}

async function loadStoredMappings(): Promise<StoredMappings> {
  const data = await requestJson<{ mappings: StoredMapping[] }>(
    "/api/afas/mappings",
    undefined,
    "De opgeslagen koppelingen konden niet worden opgehaald."
  );
  const connectorModules: Record<string, string[]> = {};
  const clientMappings: Record<string, StoredMapping> = {};
  const byModuleFile: Record<string, StoredMapping> = {};
  for (const mapping of data.mappings) {
    if (mapping.group === "modules" && mapping.module) {
      (connectorModules[mapping.connector] ??= []).push(mapping.module);
      byModuleFile[mapping.module] = mapping;
    }
    if (mapping.group === "clients" && mapping.projectId && mapping.module) {
      clientMappings[clientMappingKey(mapping.projectId, mapping.module)] = mapping;
    }
  }
  return {
    byKey: Object.fromEntries(
      data.mappings
        .filter((mapping) => mapping.group !== "clients")
        .map((mapping) => [
          // `modules` is keyed by the file's own module id, `nymbus` by connector —
          // the same split the store itself makes. Keying `modules` by connector
          // would drop one of every pair sharing one (`KnEmployee`, `FiEntries`,
          // `KnSalesRelationOrg`, `KnPurchaseRelationOrg`): eight of the nineteen
          // files, silently, with the survivor shown under both their names.
          mapping.group === "modules" && mapping.module
            ? moduleMappingKey(mapping.module)
            : mappingKey(mapping.group, mapping.connector),
          mapping,
        ])
    ),
    connectorModules,
    clientMappings,
    byModuleFile,
  };
}

/** Store one connector's mapping, replacing whatever was there. */
export async function saveStoredMapping(
  group: string,
  connector: string,
  document: MappingExport
): Promise<StoredMapping> {
  const data = await requestJson<{ mapping: StoredMapping }>(
    mappingPath(group, connector),
    jsonBody("PUT", { mapping: document }),
    "De koppeling kon niet worden opgeslagen."
  );
  // The list this mapping belongs to is now stale — see `storedMappingsCache`.
  forgetStoredMappings();
  return data.mapping;
}

/** Forget one connector's mapping. Deleting one that isn't there is not an error. */
export async function deleteStoredMapping(group: string, connector: string): Promise<void> {
  await requestJson(
    mappingPath(group, connector),
    { method: "DELETE" },
    "De koppeling kon niet worden verwijderd."
  );
  forgetStoredMappings();
}
