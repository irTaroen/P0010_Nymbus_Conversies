/**
 * The sheet on screen, kept in the browser so a crash can't take it with it.
 *
 * The uploader holds everything about an open workbook in React state, and React
 * state dies with the tab. Two guards already stand in front of the *deliberate*
 * ways out — [`NavigationGuard`](../components/NavigationGuard.tsx) in front of a
 * link, the browser's own `beforeunload` prompt in front of a reload or a close —
 * and neither of them is asked when the machine goes to sleep for the last time,
 * the browser is killed, or the tab is dropped to reclaim memory. That is the gap
 * this fills: an afternoon of corrections survives it, because a copy is already
 * written before it happens.
 *
 * **IndexedDB, not `localStorage`.** The export re-opens the *original* upload and
 * patches only the edited cells into it (`patchOriginal()` in [excel.ts](./excel.ts)),
 * which is what keeps the client's own formatting in the file they get back — so a
 * draft that can't hold the `File` restores a sheet that exports worse than it went
 * in. A `File` is a Blob: structured clone stores one, JSON cannot, and a workbook
 * runs past `localStorage`'s ~5 MB long before it runs past this.
 *
 * **Two stores, one draft.** A `put` replaces a record whole, so everything in one
 * record is copied on every write. The grid changes constantly and the file it came
 * from never does, so they are stored apart: `sources` is written once per opened
 * workbook (the parse plus the original bytes) and `drafts` every few seconds while
 * typing (the strings, the dirty keys, the two settings). A draft needs both halves;
 * one without the other is a leftover and is thrown away on read.
 *
 * **Keyed by user, project and module.** IndexedDB is per *origin* and shared by
 * every tab and window on it — unlike the per-tab session in
 * [session-store.ts](./session-store.ts) — so on a laptop two colleagues share, the
 * key is what stops one being offered the other's work.
 *
 * **Nothing here is load-bearing.** Private windows, a full disk, a browser that
 * refuses the database: every call resolves to "no draft" instead of throwing, and
 * the tool works exactly as it did before this file existed.
 */

import type { ParsedSheet } from "@/lib/excel";

const DB_NAME = "tsi-conversie";
const DB_VERSION = 1;
/** The grid as it stands: small, rewritten while the user types. */
const GRID_STORE = "drafts";
/** Where that grid came from: large, written once per opened workbook. */
const SOURCE_STORE = "sources";

/**
 * The shape of a stored draft. **Bump this whenever a field below changes
 * meaning**, the way [session-store.ts](./session-store.ts) drops a session of an
 * older shape: a draft is restored straight into the uploader's state, so a record
 * written by a previous shape has to be thrown away rather than half-understood.
 */
const DRAFT_VERSION = 1;

/**
 * How long a draft is worth offering. Long enough to cover a weekend and a holiday
 * Monday; short enough that a workbook nobody came back for doesn't sit in the
 * browser's storage forever.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The grid half of a draft — everything an edit changes. */
interface GridRecord {
  key: string;
  version: number;
  /** Epoch ms; `savedAt` on the way out, and what {@link pruneDrafts} judges. */
  savedAt: number;
  cells: string[][];
  /** `dirtyKeys` as an array — the same "row:col" keys, in a shape a record shows. */
  dirty: string[];
  sheetIndex: number;
}

/** The file half — everything an edit leaves alone. */
interface SourceRecord {
  key: string;
  version: number;
  fileName: string;
  sheets: ParsedSheet[];
  /** The upload itself, so a restored sheet still exports through the original. */
  file: File | null;
}

/** A draft as its two halves read together — what the uploader is handed back. */
export interface SheetDraft {
  savedAt: Date;
  fileName: string;
  sheets: ParsedSheet[];
  sheetIndex: number;
  cells: string[][];
  dirtyKeys: Set<string>;
  file: File | null;
}

/**
 * Which draft this is: the person, the project and the module, in that order.
 *
 * The module page keys the uploader on the module, so one open sheet is exactly one
 * of these — and every part is needed. Without the project, two projects' sheets for
 * the same module would overwrite each other; without the e-mail, a shared laptop
 * would offer one user the other's corrections.
 */
export function draftKey({
  email,
  projectId,
  moduleId,
}: {
  email: string;
  projectId: string;
  moduleId: string;
}): string {
  return `${email.trim().toLowerCase()}|${projectId}|${moduleId}`;
}

/**
 * The database, opened once and reused — including its failure: a browser that
 * refuses it (private mode, blocked storage) resolves `null` and keeps resolving
 * `null`, so a refused open isn't retried on every keystroke.
 */
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    // Server render, or a browser without it — there is no storage to open.
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GRID_STORE)) {
        db.createObjectStore(GRID_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(SOURCE_STORE)) {
        db.createObjectStore(SOURCE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holds an older version open — nothing to do but go without.
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** One IndexedDB request as a promise. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Ask the browser not to evict this origin's storage when the disk fills up.
 *
 * Called at the moment the **first** draft is written rather than on page load, and
 * only once: Firefox answers this with a permission doorhanger, and a prompt about
 * storing data is fair when there is work to store and noise when someone is only
 * looking at a page. Chrome decides silently. Either way the answer changes nothing
 * here — an evicted draft reads back as no draft.
 */
let persistenceAsked = false;
export function requestPersistentStorage(): void {
  if (persistenceAsked) return;
  persistenceAsked = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Not supported, or refused — drafts are simply evictable.
  }
}

/**
 * Store the half of `key`'s draft that a file supplies: the parse and the upload
 * itself. Written once when the first edit is made to a workbook, not on every
 * save — see the note on the two stores at the top.
 */
export async function saveDraftSource(
  key: string,
  source: { fileName: string; sheets: ParsedSheet[]; file: File | null }
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(SOURCE_STORE, "readwrite");
    const record: SourceRecord = { key, version: DRAFT_VERSION, ...source };
    await done(tx.objectStore(SOURCE_STORE).put(record));
  } catch {
    // Out of quota, or the store went away — the draft is simply not written.
  }
}

/**
 * Store the half a keystroke changes. Stamps `savedAt`, which is the moment the
 * restore offer names and the age {@link pruneDrafts} measures.
 */
export async function saveDraftGrid(
  key: string,
  grid: {
    cells: string[][];
    dirtyKeys: Set<string>;
    sheetIndex: number;
  }
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(GRID_STORE, "readwrite");
    const record: GridRecord = {
      key,
      version: DRAFT_VERSION,
      savedAt: Date.now(),
      cells: grid.cells,
      dirty: [...grid.dirtyKeys],
      sheetIndex: grid.sheetIndex,
    };
    await done(tx.objectStore(GRID_STORE).put(record));
  } catch {
    // Same as above: a draft that couldn't be written is a draft that isn't there.
  }
}

/**
 * The draft stored for `key`, or null when there is nothing worth offering.
 *
 * Four things count as nothing: no record, only one of the two halves, a record of
 * an older {@link DRAFT_VERSION}, and one older than {@link MAX_AGE_MS}. All four are
 * cleared out on the way past, so a refusal to restore is also a tidy-up — the same
 * reflex `readStorage()` in [session-store.ts](./session-store.ts) has about a
 * session of an older shape.
 */
export async function readDraft(key: string): Promise<SheetDraft | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([GRID_STORE, SOURCE_STORE], "readonly");
    const [grid, source] = await Promise.all([
      done<GridRecord | undefined>(tx.objectStore(GRID_STORE).get(key)),
      done<SourceRecord | undefined>(tx.objectStore(SOURCE_STORE).get(key)),
    ]);
    if (!grid && !source) return null;
    const usable =
      grid !== undefined &&
      source !== undefined &&
      grid.version === DRAFT_VERSION &&
      source.version === DRAFT_VERSION &&
      Date.now() - grid.savedAt < MAX_AGE_MS &&
      Array.isArray(grid.cells) &&
      Array.isArray(source.sheets) &&
      source.sheets[grid.sheetIndex] !== undefined;
    if (!usable) {
      await deleteDraft(key);
      return null;
    }
    return {
      savedAt: new Date(grid.savedAt),
      fileName: source.fileName,
      sheets: source.sheets,
      sheetIndex: grid.sheetIndex,
      cells: grid.cells,
      dirtyKeys: new Set(grid.dirty ?? []),
      file: source.file ?? null,
    };
  } catch {
    return null;
  }
}

/** Forget `key`'s draft — both halves, so neither is left behind as a leftover. */
export async function deleteDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([GRID_STORE, SOURCE_STORE], "readwrite");
    await Promise.all([
      done(tx.objectStore(GRID_STORE).delete(key)),
      done(tx.objectStore(SOURCE_STORE).delete(key)),
    ]);
  } catch {
    // Nothing to do about it, and nothing depends on it having happened.
  }
}

/**
 * Drop every draft past {@link MAX_AGE_MS}, and every source half whose grid half is
 * gone. Run once when the uploader mounts: expiry is checked on read as well, but a
 * draft nobody ever reads again would otherwise hold its workbook forever — and this
 * is also what clears out the halves left behind by an interrupted write.
 */
export async function pruneDrafts(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([GRID_STORE, SOURCE_STORE], "readwrite");
    const grids = tx.objectStore(GRID_STORE);
    const sources = tx.objectStore(SOURCE_STORE);
    // Both reads are asked for before either is awaited: a transaction stays alive
    // across the resolution of its own requests, but not across anything else, so
    // issuing the second one after the first has resolved is asking for a closed
    // transaction on some browsers.
    const [stored, sourceKeys] = await Promise.all([
      done<GridRecord[]>(grids.getAll()),
      done<IDBValidKey[]>(sources.getAllKeys()),
    ]);
    const fresh = new Set<string>();
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const grid of stored) {
      if (grid.version === DRAFT_VERSION && grid.savedAt >= cutoff) fresh.add(grid.key);
      else grids.delete(grid.key);
    }
    for (const key of sourceKeys) {
      if (!fresh.has(String(key))) sources.delete(key);
    }
  } catch {
    // Housekeeping — a failure costs some storage, nothing else.
  }
}
