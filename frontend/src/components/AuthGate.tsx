"use client";

import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useT } from "@/lib/i18n";

/**
 * The gate every route sits behind. There is no login — the backend runs as one
 * local user — so this only waits for `/api/auth/me` to answer, and says so plainly
 * when it doesn't (the backend isn't running). That is also what lets
 * `app/[project]/layout.tsx` take a session for granted.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error, refresh } = useAuth();
  const t = useT();

  if (status === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-105 flex-col items-center rounded-3xl bg-k-bg px-11 pt-11 pb-9 text-center shadow-raised">
          <h1 className="text-lg font-semibold text-k-text-primary">
            {t("De backend is niet bereikbaar", "The backend can't be reached")}
          </h1>
          <p className="mt-2 text-sm text-k-text-secondary">
            {t(
              "Start de app met `make dev` in de hoofdmap van het project.",
              "Start the app with `make dev` in the project's root folder."
            )}
          </p>
          <p className="mt-2 text-xs text-k-text-tertiary">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="neu-action-primary mt-5"
          >
            <RefreshCw className="h-4 w-4" />
            {t("Opnieuw proberen", "Try again")}
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-lg bg-k-bg text-k-cloud-deep shadow-raised">
          <FileSpreadsheet className="h-6 w-6" strokeWidth={2} />
        </span>
      </div>
    );
  }

  return <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
