/**
 * Every URL the app has, and the only place that knows their shape.
 *
 *     /                       pick up the user's first project and go there
 *     /{projectId}            the project — module list in the sidebar, nothing open
 *     /{projectId}/{moduleId} one module of that project: its uploader
 *     /afas/updateconnectors  what an AFAS UpdateConnector accepts (admins)
 *     /voortgang              the managementrapport over several projects (admins)
 *
 * The module segment is the **catalog id** from [`lib/modules.tsx`](./modules.tsx)
 * (`hrm-medewerkers`) — the id the rule set, the help and the mapping file share.
 *
 * Build paths through these helpers rather than interpolating: the guard in
 * [`NavigationGuard`](../components/NavigationGuard.tsx) compares what it is handed
 * against `usePathname()`, and it can only do that while both sides are spelled the
 * same way.
 */

/** The app's front door: no project yet — it forwards to the user's first one. */
export const HOME_PATH = "/";

/** A project's own page — its modules in the sidebar, no sheet open. */
export function projectPath(projectId: string): string {
  return `/${encodeURIComponent(projectId)}`;
}

/** One module of one project: the page that reads, checks and sends its sheet. */
export function modulePath(projectId: string, moduleId: string): string {
  return `${projectPath(projectId)}/${encodeURIComponent(moduleId)}`;
}

/**
 * The query parameter naming which reading of the open sheet is on screen — the
 * grid, or the AFAS bodies it would produce (`SheetView` in
 * [`SheetToolbar`](../components/uploader/SheetToolbar.tsx)).
 *
 * A **query param, not a path segment**, and that is the whole of the choice: the
 * page is the same page either way, holding the same workbook. A third segment would
 * be a different address for the module — it would remount the uploader and throw
 * away the sheet on screen, which is exactly the thing a view switch must not do.
 * `data` is the default and is left out of the URL entirely, so an ordinary module
 * link is unchanged.
 */
export const SHEET_VIEW_PARAM = "view";

/** A module with one of its views open — `data` yields the plain module path. */
export function moduleViewPath(
  projectId: string,
  moduleId: string,
  view: string
): string {
  const path = modulePath(projectId, moduleId);
  if (view === "data") return path;
  return `${path}?${new URLSearchParams({ [SHEET_VIEW_PARAM]: view })}`;
}

/**
 * The query parameter naming the project's custom module (maatwerk) the payload view
 * shows instead of the module itself ([`custom-modules.ts`](./custom-modules.ts)). A query param for the same reason as
 * `SHEET_VIEW_PARAM`: it is the same page holding the same sheet, and a custom module
 * has no sheet of its own — it reads the one open under its parent.
 */
export const PAYLOAD_STEP_PARAM = "stap";

/**
 * A custom module's own payload view — how the sidebar's *Maatwerk* entries link: to
 * their parent module's address (whose sheet they read), showing only themselves.
 */
export function payloadStepPath(
  projectId: string,
  moduleId: string,
  stepId: string
): string {
  const params = new URLSearchParams({
    [SHEET_VIEW_PARAM]: "payloads",
    [PAYLOAD_STEP_PARAM]: stepId,
  });
  return `${modulePath(projectId, moduleId)}?${params}`;
}

/**
 * The UpdateConnector explorer (admins): the payload an AFAS connector accepts, read
 * from its metainfo. Static segments win over `[project]`, so this address can never
 * be taken for a project id — and it names no project on purpose, since the schemas
 * behind it are Nymbus's own: the live environment for the dossier connectors, and the
 * **test** one for the module connectors, which is the template every customer
 * environment is a copy of.
 *
 * It is no longer the only way in. The sidebar row and the payload view's *Koppeling*
 * button open the same explorer in a dialog over whatever is on screen
 * (`UpdateConnectorsDialog`), because navigating there would unmount an open sheet.
 * This address stays for when the explorer *is* the work rather than a detour from
 * it: a real URL, linkable and refreshable.
 */
export const UPDATE_CONNECTORS_PATH = "/afas/updateconnectors";






/**
 * The managementrapport (admins): where every selected client's conversion stands,
 * module by module, on one page — the overview a project manager is shown. A static
 * segment, same reasoning as `UPDATE_CONNECTORS_PATH`: it beats `[project]`, and it
 * names no project because it is about several.
 */
export const MANAGEMENT_REPORT_PATH = "/voortgang";

/**
 * The managementrapport, opened with the project picker's filter carried over — how
 * "generate it from here" keeps the list the admin had already narrowed down. Both
 * are left out of the URL when they are the default, so the plain address stays
 * `/voortgang`.
 */
export function managementReportPath(filter?: { query?: string; status?: string }): string {
  const params = new URLSearchParams();
  const query = filter?.query?.trim();
  if (query) params.set("q", query);
  if (filter?.status && filter.status !== "all") params.set("status", filter.status);
  const search = params.toString();
  return search ? `${MANAGEMENT_REPORT_PATH}?${search}` : MANAGEMENT_REPORT_PATH;
}

/**
 * A link to the explorer that remembers which project sent it there, so its "terug"
 * arrow can return to that project instead of always falling back to `HOME_PATH` —
 * which reopens the project picker for an admin with more than one, undoing the
 * choice they'd already made. `fromProjectId` travels as a query param rather than
 * a path segment: the explorer itself still names no project (see
 * `UPDATE_CONNECTORS_PATH`), this is only where "back" leads.
 */
export function updateConnectorsPath(
  fromProjectId?: string | null,
  /**
   * Open this connector on arrival instead of the first one in the list — how the
   * payload view's *Updateconnectors* button lands on the connector whose body is
   * on screen rather than on whatever sorts first. Its `group` is always `modules`:
   * a module's payload can only ever be built from a module connector.
   */
  connector?: string | null
): string {
  const params = new URLSearchParams();
  if (fromProjectId) params.set("from", fromProjectId);
  if (connector) params.set("connector", connector);
  const query = params.toString();
  return query ? `${UPDATE_CONNECTORS_PATH}?${query}` : UPDATE_CONNECTORS_PATH;
}

/** What a path points at. Either id is null when the path doesn't carry it. */
export interface AppRoute {
  projectId: string | null;
  moduleId: string | null;
}

/**
 * Read a path back into the project and module it names — how code holding only an
 * href (the navigation guard, which is handed one and has to say where it leads)
 * gets at the ids behind it. Anything deeper than the two segments is ignored, and a
 * path this app doesn't serve simply yields nulls rather than throwing.
 */
export function parseAppPath(path: string): AppRoute {
  const [pathname] = path.split(/[?#]/, 1);
  let segments: string[];
  try {
    segments = pathname
      .split("/")
      .filter((segment) => segment !== "")
      .map(decodeURIComponent);
  } catch {
    // A malformed escape (`/%E0%A4%A`) is a path this app doesn't serve, not an
    // error for the navigation guard to trip over.
    return { projectId: null, moduleId: null };
  }
  const [projectId, moduleId] = segments;
  return { projectId: projectId ?? null, moduleId: moduleId ?? null };
}
