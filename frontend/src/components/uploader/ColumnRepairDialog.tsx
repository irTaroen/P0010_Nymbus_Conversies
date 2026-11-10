"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import Checkbox from "@/components/Checkbox";
import Modal, { ModalButton, ModalCloseButton } from "@/components/Modal";
import { useT } from "@/lib/i18n";
import {
  suggestRename,
  unclaimedColumns,
  type ColumnRepair,
} from "@/lib/column-repair";

/** The §10.2 input recipe — inset at rest, the cloud-blue ring on focus (`neu-input`). */
const INPUT = "neu-input w-full rounded-full px-4 py-2 text-sm";

/** A dropdown with a column chosen — the cloud-blue text, so an answered row stands out. */
const INPUT_CHOSEN = "neu-input w-full rounded-full px-4 py-2 text-sm font-medium text-k-cloud-deep";

/** What one missing column is to become: nothing yet, added, ignored, or renamed. */
type Choice =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "ignore" }
  | { kind: "rename"; from: number };

/**
 * Modal: an admin repairs the sheet's columns — the answer to the missing-column
 * banner, see [`lib/column-repair.ts`](../../lib/column-repair.ts).
 *
 * One row per missing column, three ways to answer it, of which one at most holds —
 * ticking one clears the others:
 *
 * - **Toevoegen** — a new, empty column at the end of the sheet.
 * - **Negeren** — the column stays absent, and the banner and the report stop
 *   naming it for this upload. Its checks are still skipped; this only says the
 *   absence is known and fine (a person-only column on an organisations sheet).
 * - **a sheet column from the dropdown** — that column is renamed to this name.
 *   Only columns no rule reads are offered, a likely one is preselected (`Naam` for
 *   `Organisatie Naam`), and one taken by another row is greyed out: two expected
 *   names cannot both be the same column.
 *
 * Nothing happens until *Toepassen* — the preselected rename included, because a
 * likeness is not proof and the admin is the one who can see what `Naam` holds.
 */
export default function ColumnRepairDialog({
  moduleId,
  headers,
  missing,
  onApply,
  onClose,
}: {
  moduleId: string;
  /** The sheet's headers as they stand. */
  headers: string[];
  /** The rule set's names the sheet lacks and nobody has ignored yet. */
  missing: string[];
  onApply: (repairs: ColumnRepair[], ignored: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const candidates = useMemo(() => unclaimedColumns(moduleId, headers), [moduleId, headers]);

  const [choices, setChoices] = useState<Choice[]>(() => {
    const taken = new Set<number>();
    return missing.map((column) => {
      const free = candidates.filter((i) => !taken.has(i));
      const from = suggestRename(column, headers, free);
      if (from === null) return { kind: "none" };
      taken.add(from);
      return { kind: "rename", from };
    });
  });

  const suggestions = useMemo(
    () => missing.map((column) => suggestRename(column, headers, candidates)),
    [missing, headers, candidates]
  );

  function choose(i: number, choice: Choice) {
    setChoices((prev) => prev.map((c, j) => (j === i ? choice : c)));
  }

  const repairs: ColumnRepair[] = choices.flatMap((choice, i): ColumnRepair[] => {
    const column = missing[i];
    if (choice.kind === "add") return [{ kind: "add", column }];
    if (choice.kind === "rename") return [{ kind: "rename", column, from: choice.from }];
    return [];
  });
  const ignored = missing.filter((_, i) => choices[i].kind === "ignore");
  const answered = repairs.length + ignored.length;

  const renamedFrom = (except: number) =>
    new Set(
      choices.flatMap((c, i) => (i !== except && c.kind === "rename" ? [c.from] : []))
    );

  return (
    <Modal onDismiss={onClose} className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-k-text-primary">{t("Kolommen herstellen", "Repair columns")}</h2>
          <p className="mt-1 text-sm text-k-text-secondary">
            {t(
              "Voeg een kolom toe, negeer hem, of kies een bestaande kolom die deze naam krijgt. Dit geldt alleen voor dit bestand: de aanpassing komt in de Excel die je opslaat, zodat de klant daarin verder kan.",
              "Add a column, ignore it, or pick an existing column to take this name. This applies to this file only: the change goes into the Excel you save, so the client can carry on with it.",
            )}
          </p>
        </div>
        <ModalCloseButton onClose={onClose} />
      </div>

      <ul className="max-h-[60vh] divide-y divide-k-divider overflow-y-auto border-t border-k-divider">
        {missing.map((column, i) => {
          const choice = choices[i];
          const taken = renamedFrom(i);
          return (
            <li
              key={column}
              className="grid items-center gap-3 px-6 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-5"
            >
              <p className="truncate text-sm font-semibold text-k-text-primary" title={column}>
                {column}
              </p>
              <div className="flex items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-k-text-primary">
                  <Checkbox
                    checked={choice.kind === "add"}
                    onChange={(on) => choose(i, on ? { kind: "add" } : { kind: "none" })}
                  />
                  {t("Toevoegen", "Add")}
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-k-text-primary">
                  <Checkbox
                    checked={choice.kind === "ignore"}
                    onChange={(on) => choose(i, on ? { kind: "ignore" } : { kind: "none" })}
                  />
                  {t("Negeren", "Ignore")}
                </label>
              </div>
              <div className="relative">
                <select
                  aria-label={t(`Bestaande kolom voor ${column}`, `Existing column for ${column}`)}
                  value={choice.kind === "rename" ? String(choice.from) : ""}
                  onChange={(e) =>
                    choose(
                      i,
                      e.target.value === ""
                        ? { kind: "none" }
                        : { kind: "rename", from: Number(e.target.value) }
                    )
                  }
                  disabled={candidates.length === 0}
                  className={`${choice.kind === "rename" ? INPUT_CHOSEN : INPUT} cursor-pointer`}
                >
                  <option value="">
                    {candidates.length === 0 ? t("Geen vrije kolommen", "No free columns") : t("Bestaande kolom…", "Existing column…")}
                  </option>
                  {candidates.map((idx) => (
                    <option key={idx} value={idx} disabled={taken.has(idx)}>
                      {headers[idx]}
                      {suggestions[i] === idx ? t(" (voorgesteld)", " (suggested)") : ""}
                    </option>
                  ))}
                </select>
                {suggestions[i] !== null && (
                  <span
                    title={t(`Voorgesteld: ${headers[suggestions[i]!]}`, `Suggested: ${headers[suggestions[i]!]}`)}
                    className="pointer-events-auto absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-k-bg text-k-cloud-deep shadow-raised-sm"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    <span className="sr-only">
                      {t("Voorgesteld: ", "Suggested: ")}
                      {headers[suggestions[i]!]}
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-4 border-t border-k-divider px-6 py-4">
        <p className="text-xs text-k-text-secondary tabular-nums">
          {t(
            `${answered} van ${missing.length} kolom(men) gekozen`,
            `${answered} of ${missing.length} column(s) chosen`,
          )}
        </p>
        <ModalButton
          tone="primary"
          disabled={answered === 0}
          onClick={() => onApply(repairs, ignored)}
        >
          {t("Toepassen", "Apply")}
        </ModalButton>
      </div>
    </Modal>
  );
}
