"use client";

import { setTheme, useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

/**
 * Dark/light toggle — a flat `neu-icon-btn` (nymbus-styling.md §3.9). It shows the
 * theme that is *on*: the violet moon in light mode, the gold sun in dark mode,
 * where the button also stays pressed in. Renders no icon until hydrated, so it
 * never flashes the wrong one.
 *
 * The sun gold and moon violet are icon art, not UI colour — the two sanctioned
 * hardcoded colours outside a brand logo.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const t = useT();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      data-active={isDark}
      aria-pressed={isDark}
      aria-label={isDark ? t("Schakel naar lichte modus", "Switch to light mode") : t("Schakel naar donkere modus", "Switch to dark mode")}
      title={isDark ? t("Lichte modus", "Light mode") : t("Donkere modus", "Dark mode")}
      className={`neu-icon-btn ${className}`}
    >
      {theme !== null &&
        (isDark ? (
          <span aria-hidden className="text-[15px] leading-none text-[#f5c842] drop-shadow-[0_0_4px_#f5c84266]">
            ☀
          </span>
        ) : (
          <svg viewBox="0 0 24 24" width={15} height={15} className="drop-shadow-[0_0_4px_#7c5cbf88]" aria-hidden="true">
            <path
              fill="#7c5cbf"
              d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"
            />
          </svg>
        ))}
    </button>
  );
}
