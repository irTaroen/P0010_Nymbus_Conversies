"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, DatabaseZap, Hourglass, Loader2, RotateCw } from "lucide-react";
import Modal, {
  ModalSearch,
  PickerHeader,
  PickerFooter,
  PICKER_ROW_GRID,
} from "@/components/Modal";
import { useIsAdmin } from "@/components/AuthProvider";
import { useNarrowScreen } from "@/lib/narrow-screen";
import { GuardedLink } from "@/components/NavigationGuard";
import ProjectStatusPill, { REALISATIE_STATUS } from "@/components/ProjectStatusPill";
import { reloadMe, type Project } from "@/lib/auth";
import {
  isTestProject,
  isWorkable,
  matchesPickerFilter,
  matchesQuery,
  STATUS_FILTERS,
  TEST_FILTER,
  type PickerFilter,
} from "@/lib/project-filters";
import { setSession, withSessionReload } from "@/lib/session-store";
import { projectPath } from "@/lib/routes";
import { countText } from "@/lib/validation/metrics";
import { useT } from "@/lib/i18n";

/** The status switch's segments: *Realisatie*, *Afgemeld* and *TEST* — the last
 *  the test projects, which no other setting shows (`matchesPickerFilter`). *Alle*
 *  is what's left when none is on, so it needs no segment of its own. */
const PICKER_FILTERS: { id: PickerFilter; label: string }[] = [
  ...STATUS_FILTERS.filter((f) => f.id !== "all"),
  { id: TEST_FILTER, label: "TEST" },
];

/** What "dismiss" means without an `onClose`: nothing. Hoisted so `Modal`'s Escape
 *  listener isn't torn down and re-attached on every render. */
const IGNORE_DISMISS = () => {};

/** A project's two AFAS environments, in the order the *Connection* column shows
 *  them. **Live first**: it is the environment the conversion actually lands in, so
 *  it is the one an admin scanning the column is looking for — test is the
 *  precondition, live is the point. */
const AFAS_STAGES = ["live", "test"] as const;

/** The row grid below `lg`: name, then status — see {@link rowTemplate}. */
const NARROW_ROW = "max-lg:grid-cols-[minmax(0,1fr)_auto]!";

/** A column the narrow row leaves out. */
const WIDE_ONLY = "max-lg:hidden";
type AfasStage = (typeof AFAS_STAGES)[number];

/**
 * One grid shared by the column band and every row, so the cells line up under
 * their headings: `Project · Connection · Type · Status`.
 *
 * **Connection where the module categories used to be.** That column held an
 * `HRM`/`ERP` tag pair saying which kinds of module a project has — a fact you meet
 * again in the sidebar the moment you open it, and one that told an admin nothing
 * about whether the project could be worked in *now*. What does is whether its two
 * AFAS environments are set up, so the column reports that instead — to an admin;
 * see below. The module *count* was never in this column and is unaffected: it
 * stays in the row's metadata line beside the project code.
 *
 * The right-hand columns are **fixed widths, not `auto`**: each row is its own grid
 * container, so an `auto` column would size to that row's own content and the
 * columns would stagger down the list. The horizontal padding is split the same way
 * on both — the band carries all of it (`px-5`), a row inherits `px-2` from the list
 * and adds `px-3` — so the two start and end on the same pixel.
 *
 * **Connection is admin-only, and so is its column.** Whether a project's
 * credentials are stored is a fact only an admin can act on, so a client contact
 * gets neither the tags nor the heading — and the column has to leave the grid with
 * them, or every row would carry a 6.5rem hole where an admin sees `LIVE`/`TEST`.
 * Hence a template per role rather than one constant: {@link rowTemplate}.
 *
 * The template is an inline style rather than a `grid-cols-[…]` class because the
 * connection cell is sized from `AFAS_STAGES.length`: Tailwind reads class names out
 * of the source text, so a built-up class string is one it would never generate.
 *
 * Below `lg` the band and the rows drop *Connection* and *Type* and keep the name and
 * the status — what you pick a project by on a phone — so {@link NARROW_ROW} replaces
 * the template there. It is `!important` because it has to beat this inline style.
 */
function rowTemplate(withConnection: boolean) {
  return {
    gridTemplateColumns: `minmax(0,1fr) ${
      withConnection ? `${AFAS_STAGES.length * 3.25}rem ` : ""
    }5.5rem 6.5rem`,
  };
}

/**
 * Every project the session carries, as one dialog to choose from.
 *
 * A dropdown was fine while a project was a name and nothing else. It isn't any
 * more: what an admin needs to know before opening one is whether AFAS has a
 * **dossieritem** for it at all — without one the conversion hasn't been set up,
 * so the project has no hoofdproces to hand a sheet to and no modules to import,
 * and opening it lands on an empty sidebar. That fact, the project's AFAS status,
 * how many modules it holds and whether they are HRM, ERP or both don't fit on a
 * `w-72` popover row, so the choice gets the room it needs.
 *
 * The list splits into two side-by-side grids: projects that are both linked
 * (`hasDossier`) and in AFAS's *Realisatie* status — the ones there is actually
 * work to do in right now — on the left, everything else (no dossieritem, or a
 * different status) on the right with its flag where relevant. They stay in the
 * list rather than being filtered out, because a project that isn't set up or
 * isn't active is still a real project an admin may want to look at; it just says
 * so first.
 *
 * Each entry is a `GuardedLink` to the project's own page, not a setter — the open
 * project is the URL ([`lib/routes.ts`](../lib/routes.ts)) — and it lands on the
 * project page rather than on the same module under the new project: whether that
 * project even has that module takes a fetch to know.
 */
export default function ProjectPickerModal({
  projects,
  selectedProjectId,
  onClose,
}: {
  /**
   * The projects to choose from. Passed in rather than read from `useProject()`:
   * this also opens at `/`, where there is no project context yet — only a
   * session.
   */
  projects: Project[];
  /** The project already open, marked in the list. Absent at `/`, where none is. */
  selectedProjectId?: string;
  /**
   * Closes the dialog. Leave it out where there is nothing behind it (`/`): the
   * dialog is then the whole page, and picking a project is the only way on — so
   * it shows no close button and ignores Escape rather than dismissing to a blank
   * screen.
   */
  onClose?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  // Opens on *Realisatie*: the running conversions are the ones there is work in.
  // Clicking it again switches it off and shows every project.
  const [statusFilter, setStatusFilter] = useState<PickerFilter>(REALISATIE_STATUS);
  // Only the projects where a task is waiting on Nymbus — the "bij Nymbus" mark on
  // a row, turned into a filter. Combines with the search and the status switch.
  const [nymbusOnly, setNymbusOnly] = useState(false);
  const q = query.trim();

  // Refresh state. `"error"` survives only until the next attempt: the list stays
  // on screen throughout either way — a failed refresh leaves the projects it
  // already had, which are still the best answer available.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshFailed(false);
    // Writing the session is the whole update: `projects` is a prop, but it comes
    // from the same store, so every row here re-renders off this one call — as does
    // the sidebar behind the dialog.
    withSessionReload(reloadMe)
      .then(setSession)
      .catch(() => setRefreshFailed(true))
      .finally(() => setRefreshing(false));
  }, []);

  // Name *and* project code (`matchesQuery`), narrowed further by `statusFilter` before the two grids split it, so
  // picking "Afgemeld" can correctly leave "Actief in realisatie" empty — a
  // deregistered project was never workable to begin with.
  const matches = useMemo(
    () =>
      projects.filter(
        (project) =>
          matchesQuery(project, q) &&
          matchesPickerFilter(project, statusFilter) &&
          (!nymbusOnly || project.nymbusTaskCount > 0),
      ),
    [projects, q, statusFilter, nymbusOnly],
  );
  const filtered = q !== "" || statusFilter !== "all" || nymbusOnly;

  // Admins only, like the Connection column this strip explains: a client contact
  // has no settings dialog and no column, so naming the credential database to them
  // is a problem they cannot act on and reads as a broken tool.
  const showConnection = useIsAdmin();

  // Whether the settings store could be read at all, over the **whole** list rather
  // than the filtered one: it is a fact about the database, not about whichever
  // projects the search happens to be showing, and a strip that vanished when you
  // typed would look like the outage had.
  const connectionUnavailable = projects.some(
    (project) => project.afasConnection === "unavailable",
  );

  const workable = matches.filter(isWorkable);
  const rest = matches.filter((project) => !isWorkable(project));
  // Test projects aside: they only show under *TEST*, so counting them here would
  // promise more than the *Realisatie* grid holds.
  const workableTotal = projects.filter(
    (project) => isWorkable(project) && !isTestProject(project),
  ).length;

  return (
    <Modal onDismiss={onClose ?? IGNORE_DISMISS} className="max-w-6xl">
      <PickerHeader title={t("Kies een project", "Choose a project")} onClose={onClose}>
        <p className="mt-0.5 text-sm text-k-text-secondary">
          {countText(projects.length, "project", "projecten", "project", "projects")}{" "}
          {t("in AFAS, waarvan", "in AFAS, of which")}{" "}
          {workableTotal} {t("actief in realisatie", "active in realisation")}.
        </p>
      </PickerHeader>

      {/* Search and filter on **one line**, the field taking the width and the
          filter only what its three words need. Stacked full-width, the segmented
          switch put a block of solid cloud-blue the size of a hero button above the
          list — the loudest thing in a dialog whose job is to be read — and spent
          a row of height on saying "Alle". */}
      {/* Below `lg` the field takes a row of its own and the three controls follow
          under it — beside a search field on a phone they leave it no room to type. */}
      <div className="flex items-center gap-3 px-6 pb-4 max-lg:flex-wrap">
        <div className="min-w-0 flex-1 max-lg:basis-full">
          <ModalSearch
            value={query}
            onChange={setQuery}
            placeholder={t("Zoek op projectnaam of projectnummer…", "Search by project name or number…")}
            label={t("Zoek een project", "Search for a project")}
          />
        </div>

        {/* Re-read everything this dialog shows, from both of its sources: the
            projects, their statuses, dossieritems and module counts from AFAS, and
            each project's stored credentials from the settings database
            (`reloadMe()` → `GET /api/auth/me?reload=1`).

            It is here because this dialog is the only screen showing *all* the
            projects at once, and because every fact in it is one somebody else can
            change while the tab is open — a colleague setting up a deeltaak, AFAS
            moving a project to Realisatie, an admin writing credentials in another
            tab. The session is captured at login and otherwise only ever refreshed
            for its connection fields, so without this the only way to see any of
            that was to sign out and back in.

            Icon-only, at the size of the search field beside it: the dialog's own
            actions are the rows, and a labelled button here would compete with them.
            The label lives in `aria-label` and `title` instead, so it is neither
            lost to a screen reader nor to a hover. */}
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label={t("Projectgegevens verversen", "Refresh project data")}
          title={
            refreshFailed
              ? t(
                  "Verversen is niet gelukt — de lijst hieronder is nog de vorige. Probeer het opnieuw.",
                  "Refreshing failed — the list below is still the previous one. Try again."
                )
              : t(
                  "Ververs de projectgegevens uit AFAS en de instellingen-database.",
                  "Refresh the project data from AFAS and the settings database."
                )
          }
          className={`neu-button flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full pointer-coarse:h-11 pointer-coarse:w-11 ${
            refreshFailed ? "text-k-red-fg!" : ""
          }`}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          ) : (
            <RotateCw className="h-4 w-4 shrink-0" strokeWidth={2} />
          )}
        </button>

        {/* Toggle: only the projects with work waiting on Nymbus. In the row's
            own sky and hourglass, so the button reads as "the rows with that mark". */}
        <button
          type="button"
          onClick={() => setNymbusOnly((on) => !on)}
          aria-pressed={nymbusOnly}
          title={t(
            "Toon alleen projecten met taken die bij Nymbus liggen.",
            "Show only projects with tasks waiting on Nymbus."
          )}
          className={`neu-button flex h-9.5 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold pointer-coarse:h-11 ${
            nymbusOnly ? "text-k-cyan-fg!" : ""
          }`}
        >
          <Hourglass aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {t("Bij Nymbus", "With Nymbus")}
        </button>

        {/* Status filter — the same segmented switch `ProjectSettingsDialog` uses
            for its tabs, over the two statuses this tool recognises by name and the
            test projects, which only appear under their own segment. No
            *Alle* segment: with neither on, the list is unfiltered, and clicking the
            active one again switches it back off — like the *Bij Nymbus* toggle
            beside it. */}
        <div className="flex h-9.5 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm pointer-coarse:h-11">
          {PICKER_FILTERS.map((filter) => {
            const active = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatusFilter(active ? "all" : filter.id)}
                aria-pressed={active}
                className={`flex h-8 cursor-pointer items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-[box-shadow,color] duration-200 pointer-coarse:h-10 ${
                  active
                    ? "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                    : "text-k-text-tertiary hover:text-k-text-primary"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Said once, above the list, when the settings database is unreachable.

          The Connection column already says it per row — a flat `—` where a
          `LIVE`/`TEST` tag would be — but a column can only whisper, and it whispers
          in a tooltip nobody hovers. With the store down *every* row shows the dash
          at once, which reads as a column that failed to load, or worse, as
          twenty-four projects that were never set up. The cause is one fact about
          one database, so it is said once, in a sentence, where the reader is
          already looking.

          Only when at least one project says `"unavailable"`: the flag comes from
          the same read for every project, so in practice it is all or none, but
          `some` is the honest test and costs nothing. Admins only, like everything
          else in this app that names a credential store — the column itself is
          already gated the same way. */}
      {showConnection && connectionUnavailable && (
        <div
          role="status"
          className="flex items-center gap-2.5 border-t border-k-red-bg bg-k-red-bg px-6 py-2.5 text-sm text-k-red-fg"
        >
          <DatabaseZap className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">
              {t("De instellingen-database is onbereikbaar", "The settings database is unreachable")}
            </span>{" "}
            {t(
              "— of deze projecten een AFAS-koppeling hebben, is nu onbekend.",
              "— whether these projects have an AFAS connection is unknown for now."
            )}
          </span>
        </div>
      )}

      {/* Stacked below `lg`, one grid over the other: side by side, each got half a
          phone and a project name had nothing left to show itself in. */}
      <div className="grid grid-cols-2 divide-x divide-k-divider border-t border-k-divider max-lg:grid-cols-1 max-lg:divide-x-0 max-lg:divide-y">
        <GridColumn
          title={t("Actief in realisatie", "Active in realisation")}
          hint={t(
            "Dossieritem aanwezig en status Realisatie in AFAS.",
            "Dossier item present and status Realisation in AFAS."
          )}
          projects={workable}
          query={query}
          selectedProjectId={selectedProjectId}
          onPick={onClose}
        />
        <GridColumn
          title={t("Overige projecten", "Other projects")}
          hint={t(
            "Geen dossieritem, of een andere status dan Realisatie.",
            "No dossier item, or a status other than Realisation."
          )}
          projects={rest}
          query={query}
          selectedProjectId={selectedProjectId}
          onPick={onClose}
        />
      </div>

      <PickerFooter
        count={
          filtered
            ? `${matches.length} ${t("van", "of")} ${countText(projects.length, "project", "projecten", "project", "projects")}`
            : countText(projects.length, "project", "projecten", "project", "projects")
        }
        onClose={onClose}
      />
    </Modal>
  );
}

/**
 * One of the two side-by-side grids: its own heading, its own column band (so
 * Modules/Status still line up with the rows directly under them), and its own
 * independently scrolling list — a project moving between grids as its status
 * changes shouldn't fight the other grid's scroll position.
 *
 * Always renders, even at zero rows: the two grids are a fixed layout, not
 * sections that come and go, so an empty one says so in place rather than
 * collapsing and leaving the other to fill the width on its own.
 */
function GridColumn({
  title,
  hint,
  projects,
  query,
  selectedProjectId,
  onPick,
}: {
  title: string;
  hint: string;
  projects: Project[];
  query: string;
  selectedProjectId?: string;
  onPick?: () => void;
}) {
  // The *Connection* column is admin-only, so its heading and the grid track that
  // holds it come and go together — see {@link rowTemplate}. Read here rather than
  // passed down from the dialog: the rule is about the column, and `ProjectRow`
  // asks the same question for the same reason.
  const t = useT();
  const showConnection = useIsAdmin();
  // On a phone the picker is opened to pick up Nymbus's own work, so the projects
  // with tasks waiting on Nymbus lead each grid, most first. Sorted rather than
  // filtered: the rest stay underneath, in their usual order (*Bij Nymbus* still
  // filters, for whoever wants only those).
  const narrow = useNarrowScreen();
  const shown = narrow
    ? [...projects].sort((a, b) => b.nymbusTaskCount - a.nymbusTaskCount)
    : projects;
  return (
    <div className="flex min-w-0 flex-col">
      {/* The count as a pill beside the title rather than a bare number after it:
          two of these headings sit side by side, and the figure is what tells them
          apart at a glance. */}
      <div className="px-5 pb-3 pt-3.5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-k-text-primary">
          {title}
          <span className="rounded-full bg-k-bg px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-k-text-secondary tabular-nums">
            {projects.length}
          </span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-k-text-tertiary">{hint}</p>
      </div>

      {/* Column band — the quiet `bg-k-tint` one `CodetabelPicker` uses, a size
          smaller than the group heading above it so the two read as heading and
          then labels rather than as two headings.

          The three fixed-width columns centre their heading, `Project` alone stays
          left. Those cells hold one chip each, drawn centred in a column wider than
          it is; a heading pinned to the cell's left edge then floated away from the
          thing it names, and over `Status` it sat nearer the Type chips than its
          own. Project is the one column whose content genuinely starts at the left
          edge — a name that truncates — so its heading starts there too. */}
      <div
        aria-hidden="true"
        style={rowTemplate(showConnection)}
        className={`${PICKER_ROW_GRID} ${NARROW_ROW} border-y border-k-divider bg-k-tint px-5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-k-text-secondary`}
      >
        <span>Project</span>
        {showConnection && <span className={`text-center ${WIDE_ONLY}`}>Connection</span>}
        <span className={`text-center ${WIDE_ONLY}`}>Type</span>
        <span className="text-center">Status</span>
      </div>

      {/* The list fades out at its bottom edge instead of cutting a row in half:
          a scroll area whose last visible row is sliced through the middle reads
          as a layout that ran out of room rather than as one there is more of. */}
      <div className="relative">
        {/* Height off the **viewport**, not just a fixed `rem`: the dialog has a
            header, a search row, two group headings and a footer above and below
            these lists, and a fixed 24rem list put the footer under the fold of a
            laptop screen. `min()` keeps the roomier of the two on a big display. */}
        {/* Below `lg` the lists don't scroll themselves: stacked, two scroll areas
            inside a scrolling sheet left a finger guessing which one it would move. */}
        <ul className="max-h-[min(24rem,42vh)] space-y-0.5 overflow-y-auto px-2 py-2 max-lg:max-h-none max-lg:overflow-visible">
          {projects.length === 0 ? (
            <li className="px-3 py-12 text-center text-sm text-k-text-tertiary">
              {query
                ? t(`Geen project gevonden voor “${query}”.`, `No project found for “${query}”.`)
                : t("Geen projecten in deze groep.", "No projects in this group.")}
            </li>
          ) : (
            shown.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  active={project.id === selectedProjectId}
                  onPick={onPick}
                />
              </li>
            ))
          )}
        </ul>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-k-bg to-transparent max-lg:hidden"
        />
      </div>
    </div>
  );
}

/**
 * One project across the columns: name over its project code and module count
 * (or the flag that there is no dossieritem behind it), a tag per AFAS environment
 * for an admin, the conversion type, and the project's AFAS status.
 *
 * Every badge in the row is the **same soft-tinted chip** — one ink at `/10` fill,
 * `/30` border and full strength for the letters — so nothing in it shouts: the
 * category tags, the dossieritem flag and the status all read as tinted labels,
 * and what tells them apart is size, shape and place rather than volume. An
 * unlinked, deregistered project used to carry a solid orange chip in its second
 * line *and* a solid red one at its end, which made the noisiest rows in the
 * dialog the ones with the least to offer. The flag carries the **same red as
 * Afgemeld** (the `--k-red-*` pair) rather than an amber of its own: no dossieritem
 * and a deregistered status are the same kind of fact about a row — a reason there
 * is nothing to do in this project — and two warm hues in one row only ask the
 * reader to work out which of them outranks the other. It stays a size down from
 * the status pill and inside the row's quiet metadata line, so the two still read
 * as a detail and a verdict rather than as the same claim made twice.
 */
/* The metadata line used to carry a **Geen AFAS-koppeling** chip as well. The
   Connection column says the same thing better — per environment rather than rolled
   into one word, in a column of its own rather than a chip that wrapped the line
   onto two — so the chip went and the line is back to `501243 · 11 modules`. The
   fact still gets a band with a button on the project's own page
   (`AfasConnectionNotice`), which is where somebody can act on it. */
function ProjectRow({
  project,
  active,
  onPick,
}: {
  project: Project;
  active: boolean;
  onPick?: () => void;
}) {
  // Same gate as the column band above it, asked the same way: a row whose grid
  // disagreed with the band's would stagger every cell one column across.
  const t = useT();
  const showConnection = useIsAdmin();
  return (
    /* `onClick` closes the dialog rather than `onNavigate`, so it also gets out of
       the way when the guard stops the navigation and puts the leave prompt on
       screen. Not prefetched: the page is client-rendered, so there is nothing to
       fetch ahead of a click. */
    <GuardedLink
      href={projectPath(project.id)}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      onClick={onPick}
      style={rowTemplate(showConnection)}
      className={`${PICKER_ROW_GRID} ${NARROW_ROW} w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-colors pointer-coarse:py-3 ${
        active
          ? "bg-k-cloud-light/40 shadow-inset-sm"
          : "hover:bg-k-tint"
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block truncate text-sm font-medium ${
            active ? "text-k-cloud-deep" : "text-k-text-primary"
          }`}
        >
          {project.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-k-text-secondary">
          <span className="tabular-nums">{project.id}</span>
          {project.hasDossier ? (
            <>
              <span aria-hidden="true" className="text-k-text-tertiary">
                ·
              </span>
              <span className="tabular-nums">
                {countText(project.moduleCount, "module", "modules", "module", "modules")}
              </span>
              {/* Whose turn it is, summed: the sidebar's per-module hourglass, in
                  the same sky, counted over the project — where Nymbus's own work
                  is waiting. Absent at 0, so the mark only shows where there is any. */}
              {project.nymbusTaskCount > 0 && (
                <>
                  <span aria-hidden="true" className="text-k-text-tertiary">
                    ·
                  </span>
                  <span
                    className="inline-flex items-center gap-1 font-medium text-k-cyan-fg"
                    title={`${countText(project.nymbusTaskCount, "taak ligt", "taken liggen", "task is", "tasks are")} ${t("bij Nymbus", "with Nymbus")}`}
                  >
                    <Hourglass aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2} />
                    <span className="tabular-nums">
                      {project.nymbusTaskCount} {t("bij Nymbus", "with Nymbus")}
                    </span>
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-k-red-bg px-1.5 py-0.5 text-[10px] font-semibold text-k-red-fg shadow-inset-sm">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
              {t("Geen modules", "No modules")}
            </span>
          )}
        </span>
      </span>

      {/* Both stages always drawn, for every project an **admin** sees — including
          one with no dossieritem. Unlike the module categories this cell replaced, a
          connection is not downstream of AFAS having scoped the project: an admin
          can fill in credentials for a project AFAS hasn't set up yet, and the two
          gaps are worth seeing apart rather than one hiding the other behind a
          dash. A client contact gets no cell at all, not an empty pair of outlines:
          there is nothing they can do about a stage that isn't set up, and two grey
          `LIVE`/`TEST` husks over every row would read as a tool that is switched
          off. */}
      {showConnection && (
        <span className={`flex gap-1 ${WIDE_ONLY}`}>
          {AFAS_STAGES.map((stage) => (
            <StageTag
              key={stage}
              stage={stage}
              configured={project.afasStages[stage]}
              unknown={project.afasConnection === "unavailable"}
            />
          ))}
        </span>
      )}

      {/* Both chips centred in their cell, under a centred heading — a chip pinned
          left in a cell wider than it is left a ragged gutter down the list and
          pulled each one away from the word naming it. */}
      <span className={`flex min-w-0 justify-center ${WIDE_ONLY}`}>
        <ConversionTypeTag conversionType={project.conversionType} />
      </span>

      <span className="flex min-w-0 justify-center">
        <ProjectStatusPill status={project.status} />
      </span>
    </GuardedLink>
  );
}

const CONVERSION_TYPE_LABEL: Record<Project["conversionType"], { nl: string; en: string }> = {
  facilitair: { nl: "Facilitair", en: "Facilities" },
  dossier: { nl: "Dossier", en: "Dossier" },
  standard: { nl: "Normaal", en: "Standard" },
};

/**
 * A project's conversion type, off AFAS's hoofdproces dossieritem
 * (`project.conversionType`), in the **Type** column of the band. Same soft-tinted
 * chip as `CategoryTag`, so a third kind of fact about the project doesn't reach
 * for a hue of its own.
 *
 * All three types are drawn, `"standard"` included. It used to sit inline in the
 * row's metadata line and render nothing for `"standard"`, on the reasoning that
 * the common case isn't worth a tag — which held while it was a chip floating
 * beside the project code, and stops holding the moment the fact gets a column of
 * its own: a heading over a cell that is empty in most rows reads as data that
 * failed to load, not as "nothing to say here". So `"standard"` draws too, as
 * **Normaal** in `CategoryTag`'s quiet outline rather than the brand tint — present
 * and readable, but leaving the cloud-blue to the two types that mean the project is
 * converted a different way.
 */
function ConversionTypeTag({ conversionType }: { conversionType: Project["conversionType"] }) {
  const t = useT();
  const standard = conversionType === "standard";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-inset-sm ${
        standard
          ? "text-k-text-tertiary"
          : "bg-k-cloud-light/40 text-k-cloud-deep"
      }`}
    >
      {t(CONVERSION_TYPE_LABEL[conversionType].nl, CONVERSION_TYPE_LABEL[conversionType].en)}
    </span>
  );
}

/**
 * Whether **one** of a project's two AFAS environments is set up, as a tag carrying
 * that environment's name — tinted cloud-blue when it is, a flat inset well
 * in `text-k-text-tertiary` when it isn't. Both states are drawn, never one left blank: the
 * answer *no* is worth as much here as *yes*, and a gap would read as a column that
 * failed to load.
 *
 * **What "set up" means, exactly.** `project.afasStages` says whether an
 * omgevingsnummer and that stage's client id + secret are *stored* — not whether
 * AFAS accepts them. Knowing that takes a real call per stage per project
 * (`ProjectSettingsDialog`'s *Verbinding testen*), and a session that carries every
 * project for an admin can't make fifty of them before the picker can render. So the
 * chip promises only what it can know, and its tooltip says *ingesteld* rather than
 * *werkt* so nobody reads a stored typo as a working token.
 *
 * `role="img"` with the stage in its label, so a screen reader hears *live: ingesteld*
 * rather than a bare "LIVE" it would have to interpret — the same treatment the
 * category tags this replaced were given, for the same reason.
 */
function StageTag({
  stage,
  configured,
  unknown,
}: {
  stage: AfasStage;
  configured: boolean;
  unknown: boolean;
}) {
  const t = useT();
  // `configured` is a boolean and an unreadable settings store has no third value
  // for it, so it arrives `false` — the same shape as *niet ingesteld*, and a
  // different fact. Drawn as a dash rather than the empty well: the well is a
  // claim ("this one isn't set up"), and here the honest answer is that the column
  // could not be read. `project.afasConnection` is what tells the two apart.
  if (unknown) {
    return (
      <span
        role="img"
        aria-label={t(`${stage}: onbekend, instellingen niet te lezen`, `${stage}: unknown, settings could not be read`)}
        title={t(
          `De projectinstellingen zijn nu niet te lezen, dus of de ${stage}-omgeving is ingesteld is onbekend. Dit betekent niet dat er niets is ingesteld.`,
          `The project settings cannot be read right now, so whether the ${stage} environment is set up is unknown. This does not mean nothing is set up.`
        )}
        className="flex flex-1 items-center justify-center rounded-full bg-k-bg py-0.5 text-[10px] font-bold uppercase tracking-wide text-k-text-tertiary shadow-inset-sm"
      >
        —
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={t(
        `${stage}: ${configured ? "ingesteld" : "niet ingesteld"}`,
        `${stage}: ${configured ? "set up" : "not set up"}`
      )}
      title={
        configured
          ? t(
              `De ${stage}-omgeving van dit project is ingesteld — omgevingsnummer, client id en client secret zijn opgeslagen. Of AFAS ze accepteert, test je in de projectinstellingen.`,
              `The ${stage} environment of this project is set up — environment number, client id and client secret are stored. Whether AFAS accepts them, you test in the project settings.`
            )
          : t(
              `De ${stage}-omgeving van dit project is niet ingesteld.`,
              `The ${stage} environment of this project is not set up.`
            )
      }
      className={`flex flex-1 items-center justify-center rounded-full py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-inset-sm ${
        configured
          ? "bg-k-cloud-light/40 text-k-cloud-deep"
          : "text-k-text-tertiary"
      }`}
    >
      {stage}
    </span>
  );
}
