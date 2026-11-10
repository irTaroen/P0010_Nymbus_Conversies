/**
 * The projectrapport as a PDF — the status one-pager that would get mailed to a
 * project lead, the way the validatierapport already goes out to a client.
 *
 * Same medium, same primitives, different report: this file draws from
 * [`report-pdf.ts`](./report-pdf.ts)'s `Sheet`, its WinAnsi-safe text helpers, its
 * palette and its lucide `IconMark`s, so the two PDFs read as one system rather than
 * two. What differs is the shape of the data — a project's modules instead of one
 * sheet's cells — so the drawing here is new, but nothing about *how* a page is laid
 * out is reinvented.
 *
 * **Both** on-screen views, whichever of
 * [`ProjectReport`](../components/ProjectReport.tsx)'s Lijst/Bord toggle is open: the
 * list on the first page, the board from a fresh page after it. A PDF has no toggle,
 * and the two answer different questions — *how is each module doing* and *who has
 * to act next* — so a mailed report carries both rather than whichever happened to be
 * on screen.
 *
 * Nothing is counted or worded here — every figure and every line of text comes from
 * [`lib/project-report.ts`](./project-report.ts), the same module `ProjectReport.tsx`
 * reads, so the screen and the mailed PDF can never disagree about one project.
 */

import type { jsPDF, TextOptionsLight } from "jspdf";
import { downloadName, triggerDownload } from "@/lib/download";
import { tr } from "@/lib/i18n";
import {
  conversionSteps,
  moduleStatusTone,
  type ConversionPhase,
  type ModuleStatusTone,
  type StepState,
} from "@/lib/modules";
import {
  completenessTone,
  formatCheckedAt,
  progressFigureLabel,
  storedErrorCount,
  storedErrorText,
  type CompletenessTone,
} from "@/lib/project-progress";
import {
  boardCardDetail,
  boardCheckText,
  buildProjectBoard,
  completionMetricText,
  deadlineMetricText,
  phaseTag,
  rowDeliveryDate,
  rowTurn,
  sendRefusalLines,
  startedMetricText,
  type ProjectReport,
  type ProjectReportRow,
} from "@/lib/project-report";
import { countText, type MetricText } from "@/lib/validation/metrics";
import {
  ASCENT,
  BODY,
  BORDER,
  columnsFromRight,
  drawCard,
  drawCardDivider,
  drawFooters,
  drawHero,
  drawRuns,
  ellipsize,
  EMERALD,
  generatedLine,
  MARGIN,
  measure,
  NAVY,
  newReportDoc,
  pill,
  PRIMARY,
  RED,
  Sheet,
  STATUS_BAD,
  STATUS_GOOD,
  SURFACE,
  wrap,
  wrapRuns,
  write,
  writeColumnHeadings,
  type Rgb,
  type Run,
  type Tone,
} from "@/lib/report-pdf";

/**
 * The four status tones' fills, at the exact hex Tailwind's classes in
 * `STATUS_TONE_FILL` ([`lib/modules.tsx`](./modules.tsx)) resolve to —
 * `bg-emerald-500`/`bg-sky-400`/`bg-primary`/`bg-red-500` — so the meter here and the
 * sidebar dot on screen are the same colour for the same status. `PRIMARY` already
 * exists in `report-pdf.ts` for the client tone; `emerald-500` and `sky-400` have no
 * equivalent there (its own `GREEN` is `green-600`, the validatierapport's clean-state
 * colour, not this palette's "done").
 */
const SKY: Rgb = [74, 143, 168]; // --k-cyan-fg

/**
 * `text-emerald-600`, the ink the on-screen row gives a **Rijen OK** of 100% — and
 * deliberately not {@link EMERALD} above, which is `emerald-500`, the *dot's*
 * green. One step darker is what a percentage needs to stay readable as text at
 * 8pt where a 2.4pt dot does not, and it is what the screen already uses, so
 * borrowing the dot's hue here would have made the PDF the one place the two
 * greens differ.
 */
const EMERALD_INK: Rgb = [90, 138, 74]; // --k-green-fg

/** `text-body/60` on white, pre-blended — the ink of the *(Nymbus)* mark on screen. */
const BODY_MUTED: Rgb = [154, 157, 180]; // --k-text-tertiary

export const STATUS_TONE_RGB: Record<ModuleStatusTone, Rgb> = {
  done: EMERALD,
  nymbus: SKY,
  client: PRIMARY,
  rejected: RED,
};

/**
 * The *Fase* fills at the light-theme hex `PHASE_FILL` ([`lib/modules.tsx`](./modules.tsx))
 * resolves to — the purple, cyan and green inks and the tertiary grey — so the PDF's
 * meter is the screen's.
 */
export const PHASE_RGB: Record<ConversionPhase, Rgb> = {
  afgerond: [122, 95, 179], // --k-purple-fg
  live: [74, 143, 168], // --k-cyan-fg
  test: [90, 138, 74], // --k-green-fg
  validatie: [154, 157, 180], // --k-text-tertiary
};

/** A *Fase* step's mark — the on-screen stepper's `STEP_MARK`, as one fill each. */
const STEP_RGB: Record<StepState, Rgb> = {
  done: EMERALD,
  current: SKY, // the status dot's sky, as on screen
  rejected: RED,
  todo: BORDER,
};

/**
 * The row dot's tone, in the same four bands the sidebar and the on-screen
 * projectrapport use ({@link CompletenessTone} in `lib/project-progress.ts`) — grey
 * unchecked, red at half clean or under, amber short of a full sheet, green at 100%.
 */
const COMPLETENESS_TONE_RGB: Record<CompletenessTone, Rgb> = {
  unchecked: [154, 157, 180], // --k-text-tertiary
  poor: RED,
  partial: [184, 115, 51], // --k-amber-fg
  clean: EMERALD,
};

/** One band of a meter: its id, its count, and what the legend calls it. */
type Segment<K extends string> = { id: K; value: number; label?: string };

/**
 * A segmented meter, `height` tall across `width`, its bands painted from `fills` —
 * the projectrapport's *Fase* card and, smaller, every line of the managementrapport. The empty track first,
 * then one rounded fill per non-zero status, `gap` apart, each at least `minWidth`
 * wide so a single module stays visible.
 *
 * Each fill's start comes from the running **total of the values before it**, not
 * from a cursor advanced by the width just drawn: a cursor accumulates one gap per
 * segment on top of rounded widths, and the last fill then starts past the track's
 * end and spills out through the card's rounded corner. The last fill takes the
 * rounding leftovers, so the fills meet the track's end exactly.
 *
 * Scaled by the segments' own sum, not the module count: the two agree for a real
 * project, but a module counted under two statuses would otherwise fill the track
 * before the last segment got any width at all.
 */
export function drawSegmentMeter<K extends string>(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  segments: readonly Segment<K>[],
  fills: Record<K, Rgb>,
  { gap, minWidth }: { gap: number; minWidth: number },
): void {
  const filled = segments.filter((s) => s.value > 0);
  const radius = height / 2;
  doc.setFillColor(...BORDER);
  doc.roundedRect(x, y, width, height, radius, radius, "F");
  const total = filled.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return;
  const available = width - gap * (filled.length - 1);
  let before = 0;
  filled.forEach((segment, i) => {
    const start = x + (before / total) * available + i * gap;
    before += segment.value;
    const end = i === filled.length - 1 ? x + width : x + (before / total) * available + i * gap;
    doc.setFillColor(...(fills[segment.id] as Rgb));
    doc.roundedRect(start, y, Math.max(minWidth, end - start), height, radius, radius, "F");
  });
}

/**
 * A meter's legend on one row from `x`: dot · label · count for every segment,
 * the empty ones included, measured so the entries land where they fit rather than
 * at guessed offsets. A meter is never read by colour alone.
 */
export function drawSegmentLegend<K extends string>(
  doc: jsPDF,
  sheet: Sheet,
  x: number,
  y: number,
  segments: readonly Segment<K>[],
  fills: Record<K, Rgb>,
): void {
  let lx = x;
  for (const segment of segments) {
    doc.setFillColor(...(fills[segment.id] as Rgb));
    doc.circle(lx + 2.5, y - 2.5, 2.5, "F");
    sheet.font(8, "normal", BODY);
    write(doc, segment.label ?? "", lx + 9, y);
    lx += 9 + measure(doc, segment.label ?? "") + 5;
    sheet.font(8, "bold", NAVY);
    const count = String(segment.value);
    write(doc, count, lx, y);
    lx += measure(doc, count) + 12;
  }
}

/**
 * *Aan zet* — who has to move the open modules, as a legend row under the *Fase*
 * one: bij Nymbus and bij de klant, rejected modules counted under whoever has to
 * act, in the colours the open step of each row's stepper wears. The screen's
 * `PhaseTurnLegend`, second half.
 */
export function drawTurnLegend(
  doc: jsPDF,
  sheet: Sheet,
  x: number,
  y: number,
  report: { turnSegments: ProjectReport["turnSegments"] },
): void {
  sheet.font(7, "bold", BODY);
  const heading = tr("AAN ZET", "WHOSE TURN");
  write(doc, heading, x, y);
  drawSegmentLegend(doc, sheet, x + measure(doc, heading) + 8, y, report.turnSegments, STATUS_TONE_RGB);
}

/**
 * The metric card: the two headline figures side by side on the left, the project's
 * status meter with its legend beside them on the right — the same reading order the
 * card has on screen ([`ProjectReport.tsx`](../components/ProjectReport.tsx)), and the
 * project-level sibling of `report-pdf.ts`'s `drawMetrics()`.
 *
 * Where the portrait validatierapport stacks its meter *under* the figures, this one
 * puts it beside them, and the two figures beside each other rather than one above the
 * other. Both are the same decision: on A4 **landscape** height is the scarce
 * resource, not width. The page has 465pt of usable height, of which the header, the
 * meta line, the two column-heading rows, two group bands and fifteen module rows
 * already claim ~373 — leaving this card **under 80pt** if a real project is to stay
 * on the one page the format exists for. Laid out horizontally it costs ~72; every
 * vertical arrangement of the same content costs 110–135 and pushes five modules onto
 * a second page. So the width landscape bought is spent here too, not only on the
 * table below.
 *
 * Kept as its own function rather than shared with `drawMetrics()`: the two read
 * different report shapes end to end, and now different layouts too.
 */
function drawProjectMetrics(doc: jsPDF, sheet: Sheet, report: ProjectReport): void {
  // The screen's three figures: opgestart, afgerond, nearing the deadline.
  const metrics: MetricText[] = [
    startedMetricText(report),
    completionMetricText(report),
    deadlineMetricText(report),
  ];
  const PAD = 11;
  const FIGURE_SIZE = 22;
  const LINE = 10.5;

  // Left part: the figures side by side, each in its own column. Right half:
  // the meter, its track full-width of that half and the legend flowed across one
  // row beneath it. The hairline between the two halves sits at `meterX - 12`.
  const figuresWidth = sheet.width * 0.62;
  const figureColumn = figuresWidth / metrics.length;
  const meterX = MARGIN + figuresWidth + 12;
  // Minus the card's own right padding as well as the hairline gap, or the track
  // runs out through the rounded corner.
  const meterWidth = sheet.width - figuresWidth - 12 - PAD - 14;

  sheet.font(9, "normal", BODY);
  const captionWidth = figureColumn - 14;
  const captions = metrics.map((m) => wrap(doc, m.caption, captionWidth));
  const captionLines = Math.max(...captions.map((c) => c.length));
  // The figures' block: the number, the tallest caption of the two (so the pair's
  // details sit on one line), and the detail line under it.
  const figuresHeight = FIGURE_SIZE * 1.08 + captionLines * LINE + LINE;

  // Meter block: a heading line, the track, then the legend on a single row.
  // Plus the *Aan zet* row under the legend (see `drawTurnLegend()`).
  const meterHeight = 14 + 8 + 10 + 11 + 13;

  const height = PAD * 2 + Math.max(figuresHeight, meterHeight);

  sheet.need(height);
  const top = sheet.y;
  drawCard(doc, sheet, top, height);

  // The figures, side by side.
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
      write(doc, ellipsize(doc, metric.detail, figureColumn - 14), x, detailY + 8 * ASCENT);
    }
  });

  // The hairline between the figures and the meter, the height of the card's own padding.
  drawCardDivider(doc, meterX - 12, top, height, PAD);

  // The meter — the conversion's phases, as on screen: how far the modules got
  // (validated, in test, in live, done) rather than whose turn it is, which the
  // table's *Status in AFAS* and the board's lanes keep.
  sheet.font(7.5, "bold", BODY);
  write(doc, tr("FASE", "STAGE"), meterX, top + PAD + 7.5 * ASCENT);
  let y = top + PAD + 14;

  drawSegmentMeter(doc, meterX, y, meterWidth, 8, report.phaseSegments, PHASE_RGB, { gap: 2, minWidth: 3 });
  y += 18;

  // Legend: every segment, including the empty ones, with its count — the same
  // "never read by colour alone" rule the sheet meter's legend follows.
  drawSegmentLegend(doc, sheet, meterX, y, report.phaseSegments, PHASE_RGB);

  sheet.y = top + height + 12;
}

/**
 * What a module's row says under **Fouten**, and how it is dressed — the same four
 * cases `ErrorCell` on screen keeps apart, in the same two costumes.
 *
 * A **counted** module gets the tinted badge the screen gives it: green for a clean
 * sheet, red once anything was found. That is the one colour a reader scanning the
 * table actually needs — *which modules still have something wrong* — and printing
 * it as plain navy threw the answer away, leaving the eye to read eleven strings
 * before finding the two that matter. The tones are `report-pdf.ts`'s own
 * {@link STATUS_GOOD}/{@link STATUS_BAD}, the pre-blended form of the very
 * `--color-status-good`/`--color-status-bad` the badge on screen is built from, so
 * the mailed page and the app are the same colour and not merely both "green".
 *
 * The two **uncounted** cases carry no tone (`null`): they are not verdicts, and on
 * screen they are muted text rather than a badge for exactly that reason — a grey
 * *Niet gecontroleerd* must not read as a third severity beside the red and green.
 *
 * Which unit it prints follows the screen exactly (see `ErrorCell`): the **fields**
 * a check counted in this session, or the **rows** AFAS stores once that is all
 * that is left. A printed page can't explain itself on hover, so the row figure
 * carries its unit in the words — *3 rijen met fouten* — rather than reading as a
 * field count that happens to be lower.
 */
function rowError(progress: ProjectReportRow["progress"]): {
  text: string;
  tone: Tone | null;
} {
  if (!progress) return { text: tr("Niet gecontroleerd", "Not checked"), tone: null };
  const found = storedErrorCount(progress);
  if (found === null) return { text: tr("Niet geteld", "Not counted"), tone: null };
  return found.count === 0
    ? { text: tr("Geen fouten", "No errors"), tone: STATUS_GOOD }
    : { text: storedErrorText(found), tone: STATUS_BAD };
}

/**
 * Column x-offsets from the left margin, sized to what each column's longest real
 * value actually measures (checked against `Controle testimport` for status,
 * `100 rijen met fouten` for fouten — 70pt of the 100 available, and the longest
 * that column can now hold since it prints AFAS's stored row count as well as a
 * field count, `30-07-2026 14:05` for the timestamp) with
 * comfortable padding on top rather than the tightest fit that survives — A4
 * **landscape** (not portrait; changed with this table in mind, since a wide
 * six-column table reads better with room to breathe than squeezed into a narrow
 * page) leaves plenty to spend. **Module still gets what `sheet.width` leaves
 * over** after the five fixed columns, so the layout stays correct if the page
 * format ever changes again rather than silently drifting off the right edge.
 */
const COL_WIDTH = {
  status: 94,
  stage: 52,
  errors: 83,
  progress: 60,
  delivery: 56,
  checked: 78,
};
const COL_GAP = 12;

/**
 * Eight since *Fase* joined (22-10-2026), and the figure grew its word
 * (*100% gevalideerd*). Every other fixed column gave up what it had over its longest
 * real value to make the room — *Live import niet akkoord* for status (94 with its
 * dot), *Controle ingevulde template (Nymbus)* for wacht op (127), the *608 rijen met
 * fouten* badge (83), *LAATSTE CONTROLE* (78) — and the gap went from 14 to 12; a
 * right-aligned head wider than its column (*OPLEVERDATUM*) runs into the gap before
 * it, which a right-aligned figure never fills. The module keeps 87pt, which still
 * holds *Financiële contracten*. *Fase* is the compact form of the screen's stepper
 * — three marks and the open step's name — because the named steps take 84pt.
 *
 * Seven again since *Wacht op* left (23-10-2026) — the same table
 * [`ModuleReportTable`](../components/ModuleReportTable.tsx) draws on both the
 * project page and the managementrapport. Its 128pt went to the module, which
 * takes whatever the fixed columns leave. *Fase* comes before *Status in AFAS*, as on
 * screen: the step first, AFAS's word for it second.
 */
function tableColumns(sheet: Sheet) {
  const fixed = columnsFromRight(
    sheet.width,
    [
      ["checked", COL_WIDTH.checked],
      ["delivery", COL_WIDTH.delivery],
      ["progress", COL_WIDTH.progress],
      ["errors", COL_WIDTH.errors],
      ["status", COL_WIDTH.status],
      ["stage", COL_WIDTH.stage],
    ],
    COL_GAP,
  );
  return { dot: 0, moduleName: 12, ...fixed };
}

/** Column headers, printed once above the first group. */
function drawColumnHeadings(doc: jsPDF, sheet: Sheet): void {
  const col = tableColumns(sheet);
  sheet.need(16);
  writeColumnHeadings(doc, sheet, [
    ["Module", col.moduleName, "left"],
    [tr("Fase", "Stage"), col.stage, "left"],
    ["Status", col.status, "left"],
    [tr("Fouten", "Errors"), col.errors, "left"],
    [tr("Rijen OK", "Rows OK"), col.progress + COL_WIDTH.progress, "right"],
    [tr("Opleverdatum", "Delivery date"), col.delivery + COL_WIDTH.delivery, "right"],
    [tr("Laatste controle", "Last check"), col.checked + COL_WIDTH.checked, "right"],
  ]);
  sheet.space(14);
}

/**
 * One group's heading band, then one **single line per module** — module, fase,
 * status in AFAS, fouten, rijen OK, opleverdatum, laatste controle, in the same order and the
 * same table shape [`ProjectReport.tsx`](../components/ProjectReport.tsx)'s list
 * view uses on screen. All seven columns fit a page at this size (measured against
 * the longest real value each one carries, see {@link COL_WIDTH}) — the one-page
 * report this item asked for is a table read at a glance, not a sentence per module.
 */
function drawGroup(
  doc: jsPDF,
  sheet: Sheet,
  group: ProjectReport["groups"][number],
): void {
  const col = tableColumns(sheet);

  sheet.need(20);
  doc.setFillColor(...SURFACE);
  doc.roundedRect(MARGIN, sheet.y, sheet.width, 15, 5, 5, "F");
  sheet.font(7.5, "bold", BODY);
  write(doc, group.label.toUpperCase(), MARGIN + 10, sheet.y + 10.5);
  sheet.space(18);

  // Measured against the page's own budget rather than picked: A4 landscape leaves
  // 465pt under the margins and footer, of which the hero, the metric card, the two
  // heading rows, two group bands and the footnote take ~230 — so fifteen modules
  // get ~15.5pt each, and 15 is what fits with a hairline over. Dense, but it still
  // clears 8.5pt text with padding, and one page is the whole point of this format
  // (see {@link drawHero} and {@link drawProjectMetrics}, both laid out sideways for
  // the same reason).
  const rowHeight = 15;
  for (const row of group.rows) {
    sheet.need(rowHeight);
    const rowTop = sheet.y;
    const baseline = rowTop + 8 * ASCENT + 1.5;

    // Status dot — the same four-tone scale as the sidebar's and the on-screen
    // row's own dot (`completenessTone`), so a reader flipping between the PDF
    // and the app sees the same colour mean the same thing.
    doc.setFillColor(...COMPLETENESS_TONE_RGB[completenessTone(row.progress)]);
    doc.circle(MARGIN + col.dot + 3, baseline - 8 * ASCENT * 0.35, 2.4, "F");

    sheet.font(8.5, "bold", NAVY);
    write(doc, ellipsize(doc, row.label, col.stage - col.moduleName - COL_GAP), MARGIN + col.moduleName, baseline);

    // Status in AFAS — behind the dot of the tone it is counted under, the same
    // colour as the meter above, the way `StatusCell` shows it on screen.
    sheet.font(8, "normal", BODY);
    if (row.status?.status) {
      doc.setFillColor(...STATUS_TONE_RGB[moduleStatusTone(row.status)]);
      doc.circle(MARGIN + col.status + 2.5, baseline - 8 * ASCENT * 0.35, 2.5, "F");
      write(doc, ellipsize(doc, row.status.status, COL_WIDTH.status - 9), MARGIN + col.status + 9, baseline);
    } else {
      write(doc, "—", MARGIN + col.status, baseline);
    }

    // Fase — the screen's stepper, compact: a mark per step (done green, open blue,
    // turned down red, ahead grey) and the open step's name, red when turned down.
    const steps = conversionSteps(row.status);
    const phase = phaseTag(row);
    if (steps && phase) {
      const dotY = baseline - 8 * ASCENT * 0.35;
      steps.forEach((step, i) => {
        // The open step in the colour of whoever has to move it, as on screen.
        const turn = rowTurn(row);
        doc.setFillColor(
          ...(step.state === "current" && turn ? STATUS_TONE_RGB[turn] : STEP_RGB[step.state]),
        );
        const cx = MARGIN + col.stage + 2.2 + i * 6.5;
        doc.circle(cx, dotY, 2.2, "F");
        // A turned-down step stays red, ringed in the colour of whoever has to act
        // on it — a rejection is still with Nymbus or the client, as on screen.
        if (step.state === "rejected" && turn) {
          doc.setDrawColor(...STATUS_TONE_RGB[turn]);
          doc.setLineWidth(0.8);
          doc.circle(cx, dotY, 3.2, "S");
        }
      });
      sheet.font(7.5, phase.rejected ? "bold" : "normal", phase.rejected ? STATUS_BAD.ink : NAVY);
      write(doc, ellipsize(doc, phase.label, COL_WIDTH.stage - 21), MARGIN + col.stage + 21, baseline);
    } else {
      sheet.font(8, "normal", BODY);
      write(doc, "—", MARGIN + col.stage, baseline);
    }

    // Fouten — the tinted badge for a counted module, muted text for one that was
    // never checked (see {@link rowError}). `pill()` sets its own font and size, so
    // the text measured for the ellipsis is measured under those, not the 8pt the
    // plain branch uses; the padding it adds is subtracted from the column so a
    // long value's box still ends inside `COL_WIDTH.errors`.
    const error = rowError(row.progress);
    if (error.tone) {
      sheet.font(7.5, "bold", NAVY);
      const label = ellipsize(doc, error.text, COL_WIDTH.errors - 12);
      // Centred on the row's baseline rather than hung from it: the badge is taller
      // than the line, and aligning its top to the text's would push it into the
      // row below at this 15pt row height.
      pill(doc, label, MARGIN + col.errors, baseline - 9.2, error.tone);
    } else {
      sheet.font(8, "normal", BODY);
      write(doc, ellipsize(doc, error.text, COL_WIDTH.errors), MARGIN + col.errors, baseline);
    }

    // Rijen OK — green at a full sheet, navy otherwise, the same two inks the
    // on-screen row switches between (`text-emerald-600` / `text-navy`), and after it
    // what the figure measures: *gevalideerd*, *in Test*, *in Live*.
    const rightAlign: TextOptionsLight = { align: "right" };
    const progressRight = MARGIN + col.progress + COL_WIDTH.progress;
    if (row.progress) {
      sheet.font(7, "normal", BODY);
      const word = ` ${progressFigureLabel(row.progress)}`;
      write(doc, word, progressRight, baseline, rightAlign);
      const wordWidth = measure(doc, word);
      sheet.font(8, "bold", row.progress.completeness === 100 ? EMERALD_INK : NAVY);
      write(doc, `${row.progress.completeness}%`, progressRight - wordWidth, baseline, rightAlign);
    } else {
      sheet.font(8, "bold", NAVY);
      write(doc, "—", progressRight, baseline, rightAlign);
    }

    sheet.font(7.5, "normal", BODY);
    write(doc, rowDeliveryDate(row) ?? "—", MARGIN + col.delivery + COL_WIDTH.delivery, baseline, rightAlign);
    write(
      doc,
      row.progress ? formatCheckedAt(row.progress.checkedAt) : "—",
      MARGIN + col.checked + COL_WIDTH.checked,
      baseline,
      rightAlign,
    );

    sheet.y = rowTop + rowHeight;
  }
  sheet.space(5);
}

/**
 * The footnote under the table — the same sentence
 * [`ProjectReport.tsx`](../components/ProjectReport.tsx) prints under its own list, in
 * the same words, because a mailed page has no column tooltip to hover and the reader
 * is exactly the person who has never seen these six headings before. Emphasis on the
 * column names via `report-pdf.ts`'s `wrapRuns`/`drawRuns`, the pair written for a
 * wrapped line that changes weight mid-sentence.
 */
export function drawTableNote(doc: jsPDF, sheet: Sheet): void {
  const SIZE = 7.5;
  const runs: Run[] = [
    { text: "Status", bold: true },
    { text: tr(" is waar de module in de conversie staat; ", " is where the module stands in the conversion; ") },
    { text: tr("Fase", "Stage"), bold: true },
    {
      text: tr(
        " is de stap waarop de module staat — validatie, de import in de testomgeving, de" +
          " import in de live-omgeving (groen gedaan, rood niet akkoord; de open stap, en de ring om een afgekeurde, blauw bij Nymbus en oranje bij de klant) — en" +
          " een module is pas klaar als Live is afgerond. ",
        " is the step the module is on — validation, the import into the test environment, the" +
          " import into the live environment (green done, red not approved; the open step, and the ring around a turned-down one, blue with Nymbus and orange with the client) — and" +
          " a module is only finished once Live is done. "
      ),
    },
    { text: tr("Fouten", "Errors"), bold: true },
    { text: tr(" en ", " and ") },
    { text: tr("Rijen OK", "Rows OK"), bold: true },
    {
      text: tr(
        " komen uit de laatste controle van dat bestand: de velden die nog een fout" +
          " bevatten, en het percentage rijen dat zo naar AFAS kan (gevalideerd). Staat er" +
          " in Test of in Live achter, dan zijn de rijen al naar die omgeving verstuurd: ",
        " come from the last check of that file: the fields that still contain an error, and" +
          " the percentage of rows that can go to AFAS that way (validated). If it says" +
          " Test or Live after it, the rows have already been sent to that environment: "
      ),
    },
    { text: tr("Rijen OK", "Rows OK"), bold: true },
    { text: tr(" is dan het aandeel dat er echt in staat, en ", " is then the share that is actually in it, and ") },
    { text: tr("Fouten", "Errors"), bold: true },
    { text: tr(" het aantal rijen dat AFAS weigerde; ", " the number of rows AFAS refused; ") },
    { text: tr("Opleverdatum", "Delivery date"), bold: true },
    {
      text: tr(
        " is de opleverdatum die AFAS bij de module vastlegt — een streepje betekent" +
          " dat AFAS er nog geen datum voor heeft.",
        " is the delivery date AFAS records for the module — a dash means" +
          " AFAS has no date for it yet."
      ),
    },
  ];
  const lines = wrapRuns(doc, runs, SIZE, sheet.width);
  sheet.space(6);
  for (const line of lines) {
    sheet.need(SIZE * 1.45);
    drawRuns(doc, line, MARGIN, sheet.y + SIZE * ASCENT, SIZE, BODY);
    sheet.space(SIZE * 1.45);
  }
}

/**
 * Everything under the hero: the metric card, the module table and its footnote —
 * or the one sentence a project without modules gets. Exported so the
 * managementrapport ([`management-report-pdf.ts`](./management-report-pdf.ts)) can
 * draw each client's page with exactly this layout under a heading of its own,
 * rather than a second copy of it that would drift. `note: false` leaves the
 * footnote off for a caller that prints it once for all its projects.
 */
export function drawProjectReportBody(
  doc: jsPDF,
  sheet: Sheet,
  report: ProjectReport,
  { note = true }: { note?: boolean } = {},
): void {
  if (report.moduleCount === 0) {
    sheet.font(9.5, "normal", BODY);
    sheet.paragraph(tr("Dit project heeft nog geen modules.", "This project has no modules yet."), MARGIN, 9.5, sheet.width);
    return;
  }
  drawProjectMetrics(doc, sheet, report);

  // No `MODULES (n)` heading of its own: the count is already the metric card's
  // own `2 van 15 modules`, and on a page whose whole job is fitting one screen's
  // worth of table, a line restating it costs a module row.
  drawColumnHeadings(doc, sheet);

  for (const group of report.groups) {
    drawGroup(doc, sheet, group);
  }

  if (note) drawTableNote(doc, sheet);
  drawSendRefusals(doc, sheet, report);
}

/**
 * *Geweigerd door AFAS* — the same section the screen prints under its list
 * (`SendRefusals` in [`ProjectReport.tsx`](../components/ProjectReport.tsx)), off the
 * same `sendRefusalLines()`: per module whose last send left rows out, AFAS's reasons
 * with the rows each one refused. Nothing at all when no send refused anything.
 */
function drawSendRefusals(doc: jsPDF, sheet: Sheet, report: ProjectReport): void {
  const lines = sendRefusalLines(report);
  if (lines.length === 0) return;
  const SIZE = 7.5;
  const GAP = SIZE * 1.45;
  const COUNT = 52;

  sheet.space(8);
  sheet.need(GAP * 3);
  sheet.font(7.5, "bold", BODY);
  write(doc, tr("GEWEIGERD DOOR AFAS", "REFUSED BY AFAS"), MARGIN, sheet.y + 7.5 * ASCENT);
  sheet.space(GAP + 2);

  for (const line of lines) {
    sheet.need(GAP * 2);
    sheet.font(SIZE, "bold", NAVY);
    write(doc, line.label, MARGIN, sheet.y + SIZE * ASCENT);
    const labelWidth = measure(doc, line.label);
    sheet.font(SIZE, "normal", BODY);
    write(
      doc,
      tr(
        ` · ${countText(line.failedRows, "rij", "rijen")} niet in AFAS (${line.stage}) · verstuurd ${line.sentAt}`,
        ` · ${countText(line.failedRows, "row", "rows")} not in AFAS (${line.stage}) · sent ${line.sentAt}`
      ),
      MARGIN + labelWidth,
      sheet.y + SIZE * ASCENT,
    );
    sheet.space(GAP);

    const items = [
      ...line.refusals.map((r) => ({ rows: r.rows, text: r.message })),
      ...(line.heldBackRows > 0
        ? [
            {
              rows: line.heldBackRows,
              text: tr(
                "Tegengehouden: iets wat deze rijen opzoeken bestaat nog niet in AFAS.",
                "Held back: something these rows look up does not exist in AFAS yet."
              ),
            },
          ]
        : []),
    ];
    for (const item of items) {
      const wrapped = wrap(doc, item.text, sheet.width - COUNT - 8);
      sheet.need(GAP * Math.min(wrapped.length, 2));
      sheet.font(SIZE, "bold", STATUS_BAD.ink);
      write(doc, countText(item.rows, tr("rij", "row"), tr("rijen", "rows")), MARGIN + COUNT, sheet.y + SIZE * ASCENT, {
        align: "right",
      });
      sheet.font(SIZE, "normal", BODY);
      for (const text of wrapped) {
        sheet.need(GAP);
        write(doc, text, MARGIN + COUNT + 8, sheet.y + SIZE * ASCENT);
        sheet.space(GAP);
      }
    }
    sheet.space(4);
  }
}

/** `text-zinc-400`, the ink of a card's HRM/ERP tag on screen. */
const ZINC_400: Rgb = [154, 157, 180]; // --k-text-tertiary
/** `bg-zinc-300`, the dot of the lane AFAS holds no status for. */
const ZINC_300: Rgb = [217, 210, 200]; // --k-divider

/**
 * The **bord** ([`ProjectReportBoard`](../components/ProjectReportBoard.tsx)) on a
 * page of its own: one lane per status in AFAS, side by side, one card per module —
 * the same lanes, order, cards and wording as on screen, all from
 * `buildProjectBoard()`, `boardCardDetail()` and `boardCheckText()`.
 *
 * Drawn **row by row across the lanes** rather than lane by lane: every card has the
 * same height, so the n-th card of every lane shares one band, and a band that won't
 * fit breaks to a new page with the lane heads drawn again above it. A long lane
 * therefore continues on the next page under its own head instead of running off the
 * bottom, which a lane-at-a-time layout couldn't do without the others losing their
 * place.
 */
function drawProjectBoard(doc: jsPDF, sheet: Sheet, report: ProjectReport): void {
  const lanes = buildProjectBoard(report);
  const GAP = 8;
  const PAD = 6;
  const HEAD = 20;
  const CARD = 40;
  const ROW = CARD + PAD;
  const laneWidth = (sheet.width - GAP * (lanes.length - 1)) / lanes.length;
  const cardWidth = laneWidth - PAD * 2;
  const laneX = (i: number) => MARGIN + i * (laneWidth + GAP);

  doc.addPage();
  sheet.y = MARGIN;
  sheet.font(12, "bold", NAVY);
  write(doc, tr("Bord", "Board"), MARGIN, sheet.y + 12 * ASCENT);
  sheet.space(17);
  sheet.font(8.5, "normal", BODY);
  write(
    doc,
    tr(
      "De modules in kolommen, gegroepeerd op hun status in AFAS.",
      "The modules in columns, grouped by their status in AFAS."
    ),
    MARGIN,
    sheet.y + 8.5 * ASCENT
  );
  sheet.space(18);

  // A lane's head — the meter's legend entry one level down: dot, word, count.
  const drawHeads = () => {
    lanes.forEach((lane, i) => {
      const x = laneX(i);
      doc.setFillColor(...SURFACE);
      doc.roundedRect(x, sheet.y, laneWidth, HEAD + 6, 5, 5, "F");
      doc.setFillColor(...(lane.tone ? STATUS_TONE_RGB[lane.tone] : ZINC_300));
      doc.circle(x + PAD + 2.5, sheet.y + HEAD / 2 + 1, 2.5, "F");
      sheet.font(7.5, "bold", NAVY);
      const count = String(lane.cards.length);
      const countWidth = measure(doc, count);
      write(doc, count, x + laneWidth - PAD, sheet.y + HEAD / 2 + 3.5, { align: "right" });
      sheet.font(7.5, "bold", BODY);
      write(
        doc,
        ellipsize(doc, lane.label.toUpperCase(), laneWidth - PAD * 2 - 12 - countWidth),
        x + PAD + 9,
        sheet.y + HEAD / 2 + 3.5,
      );
    });
    sheet.space(HEAD);
  };

  sheet.need(HEAD + ROW);
  drawHeads();

  const rows = Math.max(1, ...lanes.map((lane) => lane.cards.length));
  for (let r = 0; r < rows; r++) {
    if (sheet.y + ROW > sheet.bottom) {
      sheet.need(ROW + HEAD + 1);
      drawHeads();
    }
    const top = sheet.y;
    lanes.forEach((lane, i) => {
      const x = laneX(i);
      const card = lane.cards[r];
      // The lane's own grey, carried down band by band; the last band of a lane
      // rounds its foot.
      const last = r === Math.max(0, lane.cards.length - 1);
      if (r < Math.max(1, lane.cards.length)) {
        doc.setFillColor(...SURFACE);
        if (last) {
          doc.roundedRect(x, top - 6, laneWidth, ROW + 6, 5, 5, "F");
        } else {
          doc.rect(x, top - 6, laneWidth, ROW + 6, "F");
        }
      }
      if (!card) {
        // An empty lane says so rather than collapsing, as on screen.
        if (r === 0) {
          sheet.font(7.5, "normal", BODY_MUTED);
          write(doc, tr("Geen modules", "No modules"), x + PAD, top + 7.5 * ASCENT + 2);
        }
        return;
      }

      const cx = x + PAD;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.roundedRect(cx, top, cardWidth, CARD, 4, 4, "FD");

      const inner = cardWidth - 14;
      // Name, with the HRM/ERP tag beside it — the board has no group headings.
      sheet.font(6.5, "bold", ZINC_400);
      const tag = card.groupLabel.toUpperCase();
      const tagWidth = measure(doc, tag);
      write(doc, tag, cx + cardWidth - 7, top + 7 + 8.5 * ASCENT, { align: "right" });
      sheet.font(8.5, "bold", NAVY);
      write(doc, ellipsize(doc, card.label, inner - tagWidth - 6), cx + 7, top + 7 + 8.5 * ASCENT);

      const detail = boardCardDetail(card, lane.label);
      if (detail) {
        sheet.font(7.5, "normal", BODY);
        write(doc, ellipsize(doc, detail, inner), cx + 7, top + 18 + 7.5 * ASCENT);
      }

      // The sidebar's completeness dot — a different question from the lane.
      doc.setFillColor(...COMPLETENESS_TONE_RGB[completenessTone(card.progress)]);
      doc.circle(cx + 9, top + 31.5, 2, "F");
      // The *Fase* in one word at the line's end, as on screen — a lane says whose
      // turn it is, not how far the module got.
      const phase = phaseTag(card);
      let phaseWidth = 0;
      if (phase) {
        sheet.font(6.5, "bold", phase.rejected ? STATUS_BAD.ink : BODY_MUTED);
        const label = phase.label.toUpperCase();
        phaseWidth = measure(doc, label) + 6;
        write(doc, label, cx + cardWidth - 7, top + 29 + 7 * ASCENT, { align: "right" });
      }
      sheet.font(7, "normal", BODY);
      write(doc, ellipsize(doc, boardCheckText(card), inner - 8 - phaseWidth), cx + 15, top + 29 + 7 * ASCENT);
    });
    sheet.y = top + ROW;
  }

  // The board's own footnote, in the screen's words.
  sheet.space(8);
  const SIZE = 7.5;
  const runs: Run[] = [
    { text: tr("Elke module staat in de kolom van de ", "Each module sits in the column of the ") },
    { text: tr("status die AFAS ervoor vastlegt", "status AFAS records for it"), bold: true },
    {
      text: tr(
        "; op de kaart staat die status in de woorden van AFAS zelf, met de taak waar de" +
          " module op wacht. Onderaan de kaart staat de laatste controle van dat bestand —" +
          " het percentage rijen dat zo naar AFAS kan en de velden die nog een fout bevatten.",
        "; the card states that status in AFAS's own words, with the task the module is" +
          " waiting on. At the foot of the card is the last check of that file — the percentage" +
          " of rows that can go to AFAS that way and the fields that still contain an error."
      ),
    },
  ];
  for (const line of wrapRuns(doc, runs, SIZE, sheet.width)) {
    sheet.need(SIZE * 1.45);
    drawRuns(doc, line, MARGIN, sheet.y + SIZE * ASCENT, SIZE, BODY);
    sheet.space(SIZE * 1.45);
  }
}

/**
 * Render the projectrapport to a PDF blob. Kept separate from the download, the same
 * split `report-pdf.ts` makes, so the layout can be produced and inspected without a
 * browser.
 */
export async function buildProjectReportPdf(report: ProjectReport): Promise<Blob> {
  const doc = await newReportDoc({
    title: tr(`Projectrapport · ${report.projectName}`, `Project report · ${report.projectName}`),
    subject: tr("Projectrapport", "Project report"),
    orientation: "landscape",
  });

  const sheet = new Sheet(doc);
  drawHero(doc, sheet, {
    kind: "Projectrapport",
    subject: report.projectName,
    lines: [generatedLine()],
  });

  drawProjectReportBody(doc, sheet, report);
  if (report.moduleCount > 0) drawProjectBoard(doc, sheet, report);

  drawFooters(doc, tr(`Projectrapport · ${report.projectName}`, `Project report · ${report.projectName}`));
  return doc.output("blob");
}

/** Build the projectrapport PDF and hand it to the browser as a download. */
export async function downloadProjectReportPdf(report: ProjectReport): Promise<void> {
  const blob = await buildProjectReportPdf(report);
  triggerDownload(
    blob,
    // Named for the project like every other file the tool writes, even though
    // this one already says so in its base name: a folder of downloads sorts by
    // number, and the projectrapport belongs with the sheets it reports on.
    downloadName(report.projectName, "pdf", tr("Projectrapport_", "Project_report_"), report.projectId)
  );
}
