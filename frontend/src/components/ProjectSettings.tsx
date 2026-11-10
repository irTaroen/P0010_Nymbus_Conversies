"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useProject } from "@/components/ProjectProvider";
import ProjectSettingsDialog from "@/components/ProjectSettingsDialog";
import { useAuth } from "@/components/AuthProvider";
import { useNavigationGuard } from "@/components/NavigationGuard";
import { HOME_PATH } from "@/lib/routes";
import SidebarActionRow from "@/components/SidebarActionRow";
import { useT } from "@/lib/i18n";

/**
 * Admin-only sidebar row: configure the **active** project — pick another one in the
 * project selector above to configure that one instead. The form itself lives in
 * [`ProjectSettingsDialog`](./ProjectSettingsDialog.tsx), which is mounted only while
 * open so it loads the stored settings fresh every time.
 *
 * The sidebar wraps this in [`AdminOnly`](./AdminOnly.tsx) — that, and not the
 * guard below, is what keeps it away from non-admins; viewing the app as another
 * user hands us their (non-admin) session, so it disappears along with `UsersRow`.
 */
export default function ProjectSettings() {
  const { selectedProject } = useProject();
  const t = useT();
  const [open, setOpen] = useState(false);
  const { refresh } = useAuth();
  const { navigate } = useNavigationGuard();

  return (
    <>
      <SidebarActionRow icon={Settings} label={t("Projectinstellingen", "Project settings")} onClick={() => setOpen(true)} />

      {/* Closing re-reads the session: a project's `afasConnection` / `afasStages`
          and name ride along with the project list, and this dialog is where they
          change. */}
      {open && (
        <ProjectSettingsDialog
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          onClose={() => {
            setOpen(false);
            void refresh();
          }}
          onProjectDeleted={() => {
            setOpen(false);
            navigate(HOME_PATH, { force: true });
          }}
        />
      )}
    </>
  );
}
