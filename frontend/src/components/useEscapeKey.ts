"use client";

import { useEffect, useRef } from "react";

/**
 * Run `handler` when Escape is pressed anywhere on the page — how every dialog,
 * drawer and focus mode in the app is left. Bound only while `enabled`, so a
 * layer that isn't showing can't swallow an Escape meant for one that is.
 *
 * `handler` is read at the moment the key is pressed, so a caller can pass an
 * inline function without the listener being torn down and rebound every render.
 * A field that wants Escape for itself (cancelling an inline edit) stops the
 * event's propagation in its own `onKeyDown`, and this never hears it.
 */
export function useEscapeKey(handler: () => void, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") latest.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
