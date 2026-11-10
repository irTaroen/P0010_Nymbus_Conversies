"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError } from "@/lib/api";
import {
  fetchActiveSendRun,
  fetchSendRun,
  startDeleteRun,
  startSendRun,
  stopSendRun,
  type DeleteRecord,
  type SendOutcome,
  type SendMeasure,
  type SendRecord,
  type SendSkipped,
  type SendStage,
  type SendStep,
} from "@/lib/payload-send";
import { useModule } from "@/components/ModuleProvider";
import { useProgress } from "@/components/ProgressProvider";
import { useProject } from "@/components/ProjectProvider";
import { useRunWatch } from "@/components/RunWatchProvider";

/**
 * The sends this project has going, above the screen that starts them.
 *
 * A send is a background run on the backend
 * ([`payload_send.py`](../../../backend/payload_send.py)) — a few hundred sequential
 * AFAS calls, minutes rather than seconds. The state of one therefore cannot live in
 * `ModulePayloadPanel`: that component unmounts the moment somebody switches to the
 * Data tab or opens another module, which is exactly the thing this change exists to
 * allow. So the run lives here, one per module, and the panel *reads* it.
 *
 * ### What this owns and what it doesn't
 *
 * Only the run: its id, its progress, and the polling that keeps it current. Which
 * records were picked, which phase they were built for, which stage the switch is on
 * — all of that stays in the panel, because all of it is gone the moment the sheet
 * closes anyway. This holds the part that outlives the screen.
 *
 * ### Polling, not a subscription
 *
 * Every {@link POLL_MS} while a run is `running`, the same way
 * [`DossierMigrationRunPanel`](./DossierMigrationRunPanel.tsx) follows its run. The
 * backend has no push channel and a send is measured in minutes, so a two-second
 * poll is both cheap and finer-grained than anybody reads a progress bar.
 *
 * A poll that fails is **not** a run that failed: a dropped request while the laptop
 * sleeps says nothing about the loop on the server, which is still posting records.
 * So a failed poll is swallowed and the next tick tries again — the run's own
 * failure arrives as `status: "failed"`, from the backend, which is the only thing
 * that knows.
 */

/** How often a running send is asked how far it has got. */
const POLL_MS = 2000;

interface SendRunContextValue {
  /** The run for a module — in progress or the last finished one — or `null`. */
  runFor: (moduleId: string) => SendOutcome | null;
  /**
   * Start a send. Resolves once the backend has *accepted* the run, not once it is
   * done; from there the run arrives through {@link runFor}.
   *
   * Throws an `ApiError` when the run is refused — nothing was sent in that case.
   */
  start: (
    moduleId: string,
    stage: SendStage,
    records: SendRecord[],
    /** Ticked records left out of this send, counted for its report. */
    skipped?: SendSkipped,
    /** What the outcome is measured against — see {@link SendMeasure}. */
    measure?: SendMeasure,
    /** The step of a multi-step module this send is — see {@link SendStep}. */
    step?: SendStep | null,
  ) => Promise<SendOutcome>;
  /**
   * Start removing records from AFAS — a run like a send's, polled and stopped the
   * same way, with `operation: "delete"`. Throws an `ApiError` when refused, and
   * then nothing was deleted.
   */
  startDelete: (
    moduleId: string,
    stage: SendStage,
    records: DeleteRecord[],
  ) => Promise<SendOutcome>;
  /**
   * Ask a module's running send to stop after the record it is on. Resolves once
   * the backend has taken the request; the run itself turns `stopped` a poll later.
   */
  stop: (moduleId: string) => Promise<void>;
  /**
   * Forget a module's finished run, so the panel stops showing last run's ticks and
   * counts. Refuses to drop one still running: the marks on those rows are the only
   * report of records being written right now.
   */
  clear: (moduleId: string) => void;
  /**
   * Take on a run this tab didn't start — what {@link useModuleSendRun} does with
   * the one the backend reports for a freshly opened panel. From then on it polls
   * like any other.
   */
  adopt: (moduleId: string, run: SendOutcome) => void;
  /** Every run still going, for the badge that shows outside the payload panel. */
  running: SendOutcome[];
}

const SendRunContext = createContext<SendRunContextValue | null>(null);

/** Stable identity for "no runs", so the context value doesn't churn. */
const EMPTY_RUNS: Map<string, SendOutcome> = new Map();

export function SendRunProvider({ children }: { children: React.ReactNode }) {
  const { selectedProject, selectedProjectId } = useProject();
  const { modules, customModules } = useModule();
  const { track } = useRunWatch();
  // A finished send has stamped its outcome onto the deeltaak — the badge re-reads it.
  const { refresh: refreshProgress } = useProgress();
  /**
   * Runs by module id, **tagged with the project they belong to**.
   *
   * The tag is what makes a project switch safe without an effect that resets the
   * map: anything from another project simply stops matching, the same trick
   * [`ProgressProvider`](./ProgressProvider.tsx) uses. Resetting in an effect would
   * also be a setState during render's commit, which this codebase's React Compiler
   * lint refuses — and rightly, since it would show one project's progress under
   * another's modules for a frame first.
   *
   * The map is replaced rather than mutated, so a poll that changes one run
   * re-renders the panels reading it.
   */
  const [stored, setStored] = useState<{
    projectId: string;
    byModule: Map<string, SendOutcome>;
  }>(() => ({ projectId: selectedProjectId, byModule: new Map() }));

  const runs = useMemo(
    () =>
      stored.projectId === selectedProjectId ? stored.byModule : EMPTY_RUNS,
    [stored, selectedProjectId],
  );

  /**
   * What `store` names a run with, read when it is called rather than closed over.
   * Closed over, every module refresh (which runs after each hand-off) rebuilt
   * `store` — and with it every panel's `adopt`, so each re-asked the backend for its
   * active run, and the poll below tore down and restarted its interval.
   */
  const naming = useRef({ track, projectName: selectedProject.name, modules, customModules });
  useEffect(() => {
    naming.current = { track, projectName: selectedProject.name, modules, customModules };
  });

  const store = useCallback(
    (moduleId: string, run: SendOutcome) => {
      const { track, projectName, modules, customModules } = naming.current;
      // Handed to the app-wide watcher too, which outlives this project's screen and
      // puts up the toast when the run ends — see `RunWatchProvider`.
      track(run, {
        projectId: selectedProjectId,
        projectName,
        moduleLabel:
          customModules.find((m) => m.id === moduleId)?.label ??
          modules.find((m) => m.id === moduleId)?.label ??
          moduleId,
      });
      setStored((current) => {
        // A run arriving for a project nobody is looking at any more is dropped
        // along with the rest of that project's map.
        const base =
          current.projectId === selectedProjectId
            ? current.byModule
            : EMPTY_RUNS;
        const next = new Map(base);
        next.set(moduleId, run);
        return { projectId: selectedProjectId, byModule: next };
      });
    },
    [selectedProjectId],
  );

  const start = useCallback(
    async (
      moduleId: string,
      stage: SendStage,
      records: SendRecord[],
      skipped?: SendSkipped,
      measure?: SendMeasure,
      step?: SendStep | null,
    ) => {
      const run = await startSendRun(
        selectedProjectId,
        moduleId,
        stage,
        records,
        skipped,
        measure,
        step,
      );
      store(moduleId, run);
      return run;
    },
    [selectedProjectId, store],
  );

  const startDelete = useCallback(
    async (moduleId: string, stage: SendStage, records: DeleteRecord[]) => {
      const run = await startDeleteRun(selectedProjectId, moduleId, stage, records);
      store(moduleId, run);
      return run;
    },
    [selectedProjectId, store],
  );

  const stop = useCallback(
    async (moduleId: string) => {
      const run = runs.get(moduleId);
      if (!run || run.status !== "running") return;
      store(moduleId, await stopSendRun(run.runId));
    },
    [runs, store],
  );

  const clear = useCallback(
    (moduleId: string) => {
      setStored((current) => {
        if (current.projectId !== selectedProjectId) return current;
        const run = current.byModule.get(moduleId);
        if (!run || run.status === "running") return current;
        const next = new Map(current.byModule);
        next.delete(moduleId);
        return { projectId: current.projectId, byModule: next };
      });
    },
    [selectedProjectId],
  );

  const runFor = useCallback(
    (moduleId: string) => runs.get(moduleId) ?? null,
    [runs],
  );

  // The ids being polled, as a stable string — the effect below restarts when a run
  // starts or settles, not on every progress update it installs itself.
  const pollable = useMemo(
    () =>
      [...runs.values()]
        .filter((run) => run.status === "running")
        .map((run) => `${run.moduleId}:${run.runId}`)
        .sort()
        .join(","),
    [runs],
  );

  useEffect(() => {
    if (!pollable) return;
    const entries = pollable
      .split(",")
      .map((entry) => entry.split(":") as [string, string]);
    let stopped = false;

    const tick = async () => {
      for (const [moduleId, runId] of entries) {
        try {
          const run = await fetchSendRun(runId);
          if (stopped) return;
          store(moduleId, run);
          // Only running runs are polled, so this is the moment it ended. The
          // backend stamps the deeltaak *before* the run reports itself done, so
          // the figure read now is already the new one.
          if (run.status !== "running" && run.operation !== "delete") {
            void refreshProgress();
          }
        } catch {
          // A poll that didn't land says nothing about the run — see the note above.
        }
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_MS);
    // Straight away as well as on the interval: a run just started shows `0 van 265`
    // until the first tick, and two seconds of a bar that hasn't moved reads as a
    // send that didn't take.
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pollable, store, refreshProgress]);

  const running = useMemo(
    () => [...runs.values()].filter((run) => run.status === "running"),
    [runs],
  );

  const value = useMemo(
    () => ({ runFor, start, startDelete, stop, clear, adopt: store, running }),
    [runFor, start, startDelete, stop, clear, store, running],
  );

  return (
    <SendRunContext.Provider value={value}>{children}</SendRunContext.Provider>
  );
}

/** The send runs of the open project. Throws outside the provider, like the rest. */
export function useSendRuns(): SendRunContextValue {
  const context = useContext(SendRunContext);
  if (!context)
    throw new Error("useSendRuns moet binnen een SendRunProvider staan.");
  return context;
}

/**
 * One module's run, picked up again on mount.
 *
 * The provider only knows about runs *this tab* started. A reload, or a panel opened
 * on a module somebody sent from an hour ago in another tab, has to ask the backend
 * — otherwise the screen offers a send button over records that are at that moment
 * being written. Asked once per module, and only while the provider has nothing:
 * once a run is in hand the polling above keeps it current.
 */
export function useModuleSendRun(moduleId: string): SendOutcome | null {
  const { runFor, adopt } = useSendRuns();
  const { selectedProjectId } = useProject();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await fetchActiveSendRun(selectedProjectId, moduleId);
        if (!cancelled && found) adopt(moduleId, found);
      } catch (error) {
        // A non-admin gets a 403 here and simply has no sends to adopt; anything
        // else is a lookup that failed, which is not worth a notice over a panel
        // that otherwise works. Not rethrown: nothing awaits this, so a rethrow
        // would only surface as an unhandled rejection.
        if (!(error instanceof ApiError)) {
          console.warn("Lopende verzending niet opgehaald:", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per module per project: the ask is "is something already running", and
    // once the provider has the run its own polling keeps it current.
  }, [adopt, moduleId, selectedProjectId]);

  return runFor(moduleId);
}
