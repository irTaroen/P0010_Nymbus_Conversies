/**
 * Which of a module's payloads AFAS **already holds**.
 *
 * The payload view builds a body per row and, until this, could only offer to insert
 * them — so a re-send inserted duplicates, or AFAS refused them one at a time after
 * the press. This reads the keys the customer's environment already has, matches them
 * against the sheet, and lets the panel mark each record *Bestaat al* or *Nieuw*
 * before anything is sent.
 *
 * ### Not a codetabel
 *
 * It looks like one and is not. A codetabel judges a **cell** against a closed set of
 * valid values, and a value outside it is an error; this judges a **record** against
 * what exists right now, where "not present" is the ordinary answer for most rows of a
 * conversion. They fail differently too: an unreadable codetabel skips a check, while
 * an unreadable existence list — if it were read as "nothing exists" — would mark every
 * record new and invite a duplicate insert of the lot. So {@link ExistingRecords}
 * carries an explicit `available`, and every reader must branch on it rather than on
 * the key count.
 *
 * ### Keys are padded on one side and not the other
 *
 * AFAS answers `07750`, and `000001` for every project; the sheet columns behind both
 * are typed `integer`, so Excel hands over `7750` and `1`. Comparing as strings marks
 * existing records as new. {@link normalizeKey} strips leading zeros from an
 * all-digits key on **both** sides — the same normalisation
 * `codetabellen/store.ts` does for the administratietabel, and the same one
 * `backend/existing.py` applies before the send is verified, so the two cannot drift.
 */

import { normalizeAfasCode } from "@/lib/afas-keys";
import { requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { SendStage } from "@/lib/payload-send";

/** What one environment already holds for a module. */
export interface ExistingRecords {
  moduleId: string;
  stage: SendStage;
  /** How the environment names itself, for the line above the marks. */
  environment: string;
  connector: string;
  /**
   * Whether this module's payload view may offer *Verwijderen* — the backend's
   * word (`existing.DeleteTarget`), since the delete's connector and key field are
   * declared there and nowhere else. Absent from a backend that predates it.
   */
  deletable?: boolean;
  /**
   * Whether AFAS actually answered. **False is not "none exist"** — it is "we could
   * not ask", which happens when the `CON_ERP_*` / `CON_HRM_*` connector isn't on this customer's
   * app connector yet. The panel then marks nothing and the send behaves as it did
   * before this feature, rather than treating an unanswered question as an empty
   * environment.
   */
  available: boolean;
  /** Normalized key -> the record's name in AFAS, so a match can show what it hit. */
  keys: Record<string, string>;
  count: number;
  message: string;
  fetchedAt: string;
}

/**
 * A record key in the one shape both sides are compared in — trimmed, then
 * {@link normalizeAfasCode}: upper-cased and stripped of AFAS's leading zeros.
 */
export function normalizeKey(value: string): string {
  return normalizeAfasCode(value.trim());
}

/** How one payload stands against the environment. */
export type ExistingState = "exists" | "new" | "unknown";

/** One payload's verdict, and what it matched on. */
export interface ExistingMatch {
  state: ExistingState;
  /** The normalized key it was judged by — empty when the sheet column was blank. */
  key: string;
  /** The record's name in AFAS, when it exists. Shown so a wrong match is visible. */
  name: string;
}

/** The verdict for one key against a fetched set. */
export function matchKey(
  existing: ExistingRecords | null,
  rawKey: string
): ExistingMatch {
  const key = normalizeKey(rawKey);
  // No read, a failed read, or a row whose key column is empty: all three are
  // "we cannot say", and none of them may be shown as "new" — a blank key would
  // otherwise be marked safe to insert on the strength of nothing at all.
  if (!existing || !existing.available || key === "") {
    return { state: "unknown", key, name: "" };
  }
  const name = existing.keys[key];
  return name === undefined
    ? { state: "new", key, name: "" }
    : { state: "exists", key, name };
}

/**
 * The keys a module's environment already holds.
 *
 * `stage` is required and never defaulted: the whole question is "does this exist in
 * the environment I am about to write to", so a test read says nothing about live.
 *
 * A **404** means this module has no existence lookup registered — a wiring mistake
 * worth surfacing rather than a reason to guess. Every other failure surfaces as an
 * `ApiError` for the caller to turn into the *niet gecontroleerd* state.
 */
export async function fetchExistingRecords(
  projectId: string,
  moduleId: string,
  stage: SendStage
): Promise<ExistingRecords> {
  return requestJson<ExistingRecords>(
    `/api/projects/${encodeURIComponent(projectId)}/existing/${encodeURIComponent(
      moduleId
    )}?stage=${encodeURIComponent(stage)}`,
    undefined,
    tr(
      "De bestaande records konden niet bij AFAS worden opgevraagd.",
      "The existing records could not be requested from AFAS."
    )
  );
}
