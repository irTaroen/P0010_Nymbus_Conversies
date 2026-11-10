# Architecture

Nymbus Conversies: one Next.js frontend and one FastAPI backend on
your own machine, everything stored as JSON files. No login, no database, no AFAS environment of its own
environment — the only AFAS the tool talks to is each **client's**.

## Components

```
browser ──► Next.js :3010 ──(/api/* rewrite)──► FastAPI :8010 ──► client's AFAS (REST)
                                                      │
                                                      └──► backend/json_files/*.json
```

- **Frontend** (`frontend/`) — Next.js 16 app router. Reads Excel in the browser (SheetJS),
  validates it against the module's rule set, renders the table, builds the AFAS payloads,
  and writes the annotated Excel (ExcelJS) and the PDF reports (jsPDF) as downloads.
- **Backend** (`backend/main.py`) — owns the client credentials and every AFAS call: schema
  reads, codetabellen, existing records, lookups, and the send itself (as a background run,
  `payload_send.py`). Stores projects, modules, mappings and figures as JSON
  (`local_store.py`, `mapping_store.py`, `send_progress.py`).
- **No auth.** `/api/auth/me` answers with one local user who has every right; the
  route dependencies (`current_session`, `require_admin`) still exist so each route says
  what it would need, but they never refuse.

## Data flow

1. **Project and modules.** `GET /api/auth/me` returns the local user and every project in
   `projects.json` (`_project_view` in `main.py` keeps the shape the frontend had, so the
   picker, sidebar and reports read it unchanged). `GET /api/projects/{id}/modules` returns
   the project's modules from `project_modules.json`, grouped by the categories of
   `modules.json`.
2. **Upload and validate** — entirely in the browser
   ([file-types.md](file-types.md)). Codetabellen are fetched from the client's **live**
   environment (`GET /api/projects/{id}/codetabellen/{key}`); a table nobody can serve makes
   its check pass with a *niet gecontroleerd* badge.
3. **Stamp.** Each validation run posts its figures
   (`POST /api/projects/{id}/modules/{module}/validation`) — the sidebar badge, the
   projectrapport and `/voortgang` read them back (`GET /api/projects/{id}/progress`).
4. **Payloads.** The payload tab combines the sheet, the module's mapping
   (`mappings/modules/` or the client copy in `mappings/clients/<id>/`) and the
   UpdateConnector schema (the OAS file in `schemas/`, or the client's own metainfo for a
   flagged or maatwerk module) into one AFAS body per record. *Bestaat al* / *Nieuw* comes
   from the client's `CON_*` GetConnectors ([existing-records.md](existing-records.md)).
5. **Send.** `POST /api/afas/payloads/send` starts a background run against the client's
   test or live environment; the panel polls it. When it ends, the module's figures are
   stamped (rows in AFAS), the detail behind them (refusals, environment) goes to
   `state/send_progress.json`, and the module's stage moves forward (validatie → test →
   live). The verzendrapport PDF and the Excel with refused cells marked are downloads.

## Storage

See the table in [CLAUDE.md](../CLAUDE.md#where-things-live). Every store re-reads its
file on each request, so a hand edit applies without a restart. Writes are atomic
(`json_store.write_json_atomic`) and serialized per process (`local_store._lock`).

## Schemas

`backend/scripts/sync_oas.py` (`make oas`) downloads every Profit spec from
[AFASSoftware/OASContent](https://github.com/AFASSoftware/OASContent)
(`OpenApiSpecs/profit/nl/*.json`) at one commit and converts each UpdateConnector's POST
(else PUT) request schema into AFAS's `metainfo/update` shape:

| `metainfo/update` | from the OAS |
| --- | --- |
| `name` (body root key) | the single property under the request schema (`AfasEmployee`) |
| `fields[].fieldId`, `label` | `Element.Fields.properties` key, first line of `description` |
| `dataType` | `type`/`format`: boolean, int, decimal, date (`date`/`date-time`), blob (`byte`), else string |
| `mandatory` | listed in `Element.Fields.required` |
| `length`, `decimals` | `maxLength`, `multipleOf` |
| `values` | `enum`, each with its `code = text;` line from `description` |
| `primaryKey` | root object only: the keys in the connector's DELETE path (`@EmId`) |
| `objects` | `Element.Objects` (array items), recursively |

`notzero` and `controlType` aren't in the OAS and are written as `false`/`0`. The result
is `schemas/<Connector>.json` plus `schemas/_index.json` (connector, description,
category, and the source commit). The OAS describes a *pure* Profit — no vrije velden —
which is why a client whose inrichting deviates gets a client mapping read against its
own environment (`GET /api/projects/{id}/updateconnectors/{module}`).

## Repository layout

```
Makefile                    make dev / install / check / oas
backend/
  main.py                   every route
  local_store.py            projects, project modules, client tokens, send state
  mapping_store.py          field mappings as files
  afas.py                   the AFAS REST client (environment passed per call)
  codetabellen.py           reference tables per client environment
  existing.py, lookups.py   CON_* reads for Bestaat al and mapping lookups
  payload_send.py           the send as a background run
  send_progress.py          the figure a send stamps, and its detail
  dossier_migration.py      the AFAS → AFAS variant
  scripts/sync_oas.py       OAS → json_files/schemas/
  json_files/               everything the app stores (see CLAUDE.md)
connectoren/                the GetConnectors (.gcn) every client environment needs
frontend/src/
  app/                      routes: /, /[project], /[project]/[module], /voortgang, /afas/updateconnectors
  components/               the shell, uploader, payload view, settings dialogs
  lib/                      validation, mappings, payload plans, reports, API clients
  lib/validation/rules/     one rule set per module
  lib/help/content/         one help article per module (NL + en/)
frontend/public/templates/  the Excel templates (NL + en/)
docs/                       this folder
```

### Routing

```
/                          the project picker (several projects), the only project, or
                           "no projects yet" with a *Nieuw project* button
/{projectId}               the project: modules in the sidebar, the projectrapport
/{projectId}/{moduleId}    one module: its uploader (?view=payloads for the payload tab)
/voortgang                 the managementrapport over every project
/afas/updateconnectors     the connector explorer and mapping editor
```

Build every path with [`lib/routes.ts`](../frontend/src/lib/routes.ts) and link with
`GuardedLink`; a programmatic move goes through `NavigationGuard`'s `navigate()`, so an
open sheet's leave prompt is always asked. `[project]/layout.tsx` resolves the id against
the session's projects and mounts the project shell; an unknown id gets a notice instead
of an empty shell. A project whose kind is `dossier` gets `DossierMigrationPage` instead
of the module list.

### Adding a module payload plan

A module only gets the **Payloads** view (`?view=payloads`) once it has an entry in
`MODULE_PAYLOAD_PLANS` in [`lib/module-payloads.ts`](../frontend/src/lib/module-payloads.ts).
A mapping file exists for nearly every module, but a mapping alone doesn't say *which
connector a given row goes through* — that is the question a plan answers, and it is
left unanswered rather than guessed.

A plan is data, not code. Three things have to line up:

| field | must be | where it comes from |
| --- | --- | --- |
| the record key | the **app module id** | `MODULES` in [`lib/modules.tsx`](../frontend/src/lib/modules.tsx) — `erp-crediteuren`, not `CR` |
| `mappingId` | the mapping's **filename**, no `.json` | `backend/json_files/mappings/modules/` |
| `discriminatorColumn` | a column **header**, verbatim | the module's rule set in `lib/validation/rules/<id>.json` |

`mappingId` is the filename because the backend overwrites each row's `module` with
`path.stem` on the way out (`_mapping_rows()` in `main.py`), and the panel indexes the
result by that value — so a split module's two files stay distinct even though both
name the same `module` internally.

**The ordinary case** is one connector and no branching. Every row belongs to the only
variant, so `match` is empty and the discriminator is null:

```ts
"erp-artikelen": {
  discriminatorColumn: null,
  variants: [{ mappingId: "erp-artikelen", label: "Artikel", match: [] }],
},
```

**A split module** names the column that decides, and each variant claims the values
that route to it. `match` is compared trimmed and upper-cased, so a client typing `o`
lands the same as `O`:

```ts
"erp-crediteuren": {
  discriminatorColumn: "Organisatie of Persoon",
  variants: [
    { mappingId: "erp-crediteuren-organisatie", label: "Organisatie", match: ["O"] },
    { mappingId: "erp-crediteuren-persoon", label: "Persoon", match: ["P"] },
  ],
},
```

The three split modules and their discriminators, all enum-checked by their rule sets:
Debiteuren and Crediteuren on `Organisatie of Persoon` (`O`/`P`), Contactpersonen on
`Contact bij` (`D`/`C`), Openstaande posten on `Debiteur of Crediteur` (`D`/`C`).

What you get for free, and what to watch:

- **Nothing is keyed by column position.** `buildModulePayloads()` re-points every
  mapping at the sheet on screen by header name (`remapToSheet`), so a client export
  that gained or lost a column still fills the right fields, and a mapped column the
  file hasn't got is dropped *and* reported (`missingColumns`) rather than silently
  read from its neighbour. The discriminator is looked up by header for the same reason.
- **A row matching no variant is not dropped silently** — it lands in `unrouted` and
  the panel says so. An unroutable row is one that would never reach AFAS, which is
  exactly what this view exists to show before an upload rather than after.
- **Grouping is asked per variant, not per module.** A module whose mapping marks key
  columns (`key: true`) states a kop and its regels flat; `groupShape()`/`groupRows()`
  turn that into AFAS's `"Element": [ … ]` array. Voorcalculatie, Abonnementen and
  Openstaande posten are the three, and they need nothing extra in the plan.
- **The connector's schema is fetched per variant**, from the mapping's own
  `connector` field — so a plan naming a mapping whose connector has no metainfo will
  render nothing for that variant and show it as missing.

## API surface

## API surface

All under `/api`, all answered by `backend/main.py`.

| Area | Routes |
| --- | --- |
| Session | `GET /auth/me`, `GET /health` |
| Projects | `POST /projects`, `DELETE /projects/{id}`, `PUT /projects/{id}/module-list`, `/conversion-type`, `/status`, `GET/PUT /projects/{id}/settings`, `/conversion-settings`, `/intake`, `/test-project`, `/display-name`, `POST /projects/{id}/settings/test-connection`, `GET /projects/{id}/connectors/check?stage=`, `GET /connectoren/{file}.gcn` |
| Modules | `GET /modules` (catalog), `GET /projects/{id}/modules`, `PUT /projects/{id}/modules/{module}` (opleverdatum, stage) |
| Figures | `POST /projects/{id}/modules/{module}/validation`, `POST /progress`, `GET /projects/{id}/progress`, `GET /voortgang/{id}`, `GET /voortgang/intakes` |
| Schemas | `GET /afas/updateconnectors`, `GET /afas/updateconnectors/modules/{connector}` (OAS), `GET /afas/updateconnectors/clients`, `GET /projects/{id}/updateconnectors/{module}` (client), `GET /afas/getconnectors/{group}[/{connector}]?project=` |
| Mappings | `GET /afas/mappings`, `PUT/DELETE /afas/mappings/{group}/{key}`, `PUT/DELETE /projects/{id}/mappings/{module}`, `GET/POST /projects/{id}/custom-modules`, `DELETE /projects/{id}/custom-modules/{module}` |
| Client reads | `GET /projects/{id}/codetabellen/{key}` (+ `POST …/refresh`), `GET /projects/{id}/environment?stage=`, `GET /projects/{id}/existing/{module}?stage=`, `GET /projects/{id}/existing/{module}/validation`, `GET /projects/{id}/lookup` |
| Send | `POST /afas/payloads/send`, `POST /afas/payloads/delete`, `GET /afas/payloads/send/{run}`, `POST /afas/payloads/send/{run}/stop`, `GET /afas/payloads/send`, `GET /afas/payloads/runs` |
| Plaatsen | `POST /afas-plaatsen`, `GET /afas-plaatsen.csv` |
| Dossier migration | `GET/PUT /projects/{id}/dossier-migration/settings`, `POST …/settings/test-connection`, `POST/GET …/runs`, `GET …/runs/{run}` |

## Conventions

- The frontend calls the backend through `requestJson()` in `lib/api.ts`: relative `/api/…`
  paths (Next rewrites them), every failure an `ApiError` whose `message` is the backend's
  `detail` or the caller's fallback.
- Module ids (`hrm-medewerkers`, `erp-debiteuren`, …) are the shared vocabulary across
  recognition, validation, mappings, help and the URL. The catalog is `MODULE_CATALOG` in
  `lib/modules.tsx`; `backend/json_files/modules.json` carries the same ids and labels and
  must be kept in step.
- **Every string a person reads is written in Dutch and English, side by side** — `useT()`
  in components, `tr()` in lib code at the moment it runs, never at module top level.
  Not translated: anything compared against data or sent to AFAS, and the payload view.
  See [`lib/i18n.ts`](../frontend/src/lib/i18n.ts).
- **Never a literal control byte in a source file** — spell a NUL as `\u0000`; a raw byte
  makes git treat the file as binary. `npm run check:control-bytes` checks.
