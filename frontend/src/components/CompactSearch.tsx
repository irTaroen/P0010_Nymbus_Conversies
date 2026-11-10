"use client";

import { Search } from "lucide-react";

/**
 * The small filter box above a rail or a list inside a panel — the mapping editor's
 * connector rail, its Excel columns, the schema tree, the payload records. `h-9`
 * to sit in a toolbar row beside buttons of the same height; the
 * dialog-sized search with its clear button is [`ModalSearch`](./Modal.tsx).
 *
 * `type="search"`, so the browser's own clear control and Escape-to-clear come with
 * it. `className` goes on the wrapper, for the caller's width (`flex-1`, `min-w-40`).
 */
export default function CompactSearch({
  value,
  onChange,
  placeholder,
  label,
  title,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Accessible name — the field carries no visible label. */
  label: string;
  /** A hover hint, for a search with a syntax worth knowing. */
  title?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`.trim()}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-k-text-tertiary"
        strokeWidth={1.8}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        title={title}
        className="neu-input h-9 w-full rounded-full pl-8 pr-3 text-sm"
      />
    </div>
  );
}
