"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, FolderPlus } from "lucide-react";
import { useAuth, useIsAdmin } from "@/components/AuthProvider";
import { NavigationGuardProvider } from "@/components/NavigationGuard";
import NewProjectDialog from "@/components/NewProjectDialog";
import ProjectPickerModal from "@/components/ProjectPickerModal";
import { MANAGEMENT_REPORT_PATH, projectPath } from "@/lib/routes";
import { useT } from "@/lib/i18n";

/**
 * The front door. Every page below it belongs to a project, so this one has nothing
 * of its own to show — it decides which project to open.
 *
 * With several projects that is a real choice, so
 * [`ProjectPickerModal`](../components/ProjectPickerModal.tsx) asks it; with one, `/`
 * forwards to it (`replace`, so the back button doesn't bounce off a redirect). With
 * none — a fresh install — it offers *Nieuw project*.
 */
export default function Home() {
  const { session, isManager, projectChoicePending, projectChoiceOffered } = useAuth();
  const isAdmin = useIsAdmin();
  const t = useT();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const projects = useMemo(() => session?.projects ?? [], [session]);

  const choose = isAdmin && projects.length > 1;
  const firstProjectId = choose || isManager ? null : (projects[0]?.id ?? null);

  useEffect(() => {
    if (isManager) router.replace(MANAGEMENT_REPORT_PATH);
    else if (firstProjectId) router.replace(projectPath(firstProjectId));
  }, [isManager, firstProjectId, router]);

  // The dialog below *is* the ask, so nothing downstream has to repeat it.
  useEffect(() => {
    if (choose && projectChoicePending) projectChoiceOffered();
  }, [choose, projectChoicePending, projectChoiceOffered]);

  if (choose) {
    return (
      // The picker's entries are `GuardedLink`s and there is no project shell here
      // to have mounted the provider they ask. Nothing installs a guard at `/` —
      // there is no open sheet to leave — so every link goes straight through; this
      // is only what keeps the app down to one link component.
      <NavigationGuardProvider>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-k-bg text-k-cloud-deep shadow-raised">
            <FileSpreadsheet className="h-6 w-6" strokeWidth={2} />
          </span>
          <p className="text-sm text-k-text-secondary">Nymbus Conversies</p>
        </div>
        {/* No `onClose`: there is nothing behind this page to dismiss to, so
            picking a project is the way on. */}
        <ProjectPickerModal projects={projects} />
      </NavigationGuardProvider>
    );
  }

  if (firstProjectId || isManager) return null; // one frame, on the way there

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-105 flex-col items-center rounded-3xl bg-k-bg px-11 pt-11 pb-9 text-center shadow-raised">
        <h1 className="text-lg font-semibold text-k-text-primary">{t("Nog geen projecten", "No projects yet")}</h1>
        <p className="mt-2 text-sm text-k-text-secondary">
          {t(
            "Maak een project aan voor de klant die je gaat converteren.",
            "Create a project for the client you are going to convert."
          )}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="neu-action-primary mt-5"
        >
          <FolderPlus className="h-4 w-4" />
          {t("Nieuw project", "New project")}
        </button>
      </div>
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false);
            router.push(projectPath(project.id));
          }}
        />
      )}
    </div>
  );
}
