"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { LOCALES, restoreLocale, setLocale, useLocale, useT } from "@/lib/i18n";

/**
 * Applies the viewer's remembered language once the page has hydrated, and again on
 * every sign-in, sign-out and switch of session — English is admin-only for now
 * (`restoreLocale`). Mounted once, inside `AuthProvider` in the root layout — see
 * `lib/i18n.ts` for why this waits until after hydration.
 */
export function LocaleRestorer() {
  const { isAdmin } = useAuth();
  useEffect(() => {
    restoreLocale(isAdmin);
  }, [isAdmin]);
  return null;
}

/**
 * The NL / EN switch — the inline segmented switch (design system §12) at its
 * smallest, since it sits beside the signed-in user in the sidebar, where a
 * full-size control would outweigh what it does. Admins (and so developers) only,
 * for now; the sidebar renders it behind `isAdmin`.
 */
export default function LocaleToggle({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("Taal", "Language")}
      className={`flex h-7 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm ${className}`}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          title={l === "nl" ? "Nederlands" : "English"}
          className={`flex h-6 cursor-pointer items-center justify-center rounded-full px-2 text-[11px] font-semibold uppercase transition-[color,box-shadow] duration-200 ${
            locale === l ? "bg-k-bg text-k-cloud-deep shadow-raised-xs" : "text-k-text-tertiary hover:text-k-text-primary"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
