"use client";

import { type ModuleRecognition } from "@/lib/modules";
import { useModule } from "@/components/ModuleProvider";
import Modal, { ModalCloseButton } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/** Modal: pick a module when the filename was unknown/ambiguous. */
export default function ModulePicker({
  fileName,
  recognition,
  onSelect,
  onCancel,
}: {
  fileName: string;
  recognition: ModuleRecognition;
  onSelect: (moduleId: string) => void;
  onCancel: () => void;
}) {
  // Only the project's own modules — the same set recognition chose from.
  const { groups } = useModule();
  const t = useT();
  const candidates =
    recognition.status === "ambiguous" ? new Set(recognition.candidates) : null;
  const intro =
    recognition.status === "ambiguous"
      ? t(
          "De bestandsnaam past bij meerdere modules. Kies de juiste.",
          "The file name matches several modules. Choose the right one.",
        )
      : t(
          "We konden de module niet uit de bestandsnaam afleiden. Kies de module.",
          "We couldn't work out the module from the file name. Choose the module.",
        );

  return (
    <Modal onDismiss={onCancel} className="flex max-h-[80vh] max-w-sm flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-k-divider px-6 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-k-text-secondary">
            {fileName}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-k-text-primary">
            {t("Welke module is dit?", "Which module is this?")}
          </h2>
          <p className="mt-1 text-sm text-k-text-secondary">{intro}</p>
        </div>
        <ModalCloseButton onClose={onCancel} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 && (
          <p className="px-4 py-3 text-sm text-k-text-secondary">
            {t("Dit project heeft geen modules om uit te kiezen.", "This project has no modules to choose from.")}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.id} className="px-2 py-1">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((m) => {
                const suggested = candidates?.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-[box-shadow,color] duration-200 hover:text-k-cloud-deep hover:shadow-inset-sm ${
                        suggested ? "text-k-cloud-deep" : "text-k-text-primary"
                      }`}
                    >
                      {m.label}
                      {suggested && (
                        <span className="rounded-full bg-k-cloud-light/40 px-2 py-0.5 text-[10px] font-semibold text-k-cloud-deep shadow-inset-sm">
                          {t("voorgesteld", "suggested")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-k-divider px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-k-text-secondary underline-offset-2 hover:underline"
        >
          {t("Annuleren", "Cancel")}
        </button>
      </div>
    </Modal>
  );
}
