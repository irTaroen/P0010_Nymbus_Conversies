/**
 * The validation report as a PDF — the version that gets mailed to the client.
 *
 * Same content and the same order as the report drawer, laid out for A4: the app's
 * hero with the file it is about beside it, the two metrics with their meter, then
 * every column with its messages and the Excel rows they land on. Nothing is capped
 * or folded away here (the drawer's `+N meer` exists because a drawer is a viewport;
 * a PDF is the worklist), so a report simply runs on for as many pages as it needs.
 *
 * The hero ({@link drawHero}) and the shape of the metric card are shared with the
 * projectrapport ([`project-report-pdf.ts`](./project-report-pdf.ts)) — the two PDFs
 * leave the app through the same inbox, so they open identically and differ only in
 * what they go on to report.
 *
 * jsPDF is pulled in on demand — ~340 KB of writer that has no business in the
 * initial bundle, the same deal `excel.ts` makes with ExcelJS. Rendering
 * (`buildReportPdf`) is kept apart from downloading (`downloadReportPdf`) so the
 * layout can be exercised without a DOM.
 *
 * Colours are the theme tokens from globals.css and the status hues the table
 * already uses, and the marks are lucide's own geometry drawn at lucide's own
 * stroke width, so a reader holding the PDF beside the drawer is looking at one
 * report rather than two; see design-system.md. Nothing on the page rides on colour
 * alone: every finding is counted in words next to its mark, so the report
 * survives greyscale printing.
 */

import type { jsPDF, TextOptionsLight } from "jspdf";
import { formatDateTime } from "@/lib/datetime";
import { tr } from "@/lib/i18n";
import { downloadName, triggerDownload } from "@/lib/download";
import {
  rowRangeSegments,
  type ReportAutofixColumn,
  type ReportColumn,
  type ReportMessage,
  type ValidationReport,
} from "@/lib/validation/report";
import {
  errorCountText,
  fieldMetricText,
  omvangText,
  rowMetricText,
  rowSegments,
  type RowSegmentId,
} from "@/lib/validation/metrics";

/** An RGB triple in jsPDF's own `0-255` per channel — exported for other report PDFs. */
export type Rgb = readonly [number, number, number];

// Nymbus light tokens (globals.css) — print is always the light theme. Exported so
// the other report PDFs paint from the same palette instead of their own approximations.
export const NAVY: Rgb = [49, 52, 75]; // --k-text-primary
export const BODY: Rgb = [107, 111, 142]; // --k-text-secondary
export const PRIMARY: Rgb = [95, 168, 211]; // --k-cloud-deep
export const SURFACE: Rgb = [245, 240, 235]; // --k-bg
export const BORDER: Rgb = [217, 210, 200]; // --k-divider

// Status marks — the k-red-fg / k-green-fg inks. `RED` and `EMERALD` (the meters'
// "done") are shared with the other report PDFs, which paint the same strips and
// dots the screen does.
export const RED: Rgb = [176, 69, 69]; // --k-red-fg
const GREEN: Rgb = [90, 138, 74]; // --k-green-fg
export const EMERALD: Rgb = [90, 138, 74]; // --k-green-fg

/**
 * A badge's three strengths, the way the project pickers build one: a `/10` fill, a
 * `/30` border and full-strength letters, all of a single hue.
 *
 * **Pre-blended over white**, because a PDF fill has no alpha to compose with and
 * white is what the badge sits on in the drawer — so the pill on the page comes
 * out the colour the pill on screen is, rather than the colour the tokens name.
 */
export interface Tone {
  bg: Rgb;
  line: Rgb;
  ink: Rgb;
}

/** The red pair (`--k-red-bg` / `--k-red-fg`) at those three strengths. */
export const STATUS_BAD: Tone = {
  bg: [240, 200, 200],
  line: [222, 168, 168],
  ink: [176, 69, 69],
};

/** The green pair (`--k-green-bg` / `--k-green-fg`), for the badge a clean sheet gets. */
export const STATUS_GOOD: Tone = {
  bg: [210, 226, 192],
  line: [178, 204, 158],
  ink: [90, 138, 74],
};

// Tinted strips, matching the banners on screen. Amber is no longer a severity
// here — it is only the notice colour, for the stale-data and missing-column
// banners.
const AMBER_BG: Rgb = [240, 217, 184]; // --k-amber-bg
const AMBER_INK: Rgb = [184, 115, 51]; // --k-amber-fg
const GREEN_BG: Rgb = [210, 226, 192]; // --k-green-bg
const GREEN_INK: Rgb = [90, 138, 74]; // --k-green-fg

// A banner is outlined as well as tinted, exactly as it is on screen — the border
// is what keeps a pale strip reading as a band once the page is printed.
const AMBER_LINE: Rgb = [226, 192, 150];
const GREEN_LINE: Rgb = [178, 204, 158];

/**
 * The amber of a notice as a pill — the colour a corrected cell has in the table,
 * so a correction reads the same on paper as on screen: noted, not wrong.
 */
const NOTICE_TONE: Tone = { bg: AMBER_BG, line: AMBER_LINE, ink: AMBER_INK };

// Exported alongside `Sheet`: a second report PDF lays its own rows out by hand
// against the same coordinate system (the page margin, a line's baseline offset,
// an icon's box), so those constants have to be public wherever `Sheet` is.
export const MARGIN = 48;
/** Space kept free at the foot of every page for the running footer. */
const FOOTER_SPACE = 34;
/** Helvetica's baseline sits about this far below the top of a line. */
export const ASCENT = 0.78;
/** Side of the square an icon is drawn in — the drawer's `h-4 w-4`, on paper. */
export const ICON = 9.5;
/** Space between an icon and the text it belongs to (the drawer's `gap-2`). */
export const ICON_GAP = 4;
/** A count badge's box. The radius is `--radius-badge`'s 6-on-20 proportion. */
const PILL_HEIGHT = 13;
export const PILL_RADIUS = 4;
/** Column that holds the `4×` count in a message row. */
const COUNT_WIDTH = 30;
/** Indent of a message's text from the left margin (mark + count column). */
const MESSAGE_INDENT = ICON + ICON_GAP + COUNT_WIDTH;

/**
 * The code points jsPDF folds into WinAnsi's 0x80–0x9F range.
 *
 * The standard PDF fonts are WinAnsi-encoded, and jsPDF maps this set of Unicode
 * characters onto the bytes WinAnsi keeps them at (en dash to 0x96, the right
 * double quote to 0x94, the ellipsis to 0x85, and so on) before it writes the
 * text out. So they arrive on the page as themselves and need no help from us —
 * which is the whole of this list's purpose: to say what must be left alone.
 *
 * Everything **outside** CP1252 is the real problem, and a worse one than a
 * missing glyph: a single such character flips jsPDF's whole string to UCS-2BE,
 * which a WinAnsi font then renders as every letter spaced out and interleaved
 * with blanks. One `≥` in a validation message would garble the entire
 * line, so {@link winAnsi} substitutes those before they reach the writer.
 */
const CP1252_MAPPED: ReadonlySet<number> = new Set([
  0x0192, 0x02c6, 0x02dc, 0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021,
  0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/**
 * Stand-ins for the characters this report's own copy and the rule sets actually
 * use beyond CP1252 — `checks.ts` phrases a bound as `Moet ≥ 0 zijn`, which
 * would otherwise garble its whole message line. Anything else outside CP1252
 * becomes a `?`, so a character the standard fonts can't render is visible
 * rather than silently missing.
 */
const SUBSTITUTES: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
};

/**
 * Text made safe for a WinAnsi standard font. Every string reaches jsPDF through
 * this — drawn, wrapped *and* measured — so a substitution can never shift a
 * layout that was measured on the original.
 */
function winAnsi(text: string): string {
  // Fast path: nothing above Latin-1 needs looking at, which is nearly every
  // string here. The range bounds are escapes, not literal bytes: a raw NUL in
  // the source makes git treat this file as binary and hides it from grep.
  if (!/[^\u0000-\u00ff]/.test(text)) return text;
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code <= 0xff || CP1252_MAPPED.has(code)) return ch;
      return SUBSTITUTES[ch] ?? "?";
    })
    .join("");
}

/** Draw text. The only place `doc.text` is called. */
export function write(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options?: TextOptionsLight,
): void {
  doc.text(winAnsi(text), x, y, options);
}

/** Wrap text to `maxWidth`, in the current font. */
export function wrap(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(winAnsi(text), maxWidth) as string[];
}

/** Rendered width of text in the current font. */
export function measure(doc: jsPDF, text: string): number {
  return doc.getTextWidth(winAnsi(text));
}

/**
 * A thin layer over jsPDF: a `y` cursor that flows down the page, breaks to a
 * new one when a block wouldn't fit, and keeps the font/colour calls short.
 */
export class Sheet {
  y = MARGIN;
  readonly width: number;
  readonly bottom: number;
  // Assigned longhand rather than as a constructor parameter property, which
  // Node's type-stripping (what the repo's own .mts scripts run on) rejects.
  private readonly doc: jsPDF;

  constructor(doc: jsPDF) {
    this.doc = doc;
    const page = doc.internal.pageSize;
    this.width = page.getWidth() - MARGIN * 2;
    this.bottom = page.getHeight() - MARGIN - FOOTER_SPACE;
  }

  font(
    size: number,
    weight: "normal" | "bold" = "normal",
    colour: Rgb = NAVY,
    // Courier for the one thing the drawer sets in mono: a column's letter.
    family: "helvetica" | "courier" = "helvetica",
  ): this {
    this.doc.setFont(family, weight);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...colour);
    return this;
  }

  /** Start a new page unless `height` still fits under the current cursor. */
  need(height: number): this {
    if (this.y + height > this.bottom) {
      this.doc.addPage();
      this.y = MARGIN;
    }
    return this;
  }

  /** One line of text; `y` is the line's top, not its baseline. */
  line(text: string, x: number, size: number, gap = size * 1.4): this {
    write(this.doc, text, x, this.y + size * ASCENT);
    this.y += gap;
    return this;
  }

  /** Wrapped text, breaking pages between lines rather than clipping. */
  paragraph(text: string, x: number, size: number, maxWidth: number, gap = size * 1.3): this {
    for (const line of wrap(this.doc, text, maxWidth)) {
      this.need(gap).line(line, x, size, gap);
    }
    return this;
  }

  space(height: number): this {
    this.y += height;
    return this;
  }

  /** A full-width hairline at the cursor — under a heading, above a table. */
  rule(): this {
    this.doc.setDrawColor(...BORDER);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN, this.y, MARGIN + this.width, this.y);
    return this;
  }
}

/** Text cut to `maxWidth` with an ellipsis. Assumes the font is already set. */
export function ellipsize(doc: jsPDF, text: string, maxWidth: number): string {
  if (measure(doc, text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(doc, `${cut}…`) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/** A tinted, outlined badge with its label centred; returns the width it took. */
export function pill(doc: jsPDF, text: string, x: number, top: number, tone: Tone): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const width = measure(doc, text) + 12;
  doc.setFillColor(...tone.bg);
  doc.setDrawColor(...tone.line);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, top, width, PILL_HEIGHT, PILL_RADIUS, PILL_RADIUS, "FD");
  doc.setTextColor(...tone.ink);
  write(doc, text, x + 6, top + 9.2);
  return width;
}

/**
 * A mark drawn into a `size × size` box whose top-left corner is `(x, top)` — the
 * page's answer to a `<span className="h-4 w-4">` in the drawer.
 */
export type IconMark = (doc: jsPDF, x: number, top: number, size: number, ink: Rgb) => void;

/**
 * Set up for an outlined icon, draw it, and put the pen back.
 *
 * The marks are stroked rather than filled, at lucide's own `strokeWidth` of 1.8
 * in a 24-unit box, because that is what the drawer renders: a filled dot in the
 * PDF and an outlined `AlertCircle` on screen were the same finding wearing two
 * different clothes. Round joins and caps are lucide's too — and they are reset
 * afterwards, so the hairlines and the meter elsewhere on the page keep theirs.
 */
function strokeIcon(doc: jsPDF, size: number, ink: Rgb, draw: () => void): void {
  doc.setDrawColor(...ink);
  doc.setFillColor(...ink);
  doc.setLineWidth((1.8 * size) / 24);
  doc.setLineJoin("round");
  doc.setLineCap("round");
  draw();
  doc.setLineJoin("miter");
  doc.setLineCap("butt");
}

/**
 * A circle arc as relative cubic Bézier segments for `doc.lines`, in lucide's
 * 24-unit box (`u` scales it), quarter turns at most so each segment stays a
 * faithful arc. Angles in degrees, clockwise on the page (y points down).
 */
function arcSegments(
  cx: number,
  cy: number,
  r: number,
  start: number,
  sweep: number,
  u: number,
): number[][] {
  const steps = Math.ceil(Math.abs(sweep) / 90);
  const step = ((sweep / steps) * Math.PI) / 180;
  const k = (4 / 3) * Math.tan(step / 4);
  const segments: number[][] = [];
  let a = (start * Math.PI) / 180;
  for (let i = 0; i < steps; i++) {
    const b = a + step;
    const [x0, y0] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x3, y3] = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    const [x1, y1] = [x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a)];
    const [x2, y2] = [x3 + k * r * Math.sin(b), y3 - k * r * Math.cos(b)];
    segments.push(
      [x1 - x0, y1 - y0, x2 - x0, y2 - y0, x3 - x0, y3 - y0].map((v) => v * u),
    );
    a = b;
  }
  return segments;
}

/**
 * lucide `CloudUpload` — a figure that is a send's outcome rather than a check's, as
 * the sidebar badge and the projectrapport's *Rijen OK* column mark it on screen.
 * The cloud is lucide's own two arcs (centres worked out from its SVG path) joined
 * by its short straight top; the arrow is its `M12 13v8` with the `m8 17 4-4 4 4` head.
 */
export const cloudUploadMark: IconMark = (doc, x, top, size, ink) => {
  const u = size / 24;
  strokeIcon(doc, size, ink, () => {
    const big = arcSegments(9.005, 10.009, 7, 133.34, 209.98, u);
    const small = arcSegments(17.439, 12.5, 4.5, -89.23, 144.54, u);
    doc.lines(
      [...big, [(17.5 - 15.71) * u, 0], ...small],
      x + 4.2 * u,
      top + 15.1 * u,
      [1, 1],
      "S",
      false,
    );
    doc.line(x + 12 * u, top + 13 * u, x + 12 * u, top + 21 * u);
    doc.lines(
      [
        [4 * u, -4 * u],
        [4 * u, 4 * u],
      ],
      x + 8 * u,
      top + 17 * u,
      [1, 1],
      "S",
      false,
    );
  });
};

/** lucide `AlertTriangle` — the mark on every notice, as in `AmberNotice`. */
export const alertTriangleMark: IconMark = (doc, x, top, size, ink) => {
  const u = size / 24;
  strokeIcon(doc, size, ink, () => {
    // Relative moves, closed, so the three corners get one joined path.
    doc.lines(
      [
        [9.4 * u, 17.4 * u],
        [-18.8 * u, 0],
      ],
      x + 12 * u,
      top + 3.2 * u,
      [1, 1],
      "S",
      true,
    );
    doc.line(x + 12 * u, top + 9.2 * u, x + 12 * u, top + 13.4 * u);
    doc.circle(x + 12 * u, top + 16.8 * u, 0.95 * u, "F");
  });
};

/** lucide `AlertCircle` — one finding, the mark the drawer puts on a message. */
const alertCircleMark: IconMark = (doc, x, top, size, ink) => {
  const u = size / 24;
  strokeIcon(doc, size, ink, () => {
    doc.circle(x + 12 * u, top + 12 * u, 9.7 * u, "S");
    doc.line(x + 12 * u, top + 7.6 * u, x + 12 * u, top + 12.4 * u);
    doc.circle(x + 12 * u, top + 15.9 * u, 0.95 * u, "F");
  });
};

/** lucide `CheckCircle2` — a clean result, as in `GreenNotice`. */
export const checkCircleMark: IconMark = (doc, x, top, size, ink) => {
  const u = size / 24;
  strokeIcon(doc, size, ink, () => {
    doc.circle(x + 12 * u, top + 12 * u, 9.7 * u, "S");
    // lucide's own check: (9,12) -> (11,14) -> (15,10).
    doc.lines(
      [
        [2 * u, 2 * u],
        [4 * u, -4 * u],
      ],
      x + 9 * u,
      top + 12 * u,
      [1, 1],
      "S",
    );
  });
};

/**
 * A stretch of text in one weight — the page's `<strong>`.
 *
 * The banners carry emphasis on screen (`MissingColumnsNotice` names the columns
 * in bold), and a banner is exactly where a wrapped line has to survive a weight
 * change mid-sentence, so their text is runs rather than one string.
 */
export type Run = { text: string; bold?: boolean };

/**
 * Wrap runs to `maxWidth`, greedily, word by word.
 *
 * Words are measured in their own weight — bold is wider, and a line laid out on
 * the regular widths would run past the banner's edge. A word may be **made of
 * several runs**: `Kostendrager.` is a bold column name with a regular full stop
 * behind it, and the two are one word, so a line can never break between them and
 * start with a lone `.`. jsPDF's own `splitTextToSize` can do none of this — it
 * knows one font per call.
 */
export function wrapRuns(doc: jsPDF, runs: Run[], size: number, maxWidth: number): Run[][] {
  doc.setFontSize(size);

  // Runs -> words. `space` records whether whitespace preceded the word, so it
  // can be dropped when the word ends up first on a line.
  const words: { pieces: Run[]; space: boolean }[] = [];
  let current: Run[] | null = null;
  let space = false;
  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        current = null;
        space = words.length > 0;
        continue;
      }
      if (current) {
        current.push({ text: token, bold: run.bold });
      } else {
        current = [{ text: token, bold: run.bold }];
        words.push({ pieces: current, space });
        space = false;
      }
    }
  }

  const widthOf = (piece: Run) => {
    doc.setFont("helvetica", piece.bold ? "bold" : "normal");
    return measure(doc, piece.text);
  };
  const sum = (pieces: Run[]) => pieces.reduce((total, p) => total + widthOf(p), 0);

  // A word wider than the line itself — an AFAS log key, a GUID, a long file name —
  // has no space to wrap at, and would run off the page (and over whatever is
  // right-aligned beside it). It is broken between characters instead, the way
  // `splitTextToSize` breaks one for `wrap`.
  const fitted: typeof words = [];
  for (const word of words) {
    if (sum(word.pieces) <= maxWidth) {
      fitted.push(word);
      continue;
    }
    let chunk: Run[] = [];
    let chunkWidth = 0;
    let first = true;
    for (const piece of word.pieces) {
      for (const char of Array.from(piece.text)) {
        const charWidth = widthOf({ text: char, bold: piece.bold });
        if (chunk.length > 0 && chunkWidth + charWidth > maxWidth) {
          fitted.push({ pieces: chunk, space: first && word.space });
          first = false;
          chunk = [];
          chunkWidth = 0;
        }
        const last = chunk[chunk.length - 1];
        if (last && Boolean(last.bold) === Boolean(piece.bold)) last.text += char;
        else chunk.push({ text: char, bold: piece.bold });
        chunkWidth += charWidth;
      }
    }
    if (chunk.length > 0) fitted.push({ pieces: chunk, space: first && word.space });
  }

  const lines: Run[][] = [];
  let line: Run[] = [];
  let used = 0;
  for (const word of fitted) {
    // The leading space rides on the word's first piece, so drawing is a plain
    // left-to-right walk with no gap bookkeeping.
    const spaced =
      word.space && line.length > 0
        ? [{ ...word.pieces[0], text: ` ${word.pieces[0].text}` }, ...word.pieces.slice(1)]
        : word.pieces;
    const width = sum(spaced);
    if (line.length > 0 && used + width > maxWidth) {
      lines.push(line);
      line = [...word.pieces];
      used = sum(word.pieces);
    } else {
      line.push(...spaced);
      used += width;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** One wrapped line of runs, drawn from `x` at `baseline`. */
export function drawRuns(
  doc: jsPDF,
  line: Run[],
  x: number,
  baseline: number,
  size: number,
  ink: Rgb,
): void {
  doc.setFontSize(size);
  doc.setTextColor(...ink);
  // Neighbouring pieces of one weight are drawn as a single string, so jsPDF sets
  // the spacing inside it itself. Positioned word by word, each word landed where
  // the previous one's *measured* width said — and that measure runs short after
  // some glyphs (a closing `'`), which visibly ate the space behind it.
  const spans: Run[] = [];
  for (const piece of line) {
    const last = spans[spans.length - 1];
    if (last && Boolean(last.bold) === Boolean(piece.bold)) last.text += piece.text;
    else spans.push({ ...piece });
  }
  let cursor = x;
  for (const span of spans) {
    doc.setFont("helvetica", span.bold ? "bold" : "normal");
    write(doc, span.text, cursor, baseline);
    cursor += measure(doc, span.text);
  }
}

/**
 * The metric card's `Geen fouten` badge — the one thing on the card said in words
 * instead of figures, and only there when there is nothing to report. Taller than
 * a count badge because it carries a mark, and at the same radius, because the
 * radius belongs to the family rather than to the box. Its height is a constant
 * because the card has to add it to its own before it can fill the box the badge
 * is drawn inside.
 */
const CLEAN_PILL_HEIGHT = 17;

function drawCleanPill(doc: jsPDF, x: number, top: number): void {
  const SIZE = 9;
  const label = tr("Geen fouten", "No errors");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(SIZE);
  const width = 10 + ICON + ICON_GAP + measure(doc, label) + 10;
  doc.setFillColor(...STATUS_GOOD.bg);
  doc.setDrawColor(...STATUS_GOOD.line);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, top, width, CLEAN_PILL_HEIGHT, PILL_RADIUS, PILL_RADIUS, "FD");
  // The mark leaves the font alone, so the weight and size set above still hold.
  checkCircleMark(doc, x + 10, top + (CLEAN_PILL_HEIGHT - ICON) / 2, ICON, STATUS_GOOD.ink);
  doc.setTextColor(...STATUS_GOOD.ink);
  write(
    doc,
    label,
    x + 10 + ICON + ICON_GAP,
    top + (CLEAN_PILL_HEIGHT - SIZE) / 2 + SIZE * ASCENT,
  );
}

/**
 * What a report's hero says about itself, to the right of the wordmark: the kind of
 * report as the heading, its subject quietly under that, and however many further
 * lines the report wants — a project's generated-at stamp, a sheet's blad and omvang.
 *
 * A list rather than a fixed `subtitle`/`meta` pair so the two reports can differ in
 * how much they have to say without either of them growing a header of its own.
 */
export interface HeroCaption {
  /**
   * The heading of the caption column, set in small caps: `VALIDATIERAPPORT`,
   * `PROJECTRAPPORT`. What the page *is*, and the stable thing a reader identifies
   * it by — so it leads, rather than the subject it happens to be about.
   */
  kind: string;
  /**
   * What this report is *of* — a file name, a project name. **Wrapped, never cut**:
   * an export name is how two reports of the same module are told apart, and the
   * distinguishing part is usually at the end.
   */
  subject: string;
  /** The quiet lines under it, top to bottom. Each is ellipsized to the same width. */
  lines: string[];
}

/**
 * The app's own hero, on paper: **Van Excel naar / AFAS zonder gedoe** in two bold
 * navy lines with the orange band behind *AFAS*, the same wordmark
 * [`Hero`](../components/Hero.tsx) opens every screen with — and the same
 * `.highlight-band` recipe (primary fill, white text, 8px radius, `0.18em` of side
 * padding) from `globals.css`. The orange rule underneath closes the block off.
 *
 * It stands where a plain `Validatierapport` title used to, because both reports
 * leave the app: someone opening a mailed PDF should meet what a reader on screen
 * meets. What the report *is* moves to the right of the same block — the kicker, the
 * subject and its quiet lines, right-aligned against the wordmark. Beside it rather
 * than under it for the same reason `Hero` itself is two columns and not a centred
 * stack: the height a header doesn't take is height the report does, and on the
 * projectrapport's landscape one-pager that is the whole game.
 *
 * Shared by both PDFs — the validatierapport ({@link buildReportPdf}) and the
 * projectrapport ([`project-report-pdf.ts`](./project-report-pdf.ts)) — so the two
 * open identically rather than nearly so. It sizes itself off the caption it is
 * handed and returns nothing: the cursor is left under the rule.
 */
export function drawHero(doc: jsPDF, sheet: Sheet, caption: HeroCaption): void {
  const top = sheet.y;
  const SIZE = 21;
  const LEAD = SIZE * 1.12;

  // Line one, plain.
  sheet.font(SIZE, "bold", NAVY);
  write(doc, tr("Van Excel naar", "From Excel to"), MARGIN, top + SIZE * ASCENT);

  // Line two: the banded word, then the rest. The band is drawn first so the
  // white glyphs land on top of it, and its geometry is measured off the text
  // rather than guessed — `0.18em` of padding either side, as the CSS has it.
  const y2 = top + LEAD;
  const pad = SIZE * 0.18;
  const bandText = "AFAS";
  const rest = tr(" zonder gedoe", " without hassle");
  const bandWidth = measure(doc, bandText) + pad * 2;
  doc.setFillColor(...PRIMARY);
  doc.roundedRect(MARGIN, y2, bandWidth, SIZE * 1.16, 5, 5, "F");
  sheet.font(SIZE, "bold", [255, 255, 255]);
  write(doc, bandText, MARGIN + pad, y2 + SIZE * ASCENT + 1);
  sheet.font(SIZE, "bold", NAVY);
  write(doc, rest, MARGIN + bandWidth, y2 + SIZE * ASCENT + 1);

  // What the report is, right-aligned against the wordmark. Held to the width the
  // wordmark leaves — measured, not halved, so nothing here can run back into
  // `zonder gedoe`.
  const right = MARGIN + sheet.width;
  const rightAlign: TextOptionsLight = { align: "right" };
  const captionWidth = sheet.width - (bandWidth + measure(doc, rest)) - 24;

  // The **kind** is the heading of this column — `VALIDATIERAPPORT` at the size the
  // subject used to have, still in small caps. It is the stable, readable thing a
  // reader identifies the page by; the file it happens to describe is not, and a
  // 40-character export name set at 13pt bold only crowded the wordmark.
  sheet.font(13, "bold", NAVY);
  write(doc, caption.kind.toUpperCase(), right, top + 13 * ASCENT, rightAlign);
  let captionY = top + 13 * 1.35;

  // The **subject** is a quiet line under it, and it **wraps** rather than being
  // cut: a validatierapport is filed against a specific export, so a name trimmed
  // to `20260825 HRM 1_5fMedewerkers V3_2026…` loses exactly the part that tells
  // two of them apart. Right-aligned line by line — jsPDF aligns each string it is
  // given, so the wrap has to be ours.
  sheet.font(8.5, "bold", BODY);
  for (const line of wrap(doc, caption.subject, captionWidth)) {
    write(doc, line, right, captionY + 8.5 * ASCENT, rightAlign);
    captionY += 11;
  }

  // The quiet lines under that — the module, the sheet, the stamp. Each is short
  // enough to hold, and an ellipsis on one of them costs nothing a reader needs.
  sheet.font(8, "normal", BODY);
  captionY += 2;
  for (const line of caption.lines) {
    write(doc, ellipsize(doc, line, captionWidth), right, captionY + 8 * ASCENT, rightAlign);
    captionY += 11;
  }

  // The rule clears whichever column is taller — the wordmark, or a caption with
  // more lines under it than the projectrapport's single stamp.
  sheet.y = Math.max(top + LEAD + SIZE * 1.16, captionY - 11 + 8 * 1.3) + 7;
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, sheet.y, MARGIN + sheet.width, sheet.y);
  sheet.space(12);
}

/**
 * The metric card: the report's two figures side by side on the left — the share of
 * rows AFAS would take as they are, and how many checked fields carry an error —
 * with the stacked row meter and its legend beside them on the right, a hairline
 * between the two halves.
 *
 * Both figures and all of their wording come from `validation/metrics.ts`, the same
 * source the report drawer renders: a caption reworded on screen and not here would
 * be two different reports of one sheet. Only the paint is this file's — the meter's
 * segments are mapped from their ids to the severity hues below.
 *
 * **Laid out across, not down**, the same shape the projectrapport's card has
 * ([`project-report-pdf.ts`](./project-report-pdf.ts)'s `drawProjectMetrics`), so the
 * two reports open with the same block and not merely a similar one. Stacked, the
 * figures, the meter and the legend cost ~150pt of a portrait page whose remaining
 * height is the findings list; across, the same content is ~86, and the pair of
 * halves reads as *how much got through* beside *what it is made of* rather than as
 * one long column.
 *
 * The card's height is measured from the wrapped captions rather than fixed: the
 * box is filled before its text is written, so it has to know beforehand how
 * tall that text turns out to be.
 */
const SEGMENT_FILL: Record<RowSegmentId, Rgb> = {
  clean: GREEN,
  error: RED,
};

function drawMetrics(doc: jsPDF, sheet: Sheet, report: ValidationReport): void {
  const segments = rowSegments(report);
  const metrics = [rowMetricText(report), fieldMetricText(report)];
  const PAD = 12;
  const FIGURE_SIZE = 24;
  const LINE = 11;

  // Left half: the two figures side by side, each in its own column. Right half:
  // the meter, its track the full width of that half, the legend on one row
  // beneath it. The hairline between them sits at `meterX - 12`.
  // 0.56, not the projectrapport's 0.46: portrait is ~250pt narrower, and at half
  // the page `van de rijen kan zo naar AFAS` wrapped onto a second line, pushing
  // its detail down and leaving the pair visibly lopsided. The meter needs far
  // less width than a caption does — it is a bar and six words.
  const figuresWidth = sheet.width * 0.56;
  const figureColumn = figuresWidth / 2;
  const meterX = MARGIN + figuresWidth + 12;
  // Minus the card's own right padding as well as the hairline gap, or the track
  // runs out through the rounded corner.
  const meterWidth = sheet.width - figuresWidth - 12 - PAD - 14;

  sheet.font(9, "normal", BODY);
  const captionWidth = figureColumn - 14;
  const captions = metrics.map((m) => wrap(doc, m.caption, captionWidth));
  const captionLines = Math.max(...captions.map((lines) => lines.length));
  const figuresHeight = FIGURE_SIZE * 1.08 + captionLines * LINE + LINE;

  // The pill is only in the height when it is drawn — an unconditional gap would
  // leave every card with a finding visibly slack. It goes in the meter half,
  // under the legend, which is where a clean sheet has the room: that half's
  // meter is then a single full-width green bar with nothing to say beside it.
  const cleanPill = report.errorCount === 0 ? CLEAN_PILL_HEIGHT + 8 : 0;
  const meterHeight = 14 + 8 + 10 + 11 + cleanPill;

  const height = PAD * 2 + Math.max(figuresHeight, meterHeight);

  sheet.need(height);
  const top = sheet.y;
  drawCard(doc, sheet, top, height);

  // The two figures, side by side, on one baseline so they read as a pair.
  metrics.forEach((metric, i) => {
    const x = MARGIN + 14 + i * figureColumn;
    let fy = top + PAD;
    sheet.font(FIGURE_SIZE, "bold", NAVY);
    write(doc, metric.figure, x, fy + FIGURE_SIZE * ASCENT);
    fy += FIGURE_SIZE * 1.08;
    sheet.font(9, "normal", BODY);
    for (const line of captions[i]) {
      write(doc, line, x, fy + 9 * ASCENT);
      fy += LINE;
    }
    if (metric.detail) {
      // Aligned to the taller caption's foot, so both details share a baseline.
      const detailY = top + PAD + FIGURE_SIZE * 1.08 + captionLines * LINE;
      sheet.font(8, "normal", BODY);
      write(doc, metric.detail, x, detailY + 8 * ASCENT);
    }
  });

  // The hairline between the figures and the meter, the height of the card's padding.
  drawCardDivider(doc, meterX - 12, top, height, PAD);

  // The meter, headed like the projectrapport's so the right half says what it is.
  sheet.font(7.5, "bold", BODY);
  write(doc, tr("RIJEN", "ROWS"), meterX, top + PAD + 7.5 * ASCENT);
  let y = top + PAD + 14;

  // 2pt gaps in the page colour separate the segments — the fills are never
  // outlined, and a segment with no rows isn't drawn at all.
  const filled = segments.filter((s) => s.value > 0);
  const GAP = 2;
  const available = meterWidth - GAP * Math.max(0, filled.length - 1);
  const rows = Math.max(1, report.totalRows);
  doc.setFillColor(...BORDER);
  doc.roundedRect(meterX, y, meterWidth, 8, 4, 4, "F");
  let x = meterX;
  filled.forEach((segment, i) => {
    // The floor keeps a single bad row in five thousand visible; the last
    // segment takes the rounding leftovers so the fills meet the track's end.
    const width =
      i === filled.length - 1
        ? meterX + meterWidth - x
        : Math.max(3, (segment.value / rows) * available);
    doc.setFillColor(...SEGMENT_FILL[segment.id]);
    doc.roundedRect(x, y, Math.max(3, width), 8, 4, 4, "F");
    x += width + GAP;
  });
  y += 8 + 10;

  // Legend: every segment, including the empty ones, with its count — flowed
  // across one row, dot · label · count.
  let legendX = meterX;
  for (const segment of segments) {
    doc.setFillColor(...SEGMENT_FILL[segment.id]);
    doc.circle(legendX + 3, y + 4, 3, "F");
    sheet.font(8, "normal", BODY);
    write(doc, segment.label, legendX + 10, y + 8 * ASCENT);
    const labelWidth = measure(doc, segment.label);
    sheet.font(8, "bold", NAVY);
    const value = String(segment.value);
    write(doc, value, legendX + 14 + labelWidth, y + 8 * ASCENT);
    legendX += 10 + labelWidth + 8 + measure(doc, value) + 14;
  }
  y += 11;

  // `Geen fouten` — the drawer's own pill, under the legend it qualifies.
  if (report.errorCount === 0) {
    drawCleanPill(doc, meterX, y + 8);
  }

  sheet.y = top + height + 14;
}

/**
 * A tinted, wrapped note — the PDF form of the banners above the table and in the
 * drawer: the same tint, the same outline, the same lucide mark and the same
 * words, with a `<strong>` arriving as a bold run.
 */
function drawBanner(
  doc: jsPDF,
  sheet: Sheet,
  runs: Run[],
  bg: Rgb,
  border: Rgb,
  ink: Rgb,
  mark: IconMark,
): void {
  const SIZE = 8.5;
  const PAD_X = 12;
  const textX = MARGIN + PAD_X + ICON + ICON_GAP;
  const lines = wrapRuns(doc, runs, SIZE, MARGIN + sheet.width - PAD_X - textX);
  const height = 14 + lines.length * 11;

  sheet.need(height + 8);
  doc.setFillColor(...bg);
  doc.setDrawColor(...border);
  doc.setLineWidth(0.6);
  doc.roundedRect(MARGIN, sheet.y, sheet.width, height, 8, 8, "FD");

  // The mark sits on the first line of the text, like the drawer's `mt-0.5` icon.
  mark(doc, MARGIN + PAD_X, sheet.y + 7.5, ICON, ink);

  let textY = sheet.y + 7;
  for (const line of lines) {
    drawRuns(doc, line, textX, textY + SIZE * ASCENT, SIZE, ink);
    textY += 11;
  }
  sheet.space(height + 10);
}

/** One column's errors: red pill, red mark. */
function drawColumn(doc: jsPDF, sheet: Sheet, column: ReportColumn): void {
  drawColumnBlock(doc, sheet, {
    letter: column.letter,
    header: column.header,
    pills: column.errorCount > 0 ? [[errorCountText(column.errorCount), STATUS_BAD]] : [],
    messages: column.messages,
    mark: alertCircleMark,
    markInk: RED,
  });
}

/** One column's automatic corrections: amber pill, amber check mark. */
function drawAutofixColumn(doc: jsPDF, sheet: Sheet, column: ReportAutofixColumn): void {
  drawColumnBlock(doc, sheet, {
    letter: column.letter,
    header: column.header,
    pills: [[tr(`${column.count}× aangepast`, `${column.count}× adjusted`), NOTICE_TONE]],
    messages: column.fixes,
    mark: checkCircleMark,
    markInk: AMBER_INK,
  });
}

/** What a column block shows — see {@link drawColumnBlock}. */
interface ColumnBlock {
  letter: string;
  header: string;
  pills: [string, Tone][];
  messages: ReportMessage[];
  mark: IconMark;
  markInk: Rgb;
}

/**
 * One column: a surface band with its name and count pills, then a line per
 * distinct message with the rows it lands on. The band and the messages are
 * separate blocks on purpose — a column with a hundred messages flows across
 * pages instead of being squeezed into one box.
 *
 * Shared by the errors and the automatic corrections, which differ only in tone:
 * the same column reads the same way in both sections.
 */
function drawColumnBlock(doc: jsPDF, sheet: Sheet, column: ColumnBlock): void {
  const BAND_HEIGHT = 22;
  // Keep the band with at least its first message line — a heading alone at the
  // foot of a page reads as an empty column.
  sheet.need(BAND_HEIGHT + 46);

  const { pills } = column;

  doc.setFillColor(...SURFACE);
  doc.roundedRect(MARGIN, sheet.y, sheet.width, BAND_HEIGHT, 6, 6, "F");

  // Measure the pills first so the name gets exactly the space that's left.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const pillsWidth = pills.reduce((sum, [text]) => sum + measure(doc, text) + 12 + 5, 0);

  // The Excel column letter leads the name, one step quieter than it, so the
  // reader can jump straight to that column in the file. In Courier because the
  // drawer sets it in mono: it is a coordinate, not a word.
  const baseline = sheet.y + BAND_HEIGHT / 2 + 3.4;
  const tag = `[${column.letter}]`;
  sheet.font(8.5, "bold", BODY, "courier");
  write(doc, tag, MARGIN + 10, baseline);
  const tagWidth = measure(doc, tag) + 5;

  sheet.font(10.5, "bold", NAVY);
  const name = ellipsize(doc, column.header, sheet.width - 20 - pillsWidth - tagWidth);
  write(doc, name, MARGIN + 10 + tagWidth, baseline);

  let pillX = MARGIN + sheet.width - 10 - pillsWidth + 5;
  for (const [text, tone] of pills) {
    pillX +=
      pill(doc, text, pillX, sheet.y + (BAND_HEIGHT - PILL_HEIGHT) / 2, tone) + 5;
  }
  sheet.space(BAND_HEIGHT + 8);

  for (const message of column.messages) {
    sheet.need(24);

    // Mark + count share the first line with the start of the message.
    column.mark(doc, MARGIN, sheet.y + 0.5, ICON, column.markInk);
    sheet.font(8.5, "bold", NAVY);
    write(
      doc,
      `${message.rows.length}×`,
      MARGIN + ICON + ICON_GAP,
      sheet.y + 9 * ASCENT,
    );

    sheet.font(9, "normal", NAVY);
    sheet.paragraph(message.message, MARGIN + MESSAGE_INDENT, 9, sheet.width - MESSAGE_INDENT, 12);

    // The rows and nothing else, as the drawer has it. This line used to open
    // with the severity in words (`fout · rijen 3, 5`) so that a finding never
    // rode on the mark's colour alone in print — but every finding is an error,
    // the count in front of the message says so, and the band above spells out
    // `31 fouten`. A word that adds nothing on every line of a long report is
    // noise, and it is noise the drawer doesn't carry.
    sheet.font(8, "normal", BODY);
    const rows = message.rows.length === 1 ? tr("rij", "row") : tr("rijen", "rows");
    sheet.paragraph(
      `${rows} ${rowRangeSegments(message.rows).join(", ")}`,
      MARGIN + MESSAGE_INDENT,
      8,
      sheet.width - MESSAGE_INDENT,
      11,
    );
    sheet.space(5);
  }
  sheet.space(6);
}

/**
 * Running footer on every page, added once the page count is known. Takes the left
 * label as plain text rather than a `ValidationReport` — the projectrapport's PDF
 * runs the same footer with its own label — so this has no report shape of its own
 * to be coupled to.
 */
export function drawFooters(doc: jsPDF, footerText: string): void {
  const pages = doc.getNumberOfPages();
  const page = doc.internal.pageSize;
  const y = page.getHeight() - MARGIN + 8;
  const right = page.getWidth() - MARGIN;
  const options: TextOptionsLight = { align: "right" };

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y - 10, right, y - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BODY);
    write(
      doc,
      ellipsize(doc, footerText, page.getWidth() - MARGIN * 2 - 90),
      MARGIN,
      y,
    );
    write(doc, tr(`pagina ${i} van ${pages}`, `page ${i} of ${pages}`), right, y, options);
  }
}

/**
 * A new A4 report in points, carrying its title and subject — where every report
 * PDF starts. The writer is imported here, on first use, so it stays out of the
 * page's own bundle.
 */
export async function newReportDoc({
  title,
  subject,
  orientation = "portrait",
}: {
  title: string;
  subject: string;
  orientation?: "portrait" | "landscape";
}): Promise<jsPDF> {
  const { jsPDF: JsPdf } = await import("jspdf");
  const doc = new JsPdf({ unit: "pt", format: "a4", orientation });
  doc.setProperties({ title, subject, creator: "Nymbus Conversies" });
  return doc;
}

/** `Gegenereerd 21-10-2026 10:00` — the hero line that says when a report was made. */
export function generatedLine(): string {
  return tr(`Gegenereerd ${formatDateTime(new Date())}`, `Generated ${formatDateTime(new Date())}`);
}

/** The figures card every report opens with: the surface tint, a hairline border. */
export function drawCard(doc: jsPDF, sheet: Sheet, top: number, height: number): void {
  doc.setFillColor(...SURFACE);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.6);
  doc.roundedRect(MARGIN, top, sheet.width, height, 10, 10, "FD");
}

/** The hairline inside a card between its figures and its meter, inset by `pad`. */
export function drawCardDivider(
  doc: jsPDF,
  x: number,
  top: number,
  height: number,
  pad: number,
): void {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.6);
  doc.line(x, top + pad, x, top + height - pad);
}

/**
 * Table columns laid out **from the right edge in**: each column's left offset
 * from the margin, given the widths rightmost first. Whatever is left of the last
 * one is the free column's (the project, the module) — so a change of page format
 * can't push a column off the page.
 */
export function columnsFromRight<K extends string>(
  width: number,
  columns: readonly (readonly [K, number])[],
  gap: number,
): Record<K, number> {
  const offsets = {} as Record<K, number>;
  let edge = width + gap;
  for (const [key, columnWidth] of columns) {
    edge = edge - gap - columnWidth;
    offsets[key] = edge;
  }
  return offsets;
}

/**
 * A table's column heads, in the small bold caps every report table uses, on the
 * line at the cursor. `x` is from the margin; a right-aligned head names its
 * column's right edge. The caller spaces down after it.
 */
export function writeColumnHeadings(
  doc: jsPDF,
  sheet: Sheet,
  headings: readonly (readonly [label: string, x: number, align?: "left" | "right"])[],
): void {
  sheet.font(7.5, "bold", BODY);
  const y = sheet.y + 7.5 * ASCENT;
  for (const [label, x, align] of headings) {
    write(doc, label.toUpperCase(), MARGIN + x, y, align ? { align } : undefined);
  }
}

/**
 * Render the report to a PDF blob. Kept separate from the download so the layout
 * can be produced (and inspected) without a browser.
 */
export async function buildReportPdf(report: ValidationReport): Promise<Blob> {
  const doc = await newReportDoc({
    title: tr(`Validatierapport · ${report.fileName}`, `Validation report · ${report.fileName}`),
    subject: report.moduleLabel ?? tr("Validatierapport", "Validation report"),
  });

  const sheet = new Sheet(doc);
  // The file is the subject; the module, the blad and the sheet's size are what
  // qualify it. All of it in the hero's right column, where the projectrapport puts
  // the same three lines — the standalone `Blad`/`Omvang`/`Gegenereerd` table this
  // used to print underneath said the same thing a second time, at the cost of the
  // 60pt that kept a short report's findings off page two.
  drawHero(doc, sheet, {
    kind: tr("Validatierapport", "Validation report"),
    subject: report.fileName,
    lines: [
      ...(report.moduleLabel ? [report.moduleLabel] : []),
      tr(
        `Blad ${report.sheetName} · ${omvangText(report.totalRows, report.totalColumns)}`,
        `Sheet ${report.sheetName} · ${omvangText(report.totalRows, report.totalColumns)}`
      ),
      generatedLine(),
    ],
  });

  // Above the figures, not under them, exactly where the drawer puts it: it says
  // the numbers below have stopped being true, and a reader who meets that after
  // reading them has already been misled.
  if (report.stale) {
    drawBanner(
      doc,
      sheet,
      // The drawer bolds the button it wants clicked; nothing here is clickable,
      // so the warning itself carries the weight.
      [
        { text: tr("Let op:", "Note:"), bold: true },
        {
          text: tr(
            " de gegevens zijn gewijzigd na deze controle. Hercontroleer in de tool voor een actueel rapport.",
            " the data has changed since this check. Re-check in the tool for an up-to-date report."
          ),
        },
      ],
      AMBER_BG,
      AMBER_LINE,
      AMBER_INK,
      alertTriangleMark,
    );
  }

  drawMetrics(doc, sheet, report);

  if (report.missingColumns.length > 0) {
    drawBanner(
      doc,
      sheet,
      // The column names in bold, the way `MissingColumnsNotice` has them on
      // screen: they are what the reader has to go and look for.
      [
        { text: tr("Verwachte kolom(men) niet gevonden: ", "Expected column(s) not found: ") },
        { text: report.missingColumns.join(", "), bold: true },
        { text: tr(". Deze controles zijn overgeslagen.", ". These checks were skipped.") },
      ],
      AMBER_BG,
      AMBER_LINE,
      AMBER_INK,
      alertTriangleMark,
    );
  }

  // Said up front, next to the other things that qualify the figures: the file
  // the client gets back is not entirely what they typed, and they should hear so
  // before they meet a changed cell in it. The details follow the errors below.
  if (report.autofixedCount > 0) {
    const cells =
      report.autofixedCount === 1
        ? tr("1 cel", "1 cell")
        : tr(`${report.autofixedCount} cellen`, `${report.autofixedCount} cells`);
    drawBanner(
      doc,
      sheet,
      [
        { text: tr("Automatisch aangepast: ", "Automatically changed: "), bold: true },
        {
          text: tr(
            `de tool heeft ${cells} gecorrigeerd waar de omschrijving uit een codetabel stond in plaats van de code (bijvoorbeeld "Nederland" in plaats van NL). Zie het overzicht onderaan dit rapport.`,
            `the tool has corrected ${cells} where the description from a code table stood in place of the code (for example "Netherlands" instead of NL). See the overview at the bottom of this report.`
          ),
        },
      ],
      AMBER_BG,
      AMBER_LINE,
      AMBER_INK,
      checkCircleMark,
    );
  }

  sheet.need(26);
  sheet
    .font(8.5, "bold", BODY)
    .line(
      report.columns.length > 0
        ? tr(`PER KOLOM (${report.columns.length})`, `PER COLUMN (${report.columns.length})`)
        : tr("PER KOLOM", "PER COLUMN"),
      MARGIN,
      8.5,
      16,
    );

  if (report.columns.length === 0) {
    drawBanner(
      doc,
      sheet,
      [{ text: tr("Geen fouten gevonden in dit blad.", "No errors found in this sheet.") }],
      GREEN_BG,
      GREEN_LINE,
      GREEN_INK,
      checkCircleMark,
    );
  } else {
    for (const column of report.columns) {
      drawColumn(doc, sheet, column);
    }
  }

  if (report.autofixed.length > 0) {
    sheet.space(6);
    sheet.need(26);
    sheet
      .font(8.5, "bold", BODY)
      .line(
        tr(
          `AUTOMATISCH AANGEPAST (${report.autofixed.length})`,
          `AUTOMATICALLY CHANGED (${report.autofixed.length})`
        ),
        MARGIN,
        8.5,
        16
      );
    sheet.font(8, "normal", BODY);
    sheet.paragraph(
      tr(
        "Deze waarden zijn door de tool vervangen door de bijbehorende code uit de codetabel. Het gedownloade bestand bevat de gecorrigeerde waarden.",
        "The tool has replaced these values with the matching code from the code table. The downloaded file contains the corrected values."
      ),
      MARGIN,
      8,
      sheet.width,
      11,
    );
    sheet.space(6);
    for (const column of report.autofixed) {
      drawAutofixColumn(doc, sheet, column);
    }
  }

  sheet.space(4);
  sheet.font(7.5, "normal", BODY);
  sheet.paragraph(
    tr(
      "Rijnummers zijn de rijnummers uit het Excel-bestand — dezelfde rijen die het gedownloade bestand markeert.",
      "Row numbers are the row numbers from the Excel file — the same rows the downloaded file marks."
    ),
    MARGIN,
    7.5,
    sheet.width,
    10,
  );

  drawFooters(doc, tr(`Validatierapport · ${report.fileName}`, `Validation report · ${report.fileName}`));
  return doc.output("blob");
}

/** Build the report PDF and hand it to the browser as a download. */
export async function downloadReportPdf(report: ValidationReport): Promise<void> {
  const blob = await buildReportPdf(report);
  triggerDownload(
    blob,
    downloadName(report.fileName, "pdf", tr("Validatierapport_", "Validation_report_"), report.projectId)
  );
}
