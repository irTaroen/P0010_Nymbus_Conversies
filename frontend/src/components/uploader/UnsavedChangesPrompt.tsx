"use client";

import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";

/**
 * Modal shown before an in-app action that would discard unsaved table edits
 * (e.g. loading another file over the current one). Offers to save + download
 * first, or to continue without saving.
 */
export default function UnsavedChangesPrompt({
  onSave,
  onDiscard,
  onCancel,
}: {
  /** Save + download the current sheet, then continue with the pending action. */
  onSave: () => void;
  /** Continue with the pending action without saving. */
  onDiscard: () => void;
  /** Dismiss and keep the current data (Escape / backdrop). */
  onCancel: () => void;
}) {
  return (
    <Modal onDismiss={onCancel} className="max-w-md">
      <ModalWarningHeader title="Niet-opgeslagen wijzigingen">
        Je hebt wijzigingen gemaakt die nog niet zijn opgeslagen. Als je doorgaat,
        gaan deze verloren. Wil je de tabel eerst opslaan en downloaden?
      </ModalWarningHeader>
      <div className="flex flex-col gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton tone="primary" fullWidth onClick={onSave}>
          Opslaan en downloaden
        </ModalButton>
        <ModalButton tone="danger" fullWidth onClick={onDiscard}>
          Doorgaan zonder opslaan
        </ModalButton>
        <ModalButton fullWidth onClick={onCancel}>
          Annuleren
        </ModalButton>
      </div>
    </Modal>
  );
}
