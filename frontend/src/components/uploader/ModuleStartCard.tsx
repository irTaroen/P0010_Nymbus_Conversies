"use client";

import { Download, HelpCircle } from "lucide-react";
import { useModule } from "@/components/ModuleProvider";
import { useProject } from "@/components/ProjectProvider";
import Metric from "@/components/uploader/Metric";
import { projectFileName } from "@/lib/download";
import { useT } from "@/lib/i18n";
import { getModule, moduleStatusTone, STATUS_TONE_FILL } from "@/lib/modules";
import { progressMetricText, type ModuleProgress } from "@/lib/project-progress";

interface ModuleIntroContent {
  description: string;
  descriptionEn: string;
}

const MODULE_INTRO: Partial<Record<string, ModuleIntroContent>> = {
  "hrm-medewerkers": {
    description:
      "Upload een Excel-bestand met medewerkersgegevens. De tool controleert de data op fouten voordat het naar AFAS gaat.",
    descriptionEn:
      "Upload an Excel file with employee data. The tool checks the data for errors before it goes to AFAS.",
  },
};

function introFor(moduleId: string, t: ReturnType<typeof useT>): string {
  const custom = MODULE_INTRO[moduleId];
  if (custom) return t(custom.description, custom.descriptionEn);

  const label = getModule(moduleId)?.label ?? moduleId;
  return t(
    `Upload een Excel-bestand met ${label.toLowerCase()}-gegevens. De tool controleert de data op fouten voordat het naar AFAS gaat.`,
    `Upload an Excel file with ${label.toLowerCase()} data. The tool checks the data for errors before it goes to AFAS.`
  );
}

/**
 * What this module's page is for, in one sentence — the copy beside the **hero**
 * heading, which on a module page is the module's own description rather than a
 * word about the app.
 *
 * It lives here, next to `MODULE_INTRO`, so the per-module text has one home; the
 * card below it doesn't repeat it.
 */
export function ModuleIntroCopy({ moduleId }: { moduleId: string }) {
  const t = useT();
  return (
    <p className="text-base leading-snug text-k-text-secondary">
      {introFor(moduleId, t)}
    </p>
  );
}

/**
 * The file name inside a module's `templateUrl` — `/templates/HRM_5_Grondslag%20Vakantietoeslag.xlsx`
 * gives `HRM_5_Grondslag Vakantietoeslag.xlsx`.
 *
 * The paths in [`lib/modules.tsx`](@/lib/modules) are percent-encoded because
 * they are URLs, and a `download` attribute is a *file name*, not a URL — left
 * encoded, the client would save a file with a literal `%20` in its name.
 */
function templateFileName(templateUrl: string): string {
  const last = templateUrl.split("/").pop() ?? templateUrl;
  try {
    return decodeURIComponent(last);
  } catch {
    // A stray `%` in a path we wrote ourselves shouldn't cost the download.
    return last;
  }
}

/**
 * The card under the hero on a module page with no sheet open: **everything about
 * this module that isn't the upload itself**, in one card.
 *
 * Four things, and they were in three places before. The name and the two things
 * worth having before filling a sheet in — how to fill it in, and the template to
 * fill in — were this card already; the module's **last check** sat in the sheet
 * toolbar above it, and the toolbar itself is now gone until there is a sheet for it
 * to describe (see [`SheetToolbar`](./SheetToolbar.tsx)). A bar of six buttons that
 * act on data, four of them greyed out, above a page whose only move is *upload a
 * file*, was a row of things you can't do standing over the one thing you can.
 *
 * So the page reads as three blocks now: what the tool does (hero), what this module
 * is and where it stands (this card), and the dropzone — which takes the height the
 * toolbar gave up.
 *
 * Top row: the module, its **AFAS status**, and the two buttons. Under a hairline,
 * the module's last recorded check when the project has one — the same figure and the
 * same wording the sidebar badge carries (`progressMetricText`), printed by the same
 * [`Metric`](./Metric.tsx) the toolbar uses for the live one. A module nobody has
 * checked yet gets **no figure at all** rather than a `0%`: same rule as the sidebar
 * badge, where a zero would read as failure instead of as "not started".
 *
 * The help drawer is the **caller's**, not this card's: the toolbar opens the same
 * one, and two components each mounting their own drawer for one module is two
 * drawers that can drift apart.
 */
export default function ModuleStartCard({
  moduleId,
  progress,
  onHelp,
}: {
  moduleId: string;
  /** The module's last recorded check, or null when nobody has checked it yet. */
  progress: ModuleProgress | null;
  /** Open the module help drawer — held by the page, see above. */
  onHelp: () => void;
}) {
  // Not named `module`: Next forbids assigning that identifier (it shadows the
  // CommonJS `module` its bundler injects) — @next/next/no-assign-module-variable.
  const moduleDef = getModule(moduleId);
  const label = moduleDef?.label ?? moduleId;
  // Where AFAS says this module stands. The sidebar's dot says the same thing in a
  // colour; here there is room for the words, which is what the client acts on —
  // "Klant — Template vullen" is the reason they are on this page at all.
  const { statuses } = useModule();
  const afasStatus = statuses.get(moduleId);
  // The template is one fixed file in `public/templates/` that every project
  // downloads the same bytes of, so only its name can say whose copy this is —
  // and an empty sheet is the one file you can't tell apart by looking inside.
  // `download` takes the name to save it under, so the rename costs no fetch.
  const { selectedProjectId } = useProject();
  const t = useT();

  return (
    <section className="flex h-full flex-col rounded-2xl bg-k-bg px-6 py-5 text-left shadow-raised">
      {/* Just the heading block now — the buttons moved below the metric, so there
          is nothing left to justify against and the row that did it is gone. */}
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-k-text-primary">{label}</h2>
        {afasStatus?.status && (
          <p className="mt-1.5 flex min-w-0 items-baseline gap-2 text-sm text-k-text-secondary">
            {/* The sidebar's own dot, from the same map — and, as there, never
                the only thing saying it: the status is spelled out beside it. */}
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                STATUS_TONE_FILL[moduleStatusTone(afasStatus)]
              }`}
            />
            {/* Wraps rather than truncates: half a column is too little for
                "Sjabloon gevuld — Controle ingevulde template", and a status
                clipped mid-word is the one thing on this card the client is
                here to read. */}
            <span className="min-w-0">
              <span className="sr-only">Status: </span>
              {afasStatus.status}
              {afasStatus.task ? ` — ${afasStatus.task}` : ""}
            </span>
          </p>
        )}
      </div>

      {/* Where the module stands, then what to do about it. The figure sits directly
          under the status it qualifies — both are statements about this module — and
          the two buttons close the card, which is the order the page is read in:
          this is where you are, this is what you do next. The hairline stays with
          the metric, so the card still reads as "about" above and "do" below. */}
      {progress && (
        <div className="mt-4 border-t border-k-divider pt-4">
          <Metric metric={progressMetricText(progress)} />
        </div>
      )}

      {/* The two things you do before filling the sheet in, side by side: read how,
          then take the template. The help used to be a text link under the name and
          is a quiet button here — it is an action next to an action, not a footnote
          to the heading. Its wording can be short because the module's name is on
          the card above it; the full question rides in `aria-label`. "Uitleg" rather
          than the old "Hoe vul ik dit in?" is what lets the pair stay on one line in
          the half-width card — the label was the last 40px needed, and the question
          it asks is already the heading above it.

          `flex-nowrap` with `shrink-0` buttons keeps them on that one line: beside
          the draft-restore card the landing gives this one about half of
          `max-w-3xl`, and wrapped they read as two steps rather than one.

          `lg:mt-auto` only where the two cards stand side by side and this one is
          stretched to the other's height: it drops the buttons to the bottom edge so
          the spare height falls above them rather than trailing underneath. Stacked
          (below `lg`) the card is its own height and a plain `mt-4` is right. */}
      <div className="mt-4 flex flex-nowrap items-center gap-1.5 lg:mt-auto lg:pt-4">
        <button
          type="button"
          onClick={onHelp}
          aria-label={t(`Hoe vul ik het ${label}-bestand in?`, `How do I fill in the ${label} file?`)}
          className="neu-button inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium"
        >
          <HelpCircle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          {t("Uitleg", "Help")}
        </button>
        {moduleDef?.templateUrl && (
          <a
            href={moduleDef.templateUrl}
            download={projectFileName(templateFileName(moduleDef.templateUrl), selectedProjectId)}
            className="neu-button inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium"
          >
            <Download className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {t("Sjabloon downloaden", "Download template")}
          </a>
        )}
      </div>
    </section>
  );
}
