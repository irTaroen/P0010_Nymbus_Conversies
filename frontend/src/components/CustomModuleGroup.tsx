"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Puzzle } from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import { useModule } from "@/components/ModuleProvider";
import { GuardedLink } from "@/components/NavigationGuard";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";
import { PAYLOAD_STEP_PARAM, payloadStepPath } from "@/lib/routes";

/**
 * The sidebar's *Maatwerk* group: the project's custom modules
 * ([`custom-modules.ts`](../lib/custom-modules.ts)), each a link to the step it adds
 * to its parent's payload view.
 *
 * **Admin-only**, like the payload view it links into (`SheetToolbar` gates that tab
 * the same way): a custom module has no sheet and no workflow for a client to act on
 * — its columns ride in the parent's sheet, and sending it is an admin's job.
 *
 * Shaped like the HRM/ERP groups above it, with two differences that follow from what
 * a custom module is. Its dot says whether a **mapping** is saved (green) or not yet
 * (grey), because that is the only state it has: there is no deeltaak, so no AFAS
 * status, and no check, so no percentage. And it is active on its parent's URL with
 * its own `?stap=`, since that is where it lives — hence the `Suspense` around the
 * search-params read, so the sidebar shell can still render without it.
 */
export default function CustomModuleGroup() {
  return (
    <AdminOnly>
      <Suspense fallback={null}>
        <CustomModuleGroupContent />
      </Suspense>
    </AdminOnly>
  );
}

function CustomModuleGroupContent() {
  const { customModules, modules, routeModuleId } = useModule();
  const { selectedProjectId } = useProject();
  const step = useSearchParams().get(PAYLOAD_STEP_PARAM);
  const [open, setOpen] = useState(true);
  const t = useT();

  // Only the ones whose parent this project actually has — a custom module on a
  // module the project lost would link to a page that answers "niet beschikbaar".
  const parents = new Set(modules.map((module) => module.id));
  const items = customModules.filter((module) =>
    parents.has(module.parentModuleId),
  );
  if (items.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 pointer-coarse:py-3 text-left text-sm font-medium text-k-text-secondary transition-[color,box-shadow] duration-150 hover:text-k-text-primary"
      >
        <span className="shrink-0 text-k-text-secondary">
          <Puzzle className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="flex-1 truncate">{t("Maatwerk", "Custom")}</span>
        <span className="shrink-0 rounded-full bg-k-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-text-secondary shadow-inset-sm">
          {items.length}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-k-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5 pl-4">
          {items.map((item) => {
            const active =
              routeModuleId === item.parentModuleId && step === item.id;
            return (
              <li key={item.id}>
                <GuardedLink
                  href={payloadStepPath(
                    selectedProjectId,
                    item.parentModuleId,
                    item.id,
                  )}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  title={`${t("Na", "After")} ${item.parentLabel} · ${item.connector} · ${
                    item.hasMapping
                      ? t("koppeling opgeslagen", "mapping saved")
                      : t("nog geen koppeling", "no mapping yet")
                  }`}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 pointer-coarse:py-3 text-left text-sm transition-[color,box-shadow,background-color] duration-150 ${
                    active
                      ? "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm"
                      : "text-k-text-secondary hover:text-k-text-primary"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      item.hasMapping ? "bg-k-green-fg" : "bg-k-divider"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="shrink-0 truncate text-[10px] text-k-text-tertiary">
                    {t("na", "after")} {item.parentLabel}
                  </span>
                  {!item.hasMapping && (
                    <span className="sr-only">{t("nog geen koppeling", "no mapping yet")}</span>
                  )}
                </GuardedLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
