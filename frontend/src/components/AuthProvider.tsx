"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { fetchMe, type Session } from "@/lib/auth";
import {
  getServerSession,
  getSession,
  isReloadingSession,
  setSession,
  subscribeToSession,
} from "@/lib/session-store";

/**
 * The local session for the whole app.
 *
 * There is no login: the backend runs as one local user with every right
 * (`/api/auth/me`). This provider fetches that session on load, keeps the copy in
 * `session-store` so a refresh paints straight away, and exposes `refresh()` for
 * whatever changes the project list (a project created or removed, its settings
 * saved).
 *
 * The role flags stay — `isAdmin`, `isDeveloper` — because the screens are still
 * written against them; locally they are always true.
 */

type AuthStatus = "loading" | "error" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  /** Why the session could not be fetched — the backend is usually not running. */
  error: string;
  isAdmin: boolean;
  isDeveloper: boolean;
  isManager: boolean;
  isVisitor: boolean;
  /** Fetch the session again (after a project was created, removed or renamed). */
  refresh: () => Promise<void>;
  /** Kept for the project picker; there is no sign-in to offer a choice after. */
  projectChoicePending: boolean;
  projectChoiceOffered: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const noop = () => () => {};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
  const session = useSyncExternalStore(subscribeToSession, getSession, getServerSession);
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      fetchMe().then(
        (next) => {
          setError("");
          if (!isReloadingSession()) setSession(next);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err))
      ),
    []
  );

  useEffect(() => {
    if (!hydrated) return;
    fetchMe().then(
      (next) => {
        setError("");
        if (!isReloadingSession()) setSession(next);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err))
    );
  }, [hydrated]);

  const projectChoiceOffered = useCallback(() => {}, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session ? "authenticated" : error ? "error" : "loading",
      session,
      error,
      isAdmin: true,
      isDeveloper: true,
      isManager: false,
      isVisitor: false,
      refresh,
      projectChoicePending: false,
      projectChoiceOffered,
    }),
    [session, error, refresh, projectChoiceOffered]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

/** Whether the user is an admin — always, locally. */
export function useIsAdmin(): boolean {
  return useAuth().isAdmin;
}

/** Whether the user is a developer — always, locally. */
export function useIsDeveloper(): boolean {
  return useAuth().isDeveloper;
}

/** Whether the user is a project manager or team lead — never, locally. */
export function useIsManager(): boolean {
  return useAuth().isManager;
}

/** The user's type — always an employee, locally. */
export function useUserType(): "employee" | "client" | null {
  return useAuth().session?.user.type ?? null;
}
