# The payload view: spreadsheet rows to annotated AFAS bodies

This document explains how Nymbus Conversies' **Payloads** view is built and what it does,
so you can rebuild it in another app. It is written to be lifted out on its own: the
concepts come first, then a minimal reference implementation you can copy, then the UI,
then the send. The file paths at the end show where the real code lives in this repo.

---

## 1. What it is

The payload view shows, for each record in an uploaded spreadsheet, the exact JSON body
that would be POSTed (or PUT) to an AFAS UpdateConnector. Next to every value it shows
where that value came from:

```
{
  "KnSalesRelationOrg": {
    "Element": {
      "Fields": {
        "DbId": "13823",      ← Debiteur Nummer
        "IsDb": true,         ← vaste waarde
        "PaCd": "30",         ← Betalingsvoorwaarde
        ...
      },
      "Objects": [
        { "KnOrganisation": { "Element": { "Fields": { "Nm": "Fam Proes"  ← Organisatie Naam
```

It is a **preview and a send console in one**:

- **Left rail**: one row per record (a sheet row, or a group of rows). Each row has a
  checkbox, a title, badges and its Excel row number(s).
- **Right pane**: the selected record's body, with an annotation on each line.
- **Header**: the connector and variant, Test/Live, *Copy JSON*, *open mapping*, and
  **Verzenden N** (send the N ticked records).
- **After a send**: a progress and result banner, with a PDF report and an Excel export of
  the refused cells.

Two design rules shape everything else:

1. **The body on screen is the body that is sent.** The send parses the same lines the
   view renders. There is no second builder that could drift from the preview.
2. **The annotation is never part of the JSON.** Each line holds `{ text, note }`. Only
   `text` is copied or sent, and `note` is drawn beside it.

---

## 2. The three inputs

| Input | What it is | Where it comes from |
|---|---|---|
| **Sheet** | `{ headers: string[], rows: Cell[][], rowNumbers: number[] }`, the grid **as edited on screen** | the user's upload, after their corrections |
| **Schema** | the UpdateConnector's tree of objects and fields | AFAS `GET metainfo/update/{connector}`, served by your backend |
| **Mapping** | for each AFAS field, where its value comes from (a column or a fixed value) | stored per module (a JSON file or DB row), made in a mapping editor |

Build from the **edited grid**, not the original parse. The preview exists to prove the
corrections, and a preview built from the untouched file hides them.

### 2.1 Schema shape (as AFAS reports it)

```ts
interface AfasSchemaField {
  fieldId: string;          // "DbId"
  label: string;            // "Nummer debiteur"
  dataType: string;         // "string" | "int" | "decimal" | "date" | "boolean" | "blob" ...
  mandatory: boolean;
  primaryKey: boolean;
  length: number;
  decimals: number;
  values: { id: string; description: string }[] | null;   // allowed values, or free-form
}
interface AfasSchemaObject {
  name: string;
  fields?: AfasSchemaField[] | null;
  objects?: AfasSchemaObject[] | null;   // nested objects (KnOrganisation, KnBankAccount, ...)
}
interface AfasUpdateSchema extends AfasSchemaObject {
  id: string;     // the connector as addressed:      "KnSubjectReaction"
  name: string;   // the ROOT KEY of the body:        "KnReaction"  (often != id!)
}
```

Always take the body's root key from `schema.name`, never from the connector id.

### 2.2 Mapping shape

In memory, a mapping is a flat record keyed by `"<objectPath>#<fieldId>"`. The object path
is the dotted path from the root, so a field id only has to be unique within its object:

```ts
type FixedValue = string | number | boolean;

type FieldSource =
  | { kind: "fixed"; value: FixedValue }
  | {
      kind: "column";
      index: number;        // column position when it was mapped
      header: string;       // header text when it was mapped: used to re-find the column
      key?: true;           // part of the group key (several rows = one record)
      valueMap?: Record<string, FixedValue>;      // translate client codes -> AFAS codes
      multiply?: number;                           // unit conversion (hours -> minutes)
      fallback?: { index: number; header: string };// read this column when own cell is empty
      lookup?: { connector: string; matchField: string; valueField: string }; // GetConnector lookup
    };

type FieldMapping = Record<string, FieldSource>;   // "KnSalesRelationOrg.KnOrganisation#Nm" -> source
```

On disk it is stored as a readable list, which is easier to diff:

```json
{
  "connector": "KnSalesRelationOrg",
  "root": "KnSalesRelationOrg",
  "fields": [
    { "object": ["KnSalesRelationOrg"], "field": "DbId", "label": "Nummer debiteur",
      "mandatory": false, "source": "column", "column": "Debiteur Nummer", "columnIndex": 0 },
    { "object": ["KnSalesRelationOrg"], "field": "IsDb", "label": "Is debiteur",
      "mandatory": false, "source": "fixed", "value": true }
  ]
}
```

Converting between the two: `key = object.join(".") + "#" + field`.

---

## 3. The pipeline

```
sheet ─┐
       ├─ 1. route each row to a variant (which connector)
plan ──┘
                │
mapping ── 2. remap columns to this sheet by header name ── report missing columns
                │
schema ─── 3. narrow the schema (scope "mapped" = only filled fields)
                │
           4. group rows into records (if the mapping has key columns)
                │
           5. for each record: resolver = fieldValues(mapping, sheet, row)
                │
           6. payloadLines(schema, resolver) → [{ text, note }, ...]
                │
           ModulePayload { ordinal, variant, connector, rowNumbers, title, lines, values, ... }
```

### Step 1: Route rows to a variant (the "plan")

A module is not always one connector. *Debiteuren* has one column, *Organisatie of Persoon*,
that sends an `O` row to `KnSalesRelationOrg` and a `P` row to `KnSalesRelationPer`. So each
module has a **plan**:

```ts
interface ModuleVariant { mappingId: string; label: string; short?: string; match: string[] }
interface ModulePayloadPlan {
  discriminatorColumn: string | null;   // by HEADER, never by index
  variants: ModuleVariant[];
  existing?: { column: string; noun: string };   // for "already exists" marks (optional)
}

// ordinary module
{ discriminatorColumn: null, variants: [{ mappingId: "erp-artikelen", label: "Artikel", match: [] }] }

// split module
{ discriminatorColumn: "Organisatie of Persoon", variants: [
    { mappingId: "erp-debiteuren-organisatie", label: "Organisatie", short: "Deb.", match: ["O"] },
    { mappingId: "erp-debiteuren-persoon",     label: "Persoon",                     match: ["P"] } ] }
```

Compare the discriminator trimmed and upper-cased. A row that matches no variant is **not
dropped**. It goes into an `unrouted` list that the view reports, because a row that would
never reach AFAS is exactly what this view should surface.

### Step 2: Re-point the mapping at this sheet

A mapping stores `index` and `header`. For every column source:

- if `headers[index]` still matches `header`, keep it;
- else find the header anywhere in the sheet (it moved), and use that index;
- else **drop the field** and record it as a missing column.

Never fall back to the old index. A field filled from the neighbouring column writes the
wrong value into AFAS, which is worse than a missing field. Fixed values are always kept.

**Header matching is case-insensitive and whitespace-tolerant** (`Org. eenheid` ==
`Org. Eenheid`). Punctuation stays significant. An exact-match lookup fails silently here:
it reports the column missing and drops the field.

### Step 3: Scope ("all" vs "mapped")

- `mapped`: filter the schema to fields the mapping fills. Keep an object if anything
  survives underneath it. This is the real body that gets sent.
- `all`: the full connector, with unmapped fields as typed placeholders (`""`, `0`,
  `false`, `"2026-01-01T00:00:00"`). Use this to answer "is there a field nobody mapped?".

### Step 4: Grouping (several rows = one record)

Some sheets state a header and its lines flat, with the header's columns repeated on every
line row (for example an offerte and its regels). If the mapping marks columns `key: true`:

- **group rows** by the joined values of the key columns, in order of first appearance;
- find the **line path**: the nested object that holds the per-row fields (for example
  `KnQuotation.KnQuotationLine`);
- render everything above the line path once, from the group's first row, and render the
  line object's `Element` as an **array** with one entry per row.

Without key columns, one row is one record.

### Step 5: Resolve a field's value (`fieldValues`)

`fieldValues(mapping, sheet, rowIndex)` returns a **resolver**
`(objectPath, field) => ResolvedValue | undefined`:

| Result | Meaning | Rendered as |
|---|---|---|
| `undefined` | this mapping doesn't fill the field | placeholder (only in scope `all`) |
| `{ value, note }` | a value, plus where it came from | `"Fld": value   ← note` |
| `{ omit: true, note }` | mapped, but must **not** appear in the body | line left out |

The rules, in order:

1. **Fixed**: `{ value, note: "vaste waarde" }`.
2. **No sheet loaded**: `{ value: null, note: "<header> — geen bestand" }`.
3. **Empty cell** (after the fallback column has been tried): `{ omit: true }`. **Do not
   send `""`.** On a PUT an empty value *clears* the field in AFAS.
4. **Lookup**: look the cell up in a preloaded GetConnector table. If there is no single
   match, the value is `null` and the record is marked *blocked* (it is excluded from the
   send). Never pass the raw cell through.
5. **valueMap hit**: send the translated value as-is, with the note `<header> — "X" vertaald`.
6. **multiply**: if the cell is numeric, scale it and round (int fields to whole numbers).
7. Otherwise, **coerce by the field's `dataType`** (`afasValue`):
   - `date*`: `dd-mm-yyyy` etc. becomes `yyyy-mm-dd` (or `yyyy-mm-ddThh:mm:ss` when there
     is a time). If it doesn't parse, keep the text.
   - `int`/`decimal`: `Number(text.replace(",", "."))` if finite, else keep the text.
   - `boolean`: `ja/j/1/true/waar` becomes `true`, `nee/n/0/false/onwaar` becomes `false`,
     anything else keeps the text.
   - anything else: the text.

   A value that can't be coerced is kept as text, so AFAS refuses it visibly, rather than
   being turned into a `0` that hides the problem.

### Step 6: Render line by line (`payloadLines`)

The body is written as lines, not with `JSON.stringify`, for one reason: each line must be
able to carry a note. Every key and value still goes through `JSON.stringify`, so the text
is valid JSON. Only the braces, indentation and commas are written by hand.

Envelope (the shape AFAS UpdateConnectors take):

```
{ "<root>": { "Element": { "Fields": { ... }, "Objects": [ { "<child>": { "Element": { ... } } }, ... ] } } }
```

- `Objects` is a **list**, and each child is wrapped in its own `{ name: { Element } }`.
- A grouped line object has `"Element": [ {…}, {…} ]`.
- With a resolver present, an object whose fields are all omitted and which has no
  non-empty children is **left out entirely**. Otherwise AFAS would be asked to create an
  empty object.
- An object with no fields still writes `"Fields": {}` (the envelope's shape belongs to
  AFAS).
- Optional `@Action` per object (`insert`/`update`/`delete`) goes **first** in `Fields`.
  That is how a PUT says "add this nested record" rather than "overwrite it".
- Commas are handled by joining blocks: a comma goes on the last line of every non-empty
  block except the last one.

`payloadJson(lines) = lines.map(l => l.text).join("\n")` gives a parseable document. The
copy button uses it, and so does the send (`JSON.parse(payloadJson(lines))`).

---

## 4. Reference implementation (self-contained TypeScript)

This is a working core with routing, remapping, resolving, rendering and grouping. It leaves
out lookups, phases, repairs and counter-lines. Use it with the types from §2.

```ts
type Cell = string | number | boolean | Date | null;
interface Sheet { headers: string[]; rows: Cell[][]; rowNumbers: number[] }
interface PayloadLine { text: string; note?: string }
type Resolved = { omit?: false; value: FixedValue | null; note?: string } | { omit: true; note?: string };
type Resolver = (path: string, field: AfasSchemaField) => Resolved | undefined;

const norm = (h: string) => h.trim().replace(/\s+/g, " ").toLowerCase();
const headerIndex = (headers: string[], name: string) =>
  headers.findIndex((h) => norm(h) === norm(name));
const cellText = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));
const fieldKey = (path: string, id: string) => `${path}#${id}`;
const objectPath = (parent: string, name: string) => (parent ? `${parent}.${name}` : name);
const fieldsOf = (o: AfasSchemaObject) => o.fields ?? [];
const objectsOf = (o: AfasSchemaObject) => o.objects ?? [];

// ---- Step 2: remap ---------------------------------------------------------
function remapToSheet(mapping: FieldMapping, headers: string[]) {
  const out: FieldMapping = {};
  const missing: string[] = [];
  for (const [key, src] of Object.entries(mapping)) {
    if (src.kind === "fixed") { out[key] = src; continue; }
    const same = headers[src.index] !== undefined && norm(headers[src.index]) === norm(src.header);
    const idx = same ? src.index : headerIndex(headers, src.header);
    if (idx === -1) { missing.push(src.header); continue; }
    out[key] = { ...src, index: idx, header: headers[idx] };
  }
  return { mapping: out, missing };
}

// ---- Step 5: value coercion + resolver -------------------------------------
function afasDate(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
        ?? null;
  if (m) {
    const [, d, mo, y, hh, mi, ss] = m;
    const day = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return hh ? `${day}T${hh.padStart(2, "0")}:${mi}:${(ss ?? "00").padStart(2, "0")}` : day;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(text.trim()) ? text.trim() : null;
}

function afasValue(field: AfasSchemaField, text: string): FixedValue {
  const t = field.dataType.toLowerCase();
  if (t.startsWith("date")) return afasDate(text) ?? text;
  if (t === "int" || t === "decimal") {
    const n = Number(text.replace(",", "."));
    return text.trim() !== "" && Number.isFinite(n) ? n : text;
  }
  if (t === "boolean" || t === "bool") {
    const v = text.trim().toLowerCase();
    if (["true", "ja", "j", "1", "waar"].includes(v)) return true;
    if (["false", "nee", "n", "0", "onwaar"].includes(v)) return false;
  }
  return text;
}

function fieldValues(mapping: FieldMapping, sheet: Sheet | null, rowIndex: number): Resolver {
  const row = sheet?.rows[rowIndex] ?? [];
  return (path, field) => {
    const src = mapping[fieldKey(path, field.fieldId)];
    if (!src) return undefined;
    if (src.kind === "fixed") return { value: src.value, note: "vaste waarde" };
    if (!sheet) return { value: null, note: `${src.header} — geen bestand` };
    let text = cellText(row[src.index] ?? null), header = src.header;
    if (!text.trim() && src.fallback) {
      const b = cellText(row[src.fallback.index] ?? null);
      if (b.trim()) { text = b; header = `${src.fallback.header} (${src.header} leeg)`; }
    }
    const trimmed = text.trim();
    if (!trimmed) return { omit: true, note: `${header} — leeg` };
    if (src.valueMap && trimmed in src.valueMap)
      return { value: src.valueMap[trimmed], note: `${header} — "${trimmed}" vertaald` };
    if (src.multiply !== undefined) {
      const n = Number(trimmed.replace(",", "."));
      if (Number.isFinite(n)) {
        const isInt = field.dataType.toLowerCase() === "int";
        const v = isInt ? Math.round(n * src.multiply) : Math.round(n * src.multiply * 1e6) / 1e6;
        return { value: v, note: `${header} × ${src.multiply}` };
      }
    }
    return { value: afasValue(field, text), note: header };
  };
}

// ---- Step 3: narrow the schema --------------------------------------------
function narrow(o: AfasSchemaObject, path: string, keep: (p: string, f: AfasSchemaField) => boolean)
  : AfasSchemaObject | null {
  const fields = fieldsOf(o).filter((f) => keep(path, f));
  const objects = objectsOf(o)
    .map((c) => narrow(c, objectPath(path, c.name), keep))
    .filter((c): c is AfasSchemaObject => c !== null);
  return fields.length || objects.length ? { ...o, fields, objects } : null;
}

// ---- Step 6: render --------------------------------------------------------
const INDENT = "  ";
const line = (d: number, text: string, note?: string): PayloadLine => ({ text: INDENT.repeat(d) + text, note });
function commaJoin(blocks: PayloadLine[][]): PayloadLine[] {
  const filled = blocks.filter((b) => b.length > 0);
  return filled.flatMap((b, i) => i === filled.length - 1 ? b
    : b.map((e, j) => (j === b.length - 1 ? { ...e, text: e.text + "," } : e)));
}
function placeholder(f: AfasSchemaField): FixedValue {
  const t = f.dataType.toLowerCase();
  if (t === "int" || t === "decimal") return 0;
  if (t === "boolean" || t === "bool") return false;
  if (t.startsWith("date")) return "2026-01-01T00:00:00";
  return "";
}
interface Repeat { path: string; count: number; resolveAt: (i: number) => Resolver }

function fieldsLines(o: AfasSchemaObject, path: string, d: number, r?: Resolver): PayloadLine[] {
  const entries = fieldsOf(o).flatMap((f) => {
    const res = r?.(path, f);
    if (res?.omit) return [];
    const value = res === undefined ? placeholder(f) : res.value;
    return [[line(d + 1, `${JSON.stringify(f.fieldId)}: ${JSON.stringify(value)}`, res?.note)]];
  });
  return entries.length ? [line(d, `"Fields": {`), ...commaJoin(entries), line(d, `}`)] : [line(d, `"Fields": {}`)];
}
function isEmpty(o: AfasSchemaObject, path: string, r: Resolver): boolean {
  return !fieldsOf(o).some((f) => !r(path, f)?.omit)
    && objectsOf(o).every((c) => isEmpty(c, objectPath(path, c.name), r));
}
function objectsLines(o: AfasSchemaObject, path: string, d: number, r?: Resolver, rep?: Repeat): PayloadLine[] {
  const kids = objectsOf(o);
  if (!kids.length) return [];
  const blocks = kids.flatMap((c): PayloadLine[][] => {
    const cp = objectPath(path, c.name);
    const repeated = rep?.path === cp;
    if (r && !repeated && isEmpty(c, cp, r)) return [];
    const element = repeated
      ? [line(d + 3, `"Element": [`),
         ...commaJoin(Array.from({ length: rep!.count }, (_, i) =>
           [line(d + 4, `{`), ...elementLines(c, cp, d + 5, rep!.resolveAt(i)), line(d + 4, `}`)])),
         line(d + 3, `]`)]
      : [line(d + 3, `"Element": {`), ...elementLines(c, cp, d + 4, r, rep), line(d + 3, `}`)];
    return [[line(d + 1, `{`), line(d + 2, `${JSON.stringify(c.name)}: {`), ...element, line(d + 2, `}`), line(d + 1, `}`)]];
  });
  return [line(d, `"Objects": [`), ...commaJoin(blocks), line(d, `]`)];
}
function elementLines(o: AfasSchemaObject, path: string, d: number, r?: Resolver, rep?: Repeat) {
  return commaJoin([fieldsLines(o, path, d, r), objectsLines(o, path, d, r, rep)]);
}
export function payloadLines(schema: AfasUpdateSchema, r?: Resolver, rep?: Repeat): PayloadLine[] {
  return [line(0, `{`), line(1, `${JSON.stringify(schema.name)}: {`), line(2, `"Element": {`),
    ...elementLines(schema, schema.name, 3, r, rep), line(2, `}`), line(1, `}`), line(0, `}`)];
}
export const payloadJson = (lines: PayloadLine[]) => lines.map((l) => l.text).join("\n");

// ---- Step 4: grouping ------------------------------------------------------
// header path = the shortest object path holding a key column (the kop);
// line path   = the shortest column-filled path *below* it (the regel object).
function groupShape(mapping: FieldMapping) {
  const pathOf = (k: string) => k.slice(0, k.indexOf("#"));
  const keyCols: number[] = [], keyPaths: string[] = [], colPaths = new Set<string>();
  for (const [k, s] of Object.entries(mapping)) {
    if (s.kind !== "column") continue;
    colPaths.add(pathOf(k));
    if (s.key) { keyCols.push(s.index); keyPaths.push(pathOf(k)); }
  }
  if (!keyCols.length) return null;
  const headerPath = keyPaths.reduce((a, b) => (b.length < a.length ? b : a));
  const linePath = [...colPaths].filter((p) => p.startsWith(`${headerPath}.`))
    .sort((a, b) => a.length - b.length)[0] ?? null;
  return { keyCols: [...new Set(keyCols)].sort((a, b) => a - b), linePath };
}
function groupRows(keyCols: number[], sheet: Sheet, rowIndexes: number[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const i of rowIndexes) {
    const k = keyCols.map((c) => cellText(sheet.rows[i]?.[c] ?? null).trim()).join("\u0000");
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.values()];
}

// ---- The whole build -------------------------------------------------------
export interface Payload {
  ordinal: number; variant: ModuleVariant; connector: string;
  rowNumbers: number[]; title: string; lines: PayloadLine[];
}
export function buildPayloads(
  plan: ModulePayloadPlan,
  contexts: Map<string, { mapping: FieldMapping; schema: AfasUpdateSchema }>,
  sheet: Sheet,
  scope: "all" | "mapped",
) {
  const unrouted: { rowNumber: number; value: string }[] = [];
  const missingColumns: { header: string; variant: string }[] = [];
  const byVariant = new Map<string, number[]>();
  const disc = plan.discriminatorColumn ? headerIndex(sheet.headers, plan.discriminatorColumn) : -1;

  sheet.rows.forEach((row, i) => {
    const value = disc === -1 ? "" : cellText(row[disc] ?? null).trim().toUpperCase();
    const v = plan.discriminatorColumn === null ? plan.variants[0]
      : plan.variants.find((x) => x.match.some((m) => m.toUpperCase() === value));
    if (!v) { unrouted.push({ rowNumber: sheet.rowNumbers[i], value }); return; }
    byVariant.set(v.mappingId, [...(byVariant.get(v.mappingId) ?? []), i]);
  });

  const payloads: Payload[] = [];
  for (const variant of plan.variants) {
    const ctx = contexts.get(variant.mappingId);
    const rows = byVariant.get(variant.mappingId) ?? [];
    if (!ctx || !rows.length) continue;
    const { mapping, missing } = remapToSheet(ctx.mapping, sheet.headers);
    missing.forEach((header) => missingColumns.push({ header, variant: variant.label }));
    const schema = scope === "mapped"
      ? (narrow(ctx.schema, ctx.schema.name, (p, f) => !!mapping[fieldKey(p, f.fieldId)]) as AfasUpdateSchema | null)
      : ctx.schema;
    if (!schema) continue;
    const shape = groupShape(mapping);
    const records = shape?.linePath ? groupRows(shape.keyCols, sheet, rows) : rows.map((i) => [i]);
    for (const record of records) {
      const first = record[0];
      const lines = shape?.linePath
        ? payloadLines(schema, fieldValues(mapping, sheet, first),
            { path: shape.linePath, count: record.length, resolveAt: (k) => fieldValues(mapping, sheet, record[k]) })
        : payloadLines(schema, fieldValues(mapping, sheet, first));
      payloads.push({
        ordinal: 0, variant, connector: (ctx.schema as AfasUpdateSchema).id,
        rowNumbers: record.map((i) => sheet.rowNumbers[i]),
        title: cellText(sheet.rows[first]?.[0] ?? null),
        lines,
      });
    }
  }
  payloads.sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0]).forEach((p, i) => (p.ordinal = i + 1));
  return { payloads, unrouted, missingColumns };
}
```

> `groupShape` above follows the real one in `field-mapping.ts`. What the real code adds
> on top: `groupDisagreements()`, which flags a group whose kop columns differ between its
> rows (the first row wins in the body, so a disagreement means data is lost).

### Rendering the JSON with notes (React)

```tsx
<pre className="text-xs leading-relaxed">
  <code>
    {payload.lines.map((l, i) => (
      <span key={i} className="block whitespace-pre">
        {l.text}
        {l.note && <span className="text-orange-500/80">{"   ← "}{l.note}</span>}
      </span>
    ))}
  </code>
</pre>
```

`whitespace-pre` keeps the indentation. One `<span className="block">` per line keeps each
note on its line. Wrap the output in `useMemo` keyed on the sheet, mappings and scope, so
the build doesn't rerun on every keystroke in the rail.

---

## 5. The UI around it

### Loading

1. Look up the module's **plan**. A module without a plan gets no payload view: the
   connector choice is never guessed.
2. For each variant, fetch its **stored mapping** and then its **schema**
   (`metainfo/update/{mapping.connector}`). Fetch them one after another rather than in
   parallel, because AFAS metainfo is slow and rate-limited. Cache schemas per connector.
3. Key the result on `projectId | mappingIds | reloadCounter`. A result with a stale key
   counts as "loading". After a mapping is saved, bump the counter so the view never shows
   bodies from the old mapping.
4. If no variant has a mapping, show a message pointing to the mapping editor.

### Left rail: records

- **Search** over all fields. It matches against `payload.values` (field code → values
  taken from the *same resolver*), not against the rendered JSON text.
- **Select all**, with a tri-state checkbox.
- One row per record, memoised because there can be thousands:
  - checkbox, then ordinal, then **title** (the record's key column, for example the
    debiteurnummer), then a ✓/✗ after a run (hover shows the refusal reason);
  - second line: **variant badge** (`Deb.`), **existence badge** (✎ = exists in AFAS, will
    PUT; + = new, will POST), **Fouten** (validation errors), phase or blocked reasons;
  - right side: `rij 2241`, or `rij 12–15` for a grouped record.
  - Records that are ticked but won't be sent (skipped by the mode or phase) are dimmed,
    not unticked. The tick stays the user's choice.
- Rail toolbar toggles: **hide records with errors** (CircleAlert), **only new records**
  (Sparkles), **repair mode** (Wrench, which re-sends chosen nested objects with
  per-object `@Action`).

### Right pane header

- Connector id + `variant · rij N`.
- **Test / Live** environment toggle.
- **Copy JSON** (`payloadJson(current.lines)`), **open mapping** (opens the mapping editor
  *in a dialog*, so the payload and the uploaded sheet stay mounted), and a progress push.
- **Verzenden N**: the count of records that will actually go out. It opens a confirm
  dialog.

### Notices above the body

- **Missing columns**: "the mapping fills field X from column Y, which this sheet doesn't
  have."
- **Unrouted rows**: "row N has 'Z' in *Organisatie of Persoon*, which matches no
  connector."

---

## 6. The send

The browser never calls AFAS: credentials stay on the server.

```ts
interface SendRecord {
  ordinal: number; connector: string; rows: number[]; title: string;
  kind: string;                 // variant label
  action: "insert" | "update";  // POST or PUT
  key: string;                  // record key from the sheet, re-checked server-side for updates
  body: Record<string, unknown>;// JSON.parse(payloadJson(lines))  ← exactly what was on screen
}
```

1. **Pick the records**: ticked, not filtered out, not skipped, not blocked. Choose the
   action per record from the existence check (exists → `update`, new → `insert`). In
   "only new" mode, existing records are skipped.
2. `POST /api/afas/payloads/send { project_id, module_id, stage, records }`. The backend
   validates everything that can refuse the whole run **before** starting it: access, an
   empty selection, that each connector is one this module may write, that the environment
   is configured, and that every `update` really exists. Then it returns a `runId`
   straight away.
3. The backend runs **sequentially** (AFAS throttles bursts, and the order stays readable),
   one call per record: `POST` or `PUT` to `connectors/{connector}`.
4. The browser **polls** `GET /api/afas/payloads/send/{runId}` for
   `{ status, total, done, sent, failed, inserted, updated, results[] }`. A
   `POST …/{runId}/stop` stops it. The run is server-side, so a reload picks it back up
   (`GET /api/afas/payloads/send?module=…` returns the active run).
5. Each `SendResult` has `{ ordinal, rows, ok, action, message, keys?, body? (refusals
   only) }`. The banner shows "X verstuurd, Y geweigerd in <environment> (test|live)" with
   a progress bar, and refusals are **grouped by message**. From a refusal's `body` and
   AFAS's message, the tool extracts the offending field and value, and can:
   - download a **PDF report** of the run;
   - download the **original Excel with the refused cells marked** (fill + note).

---

## 7. Gotchas worth keeping

- **Empty cell → omit the field, never `""`**, since a PUT clears fields sent empty.
- **Never key by column index** across files: re-find by header, case-insensitively.
- **Never drop silently**: unrouted rows, missing columns and blocked lookups are all
  findings to show.
- **Root key = `schema.name`**, not the connector id.
- **Notes live outside the JSON**: the copy button and the send take `text` only.
- **The preview is the send**: parse the rendered lines, and don't rebuild the body.
- **Coerce by `dataType`**, and keep the raw text when coercion fails, so AFAS refuses it
  loudly.
- **Lookups** (cell → value via a GetConnector) resolve to `null` plus *blocked* when
  there is no single match. Never pass the raw cell through.

---

## 8. Where it lives in this repo

| Concern | File |
|---|---|
| Schema types, filter, `payloadLines`, `payloadJson` | `frontend/src/lib/afas-schema.ts` |
| Mapping types, `remapToSheet`, `fieldValues`, `afasValue`, grouping, storage format | `frontend/src/lib/field-mapping.ts` |
| Plans per module, `buildModulePayloads`, `ModulePayload` | `frontend/src/lib/module-payloads.ts` |
| Search / filter over records | `frontend/src/lib/payload-filter.ts` |
| Send records, run polling, refusal parsing | `frontend/src/lib/payload-send.ts` |
| The panel (rail, header, JSON pane, send) | `frontend/src/components/uploader/ModulePayloadPanel.tsx` |
| Send confirm dialog | `frontend/src/components/uploader/SendPayloadsDialog.tsx` |
| Backend send + run endpoints | `backend/main.py` (`/api/afas/payloads/send…`) |
| Envelope on the server | `backend/afas.py` (`afas_envelope`, `afas_element`) |
| Stored mappings | `backend/json_files/mappings/modules/*.json` → Postgres `field_mappings` |
| More background | `docs/afas-integration.md` (*Payloads*), `docs/architecture.md` (*Adding a module payload plan*), `docs/existing-records.md` |
