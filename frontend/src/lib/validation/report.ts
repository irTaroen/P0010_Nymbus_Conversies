/**
 * Validation report — the sheet-level view of a {@link ValidationResult}.
 *
 * The engine keys its issues per cell, which is what the table needs and the
 * wrong shape for the question "what is wrong with this sheet?". This module
 * regroups them **by column, then by message** and hands back a plain object the
 * drawer and the PDF only have to render.
 *
 * The report's *figures* are not computed here: it extends {@link SheetMetrics} and
 * fills that half in with {@link sheetMetrics}, so the percentage on the report and
 * the percentage on the sidebar badge are the same arithmetic. Grouping is what this
 * module owns — see [metrics.ts](./metrics.ts) for the numbers.
 *
 * Row numbers are the **Excel rows** the data came from (`ParsedSheet.rowNumbers`),
 * not grid indexes: the report exists to be worked through against the file, and
 * the annotated export flags those same lines.
 */

import { tr } from "@/lib/i18n";
import { sheetMetrics, type SheetMetrics } from "./metrics";
import type { ValidationResult } from "./types";

/** One distinct message within a column, plus the rows it lands on. */
export interface ReportMessage {
  message: string;
  /** Excel rows carrying this message, ascending. Its length is the count. */
  rows: number[];
}

/** One column's issues, grouped by message. */
export interface ReportColumn {
  /** Column index in the grid (0-based) — the order the sheet has them in. */
  index: number;
  /** Excel column letter (`A`, `B`, … `AA`), so a column is findable in the file. */
  letter: string;
  header: string;
  errorCount: number;
  /** The largest group first. */
  messages: ReportMessage[];
}

/**
 * One column's automatic corrections — the cells where the codetabel check found
 * an omschrijving and wrote its code instead (`autofix.ts`). Grouped like the
 * issues are: one line per distinct correction (`"Nederland" → NL`), with the rows
 * it was made on.
 */
export interface ReportAutofixColumn {
  index: number;
  letter: string;
  header: string;
  /** Cells corrected in this column. */
  count: number;
  /** One per distinct `from → to`, the largest group first. */
  fixes: ReportMessage[];
}

/**
 * One validated sheet as the drawer and the PDF render it: every figure of
 * {@link SheetMetrics}, plus what the report adds on top — which sheet it describes,
 * the issues grouped per column, and the issue totals those groups add up to.
 */
export interface ValidationReport extends SheetMetrics {
  fileName: string;
  /**
   * The project the sheet belongs to, for the PDF's file name — see
   * `downloadName()` in [download.ts](../download.ts). Null outside a project.
   */
  projectId: string | null;
  sheetName: string;
  /** Display label of the module the sheet was validated against. */
  moduleLabel: string | null;
  totalColumns: number;
  /**
   * Issues, not cells or rows: a cell failing three rules is one field, one row
   * and three of these. No surface prints the figure any more — a `Fouten` tile
   * showed it until it turned out to be a fourth count of the same sheet, next
   * to a metric card counting fields and a meter counting rows. What still reads
   * it is the `Geen fouten` pill, which needs to know only whether it is zero.
   *
   * Summed from the grouped messages below rather than copied from
   * `ValidationResult`, so it can never disagree with the per-column figures.
   * The field and row figures live in {@link SheetMetrics}.
   */
  errorCount: number;
  /** Only the columns that have issues, in sheet order (`A`, `B`, `C`, …). */
  columns: ReportColumn[];
  missingColumns: string[];
  /**
   * The cells the tool corrected itself, by column in sheet order — so the client
   * reading the report knows which values in the returned file are not the ones
   * they typed. Empty when nothing was corrected.
   */
  autofixed: ReportAutofixColumn[];
  /** Total of the above: cells, not distinct corrections. */
  autofixedCount: number;
  /** True when cells were edited after the run that produced this report. */
  stale: boolean;
}

/** What the report needs about the sheet it describes. */
export interface ReportInput {
  fileName: string;
  /** The project the sheet belongs to; see {@link ValidationReport.projectId}. */
  projectId?: string | null;
  sheetName: string;
  moduleLabel: string | null;
  headers: string[];
  /**
   * The 1-based Excel row each grid row came from (`ParsedSheet.rowNumbers`) —
   * one entry per data row, so its length is the sheet's row count.
   */
  rowNumbers: number[];
  /**
   * The 1-based Excel column grid column 0 came from
   * (`ParsedSheet.firstColumnNumber`) — 1 unless the client's sheet starts
   * further right. Defaults to 1.
   */
  firstColumnNumber?: number;
  result: ValidationResult;
  stale?: boolean;
}

/**
 * `0` → `A`, `25` → `Z`, `26` → `AA` — Excel's bijective base-26 column names.
 * `offset` is the 1-based Excel column that grid column 0 sits in, so a sheet
 * whose data starts at B still names its first column `B`.
 *
 * Exported because the connector page names a sheet's columns the same way while
 * mapping them, and a second implementation of Excel's counting is a second one to
 * get wrong. It lives here rather than in `excel.ts` on purpose: that module
 * statically imports SheetJS, and this is a pure function nothing should pay a
 * parser for.
 */
export function columnLetter(index: number, offset = 1): string {
  let n = index + offset;
  let letter = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Build the report for one validated sheet: the figures from {@link sheetMetrics},
 * every issue grouped by column and message on top.
 *
 * The issue totals are summed from those groups rather than copied from
 * `result.errorCount`, so the per-column figures always add up to the header's.
 */
export function buildValidationReport(input: ReportInput): ValidationReport {
  const { result, rowNumbers, headers } = input;
  const excelRow = (gridRow: number) => rowNumbers[gridRow] ?? gridRow + 1;

  // column index -> message -> the rows (Excel) carrying it. A Set because the
  // same message can reach one cell from two rules; it's one problem there.
  // The message alone is the key: with one severity there is nothing else to
  // tell two groups apart.
  const grouped = new Map<number, Map<string, ReportMessage & { rowSet: Set<number> }>>();

  for (const cellIssues of result.byCell.values()) {
    for (const issue of cellIssues) {
      const row = excelRow(issue.row);

      let messages = grouped.get(issue.col);
      if (!messages) grouped.set(issue.col, (messages = new Map()));
      let group = messages.get(issue.message);
      if (!group) {
        group = { message: issue.message, rows: [], rowSet: new Set() };
        messages.set(issue.message, group);
      }
      group.rowSet.add(row);
    }
  }

  let errorCount = 0;

  const columns: ReportColumn[] = [...grouped.entries()].map(([index, messages]) => {
    const list: ReportMessage[] = [...messages.values()].map((g) => ({
      message: g.message,
      rows: [...g.rowSet].sort((a, b) => a - b),
    }));
    // The biggest group first — the most rows to fix in one go.
    list.sort(
      (a, b) =>
        b.rows.length - a.rows.length || a.message.localeCompare(b.message, "nl"),
    );

    const columnErrors = list.reduce((sum, m) => sum + m.rows.length, 0);
    errorCount += columnErrors;

    return {
      index,
      letter: columnLetter(index, input.firstColumnNumber ?? 1),
      header: headers[index] ?? `${tr("Kolom", "Column")} ${index + 1}`,
      errorCount: columnErrors,
      messages: list,
    };
  });

  // Sheet order — A, B, C. The report is worked through side by side with the
  // file, so it reads left to right like the sheet does; sorting worst-first
  // instead would make the reader hunt for each column.
  columns.sort((a, b) => a.index - b.index);

  const autofixed = groupAutofixes(input, excelRow);

  return {
    ...sheetMetrics(result, rowNumbers.length),
    fileName: input.fileName,
    projectId: input.projectId ?? null,
    sheetName: input.sheetName,
    moduleLabel: input.moduleLabel,
    totalColumns: headers.length,
    errorCount,
    columns,
    missingColumns: result.missingColumns,
    autofixed,
    autofixedCount: autofixed.reduce((sum, c) => sum + c.count, 0),
    stale: input.stale ?? false,
  };
}

/**
 * `result.autofixed` grouped the way the issues are: per column, then per distinct
 * correction. The original goes in quotes (it is what the client typed, verbatim)
 * and the code bare, the way the table's notice phrases it.
 */
function groupAutofixes(
  input: ReportInput,
  excelRow: (gridRow: number) => number
): ReportAutofixColumn[] {
  const grouped = new Map<number, Map<string, Set<number>>>();
  for (const [key, { from, to }] of input.result.autofixed) {
    const [row, col] = key.split(":").map(Number);
    let fixes = grouped.get(col);
    if (!fixes) grouped.set(col, (fixes = new Map()));
    const label = to === "" ? `"${from}" → ${tr("leeg", "empty")}` : `"${from}" → ${to}`;
    let rows = fixes.get(label);
    if (!rows) fixes.set(label, (rows = new Set()));
    rows.add(excelRow(row));
  }
  return [...grouped.entries()]
    .map(([index, fixes]) => {
      const list: ReportMessage[] = [...fixes.entries()]
        .map(([message, rows]) => ({ message, rows: [...rows].sort((a, b) => a - b) }))
        .sort((a, b) => b.rows.length - a.rows.length || a.message.localeCompare(b.message, "nl"));
      return {
        index,
        letter: columnLetter(index, input.firstColumnNumber ?? 1),
        header: input.headers[index] ?? `${tr("Kolom", "Column")} ${index + 1}`,
        count: list.reduce((sum, m) => sum + m.rows.length, 0),
        fixes: list,
      };
    })
    .sort((a, b) => a.index - b.index);
}

/**
 * Row numbers as readable segments: `["2–5", "8", "11–13"]`. Runs of three or
 * more collapse into a range — a column that fails on every row would otherwise
 * print hundreds of numbers. Two consecutive rows stay separate (`"2, 3"` is
 * shorter than `"2–3"` and reads the same).
 */
export function rowRangeSegments(rows: number[]): string[] {
  const segments: string[] = [];
  for (let i = 0; i < rows.length; ) {
    let end = i;
    while (end + 1 < rows.length && rows[end + 1] === rows[end] + 1) end++;
    const length = end - i + 1;
    if (length >= 3) {
      segments.push(`${rows[i]}–${rows[end]}`);
      i = end + 1;
    } else {
      for (let j = i; j <= end; j++) segments.push(String(rows[j]));
      i = end + 1;
    }
  }
  return segments;
}
