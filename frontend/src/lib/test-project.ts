/**
 * Whether a project is a **test project** — one that exists to try the tool out
 * rather than to convert a client.
 *
 * Ours, like the intake ([`intake.ts`](./intake.ts)): AFAS has no field for it, so it
 * is the `test_project` column of our own `project_settings` table, saved on its own
 * route. Admins tick it on the *Conversie* tab of the project settings; everywhere
 * else reads it off the session instead (`Project.testProject`), which is what the
 * project picker's *TEST* switch and the managementrapport filter on — see
 * `isTestProject()` in [`project-filters.ts`](./project-filters.ts).
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

function testProjectPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/test-project`;
}

/** One project's flag (admins only). Throws an `ApiError`. */
export async function fetchTestProject(projectId: string): Promise<boolean> {
  const data = await requestJson<{ testProject: boolean }>(
    testProjectPath(projectId),
    undefined,
    tr("Kon niet worden geladen of dit een testproject is.", "Could not load whether this is a test project."),
  );
  return data.testProject;
}

/** Save it, and answer with what was stored. */
export async function saveTestProject(projectId: string, testProject: boolean): Promise<boolean> {
  const data = await requestJson<{ testProject: boolean }>(
    testProjectPath(projectId),
    jsonBody("PUT", { testProject }),
    tr("Kon niet worden opgeslagen of dit een testproject is.", "Could not save whether this is a test project."),
  );
  return data.testProject;
}
