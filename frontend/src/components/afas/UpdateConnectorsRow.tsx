"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import UpdateConnectorsDialog from "@/components/afas/UpdateConnectorsDialog";
import { useProject } from "@/components/ProjectProvider";
import SidebarActionRow from "@/components/SidebarActionRow";

/**
 * Admin-only sidebar row: the AFAS UpdateConnectors and their field mappings, opened
 * **in a dialog over the project shell** — the same shape as its neighbour
 * [`ProjectSettings`](../ProjectSettings.tsx), and mounted only while open so the
 * connector list is read fresh each time.
 *
 * It used to be a `GuardedLink` to `/afas/updateconnectors`, on the reasoning that
 * the explorer is about an AFAS *environment* rather than about this project, so it
 * belonged outside the project shell. True of the content, but it made the row cost
 * more than it was worth: with a sheet open, following it unmounted the uploader,
 * dropped the workbook and raised the leave prompt — for what is nearly always a look
 * at a schema and then straight back to work. A dialog keeps the sheet exactly where
 * it was.
 *
 * The page at `/afas/updateconnectors` is untouched and still the right way in when
 * the explorer *is* the work: it is a real address, linkable and refreshable.
 * `fromProjectId` is still passed so that page's own "terug" arrow leads back here if
 * the reader ends up on it.
 *
 * The sidebar wraps this in [`AdminOnly`](../AdminOnly.tsx) — that, and not anything
 * here, is what keeps it away from non-admins.
 */
export default function UpdateConnectorsRow() {
  const { selectedProject } = useProject();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SidebarActionRow icon={Braces} label="Updateconnectors" onClick={() => setOpen(true)} />

      {open && (
        <UpdateConnectorsDialog
          fromProjectId={selectedProject.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
