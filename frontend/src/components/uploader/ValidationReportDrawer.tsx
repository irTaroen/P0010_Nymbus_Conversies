"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, FileDown, Loader2 } from "lucide-react";
import Drawer, { DrawerCloseButton } from "@/components/Drawer";
import { AmberNotice, MissingColumnsNotice } from "@/components/uploader/Notices";
import {
  rowRangeSegments,
  type ReportMessage,
  type ValidationReport,
} from "@/lib/validation/report";
import {
  errorCountText,
  fieldMetricText,
  meterLabel,
  omvangText,
  rowMetricText,
  rowSegments,
  type RowSegmentId,
} from "@/lib/validation/metrics";
import { downloadReportPdf } from "@/lib/report-pdf";
import { usePdfDownload } from "@/components/usePdfDownload";
import { useT } from "@/lib/i18n";

/** Row segments shown per message before the list folds into a "+N" button. */
const MAX_SEGMENTS = 20;

/** Compact raised pill, per nymbus-styling.md §10.1 — used for the header's PDF action. */
const HEADER_BTN =
  "neu-button inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium disabled:cursor-wait";

/**
 * The meter's fill per row state — status colours, not series colours: green means
 * "may go to AFAS", red means "blocks the upload". The states themselves, their
 * labels and their counts come from `validation/metrics.ts`; only the paint is a
 * screen concern (the PDF maps the same ids to RGB).
 */
const SEGMENT_FILL: Record<RowSegmentId, string> = {
  clean: "bg-k-green-fg",
  error: "bg-k-red-fg",
};

/**
 * A column's error count: an inset pill in the red semantic pair, the same recipe and
 * silhouette as [`ProjectStatusPill`](../ProjectStatusPill.tsx), because both are the
 * verdict at the end of a row. Badges are `rounded-full` and sit inset, no border.
 */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-k-red-bg px-2 py-0.5 text-[11px] font-semibold text-k-red-fg shadow-inset-sm">
      {children}
    </span>
  );
}

/**
 * {@link Pill}'s amber twin, for a column's automatic corrections — the colour a
 * corrected cell has in the table (a notice: noted, not wrong). Same recipe, so the
 * two badges share a silhouette at the end of a column's row.
 */
function NoticePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-k-amber-bg px-2 py-0.5 text-[11px] font-semibold text-k-amber-fg shadow-inset-sm">
      {children}
    </span>
  );
}

/** How a column card marks its lines — errors and corrections differ only here. */
const TONES = {
  error: {
    Icon: AlertCircle,
    iconClass: "text-k-red-fg",
    srLabel: { nl: "Fout: ", en: "Error: " },
  },
  autofix: {
    Icon: CheckCircle2,
    iconClass: "text-k-amber-fg",
    srLabel: { nl: "Automatisch aangepast: ", en: "Automatically corrected: " },
  },
} as const;

/**
 * One column in the report: its letter and name with a badge, then a line per
 * distinct message with the rows it lands on, folding a long row list behind a
 * "+N meer". Shared by the errors and the automatic corrections, so a column reads
 * the same in both lists — the PDF draws both through one routine for the same
 * reason (`drawColumnBlock` in report-pdf.ts).
 */
function ColumnCard({
  index,
  letter,
  header,
  badge,
  messages,
  tone,
  expanded,
  onExpand,
}: {
  index: number;
  letter: string;
  header: string;
  badge: React.ReactNode;
  messages: ReportMessage[];
  tone: keyof typeof TONES;
  expanded: Set<string>;
  onExpand: (key: string) => void;
}) {
  const { Icon, iconClass, srLabel } = TONES[tone];
  const t = useT();
  return (
    <li className="rounded-xl bg-k-bg px-3 py-2.5 shadow-raised-sm">
      <div className="flex items-baseline justify-between gap-2">
        {/* The Excel column letter leads, so the reader can jump
            straight to that column in the file. */}
        <span className="min-w-0 truncate font-medium text-k-text-primary">
          <span className="font-mono text-xs font-semibold text-k-text-secondary">[{letter}]</span>{" "}
          {header}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">{badge}</span>
      </div>
      <ul className="mt-2.5 space-y-2.5">
        {messages.map((m) => {
          // The tone is part of the key: the same column can be listed under both
          // the errors and the corrections, and their folds are separate.
          const key = `${tone}:${index}:${m.message}`;
          const segments = rowRangeSegments(m.rows);
          const clipped = !expanded.has(key) && segments.length > MAX_SEGMENTS;
          const visible = clipped ? segments.slice(0, MAX_SEGMENTS) : segments;
          return (
            <li key={key} className="flex items-start gap-2">
              <Icon
                aria-hidden
                className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`}
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <p className="text-sm leading-snug text-k-text-primary">
                  {/* The icon is decorative; name what the line is for screen
                      readers so colour+icon aren't the only cue. */}
                  <span className="sr-only">{t(srLabel.nl, srLabel.en)}</span>
                  <span className="font-semibold tabular-nums">{m.rows.length}×</span>{" "}
                  {m.message}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-k-text-secondary">
                  {m.rows.length === 1 ? t("rij", "row") : t("rijen", "rows")} {visible.join(", ")}
                  {clipped && (
                    <>
                      {" … "}
                      <button
                        type="button"
                        onClick={() => onExpand(key)}
                        className="cursor-pointer font-medium text-k-cloud-deep underline decoration-k-cloud-deep/40 underline-offset-2 transition-colors hover:text-k-cloud-deep"
                      >
                        +{segments.length - MAX_SEGMENTS} {t("meer", "more")}
                      </button>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * Right slide-over with the validation report for the sheet on screen: what was
 * checked, how far the sheet got, and every issue grouped by column and then by
 * message. Purely presentational — the grouping comes from
 * `lib/validation/report.ts`, the figures and their wording from
 * `lib/validation/metrics.ts`; nothing is counted or phrased here.
 *
 * Rendered only while open (the parent mounts it conditionally), so it animates
 * in on mount, exactly like the module help drawer.
 */
export default function ValidationReportDrawer({
  report,
  onClose,
}: {
  report: ValidationReport;
  onClose: () => void;
}) {
  const t = useT();
  // Messages whose full row list the user asked for, keyed column:message.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The PDF writer is fetched on first use, so the button reports its progress.
  const [pdf, savePdf] = usePdfDownload(() => downloadReportPdf(report));

  function expand(key: string) {
    setExpanded((prev) => new Set(prev).add(key));
  }

  const rows = rowMetricText(report);
  const fields = fieldMetricText(report);
  const segments = rowSegments(report);
  // Only the segments that have rows — an empty one would still take its 2px gap.
  const meter = segments.filter((s) => s.value > 0);

  return (
    <Drawer onClose={onClose} label={t("Validatierapport", "Validation report")} width="max-w-lg">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-k-divider px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-k-text-primary">{t("Validatierapport", "Validation report")}</h2>
          <p className="mt-0.5 truncate text-sm text-k-text-secondary">
            {report.moduleLabel ? `${report.moduleLabel} · ` : ""}
            {report.fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={savePdf}
            disabled={pdf === "busy"}
            title={t("Rapport downloaden als PDF", "Download report as PDF")}
            className={HEADER_BTN}
          >
            {pdf === "busy" ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileDown className="h-4 w-4" strokeWidth={1.8} />
            )}
            {pdf === "failed" ? t("Mislukt", "Failed") : "PDF"}
          </button>
          <DrawerCloseButton onClick={onClose} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {report.stale && (
          <AmberNotice className="mb-4">
            {t(
              <>
                De gegevens zijn gewijzigd na deze controle. Klik op{" "}
                <strong>Hercontroleren</strong> voor een actueel rapport.
              </>,
              <>
                The data has changed since this check. Click{" "}
                <strong>Re-check</strong> for an up-to-date report.
              </>
            )}
          </AmberNotice>
        )}

        {/* Sheet identity — which sheet of which file this report describes. */}
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-k-text-secondary">{t("Blad", "Sheet")}</dt>
          <dd className="truncate font-medium text-k-text-primary">{report.sheetName}</dd>
          <dt className="text-k-text-secondary">{t("Omvang", "Size")}</dt>
          <dd className="font-medium text-k-text-primary">
            {omvangText(report.totalRows, report.totalColumns)}
          </dd>
        </dl>

        {/* The two metrics the report is read for, side by side and of equal
            weight: how much of the sheet AFAS would take, and how much work is
            left in the data. They answer different questions — one bad field in
            every row is nothing importable and nearly every field fine — so
            neither one stands in for the other. The rows lead, because that is
            what the sidebar badge carries; the meter below breaks them down.
            Figures and wording both come from `validation/metrics.ts`, so the
            mailed PDF says exactly what this card says. */}
        <section className="rounded-xl bg-k-bg px-4 py-4 shadow-inset-sm">
          <div className="grid grid-cols-2 gap-x-4 divide-x divide-k-divider">
            {[rows, fields].map((metric, i) => (
              <div key={metric.caption} className={i === 0 ? undefined : "pl-4"}>
                {/* Proportional figures on purpose — tabular-nums makes a
                    standalone number at this size look loose. */}
                <div className="text-4xl font-bold leading-none tracking-tight text-k-text-primary">
                  {metric.figure}
                </div>
                <p className="mt-1.5 text-sm leading-snug text-k-text-secondary">{metric.caption}</p>
                {metric.detail && (
                  <p className="mt-1 text-xs tabular-nums text-k-text-secondary">{metric.detail}</p>
                )}
              </div>
            ))}
          </div>

          {report.errorCount === 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-k-green-bg px-3 py-1 text-sm font-semibold text-k-green-fg shadow-inset-sm">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
              {t("Geen fouten", "No errors")}
            </p>
          )}

          {/* 2px surface gaps separate the segments — no borders on the marks. */}
          <div
            role="img"
            aria-label={meterLabel(report)}
            className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-k-bg shadow-inset-sm"
          >
            {meter.map((s) => (
              <div
                key={s.id}
                // flex-grow shares the track *minus* the gaps, so the segments
                // never add up past 100%; the floor keeps a single bad row visible.
                style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3 }}
                className={`h-full rounded-full ${SEGMENT_FILL[s.id]}`}
              />
            ))}
          </div>
          {/* The legend names every segment with its count, so the meter is
              never read by colour alone. */}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-k-text-secondary">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${SEGMENT_FILL[s.id]}`}
                />
                {s.label}
                <span className="font-semibold tabular-nums text-k-text-primary">{s.value}</span>
              </li>
            ))}
          </ul>
        </section>

        <MissingColumnsNotice columns={report.missingColumns} className="mt-4" />

        {/* Up front, as in the PDF: the file the client gets back is not entirely
            what they typed, and they should hear so before meeting a changed cell.
            The details follow the errors below. */}
        {report.autofixedCount > 0 && (
          <AmberNotice icon={CheckCircle2} className="mt-4">
            {t(
              <>
                <strong>Automatisch aangepast:</strong> de tool heeft{" "}
                {report.autofixedCount === 1 ? "1 cel" : `${report.autofixedCount} cellen`}{" "}
                gecorrigeerd waar de omschrijving uit een codetabel stond in plaats van de
                code (bijvoorbeeld &ldquo;Nederland&rdquo; in plaats van NL). Zie het
                overzicht onderaan.
              </>,
              <>
                <strong>Automatically corrected:</strong> the tool has{" "}
                {report.autofixedCount === 1 ? "1 cell" : `${report.autofixedCount} cells`}{" "}
                corrected where the description came from a code table instead of the
                code (for example &ldquo;Netherlands&rdquo; instead of NL). See the
                overview at the bottom.
              </>
            )}
          </AmberNotice>
        )}

        <h3 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-wide text-k-text-secondary">
          {report.columns.length > 0
            ? t(`Per kolom (${report.columns.length})`, `By column (${report.columns.length})`)
            : t("Per kolom", "By column")}
        </h3>

        {report.columns.length === 0 ? (
          <p className="flex items-start gap-2 rounded-xl bg-k-green-bg px-3 py-2 text-sm text-k-green-fg">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span>{t("Geen fouten gevonden in dit blad.", "No errors found on this sheet.")}</span>
          </p>
        ) : (
          <ul className="space-y-3">
            {report.columns.map((column) => (
              <ColumnCard
                key={column.index}
                index={column.index}
                letter={column.letter}
                header={column.header}
                badge={
                  column.errorCount > 0 && <Pill>{errorCountText(column.errorCount)}</Pill>
                }
                messages={column.messages}
                tone="error"
                expanded={expanded}
                onExpand={expand}
              />
            ))}
          </ul>
        )}

        {report.autofixed.length > 0 && (
          <>
            <h3 className="mt-6 mb-1 text-sm font-semibold uppercase tracking-wide text-k-text-secondary">
              {t(`Automatisch aangepast (${report.autofixed.length})`, `Automatically corrected (${report.autofixed.length})`)}
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-k-text-secondary">
              {t(
                "Deze waarden zijn door de tool vervangen door de bijbehorende code uit de codetabel. Het gedownloade bestand bevat de gecorrigeerde waarden.",
                "The tool has replaced these values with the matching code from the code table. The downloaded file contains the corrected values."
              )}
            </p>
            <ul className="space-y-3">
              {report.autofixed.map((column) => (
                <ColumnCard
                  key={column.index}
                  index={column.index}
                  letter={column.letter}
                  header={column.header}
                  badge={<NoticePill>{column.count}× {t("aangepast", "corrected")}</NoticePill>}
                  messages={column.fixes}
                  tone="autofix"
                  expanded={expanded}
                  onExpand={expand}
                />
              ))}
            </ul>
          </>
        )}

        <p className="mt-5 text-xs leading-relaxed text-k-text-secondary">
          {t(
            "Rijnummers zijn de rijnummers uit het Excel-bestand — dezelfde rijen die het gedownloade bestand markeert.",
            "Row numbers are the row numbers from the Excel file — the same rows the downloaded file marks."
          )}
        </p>
      </div>
    </Drawer>
  );
}
