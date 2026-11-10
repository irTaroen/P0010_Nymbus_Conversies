/**
 * Codetabel autofix — the half of the `codetabel` check that repairs what it can.
 *
 * Clients fill in `Nederland` where the template asks for `NL`, `30 dagen` for
 * `30`, `Gehuwd` for `GH`. Each names exactly one entry of the table the column is
 * checked against, and its code is the answer the value picker would offer anyway.
 * Flagging them red and making the user pick it, row by row, is asking for a
 * correction the tool can make itself.
 *
 * **Not a separate rule.** Whether a cell is wrong and which code it means are one
 * question, answered by one function: `codetabelVerdict` in engine.ts. The check
 * flags a cell when the verdict is invalid; this module writes the verdict's `code`
 * into the cell first, so every `codetabel` column in every module gets it with
 * nothing to switch on. The single exception is a property of the table, not of a
 * rule — `resolveNames: false` on the woonplaatsen in `codetabellen/sources.ts`.
 *
 * What resolves and what doesn't is the verdict's business (exact name match, one
 * entry only, within the row's scope); see its comment. Two things are this
 * module's:
 *
 * - **Order.** Unscoped columns are fixed first, so a cao written as its name is
 *   resolved before the arbeidsvoorwaarde scoped by it is judged.
 * - **What the user sees.** A fixed cell is an ordinary edit — it differs from the
 *   file, so it is marked edited, patched into the exported workbook and carried in
 *   the payload — it gets an amber notice naming what it was, and the
 *   validatierapport lists it. Both are **derived** rather than remembered
 *   ({@link recordAutofixes}): the original is
 *   still in the parsed sheet, so a restored draft shows it too, and it disappears
 *   by itself the moment the user types something else into the cell.
 *
 * **More repairs ride along**, declared per rule rather than per table: an
 * `enum` with `aliases` (`J`/`Ja` written for `1`), a `clear` rule, whose repair
 * is to empty the cell (`0` in *Min. uren/wk*), and a `split-huisnummer` rule,
 * which splits `17-19` into huisnummer `17` and toevoeging `-19` — the one repair
 * that writes two cells. Every `postcode` column also gets its whitespace
 * straightened (`1815  DG` → `1815 DG`), and every `date` column that wants a
 * whole day loses the time a datetime cell carries (`15-01-2017 22:59:59` →
 * `15-01-2017`), both with nothing to switch on. Same pass,
 * same notice, same report line; only the lookup differs.
 */

import {
  codetabelColumns,
  codetabelScope,
  codetabelVerdict,
  resolveColumn,
  type CodetabelColumn,
} from "./engine";
import { tr } from "@/lib/i18n";
import { RULE_SETS } from "./rules";
import { toDate, toNum } from "./checks";
import type { ColumnRules, RuleCheck, ValidationResult } from "./types";

/**
 * The code `value` should become in this row, or `null` when it is fine or can't be
 * resolved. `row` supplies the scope, so it must already carry any fix to the
 * scope column.
 */
function fixFor({ rule, scopeIdx }: CodetabelColumn, value: string, row: string[]): string | null {
  const text = value.trim();
  if (text === "") return null;
  const verdict = codetabelVerdict(rule, text, codetabelScope(rule, row, scopeIdx));
  return verdict.valid ? null : verdict.code;
}

/**
 * The allowed value an `enum` cell is another spelling of, or `null` when it is
 * already allowed or isn't listed in the rule's `aliases`. Case-insensitive, as
 * the enum check itself is.
 */
function aliasFor(rule: RuleCheck, value: string): string | null {
  const text = value.trim().toLowerCase();
  if (text === "" || rule.values?.some((v) => v.toLowerCase() === text)) return null;
  for (const [code, names] of Object.entries(rule.aliases ?? {})) {
    if (names.some((n) => n.toLowerCase() === text)) return code;
  }
  return null;
}

/**
 * `""` when a `clear` rule empties `value`, else `null`. Numbers compare as
 * numbers, so `0` matches `0,00` too.
 */
function clearFor(rule: RuleCheck, value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  const n = toNum(text);
  const hit = rule.values?.some(
    (v) => v.toLowerCase() === text.toLowerCase() || (n !== null && toNum(v) === n)
  );
  return hit ? "" : null;
}

/** A letter or digit — what a toevoeging has to hold to be one. */
const ALNUM = /[\p{L}\p{N}]/u;

/**
 * A huisnummer written with (part of) its toevoeging, as `[number, toevoeging]`,
 * where `toevoeging` is what the row's toevoeging cell should hold: the rest of
 * the huisnummer in front of what the cell (`toevoeging`) already says. `17-19` is
 * `["17", "-19"]`, `12 A` is `["12", "A"]`, and `250-` beside a toevoeging `252`
 * is `["250", "-252"]`. Two words are kept apart by a space (`12 a` + `bis` →
 * `a bis`), and a rest that is only a separator with nothing behind it is dropped
 * (`250-` alone → `250`, toevoeging still empty). `null` when `value` doesn't
 * start with a number or is nothing but one (`17`, and `17,5` is left to the type
 * check).
 */
function splitHuisnummer(value: string, toevoeging: string): [string, string] | null {
  const text = value.trim();
  if (toNum(text) !== null) return null;
  const match = /^(\d+)\s*(\S.*)$/.exec(text);
  if (!match) return null;
  const rest = match[2].trim();
  const kept = toevoeging.trim();
  const glue = ALNUM.test(rest.slice(-1)) && ALNUM.test(kept.charAt(0)) ? " " : "";
  const joined = rest + glue + kept;
  return [match[1], ALNUM.test(joined) ? joined : kept];
}

/**
 * `value` without leading or trailing whitespace and with every run inside it
 * collapsed to one space (`1815  DG` → `1815 DG`), or `null` when it already is.
 */
function spacedPostcode(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  return text === value ? null : text;
}

/**
 * Whether a column's `format` asks for a whole date and nothing more: every
 * alternative carries a day, a month and a four-digit year, and none a time.
 */
function wantsWholeDate(col: ColumnRules): boolean {
  if (col.type !== "date") return false;
  return (col.format ?? "DD-MM-YYYY")
    .split("|")
    .every((f) => /DD/.test(f) && /MM/.test(f) && /YYYY/.test(f) && !/HH|mm|ss/.test(f));
}

/** A time behind a date: ` 22:59`, ` 22:59:59`, `T22:59:59.000Z`, ` 10:59:59 PM`. */
const TIME_PART = String.raw`(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:[AaPp][Mm])?\s*(?:Z|[+-]\d{2}:?\d{2})?)?`;
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})` + TIME_PART + "$");
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})` + TIME_PART + "$");

/**
 * `value` as `dd-mm-yyyy` when it is a date in another shape — a datetime
 * (`15-01-2017 22:59:59`, what Excel hands over for a cell holding a time), the
 * ISO order (`2017-01-15`, `2017-01-15T22:59:59Z`), or single digits (`5-1-2017`)
 * — or `null` when the column's format already accepts it or it isn't a real day.
 * The time is dropped, not rounded: the day as written is the day sent. Day before
 * month, as everywhere in this tool.
 */
function wholeDate(value: string, format: string): string | null {
  const text = value.trim();
  if (text === "" || toDate(text, format) !== null) return null;
  const dayFirst = DAY_FIRST.exec(text);
  const yearFirst = dayFirst ? null : YEAR_FIRST.exec(text);
  if (!dayFirst && !yearFirst) return null;
  const [d, m, y] = dayFirst
    ? [dayFirst[1], dayFirst[2], dayFirst[3]]
    : [yearFirst![3], yearFirst![2], yearFirst![1]];
  const date = `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
  return toDate(date, "DD-MM-YYYY") === null ? null : date;
}

/** What the table's notice and the report say about one repaired cell. */
interface FixRecord {
  /** The value the report shows the cell came from. */
  from: string;
  message: string;
}

/**
 * One column the autofix repairs, with the repair for a cell of it. `row` is the
 * row as repaired so far (the codetabel scope), `source` the row before this pass
 * touched it — what a split reads, since by the time the toevoeging is filled its
 * huisnummer may already be split.
 */
interface FixableColumn {
  idx: number;
  fix: (value: string, row: string[], source: string[]) => string | null;
  /** The notice and report line for a repair; a rewrite to a code when absent. */
  describe?: (original: string, to: string, source: string[]) => FixRecord;
}

/**
 * The sheet's columns the autofix covers: every `codetabel` column (in
 * {@link codetabelColumns}' order, unscoped first), then every `enum` column with
 * `aliases`, every column with a `clear` or `postcode` rule, every whole-date
 * column, and both columns of every
 * `split-huisnummer` rule whose toevoeging column the sheet carries.
 */
function fixableColumns(moduleId: string, headers: string[]): FixableColumn[] {
  const columns: FixableColumn[] = codetabelColumns(moduleId, headers).map((column) => ({
    idx: column.idx,
    fix: (value, row) => fixFor(column, value, row),
  }));
  for (const col of RULE_SETS[moduleId]?.columns ?? []) {
    const alias = col.rules.find((r) => r.check === "enum" && r.aliases);
    const clear = col.rules.find((r) => r.check === "clear");
    const split = col.rules.find((r) => r.check === "split-huisnummer" && r.intoColumn);
    const postcode = col.rules.some((r) => r.check === "postcode");
    const date = wantsWholeDate(col);
    if (!alias && !clear && !split && !postcode && !date) continue;
    const idx = resolveColumn(headers, col.column);
    if (idx === null) continue;
    if (date) {
      const format = col.format ?? "DD-MM-YYYY";
      columns.push({
        idx,
        fix: (value) => wholeDate(value, format),
        describe: (original, to) => ({
          from: original,
          message: tr(
            `Automatisch aangepast: "${original}" is omgezet naar datum ${to}`,
            `Automatically changed: "${original}" is converted to date ${to}`
          ),
        }),
      });
    }
    if (alias) columns.push({ idx, fix: (value) => aliasFor(alias, value) });
    if (clear) columns.push({ idx, fix: (value) => clearFor(clear, value) });
    if (postcode) {
      columns.push({
        idx,
        fix: spacedPostcode,
        describe: (original, to) => ({
          from: original,
          message: tr(
            `Automatisch aangepast: overtollige spaties verwijderd uit "${original}", nu ${to}`,
            `Automatically changed: extra spaces removed from "${original}", now ${to}`
          ),
        }),
      });
    }
    const into = split ? resolveColumn(headers, split.intoColumn!) : null;
    if (into !== null) {
      const parts = (source: string[]) =>
        splitHuisnummer(source[idx] ?? "", source[into] ?? "");
      columns.push({
        idx,
        fix: (_value, _row, source) => parts(source)?.[0] ?? null,
        describe: (original, to, source) => {
          const toevoeging = parts(source)![1];
          return {
            from: original,
            message: toevoeging
              ? tr(
                  `Automatisch gesplitst: "${original}" is huisnummer ${to} met toevoeging ${toevoeging}`,
                  `Automatically split: "${original}" is house number ${to} with addition ${toevoeging}`
                )
              : tr(
                  `Automatisch aangepast: "${original}" is huisnummer ${to}`,
                  `Automatically changed: "${original}" is house number ${to}`
                ),
          };
        },
      });
      columns.push({
        idx: into,
        // Null when the toevoeging comes out as it was (`250-` beside an empty one).
        fix: (value, _row, source) => {
          const toevoeging = parts(source)?.[1];
          return toevoeging === undefined || toevoeging === value ? null : toevoeging;
        },
        describe: (original, to, source) => {
          const huisnummer = (source[idx] ?? "").trim();
          return {
            from: huisnummer,
            message: original
              ? tr(
                  `Automatisch aangevuld: toevoeging ${original} is ${to} geworden, met het deel uit huisnummer "${huisnummer}"`,
                  `Automatically completed: addition ${original} has become ${to}, with the part from house number "${huisnummer}"`
                )
              : tr(
                  `Automatisch aangevuld: toevoeging ${to} is gesplitst uit huisnummer "${huisnummer}"`,
                  `Automatically completed: addition ${to} was split from house number "${huisnummer}"`
                ),
          };
        },
      });
    }
  }
  return columns;
}

export interface AutofixResult {
  /** The grid with every fix applied — the same array when nothing was fixed. */
  cells: string[][];
  /** `"row:col"` of every cell rewritten, for the caller's dirty set. */
  fixed: string[];
}

/**
 * Rewrite every `codetabel` cell that holds a name instead of a code, and every
 * `enum` cell that holds one of its aliases, empty every cell a `clear` rule
 * names, and split every huisnummer written with its toevoeging.
 *
 * Pure: the input grid is not mutated, and when nothing needs fixing the very same
 * array comes back, so a caller can compare by identity to skip a state update.
 * A table that hasn't loaded yet fixes nothing (its verdict is "valid"), which is
 * why the uploader runs this again when the codetabellen arrive.
 */
export function applyAutofix(
  moduleId: string,
  headers: string[],
  cellData: string[][]
): AutofixResult {
  const columns = fixableColumns(moduleId, headers);
  if (columns.length === 0) return { cells: cellData, fixed: [] };

  const fixed: string[] = [];
  let cells = cellData;
  for (let r = 0; r < cellData.length; r++) {
    for (const column of columns) {
      const { idx } = column;
      const code = column.fix(cellData[r]?.[idx] ?? "", cells[r] ?? [], cellData[r] ?? []);
      if (code === null) continue;
      // Copy-on-write: the grid on the first fix, a row on its first fix.
      if (cells === cellData) cells = [...cellData];
      if (cells[r] === cellData[r]) cells[r] = [...cellData[r]];
      cells[r][idx] = code;
      fixed.push(`${r}:${idx}`);
    }
  }
  return { cells, fixed };
}

/**
 * Record every cell the autofix rewrote on `result`: in `autofixed` (what it was and
 * what it became, for the validatierapport) and as an amber notice in `notices`
 * (for the table).
 *
 * Recognised by comparing the grid with the file as read: a cell whose original
 * resolves by name to exactly what it holds now was fixed (by the autofix, or by
 * the user picking that same code — either way the remark is true). `originals`
 * is the parsed sheet's grid, as strings; a split reads its huisnummer there.
 *
 * Mutates `result` — a run the caller has just been handed and no one else holds yet.
 */
export function recordAutofixes(
  moduleId: string,
  headers: string[],
  originals: string[][],
  cellData: string[][],
  result: ValidationResult
): void {
  const { notices, autofixed } = result;
  for (const column of fixableColumns(moduleId, headers)) {
    const { idx } = column;
    for (let r = 0; r < cellData.length; r++) {
      const current = (cellData[r]?.[idx] ?? "").trim();
      const original = (originals[r]?.[idx] ?? "").trim();
      if (current === original) continue;
      // Scoped by the row as it is now — the scope the cell was fixed against.
      const source = originals[r] ?? [];
      const code = column.fix(original, cellData[r] ?? [], source);
      if (code === null || code.toUpperCase() !== current.toUpperCase()) continue;
      const key = `${r}:${idx}`;
      const { from, message } = column.describe?.(original, code, source) ?? {
        from: original,
        message:
          code === ""
            ? tr(
                `Automatisch aangepast: "${original}" is leeggemaakt`,
                `Automatically changed: "${original}" was cleared`
              )
            : tr(
                `Automatisch aangepast: "${original}" is omgezet naar code ${code}`,
                `Automatically changed: "${original}" was converted to code ${code}`
              ),
      };
      autofixed.set(key, { from, to: code });
      const list = notices.get(key);
      if (list) list.push(message);
      else notices.set(key, [message]);
    }
  }
}
