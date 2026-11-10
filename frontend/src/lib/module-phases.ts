/**
 * Modules whose records are written to AFAS in **more than one call per record**.
 *
 * Every other module is one row → one body → one POST. A medewerker is not: creating
 * one in AFAS is two calls, and the second is not a retry or a correction of the
 * first but a deliberately later state of the same employee.
 *
 * ### Why an employee takes two calls
 *
 * A conversion carries an employee's history, and AFAS stores the contract, the
 * function, the roster and the salary as **dated records** — each keyed by its own
 * begin date (`AfasContract.DaBe`, `AfasOrgunitFunction.DaBe`, `AfasTimeTable.DaBg`,
 * `AfasSalary.DaBe`, all `primaryKey` in the connector's own schema). So "this person
 * has earned X since livegang, and worked here since 2019" is not one record with two
 * values; it is two records, and no single body can state both.
 *
 * Hence the two phases (Taroen, 22-09-2026):
 *
 * 1. **Aanmaken** — the employee as they have been since *datum in dienst*: a POST
 *    carrying the person, the address, and one contract/functie/rooster/salaris each
 *    beginning on that date. The salary here is deliberately **not** the sheet's: it
 *    is `V` (vast salaris) at **0**, because the amount in the sheet is what the
 *    employee earns *now*, and writing it against 2019 would tell AFAS they have
 *    earned that since 2019 — a payroll history nobody asked for.
 * 2. **Livegang** — the same employee from *datum livegang*: a PUT adding a second
 *    contract/functie/rooster/salaris, identical but for the date, and this time the
 *    salary the sheet actually carries.
 *
 * The result is an employee whose AFAS history says *here since 2019, earning this
 * since livegang* — which is what the client's data means.
 *
 * ### Why phase 2 is a PUT with `@Action: insert`
 *
 * The employee exists after phase 1, so the second call is a PUT on their `EmId`
 * (docs/AFAS-Profit-API-Referentie.md §4). But a PUT **updates** the records whose
 * keys it carries, and a second contract is not an update of the first — so each
 * nested object carries `@Action: insert` inside its own `Fields` (§4.1), which tells
 * AFAS to add a record rather than overwrite the one already there.
 *
 * This was **verified against a real environment** (Balans 501342 at 38892.resttest,
 * 22-09-2026) rather than reasoned about: phase 1 then phase 2 both return 201, and
 * `CON_HRM_Medewerker` afterwards still reports `BegindatumContract` = phase 1's date,
 * which is what proves phase 2 did not overwrite it. Without `@Action` the same body
 * is accepted too — AFAS does not complain — so the difference is invisible at the
 * call and only shows up in the stored history. That is exactly the kind of thing
 * that must be pinned by a test against AFAS rather than by a reading of the docs.
 *
 * ### What a phase is, mechanically
 *
 * A phase is a **transform over the body the mapping already builds**, not a second
 * mapping. It says which objects it keeps, what date to write into each one's begin
 * date, which fields to override with a constant, and which verb to send with. The
 * whole of `buildModulePayloads` — the stored mapping, `remapToSheet`, the standard
 * column fills, grouping — runs underneath unchanged, so a phase cannot drift from
 * the mapping an admin maintains in the editor.
 *
 * A module with no entry here keeps exactly today's behaviour: one body, one POST.
 */

import type { AfasSchemaField } from "@/lib/afas-schema";
import type { FieldValueResolver } from "@/lib/afas-schema";
import { afasDate, afasValue, fieldKey } from "@/lib/field-mapping";
import type { StandardColumn } from "@/lib/standard-columns";
import { codetabelCodeForScope } from "@/lib/validation/codetabellen/store";
import { tr } from "@/lib/i18n";

/** Which call of a multi-step module a body belongs to. */
export type PhaseId = string;

/**
 * A value a phase writes itself, over whatever the mapping resolved.
 *
 * `remove` takes the field **out of the body** — the one way a phase can say "not
 * this one" about a field the mapping fills. Used for `DaEe` (datum uit dienst),
 * which the sheet has no column for and which must never be inferred from the
 * einddatum: an employee whose contract ended is not necessarily out of service, and
 * writing that date would end their employment in AFAS (Taroen, 22-09-2026).
 *
 * `fill` reads one of the conversion's own settings
 * ([`standard-columns.ts`](./standard-columns.ts)) by the sheet header it is keyed
 * by. It exists because the stored mapping has **no entry** for `PtId` (Periodetabel),
 * `PeRp` (Herhalen na) or `YrPe` (Jaar volgende periodiek) — a fill can only cover a
 * field some mapping points at, so with no mapping entry those three reached no
 * payload at all, and `PtId` is `mandatory` on `AfasSalary`. Naming the fill here
 * rather than re-deriving the value keeps one source for the periodetabel: the
 * project's hoofdproces dossieritem, through the same resolver the *Data* tab reads.
 */
export type PhaseOverride =
  | { kind: "constant"; value: string | number | boolean; note: string }
  | { kind: "fill"; header: string; note: string }
  | { kind: "remove"; note: string }
  /**
   * The value another field in the **same object** resolved to, with a fallback when
   * that one is empty too.
   *
   * For a mandatory field the sheet usually leaves blank but sometimes fills, where
   * another field of the same object is the sensible stand-in — the geboortenaam
   * falling back to the achternaam.
   */
  | { kind: "copy"; from: string; fallback: string | number; note: string }
  /**
   * The field as the mapping resolved it, but **only for the rows** whose sheet
   * column holds one of the given values — omitted for every other row.
   *
   * The field-level twin of {@link PhaseObjectWhen}: the loonschaal fields belong on
   * a scale-based salary only, while the salary object itself is written for all.
   */
  | { kind: "keepWhen"; when: PhaseObjectWhen }
  /**
   * A value computed from other fields of the **same object**, or from a column of
   * the sheet.
   *
   * The escape hatch the other four kinds don't cover, for the rules that are
   * neither a constant nor a copy: *Parttime (%)* is the week's hours against a full
   * week, and *Afw. uren p.w. aangifte* is sent only when there are no week hours at
   * all. `read` hands the function the same resolver the body is built with, so it
   * sees exactly what the mapping and the fills produced — and a `cell` reader for
   * the columns AFAS has no field for.
   *
   * Returning `null` **omits** the field, which is how *Wachtdagen toepassen* stays
   * blank and how `DfHo` disappears for everyone who has real week hours.
   */
  | {
      kind: "derive";
      note: string;
      of: (read: PhaseReader) => string | number | boolean | null;
    };

/** What a `derive` is given: this object's fields, and this row's cells. */
export interface PhaseReader {
  /** Another field of the same object, as the mapping resolved it — `""` when empty. */
  field: (fieldId: string) => string;
  /** A column of the sheet for this row, by header — `""` when absent or blank. */
  cell: (header: string) => string;
  /**
   * A field of **another** object of the same body, as the mapping resolved it —
   * `""` when empty. For a field that mirrors a nested object's, like a relation's
   * *voorkeur* IBAN repeating its own `KnBankAccount`.
   */
  at: (path: string, fieldId: string) => string;
  /**
   * The conversion's livegangdatum as `yyyy-mm-dd` — `""` when AFAS has none for the
   * project. For a rule that depends on it, like the verlofsaldo's *Datum boeking*.
   */
  livegang: string;
}

/** Shorthand for the common case. */
function constant(
  value: string | number | boolean,
  note: string
): PhaseOverride {
  return { kind: "constant", value, note };
}

/** One call in a module's sequence. */
export interface ModulePhase {
  /** Stable id — what the toggle, the send and the progress record name it by. */
  id: PhaseId;
  /** What the toggle shows: *Historie*, *Actueel*. */
  label: string;
  /** One line under the toggle saying what this phase writes. */
  description: string;
  /**
   * The verb. `insert` is a POST creating the record; `update` a PUT on a record
   * phase 1 already created.
   *
   * Note this is the phase's **intent**, not the per-record verdict the existence
   * read produces. A module with an `existing` plan still marks records *Bestaat al*
   * and the send still re-checks server-side; a phase whose verb is `update` simply
   * has no insert to fall back to, because its whole premise is that the record is
   * there.
   */
  verb: "insert" | "update";
  /**
   * Object paths this phase writes, relative to the schema root
   * (`AfasEmployee.AfasContract`). A path not listed is **left out of the body
   * entirely**, which is how phase 2 sends four objects where phase 1 sends six.
   *
   * The root itself is always kept — it carries the key.
   */
  objects: string[];
  /**
   * Objects this phase writes **only for some records**, keyed by object path.
   *
   * Distinct from `objects`, which is a property of the phase and narrows the schema
   * once for the whole build. This is a property of the **row**: *AfasPeriodiek*
   * belongs on an employee whose salary is scale-based (`S` / `Su`) and on nobody
   * else, so the object is in the schema for every record and emptied out for the
   * ones it doesn't apply to.
   *
   * Emptied rather than removed, because the schema is shared by every record of a
   * variant — one filtered tree is built per build, not per row. So a record that
   * fails the test has every field of that object omitted, which collapses it to an
   * empty `Fields` block rather than dropping the object. See `phaseSkipsObject`.
   */
  conditionalObjects?: Record<string, PhaseObjectWhen>;
  /**
   * Object paths this phase **never** writes, subtracted from `objects`.
   *
   * The counterpart of `objects` for a phase that keeps everything by default: phase
   * 1 lists no objects (meaning "whatever the mapping fills") but must still leave
   * the agency out, and spelling out the other twenty-nine to exclude one would be a
   * second mapping to maintain.
   */
  excludeObjects?: string[];
  /**
   * Where each dated object's begin date comes from, keyed by object path.
   *
   * The value is a {@link PhaseDate}, resolved per project and row rather than
   * stated here: phase 1's date is a column of the sheet, phase 2's a setting of the
   * conversion, and neither is a constant this file could hold.
   */
  dates: Record<string, PhaseDate>;
  /**
   * Fields this phase writes itself, keyed by `objectPath#FieldId` — the same
   * `fieldKey()` the mapping and the fills are keyed by, so the three cannot
   * disagree about what a field is called.
   */
  overrides: Record<string, PhaseOverride>;
  /**
   * Whether this phase applies to a given record at all.
   *
   * Phase 2 skips an employee whose contract ended **before** livegang: a second
   * contract starting after they left is not a thing that happened, and AFAS would
   * be describing an employment nobody had. Absent means "every record".
   */
  skip?: PhaseSkip;
}

/**
 * When a conditional object applies to a record.
 *
 * `column` is read from the sheet rather than from the built body because it is the
 * client's own answer — *Soort salaris* — and reading the cell keeps the test
 * independent of whatever the mapping happens to do with that column downstream.
 */
export interface PhaseObjectWhen {
  /** The sheet column deciding it, by header. */
  column: string;
  /**
   * The values that switch the object on, compared trimmed and case-insensitively.
   * Absent: any value — the column only has to be filled, as Wagenpark's employee
   * link needs a *Medewerker*.
   */
  isOneOf?: string[];
  /** What the payload line says when the object is left empty. */
  note: string;
}

/** Whether `when` holds for this row's cell. */
function whenApplies(when: PhaseObjectWhen, cell: (header: string) => string): boolean {
  const value = cell(when.column).trim().toLowerCase();
  if (!when.isOneOf) return value !== "";
  return when.isOneOf.some((option) => option.toLowerCase() === value);
}

/** Where a phase's begin date comes from. */
export type PhaseDate =
  /** A column of the sheet, by header — *Datum in dienst*. */
  | { kind: "column"; header: string }
  /** The conversion's livegangdatum, off the hoofdproces dossieritem. */
  | { kind: "livegang" };

/** Why a phase might not apply to one record. */
export type PhaseSkip = {
  /** The column holding the date that decides it, by header. */
  column: string;
  /** Skip when that date is **before** the livegangdatum. A blank cell never skips. */
  before: "livegang";
  /** What the panel says about the skipped ones. */
  reason: string;
};

/** The salary object, named once — the phases that write one all point at it. */
const SALARY_PATH = "AfasEmployee.AfasSalary";

/**
 * `AfasEmployee`'s dated objects — the ones both phases write.
 *
 * Named once because both phases need the identical list and a phase that wrote
 * three of the four would produce an employee whose salary started at livegang and
 * whose contract did not, which is not a state anybody meant to create.
 *
 * The salary is passed separately (`datesFor`'s `extra`) because phase 2 also
 * dates the periodiek, which only rides along with a salary.
 */
const EMPLOYEE_DATED_OBJECTS = [
  "AfasEmployee.AfasContract",
  "AfasEmployee.AfasOrgunitFunction",
  "AfasEmployee.AfasTimeTable",
] as const;

/** The periodiek object, named once — three places point at it. */
const PERIODIEK_PATH = "AfasEmployee.AfasPeriodiek";

/**
 * The sector-fonds registration (*APG Beroep*, *APG Cao*) — **sent by neither phase**
 * for now (Taroen, 27-09-2026).
 *
 * It was briefly phase 2's, dated at livegang like the fiscus, and was taken out
 * again because it kept failing: AFAS demands `AyId`, `ViDi`, `ViSr` and `SdLn` on
 * it, and the value list for `ViSe` did not hold the code it was given. Excluded
 * explicitly rather than unmapped, so the mapping keeps its entries and this file is
 * the one place that says the phases skip it. Its `DaBe` stays in
 * `EMPLOYEE_DATE_FIELDS`, so putting it back is adding the path to phase 2's
 * `objects` and `dates`.
 */
const AGENCY_PATH = "AfasEmployee.AfasAgencySfb";

/**
 * The fiscal registration (*Fiscus*, instantie `F`) — written in **both** phases, as
 * one more dated object (Taroen, 27-09-2026).
 *
 * Every field but the date is the same for every employee and sits in the stored
 * mapping as a fixed value (Taroen, 25-09-2026): inkomstenverhouding 15, aard 1,
 * witte tabel, tabelcode 0, loonheffingskorting toepassen, Zvw `K`, no alleenstaande
 * ouderenkorting, no vakantiebonnen.
 *
 * Dated at the **livegangdatum in both phases** (Taroen, 27-09-2026), not like the
 * contract: the fiscal registration counts from when payroll starts running in AFAS.
 * Note that `DaBe` and `AyId` are the record's key, so both phases address the same
 * record — if AFAS refuses phase 2's `@Action: insert` as a duplicate, this is why.
 * Phase 2's `skip` keeps it away from an employee whose contract ended before
 * livegang.
 */
const FISCUS_PATH = "AfasEmployee.AfasAgencyFiscus";

/** Each dated object's own begin-date field — AFAS is not consistent about it. */
const EMPLOYEE_DATE_FIELDS: Record<string, string> = {
  "AfasEmployee.AfasContract": "DaBe",
  "AfasEmployee.AfasOrgunitFunction": "DaBe",
  // The one that differs: the roster's key is `DaBg`, not `DaBe`. Getting this wrong
  // writes the date into no field at all and leaves the mandatory key unset, which
  // AFAS rejects with a message about the *rooster* rather than about a date.
  "AfasEmployee.AfasTimeTable": "DaBg",
  "AfasEmployee.AfasSalary": "DaBe",
  [PERIODIEK_PATH]: "DaBe",
  [AGENCY_PATH]: "DaBe",
  [FISCUS_PATH]: "DaBe",
};

/** The date field of a dated object, or null when it isn't one. */
export function dateFieldOf(path: string): string | null {
  return EMPLOYEE_DATE_FIELDS[path] ?? null;
}

/**
 * A phase's dates, keyed by object — every dated object moves together.
 *
 * A helper rather than repeated entries per phase: the invariant is that the dated
 * objects share one date, and writing it out per phase is four chances to mistype
 * the one that differs. `extra` carries the objects only some modules write (the
 * salary, and phase 2's periodiek), so a module without them gets no entry rather
 * than a date for an object it never sends.
 */
function datesFor(
  date: PhaseDate,
  extra: readonly string[] = []
): Record<string, PhaseDate> {
  return Object.fromEntries(
    [...EMPLOYEE_DATED_OBJECTS, ...extra].map((path) => [path, date])
  );
}

/**
 * The columns a phase-1 salary overrides, and why each is what it is.
 *
 * All four are `mandatory` on `AfasSalary` in the connector's own schema, so none can
 * simply be left out — a phase-1 body without them is rejected. The amounts are 0
 * because phase 1 is deliberately not making a statement about pay
 * (Taroen, 22-09-2026); `SaPe` is `V` because AFAS's own value list gives `V` =
 * *Vast salaris* (confirmed from `update_connector_metainfo`, not guessed), and a
 * salary of 0 has to be *some* type.
 *
 * `PtId` (Periodetabel) is **not** here: it comes from the project's hoofdproces
 * dossieritem through the standard-column fills
 * ([`standard-columns.ts`](./standard-columns.ts)), which is the one place that value
 * is allowed to come from.
 */
const PHASE_ONE_SALARY: Record<string, PhaseOverride> = {
  "AfasEmployee.AfasSalary#SaPe": constant("V", "vast salaris (fase 1)"),
  "AfasEmployee.AfasSalary#EmSa": constant(0, "nog geen salaris in fase 1"),
  "AfasEmployee.AfasSalary#SaYe": constant(0, "nog geen salaris in fase 1"),
};

/**
 * The salary fields **both** phases have to carry, whatever the sheet says.
 *
 * `PtId` is `mandatory` on `AfasSalary` and **not in the stored mapping**, so
 * without this every salary body would be missing it and AFAS would refuse the lot.
 * (`NtSa` used to be here too; it is a fixed `false` in the mapping now.)
 *
 * It comes from the project's dossieritem rather than from a constant: it is **5**
 * (maandelijks) or **6** (vierwekelijks) per conversion, it is already resolved for
 * the *Data* tab, and a constant here would be a second answer to a question that
 * has one.
 */
const SALARY_ALWAYS: Record<string, PhaseOverride> = {
  "AfasEmployee.AfasSalary#PtId": {
    kind: "fill",
    header: "Periodetabel HRM",
    note: "periodetabel uit dossieritem",
  },
};

/**
 * `AfasEmployee.AfasPeriodiek` — the periodiek schedule, in **phase 2 only** and only
 * for a **scale-based salary** (Taroen, 22-09-2026).
 *
 * Two restrictions, for two different reasons:
 *
 * - **Phase 2, not phase 1.** A periodiek is the schedule by which someone's salary
 *   next rises. Phase 1 deliberately states no salary at all (`V` at 0), so a
 *   schedule for raising it would be describing an increase to a number nobody
 *   claimed. It belongs with the real salary, which is phase 2's.
 * - **`S` / `Su` only.** Periodieken are a property of a **loonschaal**: you move up
 *   a trede on a schedule. `U` (uurloon) and `V` (vast salaris) have no scale to
 *   move within, so a periodiek on one of them is a schedule with nothing to
 *   schedule — which AFAS may or may not refuse, and which is wrong either way.
 *   The codes come from the connector's own value list for `SaPe`, read from
 *   `update_connector_metainfo`: `U` Uurloon, `V` Vast salaris, `S` Schaalsalaris,
 *   `Su` Schaal uurloon.
 */
const SCALE_SALARY: PhaseObjectWhen = {
  column: "Soort salaris",
  // The two scale-based types. Compared case-insensitively, so a sheet saying
  // `su` is the same answer — `SaPe` is enum-checked by the rule set anyway.
  isOneOf: ["S", "Su"],
  note: "alleen bij schaalsalaris",
};

const PERIODIEK_WHEN: Record<string, PhaseObjectWhen> = {
  "AfasEmployee.AfasPeriodiek": SCALE_SALARY,
};

/**
 * *Soort loonschaal* (`TaId`) and *Loonschaal* (`VaSc`) — sent **only with a
 * scale-based salary** (`S` / `Su`), for the same reason as the periodiek: `U` and
 * `V` have no loonschaal (Taroen, 02-10-2026).
 *
 * Phase 1 never sends them, because phase 1's `SaPe` is always `V` — whatever the
 * sheet's *Soort salaris* says. Phase 2 sends them for the rows whose sheet does
 * say `S` or `Su`.
 */
const LOONSCHAAL_FIELDS = ["TaId", "VaSc"] as const;

const PHASE_ONE_LOONSCHAAL: Record<string, PhaseOverride> = Object.fromEntries(
  LOONSCHAAL_FIELDS.map((fieldId) => [
    `${SALARY_PATH}#${fieldId}`,
    { kind: "remove", note: "geen loonschaal bij vast salaris (fase 1)" },
  ])
);

const LOONSCHAAL_WHEN_SCALE: Record<string, PhaseOverride> = Object.fromEntries(
  LOONSCHAAL_FIELDS.map((fieldId) => [
    `${SALARY_PATH}#${fieldId}`,
    { kind: "keepWhen", when: SCALE_SALARY },
  ])
);

/**
 * The periodiek fields the conversion supplies, on top of the mapping's `PeNo` and
 * `InMe`.
 *
 * *Herhalen na* is derived from the periodetabel, *Jaar volgende periodiek* from the
 * livegangdatum. Neither is mandatory, so a project without those settings simply
 * omits them rather than failing, which is the same `null`-fill contract every other
 * standard column has.
 */
const PERIODIEK_FIELDS: Record<string, PhaseOverride> = {
  "AfasEmployee.AfasPeriodiek#PeRp": {
    kind: "fill",
    header: "Herhalen na",
    note: "afgeleid van periodetabel",
  },
  "AfasEmployee.AfasPeriodiek#YrPe": {
    kind: "fill",
    header: "Jaar volgende periodiek",
    note: "afgeleid van datum livegang",
  },
};

/**
 * What AFAS demands to **create** an employee that neither the sjabloon nor the
 * mapping supplies.
 *
 * Every one of these was found by posting a body to a real environment and reading
 * what came back (Balans 501342 at 38892.resttest, 22-09-2026) — AFAS validates one
 * rule at a time, so they surfaced one error per attempt. They are not in the
 * mapping because they are not client data: no conversion sjabloon asks for a
 * *naamgebruik* or an *aangiftetijd*, and there is nothing for a client to decide.
 *
 * - `SpNm` + `ViUs` — "Het veld 'Geboortenaam en/of partnernaam' moet altijd
 *   aangevinkt zijn bij een persoon als deze gekoppeld wordt aan een medewerker",
 *   and with it on, AFAS requires a naamgebruik. `"0"` is *Geboortenaam* from the
 *   connector's own value list, which is what an unmarried-name default means.
 *   The sheet's own *Geboortenaam* column still fills `NmBi` through the mapping.
 * - `RtDa` — `mandatory` on `AfasContract` with no column behind it. `false` is the
 *   ordinary case; wachtdagen are a per-employer arrangement, not per employee.
 * - `PcPt` — `mandatory` on `AfasTimeTable`. 100 is the roster as written: the
 *   sheet's *Aantal uren per week* already says how much someone works, and a
 *   parttime percentage on top of it would say it twice.
 * - `DfHo` — AFAS refuses a roster with "Het veld 'Afw. uren p.w. aangifte' moet
 *   groter zijn dan 0,00, als het veld 'Oproepovereenkomst' uit staat en het veld
 *   'Uren per week' gelijk is aan 0,00". It is the hours the employer declares, so
 *   it tracks the contract hours rather than being a constant — see `HOURS_FIELD`.
 *
 * All of them are `constant` rather than `fill`: they are properties of *creating an
 * employee in AFAS*, identical for every project, and nothing on a dossieritem or in
 * a settings dialog would change them.
 */
/** A full working week, in hours — the 100% a *Parttime (%)* is measured against. */
const FULL_WEEK_HOURS = 40;

/** A `J`/`N` cell as a boolean. Anything else is `N` — the columns are enum-checked. */
function isYes(text: string): boolean {
  return text.trim().toUpperCase() === "J";
}

/** A sheet number (`38,5` as readily as `38.5`), or null when it isn't one. */
function numberOf(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
}

/** `AfasTimeTable`'s hours per weekday, Monday first. */
const DAY_HOUR_FIELDS = ["HrMo", "HrTu", "HrWe", "HrTh", "HrFr", "HrSa", "HrSu"];

/**
 * The week's hours **as AFAS will count them**, which *Type rooster* decides
 * (27-09-2026). `1`/`2` are *uren per dag*: AFAS adds up the day fields and ignores
 * `HrWk` entirely — a roster with `EtTy: "1"`, `HrWk: 38` and no day hours is a
 * roster of 0 hours to AFAS, which then demands *Afw. uren p.w. aangifte*. Every
 * other type reads `HrWk`. Null when the fields that count are all empty.
 */
function weekHours(read: PhaseReader): number | null {
  const type = read.field("EtTy").trim();
  if (type !== "1" && type !== "2") return numberOf(read.field("HrWk"));
  const days = DAY_HOUR_FIELDS.map((f) => numberOf(read.field(f))).filter(
    (h): h is number => h !== null
  );
  return days.length ? days.reduce((a, b) => a + b, 0) : null;
}

const EMPLOYEE_REQUIRED: Record<string, PhaseOverride> = {
  // `MatchPer` (`'7'`, altijd nieuw toevoegen), `ViUs` (`'0'`, naamgebruik
  // geboortenaam) and `NtSa` (`false`, brutosalaris) are **not** here: they are
  // fixed values in the stored mapping (22-09-2026), which is where a constant that
  // is the same on every row of every project belongs — an admin can see it in the
  // mapping editor, and a phase that restated it would be a second answer nobody
  // could find. This file only carries what the mapping cannot express.
  //
  // `SpNm` is mapped from the sheet's *Geboortenaam apart vastleggen*, but AFAS
  // requires it **true** for anyone attached to a medewerker ("moet altijd
  // aangevinkt zijn"). So it is forced here while the sheet's own answer keeps
  // deciding *which columns the geboortenaam comes from*, below.
  "AfasEmployee.KnPerson#SpNm": constant(true, "verplicht bij een medewerker"),

  // AFAS insists on `SpNm: true` for anyone attached to a medewerker, so every
  // employee needs a geboortenaam whether or not the client recorded one
  // separately. Which pair of columns it comes from is the sheet's own answer
  // (Taroen, 22-09-2026): *Geboortenaam apart vastleggen* = `J` means the client
  // filled *Voorv. geb.naam* / *Geboortenaam*, and anything else means the person's
  // own name is their geboortenaam — so it comes from *Voorvoegsel* /
  // *Achternaam*.
  //
  // Reading the flag rather than "the geboortenaam column if it's filled" matters:
  // a row marked `J` with an empty *Geboortenaam* is a data error the client should
  // see, and silently substituting the achternaam would paper over it. It still
  // sends the achternaam — AFAS refuses an empty one — but the sheet is what the
  // *Data* tab flags.
  "AfasEmployee.KnPerson#NmBi": {
    kind: "derive",
    note: "geboortenaam volgens 'apart vastleggen'",
    of: (read) => {
      const apart = isYes(read.cell("Geboortenaam apart vastleggen"));
      const name = apart ? read.cell("Geboortenaam") : read.cell("Achternaam");
      return name || read.cell("Achternaam");
    },
  },
  // The tussenvoegsel of that same name, from the matching column. `IsBi` is
  // optional, so an empty one is simply omitted rather than defaulted.
  "AfasEmployee.KnPerson#IsBi": {
    kind: "derive",
    note: "voorvoegsel geboortenaam volgens 'apart vastleggen'",
    of: (read) => {
      const apart = isYes(read.cell("Geboortenaam apart vastleggen"));
      return (apart ? read.cell("Voorv. geb.naam") : read.cell("Voorvoegsel")) || null;
    },
  },

  // Left blank (Taroen, 22-09-2026). It is `mandatory` in the connector's schema,
  // but AFAS accepts a body without it — a wachtdagenregeling is an employer's
  // arrangement, and guessing `false` for every employee would be stating a policy
  // the conversion was never told.
  "AfasEmployee.AfasContract#RtDa": { kind: "remove", note: "wachtdagen niet ingevuld" },

  // The week's hours as a percentage of a full one: 40 → 100, 20 → 50. Rounded to
  // two decimals so a 36-hour week is 90 rather than 89.99999999999999, which is
  // the same number and looks like a bug in the payload view.
  "AfasEmployee.AfasTimeTable#PcPt": {
    kind: "derive",
    note: `uren per week (of som van de dagen) t.o.v. ${FULL_WEEK_HOURS} uur`,
    of: (read) => {
      const hours = weekHours(read);
      if (hours === null) return null;
      return Math.round((hours / FULL_WEEK_HOURS) * 10000) / 100;
    },
  },

  // *Type rooster* decides **which fields AFAS reads the hours from**, and without it
  // a roster stating 40 hours a week is read as stating none (23-09-2026).
  //
  // The connector's own value list names them: `1` uren per dag, `3` werktijden, `5`
  // *Uren per week*. The sjabloon's *Aantal uren per week* is exactly what `5`
  // describes, and with any other type AFAS looks for per-day hours or begin/end
  // times, finds none, and concludes the week is 0 — which is why it then demanded
  // an *Afw. uren p.w. aangifte* for an employee who plainly works full time.
  //
  // **Not defaulted here.** *Type rooster* is `required` in the rule set with the
  // enum `1, 2, 5`, so a sheet without it is an error the client can see and fix on
  // the *Data* tab — which is where a value they are expected to supply belongs.
  // Filling it in silently would turn a visible gap into a guess: `5` is right for a
  // sheet that states weekly hours and wrong for one that states hours per day, and
  // only the client knows which they filled in.
  //
  // (Left as a comment rather than removed: the field is easy to mistake for one the
  // app should supply, and the reason it doesn't is the point.)

  // Wisselende weken can't be imported (Taroen, 27-09-2026): a roster of type `2`
  // (uren per dag) or `4` (werktijden) needs a cycle of weeks the sjabloon has no
  // columns for, so it goes to AFAS as its gelijke-weken counterpart — `1` resp.
  // `3` — and the wisselende weken are set up by hand in AFAS afterwards. The rule
  // set's `notice` on *Type rooster* tells the user so and tints the cell amber.
  //
  // Here rather than as a `valueMap` in the mapping: a project with its own copy
  // of the Medewerkers mapping would miss one added later, and then the notice
  // would promise a 1 the payload never sends.
  "AfasEmployee.AfasTimeTable#EtTy": {
    kind: "derive",
    note: "wisselende weken als gelijke weken",
    of: (read) => {
      const own = read.field("EtTy").trim();
      if (own === "2") return "1";
      if (own === "4") return "3";
      return own || null;
    },
  },

  // *Ketennummer* must be `0` ("Niet van toepassing") on a contract of onbepaalde
  // tijd — AFAS refuses `ApCo: "O"` with any other value ("Bij het contracttype
  // 'Onbepaalde tijd' moet het veld 'Ketennummer' de waarde 'Niet van toepassing'
  // (0) hebben", 23-09-2026).
  //
  // Written rather than left to the sheet because most templates leave the column
  // blank and AFAS accepts the field omitted (live-confirmed) — so this is not
  // fixing an error, it is stating the value AFAS would have defaulted to, which
  // keeps the body honest about what it asks for. A ketennummer that *is* filled and
  // wrong is the client's to fix, and the rule set flags it on the *Data* tab.
  //
  // Only for `O`: a contract of bepaalde tijd carries a real chain number, and
  // overwriting it with 0 would erase the thing the field is for.
  "AfasEmployee.AfasContract#ViKe": {
    kind: "derive",
    note: "niet van toepassing bij onbepaalde tijd",
    of: (read) => {
      const own = read.field("ViKe");
      if (read.field("ApCo").trim().toUpperCase() !== "O") return own || null;
      return "0";
    },
  },

  // *Afw. uren p.w. aangifte* is the **stand-in** for a week's hours, not a copy of
  // them. AFAS states the rule from both sides, and it took both errors to see it
  // (23-09-2026):
  //
  //   "moet groter zijn dan 0,00, als 'Oproepovereenkomst' uit staat en
  //    'Uren per week' gelijk is aan 0,00"
  //   "mag niet gevuld zijn als de waarde van 'Uren per week' groter is dan 0,00"
  //
  // Together: the field exists so a roster with no contractual hours can still
  // declare some, and filling it beside real hours is a contradiction AFAS refuses.
  // It is therefore sent **only** when there is no oproepovereenkomst *and* the week
  // has no hours — which is the one case the first error describes — and omitted
  // everywhere else.
  //
  // The first version of this copied `HrWk` whenever `ClAg` was off, which satisfied
  // the first rule and broke the second for every employee who works a normal week.
  "AfasEmployee.AfasTimeTable#DfHo": {
    kind: "derive",
    note: "alleen als er geen uren per week zijn",
    of: (read) => {
      if (isYes(read.cell("Oproepovereenkomst"))) return null;
      const hours = weekHours(read);
      // Hours present and real: the field must stay empty.
      if (hours !== null && hours > 0) return null;
      // A per-day roster without day hours is an incomplete sheet, not a week of
      // none: the rule set flags *Type rooster* for it. Declaring 40 here would
      // make AFAS accept a 0-hour roster and hide the gap.
      const type = read.field("EtTy").trim();
      if (type === "1" || type === "2") return null;
      // No hours at all, and no oproepovereenkomst to explain it — AFAS wants a
      // positive number here. A full week is what an unstated *Aantal uren per week*
      // means everywhere else in this template.
      return FULL_WEEK_HOURS;
    },
  },
};

/**
 * `AfasBankInfo`'s fields no sjabloon asks for, because none is something a client
 * types — each follows from what they already gave (Taroen, 22/23-09-2026).
 *
 * The bank account lives on **`AfasBankInfo`**, directly under `AfasEmployee`, not
 * on `KnPerson.KnBankAccount` (Taroen, 23-09-2026). Both objects exist in the
 * connector and both accept a body, but they are not the same record: `KnBankAccount`
 * is the *person's* account, `AfasBankInfo` the **medewerker's** — which is the one
 * payroll pays from, and the one whose history the livegang has to leave intact.
 * They differ in shape as well as in place, so this is not a rename:
 *
 * - **`AcId` (Rekeningnummer)** replaces `KnBankAccount`'s `BaAc`. It is `mandatory`
 *   **and** `primaryKey` here, where `BaAc` was neither — the account number is the
 *   key of the record, which is why the object is written in phase 1 and never
 *   again.
 * - **`NoBk` (Kasbetaling)**, **`SeNo` (Volgnummer)** and **`SaAc` (Salarisrekening)**
 *   are `mandatory` here and have no counterpart on `KnBankAccount` at all. `SeNo`
 *   is left to AFAS (Taroen, 23-09-2026): it is a `primaryKey` volgnummer, and AFAS
 *   numbers those itself — see [[afas-assigns-primary-key-volgnummers]]. Sending our
 *   own would fix the key of a record we only ever write once.
 * - **`CoId`** is optional here and was mandatory there.
 *
 * The values:
 *
 * - **`AcId`** is the account number inside the IBAN: `NL87ABNA0146130464` →
 *   `0146130464`. See {@link accountFromIban}.
 * - **`BkTp` (Type bank)** is AFAS's own per-country code, looked up in
 *   `ALG_TypeBank` by the **country of the bank account** (`CoId`, the sheet's *Land
 *   (Bank)*) — NL is 528000. The table is read rather than hardcoded because it has
 *   289 rows and is AFAS's to change; it is fetched for this module even though no
 *   rule references it (`PAYLOAD_TABLES` in the codetabel registry).
 * - **`NoBk`** is `false`: a conversion writes bank accounts, not cash payment.
 * - **`SaAc`** is `true`: the one account a conversion knows about is the one the
 *   salary goes to. That is the whole reason it is in the sjabloon.
 *
 * `AcId` and `BkTp` omit rather than guess when their input is missing: no IBAN
 * means no account number, and a country the table has no row for means no type
 * bank. Omitting `AcId` leaves the object without its key, so AFAS refuses it —
 * which is the right answer for a row whose IBAN the sheet never carried.
 */
const BANK_ACCOUNT: Record<string, PhaseOverride> = {
  ...bankFromIban("AfasEmployee.AfasBankInfo", "AcId"),
  "AfasEmployee.AfasBankInfo#NoBk": constant(false, "geen kasbetaling"),
  "AfasEmployee.AfasBankInfo#SaAc": constant(true, "salarisrekening"),
};

/**
 * The two fields a bank account derives from what the sheet already gave: the
 * account number from the IBAN, and the type bank from the country of the bank.
 *
 * Shared by `AfasBankInfo` (the medewerker's account, number in `AcId`) and
 * `KnBankAccount` (a relation's, number in `BaAc`) — the same rule under two field
 * codes, so `accountField` names which one.
 */
function bankFromIban(
  path: string,
  accountField: string
): Record<string, PhaseOverride> {
  return {
    [`${path}#${accountField}`]: {
      kind: "derive",
      note: "rekeningnummer uit het IBAN",
      of: (read) => accountFromIban(read.field("Iban")),
    },
    [`${path}#BkTp`]: {
      kind: "derive",
      note: "type bank bij het land van de bank",
      of: (read) => {
        // The country as the **body** carries it, not the raw cell: `CoId` goes
        // through the mapping's own conversions, and the table is keyed by the same
        // codes AFAS uses there.
        const land = read.field("CoId");
        const code = codetabelCodeForScope("TypeBank", land);
        return code === "" ? null : Number(code);
      },
    },
  };
}

/**
 * A debiteur's or crediteur's `KnBankAccount`, filled the way the medewerker's is
 * (Taroen, 09-10-2026): `BaAc` and `BkTp` derived — see {@link bankFromIban} — and
 * `IbCk` (IBAN-controle) always on.
 *
 * `IbCk` is an override rather than a fixed value in the stored mappings because a
 * project's client mapping is a **snapshot** of the standard one
 * (`_seed_client_mappings` in `backend/main.py`): a field added to the standard file
 * would never reach the copies already made. No `NoBk`/`SaAc` — `KnBankAccount` has
 * neither field; they belong to the medewerker's `AfasBankInfo`.
 */
function relationBankAccount(path: string): Record<string, PhaseOverride> {
  return {
    ...bankFromIban(path, "BaAc"),
    [`${path}#IbCk`]: constant(true, "vaste waarde"),
    ...preferredAccount(path),
  };
}

/**
 * The relation's **voorkeur**-rekening — `Iban`, `BaAc` and `CoId` on the root
 * (`KnPurchaseRelationOrg`, …) — repeating its own `KnBankAccount`, but only when
 * *Automatisch betalen/incasseren* (`AuPa`) is on.
 *
 * AFAS refuses an automatic payment or collection without one: *"Er moet een
 * voorkeur bankrekening aanwezig zijn voor automatische incasso/betaling"*. Creating
 * the account under the organisation does not make it the preferred one — that is
 * these three root fields (Taroen, 09-10-2026). Omitted when `AuPa` is off, which
 * leaves such relations exactly as they were sent before.
 *
 * Read from the bank account's **mapped** `Iban` and `CoId`, and the account number
 * derived from that IBAN the same way `KnBankAccount.BaAc` is — the resolver a
 * derive reads is the mapping's, so the bank's own `BaAc` override is not visible
 * to it.
 */
function preferredAccount(bankPath: string): Record<string, PhaseOverride> {
  const root = bankPath.split(".")[0]!;
  // Read through the *asking* field's type — a string here — so `AuPa` arrives as
  // the sheet spelled it (`Ja`), not as the boolean `afasValue` makes of it for its
  // own field. Hence the same yes-list rather than a compare with `"true"`.
  const whenAutomatic =
    (of: (read: PhaseReader) => string | null) =>
    (read: PhaseReader) =>
      ["true", "ja", "j", "1", "waar"].includes(read.field("AuPa").trim().toLowerCase())
        ? of(read)
        : null;
  return {
    [`${root}#Iban`]: {
      kind: "derive",
      note: "voorkeur-IBAN bij automatisch betalen",
      of: whenAutomatic((read) => read.at(bankPath, "Iban") || null),
    },
    [`${root}#BaAc`]: {
      kind: "derive",
      note: "voorkeur-rekeningnummer bij automatisch betalen",
      of: whenAutomatic((read) => accountFromIban(read.at(bankPath, "Iban"))),
    },
    [`${root}#CoId`]: {
      kind: "derive",
      note: "land voorkeur-rekening bij automatisch betalen",
      of: whenAutomatic((read) => read.at(bankPath, "CoId") || null),
    },
  };
}

/**
 * The account number inside an IBAN — everything after the country code, the two
 * check digits and the four-letter bank code.
 *
 * `NL87ABNA0146130464` → `0146130464`. Spaces are stripped first, since a client's
 * sheet may carry the grouped notation. Anything too short to have an account part,
 * or not shaped like an IBAN at all, yields `null` and the field is omitted — a
 * partial account number is worse than none, because it looks like a real one.
 */
function accountFromIban(iban: string): string | null {
  const text = iban.replace(/\s+/g, "").toUpperCase();
  // Country (2) + check digits (2) + bank code (4) = 8, and at least one more for
  // the account itself.
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4}[A-Z0-9]+$/.test(text)) return null;
  const account = text.slice(8);
  return account === "" ? null : account;
}

/**
 * *Datum uit dienst* is never written, in either phase.
 *
 * The sheet has no such column — it carries *Einddatum contract*, which is a
 * different fact — and `DaEe` is what actually ends someone's employment in AFAS.
 * Inferring one from the other would put people out of service who are not
 * (Taroen, 22-09-2026). Stated as an explicit `remove` rather than by leaving it
 * unmapped, so a future mapping that maps it cannot quietly start sending it.
 */
const NEVER_UIT_DIENST: Record<string, PhaseOverride> = {
  "AfasEmployee.AfasContract#DaEe": {
    kind: "remove",
    note: "datum uit dienst wordt nooit gevuld",
  },
};

/**
 * The two phases of creating a medewerker.
 *
 * Only `hrm-medewerkers` uses them. `hrm-uitzendkrachten` writes to the same
 * `KnEmployee` connector but in a single call (Taroen, 23-09-2026) — see
 * {@link MODULE_PHASES}.
 */
function employeePhases(): ModulePhase[] {
  return [
    {
      id: "aanmaken",
      // Getters, not values: this list is built once at load, and the label has to
      // read the language at the moment it is shown (see `tr`).
      get label() {
        return tr("Historie", "History");
      },
      get description() {
        return tr(
          "De medewerker zoals hij sinds datum in dienst is — met contract, functie, " +
            "rooster, fiscus en een salaris van 0.",
          "The employee as they have been since their start date — with contract, function, " +
            "roster, tax details and a salary of 0."
        );
      },
      verb: "insert",
      // Everything the mapping fills, bar the sector-fonds: the person and their address
      // come along in this phase and in no other, since a person is created once.
      objects: [],
      // The sector-fonds is left out for now — see `AGENCY_PATH` — and the periodiek
      // belongs to phase 2 only — see `PERIODIEK_WHEN`. Excluded explicitly, since an
      // empty `objects` means everything the mapping fills.
      excludeObjects: [AGENCY_PATH, PERIODIEK_PATH],
      dates: {
        ...datesFor({ kind: "column", header: "Datum in dienst" }, [SALARY_PATH]),
        // The one phase-1 object not dated by *Datum in dienst* — see `FISCUS_PATH`.
        [FISCUS_PATH]: { kind: "livegang" },
      },
      overrides: {
        ...EMPLOYEE_REQUIRED,
        ...BANK_ACCOUNT,
        ...PHASE_ONE_SALARY,
        ...PHASE_ONE_LOONSCHAAL,
        ...SALARY_ALWAYS,
        ...NEVER_UIT_DIENST,
      },
    },
    {
      id: "livegang",
      get label() {
        return tr("Actueel", "Current");
      },
      get description() {
        return tr(
          "Een tweede contract, functie, rooster en salaris vanaf de livegangdatum — " +
            "hier met het salaris uit het bestand, de periodiek bij een schaalsalaris, " +
            "en de fiscus.",
          "A second contract, function, roster and salary from the go-live date — here " +
            "with the salary from the file, the periodic increase for a scale salary, " +
            "and the tax details."
        );
      },
      verb: "update",
      // The dated objects plus the periodiek: the person and the address already
      // exist, and re-sending them would be an update of records this phase has no
      // business touching. `AfasPeriodiek` is here rather than in phase 1 because a
      // periodiek schedules a rise in a salary, and phase 1 states no salary — see
      // `PERIODIEK_WHEN`. The fiscus starts at livegang too — see `FISCUS_PATH`.
      // The sector-fonds is left out for now — see `AGENCY_PATH`.
      objects: [...EMPLOYEE_DATED_OBJECTS, SALARY_PATH, PERIODIEK_PATH, FISCUS_PATH],
      conditionalObjects: PERIODIEK_WHEN,
      dates: {
        ...datesFor({ kind: "livegang" }, [SALARY_PATH]),
        // Its own key is `DaBe`, like the contract's and the salary's, and it starts
        // on the same day as the salary it schedules.
        [PERIODIEK_PATH]: { kind: "livegang" },
        [FISCUS_PATH]: { kind: "livegang" },
      },
      // No `SaPe`/`EmSa`/`SaYe` override — the sheet's own are the point of this
      // phase. The periodetabel still comes from the conversion, since the mapping has
      // no entry for it. `DaEe` stays suppressed as in phase 1.
      // The roster's mandatory fields come along again: phase 2 writes a **new**
      // rooster record, which AFAS validates exactly as it validated phase 1's. The
      // person's own requirements do not — `KnPerson` isn't in this phase at all.
      overrides: {
        "AfasEmployee.AfasContract#RtDa": EMPLOYEE_REQUIRED["AfasEmployee.AfasContract#RtDa"]!,
        "AfasEmployee.AfasContract#ViKe": EMPLOYEE_REQUIRED["AfasEmployee.AfasContract#ViKe"]!,
        "AfasEmployee.AfasTimeTable#EtTy": EMPLOYEE_REQUIRED["AfasEmployee.AfasTimeTable#EtTy"]!,
        "AfasEmployee.AfasTimeTable#PcPt": EMPLOYEE_REQUIRED["AfasEmployee.AfasTimeTable#PcPt"]!,
        "AfasEmployee.AfasTimeTable#DfHo": EMPLOYEE_REQUIRED["AfasEmployee.AfasTimeTable#DfHo"]!,
        ...SALARY_ALWAYS,
        ...LOONSCHAAL_WHEN_SCALE,
        ...PERIODIEK_FIELDS,
        ...NEVER_UIT_DIENST,
      },
      skip: {
        column: "Einddatum contract",
        before: "livegang",
        get reason() {
          return tr(
            "contract al beëindigd vóór de livegangdatum",
            "contract already ended before the go-live date"
          );
        },
      },
    },
  ];
}

/**
 * Which modules are sent in phases, by module id.
 *
 * A module absent here is single-phase, which is every module but these two — and
 * `phasesOf()` answers `null` for them, so nothing downstream needs a special case.
 */
export const MODULE_PHASES: Record<string, ModulePhase[]> = {
  "hrm-medewerkers": employeePhases(),
  // `hrm-uitzendkrachten` is deliberately **not** here (Taroen, 23-09-2026). An
  // uitzendkracht has only the *Historie* step — one POST, every dated object from
  // *Datum in dienst*, no livegang record — and everything that step needs is a
  // fixed value or a column in its stored mapping
  // (`backend/json_files/mappings/modules/hrm-uitzendkrachten.json`): contract `O`
  // / `UI` / `2`, rooster `5` at 5 × 38 uur and 100%, salaris `V` at 0, and the
  // geboortenaam from the achternaam. The periodetabel is the standard-column fill.
  // With nothing left for a phase to add, it is an ordinary one-call module.
};

/**
 * Overrides for modules sent in **one** call — the same field rules a phase carries,
 * for a module with no phases to carry them. Keyed by module id; each variant's
 * paths start at its own root, so the organisation and the person share one record.
 */
const MODULE_OVERRIDES: Record<string, Record<string, PhaseOverride>> = {
  "hrm-wagenpark": {
    // *Kilometers per jaar* is sent only when it is more than 0 (Taroen, 28-10-2026):
    // a 0 — typed, or the rules' default for a blank cell — omits `KmYe`.
    "HrMobility#KmYe": {
      kind: "derive",
      note: "weggelaten bij 0",
      of: (read) => {
        const km = Number(read.field("KmYe"));
        return km ? km : null;
      },
    },
  },
  // *Datum boeking* (`RgDa`): the sheet's own date when filled; otherwise the
  // livegangdatum when it falls in the *Boekjaar*, and 31 december of the boekjaar
  // when it doesn't (Taroen, 13-10-2026). A saldo booked into the livegang year
  // belongs on the livegang itself, not at the end of a year the conversion is
  // already part of. No readable boekjaar omits the field — `RgDa` is optional, and
  // AFAS then books on its own default rather than on a guessed year.
  "hrm-verlofsaldo": {
    "HrAbsCorrection#RgDa": {
      kind: "derive",
      note: "datum boeking uit boekjaar",
      of: (read) => {
        const own = read.field("RgDa");
        if (own) return own;
        const jaar = read.cell("Boekjaar").trim();
        if (!/^\d{4}$/.test(jaar)) return null;
        return read.livegang.startsWith(`${jaar}-`) ? read.livegang : `${jaar}-12-31`;
      },
    },
  },
  // A journaalpost's dates and period have no column but are mandatory (Taroen,
  // 13-10-2026): *Datum boeking* (`EnDa`) is the livegangdatum, *Boekjaar*/*Periode*
  // (`Year`/`Peri`) its year and month — monthly periods assumed — and *Boekstukdatum*
  // (`BpDa`) the sheet's *Factuurdatum*, so AFAS ages each post from its real invoice,
  // with the livegangdatum for a blank cell. No livegangdatum omits all four, and AFAS
  // refuses the post on the mandatory fields rather than booking it on a guessed date.
  "erp-openstaandposten": {
    "FiEntryPar#Year": {
      kind: "derive",
      note: "jaar van datum livegang",
      of: (read) => (read.livegang ? Number(read.livegang.slice(0, 4)) : null),
    },
    "FiEntryPar#Peri": {
      kind: "derive",
      note: "maand van datum livegang",
      of: (read) => (read.livegang ? Number(read.livegang.slice(5, 7)) : null),
    },
    "FiEntryPar.FiEntries#EnDa": {
      kind: "derive",
      note: "datum livegang",
      of: (read) => read.livegang || null,
    },
    "FiEntryPar.FiEntries#BpDa": {
      kind: "derive",
      note: "factuurdatum, anders datum livegang",
      of: (read) => read.field("BpDa") || read.livegang || null,
    },
  },
  "erp-debiteuren": {
    ...relationBankAccount("KnSalesRelationOrg.KnOrganisation.KnBankAccount"),
    ...relationBankAccount("KnSalesRelationPer.KnPerson.KnBankAccount"),
  },
  "erp-crediteuren": {
    ...relationBankAccount("KnPurchaseRelationOrg.KnOrganisation.KnBankAccount"),
    ...relationBankAccount("KnPurchaseRelationPer.KnPerson.KnBankAccount"),
  },
};

/**
 * {@link ModulePhase.conditionalObjects} for a module that has no phases, the
 * counterpart of {@link MODULE_OVERRIDES}.
 */
const MODULE_CONDITIONAL_OBJECTS: Record<string, Record<string, PhaseObjectWhen>> = {
  // A vehicle without a *Medewerker* is the vehicle alone (Taroen, 28-10-2026): its
  // employee link — bijtelling, eigen bijdrage, the registration dates — would be an
  // assignment to nobody, so the whole `HrEmployeeMobility` object is left out.
  "hrm-wagenpark": {
    "HrMobility.HrEmployeeMobility": { column: "Medewerker", note: "geen medewerker" },
  },
};

/**
 * What the payload **build** is given: the selected phase, or — for a one-call
 * module with {@link MODULE_OVERRIDES} or {@link MODULE_CONDITIONAL_OBJECTS} — a
 * single implicit phase holding just those.
 *
 * Kept apart from the phase the panel *shows*: the implicit one has no toggle, no
 * label on the send button and no `@Action`. It writes every object the mapping
 * fills, has no dates and skips no record, so the only thing it changes in the build
 * is the overridden fields — which is the point.
 */
export function buildPhaseOf(
  moduleId: string | null,
  phase: ModulePhase | null
): ModulePhase | null {
  if (phase) return phase;
  const overrides = moduleId ? MODULE_OVERRIDES[moduleId] : undefined;
  const conditionalObjects = moduleId ? MODULE_CONDITIONAL_OBJECTS[moduleId] : undefined;
  if (!overrides && !conditionalObjects) return null;
  return {
    id: "enkel",
    label: "",
    description: "",
    verb: "insert",
    objects: [],
    dates: {},
    overrides: overrides ?? {},
    conditionalObjects,
  };
}

/** This module's phases, or `null` when it is an ordinary one-call module. */
export function phasesOf(moduleId: string | null): ModulePhase[] | null {
  if (!moduleId) return null;
  return MODULE_PHASES[moduleId] ?? null;
}

/** A phase by id, or the module's first — what a stale toggle falls back to. */
export function phaseById(
  moduleId: string | null,
  phaseId: PhaseId | null
): ModulePhase | null {
  const phases = phasesOf(moduleId);
  if (!phases || phases.length === 0) return null;
  return phases.find((phase) => phase.id === phaseId) ?? phases[0] ?? null;
}

/**
 * Whether a phase writes a given object path.
 *
 * An empty `objects` means **all of them** — phase 1 writes whatever the mapping
 * fills, and listing the person, the address, the bank account and every other
 * nested object it might gain would be a second mapping to maintain.
 */
export function phaseKeepsObject(phase: ModulePhase, path: string): boolean {
  // An exclusion wins over anything `objects` says, and takes its whole subtree with
  // it: an object this phase does not write has no children it writes either.
  const excluded = phase.excludeObjects ?? [];
  if (excluded.some((skip) => path === skip || path.startsWith(`${skip}.`))) {
    return false;
  }
  if (phase.objects.length === 0) return true;
  // A kept object's ancestors are kept too: `AfasEmployee` has to survive for
  // `AfasEmployee.AfasSalary` to hang off anything.
  return phase.objects.some(
    (kept) => kept === path || kept.startsWith(`${path}.`) || path.startsWith(`${kept}.`)
  );
}

type ConditionalObjects = NonNullable<ModulePhase["conditionalObjects"]>;

/**
 * Which conditional object, if any, governs the object at `path`: the object itself
 * or anything nested under it — a sub-object of a condition that doesn't apply is
 * not written either. Remembered per phase and path, since it depends on nothing
 * else and is asked for every field of every record.
 */
const conditionalLookups = new WeakMap<
  ConditionalObjects,
  Map<string, [string, ConditionalObjects[string]] | null>
>();

function conditionalEntry(
  entries: ConditionalObjects,
  path: string
): [string, ConditionalObjects[string]] | null {
  let byPath = conditionalLookups.get(entries);
  if (!byPath) conditionalLookups.set(entries, (byPath = new Map()));
  let found = byPath.get(path);
  if (found === undefined) {
    found =
      Object.entries(entries).find(
        ([objectPath]) => path === objectPath || path.startsWith(`${objectPath}.`)
      ) ?? null;
    byPath.set(path, found);
  }
  return found;
}

/**
 * The phase's resolver: the mapping's answer with this phase's dates and overrides
 * written over it.
 *
 * Layered the same way {@link withFills} layers the standard columns — a wrapper over
 * the resolver rather than a branch inside it — so the order is explicit: the mapping
 * resolves, the fills cover what the sheet hasn't got, and the phase has the last
 * word. That order is what lets phase 1 send a salary of 0 over a sheet that has a
 * real one, while still taking the periodetabel from the fills.
 */
export function withPhase(
  resolve: FieldValueResolver,
  phase: ModulePhase,
  /** The begin date each dated object gets, already resolved — `yyyy-mm-dd` or "". */
  dates: ReadonlyMap<string, string>,
  /**
   * The conversion's own settings, by sheet header — what a `fill` override reads.
   * Empty for a project that has none, which omits those fields rather than
   * inventing them; see {@link PhaseOverride}.
   */
  fills: ReadonlyMap<string, StandardColumn>,
  /**
   * This record's row, by column header — what a `derive` override reads for the
   * columns AFAS has no field for (*Geboortenaam apart vastleggen*,
   * *Oproepovereenkomst*). Case-insensitive, like every other header lookup.
   */
  cell: (header: string) => string,
  /** The conversion's livegangdatum, as AFAS sent it — what `read.livegang` gives. */
  livegangDatum: string = ""
): FieldValueResolver {
  const livegang = isoDay(livegangDatum);
  /** Whether a conditional object applies to this record, memoised per object. */
  const verdicts = new Map<string, { applies: boolean; note: string }>();
  const conditionalOf = (
    active: ModulePhase,
    path: string
  ): { applies: boolean; note: string } | null => {
    const entries = active.conditionalObjects;
    if (!entries) return null;
    const found = conditionalEntry(entries, path);
    if (!found) return null;
    const [objectPath, when] = found;
    const hit = verdicts.get(objectPath);
    if (hit) return hit;
    const verdict = { applies: whenApplies(when, cell), note: when.note };
    verdicts.set(objectPath, verdict);
    return verdict;
  };

  return (path, field) => {
    const key = fieldKey(path, field.fieldId);

    // A conditional object this record doesn't qualify for: every field of it is
    // omitted, which leaves an empty `Fields` block rather than removing the object
    // (the schema is shared by all this variant's records — see `conditionalObjects`).
    const when = conditionalOf(phase, path);
    if (when && !when.applies) return { omit: true, note: when.note };

    const override = phase.overrides[key];
    if (override) {
      if (override.kind === "remove") return { omit: true, note: override.note };
      if (override.kind === "keepWhen") {
        return whenApplies(override.when, cell)
          ? resolve(path, field)
          : { omit: true, note: override.when.note };
      }
      if (override.kind === "derive") {
        const read: PhaseReader = {
          // Another field of the same object, as the **mapping** resolved it — so
          // `HrWk` here is the sheet's *Aantal uren per week* through every
          // conversion the mapping applies, not a second reading of the cell.
          field: (fieldId) => {
            const other = resolve(path, { ...field, fieldId });
            return other && !other.omit && other.value !== null
              ? String(other.value)
              : "";
          },
          cell,
          livegang,
          at: (otherPath, fieldId) => {
            const other = resolve(otherPath, { ...field, fieldId });
            return other && !other.omit && other.value !== null
              ? String(other.value)
              : "";
          },
        };
        const value = override.of(read);
        return value === null
          ? { omit: true, note: override.note }
          : { value, note: override.note };
      }
      if (override.kind === "copy") {
        // The field's **own** mapped value first: a `copy` is a fallback for a
        // mandatory field the sheet usually leaves blank, not an instruction to
        // overwrite the one case where the client did fill it in. *Geboortenaam* is
        // exactly that — filled for the few who have one, blank for everyone else.
        const own = resolve(path, field);
        if (own && !own.omit && own.value !== null && own.value !== "") return own;
        const source = resolve(path, { ...field, fieldId: override.from });
        const value =
          source && !source.omit && source.value !== null && source.value !== ""
            ? source.value
            : override.fallback;
        return { value, note: override.note };
      }
      if (override.kind === "fill") {
        const fill = fills.get(override.header);
        // No setting behind it — an ERP-only project, a dossieritem nobody filled
        // in. Omitted rather than defaulted: a wrong periodetabel lands silently in
        // AFAS, and `ConversionSettingsNotice` already says the setting is missing.
        return fill && fill.value !== null
          ? { value: afasValue(field, fill.value), note: fill.note }
          : { omit: true, note: override.note };
      }
      // Through `afasValue` only for a string, so a constant already typed as a
      // number or a boolean (`0`, `false`) keeps its JSON type rather than being
      // re-parsed out of its own text.
      return {
        value:
          typeof override.value === "string"
            ? afasValue(field, override.value)
            : override.value,
        note: override.note,
      };
    }

    // The dated key. Written even when the mapping already fills it (phase 1's
    // contract maps `DaBe` from *Datum in dienst* anyway), because the phase is the
    // authority on its own dates and a mapping that changed underneath must not
    // silently move phase 2 back to the sheet's date.
    if (dateFieldOf(path) === field.fieldId) {
      const date = dates.get(path) ?? "";
      // No date resolved — the livegangdatum is missing, or the sheet's column is
      // blank for this row. Omit rather than send "": the field is a mandatory
      // primary key, and an empty one is refused by AFAS with a message about the
      // object rather than about the date. The panel reports the cause separately.
      return date === ""
        ? { omit: true, note: "begindatum onbekend" }
        : { value: date, note: noteForDate(phase, path) };
    }

    return resolve(path, field);
  };
}

/**
 * A date as `yyyy-mm-dd`: AFAS's ISO form (sometimes with a time behind it) cut to
 * the day, or a `DD-MM-YYYY` read the way a sheet cell is. `""` for anything else.
 */
function isoDay(text: string): string {
  const trimmed = text.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1]!;
  return afasDate(trimmed)?.slice(0, 10) ?? "";
}

/** Where this phase's date for an object came from, for the payload line's note. */
function noteForDate(phase: ModulePhase, path: string): string {
  const date = phase.dates[path];
  if (!date) return "";
  return date.kind === "livegang"
    ? "livegangdatum uit dossieritem"
    : `uit kolom ${date.header}`;
}

/**
 * The `@Action` a phase's nested objects carry, or null when they carry none.
 *
 * Only an `update` phase needs one: its PUT would otherwise **overwrite** the records
 * phase 1 wrote rather than adding the later ones beside them
 * (docs/AFAS-Profit-API-Referentie.md §4.1). A phase-1 POST has nothing to disambiguate.
 */
export function phaseAction(phase: ModulePhase): "insert" | null {
  return phase.verb === "update" ? "insert" : null;
}

/** Whether a field is one a phase writes itself — for the *Alleen gevuld* scope. */
export function phaseWritesField(
  phase: ModulePhase,
  path: string,
  field: AfasSchemaField
): boolean {
  const key = fieldKey(path, field.fieldId);
  const override = phase.overrides[key];
  // `remove` is not "written": the point of it is that the field leaves the body, so
  // keeping it in the *Alleen gevuld* scope would draw a line the resolver then omits.
  // A `derive` **is** kept even though it may resolve to nothing for a given row:
  // the scope decides which fields the body can carry, and it must not depend on
  // which record happens to be open.
  if (override && override.kind !== "remove") return true;
  return dateFieldOf(path) === field.fieldId && Boolean(phase.dates[path]);
}

// --- What the tool fills itself, as the mapping editor shows it -------------------

/**
 * How the conversion treats a field (or an object) **regardless of the mapping** —
 * what the schema explorer marks so an admin can see which rows their mapping
 * doesn't decide:
 *
 * - `computed` — worked out by the code: a `derive`, `fill` or `copy` override, or a
 *   dated object's begin date. Often *from* the mapped value (`EtTy`, `ViKe`), so the
 *   mapping still counts as input.
 * - `always` — a `constant` override: this value, whatever the mapping says.
 * - `conditional` — sent only for some rows: a `keepWhen` field, or a field of a
 *   conditional object.
 * - `omitted` — never sent: a `remove` override, or an object the phase leaves out.
 */
export type AutoFieldKind = "computed" | "always" | "conditional" | "omitted";

export interface AutoFieldRule {
  kind: AutoFieldKind;
  /** The value an `always` rule sends. */
  value?: string | number | boolean;
  /** Why — the override's own note, so badge and payload line say the same thing. */
  note: string;
  /** The step it applies to (*Historie*), or `null` for every step of the module. */
  phase: string | null;
}

export interface AutoFieldRules {
  /** By `fieldKey()` — `AfasEmployee.AfasBankInfo#BkTp`. */
  fields: Map<string, AutoFieldRule[]>;
  /** By object path — `AfasEmployee.AfasAgencySfb`. */
  objects: Map<string, AutoFieldRule[]>;
}

/** When a conditional object or field applies, in words. */
function whenNote(when: PhaseObjectWhen): string {
  return when.isOneOf
    ? tr(
        `alleen als "${when.column}" ${when.isOneOf.join(" of ")} is`,
        `only when "${when.column}" is ${when.isOneOf.join(" or ")}`
      )
    : tr(`alleen als "${when.column}" gevuld is`, `only when "${when.column}" is filled`);
}

function ruleOfOverride(override: PhaseOverride): Omit<AutoFieldRule, "phase"> {
  switch (override.kind) {
    case "constant":
      return { kind: "always", value: override.value, note: override.note };
    case "remove":
      return { kind: "omitted", note: override.note };
    case "keepWhen":
      return { kind: "conditional", note: whenNote(override.when) };
    default:
      return { kind: "computed", note: override.note };
  }
}

/**
 * Collapse one key's per-step rules: the same rule in **every** step is one rule
 * without a step; anything else keeps its step, so `SaPe` reads *Altijd V · Historie*
 * and says nothing about *Actueel*, where the mapping decides.
 *
 * `undefined` is a step the key doesn't apply to — one that doesn't send the object
 * at all, like *Actueel* and the medewerker's person — and is left out of the
 * comparison, so `SpNm` reads *Altijd true* rather than *Altijd true · Historie*
 * as if *Actueel* let the mapping decide it. `null` is a step that sends the field
 * as mapped.
 */
function mergeSteps(
  allSteps: (Omit<AutoFieldRule, "phase"> | null | undefined)[],
  allLabels: (string | null)[]
): AutoFieldRule[] {
  const applies = allSteps.map((rule) => rule !== undefined);
  const perStep = allSteps.filter((_, index) => applies[index]) as (Omit<
    AutoFieldRule,
    "phase"
  > | null)[];
  const labels = allLabels.filter((_, index) => applies[index]);
  if (perStep.length === 0) return [];
  const present = perStep.filter((rule): rule is Omit<AutoFieldRule, "phase"> => rule !== null);
  const same = (a: Omit<AutoFieldRule, "phase">, b: Omit<AutoFieldRule, "phase">) =>
    a.kind === b.kind && a.value === b.value && a.note === b.note;
  if (present.length === perStep.length && present.every((rule) => same(rule, present[0]!))) {
    return [{ ...present[0]!, phase: null }];
  }
  // Same kind and value everywhere, only the reason differs — the begin dates, from
  // *Datum in dienst* in one step and the livegangdatum in the other: one badge, the
  // reasons side by side in its tooltip.
  if (
    present.length === perStep.length &&
    present.every((rule) => rule.kind === present[0]!.kind && rule.value === present[0]!.value)
  ) {
    return [
      {
        ...present[0]!,
        note: present.map((rule, index) => `${labels[index]}: ${rule.note}`).join(" · "),
        phase: null,
      },
    ];
  }
  return perStep.flatMap((rule, index) => (rule ? [{ ...rule, phase: labels[index]! }] : []));
}

/**
 * Every field and object the conversion of `moduleId` (a **sidebar** module id —
 * `erp-crediteuren`, not one of its mapping ids) fills, limits or drops itself, read
 * from the same phases and overrides the payload build applies. `null` for a module
 * the code leaves entirely to its mapping.
 *
 * Paths start at the schema root, like the overrides, so one module's rules cover
 * both halves of a split module: the organisation's paths simply don't occur in the
 * person's schema.
 */
export function autoFieldRules(moduleId: string | null): AutoFieldRules | null {
  const phases = phasesOf(moduleId) ?? [buildPhaseOf(moduleId, null)].filter(
    (phase): phase is ModulePhase => phase !== null
  );
  if (phases.length === 0) return null;
  const labels = phases.map((phase) => (phases.length > 1 ? phase.label : null));

  const fieldRule = (
    phase: ModulePhase,
    key: string
  ): Omit<AutoFieldRule, "phase"> | null | undefined => {
    const override = phase.overrides[key];
    if (override) return ruleOfOverride(override);
    const [path, fieldId] = key.split("#") as [string, string];
    if (dateFieldOf(path) === fieldId && phase.dates[path]) {
      return { kind: "computed", note: noteForDate(phase, path) };
    }
    // A step that doesn't send this object has nothing to say about its fields.
    return phaseKeepsObject(phase, path) ? null : undefined;
  };
  const fieldKeys = new Set(
    phases.flatMap((phase) => [
      ...Object.keys(phase.overrides),
      ...Object.keys(phase.dates).flatMap((path) => {
        const fieldId = dateFieldOf(path);
        return fieldId ? [fieldKey(path, fieldId)] : [];
      }),
    ])
  );
  const fields = new Map<string, AutoFieldRule[]>();
  for (const key of fieldKeys) {
    const rules = mergeSteps(phases.map((phase) => fieldRule(phase, key)), labels);
    if (rules.length > 0) fields.set(key, rules);
  }

  // Objects: only the ones a step names as left out or conditional. A step that
  // simply doesn't list an object (*Actueel* writes four) isn't marked object by
  // object — that is the step's shape, said in its own description.
  const objectRule = (phase: ModulePhase, path: string): Omit<AutoFieldRule, "phase"> | null => {
    if (!phaseKeepsObject(phase, path)) {
      return { kind: "omitted", note: tr("niet verstuurd", "not sent") };
    }
    const when = phase.conditionalObjects?.[path];
    return when ? { kind: "conditional", note: whenNote(when) } : null;
  };
  const objectPaths = new Set(
    phases.flatMap((phase) => [
      ...(phase.excludeObjects ?? []),
      ...Object.keys(phase.conditionalObjects ?? {}),
    ])
  );
  const objects = new Map<string, AutoFieldRule[]>();
  for (const path of objectPaths) {
    const rules = mergeSteps(phases.map((phase) => objectRule(phase, path)), labels);
    if (rules.length > 0) objects.set(path, rules);
  }

  return { fields, objects };
}
