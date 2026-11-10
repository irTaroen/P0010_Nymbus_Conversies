/**
 * Per-project configuration: the AFAS environment the project's data goes to, and
 * the OAuth client credentials of its test and live environment.
 *
 * Admin-only on both sides. The backend keeps this in
 * `backend/json_files/project_settings.json` for now — an Azure Data Lake later, see
 * [docs/todo.md](../../../docs/todo.md) — with the client ids and secrets encrypted in
 * the file (`backend/encryption.py`).
 *
 * **Secrets only travel one way.** A fetch says whether a secret is stored
 * (`testClientSecretSet`), never what it is, so a secret never reaches the browser
 * after it has been saved. A save leaves a secret `null` to keep the stored one.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { forgetStoredMappings } from "@/lib/field-mapping";
import { tr } from "@/lib/i18n";

export type ProjectSettings = {
  projectId: string;
  projectName: string;
  /** AFAS environment number — the `12345` in 12345.resttest.afas.online. */
  omgeving: number | null;
  testClientId: string;
  liveClientId: string;
  /** Whether a secret is stored. The value itself stays in the backend. */
  testClientSecretSet: boolean;
  liveClientSecretSet: boolean;
  /**
   * The modules this project maps **differently**, as app module ids
   * (`hrm-medewerkers`) — the only setting here that is not a credential.
   *
   * Every project otherwise uses the same field mapping per connector, made against
   * the schema of the template environment each customer environment is a copy of.
   * A module listed here is the exception: its schema is to be read from
   * *this* customer's AFAS and its mapping kept as a copy of its own. Stored and shown
   * today; what reads it is still to come (docs/todo.md).
   */
  customMappingModules: string[];
};

/** What a save sends. `null` for a secret keeps the stored one, `""` clears it. */
export type ProjectSettingsInput = {
  omgeving: string;
  testClientId: string;
  liveClientId: string;
  testClientSecret: string | null;
  liveClientSecret: string | null;
  /** The whole list, as the dialog has it — what is sent replaces what is stored. */
  customMappingModules: string[];
};

function settingsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/settings`;
}

/** One project's settings, without its secrets. Throws an `ApiError` to show. */
export async function fetchProjectSettings(projectId: string): Promise<ProjectSettings> {
  const data = await requestJson<{ settings: ProjectSettings }>(
    settingsPath(projectId),
    undefined,
    tr("De projectinstellingen konden niet worden geladen.", "The project settings could not be loaded.")
  );
  return data.settings;
}

/** Save one project's settings; answers with them as a fetch would. */
export async function saveProjectSettings(
  projectId: string,
  input: ProjectSettingsInput
): Promise<ProjectSettings> {
  const data = await requestJson<{ settings: ProjectSettings }>(
    settingsPath(projectId),
    jsonBody("PUT", input),
    tr("De projectinstellingen konden niet worden opgeslagen.", "The project settings could not be saved.")
  );
  // A newly flagged module gets its client mapping seeded from the standard one by
  // this save, so the cached mapping list no longer matches the store.
  forgetStoredMappings();
  return data.settings;
}

/** The two environments a project is configured for, each testable on its own. */
export type SettingsStage = "test" | "live";

/**
 * The credentials one connection test is run with, as the form has them now. Each
 * `null` tests with what is stored instead — always so for the secret, which the
 * browser never has, and for all three in {@link STORED_CREDENTIALS}.
 */
export type ConnectionTestInput = {
  omgeving: string | null;
  clientId: string | null;
  clientSecret: string | null;
};

/** Test exactly what is saved for a stage — the check a project runs on entry. */
export const STORED_CREDENTIALS: ConnectionTestInput = {
  omgeving: null,
  clientId: null,
  clientSecret: null,
};

/** Whether AFAS answered, and what it said. A refusal is a result, not an error. */
export type ConnectionTest = { ok: boolean; message: string };

/**
 * Ask AFAS itself whether one environment of this project can be reached with these
 * credentials — the backend calls `metainfo`, which needs no connector and touches no
 * data. Tests what the form shows, so a credential can be checked before it is saved.
 *
 * Only a broken *call* throws (an `ApiError`); credentials AFAS rejects come back as
 * `ok: false` with AFAS's own reason.
 */
export async function testProjectConnection(
  projectId: string,
  stage: SettingsStage,
  input: ConnectionTestInput
): Promise<ConnectionTest> {
  const data = await requestJson<{ connection: ConnectionTest }>(
    `${settingsPath(projectId)}/test-connection`,
    jsonBody("POST", { stage, ...input }),
    tr("De verbinding met AFAS kon niet worden getest.", "The connection to AFAS could not be tested.")
  );
  return data.connection;
}
