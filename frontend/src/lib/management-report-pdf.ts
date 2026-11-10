/**
 * The managementrapport as a PDF — what goes up on the screen in a project managers'
 * meeting, or into their mailboxes afterwards.
 *
 * Page one is the **portfolio**: the selection's figures and meter, then one line per
 * client. Every page after that is **one client**, drawn by the projectrapport's own
 * [`drawProjectReportBody()`](./project-report-pdf.ts) under a heading naming the
 * project — so a client's page here is that client's projectrapport, not a second
 * rendering of it that could drift.
 *
 * Same primitives as both other PDFs ([`report-pdf.ts`](./report-pdf.ts)): the
 * `Sheet`, the WinAnsi-safe text helpers, the palette, the hero and the footer.
 * Nothing is counted here — every figure comes from
 * [`management-report.ts`](./management-report.ts).
 */

import type { jsPDF, TextOptionsLight } from "jspdf";
import { downloadName, triggerDownload } from "@/lib/download";
import {
  CONVERSION_TYPE_LABEL,
  intakeText,
  projectDate,
  type ManagementLine,
  type ManagementSummary,
} from "@/lib/management-report";
import { formatCheckedAt } from "@/lib/project-progress";
import { deadlineMetricText } from "@/lib/project-report";
import {
  drawProjectReportBody,
  drawSegmentLegend,
  drawSegmentMeter,
  drawTableNote,
  drawTurnLegend,
  PHASE_RGB,
} from "@/lib/project-report-pdf";
import { tr } from "@/lib/i18n";
import { countText } from "@/lib/validation/metrics";
import {
  ASCENT,
  BODY,
  columnsFromRight,
  drawCard,
  drawCardDivider,
  drawFooters,
  drawHero,
  ellipsize,
  generatedLine,
  MARGIN,
  NAVY,
  newReportDoc,
  pill,
  Sheet,
  STATUS_BAD,
  STATUS_GOOD,
  SURFACE,
  write,
  writeColumnHeadings,
} from "@/lib/report-pdf";

/** The two sizes the meter comes in here: the card's, and each overview line's. */
const METER_CARD = { gap: 1.5, minWidth: 8 };
const METER_ROW = { gap: 1.5, minWidth: 5 };

/**
 * The selection's headline card: three figures and the combined meter with its
 * legend. The same card shape the projectrapport opens with, one level up.
 */
function drawSummaryCard(doc: jsPDF, sheet: Sheet, summary: ManagementSummary): void {
  const PAD = 11;
  // Room for the *Aan zet* row under the *Fase* legend.
  const height = 82;
  sheet.need(height);
  const top = sheet.y;
  drawCard(doc, sheet, top, height);

  const ofModules = (count: number) =>
    `${count} ${tr("van", "of")} ${countText(summary.moduleCount, "module", "modules")}`;
  // The projectrapport's three figures over the whole selection. *Niet akkoord* has
  // no figure of its own here: the overview's column counts it per client, and the
  // meter beside these counts phases, as the projectrapport's does.
  const deadline = deadlineMetricText(summary);
  const figures = [
    {
      figure: `${summary.started}%`,
      caption: tr("van de modules is opgestart", "of the modules have started"),
      detail: ofModules(summary.startedCount),
    },
    {
      figure: `${summary.completion}%`,
      caption: tr("van de modules is afgerond", "of the modules are completed"),
      detail: ofModules(summary.doneCount),
    },
    {
      ...deadline,
      detail:
        summary.dueSoonCount > 0
          ? `${tr("bij", "at")} ${countText(summary.projectsDueSoon, "project", tr("projecten", "projects"))}${
              summary.overdueCount > 0 ? ` · ${summary.overdueCount} ${tr("te laat", "overdue")}` : ""
            }`
          : deadline.detail,
    },
  ];
  const figuresWidth = sheet.width * 0.62;
  const column = figuresWidth / figures.length;
  figures.forEach((f, i) => {
    const x = MARGIN + 14 + i * column;
    sheet.font(22, "bold", NAVY);
    write(doc, f.figure, x, top + PAD + 22 * ASCENT);
    sheet.font(9, "normal", BODY);
    write(doc, ellipsize(doc, f.caption, column - 14), x, top + PAD + 24 + 9 * ASCENT);
    sheet.font(8, "normal", BODY);
    write(doc, ellipsize(doc, f.detail, column - 14), x, top + PAD + 36 + 8 * ASCENT);
  });

  const meterX = MARGIN + figuresWidth + 12;
  const meterWidth = sheet.width - figuresWidth - 12 - PAD - 14;
  drawCardDivider(doc, meterX - 12, top, height, PAD);

  sheet.font(7.5, "bold", BODY);
  write(
    doc,
    `${tr("FASE", "PHASE")} · ${countText(summary.projectCount, "PROJECT", tr("PROJECTEN", "PROJECTS"))}`,
    meterX,
    top + PAD + 7.5 * ASCENT,
  );
  drawSegmentMeter(doc, meterX, top + PAD + 14, meterWidth, 8, summary.phaseSegments, PHASE_RGB, METER_CARD);
  drawSegmentLegend(doc, sheet, meterX, top + PAD + 40, summary.phaseSegments, PHASE_RGB);
  drawTurnLegend(doc, sheet, meterX, top + PAD + 53, summary);

  sheet.y = top + height + 14;
}

/**
 * The overview table's columns, from the right edge in. The project takes what the
 * fixed ones leave, the same rule `tableColumns()` in the projectrapport keeps, so
 * a change of page format can't push a column off the page.
 */
const COL_WIDTH = {
  livegang: 58,
  delivery: 62,
  progress: 110,
  client: 50,
  rejected: 58,
  errors: 92,
  checked: 78,
};
const COL_GAP = 12;

function overviewColumns(sheet: Sheet) {
  const fixed = columnsFromRight(
    sheet.width,
    [
      ["checked", COL_WIDTH.checked],
      ["errors", COL_WIDTH.errors],
      ["rejected", COL_WIDTH.rejected],
      ["client", COL_WIDTH.client],
      ["progress", COL_WIDTH.progress],
      ["delivery", COL_WIDTH.delivery],
      ["livegang", COL_WIDTH.livegang],
    ],
    COL_GAP,
  );
  return { project: 0, ...fixed };
}

function drawOverviewHeadings(doc: jsPDF, sheet: Sheet): void {
  const col = overviewColumns(sheet);
  sheet.need(16);
  writeColumnHeadings(doc, sheet, [
    ["Project", col.project],
    [tr("Livegang", "Go-live"), col.livegang + COL_WIDTH.livegang, "right"],
    [tr("Opleverdatum", "Delivery date"), col.delivery + COL_WIDTH.delivery, "right"],
    [tr("Afgerond", "Completed"), col.progress],
    [tr("Bij klant", "With client"), col.client + COL_WIDTH.client, "right"],
    [tr("Niet akkoord", "Not approved"), col.rejected + COL_WIDTH.rejected, "right"],
    [tr("Fouten", "Errors"), col.errors],
    [tr("Laatste controle", "Last check"), col.checked + COL_WIDTH.checked, "right"],
  ]);
  sheet.space(13).rule().space(3);
}

/** One client on the overview: two lines, the name over its number, type and status. */
function drawOverviewRow(doc: jsPDF, sheet: Sheet, line: ManagementLine): void {
  const col = overviewColumns(sheet);
  const ROW = 25;
  if (sheet.y + ROW > sheet.bottom) {
    sheet.need(ROW);
    drawOverviewHeadings(doc, sheet);
  }
  const top = sheet.y;
  const baseline = top + 9 + 8.5 * ASCENT - 4;
  const sub = baseline + 10;
  const right: TextOptionsLight = { align: "right" };
  const { project, report } = line;

  sheet.font(8.5, "bold", NAVY);
  write(doc, ellipsize(doc, project.name, col.livegang - COL_GAP), MARGIN, baseline);
  sheet.font(7, "normal", BODY);
  const meta = [
    project.id,
    CONVERSION_TYPE_LABEL[project.conversionType],
    project.status,
    project.hasDossier ? countText(report.moduleCount, "module", "modules") : tr("geen modules", "no modules"),
  ]
    .filter(Boolean)
    .join(" · ");
  write(doc, ellipsize(doc, meta, col.livegang - COL_GAP), MARGIN, sub);

  sheet.font(7.5, "normal", BODY);
  write(doc, projectDate(project.livegangDatum) ?? "—", MARGIN + col.livegang + COL_WIDTH.livegang, baseline, right);
  write(doc, report.delivery?.text ?? "—", MARGIN + col.delivery + COL_WIDTH.delivery, baseline, right);

  if (report.moduleCount > 0) {
    drawSegmentMeter(doc, MARGIN + col.progress, baseline - 5, 64, 5, report.phaseSegments, PHASE_RGB, METER_ROW);
    sheet.font(8, "bold", NAVY);
    write(doc, `${report.completion}%`, MARGIN + col.progress + COL_WIDTH.progress, baseline, right);
    sheet.font(7, "normal", BODY);
    write(doc, `${report.doneCount} van ${report.moduleCount}`, MARGIN + col.progress, sub);
  } else {
    sheet.font(8, "normal", BODY);
    write(doc, "—", MARGIN + col.progress, baseline);
  }

  // *Aan zet* — the client's open modules, rejected ones included, as on screen.
  sheet.font(8, "bold", line.byTurn.client > 0 ? NAVY : BODY);
  write(doc, String(line.byTurn.client), MARGIN + col.client + COL_WIDTH.client, baseline, right);
  sheet.font(8, "bold", line.byTone.rejected > 0 ? STATUS_BAD.ink : BODY);
  write(doc, String(line.byTone.rejected), MARGIN + col.rejected + COL_WIDTH.rejected, baseline, right);

  if (line.errorRows === null && line.sentCount > 0) {
    // Every module with a figure has been sent: AFAS's refusals are the errors left.
    sheet.font(7.5, "bold", NAVY);
    const text =
      line.refusedRows === 0
        ? tr("Alles in AFAS", "All in AFAS")
        : `${countText(line.refusedRows, tr("rij", "row"), tr("rijen", "rows"))} ${tr("geweigerd", "refused")}`;
    pill(doc, ellipsize(doc, text, COL_WIDTH.errors - 12), MARGIN + col.errors, baseline - 9.2, line.refusedRows === 0 ? STATUS_GOOD : STATUS_BAD);
  } else if (line.errorRows === null) {
    sheet.font(7.5, "normal", BODY);
    write(doc, report.moduleCount > 0 ? tr("Niet gecontroleerd", "Not checked") : "—", MARGIN + col.errors, baseline);
  } else {
    sheet.font(7.5, "bold", NAVY);
    const text =
      line.errorRows === 0
        ? tr("Geen fouten", "No errors")
        : countText(line.errorRows, tr("rij", "row"), tr("rijen", "rows"));
    pill(doc, ellipsize(doc, text, COL_WIDTH.errors - 12), MARGIN + col.errors, baseline - 9.2, line.errorRows === 0 ? STATUS_GOOD : STATUS_BAD);
    if (line.modulesWithErrors > 0) {
      sheet.font(7, "normal", BODY);
      write(doc, `in ${countText(line.modulesWithErrors, "module", "modules")}`, MARGIN + col.errors, sub + 1.5);
    }
  }
  // AFAS's refusals sit under the check's figure rather than in it — a different
  // finding. Only when there are any, and only where the line has room left.
  if (line.errorRows !== null && line.refusedRows > 0 && line.modulesWithErrors === 0) {
    sheet.font(7, "normal", STATUS_BAD.ink);
    write(
      doc,
      ellipsize(doc, `${countText(line.refusedRows, tr("rij", "row"), tr("rijen", "rows"))} ${tr("geweigerd door AFAS", "refused by AFAS")}`, COL_WIDTH.errors),
      MARGIN + col.errors,
      sub + 1.5,
    );
  }

  sheet.font(7.5, "normal", BODY);
  write(
    doc,
    line.lastCheckedAt ? formatCheckedAt(line.lastCheckedAt) : "—",
    MARGIN + col.checked + COL_WIDTH.checked,
    baseline,
    right,
  );

  sheet.y = top + ROW;
  doc.setDrawColor(...SURFACE);
  doc.line(MARGIN, sheet.y - 1, MARGIN + sheet.width, sheet.y - 1);
}

/**
 * A client page's heading: the project, then everything AFAS says about it. Without
 * its name (`name: false`) when the hero above already carries it — the one-client PDF.
 */
function drawProjectHeading(
  doc: jsPDF,
  sheet: Sheet,
  line: ManagementLine,
  { name = true }: { name?: boolean } = {},
): void {
  const { project } = line;
  if (name) {
    sheet.font(14, "bold", NAVY);
    write(doc, ellipsize(doc, project.name, sheet.width), MARGIN, sheet.y + 14 * ASCENT);
    sheet.space(19);
  }
  const facts = [
    project.id,
    CONVERSION_TYPE_LABEL[project.conversionType],
    project.status && `${tr("status", "status")} ${project.status}`,
    projectDate(project.livegangDatum) && `${tr("livegang", "go-live")} ${projectDate(project.livegangDatum)}`,
    projectDate(project.appreoTestdatum) && `Appreo-test ${projectDate(project.appreoTestdatum)}`,
    line.report.delivery && `${tr("opleverdatum", "delivery date")} ${line.report.delivery.text}`,
    project.hrmPeriodetabel !== null && `${tr("periodetabel", "period table")} ${project.hrmPeriodetabel}`,
    // Here rather than in the overview table, which has no width left for a column.
    // "intake ingepland 20-10-2026", "intake nog niet ingepland": the label without
    // its own leading "Intake", lowercased like the facts beside it.
    intakeText(line.intake) &&
      `intake ${intakeText(line.intake)!.replace(/^Intake /, "").toLowerCase()}`,
  ].filter(Boolean) as string[];
  sheet.font(8.5, "normal", BODY);
  write(doc, ellipsize(doc, facts.join(" · "), sheet.width), MARGIN, sheet.y + 8.5 * ASCENT);
  sheet.space(14).rule().space(10);
}

/** Render the managementrapport to a PDF blob — separate from the download, like the other two. */
export async function buildManagementReportPdf(summary: ManagementSummary): Promise<Blob> {
  const doc = await newReportDoc({
    title: tr("Managementrapport", "Management report"),
    subject: tr("Managementrapport", "Management report"),
    orientation: "landscape",
  });

  const sheet = new Sheet(doc);
  drawHero(doc, sheet, {
    kind: tr("Managementrapport", "Management report"),
    subject: countText(summary.projectCount, "project", tr("projecten", "projects")),
    lines: [generatedLine()],
  });
  drawSummaryCard(doc, sheet, summary);
  drawOverviewHeadings(doc, sheet);
  for (const line of summary.lines) drawOverviewRow(doc, sheet, line);

  summary.lines.forEach((line, i) => {
    doc.addPage();
    sheet.y = MARGIN;
    drawProjectHeading(doc, sheet, line);
    // The column note once, on the last client's page, rather than on every one.
    drawProjectReportBody(doc, sheet, line.report, { note: false });
    if (i === summary.lines.length - 1 && line.report.moduleCount > 0) drawTableNote(doc, sheet);
  });

  drawFooters(doc, `${tr("Managementrapport", "Management report")} · ${countText(summary.projectCount, "project", tr("projecten", "projects"))}`);
  return doc.output("blob");
}

/** Build the managementrapport PDF and hand it to the browser as a download. */
export async function downloadManagementReportPdf(summary: ManagementSummary): Promise<void> {
  const blob = await buildManagementReportPdf(summary);
  triggerDownload(blob, downloadName(tr("Managementrapport", "Management_report"), "pdf"));
}

/**
 * One client on its own — the client block of the page as a PDF: the managementrapport's
 * client page under a hero naming that client, so it can be mailed without the rest
 * of the selection. Same drawing as the full report's per-client pages.
 */
export async function buildManagementProjectPdf(line: ManagementLine): Promise<Blob> {
  const { project } = line;
  const doc = await newReportDoc({
    title: `${tr("Managementrapport", "Management report")} · ${project.name}`,
    subject: tr("Managementrapport", "Management report"),
    orientation: "landscape",
  });

  const sheet = new Sheet(doc);
  drawHero(doc, sheet, {
    kind: tr("Managementrapport", "Management report"),
    subject: project.name,
    lines: [generatedLine()],
  });
  drawProjectHeading(doc, sheet, line, { name: false });
  drawProjectReportBody(doc, sheet, line.report);

  drawFooters(doc, `${tr("Managementrapport", "Management report")} · ${project.name}`);
  return doc.output("blob");
}

/** Build one client's managementrapport PDF and hand it to the browser as a download. */
export async function downloadManagementProjectPdf(line: ManagementLine): Promise<void> {
  const blob = await buildManagementProjectPdf(line);
  triggerDownload(
    blob,
    downloadName(line.project.name, "pdf", `${tr("Managementrapport", "Management_report")}_`, line.project.id),
  );
}
