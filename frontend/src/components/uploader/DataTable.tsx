"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, TextSearch, X } from "lucide-react";
import { type ParsedWorkbook } from "@/lib/excel";
import { type Issue } from "@/lib/validation/types";
import { codetabelScope, type CodetabelColumn } from "@/lib/validation/engine";
import CodetabelPicker from "@/components/uploader/CodetabelPicker";
import { useT } from "@/lib/i18n";
import { type HeaderMap } from "@/lib/headers";

const ROW_HEIGHT = 37; // px — matches px-3 py-2 + border
const CELL_H_PADDING = 24; // px-3 left + right
// px — the column search's placeholder "Zoeken" in full, plus the icon and the
// clear button's room either side of it (pl-7 pr-7), at 16px on a touch screen too.
const SEARCH_FIELD_WIDTH = 116;
const MIN_COL_WIDTH = SEARCH_FIELD_WIDTH + 16; // + the search cell's px-2
/** The column-search row's ground: a solid pale cloud-blue (see the row itself). */
const SEARCH_BAND = "bg-[color-mix(in_srgb,var(--k-cloud-light)_35%,var(--k-bg))]";

/**
 * The first data column is frozen beside the `#` column, so a row keeps its key
 * (the medewerker, the debiteur…) in sight however far right the sheet scrolls.
 * Its cells repeat a ground of their own — `sticky` doesn't inherit one, and the
 * cells scrolling under it would show through — and carry a hairline on their
 * right edge, the freeze line.
 */
const FROZEN_CELL_EDGE = "shadow-[inset_-1px_0_0_var(--k-divider)]";

/** Stable identity for a missing row, so `Row`'s memo fast path still applies. */
const EMPTY_ROW: string[] = [];

/** Column index → its codetabel, for the columns whose table has loaded. */
export type PickerColumns = ReadonlyMap<number, CodetabelColumn>;
const NO_PICKER_COLUMNS: PickerColumns = new Map();
const NO_UNLISTED = new Map<string, Issue>();

/** This row's issues/defaults/notices/unlisted, keyed by column index rather than `"row:col"`. */
interface RowLookups {
  dirty: Set<number>;
  issues: Map<number, Issue[]>;
  defaults: Map<number, string>;
  notices: Map<number, string[]>;
  unlisted: Map<number, Issue>;
}

interface RowProps {
  rowIdx: number;
  headers: string[];
  rowData: string[];
  lookups: RowLookups;
  hasCustomWidths: boolean;
  /** Where the frozen first data column sticks: the `#` column's width, in px. */
  frozenLeft: number;
  pickerColumns: PickerColumns;
  onCellChange: (rowIdx: number, colIdx: number, value: string) => void;
  onHoverTip: (e: React.MouseEvent<HTMLTableCellElement>, messages: string[]) => void;
  onHideTip: () => void;
  /** Touch only (the parent checks): `messages` on focus, `null` on blur. */
  onFocusTip: (e: React.FocusEvent<HTMLTableCellElement>, messages: string[] | null) => void;
  onOpenPicker: (row: number, col: number, tableRef: string, scope: string | undefined) => void;
}

/**
 * The sheet rows whose cells contain every column's search term (case-insensitive,
 * anywhere in the value), or `null` when no term is filled in. Read off `cellData`,
 * so it searches what the grid shows — edits included — not the file as uploaded.
 */
function searchRows(
  cellData: string[][],
  rowCount: number,
  terms: Record<number, string>,
): Set<number> | null {
  const active = Object.entries(terms)
    .map(([c, term]) => [Number(c), term.trim().toLocaleLowerCase("nl")] as const)
    .filter(([, term]) => term !== "");
  if (active.length === 0) return null;
  const rows = new Set<number>();
  for (let r = 0; r < rowCount; r++) {
    const row = cellData[r] ?? EMPTY_ROW;
    if (active.every(([c, term]) => (row[c] ?? "").toLocaleLowerCase("nl").includes(term))) {
      rows.add(r);
    }
  }
  return rows;
}

/** Where a touch tip goes: under its cell, but never past the screen's right edge. */
function touchTipPosition(cell: HTMLElement): { x: number; y: number } {
  const r = cell.getBoundingClientRect();
  return { x: Math.max(8, Math.min(r.left, window.innerWidth - 20 * 16 - 8)), y: r.bottom + 4 };
}

/**
 * One row's cells. Pulled out and memoized so a keystroke — which replaces
 * `cellData`'s top-level array, `dirtyKeys` and `issues`/`defaults` with fresh
 * objects on every edit (see `ExcelUploader.handleCellChange`) — re-renders only
 * the row that changed instead of every row the virtualizer has mounted.
 *
 * `rowData`/`lookups` are recomputed per row on every parent render (see
 * `rowLookups` below), but memoized *by value* through the custom `areEqual`
 * comparator: a row whose own slice didn't change bails out of re-rendering
 * even though the container Set/Map/array it was carved from is a fresh object
 * every time.
 */
const Row = memo(function Row({
  rowIdx,
  headers,
  rowData,
  lookups,
  hasCustomWidths,
  frozenLeft,
  pickerColumns,
  onCellChange,
  onHoverTip,
  onHideTip,
  onFocusTip,
  onOpenPicker,
}: RowProps) {
  const t = useT();
  return (
    <tr style={{ height: ROW_HEIGHT }} className="border-t border-k-divider">
      <td className="sticky left-0 z-10 bg-k-bg px-3 py-2 text-k-text-secondary tabular-nums">
        {rowIdx + 1}
      </td>
      {headers.map((header, c) => {
        const current = rowData[c] ?? "";
        const edited = lookups.dirty.has(c);
        const cellIssues = lookups.issues.get(c);
        const flagged = !!cellIssues?.length;
        // Only meaningful while the cell is actually empty — once the user
        // types a real value it stops being blank and this key drops out of
        // `defaults` on the next validation pass.
        const defaultValue = !flagged && current === "" ? lookups.defaults.get(c) : undefined;
        // A remark on a value that is accepted but sent differently. Amber like a
        // default — it never blocks — and hidden behind a red flag, which is what
        // the user has to act on first.
        const cellNotices = !flagged ? lookups.notices.get(c) : undefined;
        // A value an `allowUnlisted` list doesn't hold (an unknown woonplaats): not
        // wrong, only not in AFAS yet — amber too, and still offering the picker.
        const unlisted = !flagged ? lookups.unlisted.get(c) : undefined;
        const amber = defaultValue !== undefined || !!cellNotices?.length || !!unlisted;
        const tipMessages = cellIssues
          ? cellIssues.map((i) => i.message)
          : cellNotices?.length || unlisted
            ? [...(cellNotices ?? []), ...(unlisted ? [unlisted.message] : [])]
            : defaultValue !== undefined
              ? [t(`Standaardwaarde ${defaultValue} wordt gebruikt als dit leeg blijft`, `Default value ${defaultValue} is used if this stays empty`)]
              : undefined;
        // A rejected value from an AFAS reference list: the cell can offer
        // the list itself, so the corner button below appears. The first
        // such issue wins — a cell is only ever checked against one list.
        // An unlisted value offers it as well, also under a red flag from
        // another rule (a place over its length).
        const listIssue = cellIssues?.find((i) => i.tableRef) ?? lookups.unlisted.get(c);
        // An **empty** cell in a codetabel column offers the same list: there is
        // nothing wrong to correct, but there is a value to choose, and the user
        // shouldn't have to know the codes to fill it in. Whatever flags it (a
        // `required`, or nothing) it has no codetabel issue — the check only judges
        // a value — so the table is read off the column instead, narrowed by this
        // row's scope exactly as the check would narrow it.
        const emptyColumn =
          !listIssue && current.trim() === "" ? pickerColumns.get(c) : undefined;
        const picker = listIssue
          ? { tableRef: listIssue.tableRef!, scope: listIssue.tableScope }
          : emptyColumn
            ? {
                tableRef: emptyColumn.rule.tableRef!,
                scope:
                  codetabelScope(emptyColumn.rule, rowData, emptyColumn.scopeIdx) || undefined,
              }
            : undefined;
        return (
          <td
            key={c}
            onMouseEnter={tipMessages ? (e) => onHoverTip(e, tipMessages) : undefined}
            onMouseLeave={tipMessages ? onHideTip : undefined}
            onFocus={tipMessages ? (e) => onFocusTip(e, tipMessages) : undefined}
            onBlur={tipMessages ? (e) => onFocusTip(e, null) : undefined}
            style={c === 0 ? { left: frozenLeft } : undefined}
            className={`overflow-hidden p-0 ${
              c === 0 ? `sticky z-10 ${FROZEN_CELL_EDGE}` : "relative"
            } ${flagged ? "bg-k-red-bg" : amber ? "bg-k-amber-bg" : c === 0 ? "bg-k-bg" : ""}`}
          >
            {edited && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 h-0 w-0 border-r-[7px] border-t-[7px] border-r-transparent border-t-k-cloud-deep"
              />
            )}
            {flagged && (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-l-[7px] border-b-[7px] border-l-transparent border-b-k-red-fg"
              />
            )}
            {/* The way out of a list error: the valid values, one click
                away. Top-right, the cell's one free corner — the edited
                mark holds the top-left and the error mark the
                bottom-right. */}
            {picker && (
              <button
                type="button"
                onClick={() => onOpenPicker(rowIdx, c, picker.tableRef, picker.scope)}
                title={t("Kies een waarde uit de codetabel", "Choose a value from the code table")}
                aria-label={t(
                  `Kies een geldige waarde voor ${header}, rij ${rowIdx + 1}`,
                  `Choose a valid value for ${header}, row ${rowIdx + 1}`
                )}
                // Red on a flagged cell, like the flag it resolves; amber on an
                // unlisted one, like its tint; neutral on an empty cell nothing is
                // wrong with — there it is an offer, not a fix.
                className={`absolute right-0 top-0 z-10 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-bl-md transition-colors pointer-coarse:h-[26px] pointer-coarse:w-[26px] ${
                  flagged
                    ? "bg-k-red-bg text-k-red-fg hover:bg-k-red-fg hover:text-k-bg"
                    : unlisted
                      ? "bg-k-amber-bg text-k-amber-fg hover:bg-k-amber-fg hover:text-k-bg"
                      : "bg-k-tint text-k-text-secondary hover:bg-k-cloud-deep hover:text-k-bg"
                }`}
              >
                <TextSearch className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
            <input
              type="text"
              data-cell={`${rowIdx}:${c}`}
              value={current}
              placeholder={defaultValue}
              onChange={(e) => onCellChange(rowIdx, c, e.target.value)}
              // Flat at rest, so the cell's own tint (red, amber) shows and a
              // sheet of thousands of cells isn't thousands of inset wells; the
              // inset and the cloud-light ring of `neu-input` appear only on the
              // cell being edited.
              className={`h-full w-full rounded-md bg-transparent py-2 text-sm text-k-text-primary ${hasCustomWidths ? "min-w-0" : "min-w-[6rem]"} caret-k-cloud-deep outline-none transition-shadow duration-150 placeholder:text-k-amber-fg/70 focus:shadow-[var(--k-shadow-inset-sm),inset_0_0_0_2px_var(--k-cloud-light)] ${
                // Room for the corner button, so a long value never runs
                // underneath it.
                picker ? "pl-3 pr-6 pointer-coarse:pr-8" : "px-3"
              }`}
            />
          </td>
        );
      })}
    </tr>
  );
},
areRowPropsEqual);

/**
 * `Row`'s `memo` comparator: everything but `rowData`/`lookups` is either a
 * primitive or stable across renders (the callbacks are `useCallback`d in
 * `DataTable`, `headers` only changes with the sheet itself), so those compare
 * by `===`. `rowData` and the three `lookups` collections are rebuilt fresh
 * per row on every `DataTable` render (see `rowLookups`) — comparing *them* by
 * `===` would defeat the memo for every row, edited or not, so they're compared
 * by value instead. Both sides are small (one row's cells/flags), so this is
 * cheap next to the render it's skipping.
 *
 * **The row's text and its flags are compared independently, and both must be
 * equal to bail out.** Unchanged text does not imply unchanged flags: validation
 * runs *after* the render that applied the edit, so by the time a fresh
 * `ValidationResult` arrives the cell already holds its new value and only the
 * flags differ. A short-circuit on `rowData` identity alone would drop exactly
 * the render that puts the new error on screen — a corrected cell keeping a red
 * flag it no longer earns, or a broken one showing none (and with it no
 * `CodetabelPicker` button, since `DataTable` renders that off the issue's
 * `tableRef`). The same holds for every flag change no edit of this row causes:
 * codetabellen arriving late and re-validating the sheet, a `unique` duplicate
 * cleared two rows away, a cross-field rule flagging another row, a default
 * appearing or disappearing.
 */
function areRowPropsEqual(prev: Readonly<RowProps>, next: Readonly<RowProps>): boolean {
  if (
    prev.rowIdx !== next.rowIdx ||
    prev.headers !== next.headers ||
    prev.hasCustomWidths !== next.hasCustomWidths ||
    prev.frozenLeft !== next.frozenLeft ||
    prev.pickerColumns !== next.pickerColumns ||
    prev.onCellChange !== next.onCellChange ||
    prev.onHoverTip !== next.onHoverTip ||
    prev.onHideTip !== next.onHideTip ||
    prev.onFocusTip !== next.onFocusTip ||
    prev.onOpenPicker !== next.onOpenPicker
  ) {
    return false;
  }
  return rowDataEqual(prev.rowData, next.rowData) && lookupsEqual(prev.lookups, next.lookups);
}

/** One row's cell strings, by value — identity first, for the untouched row. */
function rowDataEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** One row's flags, by value: what an edit elsewhere (or a recheck) moves. */
function lookupsEqual(a: RowLookups, b: RowLookups): boolean {
  return (
    setsEqual(a.dirty, b.dirty) &&
    issuesEqual(a.issues, b.issues) &&
    mapsEqual(a.defaults, b.defaults) &&
    listMapsEqual(a.notices, b.notices) &&
    unlistedEqual(a.unlisted, b.unlisted)
  );
}

function listMapsEqual(a: Map<number, string[]>, b: Map<number, string[]>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.length !== v.length || v.some((m, i) => m !== w[i])) return false;
  }
  return true;
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function mapsEqual(a: Map<number, string>, b: Map<number, string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * One cell's issues, by value — every field of `Issue` the row renders off.
 *
 * `row`/`col` are the map key and can't differ here, which leaves the three
 * below: the tooltip text, and the two the `CodetabelPicker` button is built
 * from. **Adding a field to `Issue` means adding it here** — a field this misses
 * is a change the flag can't re-render for, which is the failure the comparator
 * exists to avoid. The `satisfies` line keeps that from being a comment nobody
 * reads: it stops compiling when `Issue` grows a field the list doesn't name.
 */
const COMPARED_ISSUE_FIELDS = ["message", "tableRef", "tableScope"] as const;
type ComparedIssueField = (typeof COMPARED_ISSUE_FIELDS)[number];
// Every key of `Issue` is either the cell's own coordinates or compared above.
type _IssueFieldsCovered = ComparedIssueField | "row" | "col";
const _issueFieldsExhaustive = null as unknown as keyof Issue satisfies _IssueFieldsCovered;
void _issueFieldsExhaustive;

function issuesEqual(a: Map<number, Issue[]>, b: Map<number, Issue[]>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const other = b.get(k);
    if (!other || other.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) {
      for (const f of COMPARED_ISSUE_FIELDS) {
        if (v[i][f] !== other[i][f]) return false;
      }
    }
  }
  return true;
}

/** {@link issuesEqual} for the one-per-cell `unlisted` map. */
function unlistedEqual(a: Map<number, Issue>, b: Map<number, Issue>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || COMPARED_ISSUE_FIELDS.some((f) => v[f] !== w[f])) return false;
  }
  return true;
}

/**
 * Virtualised, inline-editable table for one parsed sheet.
 *
 * `cellData` holds the current (editable) string values; `dirtyKeys` is the set
 * of `"row:col"` cells that differ from their parsed original (maintained by the
 * parent) and drives the corner-triangle indicator (the app's primary colour —
 * not to be confused with the amber a defaulted cell gets, below). `issues` maps
 * the same `"row:col"` keys to validation problems, tinting the cell red with
 * the message(s) on hover — one tint, because there is one severity: a flagged
 * cell blocks its row from the upload.
 *
 * `defaults` maps the same keys to the value an **empty** cell will be treated
 * as (a `default-if-empty` rule). That is not a second severity — a defaulted
 * cell carries no issue and never blocks anything — so it gets its own amber
 * tint rather than red, and shows the value as a placeholder rather than
 * writing it into `cellData`: nothing here is user-entered until they type it.
 *
 * `notices` maps the same keys to remarks on a **filled** cell whose value is
 * accepted but sent to AFAS differently (a `notice` rule). Same amber, for the
 * same reason — it never blocks — with the remark on hover.
 *
 * `unlisted` maps the same keys to a value an `allowUnlisted` codetabel check
 * didn't find (an unknown woonplaats). Amber as well, with the message on hover
 * and the value picker in the corner, as a codetabel error would have.
 *
 * `visibleRows` optionally narrows the rendered rows to those row indexes (used
 * by the toolbar's "alleen rijen met fouten" filter); omit it to show them all.
 * Row numbers and cell keys always refer to the sheet, never to the filtered
 * position, so filtering never changes what an edit writes to.
 *
 * `instructions` holds the template's row 2 per column — what to fill in — shown in
 * the search band above each field, so the help the client read in Excel is still
 * beside the column here. Omitted or `null`, the band is the search fields alone.
 *
 * Under each header sits a search field of the table's own, narrowing the rows
 * further to those whose cell in that column contains the term — every filled-in
 * column at once. Kept here rather than by the caller: it is a way of looking at
 * the grid, not a fact about the sheet, and nothing else needs to know about it.
 *
 * `focusCell` asks the table to bring one cell into view and put the caret in it
 * — the toolbar's vorige/volgende fout buttons. Acted on once per `seq`, so the
 * same request isn't replayed by an unrelated re-render.
 */
export default function DataTable({
  sheet,
  cellData,
  dirtyKeys,
  issues,
  defaults,
  notices,
  unlisted = NO_UNLISTED,
  visibleRows,
  focusCell,
  pickerColumns = NO_PICKER_COLUMNS,
  instructions = null,
  onCellChange,
}: {
  sheet: NonNullable<ParsedWorkbook["sheets"][number]>;
  cellData: string[][];
  dirtyKeys: Set<string>;
  issues: Map<string, Issue[]>;
  defaults: Map<string, string>;
  notices: Map<string, string[]>;
  unlisted?: Map<string, Issue>;
  visibleRows?: number[];
  focusCell?: { row: number; col: number; seq: number } | null;
  /**
   * The columns checked against a codetabel whose values are in hand — an empty
   * cell in one offers the value picker too. Rebuilt by the caller when the
   * codetabellen arrive; omitted, only codetabel errors offer it.
   */
  pickerColumns?: PickerColumns;
  /** The template's instruction per column header — see `columnInstructions`. */
  instructions?: HeaderMap<string> | null;
  onCellChange: (rowIdx: number, colIdx: number, value: string) => void;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const headRowRef = useRef<HTMLTableRowElement>(null);
  // The `#` column's rendered width — where the frozen first data column sticks.
  // Measured rather than computed: in the auto layout it is whatever the browser
  // gave the row numbers, and it changes with the sheet's length and with a drag.
  const [frozenLeft, setFrozenLeft] = useState(0);
  useLayoutEffect(() => {
    const indexCell = headRowRef.current?.children[0];
    if (!indexCell) return;
    // Floored: a fraction too far left only tucks the frozen column under the `#`
    // one, where a fraction too far right leaves a seam the scrolling cells show
    // through.
    const measure = () => setFrozenLeft(Math.floor(indexCell.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(indexCell);
    return () => observer.disconnect();
  }, []);
  // Custom validation tooltip — instant (no native `title` delay) and positioned
  // `fixed` so it escapes the table's overflow clipping. `anchor` is the cell a
  // touch tip belongs to (see `handleFocusTip`), so a scroll can move it along.
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    messages: string[];
    anchor?: HTMLElement;
  } | null>(null);
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  // The cell whose AFAS list is open in the value picker (null = closed). Held
  // here because the corner button inside a cell is what opens it, and rendered
  // outside the scroll container below so the overlay isn't clipped by it.
  const [picker, setPicker] = useState<{
    row: number;
    col: number;
    tableRef: string;
    scope?: string;
  } | null>(null);

  // The column searches: the term per column index, and the rows they matched.
  // The match is taken when a term changes, not on every edit — a row whose
  // searched value is being typed over would otherwise vanish mid-keystroke, the
  // same reason the errors-only filter holds its rows until Hercontroleren.
  const [columnSearch, setColumnSearch] = useState<Record<number, string>>({});
  const [searchMatches, setSearchMatches] = useState<Set<number> | null>(null);
  const searchColumn = useCallback(
    (colIdx: number, value: string) => {
      const next = { ...columnSearch, [colIdx]: value };
      if (value === "") delete next[colIdx];
      setColumnSearch(next);
      setSearchMatches(searchRows(cellData, sheet.rows.length, next));
    },
    [columnSearch, cellData, sheet.rows.length],
  );
  const clearSearch = useCallback(() => {
    setColumnSearch({});
    setSearchMatches(null);
  }, []);
  // Another sheet (or a re-upload) leaves the matched row indexes meaningless.
  useEffect(clearSearch, [sheet, clearSearch]);
  const searching = searchMatches !== null;

  // A different sheet (or the same one re-parsed with other headers) invalidates
  // every measured width. Joined into one string so the effect can compare the
  // headers by value; extracted to a variable because a dependency array may not
  // hold an expression the linter can't check statically.
  const headerKey = sheet.headers.join("\0");
  useEffect(() => {
    setColWidths({});
  }, [sheet.name, headerKey]);

  /**
   * A text's rendered width in the table's font. Measured on a canvas rather than by
   * writing it into the hidden span and reading its box: a box read forces a layout,
   * and fitting one column of a few-thousand-row sheet did thousands of them on a
   * single mousedown. The canvas takes its font from that span's computed style
   * (read once), so the widths match; the span stays the fallback without a canvas.
   */
  const measureCanvas = useRef<{ context: CanvasRenderingContext2D; font: string } | null>(null);
  const measureText = useCallback((text: string, bold: boolean) => {
    const el = measureRef.current;
    if (!el) return 0;
    if (!measureCanvas.current) {
      const context = document.createElement("canvas").getContext("2d");
      if (context) {
        const style = getComputedStyle(el);
        measureCanvas.current = { context, font: `${style.fontSize} ${style.fontFamily}` };
      }
    }
    const canvas = measureCanvas.current;
    // `whitespace-nowrap` collapses runs of spaces on screen; the canvas doesn't.
    const shown = (text || " ").replace(/\s+/g, " ");
    if (canvas) {
      canvas.context.font = `${bold ? 600 : 400} ${canvas.font}`;
      return canvas.context.measureText(shown).width;
    }
    el.style.fontWeight = bold ? "600" : "400";
    el.textContent = shown;
    return el.getBoundingClientRect().width;
  }, []);

  // A column can never be narrower than its own header label, so the header
  // text always stays fully readable even when a row has no data.
  const columnMinWidth = useCallback(
    (colIdx: number) => {
      const header = Math.ceil(measureText(sheet.headers[colIdx] ?? "", true));
      return Math.max(MIN_COL_WIDTH, header + CELL_H_PADDING + 2);
    },
    [measureText, sheet.headers],
  );

  // Freeze every column at its current rendered width. Once one column becomes
  // fixed-width the table switches to `table-fixed`, where any column *without*
  // an explicit width would collapse to share leftover space — so we lock them
  // all up front and only ever change the one the user is dragging/fitting.
  const snapshotWidths = useCallback(() => {
    const cells = headRowRef.current?.children;
    const next: Record<number, number> = {};
    for (let i = 0; i < sheet.headers.length; i++) {
      const th = cells?.[i + 1] as HTMLElement | undefined;
      const rendered = th ? th.getBoundingClientRect().width : MIN_COL_WIDTH;
      next[i] = Math.max(columnMinWidth(i), Math.round(rendered));
    }
    return next;
  }, [columnMinWidth, sheet.headers.length]);

  // Width that fits the longest value (header vs. any row). This is both the
  // auto-fit target and the *maximum* a column may be dragged to — there is no
  // point letting a column grow wider than its widest content. When every row
  // is empty this equals the header width, so an empty column is fixed there.
  const columnContentWidth = useCallback(
    (colIdx: number) => {
      let max = measureText(sheet.headers[colIdx] ?? "", true);
      // Each distinct value once: a column of codes repeats a handful of them.
      const seen = new Set<string>();
      for (const row of cellData) {
        const value = row[colIdx] ?? "";
        if (seen.has(value)) continue;
        seen.add(value);
        max = Math.max(max, measureText(value, false));
      }
      return Math.max(columnMinWidth(colIdx), Math.ceil(max) + CELL_H_PADDING + 2);
    },
    [cellData, columnMinWidth, measureText, sheet.headers],
  );

  const autoFitColumn = useCallback(
    (colIdx: number) => {
      const width = columnContentWidth(colIdx);
      setColWidths((prev) => {
        const base = Object.keys(prev).length ? prev : snapshotWidths();
        return { ...base, [colIdx]: width };
      });
    },
    [columnContentWidth, snapshotWidths],
  );

  const beginColumnResize = useCallback(
    (colIdx: number, startX: number, startWidth: number) => {
      const min = columnMinWidth(colIdx);
      const max = columnContentWidth(colIdx);
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const width = Math.min(max, Math.max(min, Math.round(startWidth + delta)));
        setColWidths((prev) => ({ ...prev, [colIdx]: width }));
      };

      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columnContentWidth, columnMinWidth],
  );

  const hasCustomWidths = Object.keys(colWidths).length > 0;

  // In fixed-layout mode we give the table an explicit total width so each
  // column keeps exactly the width it was set to. If we let it stretch to the
  // container (`w-full`/`min-w-full`), the browser redistributes the surplus
  // across columns and a drag appears to do nothing.
  const indexColWidth = hasCustomWidths
    ? Math.max(44, Math.ceil(measureText(String(sheet.rows.length), false)) + CELL_H_PADDING + 2)
    : 0;
  const totalWidth = hasCustomWidths
    ? indexColWidth +
      sheet.headers.reduce((sum, _, i) => sum + (colWidths[i] ?? columnMinWidth(i)), 0)
    : 0;

  // Sheet row indexes to render, in order. Unfiltered this is every row; the
  // virtualizer counts these, so `vRow.index` is a position in here — map it
  // back through `rowIndices` to get the real sheet row.
  const rowIndices = useMemo(() => {
    const rows = visibleRows ?? Array.from({ length: sheet.rows.length }, (_, i) => i);
    return searchMatches ? rows.filter((r) => searchMatches.has(r)) : rows;
  }, [visibleRows, sheet.rows.length, searchMatches]);

  // Toggling a filter changes which row sits at any given scroll offset (and
  // can shrink the list a long way), so jump back to the first row.
  const isFiltered = visibleRows !== undefined;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [isFiltered, searchMatches]);

  const virtualizer = useVirtualizer({
    count: rowIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Bring the requested cell into view and focus it. Two steps, because the row
  // may not be mounted yet: scroll the virtualizer to it, then wait for the
  // frames it takes to render before the input can be found. Horizontal scroll
  // is done by hand, centring the cell in the area right of the sticky `#`
  // column — `scrollIntoView` would also scroll the page around the table, and
  // could leave the cell under that sticky column.
  //
  // The scroll re-renders the table, which re-runs this effect and cancels the
  // frame in flight — so the cell still to be focused lives in a ref, and each
  // run picks the wait back up rather than starting it over.
  const handledSeq = useRef(-1);
  const pendingFocus = useRef<{ row: number; col: number; tries: number } | null>(null);
  useEffect(() => {
    if (focusCell && focusCell.seq !== handledSeq.current) {
      // A jump to a cell the column search hides drops the search: the user
      // asked to go there. The next run finds the row in the full list.
      if (searchMatches && !searchMatches.has(focusCell.row)) return clearSearch();
      const pos = rowIndices.indexOf(focusCell.row);
      if (pos >= 0) {
        handledSeq.current = focusCell.seq;
        pendingFocus.current = { row: focusCell.row, col: focusCell.col, tries: 0 };
        virtualizer.scrollToIndex(pos, { align: "center" });
      }
    }
    if (!pendingFocus.current) return;
    let frame = 0;
    const settle = () => {
      const target = pendingFocus.current;
      const root = scrollRef.current;
      if (!target || !root) return;
      const input = root.querySelector<HTMLInputElement>(
        `input[data-cell="${target.row}:${target.col}"]`,
      );
      if (!input) {
        if (++target.tries < 30) frame = requestAnimationFrame(settle);
        else pendingFocus.current = null;
        return;
      }
      pendingFocus.current = null;
      const cell = input.parentElement!.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      // Both frozen columns cover the left edge; a cell in the frozen data column
      // is always in view, so it needs no horizontal scroll at all.
      if (target.col > 0) {
        const head = headRowRef.current?.children;
        const sticky =
          (head?.[0]?.getBoundingClientRect().width ?? 0) +
          (head?.[1]?.getBoundingClientRect().width ?? 0);
        const left = cell.left - box.left + root.scrollLeft;
        const room = root.clientWidth - sticky;
        root.scrollLeft = Math.max(0, left - sticky - (room - cell.width) / 2);
      }
      input.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [focusCell, rowIndices, virtualizer, searchMatches, clearSearch]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalHeight - virtualRows[virtualRows.length - 1].end
      : 0;

  // Stable across renders so `Row`'s memo comparator can rely on identity for
  // these — only `rowData`/`lookups` are expected to (and need to) change.
  const handleHoverTip = useCallback(
    (e: React.MouseEvent<HTMLTableCellElement>, messages: string[]) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left, y: r.bottom + 4, messages });
    },
    [],
  );
  const handleHideTip = useCallback(() => setTip(null), []);
  // A touch screen has no hover, so there a cell's messages show while it has focus
  // — tapping a cell is what focuses its input — and go again on blur. Gated on the
  // pointer, so a mouse keeps exactly the hover behaviour above. Kept inside the
  // screen (the tooltip is at most `max-w-xs`, 20rem), which a 375px phone needs
  // and a desktop's hover never did.
  const handleFocusTip = useCallback(
    (e: React.FocusEvent<HTMLTableCellElement>, messages: string[] | null) => {
      if (!window.matchMedia("(pointer: coarse)").matches) return;
      if (!messages) return setTip(null);
      setTip({ ...touchTipPosition(e.currentTarget), messages, anchor: e.currentTarget });
    },
    [],
  );
  // A wheel scroll moves the hovered cell away — or the virtualizer unmounts it —
  // without a `mouseleave`, which would leave the tooltip pinned over rows it doesn't
  // describe. A touch tip follows its cell instead: the keyboard opening scrolls the
  // focused cell into view, and the tip shouldn't vanish the moment it appears.
  const handleScroll = useCallback(() => {
    setTip((t) => (t?.anchor?.isConnected ? { ...t, ...touchTipPosition(t.anchor) } : null));
  }, []);
  const handleOpenPicker = useCallback(
    (row: number, col: number, tableRef: string, scope: string | undefined) => {
      setPicker({ row, col, tableRef, scope });
    },
    [],
  );

  /**
   * `dirtyKeys`/`issues`/`defaults` are keyed `"row:col"` for the whole sheet;
   * `Row` only needs its own row's slice, by column index. Built per virtualized
   * row rather than once for the whole sheet — the virtualizer only ever mounts
   * a couple dozen rows regardless of the sheet's total size, so this stays
   * cheap on every render including the keystroke that invalidates it.
   */
  const rowLookups = useCallback(
    (rowIdx: number): RowLookups => {
      const dirty = new Set<number>();
      const rowIssues = new Map<number, Issue[]>();
      const rowDefaults = new Map<number, string>();
      const rowNotices = new Map<number, string[]>();
      const rowUnlisted = new Map<number, Issue>();
      for (let c = 0; c < sheet.headers.length; c++) {
        const key = `${rowIdx}:${c}`;
        if (dirtyKeys.has(key)) dirty.add(c);
        const cellIssues = issues.get(key);
        if (cellIssues?.length) rowIssues.set(c, cellIssues);
        const def = defaults.get(key);
        if (def !== undefined) rowDefaults.set(c, def);
        const cellNotices = notices.get(key);
        if (cellNotices?.length) rowNotices.set(c, cellNotices);
        const cellUnlisted = unlisted.get(key);
        if (cellUnlisted) rowUnlisted.set(c, cellUnlisted);
      }
      return {
        dirty,
        issues: rowIssues,
        defaults: rowDefaults,
        notices: rowNotices,
        unlisted: rowUnlisted,
      };
    },
    [sheet.headers.length, dirtyKeys, issues, defaults, notices, unlisted],
  );

  return (
    <>
    {/* Edge to edge: it fills its card, and the card's raised shadow draws the
        edge. The radius stays, to clip the sticky header's corners to it. */}
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-auto rounded-2xl"
    >
      <table
        style={hasCustomWidths ? { width: totalWidth } : undefined}
        className={`border-collapse text-sm ${hasCustomWidths ? "table-fixed" : "min-w-full"}`}
      >
        {hasCustomWidths && (
          <colgroup>
            <col style={{ width: indexColWidth }} />
            {sheet.headers.map((_, i) => (
              <col
                key={i}
                style={colWidths[i] ? { width: colWidths[i] } : undefined}
              />
            ))}
          </colgroup>
        )}
        {/* The header's own ground is the search band's, not the label fill: the
            collapsed border under it leaves a 1px seam beside the sticky `#`
            column where this shows through, and the label fill there drew a
            stray line under the pale band. The label cells each carry their own
            fill. */}
        <thead className={`sticky top-0 z-20 ${SEARCH_BAND}`}>
          <tr ref={headRowRef}>
            <th className="relative sticky left-0 z-10 bg-k-cloud-deep px-3 py-2.5 text-left font-semibold text-k-bg">
              #
              <span
                aria-hidden
                className="pointer-events-none absolute right-0 top-1/2 h-1/2 w-px -translate-y-1/2 bg-k-bg/30"
              />
            </th>
            {sheet.headers.map((header, i) => (
              <th
                key={i}
                style={{
                  ...(colWidths[i] ? { width: colWidths[i] } : undefined),
                  ...(i === 0 ? { left: frozenLeft } : undefined),
                }}
                className={`${i === 0 ? "sticky z-10" : "relative"} whitespace-nowrap bg-k-cloud-deep px-3 py-2.5 text-left font-semibold text-k-bg`}
              >
                {header}
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-0 top-1/2 h-1/2 w-px -translate-y-1/2 bg-k-bg/30"
                />
                <span
                  role="separator"
                  aria-label={t(`Kolom ${header} aanpassen`, `Adjust column ${header}`)}
                  title={t(
                    "Sleep om te vergroten/verkleinen · Dubbelklik om automatisch aan te passen",
                    "Drag to widen or narrow · Double-click to fit automatically"
                  )}
                  className="absolute -right-px top-0 z-30 h-full w-2 cursor-col-resize select-none hover:bg-k-bg/25 active:bg-k-bg/40"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const snap = snapshotWidths();
                    setColWidths(snap);
                    beginColumnResize(i, e.clientX, snap[i]);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    autoFitColumn(i);
                  }}
                />
              </th>
            ))}
          </tr>
          {/* The column searches, on a pale cloud-blue band under the labels: still
              part of the header, but quieter than it, so the labels stay the thing
              the eye lands on. Mixed with white rather than `bg-k-cloud-light/60` — the
              header is sticky, and rows would show through a translucent ground.
              The `#` cell holds the clear-all, at the bottom so it sits beside the
              fields rather than beside the instructions above them. */}
          <tr>
            <th className={`sticky left-0 z-10 px-2 py-2 text-left align-bottom ${SEARCH_BAND}`}>
              {searching && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label={t("Alle zoekopdrachten wissen", "Clear all searches")}
                  title={t("Alle zoekopdrachten wissen", "Clear all searches")}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </th>
            {sheet.headers.map((header, i) => {
              const term = columnSearch[i] ?? "";
              const instruction = instructions?.get(header);
              return (
                <th
                  key={i}
                  style={i === 0 ? { left: frozenLeft } : undefined}
                  className={`px-2 py-2 font-normal ${i === 0 ? "sticky z-10" : ""} ${SEARCH_BAND}`}
                >
                  {/* The template's row 2 for this column. Two lines at most, the
                      same two-line height in every column (empty where a column
                      has none) so the fields below stay on one line; the whole
                      text on hover. `w-0 min-w-full` keeps it out of the table's
                      width sums: it wraps to the column, never widens it. */}
                  {instructions && (
                    <p
                      title={instruction}
                      className="mb-1.5 line-clamp-2 h-8 w-0 min-w-full px-0.5 text-left text-[11px] leading-4 text-k-text-secondary [overflow-wrap:anywhere]"
                    >
                      {instruction}
                    </p>
                  )}
                  <label className="relative block">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-k-text-tertiary">
                      <Search className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    <input
                      type="text"
                      // Sized by the column, never the other way round: an input's
                      // default 20-character width would widen every narrow column.
                      size={1}
                      style={{ minWidth: SEARCH_FIELD_WIDTH }}
                      value={term}
                      onChange={(e) => searchColumn(i, e.target.value)}
                      placeholder={t("Zoeken", "Search")}
                      aria-label={t(`Zoek in ${header}`, `Search in ${header}`)}
                      className="neu-input h-7 w-full min-w-0 rounded-full pl-7 pr-7 text-xs"
                    />
                    {term.length > 0 && (
                      <button
                        type="button"
                        onClick={() => searchColumn(i, "")}
                        aria-label={t(`Zoekopdracht in ${header} wissen`, `Clear search in ${header}`)}
                        className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    )}
                  </label>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr style={{ height: paddingTop }}>
              <td colSpan={sheet.headers.length + 1} />
            </tr>
          )}
          {virtualRows.map((vRow) => {
            const rowIdx = rowIndices[vRow.index];
            return (
              <Row
                key={vRow.key}
                rowIdx={rowIdx}
                headers={sheet.headers}
                rowData={cellData[rowIdx] ?? EMPTY_ROW}
                lookups={rowLookups(rowIdx)}
                hasCustomWidths={hasCustomWidths}
                frozenLeft={frozenLeft}
                pickerColumns={pickerColumns}
                onCellChange={onCellChange}
                onHoverTip={handleHoverTip}
                onHideTip={handleHideTip}
                onFocusTip={handleFocusTip}
                onOpenPicker={handleOpenPicker}
              />
            );
          })}
          {rowIndices.length === 0 && (
            <tr className="border-t border-k-divider">
              <td
                colSpan={sheet.headers.length + 1}
                className="px-3 py-6 text-center text-sm text-k-text-secondary"
              >
                {searching ? t("Geen rijen gevonden.", "No rows found.") : t("Geen rijen met fouten.", "No rows with errors.")}
              </td>
            </tr>
          )}
          {paddingBottom > 0 && (
            <tr style={{ height: paddingBottom }}>
              <td colSpan={sheet.headers.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-full bg-k-text-primary px-2.5 py-1 text-xs font-medium leading-snug text-k-bg shadow-raised-sm"
          style={{ top: tip.y, left: tip.x }}
        >
          {tip.messages.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      {/* Outside the scroll container on purpose: a `fixed` overlay rendered
          inside it would sit in the table's stacking context, under the sticky
          header. Mounted only while open, so it reads the list fresh. */}
      {picker && (
        <CodetabelPicker
          tableRef={picker.tableRef}
          scope={picker.scope}
          columnName={sheet.headers[picker.col] ?? ""}
          currentValue={cellData[picker.row]?.[picker.col] ?? ""}
          onSelect={(value) => {
            onCellChange(picker.row, picker.col, value);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none fixed -left-[9999px] top-0 whitespace-nowrap text-sm"
      />
    </>
  );
}
