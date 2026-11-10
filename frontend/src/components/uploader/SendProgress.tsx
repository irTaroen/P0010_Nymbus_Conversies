"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Square,
  X,
} from "lucide-react";
import { isDeleteRun, type SendOutcome } from "@/lib/payload-send";

/**
 * How far a send has got — the strip that stands where the send button was while
 * records are going to AFAS.
 *
 * ### Why a real bar and not a spinner
 *
 * A send is one sequential AFAS call per record, so a few hundred records is
 * minutes. A spinner over that says only "something is happening", which is the one
 * thing the person pressing it already knows; what they cannot tell without this is
 * whether it is nearly done, whether AFAS has started refusing everything, and
 * whether it is safe to go and do something else. All three are in the numbers here.
 *
 * ### Two segments, filled against the total
 *
 * The meter is the design system's stacked one (design-system.md §14) — green for
 * accepted, red for refused — but the widths are shares of **`total`**, not of the
 * records answered so far. A bar scaled to what has come back would sit at 100% from
 * the first record and only change colour, which is a progress bar that never
 * progresses; scaled to the total, the filled part *is* how far along the run is and
 * the empty track to its right is what is left.
 *
 * Refusals are shown the moment they happen rather than saved for the end. A run
 * where AFAS rejects everything looks identical to a healthy one for its whole
 * length otherwise, and the difference is worth minutes to somebody watching.
 *
 * The record-by-record reasons are **not** here: those stay in the notice carousel
 * above the payload list, on the refused row's own body, and in the verzendrapport
 * this strip offers once the run has settled. This strip is the glance.
 */
export default function SendProgress({
  run,
  onDismiss,
  onReport,
  reporting = false,
  onMarkedSheet,
  markingSheet = false,
}: {
  run: SendOutcome;
  /** Downloads the verzendrapport (PDF). Offered once the run has settled — a
   *  report of a run still going would be out of date before it opened. */
  onReport?: () => void;
  reporting?: boolean;
  /** Downloads the uploaded sheet with the refused cells marked red. Only passed
   *  when something was refused. */
  onMarkedSheet?: () => void;
  markingSheet?: boolean;
  /** Clears a finished run from the panel. Absent while one is still going — a run
   *  in progress is not something the screen may be asked to forget. */
  onDismiss?: () => void;
}) {
  const running = run.status === "running";
  const total = Math.max(run.total, 1);
  const okPct = (run.sent / total) * 100;
  const failPct = (run.failed / total) * 100;
  const stage = run.stage === "live" ? "live" : "test";
  // A delete run reads through the same strip in its own verb — *verwijderd uit*,
  // never *verstuurd naar*, since the latter would tell an admin the records went in.
  const removing = isDeleteRun(run);
  const done = removing ? "verwijderd" : "verstuurd";
  const toward = removing ? "uit" : "naar";
  // Ticked but held back before the send — something they look up isn't in AFAS.
  const missing = run.skippedMissing?.length ?? 0;

  return (
    <div
      className="w-full rounded-xl bg-k-bg px-3 py-2.5 shadow-inset-sm"
      // The whole strip announces itself as one status, and politely: a send is
      // minutes long and a bar that interrupted a screen reader every two seconds
      // would make the app unusable while one runs.
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {running ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-k-cloud-deep"
            strokeWidth={1.8}
          />
        ) : run.status === "failed" ? (
          // The run itself stopped — the only case where nothing further was even
          // attempted, and the one that gets the plain refusal mark.
          <X className="h-4 w-4 shrink-0 text-k-red-fg" strokeWidth={2.2} />
        ) : run.status === "stopped" ? (
          // Stopped on request — nothing went wrong, the rest was just not sent.
          <Square className="h-4 w-4 shrink-0 text-k-text-secondary" strokeWidth={1.8} />
        ) : run.failed > 0 || missing > 0 ? (
          // A finished run that AFAS refused part of. Amber rather than red: 240 of
          // 265 records did land, and a red cross over that reads as a send that
          // failed — the numbers beside it say which part didn't, and the notice
          // above the payload list says why per record.
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-k-amber-fg"
            strokeWidth={1.8}
          />
        ) : (
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-k-green-fg"
            strokeWidth={1.8}
          />
        )}

        {/* The sentence, in the tense the run is in. While it runs the count leads,
            because that is the thing that changes; once it is done the verdict does,
            because the count has stopped meaning anything on its own. */}
        <span className="min-w-0 flex-1 truncate text-sm text-k-text-primary">
          {running ? (
            <>
              <span className="font-semibold tabular-nums">
                {run.done} van {run.total}
              </span>{" "}
              {done} {toward} {stage}
              {run.stopRequested && " · stoppen na dit record"}
              {run.failed > 0 && (
                <span className="text-k-red-fg">
                  {" "}
                  · <span className="tabular-nums">{run.failed}</span> geweigerd
                </span>
              )}
            </>
          ) : run.status === "failed" ? (
            <>
              <span className="font-semibold">
                {removing ? "Verwijderen afgebroken" : "Verzending afgebroken"}
              </span>
              {run.done > 0 && (
                <>
                  {" "}
                  na{" "}
                  <span className="tabular-nums">
                    {run.done} van {run.total}
                  </span>
                </>
              )}
              {run.error ? ` — ${run.error}` : ""}
            </>
          ) : run.status === "stopped" ? (
            <>
              <span className="font-semibold">Gestopt</span> na{" "}
              <span className="tabular-nums">
                {run.done} van {run.total}
              </span>
              {" — "}
              <span className="tabular-nums">{run.sent}</span> {done} {toward}{" "}
              {run.environment}
              {run.failed > 0 && (
                <span className="text-k-red-fg">
                  , <span className="tabular-nums">{run.failed}</span> geweigerd
                </span>
              )}
            </>
          ) : run.failed === 0 && missing === 0 ? (
            <>
              <span className="font-semibold tabular-nums">{run.sent}</span>{" "}
              {run.sent === 1 ? "record" : "records"} {done} {toward}{" "}
              {run.environment}
            </>
          ) : (
            <>
              <span className="font-semibold tabular-nums">{run.sent}</span> {done}
              {run.failed > 0 && (
                <>
                  ,{" "}
                  <span className="font-semibold tabular-nums text-k-red-fg">
                    {run.failed}
                  </span>{" "}
                  geweigerd
                </>
              )}
              {missing > 0 && (
                <>
                  ,{" "}
                  <span className="font-semibold tabular-nums text-k-red-fg">
                    {missing}
                  </span>{" "}
                  niet verstuurd
                </>
              )}{" "}
              in {run.environment}
            </>
          )}
        </span>

        {/* Leaving is the point of the whole change, so it is said rather than
            implied — but only while it is true. */}
        {running && (
          <span className="hidden shrink-0 text-xs text-k-text-secondary sm:inline">
            Je kunt ondertussen doorwerken
          </span>
        )}

        {!running && onReport && (
          <button
            type="button"
            onClick={onReport}
            disabled={reporting}
            title="Verzendrapport downloaden als PDF — alle records, met de melding van AFAS bij elke weigering"
            className="neu-button inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
          >
            {reporting ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            )}
            Rapport
          </button>
        )}

        {!running && onMarkedSheet && (
          <button
            type="button"
            onClick={onMarkedSheet}
            disabled={markingSheet}
            title="Excel downloaden met de geweigerde cellen rood gemarkeerd — oude markeringen worden eerst gewist"
            className="neu-button inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
          >
            {markingSheet ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.8} />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            )}
            Excel
          </button>
        )}

        {!running && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Deze verzending verbergen"
            className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* The meter. `aria-hidden` because the sentence above already carries every
          number in it — the design system's rule that a meter is never read by
          colour alone, met by not making the meter the thing that is read. */}
      <div
        aria-hidden
        className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-k-bg shadow-inset-sm"
      >
        {run.sent > 0 && (
          <div
            style={{ width: `${okPct}%` }}
            className="h-full rounded-full bg-k-green-fg transition-[width] duration-300"
          />
        )}
        {run.failed > 0 && (
          <div
            style={{ width: `${failPct}%` }}
            className="h-full rounded-full bg-k-red-fg transition-[width] duration-300"
          />
        )}
      </div>
    </div>
  );
}
