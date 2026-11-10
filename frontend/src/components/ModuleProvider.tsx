"use client";

import { useParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useProject } from "@/components/ProjectProvider";
import {
  fetchProjectModules,
  type ModuleDef,
  type ModuleGroup,
  type ModuleStatus,
} from "@/lib/modules";
import { fetchCustomModules, type CustomModule } from "@/lib/custom-modules";

interface ModuleContextValue {
  /** The active project's module groups (HRM / ERP), fetched from the backend. */
  groups: ModuleGroup[];
  /** Every module in `groups`, flattened — the set the user may pick from. */
  modules: ModuleDef[];
  /**
   * Where each of them stands in AFAS, keyed by module id: the deeltaak's
   * workflow status, the task it waits on, and whether a sheet may be handed in.
   * Empty while the fetch is loading or after it failed.
   */
  statuses: Map<string, ModuleStatus>;
  /** State of the module fetch for the active project. */
  status: "loading" | "ready" | "error";
  /**
   * The module id the URL carries, or null on a page that names none (the project's
   * own page). Untested against the project — it is whatever was typed — so it is
   * what the sidebar highlights (that can't wait for a fetch) and nothing else.
   */
  routeModuleId: string | null;
  /**
   * `routeModuleId` once it is known to be one of this project's modules. Null while
   * the modules are still loading and for a module this project can't import, which
   * is exactly the difference `status` tells apart.
   */
  selectedModuleId: string | null;
  /**
   * Re-read the project's modules from AFAS. Handing a sheet in moves its deeltaak
   * on, so the status this provider holds is stale the moment that call returns.
   */
  refresh: () => Promise<void>;
  /**
   * The project's custom modules (maatwerk) — the extra steps some projects add to a
   * standard module, see [`custom-modules.ts`](../lib/custom-modules.ts). Fetched
   * beside the modules rather than with them: they live in the app's own store, not
   * in AFAS, and a failure here must not take the HRM/ERP list down with it — it
   * reads as "none".
   */
  customModules: CustomModule[];
  /** Re-read them — after the settings dialog adds or removes one, or a mapping is saved. */
  refreshCustomModules: () => Promise<void>;
}

const ModuleContext = createContext<ModuleContextValue | null>(null);

/** Stable identity for "no modules", so the context value doesn't churn. */
const NO_GROUPS: ModuleGroup[] = [];
const NO_STATUSES = new Map<string, ModuleStatus>();
const NO_CUSTOM_MODULES: CustomModule[] = [];

/**
 * Which modules the open project may import, and which of them the URL is on.
 *
 * The active module is the URL's (`/{project}/{module}`), so this provider holds no
 * selection of its own and there is no setter: moving to another module is a
 * navigation, which the sidebar's [`GuardedLink`](./NavigationGuard.tsx)s perform and
 * the uploader's leave prompt can intercept. What is left here is the per-project
 * fetch, and resolving the URL's module against its result.
 */
export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const { selectedProjectId } = useProject();
  // The URL's params, from anywhere in the tree — this provider sits above the
  // `[module]` segment, so it reads the module the page below it is on.
  const params = useParams<{ module?: string }>();
  const routeModuleId = typeof params.module === "string" ? params.module : null;

  // The fetch result, tagged with the project it was fetched for (`groups: null`
  // means it failed). Anything belonging to another project is stale by definition,
  // so a project switch needs no reset — it just stops matching.
  const [fetched, setFetched] = useState<{
    projectId: string;
    groups: ModuleGroup[] | null;
    statuses: Map<string, ModuleStatus>;
  } | null>(null);

  // Modules belong to a project, so every project switch reloads them.
  useEffect(() => {
    let current = true;
    fetchProjectModules(selectedProjectId)
      .then(({ groups, statuses }) => {
        if (current) setFetched({ projectId: selectedProjectId, groups, statuses });
      })
      .catch(() => {
        if (current) {
          setFetched({ projectId: selectedProjectId, groups: null, statuses: NO_STATUSES });
        }
      });
    return () => {
      current = false;
    };
  }, [selectedProjectId]);

  // Custom modules, tagged with their project like the fetch above.
  const [customFetched, setCustomFetched] = useState<{
    projectId: string;
    modules: CustomModule[];
  } | null>(null);

  useEffect(() => {
    let current = true;
    fetchCustomModules(selectedProjectId)
      .then((modules) => {
        if (current) setCustomFetched({ projectId: selectedProjectId, modules });
      })
      .catch(() => {
        if (current) setCustomFetched({ projectId: selectedProjectId, modules: NO_CUSTOM_MODULES });
      });
    return () => {
      current = false;
    };
  }, [selectedProjectId]);

  const refreshCustomModules = useCallback(async () => {
    try {
      const modules = await fetchCustomModules(selectedProjectId);
      setCustomFetched({ projectId: selectedProjectId, modules });
    } catch {
      // Keep the previous answer.
    }
  }, [selectedProjectId]);

  const customModules =
    customFetched?.projectId === selectedProjectId
      ? customFetched.modules
      : NO_CUSTOM_MODULES;

  // A re-read on demand. Deliberately leaves what is on screen standing if it
  // fails: the modules the user is looking at are still the project's modules,
  // and only the status behind them would be out of date.
  const refresh = useCallback(async () => {
    try {
      const { groups, statuses } = await fetchProjectModules(selectedProjectId);
      setFetched({ projectId: selectedProjectId, groups, statuses });
    } catch {
      // Keep the previous answer.
    }
  }, [selectedProjectId]);

  const current = fetched?.projectId === selectedProjectId ? fetched : null;
  const groups = current?.groups ?? NO_GROUPS;
  const statuses = current?.statuses ?? NO_STATUSES;
  const status: ModuleContextValue["status"] = !current
    ? "loading"
    : current.groups
      ? "ready"
      : "error";

  const modules = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // A module the project doesn't have is never active — which is also how a project
  // switch that lands on a module the new project lacks resolves to nothing.
  const selectedModuleId =
    routeModuleId && modules.some((m) => m.id === routeModuleId)
      ? routeModuleId
      : null;

  const value = useMemo<ModuleContextValue>(
    () => ({
      groups,
      modules,
      statuses,
      status,
      routeModuleId,
      selectedModuleId,
      refresh,
      customModules,
      refreshCustomModules,
    }),
    [
      groups,
      modules,
      statuses,
      status,
      routeModuleId,
      selectedModuleId,
      refresh,
      customModules,
      refreshCustomModules,
    ]
  );

  return (
    <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
  );
}

export function useModule(): ModuleContextValue {
  const ctx = useContext(ModuleContext);
  if (!ctx) {
    throw new Error("useModule must be used within a ModuleProvider");
  }
  return ctx;
}
