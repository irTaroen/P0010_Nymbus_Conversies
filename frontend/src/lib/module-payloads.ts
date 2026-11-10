/**
 * A module's sheet read through its stored mapping, as the bodies AFAS would receive
 * — one per record, for every row of the sheet at once.
 *
 * This is the step the tool has been building towards and could not take yet: the
 * mapping editor at `/afas/updateconnectors` already renders a real body
 * ([`afas-schema.ts`](./afas-schema.ts)'s `payloadLines`, fed by
 * [`field-mapping.ts`](./field-mapping.ts)'s `fieldValues`), but only ever **one row
 * at a time**, chosen with a *Voorbeeld* stepper, and only on the page where the
 * mapping is being made. Nothing built the whole set for the sheet a client actually
 * uploaded. That is all this module adds; every conversion rule underneath it —
 * dates to ISO, blank cells omitted, `valueMap` translations, kop/regel grouping —
 * is the existing code, called once per record rather than once.
 *
 * ### Why a module is not simply a connector
 *
 * Debiteuren is the case that forces the shape here. Its template has one column,
 * *Organisatie of Persoon* (`O`/`P`, required — the rule set enums it), that decides
 * **which connector a row goes through**: an `O` row is a `KnSalesRelationOrg`, a `P`
 * row a `KnSalesRelationPer`, same sheet, same columns, different object underneath.
 * So the module has two stored mappings — `erp-debiteuren-organisatie.json` and
 * `-persoon.json` — and neither is "the mapping for Debiteuren". Both files say so in
 * their own notes, and `_module_connector()` in the backend still resolves the module
 * to whichever of the two sorts first, which is the seam docs/todo.md flags.
 *
 * A {@link ModulePayloadPlan} is that seam closed on the read side: a module resolves
 * to **one or more variants**, plus — when there is more than one — the column whose
 * value picks between them. One variant and no discriminator is the ordinary case and
 * the twelve other modules are exactly that, so nothing about them changes.
 *
 * Openstaande posten has the identical shape (a `D`/`C` column over
 * `-debiteur`/`-crediteur`), which is why the plan is data rather than a Debiteuren
 * special case — see {@link MODULE_PAYLOAD_PLANS}.
 *
 * ### What a record is
 *
 * One row, for every module but three. Voorcalculatie, Abonnementen and Openstaande
 * posten state a kop and its regels flat — the kop's columns repeat on every regel row
 * — and their mappings mark the identifying columns with `key: true`. `groupShape()`
 * reads that off the mapping and `groupRows()` gathers the sheet by it, so a record
 * there is a **group of rows** and the regel object is written as AFAS's
 * `"Element": [ … ]` array. Both cases go through {@link buildModulePayloads} without
 * the caller having to know which one it is looking at.
 */

import type { ParsedSheet } from "@/lib/excel";
import { cellToString } from "@/lib/excel";
import { HeaderMap, headerIndex } from "@/lib/headers";
import {
  fieldsOf,
  filterSchema,
  objectPath,
  objectsOf,
  payloadLines,
  type AfasSchemaField,
  type AfasSchemaObject,
  type AfasUpdateSchema,
  type FieldValueResolver,
  type PayloadLine,
} from "@/lib/afas-schema";
import {
  afasDate,
  afasValue,
  fieldKey,
  fieldValues,
  fromMappingExport,
  groupRows,
  groupShape,
  lookupProblem,
  mappingLookups,
  remapToSheet,
  type FieldMapping,
  type StoredMapping,
} from "@/lib/field-mapping";
import { NO_LOOKUPS, lookupId, type AfasLookup, type LookupTables } from "@/lib/afas-lookup";
import { type StandardColumn } from "@/lib/standard-columns";
import { RULE_SETS } from "@/lib/validation/rules";
import {
  codetabelColumns,
  codetabelScope,
  codetabelVerdict,
  type CodetabelColumn,
} from "@/lib/validation/engine";
import {
  phaseAction,
  phaseKeepsObject,
  phaseWritesField,
  withPhase,
  type ModulePhase,
} from "@/lib/module-phases";
import {
  mergeRepairObjects,
  repairActions,
  repairKeepsObject,
  repairObjectsOf,
  withoutEmpty,
  type RepairObject,
  type RepairPlan,
} from "@/lib/repair-send";

/**
 * One connector a module's rows can go through, and how a row is recognised as
 * belonging to it.
 *
 * `match` is the set of cell values that select this variant, compared trimmed and
 * upper-cased — a client typing `o` rather than `O` is the same answer, and the
 * column is enum-checked by the rule set anyway. It is empty for a module with a
 * single variant, where every row belongs to it by definition.
 */
export interface ModuleVariant {
  /** The stored mapping's own key — the file name under `mappings/modules/`. */
  mappingId: string;
  /** What this half of the module is, for a badge: `Organisatie`, `Debiteur`, … */
  label: string;
  /** The badge's text in the 288px record list, where `label` would crowd out the
   *  record's own title — `Mdw.` for `Medewerker`. Absent = `label` is short enough. */
  short?: string;
  /** Cell values that route a row here. Empty = the module's only variant. */
  match: string[];
}

/**
 * Where a record's identity comes from, for the *Bestaat al* / *Nieuw* marks.
 *
 * Named by **sheet column header**, not by a path into the built body: the body is
 * nested and connector-shaped (a split module's two halves nest differently), while
 * this is the value the admin can see in the record list and the one the rule set
 * already validates. The backend's matching source is registered per module in
 * `backend/existing.py`, and the two must name the same record — see
 * docs/existing-records.md.
 */
export interface ExistingKeyPlan {
  /** The column holding the key, by header — `Debiteur Nummer`, `Projectnummer`. */
  column: string;
  /** What one record is called, for the counts and the dialog: "debiteur". */
  noun: string;
  /** And several, where the delete dialog needs it: "offertes". Falls back to
   *  "records" — Dutch plurals are not a suffix rule. */
  plural?: string;
}

/** How one module's rows become AFAS bodies. */
export interface ModulePayloadPlan {
  /**
   * The column whose value picks the variant, by **header** — not by index, so the
   * plan survives a template that gains a column, exactly as a mapping's own
   * `remapToSheet()` does. Null for a single-variant module.
   */
  discriminatorColumn: string | null;
  variants: ModuleVariant[];
  /**
   * How to tell whether a record already exists in AFAS. **Absent by default**, and
   * a module without it keeps exactly today's behaviour: nothing is fetched, nothing
   * is marked, and the send inserts — so adding this to one module cannot change
   * another. Requires a matching `_register` in `backend/existing.py`.
   */
  existing?: ExistingKeyPlan;
  /**
   * A second regel after every row's own, balancing it — for a grouped module whose
   * rows are all one side of a journaalpost. Absent for every other module.
   */
  counterLine?: CounterLinePlan;
}

/**
 * The counter-entry a row of a journaalpost gets, so the post balances.
 *
 * A beginbalans of open debiteurenposten is all-debet and AFAS refuses a journaalpost
 * that is not in balans (docs/AFAS-Profit-API-Referentie.md §6.4). So each row is
 * written twice: its own regel, then the same regel turned around onto the account in
 * `column` — the amounts swapped, `constants` written over it, and the fields that
 * only mean something on the row's own account left out. One counter-line per row
 * rather than one per post keeps every boekstuk balanced on its own (Taroen,
 * 13-10-2026).
 */
export interface CounterLinePlan {
  /** The sheet column holding the account to book against, by header. */
  column: string;
  /** The regel field that account goes into — `AcNr`. */
  accountField: string;
  /** Fields with one value on every counter-line — `VaAs` 1 (grootboekrekening). */
  constants: Record<string, string | number>;
  /** The two amount fields whose values trade places — `AmDe` and `AmCr`. */
  swap: [string, string];
  /** Fields the counter-line does not carry — the incasso, factuur and vervaldatum. */
  omit: string[];
  /** What the payload view says beside the counter-line's fields. */
  note: string;
}

/**
 * Which mappings each module's rows go through — **every module that has a stored
 * mapping**, which since 09-09-2026 is all sixteen of them.
 *
 * Keyed by the **app module id** ([`modules.tsx`](./modules.tsx)), which is what the
 * URL and the sidebar carry. The `mappingId`s are the file names in
 * `backend/json_files/mappings/modules/`, which for a split module are the module id
 * plus a variant suffix — the same suffixes `ConnectorRail` reads to label them.
 *
 * ### What a plan does and does not decide
 *
 * A plan answers one question — *which mapping does this row go through* — and
 * nothing else. It does **not** say whether a row is one record: that comes from the
 * `key: true` columns in the mapping itself, which `groupShape()` reads, so the three
 * kop/regel modules (Voorcalculatie, Abonnementen, Openstaande posten) need no
 * declaration here beyond their mapping id. Nor does it decide the connector: that is
 * the stored mapping's own `connector`, whose schema the panel fetches.
 *
 * `discriminatorColumn` is `null` for the ten single-variant modules, where every row
 * belongs to the one variant by definition. The four split modules each name the
 * template column that routes a row, and every one of those columns is `required` +
 * `enum` in its rule set — so a value no variant claims is already an error on the
 * *Data* tab before it reaches `variantOfRow()`.
 *
 * `existing` is present on only the modules that have a `CON_ERP_*` / `CON_HRM_*`
 * connector **and** key on a single row-level column. Adding it to a module cannot affect
 * another, and a module without it keeps the plain behaviour: nothing fetched,
 * nothing marked, the send inserts. See docs/existing-records.md for why the other
 * connectors are unregistered.
 */
export const MODULE_PAYLOAD_PLANS: Record<string, ModulePayloadPlan> = {
  // --- HRM -------------------------------------------------------------------
  "hrm-medewerkers": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-medewerkers", label: "Medewerker", short: "Mdw.", match: [] }],
    // `CON_HRM_Medewerker`, keyed on the medewerkercode — the column the rule set
    // already makes `required` + `unique`. A medewerker who is already in AFAS is the
    // case this mark exists for: re-sending the sheet would otherwise try to create a
    // second employee under a code AFAS already holds.
    existing: { column: "Medewerker", noun: "medewerker" },
  },
  "hrm-uitzendkrachten": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-uitzendkrachten", label: "Uitzendkracht", short: "Uitz.", match: [] }],
    // The same connector and the same key as `hrm-medewerkers`: an uitzendkracht is a
    // medewerker to AFAS, so the two modules read one existence list. The noun differs
    // because the counts and the confirm dialog are read by someone who knows which
    // sheet they uploaded.
    existing: { column: "Medewerker", noun: "uitzendkracht" },
  },
  // No `existing`: `CON_HRM_Verlofsaldo` keys on `Medewerker` + `TypeVerlof` +
  // `Boekjaar` and one medewerker holds a saldo per verlofsoort per year (88 rows over
  // 18 medewerkers live). Keying on *Medewerker* alone would mark every row of an
  // employee with any saldo as "bestaat al" and decline to write the rest — see
  // `backend/existing.py` for the composite-key seam that has to widen first.
  "hrm-verlofsaldo": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-verlofsaldo", label: "Verlofcorrectie", short: "Verlof", match: [] }],
  },
  // No `existing`: the `CON_HRM_Looncomponenten` connector at this customer is the
  // looncomponent *catalogue* (897 rows, keyed `Nummer` + `Stamnummer` + `CAO`), a
  // closed set of valid values rather than a list of records this sheet writes — a
  // codetabel in this app's terms, not an existence read.
  "hrm-salarisparameters": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-salarisparameters", label: "Salarisparameter", short: "Sal.par.", match: [] }],
  },
  "hrm-wagenpark": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-wagenpark", label: "Vervoermiddel", short: "Vervoer", match: [] }],
    // `CON_HRM_Wagenpark`, keyed on the kenteken rather than on the medewerker: one
    // medewerker can hold several vervoermiddelen, and *Kenteken* is the column the
    // rule set already makes `required` + `unique`.
    existing: { column: "Kenteken", noun: "vervoermiddel" },
  },
  // No `existing`: `CON_HRM_Loonmutaties_Vakantietoeslag` keys on `Periodetabel` +
  // `Boekjaar` + `Periode` + `Medewerker` + `LC`, and this sheet carries only
  // *Medewerker*, *Bedrag* and *Grondslag* — four of the five key parts are not in the
  // sheet at all, so there is nothing to compare.
  "hrm-vakantietoeslag": {
    discriminatorColumn: null,
    variants: [{ mappingId: "hrm-vakantietoeslag", label: "Grondslag", short: "Grondsl.", match: [] }],
  },

  // --- ERP -------------------------------------------------------------------
  "erp-debiteuren": {
    discriminatorColumn: "Organisatie of Persoon",
    variants: [
      { mappingId: "erp-debiteuren-organisatie", label: "Organisatie", short: "Deb.", match: ["O"] },
      { mappingId: "erp-debiteuren-persoon", label: "Persoon", short: "Deb.", match: ["P"] },
    ],
    // The badge names the record — a debiteur, either way — like `Mdw.` does for
    // Medewerkers; which half it is shows on hover, from `label`.
    //
    // Both halves of the split are the same debiteur to AFAS, keyed the same way —
    // which is why the existence key is a property of the module rather than of a
    // variant.
    existing: { column: "Debiteur Nummer", noun: "debiteur" },
  },
  // The same O/P seam as Debiteuren, one connector family over
  // (`KnPurchaseRelation*`), and keyed the same way — `CON_ERP_Crediteuren` was
  // already registered in `backend/existing.py` before this module had a plan to
  // use it.
  "erp-crediteuren": {
    discriminatorColumn: "Organisatie of Persoon",
    variants: [
      { mappingId: "erp-crediteuren-organisatie", label: "Organisatie", short: "Cred.", match: ["O"] },
      { mappingId: "erp-crediteuren-persoon", label: "Persoon", short: "Cred.", match: ["P"] },
    ],
    existing: { column: "Crediteur Nummer", noun: "crediteur" },
  },
  // A different kind of split from the O/P ones: *Contact bij* picks which **existing
  // relation** the new contactpersoon is nested under, so the two variants are the
  // sales and purchase sides of the same act rather than two shapes of one record.
  // No `existing`: the key in the sheet identifies the debiteur/crediteur being
  // reached through, not the contactpersoon being created, so matching on it would
  // mark every row of a client with existing relations as "bestaat al" and refuse to
  // write the very contacts this module exists to add.
  "erp-contactpersonen": {
    discriminatorColumn: "Contact bij",
    variants: [
      { mappingId: "erp-contactpersonen-debiteur", label: "Debiteur", short: "Deb.", match: ["D"] },
      { mappingId: "erp-contactpersonen-crediteur", label: "Crediteur", short: "Cred.", match: ["C"] },
    ],
  },
  "erp-artikelen": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-artikelen", label: "Artikel", match: [] }],
  },
  "erp-projecten": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-projecten", label: "Project", match: [] }],
    // `CON_ERP_Projecten` pads every key (`000001` against an `integer`
    // Projectnummer) — the case `normalize_key` exists for, see
    // docs/existing-records.md §2.
    // Deletable too (`PtProject` on `PrId`).
    existing: { column: "Projectnummer", noun: "project", plural: "projecten" },
  },
  // Grouped: `KnQuotation` is the kop and its regels repeat, off the mapping's four
  // `key: true` columns. `CON_ERP_Voorcalculatie` answers per regel (`Offerte` +
  // `Regelnummer`); the backend collapses those into one key per offerte, which is
  // the group a record is here. Its existing records can also be **deleted** from
  // the payload view — see `backend/existing.py`'s `DeleteTarget`.
  "erp-voorcalculatie": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-voorcalculatie", label: "Offerte", match: [] }],
    existing: { column: "Offerte", noun: "offerte", plural: "offertes" },
  },
  // Grouped on `Abonnement nummer`. `CON_ERP_Abonnementsregel` keys per regel too,
  // and the backend collapses its `Abonnement` field onto one key per abonnement,
  // the way Voorcalculatie's `Offerte` is. Deletable (`FbSubscription` on `SuNr`).
  "erp-abonnementen": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-abonnementen", label: "Abonnement", short: "Abon.", match: [] }],
    existing: { column: "Abonnement nummer", noun: "abonnement", plural: "abonnementen" },
  },
  "erp-vasteActiva": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-vasteActiva", label: "Vast activum", short: "Activum", match: [] }],
  },
  // Grouped on `Contractnummer`: `FiContract` is the kop, `FiContractline` its regel,
  // both stated flat on one row like Abonnementen. No `existing` yet — no
  // GetConnector for contracten is registered in `backend/existing.py`.
  "erp-financielecontracten": {
    discriminatorColumn: null,
    variants: [{ mappingId: "erp-financielecontracten", label: "Contract", match: [] }],
  },
  // Both halves go through **one** connector (`FiEntries`) — unlike the O/P splits,
  // which are two. What differs per side is the field shape: `VaAs` (Kenmerk
  // rekening) is fixed 2 vs 3, and the amount lands in `AmDe` vs `AmCr`. Grouped on
  // `Fin Administratie` + `Dagboek`, so a record is a journaalpost with its regels,
  // each row followed by its counter-line on the row's *Tussenrekening*.
  "erp-openstaandposten": {
    discriminatorColumn: "Debiteur of Crediteur",
    variants: [
      { mappingId: "erp-openstaandposten-debiteur", label: "Debiteur", short: "Deb.", match: ["D"] },
      { mappingId: "erp-openstaandposten-crediteur", label: "Crediteur", short: "Cred.", match: ["C"] },
    ],
    counterLine: {
      column: "Tussenrekening",
      accountField: "AcNr",
      constants: { VaAs: "1" },
      swap: ["AmDe", "AmCr"],
      omit: ["AuPa", "InId", "DaEx"],
      note: "tegenboeking op tussenrekening",
    },
  },
};

/**
 * Every distinct AFAS lookup the loaded variants' mappings declare — the tables the
 * panel has to fetch before a looked-up field can be filled. Empty for every module
 * without one, which then fetches nothing.
 */
export function contextLookups(contexts: Map<string, VariantContext>): AfasLookup[] {
  const byId = new Map<string, AfasLookup>();
  for (const { mapping } of contexts.values()) {
    for (const lookup of mappingLookups(fromMappingExport(mapping))) {
      byId.set(lookupId(lookup), lookup);
    }
  }
  return [...byId.values()];
}

/** The plan for a module, or `null` when it has no payload view. */
export function payloadPlanFor(moduleId: string): ModulePayloadPlan | null {
  return MODULE_PAYLOAD_PLANS[moduleId] ?? null;
}

/**
 * The sidebar module a stored mapping belongs to — `erp-crediteuren` for
 * `erp-crediteuren-organisatie` — or `null` for a mapping no plan uses (a custom
 * module's, a Nymbus connector's). What the phases and overrides are keyed by.
 */
export function moduleOfMapping(mappingId: string): string | null {
  for (const [moduleId, plan] of Object.entries(MODULE_PAYLOAD_PLANS)) {
    if (plan.variants.some((variant) => variant.mappingId === mappingId)) return moduleId;
  }
  return null;
}

/** Every mapping id a module's plan needs loaded before it can build anything. */
export function planMappingIds(plan: ModulePayloadPlan): string[] {
  return plan.variants.map((variant) => variant.mappingId);
}

/**
 * The variant a row belongs to, or `null` when its discriminator cell says nothing
 * any variant claims.
 *
 * A `null` is **not** silently dropped by the caller: an unroutable row is a row that
 * would never reach AFAS, and the whole point of this view is to see that before an
 * upload rather than after. The rule set already flags an empty or out-of-enum value
 * in that column, so this is the same finding stated in payload terms.
 */
export function variantOfRow(
  plan: ModulePayloadPlan,
  sheet: ParsedSheet,
  rowIndex: number
): ModuleVariant | null {
  const [only] = plan.variants;
  if (plan.discriminatorColumn === null) return only ?? null;
  const column = headerIndex(sheet.headers, plan.discriminatorColumn);
  if (column === -1) return null;
  const value = cellToString(sheet.rows[rowIndex]?.[column] ?? null).trim().toUpperCase();
  return (
    plan.variants.find((variant) =>
      variant.match.some((candidate) => candidate.toUpperCase() === value)
    ) ?? null
  );
}

/**
 * One field a record can be filtered on: the AFAS code, and the Dutch label AFAS
 * gives it.
 *
 * Named by **field code alone**, not by the `path#field` key a mapping is stored
 * under. A split module maps the same code in two connectors that nest differently
 * (`KnSalesRelationOrg.KnOrganisation#DbId` and `…Per.KnPerson#DbId`), and an admin
 * filtering on *Debiteurnummer* means both — one entry in the picker that matches
 * whichever half a record went through. Where two objects of one connector really do
 * carry different fields under one code, both values are kept and the filter matches
 * if either does, which is the reading that never hides a record it should show.
 */
export interface PayloadField {
  /** The AFAS field code — `DbId`. What goes between the brackets. */
  fieldId: string;
  /** AFAS's own Dutch label — `Debiteurnummer`. Falls back to the code. */
  label: string;
}

/** One body the conversion would send, with everything needed to read it. */
export interface ModulePayload {
  /** Position in the built set, 1-based — what the list numbers records by. */
  ordinal: number;
  /** The variant it went through — its connector, and the badge beside it. */
  variant: ModuleVariant;
  /** The connector this body is posted to, from the mapping itself. */
  connector: string;
  /** Excel row numbers behind it: one for a row, several for a grouped record. */
  rowNumbers: number[];
  /** A word or two identifying the record — its `existingKey` if it has one, else
   *  the first key/required cell it has. */
  title: string;
  /**
   * The record's key as the sheet spells it, from the plan's `existing.column` —
   * empty when the module has no existence plan or the cell is blank. Raw here;
   * `normalizeKey()` does the padding-insensitive comparison. Carried on the payload
   * so the mark, the send and the backend's re-check all read one value.
   */
  existingKey: string;
  /** The body, line by line, each carrying the column that filled it. */
  lines: PayloadLine[];
  /**
   * What this body carries per field code, as text — what the filter reads.
   *
   * Taken from the **same resolver the lines are written by** (`fieldValues`), not by
   * parsing the rendered JSON back: a filter that read the text would match the
   * quoting and the indentation as readily as the value, and would go blind the
   * moment *Alleen gevuld* is switched off and every field grows a placeholder.
   * A field whose cell is empty is absent here rather than `""` — the body leaves it
   * out too, and "has no value" is a thing the filter can then say.
   *
   * Several values under one code where a connector fills it in more than one object
   * (see {@link PayloadField}); a grouped record carries its **kop's** values, from
   * the first row, since that is what identifies the record the filter is picking.
   */
  values: Map<string, string[]>;
  /**
   * Why this record is not part of the current phase, or `null` when it is.
   *
   * A skipped record is still **built and shown** rather than dropped: "248 of 266"
   * with no way to see the other 18 is a number an admin has to take on faith, and
   * the reason a medewerker is out of phase 2 (their contract ended before livegang)
   * is exactly the thing worth checking. It is excluded from the send instead.
   */
  skipped: string | null;
  /**
   * Why this record **can't** be sent, or `null` when it can: a looked-up field
   * (`FieldSource.lookup`) whose cell has no answer in the environment being sent to
   * — no match, several, or a table that couldn't be read. Unlike `skipped` this is
   * not a choice the phase made but a value that is missing, so the send leaves the
   * record out and the list says which field and why. Covers every row of a grouped
   * record: one unresolved regel is a body AFAS would get wrong.
   */
  blocked: string | null;
}

/** A column a mapping fills a field from that the uploaded sheet doesn't have. */
export interface MissingColumn {
  /** The header the mapping expects, verbatim. */
  header: string;
  /** The variant whose mapping wanted it. */
  variantLabel: string;
  /** The AFAS field it would have filled, for the message. */
  field: string;
}

/** A row that reached no variant at all, and why. */
export interface UnroutedRow {
  rowNumber: number;
  /** What the discriminator cell actually held, for the message. */
  value: string;
}

/** Everything the payload view shows, built in one pass over the sheet. */
export interface ModulePayloadSet {
  payloads: ModulePayload[];
  unrouted: UnroutedRow[];
  /**
   * Columns a mapping names that this sheet has not got. Dropping them is right —
   * a field filled from the wrong column is worse than an absent field — but doing
   * it silently is not: the reader has to know a field they mapped is not in these
   * bodies, and that the sheet is probably not the template the mapping was made
   * against.
   */
  missingColumns: MissingColumn[];
  /**
   * Every field these bodies actually carry, by code — what the filter's picker
   * offers, in the mapping's own (schema) order so it reads like the body does.
   *
   * Built from the **mappings**, not from the schemas: the picker must offer what
   * these records are filled with, and a connector's full field list is hundreds of
   * placeholders nobody can filter on. Across all variants at once, so a split
   * module offers one list rather than one per half.
   */
  fields: PayloadField[];
  /**
   * The nested objects these bodies can carry, across every variant, depth first —
   * what the *Herstellen* chooser offers ([`repair-send.ts`](./repair-send.ts)).
   * Read off the schema **before** a repair narrows it, so choosing *Overslaan* for
   * an object does not take its row out of the chooser.
   */
  objects: RepairObject[];
}

/** Shared empty fills, so the default argument is stable across renders. */
const NO_FILL_COLUMNS: ReadonlyMap<string, StandardColumn> = new Map();

/** Shared empty key set, for `payloadValues`' default argument. */
const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** What one variant needs to render: its mapping, and the schema behind it. */
export interface VariantContext {
  mapping: StoredMapping;
  schema: AfasUpdateSchema;
  /**
   * Whether `mapping` is this project's **own copy** (`mappings/clients/…`) rather
   * than the standard one — a custom module's, or a catalog module flagged as
   * *Afwijkende koppeling*. Its schema then came from the project's own AFAS, and
   * the payload view's *Koppeling* button has to open that copy, not the standard.
   */
  client: boolean;
}

/**
 * How much of each body is written: everything the connector accepts, or only what
 * the mapping actually fills.
 *
 * `all` is the shape — every field the connector has, unmapped ones carrying a typed
 * placeholder — which is what answers *is there a field here nobody mapped*. `mapped`
 * is the body as it would really be sent, the objects kept for what survives in them.
 * The narrowing is `filterSchema`'s own `keepField`, the same hook the mapping editor's
 * *Alleen gevuld* uses, so the two views can't drift apart.
 */
export type PayloadScope = "all" | "mapped";

/**
 * What one record carries per field code, read through the same resolver that writes
 * its lines.
 *
 * It walks the **mapping**, not the schema, so it costs one pass over the filled
 * fields rather than over the connector's whole tree — and it asks the resolver for
 * each one, which is what makes a `valueMap` translation and a date's ISO form show
 * up here exactly as they do in the body. An omitted field (an empty cell) is left
 * out; a `null` (no sheet) is too, since neither is a value to match on.
 */
function payloadValues(
  mapping: FieldMapping,
  schema: AfasUpdateSchema,
  resolve: FieldValueResolver,
  /**
   * Keys the app fills whose column this sheet hasn't got — absent from `mapping`,
   * but carrying a value in every body, so the filter has to be able to match on
   * them. Walked beside the mapping's own keys rather than instead of them.
   */
  filled: ReadonlySet<string> = EMPTY_KEYS
): Map<string, string[]> {
  const values = new Map<string, string[]>();
  // The schema is what says which `AfasSchemaField` a key stands for, and the
  // resolver takes the field itself rather than its code. One walk, keyed the way
  // the mapping is, so the two can be looked up against each other.
  const byKey = new Map<string, { path: string; field: AfasSchemaField }>();
  const walk = (object: AfasSchemaObject, path: string) => {
    for (const field of fieldsOf(object)) {
      byKey.set(fieldKey(path, field.fieldId), { path, field });
    }
    for (const child of objectsOf(object)) walk(child, objectPath(path, child.name));
  };
  walk(schema, schema.name);

  // A Set so a key that is both mapped and filled is asked for once.
  for (const key of new Set([...Object.keys(mapping), ...filled])) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const resolved = resolve(entry.path, entry.field);
    if (!resolved || resolved.omit || resolved.value === null) continue;
    const text = String(resolved.value).trim();
    if (text === "") continue;
    values.set(entry.field.fieldId, [...(values.get(entry.field.fieldId) ?? []), text]);
  }
  return values;
}

/**
 * The mapping keys the app fills itself, by the fill behind each — built from the
 * **stored** mapping rather than the remapped one, so a column the sheet hasn't got
 * is still found here. That is the case the whole thing exists for: a facilitaire
 * sjabloon that dropped *Periodetabel HRM* leaves `AfasEmployee.AfasSalary#PtId`
 * unmapped after `remapToSheet`, and nothing downstream would know which field the
 * absent column was going to fill if the lookup went the other way.
 *
 * Keyed by mapping key rather than by header because that is what the resolver is
 * asked in — and because one header can fill more than one field, which a
 * header-keyed lookup would have to re-derive per call.
 */
function fillsByKey(
  stored: FieldMapping,
  fills: ReadonlyMap<string, StandardColumn>
): Map<string, StandardColumn> {
  const byKey = new Map<string, StandardColumn>();
  if (fills.size === 0) return byKey;
  // Asked by the header a *mapping* carries, which came off a client's sheet, against
  // a table written in our own spelling — so the two are matched the way every other
  // header comparison is (`lib/headers.ts`), not by exact string.
  const byHeader = new HeaderMap([...fills]);
  for (const [key, source] of Object.entries(stored)) {
    if (source.kind !== "column") continue;
    const fill = byHeader.get(source.header);
    // A fill with nothing to put in the column (no periodetabel on the project, no
    // livegangdatum in AFAS yet) is not registered: the field then behaves as it
    // always did — omitted when the cell is empty — rather than being filled with a
    // guess. `standard-columns.ts` explains why that is the right failure.
    if (fill && fill.value !== null) byKey.set(key, fill);
  }
  return byKey;
}

/**
 * The mapping keys whose column carries a `default-if-empty` rule, by the default —
 * the payload half of the amber cell the validation engine records for a blank cell
 * under that rule (Taroen, 13-10-2026).
 *
 * Built from the **remapped** mapping, so only columns this sheet actually has are
 * in it: `default-if-empty` answers for a blank *cell*, never for an absent column.
 * An absent column stays reported as missing — that is the point of the rule over
 * the retired `required-or-default`, which made the columns a sheet must carry
 * unclear. Filling a column the sheet hasn't got is what `standard-columns.ts` is for.
 */
function ruleDefaultsByKey(
  plan: ModulePayloadPlan,
  mapping: FieldMapping
): Map<string, StandardColumn> {
  const byKey = new Map<string, StandardColumn>();
  const moduleId = planModuleId(plan);
  const columns = moduleId ? RULE_SETS[moduleId]?.columns ?? [] : [];
  const entries: [string, string][] = [];
  for (const col of columns) {
    const value = col.rules.find((r) => r.check === "default-if-empty")?.defaultValue;
    if (value === undefined) continue;
    for (const name of Array.isArray(col.column) ? col.column : [col.column]) {
      entries.push([name, value]);
    }
  }
  if (entries.length === 0) return byKey;
  const byHeader = new HeaderMap(entries);
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind !== "column") continue;
    const value = byHeader.get(source.header);
    if (value !== undefined) {
      byKey.set(key, { header: source.header, value, note: "standaardwaarde bij lege cel" });
    }
  }
  return byKey;
}

/** The module id `plan` is registered under, for reading that module's rule set. */
function planModuleId(plan: ModulePayloadPlan): string | undefined {
  return Object.keys(MODULE_PAYLOAD_PLANS).find((id) => MODULE_PAYLOAD_PLANS[id] === plan);
}

/**
 * The mapping keys whose column carries an `omitUnlisted` codetabel rule, by that
 * column as the validation engine resolves it — the payload half of the amber
 * *unlisted* cell (Geboorteland, Geboorteplaats). Built from the **remapped**
 * mapping, so its indexes are this sheet's.
 */
function unlistedOmissionsByKey(
  plan: ModulePayloadPlan,
  mapping: FieldMapping,
  headers: string[]
): Map<string, CodetabelColumn> {
  const byKey = new Map<string, CodetabelColumn>();
  const moduleId = planModuleId(plan);
  if (!moduleId) return byKey;
  const columns = codetabelColumns(moduleId, headers).filter((c) => c.rule.omitUnlisted);
  if (columns.length === 0) return byKey;
  for (const [key, source] of Object.entries(mapping)) {
    if (source.kind !== "column") continue;
    const column = columns.find((c) => c.idx === source.index);
    if (column) byKey.set(key, column);
  }
  return byKey;
}

/**
 * `resolve` with every `omitUnlisted` field left out of the body when this row's
 * value isn't in its codetabel — the same verdict, against the same scope, that
 * marked the cell amber, so the table and the body are one decision. The rest of
 * the record is sent. A table that hasn't loaded judges nothing, so the value goes
 * out as before.
 *
 * **A pair goes together or not at all.** A column and the scope column it is judged
 * within (Geboorteplaats within Geboorteland) are dropped as one: a place sent
 * without its land, or a land without the place that came with it, is half a fact
 * AFAS would store as a whole one (Taroen, 21-10-2026).
 */
function withoutUnlisted(
  resolve: FieldValueResolver,
  byKey: ReadonlyMap<string, CodetabelColumn>,
  sheet: ParsedSheet,
  rowIndex: number
): FieldValueResolver {
  if (byKey.size === 0) return resolve;
  const row = sheet.headers.map((_, c) => cellToString(sheet.rows[rowIndex]?.[c] ?? null));
  // The columns whose own value is unlisted in this row, each with the reason.
  const unlisted = new Map<number, string>();
  for (const column of new Set(byKey.values())) {
    const value = (row[column.idx] ?? "").trim();
    if (value === "") continue;
    const scope = codetabelScope(column.rule, row, column.scopeIdx);
    if (!codetabelVerdict(column.rule, value, scope).valid) {
      unlisted.set(column.idx, `${sheet.headers[column.idx]} "${value}" — niet in AFAS`);
    }
  }
  if (unlisted.size === 0) return resolve;
  // Then the pairs: a column goes when it, its scope column or a column scoped by
  // it is unlisted.
  const reason = (column: CodetabelColumn): string | undefined =>
    unlisted.get(column.idx) ??
    (column.scopeIdx !== null ? unlisted.get(column.scopeIdx) : undefined) ??
    [...byKey.values()]
      .filter((other) => other.scopeIdx === column.idx)
      .map((other) => unlisted.get(other.idx))
      .find(Boolean);
  return (path, field) => {
    const column = byKey.get(fieldKey(path, field.fieldId));
    const why = column && reason(column);
    return why ? { omit: true, note: `${why}, niet meegestuurd` } : resolve(path, field);
  };
}

/**
 * `fieldValues`' answer with the app's own values behind it — the payload half of
 * {@link StandardColumn}.
 *
 * It overrides exactly two of the three answers the resolver can give, and leaves the
 * third alone:
 *
 * - **`{ omit: true }`** — the column is in the sheet and this row's cell is blank.
 *   The fill goes in. This is the same rule the validation engine applies to the same
 *   cell (it records a default there), so the amber cell in the table and the value
 *   in the body are one decision rather than two that have to agree.
 * - **`undefined`** — unmapped. Only overridden for a key the *stored* mapping did
 *   map to a filled column, i.e. one `remapToSheet` dropped because the sheet hasn't
 *   got the column. A genuinely unmapped field keeps its placeholder, as before.
 * - **a value** — the sheet said something. Untouched: the sheet wins when it is
 *   filled (Taroen, 09-09-2026).
 *
 * The note carries the fill's provenance rather than a column header, because that is
 * what it is — *periodetabel uit dossieritem*, not a cell nobody can go and look at.
 */
function withFills(
  resolve: FieldValueResolver,
  byKey: ReadonlyMap<string, StandardColumn>
): FieldValueResolver {
  if (byKey.size === 0) return resolve;
  return (path, field) => {
    const resolved = resolve(path, field);
    if (resolved && !resolved.omit && resolved.value !== null) return resolved;
    const fill = byKey.get(fieldKey(path, field.fieldId));
    if (!fill || fill.value === null) return resolved;
    // Through `afasValue()`, the same converter a sheet cell goes through, so a fill
    // and a typed-in cell of the same value produce the identical body: `DyWk` is an
    // `int` and `HrWk` a `decimal`, and sending them as `"5"` / `"38"` where a filled
    // cell sends `5` / `38` would make the two paths differ in AFAS's eyes for no
    // reason the reader could see.
    return { value: afasValue(field, fill.value), note: fill.note };
  };
}

/**
 * One row's cells by column header, for a phase's `derive` overrides.
 *
 * Through `headerIndex` rather than a raw `indexOf`, like every other header lookup
 * in the app: the client's sheet spells *Org. Eenheid* where ours says *Org.
 * eenheid*, and an exact match would silently read nothing — which for a `J`/`N`
 * flag means quietly taking the `N` branch for every row (`lib/headers.ts`).
 */
function cellReader(
  sheet: ParsedSheet,
  rowIndex: number
): (header: string) => string {
  return (header) => {
    const column = headerIndex(sheet.headers, header);
    if (column === -1) return "";
    return cellToString(sheet.rows[rowIndex]?.[column] ?? null).trim();
  };
}

/**
 * A regel's resolver turned into its counter-line's — see {@link CounterLinePlan}.
 *
 * Only the regel object itself is turned around; anything above or below it reads as
 * the row's own line does. The swapped amounts go back through `resolve` under the
 * other field's id, so the counter amount is the row's amount after every conversion
 * the mapping applies, not a second reading of the cell.
 */
function counterResolver(
  resolve: FieldValueResolver,
  counter: CounterLinePlan,
  linePath: string,
  cell: (header: string) => string
): FieldValueResolver {
  return (path, field) => {
    if (path !== linePath) return resolve(path, field);
    const id = field.fieldId;
    if (counter.omit.includes(id)) return { omit: true, note: counter.note };
    if (id === counter.accountField) {
      const account = cell(counter.column);
      return account === ""
        ? { omit: true, note: `${counter.column} — leeg` }
        : { value: afasValue(field, account), note: counter.note };
    }
    if (id in counter.constants) {
      return { value: counter.constants[id] ?? null, note: counter.note };
    }
    const [a, b] = counter.swap;
    const other = id === a ? b : id === b ? a : null;
    if (other === null) return resolve(path, field);
    const swapped = resolve(path, { ...field, fieldId: other });
    return swapped && !swapped.omit ? { ...swapped, note: counter.note } : swapped;
  };
}

/** Shared empty date map, so a phase-less build allocates nothing per record. */
const NO_DATES: ReadonlyMap<string, string> = new Map();

/**
 * The date one record's cell carries, as `yyyy-mm-dd` — or `""` when the cell is
 * blank or holds something that isn't a date.
 *
 * Through `afasDate()`, the same converter every mapped date cell goes through, so a
 * phase's begin date and a mapped one are the same notation by construction. A cell
 * AFAS couldn't read yields `""` rather than the raw text: this value becomes a
 * mandatory primary key, and a key of `"31/02/2019"` is a body AFAS refuses with a
 * message about the object rather than about the cell.
 */
function dateFromColumn(
  sheet: ParsedSheet,
  rowIndex: number,
  header: string
): string {
  const column = headerIndex(sheet.headers, header);
  if (column === -1) return "";
  const text = cellToString(sheet.rows[rowIndex]?.[column] ?? null).trim();
  if (text === "") return "";
  return afasDate(text)?.slice(0, 10) ?? "";
}

/**
 * Each dated object's begin date for one record, by object path.
 *
 * Resolved per record rather than per phase because phase 1's date is a **column** —
 * every employee has their own datum in dienst — while phase 2's is one setting of
 * the conversion. Both end up in the same map, so `withPhase()` reads one thing.
 */
function phaseDates(
  phase: ModulePhase,
  sheet: ParsedSheet,
  rowIndex: number,
  livegangDatum: string
): ReadonlyMap<string, string> {
  const dates = new Map<string, string>();
  for (const [path, source] of Object.entries(phase.dates)) {
    dates.set(
      path,
      source.kind === "livegang"
        ? livegangDatum.slice(0, 10)
        : dateFromColumn(sheet, rowIndex, source.header)
    );
  }
  return dates;
}

/**
 * Why this record is out of this phase, or `null` when it is in it.
 *
 * Only one rule today: an employee whose contract ended **before** the livegangdatum
 * gets no second contract starting at livegang, because that is an employment that
 * did not happen. A blank einddatum never skips — an open contract is the normal
 * case, and treating "no end date" as "ended long ago" would drop every current
 * employee from the phase that pays them.
 *
 * A record with no resolvable livegangdatum is **not** skipped either: that is a
 * configuration gap the panel reports as itself, and silently calling every employee
 * "ended before an unknown date" would hide it behind a plausible number.
 */
function skipReason(
  phase: ModulePhase,
  sheet: ParsedSheet,
  rowIndex: number,
  livegangDatum: string
): string | null {
  const skip = phase.skip;
  if (!skip) return null;
  const livegang = livegangDatum.slice(0, 10);
  if (livegang === "") return null;
  const ended = dateFromColumn(sheet, rowIndex, skip.column);
  if (ended === "") return null;
  // Both are `yyyy-mm-dd`, so a string comparison is a date comparison — and one
  // that cannot drift with a timezone the way two `Date`s would.
  return ended < livegang ? skip.reason : null;
}

/**
 * The first unresolved lookup across a record's rows, with the Excel row it is on
 * when the record spans several — or `null`. Skips the work entirely for a mapping
 * without a lookup, which is every mapping but a handful.
 */
function recordBlocked(
  mapping: FieldMapping,
  sheet: ParsedSheet,
  record: number[],
  lookups: LookupTables
): string | null {
  if (!Object.values(mapping).some((source) => source.kind === "column" && source.lookup)) {
    return null;
  }
  for (const rowIndex of record) {
    const problem = lookupProblem(mapping, sheet, rowIndex, lookups);
    if (problem === null) continue;
    return record.length > 1
      ? `${problem} (rij ${sheet.rowNumbers[rowIndex] ?? rowIndex + 1})`
      : problem;
  }
  return null;
}

/** The label of the first column a record can be recognised by. */
function recordTitle(mapping: FieldMapping, sheet: ParsedSheet, rowIndex: number): string {
  const columns = Object.values(mapping)
    .flatMap((source) => (source.kind === "column" ? [source] : []))
    .sort((a, b) => Number(Boolean(b.key)) - Number(Boolean(a.key)) || a.index - b.index);
  for (const column of columns) {
    const text = cellToString(sheet.rows[rowIndex]?.[column.index] ?? null).trim();
    if (text !== "") return text;
  }
  return "";
}

/**
 * Every body a module's sheet would produce, in sheet order.
 *
 * Each variant's rows are read through **that variant's own** mapping and schema, so
 * a Debiteuren sheet with both kinds of row yields `KnSalesRelationOrg` bodies and
 * `KnSalesRelationPer` bodies side by side, each with its own field set — which is
 * exactly what the upload will have to post, and what nothing could see until now.
 *
 * Grouping is asked of the mapping, per variant, rather than of the module: a
 * grouped module has one variant today, but the question *does this mapping group*
 * is the mapping's to answer, and asking it per variant means a future split module
 * that also groups needs no change here.
 */
export function buildModulePayloads(
  plan: ModulePayloadPlan,
  contexts: Map<string, VariantContext>,
  sheet: ParsedSheet,
  scope: PayloadScope,
  /**
   * The columns this conversion fills from its own configuration rather than from the
   * client's sheet — see [`lib/standard-columns.ts`](./standard-columns.ts). Such a
   * column fills its field whether the sheet has it blank or hasn't got it at all,
   * and is never reported as a missing column. Empty for a standard conversion, which
   * builds exactly as before.
   */
  fills: ReadonlyMap<string, StandardColumn> = NO_FILL_COLUMNS,
  /**
   * Which call of a multi-step module this set is for
   * ([`module-phases.ts`](./module-phases.ts)) — `null` for every ordinary module,
   * which builds exactly as it always did.
   */
  phase: ModulePhase | null = null,
  /**
   * The conversion's livegangdatum as `yyyy-mm-dd`, for the phase that dates its
   * records by it. `""` when AFAS hasn't got one, which leaves those begin dates
   * unresolved — the panel says so rather than sending a body AFAS would refuse.
   */
  livegangDatum: string = "",
  /**
   * The AFAS tables the mappings' looked-up fields read, fetched from the
   * environment the send goes to ([`afas-lookup.ts`](./afas-lookup.ts)). A record
   * whose lookup has no answer is built and shown, but `blocked`.
   */
  lookups: LookupTables = NO_LOOKUPS,
  /**
   * A *Herstellen* send ([`repair-send.ts`](./repair-send.ts)): which nested objects
   * the body keeps and the `@Action` each carries, on top of the phase. `null` for
   * every ordinary build.
   */
  repair: RepairPlan | null = null
): ModulePayloadSet {
  const payloads: ModulePayload[] = [];
  const objectLists: RepairObject[][] = [];
  const unrouted: UnroutedRow[] = [];
  const missingColumns: MissingColumn[] = [];
  // Field code → label, across every variant. A Map keyed by code is what makes the
  // two halves of a split module one list: the second variant's `DbId` finds the
  // first's entry rather than adding a duplicate, and insertion order keeps the
  // schema order the mapping was written in.
  const fieldLabels = new Map<string, string>();
  const discriminator =
    plan.discriminatorColumn === null
      ? -1
      : headerIndex(sheet.headers, plan.discriminatorColumn);
  // The key column, by header, for the same reason the discriminator is: a template
  // that gained a column must not shift it. -1 for a module with no existence plan,
  // and also for one whose sheet simply hasn't got the column — both leave every
  // `existingKey` empty, which reads as "cannot say" rather than as "new".
  const keyColumn = plan.existing ? headerIndex(sheet.headers, plan.existing.column) : -1;

  // Which rows went to which variant, in sheet order, before anything is rendered:
  // a grouped variant needs its whole row set at once, and an ungrouped one reads
  // the same list one entry at a time.
  const rowsByVariant = new Map<string, number[]>();
  sheet.rows.forEach((_, rowIndex) => {
    const variant = variantOfRow(plan, sheet, rowIndex);
    if (!variant) {
      unrouted.push({
        rowNumber: sheet.rowNumbers[rowIndex] ?? rowIndex + 1,
        value:
          discriminator === -1
            ? ""
            : cellToString(sheet.rows[rowIndex]?.[discriminator] ?? null).trim(),
      });
      return;
    }
    rowsByVariant.set(variant.mappingId, [
      ...(rowsByVariant.get(variant.mappingId) ?? []),
      rowIndex,
    ]);
  });

  for (const variant of plan.variants) {
    const context = contexts.get(variant.mappingId);
    const rowIndexes = rowsByVariant.get(variant.mappingId) ?? [];
    if (!context || rowIndexes.length === 0) continue;

    // The stored mapping re-pointed at the sheet on screen, by header name — the
    // same rule the mapping editor applies when a saved mapping is opened beside
    // another copy of the template (`remapToSheet`). A mapping's `columnIndex` is
    // only true of the sheet it was made against: a client's export that gained or
    // lost a column shifts every index after it, and reading the raw indices would
    // fill each field from its neighbour's column — silently, since the values are
    // all strings. Without this, a template one column short wrote Woonplaats into
    // `CoId` (Land) and Straatnaam into `HmNr` (Huisnummer).
    const stored = fromMappingExport(context.mapping);
    const mapping = remapToSheet(stored, sheet.headers);
    // Which of this mapping's fields the app fills itself, before the missing-column
    // pass below — a filled column is not missing from the template, it is one this
    // conversion does not ask the client for, so it must not be reported.
    const filled = fillsByKey(stored, fills);
    // What a blank cell is sent as: the conversion's own fills first, then the rule
    // set's `default-if-empty` values for the columns this sheet has.
    const defaulted = new Map([...ruleDefaultsByKey(plan, mapping), ...filled]);
    // What is left out when the sheet's value isn't in its codetabel.
    const omitted = unlistedOmissionsByKey(plan, mapping, sheet.headers);
    for (const [key, source] of Object.entries(stored)) {
      if (source.kind !== "column" || mapping[key] || filled.has(key)) continue;
      missingColumns.push({
        header: source.header,
        variantLabel: variant.label,
        field: key.split("#")[1] ?? key,
      });
    }
    // The picker's entries, from the stored document rather than from `mapping`:
    // it is the half that carries AFAS's label, and it is the same list of fields —
    // a column this sheet hasn't got is already reported as a missing column, and
    // leaving it out of the picker too would be right but would make the picker
    // depend on which file is open. `label ||` because a mapping saved before the
    // label was stored has an empty one, and a blank entry in the list is worse than
    // the bare code.
    for (const entry of context.mapping.fields) {
      if (!fieldLabels.has(entry.field)) {
        fieldLabels.set(entry.field, entry.label || entry.field);
      }
    }

    // The phase's own objects, before the scope narrows anything: a phase that
    // doesn't write `KnPerson` must not carry an empty one, and pruning it here
    // rather than in the resolver is what removes the object instead of blanking it.
    const scoped = phase
      ? filterSchema(context.schema, {
          query: "",
          onlyMandatory: false,
          keepObject: (path) => phaseKeepsObject(phase, path),
        })
      : context.schema;
    if (!scoped) continue;

    const narrowed =
      scope === "mapped"
        ? filterSchema(scoped, {
            query: "",
            onlyMandatory: false,
            // `filled` as well as `mapping`: a field whose column this sheet hasn't
            // got is dropped from `mapping`, but the app fills it, so *Alleen gevuld*
            // has to keep it — narrowing it away would leave the value out of the
            // body that is actually sent, since the send uses this same scope.
            // A phase's own fields join them for the same reason: phase 1's salary of
            // 0 is written by the phase, not by the mapping, and *Alleen gevuld* that
            // hid it would hide it from the body too.
            keepField: (path, field) => {
              const key = fieldKey(path, field.fieldId);
              if (Boolean(mapping[key]) || filled.has(key)) return true;
              return phase ? phaseWritesField(phase, path, field) : false;
            },
          })
        : scoped;
    if (!narrowed) continue;
    objectLists.push(repairObjectsOf(narrowed));

    // The repair's own narrowing, last: the objects set to *Overslaan* leave the body
    // outright, the same way a phase drops the ones it doesn't write.
    const repaired = repair
      ? filterSchema(narrowed, {
          query: "",
          onlyMandatory: false,
          keepObject: (path) => repairKeepsObject(repair, path),
        })
      : narrowed;
    if (!repaired) continue;

    const shape = groupShape(mapping);
    // A grouped mapping gathers **this variant's rows only**: rows of another variant
    // are another connector's records and can't share a kop with these.
    const variantSheet: ParsedSheet = shape
      ? {
          ...sheet,
          rows: rowIndexes.map((index) => sheet.rows[index]),
          rowNumbers: rowIndexes.map((index) => sheet.rowNumbers[index] ?? index + 1),
        }
      : sheet;

    const records: number[][] =
      shape && shape.linePath
        ? groupRows(shape.keyColumns, variantSheet).map((group) => group.rows)
        : rowIndexes.map((index) => [index]);

    for (const record of records) {
      // A grouped record's indexes point into `variantSheet`; an ungrouped one's
      // into `sheet`. One `read` sheet either way, so everything below is the same.
      const read = shape && shape.linePath ? variantSheet : sheet;
      const [first = 0] = record;
      // One resolver for the record's own row, used by both the body and the values
      // the filter reads — the same values, by construction rather than by two code
      // paths that have to agree.
      const base = withoutUnlisted(
        withFills(fieldValues(mapping, read, first, lookups), defaulted),
        omitted,
        read,
        first,
      );
      // This record's begin date per dated object, resolved once: a column of the
      // sheet for phase 1, the conversion's livegangdatum for phase 2. Empty for a
      // module with no phase, where nothing reads it.
      const dates = phase
        ? phaseDates(phase, read, first, livegangDatum)
        : NO_DATES;
      const phased = phase
        ? withPhase(base, phase, dates, fills, cellReader(read, first), livegangDatum)
        : base;
      const resolve = repair ? withoutEmpty(phased) : phased;
      // A repair names every object's action itself, so it replaces the phase's.
      const action = repair
        ? repairActions(repair, repaired.name)
        : phase && phaseAction(phase)
          ? { root: "update", nested: phaseAction(phase) as string }
          : undefined;
      const linePath = shape?.linePath ?? null;
      // With a counter-line, element 2i is row i's own regel and 2i+1 its counter.
      const counter = linePath ? plan.counterLine : undefined;
      const perRow = counter ? 2 : 1;
      const lines =
        linePath
          ? payloadLines(
              repaired,
              resolve,
              {
                path: linePath,
                count: record.length * perRow,
                // Every regel gets the fills too: a configuration value is the same on
                // every row of the conversion, so it belongs on each element rather
                // than only on the kop's own row.
                resolveAt: (index) => {
                  const rowIndex = record[Math.floor(index / perRow)] ?? first;
                  const rowResolve = withoutUnlisted(
                    withFills(fieldValues(mapping, read, rowIndex, lookups), defaulted),
                    omitted,
                    read,
                    rowIndex,
                  );
                  const rowPhased = phase
                    ? withPhase(
                        rowResolve,
                        phase,
                        dates,
                        fills,
                        cellReader(read, rowIndex),
                        livegangDatum,
                      )
                    : rowResolve;
                  const rowLine =
                    counter && index % perRow === 1
                      ? counterResolver(rowPhased, counter, linePath, cellReader(read, rowIndex))
                      : rowPhased;
                  return repair ? withoutEmpty(rowLine) : rowLine;
                },
              },
              action,
            )
          : payloadLines(repaired, resolve, undefined, action);

      // From the record's **first** row: a grouped record is one kop with its
      // regels, and the kop's columns repeat on every line, so the key is the same
      // on all of them.
      const existingKey =
        keyColumn === -1 ? "" : cellToString(read.rows[first]?.[keyColumn] ?? null).trim();
      payloads.push({
        ordinal: payloads.length + 1,
        variant,
        connector: context.mapping.connector,
        rowNumbers: record.map((index) => read.rowNumbers[index] ?? index + 1),
        // The record's own key when the plan names one: a Voorcalculatie record is an
        // offerte, and its first key column by sheet order is the Projectnummer.
        title: existingKey || recordTitle(mapping, read, first),
        existingKey,
        lines,
        // Read against the **unfiltered** schema, so what the filter can match on
        // does not change with the *Alleen gevuld* switch: the switch decides how
        // much of the body is drawn, never which records exist.
        values: payloadValues(
          mapping,
          context.schema,
          resolve,
          new Set(filled.keys())
        ),
        skipped: phase ? skipReason(phase, read, first, livegangDatum) : null,
        blocked: recordBlocked(mapping, read, record, lookups),
      });
    }
  }

  // Sheet order across variants, not variant by variant: the reader is checking a
  // sheet, and a record's neighbours on screen should be its neighbours in the file.
  payloads.sort((a, b) => (a.rowNumbers[0] ?? 0) - (b.rowNumbers[0] ?? 0));
  payloads.forEach((payload, index) => {
    payload.ordinal = index + 1;
  });

  return {
    payloads,
    unrouted,
    missingColumns,
    fields: Array.from(fieldLabels, ([fieldId, label]) => ({ fieldId, label })),
    objects: mergeRepairObjects(objectLists),
  };
}
