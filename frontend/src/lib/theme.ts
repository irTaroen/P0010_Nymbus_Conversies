"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme-script";

/**
 * Light / dark theme (nymbus-styling.md §8). The theme lives in one place — the
 * `data-theme` attribute on `<html>` — and every colour follows it through the
 * `--k-*` tokens in globals.css, so no component ever reads the theme to pick a
 * colour. The only readers are the toggle's icon and its `aria-pressed`.
 *
 * The viewer's choice is remembered in localStorage; with no choice yet the OS
 * setting decides. `THEME_SCRIPT` (theme-script.ts) applies it before the first
 * paint (see the root layout), so a dark-mode user never sees a cream flash.
 *
 * No `next-themes`: this is the part of it the app needs, without a dependency.
 */

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active theme; `null` on the server and during hydration (no icon flash). */
export function useTheme(): Theme | null {
  return useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the switch still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}
