"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Modal, { ModalSearch, PickerHeader, PickerFooter } from "@/components/Modal";
import { useCodetabellen } from "@/components/CodetabellenProvider";
import { codetabelPicker, codetabelScopeKey, getCodetabel } from "@/lib/validation/codetabellen";
import { countText } from "@/lib/validation/metrics";
import type { CodetabelEntry } from "@/lib/validation/types";
import { localized, useT } from "@/lib/i18n";

const ROW_HEIGHT = 36; // px — matches px-4 py-2 + the row's text size

/**
 * The AFAS list behind a rejected cell, offered back to the user as a picker:
 * every valid value, searchable, one click to write it into the cell.
 *
 * It exists because a failed `codetabel` check is the one error the tool knows
 * the answer to. Every other message can only describe what is wrong ("geen
 * geldige IBAN"); this one is "the value isn't in *this* list" — and the list is
 * right here, so telling the user to go find `AFG` in AFAS themselves is work the
 * tool can do for them.
 *
 * The columns come from the list's own `picker` declaration in
 * [sources.ts](../../lib/validation/codetabellen/sources.ts) — the AFAS export's
 * field names (`Code` + `Naam`, `Land` + `Woonplaats`) — and both are searchable,
 * because a client who typed a wrong nationality code knows the country's *name*,
 * not the code they were supposed to use. What a pick writes into the cell is
 * always the entry's `code`: that is what the check compares, so nothing else
 * could resolve the error. For the woonplaatsen list the `code` *is* the place
 * name, which is why picking there fills in the woonplaats and not its land.
 *
 * `scope` narrows the list to exactly what the check judged the cell against (the
 * row's land, for a woonplaats). Without it the picker would offer values that
 * are in the list but still wrong for this row.
 */
export default function CodetabelPicker({
  tableRef,
  scope,
  columnName,
  currentValue,
  onSelect,
  onClose,
}: {
  /** The list to show — an issue's `tableRef`. */
  tableRef: string;
  /** Scope to narrow to, from the issue's `tableScope`. Absent = unscoped list. */
  scope?: string;
  /** The sheet column being corrected; the dialog's heading. */
  columnName: string;
  /** What the cell holds now — the value the check rejected. */
  currentValue: string;
  /** Called with the picked entry's `code`. */
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  // The row Enter would pick, moved with the arrow keys. Typing is how you get
  // here, so the keyboard has to be able to finish the job without the mouse.
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const picker = codetabelPicker(tableRef);
  // Opened before the table landed (the help drawer offers it as soon as the table
  // is registered), the list has to fill in when it arrives rather than stay empty.
  const { loadedAt } = useCodetabellen();

  /**
   * The entries on offer: the whole list, narrowed to `scope` when there is one.
   * Case-insensitively, like the check itself — the sheet's `nl` and the list's
   * `NL` are the same land.
   *
   * Deduped on what the user actually sees, because a connector may return the
   * same value several times over: `ALG_Dienstbetrekkingen` answers with 21 rows
   * for 9 distinct (cao, code) pairs, so cao `SG` would otherwise offer *Vaste
   * medewerker* five times and *Stagiair* four. The store keeps every row as AFAS
   * sent it — its indexes are Sets, so duplicates cost validation nothing — and
   * the collapsing belongs here, where a repeated row is a defect rather than
   * data. Keyed by code **and** scope so a code valid under two scopes survives
   * in both.
   */
  const entries = useMemo(() => {
    const all = getCodetabel(tableRef);
    const wanted = scope ? codetabelScopeKey(tableRef, scope) : null;
    const seen = new Set<string>();
    const out: typeof all = [];
    for (const e of all) {
      const entryScope = codetabelScopeKey(tableRef, e.scope ?? "");
      if (wanted !== null && entryScope !== wanted) continue;
      const key = `${entryScope}\u0000${e.code.toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
    // `loadedAt` isn't read: it is the signal that `getCodetabel` now answers anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRef, scope, loadedAt]);

  /**
   * The columns to show. A list narrowed to one scope drops the column holding
   * that scope: every row would repeat the same `NL`, and the heading already
   * says which land the list is for. What is left is the column that matters.
   */
  const columns = useMemo(
    () => picker.columns.filter((c) => !(scope && c.field === "scope")),
    [picker.columns, scope],
  );

  /** The scope column's own label ("Land"), for the heading's note. */
  const scopeColumn = picker.columns.find((c) => c.field === "scope");
  const scopeLabel = scopeColumn && localized(scopeColumn.label, scopeColumn.labelEn);

  // Search across every shown column, so a term finds a row by either of them.
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q === "") return entries;
    return entries.filter((e) =>
      columns.some((c) => (e[c.field] ?? "").toLowerCase().includes(q)),
    );
  }, [entries, columns, q]);

  // A new term is a new list — start at the top, both the scroll and the cursor.
  useEffect(() => {
    setActive(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [q]);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  function move(delta: number) {
    if (matches.length === 0) return;
    const next = Math.min(Math.max(active + delta, 0), matches.length - 1);
    setActive(next);
    virtualizer.scrollToIndex(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault(); // else the caret jumps instead of the cursor
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = matches[active];
      if (entry) onSelect(entry.code);
    }
  }

  const listId = "codetabel-picker-options";
  const gridCols = columns.length > 1 ? "grid-cols-[8rem_1fr]" : "grid-cols-1";

  return (
    <Modal onDismiss={onClose} className="max-w-lg">
      <PickerHeader title={columnName} onClose={onClose}>
        <p className="mt-0.5 text-sm text-k-text-secondary">
          {t("Kies een geldige waarde uit de codetabel", "Choose a valid value from the code table")}
          {scope && scopeLabel ? t(` binnen ${scopeLabel} ${scope}`, ` within ${scopeLabel} ${scope}`) : ""}.
        </p>
        {currentValue && (
          <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-k-red-bg px-2.5 py-1 text-xs text-k-red-fg shadow-inset-sm">
            <span className="shrink-0">{t("Huidige waarde:", "Current value:")}</span>
            <span className="truncate font-semibold">{currentValue}</span>
          </p>
        )}
      </PickerHeader>

      <div className="border-b border-k-divider px-6 pb-4">
        <ModalSearch
          value={query}
          onChange={setQuery}
          placeholder={t(
            `Zoek op ${columns.map((c) => c.label.toLowerCase()).join(" of ")}…`,
            `Search by ${columns.map((c) => (c.labelEn ?? c.label).toLowerCase()).join(" or ")}…`,
          )}
          label={t(`Zoek een waarde voor ${columnName}`, `Search for a value for ${columnName}`)}
          inputProps={{
            onKeyDown,
            role: "combobox",
            "aria-expanded": true,
            "aria-controls": listId,
            "aria-activedescendant": matches[active] ? `${listId}-${active}` : undefined,
          }}
        />
      </div>

      {/* Column headers — the quiet `bg-k-tint` band, not the data table's
          filled header: this is a reference list inside a dialog, not the sheet. */}
      <div
        className={`grid ${gridCols} gap-3 border-b border-k-divider bg-k-tint px-6 py-2 text-xs font-semibold uppercase tracking-wide text-k-text-secondary`}
      >
        {columns.map((c) => (
          <span key={c.field}>{t(c.label, c.labelEn ?? c.label)}</span>
        ))}
      </div>

      {/* Virtualised: the woonplaatsen list is 3260 entries, and all of them are
          reachable by scrolling — there is no "top 50" that could hide the one
          the user needs. */}
      <div ref={scrollRef} id={listId} role="listbox" className="h-80 overflow-auto">
        {matches.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-k-text-secondary">
            {/* An empty table and an empty search result are different problems:
                the table is fetched from the client's AFAS, so "nothing here"
                usually means it couldn't be, and telling the user their query
                found nothing would point them at the wrong thing. */}
            {getCodetabel(tableRef).length === 0
              ? t(
                  "Deze codetabel kon niet uit AFAS worden opgehaald, dus er is niets om uit te kiezen.",
                  "This code table could not be fetched from AFAS, so there is nothing to choose from.",
                )
              : t(`Geen waarde gevonden voor “${query}”.`, `No value found for “${query}”.`)}
          </p>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const entry = matches[v.index];
              return (
                <Row
                  key={v.key}
                  id={`${listId}-${v.index}`}
                  entry={entry}
                  columns={columns}
                  gridCols={gridCols}
                  active={v.index === active}
                  top={v.start}
                  height={v.size}
                  onPointerEnter={() => setActive(v.index)}
                  onPick={() => onSelect(entry.code)}
                />
              );
            })}
          </div>
        )}
      </div>

      <PickerFooter
        count={
          q === ""
            ? countText(entries.length, t("waarde", "value"), t("waarden", "values"))
            : t(
                `${matches.length} van ${countText(entries.length, "waarde", "waarden")}`,
                `${matches.length} of ${countText(entries.length, "value", "values")}`,
              )
        }
        onClose={onClose}
      />
    </Modal>
  );
}

/**
 * One entry. A `div` rather than a `<button>`: it is an `option` inside the
 * listbox, and focus stays in the search field (`aria-activedescendant`) so
 * typing and picking are one uninterrupted move.
 */
function Row({
  id,
  entry,
  columns,
  gridCols,
  active,
  top,
  height,
  onPointerEnter,
  onPick,
}: {
  id: string;
  entry: CodetabelEntry;
  columns: { label: string; field: keyof CodetabelEntry }[];
  gridCols: string;
  active: boolean;
  top: number;
  height: number;
  onPointerEnter: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onPointerEnter={onPointerEnter}
      onClick={onPick}
      style={{ position: "absolute", top, left: 0, width: "100%", height }}
      className={`grid ${gridCols} cursor-pointer items-center gap-3 px-6 text-sm transition-colors ${
        active ? "bg-k-cloud-light/40 text-k-cloud-deep" : "text-k-text-primary"
      }`}
    >
      {columns.map((c) => (
        <span key={c.field} className="truncate">
          {c.field === "code" ? (
            <span className="font-semibold">{entry[c.field]}</span>
          ) : (
            entry[c.field]
          )}
        </span>
      ))}
    </div>
  );
}
