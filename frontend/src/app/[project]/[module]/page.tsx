"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ExcelUploader from "@/components/ExcelUploader";
import RouteNotice from "@/components/RouteNotice";
import { type SheetView } from "@/components/uploader/SheetToolbar";
import { useModule } from "@/components/ModuleProvider";
import { useNavigationGuard } from "@/components/NavigationGuard";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";
import { getModule } from "@/lib/modules";
import {
  moduleViewPath,
  PAYLOAD_STEP_PARAM,
  projectPath,
  SHEET_VIEW_PARAM,
} from "@/lib/routes";

/**
 * `/{project}/{module}` — one module of one project, and the sheet being worked on.
 *
 * The URL's module has to be checked against the project before the uploader can
 * mount: a module this project can't import has no rules to validate against and no
 * connector to send to, and with modules in the address bar that URL is typeable. It
 * takes a fetch to know (`ModuleProvider`), hence the three states below.
 *
 * `key` on the uploader is what makes the module boundary real: it holds an open
 * workbook, its edits and its validation results, and none of that may survive a move
 * to another module. Keying it on the module guarantees a fresh one — the sheet state
 * is gone because the component is, not because something remembered to clear it.
 */
function ModulePageContent() {
  const { status, routeModuleId, selectedModuleId } = useModule();
  const { selectedProject } = useProject();
  const { navigate } = useNavigationGuard();
  const t = useT();

  /**
   * Which reading of the sheet the address asks for. Anything but `payloads` is the
   * grid — an unknown value in a typeable URL falls back to the ordinary view rather
   * than to an error, since a mistyped `?view=` is not a wrong address, only a
   * meaningless one.
   */
  const searchParams = useSearchParams();
  const view: SheetView =
    searchParams.get(SHEET_VIEW_PARAM) === "payloads" ? "payloads" : "data";
  /**
   * A custom module (maatwerk) on this module, shown in the payload view as itself —
   * it borrows this module's sheet, since its columns are in it. Only meaningful on
   * the payload view, and an id the panel doesn't know simply selects nothing.
   */
  const step = view === "payloads" ? searchParams.get(PAYLOAD_STEP_PARAM) : null;

  if (selectedModuleId) {
    return (
      <ExcelUploader
        key={selectedModuleId}
        moduleId={selectedModuleId}
        view={view}
        onViewChange={(next) =>
          // Through the guard like every other exit, even though this one keeps the
          // sheet: the guard is what the app navigates with, and a second way round
          // it is a second thing to remember. It sees the same pathname either side
          // of the change and lets it through without a prompt.
          navigate(moduleViewPath(selectedProject.id, selectedModuleId, next))
        }
        step={step}
      />
    );
  }

  // Still finding out which modules this project has — the sidebar says so too.
  if (status === "loading") {
    return (
      <p className="px-1 py-2 text-sm text-k-text-secondary">{t("Module laden…", "Loading modules…")}</p>
    );
  }

  if (status === "error") {
    return (
      <RouteNotice
        title={t("Modules konden niet worden geladen", "The modules could not be loaded")}
        description={t(
          "De modules van dit project zijn niet op te halen. Probeer het later opnieuw.",
          "The modules of this project cannot be fetched. Try again later.",
        )}
        action={{
          href: projectPath(selectedProject.id),
          label: t(`Naar ${selectedProject.name}`, `Go to ${selectedProject.name}`),
        }}
      />
    );
  }

  // The project's modules are known, and this isn't one of them.
  return (
    <RouteNotice
      title={t("Module niet beschikbaar", "Module not available")}
      description={
        <>
          <strong>{getModule(routeModuleId ?? "")?.label ?? routeModuleId}</strong>{" "}
          {t("hoort niet bij de conversie van", "is not part of the conversion of")}{" "}
          <strong>{selectedProject.name}</strong>.{" "}
          {t(
            "Kies links een van de onderdelen die dit project wel heeft.",
            "Pick one of the parts on the left that this project does have.",
          )}
        </>
      }
      action={{
        href: projectPath(selectedProject.id),
        label: t(`Naar ${selectedProject.name}`, `Go to ${selectedProject.name}`),
      }}
    />
  );
}

/**
 * `useSearchParams` makes this route dynamic and needs a `Suspense` boundary around
 * it, so the shell can still be prerendered — the same shape as
 * [`/afas/updateconnectors`](../../afas/updateconnectors/page.tsx). The fallback is
 * null rather than a spinner: the sidebar is already outside this boundary and the
 * params resolve in the same tick.
 */
export default function ModulePage() {
  return (
    <Suspense fallback={null}>
      <ModulePageContent />
    </Suspense>
  );
}
