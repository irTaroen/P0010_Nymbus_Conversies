/**
 * Per-project progress per module: how complete a module's sheet was at the **last
 * hand-off to Nymbus**, and when that was. The sidebar shows it next to the module,
 * so a client can see at a glance which parts of the conversion still need work.
 *
 * The percentage is the report's completeness figure — the share of rows AFAS could
 * take as they are, `SheetMetrics.completeness` from
 * [validation/metrics.ts](./validation/metrics.ts) — so the badge and the
 * validatierapport's percentage can never disagree. Rows, because that is the unit
 * the upload works in; how much of the *data* is right is the report's other
 * metric, and it deliberately stays there rather than in the badge.
 *
 * Everything here is read from AFAS — nothing in the browser sets it. A validation run
 * leaves it alone; [ProgressProvider](../components/ProgressProvider.tsx)'s `refresh()`
 * reads it again after an action has stamped new figures on the dossieritem. The full
 * {@link SheetMetrics} slot is kept for the field-level counts
 * (`checkedCells`/`errorCells`), but AFAS has nowhere to keep those, so in practice
 * `metrics` is `null` and a reader shows the percentage with AFAS's row-level error
 * count. Zero is a fact about a clean sheet; it is not what "not available here" means.
 *
 * This is **not** the module's state in AFAS. AFAS holds the deeltaak's workflow status
 * (Klant, Sjabloon gevuld, Niet akkoord, …) — where the module stands in the conversion,
 * which the sidebar leads with and which arrives with the module list
 * ([modules.tsx](./modules.tsx)). The percentage here answers what that workflow never
 * records: how clean the sheet was at the last hand-off.
 *
 * AFAS is the only store — the deeltaak dossieritem itself, via the hosted version's backend and its
 * `update_deeltaak_progress()` — keyed by the **app** module id (`hrm-medewerkers`) on
 * this side, resolved to the AFAS deeltaak on the backend, which is why two modules
 * sharing one deeltaak still keep their own figure (see docs/todo.md item 35). A module
 * never submitted simply has no entry.
 *
 * Two things write it. The hand-off does, as a side effect (`POST /api/upload`), and that
 * is the only road a client's figures take — which is why a stored row is normally a
 * statement about a sheet Nymbus actually received. An **admin** can also send the figures
 * of a check on their own, for a sheet that isn't being handed in at all
 * ([progress-payload.ts](./progress-payload.ts)); such a row is still one of ours, but it
 * describes a check rather than a delivery.
 *
 * The store is per project, not per user: the newest hand-off wins whoever sent it.
 */

import { requestJson } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { countText, errorCountText } from "@/lib/validation/metrics";
import type { MetricText, SheetMetrics } from "@/lib/validation/metrics";
import { tr } from "@/lib/i18n";

/** One refusal message from the last send, and how many sheet rows it refused. */
export type SendRefusal = { message: string; rows: number };

/**
 * The send behind a figure — set when the deeltaak's percentage is the outcome of the
 * last **send to AFAS** rather than of a validation run (`backend/send_progress.py`).
 * The percentage itself stays in `completeness`, as AFAS holds it: the share of the
 * sheet's rows that is in AFAS now. This is what lies behind it.
 */
export type ProgressSend = {
  stage: "test" | "live";
  /** How the environment names itself — `Balans - conversie — 38892 (test)`. */
  environment: string;
  /** How the run ended: `done`, or `stopped`/`failed` partway. */
  status: string;
  sentAt: string;
  sentBy: string;
  /** Rows the module's records cover — the percentage's denominator. */
  totalRows: number;
  inAfasRows: number;
  /** Rows AFAS refused in that run. */
  refusedRows: number;
  /** Rows held back because something they look up isn't in AFAS. */
  heldBackRows: number;
  /** AFAS's messages, most rows first. */
  refusals: SendRefusal[];
};

/** One module's last hand-off. */
export type ModuleProgress = {
  /** Catalog module id (`hrm-medewerkers`) — what the store is keyed by. */
  moduleId: string;
  /** 0–100: the share of rows without a blocking error at that hand-off. */
  completeness: number;
  /**
   * Every figure of the check that was submitted, as `sheetMetrics()` counted
   * them — or `null` when the stored row lacks the field-level counts, which AFAS
   * itself has nowhere to keep. `completeness` above
   * is always there and always equals `metrics.completeness` when both are set.
   */
  metrics: SheetMetrics | null;
  /**
   * **Rows** carrying at least one error at that check — AFAS's own `Fouten`, and
   * the only error count that survives a page load. It sits beside `metrics`
   * rather than inside it because it outlives it: `metrics` is all-or-nothing (a
   * field-level claim needs all four of its counts), while this one is stored and
   * comes back on every fetch. `null` only for a check recorded before AFAS kept
   * it. Always equals `metrics.errorRowCount` when both are set.
   */
  errorRowCount: number | null;
  /** When the hand-off happened, ISO 8601 UTC as the backend stamped it. */
  checkedAt: string;
  /** The file the figure came from, `""` when not known locally. */
  fileName: string;
  /** Who submitted it, `""` when the store has none. */
  submittedBy: string;
  /**
   * Set when this figure came from a send to AFAS — then `completeness` is the share
   * of rows in AFAS and `errorRowCount` the rows that didn't get in — and `null` for
   * a validation figure.
   */
  send: ProgressSend | null;
};

/**
 * A stored row as the backend returns it: the module's name rides along, and the
 * counts behind the percentage AFAS can't keep are always `null` — there is no
 * "recorded before they existed" here, every fetched row is like that.
 */
export type StoredProgress = Omit<ModuleProgress, "metrics" | "fileName" | "send"> & {
  send?: ProgressSend | null;
  moduleName: string;
  totalRows: number | null;
  errorRowCount: number | null;
  checkedCells: number | null;
  errorCells: number | null;
  fileName: string | null;
};

function progressPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/progress`;
}

/**
 * The stored counts back as a {@link SheetMetrics}, or `null` when the row doesn't
 * carry them (a check from before they were recorded). All four or none: they are
 * written by one save, so a row missing any of them isn't a half-known check — it is
 * an old one, and guessing the rest would put a made-up figure on the projectrapport.
 *
 * `importableRowCount` is recomputed rather than stored, exactly as `sheetMetrics()`
 * derives it: two fields that must agree are one field too many.
 */
function toMetrics(row: StoredProgress): SheetMetrics | null {
  const { totalRows, errorRowCount, checkedCells, errorCells } = row;
  if (
    totalRows === null ||
    errorRowCount === null ||
    checkedCells === null ||
    errorCells === null
  ) {
    return null;
  }
  return {
    totalRows,
    errorRowCount,
    importableRowCount: Math.max(0, totalRows - errorRowCount),
    completeness: row.completeness,
    checkedCells,
    errorCells,
  };
}

/** A stored row as a `ModuleProgress` — the same keys, minus the module's name. */
function toModuleProgress(row: StoredProgress): ModuleProgress {
  return {
    moduleId: row.moduleId,
    completeness: row.completeness,
    metrics: toMetrics(row),
    errorRowCount: row.errorRowCount,
    checkedAt: row.checkedAt,
    fileName: row.fileName ?? "",
    submittedBy: row.submittedBy ?? "",
    send: row.send ?? null,
  };
}

/**
 * The last hand-off per module for one project, keyed by module id. Modules never
 * submitted are simply absent. Throws an `ApiError` to show.
 */
export async function fetchProjectProgress(
  projectId: string
): Promise<Map<string, ModuleProgress>> {
  const data = await requestJson<{ progress: StoredProgress[] }>(
    progressPath(projectId),
    undefined,
    tr("De voortgang van dit project kon niet worden geladen.", "The progress of this project could not be loaded.")
  );
  return parseProjectProgress(data.progress ?? []);
}

/** Stored rows as the app holds them — shared with `/voortgang`'s own endpoint. */
export function parseProjectProgress(rows: StoredProgress[]): Map<string, ModuleProgress> {
  const byModule = new Map<string, ModuleProgress>();
  for (const row of rows) {
    const progress = toModuleProgress(row);
    byModule.set(progress.moduleId, progress);
  }
  return byModule;
}

/**
 * The dot's colour at a glance — the same four bands the badge's number already
 * falls into: grey for a module nobody has checked yet, red at half the rows clean
 * or fewer, amber short of a full sheet, green at 100%. One scale, so the sidebar's
 * dot and the projectrapport's row dot can never disagree about the same module.
 */
export type CompletenessTone = "unchecked" | "poor" | "partial" | "clean";

export function completenessTone(
  progress: ModuleProgress | null | undefined
): CompletenessTone {
  if (!progress) return "unchecked";
  if (progress.completeness >= 100) return "clean";
  if (progress.completeness > 50) return "partial";
  return "poor";
}

/** The fill for each tone — shared by every dot that reads it, so the scale stays one. */
export const COMPLETENESS_TONE_FILL: Record<CompletenessTone, string> = {
  unchecked: "bg-k-text-tertiary",
  poor: "bg-k-red-fg",
  partial: "bg-k-amber-fg",
  clean: "bg-k-green-fg",
};

/**
 * A stored timestamp as the tooltip shows it, e.g. `30-07-2026 15:41` in local time —
 * the client checked their sheet at a wall-clock moment, not at a UTC one. Anything
 * unparseable is handed back as-is rather than rendered as "Invalid Date".
 *
 * The notation is [datetime.ts](./datetime.ts)'s, which the PDF's *Gegenereerd* line
 * also prints: one moment, one format, wherever it is shown.
 */
export function formatCheckedAt(checkedAt: string): string {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return checkedAt;
  return formatDateTime(date);
}

/**
 * The error count to show for a stored check, and which unit it is in — the one
 * decision every surface printing **Fouten** has to make, made once here.
 *
 * A check counted in this session carries the sharper figure, the **fields** that
 * were wrong ({@link SheetMetrics.errorCells}); after a reload only AFAS's own
 * `Fouten` survives, which counts **rows**. Both are real counts of the same check,
 * so neither may be dressed as the other: callers word `unit: "rows"` differently
 * (*3 rijen met fouten*) from `unit: "fields"` (*3 fouten*). `null` only when the
 * check predates AFAS keeping any count — the genuine *Niet geteld*.
 *
 * Why the fallback exists at all: the row count **is** stored and does come back on
 * every fetch, and the report used to read `metrics.errorCells` alone — printing
 * *Niet geteld* over a figure AFAS was holding for every module after a reload.
 */
export function storedErrorCount(
  progress: ModuleProgress
): { count: number; unit: "fields" | "rows" | "refused" } | null {
  // After a send, `Fouten` holds the rows that didn't get into AFAS — a different
  // claim from a check's error rows, so it carries its own unit and wording.
  if (progress.send) {
    return { count: progress.send.refusedRows + progress.send.heldBackRows, unit: "refused" };
  }
  const errorCells = progress.metrics?.errorCells ?? null;
  if (errorCells !== null) return { count: errorCells, unit: "fields" };
  if (progress.errorRowCount !== null) {
    return { count: progress.errorRowCount, unit: "rows" };
  }
  return null;
}

/** *3 fouten* / *3 rijen met fouten* — one stored count with the unit it is in. */
export function storedErrorText(
  found: { count: number; unit: "fields" | "rows" | "refused" }
): string {
  if (found.unit === "refused") {
    return countText(found.count, tr("rij geweigerd", "row refused"), tr("rijen geweigerd", "rows refused"));
  }
  return found.unit === "rows"
    ? countText(found.count, tr("rij met fouten", "row with errors"), tr("rijen met fouten", "rows with errors"))
    : errorCountText(found.count);
}

/**
 * A stored check as the same three lines a live figure is printed with
 * ({@link MetricText} in [validation/metrics.ts](./validation/metrics.ts)), so one
 * renderer shows both: the sheet toolbar leads with these numbers before a file is
 * loaded and with `rowMetricText()`'s the moment one is.
 *
 * Past tense on purpose — *kon*, not *kan*. This is what the last check found, not
 * what is on screen, and the detail line names the moment and the file it came from
 * so the figure can't be mistaken for the current sheet's. Only the row percentage
 * exists here; the field figures aren't stored (see the note at the top).
 */
export function progressMetricText(progress: ModuleProgress): MetricText {
  if (progress.send) {
    const { send } = progress;
    const detail = [tr(`verstuurd ${formatCheckedAt(send.sentAt)}`, `sent ${formatCheckedAt(send.sentAt)}`)];
    const failed = send.refusedRows + send.heldBackRows;
    detail.push(failed === 0 ? tr("niets geweigerd", "nothing refused") : storedErrorText({ count: failed, unit: "refused" }));
    return {
      figure: `${progress.completeness}%`,
      caption: tr(`van de rijen staat in AFAS (${sendStageLabel(send)})`, `of the rows are in AFAS (${sendStageLabel(send)})`),
      detail: detail.join(" · "),
    };
  }
  const detail = [tr(`laatste controle ${formatCheckedAt(progress.checkedAt)}`, `last check ${formatCheckedAt(progress.checkedAt)}`)];
  if (progress.fileName) detail.push(progress.fileName);
  return {
    figure: `${progress.completeness}%`,
    caption: tr("van de rijen kon zo naar AFAS", "of the rows could go to AFAS as they are"),
    detail: detail.join(" · "),
  };
}

/** `Test` / `Live` — the environment a send went to, as the switch names it. */
export function sendStageLabel(send: ProgressSend): string {
  return send.stage === "live" ? "Live" : "Test";
}

/**
 * What a stored percentage measures, in the words the reports print after it:
 * *gevalideerd* for a check (the share of rows that could go to AFAS), *in Test* /
 * *in Live* for a send (the share that is in that environment now). Never the bare
 * number — *100%* alone read as "finished" for a sheet that was only clean.
 */
export function progressFigureLabel(progress: ModuleProgress): string {
  return progress.send ? `in ${sendStageLabel(progress.send)}` : tr("gevalideerd", "validated");
}

/**
 * What a figure is, in words — the badge's tooltip and every report's hover title:
 * *94% van de rijen staat in AFAS (Live) · 12 rijen geweigerd · verstuurd 18-10-2026
 * 14:02* for a send, *87% van de rijen zonder fouten · laatste controle …* for a check.
 */
export function progressSummary(progress: ModuleProgress): string {
  const { send } = progress;
  if (!send) {
    const parts = [tr(`${progress.completeness}% van de rijen zonder fouten`, `${progress.completeness}% of the rows without errors`)];
    if (progress.checkedAt) parts.push(tr(`laatste controle ${formatCheckedAt(progress.checkedAt)}`, `last check ${formatCheckedAt(progress.checkedAt)}`));
    if (progress.fileName) parts.push(progress.fileName);
    return parts.join(" · ");
  }
  const parts = [
    tr(
      `${progress.completeness}% van de rijen staat in AFAS (${sendStageLabel(send)})`,
      `${progress.completeness}% of the rows are in AFAS (${sendStageLabel(send)})`,
    ),
    tr(`${send.inAfasRows} van ${send.totalRows} rijen`, `${send.inAfasRows} of ${send.totalRows} rows`),
  ];
  if (send.refusedRows > 0) parts.push(storedErrorText({ count: send.refusedRows, unit: "refused" }));
  if (send.heldBackRows > 0) {
    parts.push(countText(send.heldBackRows, tr("rij tegengehouden", "row held back"), tr("rijen tegengehouden", "rows held back")));
  }
  if (send.status === "stopped") parts.push(tr("verzending gestopt", "send stopped"));
  if (send.status === "failed") parts.push(tr("verzending afgebroken", "send aborted"));
  parts.push(tr(`verstuurd ${formatCheckedAt(send.sentAt)}`, `sent ${formatCheckedAt(send.sentAt)}`));
  if (send.sentBy) parts.push(tr(`door ${send.sentBy}`, `by ${send.sentBy}`));
  return parts.join(" · ");
}
