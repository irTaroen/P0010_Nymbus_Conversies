"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Filter,
  HelpCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Settings2
} from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import { useCodetabellen } from "@/components/CodetabellenProvider";
import { useFocusMode } from "@/components/FocusModeProvider";
import Metric from "@/components/uploader/Metric";
import ToolbarButton from "@/components/uploader/ToolbarButton";
import { useT } from "@/lib/i18n";
import {
  fieldMetricText,
  rowMetricText,
  type MetricText,
  type SheetMetrics
} from "@/lib/validation/metrics";

/**
 * Which of the module page's two readings of the open sheet is on screen: the grid
 * the client fills in, or the AFAS bodies that grid would produce.
 *
 * The second is admins-only and needs the module's stored mapping behind it, so it
 * isn't a view every module has — see
 * [`module-payloads.ts`](../../lib/module-payloads.ts). It lives in the URL as a
 * query parameter rather than in component state, so a payload someone is looking at
 * can be linked to and survives a refresh, the same reason the module itself is in
 * the address (docs/architecture.md#routing).
 */
export type SheetView = "data" | "payloads";

const SHEET_VIEWS: { id: SheetView; label: string }[] = [
  { id: "data", label: "Data" },
  { id: "payloads", label: "Payloads" }
];

/**
 * The bar above the grid: which sheet is on screen, how far it got, and every
 * action on it.
 *
 * **It comes with the sheet and goes with it.** It used to be there from the moment a
 * module was selected, with the four data actions greyed out and the module's last
 * stored check in place of live figures — a row of things you can't do standing over
 * a page whose only move is *upload a file*. So [`ExcelUploader`](../ExcelUploader.tsx)
 * mounts it only once there is a workbook, and everything it carried before a file
 * has a better home on the page that has no file:
 * [`ModuleStartCard`](./ModuleStartCard.tsx) holds the module's name, its help and its
 * last check, and the dropzone — which takes the height this bar gave up — is the
 * upload action. That is also why there is one shape here now and not two: `fileName`
 * is always a file's, and `metrics` always the sheet on screen's.
 *
 * **It lives in the page's left column**, a column of its own beside the grid
 * (`ExcelUploader` draws it), not as a bar over the grid: over the grid it took a
 * quarter of the height every row of the sheet wanted. It stacks its pieces in one
 * column:
 * what the sheet *is* (filename, view switch), what you can *do* to it (the icon
 * row) and how it *scored* (the figures, with the error stepping under them). The same stack serves a
 * phone, where the column becomes a band over the sheet. Every tooltip opens
 * rightwards (`leading`): from the left edge of the page a centred one would hang
 * off the screen, where this way it runs out over the table.
 * Presentational — `ExcelUploader` owns the state and hands the figures over already
 * counted, every number worded by `validation/metrics.ts`, so this bar can't disagree
 * with the report drawer or the sidebar badge.
 *
 * The counts themselves are left to the figures row and the validatierapport. There
 * were pills here for the sheet's size and its issue total, and with the metrics
 * underneath saying more about both they were three readings of one sheet in one
 * card: the size lives in the report's `Omvang`, the issue total in its tiles.
 *
 * The validatierapport isn't a button of its own in the row: it opens from
 * **Instellingen** ([`SheetSettings`](./SheetSettings.tsx)), a button shown to
 * admins (and so developers) only.
 *
 * It reads a little for itself (the codetabellen, focus mode), which is why it
 * isn't *purely* presentational: neither is state about the sheet.
 */
export default function SheetToolbar({
  moduleLabel,
  fileName,
  metrics,
  stale,
  errorRowCount,
  errorCellCount,
  errorPosition,
  onPrevError,
  onNextError,
  filterErrors,
  saveReady,
  onRecheck,
  onSave,
  onUpload,
  onToggleFilter,
  onConfig,
  onHelp,
  view,
  onViewChange,
  activity = null,
  payloadMetrics = null,
  className = ""
}: {
  /** The module the bar describes — the committed one, since data is shown. */
  moduleLabel: string;
  /** The loaded file. There is always one: the bar comes with the sheet. */
  fileName: string;
  /** Validation has run on the sheet on screen — what the report needs. */
  hasResult: boolean;
  /** Live figures for the sheet on screen. */
  metrics: SheetMetrics | null;
  /** Cells were edited after the run `metrics` describes. */
  stale: boolean;
  /** Rows the errors-only filter would show. */
  errorRowCount: number;
  /** Flagged cells the vorige/volgende buttons walk through. */
  errorCellCount: number;
  /** Which of those the last jump landed on (0-based), `null` before one. */
  errorPosition: number | null;
  onPrevError: () => void;
  onNextError: () => void;
  /** The filter is on *and* biting. */
  filterErrors: boolean;
  /** Nudge the save button — checked, clean, unsaved edits. */
  saveReady: boolean;
  onRecheck: () => void;
  onSave: () => void;
  onUpload: () => void;
  onToggleFilter: () => void;
  onConfig: () => void;
  onHelp: () => void;
  /** Which of the two views the page is on — `null` when this module has no
   *  payload view at all, in which case the switch doesn't render. */
  view: SheetView | null;
  onViewChange: (view: SheetView) => void;
  /** Background work on the page (*Bestaande records … opzoeken…*), shown in the
   *  lead figure's detail line with a spinner — a place that is always there, so
   *  it appearing and going never moves the content under it. */
  activity?: string | null;
  /** The payload view's record counts (`ModulePayloadPanel`'s `onMetrics`) —
   *  shown instead of the validation's figures while that view is open. Always
   *  two, like those, so the swap happens in the same two slots. */
  payloadMetrics?: MetricText[] | null;
  className?: string;
}) {
  // The sheet on screen, in the two figures the validatierapport leads with. A
  // committed sheet is always validated, so this is really always both; the empty
  // case is the frame between the two, not a state worth wording.
  // In the payload view the bar carries that view's counts instead: the records
  // ticked, already in AFAS and kept out by errors — what a send will do, where
  // the validation's *100%* only says the cells are filled in right.
  const t = useT();
  const payloadView = view === "payloads" && payloadMetrics !== null;
  const shown: MetricText[] =
    payloadView && payloadMetrics
      ? payloadMetrics
      : metrics
        ? [rowMetricText(metrics), fieldMetricText(metrics)]
        : [];

  // Which of this module's AFAS reference lists nobody could serve. Read here
  // rather than passed in: it is not
  // state about the sheet, and the sheet's owner has no part in it.
  const { unresolved } = useCodetabellen();

  // The second thing this bar reads for itself, and for the same reason as
  // the codetabellen above: how wide the page is isn't state about the sheet, and
  // threading it down as a prop pair would make `ExcelUploader` a relay for
  // something it has no opinion about.
  const { focused, toggleFocus } = useFocusMode();

  // Step through the flagged cells one by one, or narrow the grid to the rows
  // that hold them — on the line of the second figure. Greyed rather than hidden on
  // a clean sheet: a sheet with nothing to step through is good news, not a reason
  // for the column to change shape. Kept in the payload view for the same reason —
  // a jump from there lands on the cell in the Data view (`goToError` switches).
  const errorStepping = (
    <div className="flex shrink-0 items-center gap-1">
      <ToolbarButton
        label={
          errorCellCount === 0
            ? t("Geen velden met fouten", "No fields with errors")
            : errorPosition !== null
              ? t(
                  `Vorige fout (${errorPosition + 1} van ${errorCellCount})`,
                  `Previous error (${errorPosition + 1} of ${errorCellCount})`,
                )
              : t("Vorige fout", "Previous error")
        }
        onClick={onPrevError}
        disabled={errorCellCount === 0}
        leading
      >
        <ChevronLeft className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton
        label={
          errorCellCount === 0
            ? t("Geen velden met fouten", "No fields with errors")
            : errorPosition !== null
              ? t(
                  `Volgende fout (${errorPosition + 1} van ${errorCellCount})`,
                  `Next error (${errorPosition + 1} of ${errorCellCount})`,
                )
              : t("Volgende fout", "Next error")
        }
        onClick={onNextError}
        disabled={errorCellCount === 0}
        leading
      >
        <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton
        label={
          filterErrors
            ? t("Alle rijen tonen", "Show all rows")
            : errorRowCount > 0
              ? t(
                  `Alleen rijen met fouten (${errorRowCount})`,
                  `Only rows with errors (${errorRowCount})`,
                )
              : t("Alleen rijen met fouten", "Only rows with errors")
        }
        onClick={onToggleFilter}
        active={filterErrors}
        disabled={errorRowCount === 0}
        leading
      >
        <Filter className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      </ToolbarButton>
    </div>
  );

  return (
    // `relative z-30` keeps the buttons' tooltips above the table beside the
    // column — its sticky header carries a z-index of its own.
    <section className={`relative z-30 shrink-0 px-4 py-4 ${className}`}>
      {/* The sheet's identity. Two lines rather than one truncated one: the column
          is narrow, and a file name's distinguishing part (the date, the version)
          is usually at its end. `overflow-wrap:anywhere` because the names are
          long runs of underscores with no space to break at. */}
      <h2
        title={fileName}
        className="line-clamp-2 text-base font-semibold leading-snug text-k-text-primary [overflow-wrap:anywhere]"
      >
        {fileName}
      </h2>
      {/* The sheet, or the bodies it would send. Admin-only, and only for a
          module whose mapping can actually produce them — see `SheetView`. Under
          the name, the column's width, since it says which reading of it is on
          screen. */}
      {view !== null && (
        <AdminOnly>
          <div className="mt-2.5 flex h-9.5 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm">
            {SHEET_VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onViewChange(option.id)}
                aria-pressed={view === option.id}
                className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-[box-shadow,color] duration-200 ${
                  view === option.id
                    ? "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                    : "text-k-text-tertiary hover:text-k-text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </AdminOnly>
      )}

      {/* Every action on the sheet, on one line that is only ever buttons —
          `gap-1.5` so all six fit the column without wrapping. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ToolbarButton label={t("Data hercontroleren", "Re-check data")} onClick={onRecheck} pulse={stale} leading>
          <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        </ToolbarButton>
        <ToolbarButton
          label={t("Opslaan en downloaden (Excel + PDF)", "Save and download (Excel + PDF)")}
          onClick={onSave}
          pulse={saveReady}
          leading
        >
          <Save className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        </ToolbarButton>
        <ToolbarButton label={t("Upload nieuw bestand", "Upload new file")} onClick={onUpload} leading>
          <FileUp className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        </ToolbarButton>
        {/* A toggle, so it wears the filter's pressed-in `active` state — with the
            sidebar gone, the button's own look is what says the page is in an
            unusual mode, alongside the icon flipping to `Minimize2`. Escape
            leaves too (`FocusModeProvider`). Desktop only: below `lg` the sidebar
            is already out of the way, in a drawer, so there is no width to win.
            `contents` keeps the button a direct item of this row where it shows. */}
        <span className="hidden lg:contents">
          <ToolbarButton
            label={focused ? t("Zijbalken tonen (Esc)", "Show sidebars (Esc)") : t("Volledig scherm", "Full screen")}
            onClick={toggleFocus}
            active={focused}
            leading
          >
            {focused ? (
              <Minimize2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            ) : (
              <Maximize2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            )}
          </ToolbarButton>
        </span>
        <ToolbarButton label={`${t("Uitleg", "Help")} ${moduleLabel}`} onClick={onHelp} leading>
          <HelpCircle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        </ToolbarButton>
        <AdminOnly>
          <ToolbarButton label={t("Instellingen", "Settings")} onClick={onConfig} leading>
            <Settings2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          </ToolbarButton>
        </AdminOnly>
      </div>

      {/* How the sheet scored: the figures stacked one per line (side by side
          they'd cut each other's captions off in a column this narrow), the
          error stepping beside the last of them, then what qualifies them. */}
      <div className="mt-4 border-t border-k-divider pt-4">
        {shown.length > 0 && (
          <div className="flex flex-col gap-3">
            {shown.map((metric, i) => (
              <div key={i} className="flex items-center gap-2">
                <div title={metric.title} className="min-w-0 flex-1">
                  {/* The payload view's background read (*Bestaande records …
                      opzoeken…*) takes the lead's detail line rather than a line
                      of its own, which would push everything under it down. */}
                  <Metric
                    metric={i === 0 && activity ? { ...metric, detail: activity } : metric}
                    busy={i === 0 && !!activity}
                  />
                </div>
                {i === shown.length - 1 && errorStepping}
              </div>
            ))}
          </div>
        )}
        {/* The figures are the last run's, and the grid has moved on since —
            say so rather than letting a stale percentage pass for current.
            And a codetabel no AFAS environment could serve leaves its column
            unchecked, which is invisible next to a clean one — both read as 0
            fouten. Say which lists are missing, so a *100%* is never mistaken
            for "everything was checked". */}
        {((stale && metrics) || unresolved.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stale && metrics && (
              <span
                title={t(
                  "De gegevens zijn gewijzigd na deze controle. Klik op Hercontroleren voor actuele cijfers.",
                  "The data changed after this check. Click Re-check for current figures.",
                )}
                className="rounded-full bg-k-amber-bg px-2.5 py-1 text-xs font-semibold text-k-amber-fg shadow-inset-sm"
              >
                {t("Verouderd", "Outdated")}
              </span>
            )}
            {unresolved.length > 0 && (
              <span
                title={t(
                  `Deze AFAS-lijsten kon geen enkele omgeving leveren: ${unresolved.join(", ")}. ` +
                    `De kolommen die ze gebruiken zijn niet gecontroleerd — vul de AFAS-gegevens ` +
                    `van dit project in en herlaad de pagina.`,
                  `No environment could supply these AFAS lists: ${unresolved.join(", ")}. ` +
                    `The columns that use them have not been checked — fill in this project's AFAS details ` +
                    `and reload the page.`,
                )}
                className="rounded-full bg-k-amber-bg px-2.5 py-1 text-xs font-semibold text-k-amber-fg shadow-inset-sm"
              >
                {unresolved.length}{" "}
                {unresolved.length === 1 ? t("lijst", "list") : t("lijsten", "lists")}{" "}
                {t("niet gecontroleerd", "not checked")}
              </span>
            )}
          </div>
        )}
      </div>

    </section>
  );
}
