"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useEscapeKey } from "@/components/useEscapeKey";
import { useT } from "@/lib/i18n";

/**
 * Right slide-over panel over a dimmed backdrop — what [`Modal`](./Modal.tsx) is
 * for centred dialogs. Owns the shared scaffolding: the fixed overlay, the
 * `bg-k-text-primary/20` backdrop, the slide-in transition, the dialog roles, and dismissal
 * on Escape or a backdrop click. Callers supply only the panel's content.
 *
 * **Mount it only while open.** The slide-in is driven by a `shown` flag flipped one
 * frame after mount, so a drawer that stays mounted while closed would animate once
 * and never again. A caller holding an `open` flag returns `null` above this
 * component rather than passing the flag in.
 *
 * `width` is the panel's max width (`max-w-md` for reference content, `max-w-lg`
 * where grouped lists need the room) — see design-system.md.
 */
export default function Drawer({
  onClose,
  onEscape,
  label,
  width = "max-w-md",
  modal = true,
  children,
}: {
  /** Called on a backdrop click, and on Escape unless `onEscape` handles it. */
  onClose: () => void;
  /**
   * Escape handler, when the drawer peels off a layer of its own state before
   * closing (the module help drawer clears an active search first). Defaults to
   * `onClose`.
   */
  onEscape?: () => void;
  /** Names the dialog for assistive tech, e.g. "Validatierapport". */
  label: string;
  /** Tailwind max-width class for the panel. */
  width?: string;
  /**
   * `false` for a panel that sits beside the page instead of over it: no dimmed
   * backdrop, and the page behind stays clickable — for a drawer that follows what
   * the user picks on the page (the admin's appointments per calendar day). Escape
   * still closes it; a click outside does not, since that click is meant for the page.
   */
  modal?: boolean;
  children: React.ReactNode;
}) {
  // Drives the slide-in: mount off-screen, then animate to 0 on the next frame,
  // so the initial state is committed before the transition starts.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEscapeKey(() => (onEscape ?? onClose)());

  return (
    <div
      className={`fixed inset-0 z-50 ${modal ? "" : "pointer-events-none"}`}
      role="dialog"
      aria-modal={modal}
      aria-label={label}
    >
      {modal && (
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
            shown ? "opacity-100" : "opacity-0"
          }`}
          onClick={onClose}
        />
      )}
      <div
        // The safe-area padding is 0 except on a phone with a notch or a home
        // indicator, where it keeps the header and the last row clear of them.
        className={`pointer-events-auto absolute right-0 top-0 flex h-full w-full ${width} flex-col bg-k-bg pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-[-12px_0_32px_var(--k-shade),-1px_0_0_var(--k-highlight)] transition-transform duration-200 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** The quiet outlined close button every drawer header ends with. */
export function DrawerCloseButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("Sluiten", "Close")}
      className="neu-icon-btn pointer-coarse:-m-1"
    >
      <X className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}
