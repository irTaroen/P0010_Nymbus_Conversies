/**
 * Dossier migration: a project whose "conversion" is copying an employee's
 * dossier files from one AFAS environment (source) to another (target),
 * rather than the usual Excel-in/AFAS-out flow. Admin-only, like
 * `project-settings.ts` — the source/target credentials are write-only over
 * the API (a fetch says whether a secret is stored, never what it is), and a
 * run happens as a background job on the backend: `startDossierMigrationRun`
 * returns immediately, `fetchDossierMigrationRun` polls its progress.
 *
 * See `backend/dossier_migration.py` for the full design (why OAuth, why no
 * `Unique_hash`, why a background job) — this file only mirrors its API
 * shapes.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

export type DossierMigrationStage = "test" | "live";
export type DossierMigrationSide = "source" | "target";

export type DossierMigrationConnectors = {
  medewerkers: string;
  dossieritems: string;
  bijlagen: string;
};

export type DossierMigrationEndpoint = {
  omgeving: string;
  stage: DossierMigrationStage;
  clientId: string;
  /** Whether a secret is stored. The value itself stays in the backend. */
  clientSecretSet: boolean;
  connectors: DossierMigrationConnectors;
};

export type DossierMigrationTarget = DossierMigrationEndpoint & {
  /** The AFAS user id (`UsId`) an upload is attributed to. `null` until set. */
  gebruiker: string | null;
};

export type DossierMigrationFileMapping = { type: string; kenmerk: string };

export type DossierMigrationMapping = {
  /** Source employee id -> target employee id. */
  employees: Record<string, string>;
  /**
   * Source `"<Type_dossieritem>"` or `"<Type_dossieritem>.<Kenmerk>"` -> the
   * target's own type + kenmerk. A key ending in `.xx` is a wildcard: it
   * matches any kenmerk under that source type, and the longest matching
   * prefix wins when more than one could apply.
   */
  files: Record<string, DossierMigrationFileMapping>;
};

export type DossierMigrationSettings = {
  projectId: string;
  projectName: string;
  source: DossierMigrationEndpoint;
  target: DossierMigrationTarget;
  mapping: DossierMigrationMapping;
};

/** What one side's save sends. `null` for a secret keeps the stored one, `""`
 *  clears it; `connectors` left out keeps the stored overrides. */
export type DossierMigrationEndpointInput = {
  omgeving: string;
  stage: DossierMigrationStage;
  clientId: string;
  clientSecret: string | null;
  connectors?: DossierMigrationConnectors | Record<string, never> | null;
  gebruiker?: string | null;
};

export type DossierMigrationSettingsInput = {
  /** Left out (null) keeps what is stored, so a save can touch just one of
   *  source/target/mapping without resending the rest. */
  source?: DossierMigrationEndpointInput | null;
  target?: DossierMigrationEndpointInput | null;
  mapping?: DossierMigrationMapping | null;
};

export type DossierMigrationConnectionTestInput = {
  side: DossierMigrationSide;
  omgeving: string;
  stage: DossierMigrationStage;
  clientId: string;
  /** `null` tests with the stored secret — the browser never has it. */
  clientSecret: string | null;
};

/** Whether AFAS answered, and what it said. A refusal is a result, not an error. */
export type DossierMigrationConnectionTest = { ok: boolean; message: string };

export type DossierMigrationFailure = {
  medewerker: string | null;
  bestand: string | null;
  bijlageId: string | null;
  error: string;
};

export type DossierMigrationRunStats = {
  totalSource: number;
  alreadyPresent: number;
  toTransfer: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: DossierMigrationFailure[];
};

export type DossierMigrationRunStatus = "running" | "done" | "failed";

export type DossierMigrationRun = {
  runId: string;
  status: DossierMigrationRunStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  stats: DossierMigrationRunStats;
};

function settingsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/dossier-migration/settings`;
}

function runsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/dossier-migration/runs`;
}

/** One project's dossier-migration settings, without its secrets. */
export async function fetchDossierMigrationSettings(
  projectId: string
): Promise<DossierMigrationSettings> {
  const data = await requestJson<{ settings: DossierMigrationSettings }>(
    settingsPath(projectId),
    undefined,
    tr("De dossierconversie-instellingen konden niet worden geladen.", "The dossier conversion settings could not be loaded.")
  );
  return data.settings;
}

/** Save one project's dossier-migration settings; answers with them as a fetch would. */
export async function saveDossierMigrationSettings(
  projectId: string,
  input: DossierMigrationSettingsInput
): Promise<DossierMigrationSettings> {
  const data = await requestJson<{ settings: DossierMigrationSettings }>(
    settingsPath(projectId),
    jsonBody("PUT", input),
    tr("De dossierconversie-instellingen konden niet worden opgeslagen.", "The dossier conversion settings could not be saved.")
  );
  return data.settings;
}

/**
 * Ask AFAS itself whether one side (source or target) can be reached with
 * these credentials — same reasoning as `testProjectConnection`: only a
 * broken *call* throws, a refusal from AFAS comes back as `ok: false`.
 */
export async function testDossierMigrationConnection(
  projectId: string,
  input: DossierMigrationConnectionTestInput
): Promise<DossierMigrationConnectionTest> {
  const data = await requestJson<{ connection: DossierMigrationConnectionTest }>(
    `${settingsPath(projectId)}/test-connection`,
    jsonBody("POST", input),
    tr("De verbinding met AFAS kon niet worden getest.", "The connection to AFAS could not be tested.")
  );
  return data.connection;
}

/**
 * Start a dry run (the default) or a live run in the background and return
 * its id right away — poll it with `fetchDossierMigrationRun`. Throws an
 * `ApiError` (409) when this project already has one running.
 */
export async function startDossierMigrationRun(
  projectId: string,
  dryRun: boolean
): Promise<DossierMigrationRun> {
  const data = await requestJson<{ run: DossierMigrationRun }>(
    runsPath(projectId),
    jsonBody("POST", { dryRun }),
    tr("De dossierconversie kon niet worden gestart.", "The dossier conversion could not be started.")
  );
  return data.run;
}

/** One run's current progress — call this on an interval while `status === "running"`. */
export async function fetchDossierMigrationRun(
  projectId: string,
  runId: string
): Promise<DossierMigrationRun> {
  const data = await requestJson<{ run: DossierMigrationRun }>(
    `${runsPath(projectId)}/${encodeURIComponent(runId)}`,
    undefined,
    tr("De status van de dossierconversie kon niet worden opgehaald.", "The status of the dossier conversion could not be fetched.")
  );
  return data.run;
}

/** This project's most recent runs, newest first. */
export async function fetchDossierMigrationRuns(projectId: string): Promise<DossierMigrationRun[]> {
  const data = await requestJson<{ runs: DossierMigrationRun[] }>(
    runsPath(projectId),
    undefined,
    tr("De dossierconversie-runs konden niet worden geladen.", "The dossier conversion runs could not be loaded.")
  );
  return data.runs ?? [];
}
