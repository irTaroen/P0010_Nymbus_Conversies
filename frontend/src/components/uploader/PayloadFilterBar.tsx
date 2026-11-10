"use client";

import { Filter, Plus, Search, X } from "lucide-react";
import { isActive, type PayloadFilter } from "@/lib/payload-filter";
import type { PayloadField } from "@/lib/module-payloads";

/**
 * *Filter* — the conditions that decide which records are on screen, and therefore
 * which ones a send carries.
 *
 * ### Where it sits, and why
 *
 * Above the two columns, spanning both: it narrows the record list on the left, but
 * saying so from inside that 288px column would mean a field picker and a search box
 * stacked in a rail that has room for neither. It is also not a thing to hide behind
 * a popover — the panel's other view-wide control (*Bestaande records*) is a card in
 * exactly this position, and for the same reason: a filter that is on while its
 * controls are folded away is a send whose size has an invisible cause.
 *
 * ### One row per condition
 *
 * A row is a field and a text, and the **+** adds another. Rows are ANDed, which is
 * what an admin means by adding one ("debiteuren in Amsterdam *and* over 1000"), and
 * what makes each row readable on its own — an OR would need brackets on screen the
 * moment there were three of them.
 *
 * The field picker names a field twice over, `Debiteurnummer (DbId)`: the label is
 * how an admin knows which field they want, the code is how they check it against the
 * body rendered on the right, where AFAS's own `"DbId"` is what is written. Sorted by
 * label rather than left in schema order, because a picker is read by looking for a
 * word, and schema order is the connector's business, not the reader's.
 */
export default function PayloadFilterBar({
  filters,
  fields,
  matched,
  total,
  onChange,
  onAdd,
  onRemove,
  onClear,
}: {
  filters: PayloadFilter[];
  /** Every field these payloads carry — the picker's options. */
  fields: PayloadField[];
  /** How many records survive, and out of how many — the bar's own answer. */
  matched: number;
  total: number;
  onChange: (id: string, patch: Partial<PayloadFilter>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const active = filters.filter(isActive).length;
  // By label, with the code as tie-break so two fields sharing a label (it happens —
  // AFAS reuses "Omschrijving") keep a stable order rather than swapping on rerender.
  const options = [...fields].sort(
    (a, b) => a.label.localeCompare(b.label, "nl") || a.fieldId.localeCompare(b.fieldId)
  );

  return (
    <div className="shrink-0 rounded-2xl bg-k-bg px-3 py-2.5 shadow-raised">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-k-text-secondary">
          <Filter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Filter
        </span>
        {/* What the conditions did, in the panel's own house style — the same
            "<n> van <m>" sentence the record list's header uses, so the two read as
            one count rather than as two figures to reconcile. */}
        {active > 0 ? (
          <span className="text-sm text-k-text-primary">
            <span className="font-semibold tabular-nums">{matched}</span> van{" "}
            <span className="tabular-nums">{total}</span>{" "}
            {total === 1 ? "record" : "records"} voldoet aan{" "}
            <span className="tabular-nums">{active}</span>{" "}
            {active === 1 ? "voorwaarde" : "voorwaarden"}
          </span>
        ) : (
          <span className="text-sm text-k-text-secondary">
            Alle <span className="tabular-nums">{total}</span>{" "}
            {total === 1 ? "record" : "records"} — kies een veld om te filteren
          </span>
        )}
        {active > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="neu-button ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium"
          >
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Filter wissen
          </button>
        )}
      </div>

      <div className="mt-2 space-y-1.5">
        {filters.map((filter, index) => (
          <div key={filter.id} className="flex flex-wrap items-center gap-2">
            {/* "en" rather than nothing between the rows: it is the one word that
                says how two conditions combine, and it costs a label's worth of
                space to remove the guess. */}
            <span className="w-7 shrink-0 text-right text-xs text-k-text-secondary">
              {index === 0 ? "" : "en"}
            </span>
            <select
              value={filter.fieldId}
              onChange={(e) => onChange(filter.id, { fieldId: e.target.value })}
              aria-label="Veld om op te filteren"
              className="neu-input h-9 w-64 shrink-0 cursor-pointer rounded-full px-3 text-sm"
            >
              <option value="">Kies een veld…</option>
              {options.map((field) => (
                <option key={field.fieldId} value={field.fieldId}>
                  {field.label} ({field.fieldId})
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-k-text-tertiary"
                strokeWidth={1.8}
              />
              <input
                type="search"
                value={filter.query}
                onChange={(e) => onChange(filter.id, { query: e.target.value })}
                // Disabled until a field is picked: a search box with nothing to
                // search is a prompt to type something that cannot do anything.
                disabled={filter.fieldId === ""}
                placeholder={
                  filter.fieldId === "" ? "Kies eerst een veld" : "Bevat…"
                }
                aria-label="Zoekwaarde"
                className="neu-input h-9 w-full rounded-full pl-8 pr-3 text-sm"
              />
            </div>
            {/* The first row has no remove button: with one row there is nothing to
                go back to, and `Filter wissen` above already empties it. */}
            <button
              type="button"
              onClick={() => onRemove(filter.id)}
              disabled={filters.length === 1}
              aria-label="Deze voorwaarde verwijderen"
              title="Deze voorwaarde verwijderen"
              className="neu-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:text-k-red-fg!"
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="neu-button mt-2 ml-9 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Veld toevoegen
      </button>
    </div>
  );
}
