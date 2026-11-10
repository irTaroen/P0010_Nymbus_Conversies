/**
 * A mapped field whose value is **looked up in the AFAS environment being written
 * to** — the third kind of source, beside a column and a fixed value.
 *
 * It rides on a column source (`FieldSource.lookup` in
 * [`field-mapping.ts`](./field-mapping.ts)): the cell is still read, but what the body
 * carries is what AFAS holds against it. `erp-abonnementen` made the case:
 * `FbSubscription#BcId`/`#DbId` want the relation and debiteur of the abonnement's
 * project, the sheet only has the projectnummer, and what AFAS holds against it
 * differs per customer and per stage. So both are read off `CON_ERP_Projecten`
 * (`Project` → `Organisatie_nummer` / `Debiteur_nummer`) when the payload is
 * built — which is why a lookup is a translation that can't be stored, where a
 * `valueMap` is one that can.
 *
 * ### Never a guess
 *
 * A cell the table has no answer for — no match, several distinct values, or a table
 * that couldn't be read — resolves to **no value**, and the record is kept out of
 * the send ({@link lookupProblem}). Passing the raw cell through, the way an
 * untranslated `valueMap` entry is, would be wrong here in a way AFAS can't catch: a
 * debiteurnummer in a relation-number field links the abonnement to whichever
 * relation happens to carry that number.
 *
 * The backend reads the table (`backend/lookups.py`) and only for a lookup a stored
 * mapping declares, so the browser can't point it at an arbitrary GetConnector.
 */

import { requestJson } from "@/lib/api";
import { normalizeKey } from "@/lib/existing-records";
import type { SendStage } from "@/lib/payload-send";

/** What a looked-up field is read from — as the stored mapping states it. */
export interface AfasLookup {
  /** The GetConnector, e.g. `CON_ERP_Debiteuren`. */
  connector: string;
  /** The field **id** whose value must equal the cell — `Debiteur`. */
  matchField: string;
  /** The field **id** whose value goes into the body — `Nummer`. */
  valueField: string;
  /**
   * What one row of the connector *is*, to the person reading the panel — `Project`
   * for `ALG_Projecten`. Optional: with it, a cell without a match reads
   * *Project "123" bestaat niet in …* rather than naming the connector's field ids.
   * Wording only — it plays no part in which table is read ({@link lookupId}).
   */
  noun?: string;
}

/** One table's identity — how the loaded tables are keyed. */
export function lookupId(lookup: AfasLookup): string {
  return `${lookup.connector}|${lookup.matchField}|${lookup.valueField}`;
}

/** The lookup read as a sentence — for notes, titles and the dialog's summary. */
export function lookupSummary(lookup: AfasLookup): string {
  return `${lookup.valueField} uit ${lookup.connector} waar ${lookup.matchField} gelijk is`;
}

/** One lookup table, as `GET /api/projects/{id}/lookup` answers it. */
export interface LookupTable {
  stage: SendStage;
  environment: string;
  connector: string;
  matchField: string;
  valueField: string;
  /** False = AFAS could not be asked. **Not** "nothing matches". */
  available: boolean;
  /** Normalized match value -> the value AFAS holds for it. */
  values: Record<string, string>;
  /** Normalized match values that carry more than one distinct value. */
  ambiguous: Record<string, string[]>;
  rows: number;
  message: string;
  fetchedAt: string;
}

/**
 * Where one table stands, as the resolver needs it. `loading` and `error` are both
 * "no answer yet", and the resolver treats them alike; they differ only in what the
 * panel says about them.
 */
export type LookupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: LookupTable };

/** Every table a build may consult, by {@link lookupId}. */
export type LookupTables = ReadonlyMap<string, LookupState>;

/** No tables — what the mapping editor builds with, and every module without a lookup. */
export const NO_LOOKUPS: LookupTables = new Map();

/** The answer for one cell. */
export type LookupAnswer =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * What the table holds for this cell, or why there is no answer. The cell is
 * normalized like an existence key — AFAS pads its numbers (`07750`) where the
 * sheet's integer column doesn't — and that is also how the backend keyed the table.
 */
export function resolveLookup(
  tables: LookupTables,
  lookup: AfasLookup,
  cell: string,
): LookupAnswer {
  const state = tables.get(lookupId(lookup));
  // No table at all is the mapping editor, which has no stage to read one from.
  if (!state) {
    return {
      ok: false,
      reason: `opgezocht in ${lookup.connector} van de omgeving waarnaar wordt verstuurd`,
    };
  }
  if (state.status === "loading") {
    return { ok: false, reason: `${lookup.connector} wordt nog opgehaald` };
  }
  if (state.status === "error") {
    return { ok: false, reason: `${lookup.connector} kon niet worden gelezen` };
  }
  if (!state.table.available) {
    return {
      ok: false,
      reason: `${lookup.connector} is niet beschikbaar in ${state.table.environment}`,
    };
  }
  const key = normalizeKey(cell);
  const several = state.table.ambiguous[key];
  if (several) {
    return {
      ok: false,
      reason: `${lookup.matchField} "${cell.trim()}" komt in ${lookup.connector} voor met ${several.length} verschillende ${lookup.valueField}-waarden (${several.join(", ")})`,
    };
  }
  const value = state.table.values[key];
  if (value !== undefined) return { ok: true, value };
  return {
    ok: false,
    reason: lookup.noun
      ? `${lookup.noun} "${cell.trim()}" bestaat niet in ${state.table.environment} (${lookup.connector})`
      : `${lookup.matchField} "${cell.trim()}" staat niet in ${lookup.connector} (${state.table.environment})`,
  };
}

/**
 * One lookup's table from the project's own AFAS, at `stage` — never defaulted, since
 * test and live hold different numbers (at 501342, 187 debiteuren in test against 6
 * in live, 29-09-2026).
 */
export async function fetchLookupTable(
  projectId: string,
  stage: SendStage,
  lookup: AfasLookup,
): Promise<LookupTable> {
  const query = new URLSearchParams({
    stage,
    connector: lookup.connector,
    match: lookup.matchField,
    value: lookup.valueField,
  });
  return requestJson<LookupTable>(
    `/api/projects/${encodeURIComponent(projectId)}/lookup?${query}`,
    undefined,
    `${lookup.connector} kon niet bij AFAS worden opgevraagd.`,
  );
}

// --- For the dialog: which GetConnectors exist, and what is in one ------------

/** One GetConnector as `metainfo` lists it. */
export interface GetConnectorInfo {
  id: string;
  description?: string;
}

/** One field of a GetConnector, as `metainfo/get/<connector>` names it. */
export interface GetConnectorField {
  /** The id a row is keyed by — what a lookup names. Not always the label. */
  id: string;
  label?: string;
  dataType?: string;
}

/** A GetConnector's fields and its first few rows, for the dialog's preview. */
export interface GetConnectorPreview {
  fields: GetConnectorField[];
  rows: Record<string, unknown>[];
  /** Why `rows` is empty when the fields did answer. */
  rowsMessage: string;
}

/** `?project=…` when a project is known — the backend reads that project's
 *  environment, and otherwise the first project with AFAS details filled in. */
function projectQuery(projectId: string | null | undefined): string {
  return projectId ? `?project=${encodeURIComponent(projectId)}` : "";
}

/** The GetConnectors a project's environment exposes. */
export async function fetchGetConnectors(
  group: string,
  projectId?: string | null,
): Promise<{ connectors: GetConnectorInfo[]; message: string }> {
  const data = await requestJson<{ connectors: GetConnectorInfo[]; message: string }>(
    `/api/afas/getconnectors/${encodeURIComponent(group)}${projectQuery(projectId)}`,
    undefined,
    "De GetConnectors konden niet worden opgehaald.",
  );
  return { connectors: data.connectors ?? [], message: data.message ?? "" };
}

/** A GetConnector's fields and a sample of its rows, from a project's environment. */
export async function fetchGetConnectorPreview(
  group: string,
  connector: string,
  projectId?: string | null,
): Promise<GetConnectorPreview> {
  const data = await requestJson<{
    metainfo: { fields?: GetConnectorField[] | null };
    rows: Record<string, unknown>[];
    rowsMessage: string;
  }>(
    `/api/afas/getconnectors/${encodeURIComponent(group)}/${encodeURIComponent(connector)}${projectQuery(projectId)}`,
    undefined,
    `${connector} kon niet worden gelezen.`,
  );
  return {
    fields: data.metainfo?.fields ?? [],
    rows: data.rows ?? [],
    rowsMessage: data.rowsMessage ?? "",
  };
}
