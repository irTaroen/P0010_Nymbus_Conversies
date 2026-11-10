/**
 * Managementrapport — every selected client's conversion on one page, one level
 * above the projectrapport.
 *
 * [`project-report.ts`](./project-report.ts) answers *where does this project
 * stand*. This answers the question a project manager brings to a meeting: **where
 * do all of them stand, and which ones need someone**. It has no data of its own
 * either — it is one {@link ProjectReport} per project, built by the very
 * `buildProjectReport()` the project page uses, and a sum over them. So a client's
 * line here and that client's own projectrapport can never disagree: they are one
 * value, read twice.
 *
 * The only thing this module adds that the projectrapport doesn't have is the
 * **Project** itself — AFAS's project status, the conversion type, the livegang
 * and Appreo dates off the hoofdproces — which the project page gets from the
 * sidebar and a portfolio has to carry per line.
 */

import { requestJson } from "@/lib/api";
import type { Project } from "@/lib/auth";
import { INTAKE_LABEL, intakeHasDate, type Intake } from "@/lib/intake";
import { formatIsoDate } from "@/lib/datetime";
import {
  CONVERSION_PHASE_SEGMENTS,
  MODULE_STATUS_SEGMENTS,
  moduleStatusTone,
  parseProjectModules,
  type ConversionPhase,
  type ModuleStatusTone,
  type ProjectModulesResponse,
} from "@/lib/modules";
import { parseProjectProgress, type StoredProgress } from "@/lib/project-progress";
import {
  buildProjectReport,
  type ProjectPhaseSegment,
  type ProjectReport,
  type ProjectReportRow,
  type ProjectStatusSegment,
  type ProjectTurnSegment,
  turnSegmentsOf,
} from "@/lib/project-report";
import { percentageOf } from "@/lib/validation/metrics";
import { tr } from "@/lib/i18n";

/**
 * One project's report, from `GET /api/voortgang/{id}` — the route (admins and managers only)
 * behind this page, which re-checks the Nymbus logins on every call. It returns
 * the same `groups` and stored `progress` rows the project shell reads from
 * `/modules` and `/progress` (`ModuleProvider`, `ProgressProvider`), and they go
 * through those fetchers' own parsers, so a client's line here is what their
 * project page would show. A project whose progress won't load answers with no
 * checks rather than failing, as the sidebar does.
 */
export async function fetchProjectReport(project: Project): Promise<ProjectReport> {
  // No dossieritem means no deeltaken, so no modules and no checks — there is
  // nothing to ask AFAS. The empty report is still a real line: the client is in
  // the selection, and "not set up yet" is what their card has to say.
  if (!project.hasDossier) {
    return buildProjectReport({
      projectId: project.id,
      projectName: project.name,
      groups: [],
      statuses: new Map(),
      progress: new Map(),
    });
  }
  const data = await requestJson<ProjectModulesResponse & { progress: StoredProgress[] }>(
    `/api/voortgang/${encodeURIComponent(project.id)}`,
    undefined,
    tr("De voortgang van dit project kon niet worden opgehaald.", "The progress of this project could not be retrieved.")
  );
  const modules = parseProjectModules(data);
  return buildProjectReport({
    projectId: project.id,
    projectName: project.name,
    groups: modules.groups,
    statuses: modules.statuses,
    progress: parseProjectProgress(data.progress ?? []),
  });
}

/** One client's line: the project as AFAS describes it, and its report. */
export interface ManagementEntry {
  project: Project;
  report: ProjectReport;
  /**
   * Where the intake stands — ours, not AFAS's (`lib/intake.ts`), read once for the
   * whole page. Null while that read is out or when it failed, so a line never
   * claims *Nog niet ingepland* for a project nobody could look up.
   */
  intake: Intake | null;
}

/** What one client's line says beyond the projectrapport's own figures. */
export interface ManagementLine extends ManagementEntry {
  /** Modules per status tone, keyed for the columns that single one out. */
  byTone: Record<ModuleStatusTone, number>;
  /**
   * Open modules by whose turn it is — the projectrapport's *Aan zet* counts, so a
   * line's *bij Nymbus* / *bij de klant* match its card's. Unlike `byTone`, a module
   * *niet akkoord* is counted here too, under whoever has to act on it.
   */
  byTurn: { nymbus: number; client: number };
  /**
   * AFAS's stored **row** count of errors, summed over the modules whose last check
   * has one — the only error figure that survives a page load (see
   * `storedErrorCount()`), and the one every line here has. Null when no module
   * carries a count, so an unchecked project doesn't wear a clean-looking zero.
   */
  errorRows: number | null;
  /** Modules whose last check left at least one row with an error. */
  modulesWithErrors: number;
  /**
   * Modules whose figure is a send's outcome, and the rows those sends left out of
   * AFAS. Kept apart from `errorRows`: a row AFAS refused is a different finding
   * from a row the check flagged, and adding the two would count neither.
   */
  sentCount: number;
  refusedRows: number;
  /** The most recent check of any module, ISO — null when none was ever checked. */
  lastCheckedAt: string | null;
}

/** The whole selection, added up. */
export interface ManagementSummary {
  projectCount: number;
  moduleCount: number;
  doneCount: number;
  /** 0–100, done modules over all modules of the selection. */
  completion: number;
  /** Modules past *Template vullen*, and their share of all modules — see `moduleStarted()`. */
  startedCount: number;
  started: number;
  /** Open modules due within the week (overdue ones included), as `ProjectReport` counts them. */
  dueSoonCount: number;
  overdueCount: number;
  datedOpenCount: number;
  /** Projects with at least one module nearing its deadline. */
  projectsDueSoon: number;
  statusSegments: ProjectStatusSegment[];
  /** Modules per conversion phase over the selection — the *Fase* meter. */
  phaseSegments: ProjectPhaseSegment[];
  /** Open modules by whose turn it is over the selection — the *Aan zet* counts. */
  turnSegments: ProjectTurnSegment[];
  checkedCount: number;
  errorRows: number | null;
  /** Over every send in the selection: modules, their rows, and how many are in AFAS. */
  sentCount: number;
  sentRows: number;
  inAfasRows: number;
  refusedRows: number;
  /** Projects with at least one module *Niet akkoord* — the ones to discuss first. */
  projectsWithRejections: number;
  lines: ManagementLine[];
}

function emptyTones(): Record<ModuleStatusTone, number> {
  return { done: 0, nymbus: 0, client: 0, rejected: 0 };
}

function rowsOf(report: ProjectReport): ProjectReportRow[] {
  return report.groups.flatMap((group) => group.rows);
}

/** One client's line — see {@link ManagementLine}. */
export function buildManagementLine(entry: ManagementEntry): ManagementLine {
  const byTone = emptyTones();
  for (const segment of entry.report.statusSegments) byTone[segment.id] = segment.value;
  const byTurn = { nymbus: 0, client: 0 };
  for (const segment of entry.report.turnSegments) byTurn[segment.id] = segment.value;

  let errorRows = 0;
  let counted = 0;
  let modulesWithErrors = 0;
  let lastCheckedAt: string | null = null;
  for (const row of rowsOf(entry.report)) {
    const progress = row.progress;
    if (!progress) continue;
    if (progress.send) {
      // A send's `Fouten` is AFAS's refusals — counted below, not as check errors.
    } else if (progress.errorRowCount !== null) {
      counted++;
      errorRows += progress.errorRowCount;
      if (progress.errorRowCount > 0) modulesWithErrors++;
    }
    // ISO 8601 UTC as the backend stamps it, so text order is time order.
    if (lastCheckedAt === null || progress.checkedAt > lastCheckedAt) {
      lastCheckedAt = progress.checkedAt;
    }
  }

  return {
    ...entry,
    byTone,
    byTurn,
    errorRows: counted > 0 ? errorRows : null,
    modulesWithErrors,
    sentCount: entry.report.sentCount,
    refusedRows: entry.report.refusedRows,
    lastCheckedAt,
  };
}

/**
 * The selection as one summary, lines in the order they were handed in — the
 * caller's, which is the project list's, so the report reads down in the order the
 * admin ticked the boxes against.
 */
export function buildManagementSummary(entries: ManagementEntry[]): ManagementSummary {
  const lines = entries.map(buildManagementLine);
  const tones = emptyTones();
  const phases: Record<ConversionPhase, number> = { afgerond: 0, live: 0, test: 0, validatie: 0 };
  const turns = { nymbus: 0, client: 0 };
  let moduleCount = 0;
  let startedCount = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;
  let datedOpenCount = 0;
  let projectsDueSoon = 0;
  let checkedCount = 0;
  let errorRows = 0;
  let counted = false;
  let projectsWithRejections = 0;
  let sentCount = 0;
  let sentRows = 0;
  let inAfasRows = 0;
  let refusedRows = 0;

  for (const line of lines) {
    sentCount += line.report.sentCount;
    sentRows += line.report.sentRows;
    inAfasRows += line.report.inAfasRows;
    refusedRows += line.report.refusedRows;
    moduleCount += line.report.moduleCount;
    startedCount += line.report.startedCount;
    dueSoonCount += line.report.dueSoonCount;
    overdueCount += line.report.overdueCount;
    datedOpenCount += line.report.datedOpenCount;
    if (line.report.dueSoonCount > 0) projectsDueSoon++;
    checkedCount += line.report.checkedCount;
    for (const tone of Object.keys(tones) as ModuleStatusTone[]) {
      tones[tone] += line.byTone[tone];
    }
    for (const segment of line.report.phaseSegments) phases[segment.id] += segment.value;
    for (const segment of line.report.turnSegments) turns[segment.id] += segment.value;
    if (line.errorRows !== null) {
      counted = true;
      errorRows += line.errorRows;
    }
    if (line.byTone.rejected > 0) projectsWithRejections++;
  }

  return {
    projectCount: lines.length,
    moduleCount,
    doneCount: tones.done,
    completion: percentageOf(tones.done, moduleCount),
    startedCount,
    started: percentageOf(startedCount, moduleCount),
    dueSoonCount,
    overdueCount,
    datedOpenCount,
    projectsDueSoon,
    statusSegments: MODULE_STATUS_SEGMENTS.map((s) => ({
      id: s.id,
      label: s.label,
      value: tones[s.id],
    })),
    phaseSegments: CONVERSION_PHASE_SEGMENTS.map((s) => ({
      id: s.id,
      label: s.label,
      value: phases[s.id],
    })),
    turnSegments: turnSegmentsOf(turns),
    checkedCount,
    errorRows: counted ? errorRows : null,
    sentCount,
    sentRows,
    inAfasRows,
    refusedRows,
    projectsWithRejections,
    lines,
  };
}

/** A project's hoofdproces date (`livegangDatum`, `appreoTestdatum`) as printed, or null. */
export function projectDate(value: string): string | null {
  return value.trim() ? formatIsoDate(value) : null;
}

/** The intake as one phrase — *Intake ingepland 20-10-2026* — or null when unknown. */
export function intakeText(intake: Intake | null): string | null {
  if (!intake) return null;
  const day = intakeHasDate(intake.status) ? projectDate(intake.datum) : null;
  return day ? `${INTAKE_LABEL[intake.status]} ${day}` : INTAKE_LABEL[intake.status];
}

/**
 * The conversion type as the picker's Type column words it. Getters rather than
 * strings: each is read at the moment it is used, so the language is the one on
 * screen then, not the one at import.
 */
export const CONVERSION_TYPE_LABEL: Record<Project["conversionType"], string> = {
  get facilitair() {
    return tr("Facilitair", "Facilitated");
  },
  get dossier() {
    return "Dossier";
  },
  get standard() {
    return tr("Normaal", "Standard");
  },
};

/** The module's tone, or null for one AFAS answers no status for. */
export function rowTone(row: ProjectReportRow): ModuleStatusTone | null {
  return row.status ? moduleStatusTone(row.status) : null;
}
