/**
 * The verzendrapport as a PDF — what a send to AFAS did, record by record, in a form
 * that can leave the tool: mailed to the client whose rows AFAS refused, or filed
 * next to the sheet as the proof of what went into their environment.
 *
 * The third report on the same primitives: [`report-pdf.ts`](./report-pdf.ts)'s
 * `Sheet`, hero, footer, palette and pill, so a validatierapport, a projectrapport
 * and a verzendrapport open as one family.
 *
 * ### Refusals first, and in AFAS's own words
 *
 * The page is read for the records that did **not** land, so those come straight
 * after the figures, each with the full message AFAS gave — never paraphrased or
 * truncated, because that message is the only thing that says which field to fix.
 * The accepted records follow as a compact list with the key AFAS assigned, which is
 * what someone looks a record up by in Profit afterwards.
 *
 * Nothing is counted here that the run did not already count: every figure is a
 * field of the backend's {@link SendOutcome}, the same object the progress strip
 * and the notices read, so the screen and the paper cannot disagree.
 */

import type { jsPDF } from "jspdf";
import { formatDateTime, formatTime } from "@/lib/datetime";
import { tr } from "@/lib/i18n";
import { downloadName, triggerDownload } from "@/lib/download";
import {
  groupMissing,
  groupRefusals,
  isUnexpectedErrorGroup,
  isDeleteRun,
  refusalItemText,
  type MissingGroup,
  type RefusalGroup,
  type RefusedValue,
  type SendOutcome,
  type SendResult,
} from "@/lib/payload-send";
import {
  ASCENT,
  BODY,
  BORDER,
  drawCard,
  drawFooters,
  drawHero,
  ellipsize,
  EMERALD,
  MARGIN,
  measure,
  NAVY,
  newReportDoc,
  pill,
  RED,
  Sheet,
  STATUS_BAD,
  STATUS_GOOD,
  wrap,
  write,
  writeColumnHeadings,
  type Rgb,
} from "@/lib/report-pdf";

/** `zinc-400` — ticked but left behind, neither a success nor a refusal. */
const SKIPPED: Rgb = [154, 157, 180]; // --k-text-tertiary
/** `text-red-700`, the ink the refusals are counted in on screen. */
const RED_INK: Rgb = [176, 69, 69]; // --k-red-fg

/** What the report is about, besides the run itself. */
export interface SendReportContext {
  projectId: string;
  projectName: string;
  moduleLabel: string;
  /** The step of a multi-phase module (`Aanmaken`, `Livegang`), when it has them. */
  phaseLabel?: string | null;
  /** Per refused ordinal, what was sent for the fields AFAS named — see
   *  `refusedValues()` in `payload-send.ts`. */
  refusedValues?: Map<number, RefusedValue[]>;
  /** A heading of the user's own per refusal group, keyed by AFAS's message — for
   *  a message that names nothing (*AFAS gaf een fout terug (500).*) whose real
   *  cause was found in Profit. See `RefusalsDialog`. */
  headings?: Map<string, string>;
  /**
   * The module's records as a whole once the run is over: how many there are
   * (`total`) and how many of them AFAS now holds (`inAfas` — marked *Bestaat al*
   * or written by this run, minus what it refused). With it the figures describe
   * the sheet — *170 verstuurd* of 181 — rather than only the ten this run sent;
   * the *Verstuurd* list further down stays this run's. `null` where the panel
   * can't tell (no existence read for the run's stage), and the figures fall back
   * to the run alone.
   */
  records?: { total: number; inAfas: number } | null;
  /**
   * The runs of a module sent in **steps** (Medewerkers: *Historie*, then
   * *Actueel*), oldest step first. With two or more the report covers them all —
   * one header, then a section per step with its own figures, refusals and sent
   * records — and the run passed beside the context only names the file. Each step
   * carries its own `records` and `refusedValues`; `headings` is shared, keyed by
   * AFAS's message.
   */
  steps?: SendReportStep[] | null;
  /**
   * In a combined report, the module as a whole: its records, and how many of them
   * **every** step has in AFAS — an employee whose *Historie* went in but whose
   * *Actueel* was refused is not converted. The figure the deeltaak was stamped
   * with, in records. `null` where a step can't be measured.
   */
  complete?: { total: number; inAfas: number } | null;
}

/** One step's run in a combined verzendrapport — see `SendReportContext.steps`. */
export interface SendReportStep {
  run: SendOutcome;
  /** `Stap 1 · Historie` — the section's title. */
  label: string;
  records?: SendReportContext["records"];
  refusedValues?: Map<number, RefusedValue[]>;
}

function actionText(result: SendResult): string {
  if (result.action === "delete") return tr("verwijderd", "deleted");
  return result.action === "update" ? tr("bijgewerkt", "updated") : tr("aangemaakt", "created");
}

/** What a refused record tried to do — it was not *aangemaakt*, so not in that word. */
function attemptText(result: SendResult): string {
  if (result.action === "delete") return tr("verwijderen", "delete");
  return result.action === "update" ? tr("bijwerken", "update") : tr("aanmaken", "create");
}

/**
 * When AFAS answered on the record, `14:05:30` — the date is in the header (or the
 * step's title), and seconds tell apart the records a run answers each second.
 * Empty for a run from before the backend stamped it.
 */
function timeText(result: SendResult): string {
  if (!result.answeredAt) return "";
  const at = new Date(result.answeredAt);
  return Number.isNaN(at.getTime()) ? "" : formatTime(at, true);
}

/** The sheet row(s) the record was built from — `5`, or `5–7` for several. */
function rowsText(result: SendResult): string {
  const rows = result.rows;
  if (rows.length === 0) return "—";
  return rows.length > 1 ? `${rows[0]}–${rows[rows.length - 1]}` : String(rows[0]);
}

/** What the report calls itself: a delete run's is not a *verzend*rapport. */
function reportKind(run: SendOutcome): string {
  return isDeleteRun(run) ? tr("Verwijderrapport", "Deletion report") : tr("Verzendrapport", "Send report");
}

/**
 * The key AFAS wrote, flattened for one line: `{ KnSubject: { SbId: "12" } }` →
 * `SbId 12`. The connector name is dropped — it already has a column of its own.
 */
export function keysText(keys: SendResult["keys"]): string {
  if (!keys) return "";
  const parts: string[] = [];
  const walk = (value: unknown, name: string | null) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) walk(inner, key);
    } else if (value !== null && value !== undefined && value !== "") {
      parts.push(name ? `${name} ${String(value)}` : String(value));
    }
  };
  walk(keys, null);
  return parts.join(", ");
}

/**
 * The figures card: verstuurd, geweigerd and — only for a run that stopped early —
 * niet verstuurd, beside a meter of the same shares scaled to the run's total.
 */
/**
 * Every record that was ticked for this send — what went, plus what the panel
 * left behind (already in AFAS under *Alleen nieuwe*, or outside this phase). A
 * rerun of only the new records is "108 van 288", not "108 van 108": the report
 * is about the sheet, and the sheet had 288.
 */
function selectedCount(run: SendOutcome): number {
  return (
    run.total +
    (run.skippedExisting ?? 0) +
    (run.skippedPhase ?? 0) +
    missingCount(run)
  );
}

/** Ticked but held back because something they look up isn't in AFAS. */
function missingCount(run: SendOutcome): number {
  return run.skippedMissing?.length ?? 0;
}

/**
 * The figures the card leads with and the verdict counts against: the module's
 * records as a whole when the panel could say how many AFAS holds
 * (`context.records`), else this run's ticked set. `sent` is then everything in
 * AFAS — the total minus what isn't — not just what this run wrote.
 */
function reportTotals(
  run: SendOutcome,
  records: SendReportContext["records"],
): { sent: number; total: number; whole: boolean } {
  if (records && !isDeleteRun(run) && records.total > 0) {
    return { sent: Math.min(records.inAfas, records.total), total: records.total, whole: true };
  }
  return { sent: run.sent, total: selectedCount(run), whole: false };
}

function drawSummary(
  doc: jsPDF,
  sheet: Sheet,
  run: SendOutcome,
  records: SendReportContext["records"],
): void {
  const PAD = 12;
  const SIZE = 22;
  const totals = reportTotals(run, records);
  const unsent = Math.max(0, run.total - run.done);
  // Over the whole module the records already in AFAS are inside *Verstuurd*, and
  // a stopped run's tail is part of what is still to send — neither gets its own
  // figure then, or it would be counted twice.
  const skippedExisting = totals.whole ? 0 : (run.skippedExisting ?? 0);
  const skippedPhase = run.skippedPhase ?? 0;
  const missing = missingCount(run);
  /** Records neither in AFAS nor refused nor held back: never ticked, or not reached. */
  const toSend = totals.whole
    ? Math.max(0, totals.total - totals.sent - run.failed - missing - skippedPhase)
    : 0;
  const thisRun =
    run.updated > 0
      ? tr(
          `${run.inserted} aangemaakt, ${run.updated} bijgewerkt`,
          `${run.inserted} created, ${run.updated} updated`
        )
      : undefined;
  const figures: { figure: string; caption: string; detail?: string; ink: Rgb }[] = [
    {
      figure: String(totals.sent),
      caption: isDeleteRun(run) ? tr("Verwijderd", "Deleted") : tr("Verstuurd", "Sent"),
      detail: totals.whole
        ? tr(
            `${run.sent} in deze verzending${thisRun ? ` (${thisRun})` : ""}`,
            `${run.sent} in this send${thisRun ? ` (${thisRun})` : ""}`
          )
        : thisRun,
      ink: NAVY,
    },
    { figure: String(run.failed), caption: tr("Geweigerd", "Refused"), ink: run.failed > 0 ? RED_INK : NAVY },
  ];
  // Listed below, unlike the two skips after it: each is a record to create in AFAS.
  if (missing > 0) {
    figures.push({
      figure: String(missing),
      caption: tr("Ontbreekt in AFAS", "Missing in AFAS"),
      detail: tr("niet verstuurd", "not sent"),
      ink: RED_INK,
    });
  }
  // Counted, never listed: the records left behind are not what this report is
  // about, only part of the total it reports against.
  if (skippedExisting > 0) {
    figures.push({
      figure: String(skippedExisting),
      caption: tr("Staan al in AFAS", "Already in AFAS"),
      detail: tr("overgeslagen (Alleen nieuwe)", "skipped (New only)"),
      ink: BODY,
    });
  }
  if (skippedPhase > 0) {
    figures.push({
      figure: String(skippedPhase),
      caption: tr("Buiten deze stap", "Outside this step"),
      detail: tr("overgeslagen", "skipped"),
      ink: BODY,
    });
  }
  if (toSend > 0) {
    figures.push({
      figure: String(toSend),
      caption: tr("Nog niet verstuurd", "Not sent yet"),
      ink: BODY,
    });
  }
  if (!totals.whole && unsent > 0) {
    figures.push({
      figure: String(unsent),
      caption: isDeleteRun(run) ? tr("Niet verwijderd", "Not deleted") : tr("Niet verstuurd", "Not sent"),
      ink: BODY,
    });
  }

  const height = PAD * 2 + SIZE * 1.08 + 11 + 11 + 16;
  sheet.need(height);
  const top = sheet.y;
  drawCard(doc, sheet, top, height);

  // The share that landed, right-aligned in the card's corner — of everything
  // ticked, the same total the meter divides. Floored, so 641 of 642 reads 99%,
  // never a 100% that hides a refusal.
  const selected = totals.total;
  const SHARE_WIDTH = 90;
  if (selected > 0) {
    const share = `${Math.floor((totals.sent / selected) * 100)}%`;
    const right = MARGIN + sheet.width - 14;
    let y = top + PAD;
    sheet.font(SIZE, "bold", totals.sent === selected ? STATUS_GOOD.ink : NAVY);
    write(doc, share, right, y + SIZE * ASCENT, { align: "right" });
    y += SIZE * 1.08;
    sheet.font(9, "normal", BODY);
    write(doc, isDeleteRun(run) ? tr("verwijderd", "deleted") : tr("geïmporteerd", "imported"), right, y + 9 * ASCENT, {
      align: "right",
    });
  }

  const column = (sheet.width - 28 - SHARE_WIDTH) / Math.max(3, figures.length);
  figures.forEach((entry, i) => {
    const x = MARGIN + 14 + i * column;
    let y = top + PAD;
    sheet.font(SIZE, "bold", entry.ink);
    write(doc, entry.figure, x, y + SIZE * ASCENT);
    y += SIZE * 1.08;
    sheet.font(9, "normal", BODY);
    write(doc, entry.caption, x, y + 9 * ASCENT);
    y += 11;
    if (entry.detail) {
      sheet.font(8, "normal", BODY);
      write(doc, ellipsize(doc, entry.detail, column - 8), x, y + 8 * ASCENT);
    }
  });

  // The meter, full width along the card's foot — shares of the total, like the
  // strip on screen, so a stopped run shows its unsent tail as empty track.
  const meterX = MARGIN + 14;
  const meterWidth = sheet.width - 28;
  const meterY = top + height - PAD - 8;
  // Against everything ticked, so a rerun's skipped majority shows as grey
  // rather than stretching the refusals across the whole bar.
  const total = Math.max(totals.total, 1);
  doc.setFillColor(...BORDER);
  doc.roundedRect(meterX, meterY, meterWidth, 8, 4, 4, "F");
  let x = meterX;
  for (const [value, fill] of [
    [totals.sent, EMERALD],
    [run.failed + missing, RED],
    [skippedExisting + skippedPhase + toSend, SKIPPED],
  ] as const) {
    if (value <= 0) continue;
    const width = Math.max(4, (value / total) * meterWidth);
    doc.setFillColor(...fill);
    doc.roundedRect(x, meterY, Math.min(width, meterX + meterWidth - x), 8, 4, 4, "F");
    x += width + 2;
  }

  sheet.y = top + height + 14;
}

/**
 * A section heading with its count — `GEWEIGERD (7)`. `following` is the height of
 * what must land on the same page under it (the table's column heads and first
 * row), so a heading is never left alone at the foot of a page.
 */
function drawHeading(
  doc: jsPDF,
  sheet: Sheet,
  label: string,
  count: number,
  following = 40,
): void {
  sheet.need(21 + following);
  sheet.font(9, "bold", NAVY);
  write(doc, `${label.toUpperCase()} (${count})`, MARGIN, sheet.y + 9 * ASCENT);
  sheet.space(13).rule().space(8);
}

/** A refusal group's or missing group's size: AFAS's words at this size, in lines this tall. */
const GROUP_SIZE = 8.5;
const GROUP_LINE = GROUP_SIZE * 1.35;

/**
 * A group's heading — the message once, in red, wrapped in full, with its count
 * when there is more than one record under it. Never left alone at a page's foot:
 * it asks for room for its first row as well.
 */
function drawGroupHeading(doc: jsPDF, sheet: Sheet, message: string, items: number): void {
  sheet.font(GROUP_SIZE, "bold", RED_INK);
  const count = items > 1 ? `  (${items})` : "";
  const heading = wrap(doc, `${message}${count}`, sheet.width);
  sheet.need(heading.length * GROUP_LINE + GROUP_LINE + 4);
  for (const line of heading) {
    sheet.need(GROUP_LINE);
    sheet.font(GROUP_SIZE, "bold", RED_INK);
    write(doc, line, MARGIN, sheet.y + GROUP_SIZE * ASCENT);
    sheet.space(GROUP_LINE);
  }
}

/** How far a group's records sit in under its heading. */
const GROUP_INDENT = 14;

/**
 * One record under a group's heading, wrapped to `width` and indented, the page
 * broken before it rather than through it. Returns the top it was drawn at, for a
 * caller that sets something beside its first line.
 */
function drawGroupItem(doc: jsPDF, sheet: Sheet, text: string, width: number): number {
  sheet.font(GROUP_SIZE, "normal", NAVY);
  const lines = wrap(doc, text, width);
  sheet.need(lines.length * GROUP_LINE);
  const top = sheet.y;
  for (const line of lines) {
    write(doc, line, MARGIN + GROUP_INDENT, sheet.y + GROUP_SIZE * ASCENT);
    sheet.space(GROUP_LINE);
  }
  return top;
}

/**
 * One message AFAS refused records with, and every record it refused with it:
 *
 *     Waarde valt buiten de grenzen. Ondergrens: 500; bovengrens: 49999.  (2)
 *       Rij 5. Organisatie 101 [Opgestuurd 101]                 64DE5905…
 *       Rij 6. Organisatie 118 [Opgestuurd 118]                 7A21C0D3…
 *
 * The message once, in red, wrapped in full — AFAS's words untouched, since they
 * are what names the fix. The rows under it in navy, each with AFAS's log
 * reference in grey at the right edge, which is what AFAS support asks for. The
 * heading never ends a page on its own: it needs its first row under it.
 */
function drawRefusalGroup(
  doc: jsPDF,
  sheet: Sheet,
  group: RefusalGroup,
  own?: string,
): void {
  // What was tried, when, and AFAS's log reference, in grey at the right edge.
  // Wide enough for the whole reference — a cut one is no use to AFAS support —
  // measured once for the group rather than assumed.
  const sideText = (result: SendResult) =>
    [attemptText(result), timeText(result), result.logReference ?? ""]
      .filter(Boolean)
      .join(" · ");
  sheet.font(7, "normal", BODY);
  const refWidth = Math.max(
    0,
    ...group.items.map((item) => measure(doc, sideText(item.result))),
  );

  drawGroupHeading(doc, sheet, own ?? group.message, group.items.length);
  // A heading of our own replaces AFAS's words, never hides them: what AFAS
  // answered stays under it, small, for whoever looks the record up in Profit.
  if (own) {
    sheet.font(7.5, "normal", BODY);
    for (const line of wrap(doc, `AFAS: ${group.message}`, sheet.width)) {
      sheet.need(GROUP_LINE);
      write(doc, line, MARGIN, sheet.y + 7.5 * ASCENT);
      sheet.space(7.5 * 1.35);
    }
  }
  sheet.space(2);

  const textWidth = sheet.width - GROUP_INDENT - (refWidth > 0 ? refWidth + 16 : 0);
  for (const item of group.items) {
    const top = drawGroupItem(doc, sheet, refusalItemText(item), textWidth);
    sheet.font(7, "normal", BODY);
    write(doc, sideText(item.result), MARGIN + sheet.width, top + GROUP_SIZE * ASCENT, {
      align: "right",
    });
  }
  sheet.space(10);
}

/**
 * One missing thing and every record held back for it — laid out as a refusal
 * group, without the log reference (AFAS never saw these):
 *
 *     Debiteur bestaat niet in Balans — 38892 (test) (CON_ERP_Debiteuren)  (7)
 *       Rij 11. Project 5019 [Gezocht 5019]
 */
function drawMissingGroup(doc: jsPDF, sheet: Sheet, group: MissingGroup): void {
  drawGroupHeading(doc, sheet, group.message, group.items.length);
  sheet.space(2);
  for (const item of group.items) {
    drawGroupItem(doc, sheet, refusalItemText(item), sheet.width - GROUP_INDENT);
  }
  sheet.space(10);
}

/** Column offsets of the accepted-records table, from the left margin. */
function acceptedColumns(sheet: Sheet) {
  const row = 0;
  const title = 40;
  const key = sheet.width - 100;
  const time = key - 46;
  const action = time - 56;
  const connector = action - 100;
  return { row, title, connector, action, time, key };
}

function drawAcceptedTable(doc: jsPDF, sheet: Sheet, results: SendResult[]): void {
  const col = acceptedColumns(sheet);
  const heading = () => {
    writeColumnHeadings(doc, sheet, [
      [tr("Regel", "Row"), col.row],
      ["Record", col.title],
      ["Connector", col.connector],
      [tr("Actie", "Action"), col.action],
      [tr("Tijdstip", "Time"), col.time],
      [tr("Sleutel in AFAS", "Key in AFAS"), col.key],
    ]);
    sheet.space(13);
  };
  heading();

  const ROW = 13;
  for (const result of results) {
    if (sheet.y + ROW > sheet.bottom) {
      sheet.need(ROW + 20);
      heading();
    }
    const baseline = sheet.y + 8 * ASCENT;
    sheet.font(8, "normal", BODY);
    write(doc, ellipsize(doc, rowsText(result), col.title - col.row - 6), MARGIN + col.row, baseline);
    sheet.font(8, "bold", NAVY);
    write(doc, ellipsize(doc, result.title || tr("(leeg)", "(empty)"), col.connector - col.title - 10), MARGIN + col.title, baseline);
    sheet.font(8, "normal", BODY);
    write(doc, ellipsize(doc, result.connector, col.action - col.connector - 10), MARGIN + col.connector, baseline);
    write(doc, actionText(result), MARGIN + col.action, baseline);
    write(doc, timeText(result) || "—", MARGIN + col.time, baseline);
    write(doc, ellipsize(doc, keysText(result.keys) || "—", sheet.width - col.key), MARGIN + col.key, baseline);
    sheet.space(ROW);
  }
}

/**
 * One run's part of the report: the verdict, the figures card, then what AFAS
 * refused, what was held back and what it took. The whole report for a single run;
 * one section per step in a combined one.
 */
function drawRunBody(
  doc: jsPDF,
  sheet: Sheet,
  run: SendOutcome,
  context: Pick<SendReportContext, "records" | "refusedValues" | "headings">,
): void {
  // The verdict pill, then — for a run that stopped — why, before any figure.
  const done = isDeleteRun(run) ? tr("verwijderd", "deleted") : tr("verstuurd", "sent");
  const totals = reportTotals(run, context.records);
  /** What isn't in AFAS: over the whole module everything outside it, else this
   *  run's held-back records. */
  const notSent = totals.whole ? totals.total - totals.sent : missingCount(run);
  const verdict =
    run.status === "running"
      ? { text: tr("Nog bezig", "Still in progress"), tone: STATUS_GOOD }
      : run.status === "failed"
        ? {
            text: isDeleteRun(run)
              ? tr("Verwijderen afgebroken", "Deletion aborted")
              : tr("Verzending afgebroken", "Send aborted"),
            tone: STATUS_BAD,
          }
        : run.status === "stopped"
          ? { text: tr(`Gestopt na ${run.done} van ${run.total}`, `Stopped after ${run.done} of ${run.total}`), tone: STATUS_BAD }
        : run.failed > 0
          ? { text: tr(`${run.failed} van ${totals.total} geweigerd`, `${run.failed} of ${totals.total} refused`), tone: STATUS_BAD }
          : missingCount(run) > 0
            ? {
                text: tr(`${notSent} van ${totals.total} niet verstuurd`, `${notSent} of ${totals.total} not sent`),
                tone: STATUS_BAD,
              }
          : totals.total > totals.sent
            ? { text: `${totals.sent} ${tr("van", "of")} ${totals.total} ${done}`, tone: STATUS_GOOD }
            : { text: `${tr("Alles", "All")} ${done}`, tone: STATUS_GOOD };
  sheet.need(20);
  pill(doc, verdict.text, MARGIN, sheet.y, verdict.tone);
  sheet.space(20);
  if (run.status === "failed" && run.error) {
    sheet.font(9, "normal", RED_INK);
    sheet.paragraph(run.error, MARGIN, 9, sheet.width);
    sheet.space(6);
  }
  if (run.status === "running") {
    sheet.font(8.5, "normal", BODY);
    sheet.paragraph(
      tr(
        `Dit rapport is gemaakt terwijl de verzending nog liep: ${run.done} van ${run.total} records hadden toen antwoord van AFAS.`,
        `This report was made while the send was still running: ${run.done} of ${run.total} records had an answer from AFAS by then.`
      ),
      MARGIN,
      8.5,
      sheet.width,
    );
    sheet.space(6);
  }

  drawSummary(doc, sheet, run, context.records);

  const accepted = run.results.filter((result) => result.ok);

  // Grouped by AFAS's message, largest group first — see `groupRefusals()`. AFAS's
  // own "onverwachte fout" is left out: it is nothing a client can fix — unless
  // someone found the cause and gave it a heading of its own.
  const headings = context.headings ?? new Map<string, string>();
  const refusalGroups = groupRefusals(
    run.results,
    context.refusedValues ?? new Map(),
  ).filter((group) => headings.has(group.message) || !isUnexpectedErrorGroup(group));
  const listed = refusalGroups.reduce((sum, group) => sum + group.items.length, 0);
  if (listed > 0) {
    drawHeading(doc, sheet, tr("Geweigerd", "Refused"), listed);
    for (const group of refusalGroups) {
      drawRefusalGroup(doc, sheet, group, headings.get(group.message));
    }
    sheet.space(6);
  }
  // Right after the refusals: these did not land either, and what fixes them is
  // a record to create in AFAS before sending again.
  const missingGroups = groupMissing(run.skippedMissing ?? []);
  if (missingGroups.length > 0) {
    drawHeading(doc, sheet, tr("Niet verstuurd — ontbreekt in AFAS", "Not sent — missing in AFAS"), missingCount(run));
    for (const group of missingGroups) {
      drawMissingGroup(doc, sheet, group);
    }
    sheet.space(6);
  }
  if (accepted.length > 0) {
    drawHeading(doc, sheet, tr("Verstuurd", "Sent"), accepted.length, 13 + 13 * 3);
    drawAcceptedTable(doc, sheet, accepted);
  }
  if (run.results.length === 0 && missingGroups.length === 0) {
    sheet.font(9.5, "normal", BODY);
    sheet.paragraph(tr("AFAS heeft op geen enkel record geantwoord.", "AFAS has not answered any record."), MARGIN, 9.5, sheet.width);
  }

}

/**
 * A step's title in a combined report — `Stap 1 · Historie`, with when it ran —
 * kept on the page with the pill and the start of the figures card under it.
 */
function drawStepTitle(doc: jsPDF, sheet: Sheet, step: SendReportStep): void {
  sheet.need(13 + 12 + 20 + 60);
  sheet.font(13, "bold", NAVY);
  write(doc, step.label, MARGIN, sheet.y + 13 * ASCENT);
  sheet.space(17);
  sheet.font(8.5, "normal", BODY);
  write(
    doc,
    `${tr("Gestart", "Started")} ${formatDateTime(new Date(step.run.startedAt))}${
      step.run.finishedAt ? ` · ${tr("klaar", "done")} ${formatDateTime(new Date(step.run.finishedAt))}` : ""
    }`,
    MARGIN,
    sheet.y + 8.5 * ASCENT,
  );
  sheet.space(16);
}

/**
 * A combined report's verdict over the whole module, above the steps: how many
 * records every step has in AFAS. Each step's own figures follow in its section.
 */
function drawModuleTotal(
  doc: jsPDF,
  sheet: Sheet,
  complete: NonNullable<SendReportContext["complete"]>,
): void {
  sheet.need(13 + 20 + 20 + 12);
  sheet.font(13, "bold", NAVY);
  write(doc, tr("Totaal", "Total"), MARGIN, sheet.y + 13 * ASCENT);
  sheet.space(20);
  const whole = complete.inAfas >= complete.total;
  pill(
    doc,
    whole
      ? tr("Alles volledig verstuurd", "All fully sent")
      : tr(`${complete.inAfas} van ${complete.total} volledig verstuurd`, `${complete.inAfas} of ${complete.total} fully sent`),
    MARGIN,
    sheet.y,
    whole ? STATUS_GOOD : STATUS_BAD,
  );
  sheet.space(20);
  sheet.font(8.5, "normal", BODY);
  sheet.paragraph(
    tr(
      "Een record telt pas als elke stap het in AFAS heeft gezet. Per stap volgen de eigen aantallen, weigeringen en verstuurde records.",
      "A record only counts once every step has put it into AFAS. Each step's own counts, refusals and sent records follow."
    ),
    MARGIN,
    8.5,
    sheet.width,
  );
  sheet.space(18);
}

/** Render the verzendrapport to a PDF blob — separate from the download, so it can be
 *  produced and inspected without a browser. */
export async function buildSendReportPdf(
  run: SendOutcome,
  context: SendReportContext,
): Promise<Blob> {
  const combined = context.steps && context.steps.length > 1 ? context.steps : null;
  // A combined report is about the module, not one of its steps; its time span runs
  // from the first step's start to the last one's end.
  const subject = combined
    ? context.moduleLabel
    : context.phaseLabel
      ? `${context.moduleLabel} · ${context.phaseLabel}`
      : context.moduleLabel;
  const first = combined ? combined[0].run : run;
  const last = combined ? combined[combined.length - 1].run : run;
  const kind = reportKind(run);
  const doc = await newReportDoc({ title: `${kind} · ${subject}`, subject: kind });

  const sheet = new Sheet(doc);
  const stage = run.stage === "live" ? "live" : "test";
  drawHero(doc, sheet, {
    kind,
    subject,
    lines: [
      `${context.projectId} · ${context.projectName}`,
      // The environment names its own stage (`… — 38892 (test)`); only add it when
      // it doesn't, or the line reads `(test) (test)`.
      run.environment.toLowerCase().includes(`(${stage})`)
        ? run.environment
        : `${run.environment} (${stage})`,
      combined
        ? `${combined.length} ${tr("stappen", "steps")} · ${formatDateTime(new Date(first.startedAt))} – ${
            last.finishedAt ? formatDateTime(new Date(last.finishedAt)) : tr("bezig", "in progress")
          }`
        : `${tr("Gestart", "Started")} ${formatDateTime(new Date(run.startedAt))}${
            run.finishedAt ? ` · ${tr("klaar", "done")} ${formatDateTime(new Date(run.finishedAt))}` : ""
          }`,
    ],
  });

  const steps = context.steps && context.steps.length > 1 ? context.steps : null;
  if (steps) {
    if (context.complete) drawModuleTotal(doc, sheet, context.complete);
    steps.forEach((step, index) => {
      // Clear air above every step after the first: its title follows straight on
      // from the previous step's table otherwise.
      if (index > 0) sheet.space(18);
      drawStepTitle(doc, sheet, step);
      drawRunBody(doc, sheet, step.run, {
        records: step.records,
        refusedValues: step.refusedValues,
        headings: context.headings,
      });
    });
  } else {
    drawRunBody(doc, sheet, run, context);
  }

  drawFooters(doc, `${kind} · ${subject} · ${context.projectName}`);
  return doc.output("blob");
}

/** The name the verzendrapport carries — on a download and as a reaction's
 *  attachment alike, so the two can't be told apart. */
export function sendReportFileName(run: SendOutcome, context: SendReportContext): string {
  return downloadName(
    `${context.moduleLabel}_${run.stage}`,
    "pdf",
    `${reportKind(run)}_`,
    context.projectId,
  );
}

/** Build the verzendrapport and hand it to the browser as a download. */
export async function downloadSendReportPdf(
  run: SendOutcome,
  context: SendReportContext,
): Promise<void> {
  const blob = await buildSendReportPdf(run, context);
  triggerDownload(blob, sendReportFileName(run, context));
}
