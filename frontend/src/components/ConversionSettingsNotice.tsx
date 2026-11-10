"use client";

import { useState } from "react";
import { SlidersHorizontal, Settings } from "lucide-react";
import { useIsAdmin } from "@/components/AuthProvider";
import ProjectSettingsDialog from "@/components/ProjectSettingsDialog";
import { fetchMe, type Project } from "@/lib/auth";
import { tr, useT } from "@/lib/i18n";
import { isReloadingSession, setSession } from "@/lib/session-store";
import {
  unfilledStandardColumns,
  unfilledStandardColumnsForProject,
  type UnfilledStandardColumns,
} from "@/lib/standard-columns";

/**
 * "This facilitaire conversie has columns the app should be filling, and can't" —
 * the second setup gap an admin can close from inside the app.
 *
 * A facilitaire conversie doesn't ask the client for its periodetabel, its
 * livegangdatum or the two values derived from them: Nymbus holds them on the
 * project's hoofdproces dossieritem, and the app fills those columns itself
 * ([`lib/standard-columns.ts`](../lib/standard-columns.ts)). When the dossieritem is
 * empty the app correctly declines to invent a periodetabel — a wrong one lands
 * silently in AFAS — and the columns revert to being ordinary sheet columns.
 *
 * **That reversion is invisible, and the thing it makes visible is a lie.** With the
 * columns sheet-driven again, a sjabloon that has dropped them (which is exactly what
 * a facilitaire sjabloon does, because the client was never asked for them) trips the
 * payload panel's missing-column banner: *3 gekoppelde kolommen staan niet in dit
 * bestand — controleer of dit bestand de juiste versie van het sjabloon is*. Every
 * word of that is true and the conclusion is wrong. The sjabloon is the right one;
 * nobody filled in the dossieritem. An admin acting on that banner goes back to the
 * client for a file that would not help, and the actual fix — two fields, one dialog,
 * thirty seconds — is never reached because nothing on screen points at it.
 *
 * So this band names the cause where the symptom shows, in the vocabulary of the
 * thing that can be changed, with the button that opens the form. It is the same
 * shape and the same reasoning as [`AfasConnection`](./AfasConnection.tsx)'s two
 * notices, and deliberately a sibling of them rather than a fourth export there: that
 * module is about credentials in our own store, this is about settings in AFAS that
 * every reader can see in Profit.
 *
 * **Admins only, like every notice that names a setting.** A client contact has no
 * settings dialog ([`ProjectSettings`](./ProjectSettings.tsx) and the backend route
 * are both `AdminOnly`), so telling them their project's periodetabel is missing
 * names a problem they cannot act on and reads as a broken tool. Each component gates
 * itself, since the rule is about the message rather than about where it is shown.
 *
 * Both exports render nothing when there is nothing to report — a standard or dossier
 * conversion, a facilitaire one whose dossieritem is filled in, a module without
 * fills — so callers need no guard, the contract `AfasConnectionNotice` already has.
 */

/**
 * What is wrong with each setting, in **both** word orders Dutch needs.
 *
 * Per setting rather than one verdict for the band, because a project can have one
 * of each at the same time (periodetabel 7, livegangdatum empty) and a single
 * sentence would have to say something untrue about one of them to describe the
 * other. Being precise about *which* setting is the band's whole job — it exists to
 * stop the reader chasing the wrong thing.
 *
 * And in two forms, because Dutch puts the verb last in a subordinate clause. The
 * heading is a main clause ("de periodetabel staat niet op 5 of 6"); the body's is
 * introduced by *zolang* and inverts ("zolang de periodetabel niet op 5 of 6
 * staat"). One string reused in both places is wrong in one of them, and copy that
 * reads as machine-translated is copy a reader stops trusting about the thing it is
 * warning them of.
 */
interface Clause {
  /** Main-clause order, for the heading. */
  main: string;
  /** Verb-final order, for the body's *zolang …* clause. */
  sub: string;
}

function gapClauses(gap: UnfilledStandardColumns): Clause[] {
  const clauses: Clause[] = [];
  if (gap.periodetabel) {
    clauses.push(
      gap.periodetabel === "missing"
        ? {
            main: tr("de periodetabel ontbreekt", "the pay period table is missing"),
            sub: tr("de periodetabel ontbreekt", "the pay period table is missing"),
          }
        : {
            main: tr("de periodetabel staat niet op 5 of 6", "the pay period table is not set to 5 or 6"),
            sub: tr("de periodetabel niet op 5 of 6 staat", "the pay period table is not set to 5 or 6"),
          },
    );
  }
  if (gap.livegangDatum) {
    clauses.push(
      gap.livegangDatum === "missing"
        ? {
            main: tr("de livegangdatum ontbreekt", "the go-live date is missing"),
            sub: tr("de livegangdatum ontbreekt", "the go-live date is missing"),
          }
        : {
            main: tr("de livegangdatum is niet leesbaar", "the go-live date is unreadable"),
            sub: tr("de livegangdatum niet leesbaar is", "the go-live date is unreadable"),
          },
    );
  }
  // Neither named means a fill failed for a reason this file can't attribute. Say
  // the gap without inventing a cause — a wrong cause is worse than a vague one.
  if (clauses.length === 0) {
    const both = tr("de conversie-instellingen ontbreken", "the conversion settings are missing");
    clauses.push({ main: both, sub: both });
  }
  return clauses;
}

/**
 * The clauses as one sentence, in the word order the caller asks for.
 *
 * Two identical *ontbreekt* clauses collapse onto a shared verb — "de periodetabel
 * en de livegangdatum ontbreken", not "de periodetabel ontbreekt en de
 * livegangdatum ontbreekt", which is the sentence a reader hears as written by a
 * machine. Only that pairing is special-cased: it is the common case (a dossieritem
 * nobody has filled in at all, which is most of them), and every other combination
 * differs enough that joining with *en* reads correctly as it stands.
 */
function joinClauses(gap: UnfilledStandardColumns, order: keyof Clause): string {
  if (gap.periodetabel === "missing" && gap.livegangDatum === "missing") {
    return tr(
      "de periodetabel en de livegangdatum ontbreken",
      "the pay period table and the go-live date are missing"
    );
  }
  return gapClauses(gap)
    .map((clause) => clause[order])
    .join(tr(" en ", " and "));
}

/** The heading: main-clause order, capitalised. */
function headline(gap: UnfilledStandardColumns): string {
  const joined = joinClauses(gap, "main");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The columns, as a list — capped, because the sentence is the point, not the census. */
function columnsPhrase(headers: readonly string[]): string {
  const shown = headers.slice(0, 4);
  const rest = headers.length - shown.length;
  const and = tr(" en ", " and ");
  if (rest > 0) return `${shown.join(", ")}${and}${rest} ${tr("andere", "more")}`;
  if (shown.length < 2) return shown.join("");
  // "A, B en C" rather than "A, B, C": these run inside a sentence, where a bare
  // comma list reads as an unfinished one.
  return `${shown.slice(0, -1).join(", ")}${and}${shown[shown.length - 1]}`;
}

/**
 * The band, once — both call sites below are the same message at two altitudes, and
 * two copies that drifted apart would have the reader believe the project page and
 * the payload panel are complaining about different things.
 */
function Band({
  project,
  gap,
  className,
}: {
  project: Project;
  gap: UnfilledStandardColumns;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <>
      <div
        role="status"
        className={`flex flex-wrap items-start gap-3 rounded-xl bg-k-amber-bg px-4 py-3.5 text-k-amber-fg ${className}`.trim()}
      >
        <SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {headline(gap)} {t("in de projectinstellingen", "in the project settings")}
          </p>
          <p className="mt-1 text-sm leading-snug">
            {t(
              "Bij een facilitaire conversie vult de tool een aantal kolommen zelf, uit de conversie-instellingen van het project. Zolang",
              "In a facilities conversion the tool fills a number of columns itself, from the project's conversion settings. While"
            )}{" "}
            {joinClauses(gap, "sub")}
            {t(", blijft dat achterwege en", ", that does not happen and")}{" "}
            {gap.headers.length === 1 ? t("wordt de kolom", "the column is") : t("worden de kolommen", "the columns are")}{" "}
            <strong className="font-semibold">{columnsPhrase(gap.headers)}</strong>{" "}
            {t(
              "weer uit het bestand gelezen — waardoor een sjabloon dat ze niet heeft als onvolledig wordt gemeld. Het sjabloon is dan niet het probleem.",
              "read from the file again, so a template that lacks them is reported as incomplete. The template is not the problem then."
            )}
          </p>
        </div>
        {/* A raised pill on the amber, and opening straight onto *Conversie*: the band already
            carries the alarm, and a button that landed on the AFAS-omgeving tab would
            hand the reader a form that has nothing to do with what they just read. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="neu-button inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-k-amber-fg! hover:text-k-amber-fg!"
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          {t("Conversie-instellingen", "Conversion settings")}
        </button>
      </div>

      {/* Mounted only while open, so the tab fetches AFAS's values fresh.

          Closing **re-reads the session**, for the reason `AfasConnectionNotice`
          does: `hrmPeriodetabel` and `livegangDatum` ride along with the project
          list, and without this an admin would fill them in, watch the tab confirm
          the save, and still be looking at this band — and at the misleading
          missing-column banner it exists to explain — until they reloaded. A failure
          is ignored on purpose; a band that stays up one moment too long is a smaller
          lie than one that vanished on a fetch that never landed. */}
      {open && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          initialTab="conversie"
          onClose={() => {
            setOpen(false);
            // Dropped while a deep reload is out — a save starts one, and this
            // shallow replay landing after it would put the old settings back.
            void fetchMe()
              .then((next) => {
                if (!isReloadingSession()) setSession(next);
              })
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}

/**
 * The project's own page: the gap across **every** module the conversion fills,
 * before one is chosen.
 *
 * Here the reader has no module in hand, so the question is about the project —
 * which is also the level the missing setting lives at. It sits beside
 * `AfasConnectionNotice`, under it: a project with no credentials at all can't reach
 * AFAS for anything, which outranks a conversion setting that only affects how a few
 * columns are filled.
 */
export function ConversionSettingsNotice({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  const gap = unfilledStandardColumnsForProject(project);

  if (!isAdmin || gap.headers.length === 0) return null;
  return <Band project={project} gap={gap} className={className} />;
}

/**
 * Whether {@link ModuleConversionSettingsNotice} would render anything — the same
 * two conditions, asked before the element exists.
 *
 * `NoticeCarousel` counts the items it is handed, and a React element is truthy
 * whether or not the component behind it returns `null`. A notice that gates
 * itself therefore still claims a page: the counter reads `1 / 2` and the second
 * page is an empty band. The condition has to be answerable by the caller, so it
 * lives here beside the component rather than being copied into the panel — one
 * source of truth, and the component keeps its own guard for callers that render
 * it directly.
 */
export function useModuleConversionSettingsNotice(
  project: Project,
  moduleId: string | null,
): boolean {
  const isAdmin = useIsAdmin();
  return isAdmin && unfilledStandardColumns(project, moduleId).headers.length > 0;
}

/**
 * The same gap on the payload screen, narrowed to **this module** and said in one
 * line — the notice that explains the missing-column banner it pages beside.
 *
 * **Narrowed deliberately.** An ERP module fills nothing from the dossieritem, so
 * there is nothing to report there even while `hrm-medewerkers` has a gap. A band that fired on every module of the project would
 * name a problem that doesn't touch the screen it is on, which is how a reader learns
 * to page past the bands without reading them.
 *
 * **One line, not the card.** This lives in `NoticeCarousel`, where every item is a
 * strip and stepping between them must not reflow the panel — the full card above
 * would be three times the height of its neighbours. It is the shape and reasoning
 * `AfasStageNotice` already has in the same strip: name the cause, offer the form,
 * and leave the explanation to the dialog the button opens. The project page is where
 * the long version belongs, because that is where somebody is reading about the
 * project rather than working on a sheet.
 *
 * It does **not** suppress the missing-column banner beside it, unlike the way
 * `AfasStageNotice` suppresses the existence-read errors. That banner is still true —
 * those columns really are absent and those fields really will be empty — and the
 * send is real. This one adds the cause; the carousel shows both.
 */
export function ModuleConversionSettingsNotice({
  project,
  moduleId,
  className = "",
}: {
  project: Project;
  moduleId: string | null;
  className?: string;
}) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const t = useT();
  const gap = unfilledStandardColumns(project, moduleId);

  if (!isAdmin || gap.headers.length === 0) return null;
  return (
    <>
      <div
        role="status"
        className={`flex flex-wrap items-center gap-2.5 rounded-xl bg-k-amber-bg px-3.5 py-2.5 text-[13px] text-k-amber-fg ${className}`.trim()}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">
            {headline(gap)} {t("in de projectinstellingen", "in the project settings")}
          </span>{" "}
          {t("— daarom vult de tool", "— so the tool does not fill")}{" "}
          <strong className="font-semibold">{columnsPhrase(gap.headers)}</strong>{" "}
          {t("niet zelf en", "itself, and")}{" "}
          {gap.headers.length === 1 ? t("wordt die kolom", "that column is") : t("worden die kolommen", "those columns are")}{" "}
          {t("uit het bestand verwacht.", "expected from the file.")}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="neu-button inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium text-k-amber-fg! hover:text-k-amber-fg!"
        >
          <Settings className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          {t("Conversie-instellingen", "Conversion settings")}
        </button>
      </div>

      {/* Re-reads the session on close for the reason the card above does: fill the
          two fields in and this band, and the missing-column banner it explains,
          both have to go without a reload. */}
      {open && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          initialTab="conversie"
          onClose={() => {
            setOpen(false);
            // Dropped while a deep reload is out — a save starts one, and this
            // shallow replay landing after it would put the old settings back.
            void fetchMe()
              .then((next) => {
                if (!isReloadingSession()) setSession(next);
              })
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}
