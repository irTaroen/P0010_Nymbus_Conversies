/**
 * A file on its way to another module's page.
 *
 * Recognition happens where the file is dropped, but the module it turns out to
 * belong to has its own page now — so a file dropped on *Medewerkers* that is really
 * a debiteurenbestand has to survive the navigation to `/{project}/erp-debiteuren`.
 * It can't ride along in the URL (it's a `File` and a parsed workbook) and it doesn't
 * belong in React state (the page that parsed it unmounts on the way), so it waits
 * here: one slot, outside React, written by the page handing over and taken by the
 * page that mounts next.
 *
 * One slot is the whole story — a hand-off is one file the user just dropped, and it
 * is claimed by the very next page to mount. It is deliberately **not** persisted:
 * a `File` handle doesn't survive a reload, and a stale sheet appearing out of a
 * refresh would be worse than an empty table.
 */

import type { ParsedWorkbook } from "@/lib/excel";

export interface PendingUpload {
  /** The module whose page should adopt this file — only that page may take it. */
  moduleId: string;
  /** The file as the user gave it to us; kept so the export can re-open the original. */
  file: File;
  /** The parse the handing-over page already did, so the target doesn't repeat it. */
  parsed: ParsedWorkbook;
}

let handOff: PendingUpload | null = null;

/** Leave a file for `upload.moduleId`'s page, then navigate there. */
export function stashPendingUpload(upload: PendingUpload): void {
  handOff = upload;
}

/**
 * Look at the file left for `moduleId`, if there is one, without claiming it. A module
 * only ever gets its own hand-off; anything left for another one stays put.
 *
 * Split from {@link clearPendingUpload} so a caller can seed a `useState` lazy
 * initializer with this (safe to call twice — React replays an initializer once in
 * development Strict Mode) and clear the slot separately, once the value has actually
 * been used. Reading and clearing in the same call is what `takePendingUpload` used to
 * do, and why it couldn't be called from a lazy initializer: the replay would find the
 * slot already emptied by its own first call and silently drop the file.
 */
export function peekPendingUpload(moduleId: string): PendingUpload | null {
  return handOff?.moduleId === moduleId ? handOff : null;
}

/**
 * Clear the hand-off slot, so a second visit to the same module doesn't re-open a
 * sheet the user already closed. Only clears `moduleId`'s own hand-off — a call
 * naming the wrong module (nothing does today) leaves another module's pending file
 * untouched rather than dropping it.
 */
export function clearPendingUpload(moduleId: string): void {
  if (handOff?.moduleId === moduleId) handOff = null;
}
