"use client";

import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/**
 * Modal: the uploaded file's name carries another project's number than the one
 * the user is in.
 *
 * It asks rather than blocks, and it is deliberately not the module prompt's
 * sibling in behaviour: switching module *moves the file* to where it belongs,
 * because a module is a page in this project. A project is a different
 * conversion with its own rules, its own configuration and its own AFAS
 * environment, and the tool has no standing to decide which of the two the user
 * meant — the number may be stale (a file copied from last year's project and
 * refilled) just as easily as the page may be wrong.
 *
 * So the only offer is to go on or to stop. Going on is a real option: the file
 * is validated against *this* project, which is what the user is looking at, and
 * nothing about the old number follows it — the next download is renamed to this
 * project (see `downloadName()` in [download.ts](@/lib/download)). What the
 * prompt buys is the case that costs an afternoon: validating last project's
 * Medewerkers against this project's codetabellen and reading a screen of
 * errors that mean nothing.
 */
export default function SwitchProjectPrompt({
  fileName,
  fileProjectId,
  currentProjectId,
  currentProjectName,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  /** The number in the file's name. */
  fileProjectId: string;
  /** The project the user is actually in. */
  currentProjectId: string;
  currentProjectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Modal onDismiss={onCancel} className="max-w-md">
      <ModalWarningHeader title={t("Bestand van een ander project?", "File from another project?")}>
        {t(
          <>
            De naam van <strong>{fileName}</strong> begint met projectnummer{" "}
            <strong>{fileProjectId}</strong>, maar je staat in project{" "}
            <strong>{currentProjectId}</strong> ({currentProjectName}). Het bestand
            wordt gecontroleerd met de instellingen van {currentProjectId}.
          </>,
          <>
            The name of <strong>{fileName}</strong> starts with project number{" "}
            <strong>{fileProjectId}</strong>, but you are in project{" "}
            <strong>{currentProjectId}</strong> ({currentProjectName}). The file
            will be checked against the settings of {currentProjectId}.
          </>
        )}
      </ModalWarningHeader>
      <div className="flex justify-end gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton onClick={onCancel}>{t("Annuleren", "Cancel")}</ModalButton>
        <ModalButton tone="primary" onClick={onConfirm}>
          {t("Toch inlezen", "Import anyway")}
        </ModalButton>
      </div>
    </Modal>
  );
}
