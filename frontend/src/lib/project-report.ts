/**
 * Projectrapport — the whole conversion on one page, one level above the
 * validatierapport.
 *
 * [`validation/report.ts`](./validation/report.ts) answers *what is wrong with this
 * sheet*. This module answers the question nothing did: **where does this project
 * stand**. It has no data of its own — it joins the two answers the app already
 * holds per module and adds them up:
 *
 * - **AFAS's workflow status** per deeltaak (`useModule().statuses`), which is where
 *   a module stands in the conversion and what Nymbus works from;
 * - **the last check** per module (`useProgress()`), which is how clean that
 *   module's sheet was — the figure the sidebar badge carries.
 *
 * Neither stands in for the other, exactly as they don't in the sidebar: a module can
 * be *Afgerond* in AFAS and a module can be 100% clean, and those are different
 * sentences. The report's headline figures are all AFAS's side — how many modules
 * have started, how many are done, how many are nearing their opleverdatum — and the
 * checks speak per module, in the table.
 *
 * Everything here is a pure function of the modules, their statuses and their stored
 * progress: no React, no fetch. The component only renders what it returns, and every
 * figure it adds up is one `sheetMetrics()` already counted — this module sums, it
 * never counts. Counting a second time is how two screens end up disagreeing about
 * the same sheet (see [validation/metrics.ts](./validation/metrics.ts)).
 */

import {
  CONVERSION_PHASE_SEGMENTS,
  conversionPhase,
  conversionSteps,
  moduleStarted,
  moduleStatusTone,
  MODULE_STATUS_SEGMENTS,
  type ConversionPhase,
  type ModuleGroup,
  type ModuleStatus,
  type ModuleStatusTone,
} from "@/lib/modules";
import { formatIsoDate } from "@/lib/datetime";
import { tr } from "@/lib/i18n";
import {
  formatCheckedAt,
  progressFigureLabel,
  progressSummary,
  sendStageLabel,
  storedErrorCount,
  storedErrorText,
  type ModuleProgress,
  type SendRefusal,
} from "@/lib/project-progress";
import { countText, percentageOf, type MetricText } from "@/lib/validation/metrics";

/** One module's line in the report: where it stands, and how its last check went. */
export interface ProjectReportRow {
  moduleId: string;
  label: string;
  /** The deeltaak's status in AFAS, or null for a module it doesn't answer for. */
  status: ModuleStatus | null;
  /** The last check, or null for a module nobody has checked yet. */
  progress: ModuleProgress | null;
}

/** Modules per status tone, in {@link MODULE_STATUS_SEGMENTS} order. */
export interface ProjectStatusSegment {
  id: ModuleStatusTone;
  label: string;
  value: number;
}

/** Open modules per party whose turn it is — the *Aan zet* counts. */
export interface ProjectTurnSegment {
  id: "nymbus" | "client";
  label: string;
  value: number;
}

/** Modules per conversion phase, in {@link CONVERSION_PHASE_SEGMENTS} order. */
export interface ProjectPhaseSegment {
  id: ConversionPhase;
  label: string;
  value: number;
}

/**
 * The project's opleverdatum as the card states it.
 *
 * AFAS has **no project-level opleverdatum**: the date lives on each deeltaak
 * (`Opleverdatum` on its `KnS51` vrije velden, read as `deliveryDate` per module).
 * A project therefore has as many dates as it has modules, and today they happen to
 * agree — they were set in one pass — but nothing in AFAS keeps them agreeing the
 * moment someone edits one deeltaak.
 *
 * So the card reports the **earliest** date, which is the one a deadline question is
 * actually about, and says how many modules carry a different one rather than
 * quietly picking a winner. `uniform` is what the wording turns on: one date for the
 * whole project reads as a fact, several read as a range, and the two must not look
 * alike.
 */
export interface ProjectDelivery {
  /** The earliest date any module carries, as AFAS wrote it (`2026-10-09`). */
  iso: string;
  /** That date as the app prints it — `09-10-2026`. */
  text: string;
  /** How many modules carry a date at all. */
  withDate: number;
  /** How many modules AFAS holds no date for. */
  withoutDate: number;
  /** Whether every module that has a date carries the *same* one. */
  uniform: boolean;
}

/** One project on one page. */
export interface ProjectReport {
  projectId: string;
  projectName: string;
  /** Every module this project has — the denominator of the figures below. */
  moduleCount: number;
  /** Modules AFAS calls *Afgerond*. */
  doneCount: number;
  /** 0–100, `doneCount` over `moduleCount`. */
  completion: number;
  /** Modules whose deeltaak has left *Template vullen* — see `moduleStarted()`. */
  startedCount: number;
  /** 0–100, `startedCount` over `moduleCount` — the report's leading figure. */
  started: number;
  /**
   * Modules not yet *Afgerond* whose opleverdatum is at most {@link DEADLINE_WINDOW_DAYS}
   * days away — the ones passed already included, since a missed date is the same
   * question asked too late. `overdueCount` is how many of them are past it.
   */
  dueSoonCount: number;
  overdueCount: number;
  /** Modules not yet *Afgerond* that carry an opleverdatum — whether the figure above means anything. */
  datedOpenCount: number;
  /** Modules per status tone — whose turn it is; the board's lanes and the status counts. */
  statusSegments: ProjectStatusSegment[];
  /**
   * Modules per conversion phase — validatie, test, live, afgerond — for the *Fase*
   * meter and its legend. A module AFAS gives no step for is in none of them.
   */
  phaseSegments: ProjectPhaseSegment[];
  /**
   * Open modules by whose turn it is — *bij Nymbus*, *bij de klant* — for the
   * *Aan zet* legend. A module *niet akkoord* counts under whoever has to act on it
   * (`withNymbus`): the verdict is not a party. Done modules are nobody's turn.
   */
  turnSegments: ProjectTurnSegment[];
  /** Modules whose sheet has ever been checked. */
  checkedCount: number;
  /**
   * Of those, the ones whose stored check carries its counts. Below `checkedCount`
   * only for checks recorded before the store kept them — see
   * [project-progress.ts](./project-progress.ts).
   */
  countedCount: number;
  /** Fields still carrying an error, summed over those checks; null when there are none to sum. */
  errorCells: number | null;
  /** Modules whose last check was clean — nothing blocking the upload. */
  cleanCount: number;
  /** Modules whose figure is a send's outcome (`progress.send`), not a check's. */
  sentCount: number;
  /** Over those: the rows the sends cover, and how many of them are in AFAS. */
  sentRows: number;
  inAfasRows: number;
  /** Rows AFAS refused or that were held back, over the same sends. */
  refusedRows: number;
  /**
   * The project's **opleverdatum**, derived from its modules — see
   * {@link projectDeliveryDate}. Null when AFAS holds no date for any of them.
   */
  delivery: ProjectDelivery | null;
  /** The modules, grouped and ordered exactly as the sidebar lists them. */
  groups: { id: string; label: string; rows: ProjectReportRow[] }[];
}

/** What the report is built from — the three things the project shell already holds. */
export interface ProjectReportInput {
  projectId: string;
  projectName: string;
  groups: ModuleGroup[];
  statuses: Map<string, ModuleStatus>;
  progress: Map<string, ModuleProgress>;
  /** The day the deadline figure is counted from; today when left out. */
  today?: Date;
}

/** How close an opleverdatum must be for its module to count as *nadert de deadline*. */
export const DEADLINE_WINDOW_DAYS = 7;

/**
 * A day as AFAS writes one, `2026-10-20`, in **local** time — the reader's calendar
 * day, not UTC's, which is the day before here until 02:00 in summer.
 */
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The project's opleverdatum, derived from the dates its modules carry.
 *
 * The **earliest** wins. A project with two delivery dates has two deadlines, and the
 * nearer one is the one that constrains the work — reporting the latest would let a
 * card read *9 oktober* while a module was due in August. `uniform` says whether that
 * choice actually hid anything, so the card can word one date differently from
 * several (see {@link ProjectDelivery}).
 *
 * Rows are read straight off {@link ProjectReportRow.status}, the same
 * `deliveryDate` the table's own column prints, so the card and the column can never
 * disagree about a date — they read one value. Dates are compared as the ISO strings
 * AFAS writes (`2026-10-09`, sometimes with a `T00:00:00Z` tail): `yyyy-mm-dd` sorts
 * correctly as text, which avoids `new Date()` on a bare date — that parses as UTC
 * midnight and prints the day before west of Greenwich, the bug
 * {@link formatIsoDate} exists to dodge.
 */
export function projectDeliveryDate(
  groups: { rows: ProjectReportRow[] }[]
): ProjectDelivery | null {
  const dates: string[] = [];
  let withoutDate = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      // The ISO date only — a `T00:00:00Z` tail would make two equal days compare
      // unequal and report a project as non-uniform against itself.
      const value = row.status?.deliveryDate?.trim().slice(0, 10);
      if (value) dates.push(value);
      else withoutDate++;
    }
  }
  if (dates.length === 0) return null;

  const earliest = dates.reduce((a, b) => (b < a ? b : a));
  return {
    iso: earliest,
    text: formatIsoDate(earliest),
    withDate: dates.length,
    withoutDate,
    uniform: dates.every((d) => d === earliest),
  };
}

/**
 * The report for one project. Module order is the sidebar's, so the two read as the
 * same list; a module with no status or no check simply says so on its row rather
 * than being left out — "not started" is a finding on a project report, and dropping
 * it would make the list shorter than the project is.
 */
export function buildProjectReport(input: ProjectReportInput): ProjectReport {
  const { statuses, progress } = input;
  // Compared as `yyyy-mm-dd` text, as `projectDeliveryDate()` does — see there.
  const now = input.today ?? new Date();
  const today = isoDay(now);
  const horizon = isoDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + DEADLINE_WINDOW_DAYS)
  );

  const byTone: Record<ModuleStatusTone, number> = {
    done: 0,
    nymbus: 0,
    client: 0,
    rejected: 0,
  };
  const byPhase: Record<ConversionPhase, number> = {
    afgerond: 0,
    live: 0,
    test: 0,
    validatie: 0,
  };
  const byTurn = { nymbus: 0, client: 0 };
  let moduleCount = 0;
  let startedCount = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;
  let datedOpenCount = 0;
  let checkedCount = 0;
  let countedCount = 0;
  let cleanCount = 0;
  let errorCells = 0;
  let sentCount = 0;
  let sentRows = 0;
  let inAfasRows = 0;
  let refusedRows = 0;

  const groups = input.groups.map((group) => ({
    id: group.id,
    label: group.label,
    rows: group.items.map((item): ProjectReportRow => {
      const status = statuses.get(item.id) ?? null;
      const tone = status ? moduleStatusTone(status) : null;
      const last = progress.get(item.id) ?? null;

      const phase = conversionPhase(status);

      moduleCount++;
      if (tone) byTone[tone]++;
      if (phase) byPhase[phase]++;
      if (moduleStarted(status)) startedCount++;
      const due = status?.deliveryDate?.trim().slice(0, 10);
      if (due && tone !== "done") {
        datedOpenCount++;
        if (due <= horizon) dueSoonCount++;
        if (due < today) overdueCount++;
      }
      if (last) {
        checkedCount++;
        if (last.completeness === 100) cleanCount++;
        if (last.send) {
          sentCount++;
          sentRows += last.send.totalRows;
          inAfasRows += last.send.inAfasRows;
          refusedRows += last.send.refusedRows + last.send.heldBackRows;
        }
        // The count AFAS keeps is a **row** count, so it can't be added into a
        // total of wrong *fields*. A project whose checks all came back from AFAS
        // therefore still has no field total — the tile says so in words — while
        // the per-module rows below it each show their own stored row count.
        if (last.metrics) {
          countedCount++;
          errorCells += last.metrics.errorCells;
        }
      }

      const row: ProjectReportRow = { moduleId: item.id, label: item.label, status, progress: last };
      const turn = rowTurn(row);
      if (turn) byTurn[turn]++;
      return row;
    }),
  }));

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    moduleCount,
    doneCount: byTone.done,
    completion: percentageOf(byTone.done, moduleCount),
    startedCount,
    started: percentageOf(startedCount, moduleCount),
    dueSoonCount,
    overdueCount,
    datedOpenCount,
    statusSegments: MODULE_STATUS_SEGMENTS.map((s) => ({
      id: s.id,
      label: s.label,
      value: byTone[s.id],
    })),
    phaseSegments: CONVERSION_PHASE_SEGMENTS.map((s) => ({
      id: s.id,
      label: s.label,
      value: byPhase[s.id],
    })),
    turnSegments: turnSegmentsOf(byTurn),
    checkedCount,
    countedCount,
    // Null rather than 0 when nothing carries counts: zero errors is what a clean
    // project looks like, and an unchecked one must not borrow that face.
    errorCells: countedCount > 0 ? errorCells : null,
    cleanCount,
    sentCount,
    sentRows,
    inAfasRows,
    refusedRows,
    delivery: projectDeliveryDate(groups),
    groups,
  };
}

/* --- Wording ----------------------------------------------------------------
 * The same three-line {@link MetricText} shape the validatierapport and the sheet
 * toolbar print, so the project's headline figures are laid out by the reader's eye
 * the way every other figure in the tool is.
 */

/**
 * The first metric: how many modules have **started** — their deeltaak has left
 * *Template vullen*, so the client has uploaded and handed in a sheet at least once.
 * It leads because it moves first: a project can be weeks in before anything is
 * *Afgerond*, and a row of 0% there says nothing about whether work is happening.
 */
export function startedMetricText(report: ProjectReport): MetricText {
  const { started, startedCount, moduleCount } = report;
  return {
    figure: `${started}%`,
    caption:
      moduleCount === 0
        ? tr("dit project heeft nog geen modules", "this project has no modules yet")
        : tr("van de modules is opgestart", "of the modules has started"),
    detail:
      moduleCount === 0
        ? ""
        : tr(
            `${startedCount} van ${countText(moduleCount, "module", "modules")}`,
            `${startedCount} of ${countText(moduleCount, "module", "modules")}`
          ),
  };
}

/**
 * The second metric: how much of the **conversion** is done, in AFAS's terms — the
 * project's actual state, and what a client asking "how far are we" is asking.
 */
export function completionMetricText(report: ProjectReport): MetricText {
  const { completion, doneCount, moduleCount } = report;
  return {
    figure: `${completion}%`,
    caption:
      moduleCount === 0
        ? tr("dit project heeft nog geen modules", "this project has no modules yet")
        : tr("van de modules is afgerond", "of the modules is done"),
    detail:
      moduleCount === 0
        ? ""
        : tr(
            `${doneCount} van ${countText(moduleCount, "module", "modules")}`,
            `${doneCount} of ${countText(moduleCount, "module", "modules")}`
          ),
  };
}

/**
 * The opleverdatum as the card's header states it: the date itself, plus a
 * qualifier only when there is something to qualify.
 *
 * Silent when every module agrees — the common case, and a bare *9 oktober* is the
 * whole truth there. It speaks up when the modules **disagree** (*vroegste van 3
 * data*), because the header would otherwise present one deeltaak's date as the
 * project's, and when some modules have **no** date at all, since a reader who takes
 * the header for the whole project would be counting on a date AFAS never gave those
 * modules.
 */
export function deliveryNote(delivery: ProjectDelivery): string {
  const distinct = !delivery.uniform;
  const missing = delivery.withoutDate > 0;
  if (!distinct && !missing) return "";
  const parts: string[] = [];
  if (distinct)
    parts.push(
      tr(
        `vroegste van ${countText(delivery.withDate, "datum", "data")}`,
        `earliest of ${countText(delivery.withDate, "date", "dates")}`
      )
    );
  if (missing) {
    parts.push(
      tr(
        `${countText(delivery.withoutDate, "module", "modules")} zonder opleverdatum`,
        `${countText(delivery.withoutDate, "module", "modules")} without delivery date`
      )
    );
  }
  return parts.join(" · ");
}

/**
 * The third metric: the modules that need finishing **soon** — not yet *Afgerond*,
 * with an opleverdatum at most a week away. The ones already past it are counted in,
 * not left out: a module that missed its date is more urgent than one about to, and
 * dropping it would make the figure fall the day the date passes. The detail says
 * how many of them are late.
 *
 * A dash rather than 0 when no open module carries a date: AFAS then gave us nothing
 * to measure, and a zero would read as "nothing is due".
 */
export function deadlineMetricText(report: {
  dueSoonCount: number;
  overdueCount: number;
  datedOpenCount: number;
}): MetricText {
  const { dueSoonCount, overdueCount, datedOpenCount } = report;
  if (datedOpenCount === 0) {
    return { figure: "—", caption: tr("geen opleverdatum", "no delivery date"), detail: "" };
  }
  return {
    figure: String(dueSoonCount),
    caption:
      dueSoonCount === 1
        ? tr("module nadert de deadline", "module nearing its deadline")
        : tr("modules naderen hun deadline", "modules nearing their deadline"),
    detail:
      overdueCount > 0
        ? tr(
            `waarvan ${overdueCount} over de opleverdatum`,
            `of which ${overdueCount} past the delivery date`
          )
        : tr(
            `opleverdatum binnen ${DEADLINE_WINDOW_DAYS} dagen`,
            `delivery date within ${DEADLINE_WINDOW_DAYS} days`
          ),
  };
}

/** One sent module whose last send left rows out, with AFAS's reasons. */
export interface SendRefusalLine {
  moduleId: string;
  label: string;
  /** `Test` / `Live`. */
  stage: string;
  sentAt: string;
  /** Rows refused or held back. */
  failedRows: number;
  heldBackRows: number;
  refusals: SendRefusal[];
}

/**
 * The modules whose last send didn't get every row in, in the sidebar's order —
 * the report's *Geweigerd door AFAS* section. AFAS's own sentences, grouped and
 * counted by the backend when the run ended (`send_progress.outcome()`).
 */
export function sendRefusalLines(report: ProjectReport): SendRefusalLine[] {
  const lines: SendRefusalLine[] = [];
  for (const group of report.groups) {
    for (const row of group.rows) {
      const send = row.progress?.send;
      if (!send) continue;
      const failedRows = send.refusedRows + send.heldBackRows;
      if (failedRows === 0) continue;
      lines.push({
        moduleId: row.moduleId,
        label: row.label,
        stage: sendStageLabel(send),
        sentAt: formatCheckedAt(send.sentAt),
        failedRows,
        heldBackRows: send.heldBackRows,
        refusals: send.refusals,
      });
    }
  }
  return lines;
}

/**
 * What one module's last check says on its row: the figure with what it measures
 * (*100% gevalideerd*, never a bare *100%*), the errors, then the moment it was
 * measured. A module nobody has checked
 * gets null and the row says *Niet gecontroleerd* instead — a `0 fouten` there would
 * read as a clean sheet.
 */
export function rowCheckText(row: ProjectReportRow): string | null {
  const { progress } = row;
  if (!progress) return null;
  if (progress.send) return progressSummary(progress);
  const found = storedErrorCount(progress);
  const parts = [
    `${progress.completeness}% ${progressFigureLabel(progress)}`,
    ...(found
      ? [found.count === 0 ? tr("geen fouten", "no errors") : storedErrorText(found)]
      : []),
    tr(
      `laatste controle ${formatCheckedAt(progress.checkedAt)}`,
      `last check ${formatCheckedAt(progress.checkedAt)}`
    ),
  ];
  if (progress.fileName) parts.push(progress.fileName);
  return parts.join(" · ");
}

/**
 * The module's **opleverdatum** as its row prints it, `09-08-2026`, or null when
 * AFAS holds none for this deeltaak — which is every module until the dossieritem
 * connector carries the field (see `deliveryDate` in [modules.tsx](./modules.tsx)).
 *
 * Null rather than a stand-in date, for the reason the check figures are null
 * without a check: the row's dash says *AFAS has no date for this*, and any date
 * invented here would be read as one AFAS agreed to.
 */
export function rowDeliveryDate(row: ProjectReportRow): string | null {
  const value = row.status?.deliveryDate?.trim();
  return value ? formatIsoDate(value) : null;
}

/**
 * A meter as one sentence, for readers who get no colour — the same job
 * `meterLabel()` does for the validatierapport's row meter. Takes either breakdown,
 * the *Fase* meter's or the status tones'.
 */
export function segmentsLabel(segments: readonly { label: string; value: number }[]): string {
  const filled = segments.filter((s) => s.value > 0);
  if (filled.length === 0) return tr("Geen modules", "No modules");
  return filled.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(", ");
}

/**
 * Whose turn a module is — `nymbus` or `client` — or null when it is nobody's: done,
 * at no task, or without a status. The same `withNymbus` the status dot's tone and
 * the *(Nymbus)* mark read, so the stepper, the row and the counts can't disagree.
 */
export function rowTurn(row: ProjectReportRow): "nymbus" | "client" | null {
  const { status } = row;
  if (!status?.task || moduleStatusTone(status) === "done") return null;
  return status.withNymbus ? "nymbus" : "client";
}

/** *bij Nymbus* / *bij de klant* — {@link rowTurn} in the reports' words. */
export function turnText(turn: "nymbus" | "client"): string {
  return turn === "nymbus" ? tr("bij Nymbus", "with Nymbus") : tr("bij de klant", "with the client");
}

/**
 * The *Aan zet* counts as segments, Nymbus first — shared by the project report and
 * the managementrapport's sum over its projects.
 */
export function turnSegmentsOf(counts: { nymbus: number; client: number }): ProjectTurnSegment[] {
  return [
    { id: "nymbus", label: tr("Bij Nymbus", "With Nymbus"), value: counts.nymbus },
    { id: "client", label: tr("Bij de klant", "With the client"), value: counts.client },
  ];
}

/**
 * A module's *Fase* in one word, for a place with no room for the three steps — a
 * board card, the PDF's table: the open step (*Test*), or *Afgerond*. `rejected`
 * when that step was turned down, so it can be inked red. Null without a step.
 */
export function phaseTag(row: ProjectReportRow): { label: string; rejected: boolean } | null {
  const steps = conversionSteps(row.status);
  if (!steps) return null;
  const open = steps.find((s) => s.state !== "done");
  if (!open) return { label: tr("Afgerond", "Done"), rejected: false };
  return { label: open.label, rejected: open.state === "rejected" };
}

/**
 * A module's *Fase* in words — *Test (Validatie gedaan)*, *Live niet akkoord* — the
 * stepper's hover title and its screen-reader text, and the row tooltip's phrase.
 * Null for a module AFAS gives no step for.
 */
export function stageText(row: ProjectReportRow): string | null {
  const steps = conversionSteps(row.status);
  if (!steps) return null;
  if (steps.every((s) => s.state === "done"))
    return tr("Afgerond: validatie, test en live gedaan", "Done: validation, test and live finished");
  const open = steps.find((s) => s.state !== "done")!;
  const done = steps.filter((s) => s.state === "done").map((s) => s.label.toLowerCase());
  const turn = rowTurn(row);
  return [
    `${open.label}${open.state === "rejected" ? tr(" niet akkoord", " not approved") : ""}`,
    turn ? turnText(turn) : "",
    done.length > 0
      ? tr(`${done.join(" en ")} gedaan`, `${done.join(" and ")} done`)
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One module's row as its hover title: where AFAS says it stands (and the task it is
 * waiting on), when it is due, and how its last check went — in that order, because
 * that is the order the columns are read in.
 *
 * Both views print it, which is the reason it lives here rather than in either of
 * them: the list and the board show the same twelve modules, and a module that
 * describes itself one way in the table and another on its card is two answers to
 * one question. It is also the only place the **opleverdatum** exists under `lg`,
 * where the column is gone (see the note on `COL` in the component).
 */
export function rowTooltip(row: ProjectReportRow): string | null {
  const status = row.status?.task
    ? `${row.status.status} — ${row.status.task}`
    : row.status?.status;
  const delivery = rowDeliveryDate(row);
  const stage = stageText(row);
  const parts = [
    status,
    stage && tr(`fase ${stage}`, `stage ${stage}`),
    delivery && tr(`opleverdatum ${delivery}`, `delivery date ${delivery}`),
    rowCheckText(row),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* --- The board --------------------------------------------------------------
 * The same modules the list holds, laid out by **where they stand** instead of by
 * category: one lane per status tone, each module a card in the lane its deeltaak
 * puts it in. The list answers "how is this module doing", column by column; the
 * board answers "who has to act next, and on how many" without the reader adding up
 * a column of status words themselves.
 *
 * It is a re-grouping and nothing more — same rows, same figures, same wording. Both
 * views come off one {@link ProjectReport}, so they cannot disagree about a module.
 */

/** A module on the board: its report row, plus the category the lanes cut across. */
export interface ProjectBoardCard extends ProjectReportRow {
  groupId: string;
  /** `HRM` / `ERP` — the grouping the list has as headings and the board hasn't. */
  groupLabel: string;
}

/** One lane: a status bucket with the modules standing in it. */
export interface ProjectBoardLane {
  /** The tone id, or `"none"` for the modules AFAS holds no status for. */
  id: ModuleStatusTone | "none";
  /** The tone whose fill the lane paints in, or null for that last lane. */
  tone: ModuleStatusTone | null;
  label: string;
  cards: ProjectBoardCard[];
}

/**
 * Lane order is the **flow**, left to right — rework, then the client, then us, then
 * done — and deliberately *not* {@link MODULE_STATUS_SEGMENTS}' order, which the meter
 * above the board uses. The two orders answer different questions and reversing either
 * one breaks it: a meter is a quantity bar and fills from the left as a project
 * progresses, so *Afgerond* leads it; a board is read as movement towards done, and a
 * board with *Afgerond* in the first column reads as though the work runs backwards.
 *
 * *Niet akkoord* goes **first** rather than last. It is where an import came back from,
 * so in the loop it sits before the client's lane; and the two leftmost lanes are then
 * both the client's own work, which is what they open this page to find.
 */
const BOARD_LANE_ORDER: readonly ModuleStatusTone[] = [
  "rejected",
  "client",
  "nymbus",
  "done",
];

/**
 * The report's modules as board lanes.
 *
 * All four status lanes are always returned, empty ones included, exactly as the
 * meter's legend names every segment whether or not it has modules: a lane that
 * disappears when it empties makes the board a different shape per project, and
 * "nothing is *Niet akkoord*" is worth showing.
 *
 * The fifth lane is the exception — it is returned **only when it has cards**. A
 * module with no status is one AFAS answers nothing for (no deeltaak of its own), not
 * a stage of the conversion, so it gets no standing column; but it may not be dropped
 * either, for the reason the list keeps such a row: a board shorter than the project
 * is is worse than one honest extra lane.
 */
export function buildProjectBoard(report: ProjectReport): ProjectBoardLane[] {
  const cards = new Map<ModuleStatusTone | "none", ProjectBoardCard[]>();
  for (const group of report.groups) {
    for (const row of group.rows) {
      const key = row.status ? moduleStatusTone(row.status) : "none";
      const lane = cards.get(key) ?? [];
      lane.push({ ...row, groupId: group.id, groupLabel: group.label });
      cards.set(key, lane);
    }
  }

  const lanes: ProjectBoardLane[] = BOARD_LANE_ORDER.map((tone) => ({
    id: tone,
    tone,
    label: MODULE_STATUS_SEGMENTS.find((s) => s.id === tone)!.label,
    cards: cards.get(tone) ?? [],
  }));

  const orphans = cards.get("none");
  if (orphans?.length) {
    lanes.push({ id: "none", tone: null, label: tr("Geen status", "No status"), cards: orphans });
  }
  return lanes;
}

/**
 * A board card's middle line: the open task, or the status when there is none.
 *
 * The task is the sharper half of the pair (*Template vullen* says what to do,
 * *Klant* only who), so it leads; the status carries it when there is no task.
 * Unless it is the lane's own word, and then the line is dropped: a card reading
 * *Afgerond* under a column headed **Afgerond** spends a line saying where the
 * reader can already see it stands. That only bites at the ends of the workflow,
 * where AFAS holds no task any more. Shared by the screen
 * ([`ProjectReportBoard`](../components/ProjectReportBoard.tsx)) and the PDF.
 */
export function boardCardDetail(card: ProjectReportRow, laneLabel: string): string {
  const status = card.status?.status ?? "";
  return (
    card.status?.task ||
    (status.trim().toLowerCase() === laneLabel.trim().toLowerCase() ? "" : status)
  );
}

/**
 * What a card says about its module's last check, in one line: the share of rows that
 * could go to AFAS, then the fields that were wrong — the list's **Rijen OK** and
 * **Fouten** columns, in that order and in the same words.
 *
 * The same three silences the list keeps apart (see `ErrorCell`): a module nobody has
 * checked says so instead of showing a zero, and a check recorded without counts
 * shows its percentage and stops there rather than borrowing a *geen fouten*.
 */
export function boardCheckText(row: ProjectReportRow): string {
  const { progress } = row;
  if (!progress) return tr("Niet gecontroleerd", "Not checked");
  const parts = [`${progress.completeness}% ${progressFigureLabel(progress)}`];
  const found = storedErrorCount(progress);
  if (found) parts.push(found.count === 0 ? tr("geen fouten", "no errors") : storedErrorText(found));
  return parts.join(" · ");
}
