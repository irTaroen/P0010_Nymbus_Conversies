/**
 * "Do this project's stored AFAS credentials still work?" — asked once when a project
 * is entered, answered only when the answer is *no*.
 *
 * `project.afasStages` says a stage is **ingesteld**, not that AFAS accepts it — a
 * token revoked or regenerated at the customer after it was saved looks exactly like
 * a working one until the first upload fails. So on entry the project shell runs the
 * same test as *Verbinding testen* in the settings dialog (`metainfo`, no data
 * touched) for every stage that has credentials stored, and the project page shows a
 * band for the ones AFAS refused. A stage that works says nothing — silence is the
 * success state.
 *
 * An external store rather than state in a component, because the two ends live in
 * different places: the check runs in the project layout (so it fires on entry and
 * not again on every walk between modules), the band sits on the project page, which
 * unmounts whenever a module is opened.
 *
 * Only a **refusal** is reported. A call that broke on its way (`ApiError`: the
 * backend unreachable, a 403 after impersonation started) says nothing about the
 * credentials, and turning it into "your token doesn't work" would send an admin to
 * regenerate a token that is fine.
 */

import { ApiError } from "@/lib/api";
import {
  STORED_CREDENTIALS,
  testProjectConnection,
  type SettingsStage,
} from "@/lib/project-settings";

/** One stage AFAS refused, with AFAS's own reason. */
export type ConnectionFailure = { stage: SettingsStage; message: string };

const NONE: readonly ConnectionFailure[] = [];

/** The refused stages per project, from the last check that finished. */
const failures = new Map<string, readonly ConnectionFailure[]>();
/** The latest check per project, so a slower earlier one can't overwrite it. */
const latest = new Map<string, number>();
let sequence = 0;
const listeners = new Set<() => void>();

export function subscribeToConnectionChecks(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The stages AFAS refused for this project; an empty list (stable) when none. */
export function connectionFailures(projectId: string): readonly ConnectionFailure[] {
  return failures.get(projectId) ?? NONE;
}

/**
 * Test each stage's **stored** credentials and record which AFAS refused. Both
 * stages in parallel; fire-and-forget — it never throws, and never blocks a render.
 */
export async function checkProjectConnections(
  projectId: string,
  stages: readonly SettingsStage[],
): Promise<void> {
  const run = ++sequence;
  latest.set(projectId, run);
  const results = await Promise.all(
    stages.map(async (stage): Promise<ConnectionFailure | null> => {
      try {
        const result = await testProjectConnection(projectId, stage, STORED_CREDENTIALS);
        return result.ok ? null : { stage, message: result.message };
      } catch (error) {
        if (error instanceof ApiError) return null;
        throw error;
      }
    }),
  ).catch(() => null);
  if (results === null || latest.get(projectId) !== run) return;
  const refused = results.filter((r): r is ConnectionFailure => r !== null);
  failures.set(projectId, refused.length ? refused : NONE);
  for (const listener of listeners) listener();
}
