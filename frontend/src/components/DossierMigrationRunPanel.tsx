"use client";

import { useEffect, useState } from "react";
import { Loader2, PlayCircle, Zap } from "lucide-react";
import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";
import { Notice } from "@/components/settings/SettingsFields";
import { ApiError } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { formatCheckedAt } from "@/lib/project-progress";
import {
  fetchDossierMigrationRun,
  fetchDossierMigrationRuns,
  startDossierMigrationRun,
  type DossierMigrationRun,
} from "@/lib/dossier-migration";

/**
 * Dry-run / live-run controls for one project's dossier migration, and the
 * live progress of whichever run is (or was last) going.
 *
 * A run happens in the background on the backend (`dossier_migration.py`'s
 * `start_run`/`RunState`) — starting one returns a `runId` right away, and
 * this polls `GET .../runs/{runId}` every {@link POLL_MS} while its status is
 * `"running"`. On mount it first asks for the project's most recent run
 * (`fetchDossierMigrationRuns`) so a page reload doesn't lose sight of one
 * still going, or of the last one's result.
 *
 * *Proefdraai* (dry run) is always the plain primary action — the app's
 * dry-run-first rule — while *Live conversie* sits behind a confirm step
 * (`ModalWarningHeader`), the same "confirm before something consequential"
 * shape the upload flow's admin preview uses: this genuinely writes files
 * into the target AFAS environment.
 */
const POLL_MS = 2000;

export default function DossierMigrationRunPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const [run, setRun] = useState<DossierMigrationRun | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [starting, setStarting] = useState<"dry" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  useEffect(() => {
    let current = true;
    fetchDossierMigrationRuns(projectId)
      .then((runs) => {
        // A run started from here while this was in flight is newer than
        // anything the list can say — keep it.
        if (current) setRun((started) => started ?? runs[0] ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (current) setLoadingInitial(false);
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  const runId = run?.runId;
  const runStatus = run?.status;
  useEffect(() => {
    // Deliberately keyed on the id + status, not the whole `run` object: a
    // tick's own `setRun(next)` must not tear down and rebuild this interval
    // on every poll, only when a different run starts or this one settles.
    if (!runId || runStatus !== "running") return;
    let current = true;
    const timer = setInterval(() => {
      fetchDossierMigrationRun(projectId, runId)
        .then((next) => {
          if (current) setRun(next);
        })
        .catch(() => {
          // A hiccup on one poll isn't worth surfacing — the next tick tries again.
        });
    }, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [projectId, runId, runStatus]);

  async function start(dryRun: boolean) {
    setError(null);
    setStarting(dryRun ? "dry" : "live");
    try {
      const started = await startDossierMigrationRun(projectId, dryRun);
      setRun(started);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : tr("De dossierconversie kon niet worden gestart.", "The dossier conversion could not be started.")
      );
    } finally {
      setStarting(null);
      setConfirmLive(false);
    }
  }

  const running = run?.status === "running";
  // Also while the first list is still loading: until it answers we don't know
  // whether a run is already going, and starting one now could start a second.
  const busy = running || starting !== null || loadingInitial;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ModalButton tone="primary" onClick={() => start(true)} disabled={busy}>
          <PlayCircle className="h-4 w-4" strokeWidth={1.8} />
          {starting === "dry" ? t("Starten…", "Starting…") : t("Proefdraai", "Dry run")}
        </ModalButton>
        <ModalButton tone="danger" onClick={() => setConfirmLive(true)} disabled={busy}>
          <Zap className="h-4 w-4" strokeWidth={1.8} />
          {t("Live conversie", "Live conversion")}
        </ModalButton>
        {running && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-k-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-k-cloud-deep" strokeWidth={2} />
            {t("Bezig…", "Running…")}
          </span>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {!loadingInitial && !run && (
        <p className="text-sm text-k-text-secondary">
          {t("Nog geen conversie uitgevoerd voor dit project.", "No conversion has been run for this project yet.")}
        </p>
      )}

      {run && (
        <div className="space-y-4 rounded-2xl bg-k-bg p-4 shadow-raised">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RunStatusBadge run={run} />
            <p className="text-xs text-k-text-secondary">
              {run.dryRun ? t("Proefdraai", "Dry run") : t("Live conversie", "Live conversion")} · {t("gestart", "started")}{" "}
              {formatCheckedAt(run.startedAt)}
              {run.finishedAt && ` · ${t("klaar", "finished")} ${formatCheckedAt(run.finishedAt)}`}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            <StatTile figure={run.stats.totalSource} caption={t("Bron", "Source")} />
            <StatTile figure={run.stats.alreadyPresent} caption={t("Al aanwezig", "Already present")} />
            <StatTile figure={run.stats.toTransfer} caption={t("Over te zetten", "To transfer")} />
            <StatTile figure={run.stats.succeeded} caption={t("Gelukt", "Succeeded")} tone="good" />
            <StatTile
              figure={run.stats.failed}
              caption={t("Mislukt", "Failed")}
              tone={run.stats.failed > 0 ? "bad" : undefined}
            />
            <StatTile figure={run.stats.skipped} caption={t("Overgeslagen", "Skipped")} />
          </div>

          {run.error && <Notice tone="error">{run.error}</Notice>}

          {run.stats.failures.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
                {t("Mislukte bestanden", "Failed files")}
              </h4>
              <ul className="mt-2 space-y-1">
                {run.stats.failures.map((failure, i) => (
                  <li key={i} className="rounded-xl bg-k-red-bg px-3 py-2 text-xs text-k-red-fg">
                    <span className="font-semibold">{failure.medewerker ?? "?"}</span>
                    {" — "}
                    {failure.bestand ?? t("onbekend bestand", "unknown file")}: {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {confirmLive && (
        <Modal onDismiss={() => setConfirmLive(false)} className="max-w-md">
          <ModalWarningHeader title={t("Live conversie starten?", "Start live conversion?")}>
            {t(
              "Dit zet echt bestanden over naar de doelomgeving — dit is niet ongedaan te maken. Bekijk eerst het resultaat van een proefdraai.",
              "This really transfers files to the target environment — this cannot be undone. Check the result of a dry run first.",
            )}
          </ModalWarningHeader>
          <div className="flex justify-end gap-2 border-t border-k-divider px-6 py-4">
            <ModalButton onClick={() => setConfirmLive(false)}>{t("Annuleren", "Cancel")}</ModalButton>
            <ModalButton tone="danger" onClick={() => start(false)} disabled={starting !== null}>
              {starting === "live" ? t("Starten…", "Starting…") : t("Ja, live overzetten", "Yes, transfer live")}
            </ModalButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RunStatusBadge({ run }: { run: DossierMigrationRun }) {
  const t = useT();
  const tone =
    run.status === "running"
      ? "bg-k-cloud-light/40 text-k-cloud-deep"
      : run.status === "done"
        ? "bg-k-green-bg text-k-green-fg"
        : "bg-k-red-bg text-k-red-fg";
  const label =
    run.status === "running"
      ? t("Bezig", "Running")
      : run.status === "done"
        ? t("Klaar", "Done")
        : t("Mislukt", "Failed");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide shadow-inset-sm ${tone}`}
    >
      {label}
    </span>
  );
}

function StatTile({
  figure,
  caption,
  tone,
}: {
  figure: number;
  caption: string;
  tone?: "good" | "bad";
}) {
  const color = tone === "good" ? "text-k-green-fg" : tone === "bad" ? "text-k-red-fg" : "text-k-text-primary";
  return (
    <div>
      <div className={`text-2xl font-bold leading-none tracking-tight tabular-nums ${color}`}>
        {figure}
      </div>
      <p className="mt-1 text-xs leading-snug text-k-text-secondary">{caption}</p>
    </div>
  );
}
