import { useSyncExternalStore } from "react";

/**
 * Below Tailwind's `lg` (64rem) — where the project shell trades its sidebar for a
 * top bar and a drawer, and the screens lay out for a phone (design-system.md §24).
 *
 * Layout itself stays CSS (`max-lg:`); this is for the few places where a phone
 * gets different *behaviour*, which a class can't express: a list ordered by what
 * a phone is opened for, a view chosen for you, a panel that starts closed.
 */
const NARROW_QUERY = "(max-width: 63.999rem)";

/** For a one-off decision (an initial state, an event handler). */
export function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** For rendering: follows the window across the breakpoint. False on the server. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, isNarrowScreen, () => false);
}
