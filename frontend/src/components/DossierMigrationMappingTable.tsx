"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { DossierMigrationFileMapping } from "@/lib/dossier-migration";
import { useT } from "@/lib/i18n";

/**
 * The two small editable tables a dossier migration's mapping is built from —
 * employee id -> employee id, and dossier type(.kenmerk) -> type + kenmerk.
 * Styled per design-system.md §15 (tinted sticky header, hairline rows,
 * inset inline inputs) but without that section's heavier machinery
 * (row-number column, resize handles, virtualization): these hold a handful
 * of rows an admin types by hand, not an uploaded sheet.
 *
 * Both keep their own array of rows rather than the `Record` the backend
 * stores — a plain object can't hold two rows with the same (still being
 * typed) key without one overwriting the other while the admin is mid-edit.
 * `DossierMigrationPage` converts to/from the `Record` shape at load/save.
 *
 * Each row is its own `React.memo`d component (`EmployeeMappingRowView`,
 * `FileMappingRowView` below) for the same reason `DataTable`'s rows are:
 * `update()` replaces the whole `rows` array on every keystroke, and without a
 * per-row boundary every row's inputs would re-render on every character typed
 * into any one of them. Small as these tables usually are, the fix costs
 * nothing and keeps the two editable tables in the app behaving the same way.
 */

const HEADER_CELL =
  "relative whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold tracking-[0.5px] uppercase text-k-text-secondary";
const BODY_CELL_WRAP = "relative p-1.5";
const BODY_INPUT = "neu-input w-full rounded-md px-2.5 py-1.5 text-sm";

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-k-text-tertiary transition-[box-shadow,color] duration-150 hover:text-k-red-fg hover:shadow-inset-sm"
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  );
}

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="neu-button mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

export type EmployeeMappingRow = { source: string; target: string };

/**
 * One row of `EmployeeMappingTable`, memoized so typing in one row's inputs
 * doesn't re-render every other row — `update`/`onRemove` take the row's own
 * `index` rather than closing over it, so the parent can hand every row the
 * same two callbacks (stable across renders) instead of a fresh closure per
 * row per render, which would defeat the memo.
 */
const EmployeeMappingRowView = memo(function EmployeeMappingRowView({
  index,
  row,
  onUpdate,
  onRemove,
}: {
  index: number;
  row: EmployeeMappingRow;
  onUpdate: (index: number, field: keyof EmployeeMappingRow, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  return (
    <tr className="border-t border-k-divider">
      <td className={BODY_CELL_WRAP}>
        <input
          value={row.source}
          onChange={(e) => onUpdate(index, "source", e.target.value)}
          placeholder="1001"
          className={BODY_INPUT}
        />
      </td>
      <td className={BODY_CELL_WRAP}>
        <input
          value={row.target}
          onChange={(e) => onUpdate(index, "target", e.target.value)}
          placeholder="2001"
          className={BODY_INPUT}
        />
      </td>
      <td className="px-1.5 py-1.5 text-center">
        <RemoveButton onClick={() => onRemove(index)} label={t("Koppeling verwijderen", "Remove link")} />
      </td>
    </tr>
  );
});

/** Source employee id -> target employee id. An id left blank on either side
 *  is dropped when the page converts rows back to the stored `Record`. */
export function EmployeeMappingTable({
  rows,
  onChange,
}: {
  rows: EmployeeMappingRow[];
  onChange: (rows: EmployeeMappingRow[]) => void;
}) {
  const t = useT();
  // Read through `rowsRef` rather than closing over `rows` directly, so these
  // keep one stable identity across every render instead of a fresh one on
  // every keystroke — otherwise `EmployeeMappingRowView`'s memo would be
  // defeated the moment any row is edited, since a changed `onUpdate`/
  // `onRemove` prop invalidates every row, not just the one that changed. Kept
  // current in an effect rather than during render — React refs may not be
  // written while rendering.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const update = useCallback(
    (index: number, field: keyof EmployeeMappingRow, value: string) => {
      onChange(
        rowsRef.current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
      );
    },
    [onChange],
  );
  const remove = useCallback(
    (index: number) => onChange(rowsRef.current.filter((_, j) => j !== index)),
    [onChange],
  );

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-k-bg shadow-raised">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-k-tint">
            <tr>
              <th className={HEADER_CELL}>{t("Bron-ID (medewerker)", "Source ID (employee)")}</th>
              <th className={HEADER_CELL}>{t("Doel-ID (medewerker)", "Target ID (employee)")}</th>
              <th className={`${HEADER_CELL} w-10`} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="border-t border-k-divider">
                <td colSpan={3} className="px-3 py-3 text-center text-xs text-k-text-secondary">
                  {t(
                    "Geen koppelingen — een medewerker zonder koppeling behoudt zijn bron-ID.",
                    "No links — an employee without a link keeps their source ID.",
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <EmployeeMappingRowView key={i} index={i} row={row} onUpdate={update} onRemove={remove} />
              ))
            )}
          </tbody>
        </table>
      </div>
      <AddRowButton
        onClick={() => onChange([...rows, { source: "", target: "" }])}
        label={t("Koppeling toevoegen", "Add link")}
      />
    </div>
  );
}

export type FileMappingRow = { key: string } & DossierMigrationFileMapping;

/** One row of `FileMappingTable` — see `EmployeeMappingRowView` above. */
const FileMappingRowView = memo(function FileMappingRowView({
  index,
  row,
  onUpdate,
  onRemove,
}: {
  index: number;
  row: FileMappingRow;
  onUpdate: (index: number, field: keyof FileMappingRow, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  return (
    <tr className="border-t border-k-divider">
      <td className={BODY_CELL_WRAP}>
        <input
          value={row.key}
          onChange={(e) => onUpdate(index, "key", e.target.value)}
          placeholder="7.190 of 7.xx"
          className={`${BODY_INPUT} font-mono`}
        />
      </td>
      <td className={BODY_CELL_WRAP}>
        <input
          value={row.type}
          onChange={(e) => onUpdate(index, "type", e.target.value)}
          placeholder="12"
          className={BODY_INPUT}
        />
      </td>
      <td className={BODY_CELL_WRAP}>
        <input
          value={row.kenmerk}
          onChange={(e) => onUpdate(index, "kenmerk", e.target.value)}
          placeholder="310"
          className={BODY_INPUT}
        />
      </td>
      <td className="px-1.5 py-1.5 text-center">
        <RemoveButton onClick={() => onRemove(index)} label={t("Koppeling verwijderen", "Remove link")} />
      </td>
    </tr>
  );
});

/**
 * Source `Type_dossieritem` (or `Type_dossieritem.Kenmerk`) -> the target's
 * own type + kenmerk. A key ending in `.xx` matches any kenmerk under that
 * source type — the longest matching prefix wins when more than one rule
 * could apply.
 */
export function FileMappingTable({
  rows,
  onChange,
}: {
  rows: FileMappingRow[];
  onChange: (rows: FileMappingRow[]) => void;
}) {
  const t = useT();
  // See `EmployeeMappingTable`'s `rowsRef` above — same reason.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const update = useCallback(
    (index: number, field: keyof FileMappingRow, value: string) => {
      onChange(rowsRef.current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    },
    [onChange],
  );
  const remove = useCallback(
    (index: number) => onChange(rowsRef.current.filter((_, j) => j !== index)),
    [onChange],
  );

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-k-bg shadow-raised">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-k-tint">
            <tr>
              <th className={HEADER_CELL}>{t("Bron (type of type.kenmerk of type.xx)", "Source (type, type.kenmerk or type.xx)")}</th>
              <th className={HEADER_CELL}>{t("Doel type", "Target type")}</th>
              <th className={HEADER_CELL}>{t("Doel kenmerk", "Target kenmerk")}</th>
              <th className={`${HEADER_CELL} w-10`} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="border-t border-k-divider">
                <td colSpan={4} className="px-3 py-3 text-center text-xs text-k-text-secondary">
                  {t(
                    "Geen koppelingen — een dossieritem zonder koppeling behoudt zijn bron-type en -kenmerk.",
                    "No links — a dossier item without a link keeps its source type and kenmerk.",
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <FileMappingRowView key={i} index={i} row={row} onUpdate={update} onRemove={remove} />
              ))
            )}
          </tbody>
        </table>
      </div>
      <AddRowButton
        onClick={() => onChange([...rows, { key: "", type: "", kenmerk: "" }])}
        label={t("Koppeling toevoegen", "Add link")}
      />
    </div>
  );
}
