"use client";

import { AlertTriangle, Check, Search, X, type LucideIcon } from "lucide-react";
import { useEscapeKey } from "@/components/useEscapeKey";
import { useT } from "@/lib/i18n";

/**
 * Centered modal dialog over a dimmed backdrop. Owns the shared scaffolding —
 * overlay, card surface, and dismissal on Escape or backdrop click — so callers
 * only supply the card's content. Pass width/height via `className` (e.g.
 * "max-w-md"); the card already has width, rounding, background, and shadow.
 *
 * **Below `sm` it is a bottom sheet**: full width whatever `max-w-*` the caller
 * asked for, square at the bottom where it meets the screen's edge, its buttons
 * within thumb reach, capped a little short of the screen's height and scrolling
 * itself past that — the `max-sm:` classes come after the caller's in the cascade,
 * so they win there without any dialog having to know. At any width a card taller
 * than the screen (a phone on its side) scrolls the backdrop rather than being cut
 * off at the top: `items-center-safe` centres only what fits.
 */
export default function Modal({
  onDismiss,
  className = "max-w-sm",
  children,
}: {
  /** Called on Escape or a click outside the card (the "soft cancel"). */
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  useEscapeKey(onDismiss);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center-safe justify-center overflow-y-auto bg-black/30 p-4 max-sm:items-end max-sm:px-0 max-sm:pb-0 max-sm:pt-[calc(1rem+env(safe-area-inset-top))]"
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full animate-[float-up_0.35s_ease_both] rounded-2xl bg-k-bg shadow-modal ${className} max-sm:max-h-[calc(100dvh-1rem-env(safe-area-inset-top))] max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The opening block every prompt that interrupts a flow shares: a round icon chip
 * beside a heading and one paragraph of explanation. The two exported variants below
 * differ in nothing but the chip, so a question about a sheet lays out the same way
 * whether or not there is anything at stake in it.
 */
function ModalIconHeader({
  icon: Icon,
  chipClassName,
  title,
  children,
}: {
  icon: LucideIcon;
  /** The chip's tint — background and icon colour. */
  chipClassName: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-6 py-5">
      <span
        className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md shadow-inset-sm ${chipClassName}`}
      >
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-[-0.3px] text-k-text-primary">{title}</h2>
        <p className="mt-1 text-[13px] leading-[1.55] text-k-text-secondary">{children}</p>
      </div>
    </div>
  );
}

/**
 * The opening block of a modal that asks the user to confirm something they might
 * regret: the amber chip. Used by the prompts that stand in front of losing work —
 * switching module, discarding unsaved edits, leaving a sheet that isn't saved.
 */
export function ModalWarningHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ModalIconHeader
      icon={AlertTriangle}
      chipClassName="bg-k-amber-bg text-k-amber-fg"
      title={title}
    >
      {children}
    </ModalIconHeader>
  );
}

/**
 * The same block with a green check: a decision to confirm where nothing is at
 * stake. The chip is the answer to the question the user is really asking — *did I
 * already save?* — which is why this exists rather than a headerless dialog: the
 * amber triangle would claim a risk that isn't there, and no chip at all would leave
 * the reassurance to be read out of a sentence.
 */
export function ModalConfirmHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ModalIconHeader
      icon={Check}
      chipClassName="bg-k-green-bg text-k-green-fg"
      title={title}
    >
      {children}
    </ModalIconHeader>
  );
}

/**
 * The button chrome every modal's footer shares: primary (the action that moves
 * things forward), secondary (dismiss / go back), danger (an irreversible or
 * risky choice, e.g. discarding unsaved work) and success (the positive half of
 * a two-way decision, e.g. approving a review — paired with `danger`, same
 * outlined weight, so the two read as one choice rather than one button
 * outranking the other). `fullWidth` is for the prompts that stack their
 * buttons instead of putting them side by side.
 */
export function ModalButton({
  tone = "secondary",
  fullWidth = false,
  className = "",
  children,
  ...props
}: {
  tone?: "primary" | "secondary" | "danger" | "success";
  fullWidth?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const toneClass = {
    primary: "neu-action-primary",
    secondary: "neu-action-secondary",
    danger: "neu-action-danger",
    // The positive half of a two-way decision: danger's weight, green ink.
    success: "neu-action-danger !text-k-green-fg",
  }[tone];
  return (
    <button
      type="button"
      {...props}
      className={`!px-5 !py-2 pointer-coarse:!py-3 !text-sm ${toneClass} ${fullWidth ? "w-full" : ""} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

/**
 * The round **close button** every dialog carries in its top-right corner.
 *
 * One recipe rather than a copy per dialog, because it is the app's standing promise
 * about modals: whatever a dialog is, the way out is in the same place. Escape and a
 * backdrop click still work — this makes that exit *visible*, which neither of those
 * is, and gives a pointer-only user the same one-press exit a keyboard user has.
 *
 * Placed by the caller, not by `Modal`: a dialog's header is its own layout (a title
 * with a project under it, a search field, an icon chip) and the button has to sit in
 * that flex row rather than float over it, where it would land on top of a long title.
 * `PickerHeader` already places one; anything building its own header uses this.
 *
 * It is **not** a `ModalButton`: closing is not one of the choices a dialog offers, it
 * is the way out of the whole thing. A footer with *Sluiten* beside *Opslaan* reads as
 * two competing actions, which is exactly what moving the exit up here removes — so a
 * dialog that has this in its corner keeps its footer for saving alone.
 */
export function ModalCloseButton({
  onClose,
  label,
}: {
  onClose: () => void;
  /** Accessible name — the button is an icon only. */
  label?: string;
}) {
  const t = useT();
  const name = label ?? t("Sluiten", "Close");
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={name}
      title={name}
      // 44px to a finger, without moving the header: the negative margin hands
      // back what the larger box adds, so the row keeps its 32px layout.
      className="neu-icon-btn pointer-coarse:-m-1.5"
    >
      <X className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/**
 * The grid every picker dialog's column band and rows share, so avatar, label and
 * whatever columns follow line up between the two — a row is its own grid
 * container, so without a shared template each would size to its own content and
 * the columns would stagger down the list.
 */
export const PICKER_ROW_GRID = "grid items-center gap-3";

/**
 * The card of a picker whose list is a **fetch that can be searched** — one fixed
 * height, whatever the list holds, so the dialog doesn't jump as a search narrows
 * it or a tab swaps one list for another (`UsersDialog`). The list area takes what
 * is left (`min-h-0 flex-1 overflow-y-auto`); capped by the viewport, so a short
 * screen scrolls the list rather than cutting off the footer.
 */
export const FIXED_PICKER_CARD = "flex h-[min(46rem,calc(100dvh-2rem))] max-w-3xl flex-col";

/** The list area inside a `FIXED_PICKER_CARD`: fills the card, scrolls itself. */
export const FIXED_PICKER_LIST = "min-h-0 flex-1 overflow-y-auto";

/**
 * The header every picker dialog opens with: a title, then whatever context
 * belongs under it, and the round close button top right. `onClose` is optional —
 * `ProjectPickerModal` has none at the root route (`/`), where the dialog is the
 * whole page and there is nothing to dismiss to.
 */
export function PickerHeader({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-5">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-[-0.3px] text-k-text-primary">{title}</h2>
        {children}
      </div>
      {onClose && <ModalCloseButton onClose={onClose} />}
    </div>
  );
}

/**
 * The footer every picker dialog ends with: a shown/total count on the left, a
 * quiet "Sluiten" on the right. Its own button rather than `ModalButton` — this
 * closes a dialog with nothing to decide, which reads differently from
 * `ModalButton`'s `secondary` (a real alternative to a primary action).
 */
export function PickerFooter({
  count,
  onClose,
}: {
  count: React.ReactNode;
  onClose?: () => void;
}) {
  const t = useT();
  return (
    // The hairline above the footer is the one line a modal keeps (nymbus-styling.md §10.11).
    <div className="relative flex items-center justify-between gap-4 px-6 py-4 before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-k-divider">
      <p className="text-xs text-k-text-secondary tabular-nums">{count}</p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="neu-action-secondary pointer-coarse:!py-3"
        >
          {t("Sluiten", "Close")}
        </button>
      )}
    </div>
  );
}

/**
 * The search field of a dialog or drawer that is a list to look through — the
 * design system's *Search field*: magnifier on the left, a clear button on the right
 * once something is typed, autofocused because opening one of these is how you get
 * here and typing is the next thing you do.
 *
 * Shared by every such list ([`ProjectPickerModal`](./ProjectPickerModal.tsx),
 * [`UserPickerModal`](./UserPickerModal.tsx), the help drawer's column search, the
 * [`CodetabelPicker`](./uploader/CodetabelPicker.tsx)), so the field can't be one
 * size in one and another in the other. It brings no spacing of its own: the caller
 * places it (`px-6 pb-4`, with or without a divider under it).
 *
 * `inputProps` is for a field that is more than a filter: the codetabel picker's
 * input is a `combobox` driving a `listbox` with ↑/↓ and Enter, and passes its
 * role, ARIA wiring and key handler through here.
 */
export function ModalSearch({
  value,
  onChange,
  placeholder,
  label,
  autoFocus = true,
  inputProps,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Accessible name — the field carries no visible label. */
  label: string;
  autoFocus?: boolean;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const t = useT();
  return (
    <label className="group relative block">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-k-text-tertiary transition-colors group-focus-within:text-k-cloud-deep">
        <Search className="h-4 w-4" strokeWidth={2} />
      </span>
      <input
        {...inputProps}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="neu-input w-full rounded-full py-2.5 pl-10 pr-10 text-sm"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("Zoekopdracht wissen", "Clear search")}
          className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-k-text-tertiary transition-[box-shadow,color] hover:text-k-red-fg hover:shadow-inset-sm pointer-coarse:right-0 pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </label>
  );
}
