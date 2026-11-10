/**
 * The records a module's sheet would collide with in the customer's AFAS, as the
 * `existing-record` check reads them.
 *
 * Debiteuren is the case it exists for. A client's export carries organisations
 * AFAS already holds, often under a number of its own; converting them anyway
 * creates the same organisation twice. So each row's name is looked up among the
 * `CON_ERP_Debiteuren` records: held under the row's own number it is the same
 * record (the payload view updates it), held only under another number it is a
 * duplicate in the making — and the number the other way round, held under another
 * name, is a different record the sheet would overwrite.
 *
 * ### Not a codetabel, but fetched beside them
 *
 * The data is the payload view's existence list (`lib/existing-records.ts`), read
 * through a route of its own that every project member may call. That route picks
 * the environment itself, off the module's workflow task: **test** until the test
 * import is approved, **live** from then on (`_validation_stage` in backend/main.py).
 * A name is only a duplicate where the rows are about to land — the test import
 * fills test long before live holds more than a handful of records. The
 * `CodetabellenProvider` fetches it with the module's codetabellen, so the sheet is
 * re-validated when it lands by the same `loadedAt` signal, and a failed read is
 * listed with the tables nobody could serve.
 *
 * Like an absent codetabel, a list that isn't here **skips** the check: still in
 * flight, or AFAS couldn't answer. The second is never treated as "nothing exists"
 * — it is reported as unresolved, so a clean sheet can't pass for a checked one.
 */

import { requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { normalizeKey } from "@/lib/existing-records";
import type { SendStage } from "@/lib/payload-send";
import { RULE_SETS } from "./rules";

/** What the validation route answers — `ExistingRecords` without the stage choice. */
interface RecordsResponse {
  connector: string;
  /** The environment the backend read, chosen off the module's workflow task. */
  stage: SendStage;
  available: boolean;
  /** Normalized key -> the record's name in AFAS. */
  keys: Record<string, string>;
  message: string;
}

interface RecordIndex {
  /** Normalized key -> the record's name as AFAS spells it. */
  byKey: Map<string, string>;
  /** Normalized name -> every normalized key holding it. */
  byName: Map<string, string[]>;
}

type ModuleRecords =
  | { status: "loaded"; stage: SendStage; index: RecordIndex }
  | { status: "unavailable"; stage: SendStage | null; connector: string; message: string };

const RECORDS = new Map<string, ModuleRecords>();

/**
 * Which project the lists in {@link RECORDS} belong to — the same reconciliation
 * as `claimCodetabellenFor` in the codetabel store: the engine asks by module
 * alone, so a switch of project has to evict the previous customer's debiteuren
 * before this one's sheet is judged against them.
 */
let ownerProjectId: string | null = null;

/**
 * How a name is compared: case and runs of whitespace carry no meaning, so
 * `Nymbus  B.V.` is `nymbus b.v.`. Punctuation does — `Nymbus BV` is another
 * spelling, and calling it the same organisation is a guess about someone else's
 * administration.
 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildIndex(keys: Record<string, string>): RecordIndex {
  const byKey = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const [rawKey, name] of Object.entries(keys)) {
    const key = normalizeKey(rawKey);
    if (key === "") continue;
    byKey.set(key, name);
    const n = normalizeName(name);
    if (n === "") continue;
    const held = byName.get(n);
    if (held) held.push(key);
    else byName.set(n, [key]);
  }
  return { byKey, byName };
}

/** Whether a module's rule set has an `existing-record` check — and so needs a list. */
export function moduleChecksExistingRecords(moduleId: string): boolean {
  return (
    RULE_SETS[moduleId]?.columns.some((col) =>
      col.rules.some((rule) => rule.check === "existing-record")
    ) ?? false
  );
}

/**
 * Fetch a module's records from the project's AFAS, replacing what the store
 * held. A no-op for a module without the check. Fetched on every call rather than
 * once per session: unlike a codetabel this list changes as records are sent, and a
 * debiteur created this morning has to count this afternoon.
 */
export async function ensureAfasRecordsForModule(
  projectId: string,
  moduleId: string
): Promise<void> {
  if (ownerProjectId !== projectId) {
    ownerProjectId = projectId;
    RECORDS.clear();
  }
  if (!moduleChecksExistingRecords(moduleId)) return;

  let next: ModuleRecords;
  try {
    const data = await requestJson<RecordsResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/existing/${encodeURIComponent(
        moduleId
      )}/validation`,
      undefined,
      tr(
        "De bestaande records konden niet bij AFAS worden opgevraagd.",
        "The existing records could not be requested from AFAS."
      )
    );
    next = data.available
      ? { status: "loaded", stage: data.stage, index: buildIndex(data.keys ?? {}) }
      : {
          status: "unavailable",
          stage: data.stage,
          connector: data.connector,
          message: data.message,
        };
  } catch (err) {
    next = {
      status: "unavailable",
      stage: null,
      connector: "",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  // Checked when the answer lands, not when it was asked: a fetch for the previous
  // project resolving after a switch must not write that customer's list back.
  if (ownerProjectId === projectId) RECORDS.set(moduleId, next);
}

/**
 * The list a module's check couldn't be run against, named for the toolbar's
 * *niet gecontroleerd* badge — or null when it loaded, or hasn't been asked yet.
 */
export function unresolvedAfasRecords(moduleId: string): string | null {
  const state = RECORDS.get(moduleId);
  if (state?.status !== "unavailable") return null;
  const where = [state.connector, state.stage].filter(Boolean).join(", ");
  return where
    ? tr(`bestaande records (${where})`, `existing records (${where})`)
    : tr("bestaande records", "existing records");
}

/** One row against the records AFAS holds — see {@link existingRecordConflicts}. */
export interface ExistingRecordConflicts {
  /**
   * Keys AFAS holds the row's **name** under, when none of them is the row's own:
   * the record exists and the sheet would create it a second time. Empty when the
   * name is new to AFAS or held under the row's key.
   */
  nameHeldBy: string[];
  /**
   * The name AFAS holds the row's **key** under, when it isn't the row's name: that
   * number is already another record. Null when the key is free or names the same.
   */
  keyHeldAs: string | null;
  /** The environment the records were read from, for the message's `{omgeving}`. */
  stage: SendStage;
}

/**
 * How one row stands against `moduleId`'s records in AFAS, or **null** when there
 * is no list to judge it by — not fetched yet, or AFAS couldn't answer. The engine
 * skips the check then, exactly as it does for an absent codetabel.
 */
export function existingRecordConflicts(
  moduleId: string,
  rawKey: string,
  name: string
): ExistingRecordConflicts | null {
  const state = RECORDS.get(moduleId);
  if (state?.status !== "loaded") return null;
  const key = normalizeKey(rawKey);
  const wanted = normalizeName(name);
  const holders = state.index.byName.get(wanted) ?? [];
  const keyName = state.index.byKey.get(key);
  return {
    nameHeldBy: holders.includes(key) ? [] : holders,
    keyHeldAs: keyName !== undefined && normalizeName(keyName) !== wanted ? keyName : null,
    stage: state.stage,
  };
}
