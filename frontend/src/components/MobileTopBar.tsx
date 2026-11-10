"use client";

import { Home, Menu } from "lucide-react";
import { useModule } from "@/components/ModuleProvider";
import { GuardedLink } from "@/components/NavigationGuard";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";
import { projectPath } from "@/lib/routes";

/**
 * The project shell's header below `lg`, where the sidebar no longer fits beside the
 * page and slides in over it instead (`ProjectShell`). One slim row: the button that
 * opens the sidebar, where you are — the module's name on a module, the project's on
 * the project page, under the same `PROJECT 501243` label `ProjectSelector` carries —
 * and the brand mark's way back to the project page.
 *
 * Not a bottom tab bar: the sidebar is a project's module list plus a few admin rows,
 * not three to five fixed destinations, so it opens whole rather than being cut into
 * tabs. Both buttons are 44px, the touch-target minimum.
 */
export default function MobileTopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const t = useT();
  const { selectedProject } = useProject();
  const { modules, customModules, selectedModuleId } = useModule();
  const moduleLabel = selectedModuleId
    ? (modules.find((m) => m.id === selectedModuleId)?.label ??
      customModules.find((m) => m.id === selectedModuleId)?.label)
    : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-k-divider bg-k-bg px-1.5 lg:hidden">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label={t("Menu openen", "Open menu")}
        className="neu-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-k-text-tertiary">
          {t("Project", "Project")} <span className="tabular-nums">{selectedProject.id}</span>
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-k-text-primary">
          {moduleLabel ?? selectedProject.name}
        </p>
      </div>
      <GuardedLink
        href={projectPath(selectedProject.id)}
        aria-label={t("Naar de projectpagina", "To the project page")}
        className="neu-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-k-cloud-deep"
      >
        <Home className="h-5 w-5" strokeWidth={2.25} />
      </GuardedLink>
    </header>
  );
}
