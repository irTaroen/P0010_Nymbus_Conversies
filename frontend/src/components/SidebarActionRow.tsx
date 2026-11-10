"use client";

import type { LucideIcon } from "lucide-react";

/**
 * One of the sidebar's tool rows that opens a dialog rather than navigating —
 * *Projectinstellingen*, *Gebruikers*, *Updateconnectors*. The design system's
 * navigation row, in its quiet (never active) state: a row like this has no page to
 * be "on", so it never carries the active tint.
 */
export default function SidebarActionRow({
  icon: Icon,
  label,
  onClick,
  expanded,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Whether the dialog it opens is open — announced when the row says so. */
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 pointer-coarse:py-3 text-[13px] font-medium text-k-text-secondary transition-[color,box-shadow] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </button>
  );
}
