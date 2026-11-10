import { tr } from "@/lib/i18n";
import { jsonBody, requestBlob, requestJson } from "@/lib/api";
import { headerIndex } from "@/lib/headers";
import { codetabelColumns, codetabelVerdict } from "@/lib/validation/engine";
import { codetabelIsLoaded } from "@/lib/validation/codetabellen";
import { RULE_SETS } from "@/lib/validation/rules";
import type { ValidationResult } from "@/lib/validation/types";

/**
 * The `afas_plaatsen` table (`backend/afas_plaatsen.py`): woonplaatsen to be
 * imported into AFAS, one row per land + plaats. Admins fill it from the sheet on
 * screen — every unknown woonplaats or geboorteplaats whose land is valid — and
 * download it as `Data_Woonplaatsen.csv`, both from the Instellingen modal.
 */

export type AfasPlaats = { land: string; plaats: string };

/** Whether `moduleId` has a codetabel check that lets a woonplaats be unlisted. */
export function moduleHasUnlistedPlaces(moduleId: string): boolean {
  return (
    // A scoped rule only: an unlisted *land* (Geboorteland) is not a place to add.
    RULE_SETS[moduleId]?.columns.some((col) =>
      col.rules.some((r) => r.allowUnlisted && r.scopeColumn)
    ) ?? false
  );
}

/**
 * The places of the sheet's `unlisted` cells (`allowUnlisted` codetabel checks)
 * whose land is itself valid: the scope column's own codetabel check passes on it,
 * against a table that is actually loaded — a land nothing could judge is not one
 * to add a place under. One entry per land + plaats, case-insensitively; the land
 * upper-cased, the way AFAS writes its landcodes.
 */
export function unlistedPlaces(
  moduleId: string,
  headers: string[],
  cellData: string[][],
  result: ValidationResult
): AfasPlaats[] {
  const ruleSet = RULE_SETS[moduleId];
  if (!ruleSet || result.unlisted.size === 0) return [];
  const columns = new Map(
    codetabelColumns(moduleId, headers)
      .filter((c) => c.rule.allowUnlisted && c.rule.scopeColumn)
      .map((c) => [c.idx, c.rule] as const)
  );
  const places = new Map<string, AfasPlaats>();
  for (const issue of result.unlisted.values()) {
    const rule = columns.get(issue.col);
    const land = (issue.tableScope ?? "").trim();
    const plaats = (cellData[issue.row]?.[issue.col] ?? "").trim();
    if (!rule || !land || !plaats) continue;
    const landRule = ruleSet.columns
      .find((col) => headerIndex([col.column].flat(), rule.scopeColumn!) !== -1)
      ?.rules.find((r) => r.check === "codetabel" && r.tableRef);
    if (!landRule || !codetabelIsLoaded(landRule.tableRef!)) continue;
    if (!codetabelVerdict(landRule, land, "").valid) continue;
    const place = { land: land.toUpperCase(), plaats };
    places.set(`${place.land}\t${plaats.toLowerCase()}`, place);
  }
  return [...places.values()];
}

/** Add `places` to the table; the backend skips a combination it already holds. */
export async function addAfasPlaatsen(
  places: AfasPlaats[]
): Promise<{ added: number; existing: number }> {
  return requestJson(
    "/api/afas-plaatsen",
    jsonBody("POST", { places }),
    tr("De plaatsen konden niet worden toegevoegd.", "The places could not be added.")
  );
}

/** The whole table as a `.csv` (`Land;Plaats`, semicolon-separated). */
export async function downloadAfasPlaatsen(): Promise<Blob> {
  return requestBlob(
    "/api/afas-plaatsen.csv",
    tr("De plaatsenlijst kon niet worden gedownload.", "The list of places could not be downloaded.")
  );
}
