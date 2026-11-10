"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { useConnectionCheckOnEntry } from "@/components/AfasConnection";
import { useAuth } from "@/components/AuthProvider";
import DesktopOnlyNotice from "@/components/DesktopOnlyNotice";
import DossierMigrationPage from "@/components/DossierMigrationPage";
import {
  FocusModeProvider,
  panelSizeClass,
  PANEL_TRANSITION,
  useFocusMode,
} from "@/components/FocusModeProvider";
import MobileTopBar from "@/components/MobileTopBar";
import RouteNotice from "@/components/RouteNotice";
import Sidebar from "@/components/Sidebar";
import { useEscapeKey } from "@/components/useEscapeKey";
import { CodetabellenProvider } from "@/components/CodetabellenProvider";
import { ModuleProvider } from "@/components/ModuleProvider";
import { NavigationGuardProvider } from "@/components/NavigationGuard";
import { ProgressProvider } from "@/components/ProgressProvider";
import { ProjectProvider, useProject } from "@/components/ProjectProvider";
import { SendRunProvider } from "@/components/SendRunProvider";
import { reloadMe } from "@/lib/auth";
import { setSession, withSessionReload } from "@/lib/session-store";
import { useT } from "@/lib/i18n";
import { HOME_PATH } from "@/lib/routes";

/**
 * The project shell: sidebar on the left, the module's page on the right, and the four
 * contexts that belong to *this* project around both.
 *
 * The URL's project segment is resolved here, against the projects the session
 * carries, and everything below is mounted with the project it found — so a page
 * never has to wonder whether it has one. A segment naming a project this user may not
 * open renders [`RouteNotice`](../../components/RouteNotice.tsx) instead of the shell:
 * with projects in the address bar, that URL is now typeable.
 *
 * **It is not an access check.** Hiding a project the session doesn't list is the same
 * cosmetic gate as `AdminOnly` — the backend's endpoints are what actually decide, and
 * today they decide nothing at all (docs/todo.md → *Nothing behind the login is
 * actually protected*). This layout is the natural place to enforce it once sessions
 * carry a verifiable credential; today it only keeps the UI honest.
 *
 * `useParams()` rather than the `params` promise: the whole subtree is client-side
 * anyway (the session lives in `sessionStorage`), and the hook needs no Suspense
 * boundary around it.
 *
 * A project whose `conversionType` is `"dossier"` renders `DossierMigrationPage`
 * instead of `children` — its whole page, in place of the sidebar and whatever
 * module the URL's second segment would otherwise resolve to. See
 * `DossierMigrationPage.tsx`.
 */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const { project: projectId } = useParams<{ project: string }>();
  useProjectRefresh(projectId);
  const t = useT();
  // `AuthGate` above us only renders children with a session, so `projects` is really
  // there; the fallback is for the frame a sign-out could slip through.
  const project = session?.projects.find((p) => p.id === projectId) ?? null;

  if (!project) {
    return (
      <RouteNotice
        title={t("Project niet gevonden", "Project not found")}
        description={
          t(
            <>
              Project <strong>{projectId}</strong> hoort niet bij{" "}
              {session?.user.email ?? "dit account"}, of bestaat niet.
            </>,
            <>
              Project <strong>{projectId}</strong> does not belong to{" "}
              {session?.user.email ?? "this account"}, or does not exist.
            </>
          )
        }
        action={{ href: HOME_PATH, label: t("Naar mijn projecten", "Go to my projects") }}
      />
    );
  }

  // A dossierconversie project has no modules and no Excel upload flow at all
  // — its whole page is source/target AFAS config, mapping tables and the
  // migration run, so it skips the module/progress/codetabel providers
  // and the sidebar entirely rather than rendering an empty version of them.
  if (project.conversionType === "dossier") {
    return (
      <ProjectProvider project={project}>
        <NavigationGuardProvider>
          <DesktopOnlyNotice />
          <DossierMigrationPage />
        </NavigationGuardProvider>
      </ProjectProvider>
    );
  }

  return (
    <ProjectProvider project={project}>
      <ModuleProvider>
        <ProgressProvider>
          {/* Fetched with the project, like progress, so a module's files panel
              opens already knowing what (if anything) was posted there. */}
          
            {/* Above the payload panel, and above the module route: a send is a
                background run that has to keep reporting while somebody works on
                another module — see `SendRunProvider`. */}
            <SendRunProvider>
              <CodetabellenProvider>
                {/* Outside the sidebar and the page both: the sidebar's links ask it
                    whether they may navigate, the page installs what it answers with. */}
                <NavigationGuardProvider>
                  {/* Focus mode wraps the sidebar **and** the page: the toolbar's
                      button lives below, the panel that gets out of its way is here. */}
                  <FocusModeProvider>
                    <ProjectShell>{children}</ProjectShell>
                  </FocusModeProvider>
                </NavigationGuardProvider>
              </CodetabellenProvider>
            </SendRunProvider>
          
        </ProgressProvider>
      </ModuleProvider>
    </ProjectProvider>
  );
}

/**
 * The sidebar and the page beside it — its own component only so it can read
 * `useFocusMode()`, which the layout above it provides and therefore cannot see.
 *
 * In focus mode the sidebar **stays mounted** and its wrapper closes to zero width
 * (`PANEL_TRANSITION`). Unmounting it would be cheaper — nothing off-screen would
 * re-render on a progress poll — but there is nothing to animate once the element is
 * gone, and the sheet stretching into space that appeared in one frame is the jump
 * this is meant to remove. It re-renders in place instead, which costs a poll's worth
 * of work on a subtree nobody is looking at, twice per toggle.
 *
 * `aria-hidden` while closed, so a screen reader isn't offered a nav that has no
 * width, and `inert` so its links drop out of the tab order — a keyboard user
 * tabbing into an invisible sidebar would otherwise lose their place entirely.
 *
 * **Below `lg` the same wrapper is a drawer** (the `max-lg:` classes): fixed over the
 * page's left edge, slid out of view and `invisible` until `MobileTopBar`'s menu
 * button opens it, over a backdrop that closes it again. Still the one `Sidebar` —
 * a phone gets the same rows, not a copy to keep in step. It slides on `translate`
 * and rests at `translate-none` when open, not `translate-x-0`: any transform makes
 * the panel the containing block of its `fixed` children, and the dialogs the
 * sidebar opens (project picker, settings, users) would be laid out inside a 272px
 * strip instead of over the screen. `invisible` does for the closed drawer what
 * `inert` does for focus mode, and the transition flips it only once the slide is
 * over. Focus mode itself has no say down here — it is a desktop trade of width —
 * so the drawer overrides its width and doesn't go inert while open.
 *
 * The drawer closes when the path changes (a module row, the brand mark), which is
 * why it records *where* it was opened rather than a plain boolean: navigating
 * makes the two differ, with no effect needed to notice it.
 */
function ProjectShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { focused } = useFocusMode();
  // Does what is stored for this project still get into AFAS? Asked once on entry,
  // in the background; a refusal surfaces on the project page (`AfasTokenNotice`).
  useConnectionCheckOnEntry(useProject().selectedProject);
  const pathname = usePathname();
  const [navOpenAt, setNavOpenAt] = useState<string | null>(null);
  const navOpen = navOpenAt === pathname;
  const panelRef = useRef<HTMLDivElement>(null);
  // A dialog the sidebar opened sits inside the drawer and takes its own Escape;
  // closing the drawer under it would hide it with it.
  useEscapeKey(() => {
    if (!panelRef.current?.querySelector('[role="dialog"]')) setNavOpenAt(null);
  }, navOpen);
  return (
    <div className="flex min-h-0 flex-1">
      {navOpen && (
        <button
          type="button"
          aria-label={t("Menu sluiten", "Close menu")}
          onClick={() => setNavOpenAt(null)}
          className="fixed inset-0 z-40 cursor-default bg-k-text-primary/20 lg:hidden"
        />
      )}
      <div
        ref={panelRef}
        className={`h-full ${PANEL_TRANSITION} ${panelSizeClass(focused, "w-68")} max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-68 max-lg:max-w-[85vw] max-lg:bg-k-bg max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)] max-lg:pl-[env(safe-area-inset-left)] max-lg:opacity-100 max-lg:shadow-raised max-lg:transition-[translate,visibility] max-lg:duration-200 max-lg:ease-out ${
          navOpen ? "max-lg:translate-none" : "max-lg:invisible max-lg:-translate-x-full"
        }`}
        aria-hidden={focused && !navOpen}
        inert={focused && !navOpen}
      >
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopBar onOpenNav={() => setNavOpenAt(pathname)} />
        {/* Focus mode trades the page's side padding for width too — a full-bleed
            sheet with a 16px gutter reads as a page that failed to lay out, so it
            keeps a smaller one rather than none. */}
        <main
          className={`w-full flex-1 min-h-0 flex flex-col overflow-hidden pt-3 sm:pt-4 ${
            focused ? "px-2" : "px-4"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Re-read the session from **AFAS** once per project entered, so the project this
 * shell mounts is not the copy that was true at login.
 *
 * A session is minted once and then kept in `sessionStorage` for the life of the tab.
 * Most of what it carries is fixed for that lifetime — who you are, which projects you
 * may open — but a project's own fields are not: `hrmPeriodetabel`, `livegangDatum`,
 * `conversionType`, `status`, `moduleCount` and `deeltaakcodes` all live on the
 * project's dossieritem in AFAS, where a consultant maintains them in Profit, with
 * nothing on this side able to hear about it.
 *
 * That silence is not merely a stale number on screen; it makes the app **say
 * something false about itself**. `ConversionSettingsNotice` reads the session's
 * `hrmPeriodetabel`/`livegangDatum` to decide whether this facilitaire conversie can
 * fill its own columns, so a project whose settings were filled in after this tab
 * signed in gets the band telling an admin the dossieritem is empty — over a
 * *Conversie* tab that reads AFAS live and shows them filled in. Two bits of the same
 * screen, disagreeing, and the one that is wrong is the one shouting.
 *
 * **`reloadMe()`, not `fetchMe()`.** The two are different depths and only one of them
 * helps: `fetchMe()` replays the stored session and re-derives the AFAS *connection*
 * fields alone, which is why the settings dialogs can afford to call it on every
 * close — and why calling it here would put the same stale periodetabel straight back.
 * `?reload=1` is the one that goes out to AFAS (`backend/main.py` → `_session_for`).
 *
 * **Once per project, latched on the id.** The effect is keyed by the URL's project
 * segment rather than by mount, so walking between that project's modules — which
 * re-renders this layout on every navigation — doesn't re-ask; switching to another
 * project does. The cost is one reload per project entered, against a backend whose
 * AFAS reads are themselves cached for `NYMBUS_CACHE_TTL` (300s), so a session moving
 * between two projects is not making an AFAS round trip each time.
 *
 * **Fire-and-forget, and deliberately not a loading state.** The session already in
 * hand is good enough to render the shell — it resolved the URL a line above — and
 * blocking the whole project behind an AFAS call to sharpen a handful of fields would
 * trade a rare wrong banner for a spinner on every entry. A failure leaves the session
 * exactly as it was, which is still the best answer available; a 401 is already turned
 * into a sign-out by `requestJson`. This is the same shape, and the same reasoning, as
 * `AuthProvider`'s post-hydration `fetchMe()` and the project picker's *ververs*.
 */
function useProjectRefresh(projectId: string): void {
  // The project the last reload was fired for. A ref rather than state: nothing
  // renders off it, and setting state here would re-run the effect it guards.
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || refreshed.current === projectId) return;
    refreshed.current = projectId;
    void withSessionReload(reloadMe)
      .then(setSession)
      .catch(() => {});
  }, [projectId]);
}
