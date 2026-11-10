/**
 * The figures a validated sheet is judged by — counted once, worded once, read
 * everywhere.
 *
 * `validateSheet()` answers per cell, which is what the table needs and no help at
 * all for "how far is this module?". This module turns one {@link ValidationResult}
 * into the handful of numbers that question is actually answered with — the row
 * figures, the field figures, the percentage over the rows — plus the Dutch wording
 * each is printed with. The report drawer, the PDF, the progress the sidebar badge
 * is recorded from, and anything added next all take them from here, so no two
 * places can count or word the same figure differently.
 *
 * Rows and fields are kept apart on purpose. The upload goes record by record, so
 * one bad field takes its whole row with it: a sheet whose `Land` column is wrong on
 * every row has nothing to send, however much of the rest of it is right. The row
 * figures say how much of the sheet AFAS would take, the field figures say how much
 * work is left in the data — neither stands in for the other, and neither is
 * derivable from the other.
 *
 * Everything here is a pure function of a `ValidationResult` plus the sheet's row
 * count: no React, no DOM, no fetch. That is what lets the same figures back a
 * drawer, a PDF page and a stored progress row.
 */

import { tr } from "@/lib/i18n";
import type { ValidationResult } from "./types";

/**
 * How far one validated sheet got. Two groups of figures — rows, with a percentage
 * over them, and fields as plain counts — and nothing else: every number the report
 * card, the PDF's metric card and the progress store show is in here.
 *
 * The row counts and their percentage travel together rather than each caller
 * dividing for itself: the rounding rule ({@link percentageOf}) has to be applied the
 * same way in every place, or a sheet reads as finished on one screen and not on
 * another.
 */
export interface SheetMetrics {
  /** Data rows in the sheet — the denominator of every row figure below. */
  totalRows: number;
  /**
   * Rows holding at least one error — the rows AFAS cannot take. Row-level, not
   * field-level, because the upload goes row by row: one bad field blocks the whole
   * record even when the rest of it is right.
   */
  errorRowCount: number;
  /**
   * Rows with no error — the records that can go to AFAS as they are, and what
   * {@link SheetMetrics.completeness} is the percentage of. Every issue is an
   * error, so this is also simply "the rows with nothing wrong": the meter's
   * green segment and this figure are the same count, deliberately not two
   * fields that could drift apart.
   */
  importableRowCount: number;
  /**
   * 0–100, the share of rows AFAS could take as they are — the figure the
   * validatierapport leads with and the sidebar's progress badge repeats.
   */
  completeness: number;
  /**
   * Cells the rule set actually judged (`ValidationResult.checkedCells`) — the
   * denominator of the field figures. Columns the sheet doesn't have, and columns
   * nothing checks, stay out of it; the first lands in the missing-column banner.
   */
  checkedCells: number;
  /**
   * Checked cells carrying at least one error — the fields to fix. Cells, not
   * issues: two failing rules on one cell are one thing to fix there, and one wrong
   * field.
   */
  errorCells: number;
}

/**
 * `part` of `total` as a whole 0–100, **never rounded to a clean 0 or 100 while the
 * opposite still holds**: one bad item in a thousand shows 99%, not 100%, and one
 * good item shows 1%, not 0%. An empty total is 100% — nothing is wrong with a sheet
 * there was nothing to judge in.
 *
 * Every percentage {@link SheetMetrics} carries rounds through here, so the rule is
 * stated once and a remaining problem can never round itself out of sight.
 */
export function percentageOf(part: number, total: number): number {
  if (total <= 0) return 100;
  const percentage = Math.round((part / total) * 100);
  if (percentage === 100 && part < total) return 99;
  if (percentage === 0 && part > 0) return 1;
  return percentage;
}

/**
 * One walk over the issues, answering everything the counts need: which rows carry
 * an error, and how many cells are wrong. Kept private and shared by
 * {@link sheetMetrics} and {@link errorRowIndexes} so "a row with an error" is
 * decided in exactly one place.
 *
 * Row numbers are **grid** indexes, the keys the engine flags in. The report maps
 * them to Excel rows for display; counting in grid indexes keeps the tally
 * independent of that mapping.
 */
function tally(result: ValidationResult): {
  errorRows: Set<number>;
  errorCells: number;
} {
  const errorRows = new Set<number>();
  let errorCells = 0;

  for (const cellIssues of result.byCell.values()) {
    if (cellIssues.length === 0) continue;
    // Every issue is an error, so a flagged cell is a wrong cell and its row is
    // a blocked row — no severity to sift for.
    errorCells++;
    for (const issue of cellIssues) errorRows.add(issue.row);
  }

  return { errorRows, errorCells };
}

/**
 * Every figure for one validated sheet. `totalRows` comes from the sheet, not the
 * result: a sheet's last rows can be free of issues, and a result alone can't tell
 * an unflagged row from a row that isn't there.
 *
 * Cheap enough to call per validation run — one pass over the flagged cells, no
 * regrouping. {@link buildValidationReport} is the expensive one, and it reads its
 * numbers from here.
 */
export function sheetMetrics(result: ValidationResult, totalRows: number): SheetMetrics {
  const { errorRows, errorCells } = tally(result);
  const errorRowCount = errorRows.size;
  const { checkedCells } = result;

  return {
    totalRows,
    errorRowCount,
    // Clamped: an issue on a row the sheet doesn't have would otherwise report
    // more importable rows than there are.
    importableRowCount: Math.max(0, totalRows - errorRowCount),
    // The share of **rows** carrying no error — the records that could go to AFAS
    // as they are. Rows, not fields, because that is the unit the upload works in:
    // a badge scored per field would call a sheet nearly finished while nothing in
    // it could actually be sent (see design-system.md).
    completeness: percentageOf(totalRows - errorRowCount, totalRows),
    checkedCells,
    errorCells,
  };
}

/**
 * The columns holding errors, most wrong cells first — what a *data niet akkoord*
 * mail tells the client to look at. Counted in cells, like
 * {@link SheetMetrics.errorCells}: two failing rules on one cell are one thing to
 * fix. Ties keep sheet order, so the list doesn't reshuffle between runs.
 */
export function errorColumns(
  result: ValidationResult,
  headers: string[]
): { column: string; errors: number }[] {
  const counts = new Map<number, number>();
  for (const [key, cellIssues] of result.byCell) {
    if (cellIssues.length === 0) continue;
    const col = Number(key.split(":")[1]);
    counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  return [...counts]
    .sort(([colA, a], [colB, b]) => b - a || colA - colB)
    .map(([col, errors]) => ({ column: headers[col] ?? `Kolom ${col + 1}`, errors }));
}

/**
 * Grid row indexes carrying at least one **error**, ascending — the rows that block
 * the upload, and the set the table's "alleen rijen met fouten" filter shows. The
 * indexes rather than the count, which is what {@link SheetMetrics.errorRowCount} is.
 */
export function errorRowIndexes(result: ValidationResult): number[] {
  return [...tally(result).errorRows].sort((a, b) => a - b);
}

/* --- Wording ---------------------------------------------------------------
 * The metric card exists twice — once in HTML in the report drawer, once drawn on
 * an A4 page by jsPDF — and will exist a third time wherever these numbers go next.
 * The layout can't be shared (a `<div>` and a jsPDF baseline have nothing in common),
 * the *words* can, and they're the part that drifts: a caption reworded on screen and
 * not in the mailed PDF is two different reports of the same sheet.
 *
 * Counted nouns are the sharpest case. Dutch pluralizes irregularly, and three
 * surfaces print a count of errors (the drawer's pills, the PDF's pills and its
 * message lines) — four, back when the toolbar still carried an issue chip, and
 * that was the one getting "1 fouten" wrong.
 */

/**
 * `1 rij` / `12 rijen` — a count with the noun that agrees with it. The Dutch pair is
 * required; the English pair is passed beside it where the caller has one (a compound
 * like "project kon" can't be looked up, so the caller writes it out). Without one, the
 * English falls back to the Dutch noun.
 */
export function countText(
  n: number,
  singular: string,
  plural: string,
  singularEn: string = singular,
  pluralEn: string = plural
): string {
  return tr(
    `${n} ${n === 1 ? singular : plural}`,
    `${n} ${n === 1 ? singularEn : pluralEn}`
  );
}

/** `1 fout` / `12 fouten` — every count of issues, worded once. */
export function errorCountText(n: number): string {
  return countText(n, "fout", "fouten", "error", "errors");
}

/** `1 rij · 3 kolommen` — the sheet's size, worded once for drawer and PDF alike. */
export function omvangText(totalRows: number, totalColumns: number): string {
  return `${countText(totalRows, "rij", "rijen", "row", "rows")} · ${countText(totalColumns, "kolom", "kolommen", "column", "columns")}`;
}

/** One headline figure as every surface prints it: three lines, largest first. */
export interface MetricText {
  /** The big number — a percentage or a count, already formatted. */
  figure: string;
  /** What it is, reading on from the figure: *5%* → *van de rijen kan zo naar AFAS*. */
  caption: string;
  /** The quiet line under it: the denominator, and the share when `figure` is a count. Empty when there is nothing to qualify. */
  detail: string;
  /** A tooltip for the whole figure, where the line has more to say than fits. */
  title?: string;
}

/**
 * The left metric: the share of rows AFAS would take as they are. The percentage
 * leads because it is the figure that decides whether the upload can go, and the one
 * the sidebar badge carries.
 */
export function rowMetricText(metrics: SheetMetrics): MetricText {
  const { totalRows, importableRowCount, completeness } = metrics;
  return {
    figure: `${completeness}%`,
    caption:
      totalRows === 0
        ? tr("dit blad heeft geen datarijen", "this sheet has no data rows")
        : tr("van de rijen kan zo naar AFAS", "of the rows can go to AFAS as they are"),
    detail:
      totalRows === 0
        ? ""
        : tr(
            `${importableRowCount} van ${countText(totalRows, "rij", "rijen", "row", "rows")}`,
            `${importableRowCount} of ${countText(totalRows, "rij", "rijen", "row", "rows")}`
          ),
  };
}

/**
 * The right metric: the fields that are **wrong**, not the ones that are right. It is
 * the worklist — a five-figure count of fine fields next to a red meter only read as
 * a score, where *237 velden met fouten* says what to do. The line underneath gives
 * it its scale: *van 1.200 totaal*.
 *
 * No percentage here, deliberately. The share of good fields reads as a score of the
 * sheet, and the row percentage next to it already is that score — a field share sat
 * beside it saying *97% compleet* where the rows said *0%* only invited the reader to
 * pick the kinder of the two. A sheet nothing was checked in says so instead, rather
 * than putting a denominator of zero on screen.
 */
export function fieldMetricText(metrics: SheetMetrics): MetricText {
  const { checkedCells, errorCells } = metrics;
  return {
    figure: String(errorCells),
    caption: tr(
      `${errorCells === 1 ? "veld" : "velden"} met fouten`,
      `${errorCells === 1 ? "field" : "fields"} with errors`
    ),
    detail:
      checkedCells === 0
        ? tr("er is niets gecontroleerd", "nothing has been checked")
        : tr(`van ${checkedCells} totaal`, `of ${checkedCells} in total`),
  };
}

/**
 * The two states a row can be in, in meter order — the stacked meter's segments and
 * its legend. Status labels only: the fills are per medium (a Tailwind class on screen,
 * an RGB triple in the PDF) and each renderer maps them by `id`.
 *
 * Two rather than three: an amber `Waarschuwingen` band used to sit between them,
 * for rows carrying an issue that didn't block the upload. With one severity left
 * there is no such row — a row either goes to AFAS or it doesn't — and the meter
 * now reads as exactly the percentage above it.
 */
export const ROW_SEGMENTS = [
  { id: "clean", label: "Zonder fouten", labelEn: "Without errors" },
  { id: "error", label: "Met fouten", labelEn: "With errors" },
] as const;

export type RowSegmentId = (typeof ROW_SEGMENTS)[number]["id"];

/** Each segment with the count it stands for, in meter order. */
export function rowSegments(
  metrics: SheetMetrics
): { id: RowSegmentId; label: string; value: number }[] {
  const counts: Record<RowSegmentId, number> = {
    clean: metrics.importableRowCount,
    error: metrics.errorRowCount,
  };
  return ROW_SEGMENTS.map((s) => ({
    id: s.id,
    label: tr(s.label, s.labelEn),
    value: counts[s.id],
  }));
}

/**
 * The meter as one sentence, for readers who get no colour: screen readers on the
 * drawer's `role="img"` track. Same numbers the legend prints.
 */
export function meterLabel(metrics: SheetMetrics): string {
  const filled = rowSegments(metrics).filter((s) => s.value > 0);
  if (filled.length === 0) return tr("Geen datarijen", "No data rows");
  const parts = filled.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(", ");
  return tr(
    `${metrics.completeness}% van de rijen zonder fouten — ${parts}`,
    `${metrics.completeness}% of the rows without errors — ${parts}`
  );
}
