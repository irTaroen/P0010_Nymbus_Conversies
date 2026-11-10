/**
 * The local session — the user and every project in `projects.json`, as
 * `/api/auth/me` answers — kept in `sessionStorage` so a refresh shows the app
 * straight away while the fresh copy is fetched. Exposed as an external store
 * (subscribe/getSnapshot) so React can read it with `useSyncExternalStore` — see
 * `AuthProvider`. There is no login: the backend runs as one local user.
 */

import type { Session } from "@/lib/auth";

const STORAGE_KEY = "tsi.session";

/** `undefined` = storage not read yet; `null` = read, nobody signed in. */
let cached: Session | null | undefined = undefined;
const listeners = new Set<() => void>();

function readStorage(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    // Guard against an older or malformed shape lingering in storage.
    if (!parsed?.user?.email || !Array.isArray(parsed.projects)) return null;
    // The projects carry per-project facts the picker reads (`hasDossier`, the
    // AFAS status, whether the project has an AFAS-koppeling and which of its two
    // environments are set up). A session stored before those existed would render
    // every project as "geen dossieritem" — and, without `afasConnection`, would
    // flag every project as unconnected, sending admins to a settings dialog that is
    // already filled in. So it counts as an older shape too: dropping it costs one
    // login and is the only way to get the facts, since nothing re-fetches a session
    // that is already there.
    //
    // `afasStages` is checked as an **object**, not just "present": the picker's
    // Connection column indexes into it per stage, so a session from before it
    // existed would throw rather than merely look wrong — the one field here whose
    // absence is a crash instead of a wrong answer.
    const complete = (project: Session["projects"][number]) =>
      typeof project?.hasDossier === "boolean" &&
      typeof project?.afasConnection === "string" &&
      typeof project?.afasStages === "object" &&
      project.afasStages !== null;
    if (!parsed.projects.every(complete)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function subscribeToSession(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Client snapshot — reads storage once, then serves the cached value. */
export function getSession(): Session | null {
  if (cached === undefined) cached = readStorage();
  return cached;
}

/** Server snapshot — there is no storage on the server. */
export function getServerSession(): Session | null {
  return null;
}

/** Store a session (or clear it with `null`) and notify subscribers. */
export function setSession(session: Session | null): void {
  cached = session;
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session then lives in memory only.
  }
  for (const listener of listeners) listener();
}

/**
 * How many deep reloads (`reloadMe()` → `/api/auth/me?reload=1`) are in flight.
 *
 * A counter and not a boolean, because two can overlap: entering a project fires one,
 * and an admin pressing *ververs* in the picker fires another, with no guarantee the
 * first has landed. A boolean cleared by whichever finished first would reopen the
 * window while the other was still out.
 *
 * It exists so a **shallower** refresh can decline to overwrite a deeper one's answer.
 * `fetchMe()` replays the stored session with only the AFAS-connection fields
 * re-derived; `reloadMe()` rebuilds it from AFAS, project settings included. Both are
 * fired on the same page load (`AuthProvider`'s post-hydration check, and
 * `app/[project]/layout.tsx`), they race, and the shallow one winning that race means
 * a project's `hrmPeriodetabel`/`livegangDatum` snap back to what they were at login —
 * which is exactly the stale-band bug the project reload was added to fix.
 *
 * Only the shallow caller consults this. A reload never defers to another reload:
 * both went to AFAS, so either answer is current.
 */
let reloadsInFlight = 0;

/** Whether a deep session reload is currently out — see {@link reloadsInFlight}. */
export function isReloadingSession(): boolean {
  return reloadsInFlight > 0;
}

/**
 * Run a deep reload with {@link isReloadingSession} held true for its duration, so a
 * `fetchMe()` racing it knows to drop its own answer. Returns what `run` returned, and
 * releases the flag on failure too — a reload that threw must not wedge the flag on
 * and leave every later `fetchMe()` silently discarded.
 */
export async function withSessionReload<T>(run: () => Promise<T>): Promise<T> {
  reloadsInFlight += 1;
  try {
    return await run();
  } finally {
    reloadsInFlight -= 1;
  }
}

/** The bearer token for `Authorization: Bearer <token>` — the actual credential;
 *  the cached `Session` above is only ever a display copy of what it names. */
