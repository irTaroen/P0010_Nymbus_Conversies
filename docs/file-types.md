# File types (modules) & validation

> **Local version.** Where this doc mentions the sidebar percentage coming from a deeltaak
> dossieritem in AFAS: here every validation run stamps it locally
> (`project_modules.json`), and a send from the payload tab stamps it too.

> Detail for [CLAUDE.md](../CLAUDE.md). How the tool recognizes each Excel file and the rules it checks. This is the heart of the tool — keep it current as rule sets are agreed with the business.

A **module** is one AFAS import target (Medewerkers, Debiteuren, …). "File type" and "module" are the same concept; the code calls it a module because the sidebar groups them (HRM / ERP).

## Supported modules

The catalog is the **single source of truth** for what a module *is*: `MODULE_CATALOG` in [`lib/modules.tsx`](../frontend/src/lib/modules.tsx), a flat list where each module has an `id`, its `afasModuleId`, a `label`, filename `patterns` for recognition, and a `templateUrl`.

Fifteen, in sidebar order, with the **deeltaakcode** each one is tied to AFAS by:

- **HRM:** `hrm-medewerkers` (MW), `hrm-uitzendkrachten` (UZ), `hrm-verlofsaldo` (VP), `hrm-salarisparameters` (SA), `hrm-wagenpark` (WA), `hrm-vakantietoeslag` (GV)
- **ERP:** `erp-debiteuren` (DB), `erp-crediteuren` (CR), `erp-artikelen` (AR), `erp-projecten` (PR), `erp-voorcalculatie` (VC), `erp-abonnementen` (AB), `erp-openstaandposten` (OP), `erp-vasteActiva` (OP), `erp-contactpersonen` (CO)

`afasModuleId` in the catalog holds that code, and **it is not always unique**: AFAS's `OP` (Openstaande posten en activa) still covers two app modules — each keeps its own template, rule set and help, and both show that one deeltaak's status. `VP` (Verlofsaldi en parameters) used to cover `hrm-verlofsaldo` and `hrm-salarisparameters` the same way, and `hrm-vakantietoeslag`/`erp-contactpersonen`/`erp-artikelen` had no code at all — until 26-08-2026: `Nymbus_Deeltaaktypes` gained dedicated `SA`, `GV`, `CO` and `AR` codes, all four confirmed live and mapped in above. Which category a module belongs to is *not* set here either; the backend says so (below). Some AFAS deeltaken still have no app module at all — see [todo.md](todo.md) item 34.

All fifteen have a rule set and a help article; `npm run help:check` is the gate that keeps those two in step. `erp-artikelen` (ERP_4, AFAS connector `FbItemArticle` — confirmed live, root key `FbItemArticle`, mandatory `Grp`/`BiUn`) is the newest; its field mapping is `backend/json_files/mappings/modules/erp-artikelen.json`.

**One template file per module — always, even when AFAS doesn't see two.** `templateUrl` in the catalog names one `.xlsx` under `frontend/public/templates/`, and no template holds more than one module's columns. This wasn't always true: `ERP 6_Openstaande posten en Vaste Activa.xlsx` held both `erp-openstaandposten` and `erp-vasteActiva`, and `HRM 5_Verlofsaldo, salarisparameters en vakantietoeslag.xlsx` held `hrm-verlofsaldo`, `hrm-salarisparameters` *and* `hrm-vakantietoeslag` — one sheet per module inside a shared file, which is exactly the "each keeps its own template" split above but at sheet rather than file granularity. Both were split apart (2026-08-13) so each module got its own file. **Exact numbering has moved since and will keep moving** as templates are added, removed or reordered (e.g. `HRM 4_Kinderen.xlsx` was dropped shortly after the split, shifting Verlofsaldo/Vakantietoeslag/Salarisparameter down a number each) — `MODULE_CATALOG`'s `templateUrl` is the only place that has to stay in lockstep with `frontend/public/templates/`, checked against the real filenames there rather than assumed. `OP` sharing one **deeltaak** in AFAS is unrelated to any of this — that's a fact about AFAS's own task granularity, not about how many Excel files or what they're numbered — so its two catalog entries still carry the same `afasModuleId` and still show one workflow status each; they just no longer share a workbook. (`VP` did too, until Salarisparameters got its own `SA` code — the template split above still happened first, since it's about file layout, not the deeltaak.)

A template can still legitimately have more than one **sheet** for reasons that have nothing to do with this: `HRM 1_Medewerkers.xlsx` carries "Appreo Medewerkers" and "Kantoor Medewerkers", two populations with identical columns rather than two modules, so `SheetPicker` (step 3 below) still applies to it. The rule that changed is narrower than "one sheet" — it's "one module never spans two files".

### Where the data starts

There is no setting for it. [`parseExcelFile()`](../frontend/src/lib/excel.ts) takes the first non-blank row as the headers and starts the data at the next non-blank row, **unless that row is a template's explanation row**, which it skips. Most templates carry a line of explanation under the headers (*O voor Organisatie, P voor persoon*), Wagenpark an example record, and Medewerkers nothing at all. A client fills the template in, so that row comes back unless they deleted it. A fixed "skip row 2" setting was wrong for every template without one, and for every client who deleted it: their first record was dropped.

Nothing about the row itself (no style SheetJS can read, no position) tells it apart from a record, so it is recognised **by its text**. [`scripts/sync-template-explanations.mts`](../frontend/scripts/sync-template-explanations.mts) reads row 2 of each template's first sheet into [`lib/template-explanations.json`](../frontend/src/lib/template-explanations.json). A row counts as an explanation row when **one** filled cell holds an explanation *sentence* (three words or more, such as *Het bestaande crediteurnummer*) under its header, or when **every** filled cell holds exactly the text a template has under that header. Texts are compared ignoring case, whitespace, line breaks and punctuation, and headers are matched through `lib/headers.ts`. The sentence rule exists for clients filling in an older copy of a template: its explanation row was reworded in places and had columns ours no longer has, so the every-cell rule missed it and the row was read as a record (Crediteuren, 03-11-2026). Short texts (*J/N*, *Hulptabel*, Wagenpark's example values such as `01`) could be a real value, so a row of only those still has to match in full. An explanation row that is missed stays in as a row of errors the client can see and delete. The other way round, a real record would be dropped without anyone noticing, which is also why the parser doesn't simply always skip row 2.

**English templates.** Every template has an English copy in `public/templates/en/`, which the download button serves when the app is in English (`templateUrlEn` in the catalog). It is **generated**, not edited by hand: [`scripts/translate-templates.mts`](../frontend/scripts/translate-templates.mts) copies each Dutch template and translates its explanation row (row 2 of each data sheet), its lookup sheets and its sheet names from the dictionary in `scripts/template-translations.en.json`. The **column headers stay Dutch** — they are the names the uploader matches columns on — and so do the example records below row 2, which must remain valid input. The explanation sync reads the English copies too, so a client filling in either is recognised.

**Changed or added a template? Run `npm run templates:translate`, then `npm run templates:sync`** from `frontend/` and commit the English copy and the JSON. `templates:translate:check` reports any text the dictionary has no translation for (add it, mapping a code or a name to itself); `npm run templates:check` is the read-only gate for the explanation JSON.

> Add a new module to `MODULE_CATALOG` (id + deeltaakcode + label + patterns), add the same entry to [`backend/json_files/modules.json`](../backend/json_files/modules.json) for its category and order, then wire up a rule set and a help file. Recognition and the picker derive from the catalog — there is no third place to edit. A deeltaakcode the catalog doesn't know is skipped, so a module never renders without rules and help behind it.

## Which modules a project has

Not every project imports every module, so the catalog is filtered per project. `GET /api/projects/{projectId}/modules` answers with the categories (HRM / ERP) and the app module ids in each, each carrying the workflow status AFAS holds for it:

```jsonc
{ "groups": [ { "id": "hrm", "label": "HRM", "modules": [
  { "id": "hrm-medewerkers", "name": "Medewerkers", "deeltaakcode": "MW", "statusCode": "KL", "status": "Klant", "task": "Template vullen", "actions": [{ "number": 1, "label": "Data versturen naar Nymbus", "submit": true }], "adminOnly": false }
] } ] }
```

**Which modules a project has is AFAS's answer, not ours:** a module *is* a deeltaak — one `Nymbus_Dossieritems_Deeltaak` row — so the project's dossieritems decide, and the same row says how far it is. [`modules.json`](../backend/json_files/modules.json) supplies only what AFAS doesn't: the category, the display order, and which app module a deeltaakcode maps to. Categories with nothing in them are dropped, and a project with no deeltaken gets `{ "groups": [] }`. Full field list in [architecture.md](architecture.md#api-surface).

On the frontend, `fetchProjectModules()` resolves those ids against the catalog into `ModuleGroup[]` (label + `lucide` icon + catalog entries) and [`ModuleProvider`](../frontend/src/components/ModuleProvider.tsx) fetches them for the active project — so switching projects reloads the sidebar, and a URL naming a module the new project doesn't have resolves to nothing (the page says so). `useModule()` exposes `groups`, the flat `modules`, the fetch `status`, and the two readings of the URL's module: `routeModuleId` (what the address bar says) and `selectedModuleId` (that id once it's known to be one of this project's).

## The active module

The active module is **the URL's**: `/{project}/{module}`, with the catalog id as the segment (`/501282/hrm-medewerkers`). `ModuleProvider` reads it with `useParams()` and holds no selection of its own — see [architecture.md](architecture.md#routing). It selects the validation rule set and the AFAS field mapping ([afas-integration.md](afas-integration.md)).

So there are two pages, not one page with a module sometimes set. `/{project}` is the project: the generic "pick a conversieonderdeel" paragraph beside the hero, over the projectrapport, and no dropzone at all. `/{project}/{module}` is the module: that same hero carrying the module's own description (`ModuleIntroCopy`), then [`ModuleStartCard`](../frontend/src/components/uploader/ModuleStartCard.tsx) — the module's name, its status in AFAS, its last check, a **"Hoe vul ik dit in?"** button that opens the module help drawer (see [Module help](#module-help)) and a **"Sjabloon downloaden"** button that downloads the module's template (`templateUrl` in the catalog, served from `frontend/public/templates/`, saved as `<projectnummer>_<sjabloonnaam>.xlsx`) — over the dropzone. No toolbar between them: that bar comes with the sheet it describes. See [design-system.md](design-system.md#25-core-ui-elements).

## Recognition (on upload)

`recognizeModule(fileName, modules)` in [`lib/modules.tsx`](../frontend/src/lib/modules.tsx) does a case-insensitive substring match of the filename against each module's `patterns`. It only ever chooses between the modules it's given — the project's own set from `useModule()` — so a file is never matched to a module the project can't import. It returns:

- **recognized** — exactly one match
- **ambiguous** — several matched (tagged "voorgesteld" in the picker)
- **unknown** — none matched

On drop, [`useFileIntake`](../frontend/src/components/uploader/useFileIntake.tsx) resolves through up to four modals, each shown only when needed, in order:

1. **Confirm project** — when the filename carries another project's number.
2. **Pick module** — when ambiguous/unknown.
3. **Confirm switch** — when the resolved module isn't the page's own.
4. **Pick sheet** — when the workbook has multiple sheets.

A recognized file matching the page's module skips straight to the data. One that belongs to another module **travels to that module's page** — the parse rides along in [`lib/pending-upload.ts`](../frontend/src/lib/pending-upload.ts) and the target claims it on mount, so the file is read once and the URL never describes a table validated by other rules. That is also what a file dropped on the *project* page does: with no module of its own, every file it takes in is handed onward, so step 3 never arises there and step 2's answer decides where it lands.

### Step 1: the project number in the name

Every file this tool hands out is named `<projectnummer>_…` — the template, the annotated sheet, the validatierapport (`downloadName()` / `projectFileName()` in [`lib/download.ts`](../frontend/src/lib/download.ts), see [design-system.md](design-system.md#25-core-ui-elements)). So `projectNumberIn(fileName)` reads back which conversion a file came from, and a number that isn't the open project's is worth a word before the sheet is read: what it buys is the case that costs an afternoon — last project's Medewerkers validated against this project's codetabellen and configuration, producing a screen of errors that mean nothing.

It comes **first** because it is the only question that can make the others pointless: a file from another conversion shouldn't be routed onward to a module page, it should be stopped. It fires only for a name the tool wrote itself, so the ordinary first upload — the client's own export, which has no number — passes straight through, exactly as it did before any of this existed.

Unlike step 3 it **does not offer to move the file**, and that asymmetry is deliberate. A module is a page in this project, so a misfiled sheet has somewhere to go; a project is a different conversion with its own rules, its own configuration and its own AFAS environment, and the number may be stale — a sheet copied from last year's project and refilled — exactly as easily as the page may be wrong. The tool has no standing to pick between those, so it asks: *Annuleren* or *Toch inlezen*. Reading it anyway is a real answer, not a warning overridden: the sheet is validated against the project on screen, and the old number does not follow it — the next download is renamed for **this** project.

> Don't confuse step 3 with its mirror image. **Confirm switch** is about a *file* that belongs
> elsewhere, with the data not yet on screen — and it navigates. The **user** following a link while a
> sheet *is* on screen is a different question with its own prompt — `LeaveModulePrompt`, see
> [design-system.md](design-system.md#25-core-ui-elements) — because leaving closes the table, so the only way on is
> with the sheet and its validatierapport downloaded first. A file drop deliberately goes *past* that
> prompt: handing over a file is already a decision to replace what's on screen, and the
> unsaved-changes prompt asked about edits first.

## Validation model

Each module has a **rule set**: checks applied per column (plus cross-field row checks), producing issues. **Every issue is an error** (red, blocks upload) — there is no severity field on a rule. A second severity (`warning`: amber, surfaced but allowed) existed until two of the fourteen rule sets were the only ones using it, on one check; it cost every renderer a colour branch to report something nobody acted on. If a rule isn't worth blocking an upload for, leave it out of the rule set rather than downgrading it.

`default-if-empty` (below) is not that severity come back: a cell it covers carries no issue at all, blocking or otherwise — it just isn't user-entered yet. The table still tints it, amber rather than red, but that is a distinct signal ("this will become X unless you fill it in") from a downgraded error, and `ValidationResult.defaults` is a map of its own rather than a field on `Issue`.

The engine is generic and lives in [`lib/validation/`](../frontend/src/lib/validation/); per-module rules are **data**, so business rules change without touching engine code:

- [`types.ts`](../frontend/src/lib/validation/types.ts) — config + result types.
- [`checks.ts`](../frontend/src/lib/validation/checks.ts) — pure value checks: `required`, `email`, `iban` (mod-97), `bsn` (11-proef), `btw` (EU-landcode + het formaat van dat land, zoals VIES het kent — AFAS weigert een btw-nummer zonder EU-landcode; Griekenland is `EL`, niet `GR`), `postcode` (the format of the land in its `scopeColumn` — NL, B, D, PL and E (Spain) are known — applied only to the landcodes in the rule's `values`, `NL` alone by default; an empty land counts as `scopeDefault`, e.g. `"NL"` in `erp-projecten`, `erp-contactpersonen`. Medewerkers checks all five, the other modules only NL), `phone`, `enum`, `min`/`max`, `length`, `regex`, plus a per-column `type` check (`integer`/`decimal`/`date`/`boolean`). A `date` is validated against its `format` **and against the calendar** — `toDate()` builds the date from the parsed parts and reads them back, so `31-02-2026` and `29-02-2025` fail where a pattern match alone would pass them; it is also what lets a cross-field rule compare two dates chronologically. `notice` isn't a check: a cell whose value is in its `values` gets its `message` as a **non-blocking** remark (`ValidationResult.notices`, amber in the table, not counted as an error) — for a value that is accepted but sent differently, like *Type rooster* 2 → 1. `default-if-empty` (below) never runs here at all — it is handled entirely in the engine, since it is not a value check. The `codetabel` check (value must match a code in an AFAS codetabel, optionally narrowed to the country in another column) is handled in the engine too, not here — see [afas-integration.md](afas-integration.md#codetabellen-codetabel-checks). So is `existing-record` (Debiteuren and Crediteuren): a row's name compared against the records the customer's AFAS already holds — in **test** until the test import is approved, in **live** from then on, decided by the module's workflow task — a name held only under another key, or the row's key held under another name, is a blocking error. See [existing-records.md](existing-records.md#9-in-the-sheets-validation--existing-record). And so is `matches-count`, the one check that counts across a row: the cell must equal how many of its `columns` hold a number above 0, and a row where none does is left alone — Medewerkers' *Aantal dagen per week* against *Uren Maandag* t/m *Zondag*, since AFAS ticks a werkdag for every day with hours and refuses the rooster when the two disagree. And `same-in-group`, the one check that compares rows with each other: every row sharing a value in its `groupColumn` must hold the same value in this column (dates compared as dates, a blank as a value of its own), and every row of a group that disagrees is flagged — Voorcalculatie's *Projectnummer*, *Begindatum Offerte* and *Einddatum Offerte* within one *Offerte*, and Abonnementen's *Projectnummer*, *Type Abonnement*, *Begindatum*/*Einddatum Abonnement*, *Betaalvoorwaarde* and *Cyclus Facturering* within one *Abonnement nummer* — since the payload builds the record's kop from its group's first row and would silently drop what the others say.
- [`engine.ts`](../frontend/src/lib/validation/engine.ts) — `validateSheet(moduleId, headers, cellData)` returns a `ValidationResult`: issues keyed by `"row:col"` (same scheme as the table's dirty marks), `errorCount`, and `missingColumns`. `unique` is computed across the whole column; cross-field rules evaluate `IF … THEN …` per row and flag the offending cell.

> Cells are strings (the table holds editable text), so numeric/date checks parse. Columns are matched by header text, **case-insensitively** and ignoring surrounding or repeated whitespace (`lib/headers.ts` — a rule may also list synonyms via an array). Punctuation is significant: `Org. eenheid` matches `Org. Eenheid` but not `Org eenheid`. A client renames a column by calling it something else, not by capitalising it, and an exact match read `Org. Eenheid` as a column we haven't got — skipping every check on it. A declared column absent from the file is reported in `missingColumns` and shown in a banner of its own — never as an issue, and it never blocks upload: there is no cell to flag. The only columns not reported are those the tool fills itself (*Columns the tool fills itself*, below).

## Rule sets

One JSON file per module under [`lib/validation/rules/`](../frontend/src/lib/validation/rules/) — **the filename is the module `id`** (e.g. `hrm-medewerkers.json`). [`rules/index.ts`](../frontend/src/lib/validation/rules/index.ts) aggregates them into `RULE_SETS`, keyed by `id`. Each file is `{ "columns": [...], "crossField": [...] }`; an empty rule set (`[]`/`[]`) means "no checks" — no module relies on that any more, so a sheet that reports "Geen fouten" was really checked. A column entry:

```jsonc
{
  "column": "Medewerker",          // header, case-insensitive (array = accepted synonyms)
  "type": "text",                   // text | integer | decimal | date | boolean
  "format": "DD-MM-YYYY | DD/MM/YYYY",  // dates only; "A | B" allows several
  "rules": [
    { "check": "required" },
    { "check": "unique" },
    { "check": "length", "max": 15, "message": "…" }  // "message" overrides the default NL text
  ]
}
```

A cross-field entry (`if`/`then` ops: `==` `!=` `<` `<=` `>` `>=` `isEmpty` `isNotEmpty`; `then.value` may be `{ "column": "…" }` to compare two fields; `flag` picks the cell to highlight, defaulting to the `then` column; either side may instead be `{ "allOf": [...] }` — every condition must hold — or `{ "anyOf": [...] }` — one is enough, e.g. "at least one day column > 0"; name `flag` explicitly with those):

```jsonc
{
  "if":   { "column": "Parttime worker", "op": "==", "value": "Yes" },
  "then": { "column": "Total Roster hours", "op": "<", "value": 40 },
  "flag": "Total Roster hours",
  "message": "Parttimers mogen niet meer dan 40 uur roosteren"
}
```

**Every `date` column carries `"DD-MM-YYYY | DD/MM/YYYY"`** — the two notations customer sheets arrive in, hyphens or slashes, day-month-year with a four-digit year. It is the same format string in all 27 date columns of all 14 modules; keep new ones on it, so a date that validates in one module validates in the next. A year-first or two-digit-year cell (`2026-01-01`, `1-1-26`) is an error by design: the tool never guesses which number is the day.

A comparison picks its ordering from the column's declared `type`: two `date` columns are compared **as dates** (`"Einddatum Regel" >= { "column": "Begindatum Regel" }` — comparing the strings would rank `28-01-2026` above `01-02-2026`), anything else numerically when both sides parse and as text otherwise. A date comparison where either side isn't a readable date is *indeterminate*: the rule is skipped for that row rather than flagged, because the column's own `date` check already reports the malformed value. This is what lets a rule set express "de regeldatum mag niet voor de begindatum van de kop liggen" without a second error on top of an unreadable date.

To check a column against a codetabel from AFAS, use `{ "check": "codetabel", "tableRef": "<key>" }` — the table is fetched from **this project's own live AFAS** at runtime, per module. Adding `"scopeColumn"` (+ optional `"scopeDefault"`) narrows it to the entries belonging to that column's value in the same row, which is how Woonplaats/Geboorteplaats are checked *within* their country. Adding `"allowUnlisted": true` makes a value the list doesn't hold **unlisted** rather than wrong (`ValidationResult.unlisted`): amber in the table, not counted as an error, still with the value picker. Medewerkers and Uitzendkrachten use it on Woonplaats and Geboorteplaats, because an unknown place is one to *add* to AFAS: an admin's *Plaatsen toevoegen* in the Instellingen modal writes every unlisted place whose land is valid to the `afas_plaatsen` table in Postgres ([`afas_plaatsen.py`](../backend/afas_plaatsen.py)), and *AFAS plaatsen downloaden* hands that table out as `Data_Woonplaatsen.csv` for the import into AFAS. Adding `"omitUnlisted": true` as well leaves such a value **out of the payload**: the field is omitted from that record's body (`withoutUnlisted()` in [`module-payloads.ts`](../frontend/src/lib/module-payloads.ts), the same verdict and scope that turned the cell amber) and the rest of the record is sent. A column and its `scopeColumn` go **together**: when either is unlisted, both are left out. Medewerkers and Uitzendkrachten use it on Geboorteland and Geboorteplaats, so AFAS gets the land and the place, or neither, and an unknown one never holds an employee back. Landcodes and nationalities are codetabel-checked too, so don't add an ISO-2 regex next to them: AFAS uses its own codes (`B`, `D`, `AFG`). See [afas-integration.md](afas-integration.md#codetabellen-codetabel-checks).

**A name where the code belongs is fixed, not flagged.** The `codetabel` check repairs what it can: a cell holding an entry's *omschrijving* instead of its code (`Nederland` for `NL`, `30 dagen` for `30`, `Gehuwd` for `GH`) is rewritten to that code before validation runs. Checking and repairing are one function — `codetabelVerdict` in [`engine.ts`](../frontend/src/lib/validation/engine.ts) answers both "is this valid?" and "which code is meant?" — so there is nothing to switch on per rule: every `codetabel` column in every module gets it. Only an exact name match (case, accents and whitespace ignored), only when one entry carries the name, and on a scoped rule only within the row's scope (`Oproepkracht` resolves among cao Basis's dienstbetrekkingen, not SG's); unscoped columns are fixed first, so a cao written as its name is resolved before the arbeidsvoorwaarde that reads it. Every validation run applies it — the file, a restored draft, *Hercontroleren*, the codetabellen arriving. A fixed cell counts as an edit (export and payload carry the code), carries an amber notice naming the original, and is listed in the validatierapport PDF — a banner up front with the count, and an *Automatisch aangepast* section per column (`"Nederland" -> NL`, with its Excel rows) after the errors. All of it is derived from the file rather than stored (`ValidationResult.autofixed`, grouped by `buildValidationReport`). The one table opted out is a property of the table, not a rule: `resolveNames: false` on the woonplaatsen in [`sources.ts`](../frontend/src/lib/validation/codetabellen/sources.ts), whose omschrijving is the land rather than the place. See [`lib/validation/autofix.ts`](../frontend/src/lib/validation/autofix.ts).

**An `enum` may list aliases, fixed the same way.** `{ "check": "enum", "values": ["0", "1"], "aliases": { "0": ["N", "Nee"], "1": ["J", "Ja"] } }` rewrites a cell holding an alias (case-insensitively) to the value it is keyed under, in the same autofix pass — same edit, amber notice and report line. For a code the client writes in words; Medewerkers' *Gedrag periodiek toekennen code* uses it for J/N and ja/nee.

**A `clear` rule empties values that mean nothing.** `{ "check": "clear", "values": ["0"] }` empties a cell holding one of `values` — case-insensitively, and numerically for numbers, so `0,00` too — in the same autofix pass, with the notice reading *"0" is leeggemaakt* and the report *"0" → leeg*. Medewerkers' *Min. uren/wk* and *Max. uren/wk* use it: a 0 there is a client's way of leaving it blank.

**A `split-huisnummer` rule splits a huisnummer written with its toevoeging.** `{ "check": "split-huisnummer", "intoColumn": "Toev. aan huisnr." }` on the huisnummer column turns `17-19` into `17`, and writes the rest, `-19`, into `intoColumn` (`12 A` → `12` + `A`). It's the same autofix pass, and both cells get a notice. The report lists the toevoeging as *"17-19" → -19*: its `from` is the huisnummer it was split off. A toevoeging the client already filled in is kept, with the rest put in front of it: `250-` beside `252` becomes `250` and `-252`. Two words get a space between them (`12 a` + `bis` → `a bis`), and a lone separator with nothing behind it is dropped (`250-` beside an empty toevoeging → `250`). The rule leaves the cell alone, and the integer check flags it, when the value doesn't start with a number (`Postbus 3`) or when the sheet has no toevoeging column. Every address with a toevoeging column carries it: Debiteuren, Crediteuren, Projecten (*Nummer Adres*), Medewerkers and Uitzendkrachten. Contactpersonen has no toevoeging column, so it doesn't.

**Postcodes get their whitespace straightened, with nothing to declare.** Every column with a `postcode` rule is trimmed and has each run of whitespace collapsed to one space (`1815  DG` → `1815 DG`), in the same autofix pass, whatever its land. A cell that only lost leading or trailing spaces is rewritten without a notice, because the check already ignores those spaces.

**Dates lose their time, with nothing to declare.** Every `date` column whose `format` asks for a whole day (day, month and four-digit year in every alternative, no `HH`/`mm`/`ss` — today that is all of them) gets a cell in another date shape rewritten to `DD-MM-YYYY` in the same autofix pass: a datetime (`15-01-2017 22:59:59`, which is what a cell Excel holds with a time reads as), the ISO order (`2017-01-15`, `2017-01-15T22:59:59Z`) and single digits (`5-1-2017`). The time is **dropped, not rounded**, so the day as written is the day sent. A value the format already accepts (`15/01/2017`) is left alone, and so is anything that isn't a real calendar day (`31-02-2017 10:00`), which the date check then flags. Each rewrite gets a notice and a report line.

There used to be a second fallback, `required-or-default`, which let a column go missing from the sheet without a word. It was retired (Taroen, 13-10-2026) so a rule set states plainly which columns a sheet must carry: every defaulted column now uses `default-if-empty`, below, and an absent one is reported like any other.

`{ "check": "default-if-empty", "defaultValue": "…" }` is the opposite case: a column the sheet *does* carry, where a blank cell is fine because the value it should get is known and the same for every row left empty — `hrm-wagenpark`'s `Kilometers per jaar`, defaulting to `"0"`, is the first (Taroen, 25-08-2026). An empty cell under this check is never an error and never reported as missing: the engine notes the value it stands in for in `ValidationResult.defaults`, keyed the same way as `byCell`, and the table shows it as a placeholder with an amber tint rather than leaving the cell looking untouched or flagging it red. The payload sends the same value for that blank cell (`ruleDefaultsByKey()` in [`lib/module-payloads.ts`](../frontend/src/lib/module-payloads.ts), since 13-10-2026), so the amber cell and the body agree. The downloaded Excel (and the file *Aanleveren bij Nymbus* sends) writes it into the cell too, tinted amber, so the file holds what goes to AFAS and shows which values the tool filled in (`withDefaults()` in [`lib/excel.ts`](../frontend/src/lib/excel.ts)). It answers for a blank cell only: a column the sheet hasn't got is still reported missing, unless the conversion fills it under *Columns the tool fills itself* below — as a **facilitaire** conversie does for `hrm-uitzendkrachten`'s *Dagen per week* / *Uren per week* and `hrm-medewerkers`'s *Kostendrager* / *Kostenplaats*.

### Addresses

Every module with an address checks it the same way (Taroen, 13-10-2026): **Straat, Huisnummer, Postcode, Plaats and Land** are required together, **Toevoeging** is optional. Huisnummer is an `integer` (AFAS's `HmNr` is an `int`; the toevoeging has its own column), Land is checked against `Landen`, the Postcode gets the Dutch format check only where Land is `NL` (`postcode` with `scopeColumn`; Medewerkers also checks B, D, PL and E via the rule's `values`), and Plaats is checked against `Woonplaatsen` scoped to that land.

Where an address is **mandatory** — Debiteuren, Crediteuren, Medewerkers, Uitzendkrachten, Contactpersonen — the five are simply `required`. Where it is **optional** — Projecten — they are all-or-nothing: any one of the six address cells filled makes the five required, written as one `crossField` per required column with an `anyOf` over the other cells (see `erp-projecten.json`). Contactpersonen has no Plaats column: AFAS looks the woonplaats up from the postcode (`ResZip`).

### Columns the tool fills itself

A **facilitaire conversie** doesn't ask the client for five of `hrm-medewerkers`'s columns, because they aren't client data: they are settings of the conversion, identical on every row, and Nymbus already holds them. [`lib/standard-columns.ts`](../frontend/src/lib/standard-columns.ts) is the one table that says so (Taroen, 09-09-2026):

| Column | AFAS field | Value |
|---|---|---|
| Periodetabel HRM | `AfasSalary#PtId` | the hoofdproces dossieritem's `HRM-periodetabel` |
| Herhalen na | `AfasPeriodiek#PeRp` | **13** for periodetabel 4, **12** for 5 |
| Jaar volgende periodiek | `AfasPeriodiek#YrPe` | the year **after** `Datum_livegang`'s (livegang 2027 → 2028) |
| Kostendrager | `AfasOrgunitFunction#CcId` | `Profit` |
| Kostenplaats | `AfasOrgunitFunction#CrId` | `Profit` |

And one on `hrm-uitzendkrachten`, in **every** conversion type: *Periodetabel HRM* → `AfasSalary#PtId`. That sjabloon has no such column, yet every uitzendkracht is written with a salary record (below), and `PtId` is mandatory on it — so the mapping points `PtId` at the header and the fill is the only thing that ever supplies it. A project without a periodetabel on its dossieritem gets the missing-column banner and the settings notice, not a body AFAS refuses.

**Uitzendkrachten are one call, and almost entirely fixed values** (Taroen, 23-09-2026). Unlike `hrm-medewerkers` they have no *Actueel* (livegang) step, so `module-phases.ts` has no entry for them and the payload panel shows no *Stap* toggle: one POST per uitzendkracht, with every dated record starting on *Datum in dienst*. What the rest of the body carries is in the stored mapping itself (`backend/json_files/mappings/modules/hrm-uitzendkrachten.json`), where an admin can see it in the editor:

| AFAS field | Value |
|---|---|
| `AfasContract#ApCo` Type contract | **O** (onbepaalde tijd) — and so `ViKe` Ketennummer **0**, which AFAS demands with it |
| `AfasContract#ViEt` Dienstbetrekking | **UI** (Uitzendkracht) |
| `AfasContract#EmMt` Soort medewerker | **2** (Uitzendkracht) |
| `AfasContract#DaBe`, `AfasOrgunitFunction#DaBe`, `AfasTimeTable#DaBg`, `AfasSalary#DaBe` | the sheet's *Datum in dienst* |
| `AfasTimeTable#EtTy` Type rooster | **5** (Uren per week) |
| `AfasTimeTable#DyWk` / `#HrWk` | **5** dagen / **38** uur |
| `AfasTimeTable#PcPt` Parttime (%) | **100** — 38 uur is voltijd for an uitzendkracht |
| `AfasSalary#SaPe` / `#EmSa` / `#SaYe` | **V** at **0** — the agency pays them, but AFAS still wants a salary record |
| `KnPerson#SpNm` / `#NmBi` / `#IsBi` | **true**, from *Achternaam* / *Voorvoegsel* — AFAS requires a geboortenaam on anyone linked to a medewerker, and this sjabloon has no separate one |

So the sheet's *Type Contract*, *Begindatum contract*, *Dagen per week* and *Uren per week* columns are no longer read. The *Dagen per week* / *Uren per week* fills (5 and 38, read off the `default-if-empty` rules) are still in the fill table, which keeps an absent column from raising the missing-column banner, but no mapping field points at them any more.

This is the **configuration** source of [afas-integration.md](afas-integration.md#where-a-value-comes-from), built for the one module and conversion type that need it rather than as the general `FieldSource` variant [todo.md](todo.md) items 5 and 6 describe — the stored mappings are untouched and still map all five from their columns, which is right for a standard conversion. Three things follow from one table, and all three have to hold:

- **Validation** doesn't demand the column and doesn't report it missing (`validateSheet`'s `fills` argument). A blank cell lands in `ValidationResult.defaults` carrying the value the app will send, so the table shows it amber with the value rather than red or untouched — including for the three columns the rule set doesn't declare at all, which the engine handles in a pass of its own.
- **The payload** carries the value whether the sheet has the column blank or hasn't got it (`buildModulePayloads`' `fills`), with the provenance in the line's note (*periodetabel uit dossieritem*) rather than a column header nobody can go and look at. A fill goes through `afasValue()`, the same converter a sheet cell does, so a filled cell and a fill of the same value produce the identical body — `DyWk` is an `int`, and `"5"` where a cell sends `5` would differ in AFAS's eyes for no visible reason.
- **The notices stop naming them** — the payload panel's *gekoppelde kolommen staan niet in dit bestand* banner and the help drawer's *verplicht* badge both did, and a template that deliberately dropped five columns raising a five-column alarm is exactly the false alarm that teaches people to ignore the banner. The drawer says *vult de tool* and the value instead.

**A filled cell wins.** The app fills a blank cell or an absent column; a value the client typed is used and still checked. So a facilitaire sheet behaves the same whether its template still carries the columns or has dropped them.

**No configuration means no fill.** An ERP-only project has no periodetabel and AFAS may have no livegangdatum yet. Such a column reverts to an ordinary sheet column — rules apply, absence is reported — rather than being promised and then left empty, which is the one outcome nobody can catch. Inventing a plausible value would be worse: a wrong periodetabel lands silently in AFAS.

Rule sets are confirmed with the business before being relied on — they are written from the field-level sjabloon description of each module, and the judgment calls that description leaves open (a maximum that might be a fixed width, an amount that might legitimately be negative) belong to the business, not to whoever writes the JSON. Record the ones still open in [todo.md](todo.md) rather than leaving them implicit in a rule.

To add a module, drop a `<id>.json` file and register it in `rules/index.ts`. **The rules run in the browser only** — the backend cannot read them (JSON + a TypeScript engine, no Python twin), so it accepts an upload on the client's word; see [todo.md](todo.md) item 10.

Two things the rule format cannot express today, each with a workaround in use:

- **A composite unique key.** `unique` is per column, so *Regelnummer* unique *within* an abonnement, or *Boekstuknummer* unique *per administratie*, can't be stated. `erp-abonnementen` therefore carries no uniqueness check on its line numbers, `erp-openstaandposten` carries a plain one and accepts the false positive. (`erp-voorcalculatie` has no line-number column at all: the sjabloon does not ship one and `KnQuotationLine` has no field for it — the row order within a group is the regel order.)
- **"These columns must be identical on every row of one group."** The kop columns of a voorcalculatie or abonnement repeat per row and nothing checks that they agree.

## Module help

Each module has an optional **help file** — one JSON per module under [`lib/help/content/`](../frontend/src/lib/help/content/), aggregated by [`lib/help/index.ts`](../frontend/src/lib/help/index.ts) into `getModuleHelp(id)`. Same convention as rule sets: **the filename is the module `id`**. All sections are optional; empty/missing sections simply don't render, so files can be filled in incrementally.

```jsonc
{
  "general": ["Intro paragraph.", "…"],                       // shown under "Algemeen"
  "columns": {                                                 // per-column prose, keyed by display name
    "Nationaliteit": { "description": "…", "example": "NL" }
  },
  "faq": [{ "question": "…", "answer": "…" }]                  // shown under "Veelgestelde vragen"
}
```

The **Columns** section is *derived*: the column list, the `verplicht` badge, the `type`, the allowed `enum` values, and the "gecontroleerd tegen een AFAS-lijst" hint all come from the module's **rule set**. The help file only adds a `description` + `example` per column, keyed by the column's **display name** (the first header for a synonym array). Keys with no matching rule column are ignored, so help and rules stay in sync.

Because the two files are coupled, `npm run help:sync` (from `frontend/`) does the mechanical half after any change under `rules/`: it adds a blank entry per new column, keeps the file in rule order, and reports what a script cannot write — missing prose, a description the rules now contradict ("laat leeg" on a column that just became required), and an `example` the engine itself would reject. `npm run help:check` is the read-only gate. Details in the header of [`scripts/sync-module-help.mts`](../frontend/scripts/sync-module-help.mts).

Rendered by [`ModuleHelpDrawer`](../frontend/src/components/uploader/ModuleHelpDrawer.tsx), a right slide-over opened from **Hoe vul ik dit in?** on `ModuleStartCard` and from **Uitleg {module}** in the sheet toolbar — one drawer, mounted by `ExcelUploader`, whichever of the two is on screen. See [design-system.md](design-system.md#25-core-ui-elements).

## When validation runs (UI)

Validation runs in [`ExcelUploader`](../frontend/src/components/ExcelUploader.tsx) on commit (right after a file is shown) and again whenever the user clicks **Hercontroleren**. Results live in `result` state and feed [`DataTable`](../frontend/src/components/uploader/DataTable.tsx), which tints flagged cells red (corner marker + an instant custom hover tooltip with the message). A banner above the grid lists any `missingColumns`; for an admin it ends in **Kolommen herstellen**, which opens [`ColumnRepairDialog`](../frontend/src/components/uploader/ColumnRepairDialog.tsx): per missing column, tick **Toevoegen** (a new, empty column, inserted where the module's template has it — right after the nearest template column before it that the sheet has, the rule set's column order being the template's), tick **Negeren** (the banner and the report stop naming it for this upload; its checks stay skipped), or pick a sheet column no rule reads from the dropdown to rename it (a likely one preselected — `Naam` for `Organisatie Naam`). **For this upload only**, on purpose: the client gets the corrected Excel back and goes on in that file, so the repaired headers are written into their own workbook — Excel Table included — rather than remembered for the project. The sheet is re-checked at once. Mechanics in [`lib/column-repair.ts`](../frontend/src/lib/column-repair.ts): a renamed header rides in `dirtyKeys` as `header:<col>`, an inserted column as `added:<col>` (an insertion shifts every key right of it), which is what makes the export insert and write them — moving the template's tables, dropdowns, conditional formatting and merges with an inserted column; formulas *in cells* are not rewritten — and the autosave and unsaved-changes guard treat it as an edit. Cell edits set `resultStale` internally (results no longer match the grid until the user re-checks).
