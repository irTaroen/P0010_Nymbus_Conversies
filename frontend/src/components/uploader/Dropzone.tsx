"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The dashed card that takes a file — the whole point of a module page with no sheet
 * open yet, and sized like it: it **fills the height its landing leaves** rather than
 * being a fixed strip with dead space under it. `flex-1` is what does that, in the
 * flex cell [`UploadLanding`](./UploadLanding.tsx) puts it in; `h-full` is the same
 * answer for a caller that hands it an ordinary block, and `min-h-72` the floor for a
 * short viewport, where the landing scrolls instead.
 *
 * That height is what the sheet toolbar gave up by only appearing with a sheet. A
 * drop target you can't miss is worth more than a row of buttons that can't act yet.
 *
 * The drop target *over an open table* is deliberately not this: it is an overlay on
 * the table card with its own highlight and wording (*Bestand loslaten om te vervangen*),
 * and lives with the table it covers.
 */
export default function Dropzone({
  onFile,
  onOpen,
}: {
  /** A file was dropped here. */
  onFile: (file: File) => void;
  /** The card was clicked or activated by keyboard — open the file picker. */
  onOpen: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const t = useT();

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className={`group flex h-full min-h-72 w-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-[box-shadow,border-color] duration-200 ${
        isDragging
          ? "border-k-cloud-mid bg-k-bg shadow-[var(--k-shadow-inset),0_0_0_3px_var(--k-cloud-light)]"
          : "border-k-divider bg-k-bg shadow-inset hover:border-k-cloud-mid"
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-k-bg text-k-cloud-deep shadow-inset-sm transition-colors">
        <Upload className="h-8 w-8" strokeWidth={1.5} />
      </span>
      <p className="text-xl font-semibold text-k-text-primary">{t("Kies een Excel-bestand", "Choose an Excel file")}</p>
      <p className="text-sm text-k-text-secondary">.xlsx, .xls of .csv</p>
      <span className="neu-action-primary mt-3">
        {t("Bestand kiezen", "Choose file")}
      </span>
      <p className="mt-2 text-xs text-k-text-secondary">{t("of sleep een bestand hierheen", "or drag a file here")}</p>
    </div>
  );
}
