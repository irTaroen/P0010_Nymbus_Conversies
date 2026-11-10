"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDraft,
  draftKey,
  pruneDrafts,
  readDraft,
  requestPersistentStorage,
  saveDraftGrid,
  saveDraftSource,
  type SheetDraft,
} from "@/lib/draft-store";
import type { ParsedWorkbook } from "@/lib/excel";

/**
 * Autosave for the open sheet: the React side of
 * [`lib/draft-store.ts`](../../lib/draft-store.ts).
 *
 * It watches the grid the uploader holds and writes a copy to the browser's own
 * storage while it is being edited, and on mount it reads back whatever the last
 * session left behind so the page can offer it. Nothing is decided here — the hook
 * hands over a `pending` draft and the page ([`ExcelUploader`](../ExcelUploader.tsx))
 * puts it on screen and, if the user takes it, applies it. That split is deliberate:
 * restoring means seeding half a dozen pieces of the uploader's state, and only the
 * uploader can do that.
 *
 * **Only edited sheets are stored.** A workbook nobody has changed is already safe —
 * it is the file the client has on disk — so the copy would cost a few megabytes to
 * protect nothing. `dirtyKeys` being non-empty is what makes a sheet worth keeping.
 *
 * **Written on a debounce with a ceiling.** A plain debounce never fires while
 * someone types steadily, which is exactly when there is most to lose, so a write is
 * also forced once {@link MAX_WAIT_MS} has passed since the last one. The tab going
 * to the background flushes too — that is the last moment a browser reliably gives us
 * before it discards the page.
 */

/** Quiet for this long after the last change → write. */
const DEBOUNCE_MS = 1_500;
/** …but never go longer than this between writes while the grid keeps changing. */
const MAX_WAIT_MS = 15_000;

export interface SheetDraftHandle {
  /**
   * Work found in storage when the page opened, waiting to be offered — null when
   * there is none, and again once the offer has been answered.
   */
  pending: SheetDraft | null;
  /**
   * The offer was taken. Stops offering it; the stored record stays, because it now
   * describes the sheet on screen and goes on being updated as it is edited.
   */
  accept: () => void;
  /**
   * Throw the stored draft away — the user refused the offer, a new file replaced it,
   * or the sheet has been handed to Nymbus and the work is done.
   */
  clear: () => void;
}

export function useSheetDraft({
  moduleId,
  projectId,
  email,
  workbook,
  cellData,
  dirtyKeys,
  sheetIndex,
  sourceFile,
}: {
  moduleId: string;
  /** The open project; null while there isn't one, which switches autosave off. */
  projectId: string | null;
  /** Who is signed in — part of the key, see `draftKey()`. */
  email: string | null;
  workbook: ParsedWorkbook | null;
  cellData: string[][] | null;
  dirtyKeys: Set<string>;
  sheetIndex: number;
  sourceFile: File | null;
}): SheetDraftHandle {
  const key = useMemo(
    () => (email && projectId ? draftKey({ email, projectId, moduleId }) : null),
    [email, projectId, moduleId]
  );

  const [pending, setPending] = useState<SheetDraft | null>(null);

  /**
   * The current grid, for the writer to read when its timer fires. Held in a ref
   * rather than closed over: the writer would otherwise be a new function on every
   * keystroke, and every effect depending on it would tear down and set up again —
   * including the timer this exists to let run out.
   */
  const live = useRef({
    workbook,
    cellData,
    dirtyKeys,
    sheetIndex,
    sourceFile,
  });
  useEffect(() => {
    live.current = { workbook, cellData, dirtyKeys, sheetIndex, sourceFile };
  });

  /**
   * The workbook whose heavy half is already in storage, by identity. `commit()`
   * builds a fresh object per file, so this both remembers that the source has been
   * written and notices the moment a different file needs its own.
   */
  const storedSource = useRef<ParsedWorkbook | null>(null);
  const lastWrite = useRef(0);
  /** The scheduled write, held so {@link clear} can call one off. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Bumped by every {@link clear}. A write that was already scheduled or halfway
   * through when the draft was thrown away belongs to the draft that is gone, and
   * would otherwise put back what a hand-off had just finished with.
   */
  const generation = useRef(0);
  /**
   * The grid on screen when {@link clear} ran, by identity. Clearing empties the
   * store but leaves the sheet — and its `dirtyKeys` — on screen, so without this
   * the next tab switch or unmount would flush the handed-in sheet straight back
   * and offer it again on the next visit. Every edit builds a new `cellData`, so
   * the first change after a clear starts a fresh draft as before.
   */
  const clearedCells = useRef<string[][] | null>(null);

  const flush = useCallback(async () => {
    if (!key) return;
    const gen = generation.current;
    const current = live.current;
    if (!current.workbook || !current.cellData) return;
    if (current.cellData === clearedCells.current) return;
    // Nothing is written for a sheet nobody has changed — that file is already on the
    // client's own disk, so a copy of it protects nothing. Once a draft *does* exist
    // it keeps mirroring the grid, edits undone back to none included: the stored
    // copy has to be able to say "no changes any more" as well as it said there were.
    if (current.dirtyKeys.size === 0 && storedSource.current !== current.workbook) return;
    // Stamped before the writes, not after: it paces the next write, and two seconds
    // of IndexedDB shouldn't buy the grid two more seconds of not being saved.
    lastWrite.current = Date.now();
    if (storedSource.current !== current.workbook) {
      // There is work to protect now — this is the moment to ask.
      requestPersistentStorage();
      await saveDraftSource(key, {
        fileName: current.workbook.fileName,
        sheets: current.workbook.sheets,
        file: current.sourceFile,
      });
      // Thrown away while that was in flight — leave the half that landed to
      // `readDraft()`/`pruneDrafts()`, which treat a source without a grid as litter.
      if (gen !== generation.current) return;
      storedSource.current = current.workbook;
    }
    if (gen !== generation.current) return;
    await saveDraftGrid(key, {
      cells: current.cellData,
      dirtyKeys: current.dirtyKeys,
      sheetIndex: current.sheetIndex,
    });
  }, [key]);

  // Schedule a write for every change to the grid or the sheet shown. The wait
  // is the debounce, cut short when it would push the next write past MAX_WAIT_MS.
  useEffect(() => {
    if (!key || !workbook || !cellData) return;
    if (dirtyKeys.size === 0 && storedSource.current !== workbook) return;
    const wait = Math.max(
      0,
      Math.min(DEBOUNCE_MS, lastWrite.current + MAX_WAIT_MS - Date.now())
    );
    timer.current = setTimeout(() => void flush(), wait);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [key, workbook, cellData, dirtyKeys, sheetIndex, flush]);

  /**
   * Write out whatever the timer hasn't yet when the page stops being watched.
   *
   * `visibilitychange` → hidden is the one signal browsers still give reliably on the
   * way to a closed tab, a switched app or a sleeping machine; `pagehide` covers the
   * back/forward cache. Leaving the module unmounts this hook, and its last
   * keystrokes deserve the same treatment, hence the flush in the cleanup.
   */
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") void flush();
    }
    function onPageHide() {
      void flush();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  /**
   * Whether a sheet is already on screen, for the read below to consult at the
   * moment it answers rather than at the moment it was started.
   */
  const openSheet = useRef(workbook !== null);
  useEffect(() => {
    openSheet.current = workbook !== null;
  });

  // Look for stored work when the module page opens, and tidy up what has expired.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void pruneDrafts();
    void (async () => {
      const draft = await readDraft(key);
      // A file dropped while this was in flight wins: the sheet the user just chose
      // is the one they mean, and an offer over an open table would be a trap.
      if (alive && draft && !openSheet.current) setPending(draft);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const accept = useCallback(() => setPending(null), []);

  const clear = useCallback(() => {
    // Call off whatever was scheduled or is in flight — it describes what is being
    // thrown away, and would land after the delete.
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
    // The next edit writes a fresh draft from scratch, source half and all.
    storedSource.current = null;
    lastWrite.current = 0;
    clearedCells.current = live.current.cellData;
    if (key) void deleteDraft(key);
  }, [key]);

  return { pending, accept, clear };
}
