"use client";

import { sendRefusalLines, type ProjectReport } from "@/lib/project-report";
import { countText } from "@/lib/validation/metrics";
import { useT } from "@/lib/i18n";

/**
 * *Geweigerd door AFAS*: for every module whose last send left rows out, AFAS's own
 * reasons with how many rows each refused — the part of a send the percentage can't
 * say. Absent when no send refused anything, like the third tile.
 *
 * A card of its own by default (the managementrapport's place for it); the
 * projectrapport folds it open under its header instead and passes its own frame.
 */
export default function SendRefusals({
  report,
  id,
  className = "mt-4 rounded-2xl bg-k-bg px-4 py-3 shadow-raised",
}: {
  report: ProjectReport;
  id?: string;
  className?: string;
}) {
  const t = useT();
  const lines = sendRefusalLines(report);
  if (lines.length === 0) return null;
  return (
    <div id={id} className={className}>
      <h3 className="text-sm font-semibold text-k-text-primary">{t("Geweigerd door AFAS", "Refused by AFAS")}</h3>
      <ul className="mt-2 space-y-3">
        {lines.map((line) => (
          <li key={line.moduleId}>
            <p className="text-xs text-k-text-secondary">
              <span className="font-semibold text-k-text-primary">{line.label}</span>
              {" · "}
              {countText(line.failedRows, "rij", "rijen", "row", "rows")}{" "}
              {t("niet in AFAS", "not in AFAS")} ({line.stage}) · {t("verstuurd", "sent")}{" "}
              {line.sentAt}
            </p>
            <ul className="mt-1 space-y-0.5">
              {line.refusals.map((refusal) => (
                <li key={refusal.message} className="flex gap-2 text-xs text-k-text-secondary">
                  <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-k-red-fg">
                    {countText(refusal.rows, "rij", "rijen", "row", "rows")}
                  </span>
                  <span className="min-w-0">{refusal.message}</span>
                </li>
              ))}
              {line.heldBackRows > 0 && (
                <li className="flex gap-2 text-xs text-k-text-secondary">
                  <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-k-red-fg">
                    {countText(line.heldBackRows, "rij", "rijen", "row", "rows")}
                  </span>
                  <span className="min-w-0">
                    {t(
                      "Tegengehouden: iets wat deze rijen opzoeken bestaat nog niet in AFAS.",
                      "Held back: something these rows look up does not yet exist in AFAS."
                    )}
                  </span>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
