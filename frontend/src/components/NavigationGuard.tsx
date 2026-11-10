"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

/**
 * Consulted before every in-app navigation. Return true to take it over — the guard
 * then performs the navigation itself (with `force`) once the user has decided, or
 * drops it. False lets it through untouched.
 *
 * This is the seam the uploader hangs its "leave module" prompt on: only that page
 * knows a sheet is open and what leaving it costs, and it sits beside the sidebar in
 * the tree rather than under it.
 */
export type NavigationGuard = (href: string) => boolean;

interface NavigationGuardContextValue {
  /** Install (or clear, with null) the guard consulted before each navigation. */
  setNavigationGuard: (guard: NavigationGuard | null) => void;
  /** Would the guard take `href` over? What `GuardedLink` asks before navigating. */
  isIntercepted: (href: string) => boolean;
  /**
   * Go to `href` unless the guard takes it over. `force` goes past the guard — for
   * the guard's own owner, which by then has the user's answer.
   */
  navigate: (
    href: string,
    options?: { replace?: boolean; force?: boolean }
  ) => void;
  /**
   * Did the page now on screen get here via the browser's back/forward, rather than a
   * fresh in-app navigation? True for as long as the route stays the one a `popstate`
   * landed on — including across an async check, since there is nothing to "consume"
   * that a further navigation wouldn't already invalidate on its own. See the class
   * doc for why this exists and what it doesn't cover.
   */
  isHistoryReturn: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(
  null
);

/**
 * Holds the guard that in-app navigation is checked against.
 *
 * Next has no navigation blocking of its own — no `router.events`, nothing to
 * cancel a transition midway — so the check has to happen *before* the navigation
 * starts. `<Link>`'s `onNavigate` is the documented hook for it (it carries a
 * `preventDefault()`), and `navigate()` below is the same door for the programmatic
 * case. Both read the guard from here, so there is one answer to "may we leave this
 * page" no matter who asks.
 *
 * **What this still cannot cover: cancelling the browser's own back and forward
 * buttons.** They are not navigations the page gets asked about — there is no
 * `router.events` and nothing can stop a `popstate` once it fires, so the old page
 * unmounts regardless. What this provider *can* do is tell whatever is on screen
 * afterwards that it got there that way: `isHistoryReturn()` reads true for as long
 * as the current route is the one a `popstate` just landed on, which is what lets
 * the uploader tell "the user came back via history" apart from "the user opened
 * this module fresh" and restore an edited sheet from its autosave (`useSheetDraft`)
 * instead of asking again. The `beforeunload` handler in the uploader still
 * separately catches a reload or a tab close — that is all the platform offers there.
 */
export function NavigationGuardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // In a ref, not state: installing a guard must not re-render every consumer of
  // this context, and it is only ever read at the moment a navigation is asked for.
  const guardRef = useRef<NavigationGuard | null>(null);
  // Set by the one `popstate` listener below, read by `isHistoryReturn` below it. Also
  // a ref rather than state: setting it must not itself trigger a render ahead of the
  // one the route change already causes. Carries the pathname the `popstate` landed
  // on rather than a plain boolean — see `isHistoryReturn` for why a stamped route,
  // not a timer or a second effect, is what makes this self-expire correctly.
  const historyReturnPathRef = useRef<string | null>(null);

  const setNavigationGuard = useCallback((guard: NavigationGuard | null) => {
    guardRef.current = guard;
  }, []);

  // `popstate` fires only for real history navigation — back, forward, `history.go`
  // — never for this app's own `router.push`/`replace` calls (those use
  // `pushState`/`replaceState`, which do not raise it). So this is the one reliable
  // signal that the page about to mount is a history return rather than a fresh
  // navigation, and it is the only thing this listener does: it cannot cancel the
  // transition, only annotate the one that already started. `window.location.pathname`,
  // not `usePathname()`: the event fires as the URL changes but before Next has
  // re-rendered this component with it, so the hook would still read the *old* route.
  useEffect(() => {
    function onPopState() {
      historyReturnPathRef.current = window.location.pathname;
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // True while the route is still the one a `popstate` just landed on. A plain
  // equality check against the live `pathname` handles expiry on its own for the
  // common case — any further navigation changes `pathname`, and a stale stamp for
  // the *old* route no longer matches it. What it can't handle alone is a module
  // being revisited: leave A for B and later come back to A through an ordinary
  // sidebar click, and `pathname` reads A again, coincidentally matching a stamp that
  // is still sitting there from the original back/forward, days earlier. So the
  // stamp also needs actively clearing the moment the route moves *off* it — done in
  // an effect (not a render-time ref write, which the compiler forbids for a ref
  // other than the one being read this render) keyed on `pathname`. Effects run
  // child-first, so on the commit where a `popstate` lands exactly on this stamp's
  // route, this runs after — not before — the module page's own effect has already
  // read `isHistoryReturn()`, and finds nothing to clear since the paths still match;
  // it only ever clears a stamp that belongs to a route the user has since left.
  useEffect(() => {
    if (historyReturnPathRef.current !== null && historyReturnPathRef.current !== pathname) {
      historyReturnPathRef.current = null;
    }
  }, [pathname]);

  const isHistoryReturn = useCallback(() => {
    return historyReturnPathRef.current === pathname;
  }, [pathname]);

  const isIntercepted = useCallback(
    (href: string) => {
      // Going where you already are is not leaving: the sidebar's active module is a
      // link like any other, and clicking it must not put a "leave this sheet?"
      // prompt in front of the sheet it would keep. Both sides come from
      // `lib/routes.ts`, which is what makes this comparison safe.
      //
      // **The query string is not part of "where you are"** for this question. A
      // param names a *view* of the page — which reading of the open sheet is on
      // screen (`SHEET_VIEW_PARAM`) — and Next keeps the component mounted across
      // one, so nothing is left and nothing is lost. Comparing the full href would
      // put a "leave this sheet?" prompt in front of a switch that keeps the sheet
      // it is asking about, which is the prompt saying the opposite of the truth.
      // A guard that genuinely cares about a param can still read it: it is handed
      // the whole `href`, only this shortcut ignores it.
      if (href.split(/[?#]/, 1)[0] === pathname) return false;
      return guardRef.current?.(href) ?? false;
    },
    [pathname]
  );

  const navigate = useCallback<NavigationGuardContextValue["navigate"]>(
    (href, options) => {
      if (!options?.force && isIntercepted(href)) return;
      if (options?.replace) router.replace(href);
      else router.push(href);
    },
    [router, isIntercepted]
  );

  const value = useMemo<NavigationGuardContextValue>(
    () => ({ setNavigationGuard, isIntercepted, navigate, isHistoryReturn }),
    [setNavigationGuard, isIntercepted, navigate, isHistoryReturn]
  );

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard(): NavigationGuardContextValue {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) {
    throw new Error(
      "useNavigationGuard must be used within a NavigationGuardProvider"
    );
  }
  return ctx;
}

/**
 * The app's link. A plain `<Link>` would leave the page behind without asking, so
 * **every in-app link goes through this one** — that, and `navigate()`, are the only
 * two ways out of a page, which is what keeps the "leave module" prompt in front of
 * all of them.
 *
 * It stays a real `<a>`: the href is right there for a middle-click, a
 * cmd-click or *copy link address*. A new tab opens past the guard, which is correct
 * — it leaves this one exactly where it is.
 *
 * `href` is a string on purpose (not `<Link>`'s full `UrlObject`): the guard is
 * handed the destination and has to be able to say where it leads
 * ([`parseAppPath`](../lib/routes.ts)).
 */
export function GuardedLink({
  href,
  onNavigate,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { isIntercepted } = useNavigationGuard();
  return (
    <Link
      {...rest}
      href={href}
      onNavigate={(e) => {
        if (isIntercepted(href)) {
          e.preventDefault();
          return;
        }
        onNavigate?.(e);
      }}
    />
  );
}
