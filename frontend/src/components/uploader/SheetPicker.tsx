"use client";

import { ChevronRight } from "lucide-react";
import { type ParsedWorkbook } from "@/lib/excel";
import { omvangText } from "@/lib/validation/metrics";
import Modal, { ModalCloseButton } from "@/components/Modal";

/** Modal: choose which worksheet to import from a multi-sheet workbook. */
export default function SheetPicker({
  workbook,
  onSelect,
  onCancel,
}: {
  workbook: ParsedWorkbook;
  onSelect: (index: number) => void;
  onCancel: () => void;
}) {
  return (
    <Modal onDismiss={onCancel} className="max-w-sm">
      <div className="flex items-start justify-between gap-4 border-b border-k-divider px-6 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-k-text-secondary">
            {workbook.fileName}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-k-text-primary">
            Selecteer een werkblad
          </h2>
          <p className="mt-1 text-sm text-k-text-secondary">
            Dit bestand bevat {workbook.sheets.length} werkbladen. Kies welk
            werkblad je wilt importeren.
          </p>
        </div>
        <ModalCloseButton onClose={onCancel} />
      </div>
      <ul className="divide-y divide-k-divider px-2 py-2">
        {workbook.sheets.map((s, i) => (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              className="flex w-full items-center gap-3 rounded-[10px] px-4 py-3 text-left transition-shadow duration-200 hover:shadow-inset-sm"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-k-bg text-xs font-bold text-k-text-secondary shadow-inset-sm">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-k-text-primary">
                  {s.name}
                </span>
                <span className="block text-xs text-k-text-secondary">
                  {omvangText(s.rows.length, s.headers.length)}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-k-text-tertiary"
                strokeWidth={2}
              />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-k-divider px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-k-text-secondary underline-offset-2 hover:underline"
        >
          Annuleren
        </button>
      </div>
    </Modal>
  );
}
