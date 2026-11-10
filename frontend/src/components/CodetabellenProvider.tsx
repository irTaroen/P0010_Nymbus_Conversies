"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useModule } from "@/components/ModuleProvider";
import { useProject } from "@/components/ProjectProvider";
import {
  ensureCodetabellenForModule,
  refreshCodetabellenForModule,
  unresolvedCodetabellen,
} from "@/lib/validation/codetabellen";
import {
  ensureAfasRecordsForModule,
  unresolvedAfasRecords,
} from "@/lib/validation/afas-records";

interface CodetabellenContextValue {
  /**
   * Bumped once every codetabel the active module needs has been fetched (or
   * has failed and been given up on). Nothing reads the number itself — it is a
   * change signal: depend on it to re-run work that reads the tables.
   */
  loadedAt: number;
  /**
   * The tables this module's rules reference that **no AFAS environment could
   * serve**, so the columns pointing at them went unchecked — and, for a module with
   * an `existing-record` check, its records list when AFAS couldn't answer.
   *
   * An absent table makes its check *pass* (`codetabelVerdict` in engine.ts), which
   * is the right call — judging a column against an empty list would flag every
   * value in it — but it is indistinguishable, on screen, from a column that was
   * checked and found clean: a sheet reads *0 velden met fouten* either way. That
   * silence is the failure this list exists to break. Empty while the fetch is
   * still in flight, and empty in the normal case where everything resolved.
   */
  unresolved: string[];
  /**
   * Fetch this module's tables again straight from AFAS, past the backend's
   * one-hour cache — for a table the customer changed during the day. Admin-only
   * on the backend; resolves with how many tables were refreshed and bumps
   * `loadedAt`, so the sheet is validated again against the new values.
   */
  refresh: () => Promise<number>;
}

const NONE: string[] = [];

/**
 * Everything this module's checks read from AFAS: its codetabellen, and — for a
 * module with an `existing-record` check — the records the environment its workflow
 * task imports into (test, then live) already holds (`lib/validation/afas-records.ts`). One fetch, one `loadedAt`, so the sheet
 * is re-validated once both have landed rather than twice.
 */
function ensureModuleLists(projectId: string, moduleId: string): Promise<unknown> {
  return Promise.all([
    ensureCodetabellenForModule(projectId, moduleId),
    ensureAfasRecordsForModule(projectId, moduleId),
  ]);
}

/** The lists that left a check unrun: unserved codetabellen, then an unanswered records read. */
function unresolvedLists(moduleId: string): string[] {
  const records = unresolvedAfasRecords(moduleId);
  return [...unresolvedCodetabellen(moduleId), ...(records ? [records] : [])];
}

const CodetabellenContext = createContext<CodetabellenContextValue>({
  loadedAt: 0,
  unresolved: NONE,
  refresh: () => Promise.resolve(0),
});

/**
 * Fetches the AFAS codetabellen the active module needs, out of **this project's**
 * own live AFAS environment.
 *
 * The tables a module requires are derived from its rules; each is fetched once per
 * project per session, so switching module never refetches one already held — while
 * switching project does, since a codetabel is that customer's table and not a
 * global one.
 *
 * **The fetch is asynchronous and nothing is bundled**, so there is a window in
 * which a module's page is up and its tables are not. A sheet validated inside that
 * window has its `codetabel` checks skipped (an absent table passes — see
 * `codetabelVerdict` in engine.ts), which would leave a wrong landcode unflagged and,
 * worse, silently: the cell would carry no error and so no value picker either. That
 * is what `loadedAt` is for — it tells the page the tables have landed so it can
 * validate again, now that there is something to validate against.
 *
 * A table no environment can serve (the project's AFAS credentials aren't filled in
 * yet, AFAS is down) is left absent rather than failing the page — the engine then
 * skips that check and the help drawer says the column went unchecked. See
 * `registry.ts`.
 */
export function CodetabellenProvider({ children }: { children: React.ReactNode }) {
  // **The URL's module, not `selectedModuleId`.** The latter is the route's module
  // *resolved against the project's fetched module list*, so it stays null for the
  // whole first paint (the list is still in flight) and for any module the list
  // doesn't contain. `ExcelUploader`, meanwhile, validates against the route's
  // module unconditionally — so keying the fetch on the resolved one lets a sheet
  // be judged with its `codetabel` checks skipped while this provider waits for a
  // list it doesn't actually need. The tables belong to the module the page is
  // showing; that is `routeModuleId`.
  const { routeModuleId } = useModule();
  const { selectedProjectId } = useProject();
  const [loadedAt, setLoadedAt] = useState(0);
  // Read after the fetch settles rather than kept in the registry's module scope,
  // so it is React state the UI can render off. Tagged with the project and module
  // it was read for, and only shown while those are still the ones on screen: the
  // previous module's missing tables would otherwise stay up until the next fetch
  // landed — and for good on a page with no module at all.
  const [resolvedFor, setResolvedFor] = useState<{ key: string; missing: string[] }>({
    key: "",
    missing: NONE,
  });
  const scopeKey = routeModuleId ? `${selectedProjectId}\u0000${routeModuleId}` : "";
  const unresolved = resolvedFor.key === scopeKey ? resolvedFor.missing : NONE;

  useEffect(() => {
    if (!routeModuleId) return;
    let current = true;
    ensureModuleLists(selectedProjectId, routeModuleId).then(() => {
      // Guard against a module/project switch that happened while we waited:
      // signalling then would re-validate against the wrong module's tables.
      if (!current) return;
      const missing = unresolvedLists(routeModuleId);
      setResolvedFor({ key: scopeKey, missing: missing.length ? missing : NONE });
      setLoadedAt(Date.now());
    });
    return () => {
      current = false;
    };
  }, [selectedProjectId, routeModuleId, scopeKey]);

  const refresh = useCallback(async () => {
    if (!routeModuleId) return 0;
    // The records list has no backend cache to get past; it is simply read again.
    const [count] = await Promise.all([
      refreshCodetabellenForModule(selectedProjectId, routeModuleId),
      ensureAfasRecordsForModule(selectedProjectId, routeModuleId),
    ]);
    const missing = unresolvedLists(routeModuleId);
    setResolvedFor({ key: scopeKey, missing: missing.length ? missing : NONE });
    setLoadedAt(Date.now());
    return count;
  }, [selectedProjectId, routeModuleId, scopeKey]);

  const value = useMemo<CodetabellenContextValue>(
    () => ({ loadedAt, unresolved, refresh }),
    [loadedAt, unresolved, refresh]
  );

  return (
    <CodetabellenContext.Provider value={value}>
      {children}
    </CodetabellenContext.Provider>
  );
}

/**
 * The signal that this module's codetabellen have been fetched. Depend on
 * `loadedAt` wherever a result read from the tables has to be recomputed once they
 * arrive — see the provider's note on the window between page and tables.
 */
export function useCodetabellen(): CodetabellenContextValue {
  return useContext(CodetabellenContext);
}
