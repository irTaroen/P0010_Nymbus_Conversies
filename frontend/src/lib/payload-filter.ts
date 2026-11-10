/**
 * Narrowing a module's payloads down to the records an admin actually wants to send.
 *
 * A sheet is the client's whole export — every debiteur they have — and a send is
 * regularly meant for a slice of it: the twelve rows that failed last time, one
 * administratie out of four, the crediteuren of a single land. Until now the only way
 * to say that was to untick the other four hundred boxes by hand, which is not a way
 * to say it.
 *
 * ### Why it filters on the payload, not on the sheet
 *
 * The obvious place for a filter is the grid, over the sheet's own columns. This one
 * sits on the payload view and reads **AFAS field codes** instead, because that is
 * the question being asked here: the records on this screen are bodies, the admin is
 * about to send them, and what they are checking against is what AFAS will receive —
 * a `valueMap` translation, a date turned ISO, a fixed value no column carries. A
 * filter on the raw cell would match the text *before* the mapping ran and quietly
 * disagree with the body beside it.
 *
 * It is also why a field names itself as `Debiteurnummer (DbId)`: the label is what
 * makes the list readable, the code is what makes it match the body on the right, and
 * an admin comparing the two needs both without having to hold a translation in their
 * head.
 *
 * ### What the filter is allowed to do
 *
 * It hides records, and hiding a record **excludes it from the send** — that is the
 * whole point, and it is the one thing about this feature that has to be impossible
 * to get wrong. So the rule is stated once, here, and the panel derives everything
 * (the counts, the tick boxes, the button's number) from `matchesFilters` rather than
 * keeping a second list: a record that is out of view is out of the send, always,
 * whatever its tick box remembers.
 *
 * Ticking is preserved rather than cleared while a record is hidden — the admin's
 * choice about a record is theirs and survives them narrowing the view and widening
 * it again — but it never resurrects a filtered-out record into a send.
 */

import type { ModulePayload } from "@/lib/module-payloads";

/**
 * One condition: a field, and the text it has to contain.
 *
 * `id` exists so a row can be edited and removed while its field is still unset —
 * React needs a stable key, and the field code is neither unique (two rows may filter
 * the same field) nor present on a fresh row.
 */
export interface PayloadFilter {
  id: string;
  /** The AFAS field code — `DbId`. Empty on a row the user hasn't chosen yet. */
  fieldId: string;
  /**
   * What the value must contain, case-insensitively — in the same small syntax as the
   * search box (`waarde1;waarde2`, `!waarde`; see {@link parseQuery}). Empty matches
   * everything.
   */
  query: string;
}

/** A blank condition, ready to be filled in. */
export function newFilter(): PayloadFilter {
  return {
    // `crypto.randomUUID` is in every browser this app supports and needs no import;
    // the id never leaves the page.
    id: crypto.randomUUID(),
    fieldId: "",
    query: "",
  };
}

/** Whether a condition says anything at all — a half-filled row filters nothing. */
export function isActive(filter: PayloadFilter): boolean {
  return filter.fieldId !== "" && !isEmptyQuery(parseQuery(filter.query));
}

/**
 * A query as the terms it is made of — AFAS's own quick-filter syntax, so an admin
 * who filters a list in Profit can type the same thing here:
 *
 * - `waarde1;waarde2` — **either** one (OF-filter): `acc;kantoor`.
 * - `!waarde` — the value does **not** contain it: `!enyoi`. Like in AFAS, an empty
 *   value never counts as "not containing" anything — see {@link matchesQuery}.
 *
 * Both can be combined, and then the includes are OR'ed and the excludes AND'ed:
 * `acc;kantoor;!eemland` is *acc or kantoor, but not eemland*. OR'ing an exclude
 * with the rest would make `!a;!b` pass nearly everything (only a value containing
 * both fails it), which is never what someone typing two exclusions meant.
 *
 * Blank terms (`acc;`, a lone `!`) drop out, so a query half-typed says no more
 * than what has been typed so far.
 */
interface ParsedQuery {
  include: string[];
  exclude: string[];
}

function parseQuery(query: string): ParsedQuery {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of query.split(";")) {
    const term = raw.trim().toLowerCase();
    if (term.startsWith("!")) {
      const rest = term.slice(1).trim();
      if (rest !== "") exclude.push(rest);
    } else if (term !== "") {
      include.push(term);
    }
  }
  return { include, exclude };
}

/** Whether a query says anything once parsed — `;` or `!` alone say nothing. */
function isEmptyQuery(parsed: ParsedQuery): boolean {
  return parsed.include.length === 0 && parsed.exclude.length === 0;
}

/**
 * Whether a set of values satisfies a parsed query: at least one value holds one of
 * the includes (when there are any), and no value holds any of the excludes.
 *
 * No values at all never matches — not even a pure exclude. That is AFAS's rule
 * ("het zoekresultaat zal nooit lege cellen bevatten") and the strict reading this
 * file already takes: `!x` asks for the records whose field says something other
 * than x, and a record that says nothing is not one of them.
 */
function matchesQuery(values: readonly string[], parsed: ParsedQuery): boolean {
  const filled = values.map((value) => value.toLowerCase()).filter((value) => value !== "");
  if (filled.length === 0) return false;
  const holds = (term: string) => filled.some((value) => value.includes(term));
  if (parsed.include.length > 0 && !parsed.include.some(holds)) return false;
  return !parsed.exclude.some(holds);
}

/**
 * Whether one record satisfies every active condition.
 *
 * **AND across rows, contains within a row.** Two conditions narrow — that is what a
 * second row is added for — while the text itself is a substring match rather than an
 * exact one, because an admin filtering on a debiteurnummer usually knows its prefix,
 * not the zero-padded whole (AFAS pads its keys; the sheet doesn't — see
 * docs/existing-records.md). Case is ignored for the same reason a variant's `match`
 * ignores it: a client's `nl` and AFAS's `NL` are the same answer.
 *
 * A record that simply hasn't got the field — an empty cell, or the other half of a
 * split module whose connector doesn't carry that code — does **not** match. That is
 * the strict reading, and it is the right one here: the admin asked for the records
 * where this field says something, and a record that says nothing is not one of them.
 */
export function matchesFilters(
  payload: ModulePayload,
  filters: readonly PayloadFilter[]
): boolean {
  return filters.every((filter) => {
    if (!isActive(filter)) return true;
    const values = payload.values.get(filter.fieldId);
    if (!values) return false;
    return matchesQuery(values, parseQuery(filter.query));
  });
}

/** The records that survive the conditions — what the panel shows and sends. */
export function applyFilters(
  payloads: readonly ModulePayload[],
  filters: readonly PayloadFilter[]
): ModulePayload[] {
  return payloads.filter((payload) => matchesFilters(payload, filters));
}

/**
 * Whether one record carries `query` in **any** of its fields — the search box over
 * the record list, for when the admin knows a value but not which field holds it.
 *
 * The same syntax and case rules as a condition ({@link parseQuery}), over all of
 * the record's values at once: `!x` hides a record where **any** field contains x,
 * `a;b` keeps one where any field contains either. And the same consequence: a
 * record the search hides is out of the send. An empty query matches everything.
 */
export function matchesSearch(payload: ModulePayload, query: string): boolean {
  const parsed = parseQuery(query);
  if (isEmptyQuery(parsed)) return true;
  return matchesQuery([...payload.values.values()].flat(), parsed);
}
