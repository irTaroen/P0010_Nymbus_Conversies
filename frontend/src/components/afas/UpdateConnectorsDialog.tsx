"use client";

import { useRef } from "react";

import Modal from "@/components/Modal";
import UpdateConnectorExplorer, {
  type InitialClientMapping,
} from "@/components/afas/UpdateConnectorExplorer";

/**
 * The connector explorer **over** whatever is on screen, rather than instead of it.
 *
 * It is the same [`UpdateConnectorExplorer`](./UpdateConnectorExplorer.tsx) the page
 * at `/afas/updateconnectors` renders — not a reduced copy — given an `onClose` in
 * place of its back-link, so the two can never drift apart. Inside a dialog that
 * back-arrow was its only `GuardedLink`, so the explorer performs no navigation at
 * all here and the open sheet's leave guard is never consulted.
 *
 * **Why a dialog rather than the page**, for both of its callers:
 *
 * - From the **payload view**, the mapping is opened to explain the payload behind
 *   it, so the payload has to still be there when it closes.
 * - From the **sidebar**, the page would unmount an open uploader — dropping the
 *   workbook and raising the leave prompt over a sheet nobody is leaving, for what
 *   is really a look at a schema and then back to work.
 *
 * The page at `/afas/updateconnectors` stays: it is a real address, linkable and
 * refreshable, and the right thing when the explorer *is* the work rather than a
 * detour from it.
 *
 * Nearly the whole viewport on purpose. The explorer is a three-pane working
 * surface (connector rail, schema tree, payload) and a prompt-sized card would make
 * it unusable; `p-0` because it brings its own header and padding, and
 * `overflow-hidden` so its panes scroll inside the card rather than the card growing
 * past the screen.
 */
export default function UpdateConnectorsDialog({
  fromProjectId,
  initialConnector,
  initialModuleId,
  initialClient,
  onClose,
}: {
  /** The project to return to if the reader opens the full page from here. */
  fromProjectId: string | null;
  /** Open this `modules` connector instead of the first in the list. */
  initialConnector?: string | null;
  /** Open this `modules` **mapping** — preferred over `initialConnector`, which
   *  can't tell a split module's two halves apart. */
  initialModuleId?: string | null;
  /** Open this **client** mapping — a custom module's (maatwerk), read against its
   *  project's own AFAS. Preferred over both of the above. */
  initialClient?: InitialClientMapping | null;
  /**
   * Close, told whether a mapping was saved while the dialog was open — the payload
   * view builds its bodies from that mapping, so it refetches on `saved` and leaves
   * them alone otherwise (a reload is an AFAS metainfo call per variant).
   */
  onClose: (result: { saved: boolean }) => void;
}) {
  // Whether the explorer stored a mapping while this dialog was open. Held here, and
  // written by the explorer the moment it saves, because the three ways out do not
  // all run through the same handler: Esc and the backdrop go through
  // `Modal.onDismiss`, which takes no argument. Mirroring the flag only on the
  // explorer's own close button would report `saved: false` for a save followed by
  // Esc — and leave the payload view showing bodies built from the mapping that was
  // just replaced.
  const saved = useRef(false);

  return (
    <Modal
      onDismiss={() => onClose({ saved: saved.current })}
      className="flex h-[92vh] max-w-[95vw] flex-col overflow-hidden p-0"
    >
      <UpdateConnectorExplorer
        fromProjectId={fromProjectId}
        initialConnector={initialConnector}
        initialModuleId={initialModuleId}
        initialClient={initialClient}
        onSaved={() => {
          saved.current = true;
        }}
        onClose={() => onClose({ saved: saved.current })}
      />
    </Modal>
  );
}
