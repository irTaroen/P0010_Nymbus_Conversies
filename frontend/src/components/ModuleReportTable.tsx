"use client";

import { Check, X } from "lucide-react";
import { GuardedLink } from "@/components/NavigationGuard";
import { rowTone } from "@/lib/management-report";
import { conversionSteps, STATUS_TONE_FILL, type StepState } from "@/lib/modules";
import {
  completenessTone,
  COMPLETENESS_TONE_FILL,
  formatCheckedAt,
  progressFigureLabel,
  storedErrorCount,
  storedErrorText,
} from "@/lib/project-progress";
import {
  rowDeliveryDate,
  rowTooltip,
  rowTurn,
  stageText,
  type ProjectReport,
  type ProjectReportRow,
} from "@/lib/project-report";
import { modulePath } from "@/lib/routes";
import { useT } from "@/lib/i18n";

/** Header cell — one type for all seven labels, so none reads heavier than the others. */
const TH = "whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-secondary";

/** Pinned to the top of a scrolling wrapper — its own opaque ground so rows pass under it. */
const TH_STICKY = "sticky top-0 z-20 bg-k-bg";

const TD = "border-t border-k-divider px-3 py-2 align-middle";

/** The two dates on a row — a step quieter than the figures: they say *when*. */
const DATE_TD = `${TD} whitespace-nowrap text-right text-xs tabular-nums text-k-text-secondary`;

/** A quiet placeholder where a figure would be, for a module without one. */
/** A figure there is nothing to show for — the report tables' quiet dash. */
export function Empty() {
  return <span className="text-k-text-tertiary">—</span>;
}

/**
 * What one module's last check found, as the report's one error figure.
 *
 * A check counted in this session leads with the **fields** carrying an error; after
 * a reload only AFAS's own `Fouten` is left, which counts **rows** and is worded
 * *rijen met fouten* accordingly (see `storedErrorCount()`). *Niet gecontroleerd* is
 * reserved for a module nobody has checked — a zero there would claim a clean sheet
 * for one that was never read.
 */
function ErrorCell({ progress }: { progress: ProjectReportRow["progress"] }) {
  const t = useT();
  if (!progress) return <span className="text-xs text-k-text-secondary">{t("Niet gecontroleerd", "Not checked")}</span>;
  const found = storedErrorCount(progress);
  if (found === null) {
    return (
      <span
        className="text-xs text-k-text-secondary"
        title={t(
          "Deze controle is vastgelegd zonder fouttelling. Hercontroleer de module voor een actueel aantal.",
          "This check was recorded without an error count. Re-check the module for a current number."
        )}
      >
        {t("Niet geteld", "Not counted")}
      </span>
    );
  }
  return (
    <span
      // `whitespace-nowrap`: a verdict broken over two lines grows the row.
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-inset-sm ${
        found.count === 0
          ? "bg-k-green-bg text-k-green-fg"
          : "bg-k-red-bg text-k-red-fg"
      }`}
      title={
        found.unit === "refused"
          ? t(
              "Rijen die bij de laatste verzending niet in AFAS kwamen: geweigerd door AFAS of tegengehouden.",
              "Rows that did not reach AFAS in the last send: refused by AFAS or held back."
            )
          : found.unit === "rows"
            ? t(
                "Aantal rijen met een fout bij de laatste controle, zoals AFAS het bewaart. Hercontroleer de module voor het aantal velden.",
                "Number of rows with an error at the last check, as AFAS stores it. Re-check the module for the number of fields."
              )
            : undefined
      }
    >
      {found.count === 0 ? t("Geen fouten", "No errors") : storedErrorText(found)}
    </span>
  );
}

/**
 * AFAS's status word with the tone it is counted under — the same dot colour as the
 * status meter above the table, so a row reads against the bar.
 */
function StatusCell({ row }: { row: ProjectReportRow }) {
  if (!row.status?.status) return <Empty />;
  const tone = rowTone(row);
  return (
    <span className="inline-flex items-center gap-2">
      {tone && (
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_FILL[tone]}`} />
      )}
      {row.status.status}
    </span>
  );
}

/** Each step state's mark and label ink — see {@link StageSteps}. */
const STEP_MARK: Record<StepState, string> = {
  done: "bg-k-green-fg text-k-bg",
  // Overridden by whose turn it is (`CURRENT_MARK`); this is a step nobody holds.
  current: "bg-k-cyan-fg ring-2 ring-k-cyan-bg",
  rejected: "bg-k-red-fg text-k-bg",
  todo: "bg-k-bg shadow-inset-sm",
};

/**
 * The open step in the colour of whoever has to move it — the status dot's own sky
 * for Nymbus and cloud-blue for the client (`STATUS_TONE_FILL`), so the stepper says how
 * far a module is *and* who it is waiting on, and reads against the status column.
 */
const CURRENT_MARK = {
  nymbus: "bg-k-cyan-fg ring-2 ring-k-cyan-bg",
  client: "bg-k-cloud-deep ring-2 ring-k-cloud-light",
} as const;

/**
 * A turned-down step keeps its red cross, ringed in the same colours: *niet akkoord*
 * is a verdict, not a party, and the module is still with Nymbus or the client —
 * without the ring a rejected row said nothing about whose turn it was.
 */
const REJECTED_RING = {
  nymbus: "ring-2 ring-offset-1 ring-k-cyan-bg",
  client: "ring-2 ring-offset-1 ring-k-cloud-light",
} as const;
const STEP_LABEL: Record<StepState, string> = {
  done: "text-k-text-primary",
  current: "font-semibold text-k-text-primary",
  rejected: "font-semibold text-k-red-fg",
  todo: "text-k-text-tertiary",
};

/**
 * Where the module is in the conversion — *Validatie → Test → Live*, each step done
 * (a check), open (a filled dot), turned down (a cross) or still ahead (an empty
 * ring). This is what keeps a 100% from reading as finished: the figure says how
 * clean the sheet is, or how much of it is in an environment, and only a module
 * whose **Live** step is done is through. The words carry it, not the marks: every
 * step is named, the open one is bold, and the cell's title says it in a sentence.
 */
function StageSteps({ row }: { row: ProjectReportRow }) {
  useT();
  const steps = conversionSteps(row.status);
  if (!steps) return <Empty />;
  const text = stageText(row) ?? undefined;
  const turn = rowTurn(row);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={text}>
      {steps.map((step, i) => (
        <span key={step.id} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="h-px w-2 bg-k-divider" />}
          <span
            aria-hidden
            className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
              step.state === "current" && turn
                ? CURRENT_MARK[turn]
                : step.state === "rejected" && turn
                  ? `${STEP_MARK.rejected} ${REJECTED_RING[turn]}`
                  : STEP_MARK[step.state]
            }`}
          >
            {step.state === "done" && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
            {step.state === "rejected" && <X className="h-2.5 w-2.5" strokeWidth={3.5} />}
            {step.state === "current" && <span className="h-1.5 w-1.5 rounded-full bg-k-bg" />}
          </span>
          <span aria-hidden className={`text-xs ${STEP_LABEL[step.state]}`}>
            {step.label}
          </span>
        </span>
      ))}
      <span className="sr-only">{text}</span>
    </span>
  );
}

/**
 * One project's modules, module by module — shared by the managementrapport's
 * project cards and the projectrapport's *Lijst* view, so the two pages show a module
 * the same way. A real table rather than flex rows: seven columns of figures only
 * line up reliably in one. It takes the width it is given rather than a fixed
 * minimum: the name, the status and the error badge wrap before anything scrolls
 * sideways.
 *
 * *Fase* is the conversion step it is on ({@link StageSteps}), its open step in the
 * colour of whose turn it is,
 * and **Rijen OK** names what its figure measures — *gevalideerd*, *in Test*,
 * *in Live* — so the two together say how far a module really is.
 *
 * **Below `lg` the rows are cards** ({@link ModuleReportCards}): seven columns
 * don't fit a phone, and on a phone the question is "where does my module stand",
 * which seven squeezed columns answer worse than one card with the same facts stacked.
 * Both are rendered and CSS picks one, so there is no width to measure and nothing
 * flashes on load.
 */
export default function ModuleReportTable({
  report,
  projectId,
  stickyHeader = false,
}: {
  report: ProjectReport;
  projectId: string;
  /** Pin the header row — for a caller that scrolls the table vertically. */
  stickyHeader?: boolean;
}) {
  const t = useT();
  const th = stickyHeader ? `${TH} ${TH_STICKY}` : TH;
  return (
    <>
    <ModuleReportCards report={report} projectId={projectId} />
    <table className="hidden w-full border-separate border-spacing-0 text-sm lg:table">
      <thead>
        <tr className="text-left">
          <th className={th}>Module</th>
          <th
            className={th}
            title={t(
              "De stap van de conversie waar de module staat: validatie, de import in de testomgeving, de import in de live-omgeving. Pas als Live is afgerond, is de module klaar.",
              "The conversion step the module is on: validation, the import into the test environment, the import into the live environment. Only once Live is done is the module finished."
            )}
          >
            {t("Fase", "Stage")}
          </th>
          <th className={th}>Status</th>
          <th className={th}>{t("Fouten", "Errors")}</th>
          <th
            className={`${th} text-right`}
            title={t(
              "Gevalideerd: het aandeel rijen dat zonder fouten naar AFAS kan. In Test / in Live: het aandeel dat na de laatste verzending in die omgeving staat.",
              "Validated: the share of rows that can go to AFAS without errors. In Test / in Live: the share that is in that environment after the last send."
            )}
          >
            {t("Rijen OK", "Rows OK")}
          </th>
          <th
            className={`${th} text-right`}
            title={t(
              "De datum waarop deze module wordt opgeleverd, zoals AFAS die vastlegt",
              "The date on which this module is delivered, as AFAS records it"
            )}
          >
            {t("Opleverdatum", "Delivery date")}
          </th>
          <th className={`${th} text-right`}>{t("Laatste controle", "Last check")}</th>
        </tr>
      </thead>
      {report.groups.map((group) => (
        <tbody key={group.id}>
          <tr>
            <td
              colSpan={7}
              className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-k-text-tertiary"
            >
              {group.label}
            </td>
          </tr>
          {group.rows.map((row) => (
            <tr
              key={row.moduleId}
              title={rowTooltip(row) ?? undefined}
              className="transition-colors hover:bg-k-tint"
            >
              <td className={TD}>
                <GuardedLink
                  href={modulePath(projectId, row.moduleId)}
                  prefetch={false}
                  className="flex cursor-pointer items-center gap-2.5 font-medium text-k-text-primary hover:text-k-cloud-deep"
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${COMPLETENESS_TONE_FILL[completenessTone(row.progress)]}`}
                  />
                  {row.label}
                </GuardedLink>
              </td>
              <td className={TD}>
                <StageSteps row={row} />
              </td>
              <td className={`${TD} text-xs text-k-text-secondary`}>
                <StatusCell row={row} />
              </td>
              <td className={TD}>
                <ErrorCell progress={row.progress} />
              </td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                {row.progress ? <RowsOkFigure progress={row.progress} /> : <Empty />}
              </td>
              <td className={DATE_TD}>{rowDeliveryDate(row) ?? <Empty />}</td>
              <td className={DATE_TD}>
                {row.progress ? formatCheckedAt(row.progress.checkedAt) : <Empty />}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
    </>
  );
}

/** The figure *Rijen OK* shows, with what it measures — never a bare 100% (see
 *  `progressFigureLabel()`). */
function RowsOkFigure({ progress }: { progress: NonNullable<ProjectReportRow["progress"]> }) {
  useT();
  return (
    <span className="whitespace-nowrap">
      <span
        className={`font-semibold tabular-nums ${
          progress.completeness === 100 ? "text-k-green-fg" : "text-k-text-primary"
        }`}
      >
        {progress.completeness}%
      </span>{" "}
      <span className="text-[11px] text-k-text-secondary">{progressFigureLabel(progress)}</span>
    </span>
  );
}

/**
 * The table's rows as cards, for below `lg` — the same cells, stacked: the module
 * and its figure on top, then its phase, then where it stands in AFAS and what its
 * last check found, with the two dates as a quiet last line. The whole card is the
 * link (one big target rather than a name to aim at), and `sm` puts two side by
 * side, which a tablet has the width for and a phone does not. Within a group the
 * modules whose task is Nymbus's come first.
 */
function ModuleReportCards({ report, projectId }: { report: ProjectReport; projectId: string }) {
  const t = useT();
  return (
    <div className="space-y-4 px-3 pb-1 pt-1 lg:hidden">
      {report.groups.map((group) => (
        <section key={group.id}>
          <h4 className="pb-2 text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
            {group.label}
          </h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {/* The modules waiting on Nymbus first: these cards are the phone's,
                and on a phone that is the work being looked for. */}
            {[...group.rows]
              .sort((a, b) => Number(!!b.status?.withNymbus) - Number(!!a.status?.withNymbus))
              .map((row) => {
              const delivery = rowDeliveryDate(row);
              return (
                <li key={row.moduleId}>
                  <GuardedLink
                    href={modulePath(projectId, row.moduleId)}
                    prefetch={false}
                    className="block h-full cursor-pointer space-y-2 rounded-lg bg-k-bg px-3.5 py-3 shadow-raised-sm transition-shadow duration-200 hover:shadow-hover-card active:shadow-inset"
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${COMPLETENESS_TONE_FILL[completenessTone(row.progress)]}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-k-text-primary">{row.label}</span>
                      {row.progress && <RowsOkFigure progress={row.progress} />}
                    </span>
                    <span className="block">
                      <StageSteps row={row} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-k-text-secondary">
                      <StatusCell row={row} />
                      <ErrorCell progress={row.progress} />
                    </span>
                    {(delivery || row.progress) && (
                      <span className="block text-[11px] tabular-nums text-k-text-secondary">
                        {/* Each date whole, so a narrow card breaks at the dot. */}
                        {delivery && <span className="whitespace-nowrap">{t("Oplevering", "Delivery")} {delivery}</span>}
                        {delivery && row.progress && " · "}
                        {row.progress && (
                          <span className="whitespace-nowrap">
                            {t("Gecontroleerd", "Checked")} {formatCheckedAt(row.progress.checkedAt)}
                          </span>
                        )}
                      </span>
                    )}
                  </GuardedLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
