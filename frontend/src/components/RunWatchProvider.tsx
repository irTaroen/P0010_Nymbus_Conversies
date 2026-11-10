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
import { usePathname } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, Square, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { fetchSendRun, isDeleteRun, type SendOutcome } from "@/lib/payload-send";
import { parseAppPath } from "@/lib/routes";
import { useT } from "@/lib/i18n";

/**
 * Tells you a send or delete run has finished, wherever you are in the app by then.
 *
 * [`SendRunProvider`](./SendRunProvider.tsx) follows a project's runs, and it lives in
 * the project layout. Switch to another project and it lets go of them, which is
 * right for the payload panel but leaves nobody watching a run of several minutes
 * that is still writing to AFAS. This provider sits in the root layout, above every
 * project, so it can be the one that notices the run end and puts up a toast.
 *
 * ### Two sources, one record per run
 *
 * `SendRunProvider` hands over every run it stores ({@link RunWatchContextValue.track}),
 * along with the project and module names a toast needs, since neither is on the run
 * itself. While that provider is polling, its updates arrive every two seconds and
 * this one stays idle. A run that goes {@link STALE_MS} without an update has lost
 * its watcher (its project is no longer open), so from then on this provider polls
 * it itself. Either way, the change from `running` to anything else is what raises
 * the toast, so it fires exactly once, whoever saw the change first.
 *
 * A run first seen already settled (a finished one picked up by `adopt`) never
 * raises one: nobody in this tab was waiting for it.
 *
 * ### No toast for the screen that already says it
 *
 * When the run's own module is the page you're on, the payload panel's green or
 * amber notice is already reporting it, so the toast would only repeat it.
 *
 * The toast carries no link: it renders outside the project's
 * `NavigationGuardProvider`, and a link that skips the guard would walk straight
 * past the prompt protecting an open sheet. It names the project and the module instead.
 */

/** How often this provider polls the runs it has taken over. */
const POLL_MS = 3000;
/** Without an update for this long, a run's own provider has let go of it. */
const STALE_MS = 6000;
/** How long a clean result stays up. One with refusals or an error stays until closed. */
const AUTO_DISMISS_MS = 10000;

/** Where a run was started, for the toast's second line. */
export interface RunContext {
  projectId: string;
  projectName: string;
  moduleLabel: string;
}

interface Watched extends RunContext {
  run: SendOutcome;
  /** `Date.now()` of the last update, from either source. */
  seenAt: number;
}

interface Toast extends RunContext {
  id: string;
  run: SendOutcome;
}

interface RunWatchContextValue {
  /** Report a run's latest state. Raises the toast when it has just stopped running. */
  track: (run: SendOutcome, context: RunContext) => void;
}

const RunWatchContext = createContext<RunWatchContextValue | null>(null);

export function RunWatchProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  // Read inside `track` and the poll, not during render, so a ref keeps it current
  // without making `track` change identity on every navigation.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const watched = useRef(new Map<string, Watched>());
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The number of runs still going, so the poll's effect only runs while there are any.
  const [pending, setPending] = useState(0);

  const syncPending = useCallback(() => {
    let count = 0;
    for (const entry of watched.current.values()) {
      if (entry.run.status === "running") count += 1;
    }
    setPending(count);
  }, []);

  const track = useCallback(
    (run: SendOutcome, context: RunContext) => {
      const previous = watched.current.get(run.runId);
      watched.current.set(run.runId, { ...context, run, seenAt: Date.now() });

      const finished =
        previous?.run.status === "running" && run.status !== "running";
      if (finished) {
        watched.current.delete(run.runId);
        const here = parseAppPath(pathRef.current);
        const onItsPage =
          here.projectId === context.projectId && here.moduleId === run.moduleId;
        if (!onItsPage) {
          setToasts((current) => [
            ...current.filter((toast) => toast.id !== run.runId),
            { ...context, id: run.runId, run },
          ]);
        }
      } else if (run.status !== "running") {
        // Settled and never seen running: nothing to announce, nothing to keep.
        watched.current.delete(run.runId);
      }
      syncPending();
    },
    [syncPending],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const authenticated = status === "authenticated";

  useEffect(() => {
    if (!pending || !authenticated) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      const now = Date.now();
      const stale = [...watched.current.values()].filter(
        (entry) => entry.run.status === "running" && now - entry.seenAt > STALE_MS,
      );
      for (const entry of stale) {
        try {
          const run = await fetchSendRun(entry.run.runId);
          if (stopped) return;
          track(run, entry);
        } catch {
          // A missed poll says nothing about the run. Try again on the next tick,
          // the same rule `SendRunProvider` follows.
        }
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pending, authenticated, track]);

  const value = useMemo(() => ({ track }), [track]);

  return (
    <RunWatchContext.Provider value={value}>
      {children}
      {authenticated && toasts.length > 0 && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {toasts.map((toast) => (
            <RunToast key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </RunWatchContext.Provider>
  );
}

/** The run watcher. Throws outside the provider, like the rest. */
export function useRunWatch(): RunWatchContextValue {
  const context = useContext(RunWatchContext);
  if (!context)
    throw new Error("useRunWatch moet binnen een RunWatchProvider staan.");
  return context;
}

/** One finished run, in the wording `SendProgress` and the payload panel use. */
function RunToast({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const { run } = toast;
  const removing = isDeleteRun(run);
  const missing = run.skippedMissing?.length ?? 0;
  const clean = run.status === "done" && run.failed === 0 && missing === 0;

  useEffect(() => {
    if (!clean) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [clean, onDismiss, toast.id]);

  const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;
  const verb = removing ? t("verwijderd", "removed") : t("aangemaakt", "created");
  const where = `${removing ? t("uit", "from") : t("in", "in")} ${run.environment}`;

  let title: string;
  let body: string;
  let icon: React.ReactNode;
  if (run.status === "failed") {
    title = removing ? t("Verwijderen mislukt", "Removal failed") : t("Versturen mislukt", "Sending failed");
    body = `${records(run.sent)} ${verb} ${where} ${t("voordat de run stopte", "before the run stopped")}${
      run.error ? `: ${run.error}` : "."
    }`;
    icon = <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-k-red-fg" strokeWidth={2} />;
  } else if (run.status === "stopped") {
    title = removing ? t("Verwijderen gestopt", "Removal stopped") : t("Versturen gestopt", "Sending stopped");
    body = t(
      `${run.done} van ${run.total} verwerkt: ${records(run.sent)} ${verb} ${where}.`,
      `${run.done} of ${run.total} processed: ${records(run.sent)} ${verb} ${where}.`,
    );
    icon = <Square className="mt-0.5 h-4 w-4 shrink-0 text-k-text-secondary" strokeWidth={1.8} />;
  } else if (run.failed > 0 || missing > 0) {
    title = removing
      ? t("Verwijderen klaar, met weigeringen", "Removal done, with refusals")
      : run.failed > 0
        ? t("Versturen klaar, met weigeringen", "Sending done, with refusals")
        : t("Versturen klaar, niet alles verstuurd", "Sending done, not everything sent");
    body = `${run.sent} ${verb}${
      run.failed > 0 ? t(`, ${run.failed} geweigerd`, `, ${run.failed} refused`) : ""
    }${
      missing > 0
        ? t(`, ${missing} niet verstuurd (ontbreekt in AFAS)`, `, ${missing} not sent (missing in AFAS)`)
        : ""
    } ${where}.`;
    icon = (
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-k-amber-fg" strokeWidth={1.8} />
    );
  } else {
    title = removing ? t("Verwijderen klaar", "Removal done") : t("Versturen klaar", "Sending done");
    body = `${records(run.sent)} ${verb} ${where}.`;
    icon = (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-k-green-fg" strokeWidth={1.8} />
    );
  }

  return (
    <div
      role={clean ? "status" : "alert"}
      className="pointer-events-auto flex items-start gap-2.5 rounded-[14px] bg-k-bg px-3.5 py-3 text-sm shadow-raised"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-k-text-primary">{title}</p>
        <p className="mt-0.5 text-k-text-secondary">{body}</p>
        <p className="mt-1 truncate text-xs text-k-text-secondary">
          {toast.projectId} · {toast.projectName} · {toast.moduleLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t("Melding sluiten", "Close notice")}
        className="-mt-0.5 -mr-1 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
