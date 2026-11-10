"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Where a PDF button stands: ready, writing (the writer is fetched on first use), or just failed. */
export type PdfState = "idle" | "busy" | "failed";

/** How long *failed* stays on the button before it offers itself again. */
const FAILED_MS = 2500;

/**
 * The state behind every PDF button in the app: `busy` while the dynamically
 * imported writer builds and saves the file, `failed` for a moment when it
 * couldn't, then back to `idle`. One copy, so the feedback is the same on every
 * report and its timing changes in one place.
 *
 * `download` is read when the button is pressed, not when the hook is called, so
 * it may close over whatever the component rendered last.
 */
export function usePdfDownload(download: () => Promise<void>): [PdfState, () => Promise<void>] {
  const [state, setState] = useState<PdfState>("idle");
  const latest = useRef(download);
  useEffect(() => {
    latest.current = download;
  });

  useEffect(() => {
    if (state !== "failed") return;
    const id = setTimeout(() => setState("idle"), FAILED_MS);
    return () => clearTimeout(id);
  }, [state]);

  const save = useCallback(async () => {
    setState("busy");
    try {
      await latest.current();
      setState("idle");
    } catch {
      setState("failed");
    }
  }, []);

  return [state, save];
}
