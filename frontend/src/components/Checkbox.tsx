"use client";

import { Check, Minus } from "lucide-react";

/**
 * The app's tick box: a 16px inset well that fills cloud-deep with a `k-bg` check
 * when ticked — the selected-calendar-day pairing of nymbus-styling.md, legible in
 * both themes.
 *
 * It replaces `accent-color` on a native `<input type="checkbox">`, because that
 * hands the browser the fill and lets it pick the glyph colour, which then differs
 * per engine and per theme.
 *
 * So the input stays — it is the thing that is focusable, keyboard-operable, labelable
 * and reachable by a screen reader, and none of that is worth re-implementing — but it
 * is made invisible (`appearance-none`) and the box is drawn over it. Everything below
 * is the input's own state expressed in CSS, so there is no React state here at all:
 * `peer-checked` and `peer-focus-visible` read the real control.
 *
 * `indeterminate` is a **DOM property, not an attribute** — it cannot be set in JSX —
 * so it is applied through a callback ref. That runs at commit rather than during
 * render, which is what keeps it clear of the React Compiler's ref rules
 * (`react-hooks/refs` rejects ref access during render; a DOM callback ref is not that).
 */
export default function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  className = "",
  ...props
}: {
  checked: boolean;
  /** Some but not all — the honest third state of a select-all. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "checked" | "onChange" | "type" | "className"
>) {
  return (
    <span className={`relative inline-flex h-4 w-4 shrink-0 ${className}`}>
      <input
        {...props}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        ref={(node) => {
          if (node) node.indeterminate = indeterminate && !checked;
        }}
        className={`peer h-4 w-4 shrink-0 appearance-none rounded-[5px] bg-k-bg shadow-inset-sm transition-[background-color,box-shadow] duration-150 ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:shadow-[var(--k-shadow-inset-sm),0_0_0_2px_var(--k-cloud-light)]"
        } checked:bg-k-cloud-deep checked:shadow-raised-xs indeterminate:bg-k-cloud-deep indeterminate:shadow-raised-xs disabled:checked:bg-k-text-tertiary disabled:indeterminate:bg-k-text-tertiary`}
      />
      {/* The mark itself, over the input and never in the way of a click. Hidden
          until the input says otherwise, so the two can't disagree about state. */}
      <Check
        aria-hidden
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-k-bg opacity-0 peer-checked:opacity-100"
      />
      <Minus
        aria-hidden
        strokeWidth={3.5}
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-k-bg opacity-0 peer-indeterminate:peer-not-checked:opacity-100"
      />
      {/* The focus ring belongs to the drawn box, not to an invisible input. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-0.5 rounded-[7px] opacity-0 ring-2 ring-k-cloud-mid peer-focus-visible:opacity-100"
      />
    </span>
  );
}
