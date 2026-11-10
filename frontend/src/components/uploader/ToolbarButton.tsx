"use client";

import { type LucideIcon } from "lucide-react";
import AdminOnly from "@/components/AdminOnly";

/**
 * The icon-only button the sheet toolbar is built from — and, since the admin
 * menu hangs off one of them, its own trigger too. It lives here rather than in
 * [`SheetToolbar`](./SheetToolbar.tsx) so both can use it without importing
 * across each other.
 */

// 44px to a finger (`pointer-coarse:`), the touch-target minimum; the row wraps.
export const TOOLBAR_BTN =
  "group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-k-bg text-sm font-semibold transition-[box-shadow,color,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-k-cloud-mid pointer-coarse:h-11 pointer-coarse:w-11";

export const TOOLBAR_BTN_IDLE =
  "cursor-pointer text-k-text-primary shadow-raised-sm hover:text-k-cloud-deep hover:shadow-lifted-sm active:shadow-inset-sm";

// Toggle buttons in their "on" state — pressed in and cloud-blue, so the active
// filter is obvious at a glance next to the raised one-shot actions. The admin menu's
// trigger borrows it while its panel is open, for the same reason: the button
// that opened what is on screen shouldn't look idle.
export const TOOLBAR_BTN_ACTIVE =
  "cursor-pointer text-k-cloud-deep shadow-inset-sm";

export const TOOLBAR_BTN_DISABLED =
  "cursor-not-allowed text-k-text-tertiary opacity-60 shadow-inset-sm";

// A touch screen has no hover — Tailwind's `hover:` only applies where the device
// can — so there the label shows while the button is held instead: after 300ms, so
// a plain tap doesn't flash it, and sliding off before letting go cancels the press.
export const TOOLBAR_BTN_TOOLTIP =
  "pointer-events-none absolute bottom-[calc(100%+6px)] z-50 whitespace-nowrap rounded-full bg-k-text-primary px-2.5 py-1 text-xs font-medium text-k-bg opacity-0 shadow-raised-sm transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:group-active:opacity-100 pointer-coarse:group-active:delay-300";

/** The three states as classes, so a hand-rolled trigger can't style them differently. */
export function toolbarBtnState({
  disabled,
  active,
}: {
  disabled?: boolean;
  active?: boolean;
}): string {
  return disabled ? TOOLBAR_BTN_DISABLED : active ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_IDLE;
}

/**
 * Icon-only toolbar button with a hover tooltip. Pass `active` to make it a
 * toggle (renders `aria-pressed` and the filled state); `pulse` nudges
 * attention; `disabled` greys it out and drops the hover styling. `trailing`
 * anchors the tooltip to the button's right edge instead of its centre — for the
 * buttons at the toolbar's right edge, where a centred tooltip would hang out of
 * the card. `leading` anchors it to the left edge — for a bar in the page's
 * left column, where a centred one would hang off the screen and a left-aligned
 * one runs out over the table instead.
 *
 * `adminOnly` hides the button from everyone but admins — one flag rather than a
 * conditional around the JSX, so the row of buttons stays a flat list and every
 * gate in the app runs through [`AdminOnly`](../AdminOnly.tsx). Hidden, not
 * disabled: `disabled` says "not yet" about a button you may press once the sheet
 * is ready, and a non-admin is never going to press this one.
 */
export default function ToolbarButton({
  label,
  onClick,
  pulse,
  active,
  disabled,
  trailing,
  leading,
  adminOnly,
  children,
}: {
  label: string;
  onClick?: () => void;
  pulse?: boolean;
  active?: boolean;
  disabled?: boolean;
  trailing?: boolean;
  leading?: boolean;
  adminOnly?: boolean;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`${TOOLBAR_BTN} ${toolbarBtnState({ disabled, active })} ${pulse && !disabled ? "toolbar-btn-pulse" : ""}`}
    >
      {children}
      <ToolbarTooltip trailing={trailing} leading={leading}>
        {label}
      </ToolbarTooltip>
    </button>
  );
  return adminOnly ? <AdminOnly>{button}</AdminOnly> : button;
}

/** Every {@link WorkflowActionButton} shares this chip regardless of tone —
 *  only the icon beside the label says what kind of action this is.
 *  A pill, like every other button. `w-full` so they sit in a column of one shared width (their
 *  parent sizes that column to the longest label) rather than each hugging its
 *  own — the hand-in alone would otherwise read as a narrower, lesser action
 *  next to the others. */
const STATUS_CHIP_BASE =
  "group relative inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-k-bg px-4 text-[13px] font-medium transition-[box-shadow,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-k-cloud-mid pointer-coarse:h-11";

const STATUS_CHIP_ENABLED =
  "cursor-pointer text-k-text-primary shadow-raised-sm hover:text-k-cloud-deep hover:shadow-lifted-sm active:shadow-inset-sm";

const STATUS_CHIP_DISABLED =
  "cursor-not-allowed text-k-text-tertiary shadow-inset-sm";

/** The icon's colour, keyed to what pressing the button actually records —
 *  a verdict (`good`/`bad`) or, for the hand-in, no verdict at all
 *  (`neutral`, the brand cloud-blue rather than either status colour). */
const STATUS_CHIP_ICON_TONE: Record<"neutral" | "good" | "bad", string> = {
  neutral: "text-k-cloud-deep",
  good: "text-k-green-fg",
  bad: "text-k-red-fg",
};

/**
 * A workflow action, its own button rather than an icon in the row: an icon
 * and the action's label (`ACTION_LABELS`, by code) as its visible label
 * (*Data versturen naar Nymbus*, *Import afgerond*) — unlike {@link ToolbarButton},
 * whose label only ever shows as a tooltip. These are the actions that
 * actually move a deeltaak on in AFAS (every action at the deeltaak's
 * current task, `actions` off `project_modules()` (the hosted version)), so they earn more
 * than an icon.
 *
 * **A chip, not a filled button.** White with a thin border — the same idle
 * treatment as {@link ToolbarButton} — and an `icon` beside the label
 * (`actionIcon()`, or `Send` for the hand-in). `tone` picks the icon's colour
 * (`actionTone()`): `good`/`bad` for an action's verdict, `neutral` (the
 * default, brand cloud-blue) for the hand-in and any step that isn't one.
 *
 * `pulse` is the hand-in's "this is your next step": the toolbar's own
 * `.toolbar-btn-pulse`, once the sheet may actually be sent.
 *
 * `disabled` still exists for the hand-in, which stays mounted while a sheet
 * isn't clean yet — `tooltip` carries why, and the icon dims rather than
 * keeping its colour. The other actions never render disabled at all:
 * `SheetToolbar` only mounts them while their task applies.
 */
export function WorkflowActionButton({
  label,
  tooltip,
  icon: Icon,
  tone = "neutral",
  pulse,
  disabled,
  onClick,
}: {
  label: string;
  tooltip: string;
  icon: LucideIcon;
  /** Which status the icon signals — see the constant above. */
  tone?: "neutral" | "good" | "bad";
  pulse?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${STATUS_CHIP_BASE} ${disabled ? STATUS_CHIP_DISABLED : STATUS_CHIP_ENABLED} ${pulse && !disabled ? "toolbar-btn-pulse" : ""}`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${disabled ? "text-k-text-tertiary" : STATUS_CHIP_ICON_TONE[tone]}`}
        strokeWidth={1.8}
      />
      {label}
      {/* Leading: the chips sit in the page's left column (`SheetToolbar`). */}
      <ToolbarTooltip leading>{tooltip}</ToolbarTooltip>
    </button>
  );
}

/**
 * The hover tooltip itself, for a trigger that has to build its own `<button>`
 * (the admin menu's) — same pill, same anchoring rule, so it can't drift from
 * the ones {@link ToolbarButton} renders.
 */
export function ToolbarTooltip({
  trailing,
  leading,
  children,
}: {
  trailing?: boolean;
  leading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      role="tooltip"
      className={`${TOOLBAR_BTN_TOOLTIP} ${trailing ? "right-0" : leading ? "left-0" : "left-1/2 -translate-x-1/2"}`}
    >
      {children}
    </span>
  );
}
