"use client";

import { createContext, useContext, useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { Project } from "@/lib/auth";

interface ProjectContextValue {
  /** The projects the signed-in user may open (all of them for admins). */
  projects: Project[];
  /** Whether there is anything to switch between — i.e. more than one project. */
  canSwitchProject: boolean;
  /** The open project, as the URL named it. */
  selectedProject: Project;
  /** Shorthand for `selectedProject.id` — most callers only want the id. */
  selectedProjectId: string;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/**
 * The project the app is currently in — the one in the URL.
 *
 * It holds no state of its own: `app/[project]/layout.tsx` resolves the URL's project
 * segment against the session's projects and only mounts this with the one it found,
 * so *the URL is the selection*. That is also why `selectedProject` is not nullable —
 * a project that isn't in the session never gets this far — and why switching project
 * is a navigation ([`GuardedLink`](./NavigationGuard.tsx) in `ProjectSelector`)
 * rather than a setter.
 *
 * The list of projects still comes from the session (`AuthProvider`); there is no
 * separate project catalog on the frontend.
 */
export function ProjectProvider({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}) {
  const { session } = useAuth();
  const projects = useMemo(() => session?.projects ?? [], [session]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      canSwitchProject: projects.length > 1,
      selectedProject: project,
      selectedProjectId: project.id,
    }),
    [projects, project]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return ctx;
}

/**
 * The project context when there is one, `null` on a page outside a project (the
 * connector explorer at `/afas/updateconnectors`). For the few readers that work
 * either way, such as the AFAS-lookup dialog, which reads the current project's
 * environment when it can.
 */
export function useOptionalProject(): ProjectContextValue | null {
  return useContext(ProjectContext);
}
