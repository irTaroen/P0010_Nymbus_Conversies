"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DatabaseZap, Loader2, PlugZap, RotateCw, Settings, Unplug } from "lucide-react";
import { useIsAdmin } from "@/components/AuthProvider";
import ProjectSettingsDialog from "@/components/ProjectSettingsDialog";
import {
  fetchMe,
  reloadMe,
  type AfasConnectionState,
  type Project,
} from "@/lib/auth";
import {
  checkProjectConnections,
  connectionFailures,
  subscribeToConnectionChecks,
} from "@/lib/connection-check";
import type { SettingsStage } from "@/lib/project-settings";
import { tr, useT } from "@/lib/i18n";
import { setSession, withSessionReload } from "@/lib/session-store";

/**
 * "This project has no AFAS behind it yet" — the one setup gap in this app that
 * somebody on this side of the screen can actually close.
 *
 * A project's uploads, codetabellen and existence checks all run against the
 * **customer's** AFAS environment, and which one that is comes from the
 * projectinstellingen: an omgevingsnummer plus an OAuth client id and secret per
 * stage (`project.afasConnection`, see `lib/auth.ts`). Until those are stored,
 * every one of those calls fails — and it used to fail *late*, at the first upload,
 * with AFAS's own words about a token nobody had configured. So {@link
 * AfasConnectionNotice} says it up front: a band on the project's own page, with the
 * button that opens `ProjectSettingsDialog` on the spot.
 *
 * **The picker says it too, but not from here.** This module used to export a
 * matching `AfasConnectionTag` chip for the picker's rows. The picker now has a
 * *Connection* column reporting the same store one level finer — a `LIVE` and a
 * `TEST` tag off `project.afasStages` rather than one chip off the rolled-up
 * `afasConnection` — so the chip was saying, less precisely and in a whole line of
 * row, what the column beside it already said. It went; the column is the picker's
 * answer, this band the project page's.
 *
 * **Admins only — both of them.** A client contact can't open the settings dialog
 * ([`ProjectSettings`](./ProjectSettings.tsx) is behind `AdminOnly`, and so is the
 * backend route), so telling them their project isn't connected would name a
 * problem they have no way to act on — and they'd read it as *this tool is broken*.
 * Each component gates itself rather than leaving it to the caller, since the rule
 * is about the message and not about where it is shown. The same rule takes the
 * picker's *Connection* column away from a non-admin
 * ([`ProjectPickerModal`](./ProjectPickerModal.tsx)), so nothing in the app says
 * *client id* to somebody who has no form to type one into.
 *
 * Nothing here is a credential: `afasConnection` says only how far the form got.
 */

/**
 * The wording per state, once — a chip and a band that disagreed about what is
 * missing would leave an admin guessing which of the two to believe.
 *
 * The strings are getters, read when shown, so the language follows the switch.
 *
 * **`unavailable` is not a worse `none`, it is a different fact, and that is the
 * whole reason it exists.** The other two entries describe a form: nobody filled it
 * in, or somebody filled in half of it. Both are claims about what is *stored*, and
 * both are jobs for the reader — open the dialog, type the credentials, done. When
 * the settings store itself can't be read, the tool knows none of that. It used to
 * say `none` anyway (`_connection_states()` answered `{}` on a failed read and every
 * project fell through to `NO_CONNECTION`), which put *dit project heeft nog geen
 * AFAS-koppeling* in front of an admin whose project was perfectly configured —
 * and sent them into a dialog to re-enter credentials that were already there, or
 * worse, to conclude a colleague's work had been lost.
 *
 * So this state says what actually happened, and says the opposite of a to-do: there
 * is nothing to fill in, the database holding the settings is unreachable, and the
 * thing to do is wait or call whoever runs it. Red rather than amber, because amber
 * across this app means *read this before you go on* — a setup gap someone on this
 * screen closes — and this is not that. The credentials are almost certainly fine.
 */
const COPY: Record<
  Exclude<AfasConnectionState, "complete">,
  { tag: string; title: string; body: string }
> = {
  none: {
    get tag() { return tr("Geen AFAS-koppeling", "No AFAS connection"); },
    get title() { return tr("Dit project heeft nog geen AFAS-koppeling", "This project does not have an AFAS connection yet"); },
    get body() {
      return tr(
        "Er is geen omgevingsnummer, client id of client secret ingesteld, voor test " +
          "noch live. Zolang die ontbreken kan er niets van of naar AFAS.",
        "No environment number, client ID or client secret is set, for test or live. " +
          "Until they are, nothing can go to or come from AFAS.",
      );
    },
  },
  partial: {
    get tag() { return tr("AFAS-koppeling incompleet", "AFAS connection incomplete"); },
    get title() { return tr("De AFAS-koppeling van dit project is niet compleet", "The AFAS connection for this project is not complete"); },
    get body() {
      return tr(
        "Een omgeving heeft een omgevingsnummer én een client id met client secret " +
          "nodig. Controleer de test- en live-omgeving en test de verbinding.",
        "An environment needs an environment number and a client ID with a client secret. " +
          "Check the test and live environments, and test the connection.",
      );
    },
  },
  unavailable: {
    get tag() { return tr("Instellingen onbereikbaar", "Settings unreachable"); },
    get title() { return tr("De projectinstellingen zijn nu niet te lezen", "The project settings cannot be read right now"); },
    get body() {
      return tr(
        "De database met de AFAS-instellingen is onbereikbaar. Er is waarschijnlijk " +
          "niets mis met dit project — vul niets opnieuw in en probeer het zo nog eens.",
        "The database holding the AFAS settings is unreachable. There is probably nothing " +
          "wrong with this project — don't re-enter anything, and try again in a moment.",
      );
    },
  },
};

/** The tint per state: a setup gap is amber (*doe hier iets aan*), an unreachable
 *  store red (*er is iets stuk, en niet bij jou*). Kept together so a future state
 *  can't be given copy without a tone. */
const TONE: Record<
  Exclude<AfasConnectionState, "complete">,
  { band: string; button: string; icon: typeof PlugZap }
> = {
  none: {
    band: "bg-k-amber-bg text-k-amber-fg",
    button: "text-k-amber-fg! hover:text-k-amber-fg!",
    icon: PlugZap,
  },
  partial: {
    band: "bg-k-amber-bg text-k-amber-fg",
    button: "text-k-amber-fg! hover:text-k-amber-fg!",
    icon: PlugZap,
  },
  unavailable: {
    band: "bg-k-red-bg text-k-red-fg",
    button: "text-k-red-fg! hover:text-k-red-fg!",
    icon: DatabaseZap,
  },
};

/**
 * The retry behind an `"unavailable"` notice: re-read the session from its sources
 * and write it back.
 *
 * **It really retries.** The first version of this button only renamed the
 * *Projectinstellingen* one — same `setOpen(true)`, new label — which is worse than
 * either honest option: it promised a retry and opened a form, and that form could
 * only run the same failed read and show it back as an error. A button labelled
 * *Opnieuw proberen* has to do the thing.
 *
 * `reloadMe()` rather than `fetchMe()` because the settings database is exactly what
 * separates them: the shallow call replays the stored session with its connection
 * fields re-derived, which is the same read that just failed, while the deep one
 * rebuilds from AFAS and the settings store both. Wrapped in `withSessionReload` so
 * a `fetchMe()` racing it (`AuthProvider` fires one on load) can't overwrite the
 * fresher answer with the stale session it was already holding.
 *
 * **No success state, on purpose.** When the read lands, `afasConnection` stops
 * being `"unavailable"` and the notice unmounts itself — a confirmation would be a
 * message rendered by a component that no longer exists. A failure re-renders the
 * same band, which is already the message: the store is still unreachable. Only the
 * in-flight spinner is worth showing, because that is the one state the band cannot
 * express on its own.
 */
function useConnectionRetry(): { retry: () => void; retrying: boolean } {
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(() => {
    setRetrying(true);
    withSessionReload(reloadMe)
      .then(setSession)
      .catch(() => {})
      .finally(() => setRetrying(false));
  }, []);
  return { retry, retrying };
}

/**
 * The action on the right of either notice: *Projectinstellingen* when there is a
 * form to fill in, *Opnieuw proberen* when there is nothing to fill in and the read
 * simply has to be made again.
 *
 * One component for both because the two must never drift into looking like
 * different kinds of thing — they sit in the same corner of the same band, and the
 * only difference that matters is which of the two the state calls for.
 */
function NoticeAction({
  unavailable,
  onOpenSettings,
  tone,
  size,
}: {
  unavailable: boolean;
  onOpenSettings: () => void;
  tone: string;
  /** The card band and the one-line strip size their controls differently. */
  size: "card" | "strip";
}) {
  const { retry, retrying } = useConnectionRetry();
  const t = useT();
  const metrics =
    size === "card" ? "h-9 px-3 text-sm" : "h-8 px-2.5 text-xs";
  const className = `neu-button inline-flex ${metrics} shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full font-medium ${tone}`;

  if (unavailable) {
    return (
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className={className}
      >
        {retrying ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
        ) : (
          <RotateCw className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        )}
        {retrying ? t("Bezig…", "Working…") : t("Opnieuw proberen", "Try again")}
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpenSettings} className={className}>
      <Settings className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      {t("Projectinstellingen", "Project settings")}
    </button>
  );
}

/**
 * The band on the project's own page: what is missing, and the button that opens
 * the projectinstellingen with this project already loaded.
 *
 * Amber, the app's notice tone, and a band rather than a badge: on the page
 * of the project you just opened this is the first thing to know about it, and the
 * app's amber notice ([`Notices`](./uploader/Notices.tsx)) is what it already uses
 * for "read this before you go on". It is not built from `AmberNotice` itself
 * because this one carries a heading and an action beside the text, where that
 * component is one line of copy — but it wears the same ink, so the two read as
 * one family.
 *
 * Renders nothing once the project is connected, so callers need no guard — the
 * same contract `MissingColumnsNotice` follows.
 */
export function AfasConnectionNotice({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  useT(); // the copy below is read at render, so re-render on a language switch
  const [open, setOpen] = useState(false);

  if (!isAdmin || project.afasConnection === "complete") return null;
  const copy = COPY[project.afasConnection];
  const tone = TONE[project.afasConnection];
  const Icon = tone.icon;
  const unavailable = project.afasConnection === "unavailable";

  return (
    <>
      <div
        role="status"
        className={`flex flex-wrap items-start gap-3 rounded-xl px-4 py-3.5 ${tone.band} ${className}`.trim()}
      >
        <Icon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{copy.title}</p>
          <p className="mt-1 text-sm leading-snug">{copy.body}</p>
        </div>
        {/* A raised pill on the tint rather than a filled accent button: the band is already
            the loud thing on the page, and a filled accent button inside a tinted
            band reads as a second alarm rather than as the way out of the first.

            Two different actions behind one slot — see `NoticeAction`. A setup gap
            opens the form; an unreachable store re-runs the read, because there is
            nothing to fill in and the dialog could only show the same failure. */}
        <NoticeAction
          unavailable={unavailable}
          onOpenSettings={() => setOpen(true)}
          tone={tone.button}
          size="card"
        />
      </div>

      {/* Mounted only while open, so it fetches the stored settings fresh — the same
          way the sidebar's row opens it.

          Closing it **re-reads the session**, because `afasConnection` rides along
          with the project list and nothing else would tell this band that the gap it
          is complaining about has just been filled. Without it an admin would save
          their credentials, watch the connection test go green, and still be looking
          at "dit project heeft nog geen AFAS-koppeling" until they reloaded — which
          reads as a save that didn't take. A failure is ignored on purpose: the band
          staying up one moment longer is a smaller lie than a band that vanished on
          a fetch that never landed, and `requestJson` already signs out a session
          the backend has stopped recognising. */}
      {open && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          initialTab="afas"
          onClose={() => {
            setOpen(false);
            void fetchMe().then(setSession).catch(() => {});
          }}
        />
      )}
    </>
  );
}

/**
 * Whether {@link AfasStageNotice} would render anything — its own two conditions,
 * asked before the element exists.
 *
 * `NoticeCarousel` counts the items it is handed, and a React element is truthy
 * whether or not the component behind it returns `null`, so a notice that gates
 * itself still claims a page: the counter reads `1 / 2` and the second page is an
 * empty band. The condition lives here beside the component rather than being
 * copied into the panel, and the component keeps its own guard for callers that
 * render it directly.
 */
export function useAfasStageNotice(
  project: Project,
  stage: "test" | "live",
): boolean {
  const isAdmin = useIsAdmin();
  return isAdmin && !project.afasStages[stage];
}

/** Whether the stage flags may be read as facts at all. They are plain booleans, so
 *  an unreadable settings store leaves both `false` — indistinguishable, at the
 *  flag, from *niets ingesteld*. `afasConnection` is the only field that keeps the
 *  two apart, so everything drawing a flag asks this first. */
function connectionUnknown(project: Project): boolean {
  return project.afasConnection === "unavailable";
}

/**
 * The same gap, said on the payload screen and **per stage** — the notice that
 * overrules every downstream complaint about AFAS not answering.
 *
 * `AfasConnectionNotice` above is about the project: *is there any AFAS behind
 * this at all*. This one is about the environment the send switch is pointing at
 * right now. A project can be perfectly set up for test and have nothing stored
 * for live, and on this screen that difference is the whole story: flipping the
 * switch to live is what breaks the existence read, and the read's own error
 * ("de AFAS-omgeving is niet compleet ingesteld") describes the symptom of a
 * cause that is one dialog away.
 *
 * So where the panel would show that error, it shows this instead — the cause,
 * naming the stage, with the way to fix it. The read's message is not merely
 * redundant next to this one, it is misleading: it reads as *AFAS is down* when
 * the truth is *nobody filled in this half of the form*.
 *
 * It says only that, in one line: the stage that has no credentials, and the
 * button that opens the dialog where they go. The explanation this used to carry
 * (which of the two secrets is missing, whether the other stage does have them,
 * what stays broken until they are filled in) is all visible in that dialog,
 * so on the panel it was words between the reader and the fix.
 *
 * **Admins only, like everything else that names a missing credential.** This used
 * to be the one exception — shown to everyone, with only the button gated — on the
 * reasoning that a client contact staring at unmarked records needs to know why.
 * They never see it: the panel it lives on is `AdminOnly` by placement
 * ([`ModulePayloadPanel`](./uploader/ModulePayloadPanel.tsx)), so the non-admin
 * wording was copy nobody could reach. It gates itself now for the same reason
 * {@link AfasConnectionNotice} does — the rule is about the message, not about
 * where it is shown — so no future caller can put a *er is geen client id
 * ingesteld* in front of somebody who can only read it as a broken tool.
 */
export function AfasStageNotice({
  project,
  stage,
  className = "",
}: {
  project: Project;
  stage: "test" | "live";
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  const t = useT();
  const [open, setOpen] = useState(false);

  if (!isAdmin || project.afasStages[stage]) return null;
  const label = stage === "live" ? t("live-omgeving", "live environment") : t("testomgeving", "test environment");

  // The same distinction the band above makes, in one line. `afasStages[stage]` is
  // `false` both when nothing is stored and when nothing could be read, and on this
  // screen the difference decides what the reader does next: fill in the form, or
  // wait. Saying *er zijn geen inloggegevens opgeslagen* during a Fabric outage is a
  // statement about the store that the tool has no grounds for.
  const unknown = connectionUnknown(project);
  const tone = unknown ? TONE.unavailable : TONE.none;
  const Icon = tone.icon;

  return (
    <>
      <div
        role="status"
        className={`flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] ${tone.band} ${className}`.trim()}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 font-semibold">
          {unknown
            ? t(
                `De projectinstellingen zijn nu niet te lezen — of de ${label} is ingesteld, is onbekend`,
                `The project settings cannot be read right now — whether the ${label} is set up is unknown`,
              )
            : t(
                `Voor de ${label} zijn geen AFAS-inloggegevens opgeslagen`,
                `No AFAS login details are stored for the ${label}`,
              )}
        </span>
        <NoticeAction
          unavailable={unknown}
          onOpenSettings={() => setOpen(true)}
          tone={tone.button}
          size="strip"
        />
      </div>

      {/* Re-reads the session on close for the same reason the band above does: the
          stage flags ride along with the project list, and nothing else would tell
          this notice that the credentials it is complaining about now exist. */}
      {open && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          initialTab="afas"
          onClose={() => {
            setOpen(false);
            void fetchMe().then(setSession).catch(() => {});
          }}
        />
      )}
    </>
  );
}

/** The stages a project has credentials stored for — the ones worth testing. */
function storedStages(project: Project): SettingsStage[] {
  return (["test", "live"] as const).filter((stage) => project.afasStages[stage]);
}

/**
 * Test the project's **stored** credentials once per project entered — admins only,
 * since the route is admin-only and only an admin can act on the answer. See
 * [`lib/connection-check.ts`](../lib/connection-check.ts).
 *
 * Latched on the project id like `useProjectRefresh` in the project layout, so
 * walking between modules doesn't re-ask and switching projects does. A session
 * whose settings store couldn't be read (`"unavailable"`) is not latched: the stage
 * flags are unknown there, and the reload the layout fires on entry may bring them.
 */
export function useConnectionCheckOnEntry(project: Project): void {
  const isAdmin = useIsAdmin();
  const checked = useRef<string | null>(null);
  const { id, afasConnection } = project;
  const { test, live } = project.afasStages;
  useEffect(() => {
    if (!isAdmin || checked.current === id || afasConnection === "unavailable") return;
    checked.current = id;
    const stages = (["test", "live"] as const).filter((stage) =>
      stage === "test" ? test : live,
    );
    if (stages.length) void checkProjectConnections(id, stages);
  }, [isAdmin, id, afasConnection, test, live]);
}

/**
 * The answer to that check, when it is *no*: which environment AFAS refused, in
 * AFAS's own words, and the button to the form where the credentials are fixed.
 * Renders nothing while the check runs, when every stored stage works, and for
 * anyone who isn't an admin — a working connection is not news.
 *
 * Red rather than amber: amber is a form nobody filled in, and this one *is* filled
 * in — what is there is broken. Closing the dialog tests again, so a fixed token
 * takes the band away without a reload.
 */
export function AfasTokenNotice({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  const t = useT();
  const [open, setOpen] = useState(false);
  const failures = useSyncExternalStore(
    subscribeToConnectionChecks,
    () => connectionFailures(project.id),
    () => connectionFailures(project.id),
  );

  if (!isAdmin || failures.length === 0) return null;
  const stageLabel = (stage: SettingsStage) =>
    stage === "live" ? t("Live-omgeving", "Live environment") : t("Testomgeving", "Test environment");
  const title =
    failures.length === 2
      ? t("De AFAS-verbinding werkt niet, voor test noch live", "The AFAS connection doesn't work, for test or live")
      : failures[0].stage === "live"
        ? t("De verbinding met de live-omgeving werkt niet", "The connection to the live environment doesn't work")
        : t("De verbinding met de testomgeving werkt niet", "The connection to the test environment doesn't work");

  return (
    <>
      <div
        role="status"
        className={`flex flex-wrap items-start gap-3 rounded-xl px-4 py-3.5 ${TONE.unavailable.band} ${className}`.trim()}
      >
        <Unplug className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-snug">
            {t(
              "De opgeslagen inloggegevens worden door AFAS geweigerd. Controleer het token en test de verbinding opnieuw.",
              "AFAS rejects the stored login details. Check the token and test the connection again.",
            )}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm leading-snug">
            {failures.map((failure) => (
              <li key={failure.stage}>
                <span className="font-semibold">{stageLabel(failure.stage)}:</span> {failure.message}
              </li>
            ))}
          </ul>
        </div>
        <NoticeAction
          unavailable={false}
          onOpenSettings={() => setOpen(true)}
          tone={TONE.unavailable.button}
          size="card"
        />
      </div>

      {open && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          initialTab="afas"
          onClose={() => {
            setOpen(false);
            void fetchMe()
              .then((session) => {
                setSession(session);
                const fresh = session.projects.find((p) => p.id === project.id);
                return checkProjectConnections(project.id, storedStages(fresh ?? project));
              })
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}
