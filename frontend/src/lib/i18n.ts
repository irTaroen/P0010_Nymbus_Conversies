/**
 * The app's two languages — Dutch, which everything is written in first, and English.
 *
 * **Every string carries both, side by side, at the place it is used:**
 *
 *     const t = useT();
 *     <button>{t("Opslaan", "Save")}</button>
 *     t(`${n} rijen`, `${n} rows`)
 *     t(<>Klik <b>hier</b></>, <>Click <b>here</b></>)
 *
 * Not a key into a dictionary file. With two languages and one team, a dictionary
 * only adds a lookup that can drift: change the Dutch and the English silently goes
 * on saying the old thing, or a key goes missing and renders as `upload.retry`.
 * Side by side, a reader sees what the English says the moment they touch the
 * Dutch, and a missing translation is a type error rather than a blank.
 *
 * Two ways in, for two kinds of caller:
 *
 * - **`useT()` in a component.** It subscribes, so the component re-renders when the
 *   language is switched. A component that renders text must use this — `tr()` alone
 *   gives the right string but leaves the component standing in the old language
 *   until something else re-renders it.
 * - **`tr()` everywhere else** — lib code run on demand (a PDF, an Excel export, a
 *   validation run, an error thrown from a fetch). It reads the language at the
 *   moment it is called, which for those is the moment that matters.
 *
 * Content that lives in JSON carries its English beside the Dutch too: a rule's
 * `messageEn` next to its `message`, a help article's `content/en/` twin, a
 * template's `public/templates/en/` copy. Missing English there falls back to the
 * Dutch, so a half-translated module is readable, never empty.
 *
 * The choice is the viewer's, kept in `localStorage`. The server always renders
 * Dutch and the stored language is applied after hydration (`restoreLocale`), so the
 * first client render matches the server's HTML — the auth gate shows nothing but a
 * loading mark at that point, so nobody sees the switch happen.
 */

// The default import, not named ones: `validation/checks.ts` imports this file, and
// scripts/sync-module-help.mts runs that through plain Node, whose ESM loader can't
// see the named exports of React's CommonJS entry.
import React from "react";

export type Locale = "nl" | "en";

export const LOCALES: readonly Locale[] = ["nl", "en"];

const STORAGE_KEY = "nymbus-conversies.locale";

let current: Locale = "nl";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language right now. For a component, `useLocale()` — this one doesn't re-render. */
export function getLocale(): Locale {
  return current;
}

function apply(next: Locale) {
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

/** Switch the language, and remember it for this browser. */
export function setLocale(next: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage: switch for this visit only.
  }
  apply(next);
}

/**
 * Apply the remembered language — after hydration (see the header), and again
 * whenever the session changes. English is admin-only for now (`allowed`): anyone
 * else gets Dutch, though the stored choice is kept for when it opens up — so an
 * admin who signs out, or views the app as a customer, sees what they would.
 */
export function restoreLocale(allowed: boolean) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Unreadable storage: stay on Dutch.
  }
  apply(allowed && stored === "en" ? "en" : "nl");
}

/** The Dutch or the English, by the language right now. Outside components; see the header. */
export function tr<T>(nl: T, en: T): T {
  return current === "en" ? en : nl;
}

/** The language, re-rendering the caller when it is switched. */
export function useLocale(): Locale {
  return React.useSyncExternalStore(subscribe, getLocale, () => "nl");
}

/** `tr` for a component: the same pair-picker, re-rendering the caller on a switch. */
export function useT(): <T>(nl: T, en: T) => T {
  const locale = useLocale();
  return React.useCallback(<T,>(nl: T, en: T): T => (locale === "en" ? en : nl), [locale]);
}

/**
 * The `Intl` locale for dates and numbers. Dutch formats as `nl-NL`; English as
 * `en-GB`, whose day-month-year order is what a Dutch reader of the same report
 * expects, and which AFAS's own English UI uses.
 */
export function intlLocale(locale: Locale = current): string {
  return locale === "en" ? "en-GB" : "nl-NL";
}

/**
 * A localized text held in JSON: the Dutch, and the English beside it when there is
 * one. Missing English falls back to the Dutch — readable, if not yet translated.
 */
export function localized(nl: string, en: string | undefined): string;
export function localized(nl: string | undefined, en: string | undefined): string | undefined;
export function localized(nl: string | undefined, en: string | undefined): string | undefined {
  return current === "en" && en ? en : nl;
}
