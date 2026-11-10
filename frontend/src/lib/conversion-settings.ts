/**
 * Settings of the **conversion** — its periodetabel and its livegangdatum.
 *
 * The sibling of [`project-settings.ts`](./project-settings.ts), and deliberately a
 * separate module, because the two are stored in different places and only one of
 * them is ours. The AFAS credentials there live in our own `project_settings` table;
 * these two live on the project's **hoofdproces dossieritem in AFAS**, where the
 * consultant who sets a conversion up already maintains them, and the tool reads them
 * from there on every session (`Project.hrmPeriodetabel` / `Project.livegangDatum`).
 *
 * So a save here is an AFAS write (`KnSubject`/`KnS51`, see the hosted version's backend), not
 * a row in our store. Keeping a copy of our own would be a value that silently
 * disagrees with the one Profit shows — and these two decide five columns of a
 * facilitaire conversie's Medewerkers sheet ([`standard-columns.ts`](./standard-columns.ts)),
 * so disagreeing about them means filling those columns wrong.
 *
 * Read fresh rather than taken off the session's project list, which carries the same
 * two fields: the session is minted at login, and this is the one place they change.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

export type ConversionSettings = {
  projectId: string;
  projectName: string;
  /** The HRM periodetabel as text — `""` when AFAS has none. Text, not a number, so
   *  "not set" and a literal 0 can't collapse into the same value. */
  hrmPeriodetabel: string;
  /** The livegangdatum as `yyyy-mm-dd`, or `""` — the form a date input takes. */
  livegangDatum: string;
  /**
   * The hoofdproces dossieritem these are written onto (`SbId`). `""` for a project
   * AFAS has no hoofdproces for — still being scoped — where there is nothing to
   * write to and the tab says so rather than offering a form that could only fail.
   */
  dossierItemId: string;
};

/** What a save sends. An empty field **clears** the value in AFAS. */
export type ConversionSettingsInput = {
  hrmPeriodetabel: string;
  livegangDatum: string;
};

function settingsPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/conversion-settings`;
}

/** One project's conversion settings, as AFAS holds them. Throws an `ApiError`. */
export async function fetchConversionSettings(
  projectId: string
): Promise<ConversionSettings> {
  const data = await requestJson<{ conversionSettings: ConversionSettings }>(
    settingsPath(projectId),
    undefined,
    tr("De conversie-instellingen konden niet worden geladen.", "The conversion settings could not be loaded.")
  );
  return data.conversionSettings;
}

/**
 * Write them into AFAS, and answer with them as a fetch would — read back from AFAS
 * rather than echoed, so what the form shows afterwards is what AFAS actually stored.
 */
export async function saveConversionSettings(
  projectId: string,
  input: ConversionSettingsInput
): Promise<ConversionSettings> {
  const data = await requestJson<{ conversionSettings: ConversionSettings }>(
    settingsPath(projectId),
    jsonBody("PUT", input),
    tr("De conversie-instellingen konden niet worden opgeslagen.", "The conversion settings could not be saved.")
  );
  return data.conversionSettings;
}

/**
 * The periodetabellen the tool falls back on when AFAS can't say.
 *
 * **The real list is a codetabel** — `ALG_Periodetabellen` in the project's own live
 * environment, registered as `Periodetabellen` (see
 * `validation/codetabellen/sources.ts`), because which tabellen exist is inrichting
 * per werkgever like every other reference table: 501342 carries `5` Maand HRM,
 * `6` 4 weken HRM *and* `18` Jaar Verlof HRM, and no list written down here can
 * know that. The dialog reads the codetabel and only falls back to this pair when
 * no environment answers — the connector isn't imported yet, the credentials aren't
 * filled in — which is the same degradation every codetabel has.
 *
 * These two are the fallback rather than some other pair because they are the ones
 * the tool can **act on**: *Herhalen na* is derived from the periodetabel and from
 * nothing else (12 for 5, 13 for 6, see `standard-columns.ts`), so any other value
 * leaves that column silently unfilled. That derivation is deliberately *not*
 * widened to whatever the codetabel answers — a periodetabel the tool has no
 * `Herhalen na` for is offered and saved, and the field's hint says the column stays
 * empty. See `periodetabelHint` in `ProjectSettingsDialog`.
 *
 * **The pair is 5 and 6** (Taroen, 22-09-2026), not the 4 and 5 this list carried
 * until then: 5 is maandelijks, 6 vierwekelijks. AFAS agrees from the other side —
 * `PtId` 4 is refused as a value that does not exist, and the live table holds no
 * `4` either.
 */
// The labels are getters, read at the moment they are shown (see `intake.ts`).
export const PERIODETABELLEN: readonly { value: string; readonly label: string }[] = [
  { value: "5", get label() { return tr("5 — maandelijks (12 perioden)", "5 — monthly (12 periods)"); } },
  { value: "6", get label() { return tr("6 — vierwekelijks (13 perioden)", "6 — four-weekly (13 periods)"); } },
];
