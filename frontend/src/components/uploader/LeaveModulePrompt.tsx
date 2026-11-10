"use client";

import Modal, {
  ModalButton,
  ModalConfirmHeader,
  ModalWarningHeader,
} from "@/components/Modal";
import { useT } from "@/lib/i18n";

/**
 * Modal shown when the user follows a link while a sheet is on screen — another module
 * in the sidebar, or the project itself. The page it opens closes the table, so the
 * question is always the same: go on, or stay. What changes is the price of going on.
 *
 * **Not saved yet** — leaving costs the annotated sheet and its validatierapport unless
 * the user saves first: *Opslaan en naar …* downloads the same pair the toolbar's save
 * button hands over, then leaves. *Doorgaan zonder opslaan* leaves without them —
 * for a test upload, a wrong file, or edits the user doesn't want after all.
 *
 * **Already saved** (`saved`) — both files are on disk and the grid hasn't changed
 * since, so there is nothing left to protect and the prompt says so: a green chip
 * instead of the amber triangle, a plain *Naar …*, and no separate discard button —
 * that path already leaves without writing anything new. Asking someone to save a
 * second time would hand them two duplicate downloads and teach them to click through
 * the prompt without reading it — which is exactly what would make the unsaved case
 * above useless.
 *
 * Both destinations are given as labels rather than ids: the guard behind this
 * ([`NavigationGuard`](../NavigationGuard.tsx)) works in paths, and only the uploader
 * can say whether one names a module or a project.
 *
 * Distinct from [`SwitchModulePrompt`](./SwitchModulePrompt.tsx), which asks the
 * mirror-image question on upload: a *file* that belongs to another module.
 */
export default function LeaveModulePrompt({
  fromLabel,
  toLabel,
  fileName,
  saved,
  onLeave,
  onDiscard,
  onCancel,
}: {
  /** Where the sheet on screen lives — the module it was validated against. */
  fromLabel: string;
  /** Where the user asked to go: another module, or the project. */
  toLabel: string;
  /** The open file, named so it's clear what is at stake. */
  fileName: string;
  /** Are the sheet and its report already downloaded, as the table now stands? */
  saved: boolean;
  /** Follow the link — saving on the way when `saved` is false. */
  onLeave: () => void;
  /** Follow the link without saving. Only offered while `saved` is false. */
  onDiscard: () => void;
  /** Stay put with the sheet untouched (also Escape / backdrop). */
  onCancel: () => void;
}) {
  const t = useT();
  const Header = saved ? ModalConfirmHeader : ModalWarningHeader;
  return (
    <Modal onDismiss={onCancel} className="max-w-md">
      <Header title={t(`Naar ${toLabel}?`, `To ${toLabel}?`)}>
        {saved ? (
          t(
            <>
              <strong>{fileName}</strong> is opgeslagen — het bestand en het
              validatierapport zijn gedownload. Ga je verder naar{" "}
              <strong>{toLabel}</strong>, dan wordt de tabel gesloten.
            </>,
            <>
              <strong>{fileName}</strong> is saved — the file and the validation
              report have been downloaded. If you go on to{" "}
              <strong>{toLabel}</strong>, the table will close.
            </>,
          )
        ) : (
          t(
            <>
              <strong>{fileName}</strong> staat open in <strong>{fromLabel}</strong>.
              Ga je verder naar <strong>{toLabel}</strong>, dan wordt de tabel
              gesloten — het bestand en het validatierapport worden eerst gedownload.
            </>,
            <>
              <strong>{fileName}</strong> is open in <strong>{fromLabel}</strong>.
              If you go on to <strong>{toLabel}</strong>, the table will close — the
              file and the validation report are downloaded first.
            </>,
          )
        )}
      </Header>
      <div className="flex flex-col gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton tone="primary" fullWidth onClick={onLeave}>
          {saved ? t(`Naar ${toLabel}`, `To ${toLabel}`) : t(`Opslaan en naar ${toLabel}`, `Save and go to ${toLabel}`)}
        </ModalButton>
        {!saved && (
          <ModalButton tone="danger" fullWidth onClick={onDiscard}>
            {t("Doorgaan zonder opslaan", "Continue without saving")}
          </ModalButton>
        )}
        <ModalButton fullWidth onClick={onCancel}>
          {t(`Blijf op ${fromLabel}`, `Stay on ${fromLabel}`)}
        </ModalButton>
      </div>
    </Modal>
  );
}
