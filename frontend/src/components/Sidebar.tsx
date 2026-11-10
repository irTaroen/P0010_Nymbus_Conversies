"use client";

import { useState } from "react";
import { ChartColumn, ChevronDown, Cloud, CloudUpload, Home, Hourglass, User } from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import CustomModuleGroup from "@/components/CustomModuleGroup";
import { useModule } from "@/components/ModuleProvider";
import { GuardedLink } from "@/components/NavigationGuard";
import { useProgress } from "@/components/ProgressProvider";
import ProjectSelector from "@/components/ProjectSelector";
import ProjectSettings from "@/components/ProjectSettings";
import UpdateConnectorsRow from "@/components/afas/UpdateConnectorsRow";
import { useProject } from "@/components/ProjectProvider";
import { useAuth } from "@/components/AuthProvider";
import LocaleToggle from "@/components/LocaleToggle";
import ThemeToggle from "@/components/ThemeToggle";
import NewProjectRow from "@/components/NewProjectRow";
import { type ModuleStatus } from "@/lib/modules";
import {
  completenessTone,
  COMPLETENESS_TONE_FILL,
  progressSummary,
  type ModuleProgress,
} from "@/lib/project-progress";
import { tr, useT } from "@/lib/i18n";
import { useNarrowScreen } from "@/lib/narrow-screen";
import { managementReportPath, modulePath, projectPath } from "@/lib/routes";

/**
 * The trailing column every row's badge fills — or keeps empty, see `NymbusMark`.
 * Wide enough for `100%` behind the send icon, and the same for every row so the
 * badges stack as one column whether or not they carry it.
 */
const BADGE_SLOT = "inline-flex w-12";

/**
 * How far a module got at its last check: the share of rows AFAS could take as
 * they are. Green at 100% (the whole sheet could go as it is), amber below that —
 * the number carries the meaning, the colour only echoes it. A module nobody has
 * checked yet gets no badge at all, so the list stays quiet until there is
 * something to report.
 *
 * Once the module's records have been **sent to AFAS** the figure is that send's
 * outcome instead — the share of the sheet's rows now in AFAS, written into the same
 * deeltaak field — and the pill leads with a `CloudUpload` to say so. Same pill, same
 * bands: the number still carries the meaning, the icon only says which question it
 * answers, and the tooltip spells that out.
 */
function ProgressBadge({ progress }: { progress: ModuleProgress }) {
  const t = useT();
  const complete = progress.completeness === 100;
  const sent = progress.send !== null;
  return (
    <span
      // A measure, not a verdict, so it keeps its own green/amber instead of
      // borrowing the status inks — but it is built like every other badge.
      // A fixed width, so the badges stack as one column down the rail and the
      // Nymbus mark before them lines up too — `0%` and `100%` would otherwise
      // each start somewhere else. Wide enough for `100%`.
      className={`${BADGE_SLOT} shrink-0 items-center justify-center gap-0.5 rounded-full py-0.5 text-[10px] font-semibold leading-none tabular-nums shadow-inset-sm ${
        complete
          ? "bg-k-green-bg text-k-green-fg"
          : "bg-k-amber-bg text-k-amber-fg"
      }`}
    >
      {sent && <CloudUpload aria-hidden className="h-2.5 w-2.5 shrink-0" strokeWidth={2.5} />}
      {progress.completeness}%
      <span className="sr-only">
        {sent
          ? t(" van de rijen staat in AFAS na de laatste verzending", " of the rows are in AFAS after the last send")
          : t(" van de rijen zonder fouten bij de laatste controle", " of the rows without errors at the last check")}
      </span>
    </span>
  );
}

/*
 * How clean the last check found the module is carried by the dot at the head of
 * the row, filled per band from `COMPLETENESS_TONE_FILL` — the same map the
 * projectrapport's row dot reads, so a module can never be one colour here and
 * another there. Grey with no check yet, red at half the rows clean or fewer,
 * amber short of a full sheet, green at 100% — the same bands the percentage
 * badge beside it already falls into; the dot is that fact at a glance, not a
 * second opinion.
 *
 * AFAS's own workflow status (Klant, Sjabloon gevuld, Niet akkoord, …) is a
 * separate fact — it doesn't get a colour of its own here, only the row's
 * tooltip and, spelled out, the screen-reader label below.
 */

/*
 * Whose turn it is — the one workflow fact that does get a mark of its own. A
 * deeltaak whose current task is Nymbus's (`withNymbus`, the same
 * flag that pauses the client's hand-in and shows the uploader's waiting notice)
 * carries a small `Hourglass` before the badge, in the sky of the *Bij Nymbus*
 * tone (`STATUS_TONE_FILL.nymbus`). An icon, not a pill: a second badge beside the
 * percentage would push the label out of a `w-68` rail. As with the status, the
 * colour never says it alone — the tooltip names it and an `sr-only` tail spells it
 * out.
 */
function NymbusMark() {
  const t = useT();
  return (
    <span className="shrink-0 text-k-cyan-fg">
      <Hourglass aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
      <span className="sr-only">{t("ligt bij Nymbus", "with Nymbus")}</span>
    </span>
  );
}

/** The row's tooltip: the AFAS status first, then whose turn it is, then the last check. */
function rowTitle(status: ModuleStatus | undefined, progress: ModuleProgress | undefined): string | undefined {
  const parts: string[] = [];
  if (status?.status) {
    parts.push(status.task ? `${status.status} — ${status.task}` : status.status);
  }
  if (status?.withNymbus) parts.push(tr("ligt bij Nymbus", "with Nymbus"));
  if (progress) parts.push(progressSummary(progress));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export default function Sidebar() {
  // The URL's module, not one checked against the project: the highlight follows the
  // address bar straight away rather than waiting for the module fetch to confirm it.
  const { groups, status, statuses, routeModuleId } = useModule();
  const narrow = useNarrowScreen();
  // Per-module progress of the active project — the badge behind each module name.
  const { byModule } = useProgress();
  const { selectedProject, selectedProjectId } = useProject();
  const { session, isAdmin, isManager } = useAuth();
  const t = useT();
  const canReadReport = isAdmin || isManager;
  const user = session?.user;
  // Every group is open until the user closes it, so a group never collapses on
  // its own — not when a file is uploaded, and not when the project changes.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  function isGroupOpen(groupId: string): boolean {
    return openGroups[groupId] ?? true;
  }

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !isGroupOpen(id) }));
  }

  // No z-index on the aside: the dialogs its footer rows open render inside it, and a
  // z-index would trap them under the content's sticky table headers.
  return (
    <aside className="relative flex h-full w-68 shrink-0 flex-col bg-k-bg shadow-[8px_0_24px_-14px_var(--k-shade)]">
      {/* Brand. The way back to the project's own page — without it, the page
          you land on is only reachable with the back button once a module is
          open. */}
      <div className="px-3 py-5">
        <GuardedLink
          href={projectPath(selectedProjectId)}
          title={selectedProject.name}
          className="group flex cursor-pointer items-center gap-3.5 rounded-2xl px-2 py-1"
        >
          {/* Logo plate + eyebrow + product name (nymbus-styling.md §11.3). The
              plate lifts on hover, the name turns cloud-blue — the row is a link. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-k-bg text-k-cloud-deep shadow-raised transition-shadow duration-250 group-hover:shadow-lifted">
            <Cloud aria-hidden className="h-5.5 w-5.5" strokeWidth={2} fill="var(--k-cloud-light)" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-medium uppercase leading-none tracking-[1.5px] text-k-text-tertiary">
              Nymbus
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-lg font-bold leading-none tracking-[-0.4px] text-k-text-primary transition-colors group-hover:text-k-cloud-deep">
              Conversies
              <Home aria-hidden className="h-3.5 w-3.5 shrink-0 text-k-text-tertiary" strokeWidth={2} />
            </span>
          </span>
        </GuardedLink>
      </div>

      {/* Project selector, and beside it the managementrapport — the stand van
          zaken over every project, so it sits next to the control that switches
          between them. For admins and managers, like the page itself. */}
      <div className="flex items-stretch gap-2 px-3 pb-3">
        <div className="min-w-0 flex-1">
          <ProjectSelector fullWidth />
        </div>
        {canReadReport && (
          <GuardedLink
            href={managementReportPath()}
            prefetch={false}
            aria-label={t("Managementrapport", "Management report")}
            title={t(
              "Managementrapport — de stand van zaken van alle projecten, per klant en per module.",
              "Management report — where every project stands, per client and per module.",
            )}
            className="neu-button flex w-11 shrink-0 items-center justify-center rounded-full text-k-text-secondary"
          >
            <ChartColumn className="h-4 w-4 shrink-0" strokeWidth={2} />
          </GuardedLink>
        )}
      </div>

      {/* HRM / ERP collapsible groups */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <div className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.6px] text-k-text-tertiary">
          Modules
        </div>
        {groups.length === 0 && (
          <p className="px-3 py-2 text-xs text-k-text-secondary">
            {status === "loading"
              ? t("Modules laden…", "Loading modules…")
              : status === "error"
                ? t("Modules konden niet worden geladen.", "The modules could not be loaded.")
                : t("Dit project heeft nog geen modules.", "This project has no modules yet.")}
          </p>
        )}
        {groups.map((group) => {
          const isOpen = isGroupOpen(group.id);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 pointer-coarse:py-3 text-left text-[13px] font-medium text-k-text-secondary transition-colors hover:text-k-text-primary"
              >
                <span className="shrink-0 text-k-text-secondary">{group.icon}</span>
                <span className="truncate">{group.label}</span>
                <span className="-ml-1 shrink-0 rounded-full bg-k-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-k-text-secondary shadow-inset-sm">
                  {group.items.length}
                </span>
                <ChevronDown
                  className={`ml-auto h-3.5 w-3.5 shrink-0 text-k-text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
                  strokeWidth={2}
                />
              </button>
              {isOpen && (
                <ul className="mt-0.5 space-y-0.5 pl-4">
                  {/* In the drawer (below `lg`) the modules waiting on Nymbus lead
                      their group — on a phone that is what the list is opened for.
                      The desk keeps AFAS's order. */}
                  {(narrow
                    ? [...group.items].sort(
                        (a, b) =>
                          Number(!!statuses.get(b.id)?.withNymbus) -
                          Number(!!statuses.get(a.id)?.withNymbus),
                      )
                    : group.items
                  ).map((item) => {
                    const progress = byModule.get(item.id);
                    const afasStatus = statuses.get(item.id);
                    const active = routeModuleId === item.id;
                    return (
                      <li key={item.id}>
                        {/* A real link, so a module can be middle-clicked into its own
                            tab and its address copied — but a guarded one, so the
                            uploader's leave prompt gets in front of a click that
                            would close an open sheet. Not prefetched: the page is
                            client-rendered, so there is nothing to fetch ahead, and
                            a whole project's modules sit in the viewport at once. */}
                        <GuardedLink
                          href={modulePath(selectedProjectId, item.id)}
                          prefetch={false}
                          aria-current={active ? "page" : undefined}
                          title={rowTitle(afasStatus, progress)}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 pointer-coarse:py-3 text-left text-[13px] transition-[color,box-shadow,background-color] duration-150 ${
                            active
                              ? "bg-k-cyan-bg font-medium text-k-cyan-fg shadow-inset-sm"
                              : "text-k-text-secondary hover:text-k-text-primary hover:shadow-inset-sm"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${COMPLETENESS_TONE_FILL[completenessTone(progress)]}`}
                          />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {afasStatus?.status && (
                            <span className="sr-only">{t("status", "status in AFAS")}: {afasStatus.status}</span>
                          )}
                          {afasStatus?.withNymbus && <NymbusMark />}
                          {progress ? (
                            <ProgressBadge progress={progress} />
                          ) : (
                            // No check yet: hold the badge's column open behind a
                            // Nymbus mark so it stays level with the ones above.
                            afasStatus?.withNymbus && <span aria-hidden className={`${BADGE_SLOT} shrink-0`} />
                          )}
                        </GuardedLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {/* The project's custom modules — an extra step on a standard module,
            linked into that module's payload view. Admins only. */}
        <CustomModuleGroup />
      </div>

      {/* The local user, the language, and the admin rows */}
      <div className="mx-4 h-px bg-k-divider" />
      <div className="p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-k-bg text-k-text-secondary shadow-raised-sm">
            <User className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-k-text-primary">
              {user?.name}
            </p>
            <p className="truncate text-xs text-k-text-secondary">{user?.email}</p>
          </div>
          {/* English is admin-only for now; see `restoreLocale`. */}
          {isAdmin && <LocaleToggle />}
          <ThemeToggle />
        </div>
        <AdminOnly>
          <div className="mt-1 space-y-1">
            <ProjectSettings />
            <NewProjectRow />
            {/* A dialog over the shell, not a link out of it: with a sheet open,
                navigating there would drop the workbook and raise the leave prompt
                for what is usually a glance at a schema. See
                `UpdateConnectorsRow`. */}
            <UpdateConnectorsRow />
          </div>
        </AdminOnly>
      </div>
    </aside>
  );
}
