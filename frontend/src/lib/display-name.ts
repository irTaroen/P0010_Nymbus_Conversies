/**
 * A project's **Projectnaam** — the name the tool shows instead of AFAS's own.
 *
 * Ours, like the Testproject flag ([`test-project.ts`](./test-project.ts)): the
 * `display_name` column of our own `project_settings` table, saved on its own route.
 * Admins set it on the *Conversie* tab of the project settings; everywhere else just
 * reads `Project.name`, which the backend already resolves to this name when one is
 * set — so the sidebar, the project picker and the managementrapport follow it
 * without knowing it exists. Empty clears it, and AFAS's name shows again.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

/** The override (`""` for none) and AFAS's own name, to show as the fallback. */
export type DisplayName = { displayName: string; afasName: string };

function displayNamePath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/display-name`;
}

/** One project's name (admins only). Throws an `ApiError`. */
export async function fetchDisplayName(projectId: string): Promise<DisplayName> {
  return requestJson<DisplayName>(
    displayNamePath(projectId),
    undefined,
    tr("De projectnaam kon niet worden geladen.", "The project name could not be loaded."),
  );
}

/** Save it — `""` clears it — and answer with what was stored. */
export async function saveDisplayName(
  projectId: string,
  displayName: string,
): Promise<DisplayName> {
  return requestJson<DisplayName>(
    displayNamePath(projectId),
    jsonBody("PUT", { displayName }),
    tr("De projectnaam kon niet worden opgeslagen.", "The project name could not be saved."),
  );
}
