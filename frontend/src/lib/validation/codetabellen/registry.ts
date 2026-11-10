/**
 * Codetabel registry.
 *
 * A *codetabel* is a reference table in AFAS — landen, woonplaatsen,
 * nationaliteiten, betaalvoorwaarden — holding the set of values a column is
 * allowed to contain. A column is checked against one with
 * `{ "check": "codetabel", "tableRef": "<key>" }`.
 *
 * Declare every table once with `registerCodetabel` (see sources.ts). At runtime
 * the tables a module needs are derived from its rules and fetched on demand.
 *
 * **A codetabel belongs to one project.** It comes out of that customer's own AFAS
 * environment, so the project is part of both the endpoint and the cache key: a
 * betaalvoorwaardentabel is set up per administratie, and serving one customer's to
 * another would judge a sheet against the wrong values. Switching project therefore
 * refetches rather than reusing what the previous one had.
 */

import type { CodetabelEntry } from "../types";
import { RULE_SETS } from "../rules";
import { claimCodetabellenFor, codetabellenBelongTo, setCodetabel } from "./store";
import { apiUrl, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

/**
 * Which environment a table's current values came from — what the UI tells the
 * user. Mirrors the backend's `Source` enum (backend/codetabellen.py).
 */
export type CodetabelSourceKind =
  /** This project's own AFAS: the table the import will actually hit. */
  | "client"
  /** Nymbus's live environment, standing in because the client's couldn't answer. */
  | "nymbus"
  /** Nobody answered. There is no table, so the check is skipped. */
  | "none";

export interface CodetabelSource {
  /**
   * Backend path for this table, given a project. Defaults to
   * `/api/projects/<projectId>/codetabellen/<key>` — the backend's generic route.
   */
  endpoint?: (projectId: string, key: string) => string;
  /**
   * No backend connector (yet): nothing is fetched, so an endpoint the backend
   * doesn't serve never shows up as a warning. Such a table stays empty, and the
   * engine skips a check it can't judge.
   */
  staticOnly?: boolean;
  /**
   * How the value picker shows this table to the user (see
   * {@link CodetabelPickerColumns}). Optional: a table without one is shown as
   * `Code` + `Omschrijving`.
   */
  picker?: CodetabelPickerColumns;
  /**
   * The codes are numbers AFAS pads with leading zeros (`01`, `02`), so a cell
   * holding `1` names the same entry. Set this only where that is true of the
   * table itself — see `normalizeCode` in store.ts for why it isn't the default.
   */
  numeric?: boolean;
  /**
   * The same of the **scopes**: an entry's scope is a padded number (`Functies`,
   * scoped by werkgevercode `01`), so a row whose scope column holds `1` narrows
   * to it. See `codetabelScopeKey` in store.ts.
   */
  numericScope?: boolean;
  /**
   * Whether a cell holding an entry's **omschrijving** may be resolved to its code
   * (`Nederland` → `NL`) — see `lib/validation/autofix.ts`. On by default: it is
   * part of what the `codetabel` check does. Turn it off only for a table whose
   * omschrijving does not name the entry itself.
   */
  resolveNames?: boolean;
}

/**
 * One column of the value picker. `field` says which part of a `CodetabelEntry`
 * it shows and `label` is the header above it — deliberately the AFAS table's own
 * field name (`Code`, `Naam`, `Woonplaats`), so what the user picks from reads
 * like the table they know from AFAS.
 */
export interface CodetabelColumn {
  label: string;
  /** `label` in English, when it differs — read through `localized()` (lib/i18n.ts). */
  labelEn?: string;
  field: keyof CodetabelEntry;
}

/**
 * How the value picker presents a table: the columns it shows, in order, both of
 * them searchable.
 *
 * There is no "which field is written into the cell" setting, on purpose: the
 * `codetabel` check compares a cell to an entry's **`code`**, so the code is the
 * only thing a pick can write and still validate. For the woonplaatsen table that
 * *is* the place name — `sources.ts` normalizes `Woonplaats` to `code` — which is
 * why picking a row there fills in the woonplaats and not its land.
 */
export interface CodetabelPickerColumns {
  columns: CodetabelColumn[];
}

/** Shown for a table that hasn't declared its own columns yet. */
const DEFAULT_PICKER: CodetabelPickerColumns = {
  columns: [
    { label: "Code", field: "code" },
    { label: "Omschrijving", labelEn: "Description", field: "omschrijving" },
  ],
};

const SOURCES: Record<string, CodetabelSource> = {};

/**
 * Register a codetabel and the endpoint that serves it. Call once per table.
 * The `key` is what rules reference via `tableRef`.
 */
export function registerCodetabel(key: string, source: CodetabelSource = {}): void {
  SOURCES[key] = source;
  // No values are seeded: a codetabel only ever holds what an AFAS environment
  // answered with. Until one does, the table is absent and the engine's check
  // passes for want of anything to compare against — see `sources.ts`.
}

function endpointFor(projectId: string, key: string): string {
  const custom = SOURCES[key]?.endpoint;
  return apiUrl(
    custom ? custom(projectId, key) : `/api/projects/${projectId}/codetabellen/${key}`
  );
}

/** How to present a table in the value picker, with a sensible default. */
export function codetabelPicker(key: string): CodetabelPickerColumns {
  return SOURCES[key]?.picker ?? DEFAULT_PICKER;
}

// Which environment the values currently in the store came from, per table. Read
// by the UI to say what a check actually judged a cell against: the customer's own
// table, Nymbus's standing in for it, or nothing at all — which is the one the
// reader most needs to know, since that column then isn't being checked.
const SOURCE_KIND: Record<string, CodetabelSourceKind> = {};

/**
 * Where this table's current values came from. `undefined` means no attempt has
 * been made yet (nothing fetched, nothing failed) — deliberately distinct from
 * `"none"`, which is a fetch that came back empty-handed.
 */
export function sourceOf(key: string): CodetabelSourceKind | undefined {
  return SOURCE_KIND[key];
}

/** The tables a module needs that no environment could serve, so aren't checked. */
export function unresolvedCodetabellen(moduleId: string): string[] {
  return codetabelKeysForModule(moduleId).filter((key) => SOURCE_KIND[key] === "none");
}

// A table is fetched at most once per project per session. Both maps are keyed by
// `<projectId>:<key>` — not by key alone — so opening another project fetches its
// own tables instead of reusing the ones already in the store.
const loaded = new Set<string>();
const inflight = new Map<string, Promise<void>>();

function cacheKey(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

/** What the backend answers with — `source` mirrors its `Source` enum. */
interface CodetabelResponse {
  entries: CodetabelEntry[];
  count?: number;
  source?: CodetabelSourceKind;
  /** Which omgevingnummer answered. Empty when none did. */
  environment?: string;
  /** Why nobody could serve it, in AFAS's own Dutch. */
  message?: string;
  fetchedAt?: string;
}

/**
 * Fetch one codetabel for a project if it hasn't been fetched yet. Idempotent.
 *
 * Never rejects. A table no environment can serve is a normal early state of a
 * conversion (the project's AFAS credentials aren't filled in yet), not an error
 * worth breaking the page over — the table is simply left absent, which makes the
 * engine skip that check, and `sourceOf(key)` reports `"none"` so the UI can say
 * the column went unchecked.
 */
export function ensureCodetabel(projectId: string, key: string): Promise<void> {
  const id = cacheKey(projectId, key);
  if (loaded.has(id)) return Promise.resolve();
  const current = inflight.get(id);
  if (current) return current;

  const source = SOURCES[key];
  if (!source) {
    console.warn(
      `Codetabel "${key}" is not registered (add it in codetabellen/sources.ts)`
    );
    return Promise.resolve();
  }

  // A table with no connector yet: nothing to fetch, and nothing to check against.
  if (source.staticOnly) {
    loaded.add(id);
    return Promise.resolve();
  }

  const promise = requestCodetabel(projectId, key)
    .then((data) => {
      // Switched project while this was in flight: these are another customer's
      // values now, and the store belongs to someone else. Dropped, not written —
      // and not marked loaded, so returning to that project fetches them again.
      if (!codetabellenBelongTo(projectId)) return;
      // The backend reports "no environment could serve this" as a 200 with no
      // entries and `source: "none"`, so it can say *why* in Dutch.
      if (!data.entries?.length || data.source === "none") {
        SOURCE_KIND[key] = "none";
        // Deliberately not marked loaded: a project whose credentials are filled
        // in later should get a real table on the next visit.
        console.warn(
          `Codetabel "${key}" is door geen enkele AFAS-omgeving geleverd — ` +
            `deze controle wordt overgeslagen:`,
          data.message || "geen reden opgegeven"
        );
        return;
      }
      setCodetabel(key, data.entries, {
        numeric: source.numeric ?? false,
        numericScope: source.numericScope ?? false,
        resolveNames: source.resolveNames ?? true,
      });
      SOURCE_KIND[key] = data.source === "nymbus" ? "nymbus" : "client";
      loaded.add(id);
    })
    .catch((err) => {
      // A warning, not an error: the check degrades to "not checked" rather than
      // to a wrong verdict, and a `console.error` would pop the Next dev overlay
      // for a project that simply isn't configured yet.
      if (codetabellenBelongTo(projectId)) SOURCE_KIND[key] = "none";
      console.warn(
        `Kon codetabel "${key}" niet ophalen — deze controle wordt overgeslagen:`,
        err
      );
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, promise);
  return promise;
}

/**
 * One table's raw answer from the backend. A hand-built fetch rather than
 * `requestJson`: a table that fails to load is a degradation to be recorded, not an
 * exception to propagate, which needs the raw status here rather than an
 * `ApiError`.
 */
function requestCodetabel(projectId: string, key: string): Promise<CodetabelResponse> {
  return fetch(endpointFor(projectId, key)).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<CodetabelResponse>;
  });
}

/**
 * One project's table for a caller that only wants the list, **outside** the
 * store: `null` when no environment could serve it or the request failed.
 *
 * For the project settings dialog, which may be opened for any project, not just
 * the one whose sheets the store is judging. Going through the store would either
 * be refused (it belongs to another project) or — worse — put this project's
 * values where the open module's checks read them.
 */
export async function fetchCodetabelEntries(
  projectId: string,
  key: string
): Promise<CodetabelEntry[] | null> {
  try {
    const data = await requestCodetabel(projectId, key);
    return data.entries?.length && data.source !== "none" ? data.entries : null;
  } catch (err) {
    console.warn(`Kon codetabel "${key}" niet ophalen:`, err);
    return null;
  }
}

/** The table keys a module's rules reference via `codetabel` checks. */
export function codetabelKeysForModule(moduleId: string): string[] {
  const ruleSet = RULE_SETS[moduleId];
  if (!ruleSet) return [];
  const keys = new Set<string>();
  for (const col of ruleSet.columns) {
    for (const rule of col.rules) {
      if (rule.check === "codetabel" && rule.tableRef) keys.add(rule.tableRef);
    }
  }
  return [...keys];
}

/**
 * Tables a module needs that **no rule references** — read by the payload builder
 * rather than by a check.
 *
 * `codetabelKeysForModule` walks the rule set, which is the right source for every
 * table that judges a cell. A phase's override reads one to *produce* a value
 * instead (`BkTp`, the type bank, from the country of the account), so nothing in
 * the rules mentions it and it would simply never be fetched.
 *
 * Kept here beside the rule-derived list rather than in `module-phases.ts`, so the
 * one function callers ask — "which tables does this module need" — still has one
 * answer. Declared per module because that is what the fetch is scoped by.
 */
const PAYLOAD_TABLES: Record<string, string[]> = {
  "hrm-medewerkers": ["TypeBank"],
  "erp-debiteuren": ["TypeBank"],
  "erp-crediteuren": ["TypeBank"],
};

/** Every table this module needs: the rules' and the payload's, deduplicated. */
export function codetabelKeysNeededBy(moduleId: string): string[] {
  return [
    ...new Set([
      ...codetabelKeysForModule(moduleId),
      ...(PAYLOAD_TABLES[moduleId] ?? []),
    ]),
  ];
}

/** Fetch every codetabel a module needs, for one project. Safe to call repeatedly. */
export function ensureCodetabellenForModule(
  projectId: string,
  moduleId: string
): Promise<void> {
  // Before anything is read or fetched: the store is keyed by table name alone, so
  // a switch of project has to evict the previous customer's values or this
  // customer's sheet is judged against them while the new fetch is in flight. A
  // no-op when the project hasn't changed, which is every call but the first after
  // a switch. `SOURCE_KIND` goes with them — it describes those same values.
  if (claimCodetabellenFor(projectId)) {
    for (const key of Object.keys(SOURCE_KIND)) delete SOURCE_KIND[key];
    // And `loaded` with them, for **every** project: the store now holds nothing, so
    // a key still marked loaded would report a table that isn't there any more and
    // `ensureCodetabel` would skip the fetch that would bring it back. That is the
    // A → B → A case — returning to a project whose tables were evicted while it was
    // in the background — which would otherwise leave its columns silently unchecked
    // for the rest of the session.
    loaded.clear();
  }
  return Promise.all(
    codetabelKeysNeededBy(moduleId).map((key) => ensureCodetabel(projectId, key))
  ).then(() => {});
}

/**
 * Fetch a module's codetabellen again, **through** the backend's cache rather than
 * out of it. Resolves with the number of tables refreshed; rejects with the
 * backend's refusal (admin-only) as an `ApiError`.
 *
 * Two caches stand between AFAS and the engine, and both have to give way: the
 * backend holds a table for an hour (`_TTL_SECONDS` in backend/codetabellen.py),
 * and `loaded` here holds it for the life of the page. Clearing only `loaded` would
 * refetch the backend's same stale copy — which is exactly why a reload didn't help
 * when a customer added places to `ALG_Woonplaatsen` during the day. So the
 * backend's copy is dropped first, every table before any is refetched.
 *
 * The values already in the store stay put until the new ones arrive, so the sheet
 * is never judged against an empty table in between.
 */
export async function refreshCodetabellenForModule(
  projectId: string,
  moduleId: string
): Promise<number> {
  const keys = codetabelKeysNeededBy(moduleId).filter(
    (key) => SOURCES[key] && !SOURCES[key].staticOnly
  );
  await Promise.all(
    keys.map((key) =>
      requestJson(
        `/api/projects/${projectId}/codetabellen/${key}/refresh`,
        { method: "POST" },
        tr(`Codetabel "${key}" kon niet worden ververst.`, `Codetabel "${key}" could not be refreshed.`)
      )
    )
  );
  for (const key of keys) loaded.delete(cacheKey(projectId, key));
  await ensureCodetabellenForModule(projectId, moduleId);
  return keys.length;
}
