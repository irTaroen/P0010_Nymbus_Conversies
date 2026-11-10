/**
 * Columns the app fills itself, from the conversion's own configuration.
 *
 * A **facilitaire conversie** does not ask the client for a handful of the columns a
 * standard one does. They are not client data at all: the periodetabel, the
 * livegangdatum and the two Profit-defaults are settings of the conversion, the same
 * on every row, and Nymbus already holds them — the first two on the hoofdproces
 * dossieritem (`HRM-periodetabel` / `Datum_livegang`, the hosted version's `projects()`'s
 * `hrmPeriodetabel` / `livegangDatum`), the last two by knowing what a facilitaire
 * conversie is. Asking a client to retype them is asking them to get them wrong.
 *
 * So for such a project the five columns below are **optional in the sheet and filled
 * by the app**, which is one fact with three consequences, and all three have to hold
 * or the feature is a half-measure the reader can't trust:
 *
 * 1. **Validation** doesn't demand them and doesn't report them missing
 *    ({@link standardColumnFills} feeds `validateSheet`).
 * 2. **The payload** carries the app's value where the sheet has none
 *    ({@link resolveStandardColumns}, read by `buildModulePayloads`).
 * 3. **The missing-column notice** stops naming them — a column the app fills is not
 *    a gap in the template, and saying so about five of them at once is exactly the
 *    false alarm that teaches people to ignore the banner.
 *
 * ### The sheet still wins when it is filled
 *
 * A cell with something in it is used; the app fills a **blank cell or an absent
 * column**. Confirmed as the intended behaviour (Taroen, 09-09-2026). It keeps the
 * feature additive — no value a client typed is thrown away without them seeing it —
 * and it extends the `default-if-empty` validation check, which is keyed by an
 * empty cell only, to an absent column as well. Both resolve to the same fallback, so
 * a facilitaire sheet behaves identically whether its template still carries the
 * columns or has dropped them.
 *
 * ### Where this sits in the three-source picture
 *
 * This is the **configuration** source of
 * docs/afas-integration.md#where-a-value-comes-from, built for the one module and the
 * one conversion type that need it now rather than as the general `FieldSource`
 * variant docs/todo.md items 5 and 6 describe. Deliberately: a new source kind
 * changes the mapping document, the mapping editor, the backend model and every
 * reader of `FieldSource`, and it would still need this table to say *which* column
 * gets *which* setting. Keeping it a resolver over the existing mapping means the
 * stored mappings are untouched — `hrm-medewerkers.json` still maps all five from
 * their columns, which is exactly right for a standard conversion — and the whole
 * behaviour is one lookup the payload builder and the engine both go through.
 */

import type { Project } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { RULE_SETS } from "@/lib/validation/rules";

/** What kind of conversion a fill applies to. Only facilitair has fills today. */
export type ConversionType = Project["conversionType"];

/**
 * One column the app can fill, and where its value comes from.
 *
 * Keyed by the sheet header rather than by the AFAS field code, because both readers
 * ask in the sheet's vocabulary: the engine resolves a rule set's column, and the
 * payload builder is looking at a mapping's `header`. The field code is reached
 * through the mapping, which already holds it.
 */
export interface StandardColumn {
  /** The template's header, verbatim — how both sides recognise the column. */
  header: string;
  /**
   * The value for this conversion, or `null` when the configuration it needs isn't
   * there (an ERP-only project has no periodetabel, AFAS may have no livegangdatum
   * yet).
   *
   * `null` means **this column is not filled after all**: both readers skip it, so
   * it goes back to being an ordinary sheet column — its rules apply and its absence
   * is reported. Promising to fill a column and then sending nothing would be the
   * one outcome nobody can catch, and inventing a plausible value (a 12, next year)
   * lands a wrong periodetabel silently in AFAS.
   */
  value: string | null;
  /**
   * Where the value came from, in Dutch, for the payload line's note — the same slot
   * a column's header and `vaste waarde` occupy. A value with no provenance on
   * screen is a value nobody can check.
   */
  note: string;
}

/** The five columns, per module. Only the modules that have any appear here. */
type FillTable = Record<string, readonly string[]>;

/**
 * Which columns each module hands to the app, by module id.
 *
 * A separate table from the resolver below so *whether* a column is app-filled can be
 * answered without the project's configuration in hand — which is what the missing-
 * column notice and the help drawer need, and what the validation engine needs before
 * it has a value.
 */
const FILLED_COLUMNS: Record<ConversionType, FillTable> = {
  // A standard conversion asks the client for every column of the sjabloon, so a
  // blank cell's default comes from the rule set's `default-if-empty` instead
  // (`ruleDefaultsByKey()` in module-payloads.ts) and an absent column stays reported
  // — the medewerker's *Kostendrager* / *Kostenplaats* ("Profit") included (Taroen,
  // 13-10-2026).
  standard: {
    // The uitzendkrachten sjabloon has no *Periodetabel HRM* column at all, in any
    // conversion type, yet `AfasSalary#PtId` is mandatory — the mapping writes a
    // salary of `V` / 0 for every uitzendkracht (Taroen, 23-09-2026) and points
    // `PtId` at this header so the fill below has a field to land on.
    // *Dagen per week* / *Uren per week* default to 5 and 38 in every conversion
    // type, blank or absent (Taroen, 13-10-2026) — not only a facilitaire one.
    "hrm-uitzendkrachten": ["Periodetabel HRM", "Dagen per week", "Uren per week"],
  },
  dossier: {},
  facilitair: {
    // No *Verzamelrekening* here: it is required client data in every conversion
    // type, blank or absent — the 1400 fallback is gone (Taroen, 06-11-2026).
    "hrm-medewerkers": [
      "Periodetabel HRM",
      "Herhalen na",
      "Jaar volgende periodiek",
      "Kostendrager",
      "Kostenplaats",
    ],
    // Both already carry these values as a `default-if-empty` rule, for every
    // conversion type — so the table has always shown 5 and 38 for a blank cell, and
    // the help article already promises them for a column that isn't delivered at
    // all. Listing them here is what makes that promise true: `default-if-empty` is
    // keyed by an empty *cell*, so an absent *column* raised the missing-column
    // banner, and nothing in the payload layer reads the check at all — a blank cell
    // reached AFAS with `DyWk`/`HrWk` omitted rather than with 5 and 38.
    "hrm-uitzendkrachten": ["Periodetabel HRM", "Dagen per week", "Uren per week"],
  },
};

/**
 * The headers this module/conversion combination fills itself — empty for every
 * combination that fills nothing, which is most of them.
 *
 * Callers take a `Set` because both of them ask the same question per column in a
 * loop over a rule set or a mapping.
 */
export function standardColumnHeaders(
  conversionType: ConversionType,
  moduleId: string | null
): ReadonlySet<string> {
  if (!moduleId) return EMPTY;
  const headers = FILLED_COLUMNS[conversionType]?.[moduleId];
  return headers ? new Set(headers) : EMPTY;
}

/** Shared so a caller memoising on the result doesn't rebuild on every render. */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * `Herhalen na (perioden)` — the number of periods between two periodieken.
 *
 * A function of the periodetabel and nothing else: **12** for periodetabel 5
 * (maandelijks, 12 periods in a year), **13** for periodetabel 6 (vierwekelijks, 13
 * of them). Any other periodetabel has no confirmed answer, so it gets none —
 * `null`, and the field is omitted rather than filled with a plausible 12.
 *
 * **Corrected 22-09-2026** (Taroen). This used to read 4 → 13 and 5 → 12, which was
 * wrong about *which numbers the periodetabellen are*: the pair is 5 and 6, not 4
 * and 5. AFAS confirmed it from the other side — a salary with `PtId` 4 is refused
 * in Balans's environment with "De ingevulde waarde bij 'Periodetabel' bestaat
 * niet", while 5 is what every employee already there carries.
 *
 * Exported so the project settings dialog's *Periodetabel HRM* hint can say what it
 * will fill, for whichever periodetabellen that project's AFAS turns out to offer,
 * without repeating these numbers next to the dropdown — a second copy would be free
 * to drift from the one that actually reaches the payload.
 */
export function herhalenNa(periodetabel: number | null): string | null {
  if (periodetabel === 5) return "12";
  if (periodetabel === 6) return "13";
  return null;
}

/**
 * `Jaar volgende periodiek` — the year **after** the livegangdatum's (livegang in
 * 2027 → 2028; Taroen, 23-08-2026).
 *
 * The livegangdatum arrives as AFAS wrote it, and AFAS's dossieritem fields come back
 * as ISO (`2027-01-01`, sometimes with a time) — so the year is the leading four
 * digits. A `DD-MM-YYYY` form is read too rather than assumed away: this value is one
 * digit's worth of wrong away from a payload nobody catches, so both notations are
 * recognised explicitly and anything else yields `null`.
 */
function jaarVolgendePeriodiek(livegangDatum: string): string | null {
  const text = livegangDatum.trim();
  const iso = /^(\d{4})-\d{2}-\d{2}/.exec(text);
  if (iso) return String(Number(iso[1]) + 1);
  const dutch = /^\d{2}[-/]\d{2}[-/](\d{4})$/.exec(text);
  if (dutch) return String(Number(dutch[1]) + 1);
  return null;
}

/**
 * The `defaultValue` a module's rule set already states for a column, via its
 * `default-if-empty` check.
 *
 * Read rather than retyped, for the columns where the rule set is already the
 * authority on the value: `hrm-uitzendkrachten`'s *Dagen per week* / *Uren per week*
 * have carried 5 and 38 since 25-08-2026, the table has always shown them for a blank
 * cell, and the help article quotes them. A second copy here would be a third place
 * to keep in step, and the one that silently wins on the payload.
 *
 * `null` when the rule is gone — which is the rule set saying the column is no longer
 * defaulted, and therefore that the app should stop filling it. That is exactly the
 * `null` contract {@link StandardColumn.value} already has: the column reverts to an
 * ordinary sheet column rather than being filled from a stale constant.
 */
function ruleDefault(moduleId: string, column: string): string | null {
  const rules = RULE_SETS[moduleId]?.columns.find((col) =>
    (Array.isArray(col.column) ? col.column : [col.column]).includes(column)
  )?.rules;
  const rule = rules?.find((r) => r.check === "default-if-empty");
  return rule?.defaultValue ?? null;
}

/**
 * The value and provenance of every column this project's conversion fills itself.
 *
 * Keyed by header, so a reader with a column in hand does one lookup. Empty for a
 * standard or dossier project, and for any module without fills — which is what makes
 * every call site's behaviour unchanged for them by construction rather than by a
 * conversion-type branch at each one.
 */
export function resolveStandardColumns(
  project: Pick<Project, "conversionType" | "hrmPeriodetabel" | "livegangDatum">,
  moduleId: string | null
): ReadonlyMap<string, StandardColumn> {
  const headers = standardColumnHeaders(project.conversionType, moduleId);
  if (headers.size === 0) return NO_FILLS;

  const periodetabel = project.hrmPeriodetabel;
  // Keyed by module and then by header, not by header alone: two modules can name a
  // column the same way and mean different things, and a flat table would fill one
  // module's column from the other's entry. `hrm-medewerkers` is already one header
  // away from that — its own week columns are *Aantal* dagen/uren per week, and both
  // are `required` client data rather than something the app may fill.
  const values: Record<string, Record<string, Omit<StandardColumn, "header">>> = {
    "hrm-medewerkers": {
      "Periodetabel HRM": {
        value: periodetabel === null ? null : String(periodetabel),
        note: tr("periodetabel uit projectinstellingen", "pay period table from the project settings"),
      },
      "Herhalen na": {
        value: herhalenNa(periodetabel),
        note: tr(
          `afgeleid van periodetabel ${periodetabel ?? "—"}`,
          `derived from pay period table ${periodetabel ?? "—"}`
        ),
      },
      "Jaar volgende periodiek": {
        value: jaarVolgendePeriodiek(project.livegangDatum),
        note: tr("afgeleid van datum livegang", "derived from the go-live date"),
      },
      // Not configuration read from anywhere: read off the `default-if-empty` rule on
      // both columns, so the amber cell, the payload and the help can't drift.
      Kostendrager: {
        value: ruleDefault("hrm-medewerkers", "Kostendrager"),
        note: tr("standaardwaarde", "default value"),
      },
      Kostenplaats: {
        value: ruleDefault("hrm-medewerkers", "Kostenplaats"),
        note: tr("standaardwaarde", "default value"),
      },
    },
    // The planningscapaciteit of an uitzendkracht: 5 days, 38 hours (Taroen,
    // 09-09-2026). Not typed twice — read off the module's own `default-if-empty`
    // rules, which have carried exactly these two values since 25-08-2026, so the
    // amber cell in the table and the value in the payload cannot drift apart from
    // each other or from the help article that quotes them.
    "hrm-uitzendkrachten": {
      // Same source as the medewerkers' periodetabel. The sheet has no such column,
      // so this is the only way `PtId` is ever filled for an uitzendkracht.
      "Periodetabel HRM": {
        value: periodetabel === null ? null : String(periodetabel),
        note: tr("periodetabel uit projectinstellingen", "pay period table from the project settings"),
      },
      "Dagen per week": {
        value: ruleDefault("hrm-uitzendkrachten", "Dagen per week"),
        note: tr("standaardwaarde", "default value"),
      },
      "Uren per week": {
        value: ruleDefault("hrm-uitzendkrachten", "Uren per week"),
        note: tr("standaardwaarde", "default value"),
      },
    },
  };

  const fills = new Map<string, StandardColumn>();
  for (const header of headers) {
    const entry = moduleId === null ? undefined : values[moduleId]?.[header];
    // A header in the table above with no value entry is a bug in this file rather
    // than a state to render, so it is left out instead of filled with `null` — the
    // column then behaves exactly as it did before, sheet-driven.
    if (entry) fills.set(header, { header, ...entry });
  }
  return fills;
}

/** Shared empty result, for the same memoisation reason as `EMPTY`. */
const NO_FILLS: ReadonlyMap<string, StandardColumn> = new Map();

/**
 * What the validation engine needs: the headers to leave alone, and the value a blank
 * cell in one of them counts as.
 *
 * A separate, narrower shape than the map above because the engine has no business
 * with the notes and must not have to import `Project` — it is handed data, not a
 * project.
 *
 * **A fill with no value behind it is not in either set.** An ERP-only project with
 * no periodetabel, or one whose livegangdatum AFAS hasn't got yet, cannot fill
 * *Periodetabel HRM* — and a column the app has promised to fill and then leaves
 * empty is the worst of the three outcomes: no error, no value, no mention. So such
 * a column reverts to ordinary sheet-driven behaviour, rules and missing-column
 * report included. It is the same answer the payload side reaches (`fillsByKey()`
 * skips a null fill, so the column is reported missing there too), which is what
 * keeps the *Data* tab and the *Payloads* tab telling one story.
 */
export interface StandardColumnFills {
  /** Headers the app fills — not required, not reported missing. */
  headers: ReadonlySet<string>;
  /** Header → the value a blank cell becomes. Same keys as `headers`. */
  values: ReadonlyMap<string, string>;
}

/** {@link resolveStandardColumns} in the form `validateSheet` takes. */
export function standardColumnFills(
  project: Pick<Project, "conversionType" | "hrmPeriodetabel" | "livegangDatum">,
  moduleId: string | null
): StandardColumnFills {
  const values = new Map<string, string>();
  for (const fill of resolveStandardColumns(project, moduleId).values()) {
    if (fill.value !== null) values.set(fill.header, fill.value);
  }
  return { headers: new Set(values.keys()), values };
}

/** The no-fills answer, for a caller with no project in hand. */
export const NO_STANDARD_FILLS: StandardColumnFills = {
  headers: EMPTY,
  values: new Map(),
};

/**
 * Which of a project's fills have **nothing behind them**, and which setting is
 * missing — the gap {@link StandardColumn.value}`: null` leaves, said out loud.
 *
 * The `null` contract is deliberately quiet on the payload: a column the app cannot
 * fill reverts to an ordinary sheet column, rules and missing-column report included,
 * rather than being filled with a plausible guess. That is the right *behaviour* and
 * the wrong *explanation*. What the reader then sees is the missing-column banner —
 * "3 gekoppelde kolommen staan niet in dit bestand … controleer of dit bestand de
 * juiste versie van het sjabloon is" — which names the template as the culprit for a
 * problem that is nothing to do with the template: the sjabloon is correct, the
 * hoofdproces dossieritem is empty. Acting on what that banner says means going back
 * to the client for a sheet that would not help.
 *
 * So this is the counterpart the banner needs: the same condition, read off the same
 * resolver, in the vocabulary of the thing an admin can actually change. Derived
 * rather than re-tested — asking `hrmPeriodetabel === null` here would be a second
 * copy of the rule, and the copy that goes stale the day a fill gains a third input.
 *
 * Empty for every project that has nothing to report: a standard or dossier
 * conversion, a facilitair one whose settings are filled in, and a module with no
 * fills at all. So a caller needs no conversion-type branch of its own.
 */
export interface UnfilledStandardColumns {
  /** The headers that stay sheet-driven because their setting is absent. */
  headers: readonly string[];
  /**
   * Each setting behind those columns, and **why** it isn't producing a value —
   * `null` when this setting isn't implicated at all.
   *
   * Two states rather than one, because they are two different sentences and only
   * one of them is ever true. `"missing"` is the common case: AFAS has nothing, go
   * and fill it in. `"unusable"` is a value that *is* in AFAS and that the tool has
   * no rule for — a periodetabel of 7, a livegangdatum in a notation
   * `jaarVolgendePeriodiek` doesn't recognise. Telling that reader "staat nog niet
   * in AFAS" sends them to a form that already has a value in it, and they conclude
   * the tool is broken — which, for a value it has no rule for, is nearly fair.
   *
   * Per setting rather than one flag for the band, because a project can have both
   * at once (periodetabel 7, livegangdatum empty) and a single verdict would have
   * to libel one of them to describe the other.
   */
  periodetabel: SettingGap | null;
  /** The livegangdatum's state, on the same terms. */
  livegangDatum: SettingGap | null;
}

/** Why a setting isn't yielding a value — see {@link UnfilledStandardColumns}. */
export type SettingGap = "missing" | "unusable";

/** Nothing to report — shared, so a memoising caller doesn't rebuild on it. */
const NOTHING_UNFILLED: UnfilledStandardColumns = {
  headers: [],
  periodetabel: null,
  livegangDatum: null,
};

/**
 * Which setting each fillable column depends on, for the message only.
 *
 * The *value* still comes from {@link resolveStandardColumns} — this table says what
 * to tell the reader to go and fill in, which the resolver has no opinion about. A
 * column that is unfilled for some other reason (a periodetabel that is neither 5 nor
 * 6, so `herhalenNa` has no answer — `18`, say, which 501342's table does offer) is still reported as unfilled, just without a
 * setting named: better a gap with no cause than silence.
 */
const FILL_INPUTS: Record<string, ReadonlySet<"periodetabel" | "livegang">> = {
  "Periodetabel HRM": new Set(["periodetabel"]),
  "Herhalen na": new Set(["periodetabel"]),
  "Jaar volgende periodiek": new Set(["livegang"]),
};

/** {@link UnfilledStandardColumns} for this project and module. */
export function unfilledStandardColumns(
  project: Pick<Project, "conversionType" | "hrmPeriodetabel" | "livegangDatum">,
  moduleId: string | null
): UnfilledStandardColumns {
  const fills = resolveStandardColumns(project, moduleId);
  if (fills.size === 0) return NOTHING_UNFILLED;

  const headers: string[] = [];
  let needsPeriodetabel = false;
  let needsLivegangDatum = false;
  for (const fill of fills.values()) {
    if (fill.value !== null) continue;
    headers.push(fill.header);
    const inputs = FILL_INPUTS[fill.header];
    if (inputs?.has("periodetabel")) needsPeriodetabel = true;
    if (inputs?.has("livegang")) needsLivegangDatum = true;
  }
  if (headers.length === 0) return NOTHING_UNFILLED;
  // Asked of the project, per setting: whether AFAS holds anything at all is a
  // different question from whether the fills could use it, and only the project
  // can answer the first. A setting no unfilled column depends on stays `null` —
  // the band must not name a periodetabel that is doing its job.
  return {
    headers,
    periodetabel: needsPeriodetabel
      ? project.hrmPeriodetabel === null
        ? "missing"
        : "unusable"
      : null,
    livegangDatum: needsLivegangDatum
      ? project.livegangDatum.trim() === ""
        ? "missing"
        : "unusable"
      : null,
  };
}

/**
 * The same question across **every** module a project has — what the project page
 * asks, where no module is open.
 *
 * Every module with fills is walked rather than `hrm-medewerkers` alone, so a fill
 * added to another module is reported here the day it is added and not the day
 * somebody notices this function never heard of it. Headers are deduplicated across
 * modules and kept in the order the modules declare them.
 */
export function unfilledStandardColumnsForProject(
  project: Pick<Project, "conversionType" | "hrmPeriodetabel" | "livegangDatum">
): UnfilledStandardColumns {
  const modules = Object.keys(FILLED_COLUMNS[project.conversionType] ?? {});
  const headers: string[] = [];
  const seen = new Set<string>();
  // The first non-null verdict wins per setting, and there is nothing to reconcile:
  // every module asks the same project about the same two values, so two modules
  // that both name the periodetabel always name it the same way.
  let periodetabel: SettingGap | null = null;
  let livegangDatum: SettingGap | null = null;
  for (const moduleId of modules) {
    const gap = unfilledStandardColumns(project, moduleId);
    if (gap.headers.length === 0) continue;
    for (const header of gap.headers) {
      if (seen.has(header)) continue;
      seen.add(header);
      headers.push(header);
    }
    periodetabel ??= gap.periodetabel;
    livegangDatum ??= gap.livegangDatum;
  }
  if (headers.length === 0) return NOTHING_UNFILLED;
  return { headers, periodetabel, livegangDatum };
}
