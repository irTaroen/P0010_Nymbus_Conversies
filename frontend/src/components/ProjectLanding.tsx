"use client";

import { AfasConnectionNotice, AfasTokenNotice } from "@/components/AfasConnection";
import { ConversionSettingsNotice } from "@/components/ConversionSettingsNotice";
import Hero from "@/components/Hero";
import ProjectReport from "@/components/ProjectReport";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";

/**
 * The project's own page: a project is open, no module chosen yet.
 *
 * The hero, then the **projectrapport** — where the conversion stands and how each
 * module is doing. That is the whole page: opening a project answers "how far are we",
 * and uploading happens one level down — which is why the hero puts its copy beside
 * the heading rather than under it, so the report starts near the top of the screen
 * instead of under a screenful of introduction.
 *
 * **It does not take files.** It used to — a file dropped here was recognised and sent
 * on to the module its name settled on — and that was one way in too many: a page with
 * a dropzone but no module has to guess where the file belongs, and guessing wrong
 * meant a modal asking a question the sidebar answers in one click. So the copy points
 * left instead, and every upload now starts on the page of the module it is for, where
 * the rules, the help and the template are. `useFileIntake`'s module-less mode was
 * retired with it — it always takes a module now.
 *
 * For an admin it can open with up to two more things, both bands about setup rather
 * than progress, both above the report because they outrank it, and both carrying the
 * button that fixes them so the answer is in the same place as the problem: this
 * project has no AFAS-koppeling yet ([`AfasConnection`](./AfasConnection.tsx)) —
 * without credentials nothing in the project can reach AFAS at all — and its
 * conversie-instellingen are not filled in
 * ([`ConversionSettingsNotice`](./ConversionSettingsNotice.tsx)), which is why the
 * columns a facilitaire conversie fills itself are silently left to the sheet.
 */
export default function ProjectLanding() {
  const { selectedProject } = useProject();
  const t = useT();

  // A flex column all the way down, so the report takes the height the hero leaves
  // and its module table scrolls inside it — the page itself only scrolls on a
  // screen too short to hold the report's floor.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
      <Hero
        intro={
          <p className="text-base leading-snug text-k-text-secondary">
            {t(
              <>
                Selecteer in het linker menu een conversieonderdeel en upload de ingevulde Excel-template. De
                tool controleert de gegevens op fouten — pas als alles klopt, importeren we de gegevens naar AFAS.
              </>,
              <>
                Select a conversion module in the left-hand menu and upload the completed Excel template. The
                tool checks the data for errors — only once everything is right do we import it into AFAS.
              </>
            )}
          </p>
        }
      />
      {/* Wider than the hero, deliberately. The two used to share their edges at
          `max-w-3xl`, but the report is a six-column table and the hero is two
          paragraphs: at that width the module column — the thing every row is read
          for — truncated *Uitzendkrachten* to *Uitzendkrach…* while the status beside
          it sat in whitespace. A shared edge is worth less than a readable name, so
          the report gets `max-w-6xl` — room for all seven columns side by side,
          where `5xl` left *Laatste controle* behind a sideways scroll — and the hero
          keeps the width its hand-placed line break was set for. */}
      {/* `max-lg:shrink-0`: below `lg` the report is as tall as its modules and this
          page is what scrolls — see `ProjectReport`. */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-col max-lg:shrink-0">
        {/* Above the report, not under it: it says the project can't reach AFAS at
            all, which outranks how far its modules got — and it renders nothing once
            the project is connected (and for anyone who isn't an admin), so this
            costs a normal project no height. */}
        <AfasConnectionNotice project={selectedProject} className="mb-5" />
        {/* The other half of the same question: credentials that *are* stored but
            that AFAS refuses, found by the check the project shell runs on entry.
            Silent while it runs and when every stored stage works. */}
        <AfasTokenNotice project={selectedProject} className="mb-5" />
        {/* Under the connection band and above the report, for the same reason that
            one is above the report: it is a fact about the project's setup rather
            than about its progress. Under it, because no credentials at all outranks
            a conversion setting that decides how a few columns are filled — and a
            project missing both should read top-down in that order. Renders nothing
            for a standard conversion, or once the dossieritem is filled in. */}
        <ConversionSettingsNotice project={selectedProject} className="mb-5" />
        <ProjectReport />
      </div>
    </div>
  );
}
