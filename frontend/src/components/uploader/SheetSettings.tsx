"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Download,
  Loader2,
  MapPinPlus,
  RefreshCw,
} from "lucide-react";
import AdminOnly from "@/components/AdminOnly";
import Modal, { ModalCloseButton } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/**
 * Modal: the sheet's settings — a list of tool rows. The validatierapport, which
 * everyone who can open a sheet may read here (the same report the PDF from
 * *Opslaan en downloaden* carries, on screen instead of on paper), and, admin-only,
 * *Codetabellen verversen*.
 *
 * It used to open on a *Start vanaf rij* field, a fixed number of rows to skip
 * under the headers. `parseExcelFile()` now finds where the data starts itself —
 * the first row with data, past a template's explanation row — so there is no
 * longer a reading of the file to set here.
 *
 * *Voortgang naar AFAS sturen* used to sit here too, sending the check's figures;
 * it moved to the payload view's header (`ModulePayloadPanel`), where the figure it
 * sends — how much of the sheet AFAS already holds — is the one on screen.
 *
 * *Codetabellen verversen* is for a table the customer changed in AFAS during the
 * day — a woonplaats added to `ALG_Woonplaatsen`. The backend holds a table for an
 * hour and the page for as long as it is open, so without it a value AFAS already
 * has stays red until both run out. It needs no check on screen: it replaces what
 * the check compares against, and the sheet is validated again once the tables
 * land (`loadedAt` in CodetabellenProvider).
 *
 * *Plaatsen toevoegen* and *AFAS plaatsen downloaden*, admin-only and only on a
 * module whose woonplaatsen may be unlisted (`allowUnlisted`, see `plaatsen`): the
 * first adds the sheet's unknown places with a valid land to the `afas_plaatsen`
 * table, the second hands that whole table out as a `.csv` for the
 * import into AFAS.
 */
export default function SheetSettings({
  onCancel,
  hasResult,
  onReport,
  onRefreshCodetabellen,
  plaatsen,
}: {
  onCancel: () => void;
  /** Validation has run on the sheet on screen — what the report needs. */
  hasResult: boolean;
  /** Open the validatierapport drawer — closes this modal first. */
  onReport: () => void;
  /**
   * Fetch this module's codetabellen again from AFAS, past the backend's cache.
   * Resolves with a message for the row below and rejects with the backend's
   * refusal; the modal stays open either way.
   */
  onRefreshCodetabellen: () => Promise<string>;
  /**
   * The `afas_plaatsen` rows; absent on a module without unlisted woonplaatsen,
   * which hides them. `count` is how many places *Plaatsen toevoegen* would send.
   * Both actions resolve with a message for the row (or null for none) and reject
   * with the backend's refusal.
   */
  plaatsen?: {
    count: number;
    onAdd: () => Promise<string>;
    onDownload: () => Promise<string | null>;
  };
}) {
  const t = useT();
  const refresh = useToolAction(
    onRefreshCodetabellen,
    t("De codetabellen konden niet worden ververst.", "The code tables could not be refreshed.")
  );
  const addPlaatsen = useToolAction(
    plaatsen?.onAdd,
    t("De plaatsen konden niet worden toegevoegd.", "The places could not be added.")
  );
  const downloadPlaatsen = useToolAction(
    plaatsen?.onDownload,
    t("De plaatsenlijst kon niet worden gedownload.", "The list of places could not be downloaded.")
  );

  return (
    <Modal onDismiss={onCancel} className="max-w-md">
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <h2 className="text-lg font-semibold text-k-text-primary">{t("Instellingen", "Settings")}</h2>
        <ModalCloseButton onClose={onCancel} />
      </div>
      <div className="border-t border-k-divider px-3 py-3">
        <button
          type="button"
          disabled={!hasResult}
          onClick={() => {
            onCancel();
            onReport();
          }}
          className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-shadow duration-200 hover:shadow-inset-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-k-bg text-k-text-secondary shadow-inset-sm">
            <ClipboardList className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-k-text-primary">
              {t("Validatierapport", "Validation report")}
            </span>
            <span className="block truncate text-xs text-k-text-secondary">
              {hasResult
                ? t("Alle fouten gegroepeerd per kolom", "All errors grouped by column")
                : t("Nog geen controle uitgevoerd", "No check run yet")}
            </span>
          </span>
        </button>
        <AdminOnly>
          <ToolRow
            icon={RefreshCw}
            title={t("Codetabellen verversen", "Refresh code tables")}
            hint={t("Opnieuw ophalen uit AFAS, zonder cache", "Fetch again from AFAS, without cache")}
            busyHint={t("Bezig met ophalen uit AFAS…", "Fetching from AFAS…")}
            action={refresh}
          />
          {plaatsen && (
            <>
              <ToolRow
                icon={MapPinPlus}
                title={t("Plaatsen toevoegen", "Add places")}
                hint={
                  plaatsen.count === 0
                    ? t("Geen onbekende plaatsen met een geldig land", "No unknown places with a valid country")
                    : plaatsen.count === 1
                      ? t("1 onbekende plaats naar AFAS plaatsen", "1 unknown place to add to AFAS")
                      : t(
                          `${plaatsen.count} onbekende plaatsen naar AFAS plaatsen`,
                          `${plaatsen.count} unknown places to add to AFAS`
                        )
                }
                busyHint={t("Bezig met toevoegen…", "Adding…")}
                disabled={plaatsen.count === 0}
                action={addPlaatsen}
              />
              <ToolRow
                icon={Download}
                title={t("AFAS plaatsen downloaden", "Download AFAS places")}
                hint={t("De hele tabel als Data_Woonplaatsen.csv", "The whole table as Data_Woonplaatsen.csv")}
                busyHint={t("Bezig met downloaden…", "Downloading…")}
                action={downloadPlaatsen}
              />
            </>
          )}
        </AdminOnly>
      </div>
    </Modal>
  );
}

type ToolAction = {
  run: () => void;
  busy: boolean;
  done: string | null;
  error: string | null;
};

/** One tool row's call: busy while it runs, then its message or its refusal. */
function useToolAction(
  fn: (() => Promise<string | null>) | undefined,
  fallbackError: string
): ToolAction {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!fn) return;
    setBusy(true);
    setDone(null);
    setError(null);
    try {
      setDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, done, error };
}

/** An admin tool row under the validatierapport, with its outcome beneath it. */
function ToolRow({
  icon: Icon,
  title,
  hint,
  busyHint,
  disabled = false,
  action,
}: {
  icon: typeof RefreshCw;
  title: string;
  hint: string;
  busyHint: string;
  disabled?: boolean;
  action: ToolAction;
}) {
  return (
    <>
      <button
        type="button"
        disabled={disabled || action.busy}
        onClick={action.run}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-shadow duration-200 hover:shadow-inset-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-k-bg text-k-text-secondary shadow-inset-sm">
          {action.busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-k-text-primary">{title}</span>
          <span className="block truncate text-xs text-k-text-secondary">
            {action.busy ? busyHint : hint}
          </span>
        </span>
      </button>
      {action.done && (
        <div
          role="status"
          className="mx-3 mt-1 mb-1 flex items-start gap-2 rounded-xl bg-k-green-bg px-3 py-2 text-sm text-k-green-fg"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>{action.done}</span>
        </div>
      )}
      {action.error && (
        <p
          role="alert"
          className="mx-3 mt-1 mb-1 flex items-start gap-2 rounded-xl bg-k-red-bg px-3 py-2 text-sm text-k-red-fg"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{action.error}</span>
        </p>
      )}
    </>
  );
}
