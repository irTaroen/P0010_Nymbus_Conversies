/**
 * What an AFAS **UpdateConnector** accepts, as AFAS itself describes it.
 *
 * `metainfo/update/{connector}` answers with the whole schema of a connector: every
 * field with its type, length, allowed values and whether it is mandatory, plus the
 * tree of nested objects underneath — and the **root key of the body**, which is
 * regularly *not* the connector name (`KnSubjectReaction` → `KnReaction`). The
 * backend serves it unchanged (`/api/afas/updateconnectors`), so what is on screen
 * is what AFAS said.
 *
 * This module holds the shape and the two things that are derived from it and
 * would otherwise be re-derived per component: what a subtree contains
 * (`countSchema`), and what is left of it under a filter (`filterSchema`).
 *
 * **The payload lines are the point of all this.** A module's payload has to be
 * built from the connector's own schema rather than from memory — CLAUDE.md's
 * *never guess AFAS payloads*. The envelope written here (`payloadLines` /
 * `payloadJson`) is the one `afas_envelope()` / `afas_element()` build in
 * [`backend/afas.py`](../../../backend/afas.py): `{ root: { Element: { Fields, Objects } } }`,
 * with `Objects` as a list. Keep the two in step.
 */

import { requestJson } from "@/lib/api";

/** One entry of a field's value list — AFAS's own code and its description. */
export interface AfasAllowedValue {
  id: string;
  description: string;
}

/** One field of an UpdateConnector, exactly as `metainfo/update` reports it. */
export interface AfasSchemaField {
  fieldId: string;
  label: string;
  /** `string`, `int`, `date`, `decimal`, `blob`, … — AFAS's own spelling. */
  dataType: string;
  mandatory: boolean;
  primaryKey: boolean;
  /** Maximum length; `0` where the type has none (a blob, a date). */
  length: number;
  decimals: number;
  notzero: boolean;
  /** AFAS's editor hint. Carried for completeness; nothing here reads it. */
  controlType: number;
  /** The values AFAS accepts, or `null` when the field is free-form. */
  values: AfasAllowedValue[] | null;
}

/**
 * An object in the payload tree: the root itself, or one of its nested objects.
 * Both arrays are optional — AFAS leaves them out rather than sending empties.
 */
export interface AfasSchemaObject {
  name: string;
  fields?: AfasSchemaField[] | null;
  objects?: AfasSchemaObject[] | null;
}

/** A whole connector: its id, what it is for, and its root object. */
export interface AfasUpdateSchema extends AfasSchemaObject {
  /** The connector as it is addressed: `KnSubjectReaction`. */
  id: string;
  description: string;
  /** **The root key of the body** — `KnReaction`, not the connector id. */
  name: string;
}

/** One line of the connector list: what `metainfo` says exists. */
export interface AfasConnectorSummary {
  id: string;
  description: string;
}

/** Which AFAS environment answered — the same connector can differ per environment. */
export interface AfasSchemaEnvironment {
  host: string;
  omgeving: string;
  stage: string;
  label: string;
  /** AFAS naming itself: `envid`, `appName`, `group`, `tokenExpiry`. */
  info: Record<string, string>;
}

/**
 * One category of connectors, and the environment behind it. There are two, and the
 * split is not cosmetic — it is which AFAS answers:
 *
 *   `nymbus`   Nymbus's **live** environment (app connector *NymbusConversies*): the
 *              dossier and workflow connectors the tool writes through itself, and
 *              where a client's sheets and figures are delivered.
 *   `modules`  Omgeving **38690** (Multiclean), **live**: the conversion
 *              connectors a module's sheet is mapped onto.
 *
 * The module connectors are read from one fixed environment rather than from the
 * customer they eventually write to because that environment is the **template** —
 * every customer environment is a copy of the same inrichting, so the schema is the
 * same everywhere and a mapping made once against the template is the mapping for all
 * of them. That template is a customer's environment for now; it moves back to a
 * Nymbus-owned one once that catches up (`MODULE_TEMPLATE_OMGEVING` in
 * `backend/main.py`).
 *
 * The same connector name can appear in both groups and mean a different schema, which
 * is why a connector is addressed as group + id everywhere below.
 *
 * `message` is AFAS's own reason when this group couldn't be read; the other group
 * is unaffected, since they come from different environments.
 */
export interface AfasConnectorGroup {
  id: string;
  label: string;
  environment: AfasSchemaEnvironment;
  connectors: AfasConnectorSummary[];
  message: string;
}

/** Every UpdateConnector, per group, with the environment each group came from. */
export async function fetchUpdateConnectors(): Promise<AfasConnectorGroup[]> {
  const data = await requestJson<{ groups: AfasConnectorGroup[] }>(
    "/api/afas/updateconnectors",
    undefined,
    "De AFAS-connectoren konden niet worden opgehaald."
  );
  return data.groups;
}

/**
 * Schemas already fetched this session, and the ones in flight, keyed
 * `group/connector` — the address itself, so two callers asking for the same
 * connector cannot disagree about what they asked for.
 *
 * A schema is the **shape** of a connector, not anybody's data: it has no project
 * in it, which is why one session-wide map is safe here where the codetabellen need
 * a per-project key. It changes when AFAS ships a release, so a session is a
 * reasonable lifetime; the backend holds its own TTL'd copy behind this
 * (`_schema_cache` in main.py) for the reloads this one doesn't cover.
 *
 * Worth caching because it is big and slow — `KnEmployee` is ~850 KB and the better
 * part of a second — and because `ModulePayloadPanel` is mounted conditionally on
 * the *Payloads* tab, so without this every flip between *Data* and *Payloads*
 * re-fetched the lot.
 *
 * The in-flight map is what stops a split module's two variants, or a fast
 * tab-flip, from starting the same request twice: the second caller awaits the
 * first's promise. A failure is **not** kept — the entry is dropped in `finally`
 * unless it resolved — so an error is retried on the next mount rather than being
 * remembered for the session.
 */
const schemaCache = new Map<string, AfasUpdateSchema>();
const schemaInflight = new Map<string, Promise<AfasUpdateSchema>>();
/**
 * Bumped by every {@link forgetUpdateSchema}: a request already in flight when the
 * cache was dropped answers with what AFAS said *before*, and must not be stored
 * as though it were the re-read the forget asked for.
 */
let schemaGeneration = 0;

/**
 * One connector's whole schema. The group decides which environment is asked, so it
 * is part of the address rather than a hint. Throws an `ApiError` carrying AFAS's
 * own words.
 *
 * Cached per `group/connector` for the session — see {@link schemaCache}.
 */
export async function fetchUpdateSchema(
  group: string,
  connector: string
): Promise<AfasUpdateSchema> {
  const key = `${group}/${connector}`;
  const held = schemaCache.get(key);
  if (held) return held;
  const current = schemaInflight.get(key);
  if (current) return current;

  const generation = schemaGeneration;
  const promise: Promise<AfasUpdateSchema> = requestJson<{ schema: AfasUpdateSchema }>(
    `/api/afas/updateconnectors/${encodeURIComponent(group)}/${encodeURIComponent(connector)}`,
    undefined,
    `De opbouw van ${connector} kon niet worden opgehaald.`
  )
    .then((data) => {
      if (generation === schemaGeneration) schemaCache.set(key, data.schema);
      return data.schema;
    })
    .finally(() => {
      if (schemaInflight.get(key) === promise) schemaInflight.delete(key);
    });

  schemaInflight.set(key, promise);
  return promise;
}

/**
 * Drop the cached schemas so the next read re-asks the backend.
 *
 * For the mapping editor: saving a mapping doesn't change a schema, but an admin who
 * has just changed something *in AFAS* needs a way to see it without reloading the
 * tab. Without an argument it clears the lot.
 */
export function forgetUpdateSchema(group?: string, connector?: string): void {
  schemaGeneration += 1;
  if (group === undefined || connector === undefined) {
    schemaCache.clear();
    schemaInflight.clear();
    return;
  }
  schemaCache.delete(`${group}/${connector}`);
  schemaInflight.delete(`${group}/${connector}`);
}

/** An object's own fields — `[]` where AFAS left the key out. */
export function fieldsOf(object: AfasSchemaObject): AfasSchemaField[] {
  return object.fields ?? [];
}

/** An object's direct child objects — `[]` where AFAS left the key out. */
export function objectsOf(object: AfasSchemaObject): AfasSchemaObject[] {
  return object.objects ?? [];
}

/** What a subtree holds, including everything nested under it. */
export interface SchemaCounts {
  fields: number;
  mandatory: number;
  objects: number;
}

/** Totals over a whole subtree — what a section header reports before it is opened. */
export function countSchema(object: AfasSchemaObject): SchemaCounts {
  const fields = fieldsOf(object);
  return objectsOf(object).reduce<SchemaCounts>(
    (total, child) => {
      const nested = countSchema(child);
      return {
        fields: total.fields + nested.fields,
        mandatory: total.mandatory + nested.mandatory,
        objects: total.objects + nested.objects + 1,
      };
    },
    {
      fields: fields.length,
      mandatory: fields.filter((field) => field.mandatory).length,
      objects: 0,
    }
  );
}

/**
 * The key an object is expanded under: its place in the tree rather than its name,
 * since one name occurs at several places (`KnReactionAttachment` hangs under both
 * reaction connectors) and two identically named sections must open separately.
 */
export function objectPath(parent: string, name: string): string {
  return parent ? `${parent}.${name}` : name;
}

/** A field's type as one string: `string (20)`, `decimal (11,2)`, `blob`. */
export function fieldTypeLabel(field: AfasSchemaField): string {
  const type = field.dataType || "onbekend";
  if (field.decimals > 0) return `${type} (${field.length},${field.decimals})`;
  return field.length > 0 ? `${type} (${field.length})` : type;
}

/** How the tree is narrowed: by a search term, to the mandatory fields, or both. */
export interface SchemaFilter {
  query: string;
  onlyMandatory: boolean;
  /**
   * An extra test a field has to pass, given its object's path — how the payload
   * view narrows to the **mapped** fields without this module having to know what a
   * mapping is. Objects are kept for what survives underneath them, so a field two
   * levels down keeps the objects it lives in.
   */
  keepField?: (objectPath: string, field: AfasSchemaField) => boolean;
  /**
   * An extra test a whole **object** has to pass, by its path — how a phase drops
   * the objects it doesn't write ([`module-phases.ts`](./module-phases.ts)).
   *
   * Unlike `keepField`, a failure here removes the subtree outright: phase 2 of a
   * medewerker sends four dated objects and must not carry the person and the address
   * along, and pruning those field by field would leave an empty `KnPerson` in the
   * body rather than no `KnPerson` at all. The root is never asked — it carries the
   * record's key and there is no body without it.
   */
  keepObject?: (objectPath: string) => boolean;
}

/** Does this field answer the search? Its code, its label or one of its values. */
function fieldMatches(field: AfasSchemaField, needle: string): boolean {
  if (field.fieldId.toLowerCase().includes(needle)) return true;
  if (field.label.toLowerCase().includes(needle)) return true;
  return (field.values ?? []).some(
    (value) =>
      value.id.toLowerCase().includes(needle) ||
      value.description.toLowerCase().includes(needle)
  );
}

/**
 * The subtree that survives the filter, or `null` when nothing does. An object is
 * kept for the fields and children it has left — so an empty section never stands
 * in the way of the one the reader searched for.
 *
 * **An object whose own name matches keeps its whole subtree**: searching for
 * `KnReactionAttachment` is asking what that object holds, not which of its fields
 * happen to repeat its name. That is what clearing the query on the way down does.
 */
function filterObject(
  object: AfasSchemaObject,
  path: string,
  filter: SchemaFilter
): AfasSchemaObject | null {
  const needle = filter.query.trim().toLowerCase();
  const nameMatches = needle !== "" && object.name.toLowerCase().includes(needle);
  const inner = nameMatches ? { ...filter, query: "" } : filter;

  const fields = fieldsOf(object).filter(
    (field) =>
      (!filter.onlyMandatory || field.mandatory) &&
      (filter.keepField?.(path, field) ?? true) &&
      (needle === "" || nameMatches || fieldMatches(field, needle))
  );
  const objects = objectsOf(object)
    .filter((child) => filter.keepObject?.(objectPath(path, child.name)) ?? true)
    .map((child) => filterObject(child, objectPath(path, child.name), inner))
    .filter((child): child is AfasSchemaObject => child !== null);

  if (fields.length === 0 && objects.length === 0) return null;
  return { ...object, fields, objects };
}

/** `filterObject` for a whole connector — the root keeps its id and description. */
export function filterSchema(
  schema: AfasUpdateSchema,
  filter: SchemaFilter
): AfasUpdateSchema | null {
  const filtered = filterObject(schema, schema.name, filter);
  return filtered ? { ...schema, fields: filtered.fields, objects: filtered.objects } : null;
}

/**
 * A placeholder of the right JSON type for a field, so the skeleton can be pasted
 * into a call and filled in rather than retyped. It is an **example**, never a
 * value to send as it stands — a mandatory field is as empty here as an optional one.
 */
function placeholderFor(field: AfasSchemaField): string | number | boolean {
  const type = field.dataType.toLowerCase();
  if (type === "int" || type === "decimal") return 0;
  if (type === "boolean" || type === "bool") return false;
  // AFAS reads and writes a date as `yyyy-mm-ddThh:mm:ss`; a real one is more use
  // in a pasted body than a format string it would refuse.
  if (type.startsWith("date")) return "2026-01-01T00:00:00";
  // string, blob and anything AFAS adds later. A blob carries base64 (`afas_file()`).
  return "";
}

/**
 * What filled a field, in a few words — the sheet column, for the mapping. Shown
 * beside the line in the payload view, never inside the JSON itself: a body with a
 * comment in it is not a body AFAS would take.
 */
type ValueNote = string;

/** A value for a field, and where it came from — or that it belongs in no body. */
export type ResolvedValue =
  | { omit?: false; value: string | number | boolean | null; note?: ValueNote }
  | {
      /**
       * Leave this field out of `Fields` entirely — a different answer from
       * `undefined`, which says *this resolver doesn't fill this field* and keeps the
       * placeholder standing. What needs it is a mapped column whose cell is empty:
       * on a PUT an empty value **clears** the field it is sent for
       * ([referentie](./../../docs/AFAS-Profit-API-Referentie.md) §4), so a body that
       * carries `""` for every blank cell empties half a record it was only meant to
       * add to.
       */
      omit: true;
      note?: ValueNote;
    };

/**
 * What a field is worth in the body. Answering `undefined` leaves the placeholder
 * standing, so a resolver only has to know about the fields it actually fills —
 * which is what the column mapping does with a sheet's values
 * ([`field-mapping.ts`](./field-mapping.ts)). Answering `{ omit: true }` is the third
 * case: a field the resolver *does* own and which this body must not carry at all.
 */
export type FieldValueResolver = (
  objectPath: string,
  field: AfasSchemaField
) => ResolvedValue | undefined;

/**
 * One line of the rendered body: its JSON text, and what put the value there.
 *
 * The body is written line by line rather than through `JSON.stringify` for exactly
 * one reason — a line has to be able to carry that note. The text itself is still
 * JSON: every key and every value goes through `JSON.stringify`, only the braces and
 * commas are written here, and `payloadJson()` joins the lines back into a document
 * that parses.
 */
export interface PayloadLine {
  text: string;
  note?: string;
}

/**
 * One object of the body written **once per row of a group** instead of once.
 *
 * A flat sheet where several rows make one record (a voorcalculatie-offerte and its
 * regels — see *Grouping* in [`field-mapping.ts`](./field-mapping.ts)) needs the
 * repeated half rendered as AFAS's own array form: `"Element": [ {…}, {…} ]` under
 * the sub-object, the shape `FbSales` → `FbSalesLines` uses in
 * docs/AFAS-Profit-API-Referentie.md §3.2 and §6.3. Everything above the repeated
 * object is written once, from the group's first row.
 *
 * `resolveAt(i)` is the caller's row-*i* resolver, which is what makes each element
 * carry its own row's values — the same `fieldValues()` the ungrouped body uses, once
 * per row, rather than a second way of reading a sheet.
 */
export interface PayloadRepeat {
  /** The object path whose `Element` becomes an array — `KnQuotation.KnQuotationLine`. */
  path: string;
  /** How many elements: one per row of the group. */
  count: number;
  resolveAt: (index: number) => FieldValueResolver | undefined;
}

const INDENT = "  ";

function line(depth: number, text: string, note?: string): PayloadLine {
  return { text: INDENT.repeat(depth) + text, note };
}

/**
 * Blocks in sequence, with a comma on the last line of every block but the last —
 * the one thing hand-written JSON gets wrong. Empty blocks drop out first, so an
 * object without nested objects doesn't leave a trailing comma behind.
 */
function commaJoin(blocks: PayloadLine[][]): PayloadLine[] {
  const filled = blocks.filter((block) => block.length > 0);
  return filled.flatMap((block, index) =>
    index === filled.length - 1
      ? block
      : block.map((entry, i) =>
          i === block.length - 1 ? { ...entry, text: `${entry.text},` } : entry
        )
  );
}

/**
 * AFAS's `@Action` for the object at a path, or undefined for none — see
 * {@link payloadLines}.
 */
export type PayloadAction = (path: string) => string | undefined;

/** What the payload line beside an `@Action` says it does. */
const ACTION_NOTES: Record<string, string> = {
  insert: "nieuw record",
  update: "bijwerken",
  delete: "verwijderen",
};

/**
 * `"Fields": { … }` — one line per field, each with its value and its origin.
 *
 * `actionOf` prepends AFAS's `@Action` property (docs/AFAS-Profit-API-Referentie.md
 * §4.1), which is how a PUT says *add this nested record* rather than *update the one
 * already there*. It is written **first** because it is a directive about the block
 * rather than a value in it, and a reader scanning the body should meet it before the
 * fields it governs.
 */
function fieldsLines(
  object: AfasSchemaObject,
  path: string,
  depth: number,
  resolve?: FieldValueResolver,
  actionOf?: PayloadAction
): PayloadLine[] {
  const action = actionOf?.(path);
  const directive = action
    ? [[line(depth + 1, `"@Action": ${JSON.stringify(action)}`, ACTION_NOTES[action])]]
    : [];
  const entries = fieldsOf(object).flatMap((field) => {
    const resolved = resolve?.(path, field);
    if (resolved?.omit) return [];
    const value = resolved === undefined ? placeholderFor(field) : resolved.value;
    return [
      [
        line(
          depth + 1,
          `${JSON.stringify(field.fieldId)}: ${JSON.stringify(value)}`,
          resolved?.note
        ),
      ],
    ];
  });
  const all = [...directive, ...entries];
  // An object with no fields, and one whose every mapped cell is empty, both still
  // write the key: the envelope's shape is AFAS's to state, not ours to prune.
  if (all.length === 0) return [line(depth, `"Fields": {}`)];
  return [line(depth, `"Fields": {`), ...commaJoin(all), line(depth, `}`)];
}

/**
 * `"Objects": [ … ]` — each child wrapped in its own `{ name: { Element } }`, except
 * the one `repeat` names, whose `Element` is an **array** with one entry per row of
 * the group (`PayloadRepeat`).
 *
 * The repeat is not passed on into the elements it produces: inside one of them the
 * row is already decided, and each element's own resolver carries it the rest of the
 * way down. One level of repetition is all a flat sheet can state — one row is one
 * regel, so whatever hangs under a regel has at most one of itself per row.
 */
function objectsLines(
  object: AfasSchemaObject,
  path: string,
  depth: number,
  resolve?: FieldValueResolver,
  repeat?: PayloadRepeat,
  actionOf?: PayloadAction
): PayloadLine[] {
  const children = objectsOf(object);
  if (children.length === 0) return [];
  const blocks = children.flatMap((child): PayloadLine[][] => {
    const childPath = objectPath(path, child.name);
    // An object whose every field the resolver omitted, and which has nothing nested
    // under it either, is left out altogether rather than written as an empty
    // `Fields: {}`.
    //
    // The schema is filtered once per build and shared by every record of a variant,
    // so an object that applies to **some** records has to stay in the tree; a phase
    // says "not this record" by omitting its fields (`conditionalObjects` in
    // [`module-phases.ts`](./module-phases.ts)). Without this the body would carry
    // `{"AfasPeriodiek": {"Element": {"Fields": {}}}}` for an employee who has no
    // periodiek — an object AFAS is being asked to create with no content.
    //
    // Only when a `resolve` is present: a **skeleton** has no resolver and is meant
    // to show the connector's whole shape, empty objects included.
    if (resolve && !(repeat && repeat.path === childPath) && isEmptyElement(child, childPath, resolve)) {
      return [];
    }
    if (repeat && repeat.path === childPath) {
      const elements = Array.from({ length: Math.max(repeat.count, 0) }, (_, index) => [
        line(depth + 4, `{`),
        ...elementLines(child, childPath, depth + 5, repeat.resolveAt(index), undefined, actionOf),
        line(depth + 4, `}`),
      ]);
      return [[
        line(depth + 1, `{`),
        line(depth + 2, `${JSON.stringify(child.name)}: {`),
        line(depth + 3, `"Element": [`),
        ...commaJoin(elements),
        line(depth + 3, `]`),
        line(depth + 2, `}`),
        line(depth + 1, `}`),
      ]];
    }
    return [[
      line(depth + 1, `{`),
      line(depth + 2, `${JSON.stringify(child.name)}: {`),
      line(depth + 3, `"Element": {`),
      ...elementLines(child, childPath, depth + 4, resolve, repeat, actionOf),
      line(depth + 3, `}`),
      line(depth + 2, `}`),
      line(depth + 1, `}`),
    ]];
  });
  return [line(depth, `"Objects": [`), ...commaJoin(blocks), line(depth, `]`)];
}

/**
 * Whether this object would render with no fields **and** no non-empty children —
 * the test {@link objectsLines} drops an object on. Recursive, so a parent whose only
 * child is itself empty is empty too.
 */
function isEmptyElement(
  object: AfasSchemaObject,
  path: string,
  resolve: FieldValueResolver
): boolean {
  const hasField = fieldsOf(object).some((field) => !resolve(path, field)?.omit);
  if (hasField) return false;
  return objectsOf(object).every((child) =>
    isEmptyElement(child, objectPath(path, child.name), resolve)
  );
}

/** The contents of one `Element`: its fields, then its objects. */
function elementLines(
  object: AfasSchemaObject,
  path: string,
  depth: number,
  resolve?: FieldValueResolver,
  repeat?: PayloadRepeat,
  actionOf?: PayloadAction
): PayloadLine[] {
  return commaJoin([
    fieldsLines(object, path, depth, resolve, actionOf),
    objectsLines(object, path, depth, resolve, repeat, actionOf),
  ]);
}

/**
 * The body this connector describes, line by line: the root key AFAS reported, one
 * `Fields` entry per field and one `Objects` entry per nested object. Feed it a
 * filtered schema and the body narrows with it — which is how *alleen verplicht*
 * turns into the smallest payload the connector will take.
 *
 * Without a `resolve` it is a **skeleton**: every value a placeholder of the right
 * type. With one it is a real body for the fields that resolver knows — the column
 * mapping's, which reads them out of a row of the sheet and says which column each
 * one came from in the line's `note`.
 *
 * With a `repeat` it is a body for a whole **group** of rows rather than one row: the
 * object it names is written as an array, one element per row (`PayloadRepeat`). That
 * is what makes a grouped mapping inspectable — three regels under one offerte, on
 * screen, instead of a key flag whose effect you have to take on faith.
 */
export function payloadLines(
  schema: AfasUpdateSchema,
  resolve?: FieldValueResolver,
  repeat?: PayloadRepeat,
  /**
   * AFAS's per-object `@Action` (docs/AFAS-Profit-API-Referentie.md §4.1): `insert`
   * on the **nested** objects of a PUT, so it adds a dated record beside the one
   * already there instead of overwriting it, with `update` on the root that carries
   * the key. Used by a module's second phase
   * ([`module-phases.ts`](./module-phases.ts)); omitted for every ordinary body.
   *
   * Or a function naming the action **per object path**, for a body where the
   * nested objects don't all want the same one — a *Herstellen* send
   * ([`repair-send.ts`](./repair-send.ts)) adds a salary while updating the address.
   */
  action?: { root: string; nested: string } | PayloadAction
): PayloadLine[] {
  const actionOf: PayloadAction | undefined =
    typeof action === "function"
      ? action
      : action
        ? (path) => (path === schema.name ? action.root : action.nested)
        : undefined;
  return [
    line(0, `{`),
    line(1, `${JSON.stringify(schema.name)}: {`),
    line(2, `"Element": {`),
    ...commaJoin([
      fieldsLines(schema, schema.name, 3, resolve, actionOf),
      objectsLines(schema, schema.name, 3, resolve, repeat, actionOf),
    ]),
    line(2, `}`),
    line(1, `}`),
    line(0, `}`),
  ];
}

/** Those lines as the document itself — what a copy button hands over. */
export function payloadJson(lines: PayloadLine[]): string {
  return lines.map((entry) => entry.text).join("\n");
}
