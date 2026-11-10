"use client";

import { GuardedLink } from "@/components/NavigationGuard";
import { STATUS_TONE_FILL } from "@/lib/modules";
import { completenessTone, COMPLETENESS_TONE_FILL } from "@/lib/project-progress";
import {
  boardCardDetail,
  boardCheckText,
  buildProjectBoard,
  phaseTag,
  rowTooltip,
  type ProjectBoardCard,
  type ProjectReport,
} from "@/lib/project-report";
import { useT } from "@/lib/i18n";
import { modulePath } from "@/lib/routes";
import { countText } from "@/lib/validation/metrics";

/**
 * The projectrapport's **bord**: the same modules the table holds, laid out by where
 * they stand instead of by category — one lane per status tone, one card per module,
 * and the count of each lane in its head.
 *
 * The table answers *how is this module doing*, column by column; the board answers
 * *who has to act next, and on how many* without the reader tallying twelve status
 * words themselves. It is a re-grouping and nothing else: the lanes, the order they
 * come in and every figure on a card come from
 * [`lib/project-report.ts`](../lib/project-report.ts) — same rows, same wording as the
 * table, so the two views can't disagree about a module.
 *
 * Its own file rather than a second half of [`ProjectReport`](./ProjectReport.tsx):
 * the table's `COL` map and the board's lanes are two full layouts, and the one thing
 * they share (the header, the metrics, the meter) is what stays in the parent.
 */
export default function ProjectReportBoard({
  report,
  projectId,
}: {
  report: ProjectReport;
  projectId: string;
}) {
  const lanes = buildProjectBoard(report);
  const t = useT();

  return (
    <>
      {/* Lanes share the width evenly and stop shrinking at `min-w-52`, below which a
          module name is no longer readable on its card; from there the row scrolls
          sideways rather than squeezing four columns into a phone. `items-start` so a
          full lane doesn't stretch three empty ones to its own height. */}
      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {lanes.map((lane) => (
          <section
            key={lane.id}
            aria-label={`${lane.label}: ${countText(lane.cards.length, "module", "modules")}`}
            className="min-w-52 flex-1 rounded-xl bg-k-bg p-2 shadow-inset-sm"
          >
            {/* The lane's head is the meter's legend entry, one level down: the same
                dot, the same word, the same count. Which is why the legend itself is
                not drawn above the board — see `ProjectReport`. */}
            <div className="flex items-center gap-2 px-1 pb-2">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  lane.tone ? STATUS_TONE_FILL[lane.tone] : "bg-k-divider"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-k-text-secondary">
                {lane.label}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-k-text-primary">
                {lane.cards.length}
              </span>
            </div>

            {lane.cards.length === 0 ? (
              /* An empty lane says so rather than collapsing: "nothing is Niet
                 akkoord" is a finding, and a board whose shape changes per project
                 can't be compared with the last time it was looked at. */
              <p className="px-1 pb-1 text-xs text-k-text-tertiary">{t("Geen modules", "No modules")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lane.cards.map((card) => (
                  <li key={card.moduleId}>
                    <Card card={card} projectId={projectId} laneLabel={lane.label} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p className="mt-3 px-1 text-xs leading-relaxed text-k-text-secondary">
        {t(
          <>
            Elke module staat in de kolom van de{" "}
            <strong className="font-semibold">status die AFAS ervoor vastlegt</strong>; op de
            kaart staat die status in de woorden van AFAS zelf, met de taak waar de module op
            wacht. Onderaan de kaart staat de laatste controle van dat bestand — het
            percentage rijen dat zo naar AFAS kan en de velden die nog een fout bevatten.
          </>,
          <>
            Each module sits in the column of the{" "}
            <strong className="font-semibold">status AFAS records for it</strong>; on the card
            that status is shown in AFAS&apos;s own words, with the task the module is waiting on.
            At the bottom of the card is the last check of that file — the percentage of rows
            that can go to AFAS as they are, and the fields that still contain an error.
          </>,
        )}
      </p>
    </>
  );
}

/**
 * One module as a card, and a way into it — a `GuardedLink` like the table's rows, for
 * the same reason: the project page holds no open sheet, but the guard is what this app
 * navigates through and a bare `<Link>` walks past it.
 *
 * Three lines, in the order the question is asked: which module (with the category the
 * lanes cut across, since the board has no HRM/ERP headings to stand under), where in
 * AFAS exactly — the status word beats the lane it sits in, *Sjabloon gevuld* inside
 * *Bij Nymbus* — and how its last check went. The opleverdatum stays in the tooltip,
 * as it does in the table under `lg`: a fourth line on every card for a date AFAS has
 * for none of them yet buys nothing.
 */
function Card({
  card,
  projectId,
  laneLabel,
}: {
  card: ProjectBoardCard;
  projectId: string;
  laneLabel: string;
}) {
  const t = useT();
  const tooltip = rowTooltip(card);
  // The task, or the status when there is none — see `boardCardDetail`.
  const detail = boardCardDetail(card, laneLabel);
  const phase = phaseTag(card);

  return (
    <GuardedLink
      href={modulePath(projectId, card.moduleId)}
      prefetch={false}
      title={tooltip || undefined}
      className="block cursor-pointer rounded-lg bg-k-bg px-2.5 py-2 shadow-raised-sm transition-shadow duration-200 hover:shadow-hover-card"
    >
      {/* The name, with the category beside it in the same quiet uppercase tertiary grey the
          table's group headings wear — the fact it states is the same one, moved onto
          the card because the board is grouped by something else. Beside the name and
          not above it: this lane can hold every module a project has, and a line of
          its own per card is 26px × twelve spent on the least surprising word on the
          board. Baselines, so the two sit on one line rather than the tag floating. */}
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-k-text-primary">
          {card.label}
        </span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-k-text-tertiary">
          {card.groupLabel}
        </span>
      </span>
      {detail && <span className="mt-0.5 block truncate text-xs text-k-text-secondary">{detail}</span>}
      <span className="mt-1.5 flex items-center gap-1.5">
        {/* The sidebar's completeness dot, on the same scale — how clean the sheet was,
            which is a different question from the lane the card is in and must not be
            painted in the lane's colour. */}
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${COMPLETENESS_TONE_FILL[completenessTone(card.progress)]}`}
        />
        <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-k-text-secondary">
          {boardCheckText(card)}
        </span>
        {/* The conversion step it is on — the table's *Fase* in one word, since a
            lane says whose turn it is and not how far the module got. */}
        {phase && (
          <span
            title={t("Fase van de conversie: validatie, test of live", "Conversion phase: validation, test or live")}
            className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${
              phase.rejected ? "text-k-red-fg" : "text-k-text-secondary"
            }`}
          >
            {phase.label}
          </span>
        )}
      </span>
    </GuardedLink>
  );
}
