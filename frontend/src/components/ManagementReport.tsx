"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  FileDown,
  ListChecks,
  Loader2,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminOnly from "@/components/AdminOnly";
import { useAuth, useIsManager } from "@/components/AuthProvider";
import Modal, { ModalSearch, PickerFooter, PickerHeader } from "@/components/Modal";
import Checkbox from "@/components/Checkbox";
import { GuardedLink } from "@/components/NavigationGuard";
import ModuleReportTable, { Empty } from "@/components/ModuleReportTable";
import PhaseTurnLegend from "@/components/PhaseTurnLegend";
import SendRefusals from "@/components/SendRefusals";
import ProjectStatusPill from "@/components/ProjectStatusPill";
import type { Project } from "@/lib/auth";
import {
  buildManagementSummary,
  CONVERSION_TYPE_LABEL,
  fetchProjectReport,
  projectDate,
  type ManagementLine,
  type ManagementSummary,
} from "@/lib/management-report";
import { PHASE_FILL, STATUS_TONE_FILL, type ModuleStatusTone } from "@/lib/modules";
import {
  isTestProject,
  matchesQuery,
  matchesStatusFilter,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/lib/project-filters";
import {
  DEFAULT_INTAKE,
  fetchAllIntakes,
  INTAKE_LABEL,
  intakeHasDate,
  type Intake,
  type IntakeStatus,
} from "@/lib/intake";
import { formatCheckedAt } from "@/lib/project-progress";
import { DEADLINE_WINDOW_DAYS, segmentsLabel, type ProjectReport } from "@/lib/project-report";
import { HOME_PATH, projectPath } from "@/lib/routes";
import { countText } from "@/lib/validation/metrics";
import { usePdfDownload } from "@/components/usePdfDownload";
import { tr, useT } from "@/lib/i18n";

/** Quiet neutral pill — the same class string `ProjectReport`'s PDF button wears. */
const HEADER_BTN =
  "neu-button inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium disabled:cursor-wait";

const CARD = "rounded-2xl bg-k-bg shadow-raised";

/**
 * How many projects load at once. Each one is two backend calls that each read the
 * project's deeltaken from AFAS, so selecting twenty-five projects would otherwise
 * put fifty AFAS reads in flight in one go.
 */
const CONCURRENCY = 4;

/**
 * The report's status switch: *Realisatie* and *Afgemeld* only. The picker's
 * *Alle* is left out on purpose — this page is presented as either the running
 * conversions or the finished ones, and a mix of both makes every total mean
 * neither. A picker handing over *Alle* lands on *Realisatie*.
 */
const REPORT_FILTERS = STATUS_FILTERS.filter((f) => f.id !== "all");
const DEFAULT_REPORT_FILTER = REPORT_FILTERS[0].id;

function reportFilter(filter: StatusFilter): StatusFilter {
  return REPORT_FILTERS.some((f) => f.id === filter) ? filter : DEFAULT_REPORT_FILTER;
}

type LoadState =
  | { state: "ready"; report: ProjectReport }
  | { state: "error"; message: string };

/**
 * The managementrapport: pick projects on the left with the project picker's own
 * search and status switch, read where each of them stands on the right.
 *
 * Each ticked project is loaded on its own, as it is ticked — its modules and their
 * AFAS status, and the last check per module — and built into the same
 * `ProjectReport` its project page shows. The figures across the top are a sum of
 * those; nothing here counts anything itself (see
 * [`lib/management-report.ts`](../lib/management-report.ts)).
 *
 * **The filter narrows the report as well as the list.** What the right pane shows is
 * exactly what is ticked *and* visible on the left, so switching to *Realisatie*
 * never leaves an *Afgemeld* card standing in the report. A tick a filter hides is
 * kept rather than cleared — widen the filter again and it is back — but it is
 * neither loaded nor reported while hidden.
 */
export default function ManagementReport({
  initialQuery,
  initialStatus,
}: {
  initialQuery: string;
  initialStatus: StatusFilter;
}) {
  const { session } = useAuth();
  const t = useT();
  const isManager = useIsManager();
  // Test projects never reach the report — not even as a line to untick; see
  // `isTestProject()`.
  const projects = useMemo(
    () => (session?.projects ?? []).filter((p) => !isTestProject(p)),
    [session],
  );
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const [query, setQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => reportFilter(initialStatus));
  const visible = useMemo(
    () =>
      projects.filter(
        (p) => matchesQuery(p, query) && matchesStatusFilter(p, statusFilter),
      ),
    [projects, query, statusFilter],
  );

  // Starts with **every** project ticked, whatever its status and whether or not it
  // has a dossieritem — the status switch decides which half is on screen, so both
  // halves have to be ticked already or flipping it shows an empty report. A
  // project without a dossieritem costs no AFAS read (see `fetchProjectReport()`),
  // and only the visible half is loaded. Narrowing further is *Kiezen*'s job.
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        projects
          .filter((p) => matchesQuery(p, initialQuery))
          .map((p) => p.id),
      ),
  );

  // --- Loading ---------------------------------------------------------------
  // What has come back, per project. A selected project with no entry is loading.
  // The in-flight set lives in a ref because it is bookkeeping for the effect only
  // — render never reads it (the React Compiler forbids that), it reads `loaded`.
  const [loaded, setLoaded] = useState<Map<string, LoadState>>(() => new Map());
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);

  // What the report is over: ticked *and* matching the filter. Only these load —
  // a hidden tick costs no AFAS reads.
  const reportIds = useMemo(
    () => visible.filter((p) => selected.has(p.id)).map((p) => p.id),
    [visible, selected],
  );

  useEffect(() => {
    const missing = reportIds.filter(
      (id) => !loaded.has(id) && !inFlight.current.has(id) && byId.has(id),
    );
    if (missing.length === 0) return;
    missing.forEach((id) => inFlight.current.add(id));
    const gen = generation.current;
    const queue = [...missing];

    async function worker() {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        // A refresh since this worker started: the rest of its queue is the
        // refresh's now, which has queued its own — stop rather than read AFAS for
        // projects whose answers would only be dropped below.
        if (gen !== generation.current) return;
        let result: LoadState;
        try {
          result = { state: "ready", report: await fetchProjectReport(byId.get(id)!) };
        } catch (error) {
          result = {
            state: "error",
            message: error instanceof Error ? error.message : tr("Laden is mislukt.", "Loading failed."),
          };
        }
        // A refresh since this started makes the answer stale: drop it, the
        // refresh has already queued its own.
        if (gen !== generation.current) continue;
        inFlight.current.delete(id);
        const done = result;
        setLoaded((prev) => new Map(prev).set(id, done));
      }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, missing.length); i++) void worker();
  }, [reportIds, loaded, byId]);

  // Drop one project's answer so the loader fetches it again.
  const retry = useCallback((id: string) => {
    setLoaded((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Every project's intake, in one read for the whole page — ours rather than
  // AFAS's (`lib/intake.ts`), so it rides beside the per-project loads instead of
  // in them. Null while out or after a failure: a line then shows no intake rather
  // than a default it can't vouch for. `intakeRound` re-runs it on *Verversen*.
  const [intakes, setIntakes] = useState<Map<string, Intake> | null>(null);
  const [intakeRound, setIntakeRound] = useState(0);
  useEffect(() => {
    let current = true;
    fetchAllIntakes()
      .then((map) => {
        if (current) setIntakes(map);
      })
      .catch(() => {
        if (current) setIntakes(null);
      });
    return () => {
      current = false;
    };
  }, [intakeRound]);

  const refresh = useCallback(() => {
    generation.current++;
    inFlight.current.clear();
    setLoaded(new Map());
    setIntakes(null);
    setIntakeRound((n) => n + 1);
  }, []);

  // --- Selection ---------------------------------------------------------------
  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);


  function toggleVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  // --- The report ----------------------------------------------------------------
  // In the list's own order (the session's), not the order the boxes were ticked:
  // a report that reshuffles as it loads is hard to present from.
  const selectedProjects = visible.filter((p) => selected.has(p.id));
  const entries = selectedProjects.flatMap((project) => {
    const state = loaded.get(project.id);
    const intake = intakes ? (intakes.get(project.id) ?? DEFAULT_INTAKE) : null;
    return state?.state === "ready" ? [{ project, report: state.report, intake }] : [];
  });
  const failed = selectedProjects.filter((p) => loaded.get(p.id)?.state === "error");
  const pending = selectedProjects.length - entries.length - failed.length;
  const summary = buildManagementSummary(entries);

  const [choosing, setChoosing] = useState(false);
  const closeChooser = useCallback(() => setChoosing(false), []);

  // --- Scroll spy --------------------------------------------------------------
  // The rail highlights the client card being read: the **last card whose top has
  // passed the top of the pane**, the way a section nav reads — or the last card
  // outright once the page is scrolled to the bottom, where a short final card can
  // never reach the top. Measured on the page's own scroll container (this
  // component's root); the window never scrolls here.
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  // The sticky header's height and the pane's, as CSS variables on the scroll root
  // (`--head`, `--pane`), kept current as either resizes — the header grows when
  // the totals wrap, the pane with the window. Written to the DOM, not state: they
  // are layout inputs for CSS, and a re-render per resize would be wasted.
  useEffect(() => {
    const root = scrollRef.current;
    const head = headRef.current;
    if (!root || !head) return;
    const observer = new ResizeObserver(() => {
      const sticky = getComputedStyle(head).position === "sticky";
      root.style.setProperty("--head", sticky ? `${head.offsetHeight - 24}px` : "0px");
      root.style.setProperty("--pane", `${root.clientHeight}px`);
    });
    observer.observe(head);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  /**
   * How much of the pane's top the sticky header covers — its real bottom edge,
   * measured, rather than `--head`: a sticky inset counts from inside the pane's
   * padding, so the two differ by that padding. Zero where the header doesn't stick.
   */
  function stickyOffset(root: HTMLElement): number {
    const head = headRef.current;
    if (!head || getComputedStyle(head).position !== "sticky") return 0;
    return Math.max(0, head.getBoundingClientRect().bottom - root.getBoundingClientRect().top);
  }
  const [spiedId, setSpiedId] = useState<string | null>(null);
  // A project clicked in the rail stays the active one while its smooth scroll
  // runs and after it lands — even at the bottom, where the rule above would name
  // the last card — until the reader scrolls by hand.
  const pinned = useRef<string | null>(null);
  const cardIds = selectedProjects
    .filter((p) => loaded.has(p.id))
    .map((p) => p.id)
    .join(",");

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || cardIds === "") return;
    const ids = cardIds.split(",");
    let frame = 0;
    function update() {
      frame = 0;
      if (pinned.current) return;
      const line = root!.getBoundingClientRect().top + stickyOffset(root!) + 96;
      const atBottom = root!.scrollTop + root!.clientHeight >= root!.scrollHeight - 4;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(`project-${id}`);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      if (atBottom && root!.scrollTop > 0) current = ids[ids.length - 1];
      setSpiedId(current);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function release() {
      pinned.current = null;
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("wheel", release, { passive: true });
    root.addEventListener("touchstart", release, { passive: true });
    root.addEventListener("keydown", release);
    return () => {
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("wheel", release);
      root.removeEventListener("touchstart", release);
      root.removeEventListener("keydown", release);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cardIds]);

  // Only a card that is in the report can be active — a filter change can take the
  // spied one away before the observer has anything new to say.
  const activeId = spiedId && cardIds.split(",").includes(spiedId) ? spiedId : null;

  const navigateTo = useCallback((id: string) => {
    pinned.current = id;
    // The page's own container, scrolled by hand — not `scrollIntoView`, which,
    // when this container can't bring a short last card to the top, goes on to
    // scroll the app shell's `overflow-hidden` frames and shifts the whole layout.
    const root = scrollRef.current;
    const el = document.getElementById(`project-${id}`);
    if (root && el) {
      const top =
        el.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        stickyOffset(root) -
        16;
      root.scrollTo({ top, behavior: "smooth" });
    }
    setSpiedId(id);
  }, []);

  const [pdf, savePdf] = usePdfDownload(async () => {
    const { downloadManagementReportPdf } = await import("@/lib/management-report-pdf");
    await downloadManagementReportPdf(summary);
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      {choosing && (
        <ProjectChooser
          visible={visible}
          total={projects.length}
          selected={selected}
          query={query}
          onQuery={setQuery}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onToggle={toggle}
          onToggleVisible={toggleVisible}
          onClear={() => setSelected(new Set())}
          onClose={closeChooser}
        />
      )}
      <div className="mx-auto w-full max-w-[96rem]">
        {/* The page's header — title, actions, the project controls and the totals —
            **sticks** while the clients scroll under it (lg and up; stacked on a
            narrow screen it would cover the page). Its height is measured into
            `--head` on the scroll root, which the rail sticks under and the
            navigation offsets by. `bg-k-bg` so rows pass *under* it, and a
            negative top margin the size of the root's padding so it sits flush. */}
        <div
          ref={headRef}
          className="z-20 bg-k-bg pb-4 lg:sticky lg:-top-6 lg:-mt-6 lg:pt-4"
        >
          {/* One line: the way back, the title, the actions. The description that
              used to sit under the title is its tooltip now — the header sticks, and
              every line it keeps is a line of report the reader loses. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* A manager's way back is this page itself — it is where `/` sends
                  them — so the arrow would only loop; they open a project from a
                  card's *Openen* instead. */}
              <AdminOnly>
                <GuardedLink
                  href={HOME_PATH}
                  aria-label={t("Terug naar de projecten", "Back to the projects")}
                  title={t("Terug naar de projecten", "Back to the projects")}
                  className="neu-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                >
                  <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                </GuardedLink>
              </AdminOnly>
              <h1
                className="truncate text-xl font-bold tracking-tight text-k-text-primary"
                title={t("De stand van zaken per klant: hun modules, waar elke module staat en hoe de laatste controle ging.", "Where each client stands: their modules, where each module is and how the last check went.")}
              >
                {t("Managementrapport", "Management report")}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refresh}
                disabled={pending > 0}
                title={t("Haal de geselecteerde projecten opnieuw op uit AFAS", "Reload the selected projects from AFAS")}
                className={HEADER_BTN}
              >
                {pending > 0 ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <RotateCw className="h-4 w-4" strokeWidth={1.8} />
                )}
                {t("Verversen", "Refresh")}
              </button>
              <button
                type="button"
                onClick={savePdf}
                disabled={pdf === "busy" || pending > 0 || entries.length === 0}
                title={
                  pending > 0
                    ? t("Wacht tot alle projecten geladen zijn", "Wait until all projects have loaded")
                    : t("Managementrapport downloaden als PDF — een overzicht en een pagina per klant", "Download the management report as a PDF — an overview and a page per client")
                }
                className={HEADER_BTN}
              >
                {pdf === "busy" ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <FileDown className="h-4 w-4" strokeWidth={1.8} />
                )}
                {pdf === "failed" ? t("Mislukt", "Failed") : "PDF"}
              </button>
              {isManager && <ManagerAccount />}
            </div>
          </div>

          {/* `grid-cols-1` (a `minmax(0,1fr)` track) below `lg`, here and in the grid
              below: an implicit column is `auto`, which grows to the widest table in
              it and pushed the whole page sideways on a phone. */}
          <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <ProjectControls
              reportedCount={selectedProjects.length}
              query={query}
              onQuery={setQuery}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              onChoose={() => setChoosing(true)}
              visibleCount={visible.length}
            />
            {selectedProjects.length === 0 ? (
              <section className={`${CARD} px-5 py-12 text-center text-sm text-k-text-secondary`}>
                {visible.length === 0
                  ? t("Geen projecten binnen dit filter.", "No projects match this filter.")
                  : t("Kies met Kiezen een of meer projecten om het rapport op te bouwen.", "Use Choose to pick one or more projects to build the report.")}
              </section>
            ) : (
              <SummaryCard summary={summary} pending={pending} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ProjectNav
            projects={selectedProjects}
            loaded={loaded}
            activeId={activeId}
            onNavigate={navigateTo}
            query={query}
            visibleCount={visible.length}
          />

          <div className="min-w-0 space-y-6">
            {selectedProjects.length > 0 && (
              <>
                {failed.length > 0 && (
                  <div
                    role="status"
                    className="flex items-start gap-2.5 rounded-xl bg-k-red-bg px-4 py-3 text-sm text-k-red-fg"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span>
                      <span className="font-semibold">
                        {countText(failed.length, "project kon niet", "projecten konden niet", "project could not", "projects could not")}{" "}
                        {t("worden geladen:", "be loaded:")}
                      </span>{" "}
                      {failed.map((p) => p.name).join(", ")}. {t("Probeer het opnieuw met Verversen.", "Try again with Refresh.")}
                    </span>
                  </div>
                )}
                {summary.lines.length > 0 && <OverviewTable summary={summary} />}
                {/* In the rail's order, so the rail reads as this page's contents — a
                    project that failed to load keeps its place with a card saying so,
                    rather than being a rail entry that leads nowhere. */}
                {selectedProjects.map((project) => {
                  const line = summary.lines.find((l) => l.project.id === project.id);
                  if (line) return <ProjectCard key={project.id} line={line} />;
                  const state = loaded.get(project.id);
                  return state?.state === "error" ? (
                    <FailedCard
                      key={project.id}
                      project={project}
                      message={state.message}
                      onRetry={() => retry(project.id)}
                    />
                  ) : null;
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Navigation and selection ----------------------------------------------- */

/** The status switch, the picker's own three options. */
/**
 * Who is signed in, and the way out — for a manager only. This page is their home
 * (`/` forwards them here) and has no sidebar to carry the account row an admin has there;
 * the same name/e-mail/sign-out trio `DossierMigrationPage`'s header wears.
 */
function ManagerAccount() {
  const { session } = useAuth();
  const t = useT();
  return (
    <div className="flex items-center gap-3 pl-2">
      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-semibold text-k-text-primary">{session?.user.name}</p>
        <p className="truncate text-xs text-k-text-secondary">{session?.user.email}</p>
      </div>
    </div>
  );
}

function StatusSwitch({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (f: StatusFilter) => void;
}) {
  // Re-renders on a language switch: the labels are read from STATUS_FILTERS.
  useT();
  return (
    <div className="flex h-9.5 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm">
      {REPORT_FILTERS.map((filter) => {
        const active = value === filter.id;
        return (
          <button
            key={filter.id}
            type="button"
            onClick={() => onChange(filter.id)}
            aria-pressed={active}
            className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-full px-3 text-xs font-semibold transition-[box-shadow,color] duration-200 ${
              active ? "bg-k-bg text-k-cloud-deep shadow-raised-xs" : "text-k-text-tertiary hover:text-k-text-primary"
            }`}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The left rail: the report's table of contents. Every project **in** the report,
 * in its order, and a click scrolls to that client's card — the one being read is
 * highlighted as the page scrolls, the way a section nav does.
 *
 * Choosing *which* projects are in the report is not done here any more. Ticking
 * and navigating on one row made every click ambiguous — a click on a name ought to
 * take you there, not drop the client from the report — so the checkboxes moved to
 * {@link ProjectChooser}, one button away. The search and status switch stay: they
 * narrow the report and this list together.
 */
function ProjectControls({
  reportedCount,
  query,
  onQuery,
  statusFilter,
  onStatusFilter,
  onChoose,
  visibleCount,
}: {
  /** The projects in the report — ticked and matching the filter. */
  reportedCount: number;
  query: string;
  onQuery: (q: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (f: StatusFilter) => void;
  onChoose: () => void;
  /** How many projects the filter shows at all — the "of" in the count. */
  visibleCount: number;
}) {
  const t = useT();
  return (
    <div className={`${CARD} flex flex-col overflow-hidden`}>
      <div className="space-y-2 px-3 pb-3 pt-3">
        <ModalSearch
          value={query}
          onChange={onQuery}
          placeholder={t("Zoek op naam of projectnummer…", "Search by name or project number…")}
          label={t("Zoek een project", "Search for a project")}
        />
        <StatusSwitch value={statusFilter} onChange={onStatusFilter} />
      </div>

      {/* The way into the selection, with the count it changes. */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-k-divider px-3 py-1.5">
        <span className="min-w-0 truncate text-xs text-k-text-secondary" title={t("Projecten in het rapport", "Projects in the report")}>
          <span className="font-semibold tabular-nums text-k-text-primary">{reportedCount}</span> {t("van", "of")}{" "}
          {visibleCount} {t("in rapport", "in report")}
        </span>
        <button
          type="button"
          onClick={onChoose}
          className="neu-button inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium"
        >
          <ListChecks className="h-3.5 w-3.5" strokeWidth={2} />
          {t("Kiezen", "Choose")}
        </button>
      </div>
    </div>
  );
}

/**
 * The project list under the sticky header — see {@link ProjectNav}'s note above.
 * It sticks just below that header (`--head`, measured) and is held to the height
 * the pane leaves under it (`--pane`), so its own scroll never runs off-screen.
 */
function ProjectNav({
  projects,
  loaded,
  activeId,
  onNavigate,
  query,
  visibleCount,
}: {
  projects: Project[];
  loaded: Map<string, LoadState>;
  activeId: string | null;
  onNavigate: (id: string) => void;
  query: string;
  visibleCount: number;
}) {
  const t = useT();
  return (
    <aside className={`${CARD} lg:sticky lg:top-[var(--head,0px)]`}>
      <nav aria-label={t("Projecten in het rapport", "Projects in the report")}>
        <ul className="max-h-[min(36rem,60vh)] overflow-y-auto px-2 py-2 lg:max-h-[calc(var(--pane,100vh)-var(--head,0px)-1.5rem)]">
          {projects.length === 0 ? (
            <li className="px-3 py-10 text-center text-sm text-k-text-tertiary">
              {visibleCount === 0
                ? query
                  ? t(`Geen project gevonden voor “${query}”.`, `No project found for “${query}”.`)
                  : t("Geen projecten met deze status.", "No projects with this status.")
                : t("Nog geen projecten gekozen.", "No projects chosen yet.")}
            </li>
          ) : (
            projects.map((project) => {
              const state = loaded.get(project.id);
              const active = project.id === activeId;
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(project.id)}
                    disabled={!state}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-[box-shadow,color] duration-200 disabled:cursor-default ${
                      active
                        ? "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm"
                        : "text-k-text-secondary hover:text-k-text-primary"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm font-medium ${
                          active ? "text-k-cyan-fg" : "text-k-text-primary"
                        }`}
                      >
                        {project.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums text-k-text-secondary">
                        {project.id}
                        {!project.hasDossier && <NoDossierTag />}
                      </span>
                    </span>
                    {!state ? (
                      <Loader2
                        aria-label={t("Laden", "Loading")}
                        className="h-3.5 w-3.5 shrink-0 animate-spin text-k-text-tertiary"
                        strokeWidth={2}
                      />
                    ) : state.state === "error" ? (
                      <AlertTriangle
                        aria-label={t("Laden mislukt", "Loading failed")}
                        className="h-3.5 w-3.5 shrink-0 text-k-red-fg"
                        strokeWidth={2}
                      />
                    ) : state.report.moduleCount > 0 ? (
                      <span
                        className="shrink-0 text-xs font-semibold tabular-nums text-k-text-primary"
                        title={t("Aandeel afgeronde modules", "Share of completed modules")}
                      >
                        {state.report.completion}%
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </nav>
    </aside>
  );
}

/**
 * Which projects the report covers — the checkboxes the rail used to carry, in a
 * dialog of their own. Same search and status switch as the rail, bound to the same
 * state, so what is ticked here is exactly what the rail and the report then show.
 */
function ProjectChooser({
  visible,
  total,
  selected,
  query,
  onQuery,
  statusFilter,
  onStatusFilter,
  onToggle,
  onToggleVisible,
  onClear,
  onClose,
}: {
  visible: Project[];
  total: number;
  selected: Set<string>;
  query: string;
  onQuery: (q: string) => void;
  statusFilter: StatusFilter;
  onStatusFilter: (f: StatusFilter) => void;
  onToggle: (id: string, on: boolean) => void;
  onToggleVisible: (on: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ticked = visible.filter((p) => selected.has(p.id)).length;
  const all = visible.length > 0 && ticked === visible.length;
  const t = useT();
  return (
    <Modal onDismiss={onClose} className="max-w-xl">
      <PickerHeader title={t("Projecten kiezen", "Choose projects")} onClose={onClose}>
        <p className="mt-0.5 text-sm text-k-text-secondary">
          {t("Vink aan welke projecten in het managementrapport staan.", "Tick the projects that appear in the management report.")}
        </p>
      </PickerHeader>
      <div className="space-y-3 px-6 pb-4">
        <ModalSearch
          value={query}
          onChange={onQuery}
          placeholder={t("Zoek op naam of projectnummer…", "Search by name or project number…")}
          label={t("Zoek een project", "Search for a project")}
        />
        <StatusSwitch value={statusFilter} onChange={onStatusFilter} />
      </div>

      <div className="flex items-center justify-between border-y border-k-divider px-6 py-2">
        <label className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold text-k-text-secondary">
          <Checkbox
            checked={all}
            indeterminate={ticked > 0 && !all}
            onChange={onToggleVisible}
            disabled={visible.length === 0}
          />
          {t("Alle", "All")} {countText(visible.length, "zichtbare project", "zichtbare projecten", "visible project", "visible projects")}
        </label>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer text-xs font-medium text-k-text-secondary transition-colors hover:text-k-cloud-deep"
          >
            {t("Alles wissen", "Clear all")}
          </button>
        )}
      </div>

      <ul className="max-h-[min(28rem,55vh)] overflow-y-auto px-4 py-2">
        {visible.length === 0 ? (
          <li className="px-3 py-10 text-center text-sm text-k-text-tertiary">
            {query ? t(`Geen project gevonden voor “${query}”.`, `No project found for “${query}”.`) : t("Geen projecten met deze status.", "No projects with this status.")}
          </li>
        ) : (
          visible.map((project) => {
            const on = selected.has(project.id);
            return (
              <li key={project.id}>
                <label
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-[box-shadow,color] duration-200 ${
                    on ? "shadow-inset-sm" : "hover:bg-k-tint"
                  }`}
                >
                  <Checkbox checked={on} onChange={(v) => onToggle(project.id, v)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-k-text-primary">
                      {project.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-k-text-secondary">
                      <span className="tabular-nums">{project.id}</span>
                      {!project.hasDossier && <NoDossierTag />}
                    </span>
                  </span>
                  <ProjectStatusPill status={project.status} />
                </label>
              </li>
            );
          })
        )}
      </ul>

      <PickerFooter
        count={`${ticked} ${t("van", "of")} ${countText(visible.length, "project", "projecten", "project", "projects")} ${t("gekozen", "selected")} · ${total} ${t("in totaal", "in total")}`}
        onClose={onClose}
      />
    </Modal>
  );
}

/* --- Figures ------------------------------------------------------------------- */

/**
 * The projectrapport's *Fase* meter, any height — sized to its place. Phases rather
 * than status tones on every bar of this page: a bar beside *% afgerond* is read as
 * progress, and coloured by whose turn it was it made a portfolio of clean sheets
 * look nearly through while nothing was live yet (see `PHASE_FILL`).
 */
function PhaseMeter({
  segments,
  className = "h-2.5",
}: {
  segments: ProjectReport["phaseSegments"];
  className?: string;
}) {
  const t = useT();
  const filled = segments.filter((s) => s.value > 0);
  return (
    <div
      role="img"
      aria-label={`${t("Fase", "Phase")}: ${segmentsLabel(segments)}`}
      className={`flex gap-[2px] overflow-hidden rounded-full bg-k-bg shadow-inset-sm ${className}`}
    >
      {filled.map((s) => (
        <div
          key={s.id}
          style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3 }}
          className={`h-full rounded-full ${PHASE_FILL[s.id]}`}
        />
      ))}
    </div>
  );
}

function SummaryCard({ summary, pending }: { summary: ManagementSummary; pending: number }) {
  const t = useT();
  const rejected = summary.statusSegments.find((s) => s.id === "rejected")?.value ?? 0;
  // *Aan zet* — whose turn the open modules are, rejected ones included, the same
  // counts the client cards' legend and the PDF print (`turnSegments`).
  const client = summary.turnSegments.find((s) => s.id === "client")?.value ?? 0;
  const nymbus = summary.turnSegments.find((s) => s.id === "nymbus")?.value ?? 0;
  // How many projects have work on each side — the detail under the two counts.
  const projectsWith = (turn: "nymbus" | "client") =>
    countText(summary.lines.filter((l) => l.byTurn[turn] > 0).length, "project", "projecten", "project", "projects");
  const ofModules = (count: number) =>
    `${count} ${t("van", "of")} ${countText(summary.moduleCount, "module", "modules", "module", "modules")}`;
  // The projectrapport's three figures, summed over the selection, in words short
  // enough for a seventh of the card.
  const figures: { figure: string; caption: string; detail: string; tone?: ModuleStatusTone }[] = [
    {
      figure: String(summary.projectCount),
      caption: summary.projectCount === 1 ? t("project", "project") : t("projecten", "projects"),
      detail: countText(summary.moduleCount, "module", "modules", "module", "modules"),
    },
    {
      figure: `${summary.started}%`,
      caption: t("opgestart", "started"),
      detail: ofModules(summary.startedCount),
    },
    {
      figure: `${summary.completion}%`,
      caption: t("afgerond", "completed"),
      detail: ofModules(summary.doneCount),
    },
    // A dash when no open module carries an opleverdatum — see `deadlineMetricText`.
    summary.datedOpenCount === 0
      ? { figure: "—", caption: t("naderen deadline", "approaching deadline"), detail: t("geen opleverdata", "no delivery dates") }
      : {
          figure: String(summary.dueSoonCount),
          caption: summary.dueSoonCount === 1 ? t("nadert deadline", "approaching deadline") : t("naderen deadline", "approaching deadlines"),
          detail:
            summary.dueSoonCount === 0
              ? t(`binnen ${DEADLINE_WINDOW_DAYS} dagen`, `within ${DEADLINE_WINDOW_DAYS} days`)
              : `${t("bij", "at")} ${countText(summary.projectsDueSoon, "project", "projecten", "project", "projects")}${
                  summary.overdueCount > 0 ? ` · ${summary.overdueCount} ${t("te laat", "overdue")}` : ""
                }`,
        },
    {
      figure: String(nymbus),
      caption: t("modules bij Nymbus", "modules with Nymbus"),
      detail: `${t("bij", "at")} ${projectsWith("nymbus")}`,
      tone: "nymbus",
    },
    {
      figure: String(client),
      caption: t("modules bij de klant", "modules with the client"),
      detail: `${t("bij", "at")} ${projectsWith("client")}`,
      tone: "client",
    },
    {
      figure: String(rejected),
      caption: t("modules niet akkoord", "modules not approved"),
      detail: `${t("bij", "at")} ${countText(summary.projectsWithRejections, "project", "projecten", "project", "projects")}`,
      tone: "rejected",
    },
  ];

  return (
    // Compact on purpose: this card sits in the sticky header, so its height comes
    // straight off the report under it. No heading of its own (the figures say what
    // they are), and the legend shares the meter's line.
    <section className={`${CARD} relative flex flex-col justify-center`}>
      {pending > 0 && (
        <p className="absolute right-4 top-2.5 flex items-center gap-1.5 text-[11px] text-k-text-secondary">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
          {t(
            <>Nog {countText(pending, "project", "projecten", "project", "projects")} aan het laden…</>,
            <>Loading {countText(pending, "project", "projecten", "project", "projects")}…</>
          )}
        </p>
      )}
      <div className="px-4 py-3">
        <div
          className="grid grid-cols-2 gap-y-3 sm:grid-cols-7 sm:divide-x sm:divide-k-divider"
        >
          {figures.map((f, i) => (
            <div key={i} className={i === 0 ? undefined : "sm:pl-4"}>
              <div className="text-2xl font-bold leading-none tracking-tight text-k-text-primary">
                {f.figure}
              </div>
              {/* The three status counts wear their tone's dot: it is the legend for
                  the status dots in the cards and the overview's column heads, now
                  that the meter below counts phases instead. */}
              <p className="mt-1 flex items-center gap-1.5 truncate text-xs leading-snug text-k-text-secondary">
                {f.tone && (
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_FILL[f.tone]}`} />
                )}
                {f.caption}
              </p>
              <p className="truncate text-[11px] tabular-nums text-k-text-secondary">{f.detail}</p>
            </div>
          ))}
        </div>
        {summary.moduleCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <PhaseMeter segments={summary.phaseSegments} className="h-2 min-w-48 flex-1" />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-k-text-secondary">
              <li className="font-semibold uppercase tracking-wide text-k-text-secondary">{t("Fase", "Phase")}</li>
              {summary.phaseSegments.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${PHASE_FILL[s.id]}`} />
                  {s.label}
                  <span className="font-semibold tabular-nums text-k-text-primary">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* --- Overview ------------------------------------------------------------------- */

/**
 * One line per client. A table rather than the projectrapport's flex rows: it is read
 * down *and* across, and eight columns of figures only line up reliably in a real
 * one. It scrolls sideways on a narrow screen rather than dropping columns — this is
 * the page's comparison, and a column that disappears is a client whose figure did.
 */
/** The overview's header cell — `TH` a notch tighter, so ten columns fit the pane. */
/**
 * The first column of each of the overview's three groups after Project — the
 * dates (intake, oplevering, laatste controle) and the module figures — set off by
 * a faint rule and a wider gutter, so the row reads as three blocks.
 */
const SEGMENT = "border-l border-k-divider pl-5";
/** The last column's extra right padding, so its figures don't run into the card's edge. */
const LAST_COL = "pr-6";
const OTH = "px-2.5 py-2 text-[11px] font-semibold uppercase leading-tight tracking-wide text-k-text-secondary";
/** Below `lg` the overview scrolls sideways; its project column stays put, on its own
 *  opaque ground so the figures sliding under it don't show through. */
const STICKY_PROJECT_COL = "max-lg:sticky max-lg:left-0 max-lg:z-10 max-lg:bg-k-bg";

/**
 * One line per client. A table rather than the projectrapport's flex rows: it is read
 * down *and* across, and columns of figures only line up reliably in a real one.
 *
 * Sized to **fit the pane** rather than scroll sideways: the last column is the one
 * that fell off the edge, and a comparison whose right-hand figure needs a scroll is
 * not one anybody reads. So the project column is capped and truncates (its full
 * name is the link's title) while the figures share what is left, the type chip rides in the project's second line
 * instead of a column of its own, the three counts let their two-word headings wrap
 * over a narrow number, and *Laatste controle* prints the day with the time on hover.
 *
 * **Except below `lg`**, where no squeezing makes nine columns fit a phone: there the
 * table keeps a floor width and scrolls sideways inside its card, its project column
 * narrowed to 10rem and pinned to the left edge so every row still says whose it is.
 */
function OverviewTable({ summary }: { summary: ManagementSummary }) {
  const t = useT();
  return (
    <section className={CARD}>
      <div className="px-5 pb-2 pt-4">
        <h2 className="text-base font-semibold text-k-text-primary">{t("Overzicht per klant", "Overview per client")}</h2>
      </div>
      <div className="overflow-x-auto px-2 pb-3">
        <table className="w-full border-separate border-spacing-0 text-sm max-lg:min-w-3xl">
          <thead>
            <tr className="text-left align-bottom">
              <th className={`${OTH} w-72 ${STICKY_PROJECT_COL} max-lg:w-40 max-lg:min-w-40`}>Project</th>
              <th className={`${OTH} ${SEGMENT} whitespace-nowrap`} title={t("Waar de intake met de klant staat", "Where the intake with the client stands")}>
                Intake
              </th>
              <th className={`${OTH} whitespace-nowrap`}>{t("Opleverdatum", "Delivery date")}</th>
              <th className={`${OTH} whitespace-nowrap`}>{t("Laatste controle", "Last check")}</th>
              <th className={`${OTH} ${SEGMENT} whitespace-nowrap`} title={t("Aandeel afgeronde modules, en de fase van alle modules: validatie, test, live", "Share of completed modules, and the phase of all modules: validation, test, live")}>
                {t("Voortgang", "Progress")}
              </th>
              <ToneHeader tone="nymbus" label={t("Bij Nymbus", "With Nymbus")} title={t("Modules waar Nymbus aan zet is", "Modules where Nymbus has the next move")} />
              <ToneHeader tone="client" label={t("Bij de klant", "With the client")} title={t("Modules die op de klant wachten", "Modules waiting on the client")} />
              <ToneHeader tone="rejected" label={t("Niet akkoord", "Not approved")} title={t("Modules die niet akkoord zijn", "Modules that are not approved")} />
              {/* Last, and in the phase purple: where the *Voortgang* meter and the card's
                  legend end, so finished work reads at the right on this page throughout. */}
              <ToneHeader
                tone="done"
                fill={PHASE_FILL.afgerond}
                label={t("Afgerond", "Completed")}
                title={t("Modules die AFAS afgerond noemt", "Modules AFAS records as completed")}
                last
              />
            </tr>
          </thead>
          <tbody>
            {summary.lines.map((line) => (
              <OverviewRow key={line.project.id} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A count column's heading, drawn as the legend's dot rather than its words — the
 * summary card's status counts above wear the same dots beside their names, so the
 * four labels only crowded the row.
 * The name stays for hover and screen readers: a status is never colour alone.
 */
function ToneHeader({
  tone,
  label,
  title,
  fill = STATUS_TONE_FILL[tone],
  last = false,
}: {
  tone: ModuleStatusTone;
  label: string;
  title: string;
  /** The dot's fill, when this page draws the tone in another colour than the status dot. */
  fill?: string;
  /** The table's last column — held off the card's edge (`LAST_COL`). */
  last?: boolean;
}) {
  return (
    <th className={`${OTH} w-12 text-right ${last ? LAST_COL : ""}`} title={`${label} — ${title.toLowerCase()}`}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${fill}`} />
      <span className="sr-only">{label}</span>
    </th>
  );
}

function OverviewRow({ line }: { line: ManagementLine }) {
  const { project, report } = line;
  const td = "border-t border-k-divider px-2.5 py-2.5 align-middle";
  // The dates read left, under their left-aligned headings.
  const projectDateCell = `${td} whitespace-nowrap text-left text-xs tabular-nums text-k-text-secondary`;
  const count = (n: number, ink: string) =>
    `${td} text-right font-semibold tabular-nums ${n ? ink : "text-k-text-tertiary"}`;
  return (
    <tr className="transition-colors hover:bg-k-tint">
      {/* `max-w-0` with the header's `w-72`: the column is capped at 18rem and the
          name truncates inside it, so the spare width goes to the figures rather
          than to white space after a short name. */}
      <td className={`${td} max-w-0 ${STICKY_PROJECT_COL} max-lg:max-w-40`}>
        {/* To the client's card further down this page — the overview is the index. */}
        <a
          href={`#project-${project.id}`}
          title={project.name}
          className="block cursor-pointer truncate font-medium text-k-text-primary hover:text-k-cloud-deep"
        >
          {project.name}
        </a>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums text-k-text-secondary max-lg:flex-wrap max-lg:gap-y-1">
          {project.id}
          <TypeTag type={project.conversionType} />
          {!project.hasDossier && <NoDossierTag />}
        </span>
      </td>
      <td className={`${td} ${SEGMENT} whitespace-nowrap`}>
        {line.intake ? <IntakeTag intake={line.intake} /> : <Empty />}
      </td>
      <td className={projectDateCell}>{report.delivery?.text ?? <Empty />}</td>
      <td
        className={projectDateCell}
        title={line.lastCheckedAt ? formatCheckedAt(line.lastCheckedAt) : undefined}
      >
        {line.lastCheckedAt ? formatCheckedAt(line.lastCheckedAt).slice(0, 10) : <Empty />}
      </td>
      <td className={`${td} ${SEGMENT} whitespace-nowrap`}>
        {report.moduleCount === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-center gap-2">
            <PhaseMeter segments={report.phaseSegments} className="h-2 w-32 shrink-0" />
            <span className="w-9 text-right font-semibold tabular-nums text-k-text-primary">
              {report.completion}%
            </span>
            <span className="text-[11px] tabular-nums text-k-text-secondary">
              {report.doneCount}/{report.moduleCount}
            </span>
          </div>
        )}
      </td>
      {/* *Aan zet*, as the card's legend counts it — rejected modules included. */}
      <td className={count(line.byTurn.nymbus, "text-k-text-primary")}>{line.byTurn.nymbus}</td>
      <td className={count(line.byTurn.client, "text-k-text-primary")}>{line.byTurn.client}</td>
      <td className={count(line.byTone.rejected, "text-k-red-fg")}>{line.byTone.rejected}</td>
      <td className={`${count(line.byTone.done, "text-k-purple-fg")} ${LAST_COL}`}>{line.byTone.done}</td>
    </tr>
  );
}

/**
 * The flag for a project AFAS holds no dossieritem for — the project picker's own
 * chip (same red as *Afgemeld*, an inset tinted pill a size under the status pill), worded
 * *Nog geen*: on this page it is a stage the client hasn't reached, not a fault.
 */
function NoDossierTag() {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-k-red-bg px-1.5 py-0.5 text-[10px] font-semibold text-k-red-fg shadow-inset-sm">
      <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />
      {t("Nog geen modules", "No modules yet")}
    </span>
  );
}

/**
 * Each intake status's ink, the inset tinted pill every badge on this page is drawn
 * as: grey while nothing has happened, cloud once the client has an invitation
 * (it is theirs to answer), cyan once it is in the agenda, green when it is done.
 */
const INTAKE_TONE: Record<IntakeStatus, string> = {
  niet_ingepland: "bg-k-grey-bg text-k-grey-fg shadow-inset-sm",
  uitnodiging_verstuurd: "bg-k-cloud-light/40 text-k-cloud-deep shadow-inset-sm",
  ingepland: "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm",
  afgerond: "bg-k-green-bg text-k-green-fg shadow-inset-sm",
};

/**
 * Where the intake stands, with its day once it has one — underneath in the
 * overview's cell, beside it (`inline`) in a client card's line of facts.
 */
function IntakeTag({ intake, inline = false }: { intake: Intake; inline?: boolean }) {
  const day = intakeHasDate(intake.status) ? projectDate(intake.datum) : null;
  // A span when inline: the card puts it inside its facts `<p>`, where a div is invalid.
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper className={inline ? "flex items-center gap-1.5" : "flex flex-col items-start gap-0.5"}>
      <span
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${INTAKE_TONE[intake.status]}`}
      >
        {INTAKE_LABEL[intake.status]}
      </span>
      {day && <span className="text-[11px] tabular-nums text-k-text-secondary">{day}</span>}
    </Wrapper>
  );
}

/** The picker's Type chip — cloud for the two types converted differently. */
function TypeTag({ type }: { type: Project["conversionType"] }) {
  const standard = type === "standard";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase shadow-inset-sm ${
        standard ? "bg-k-bg text-k-text-tertiary" : "bg-k-cloud-light/40 text-k-cloud-deep"
      }`}
    >
      {CONVERSION_TYPE_LABEL[type]}
    </span>
  );
}

/** A ticked project whose report could not be loaded: its place in the page, the reason, a retry. */
function FailedCard({
  project,
  message,
  onRetry,
}: {
  project: Project;
  message: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <section id={`project-${project.id}`} className={`${CARD} scroll-mt-4 px-5 py-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-k-text-primary">{project.name}</h2>
            <ProjectStatusPill status={project.status} />
          </div>
          <p className="mt-1 text-xs tabular-nums text-k-text-secondary">{project.id}</p>
        </div>
        <button type="button" onClick={onRetry} className={HEADER_BTN}>
          <RotateCw className="h-4 w-4" strokeWidth={1.8} />
          {t("Opnieuw", "Retry")}
        </button>
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-k-red-fg">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
        {message}
      </p>
    </section>
  );
}

/* --- Per client ---------------------------------------------------------------------- */

/** One client's block as a PDF — the header's PDF button, for this client alone. */
function ProjectPdfButton({ line }: { line: ManagementLine }) {
  const t = useT();
  const [pdf, savePdf] = usePdfDownload(async () => {
    const { downloadManagementProjectPdf } = await import("@/lib/management-report-pdf");
    await downloadManagementProjectPdf(line);
  });

  return (
    <button
      type="button"
      onClick={savePdf}
      disabled={pdf === "busy"}
      title={t(`${line.project.name} downloaden als PDF`, `Download ${line.project.name} as PDF`)}
      className={HEADER_BTN}
    >
      {pdf === "busy" ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
      ) : (
        <FileDown className="h-4 w-4" strokeWidth={1.8} />
      )}
      {pdf === "failed" ? t("Mislukt", "Failed") : "PDF"}
    </button>
  );
}

/**
 * One client, module by module: the projectrapport's list, plus the task each module
 * is waiting on — the one column a project manager asks about that the client's own
 * page leaves to a tooltip.
 */
function ProjectCard({ line }: { line: ManagementLine }) {
  const t = useT();
  const { project, report } = line;
  const livegang = projectDate(project.livegangDatum);
  const appreo = projectDate(project.appreoTestdatum);

  return (
    <section id={`project-${project.id}`} className={`${CARD} scroll-mt-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-k-text-primary">{project.name}</h2>
            <TypeTag type={project.conversionType} />
            <ProjectStatusPill status={project.status} />
            {!project.hasDossier && <NoDossierTag />}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-k-text-secondary">
            <span className="tabular-nums">{project.id}</span>
            {livegang && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-k-text-tertiary" strokeWidth={1.8} />
                {t("Livegang", "Go-live")} <span className="font-medium tabular-nums text-k-text-primary">{livegang}</span>
              </span>
            )}
            {report.delivery && (
              <span>
                {t("Opleverdatum", "Delivery date")}{" "}
                <span className="font-medium tabular-nums text-k-text-primary">{report.delivery.text}</span>
              </span>
            )}
            {appreo && (
              <span>
                {t("Appreo-test", "Appreo test")} <span className="font-medium tabular-nums text-k-text-primary">{appreo}</span>
              </span>
            )}
            {project.hrmPeriodetabel !== null && (
              <span>
                {t("Periodetabel", "Period table")}{" "}
                <span className="font-medium tabular-nums text-k-text-primary">{project.hrmPeriodetabel}</span>
              </span>
            )}
            {line.intake && <IntakeTag intake={line.intake} inline />}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectPdfButton line={line} />
          <GuardedLink
            href={projectPath(project.id)}
            prefetch={false}
            className={HEADER_BTN}
            title={t("Open dit project in de tool", "Open this project in the tool")}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.8} />
            {t("Openen", "Open")}
          </GuardedLink>
        </div>
      </div>

      {report.moduleCount === 0 ? (
        <p className="px-5 py-4 text-sm text-k-text-secondary">
          {project.hasDossier
            ? t("Dit project heeft nog geen modules.", "This project has no modules yet.")
            : t("Dit project heeft nog geen modules — kies ze in de projectinstellingen.", "This project has no modules yet — choose them in the project settings.")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 px-5 pt-3">
            <PhaseMeter segments={report.phaseSegments} className="h-2 flex-1" />
            <span className="text-sm font-semibold tabular-nums text-k-text-primary">
              {report.completion}% {t("afgerond", "completed")}
            </span>
          </div>
          {/* How far each phase got and who has to move the rest — the
              projectrapport's own legend, so a client card reads like their page. */}
          <PhaseTurnLegend report={report} className="px-5 pt-2" />
          <div className="overflow-x-auto px-2 pb-3 pt-2">
            <ModuleReportTable report={report} projectId={project.id} />
          </div>
          {report.refusedRows > 0 && (
            <div className="px-5 pb-4">
              <SendRefusals report={report} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
