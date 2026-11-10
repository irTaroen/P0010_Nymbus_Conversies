"use client";

import { getModule } from "@/lib/modules";
import Modal, { ModalButton, ModalWarningHeader } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/** Modal: confirm switching the active module to the file's resolved module. */
export default function SwitchModulePrompt({
  from,
  to,
  onConfirm,
  onCancel,
}: {
  from: string;
  to: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const fromLabel = getModule(from)?.label ?? from;
  const toLabel = getModule(to)?.label ?? to;
  return (
    <Modal onDismiss={onCancel} className="max-w-md">
      <ModalWarningHeader title={t("Wisselen van module?", "Switch module?")}>
        {t(
          <>Dit bestand hoort bij module <strong>{toLabel}</strong>, maar je staat nu op <strong>{fromLabel}</strong>. Wil je wisselen naar <strong>{toLabel}</strong>?</>,
          <>This file belongs to module <strong>{toLabel}</strong>, but you are now on <strong>{fromLabel}</strong>. Do you want to switch to <strong>{toLabel}</strong>?</>,
        )}
      </ModalWarningHeader>
      <div className="flex justify-end gap-2 border-t border-k-divider px-6 py-4">
        <ModalButton onClick={onCancel}>{t(<>Blijf op {fromLabel}</>, <>Stay on {fromLabel}</>)}</ModalButton>
        <ModalButton tone="primary" onClick={onConfirm}>
          {t(<>Wissel naar {toLabel}</>, <>Switch to {toLabel}</>)}
        </ModalButton>
      </div>
    </Modal>
  );
}
