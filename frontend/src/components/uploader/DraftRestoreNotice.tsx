"use client";

import { History, RotateCcw, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { useT } from "@/lib/i18n";
import { countText } from "@/lib/validation/metrics";

/**
 * The offer the module page makes when the browser turns out to be holding work from
 * a session that ended without one: *verder waar je gebleven was?*
 *
 * It sits in the landing's notice slot, above the dropzone
 * ([`UploadLanding`](./UploadLanding.tsx)), because that is where this page already
 * answers things — and because the alternative it competes with is directly below it:
 * upload the file again. So it names what it is holding (which file, how many
 * changes, from when) and lets the reader weigh that against the file on their own
 * disk, rather than restoring by itself and leaving them to work out what is on
 * screen.
 *
 * A card, not an `AmberNotice`: nothing has gone wrong. Amber here would say a
 * problem needs attention, where this is a convenience — and one that is refused
 * without cost, since [`draft-store.ts`](../../lib/draft-store.ts) only ever holds a
 * copy of work that was also on disk or is about to be.
 */
export default function DraftRestoreNotice({
  fileName,
  savedAt,
  editCount,
  onRestore,
  onDiscard,
}: {
  /** The file the stored grid came from. */
  fileName: string;
  /** When the last autosave was written. */
  savedAt: Date;
  /** How many cells stand changed from the file as it was read. */
  editCount: number;
  /** Put the stored sheet back on screen. */
  onRestore: () => void;
  /** Throw it away — this module starts empty. */
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <section
      aria-label={t("Niet-opgeslagen werk gevonden", "Unsaved work found")}
      className="flex h-full flex-col rounded-2xl bg-k-bg px-6 py-5 text-left shadow-raised"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-k-bg text-k-cloud-deep shadow-inset-sm">
            <History className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-k-text-primary">
              {t("Verder waar je gebleven was?", "Pick up where you left off?")}
            </h2>
            <p className="mt-1 text-sm text-k-text-secondary">
              {t(
                <>
                  <strong className="font-semibold wrap-anywhere">{fileName}</strong> stond hier open met{" "}
                  <strong className="font-semibold">
                    {countText(editCount, "aanpassing", "aanpassingen", "change", "changes")}
                  </strong>
                  , automatisch bewaard op {formatDateTime(savedAt)}. Deze kopie staat
                  alleen in deze browser.
                </>,
                <>
                  <strong className="font-semibold wrap-anywhere">{fileName}</strong> was open here with{" "}
                  <strong className="font-semibold">
                    {countText(editCount, "aanpassing", "aanpassingen", "change", "changes")}
                  </strong>
                  , automatically saved at {formatDateTime(savedAt)}. This copy is stored
                  only in this browser.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="neu-button inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium text-k-red-fg! hover:text-k-red-fg!"
          >
            <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {t("Weggooien", "Discard")}
          </button>
          <button
            type="button"
            onClick={onRestore}
            className="neu-button inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium"
          >
            <RotateCcw className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {t("Werk herstellen", "Restore work")}
          </button>
        </div>
      </div>
    </section>
  );
}
