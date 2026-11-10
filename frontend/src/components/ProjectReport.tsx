"use client";

import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Columns3,
  FileDown,
  List,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useModule } from "@/components/ModuleProvider";
import { useProgress } from "@/components/ProgressProvider";
import { useProject } from "@/components/ProjectProvider";
import ModuleReportTable from "@/components/ModuleReportTable";
import PhaseTurnLegend from "@/components/PhaseTurnLegend";
import ProjectReportBoard from "@/components/ProjectReportBoard";
import { useT } from "@/lib/i18n";
import { PHASE_FILL } from "@/lib/modules";
import { downloadProjectReportPdf } from "@/lib/project-report-pdf";
import {
  buildProjectReport,
  completionMetricText,
  deadlineMetricText,
  deliveryNote,
  segmentsLabel,
  sendRefusalLines,
  startedMetricText,
  type ProjectDelivery,
} from "@/lib/project-report";
import SendRefusals from "@/components/SendRefusals";
import { usePdfDownload } from "@/components/usePdfDownload";
import { countText } from "@/lib/validation/metrics";

/** Quiet neutral pill, per design-system.md — the same class string
 * `ValidationReportDrawer`'s header PDF button uses. Duplicated rather than shared:
 * it is a class string, not a behavioral component, and the two buttons live in
 * different files for unrelated reports. */
const HEADER_BTN =
  "neu-button inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 pointer-coarse:h-11 text-[13px] font-medium disabled:cursor-wait";

/**
 * Which layout the modules are shown in. Component state, not the URL: the URL says
 * *where you are* (see architecture.md#routing), and this is how you happen to be
 * looking at it — a preference worth nothing to anyone the link is sent to.
 */
type ModuleView = "list" | "board";

const VIEWS = [
  {
    id: "list",
    label: "Lijst",
    labelEn: "List",
    icon: List,
    hint: "Lijst — elke module op een rij, met haar cijfers naast elkaar",
    hintEn: "List — each module on a row, with its figures side by side",
  },
  {
    id: "board",
    label: "Bord",
    labelEn: "Board",
    icon: Columns3,
    hint: "Bord — de modules in kolommen, gegroepeerd op hun status in AFAS",
    hintEn: "Board — the modules in columns, grouped by their status in AFAS",
  },
] as const satisfies readonly {
  id: ModuleView;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  hint: string;
  hintEn: string;
}[];

/**
 * Lijst / Bord, top-right of the card — the same segmented control the AFAS explorer
 * switches its three views with, so a view switch looks the same wherever the app
 * offers one: one inset track holding the options, the active one raised in the
 * accent, the others quiet text that only darkens on hover.
 *
 * Both options keep their word beside the icon. This card is the client's page as much
 * as ours, and a pair of bare icons asks them to work out which of two pictures they
 * are currently looking at; the icon is what makes the word findable at a glance, not
 * a replacement for it.
 */
function ViewToggle({
  view,
  onChange,
}: {
  view: ModuleView;
  onChange: (view: ModuleView) => void;
}) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("Weergave van de modules", "Module view")}
      className="flex h-9 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm pointer-coarse:h-11"
    >
      {VIEWS.map(({ id, label, labelEn, icon: Icon, hint, hintEn }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={active}
            title={t(hint, hintEn)}
            className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-[box-shadow,color] duration-200 pointer-coarse:h-10 ${
              active ? "bg-k-bg text-k-cloud-deep shadow-raised-xs" : "text-k-text-tertiary hover:text-k-text-primary"
            }`}
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {t(label, labelEn)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The project's opleverdatum, in the card's header.
 *
 * Quiet on purpose. It is a *fact about* the project, not one of the figures the
 * report is read for, so it takes the muted treatment the row dates take
 * ({@link DATE_CELL}) rather than the weight of the metrics below — a date at
 * their size would read as a third headline figure and compete with the percentage
 * the page leads on.
 *
 * The note beside it appears only when the modules disagree or some carry no date
 * (see `deliveryNote()`), and the whole sentence is the element's `title`, so the
 * qualifier stays reachable on a narrow screen where it is clipped.
 */
function DeliveryDate({ delivery }: { delivery: ProjectDelivery }) {
  const t = useT();
  const note = deliveryNote(delivery);
  return (
    <p
      className="flex min-w-0 items-baseline gap-1.5 text-xs text-k-text-secondary"
      title={
        note
          ? t(`Opleverdatum ${delivery.text} — ${note}`, `Delivery date ${delivery.text} — ${note}`)
          : t(`Opleverdatum ${delivery.text}`, `Delivery date ${delivery.text}`)
      }
    >
      {/* `self-center` because the icon is a box, not a glyph: sitting on the
          baseline the text shares, it hangs a hair low. */}
      <CalendarDays className="h-3.5 w-3.5 shrink-0 self-center text-k-text-tertiary" strokeWidth={1.8} />
      <span className="shrink-0 font-medium tabular-nums text-k-text-primary">{delivery.text}</span>
      {note && <span className="truncate">{note}</span>}
    </p>
  );
}

/**
 * The project on one page: where the conversion stands and how each module is doing.
 *
 * It sits at the top of the project's own page, above the dropzone, so opening a
 * project answers "how far are we" before asking for a file. Purely presentational —
 * the shape and every figure come from
 * [`lib/project-report.ts`](../lib/project-report.ts), which sums what
 * `sheetMetrics()` already counted; nothing is counted or worded here.
 *
 * Not admin-only: it carries no more than the sidebar's dots and badges already do,
 * gathered into one place, and "how far is my conversion" is the client's own
 * question. The **validatierapport** stays the admin's, because that one is about a
 * sheet the client has their own copy of (see design-system.md).
 */
export default function ProjectReport() {
  const { groups, statuses, status } = useModule();
  const { byModule } = useProgress();
  const { selectedProject, selectedProjectId } = useProject();
  const t = useT();
  const [view, setView] = useState<ModuleView>("list");
  const [showRefusals, setShowRefusals] = useState(false);
  const report = buildProjectReport({
    projectId: selectedProjectId,
    projectName: selectedProject.name,
    groups,
    statuses,
    progress: byModule,
  });

  // The PDF writer is fetched on first use, so the button reports its progress.
  const [pdf, savePdf] = usePdfDownload(() => downloadProjectReportPdf(report));

  const metrics = [
    startedMetricText(report),
    completionMetricText(report),
    deadlineMetricText(report),
  ];
  // Only the segments that have modules — an empty one still takes its 2px gap.
  const meter = report.phaseSegments.filter((s) => s.value > 0);
  // What AFAS refused at the last send, folded behind a header button: it is detail
  // for whoever fixes the sheet, and under the table it pushed the modules aside.
  const refusalLines = sendRefusalLines(report);
  const refusedRows = refusalLines.reduce((sum, line) => sum + line.failedRows, 0);

  return (
    <section
      className={`flex min-h-0 w-full flex-col rounded-2xl bg-k-bg shadow-raised max-lg:shrink-0 ${
        // A floor for a short screen: below it the page scrolls rather than squeezing
        // the module list to a sliver. Under one module's worth of card, so a small
        // project's card is never stretched past its rows.
        report.moduleCount > 0 ? "min-h-80" : ""
      }`}
      // Below `lg` the card is as tall as its contents and the page scrolls instead
      // (`shrink-0`): on a phone the hero and the figures already fill the screen,
      // and the modules would be left a sliver of a window to scroll in.
    >
      {/* Which project this is stays off the card: the sidebar names it two
          centimetres to the left, and on screen that is enough. It belongs on the
          PDF, which is read away from all of this. The width the name would have
          taken goes to the view switch, which is the one control this card has. */}
      {/* Wraps on a phone: the buttons go under the heading rather than over it. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-3 px-5 py-4">
        {/* The heading and, beside it, **when this project is due** — the one figure
            on the card that is a date rather than a count.

            It sits in the header rather than among the metrics below because it is
            not a measurement: those count modules (the third, how many are nearing
            their date), and a date is not counted. It is also the only place the
            opleverdatum survives a narrow viewport — the table's own column is the
            first to drop, at `lg` (see `COL`), and on a phone the tooltip that
            replaces it cannot be hovered at all. */}
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-base font-semibold text-k-text-primary">{t("Projectrapport", "Project report")}</h2>
          {report.delivery && <DeliveryDate delivery={report.delivery} />}
        </div>
        {/* No switch, and nothing to mail, over a card with nothing to lay out — a
            project with no modules has one message to show, and it reads the same
            in either view. */}
        {report.moduleCount > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            {refusalLines.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRefusals((open) => !open)}
                data-active={showRefusals}
                aria-expanded={showRefusals}
                aria-controls="send-refusals"
                title={t(
                  `Geweigerd door AFAS — ${countText(refusedRows, "rij", "rijen")} niet in AFAS bij de laatste verzending`,
                  `Refused by AFAS — ${countText(refusedRows, "row", "rows")} not in AFAS at the last send`
                )}
                className={`${HEADER_BTN} text-k-red-fg! hover:text-k-red-fg!`}
              >
                <AlertCircle className="h-4 w-4 text-k-red-fg" strokeWidth={1.8} />
                {t("Geweigerd", "Refused")}
                <ChevronDown
                  aria-hidden
                  className={`h-3.5 w-3.5 transition-transform ${showRefusals ? "rotate-180" : ""}`}
                  strokeWidth={1.8}
                />
              </button>
            )}
            <button
              type="button"
              onClick={savePdf}
              disabled={pdf === "busy"}
              title={t("Projectrapport downloaden als PDF", "Download project report as PDF")}
              className={HEADER_BTN}
            >
              {pdf === "busy" ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <FileDown className="h-4 w-4" strokeWidth={1.8} />
              )}
              {pdf === "failed" ? t("Mislukt", "Failed") : "PDF"}
            </button>
            <ViewToggle view={view} onChange={setView} />
          </div>
        )}
      </div>

      {/* Opens under the button that asked for it, in either view. Capped and
          scrolling on its own, so a long list never pushes the modules off the card. */}
      {showRefusals && report.moduleCount > 0 && (
        <SendRefusals
          report={report}
          id="send-refusals"
          className="max-h-64 shrink-0 overflow-y-auto overscroll-contain border-t border-k-divider px-5 py-3"
        />
      )}

      {/* The three figures the page is read for, side by side and of equal weight:
          how many modules have started, how many AFAS calls done, and how many are
          nearing their opleverdatum. All three are AFAS's workflow; how clean each
          sheet is stays on its row in the table. */}
      <div className="shrink-0 border-t border-k-divider px-5 py-4">
        {/* Three columns from `sm`; under it three rows, each figure beside its
            caption — a third of a phone fits "86%" but wraps the caption to four lines. */}
        <div className="grid gap-x-4 divide-k-divider max-sm:gap-y-3 max-sm:divide-y sm:grid-cols-3 sm:divide-x">
          {metrics.map((metric, i) => (
            <div
              key={i}
              className={`max-sm:flex max-sm:items-center max-sm:gap-4 ${i === 0 ? "" : "sm:pl-4 max-sm:pt-3"}`}
            >
              {/* Proportional, like the drawer's: tabular-nums makes a standalone
                  figure at this size look loose. */}
              <div className="text-3xl font-bold leading-none tracking-tight text-k-text-primary max-sm:w-20 max-sm:shrink-0 max-sm:text-2xl">
                {metric.figure}
              </div>
              <div className="min-w-0">
                <p className="mt-1.5 text-sm leading-snug text-k-text-secondary max-sm:mt-0">{metric.caption}</p>
                {metric.detail && (
                  <p className="mt-1 text-xs tabular-nums text-k-text-secondary">{metric.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {meter.length > 0 && (
          <>
            {/* The **Fase** meter: how far the modules got — validated, imported in
                test, imported in live, done — rather than whose turn it is. That was
                what this bar showed, and beside *0% afgerond* a project full of
                modules at 100% read as though it were nearly through; whose turn it
                is stays on each row (*Status in AFAS*) and in the board's lanes.
                2px surface gaps separate the segments — no borders on the marks. */}
            <div
              role="img"
              aria-label={t(`Fase: ${segmentsLabel(report.phaseSegments)}`, `Phase: ${segmentsLabel(report.phaseSegments)}`)}
              className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-k-bg shadow-inset-sm"
            >
              {meter.map((s) => (
                <div
                  key={s.id}
                  // flex-grow shares the track *minus* the gaps, so the segments
                  // never add up past 100%; the floor keeps a single module visible.
                  style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3 }}
                  className={`h-full rounded-full ${PHASE_FILL[s.id]}`}
                />
              ))}
            </div>
            {/* In both views: the board's lanes are the status tones and say
                nothing about the phase, and the list's rows need the *Aan zet*
                colours explained. */}
            <PhaseTurnLegend report={report} className="mt-3" />
          </>
        )}
      </div>

      {/* Per module. Same order and the same status dot as the sidebar, so the two
          read as one list — and every row is a way into that module. */}
      <div className="flex min-h-0 flex-col border-t border-k-divider px-5 pb-4 pt-3">
        {report.moduleCount === 0 ? (
          <p className="py-2 text-sm text-k-text-secondary">
            {status === "loading"
              ? t("Modules laden…", "Loading modules…")
              : status === "error"
                ? t("Modules konden niet worden geladen.", "Modules could not be loaded.")
                : t("Dit project heeft nog geen modules.", "This project has no modules yet.")}
          </p>
        ) : view === "board" ? (
          /* Same modules, same figures, laid out by where they stand instead of by
             category. Everything above this line is shared by both views: the two
             metrics and the meter are about the project, not about how its modules
             happen to be arranged. */
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <ProjectReportBoard report={report} projectId={selectedProjectId} />
          </div>
        ) : (
          <>
            {/* Scrolls on its own, header pinned, in whatever height the hero and
                the metrics leave — so they stay in view however many modules the
                project has, and the page under them never moves. A fade at the
                bottom edge, so a row cut in half reads as "there is more" — and as
                much room under the last row, so scrolled to the end it clears it. */}
            <div className="relative -mx-3 flex min-h-0 flex-col">
              <div className="min-h-0 overflow-y-auto overscroll-contain lg:pb-6">
                <ModuleReportTable report={report} projectId={selectedProjectId} stickyHeader />
              </div>
              <div
                aria-hidden="true"
                // Only where the list scrolls inside the card; below `lg` it doesn't.
                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-k-bg to-transparent max-lg:hidden"
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
