"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Download, Loader2, SearchCheck } from "lucide-react";
import { ModalButton } from "@/components/Modal";
import { Notice } from "@/components/settings/SettingsFields";
import { ApiError } from "@/lib/api";
import { checkProjectConnectors, gcnDownloadUrl, type ConnectorCheck } from "@/lib/projects";
import { tr, useT } from "@/lib/i18n";

/**
 * The *Connectoren* tab: does the client's environment expose everything this tool
 * reads and writes? A new client has none of our GetConnectors until the `.gcn`
 * files in `connectoren/` are imported **and** added to the app connector — and
 * without them a codetabel check silently passes and *Bestaat al* can't be read. So
 * this lists every one, present or missing, with the file to import, plus the
 * UpdateConnectors the project's modules send to.
 *
 * It only checks; the import is done by hand in Profit.
 */
export default function ConnectorCheckTab({ projectId }: { projectId: string }) {
  const t = useT();
  const [stage, setStage] = useState<"test" | "live">("test");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ConnectorCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(next: "test" | "live" = stage) {
    setStage(next);
    setChecking(true);
    setError(null);
    try {
      setResult(await checkProjectConnectors(projectId, next));
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiError
          ? err.message
          : tr("De connectoren konden niet worden gecontroleerd.", "The connectors could not be checked.")
      );
    } finally {
      setChecking(false);
    }
  }

  const missingGet = result?.getConnectors.filter((c) => !c.present) ?? [];
  const missingUpdate = result?.updateConnectors.filter((c) => !c.present) ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-k-text-secondary">
        {t(
          "Controleert of de AFAS-omgeving van deze klant alle GetConnectors van de tool aanbiedt (de .gcn-bestanden in connectoren/) en de UpdateConnectors waar de modules van dit project naartoe sturen. Ontbrekende GetConnectors importeer je in Profit en voeg je toe aan de app-connector.",
          "Checks whether this client's AFAS environment offers every GetConnector the tool uses (the .gcn files in connectoren/) and the UpdateConnectors this project's modules send to. Import a missing GetConnector in Profit and add it to the app connector."
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(["test", "live"] as const).map((option) => (
          <ModalButton
            key={option}
            tone={stage === option && result ? "primary" : "secondary"}
            onClick={() => void run(option)}
            disabled={checking}
          >
            {checking && stage === option ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <SearchCheck className="h-4 w-4" strokeWidth={1.8} />
            )}
            {option === "test"
              ? t("Testomgeving controleren", "Check test environment")
              : t("Live-omgeving controleren", "Check live environment")}
          </ModalButton>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {result && !result.ok && <Notice tone="error">{result.message}</Notice>}

      {result?.ok && (
        <>
          <Notice tone={missingGet.length + missingUpdate.length === 0 ? "success" : "error"}>
            {missingGet.length + missingUpdate.length === 0
              ? t(
                  `Alles aanwezig in ${result.environment?.host ?? "de omgeving"}.`,
                  `Everything present in ${result.environment?.host ?? "the environment"}.`
                )
              : t(
                  `${missingGet.length} GetConnector(s) en ${missingUpdate.length} UpdateConnector(s) ontbreken in ${result.environment?.host ?? "de omgeving"}.`,
                  `${missingGet.length} GetConnector(s) and ${missingUpdate.length} UpdateConnector(s) are missing in ${result.environment?.host ?? "the environment"}.`
                )}
          </Notice>

          <ConnectorList
            title={t("UpdateConnectors van de modules", "The modules' UpdateConnectors")}
            empty={t("Dit project heeft nog geen module met een koppeling.", "This project has no module with a mapping yet.")}
            rows={result.updateConnectors.map((c) => ({
              id: c.id,
              present: c.present,
              detail: c.modules.join(", "),
            }))}
          />
          <ConnectorList
            title={t("GetConnectors (connectoren/)", "GetConnectors (connectoren/)")}
            empty={t("Er staan geen .gcn-bestanden in connectoren/.", "There are no .gcn files in connectoren/.")}
            rows={result.getConnectors.map((c) => ({ id: c.id, present: c.present, file: c.file }))}
          />
        </>
      )}
    </div>
  );
}

function ConnectorList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { id: string; present: boolean; detail?: string; file?: string }[];
}) {
  const t = useT();
  // Missing first: that is the list someone opens this tab for.
  const sorted = [...rows].sort((a, b) => Number(a.present) - Number(b.present));
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">{title}</h3>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-k-text-secondary">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-k-divider overflow-hidden rounded-xl bg-k-bg shadow-raised-sm">
          {sorted.map((row) => (
            <li key={row.id} className="flex items-center gap-2.5 px-3 py-2">
              {row.present ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-k-green-fg" strokeWidth={1.8} />
              ) : (
                <CircleAlert className="h-4 w-4 shrink-0 text-k-red-fg" strokeWidth={1.8} />
              )}
              <span className={`min-w-0 flex-1 truncate font-mono text-xs ${row.present ? "text-k-text-secondary" : "font-semibold text-k-text-primary"}`}>
                {row.id}
              </span>
              {row.detail && <span className="truncate text-xs text-k-text-tertiary">{row.detail}</span>}
              {!row.present && row.file && (
                <a
                  href={gcnDownloadUrl(row.file)}
                  download={row.file}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-k-cloud-deep hover:underline"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  {t("Downloaden", "Download")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
