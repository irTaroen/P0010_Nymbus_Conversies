"use client";

import { useRef, useState } from "react";
import {
  ChevronRight,
  FileSpreadsheet,
  GripVertical,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { AmberNotice } from "@/components/uploader/Notices";
import { cellToString, type ParsedWorkbook } from "@/lib/excel";
import { columnLetter } from "@/lib/validation/report";
import CompactSearch from "@/components/CompactSearch";

/** Example values per column, from the example row down. One or two is the point. */
const PREVIEW_VALUES = 2;

/** How many rows the example picker offers — a mapping is read off the first few. */
const EXAMPLE_ROW_CHOICES = 25;

/**
 * The **source** side of the mapping: the sheet's columns as a vertical list, beside
 * the connector's fields rather than above them.
 *
 * It was a table of the first rows, laid across the top of the page, and that made
 * the one gesture this page exists for hard: 78 columns scroll sideways while the
 * fields scroll down, so half the drags started with the target off screen. As a
 * column of columns it sits **next to** the tree, each side scrolls on its own, and a
 * drag is a short horizontal move between two lists that both stay put.
 *
 * A column is a row here: its Excel letter, its header, and — once it feeds
 * something — the field codes it feeds, which is the mapping read backwards and the
 * quickest way to see what is still unmapped. **The values live behind the
 * chevron**: what a column *is* is its name, and the first values are what you check
 * when the name isn't enough, so they cost a click instead of a screenful.
 *
 * Every row is a drag handle *and* a button: dragging carries the column, clicking
 * picks it and the fields opposite offer to take it. Native drag-and-drop has no
 * keyboard, and a 78-column mapping is exactly the work someone does from one.
 */
export default function ExcelColumnsPanel({
  workbook,
  sheetIndex,
  onSheetIndex,
  onFile,
  onClearFile,
  parsing,
  error,
  exampleRow,
  onExampleRow,
  picked,
  onPick,
  onDragColumn,
  fieldsByColumn,
}: {
  workbook: ParsedWorkbook | null;
  sheetIndex: number;
  onSheetIndex: (index: number) => void;
  onFile: (file: File) => void;
  onClearFile: () => void;
  parsing: boolean;
  error: string;
  /** The row the example values and the JSON preview are read from. */
  exampleRow: number;
  onExampleRow: (index: number) => void;
  /** The column picked by click, waiting for a field. */
  picked: number | null;
  onPick: (index: number | null) => void;
  /** A drag started (the column) or ended (`null`). */
  onDragColumn: (index: number | null) => void;
  /** Which fields each column already feeds — the mapping, read backwards. */
  fieldsByColumn: Map<number, string[]>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [hideMapped, setHideMapped] = useState(false);

  const sheet = workbook?.sheets[sheetIndex] ?? null;
  const needle = query.trim().toLowerCase();

  // Index kept with the header: filtering must not renumber the columns, since the
  // index *is* the mapping.
  const columns = (sheet?.headers ?? [])
    .map((header, index) => ({ header, index }))
    .filter((column) => !needle || column.header.toLowerCase().includes(needle))
    .filter((column) => !hideMapped || !fieldsByColumn.has(column.index));

  function take(file: File | undefined | null) {
    if (file) onFile(file);
  }

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-k-divider bg-k-bg">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Cleared, so choosing the same file twice fires again.
          e.target.value = "";
        }}
      />

      <div className="shrink-0 px-3 pt-3">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
          Sjabloon {sheet && `(${sheet.headers.length} kolommen)`}
        </p>
        {error && <AmberNotice className="mb-2">{error}</AmberNotice>}
      </div>

      {!sheet ? (
        <div className="min-h-0 flex-1 px-3 pb-3">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              take(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            className="flex h-full min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-k-divider bg-k-bg px-4 py-6 text-center shadow-inset transition-[box-shadow,border-color] duration-200 hover:border-k-cloud-mid hover:shadow-[var(--k-shadow-inset),0_0_0_3px_var(--k-cloud-light)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-k-bg text-k-cloud-deep shadow-inset-sm">
              {parsing ? (
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.8} />
              ) : (
                <Upload className="h-5 w-5" strokeWidth={1.8} />
              )}
            </span>
            <span className="text-sm font-semibold text-k-text-primary">
              {parsing ? "Bestand lezen…" : "Sleep het Excel-sjabloon hierheen"}
            </span>
            {!parsing && (
              <span className="text-xs text-k-text-secondary">
                De kolommen komen hier te staan, klaar om op een veld te slepen.
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 space-y-2 px-3 pb-3">
            <div className="flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-k-cloud-deep" strokeWidth={1.8} />
              <span
                className="min-w-0 flex-1 truncate text-sm font-semibold text-k-text-primary"
                title={workbook?.fileName}
              >
                {workbook?.fileName}
              </span>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                title="Een ander bestand kiezen"
                className="neu-button inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium"
              >
                Wijzig
              </button>
              <button
                type="button"
                onClick={onClearFile}
                aria-label="Bestand sluiten"
                title="Bestand sluiten"
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>

            {workbook && workbook.sheets.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-k-text-secondary">
                Werkblad
                <select
                  value={sheetIndex}
                  onChange={(e) => onSheetIndex(Number(e.target.value))}
                  className="neu-input h-8 min-w-0 flex-1 cursor-pointer rounded-full px-4 text-xs"
                >
                  {workbook.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Which row the example values and the JSON body are read from. */}
            {sheet.rows.length > 0 ? (
              <label className="flex items-center gap-2 text-xs text-k-text-secondary">
                Voorbeeld
                <select
                  value={exampleRow}
                  onChange={(e) => onExampleRow(Number(e.target.value))}
                  title="De rij waaruit de voorbeeldwaarden en de JSON worden gevuld"
                  className="neu-input h-8 min-w-0 flex-1 cursor-pointer rounded-full px-4 text-xs"
                >
                  {sheet.rowNumbers.slice(0, EXAMPLE_ROW_CHOICES).map((rowNumber, i) => (
                    <option key={rowNumber} value={i}>
                      rij {rowNumber}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs text-k-text-secondary">
                Alleen kopregels — koppelen kan, voorbeeldwaarden zijn er niet.
              </p>
            )}

            <CompactSearch
              value={query}
              onChange={setQuery}
              placeholder="Zoek kolom"
              label="Zoek kolom"
            />

            <button
              type="button"
              onClick={() => setHideMapped((on) => !on)}
              aria-pressed={hideMapped}
              title="De kolommen die al een veld vullen verbergen"
              className="neu-button w-full rounded-full px-2 py-1.5 text-xs font-medium"
            >
              Alleen ongekoppeld ({sheet.headers.length - fieldsByColumn.size})
            </button>
          </div>

          {/* The list itself — its own scroll, so it and the tree move apart. */}
          <ul className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {columns.length === 0 && (
              <li className="px-2 py-2 text-xs text-k-text-secondary">
                {hideMapped && needle === ""
                  ? "Elke kolom is gekoppeld."
                  : "Geen kolom met deze naam."}
              </li>
            )}
            {columns.map(({ header, index }) => {
              const fields = fieldsByColumn.get(index) ?? [];
              const expanded = open.has(index);
              const isPicked = picked === index;
              return (
                <li key={index}>
                  <div
                    className={`flex items-center gap-0.5 rounded-xl transition-[box-shadow,background-color] duration-200 ${
                      isPicked
                        ? "bg-k-bg text-k-cloud-deep shadow-inset-sm"
                        : fields.length > 0
                          ? "bg-k-cloud-light/40"
                          : "hover:bg-k-tint"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-expanded={expanded}
                      aria-label={`Voorbeeldwaarden van ${header}`}
                      title="Voorbeeldwaarden tonen"
                      className="flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center rounded-xl"
                    >
                      <ChevronRight
                        aria-hidden
                        className={`h-3.5 w-3.5 transition-transform ${
                          expanded ? "rotate-90" : ""
                        } ${isPicked ? "text-k-cloud-deep" : "text-k-text-tertiary"}`}
                        strokeWidth={2}
                      />
                    </button>

                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", header);
                        e.dataTransfer.effectAllowed = "copy";
                        onDragColumn(index);
                      }}
                      onDragEnd={() => onDragColumn(null)}
                      onClick={() => onPick(isPicked ? null : index)}
                      aria-pressed={isPicked}
                      title={`${header} — sleep naar een veld, of klik om te kiezen`}
                      className="group flex min-w-0 flex-1 cursor-grab items-center gap-1.5 py-1 pr-2 text-left active:cursor-grabbing"
                    >
                      <GripVertical
                        aria-hidden
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isPicked ? "text-k-cloud-deep/70" : "text-k-text-tertiary group-hover:text-k-text-tertiary"
                        }`}
                        strokeWidth={1.8}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span
                            className={`shrink-0 font-mono text-[10px] ${
                              isPicked ? "text-k-cloud-deep/70" : "text-k-text-tertiary"
                            }`}
                          >
                            {columnLetter(index, sheet.firstColumnNumber)}
                          </span>
                          <span
                            className={`min-w-0 truncate text-xs font-medium ${
                              isPicked ? "text-k-cloud-deep" : "text-k-text-primary"
                            }`}
                          >
                            {header}
                          </span>
                        </span>
                        {fields.length > 0 && (
                          <span
                            className={`block truncate font-mono text-[10px] ${
                              isPicked ? "text-k-cloud-deep/80" : "text-k-cloud-deep"
                            }`}
                            title={`Gekoppeld aan ${fields.join(", ")}`}
                          >
                            → {fields.join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>

                  {expanded && (
                    <ul className="mb-1 ml-6 mr-2 space-y-0.5 border-l-2 border-k-divider pl-2 pt-1">
                      {sheet.rows
                        .slice(exampleRow, exampleRow + PREVIEW_VALUES)
                        .map((row, offset) => {
                          const value = cellToString(row[index] ?? null);
                          return (
                            <li
                              key={sheet.rowNumbers[exampleRow + offset]}
                              className="flex items-baseline gap-1.5 text-[11px]"
                            >
                              <span className="shrink-0 font-mono text-k-text-tertiary">
                                {sheet.rowNumbers[exampleRow + offset]}
                              </span>
                              <span
                                className={`min-w-0 flex-1 truncate ${
                                  offset === 0 ? "font-medium text-k-text-primary" : "text-k-text-secondary"
                                }`}
                                title={value}
                              >
                                {value || <span className="text-k-text-tertiary">leeg</span>}
                              </span>
                            </li>
                          );
                        })}
                      {sheet.rows.length === 0 && (
                        <li className="text-[11px] text-k-text-secondary">Geen gegevensrijen.</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
