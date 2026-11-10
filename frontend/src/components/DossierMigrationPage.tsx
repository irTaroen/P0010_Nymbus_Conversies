"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Home,
  PlugZap,
} from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import { useAuth } from "@/components/AuthProvider";
import { ModalButton } from "@/components/Modal";
import { GuardedLink } from "@/components/NavigationGuard";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/components/ProjectProvider";
import DossierMigrationRunPanel from "@/components/DossierMigrationRunPanel";
import {
  EmployeeMappingTable,
  FileMappingTable,
  type EmployeeMappingRow,
  type FileMappingRow,
} from "@/components/DossierMigrationMappingTable";
import RouteNotice from "@/components/RouteNotice";
import {
  ConnectionMark,
  Field,
  inputClass,
  Notice,
  SecretField,
  secretToSend,
  UNTESTED,
  UNTOUCHED,
  type ConnectionState,
  type SecretDraft,
} from "@/components/settings/SettingsFields";
import { ApiError } from "@/lib/api";
import { tr, useT } from "@/lib/i18n";
import { HOME_PATH } from "@/lib/routes";
import {
  fetchDossierMigrationSettings,
  saveDossierMigrationSettings,
  testDossierMigrationConnection,
  type DossierMigrationSettings,
  type DossierMigrationSide,
  type DossierMigrationStage,
} from "@/lib/dossier-migration";

/**
 * The whole page for a project whose `conversionType` is `"dossier"` —
 * replaces the usual sidebar + module list entirely (`[project]/layout.tsx`):
 * source and target AFAS environment, the employee/dossier-type mapping, and
 * the dry-run/live-run panel (`DossierMigrationRunPanel`).
 *
 * There is no `Sidebar` here, so this carries its own header — the same
 * "own header, own way back" shape `/afas/updateconnectors` uses for the
 * same reason (no project shell to hang under).
 */
export default function DossierMigrationPage() {
  const t = useT();
  return (
    <AdminOnly
      fallback={
        <RouteNotice
          title={t("Alleen voor beheerders", "Administrators only")}
          description={t(
            "Dossierconversie is een beheerdersfunctie en niet zichtbaar voor andere gebruikers.",
            "Dossier conversion is an administrator function and is not visible to other users."
          )}
          action={{ href: HOME_PATH, label: t("Naar mijn projecten", "To my projects") }}
        />
      }
    >
      <DossierMigrationContent />
    </AdminOnly>
  );
}

function DossierMigrationContent() {
  const { selectedProject, selectedProjectId, canSwitchProject } = useProject();
  const { session } = useAuth();
  const t = useT();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-k-divider bg-k-bg px-6 py-4">
        <GuardedLink
          href={HOME_PATH}
          className="neu-icon-btn"
          aria-label={t("Naar mijn projecten", "To my projects")}
          title={t("Naar mijn projecten", "To my projects")}
        >
          <Home className="h-5 w-5" strokeWidth={1.8} />
        </GuardedLink>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-k-text-primary">
            <ArrowLeftRight className="h-5 w-5 shrink-0 text-k-cloud-deep" strokeWidth={2} />
            {t("Dossierconversie", "Dossier conversion")}
          </h1>
          <p className="mt-0.5 text-sm text-k-text-secondary">
            {selectedProject.name}{" "}
            <span className="text-k-text-tertiary">
              · project <span className="tabular-nums">{selectedProjectId}</span>
            </span>
          </p>
        </div>
        {canSwitchProject && <ProjectSelector />}
        <div className="flex items-center gap-3 pl-2">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-semibold text-k-text-primary">{session?.user.name}</p>
            <p className="truncate text-xs text-k-text-secondary">{session?.user.email}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-8 pb-10">
          <DossierMigrationSettingsForm projectId={selectedProjectId} />
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-k-text-tertiary">
              {t("Conversie uitvoeren", "Run conversion")}
            </h2>
            <div className="mt-3">
              <DossierMigrationRunPanel projectId={selectedProjectId} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const SIDE_BADGE_TONE: Record<DossierMigrationSide, string> = {
  source: "bg-k-green-bg text-k-green-fg shadow-inset-sm",
  target: "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm",
};

function DossierMigrationSettingsForm({ projectId }: { projectId: string }) {
  const t = useT();
  const [settings, setSettings] = useState<DossierMigrationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sourceOmgeving, setSourceOmgeving] = useState("");
  const [sourceStage, setSourceStage] = useState<DossierMigrationStage>("live");
  const [sourceClientId, setSourceClientId] = useState("");
  const [sourceSecret, setSourceSecret] = useState<SecretDraft>(UNTOUCHED);

  const [targetOmgeving, setTargetOmgeving] = useState("");
  const [targetStage, setTargetStage] = useState<DossierMigrationStage>("live");
  const [targetClientId, setTargetClientId] = useState("");
  const [targetSecret, setTargetSecret] = useState<SecretDraft>(UNTOUCHED);
  const [targetGebruiker, setTargetGebruiker] = useState("");

  const [employeeRows, setEmployeeRows] = useState<EmployeeMappingRow[]>([]);
  const [fileRows, setFileRows] = useState<FileMappingRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Record<DossierMigrationSide, ConnectionState>>({
    source: UNTESTED,
    target: UNTESTED,
  });

  useEffect(() => {
    let current = true;
    fetchDossierMigrationSettings(projectId)
      .then((loaded) => {
        if (!current) return;
        applyLoaded(loaded);
      })
      .catch((err) => {
        if (current) {
          setLoadError(
            err instanceof ApiError
              ? err.message
              : tr(
                  "De dossierconversie-instellingen konden niet worden geladen.",
                  "The dossier conversion settings could not be loaded."
                )
          );
        }
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  function applyLoaded(loaded: DossierMigrationSettings) {
    setSettings(loaded);
    setSourceOmgeving(loaded.source.omgeving);
    setSourceStage(loaded.source.stage);
    setSourceClientId(loaded.source.clientId);
    setTargetOmgeving(loaded.target.omgeving);
    setTargetStage(loaded.target.stage);
    setTargetClientId(loaded.target.clientId);
    setTargetGebruiker(loaded.target.gebruiker ?? "");
    setEmployeeRows(
      Object.entries(loaded.mapping.employees).map(([source, target]) => ({ source, target }))
    );
    setFileRows(
      Object.entries(loaded.mapping.files).map(([key, v]) => ({
        key,
        type: v.type,
        kenmerk: v.kenmerk,
      }))
    );
    setSourceSecret(UNTOUCHED);
    setTargetSecret(UNTOUCHED);
  }

  function clearSaveError() {
    setSaveError(null);
  }

  function edited(side?: DossierMigrationSide) {
    clearSaveError();
    setConnections((current) =>
      side ? { ...current, [side]: UNTESTED } : { source: UNTESTED, target: UNTESTED }
    );
  }

  async function runTest(side: DossierMigrationSide) {
    if (connections[side].testing) return;
    setConnections((current) => ({ ...current, [side]: { testing: true, result: null } }));
    const omgeving = side === "source" ? sourceOmgeving : targetOmgeving;
    const stage = side === "source" ? sourceStage : targetStage;
    const clientId = side === "source" ? sourceClientId : targetClientId;
    const secret = side === "source" ? sourceSecret : targetSecret;
    try {
      const result = await testDossierMigrationConnection(projectId, {
        side,
        omgeving: omgeving.trim(),
        stage,
        clientId,
        clientSecret: secretToSend(secret),
      });
      setConnections((current) => ({ ...current, [side]: { testing: false, result } }));
    } catch (err) {
      setConnections((current) => ({
        ...current,
        [side]: {
          testing: false,
          result: {
            ok: false,
            message:
              err instanceof ApiError
                ? err.message
                : tr(
                    "De verbinding met AFAS kon niet worden getest.",
                    "The connection to AFAS could not be tested."
                  ),
          },
        },
      }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await saveDossierMigrationSettings(projectId, {
        source: {
          omgeving: sourceOmgeving.trim(),
          stage: sourceStage,
          clientId: sourceClientId,
          clientSecret: secretToSend(sourceSecret),
        },
        target: {
          omgeving: targetOmgeving.trim(),
          stage: targetStage,
          clientId: targetClientId,
          clientSecret: secretToSend(targetSecret),
          gebruiker: targetGebruiker.trim() || null,
        },
        mapping: {
          employees: Object.fromEntries(
            employeeRows
              .filter((r) => r.source.trim() && r.target.trim())
              .map((r) => [r.source.trim(), r.target.trim()])
          ),
          files: Object.fromEntries(
            fileRows
              .filter((r) => r.key.trim())
              .map((r) => [r.key.trim(), { type: r.type.trim(), kenmerk: r.kenmerk.trim() }])
          ),
        },
      });
      applyLoaded(stored);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : tr(
              "De dossierconversie-instellingen konden niet worden opgeslagen.",
              "The dossier conversion settings could not be saved."
            )
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <Notice tone="error">{loadError}</Notice>;
  }
  if (!settings) {
    return <p className="text-sm text-k-text-secondary">{t("Instellingen laden…", "Loading settings…")}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <p className="text-sm text-k-text-secondary">
        {t(
          "Kopieert dossierbestanden (contracten, ID's, loonstroken, …) die in de bronomgeving bestaan maar nog niet in de doelomgeving — nooit andersom, en nooit een bestaand bestand overschrijvend. Een proefdraai laat altijd eerst zien wat er zou overgaan.",
          "Copies dossier files (contracts, ID's, payslips, …) that exist in the source environment but not yet in the target — never the other way round, and never overwriting an existing file. A trial run always shows first what would be copied."
        )}
      </p>

      <EndpointSection
        side="source"
        omgeving={sourceOmgeving}
        onOmgeving={(v) => {
          setSourceOmgeving(v);
          edited("source");
        }}
        stage={sourceStage}
        onStage={(v) => {
          setSourceStage(v);
          edited("source");
        }}
        clientId={sourceClientId}
        onClientId={(v) => {
          setSourceClientId(v);
          edited("source");
        }}
        secret={sourceSecret}
        secretStored={settings.source.clientSecretSet}
        onSecret={(v) => {
          setSourceSecret(v);
          edited("source");
        }}
        connection={connections.source}
        onTest={() => runTest("source")}
      />

      <EndpointSection
        side="target"
        omgeving={targetOmgeving}
        onOmgeving={(v) => {
          setTargetOmgeving(v);
          edited("target");
        }}
        stage={targetStage}
        onStage={(v) => {
          setTargetStage(v);
          edited("target");
        }}
        clientId={targetClientId}
        onClientId={(v) => {
          setTargetClientId(v);
          edited("target");
        }}
        secret={targetSecret}
        secretStored={settings.target.clientSecretSet}
        onSecret={(v) => {
          setTargetSecret(v);
          edited("target");
        }}
        connection={connections.target}
        onTest={() => runTest("target")}
        gebruiker={targetGebruiker}
        onGebruiker={(v) => {
          setTargetGebruiker(v);
          clearSaveError();
        }}
      />

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-k-text-tertiary">
          {t("Koppeling medewerkers", "Employee mapping")}
        </h2>
        <p className="mt-1 text-sm text-k-text-secondary">
          {t(
            "Bron-medewerker-ID's die in de doelomgeving een ander ID hebben.",
            "Source employee IDs that have a different ID in the target environment."
          )}
        </p>
        <div className="mt-3">
          <EmployeeMappingTable rows={employeeRows} onChange={setEmployeeRows} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-k-text-tertiary">
          {t("Koppeling dossiertypen", "Dossier type mapping")}
        </h2>
        <p className="mt-1 text-sm text-k-text-secondary">
          {t(
            <>
              Bron-dossieritemtype (en kenmerk) die in de doelomgeving een andere classificatie
              hebben. <span className="font-mono text-xs">7.xx</span> koppelt elk kenmerk onder
              bron-type 7; bij meerdere passende regels wint de langste.
            </>,
            <>
              Source dossier item type (and attribute) that has a different classification in the
              target environment. <span className="font-mono text-xs">7.xx</span> maps every
              attribute under source type 7; where several rules match, the longest one wins.
            </>
          )}
        </p>
        <div className="mt-3">
          <FileMappingTable rows={fileRows} onChange={setFileRows} />
        </div>
      </section>

      {saveError && <Notice tone="error">{saveError}</Notice>}

      <div className="flex justify-end border-t border-k-divider pt-5">
        <ModalButton tone="primary" type="submit" disabled={saving}>
          {saving ? t("Opslaan…", "Saving…") : t("Opslaan", "Save")}
        </ModalButton>
      </div>
    </form>
  );
}

function EndpointSection({
  side,
  omgeving,
  onOmgeving,
  stage,
  onStage,
  clientId,
  onClientId,
  secret,
  secretStored,
  onSecret,
  connection,
  onTest,
  gebruiker,
  onGebruiker,
}: {
  side: DossierMigrationSide;
  omgeving: string;
  onOmgeving: (v: string) => void;
  stage: DossierMigrationStage;
  onStage: (v: DossierMigrationStage) => void;
  clientId: string;
  onClientId: (v: string) => void;
  secret: SecretDraft;
  secretStored: boolean;
  onSecret: (v: SecretDraft) => void;
  connection: ConnectionState;
  onTest: () => void;
  gebruiker?: string;
  onGebruiker?: (v: string) => void;
}) {
  const t = useT();
  const sideLabel = side === "source" ? t("Bronomgeving", "Source environment") : t("Doelomgeving", "Target environment");
  const idPrefix = `dm-${side}`;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${SIDE_BADGE_TONE[side]}`}
        >
          {sideLabel}
        </h2>
        <div className="flex items-center gap-2">
          <ConnectionMark connection={connection} />
          <button
            type="button"
            onClick={onTest}
            disabled={connection.testing}
            className="neu-button flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
          >
            <PlugZap className="h-3.5 w-3.5" strokeWidth={1.8} />
            {connection.testing ? t("Testen…", "Testing…") : t("Verbinding testen", "Test connection")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-omgeving`}
          label={t("Omgevingsnummer", "Environment number")}
          hint={t("Het nummer in 12345.resttest.afas.online — alleen cijfers.", "The number in 12345.resttest.afas.online — digits only.")}
        >
          <input
            id={`${idPrefix}-omgeving`}
            type="text"
            inputMode="numeric"
            value={omgeving}
            onChange={(e) => onOmgeving(e.target.value)}
            placeholder="12345"
            className={`${inputClass} mt-1.5 w-full`}
          />
        </Field>
        <Field id={`${idPrefix}-stage`} label={t("Omgevingssoort", "Environment type")}>
          <div className="mt-1.5">
            <StageToggle value={stage} onChange={onStage} idPrefix={idPrefix} />
          </div>
        </Field>
      </div>

      <Field id={`${idPrefix}-client-id`} label="Client id">
        <input
          id={`${idPrefix}-client-id`}
          type="text"
          autoComplete="off"
          value={clientId}
          onChange={(e) => onClientId(e.target.value)}
          className={`${inputClass} mt-1.5 w-full`}
        />
      </Field>

      <SecretField
        id={`${idPrefix}-secret`}
        stored={secretStored}
        draft={secret}
        onChange={onSecret}
      />

      {onGebruiker && (
        <Field
          id={`${idPrefix}-gebruiker`}
          label={t("Gebruiker (AFAS UsId)", "User (AFAS UsId)")}
          hint={t("De AFAS-gebruiker waaronder een upload wordt weggeschreven.", "The AFAS user under which an upload is written.")}
        >
          <input
            id={`${idPrefix}-gebruiker`}
            type="text"
            value={gebruiker ?? ""}
            onChange={(e) => onGebruiker(e.target.value)}
            placeholder="1"
            className={`${inputClass} mt-1.5 w-40`}
          />
        </Field>
      )}

      {connection.result && (
        <Notice tone={connection.result.ok ? "success" : "error"}>{connection.result.message}</Notice>
      )}
    </section>
  );
}

function StageToggle({
  value,
  onChange,
  idPrefix,
}: {
  value: DossierMigrationStage;
  onChange: (v: DossierMigrationStage) => void;
  idPrefix: string;
}) {
  const options: { id: DossierMigrationStage; label: string }[] = [
    { id: "test", label: "Test" },
    { id: "live", label: "Live" },
  ];
  return (
    <div
      id={`${idPrefix}-stage`}
      className="flex h-9 w-full max-w-40 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm"
    >
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-full text-sm font-medium transition-[box-shadow,color] duration-200 ${
              active ? "bg-k-bg text-k-cloud-deep shadow-raised-xs" : "text-k-text-tertiary hover:text-k-text-primary"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
