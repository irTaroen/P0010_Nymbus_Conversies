/**
 * Codetabel declarations — the single place to add a reference table.
 *
 * To add one:
 *   1. Register it here with a unique key, and say how the value picker should
 *      show it (`picker` — the columns the user searches and picks from).
 *   2. Add its connector to the backend registry (backend/codetabellen.py).
 *   3. Reference it from a module's rules: { "check": "codetabel", "tableRef": "<key>" }.
 *
 * The endpoint is `/api/projects/<projectId>/codetabellen/<key>` — the project is
 * part of it because a codetabel is **this customer's** table, not a global one.
 * The backend resolves it against the client's own AFAS first and Nymbus's live
 * environment second, and says which one answered.
 *
 * **There are no bundled snapshots.** They used to live here as a fallback and
 * were deleted with this change: a snapshot stops tracking reality the day it is
 * pasted in, and for a table that is inrichting per administratie it is wrong in
 * both directions at once — our betaalvoorwaarden export accepted six codes the
 * first customer connected does not use and rejected two they do. So when no
 * environment answers, a column is left **unchecked** rather than judged against a
 * guess, and the UI says so. See `resolve()` in backend/codetabellen.py.
 */

import { registerCodetabel, type CodetabelPickerColumns } from "./registry";

/** The two columns of an AFAS code table, as the picker shows them. */
const CODE_NAAM_PICKER: CodetabelPickerColumns = {
  columns: [
    { label: "Code", field: "code" },
    { label: "Naam", labelEn: "Name", field: "omschrijving" },
  ],
};

// `ALG_Landen` — ~256 entries. Unscoped: a landcode is valid everywhere.
registerCodetabel("Landen", { picker: CODE_NAAM_PICKER });

// `ALG_Nationaliteiten` — a *vrije tabel*, so inrichting per environment even
// though the codes look universal.
registerCodetabel("Nationaliteiten", { picker: CODE_NAAM_PICKER });

// `ALG_BurgerlijkeStaat` — small, unscoped, and the clearest case yet for reading
// a table instead of writing the codes down: the column carried
// `enum: ["OG", "GH", "GP", "GS", "OV", "WE"]`, and the live table at the second
// customer also holds `SA` (Samenwonend). Every samenwonende medewerker was being
// flagged red against a list that was simply short one code.
registerCodetabel("BurgerlijkeStaat", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Burgerlijke staat", labelEn: "Marital status", field: "omschrijving" },
    ],
  },
});

// `ALG_Betaalvoorwaardes` — set up **per administratie**, so this is the table
// that most needed to come from the customer rather than from a snapshot. The
// default Code + Omschrijving picker matches the AFAS view.
registerCodetabel("Betalingsvoorwaarden");

// `ALG_Woonplaatsen` — the big one (tens of thousands of entries, scoped by land:
// a woonplaats is only valid in the country it belongs to).
registerCodetabel("Woonplaatsen", {
  // The one table whose names are **not** resolved to codes: the place name
  // already *is* the code, and the entry's omschrijving is the land it lies in —
  // so a country with a single woonplaats would turn `Nederland` into that place.
  resolveNames: false,
  // The AFAS table's own two columns. `Woonplaats` is the entry's `code`, so it
  // is the column a pick writes into the cell — the place name, not the land it
  // sits in.
  picker: {
    columns: [
      { label: "Land", labelEn: "Country", field: "scope" },
      { label: "Woonplaats", labelEn: "Town/city", field: "code" },
    ],
  },
});

// `ALG_TypeBank` — AFAS's own land -> type-bank table (NL -> 528000), scoped by the
// country of the bank.
//
// **The only table here that no rule references.** Every other one judges a cell: a
// wrong landcode is an error the user fixes. This one is read by the *payload*
// builder — `KnBankAccount.BkTp` is a mandatory field no sjabloon asks for, because
// nobody types a type-bank; it follows from the country. So it has no `codetabel`
// check, is never a red cell, and its picker is never opened. It is registered here
// all the same, because this file is where a table's existence is declared and a
// second registry for "tables the payload reads" would be one place too many to look.
//
// `numeric: true` for the same reason `Administraties` has it: the codes are integers
// (528000), and a lookup must not care whether one arrives padded.
registerCodetabel("TypeBank", { numeric: true });

// `ALG_CAO` — the CAO's this employer runs, so entirely inrichting: two rows at
// the first customer, and no two customers share a set. This table replaces the
// hardcoded `enum: ["SG", "SPAAR", "KT"]` both HRM modules carried, which rejected
// one of that customer's own two CAO's ("Basis") — the betaalvoorwaarden mistake
// over again.
registerCodetabel("Caos", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "CAO", field: "omschrijving" },
    ],
  },
});

// `ALG_Arbeidsvoorwaarden` — **scoped by CAO**: the connector carries a `CAO`
// column next to the code, because an arbeidsvoorwaarde belongs to exactly one
// CAO. The codes are not unique across CAO's, so a flat check would pass a row
// pairing one CAO with another's voorwaarde; the rule therefore narrows the table
// with `scopeColumn: "Cao"`, the same shape as woonplaats-within-land.
registerCodetabel("Arbeidsvoorwaarden", {
  // The CAO leads, so the picker reads the way the row does: which CAO, then the
  // code within it. A pick writes the `code`, never the CAO.
  picker: {
    columns: [
      { label: "CAO", field: "scope" },
      { label: "Code", field: "code" },
      { label: "Arbeidsvoorwaarden", labelEn: "Terms of employment", field: "omschrijving" },
    ],
  },
});

// `ALG_Administraties` — the financiële administraties (`01`, `02`).
//
// **`numeric`**, and this is the table that flag exists for: AFAS pads the codes
// with a leading zero, while the sheet columns holding an administratie are typed
// `integer` and Excel strips that zero from any numeric cell as a matter of
// course. Without it a correct sheet carrying `1` would have its whole
// administratiekolom flagged red over formatting. See `normalizeCode` in store.ts.
registerCodetabel("Administraties", {
  numeric: true,
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Administratie", labelEn: "Administration", field: "omschrijving" },
    ],
  },
});

// `ALG_Werkgevers` — the werkgevers (`01` Blinck Schoon B.V., `02` Blinck
// Management B.V. at 501372). **`numeric`** for the `Administraties` reason: AFAS
// pads the codes, and a sheet exporting the column as a number writes `1`. A
// non-numeric werkgevercode is left as it is (see `normalizeCode` in store.ts).
// Until now the column was only `required` — and it is the scope `Functies`
// narrows on, so a wrong werkgever also waved every functie through.
registerCodetabel("Werkgevers", {
  numeric: true,
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Werkgever", labelEn: "Employer", field: "omschrijving" },
    ],
  },
});

// `ALG_Functies` — **scoped by werkgever**: a functie is set up per werkgever and
// the connector carries the `Werkgever` code next to it. The first customer has
// only one werkgever, so the scope changes nothing there yet; it is declared
// because it costs nothing (a scope the table doesn't cover passes) and is the
// difference between right and wrong on a project with two.
//
// **`numericScope`**: the scope is a werkgevercode, padded like the `Werkgevers`
// table it comes from, so a row carrying werkgever `1` must narrow to `01`'s
// functies rather than to none — which would pass every functie unchecked.
registerCodetabel("Functies", {
  numericScope: true,
  picker: {
    columns: [
      { label: "Werkgever", labelEn: "Employer", field: "scope" },
      { label: "Functie", labelEn: "Job", field: "code" },
      { label: "Omschrijving", labelEn: "Description", field: "omschrijving" },
    ],
  },
});

// `ALG_Organigram` — the organisatie-eenheden, read out of the organigram (hence
// the connector's name, and its `OE` column where the others say `Naam`).
// Unscoped: one organigram per environment.
registerCodetabel("Organisatie-eenheden", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Organisatie-eenheid", labelEn: "Organisational unit", field: "omschrijving" },
    ],
  },
});

// `ALG_Grootboekrekeningen` — the **verzamelrekeningen**, not the whole grootboek:
// the connector is filtered to them (`1400` Debiteuren, `1600` Crediteuren at the
// first customer), which is exactly what the one column referencing it needs.
// Until now that column accepted any number at all, `default-if-empty` "1400"
// being its only rule.
registerCodetabel("Grootboekrekeningen", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Grootboekrekening", labelEn: "General ledger account", field: "omschrijving" },
    ],
  },
});

// `ALG_Projectgroepen` — the projectgroepenregister the sjabloon points at
// ("gebruik uitsluitend codes die bestaan in het projectgroepenregister"), which
// until now nothing checked. Unscoped: one register per environment.
registerCodetabel("Projectgroepen", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Projectgroep", labelEn: "Project group", field: "omschrijving" },
    ],
  },
});

// `ALG_Dienstbetrekkingen` — **scoped by cao**, the second table of that shape
// after `Arbeidsvoorwaarden`, and here the scope really narrows: at the first
// customer cao `Basis` allows only `O` and `V`, so `D`, `S`, `SV`, `UI` and `Vk`
// are all invalid under it while being perfectly valid under cao `SG`. Note `V`
// (Vaste medewerker) and `Vk` (Vakantiekracht) are distinct codes differing only
// in case — safe, since matching is case-insensitive per code, not per prefix.
registerCodetabel("Dienstbetrekkingen", {
  picker: {
    columns: [
      { label: "CAO", field: "scope" },
      { label: "Code", field: "code" },
      { label: "Dienstbetrekking", labelEn: "Employment relationship", field: "omschrijving" },
    ],
  },
});

// `ALG_Contracttypes` — small and unscoped, replacing a hardcoded `["O", "B"]` on
// the medewerkers column. The first customer carrying it (501372) also has `H`,
// `J`, `AJ`, `7M`, `8M` and `9M` — fixed-length contracts that enum rejected.
registerCodetabel("Contracttypes", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Contract", field: "omschrijving" },
    ],
  },
});

// `ALG_Verlofsoorten` — the verlofsoorten a saldo can be booked on. Codes usually
// carry the year (`W2025` wettelijk, `B2025` bovenwettelijk), so this table goes
// stale per year as well as per customer — which is precisely why it has to come
// from the customer's live AFAS rather than from anything bundled.
//
// **Deliberately unscoped, though AFAS scopes it.** A verlofsoort is tied to a cao
// *and* an arbeidsvoorwaarde there, but `hrm-verlofsaldo` carries neither column —
// it holds Medewerker, Type Verlof, Boekjaar, Datum Boeking and Saldo — and a
// `scopeColumn` can only read a column in the same row. The medewerker's cao lives
// in the *hrm-medewerkers* sheet, which the engine validates independently, so
// there is nothing here to scope by. The flat check still catches what actually
// goes wrong: a stale year code, a misspelling, a code from another customer. The
// cao-aware version waits on employee data being fetched from AFAS itself.
registerCodetabel("Verlofsoorten", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Verlofsoort", labelEn: "Leave type", field: "omschrijving" },
    ],
  },
});

// `ALG_Items` — the artikelen, kostensoorten, werksoorten and layout rows an
// offerteregel can point at, in one table with a `Type` column saying which kind
// each row is.
//
// **Unscoped, deliberately, even though the sheet has a *Type item* column.**
// Measured against the first customer (273 rows): the codes are effectively unique
// across types (269 distinct, and the only one under more than one `Type` is
// `*****`, a layout placeholder), so a scope would narrow nothing a flat check gets
// wrong. More decisively, the two vocabularies don't match — the sheet's enum is
// `Art`/`Kst`/`Sam`/`Wst` while AFAS answers `Artikel`/`Kosten`/`Werksoort`/… — so
// `scopeColumn: "Type item"` would compare `Art` against scope `Artikel`, match
// nothing, and since an uncovered scope *passes*, silently switch the check off for
// every row. That needs a translation layer no table has; until then flat is both
// simpler and stricter.
//
// The type is still carried as the entry's `scope` so the **picker can show it** —
// it is the one thing that tells a user why a code suits their row. With no
// `scopeColumn` on the rule the engine never reads it (`engine.ts` goes straight to
// `codetabelHasCode`), so this is display-only and changes no verdict.
registerCodetabel("Items", {
  picker: {
    columns: [
      { label: "Type", field: "scope" },
      { label: "Code", field: "code" },
      { label: "Item", field: "omschrijving" },
    ],
  },
});

// The abonnementtypes (`SO` Schoonmaakonderhoud, `GB` Glasbewassing, …) — pure
// inrichting, and the column referencing it once carried **no rules at all**.
//
// Served by **either of two connectors**: `ALG_TypeAbonnement` where it exists and
// `ALG_Abonnementtypes` everywhere else. They answer the same codes with the same
// descriptions, so nothing here depends on which one did; the backend prefers the
// newer name and falls back, and the entries arrive identical either way.
//
// Not to be confused with the abonnementen sheet's `Artikel` column, which is
// checked against `Artikelen` below. The two are easy to mix up precisely because
// the code sets overlap — `SO`, `GB`, `VO`, `SR` and `GR` are abonnementtypes here
// *and* artikelcodes there at the second customer — so the column decides which:
// `Type Abonnement` names an abonnementtype, `Artikel` an itemcode.
registerCodetabel("Abonnementtypes", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      // Named for what the column *is* rather than after either connector's field
      // (`Abonnement` on the old one, `TypeAbonnement` on the new): with two
      // connectors behind one table, a label copied from one of them would be
      // wrong half the time.
      { label: "Type abonnement", labelEn: "Subscription type", field: "omschrijving" },
    ],
  },
});

// `ALG_Cycli` — the factureringscycli an abonnement is billed on: `J1` Jaar, `M1`
// Maand, `M3` Kwartaal, `M6` Half jaar, `W4` 4-weken. A *vrije tabel*, so per
// environment — and demonstrably so: the UpdateConnector's own value list for
// `VaIn` reads D7/I/J1/M1/M3/W1, while the live table answers M6 and W4 and
// neither D7 nor I nor W1. That gap is the argument for the table over a written
// list.
//
// The connector is being rolled out to every project (present at 501342, absent at
// 501281 as of 14-09-2026). That needs no handling here and no change when the
// import lands: an unserved table leaves the column unchecked and the help drawer
// says *niet gecontroleerd*, which is the standard path, not a special case.
registerCodetabel("Cycli", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Cyclus", labelEn: "Cycle", field: "omschrijving" },
    ],
  },
});

// `ALG_Periodetabellen` — the HRM-periodetabellen (`5` Maand HRM, `6` 4 weken HRM,
// `18` Jaar Verlof HRM at the first customer that has the connector).
//
// **The one table no rule references.** Every other key here is a `tableRef` on a
// column; this one fills the *Periodetabel HRM* dropdown in the project settings
// dialog, whose value is written onto the project's hoofdproces dossieritem in
// AFAS rather than into a sheet cell. It is declared here so it travels the same
// road as the rest — one registry, one endpoint, one per-project cache — instead of
// a second mechanism for the same kind of data. `codetabelKeysForModule` derives
// its keys from the rules, so nothing fetches this one implicitly: the dialog asks
// for it by name with `fetchCodetabelEntries`, outside the store.
//
// **`numeric`**, and for the same reason as `Administraties`: the connector's
// `Code` is an AFAS `int` (`5`), while the setting is stored and compared as text.
registerCodetabel("Periodetabellen", {
  numeric: true,
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Periodetabel", labelEn: "Period table", field: "omschrijving" },
    ],
  },
});

// `ALG_Items` again, cut to the rows whose `Type` is **`Artikel`** — what the
// abonnementen sheet's `Artikel` column names. A key of its own rather than a
// `scopeColumn` on `Items`, because the narrowing is fixed rather than per row:
// every abonnementsregel is an artikel by construction (the mapping fixes
// `VaIt = 2` and feeds `ItCd` from this column), so there is no column for a scope
// to read. The backend's mapper drops the other types before they ever reach the
// table, so the picker offers artikelen only.
//
// This is the narrowing `Items` above explains it cannot do for *erp-voorcalculatie*
// — there the sheet's own `Art`/`Kst`/`Wst` vocabulary doesn't match AFAS's, and a
// mismatched scope passes everything. Here nothing is read off the sheet at all, so
// that failure mode doesn't arise.
//
// Not merely tidier: at 501342 `VO`, `SP`, `GBL` and `SOL` each exist under both
// `Artikel` and another `Type`, so the flat table would pass a werksoortcode here.
registerCodetabel("Artikelen", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Artikel", labelEn: "Item", field: "omschrijving" },
    ],
  },
});

// `ALG_Automerken` — the merk of a leaseauto (`HrMobility#ViMr`), a code list in
// AFAS: the sheet holds the code (`2`), and a name like `Volkswagen` is offered its
// code by the picker. Unscoped.
registerCodetabel("Automerken", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Merk", labelEn: "Make", field: "omschrijving" },
    ],
  },
});

// `ALG_Automodellen` — the model of a leaseauto (`HrMobility#ViMd`). Body types
// (Hatchback … SUV) rather than models of a merk, so unscoped.
registerCodetabel("Automodellen", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Model", field: "omschrijving" },
    ],
  },
});

// `ALG_Leasemaatschappijen` — the leasemaatschappij of a leaseauto, an instantie in
// AFAS: the sheet holds its code (`1000111`), and a name like `Athlon` is offered
// its code by the picker. Unscoped.
registerCodetabel("Leasemaatschappijen", {
  picker: {
    columns: [
      { label: "Code", field: "code" },
      { label: "Leasemaatschappij", labelEn: "Lease company", field: "omschrijving" },
    ],
  },
});
