"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useEscapeKey } from "@/components/useEscapeKey";

interface FocusModeValue {
  /** Whether the page has been given the whole window. */
  focused: boolean;
  toggleFocus: () => void;
  /** Leave focus mode, no-op when already out — what Escape and unmount use. */
  exitFocus: () => void;
}

const FocusModeContext = createContext<FocusModeValue | null>(null);

/**
 * "Give this sheet the whole window" — one boolean, shared by the two things that
 * have to get out of its way.
 *
 * A module page is a sheet read across its full width: 60-odd columns in the grid,
 * or an AFAS body nested five objects deep in the payload view. Both are wider than
 * the space left over once the three panels around them have taken theirs — the
 * project sidebar (`w-68`), the module's *Aangeleverde bestanden*
 * ([`ModuleFilesPanel`](./uploader/ModuleFilesPanel.tsx), `w-72`) and, in the
 * payload view, the Records rail (`w-72`) — well over half a laptop's screen
 * between them. All three are ways of *getting* to a sheet, not of reading the one
 * already open, which is what makes them the right things to trade for width.
 *
 * **Why a context and not `useState` in one component.** The panels are scattered
 * across the tree: the sidebar is rendered by
 * [`app/[project]/layout.tsx`](../app/[project]/layout.tsx), the files panel by
 * [`ExcelUploader`](./ExcelUploader.tsx), the rail by
 * [`ModulePayloadPanel`](./uploader/ModulePayloadPanel.tsx) below that, and the
 * button that toggles them all by
 * [`SheetToolbar`](./uploader/SheetToolbar.tsx) off to one side. Their nearest
 * common ancestor is that layout, so the state lives there — as a provider rather
 * than as three prop chains threaded through every component in between.
 *
 * **Not the browser's fullscreen.** No `requestFullscreen()`: that hides the
 * address bar and the tab strip, which on a tool whose URL *is* its state
 * (docs/architecture.md#routing) takes away the thing telling you which module you
 * are in, and it opts out of the browser's own zoom and print. This is a layout
 * state, so it is a layout state — which also means it survives nothing, by
 * design: see below.
 *
 * **Deliberately not in the URL.** Everything else about where you are is
 * (`/501282/hrm-medewerkers?view=payloads`), because a module is worth linking to
 * and worth surviving a refresh. This isn't: it says how wide one person wants one
 * screen right now, and a link that silently hid a colleague's sidebar would be a
 * link that arrived broken-looking. It resets on reload, and that is the right
 * answer rather than a missing feature.
 */
export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);

  const exitFocus = useCallback(() => setFocused(false), []);
  const toggleFocus = useCallback(() => setFocused((on) => !on), []);

  // Escape leaves, the way it closes every dialog in the app. Focus mode hides the
  // app's own navigation, so it has to have a way out that needs no navigation to
  // find — the exit button is the obvious one, this is the one that works when the
  // pointer is somewhere in a 6000-cell grid. Bound only while focused, so it can't
  // swallow an Escape a dialog underneath wants.
  useEscapeKey(() => setFocused(false), focused);

  const value = useMemo<FocusModeValue>(
    () => ({ focused, toggleFocus, exitFocus }),
    [focused, toggleFocus, exitFocus],
  );

  return (
    <FocusModeContext.Provider value={value}>
      {children}
    </FocusModeContext.Provider>
  );
}

/**
 * The classes a side panel wears so it *slides* out of the way instead of blinking
 * out — one string, used by all three, because three panels leaving at three speeds
 * would read as three unrelated glitches rather than one movement.
 *
 * **Width is the animated property, and that is deliberate.** The main pane is
 * `flex-1`, so shrinking a sibling's width to zero is the same motion as growing the
 * sheet: the grid stretches into the space as it is vacated, in one continuous
 * frame-by-frame layout rather than a jump at the end. That is the "stretch" this is
 * for, and it comes free — the sheet itself needs no transition at all.
 *
 * Animating layout width is normally the expensive choice (it reflows every frame,
 * where `transform` doesn't). It is the right one here anyway: a `translateX` would
 * slide the panel out *over* the sheet while leaving its gap behind, so the sheet
 * would still snap wider at the end — which is precisely the thing being fixed. Two
 * panels over 200ms, on a page that is otherwise idle, is a cost worth paying for
 * the only motion that tells the truth about the layout.
 *
 * `overflow-hidden` is what makes a zero width safe: the contents are `w-68`/`w-72`
 * wide and do not reflow, they are simply clipped as the frame closes over them.
 * `opacity` fades a touch faster than the width closes, so the last few pixels are
 * already empty and the panel doesn't appear to be crushed. `shrink-0` keeps flex
 * from pre-emptively squeezing the panel before the transition starts.
 */
export const PANEL_TRANSITION =
  "shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out";

/** The width/opacity pair for a panel, given whether focus mode has hidden it. The
 *  open width is the panel's own — hence the argument rather than a constant. */
export function panelSizeClass(hidden: boolean, openWidth: string): string {
  return hidden ? "w-0 opacity-0" : `${openWidth} opacity-100`;
}

/**
 * Focus mode, for the panels that hide and the button that toggles it.
 *
 * Falls back to "not focused, and toggling does nothing" outside a provider rather
 * than throwing, unlike `useProject`: this is a display preference, and a component
 * mounted somewhere without the provider (the dossier shell, a future standalone
 * page) should render at its normal width, not crash.
 */
export function useFocusMode(): FocusModeValue {
  return useContext(FocusModeContext) ?? NO_FOCUS;
}

/** The outside-a-provider answer, as one stable object so it can't retrigger memos. */
const NO_FOCUS: FocusModeValue = {
  focused: false,
  toggleFocus: () => {},
  exitFocus: () => {},
};
