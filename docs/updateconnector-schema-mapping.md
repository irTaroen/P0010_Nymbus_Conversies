# UpdateConnector schema mapping — how it works and how it is built

A reusable design for turning **rows of tabular data** (an Excel sheet, a CSV, a database
export) into **request bodies for an AFAS UpdateConnector**, where the shape of the body is
not written in code but **read from AFAS itself** and the source → target wiring is data
you can store, review in a diff, and re-apply.

This document describes the design independent of any one app. Everything specific to the
Nymbus Conversies (module ids, Dutch UI strings, storage paths) is confined to the
[appendix](#appendix--where-each-part-lives-in-this-repo), so the rest can be lifted into
another codebase. Code excerpts are TypeScript because that is what the reference
implementation is written in; the ideas need nothing TypeScript-specific.

Companion reading in this repo: [AFAS Profit API reference](AFAS-Profit-API-Referentie.md)
(the API itself) and [afas-integration.md](afas-integration.md#field-mapping) (how this app
uses it).

---

## 1. The idea in one page

An UpdateConnector body is a **nested tree**: a root key, an `Element`, its `Fields`, and
`Objects` that repeat the same structure. AFAS publishes the tree's *exact* shape per
connector (**metainfo**). A mapping tool therefore needs four things, and keeps them
separate:

```
   ┌────────────────────┐   ┌──────────────────┐
   │ 1. SCHEMA          │   │ 2. SOURCE        │
   │ metainfo/update/X  │   │ a sheet: headers │
   │ tree of objects →  │   │ + rows of cells  │
   │ fields (type, len, │   └────────┬─────────┘
   │ mandatory, values) │            │
   └─────────┬──────────┘            │
             │      ┌────────────────┴───────────────┐
             │      │ 3. MAPPING (stored data)       │
             │      │ "path#field" → column | fixed  │
             │      └────────────────┬───────────────┘
             │                       │
             ▼                       ▼
        ┌─────────────────────────────────────┐
        │ 4. RESOLVER   (path, field) → value │  reads one row through the mapping,
        │    | omit | undefined               │  converts each cell to the field's type
        └───────────────────┬─────────────────┘
                            ▼
        ┌─────────────────────────────────────┐
        │ RENDERER  schema + resolver → body  │  walks the schema, asks the resolver
        └───────────────────┬─────────────────┘  for every field, writes the envelope
                            ▼
                  POST / PUT connectors/{X}
```

Three consequences drive everything else:

1. **The schema is the only authority on shape.** Nothing in code names a field, a nesting
   level or a root key. A connector added in AFAS needs no code change.
2. **The mapping is data, not code.** It is a flat dictionary keyed by *where in the tree* a
   field lives. It serialises to a small JSON document, can be hand-edited, and survives
   the tab it was made in.
3. **The body is derived, never authored.** One function (the renderer) turns
   *schema + resolver* into a body. The editor's preview, the bulk preview and the actual
   send all call it, so what you looked at is what leaves.

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **UpdateConnector** | An AFAS endpoint that writes data (`POST` insert, `PUT` update, `DELETE`). Addressed by an id such as `KnSalesRelationOrg`. |
| **Schema** | AFAS's description of one UpdateConnector: fields, nested objects, root key. |
| **Object** | A node in the schema tree — the root or a nested object. Has `fields` and child `objects`. |
| **Object path** | Dotted names from the root: `KnQuotation.KnQuotationLine`. Identifies a *place* in the tree. |
| **Field** | A leaf: `fieldId` (short code such as `QuId`), label, type, constraints. |
| **Field key** | `objectPath + "#" + fieldId`. The identity of one *place a value goes*. |
| **Source** | Where one field's value comes from: a sheet **column** or a **fixed** value. |
| **Mapping** | `Record<fieldKey, Source>` — every filled field of one connector. |
| **Resolver** | A function `(objectPath, field) → answer` that yields the value for one record. |
| **Record** | One body's worth of data: usually one row, sometimes a group of rows. |
| **Variant** | One connector a sheet's rows *may* go through (see [routing](#8-one-sheet-several-connectors--variants)). |

---

## 3. The schema

### 3.1 What AFAS answers

`GET …/ProfitRestServices/metainfo/update/{connector}` returns the whole tree. Its shape
(field names are AFAS's own):

```ts
interface SchemaField {
  fieldId: string;        // "QuId" — the key that goes into `Fields`
  label: string;          // human label, per the environment's language
  dataType: string;       // "string" | "int" | "decimal" | "date" | "boolean" | "blob" | …
  mandatory: boolean;
  primaryKey: boolean;
  length: number;         // 0 where the type has none
  decimals: number;
  notzero: boolean;
  controlType: number;    // AFAS editor hint — informational
  values: { id: string; description: string }[] | null;  // allowed values, or free-form
}

interface SchemaObject {
  name: string;
  fields?: SchemaField[] | null;      // AFAS omits the key rather than sending []
  objects?: SchemaObject[] | null;
}

interface UpdateSchema extends SchemaObject {
  id: string;             // the connector as addressed: "KnSubjectReaction"
  description: string;
  name: string;           // ← THE ROOT KEY OF THE BODY. Often NOT the id.
}
```

`GET …/metainfo` lists what exists (`updateConnectors`, `getConnectors`, and an `info` block
naming the environment) — that is how a connector picker is built without hard-coding names.

### 3.2 The root-key trap

The body's outermost key is `schema.name`, **not** the connector id in the URL:

| URL / `id` | Body root (`name`) |
|---|---|
| `KnSubjectReaction` | `KnReaction` |
| `KnEmployee` | `AfasEmployee` |
| `FiEntries` | `FiEntryPar` |

Always take the root from the schema. Hard-coding it from the URL is the classic first bug.

### 3.3 Pass the schema through unchanged

The backend proxy returns AFAS's answer as it is. The question the UI asks is *what does
AFAS say this connector takes*; a proxy that reshapes the answer is answering a different
question, and every downstream feature (badges, validation, examples) then inherits the
reshaping. Normalise defensively in one place on the client (`fieldsOf(obj)` returns
`obj.fields ?? []`) instead.

### 3.4 Which environment is asked matters

The same connector name can mean a different schema in different AFAS environments. Treat
`(environment group, connector id)` as the address, not the id alone.

The pattern that made one mapping reusable across many customers: read schemas from a
single **template** environment that every customer environment is a copy of, and make the
mapping once against it. Only when a customer's environment has genuinely drifted do you
read *that* customer's schema and keep a separate copy of the mapping
([§9.4](#94-per-customer-overrides)). Keep the environment an explicit parameter of every
AFAS call — no module-level "current environment".

### 3.5 Helpers derived from the schema

These are pure functions over `SchemaObject`, worth writing once and sharing:

```ts
objectPath(parent, name)   // "A" + "B" → "A.B"; the tree position, not the bare name
countSchema(obj)           // { fields, mandatory, objects } including everything nested
fieldTypeLabel(field)      // "string (20)", "decimal (11,2)", "blob"
filterSchema(schema, {query, onlyMandatory, keepField})  // narrowed copy, or null
```

Two rules inside `filterSchema` that are easy to get wrong:

- **Identify an object by path, not by name.** One name occurs at several places
  (`KnReactionAttachment` hangs under two connectors; an expanded-state map keyed by bare
  name opens both).
- **Keep an object for what survives beneath it, and if the object's own name matches the
  query keep its whole subtree** (clear the query on the way down). Searching for an
  object's name means "what is in it", not "which of its fields repeat that name".

`keepField(path, field)` is the extension hook: the same filter powers *search*, *only
mandatory*, and *only the fields the mapping fills* without the schema module knowing what
a mapping is.

---

## 4. The mapping model

### 4.1 The key is the field, not the column

```ts
const fieldKey = (path: string, fieldId: string) => `${path}#${fieldId}`;
// "KnQuotation.KnQuotationLine#VaIt"
```

- A **field id is only unique within its object** (`KnReactionAttachment#FileName` is not
  `KnReaction#FileName`), so the key includes the path.
- `#` because AFAS never uses it in a name, so the halves can always be separated again.
- Keying by *field* encodes two rules by construction: **one column may feed several
  fields; a field takes exactly one value.**

### 4.2 Two sources, mutually exclusive

```ts
type FieldSource =
  | { kind: "column"; index: number; header: string; key?: true; valueMap?: Record<string, Value> }
  | { kind: "fixed";  value: Value };            // Value = string | number | boolean

type FieldMapping = Record<string, FieldSource>;
```

- **column** — the value is read from a cell. Stored by **index *and* header**: the index
  reads a row; the header is what survives a re-read of the file (see §4.3).
- **fixed** — one constant for every record (a type code, a processing flag, a fiscal year).
  Typing it once beats a 3 000-row column of identical cells.
- Assigning either replaces the other: one field, one source.
- A column may also carry a **`lookup`** — the cell picks a row of a GetConnector in the
  environment being sent to, and that row's value is sent ([§5.7](#57-lookups--a-translation-afas-holds)).
- `key`, `valueMap` and `lookup` exist **only on columns** — a constant is identical on every row, so
  it identifies nothing and has nothing to translate. Make the *type* forbid it, and have
  the server refuse it too, because a mapping document can arrive from elsewhere.

### 4.3 Re-pointing a mapping at a new sheet

A column index is only true of the sheet the mapping was made against. A client's export
that gained a column shifts every index after it, and reading raw indices would fill each
field from its neighbour's column — **silently**, because every value is a string.

```ts
function remapToSheet(mapping, headers) {
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind === "fixed")                     keep;                 // belongs to no sheet
    else if (headers[source.index] === source.header) keep;                // still where it was
    else if (headers.includes(source.header))         keep with new index; // it moved
    else                                              DROP;                // it is gone
  }
}
```

Dropping is deliberate: a field filled from the wrong column is worse than an unfilled
one. But **dropping must not be silent** — report every dropped column (*"the mapping expects
column X, this sheet has none"*) so the reader learns the sheet is probably not the
template the mapping was made against. Always call `remapToSheet` before reading rows.

### 4.4 The stored document

The stored form and the form the editor exports are **the same document** — one shape, not
a stored one and a shown one:

```jsonc
{
  "connector": "KnQuotation",        // what it is addressed by
  "root": "KnQuotation",             // schema.name at the time — the body's root key
  "file": "ERP_6_Voorcalculatie.xlsx",
  "sheet": "Conversie",
  "fields": [                        // in SCHEMA order, not the order they were dragged
    { "object": ["KnQuotation"], "field": "QuId", "label": "Nummer offerte",
      "mandatory": false, "source": "column", "column": "Offerte", "columnIndex": 1, "key": true },
    { "object": ["KnQuotation", "KnQuotationLine"], "field": "VaIt", "label": "Type item",
      "mandatory": true, "source": "column", "column": "Type item", "columnIndex": 6,
      "valueMap": { "Wst": "1", "Art": "2", "Kst": "6", "Sam": "7" } },
    { "object": ["KnQuotation"], "field": "SomeFlag", "label": "…",
      "mandatory": false, "source": "fixed", "value": true }
  ]
}
```

- `object` is the **trail** (root first); `object.join(".") + "#" + field` rebuilds the key,
  so nothing else has to be stored to restore a mapping (`fromMappingExport`).
- **Schema order** on export makes two mappings of the same connector diffable side by side.
- **`label` and `mandatory` are copies** so the file reads without the schema beside it.
  They are informational; never read behaviour from them (an old file may have an empty
  label — fall back to the code).
- Optional keys are **omitted, not `null`/`false`** (`key`, `valueMap`, `column` vs `value`),
  so a mapping that doesn't use a feature reads in a diff exactly as it did before the
  feature existed.
- Extra top-level keys (`notes`, `verifiedAgainst`) are legal in the file and useful for
  provenance, but a save from the editor only writes what the document type carries — decide
  whether your editor round-trips them.
- On read, **skip an entry you don't understand** rather than failing the load: losing one
  field beats losing the whole mapping. Refuse such entries on the way *in* instead
  ([§9.3](#93-validating-on-save)).

---

## 5. From a cell to a value

### 5.1 The resolver contract — three answers, three meanings

```ts
type ResolvedValue =
  | { omit?: false; value: string | number | boolean | null; note?: string }
  | { omit: true; note?: string };

type FieldValueResolver = (objectPath: string, field: SchemaField) => ResolvedValue | undefined;
```

| Answer | Meaning | Effect in the body |
|---|---|---|
| `undefined` | "This resolver doesn't fill this field." | Placeholder stays, so the body always shows the connector's whole shape and what *is* filled stands out. |
| `{ omit: true }` | "I own this field and this record has no value." | Key is **left out of `Fields` entirely.** |
| `{ value }` | "Here is the value." | Written, typed per the field. |

Collapsing these three into two is the source of a whole class of bugs — see §5.4.

A resolver for one record is built by binding the mapping, the sheet and a row index:

```ts
fieldValues(mapping, sheet, rowIndex): FieldValueResolver
```

Every resolved value carries a **`note`** — the column header, `fixed value`,
`"X" translated`, `header — empty`, `header — no file`. The note is *provenance*: a value
alone doesn't tell you whether it landed in the field you meant. It is shown beside the
line in a preview and never inside the JSON.

### 5.2 Type conversion — per the field's own `dataType`

A cell is text; AFAS fields are typed, and `"1234"` is a different body from `1234`. The
conversion is driven by `field.dataType` from metainfo and is applied **only where
unambiguous**:

| `dataType` | Cell becomes | Left as the original text when |
|---|---|---|
| `int`, `decimal` | JSON number; a comma decimal is read as a point | it doesn't parse |
| `boolean` | `true`/`false` from `ja j 1 waar` / `nee n 0 onwaar` | anything else |
| `date`, `datetime` | `yyyy-mm-dd` (`23-08-2026` → `2026-08-23`); a cell that carries a time keeps it (`…T08:00:00`); midnight is *not* a time | unknown notation, or a day that doesn't exist (31-02) |
| everything else | the text unchanged | — |

**This conversion never refuses.** Cells are whatever the client typed; a value that can't
be converted stays as text so the preview shows the problem, instead of a `0` or a guessed
year that hides it. Ambiguous dates (`01-02-26`) are left alone for the same reason.

Implementation notes that matter:

- **Reuse your validation engine's date parser** rather than writing a second one, so the
  mapping and a column's `date` check cannot disagree about what a date is. Parse to a UTC
  timestamp and read UTC parts back — a local getter shifts the day west of Greenwich.
- The date format AFAS wants is `yyyy-mm-dd` (confirmed against a live environment; the
  reference states none, every example just happens to be ISO).

### 5.3 Fixed values *do* refuse

A fixed value is typed now, by someone who can fix it now, so it is validated on entry
against everything metainfo states about the field:

```
allowed values (`values`)  → must be one of them          → picker, not a text box
boolean                    → true | false
int                        → digits only; notzero; digits ≤ length
decimal                    → number; decimals ≤ field.decimals; notzero
date                       → yyyy-mm-dd, stored as yyyy-mm-ddT00:00:00
string/blob/other          → length ≤ field.length
```

Pick the **narrowest input control the metainfo allows** (`fixedInputKind`: select /
boolean / date / number / text) so a wrong value is impossible to type rather than reported
after. These are the refusals AFAS would give, delivered minutes earlier and next to the
field.

### 5.4 Empty cell ⇒ omit the key (load-bearing)

A mapped column whose cell is blank resolves to `{ omit: true }`. It is **not** sent as
`""` and not as `null`. On a **PUT**, an empty value *clears* the field it is sent for; a
body that carries `""` for every blank cell would empty half a record it was only meant to
add to. Omission is what keeps a conversion **additive**, on insert and on update alike.
(A missing sheet is different from a blank cell: resolve to `value: null` with a
`header — no file` note, so the field doesn't fall back to a placeholder that reads like an
unmapped one and the document stays valid JSON.)

### 5.5 Value maps — the client's codes vs AFAS's

Sheets carry the client's own vocabulary; AFAS wants its own, often spelled differently and
not in the same order (`Wst→1, Art→2, Kst→6, Sam→7`). A column source may carry
`valueMap: Record<trimmedCellText, Value>`:

- Exact match on the **trimmed** cell text; a match **skips** type conversion (the mapper
  already chose the final value).
- A raw value with **no** entry still goes out as `afasValue()` would send it — visibly
  wrong once AFAS refuses it, rather than silently guessed.
- The editor offers the **distinct values the column actually contains**
  (`distinctColumnValues`, trimmed, first-seen order, blanks excluded) as the left side of
  the table.
- Only a column can have one; refuse it on a fixed source.

### 5.6 Composing resolvers — a third source without a third kind

Some values belong to neither the sheet nor a constant typed once: they come from
configuration or from another system (a periodetabel on the project, a go-live date). Model
that as a **decorator over the resolver** rather than a new `FieldSource` kind:

```ts
withFills(resolve, fillsByKey): FieldValueResolver
//   omit         → the fill goes in   (blank cell in a present column)
//   undefined    → the fill goes in   ONLY for a key the stored mapping mapped to a filled
//                                       column that remapToSheet dropped (column absent)
//   a real value → untouched; the sheet wins when it is filled
```

Rules that keep this honest: the fill passes through the **same `afasValue()`** a cell does
(so a fill and a typed cell of the same value make identical bodies); a fill with nothing to
put in doesn't register (the field keeps behaving as "omit when empty" rather than being
filled with a guess); the note names the fill's provenance; compute `fillsByKey` from the
**stored** mapping, because the remapped one has already lost the column that says which
field the fill was for. The same composition point is where you'd add row-level derivations
(dates from other columns, unit conversions).

### 5.7 Lookups — a translation AFAS holds

A `valueMap` is a translation you can write down. Some can't be: the relation number
behind a debiteurnummer differs per customer and per stage and grows with every new
debiteur. For those a column carries `lookup: { connector, matchField, valueField }` —
*take `valueField` from the row of `connector` whose `matchField` equals the cell*:

- The **rule** is stored; the **table** is fetched when payloads are built, from the
  environment being written to, per stage, and passed to the resolver
  (`fieldValues(mapping, sheet, row, lookups)`).
- Match keys are normalized on both sides (padding stripped from all-digit keys).
- **No answer is not a value.** No match, several distinct values, or a table that
  couldn't be read resolves to `null` with the reason as note, and the record is marked
  unsendable. Unlike an untranslated `valueMap` entry the raw cell is *not* passed
  through: a key from one number space in a field of another is a silent wrong link,
  not a visible refusal.
- Exclusive with `valueMap` on one field, and refused on a fixed source.
- Serve a table only for a triple some stored mapping declares — the names arrive from
  the browser.

---

## 6. Rendering the body

### 6.1 The envelope

Every UpdateConnector body has one shape:

```json
{ "<root>": { "Element": { "Fields": { … }, "Objects": [ { "<Child>": { "Element": { … } } } ] } } }
```

`Objects` is written as a **list**, one wrapper per child, each with its own `Element`
(AFAS accepts an object as well; the list keeps ordering explicit and matches the nested
examples in the reference). Server-side builders live in one place so callers state *what*
they send, not how AFAS spells it:

```python
afas_element(fields, keys=…, objects=…, action=…)   # keys/action get the "@" AFAS uses
afas_envelope(root, element)                        # {root: {"Element": element}}
```

`@Key` properties and `@Action` (`insert|update|delete` inside `Fields`) exist for
hand-built bodies and mixed insert/update trees; the schema-driven renderer below emits only
`Fields` and `Objects`, and primary-key fields go in as ordinary `Fields` entries.

### 6.2 The renderer: schema × resolver → lines

```ts
payloadLines(schema, resolve?, repeat?): PayloadLine[]      // { text, note? }
payloadJson(lines): string                                  // joined document
```

```
payloadLines
 └─ { schema.name: { "Element": { elementLines(root) } } }
     elementLines(obj) = commaJoin([ fieldsLines(obj), objectsLines(obj) ])
       fieldsLines:  for each field → resolve(path, field)
                        omit         → skip the entry
                        undefined    → placeholderFor(field)
                        value        → JSON.stringify(value), note attached
                     no entries?  → still write  "Fields": {}
       objectsLines: for each child → { name: { "Element": elementLines(child) } }
```

Design points:

- **Written line by line, not through `JSON.stringify`, for one reason:** each line must be
  able to carry a `note`. Keys and values still go through `JSON.stringify`; only braces and
  commas are written by hand, and the joined lines parse as JSON. (A body with a comment in
  it is not a body AFAS would take, so notes live *beside* the text.)
- **`commaJoin`** adds a comma to the last line of every block but the last and drops empty
  blocks first — the one thing hand-written JSON gets wrong (no trailing commas when an
  object has no children).
- **An object with no fields, or whose every mapped cell is empty, still writes
  `"Fields": {}`.** The envelope's shape is AFAS's to state, not ours to prune.
- **Placeholders** (`placeholderFor`) exist so the *skeleton* can be pasted and filled:
  `0` for int/decimal, `false` for boolean, `"2026-01-01T00:00:00"` for dates, `""` for the
  rest. They are examples, never values to send — a mandatory field is as empty as an
  optional one.
- Both preview and send call this function. If you add a second renderer you have two
  mappings that can disagree.

### 6.3 Scope: whole shape vs the body that would be sent

| Scope | Schema fed to the renderer | Answers |
|---|---|---|
| **all** | the full connector; unmapped fields carry placeholders | *Is there a field here nobody mapped?* |
| **mapped** | `filterSchema(schema, { keepField: mapped or filled })` | *The body as it would really be sent.* |

Send with the **`mapped`** scope. The filter keeps objects for what survives beneath them,
so a field two levels down keeps the objects it lives in. Remember to keep fields that are
*filled* (§5.6) as well as *mapped*.

### 6.4 The "what does this record carry" index

Filters ("show records where Debiteurnummer contains …") must read **the values the body
carries**, not the rendered text (which would match indentation and quotes, and go blind
when placeholders appear). Build the index from the *same resolver*:

```ts
payloadValues(mapping, schema, resolve, filled): Map<fieldId, string[]>
```

Walk the mapping's keys (a cheap pass over filled fields, not the connector's whole tree),
resolve each, skip omitted/`null`/empty. A field code can occur in several objects, so the
value is a list, and a filter matches if any matches — the reading that never hides a
record it should show. Read against the **unfiltered** schema so a display switch never
changes which records exist.

---

## 7. Several rows, one record — grouping

Sometimes one record is **several rows**: a quotation and its lines, a subscription and its
rows, a journal entry and its postings — the sheet states the parent flat, repeating its
columns on every row. The one thing the mapping adds is a flag on a column source:

```ts
{ kind: "column", …, key: true }     // this column identifies the record
```

Everything else is **derived from where the key sits in the schema**, so there is no second
setting to keep in step:

| Role | Which object | Produces |
|---|---|---|
| **kop** (header) | the shallowest object holding a key field | written **once per group**, from the group's first row |
| **regel** (line) | the shallowest object *strictly below* the kop that has a column of its own | **one element per row** of the group |

```ts
function groupShape(mapping): { headerPath; linePath | null; keyColumns } | null {
  // null when no column is marked → one row = one record (the default)
  // headerPath = shortest object path among key fields
  // linePath   = shortest column-bearing path that starts with `${headerPath}.`
  // keyColumns = de-duplicated by column index, sorted left to right
}
```

- Both paths are read **off the mapping** (a key already carries its path), not the schema,
  so a filtered schema on screen can't change the answer.
- Objects deeper than the line ride along inside each element — one row is one line, so a
  row carries at most one of whatever hangs beneath it. A flat sheet can express exactly
  **one** level of repetition.
- Two fields fed by one key column are **one** key part, not two: a record is identified by
  the *values in the sheet*, not by how many AFAS fields they fill.
- `linePath` is nullable on its own: a key with nothing mapped below it is a state worth
  *showing*, not silently treating as ungrouped.

**Grouping the rows** (`groupRows`): one group per distinct key tuple, in first-seen order,
holding row indexes in sheet order. Compare **trimmed but case- and text-exact**
(`VC001` ≠ `vc001`) — the group count is on screen, so two groups where one was meant is
visible, whereas silently merging two different records would not be. Join key parts with a
NUL (`"\u0000"`, written as the escape, never a literal byte) so a separator can't be
mistaken for part of a value.

**AFAS's array form for the repeated half** — `"Element": [ {…}, {…} ]` under the line
object — is rendered through a `PayloadRepeat`:

```ts
interface PayloadRepeat {
  path: string;                                       // object whose Element becomes an array
  count: number;                                      // one element per row of the group
  resolveAt: (i: number) => FieldValueResolver | undefined;   // row i's resolver
}
```

The renderer takes one resolver **per row** so each element carries its own row's values
through the same `fieldValues()` the ungrouped body uses. The repeat isn't passed into the
elements it produces: inside one, the row is already decided. Fills (§5.6) apply per
element as well.

**Key vs ordinary kop column — the deliberate difference.** A key column cannot disagree
within a group (a different value *is* a different group), so a typo'd key silently creates
a *second* record. A column mapped into the kop but **not** marked as key must agree across
the group, and `groupDisagreements()` reports it (*"Begindatum: `01-01-2026` versus
`09-09-2026` (row 4)"*) rather than letting the first row's value win unnoticed. So mark
only the columns that truly *identify* the record; the rest get error reporting for free.
Which is wanted is a business call per connector — the mapping records it either way.

Make grouping **checkable, not taken on faith**: show a *kop* / *regel per rij* badge on the
object headers, the count (`3 records from 12 rows`), and render the whole group the example
row belongs to so the line object visibly becomes an array of N.

---

## 8. One sheet, several connectors — variants

A sheet is not always one connector. A *debtors* template has one column
(*Organisation or Person*, `O`/`P`) that decides whether a row is a `KnSalesRelationOrg` or
a `KnSalesRelationPer` — same sheet, same columns, different object underneath. So there is
**no single "mapping for the module"**. Model it as a plan, in data:

```ts
interface ModulePayloadPlan {
  discriminatorColumn: string | null;          // by HEADER (survives a template that gains a column)
  variants: { mappingId: string; label: string; match: string[] }[];  // match = cell values that route here
  existing?: { column: string; noun: string }; // optional: how to tell a record already exists
}
```

- **Single-variant is the ordinary case:** `discriminatorColumn: null`, one variant with
  `match: []` — every row belongs to it by definition. Nothing about the common case changes.
- `variantOfRow`: trim + upper-case the discriminator cell and compare case-insensitively.
- **A row no variant claims is reported (`unrouted`), never dropped.** A row that would never
  reach AFAS is the finding; the preview is where it becomes visible *before* an upload.
- Each variant's rows are read through **that variant's own mapping and schema**, so both
  kinds of body come out side by side, each with its own field set.
- Ask *"does this mapping group?"* **per variant**, not per module, so a future split module
  that also groups needs no change.
- Build order: route every row → per variant `remapToSheet` → report missing columns →
  narrow schema → group (this variant's rows only; another variant's rows are another
  connector's records) → render → sort all payloads by first source row so a record's
  neighbours on screen are its neighbours in the file.
- The *plan* answers exactly one question — which mapping does this row go through. It does
  not decide the connector (the stored mapping says) nor whether rows group (the `key` flags
  say).

Splits come in two flavours worth telling apart: two **connectors** (O/P), and one
connector whose **field shape** differs per side (a debit/credit split that changes which
amount field is filled and a fixed account-type code).

---

## 9. Storing and serving mappings

### 9.1 One file per mapping

A mapping is sizeable and hand-edited; touching one should mean editing one file, not
picking a row out of a shared array. The **file is the store**: list = read the directory.

```
mappings/<group>/<key>.json
   group = the AFAS environment/category the schema is read from   (part of the address)
   key   = the connector, OR the app's module id — see below
mappings/clients/<projectId>/<moduleId>.json                       (overrides, §9.4)
```

**What the key is depends on the group**, because what is ambiguous differs:

- **Keyed by connector** when no other concept applies (internal/dossier connectors).
- **Keyed by module id** when one connector serves several modules (`KnEmployee` maps both
  *employees* and *temp workers*, each with a different smaller field set). Then the path
  supplies `module` and the file's own `connector` field is trusted for the connector —
  the one place the store reads content over the path it found it at.

Keep the two address spaces straight **in the client** too: a connector-keyed lookup can't
hold two module files that share a connector (one silently loses the collision in the
browser's map, not on disk). Index by the *file's own name* as well
(`byModuleFile`) for anything that resolves module → mapping(s).

A file that fails to parse is **skipped**, not fatal — one bad mapping shouldn't hide the
rest. Writes are atomic: write `name.tmp`, then `replace` it over the target.

### 9.2 Endpoints

Shown without the app's `/api` prefix.

| Route | Purpose |
|---|---|
| `GET  /afas/updateconnectors` | per group: the environment that answered + `metainfo`'s connector list. **A failing group doesn't fail the call** — it comes back with no connectors and AFAS's reason in `message`. |
| `GET  /afas/updateconnectors/{group}/{connector}` | one schema, passed through unchanged; the group picks the environment |
| `GET  /afas/mappings` | every stored mapping (newest first) |
| `PUT  /afas/mappings/{group}/{key}` | replace one; answers with the stored row |
| `DELETE /afas/mappings/{group}/{key}` | forget one; deleting a missing one is not an error |

Admin-only throughout: this is the wiring of the integration, not something an end user acts
on. The server **stamps `savedAt` / `savedBy`** — "which of these two is newer" must not
depend on a browser clock.

### 9.3 Validating on save

The stored document is later turned into payloads for a real customer, so refuse a
half-filled entry when it is written rather than discovering it at upload:

- unknown `source` (a document written by something else);
- `column` without `column` **and** `columnIndex`;
- `fixed` without a `value`;
- `key` on anything but a column;
- `valueMap` on anything but a column;
- `lookup` on anything but a column, beside a `valueMap`, or naming a connector/field that
  isn't an AFAS id;
- path segments (project id, module id) that would escape the directory — refuse `/`, `\`,
  `.`, `..` and empty.

Declare **every** optional field on the server-side model. A validation layer that ignores
unknown keys will silently drop `key` / `valueMap` on the way through and a saved grouped
mapping comes back ungrouped. Serialise with `exclude_none` so absent stays absent.

### 9.4 Per-customer overrides

The template-environment mapping is the rule; the exception is a customer whose data forces
a deviation. Flag the module on the project, and give that project its **own copy**:

- The copy is a **snapshot** — it starts as the standard mapping re-opened against the
  project's own schema and edited where it differs. Later edits to the standard mapping do
  not flow into it (that would defeat the point of an exception).
- The connector is **resolved server-side** from the standard mapping, never trusted from the
  request, so a client file can't claim a connector its module doesn't serve.
- There is nothing to snapshot until a standard mapping exists, so a flagged module without
  one has no connector and can't be opened.
- The schema is read from **that project's own** environment (the one case where re-deriving
  the template's answer would be the wrong move), and an incompletely configured project
  fails with a message naming what is missing.

---

## 10. Sending

The design decision that makes the preview trustworthy:

> **Bodies are built once, in the same code the preview uses, and sent as they are.**

What an operator reads on screen is byte-for-byte what leaves the server. Rebuilding
server-side from the sheet would be two implementations of one mapping that can disagree.
What that puts on the **server** is *authorisation and consistency*, not construction:

- **Whitelist the connector.** The body arrives from the browser, so the connector name does
  too; check every record's `connector` against the set the module's stored mappings target
  (all variants), or an admin session becomes a way to POST any body to any UpdateConnector.
- **Verify insert-vs-update claims against AFAS.** The browser decides verb from the
  existence read it shows; the server re-reads keys and refuses the *whole request* if any
  `update` isn't a record AFAS actually holds (stale panel, switched stage). "Could not
  ask" is never treated as "none exist" — that would mark everything new and invite a full
  set of duplicates.
- **POST inserts, PUT updates, nothing invents an upsert.** Default is insert; an existing
  record is either shown-and-skipped or PUT, by an explicit mode.
- **Attempt every record; each reports for itself** with AFAS's own words, the key AFAS
  wrote, and a log reference. AFAS has no transaction across calls — stopping halfway would
  leave a half-loaded environment *and* no account of which half.
- **Sequential, capped** (AFAS rate-limits; a few hundred per request at most), stage
  (`test`/`live`) **required with no default anywhere in the path**.
- Carry each record's identity on screen (`ordinal`, source `rows`) so an outcome lands on
  its row rather than on whatever came back in that position.

AFAS validates and processes **one body as one transaction**, which is why the kop and its
regels are one call and why batching across records is not the tool's to make atomic.

---

## 11. Decisions and their reasons

| Decision | Why |
|---|---|
| Shape from `metainfo`, never from memory | AFAS payloads are unforgiving and connectors change; the schema *is* the spec. |
| Body root from `schema.name` | It is regularly not the connector id. |
| Key = `path#field` | Field ids aren't unique across objects; one column may feed many fields, but a field takes one value. |
| Column stored by index **and** header | Index reads; header re-points after the template changes. |
| Drop a mapping whose column vanished, and say so | Wrong-column values are silent and worse than missing ones. |
| Cells convert leniently, fixed values validate strictly | Cells are the client's; fixed values are typed now by someone who can fix them now. |
| Empty cell ⇒ omit the key | `""` on a PUT clears the field. |
| Resolver has three answers | *Not mine* / *mine, but nothing* / *here it is* are different instructions. |
| Extra sources are resolver decorators | Standard conversions stay byte-identical; nothing new leaks into `FieldSource`. |
| Grouping derived from where the key sits | No second control to keep in step; the page can always say what it made of it. |
| One renderer for editor, preview, send | What you looked at is what leaves. |
| Line-by-line rendering | Every line carries provenance; still valid JSON. |
| One file per mapping, server-stamped | Reviewable diffs; no browser clocks. |
| Unrouted rows and missing columns are *reported* | The finding is the point; dropping silently hides it. |
| Server re-verifies verbs and connectors | The browser is untrusted input. |

---

## 12. Reusing this in another app

### 12.1 What is generic vs what is yours

| Generic — copy as is | Specific — replace |
|---|---|
| schema types + `countSchema` / `filterSchema` / `objectPath` | how you obtain an AFAS token and call AFAS (`afas_request` + verb wrappers) |
| `fieldKey`, `FieldSource`, `remapToSheet`, `columnFields` | your **sheet** type (`headers`, `rows`, `rowNumbers`, `cellToString`) |
| `afasValue`, `parseFixedValue`, `fixedInputKind` | your date parser (must be the one your validation uses) |
| resolver contract, `fieldValues`, `withFills` | which environments exist and which is the template |
| `payloadLines` / `payloadJson` / `PayloadRepeat` | the storage backend (files here; a table works the same) |
| `groupShape` / `groupRows` / `groupDisagreements` | the module/variant plan data |
| variant routing (`variantOfRow`, plan shape) | UI strings, locale, admin gate |
| stored-document shape + save-time checks | existence-check connectors, if any |

### 12.2 Build order

1. **Environment-explicit AFAS client.** Every call takes an environment; no global default.
   Verb wrappers plus intent helpers (`get_metainfo`, `update_connector_metainfo`,
   `insert_record`, `update_record`). Return a result object that carries AFAS's own message.
2. **Schema proxy.** `metainfo` list + `metainfo/update/{connector}`, admin-gated, passed
   through unchanged, group → environment.
3. **Schema module.** Types, `fieldsOf`/`objectsOf`, `countSchema`, `filterSchema`,
   `objectPath`, `fieldTypeLabel`.
4. **Renderer.** `payloadLines`/`payloadJson` with *no resolver first* — a skeleton. Get the
   envelope, commas and root key right against a real connector before anything else.
5. **Mapping module.** `FieldSource`, `fieldKey`, `remapToSheet`, `afasValue`,
   `parseFixedValue`, `fieldValues`. Now the renderer produces real bodies for one row.
6. **Editor.** Connector list → schema tree → drag/click a column onto a field, or type a
   fixed value; live JSON with provenance notes; an example-row stepper; *only mapped* and
   *only mandatory* toggles; export the document.
7. **Store.** Document → file, save-time checks, server-stamped, list/delete.
8. **Bulk preview.** `buildModulePayloads(plan, contexts, sheet, scope)` — every record for the
   whole sheet, plus `unrouted` and `missingColumns`.
9. **Grouping and value maps** — only when a connector needs them; both are additive and
   leave every other mapping unchanged.
10. **Send.** Whitelist, verify verbs, per-record outcomes.

### 12.3 Pitfalls that already cost time

- Taking the body root from the URL instead of `schema.name`.
- Keying anything (expanded state, mapping, filter) by bare object name.
- Reading raw `columnIndex` without `remapToSheet` — wrong-column data with no error.
- Sending `""` for blank cells — clears fields on PUT.
- Using one placeholder for every type (`""` for an int) — the pasted skeleton is refused.
- Building the value index by parsing rendered JSON.
- A validation model that drops undeclared optional keys (`key`, `valueMap`).
- Trusting a stored `valueMap` — a raw value with no entry passes through untranslated, and
  the id→code pairs were true of the `metainfo` read that produced them. Re-check them
  against a fresh read before a real run; value lists can differ per environment.
- Two writers of the same body (preview vs send).
- Fixed dates and cell dates format differently (`…T00:00:00` vs a plain day). Both parse;
  pick one on purpose if you can.
- Mandatory in metainfo describes the **insert**; on a PUT only the key fields are
  mandatory. Don't block updates on it.
- Keys that AFAS pads (`000123`) against a sheet that doesn't — normalise both sides before
  matching existing records.

### 12.4 A minimal test checklist

Run the pure modules in Node with no browser:

- Skeleton for a connector whose root ≠ id, with a child that has no fields, and one that
  has no children → parses as JSON, no trailing commas.
- Mapped body: int/decimal/boolean/date/blank cells, comma decimals, a `31-02` date, a value
  with a `valueMap` entry and one without.
- `remapToSheet`: column same place, moved, gone; fixed values untouched.
- Group of three rows under one key → one kop, line `Element` an array of three, each with
  its own row's values; a kop column that disagrees is reported; a typo'd key column makes a
  second group.
- Split module with a row whose discriminator matches nothing → `unrouted`.
- Save a grouped mapping through the server model and read it back → `key`/`valueMap`
  survive.

---

## 13. Worked example

Connector `KnQuotation` (root `KnQuotation`, nested `KnQuotationLine`). Illustrative field
codes; types follow the schema.

**Mapping**

| Field key | Source |
|---|---|
| `KnQuotation#QuId` | column *Offerte* — `key` |
| `KnQuotation#PrId` | column *Projectnummer* — `key` |
| `KnQuotation.KnQuotationLine#VaIt` | column *Type item* — `valueMap {Wst→1, Art→2}` |
| `KnQuotation.KnQuotationLine#ItCd` | column *Itemcode* |
| `KnQuotation.KnQuotationLine#Begindatum` | column *Begindatum Regel* (date field) |

**Sheet**

| Offerte | Projectnummer | Type item | Itemcode | Begindatum Regel |
|---|---|---|---|---|
| Q-001 | P100 | Art | SG | 23-08-2026 |
| Q-001 | P100 | Wst | GB | *(blank)* |
| Q-002 | P100 | Art | GR | 01-09-2026 |

**Shape derived from the mapping:** `headerPath = KnQuotation`,
`linePath = KnQuotation.KnQuotationLine`, key columns *Projectnummer*, *Offerte* →
**2 records from 3 rows**.

**Record 1 (rows 2–3), scope `mapped`** — kop once from the first row, line as an array:

```json
{
  "KnQuotation": {
    "Element": {
      "Fields": {
        "QuId": "Q-001",
        "PrId": "P100"
      },
      "Objects": [
        {
          "KnQuotationLine": {
            "Element": [
              {
                "Fields": {
                  "VaIt": "2",
                  "ItCd": "SG",
                  "Begindatum": "2026-08-23"
                }
              },
              {
                "Fields": {
                  "VaIt": "1",
                  "ItCd": "GB"
                }
              }
            ]
          }
        }
      ]
    }
  }
}
```

Note the second line has **no `Begindatum` key** (blank cell → omitted), `Art`/`Wst` became
`2`/`1` through the value map, and `23-08-2026` became `2026-08-23`. Beside each line, the
preview shows the note that put the value there: `Offerte`, `Type item — "Art" translated`,
`Begindatum Regel — leeg`, and so on.

---

## Appendix — where each part lives in this repo

| Concern | File |
|---|---|
| Schema types, tree helpers, **renderer** (`payloadLines`, `PayloadRepeat`) | [frontend/src/lib/afas-schema.ts](../frontend/src/lib/afas-schema.ts) |
| Mapping model, `remapToSheet`, `afasValue`, `parseFixedValue`, `fieldValues`, grouping, export/import, store client | [frontend/src/lib/field-mapping.ts](../frontend/src/lib/field-mapping.ts) |
| Variants/plan, bulk build (`buildModulePayloads`), `withFills`, value index | [frontend/src/lib/module-payloads.ts](../frontend/src/lib/module-payloads.ts) |
| Per-customer copy client | [frontend/src/lib/client-mapping.ts](../frontend/src/lib/client-mapping.ts) |
| Editor (tree, drag/pick, fixed values, value maps, key toggle) | [frontend/src/components/afas/UpdateConnectorExplorer.tsx](../frontend/src/components/afas/UpdateConnectorExplorer.tsx), [SchemaObjectSection.tsx](../frontend/src/components/afas/SchemaObjectSection.tsx), [ExcelColumnsPanel.tsx](../frontend/src/components/afas/ExcelColumnsPanel.tsx) |
| Bulk preview and send UI | [frontend/src/components/uploader/ModulePayloadPanel.tsx](../frontend/src/components/uploader/ModulePayloadPanel.tsx) |
| AFAS client, envelope builders, `update_connector_metainfo` | [backend/afas.py](../backend/afas.py) |
| Schema proxy, mapping store, save-time checks, send route | [backend/main.py](../backend/main.py) (`CONNECTOR_GROUPS`, `_checked_mapping`, `_mapping_rows`, `send_payloads`) |
| Stored mappings (examples: `erp-voorcalculatie.json` grouped + `valueMap`, `erp-debiteuren-*.json` split) | [backend/json_files/mappings/modules/](../backend/json_files/mappings/modules/) |
| AFAS lookups (`lookup` on a column): table fetch, resolver, dialog | [backend/lookups.py](../backend/lookups.py), [frontend/src/lib/afas-lookup.ts](../frontend/src/lib/afas-lookup.ts), [AfasLookupDialog.tsx](../frontend/src/components/afas/AfasLookupDialog.tsx) |
| Existence checks behind insert-vs-update | [backend/existing.py](../backend/existing.py), [existing-records.md](existing-records.md) |
| The API itself (envelope, verbs, `@Action`, examples) | [AFAS-Profit-API-Referentie.md](AFAS-Profit-API-Referentie.md) §3–§4, §6 |
