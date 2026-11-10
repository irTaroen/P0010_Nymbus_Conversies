import type { CodetabelEntry } from "../types";
import { normalizeAfasCode } from "@/lib/afas-keys";

/**
 * The live AFAS reference lists, keyed by list name. Read by the engine's
 * `codetabel` check. Seeded with static fallbacks at import (see sources.ts)
 * and overwritten with live AFAS data once generated (see registry.ts).
 */
export const CODETABELLEN: Record<string, CodetabelEntry[]> = {};

/**
 * Lookup index per list, rebuilt whenever a list is set. The lists are long
 * (Woonplaatsen holds thousands of entries) and the engine asks once per cell,
 * so a scan per cell would be O(rows × entries).
 *
 * Codes are indexed upper-cased: AFAS codes are upper case ("NL", "AFG") and
 * place names are capitalized, while customer sheets are inconsistent about it.
 * Matching case-insensitively keeps "amsterdam" out of the error list — the
 * same leniency `unique` already applies.
 */
interface ListIndex {
  /** Every code in the list, regardless of scope. */
  codes: Set<string>;
  /** scope -> the codes valid within it. Empty for unscoped lists. */
  byScope: Map<string, Set<string>>;
  /**
   * scope -> the code of its **first** entry, in AFAS's order, as AFAS wrote it —
   * what {@link codetabelCodeForScope} answers, built once here rather than by a scan
   * of the whole list per payload row.
   */
  firstCodeByScope: Map<string, string>;
  /** Whether this list's codes are compared as numbers too (see below). */
  numeric: boolean;
  /** The same for its scopes — see {@link codetabelScopeKey}. */
  numericScope: boolean;
  /**
   * Normalised omschrijving -> the code it names, or `null` when two entries share
   * the name. What the autofix reads (`lib/validation/autofix.ts`) to turn a cell
   * holding `Nederland` into `NL`.
   */
  byName: Map<string, string | null>;
  /**
   * The same, per scope — for a scoped rule, which only accepts a code within the
   * row's scope (`Oproepkracht` is `O` under cao `Basis`, and only a name under
   * *that* cao may resolve). Empty for unscoped lists.
   */
  byScopeName: Map<string, Map<string, string | null>>;
}

const INDEXES = new Map<string, ListIndex>();

/**
 * Which project the values currently in the store belong to.
 *
 * The store is keyed by table name alone, because the engine asks for
 * "Betalingsvoorwaarden" and has no project in hand. But a codetabel **is** that
 * customer's table — the registry's cache key is `<projectId>:<key>` for exactly
 * that reason — so the two have to be reconciled somewhere, and this is it.
 *
 * Without it, switching project left the previous customer's values in place until
 * the new fetch resolved, and `codetabelIsLoaded()` reported them as ready. A sheet
 * validated in that window was judged against the wrong customer's table: their
 * codes passed, this customer's own were flagged wrong. Proven in a scratch run
 * (22-09-2026), not theorised.
 *
 * `null` while nothing has been loaded yet.
 */
let ownerProjectId: string | null = null;

/**
 * Drop every table unless it already belongs to `projectId`.
 *
 * Called before a project's tables are fetched. Clearing rather than keeping is the
 * safe direction: an empty table makes the engine **skip** its check (see
 * `codetabelIsLoaded`), which under-reports, while a stale one actively misjudges —
 * and only the second of those is silent about being wrong.
 */
export function claimCodetabellenFor(projectId: string): boolean {
  if (ownerProjectId === projectId) return false;
  ownerProjectId = projectId;
  for (const key of Object.keys(CODETABELLEN)) delete CODETABELLEN[key];
  INDEXES.clear();
  return true;
}

/**
 * Whether the store currently holds `projectId`'s tables. A fetch has to ask this
 * when it **lands**, not when it starts: one started for the previous project and
 * answered after the switch would otherwise write that customer's values straight
 * back into the store {@link claimCodetabellenFor} just emptied.
 */
export function codetabellenBelongTo(projectId: string): boolean {
  return ownerProjectId === projectId;
}

/**
 * How a code is indexed and looked up: upper-cased, and for a **numeric** list
 * also stripped of the leading zeros AFAS pads its codes with.
 *
 * The administratietabel is the case this exists for. AFAS returns `01` and `02`,
 * but the sheet columns holding an administratie are typed `integer`, and Excel
 * drops a leading zero from any numeric cell as a matter of course — so a
 * perfectly correct sheet arrives carrying `1`. Comparing those strictly would
 * flag a whole column red over formatting, which is exactly the kind of wrong
 * verdict the codetabellen were introduced to stop. The upload is unaffected:
 * what goes to AFAS is the mapped payload, not the cell as typed.
 *
 * Only declared-numeric lists get this. A code table whose codes merely *look*
 * numeric may still distinguish `01` from `1`, and silently equating them
 * everywhere would be a guess dressed up as leniency.
 */
function normalizeCode(code: string, numeric: boolean): string {
  return numeric ? normalizeAfasCode(code) : code.toUpperCase();
}

/**
 * How a **scope** of list `key` is compared — the form the indexes hold it in, and
 * what the value picker narrows on. Upper-cased, and for a list declared
 * `numericScope` also stripped of padding, by the same rule as {@link normalizeCode}.
 *
 * `Functies` is why: its scope is a werkgevercode, which AFAS pads (`01`) and a
 * sheet exporting the Werkgever column as a number writes as `1`. The `Werkgevers`
 * check accepts that `1` — but compared strictly here it named a scope the table
 * didn't cover, and an uncovered scope *passes*, so every functie on that row went
 * unchecked without a word. Opt-in for the reason `numeric` is: a cao or land code
 * that merely looks numeric may still mean something different padded.
 */
export function codetabelScopeKey(key: string, scope: string): string {
  return normalizeCode(scope.trim(), INDEXES.get(key)?.numericScope ?? false);
}

function buildIndex(
  entries: CodetabelEntry[],
  numeric: boolean,
  numericScope: boolean,
  resolveNames: boolean
): ListIndex {
  const codes = new Set<string>();
  const byScope = new Map<string, Set<string>>();
  const byName = new Map<string, string | null>();
  const byScopeName = new Map<string, Map<string, string | null>>();
  const firstCodeByScope = new Map<string, string>();
  for (const entry of entries) {
    // Every entry, before the filter below — exactly what the old per-call scan saw.
    const entryScope = normalizeCode((entry?.scope ?? "").trim(), numericScope);
    if (entryScope !== "" && !firstCodeByScope.has(entryScope)) {
      firstCodeByScope.set(entryScope, entry.code);
    }
    if (typeof entry?.code !== "string" || entry.code === "") continue;
    const code = normalizeCode(entry.code, numeric);
    codes.add(code);
    if (resolveNames && typeof entry.omschrijving === "string" && entry.omschrijving.trim() !== "") {
      const name = normalizeName(entry.omschrijving);
      addName(byName, name, entry.code);
      if (entry.scope) {
        const scope = normalizeCode(entry.scope.trim(), numericScope);
        let names = byScopeName.get(scope);
        if (!names) byScopeName.set(scope, (names = new Map()));
        addName(names, name, entry.code);
      }
    }
    if (!entry.scope) continue;
    const scope = normalizeCode(entry.scope.trim(), numericScope);
    const scoped = byScope.get(scope);
    if (scoped) scoped.add(code);
    else byScope.set(scope, new Set([code]));
  }
  return { codes, byScope, firstCodeByScope, numeric, numericScope, byName, byScopeName };
}

/**
 * Record that `name` names `code`. A name two entries share names neither: `null`
 * marks it ambiguous, so the autofix leaves such a cell for the user rather than
 * picking one (`Gevelbehandelaar II` is both `GEVL` and `GEVL3` at one customer).
 */
function addName(names: Map<string, string | null>, name: string, code: string): void {
  names.set(name, names.has(name) && names.get(name) !== code ? null : code);
}

/**
 * How an omschrijving is compared: case, accents and runs of whitespace carry no
 * meaning, so `belgie`, `België` and ` België ` all name the same land. Punctuation
 * stays — `Ver. Arabische Emiraten` is matched as AFAS writes it or not at all.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Replace a list's entries with what an AFAS environment answered.
 *
 * `numeric` says the codes are numbers AFAS happens to pad (see
 * {@link normalizeCode}), `numericScope` the same of the scopes (see
 * {@link codetabelScopeKey}), `resolveNames` whether an omschrijving may stand in for
 * its code (see {@link codetabelCodeForName}). Both are properties of the table,
 * declared once in `sources.ts` and passed through by the fetch, not something a
 * caller decides per call.
 */
export function setCodetabel(
  key: string,
  entries: CodetabelEntry[],
  {
    numeric = false,
    numericScope = false,
    resolveNames = true,
  }: { numeric?: boolean; numericScope?: boolean; resolveNames?: boolean } = {}
): void {
  CODETABELLEN[key] = entries;
  INDEXES.set(key, buildIndex(entries, numeric, numericScope, resolveNames));
}

/** Whether a table has been set at all, whatever it holds. */
export function hasCodetabel(key: string): boolean {
  return key in CODETABELLEN;
}

/**
 * Whether a table holds values a check can actually be judged against.
 *
 * Distinct from {@link hasCodetabel}: a table that was set but came back empty is
 * present and useless. The engine asks this one, because "no table" has to **pass**
 * rather than fail — with no bundled snapshots, an absent table would otherwise
 * mark every value in its column wrong. See `codetabelVerdict` in engine.ts.
 */
export function codetabelIsLoaded(key: string): boolean {
  return (INDEXES.get(key)?.codes.size ?? 0) > 0;
}

/**
 * A table's entries — whatever an AFAS environment last answered with, and empty
 * both for a key nobody registered and for one no environment could serve. What the value picker reads to
 * show the user the list a cell was judged against; the engine's own checks go
 * through the indexes below instead.
 */
export function getCodetabel(key: string): CodetabelEntry[] {
  return CODETABELLEN[key] ?? [];
}

/**
 * Whether `value` is a code in the list, in any scope. Case-insensitive, and
 * padding-insensitive on a numeric list ({@link normalizeCode}).
 */
export function codetabelHasCode(key: string, value: string): boolean {
  const index = INDEXES.get(key);
  return index?.codes.has(normalizeCode(value, index.numeric)) ?? false;
}

/**
 * The code whose **omschrijving** is `name`, or `null` when no entry is called that
 * or more than one is. Returned as AFAS stores it, since it is written into the cell.
 *
 * The lookup behind the codetabel autofix: clients fill in `Nederland` where the
 * template asks for `NL`. Exact (bar case, accents and whitespace) on purpose — a
 * prefix or fuzzy match would turn `Marokkaan` into whichever entry happened to
 * start that way, and a wrong code here is sent to AFAS without anyone seeing it.
 */
export function codetabelCodeForName(key: string, name: string): string | null {
  return INDEXES.get(key)?.byName.get(normalizeName(name)) ?? null;
}

/** {@link codetabelCodeForName}, among the entries of `scope` only. */
export function codetabelCodeForNameInScope(
  key: string,
  name: string,
  scope: string
): string | null {
  return (
    INDEXES.get(key)?.byScopeName.get(codetabelScopeKey(key, scope))?.get(normalizeName(name)) ??
    null
  );
}

/**
 * The **first** code the list holds for `scope`, or `""` when it holds none.
 *
 * A lookup rather than a check: the payload builder uses it to *produce* a value
 * (the type bank for the country of a bank account), where every other function here
 * judges one the user typed. First rather than only, because six countries in
 * `ALG_TypeBank` carry more than one row — overseas territories sharing a code — and
 * AFAS's own order is the answer it would give itself.
 *
 * Returns the entry's code as stored, not normalised: this value is going into a
 * payload, so it has to be what AFAS wrote rather than what a comparison needed.
 */
export function codetabelCodeForScope(key: string, scope: string): string {
  const wanted = codetabelScopeKey(key, scope);
  if (wanted === "") return "";
  return INDEXES.get(key)?.firstCodeByScope.get(wanted) ?? "";
}

/**
 * Whether the list holds any entry for `scope` — i.e. whether it can say
 * anything about that scope at all. A scoped check treats "no entries" as
 * "nothing to check against" rather than "everything is wrong".
 */
export function codetabelCoversScope(key: string, scope: string): boolean {
  return (INDEXES.get(key)?.byScope.get(codetabelScopeKey(key, scope))?.size ?? 0) > 0;
}

/** Whether `value` is a code in the list *within* `scope`. Case-insensitive. */
export function codetabelHasCodeInScope(key: string, value: string, scope: string): boolean {
  const index = INDEXES.get(key);
  return (
    index?.byScope
      .get(codetabelScopeKey(key, scope))
      ?.has(normalizeCode(value, index.numeric)) ?? false
  );
}
