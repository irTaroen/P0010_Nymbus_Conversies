/**
 * How a list of projects is narrowed down — the search and the status switch the
 * project picker opens with, and the managementrapport's project list reuses.
 *
 * One definition for both, because the managementrapport is opened *from* the
 * picker with the filter the admin already set there (`managementReportPath()` in
 * [routes.ts](./routes.ts)): if the two screens read "Realisatie" or a search
 * differently, the report would start from a different set of projects than the one
 * that was on screen when the button was pressed.
 */

import type { Project } from "@/lib/auth";
import { AFGEMELD_STATUS, REALISATIE_STATUS } from "@/components/ProjectStatusPill";
import { tr } from "@/lib/i18n";

export type StatusFilter = "all" | typeof REALISATIE_STATUS | typeof AFGEMELD_STATUS;

/*
 * The labels are getters, not strings: `tr()` has to be asked when a label is read,
 * not once at import. Read them at the use site (in render), never spread or copy
 * the objects into a module-level constant — a spread reads the getter then and
 * freezes the Dutch.
 */
export const STATUS_FILTERS: { id: StatusFilter; readonly label: string }[] = [
  { id: "all", get label() { return tr("Alle", "All"); } },
  { id: REALISATIE_STATUS, get label() { return tr("Realisatie", "In progress"); } },
  { id: AFGEMELD_STATUS, get label() { return tr("Afgemeld", "Closed"); } },
];

/** A `status` query value back as a filter, `"all"` for anything it doesn't name. */
export function parseStatusFilter(value: string | null | undefined): StatusFilter {
  return STATUS_FILTERS.find((f) => f.id === value)?.id ?? "all";
}

export function matchesStatusFilter(project: Project, filter: StatusFilter): boolean {
  return filter === "all" || project.status.trim().toLowerCase() === filter;
}

/**
 * The picker's own extra segment, after *Realisatie* and *Afgemeld*: the test
 * projects. Not one of `STATUS_FILTERS`, because it isn't a status — a test project
 * has an AFAS status like any other — and because the managementrapport, which
 * shares those, never shows test projects at all.
 */
export const TEST_FILTER = "test";

export type PickerFilter = StatusFilter | typeof TEST_FILTER;

/**
 * The picker's filter: under *TEST* the test projects and nothing else, under any
 * other setting (*Alle* included) everything **but** them — a sandbox only shows
 * when it is asked for.
 */
export function matchesPickerFilter(project: Project, filter: PickerFilter): boolean {
  if (filter === TEST_FILTER) return isTestProject(project);
  return !isTestProject(project) && matchesStatusFilter(project, filter);
}

/** Name *and* project code: the code is what a colleague pastes into chat. */
export function matchesQuery(project: Project, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    project.name.toLowerCase().includes(q) ||
    project.id.toLowerCase().includes(q)
  );
}

/**
 * A project there is actually work to do in right now: AFAS holds a dossieritem for
 * it and it is in *Realisatie*. The picker's left grid.
 */
export function isWorkable(project: Project): boolean {
  return project.hasDossier && project.status.trim().toLowerCase() === REALISATIE_STATUS;
}

/**
 * A project that exists to try the tool out rather than to convert a client — the
 * *Testproject* box in its projectinstellingen (`Project.testProject`). The
 * managementrapport leaves these out altogether: it is presented to project
 * managers as the state of the clients, and a sandbox in that list skews every
 * total. The project picker keeps them under its own *TEST* switch, since opening
 * one is the point.
 */
export function isTestProject(project: Project): boolean {
  return project.testProject === true;
}
