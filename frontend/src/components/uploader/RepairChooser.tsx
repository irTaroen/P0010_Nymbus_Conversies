"use client";

import { Wrench } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  ACTION_LABELS,
  actionOf,
  repairBlockedBy,
  type ObjectAction,
  type RepairObject,
  type RepairPlan,
} from "@/lib/repair-send";

/** In the order the switch shows them: doing nothing first, the default. */
const ACTIONS: ObjectAction[] = ["skip", "update", "insert"];

/**
 * The *Herstellen* card: per object of the body, what a re-send does with it —
 * leave it out, update the one AFAS holds, or add one beside it
 * ([`repair-send.ts`](../../lib/repair-send.ts)).
 *
 * Above the body rather than in a dialog, because the body is the answer to the
 * choice: every switch rebuilds it, and the admin reads the `@Action` lines change
 * beside the objects they just set. The root is not a row — it is always updated,
 * since a repair only exists for records AFAS already holds.
 */
export default function RepairChooser({
  objects,
  plan,
  onChange,
  disabled,
}: {
  objects: RepairObject[];
  plan: RepairPlan;
  onChange: (next: RepairPlan) => void;
  /** While a run is going: its bodies must not change under it. */
  disabled: boolean;
}) {
  const t = useT();
  const set = (path: string, action: ObjectAction) =>
    onChange({ actions: { ...plan.actions, [path]: action } });

  return (
    <div className="shrink-0 rounded-2xl bg-k-bg px-3 py-2.5 shadow-raised">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-k-text-secondary">
        <Wrench className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        {t("Herstellen", "Repair")}
      </p>
      <p className="mt-1 text-xs text-k-text-secondary">
        {t(
          "Het hoofdrecord wordt bijgewerkt. Kies per onderdeel wat er gebeurt; lege velden worden niet meegestuurd, dus niets wordt in AFAS leeggemaakt.",
          "The main record is updated. Choose per part what happens; empty fields are not sent along, so nothing is cleared in AFAS."
        )}
      </p>
      {objects.length === 0 ? (
        <p className="mt-2 text-xs text-k-text-secondary">
          {t("Deze koppeling vult geen onderdelen onder het hoofdrecord.", "This link fills no parts under the main record.")}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {objects.map((row) => {
            const blockedBy = repairBlockedBy(plan, row.path);
            const current = actionOf(plan, row.path);
            return (
              <li
                key={row.path}
                className="flex items-center justify-between gap-3"
                style={{ paddingLeft: `${row.depth * 16}px` }}
              >
                <span
                  className={`truncate font-mono text-xs ${
                    blockedBy ? "text-k-text-tertiary" : "text-k-text-primary"
                  }`}
                  title={
                    blockedBy
                      ? t(
                          `${row.path} — gaat alleen mee als ${blockedBy.split(".").pop()} meegaat`,
                          `${row.path} — only goes along if ${blockedBy.split(".").pop()} goes along`
                        )
                      : row.path
                  }
                >
                  {row.name}
                </span>
                <span
                  role="group"
                  aria-label={t(`Actie voor ${row.name}`, `Action for ${row.name}`)}
                  className="flex h-8 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm"
                >
                  {ACTIONS.map((action) => {
                    const on = current === action;
                    return (
                      <button
                        key={action}
                        type="button"
                        onClick={() => set(row.path, action)}
                        aria-pressed={on}
                        disabled={disabled || blockedBy !== null}
                        className={`flex h-7 items-center rounded-full px-2.5 text-xs font-semibold transition-[box-shadow,color] duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                          on
                            ? "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                            : "cursor-pointer text-k-text-tertiary hover:text-k-text-primary"
                        }`}
                      >
                        {ACTION_LABELS[action]}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
