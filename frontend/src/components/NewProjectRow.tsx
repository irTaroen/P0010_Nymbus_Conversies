"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import NewProjectDialog from "@/components/NewProjectDialog";
import { useNavigationGuard } from "@/components/NavigationGuard";
import SidebarActionRow from "@/components/SidebarActionRow";
import { projectPath } from "@/lib/routes";
import { useT } from "@/lib/i18n";

/** The sidebar row that opens *Nieuw project*, and goes to the project once made. */
export default function NewProjectRow() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { navigate } = useNavigationGuard();

  return (
    <>
      <SidebarActionRow
        icon={FolderPlus}
        label={t("Nieuw project", "New project")}
        onClick={() => setOpen(true)}
        expanded={open}
      />
      {open && (
        <NewProjectDialog
          onClose={() => setOpen(false)}
          onCreated={(project) => {
            setOpen(false);
            navigate(projectPath(project.id));
          }}
        />
      )}
    </>
  );
}
