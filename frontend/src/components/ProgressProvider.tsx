"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useProject } from "@/components/ProjectProvider";
import { fetchProjectProgress, type ModuleProgress } from "@/lib/project-progress";

interface ProgressContextValue {
  /** The active project's last known progress per module, keyed by catalog module id. */
  byModule: Map<string, ModuleProgress>;
  /**
   * Read the figures again from AFAS — call it after anything that just wrote them
   * onto a deeltaak's dossieritem (a hand-off, a workflow action, an admin's push).
   *
   * There is deliberately no way to set a figure locally: the badge describes what
   * the dossieritem holds, not the sheet on screen, so a validation run leaves it
   * alone and only a write to AFAS, read back from AFAS, moves it. Resolves once the
   * new figures are in place; a failed read keeps the ones already shown.
   */
  refresh: () => Promise<void>;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

/** Stable identity for "nothing checked yet", so the context value doesn't churn. */
const NO_PROGRESS: Map<string, ModuleProgress> = new Map();

/**
 * How far the active project is with each of its modules — the percentage and the
 * moment of the last hand-off, as the sidebar shows them.
 *
 * Straight from the deeltaak dossieritems in AFAS: loaded per project (a switch
 * reloads, like `ModuleProvider`) and read again through `refresh()` whenever an
 * action has just stamped new figures there. Checking a sheet in the browser does
 * not touch it — the badge says what AFAS was told, not what is on screen.
 */
export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const { selectedProjectId } = useProject();
  // Tagged with the project it belongs to, so anything from another project is stale
  // by definition and a project switch needs no reset — it just stops matching.
  const [fetched, setFetched] = useState<{
    projectId: string;
    byModule: Map<string, ModuleProgress>;
  } | null>(null);

  useEffect(() => {
    let current = true;
    fetchProjectProgress(selectedProjectId)
      .then((byModule) => {
        if (current) setFetched({ projectId: selectedProjectId, byModule });
      })
      // Progress is context, not the job: a project whose progress won't load still
      // uploads and validates, it just shows no badges.
      .catch(() => {
        if (current) setFetched({ projectId: selectedProjectId, byModule: new Map() });
      });
    return () => {
      current = false;
    };
  }, [selectedProjectId]);

  const refresh = useCallback(async () => {
    const projectId = selectedProjectId;
    try {
      const byModule = await fetchProjectProgress(projectId);
      // Dropped if the user switched project while the read was out — the
      // switch's own load answers for the project now on screen.
      setFetched((prev) =>
        prev === null || prev.projectId === projectId ? { projectId, byModule } : prev
      );
    } catch {
      // Keep the figures already shown: the write went through, only the read-back
      // didn't, and the next load will pick it up.
    }
  }, [selectedProjectId]);

  const byModule =
    fetched?.projectId === selectedProjectId ? fetched.byModule : NO_PROGRESS;

  const value = useMemo<ProgressContextValue>(
    () => ({ byModule, refresh }),
    [byModule, refresh]
  );

  return (
    <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
  );
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return ctx;
}
