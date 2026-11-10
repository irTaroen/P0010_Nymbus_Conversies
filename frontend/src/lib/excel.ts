// Two libraries, split by direction: SheetJS reads (it handles legacy .xls,
// which ExcelJS cannot parse), ExcelJS writes everything (.xlsx and .csv) since
// SheetJS's community build silently discards cell fills and notes.
import * as XLSX from "xlsx";
import type { Fill, Workbook, Worksheet } from "exceljs";
import type JSZip from "jszip";
import { downloadName, triggerDownload } from "@/lib/download";
import { formatDate, formatTime } from "@/lib/datetime";
import { type Issue } from "@/lib/validation/types";
import { addedColumns, editedHeaderColumns } from "@/lib/column-repair";
import { columnLetter } from "@/lib/validation/report";
import { HeaderMap } from "@/lib/headers";
import { tr } from "@/lib/i18n";
import templateExplanations from "@/lib/template-explanations.json";

/**
 * A single parsed cell. Date-formatted cells come back as `Date` rather than
 * the Excel serial number underneath them — see {@link cellToString}.
 */
export type CellValue = string | number | boolean | Date | null;

/** A single parsed worksheet: its name, column headers, and rows. */
export interface ParsedSheet {
  name: string;
  headers: string[];
  /** Each row is an array of cell values aligned to `headers`. */
  rows: CellValue[][];
  /**
   * The 1-based Excel row each entry in `rows` came from. Blank and skipped
   * rows are dropped from `rows`, so the grid index is *not* the sheet row —
   * a file with a gap in it yields e.g. `[3, 4, 5, 7, 9]`. The annotated export
   * needs this to write edits and flags back to the right line.
   */
  rowNumbers: number[];
  /** The 1-based Excel row the headers came from (the first non-blank row). */
  headerRowNumber: number;
  /**
   * The 1-based Excel column that grid column 0 came from — `1` (A) for an
   * ordinary sheet, `2` (B) when the client left column A empty.
   *
   * SheetJS indexes a row **relative to the sheet's used range**, not from column
   * A: a sheet whose data starts at B1 hands back `headers[0] = "Medewerker"`.
   * Without this offset the export writes flags and edits one column to the left
   * of the data, and the report's column letters are all off by one.
   */
  firstColumnNumber: number;
}

/** A parsed workbook (one uploaded Excel file). */
export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
}

/**
 * The range a sheet's cells actually occupy, which is **not** what its `!ref`
 * says.
 *
 * Excel's used range is a high-water mark: it grows when a row is touched and
 * never shrinks back when the content goes away. Formatting applied to whole
 * columns, a large paste later deleted, or a fill dragged too far all leave a
 * sheet declaring hundreds of thousands of rows it no longer holds — one
 * customer export arrived claiming `A1:CX1047099` while ending at row 268.
 *
 * Left alone that is ruinous, because {@link parseExcelFile} asks for
 * `blankrows: true` (it needs each row's real Excel number for the annotated
 * export). SheetJS then materializes every row in the declared range before the
 * blank filter below throws them away: 27 seconds and a million discarded arrays
 * for a sheet of 268 rows, all of it on the main thread with the tab frozen.
 *
 * So the last row is taken from the cell keys instead — the only thing in the
 * sheet that cannot overstate where the data ends. Columns are left as declared:
 * they are bounded by Excel's 16k limit and cost nothing per row, and a column
 * that is empty but formatted is still a column the client means to have.
 *
 * Returns null for a sheet with no cells at all, which has no range to give.
 */
function usedRange(worksheet: XLSX.WorkSheet | undefined): XLSX.Range | null {
  const ref = worksheet?.["!ref"];
  if (!worksheet || !ref) return null;
  const declared = XLSX.utils.decode_range(ref);

  let lastRow = -1;
  for (const key of Object.keys(worksheet)) {
    // Sheet metadata (`!ref`, `!merges`, `!cols`, …) rather than a cell address.
    if (key.charCodeAt(0) === 33) continue;
    const row = XLSX.utils.decode_cell(key).r;
    if (row > lastRow) lastRow = row;
  }
  if (lastRow < 0) return null;

  // Only ever narrows. A `!ref` that already stops at the last cell — or stops
  // short of it, which would drop data — is left exactly as it is.
  if (lastRow >= declared.e.r) return declared;
  return { s: declared.s, e: { r: lastRow, c: declared.e.c } };
}

/**
 * Cell text reduced to what telling it from a template's text should not depend on:
 * casing, whitespace, line breaks and punctuation. A client's copy of an older
 * template said *O voor Organisatie* and *P voor persoon* on two lines where ours
 * says *O voor Organisatie, P voor persoon* — the same explanation.
 */
function normalizeExplanation(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The fewest words an explanation needs to identify the row on its own. Below it
 * the text could be a value (*J/N*, *Hulptabel*, Wagenpark's example `01`); a
 * sentence like *Het bestaande crediteurnummer* is never a record's.
 */
const SENTENCE_WORDS = 3;

/**
 * Every header's explanation texts across the templates, as
 * `scripts/sync-template-explanations.mts` collected them from their row 2 — each
 * normalized text mapped to whether it is a sentence (see {@link SENTENCE_WORDS}).
 */
const EXPLANATIONS = (() => {
  const byHeader = new Map<string, { header: string; texts: Map<string, boolean> }>();
  for (const columns of Object.values(templateExplanations as Record<string, Record<string, string>>)) {
    for (const [header, text] of Object.entries(columns)) {
      const key = normalizeExplanation(header);
      const entry = byHeader.get(key) ?? { header, texts: new Map<string, boolean>() };
      const normalized = normalizeExplanation(text);
      entry.texts.set(normalized, normalized.split(" ").length >= SENTENCE_WORDS);
      byHeader.set(key, entry);
    }
  }
  return new HeaderMap([...byHeader.values()].map(({ header, texts }) => [header, texts] as const));
})();

/**
 * Whether `values` is a template's explanation row rather than a record. Either of:
 *
 * - **one cell holds an explanation sentence** under its header. A client's copy
 *   of an older template reworded the rest, or added a column ours no longer has
 *   (*Naam van het bedrijf*), but no record carries *Het bestaande
 *   crediteurnummer* as its value.
 * - **every filled cell holds exactly the template's text** under that header —
 *   the only way a row of short texts counts. All of them, not most: a record
 *   that happens to share one value with an example row (Wagenpark's `01` under
 *   *Werkgever*) must stay a record.
 *
 * Not "always skip row 2": templates without an explanation row, and clients who
 * deleted it, would silently lose their first record. A row missed here comes back
 * as a row of errors they can see and delete.
 */
function isExplanationRow(headers: string[], values: CellValue[]): boolean {
  let filled = 0;
  let allMatch = true;
  for (let i = 0; i < headers.length; i++) {
    const value = values[i];
    if (value === null || value === undefined || value === "") continue;
    filled++;
    const sentence = EXPLANATIONS.get(headers[i])?.get(normalizeExplanation(cellToString(value)));
    if (sentence) return true;
    if (sentence === undefined) allMatch = false;
  }
  return filled > 0 && allMatch;
}

/**
 * Read an uploaded Excel file and parse every sheet into headers + rows.
 *
 * The first non-blank row is the column headers; the data starts at the first
 * non-blank row after it — unless that row is a template's explanation row (see
 * {@link isExplanationRow}), which is skipped. There is no setting for it: a fixed
 * row count was wrong for every template without an explanation row, and for every
 * client who had deleted it.
 */
export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const data = await file.arrayBuffer();
  // cellDates: without it SheetJS hands back a date cell as its raw serial
  // number — a "Datum in dienst" of 21-12-2025 reaches the table as 46006, and
  // every date column then fails its own DD-MM-YYYY rule. The Date is built from
  // the sheet's own y/m/d parts in local time, so {@link cellToString} reads it
  // back with local getters.
  const workbook = XLSX.read(data, { type: "array", cellDates: true });

  const sheets: ParsedSheet[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];

    // sheet_to_json starts at the sheet's first used row *and column*, not
    // necessarily A1 — both offsets are needed to name a cell's real place.
    // Clamped to the rows that actually hold a cell, see `usedRange`.
    const range = usedRange(worksheet);
    const firstRow = range ? range.s.r : 0;
    const firstColumn = range ? range.s.c : 0;

    // blankrows: true keeps the result aligned to the sheet's own rows, so each
    // entry's Excel row number is known; the blanks are dropped below instead.
    // header: 1 -> an array-of-arrays, so blank *cells* stay aligned too.
    // `range` is passed explicitly rather than left to the sheet's own `!ref`,
    // which regularly lies — see `usedRange`.
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(
      worksheet,
      { header: 1, blankrows: true, defval: null, ...(range ? { range } : {}) }
    );

    const isBlank = (row: CellValue[] | undefined) =>
      !row || row.every((v) => v === null || v === "");

    // Every row that holds something, paired with where it came from.
    const filled: { values: CellValue[]; rowNumber: number }[] = [];
    matrix.forEach((row, i) => {
      if (!isBlank(row)) filled.push({ values: row ?? [], rowNumber: firstRow + i + 1 });
    });

    // The first non-blank row is the header, the rest is data — less the
    // template's explanation row, if the first of them is one.
    const headerEntry = filled[0];
    const headers = (headerEntry?.values ?? []).map((h, i) =>
      h === null || h === "" ? `Kolom ${i + 1}` : String(h)
    );
    const bodyRows =
      filled.length > 1 && isExplanationRow(headers, filled[1].values)
        ? filled.slice(2)
        : filled.slice(1);

    // Normalize every row to the header width.
    const rows = bodyRows.map((entry) =>
      headers.map((_, i) => (entry.values[i] === undefined ? null : entry.values[i]))
    );

    return {
      name,
      headers,
      rows,
      rowNumbers: bodyRows.map((entry) => entry.rowNumber),
      headerRowNumber: headerEntry?.rowNumber ?? 1,
      firstColumnNumber: firstColumn + 1,
    };
  });

  return { fileName: file.name, sheets };
}

/**
 * Render a date cell the way the rules expect to read it back: `dd-mm-yyyy`,
 * the `DD-MM-YYYY` format every date column in `validation/rules/` declares. A
 * cell that also carries a time keeps it (`dd-mm-yyyy HH:mm`, seconds only when
 * non-zero), so a datetime column isn't silently truncated to midnight.
 *
 * Local getters throughout (see [datetime.ts](./datetime.ts)), matching how
 * SheetJS built the Date — `toISOString` here would shift the day by one for
 * anyone not on UTC.
 */
function formatCellDate(value: Date): string {
  const date = formatDate(value);
  const h = value.getHours();
  const m = value.getMinutes();
  const s = value.getSeconds();
  if (h === 0 && m === 0 && s === 0) return date;
  return `${date} ${formatTime(value, s !== 0)}`;
}

/**
 * Normalize a parsed cell to the editable string the table shows — and the
 * string the validation engine checks, the report prints and the export writes
 * back. The one place a parsed value becomes text, so dates are formatted here
 * rather than at each of those call sites.
 */
export function cellToString(value: CellValue): string {
  if (value === null) return "";
  if (value instanceof Date) return formatCellDate(value);
  return String(value);
}

/**
 * The inverse of {@link formatCellDate}: read an edited `dd-mm-yyyy` (with an
 * optional `HH:mm[:ss]`) back into a Date, or `null` when the text isn't one.
 *
 * Rolled-over dates are rejected — `new Date(2025, 1, 31)` happily lands on 3
 * March, which would write a date the user never typed into their file.
 */
function parseCellDate(value: string): Date | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  if (date.getDate() !== d || date.getMonth() !== mo - 1 || date.getFullYear() !== y) {
    return null;
  }
  return date;
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Fill for a flagged cell, ARGB. Same hue as the table's `bg-k-red-bg` but one
 * stop darker (red-100): Excel gives the eye no focus ring or corner triangle to
 * help, so the -50 tint reads as white there. Still light enough that black text
 * stays legible and a sheet full of flags looks like a checklist rather than an
 * alarm.
 *
 * One fill, not two — an amber `warning` tint used to sit beside it, and there
 * is no second severity left to paint.
 */
const ERROR_FILL = "FFFEE2E2";

/**
 * Fill for a cell the tool filled with its default (`ValidationResult.defaults`),
 * ARGB — amber-100, the file's counterpart of the table's `bg-k-amber-bg`, one stop
 * darker for the same reason as {@link ERROR_FILL}. Not a severity: it says "this
 * value was not typed by you", so the client can see what the tool filled in.
 */
const DEFAULT_FILL = "FFFEF3C7";

/** Cap on auto-fitted column width, in characters. */
const MAX_COLUMN_WIDTH = 60;
/** Breathing room added to a fitted column so text doesn't touch the gridline. */
const COLUMN_PADDING = 2;

/** What the tool asks for when saving the edited grid back out to a file. */
export interface DownloadRequest {
  /** The upload's name — the output keeps its base name and re-stamps it. */
  fileName: string;
  /** Every parsed sheet, in workbook order — all of them end up in the output. */
  sheets: ParsedSheet[];
  /** Index into `sheets` of the one the user has been editing. */
  sheetIndex: number;
  /** Current (edited) values for the edited sheet, as the table shows them. */
  rows: string[][];
  /** `"row:col"` keys of the cells the user actually changed. */
  dirtyKeys?: Set<string>;
  /** Validation issues to carry into the file, keyed `"row:col"`. */
  issues?: Map<string, Issue[]>;
  /**
   * Blank cells the validation filled with a default (`default-if-empty`, or a
   * column the conversion fills), keyed `"row:col"` → the value. Written into the
   * file and tinted with {@link DEFAULT_FILL}, so the sheet that leaves the tool
   * holds what goes to AFAS (Taroen, 13-10-2026).
   */
  defaults?: Map<string, string>;
  /**
   * The uploaded file itself. When it's an `.xlsx` the export re-opens it and
   * patches it in place, so the client's own formatting survives.
   */
  sourceFile?: File | null;
  /**
   * The project this sheet belongs to. Goes in front of the output's name so a
   * file that leaves the tool says whose conversion it is — see
   * {@link downloadName}. Optional only so a caller outside a project can still
   * write a workbook; inside one it is always passed.
   */
  projectId?: string | null;
}

/** The sheet the user edited — the one `rows`, `dirtyKeys` and `issues` describe. */
function editedSheet(req: DownloadRequest): ParsedSheet | undefined {
  return req.sheets[req.sheetIndex];
}

/**
 * Tint each flagged cell and hang its validation message(s) off it as an Excel
 * note. Only the offending cell is touched — never the whole row — so the sheet
 * stays readable no matter how many issues it holds. A cell that failed several
 * rules gets one fill and lists every message.
 *
 * `issues` is keyed `"row:col"` on the *data* grid; `toExcelRow` maps a grid row
 * onto its line in this particular sheet, and `firstColumn` is the 1-based Excel
 * column grid column 0 sits in — both differ between a patched original and a
 * freshly built one (the rebuild always starts at A1).
 */
function annotate(
  worksheet: Worksheet,
  req: DownloadRequest,
  toExcelRow: (gridRow: number) => number | undefined,
  firstColumn: number
): void {
  const columnCount = editedSheet(req)?.headers.length ?? 0;
  for (const key of req.defaults?.keys() ?? []) {
    // A flagged cell keeps its red: the error is what the client must act on.
    if (req.issues?.get(key)?.length) continue;
    const [r, c] = key.split(":").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    if (c < 0 || c >= columnCount) continue;
    const excelRow = toExcelRow(r);
    if (excelRow === undefined) continue;
    const cell = worksheet.getCell(excelRow, c + firstColumn);
    // A fresh style object, for the shared-`xf` reason given below.
    cell.style = {
      ...cell.style,
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: DEFAULT_FILL } },
    };
  }
  if (!req.issues?.size) return;
  for (const [key, cellIssues] of req.issues) {
    if (cellIssues.length === 0) continue;
    const [r, c] = key.split(":").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    if (c < 0 || c >= columnCount) continue;
    const excelRow = toExcelRow(r);
    if (excelRow === undefined) continue;

    const cell = worksheet.getCell(excelRow, c + firstColumn);

    // Assign a *fresh* style object rather than setting `cell.fill`. ExcelJS
    // hands every cell that shared an `xf` in the original file the very same
    // style object, and `cell.fill = …` mutates it in place — so tinting one
    // cell would tint every cell sharing its formatting. On a real client sheet
    // that meant 2037 of 2058 cells coming out tinted. Spreading into a new
    // object keeps the fill local.
    cell.style = {
      ...cell.style,
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: ERROR_FILL },
      },
    };
    // Deliberately no `cell.note` here. A note is a floating VML object, and Excel
    // warns "Fixed objects will move." on *every* filter action of a sheet that
    // holds one — the boxes would have to move as the filter hides rows. On a real
    // Medewerkers export that is ~7000 notes and a dialog the user cannot dismiss
    // for good, on a file whose whole point is that they filter it. Neither the
    // shapes' geometry nor their MoveWithCells/SizeWithCells flags avoid it (Excel's
    // own files carry the same flags), so the note itself has to go. The tint marks
    // *which* cell is wrong; the messages live on in the validation report PDF
    // (`report-pdf.ts`), which lists every column's messages against the Excel rows
    // they land on — so nothing is lost by leaving them out of the workbook.
  }
}

/**
 * The legacy palette entries that are a red, orange, yellow or pink — what an
 * `indexed` fill (the kind older Excel files and many exports write) resolves to.
 * Only the marking colours are listed; any other index is left alone.
 */
const MARK_INDEXED: Record<number, string> = {
  2: "FF0000", 5: "FFFF00", 10: "FF0000", 13: "FFFF00", 16: "800000",
  43: "FFFF99", 45: "FF99CC", 47: "FFCC99", 51: "FFCC00", 52: "FF9900",
  53: "FF6600",
};

/** Theme colour slots in the order a fill's `theme` index counts them. */
const THEME_SLOTS = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/**
 * The workbook theme's colours by slot index, read from its `theme1.xml` — a
 * `theme` fill names a slot, and which colour that is differs per theme (Office
 * 2013's accent2 is orange, Office 2007's is red). Empty when ExcelJS kept no
 * theme, which leaves every theme fill judged unknown and therefore kept.
 */
function themeColors(workbook: Workbook): string[] {
  const xml = (workbook as unknown as { _themes?: Record<string, string> })._themes
    ?.theme1;
  if (!xml) return [];
  return THEME_SLOTS.map((slot) => {
    const block = xml.match(new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`))?.[1] ?? "";
    return (
      block.match(/srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ??
      block.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1] ??
      ""
    );
  });
}

/**
 * Whether a colour reads as a mark — red, orange, yellow or pink — rather than
 * a formatting choice: warm hue, some saturation, and neither near-black nor
 * near-white. `tint` is Excel's lighten/darken on a theme colour.
 */
function isMarkColor(hex: string, tint = 0): boolean {
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return false;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return s > 0.25 && l > 0.15 && l < 0.97 && (h <= 70 || h >= 320);
}

/**
 * Whether a cell's fill is a red/yellow mark — ours from an earlier download, or
 * one somebody painted by hand to flag a problem.
 */
function isMarkFill(fill: Fill | undefined, theme: string[]): boolean {
  if (!fill) return false;
  const colors =
    fill.type === "pattern"
      ? [fill.fgColor, fill.pattern === "solid" ? undefined : fill.bgColor]
      : fill.stops.map((stop) => stop.color);
  return colors.some((color) => {
    if (!color) return false;
    if (color.argb) return isMarkColor(color.argb.slice(-6));
    const extended = color as { indexed?: number; theme?: number; tint?: number };
    if (extended.indexed !== undefined) {
      return isMarkColor(MARK_INDEXED[extended.indexed] ?? "");
    }
    if (extended.theme !== undefined) {
      return isMarkColor(theme[extended.theme] ?? "", extended.tint ?? 0);
    }
    return false;
  });
}

/**
 * Strip every red/yellow fill from the edited sheet's data cells, so the flags
 * {@link annotate} paints afterwards are the *only* ones in the file.
 *
 * A client re-uploads the file the tool gave them — tinted by the last check —
 * and often marks cells of their own on top. Without this, a cell fixed since
 * keeps the tint from the earlier download and the file claims errors the
 * uploader no longer has. Only the data rows and the sheet's own columns: the
 * header band and anything beside the table are the client's layout, not marks.
 * Any other colour (a grey "not used" column, a blue key column) is kept.
 *
 * Fresh style objects again, for the reason given in {@link annotate}: a shared
 * `xf` mutated in place would clear the fill of every cell sharing it.
 */
function wipeMarks(
  worksheet: Worksheet,
  target: ParsedSheet,
  theme: string[]
): void {
  const lastColumn = target.firstColumnNumber + target.headers.length - 1;
  for (const rowNumber of target.rowNumbers) {
    const row = worksheet.findRow(rowNumber);
    if (!row) continue;
    for (let c = target.firstColumnNumber; c <= lastColumn; c++) {
      const cell = row.findCell(c);
      if (!cell || !isMarkFill(cell.style?.fill, theme)) continue;
      const style = { ...cell.style };
      delete style.fill;
      cell.style = style;
    }
  }
}

/**
 * Rough rendered width of a cell, in characters. `cell.text` hands back the raw
 * value, so a number carrying a format (`#,##0.00 "EUR"` renders as
 * `45.000,00 EUR`) reads far shorter than Excel will draw it — the format string
 * is a serviceable stand-in for that width. Excel's own auto-fit uses font
 * metrics the browser doesn't have here, so this is an estimate either way.
 */
function displayLength(cell: ReturnType<Worksheet["getCell"]>): number {
  const numFmtWidth = cell.numFmt
    ? cell.numFmt.replace(/[\\"*_;@]/g, "").length
    : 0;
  if (cell.value instanceof Date) return Math.max(10, numFmtWidth);

  const text = typeof cell.text === "string" ? cell.text : String(cell.text ?? "");
  let widest = numFmtWidth;
  for (const line of text.split("\n")) widest = Math.max(widest, line.length);
  return widest;
}

/**
 * The parts of an ExcelJS row {@link trimTrailingRows} judges it by: whether it
 * holds a value, and whether it carries layout worth keeping on its own.
 */
interface TrimmableRow {
  hasValues?: boolean;
  height?: number;
  outlineLevel?: number;
}

/**
 * Drop the empty rows trailing the data, so the file we write out is the size of
 * what it holds.
 *
 * The read side works around Excel's inflated used range ({@link usedRange});
 * this is the same illness on the way back out, and there it is fatal rather
 * than slow. A customer export arrived carrying a *materialized* `<row>` for
 * every one of 1,047,099 rows — 15MB of file for 268 rows of data — and ExcelJS
 * writes back every row it loaded: serializing them exhausted the JS heap and
 * killed the save outright. Trimming is what makes such a workbook saveable at
 * all, and it takes the download from 15MB to roughly its real size.
 *
 * Only rows **after the last one holding a value** are removed, and only when
 * they hold no value themselves. `hasValues` is false for a row of styled-but-
 * empty cells, which is exactly the padding to drop — but a row carrying a
 * height or an outline level is a deliberate piece of layout, so it is kept and
 * stops the trim where it sits. Nothing inside the data is ever touched: a blank
 * row between two filled ones is the client's own spacing.
 */
function trimTrailingRows(worksheet: Worksheet): void {
  // `dimensions` is computed from the rows that actually carry cells, so unlike
  // `rowCount` it already ignores the padding — it is the honest bottom.
  const lastRow = worksheet.dimensions?.bottom ?? 0;
  // `_rows` is ExcelJS's own backing array, reached the same way `LoadedTable`
  // above reaches a loaded table's model: there is no public API for shortening
  // a sheet, and `spliceRows` would rewrite every remaining row's number.
  const { _rows: rows } = worksheet as unknown as { _rows?: TrimmableRow[] };
  if (!Array.isArray(rows) || rows.length <= lastRow) return;

  let end = rows.length;
  while (end > lastRow) {
    const row = rows[end - 1];
    if (row && (row.hasValues || row.height || row.outlineLevel)) break;
    end--;
  }
  if (end < rows.length) rows.length = end;
}

/**
 * Widen every column to its longest cell. This deliberately overrides the
 * original file's own column widths — it's the one piece of the client's
 * formatting the export replaces, because a column sized for a short label
 * hides the long values underneath it.
 *
 * Merged cells are skipped: their text spans several columns, so measuring it
 * here would stretch one column to fit text it doesn't hold.
 */
function fitColumnWidths(worksheet: Worksheet): void {
  for (let c = 1; c <= worksheet.columnCount; c++) {
    const column = worksheet.getColumn(c);
    let widest = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged) return;
      widest = Math.max(widest, displayLength(cell));
    });
    if (widest > 0) {
      column.width = Math.min(MAX_COLUMN_WIDTH, widest + COLUMN_PADDING);
    }
  }
}

/**
 * Fit an edited string back into a cell that already holds a typed value. A
 * numeric cell stays numeric and a date cell stays a date, so the client's own
 * number/date format still applies to it; anything else goes back as text,
 * matching what the table showed.
 *
 * A date cell whose new text isn't a `dd-mm-yyyy` date falls through to text
 * rather than being dropped — the value survives into the file and validation
 * flags it there, instead of the edit silently disappearing.
 */
function coerceEdit(next: string, previous: unknown): string | number | Date | null {
  if (next === "") return null;
  if (previous instanceof Date) {
    const date = parseCellDate(next.trim());
    if (date) return date;
  }
  const text = next.trim();
  // Only when the number says what was typed. A leading zero (`0123` — a padded
  // BSN, an administratiecode) and an integer past 2^53 would both be changed by
  // the conversion, and the file would then carry another value than the one the
  // grid showed and validation passed; those go back as text instead.
  if (
    typeof previous === "number" &&
    /^-?\d+([.,]\d+)?$/.test(text) &&
    !/^-?0\d/.test(text)
  ) {
    const numeric = Number(text.replace(",", "."));
    const integer = /^-?\d+$/.test(text);
    if (Number.isFinite(numeric) && (!integer || Number.isSafeInteger(numeric))) return numeric;
  }
  return next;
}

/**
 * Write the user's edits into the sheet — and only those. Untouched cells are
 * left completely alone, so their type, formula and formatting survive intact.
 *
 * This patches the client's own file, so grid column 0 is wherever the sheet's
 * data actually starts (`firstColumnNumber`), not necessarily column A.
 */
function applyEdits(worksheet: Worksheet, req: DownloadRequest): void {
  const target = editedSheet(req);
  if (!target || !req.dirtyKeys?.size) return;
  for (const key of req.dirtyKeys) {
    const [r, c] = key.split(":").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    if (c < 0 || c >= target.headers.length) continue;
    const excelRow = target.rowNumbers[r];
    if (excelRow === undefined) continue;
    const cell = worksheet.getCell(excelRow, c + target.firstColumnNumber);
    cell.value = coerceEdit(req.rows[r]?.[c] ?? "", cell.value);
  }
}

/** Column letters → their 1-based number (`AB` → `28`). */
function columnNumber(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

/** A range like `A1:Z100`, as 1-based numbers — or null when it isn't one. */
function parseRange(
  ref: string | undefined
): { c1: number; r1: number; c2: number; r2: number } | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref ?? "");
  if (!m) return null;
  return { c1: columnNumber(m[1]), r1: Number(m[2]), c2: columnNumber(m[3]), r2: Number(m[4]) };
}

/**
 * Every cell address in `ref` (`C2`, `C2:F9`, several space-separated) moved one
 * column right when it sits at or right of column `at` — the address arithmetic of
 * inserting a column. Anything that isn't an address is left as it is.
 */
function shiftRef(ref: string, at: number): string {
  return ref.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (whole, d1, letters, d2, row) => {
    const col = columnNumber(letters);
    return col >= at ? `${d1}${columnLetter(col)}${d2}${row}` : whole;
  });
}

/**
 * {@link shiftRef} for a formula: the same move, applied only to what is a
 * reference to **this** sheet. Text in quotes is left alone, as is a reference
 * qualified by a sheet name (`Lijsten!C2` points elsewhere, where nothing moved),
 * and a name followed by `(` — `LOG10(` is a function, not cell LOG10.
 */
function shiftFormula(formula: string, at: number): string {
  // Split out what must not move — quoted text, and a sheet-qualified reference
  // whole, range end included (`Lijsten!$C$2:$C$5`) — and shift only the rest.
  return formula
    .split(
      /("(?:[^"]|"")*"|(?:'(?:[^']|'')*'|[A-Za-z0-9_.]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/
    )
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /(?<![A-Za-z0-9_!.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(!A-Za-z_])/g,
            (whole, d1, letters, d2, row) => {
              const col = columnNumber(letters);
              return col >= at ? `${d1}${columnLetter(col)}${d2}${row}` : whole;
            }
          )
    )
    .join("");
}

/**
 * Insert an empty column into the client's sheet before 1-based column `at`, and
 * move what Excel would move with it.
 *
 * `spliceColumns` shifts the cells, their styles and the column widths, and nothing
 * else — so a template's own furniture would stay on the old addresses and land on
 * the wrong column: a dropdown (data validation) on the column beside it, a merged
 * title band one cell short. Those are moved here: merged ranges are taken apart
 * and put back shifted or widened; tables, data validations and conditional
 * formatting are re-addressed. An Excel Table the column lands inside, or right
 * behind on the header row, gains a table column named `name`.
 *
 * The formulas of those rules are shifted too ({@link shiftFormula}), since they
 * point at this sheet's cells. **Not** rewritten: formulas in the cells themselves,
 * which keep pointing at the cells they named. A client's data export rarely holds
 * any; one that does should be checked by hand.
 */
function insertSheetColumn(
  worksheet: Worksheet,
  at: number,
  name: string,
  headerRow: number
): void {
  type Merge = { top: number; left: number; bottom: number; right: number };
  const merges = Object.values(
    (worksheet as unknown as { _merges: Record<string, Merge> })._merges
  )
    .filter((m): m is Merge => Boolean(m) && m.right >= at)
    .map((m) => ({ top: m.top, left: m.left, bottom: m.bottom, right: m.right }));
  for (const m of merges) worksheet.unMergeCells(m.top, m.left, m.bottom, m.right);

  worksheet.spliceColumns(at, 0, []);

  for (const m of merges) {
    worksheet.mergeCells(m.top, m.left >= at ? m.left + 1 : m.left, m.bottom, m.right + 1);
  }

  for (const table of worksheet.getTables() as unknown as LoadedTable[]) {
    const range = parseRange(table.model.tableRef);
    const columns = table.model.columns;
    if (!range || !columns) continue;
    const appends =
      at === range.c2 + 1 && range.r1 === headerRow && table.model.headerRow !== false;
    if (range.c1 >= at) {
      // Wholly to the right: the table moves, unchanged.
    } else if (at <= range.c2 || appends) {
      columns.splice(at - range.c1, 0, { name, filterButton: true });
    } else {
      continue;
    }
    const c1 = range.c1 >= at ? range.c1 + 1 : range.c1;
    const ref = `${columnLetter(c1, 0)}${range.r1}:${columnLetter(range.c2)}${range.r2}`;
    table.model.tableRef = ref;
    if (table.model.autoFilterRef) table.model.autoFilterRef = ref;
  }

  // Both are on the worksheet at runtime but missing from ExcelJS's typings.
  const furniture = worksheet as unknown as {
    dataValidations?: { model: Record<string, unknown> };
    conditionalFormattings?: { ref: string; rules: { ref?: string; formulae?: unknown[] }[] }[];
  };
  if (furniture.dataValidations) {
    // One rule object is shared by every cell of its range, so each is shifted once.
    const seen = new Set<unknown>();
    furniture.dataValidations.model = Object.fromEntries(
      Object.entries(furniture.dataValidations.model).map(([address, rule]) => {
        const formulae = (rule as { formulae?: unknown[] } | undefined)?.formulae;
        if (formulae && !seen.has(rule)) {
          seen.add(rule);
          formulae.forEach((f, i) => {
            if (typeof f === "string") formulae[i] = shiftFormula(f, at);
          });
        }
        return [shiftRef(address, at), rule];
      })
    );
  }

  for (const cf of furniture.conditionalFormattings ?? []) {
    cf.ref = shiftRef(cf.ref, at);
    for (const rule of cf.rules) {
      if (rule.ref) rule.ref = shiftRef(rule.ref, at);
      if (rule.formulae) {
        rule.formulae = rule.formulae.map((f) => (typeof f === "string" ? shiftFormula(f, at) : f));
      }
    }
  }
}

/**
 * Carry a column repair (`lib/column-repair.ts`) into the client's own workbook:
 * insert the columns it added where the grid has them, and write every header it
 * set — an inserted column's name, a renamed column's new one — so the file they
 * go on in carries them. Returns whether the sheet grew a column: the caller's
 * filter range has to grow with it.
 *
 * The insertions are replayed in ascending grid order, which rebuilds the grid's
 * layout from the original file: each one lands where the grid has it because
 * every one before it, further left, is already in place.
 *
 * An inserted column takes its neighbour's look — the left one, or the right one at
 * the sheet's first column — header and data cells alike, so it doesn't stand out
 * as plain cells in a styled header band. The number format is not copied: it
 * belongs to the neighbour's values, not to these. Must run before
 * {@link applyEdits}, which writes into the columns this inserts.
 *
 * A renamed header inside an Excel Table renames its table column too: Excel
 * requires the two to be equal, and repairs a file where they aren't.
 */
function applyHeaderEdits(worksheet: Worksheet, req: DownloadRequest): boolean {
  const target = editedSheet(req);
  if (!target) return false;
  const keys = req.dirtyKeys ?? new Set<string>();
  const added = addedColumns(keys);
  const first = target.firstColumnNumber;
  const headerRow = target.headerRowNumber;

  for (const c of added) {
    insertSheetColumn(worksheet, c + first, target.headers[c] ?? "", headerRow);
  }
  const addedSet = new Set(added);
  for (const c of added) {
    let from = c - 1;
    if (from < 0) {
      from = c + 1;
      while (addedSet.has(from)) from++;
    }
    if (from >= target.headers.length) continue;
    const lookOf = (row: number) => {
      const style = { ...worksheet.getCell(row, from + first).style };
      delete style.numFmt;
      return style;
    };
    for (const row of [headerRow, ...target.rowNumbers]) {
      worksheet.getCell(row, c + first).style = lookOf(row);
    }
  }

  const tables = worksheet.getTables() as unknown as LoadedTable[];
  for (const c of editedHeaderColumns(keys)) {
    const name = target.headers[c];
    if (name === undefined) continue;
    const column = c + first;
    worksheet.getCell(headerRow, column).value = name;
    for (const table of tables) {
      const range = parseRange(table.model.tableRef);
      if (!range || range.r1 !== headerRow || column < range.c1 || column > range.c2) continue;
      const own = table.model.columns?.[column - range.c1];
      if (own) own.name = name;
    }
  }
  return added.length > 0;
}

/**
 * What ExcelJS actually hands back for a table it read out of a file: the raw
 * model, without the `ref` and `rows` a table built through `addTable()` has.
 * Its public `Table` typing describes the built kind, so mutating a loaded table
 * has to go through this.
 */
interface LoadedTable {
  model: {
    name?: string;
    headerRow?: boolean;
    /** The table's range, `A1:Z100`. */
    tableRef?: string;
    autoFilterRef?: string;
    columns?: { name?: string; filterButton?: boolean }[];
  };
}

/**
 * Restore the two table attributes ExcelJS loses when it re-saves a file whose
 * tables it didn't create itself.
 *
 * Both are the same mistake: an *omitted* attribute means "the default", but
 * ExcelJS reads omission as `false`.
 *
 * - `headerRowCount` defaults to 1 and Excel leaves it out when it *is* 1, so
 *   `attributes.headerRowCount === '1'` makes every ordinary table headerless
 *   and the re-save writes `headerRowCount="0"`. That one attribute broke the
 *   export twice over: Excel stops painting the header band, and templates whose
 *   header font is white (the Wagenpark template's is `theme="0"`) come out with
 *   an apparently empty header row — the labels are still in the sheet, just
 *   white on white. A table without a header row also can't carry filter
 *   buttons, so Excel strips the table's `<autoFilter>` and reports the file as
 *   needing repair: *"Removed Records: AutoFilter from /xl/tables/table1.xml
 *   part (Table)"*.
 * - `hiddenButton` defaults to false (button shown) and Excel writes no
 *   `<filterColumn>` at all when every column is default, so a loaded column has
 *   `filterButton: undefined` — and ExcelJS renders that as `hiddenButton="1"`,
 *   hiding all the filter dropdowns.
 *
 * The header truth comes from the upload's own `xl/tables/*.xml` rather than a
 * blanket `true`, so a genuinely headerless table stays headerless. Tables are
 * matched by name: ExcelJS renumbers the table parts on write, so the file names
 * can't be relied on.
 *
 * This walks *every* worksheet, not just the edited one. ExcelJS re-serializes
 * all of them, so a table on a sheet nobody touched breaks exactly the same way
 * — which is how the Uitzendkrachten template still came out needing repair
 * after the edited sheet's own table was fixed.
 */
async function restoreTableDefaults(
  workbook: Workbook,
  source: ArrayBuffer
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(source);

  const headerRows = new Map<string, boolean>();
  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const xml = await zip.file(path)!.async("string");
    // Only the opening <table> tag — `name` also appears on every tableColumn.
    const open = xml.match(/<table\b[^>]*>/)?.[0];
    const name = open?.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    // Absent, "1", or anything but "0" all mean the table has a header row.
    headerRows.set(name, open?.match(/\bheaderRowCount="(\d+)"/)?.[1] !== "0");
  }

  // Straight at the model: the `Table` wrapper's own setters re-measure the
  // table footprint from `rows`, which a loaded table hasn't got, so
  // `table.headerRow = true` throws before it assigns anything.
  for (const worksheet of workbook.worksheets) {
    for (const table of worksheet.getTables() as unknown as LoadedTable[]) {
      const headerRow = table.model.name
        ? headerRows.get(table.model.name)
        : undefined;
      if (headerRow !== undefined) table.model.headerRow = headerRow;
      for (const column of table.model.columns ?? []) {
        if (column.filterButton === undefined) column.filterButton = true;
      }
    }
  }
}

/** What patching the original produced: the workbook, and the bytes it was read from. */
interface PatchedWorkbook {
  workbook: Workbook;
  /** The upload's own bytes — {@link restoreDroppedParts} reads its zip a second time. */
  source: ArrayBuffer;
  /** Whether a column repair inserted a column, shifting every reference right of it. */
  columnsInserted: boolean;
}

/**
 * Re-open the uploaded `.xlsx` and patch it, so everything the client styled —
 * fonts, fills, borders, number formats, row heights, merges, frozen panes,
 * conditional formatting, data validation, other sheets — comes back out
 * untouched. Only edited cells and flagged cells are written.
 *
 * Returns `null` when this isn't possible, leaving the caller to build a plain
 * sheet instead. That happens for non-`.xlsx` uploads and, notably, for any
 * workbook holding an image or a chart: ExcelJS throws outright while
 * reconciling drawings it didn't author, so a client logo would otherwise break
 * the download entirely.
 */
async function patchOriginal(
  newWorkbook: () => Workbook,
  req: DownloadRequest
): Promise<PatchedWorkbook | null> {
  const target = editedSheet(req);
  if (!target || !req.sourceFile || !/\.xlsx$/i.test(req.fileName)) return null;
  try {
    const source = await req.sourceFile.arrayBuffer();
    const workbook = newWorkbook();
    await workbook.xlsx.load(source);
    const worksheet =
      workbook.getWorksheet(target.name) ?? workbook.worksheets[0];
    if (!worksheet) return null;

    // Columns first: the edits below write into the ones a repair inserted.
    const grew = applyHeaderEdits(worksheet, req);
    applyEdits(worksheet, req);
    // A filter the client set stops at their last column; one covering a column
    // the repair added is rebuilt below, over the sheet's new width.
    if (grew && worksheet.autoFilter) worksheet.autoFilter = undefined;
    // Only once a check has run: then the flags below are the whole truth about
    // the sheet, and a mark they don't repeat is stale. A save with no check
    // behind it knows nothing either way, so it leaves the client's marks be.
    if (req.issues) wipeMarks(worksheet, target, themeColors(workbook));
    annotate(
      worksheet,
      req,
      (gridRow) => target.rowNumbers[gridRow],
      target.firstColumnNumber
    );

    // Every sheet's tables, not just the edited one — see
    // {@link restoreTableDefaults}.
    if (workbook.worksheets.some((sheet) => sheet.getTables().length > 0)) {
      await restoreTableDefaults(workbook, source);
    }

    // Every sheet, not just the edited one: all of them are written back out, so
    // padding on any of them is padding in the download — and enough of it on any
    // one sheet is what exhausts the heap. Done before the autoFilter below and
    // the widths after it, so both measure the sheet as it will be written.
    for (const sheet of workbook.worksheets) trimTrailingRows(sheet);

    // Only add filter handles if the edited sheet has none of its own. An Excel
    // Table carries its own autoFilter, and a worksheet-level one overlapping a
    // table range is invalid — Excel rejects the whole sheet for it.
    const hasTable = worksheet.getTables().length > 0;
    if (!worksheet.autoFilter && !hasTable && target.headers.length > 0) {
      // `actualRowCount`, not `rowCount`: the latter is the sheet's declared
      // used range, which overstates the data by however far Excel's
      // high-water mark ran ahead of it (see `usedRange`). A filter handle
      // spanning a million empty rows is one the client cannot use.
      const lastRow = Math.max(
        target.rowNumbers[target.rowNumbers.length - 1] ?? 0,
        worksheet.actualRowCount
      );
      worksheet.autoFilter = {
        from: { row: target.headerRowNumber, column: target.firstColumnNumber },
        to: {
          row: Math.max(target.headerRowNumber, lastRow),
          column: target.firstColumnNumber + target.headers.length - 1,
        },
      };
    }
    fitColumnWidths(worksheet);
    return { workbook, source, columnsInserted: grew };
  } catch {
    return null;
  }
}

/**
 * Build a plain workbook from the parsed grid — every sheet, in the original
 * order, with the edited one carrying its edits and flags. Used when the upload
 * can't be patched in place; the client's formatting is gone either way, but the
 * data and the sheet layout still come through.
 */
function buildFresh(newWorkbook: () => Workbook, req: DownloadRequest): Workbook {
  const workbook = newWorkbook();

  req.sheets.forEach((parsed, index) => {
    // Excel caps sheet names at 31 characters.
    const worksheet = workbook.addWorksheet(
      parsed.name.slice(0, 31) || tr(`Blad${index + 1}`, `Sheet${index + 1}`)
    );
    worksheet.addRow(parsed.headers);

    if (index === req.sheetIndex) {
      for (const row of req.rows) worksheet.addRow(row);
      // Rebuilt from A1: header is row 1, so grid row 0 is Excel row 2 and grid
      // column 0 is column A — whatever the original sheet's offsets were.
      annotate(
        worksheet,
        req,
        (gridRow) => (gridRow >= 0 && gridRow < req.rows.length ? gridRow + 2 : undefined),
        1
      );
    } else {
      // Untouched sheet — write its parsed values as-is, keeping numbers numeric.
      for (const row of parsed.rows) worksheet.addRow(row);
    }

    const rowCount = index === req.sheetIndex ? req.rows.length : parsed.rows.length;
    if (parsed.headers.length > 0 && rowCount > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rowCount + 1, column: parsed.headers.length },
      };
    }
    fitColumnWidths(worksheet);
  });

  return workbook;
}

/**
 * Move each `<legacyDrawing>` ahead of `<tableParts>` in every worksheet.
 *
 * ExcelJS renders `tableParts` first and only then appends the `legacyDrawing`
 * that a cell note needs, but ECMA-376's `CT_Worksheet` sequence puts
 * `legacyDrawing` before `tableParts`. The XML stays well-formed, so nothing
 * complains until Excel opens it and drops the sheet — "Replaced Part:
 * /xl/worksheets/sheet1.xml part with XML error. Load error." That hits any
 * sheet holding both an Excel Table and one of our notes, which is most filled-in
 * client templates. Both elements are self-closing leaves, so reordering the
 * serialized text is safe and leaves everything else byte-identical.
 *
 * Dormant since {@link annotate} stopped writing notes (see the comment there): with
 * no note there is no `legacyDrawing`, so this finds nothing and returns the buffer
 * untouched. Kept because it is the guard for that corruption — anything that puts a
 * note or another VML object back on the sheet needs it again.
 */
async function reorderLegacyDrawings(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  let repaired = false;
  for (const path of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = await zip.file(path)!.async("string");
    if (!/<tableParts\b/.test(xml)) continue;

    const drawings = xml.match(/<legacyDrawing\b[^>]*\/>/g);
    if (!drawings) continue;

    let stripped = xml;
    for (const node of drawings) stripped = stripped.replace(node, "");
    const at = stripped.search(/<tableParts\b/);
    if (at === -1) continue;

    zip.file(path, stripped.slice(0, at) + drawings.join("") + stripped.slice(at));
    repaired = true;
  }

  if (!repaired) return buffer;
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * Add one relationship to a `.rels` part's XML, right before its closing tag — the
 * same shape `<Relationship Id="…" Type="…" Target="…"/>` every other entry already
 * has. Assumes the part is well-formed (it came out of a file Excel itself wrote),
 * so a plain string insert is safe and keeps every other byte untouched.
 */
function addRelationship(relsXml: string, id: string, type: string, target: string): string {
  const entry = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  return relsXml.replace("</Relationships>", `${entry}</Relationships>`);
}

/** The next unused `rIdN` in a `.rels` part, so an added relationship can't collide. */
function nextRelationshipId(relsXml: string): string {
  const used = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(used.length ? Math.max(...used) : 0) + 1}`;
}

const CUSTOM_XML_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const CUSTOM_PROPS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";

/**
 * Carry over the two kinds of part ExcelJS drops on the floor when it re-saves a
 * workbook it didn't author: `customXml/*` (arbitrary XML a client's own tooling
 * embedded — Excel round-trips it, ExcelJS never reads it) and `docProps/custom.xml`
 * (the *Aangepaste eigenschappen* a client set under Bestand → Info). Neither
 * corrupts the file by being missing — Excel opens the ExcelJS output fine — but a
 * client whose own process reads either back out of the file it gets from this tool
 * would otherwise find them silently gone.
 *
 * Copying the parts alone isn't enough: both are only *found* by Excel through a
 * relationship in the package's root `_rels/.rels` (plus a content-type entry in
 * `[Content_Types].xml`), and ExcelJS's rewritten `.rels` naturally has neither,
 * since it never knew the parts existed. So this adds all three — the part itself,
 * its relationship, its content type — using IDs and extensions read back out of the
 * *original* upload's own `.rels`/`[Content_Types].xml`, not invented ones, so a
 * `customXml` part that itself points at further parts (its own `_rels/item1.xml.rels`,
 * schema references) keeps working exactly as it did in the file the client sent.
 */
async function restoreDroppedParts(
  buffer: ArrayBuffer,
  source: ArrayBuffer
): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const [zip, original] = await Promise.all([
    JSZip.loadAsync(buffer),
    JSZip.loadAsync(source),
  ]);

  const originalRels = await original.file("_rels/.rels")?.async("string");
  if (!originalRels) return buffer;

  const droppedTargets = [...originalRels.matchAll(/Target="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((target) => target.startsWith("customXml/") || target === "docProps/custom.xml");

  if (droppedTargets.length === 0) return buffer;

  let rels = await zip.file("_rels/.rels")!.async("string");
  const alreadyLinked = new Set([...rels.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]));
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  let changed = false;

  for (const target of droppedTargets) {
    if (alreadyLinked.has(target)) continue;
    const part = original.file(target);
    if (!part) continue;

    // Every part the target itself references (its own `.rels`, if any) — a
    // `customXml` item's `_rels/itemN.xml.rels` lives alongside it and is invisible
    // to a root-relationship walk, so it's carried over by folder rather than by name.
    // `original.files` also lists the folder entries themselves (paths ending `/`,
    // for which `.file()` returns null rather than a readable part) — filtered out
    // via `!dir`, not just by name, since JSZip marks them either way.
    const folder = target.includes("/") ? target.slice(0, target.lastIndexOf("/") + 1) : "";
    const siblingRels = folder
      ? Object.values(original.files)
          .filter((entry) => !entry.dir && entry.name.startsWith(`${folder}_rels/`))
          .map((entry) => entry.name)
      : [];
    for (const relPart of siblingRels) {
      if (zip.file(relPart)) continue;
      zip.file(relPart, await original.file(relPart)!.async("uint8array"));
    }

    zip.file(target, await part.async("uint8array"));

    const id = nextRelationshipId(rels);
    const type = target.startsWith("customXml/") ? CUSTOM_XML_REL_TYPE : CUSTOM_PROPS_REL_TYPE;
    rels = addRelationship(rels, id, type, target);

    // `[Content_Types].xml`: a `customXml/item*.xml` is covered by the package-wide
    // `Default Extension="xml"` entry ExcelJS's output already has (every workbook
    // needs one), so only `docProps/custom.xml` — its own `Override`, since it isn't
    // a bare `.xml` content type — ever needs an addition here.
    if (target === "docProps/custom.xml" && !contentTypes.includes('PartName="/docProps/custom.xml"')) {
      contentTypes = contentTypes.replace(
        "</Types>",
        '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'
      );
    }
    changed = true;
  }

  if (!changed) return buffer;
  zip.file("_rels/.rels", rels);
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * Re-inject the original workbook's `<dxfs>` block — the fills/fonts a table's
 * `headerRowDxfId`/`dataDxfId` and Excel's own conditional-formatting rules point
 * at by index — into ExcelJS's rewritten `xl/styles.xml`.
 *
 * ExcelJS drops `<dxfs>` wholesale on every save and emits none of its own **unless**
 * the sheet carries conditional formatting, in which case it writes its own dxf
 * entries for those rules. Only the first case is safe to fix by copying: the
 * `dxfId` references already in the file (a table's header/data style, any
 * conditional-formatting rule) are 0-based indices into that list, so replacing
 * `count="0"` with the original's full block reproduces the exact list those indices
 * were written against. The second case would need each of ExcelJS's own new dxfs
 * renumbered around the reinserted ones — real index arithmetic, not a copy — so
 * this only touches the zero-count case and leaves the rest to whoever needs it (see
 * docs/todo.md, "The patched export still loses `<dxfs>`…").
 */
async function restoreDxfs(buffer: ArrayBuffer, source: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const [zip, original] = await Promise.all([
    JSZip.loadAsync(buffer),
    JSZip.loadAsync(source),
  ]);

  const originalStyles = await original.file("xl/styles.xml")?.async("string");
  const originalDxfs = originalStyles?.match(/<dxfs\b[^>]*count="(\d+)"[^>]*>[\s\S]*?<\/dxfs>/);
  if (!originalDxfs || originalDxfs[1] === "0") return buffer;

  const styles = await zip.file("xl/styles.xml")?.async("string");
  if (!styles) return buffer;
  if (!/<dxfs\b[^>]*count="0"\s*\/>/.test(styles)) return buffer;

  zip.file("xl/styles.xml", styles.replace(/<dxfs\b[^>]*count="0"\s*\/>/, originalDxfs[0]));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/** A `<dxfs>` block as written, or `""` when the styles hold none — the two spellings of "no dxfs". */
function dxfsOf(styles: string | undefined): string {
  const block = styles?.match(/<dxfs\b[^>]*?(?:\/>|>[\s\S]*?<\/dxfs>)/)?.[0] ?? "";
  return /^<dxfs\b[^>]*count="0"/.test(block) ? "" : block;
}

/**
 * Each worksheet's part path in a package, by sheet name. ExcelJS renumbers the
 * parts on write (`sheet1.xml`, `sheet2.xml`, … in tab order), so the upload's
 * `sheet3.xml` need not be the download's — the name is what the two share.
 */
async function sheetPartsByName(zip: JSZip): Promise<Map<string, string>> {
  const parts = new Map<string, string>();
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbook || !rels) return parts;
  const targets = new Map<string, string>();
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = tag.match(/\bId="([^"]*)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]*)"/)?.[1];
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    const target = targets.get(tag.match(/\br:id="([^"]*)"/)?.[1] ?? "");
    if (name !== undefined && target) parts.set(name, target);
  }
  return parts;
}

/**
 * Repair the `<conditionalFormatting>` elements ExcelJS writes back *empty*.
 *
 * ExcelJS round-trips a rule only if its writer knows the rule's type —
 * `expression`, `cellIs`, `top10`, `containsText` and a few more. Anything else,
 * notably `duplicateValues` and `uniqueValues` (*Duplicaten markeren*, which
 * client templates put on their key column), is read and then rendered as
 * nothing, while the wrapper around it is still written: `<conditionalFormatting
 * sqref="A1:A1048576"/>`. `CT_ConditionalFormatting` needs at least one
 * `cfRule`, so Excel opens the download with *"We found a problem with some
 * content"* — on the file after a check and after a send alike, both being this
 * writer.
 *
 * Where it is safe, the client's own rule is put back: the upload's element with
 * the same `sqref` on the same sheet, verbatim. Safe means its references still
 * hold — no column was inserted (which would shift what the rule's range and any
 * formula point at), and the `<dxfs>` list its `dxfId` indexes into is the
 * original's ({@link restoreDxfs} has run, and ExcelJS added none of its own).
 * Otherwise the empty element is dropped: the highlight is lost, but the file
 * opens clean, and a clean file is the one thing the export must not give up.
 */
async function restoreConditionalFormatting(
  buffer: ArrayBuffer,
  source: ArrayBuffer,
  columnsInserted: boolean
): Promise<ArrayBuffer> {
  const EMPTY = /<conditionalFormatting\b[^>]*?(?:\/>|>\s*<\/conditionalFormatting>)/g;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const sheets = [...(await sheetPartsByName(zip))];
  const xmls = await Promise.all(
    sheets.map(([, path]) => zip.file(path)?.async("string") ?? Promise.resolve(undefined))
  );
  const hasEmpty = (xml: string | undefined) => !!xml && new RegExp(EMPTY.source).test(xml);
  if (!xmls.some(hasEmpty)) return buffer;

  const original = await JSZip.loadAsync(source);
  const [styles, originalStyles] = await Promise.all([
    zip.file("xl/styles.xml")?.async("string"),
    original.file("xl/styles.xml")?.async("string"),
  ]);
  const canRestore = !columnsInserted && dxfsOf(styles) === dxfsOf(originalStyles);
  const originalParts = canRestore ? await sheetPartsByName(original) : new Map<string, string>();

  for (const [index, [name, path]] of sheets.entries()) {
    const xml = xmls[index];
    if (!xml || !hasEmpty(xml)) continue;

    // The upload's own elements on this sheet, by range — each handed out once,
    // so two rules on the same range both come back.
    const byRange = new Map<string, string[]>();
    const originalPath = originalParts.get(name);
    const originalXml = originalPath ? await original.file(originalPath)?.async("string") : undefined;
    for (const [block] of originalXml?.matchAll(
      /<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>/g
    ) ?? []) {
      const ref = block.match(/\bsqref="([^"]*)"/)?.[1] ?? "";
      byRange.set(ref, [...(byRange.get(ref) ?? []), block]);
    }

    zip.file(
      path,
      xml.replace(EMPTY, (empty) => {
        const ref = empty.match(/\bsqref="([^"]*)"/)?.[1] ?? "";
        return byRange.get(ref)?.shift() ?? "";
      })
    );
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * The request with each default written into its blank cell, as if the user had
 * typed it: the value goes into `rows` and the key into `dirtyKeys`, so both the
 * patch-in-place path (which writes only dirty cells) and the rebuild write it. A
 * cell that is no longer blank keeps what the user typed.
 */
function withDefaults(req: DownloadRequest): DownloadRequest {
  if (!req.defaults?.size) return req;
  const rows = req.rows.map((row) => [...row]);
  const dirtyKeys = new Set(req.dirtyKeys ?? []);
  const defaults = new Map<string, string>();
  for (const [key, value] of req.defaults) {
    const [r, c] = key.split(":").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c) || !rows[r]) continue;
    if ((rows[r][c] ?? "").trim() !== "") continue;
    rows[r][c] = value;
    dirtyKeys.add(key);
    defaults.set(key, value);
  }
  return { ...req, rows, dirtyKeys, defaults };
}

/**
 * Save the edited table to a file and hand it to the browser. The output keeps
 * the original base name, carries the project number in front of it and the
 * current timestamp behind it (e.g. `501282_Medewerkers_2026-07-15_143005.xlsx`)
 * — each replacing an earlier one rather than stacking on it, since clients
 * re-upload the file the tool gave them; see {@link downloadName}.
 *
 * An `.xlsx` upload is re-opened and patched in place, so the client's own
 * formatting survives and every sheet comes along (see {@link patchOriginal});
 * anything else — `.xls`, which ExcelJS can't read, `.csv`, or a workbook ExcelJS
 * chokes on — falls back to plain sheets rebuilt from the grid, still one per
 * parsed sheet. Either way column widths are re-fitted to the longest value,
 * `issues` are carried in as a pale fill per cell — after every older red/yellow
 * mark on the data is wiped ({@link wipeMarks}) — and the sheet's
 * shape is untouched (no extra column, no banner row) so the file can be
 * re-uploaded to the tool unchanged.
 *
 * A `.csv` source still exports as `.csv`, which carries the edited sheet's
 * values only — fills, notes and further sheets need the `.xlsx` path.
 */
export async function downloadSheet(req: DownloadRequest): Promise<void> {
  const { blob, fileName } = await buildSheetFile(req);
  triggerDownload(blob, fileName);
}

/** The written workbook and the name it should carry. */
export interface SheetFile {
  blob: Blob;
  fileName: string;
}

/**
 * The same file {@link downloadSheet} saves, handed back instead of given to the
 * browser — what *Aanleveren bij Nymbus* sends, so the sheet that arrives at
 * Nymbus is byte-for-byte the one the client could have downloaded, edits and
 * all. Splitting it out is the whole point: two ways to leave the browser must
 * not be able to produce two different workbooks.
 */
export async function buildSheetFile(request: DownloadRequest): Promise<SheetFile> {
  const req = withDefaults(request);
  // ~1 MB of writer — pulled in only when a file is actually written, so it
  // never lands in the initial page bundle.
  const ExcelJS = (await import("exceljs")).default;
  const newWorkbook = () => new ExcelJS.Workbook();

  const dot = req.fileName.lastIndexOf(".");
  const ext = dot > 0 ? req.fileName.slice(dot + 1).toLowerCase() : "xlsx";
  const csv = ext === "csv";

  const patched = csv ? null : await patchOriginal(newWorkbook, req);
  const workbook = patched?.workbook ?? buildFresh(newWorkbook, req);

  let buffer = csv
    ? ((await workbook.csv.writeBuffer()) as ArrayBuffer)
    : await reorderLegacyDrawings(
        (await workbook.xlsx.writeBuffer()) as ArrayBuffer
      );

  // Only meaningful when the original was patched in place — `buildFresh` never had
  // these parts to lose in the first place, and a `.csv` output can't carry them.
  if (patched) {
    buffer = await restoreDroppedParts(buffer, patched.source);
    buffer = await restoreDxfs(buffer, patched.source);
    buffer = await restoreConditionalFormatting(
      buffer,
      patched.source,
      patched.columnsInserted
    );
  }

  return {
    blob: new Blob([buffer], {
      type: csv ? "text/csv;charset=utf-8" : XLSX_MIME,
    }),
    fileName: downloadName(req.fileName, csv ? "csv" : "xlsx", "", req.projectId),
  };
}
