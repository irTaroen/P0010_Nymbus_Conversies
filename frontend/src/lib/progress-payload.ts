/**
 * Sending a module's figures to AFAS **on their own**, without handing a sheet in
 * or sending a record.
 *
 * The figures say **how much of the sheet is in AFAS**: of the rows the module's
 * records cover, how many AFAS already holds in the stage on screen (the payload
 * view's *Bestaat al* marks), and how many are still to send — the same count a
 * send stamps once its run ends (`send_progress.outcome()` in the backend), taken
 * without sending anything. It is the admin-only button in the payload view's
 * header, for a module whose records went in some other way (a send from another
 * session, an import by hand) and whose badge still describes an older state.
 * It writes the same `KnS51` vrije velden the hand-off writes and nothing else: no
 * reaction, no attachment, no workflow action, so the deeltaak's task stays put.
 * The backend keeps it as a send's figure, so the sidebar badge leads with the
 * same `CloudUpload` a send's does.
 *
 * Snake_case keys, like [upload-payload.ts](./upload-payload.ts): `ProgressUpdateRequest`
 * in `backend/main.py` is typed against this.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { percentageOf } from "@/lib/validation/metrics";

/** The request body `POST /api/progress` takes. */
export interface ProgressUpdateRequest {
  project_id: string;
  /** The module's **app** id (`hrm-medewerkers`); the backend resolves the deeltaak. */
  module_id: string;
  /** The environment whose *Bestaat al* marks `inAfasRows` counts. */
  stage: "test" | "live";
  completeness: number;
  total_rows: number;
  error_row_count: number;
}

/** What the backend answers with once AFAS holds the figures. */
export interface ProgressUpdateResult {
  stored: boolean;
  message: string;
  moduleId: string;
  moduleName: string;
  deeltaakcode: string;
  dossierItemId: string;
  completeness: number;
  /** When it was stamped, as the backend wrote it into `Laatste_controle`. */
  checkedAt: string;
  /** The admin who sent it — AFAS's `Aangeleverd_door` for this figure. */
  submittedBy: string;
  logReference: string | null;
}

/**
 * The three counts AFAS keeps, out of the payload view's coverage: `Voortgang` the
 * share of the sheet's rows AFAS holds, `Fouten` the rows it doesn't hold yet —
 * the same reading a send's stamp gives, so a figure pushed from here and one a run
 * left can't disagree about the same environment. `sheetRows` must not be empty:
 * there is nothing to describe, and `percentageOf` would call it 100%.
 */
export function buildProgressUpdate({
  projectId,
  moduleId,
  stage,
  sheetRows,
  inAfasRows,
}: {
  projectId: string;
  moduleId: string;
  stage: "test" | "live";
  /** Every sheet row the module's records cover. */
  sheetRows: number;
  /** Of those, the rows AFAS already holds in the stage on screen. */
  inAfasRows: number;
}): ProgressUpdateRequest {
  return {
    project_id: projectId,
    module_id: moduleId,
    stage,
    completeness: percentageOf(inAfasRows, sheetRows),
    total_rows: sheetRows,
    error_row_count: sheetRows - inAfasRows,
  };
}

/**
 * Stamp the module's deeltaak in AFAS with these figures. Rejects with the
 * backend's own message — a non-admin session (403) or AFAS refusing the write
 * are both worth reading as they came.
 */
export async function pushProgressToAfas(
  request: ProgressUpdateRequest
): Promise<ProgressUpdateResult> {
  return requestJson<ProgressUpdateResult>(
    "/api/progress",
    jsonBody("POST", request),
    "De voortgang kon niet naar AFAS worden gestuurd."
  );
}

/**
 * Stamp a module with the figures of the sheet just validated in the uploader —
 * what the sidebar badge and the voortgang show until the next validation or send.
 * Replaces whatever figure the last send left (`POST
 * /api/projects/{id}/modules/{module}/validation`).
 */
export async function stampValidation({
  projectId,
  moduleId,
  metrics,
  fileName,
}: {
  projectId: string;
  moduleId: string;
  metrics: {
    completeness: number;
    totalRows: number;
    errorRowCount: number;
    checkedCells: number;
    errorCells: number;
  };
  fileName: string;
}): Promise<void> {
  await requestJson<{ stored: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(moduleId)}/validation`,
    jsonBody("POST", {
      completeness: metrics.completeness,
      total_rows: metrics.totalRows,
      error_row_count: metrics.errorRowCount,
      checked_cells: metrics.checkedCells,
      error_cells: metrics.errorCells,
      file_name: fileName,
    }),
    tr("De voortgang kon niet worden vastgelegd.", "The progress could not be recorded.")
  );
}
