/**
 * Repairing a sheet's **columns** rather than its cells — an admin's answer to the
 * missing-column banner, for this upload only.
 *
 * A client's export regularly arrives with a column under its own name (`Naam` where
 * the rule set reads `Organisatie Naam`) or without columns the module needs at all
 * (`Organisatie of Persoon` on a sheet that only holds organisations). Validation
 * then skips every check on them, and the payload has nothing to send. Two repairs
 * close that gap:
 *
 * - **rename** — a sheet column nothing claims gets the expected name. Its values
 *   stay where they are; only the header changes.
 * - **add** — a new, empty column for the client to fill in, inserted where the
 *   module's template has it (see {@link insertionIndex}) rather than at the end.
 *
 * ### Per upload, on the file itself
 *
 * Nothing is remembered for the project. The client gets the corrected Excel back
 * as an attachment and goes on in that same file, so the repaired headers are in
 * the file they continue with, and a second upload of it no longer needs a repair.
 * That is why the export writes the headers into the client's own workbook (see
 * `applyHeaderEdits` in [excel.ts](./excel.ts)) instead of keeping them as a mapping
 * on the side.
 *
 * ### How it rides along: `dirtyKeys`
 *
 * A repaired header is marked in the same `dirtyKeys` set the cell edits use:
 * {@link headerKey} (`header:<col>`) for a renamed one, {@link addedKey}
 * (`added:<col>`) for an inserted one. Those keys do three jobs that would otherwise
 * each need wiring of their own: the export knows which header cells to write and
 * which columns to insert into the client's file, the unsaved-changes guard and the
 * autosave treat a repair as an edit, and the autosaved draft restores it, since the
 * draft already stores both the sheets and the keys. Every reader of `"row:col"`
 * keys skips them: they don't parse as two integers, and the grid never builds them.
 *
 * An insertion moves every column right of it one place, so it moves every key on
 * those columns with it ({@link shiftKeys}) — cell edits, renames and earlier
 * insertions alike. The export replays the insertions in ascending order, which
 * rebuilds exactly this layout from the original file.
 */

import { headerIndex, normalizeHeader } from "@/lib/headers";
import type { ParsedSheet } from "@/lib/excel";
import { RULE_SETS } from "@/lib/validation/rules";
import { conditionsOf, resolveColumn } from "@/lib/validation/engine";
import { primaryColumnName } from "@/lib/validation/checks";

/** The `dirtyKeys` entry that says the tool wrote header cell `col`. */
export function headerKey(col: number): string {
  return `header:${col}`;
}

/** The `dirtyKeys` entry that says grid column `col` was inserted by a repair. */
export function addedKey(col: number): string {
  return `added:${col}`;
}

function keyedColumns(dirtyKeys: Iterable<string>, pattern: RegExp): number[] {
  const cols: number[] = [];
  for (const key of dirtyKeys) {
    const m = pattern.exec(key);
    if (m) cols.push(Number(m[1]));
  }
  return cols.sort((a, b) => a - b);
}

/** The columns a repair inserted, ascending — the order the export replays them in. */
export function addedColumns(dirtyKeys: Iterable<string>): number[] {
  return keyedColumns(dirtyKeys, /^added:(\d+)$/);
}

/** Every header cell a repair wrote — renamed and inserted alike — ascending. */
export function editedHeaderColumns(dirtyKeys: Iterable<string>): number[] {
  return keyedColumns(dirtyKeys, /^(?:header|added):(\d+)$/);
}

/** `keys` with every column at or right of `at` moved one place right. */
function shiftKeys(keys: Set<string>, at: number): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const cell = /^(\d+):(\d+)$/.exec(key);
    const header = /^(header|added):(\d+)$/.exec(key);
    if (cell && Number(cell[2]) >= at) out.add(`${cell[1]}:${Number(cell[2]) + 1}`);
    else if (header && Number(header[2]) >= at) out.add(`${header[1]}:${Number(header[2]) + 1}`);
    else out.add(key);
  }
  return out;
}

/**
 * Where an added `column` belongs among `headers`: right after the nearest column
 * the module's template puts **before** it that the sheet has, else right before
 * the nearest one it puts after it, else at the end. The rule set lists the columns
 * in template order, so that order is the template's.
 *
 * Judged against the sheet as it stands, insertions so far included, so a run of
 * missing columns (`Voorletters`, `Voornaam`, `Voorvoegsel`) lands in order behind
 * the one before them instead of each claiming the same slot.
 */
export function insertionIndex(moduleId: string, headers: string[], column: string): number {
  const order = (RULE_SETS[moduleId]?.columns ?? []).map((c) => c.column);
  const at = order.findIndex((c) => headerIndex(Array.isArray(c) ? c : [c], column) !== -1);
  if (at === -1) return headers.length;
  for (let i = at - 1; i >= 0; i--) {
    const idx = resolveColumn(headers, order[i]);
    if (idx !== null) return idx + 1;
  }
  for (let i = at + 1; i < order.length; i++) {
    const idx = resolveColumn(headers, order[i]);
    if (idx !== null) return idx;
  }
  return headers.length;
}

/** One repair, as the admin chose it in the dialog. */
export type ColumnRepair =
  | { kind: "rename"; column: string; from: number }
  | { kind: "add"; column: string };

/**
 * Sheet columns no rule of the module claims, by index: the only ones a rename may
 * take. A column a rule already reads is spoken for, and renaming it would trade one
 * missing column for another.
 */
export function unclaimedColumns(moduleId: string, headers: string[]): number[] {
  const ruleSet = RULE_SETS[moduleId];
  if (!ruleSet) return headers.map((_, i) => i);
  const claimed = new Set<number>();
  const claim = (column: string | string[]) => {
    const idx = resolveColumn(headers, column);
    if (idx !== null) claimed.add(idx);
  };
  for (const col of ruleSet.columns) claim(col.column);
  for (const cf of ruleSet.crossField) {
    for (const side of [cf.if, cf.then]) {
      for (const c of conditionsOf(side)) {
        claim(c.column);
        if (typeof c.value === "object") claim(c.value.column);
      }
    }
    if (cf.flag) claim(cf.flag);
  }
  return headers.map((_, i) => i).filter((i) => !claimed.has(i));
}

/** Lower-cased words of a header, punctuation dropped: what a likeness is judged on. */
function words(name: string): string[] {
  return normalizeHeader(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The unclaimed sheet column that most likely *is* `column` under another name, or
 * `null` when nothing comes close. Only a suggestion: the dialog preselects it and
 * the admin confirms it, because a likeness is not proof (`Naam` may be a person's
 * full name as easily as an organisation's).
 *
 * A candidate counts when all of its words appear in the expected name or the other
 * way round (`Naam` ⊂ `Organisatie Naam`, `KvK` ⊂ `KvK-nummer`). The candidate
 * sharing the most words wins, then the shorter one, then the leftmost.
 */
export function suggestRename(
  column: string,
  headers: string[],
  candidates: number[]
): number | null {
  const target = words(column);
  if (target.length === 0) return null;
  let best: { idx: number; shared: number; length: number } | null = null;
  for (const idx of candidates) {
    const own = words(headers[idx] ?? "");
    if (own.length === 0) continue;
    const shared = own.filter((w) => target.includes(w)).length;
    const contained = shared === own.length || shared === target.length;
    if (shared === 0 || !contained) continue;
    if (
      !best ||
      shared > best.shared ||
      (shared === best.shared && own.length < best.length)
    ) {
      best = { idx, shared, length: own.length };
    }
  }
  return best?.idx ?? null;
}

/**
 * The sheet, its grid and its edit keys with `repairs` applied. Pure: returns new
 * objects, leaves the inputs alone.
 *
 * Renames first, then insertions: a rename's `from` is an index into the sheet as
 * the dialog showed it, which an insertion would move. Insertions go in template
 * order, each at its {@link insertionIndex}, empty — their parsed cells are `null`
 * because the file never held them, so a value typed into one later counts as an
 * edit like any other. A rename leaves the cells untouched and changes only the
 * header.
 *
 * A rename to a name the sheet already carries is skipped, as is an add of one:
 * two columns answering to the same name would leave the first one counting and
 * the second silently ignored (`headerIndex` returns the leftmost).
 */
export function applyColumnRepairs(
  moduleId: string,
  sheet: ParsedSheet,
  cellData: string[][],
  dirtyKeys: Set<string>,
  repairs: ColumnRepair[]
): { sheet: ParsedSheet; cellData: string[][]; dirtyKeys: Set<string> } {
  const headers = [...sheet.headers];
  const rows = sheet.rows.map((row) => [...row]);
  const cells = cellData.map((row) => [...row]);
  let keys = new Set(dirtyKeys);

  for (const repair of repairs) {
    if (repair.kind !== "rename" || headerIndex(headers, repair.column) !== -1) continue;
    if (repair.from < 0 || repair.from >= headers.length) continue;
    headers[repair.from] = repair.column;
    keys.add(headerKey(repair.from));
  }

  const order = (RULE_SETS[moduleId]?.columns ?? []).map((c) => primaryColumnName(c.column));
  const rank = (name: string) => {
    const i = headerIndex(order, name);
    return i === -1 ? order.length : i;
  };
  const adds = repairs
    .filter((r) => r.kind === "add")
    .sort((a, b) => rank(a.column) - rank(b.column));
  for (const repair of adds) {
    if (headerIndex(headers, repair.column) !== -1) continue;
    const col = insertionIndex(moduleId, headers, repair.column);
    keys = shiftKeys(keys, col);
    keys.add(addedKey(col));
    headers.splice(col, 0, repair.column);
    for (const row of rows) row.splice(col, 0, null);
    for (const row of cells) row.splice(col, 0, "");
  }

  return { sheet: { ...sheet, headers, rows }, cellData: cells, dirtyKeys: keys };
}
