/**
 * Validation engine. `validateSheet` runs a module's rule set against the
 * table's headers + cell strings and returns issues keyed by "row:col".
 *
 * The engine is generic; all per-module rules live as data in `rules/`. Cells
 * are strings (the table holds editable text), so numeric/date checks parse.
 */

import {
  columnIsChecked,
  primaryColumnName,
  runCheck,
  runTypeCheck,
  toDate,
  toNum,
} from "./checks";
import { RULE_SETS } from "./rules";
import {
  NO_STANDARD_FILLS,
  type StandardColumnFills,
} from "@/lib/standard-columns";
import { headerIndex } from "@/lib/headers";
import { localized, tr } from "@/lib/i18n";
import {
  codetabelCoversScope,
  codetabelHasCode,
  codetabelHasCodeInScope,
  codetabelIsLoaded,
  codetabelCodeForName,
  codetabelCodeForNameInScope,
} from "./codetabellen";
import { existingRecordConflicts } from "./afas-records";
import type {
  ColumnRules,
  CrossFieldCondition,
  CrossFieldSide,
  Issue,
  RuleCheck,
  ValidationResult,
} from "./types";

/**
 * Resolve a column name (or any of its synonyms) to a header index, or null.
 *
 * Matched case-insensitively (`lib/headers.ts`): the rule set spells a column the way
 * we do, the sheet the way the client does, and `Org. Eenheid` is not a column we
 * haven't got. A synonym list is still tried in order, so the primary name wins when
 * a sheet carries two of them.
 */
export function resolveColumn(headers: string[], column: string | string[]): number | null {
  const names = Array.isArray(column) ? column : [column];
  for (const n of names) {
    const i = headerIndex(headers, n);
    if (i !== -1) return i;
  }
  return null;
}

/**
 * The scope a scoped `codetabel` rule narrows its list to for one row: the value
 * of the rule's `scopeColumn` in that row, falling back to `scopeDefault` when
 * the column is empty or absent from the sheet. Empty string for an unscoped
 * rule — and for a scoped one that resolved to nothing.
 *
 * Split out from the check itself because the resolved scope outlives it: it
 * rides along on the issue, so the table can offer the same narrowed list the
 * check judged the cell against.
 */
export function codetabelScope(
  rule: RuleCheck,
  row: string[],
  scopeIdx: number | null | undefined
): string {
  if (!rule.scopeColumn) return "";
  const cell = scopeIdx == null ? "" : (row[scopeIdx] ?? "").trim();
  return cell || rule.scopeDefault || "";
}

/** One `codetabel` column of a sheet, resolved against its headers. */
export interface CodetabelColumn {
  idx: number;
  rule: RuleCheck;
  /** Header index of the rule's `scopeColumn`; `null` for unscoped or absent. */
  scopeIdx: number | null;
}

/**
 * The sheet's `codetabel` columns — the one answer to "which columns are checked
 * against a codetabel", shared by the autofix and by the table's value-picker
 * button, so both cover exactly the columns the check does.
 *
 * Unscoped first, so a caller walking a row in this order (the autofix) settles a
 * scope column before the columns that read it.
 */
export function codetabelColumns(moduleId: string, headers: string[]): CodetabelColumn[] {
  const ruleSet = RULE_SETS[moduleId];
  if (!ruleSet) return [];
  const columns: CodetabelColumn[] = [];
  for (const col of ruleSet.columns) {
    const rule = col.rules.find((r) => r.check === "codetabel");
    if (!rule?.tableRef) continue;
    const idx = resolveColumn(headers, col.column);
    if (idx === null) continue;
    const scopeIdx = rule.scopeColumn ? resolveColumn(headers, rule.scopeColumn) : null;
    columns.push({ idx, rule, scopeIdx });
  }
  return columns.sort((a, b) => Number(!!a.rule.scopeColumn) - Number(!!b.rule.scopeColumn));
}

/**
 * What the `codetabel` check says about one value — the **one** function behind
 * both the check and the autofix that repairs it (`autofix.ts`), so the two can't
 * disagree about which cells are wrong.
 *
 * - `{ valid: true }` — a code in the table, or nothing to judge against.
 * - `{ valid: false, code }` — not a code, but exactly one entry's **omschrijving**
 *   (`Nederland` for `NL`; within the row's scope for a scoped rule). `code` is
 *   what the cell should hold; the autofix writes it in before validation runs.
 * - `{ valid: false, code: null }` — wrong, and nothing to resolve it to. The
 *   user's to fix, with the value picker.
 */
export type CodetabelVerdict =
  | { valid: true }
  | { valid: false; code: string | null };

const VALID: CodetabelVerdict = { valid: true };

/**
 * The `codetabel` check: is the value a code in the referenced table — and if not,
 * which code does it name? Valid whenever there is nothing to check it against.
 *
 * **An absent table passes.** Codetabellen are fetched from the client's own AFAS
 * (see `codetabellen/registry.ts`) and there are no bundled snapshots, so a table
 * is genuinely missing whenever no environment could serve it — a project whose
 * credentials aren't filled in yet, AFAS down. Judging a column against an empty
 * table would mark *every* value in it wrong, which is the worst of the three
 * possible answers; the honest one is to leave the column unchecked and say so
 * (the help drawer shows a *niet gecontroleerd* badge).
 *
 * With `scopeColumn` the table is narrowed to one scope — a woonplaats is only
 * valid within its land — resolved by `codetabelScope` above. Two further cases
 * deliberately pass: an empty scope (the scope column has its own rules; without
 * a land there is no table to compare against) and a scope the table holds no
 * entries for (a table covering only NL shouldn't flag every Belgian town).
 *
 * A name resolves only by an exact match (bar case, accents and whitespace), only
 * when one entry carries it, and only within the scope the code would have to be
 * valid in — see `codetabelCodeForName` in the store. A guess here would go to
 * AFAS without anyone seeing it, so `Marokkaan` stays wrong rather than becoming
 * whichever entry starts that way.
 */
export function codetabelVerdict(
  rule: RuleCheck,
  value: string,
  scope: string
): CodetabelVerdict {
  const key = rule.tableRef ?? "";
  if (!codetabelIsLoaded(key)) return VALID;
  if (!rule.scopeColumn) {
    return codetabelHasCode(key, value)
      ? VALID
      : { valid: false, code: codetabelCodeForName(key, value) };
  }
  if (scope === "" || !codetabelCoversScope(key, scope)) return VALID;
  return codetabelHasCodeInScope(key, value, scope)
    ? VALID
    : { valid: false, code: codetabelCodeForNameInScope(key, value, scope) };
}

/**
 * Evaluate one side of a cross-field rule for a given row. `null` means "can't
 * say": a comparison between date columns where one of the two cells isn't a date
 * the engine can read. Neither true nor false is honest there — the malformed
 * value is the column's own `date` check to report, not this rule's — so the
 * caller skips the row instead of inventing a verdict.
 */
/**
 * `headerIndex(headers, name)` for one run, each name looked up once. A
 * cross-field condition compares against another column on **every row**, and
 * `headerIndex` normalises every header each time — rows × conditions × headers of
 * string work for an answer that cannot change within a run.
 */
function memoizedHeaderIndex(headers: string[]): (name: string) => number {
  const found = new Map<string, number>();
  return (name) => {
    let idx = found.get(name);
    if (idx === undefined) {
      idx = headerIndex(headers, name);
      found.set(name, idx);
    }
    return idx;
  };
}

function evalCondition(
  cond: CrossFieldCondition,
  row: string[],
  columnIndex: (name: string) => number,
  idx: number,
  dateFormats: Map<number, string>
): boolean | null {
  const cell = (row[idx] ?? "").trim();
  if (cond.op === "isEmpty") return cell === "";
  if (cond.op === "isNotEmpty") return cell !== "";

  // Resolve the right-hand side: literal or another column's value.
  let other: string;
  let otherIdx = -1;
  if (cond.value && typeof cond.value === "object" && "column" in cond.value) {
    otherIdx = columnIndex(cond.value.column);
    other = otherIdx === -1 ? "" : (row[otherIdx] ?? "").trim();
  } else {
    other = cond.value === undefined ? "" : String(cond.value);
  }

  // Dates before numbers: "31-12-2026" is not a number, and comparing the two as
  // text puts 28-01 after 01-02. The left column's declared format drives it (the
  // right-hand side may be a literal), the right's own format is the fallback.
  const format = dateFormats.get(idx);
  let a: number | null;
  let b: number | null;
  if (format !== undefined) {
    a = toDate(cell, format);
    b = toDate(other, dateFormats.get(otherIdx) ?? format);
    if (a === null || b === null) return null;
  } else {
    a = toNum(cell);
    b = toNum(other);
  }
  const ordered = a !== null && b !== null;

  switch (cond.op) {
    case "==":
      return ordered ? a === b : cell === other;
    case "!=":
      return ordered ? a !== b : cell !== other;
    case "<":
      return ordered ? a! < b! : cell < other;
    case "<=":
      return ordered ? a! <= b! : cell <= other;
    case ">":
      return ordered ? a! > b! : cell > other;
    case ">=":
      return ordered ? a! >= b! : cell >= other;
    default:
      return false;
  }
}

/** The conditions on one side of a cross-field rule, however it was written. */
export function conditionsOf(side: CrossFieldSide): CrossFieldCondition[] {
  if ("allOf" in side) return side.allOf;
  if ("anyOf" in side) return side.anyOf;
  return [side];
}

/**
 * Header index -> date format, for every `date` column the sheet has. Built once
 * per run so a cross-field comparison can tell a date column from a text one
 * without re-resolving the rule set per row.
 */
function dateFormatsByIndex(
  columns: ColumnRules[],
  headers: string[]
): Map<number, string> {
  const formats = new Map<number, string>();
  for (const col of columns) {
    if (col.type !== "date") continue;
    const idx = resolveColumn(headers, col.column);
    if (idx !== null) formats.set(idx, col.format ?? "DD-MM-YYYY");
  }
  return formats;
}

/**
 * Validate one sheet against the rule set for `moduleId`.
 * Returns an empty (no-issue) result when the module has no rules.
 *
 * `fills` are the columns the **app** fills from the conversion's own configuration
 * rather than from the client's sheet — a facilitaire conversie's periodetabel,
 * kostenplaats and the rest (see [`lib/standard-columns.ts`](../standard-columns.ts)).
 * Such a column is never required and never reported missing, and a blank cell in one
 * lands in {@link ValidationResult.defaults} carrying the value the app will send, so
 * the table shows it as a default rather than as data the user still owes. Omitted for
 * a caller with no project in hand, which validates exactly as before.
 */
export function validateSheet(
  moduleId: string | null,
  headers: string[],
  cellData: string[][],
  fills: StandardColumnFills = NO_STANDARD_FILLS
): ValidationResult {
  const byCell = new Map<string, Issue[]>();
  const missingColumns: string[] = [];
  const columnIndex = memoizedHeaderIndex(headers);
  const defaults = new Map<string, string>();
  const notices = new Map<string, string[]>();
  const unlisted = new Map<string, Issue>();
  let errorCount = 0;

  // `extra` carries the fields only some checks have (the AFAS list a value was
  // compared against), so every issue still goes through one place.
  const add = (
    row: number,
    col: number,
    message: string,
    extra?: Pick<Issue, "tableRef" | "tableScope">
  ) => {
    const key = `${row}:${col}`;
    const issue: Issue = { row, col, message, ...extra };
    const list = byCell.get(key);
    if (list) list.push(issue);
    else byCell.set(key, [issue]);
    errorCount++;
  };

  // Column indexes this run could actually flag something in, so `checkedCells`
  // counts the cells that were really judged — not the ones the rule set merely
  // names. A Set because a column can be reached twice (by its own rules and as
  // a cross-field rule's flag target) and must be counted once. Every cell an
  // issue lands on is in here, so the completeness figure's numerator can never
  // exceed its denominator.
  const checkedColumns = new Set<number>();

  const ruleSet = moduleId ? RULE_SETS[moduleId] : undefined;
  if (!ruleSet) {
    return { byCell, errorCount, checkedCells: 0, missingColumns, defaults, notices, autofixed: new Map(), unlisted };
  }
  // Up here rather than with the cross-field checks: an `existing-record` rule's
  // `when` is a cross-field condition too, evaluated per row in the column loop.
  const dateFormats = dateFormatsByIndex(ruleSet.columns, headers);

  // --- Per-column checks ---
  for (const col of ruleSet.columns) {
    const idx = resolveColumn(headers, col.column);
    // Whether the app fills this column itself. Asked by the primary name, the one
    // the fill table is written in — a synonym is a client's spelling of the same
    // column, not a second column, so it must get the same answer.
    const filled = fills.headers.has(primaryColumnName(col.column));
    if (idx === null) {
      // A column the app fills from configuration answers for its own absence, so
      // it is not a gap worth reporting. Every other absent column is.
      if (!filled) {
        missingColumns.push(primaryColumnName(col.column));
      }
      continue;
    }
    if (columnIsChecked(col)) checkedColumns.add(idx);

    const uniqueRule = col.rules.find((r) => r.check === "unique");
    const seen = new Map<string, number[]>(); // lower-cased value -> row indexes

    // Header index of the column a scoped `codetabel` or `postcode` rule reads,
    // resolved once per column instead of per cell. Null = not in this sheet.
    const scopeIndexes = new Map<RuleCheck, number | null>();
    // The same for an `existing-record` rule's key column and `when` column. Null =
    // not in this sheet, and the rule then judges no row: without the key there is
    // nothing to compare, without the condition no way to tell which rows qualify.
    const recordIndexes = new Map<RuleCheck, { key: number | null; when: number | null }>();
    // The columns a `matches-count` rule counts, resolved once; the absent ones dropped.
    const countIndexes = new Map<RuleCheck, number[]>();
    // A `same-in-group` rule's group column, resolved once. Null = not in this sheet,
    // and then there are no groups to compare within.
    const groupRule = col.rules.find((r) => r.check === "same-in-group" && r.groupColumn);
    const groupIdx = groupRule ? resolveColumn(headers, groupRule.groupColumn!) : null;
    // group value -> its rows, and the distinct values this column holds across them
    // (compared form -> the value as written, for the message).
    const groups = new Map<string, { rows: number[]; values: Map<string, string> }>();
    for (const rule of col.rules) {
      if (rule.check === "matches-count" && rule.columns) {
        countIndexes.set(
          rule,
          rule.columns.map((c) => resolveColumn(headers, c)).filter((i): i is number => i !== null)
        );
      }
      if ((rule.check === "codetabel" || rule.check === "postcode") && rule.scopeColumn) {
        scopeIndexes.set(rule, resolveColumn(headers, rule.scopeColumn));
      }
      if (rule.check === "existing-record" && rule.keyColumn) {
        recordIndexes.set(rule, {
          key: resolveColumn(headers, rule.keyColumn),
          when: rule.when ? resolveColumn(headers, rule.when.column) : null,
        });
      }
    }

    for (let r = 0; r < cellData.length; r++) {
      const value = (cellData[r]?.[idx] ?? "").trim();

      // A blank cell in a column the app fills is not missing data: the app's own
      // value goes out for it, so it is recorded as a default (the table tints it
      // amber and shows what it becomes) and no rule runs against the blank —
      // `required` above all, which is the whole point. A **filled** cell falls
      // through to every check as usual: the sheet wins when it says something, and
      // what it says still has to be right.
      if (filled && value === "") {
        const fill = fills.values.get(primaryColumnName(col.column));
        if (fill !== undefined) defaults.set(`${r}:${idx}`, fill);
        continue;
      }

      const typeMsg = runTypeCheck(col, value);
      if (typeMsg) add(r, idx, typeMsg);

      // Value-level rule checks.
      for (const rule of col.rules) {
        if (rule.check === "codetabel") {
          if (value !== "") {
            const row = cellData[r] ?? [];
            const scope = codetabelScope(rule, row, scopeIndexes.get(rule));
            if (!codetabelVerdict(rule, value, scope).valid) {
              const message = localized(rule.message, rule.messageEn) ?? tr("Waarde niet gevonden in lijst", "Value not found in the list");
              const extra = { tableRef: rule.tableRef, tableScope: scope || undefined };
              if (rule.allowUnlisted) {
                unlisted.set(`${r}:${idx}`, { row: r, col: idx, message, ...extra });
              } else {
                add(r, idx, message, extra);
              }
            }
          }
          continue;
        }
        if (rule.check === "existing-record") {
          const at = recordIndexes.get(rule);
          if (value === "" || !moduleId || !at || at.key === null) continue;
          const row = cellData[r] ?? [];
          if (rule.when) {
            if (at.when === null) continue;
            if (evalCondition(rule.when, row, columnIndex, at.when, dateFormats) !== true) continue;
          }
          const key = (row[at.key] ?? "").trim();
          // A blank key is the key column's own `required` to report; compared here
          // it would make every name AFAS holds look like a duplicate.
          if (key === "") continue;
          const found = existingRecordConflicts(moduleId, key, value);
          if (!found) continue;
          if (found.nameHeldBy.length > 0) {
            const message =
              localized(rule.message, rule.messageEn) ??
              tr(
                "Bestaat al in AFAS ({omgeving}) onder nummer {nummer} — verander het nummer in de sheet naar het nummer dat in AFAS bij jullie bekend is",
                "Already exists in AFAS ({omgeving}) under number {nummer} — change the number in the sheet to the number AFAS knows it by",
              );
            add(
              r,
              idx,
              message
                .replace("{nummer}", found.nameHeldBy.join(", "))
                .replace("{omgeving}", found.stage)
            );
          }
          if (found.keyHeldAs !== null) {
            const message =
              localized(rule.keyMessage, rule.keyMessageEn) ??
              tr('Nummer bestaat al in AFAS ({omgeving}), als "{naam}"', 'Number already exists in AFAS ({omgeving}), as "{naam}"');
            add(
              r,
              at.key,
              message.replace("{naam}", found.keyHeldAs).replace("{omgeving}", found.stage)
            );
          }
          continue;
        }
        if (rule.check === "matches-count") {
          const expected = toNum(value);
          if (expected === null) continue;
          const row = cellData[r] ?? [];
          const counted = (countIndexes.get(rule) ?? []).filter(
            (i) => (toNum((row[i] ?? "").trim()) ?? 0) > 0
          ).length;
          if (counted > 0 && counted !== expected) {
            const message =
              localized(rule.message, rule.messageEn) ??
              tr(
                "Komt niet overeen met het aantal ingevulde kolommen ({aantal})",
                "Does not match the number of filled-in columns ({aantal})",
              );
            add(r, idx, message.replace("{aantal}", String(counted)));
          }
          continue;
        }
        if (rule.check === "notice") {
          if (value !== "" && rule.values?.some((v) => v.toLowerCase() === value.toLowerCase())) {
            const key = `${r}:${idx}`;
            const message =
              localized(rule.message, rule.messageEn) ??
              tr("Let op: deze waarde wordt aangepast", "Note: this value will be adjusted");
            const list = notices.get(key);
            if (list) list.push(message);
            else notices.set(key, [message]);
          }
          continue;
        }
        if (rule.check === "default-if-empty") {
          if (value === "" && rule.defaultValue !== undefined) {
            defaults.set(`${r}:${idx}`, rule.defaultValue);
          }
          continue;
        }
        // The postcode format depends on the land: with a land column, a row is
        // held to its land's format only where the rule covers that land (its
        // `values`, NL alone by default) — any other foreign postcode is left alone.
        let land = "NL";
        if (rule.check === "postcode" && rule.scopeColumn) {
          land = codetabelScope(rule, cellData[r] ?? [], scopeIndexes.get(rule)).toUpperCase();
          if (!(rule.values ?? ["NL"]).some((v) => v.toUpperCase() === land)) continue;
        }
        const msg = runCheck(rule, value, land);
        if (msg) add(r, idx, localized(rule.message, rule.messageEn) ?? msg);
      }

      // Collect for the group pass. Dates compare as dates, so `1-9-2022` and
      // `01/09/2022` agree; anything unreadable compares as written.
      if (groupIdx !== null) {
        const group = (cellData[r]?.[groupIdx] ?? "").trim();
        if (group !== "") {
          const date = col.type === "date" && value !== "" ? toDate(value, col.format) : null;
          const compared = date !== null ? `date:${date}` : value;
          let entry = groups.get(group);
          if (!entry) groups.set(group, (entry = { rows: [], values: new Map() }));
          entry.rows.push(r);
          if (!entry.values.has(compared)) entry.values.set(compared, value);
        }
      }

      // Collect for the uniqueness pass (empties don't count as duplicates).
      if (uniqueRule && value !== "") {
        const k = value.toLowerCase();
        const arr = seen.get(k);
        if (arr) arr.push(r);
        else seen.set(k, [r]);
      }
    }

    // Uniqueness: flag every cell sharing a value with another.
    if (uniqueRule) {
      for (const rows of seen.values()) {
        if (rows.length < 2) continue;
        for (const r of rows) {
          add(
            r,
            idx,
            localized(uniqueRule.message, uniqueRule.messageEn) ??
              tr(
                `Waarde komt ${rows.length}× voor (moet uniek zijn)`,
                `Value occurs ${rows.length}× (must be unique)`,
              )
          );
        }
      }
    }

    // Groups: flag every row of a group whose rows disagree — which of them is
    // right is the sheet's to say, not ours.
    if (groupRule) {
      for (const [group, { rows, values }] of groups) {
        if (values.size < 2) continue;
        const found = [...values.values()].map((v) => (v === "" ? tr("(leeg)", "(empty)") : v));
        const listed = found.length > 4 ? [...found.slice(0, 4), "…"] : found;
        const message = (
          localized(groupRule.message, groupRule.messageEn) ??
          tr(
            `Moet gelijk zijn op elke regel van ${groupRule.groupColumn} {groep} — gevonden: {waarden}`,
            `Must be the same on every line of ${groupRule.groupColumn} {groep} — found: {waarden}`,
          )
        )
          .replace("{groep}", group)
          .replace("{waarden}", listed.join(", "));
        for (const r of rows) add(r, idx, message);
      }
    }
  }

  // --- App-filled columns the rule set doesn't declare ---
  // Three of `hrm-medewerkers`' five filled columns (Periodetabel HRM, Herhalen na,
  // Jaar volgende periodiek) have no rules at all — their checks were dropped once
  // the values became configuration rather than client input — so the loop above
  // never reaches them and would leave a blank cell looking like a blank cell. They
  // still have a value the app will send, and the table has to say so, so the
  // defaults are recorded here instead. Errors are not: there is no rule to fail.
  const declared = new Set(
    ruleSet.columns.map((col) => primaryColumnName(col.column))
  );
  for (const [header, value] of fills.values) {
    if (declared.has(header)) continue;
    const idx = headerIndex(headers, header);
    if (idx === -1) continue;
    for (let r = 0; r < cellData.length; r++) {
      if ((cellData[r]?.[idx] ?? "").trim() === "") defaults.set(`${r}:${idx}`, value);
    }
  }

  // --- Cross-field checks ---
  for (const cf of ruleSet.crossField) {
    const ifConds = conditionsOf(cf.if);
    const thenConds = conditionsOf(cf.then);
    const ifIdx = ifConds.map((c) => resolveColumn(headers, c.column));
    const thenIdx = thenConds.map((c) => resolveColumn(headers, c.column));
    // Every column of the `if` must exist for the rule to be armed at all. An
    // `anyOf` — on either side — survives a missing alternative (it just can't be
    // the one that arms or satisfies it); a single condition or an `allOf` does not.
    const missingIf = ifConds.filter((_, i) => ifIdx[i] === null);
    const missingThen = thenConds.filter((_, i) => thenIdx[i] === null);
    const ifAny = "anyOf" in cf.if;
    const thenAny = "anyOf" in cf.then;
    if (
      (ifAny ? missingIf.length === ifConds.length : missingIf.length) ||
      (thenAny ? missingThen.length === thenConds.length : missingThen.length)
    ) {
      for (const c of [...missingIf, ...missingThen]) missingColumns.push(c.column);
      continue;
    }
    const firstThen = thenIdx.find((i): i is number => i !== null)!;
    const flagIdx = cf.flag ? resolveColumn(headers, cf.flag) ?? firstThen : firstThen;
    checkedColumns.add(flagIdx);

    for (let r = 0; r < cellData.length; r++) {
      const row = cellData[r] ?? [];
      // Only a condition that definitely holds arms the rule, and only a `then`
      // that definitely fails trips it — an unreadable date leaves both at `null`
      // and the row alone.
      const armed = ifConds.map((c, i) =>
        ifIdx[i] === null ? false : evalCondition(c, row, columnIndex, ifIdx[i]!, dateFormats)
      );
      if (ifAny ? !armed.some((v) => v === true) : !armed.every((v) => v === true)) continue;
      const held = thenConds.map((c, i) =>
        thenIdx[i] === null ? false : evalCondition(c, row, columnIndex, thenIdx[i]!, dateFormats)
      );
      const fails = thenAny ? held.every((v) => v === false) : held.some((v) => v === false);
      if (!fails) continue;
      add(r, flagIdx, localized(cf.message, cf.messageEn) ?? tr("Voldoet niet aan de voorwaarde", "Does not meet the condition"));
    }
  }

  return {
    byCell,
    errorCount,
    checkedCells: cellData.length * checkedColumns.size,
    missingColumns: [...new Set(missingColumns)],
    defaults,
    notices,
    autofixed: new Map(),
    unlisted,
  };
}
