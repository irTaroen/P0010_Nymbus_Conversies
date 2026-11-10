# Nymbus Conversies

A local web tool for converting customer Excel exports into validated data and sending it
to the customer's **AFAS** (Profit) environment. You drop an Excel file in the browser; the
tool recognizes the module, shows the data, checks it against that module's rules, and the
**payload tab** builds the AFAS bodies and sends them to the client's environment.

Nymbus Conversies runs entirely on your own machine: no login, no AFAS environment of its
own, no Postgres, no Nodge, no Docker, no e-mail.
Everything the app holds is a JSON file under `backend/json_files/`.

## What the app does

0. **Projects** — `projects.json` (committed) holds the projects: id, name, the client's
   AFAS environment number, the kind of conversion (standard / facilitair / dossier), the
   status (realisatie / afgemeld), the intake, the periodetabel and livegangdatum. A project is
   created in the app (*Nieuw project* in the sidebar). There is **no login**: the backend
   runs as one local user with every right (`current_session` in `backend/main.py`).
   The URL says where you are: `/501282` is a project, `/501282/hrm-medewerkers` one of
   its modules ([docs/architecture.md](docs/architecture.md#routing)).
1. **Modules** — `modules.json` is the catalog (category, order); which modules a project
   has, their opleverdatum, stage (validatie → test → live → afgerond) and last figures
   live in `project_modules.json` (committed), managed on the *Modules* tab of the project
   settings.
2. **Read Excel** — upload `.xlsx`/`.xls`; the module is inferred from the file name
   ([docs/file-types.md](docs/file-types.md)).
3. **Validate** — per-module rule sets in `frontend/src/lib/validation/rules/`. Every
   validation run **stamps** the module's figures (`POST
   /api/projects/{id}/modules/{module}/validation`) — the sidebar badge and the voortgang.
   No Excel file is stored; the annotated Excel and the PDF validatierapport are
   downloads.
4. **Send** — the payload tab maps the sheet onto the module's UpdateConnector and sends
   it to the client's test or live environment through the backend. A send stamps the
   figures too (rows in AFAS) and moves the stage forward. There are **no workflow
   tasks or action buttons**.
5. **Voortgang** — `/voortgang` (managementrapport) and the projectrapport read the
   stamped figures.

## Where things live

| What | Where | In git? |
|---|---|---|
| Projects | `backend/json_files/projects.json` | yes |
| Modules per project, stage, figures | `backend/json_files/project_modules.json` | yes |
| Module catalog | `backend/json_files/modules.json` | yes |
| Client AFAS credentials | `backend/json_files/client_tokens.json` (plain text) | **no** |
| General UpdateConnector schemas | `backend/json_files/schemas/` (from the AFAS OAS) | yes |
| Standard field mappings | `backend/json_files/mappings/modules/` | yes |
| Client mappings | `backend/json_files/mappings/clients/<projectId>/` | yes |
| Maatwerk modules | `backend/json_files/custom_modules.json` | yes |
| Last send per module | `backend/json_files/state/send_progress.json` | **no** |
| Dossier migration settings | `backend/json_files/dossier_migration_settings.json` | **no** |
| AFAS woonplaatsen | `backend/json_files/afas_plaatsen.csv` | yes |
| GetConnector definitions | `connectoren/*.gcn` | yes |

`backend/local_store.py` reads and writes the project files; `backend/mapping_store.py`
the mappings. Every read goes back to disk, so a hand edit applies on the next request.

## Schemas: OAS for the general, the client's environment for the exceptions

- **General schemas** come from AFAS's public OpenAPI specs
  ([github.com/AFASSoftware/OASContent](https://github.com/AFASSoftware/OASContent), the
  content behind [docs.afas.help/profit](https://docs.afas.help/profit)), converted into
  AFAS's own `metainfo/update` shape by `backend/scripts/sync_oas.py` (`make oas`) and
  committed. The app never reads the internet for them. The OAS is a *pure* Profit: no
  vrije velden, no environment-specific mandatory flags.
- **Client-specific schemas** — a module flagged on *Maatwerk* in the project settings,
  or a maatwerk (custom) module — are read from **the client's own environment**
  (`metainfo/update/<connector>`), because that is where their vrije velden exist.

## Setting up a new client

1. *Nieuw project* (sidebar): id, name, environment number, kind of conversion, modules.
2. *Projectinstellingen → AFAS-omgeving*: client id + secret per stage; *Verbinding testen*.
3. *Projectinstellingen → Connectoren*: **check that every GetConnector is installed** —
   the `.gcn` files in `connectoren/` must be imported in the client's Profit and added to
   the app connector. Missing ones are listed with a download. Without them a codetabel
   check silently passes and *Bestaat al* can't be read. The tool only checks; the import
   is done by hand.

## Stack

- **Frontend** — Next.js 16 + React 19, Tailwind v4, `xlsx` (SheetJS) for reading and
  `exceljs` for writing, `jspdf` for the PDF reports, `lucide-react` icons. `frontend/`.
- **Backend** — FastAPI (Python 3.14), `backend/main.py`. Owns the AFAS credentials and
  every AFAS call.
- **Running** — `make dev` starts both: backend on `:8010`, frontend on `:3010`. The
  browser only talks to `:3010`; Next rewrites `/api/*` to the backend
  ([frontend/next.config.ts](frontend/next.config.ts)), so a new backend route needs no
  frontend or CORS change as long as it lives under `/api`.

## Reference docs

Read the relevant doc before working in that area.

- [Architecture](docs/architecture.md) — components, data flow, API surface, repo layout.
- [Nymbus styling](docs/nymbus-styling.md) — **the** design system: tokens, shadows,
  `neu-*` classes, component recipes, light/dark themes.
- [Design system (old)](docs/design-system.md) — the previous orange look. Its Part I class
  strings are superseded; Part II still records *why* each screen is shaped as it is.
- [File types & validation](docs/file-types.md) — type recognition, the rule sets.
- [AFAS integration](docs/afas-integration.md) — how the backend talks to AFAS. Written for
  the hosted version; see its banner for what does not apply here.
- [Existing records](docs/existing-records.md) — the `CON_ERP_*` read behind *Bestaat al* /
  *Nieuw*, and why "already exists" turns a POST into a PUT.
- [Payload view](docs/payload-view.md) and [UpdateConnector mapping](docs/updateconnector-schema-mapping.md).
- [Dossier migration](docs/dossier-migration.md) — the AFAS → AFAS variant.
- [AFAS Profit API reference](docs/AFAS-Profit-API-Referentie.md) and the
  [ERP kennisbank](docs/AFAS-Profit-ERP-Kennisbank.md) — AFAS itself.
- [TODO](docs/todo.md) — known follow-ups for this version.

## Working agreements

- **Frontend is Next.js 16** — it has breaking changes vs. older versions. See
  [frontend/AGENTS.md](frontend/AGENTS.md): consult `node_modules/next/dist/docs/` before
  writing frontend code.
- **Follow the Nymbus styling.** All UI work must match
  [docs/nymbus-styling.md](docs/nymbus-styling.md): every colour and shadow from a `k-*`
  token (`bg-k-bg`, `text-k-text-primary`, `shadow-raised`, `shadow-inset-sm` …), depth
  instead of borders, pills for controls, `neu-*` classes from
  [globals.css](frontend/src/app/globals.css) for buttons and inputs, Poppins, `lucide-react`
  icons. **Both themes** (light cream / dark warm-purple, toggled in the sidebar footer):
  never a hex value, never a `dark:` class — fix the token in `globals.css` instead.
  App-specific additions to the guide are marked *Conversies:* in `globals.css`
  (`--k-tint` for table-row hover, `neu-action-danger`, `neu-action-commit`).
- **Never a bare `<Link>` or a hand-written path.** Build every URL with
  [`lib/routes.ts`](frontend/src/lib/routes.ts) and link with `GuardedLink` from
  [`NavigationGuard`](frontend/src/components/NavigationGuard.tsx); programmatic exits use
  that provider's `navigate()`. A link that skips the guard walks past the prompt
  protecting an open sheet.
- **Secrets stay in the backend.** Client credentials live in the gitignored
  `client_tokens.json` (plain text — this is a local tool) and are never sent back to the
  browser: an endpoint may only say *whether* a secret is set. Never commit that file.
- **Never guess AFAS payloads.** Before writing or changing any code that calls AFAS —
  connector names, endpoint paths, envelopes, field codes, HTTP verbs — read
  [docs/AFAS-Profit-API-Referentie.md](docs/AFAS-Profit-API-Referentie.md) and the OAS
  schema in `backend/json_files/schemas/`. If a field isn't there, **ask AFAS itself**:
  `get_metainfo(env)`, `get_connector_metainfo(env, c)`, `update_connector_metainfo(env, c)`
  — the last one also names the body's **root key**, which is regularly not the connector
  name (`KnEmployee` → `AfasEmployee`).
- **Every AFAS call names its environment.** [`afas.py`](backend/afas.py) has no global
  "current environment": each function takes an `AfasEnvironment`, built per project by
  `project_environment()` in `main.py`. Use the verb wrappers
  (`afas_get`/`afas_post`/`afas_put`/`afas_delete`) or the intent helpers.
- **Report and clean up every record you create in AFAS.** A test POST leaves a real
  record in a customer's environment. If development creates anything in AFAS, **tell the
  user**, **list what it made** (environment, connector, key) and **delete it again**
  (`afas_delete`). If AFAS refuses the delete, say so plainly and leave the user the keys.
- **A `codetabel` check must always offer the picker.** Every rule that validates against
  a codetabel (`{ "check": "codetabel", "tableRef": "…" }`) gets the `TextSearch` button
  that opens [`CodetabelPicker`](frontend/src/components/uploader/CodetabelPicker.tsx) —
  wired automatically as long as the `Issue` carries `tableRef` (and `tableScope`). Two
  things silently break it: a table that never loaded (the check then *passes*; re-run
  when tables arrive, via `useCodetabellen().loadedAt`) and an `Issue` built without its
  `tableRef`. Codetabellen come from the **client's live environment only** — no fallback.
- **Field mappings are committed files.** Saving a mapping in the app writes
  `backend/json_files/mappings/…`; commit the diff. Editing the file by hand is equally
  fine. See [backend/mapping_store.py](backend/mapping_store.py).
- **Match a column header only through `lib/headers.ts`** — `headerIndex(headers, name)`
  and `HeaderMap`, never `indexOf` or a raw `Map`. An exact match reports the column
  *missing* and silently skips every check on it.
- **Touched `rules/`? Sync the help.** Run `npm run help:sync` from `frontend/`, write the
  missing prose, resolve every `!` line; `npm run help:check` is the gate.
- **Every user-facing string is bilingual (NL/EN).** `const t = useT(); t("Opslaan", "Save")`
  in a component, `tr()` in lib code, never `tr()` at module top level. A rule `message`
  gets a `messageEn`; help changes go into `lib/help/content/en/` too. Strings compared
  against data or sent to AFAS stay untranslated, and so does the payload view.
- **Touched `public/templates/`?** Run `npm run templates:translate`, then
  `npm run templates:sync` from `frontend/` and commit `src/lib/template-explanations.json`
  ([docs/file-types.md](docs/file-types.md#where-the-data-starts)).
- **Run `make check` before committing** — type check, lint, and the help/template gates.
- **Local versions: Node 24 (`.node-version`, via fnm) and Python 3.14**, the same as the
  original tool. **Ask the user before changing either**, or any dependency version.
- **Don't start a second server.** Before starting the frontend or backend, check for one
  already running (`lsof -nP -iTCP:3010 -sTCP:LISTEN`, same for `:8010`). Both reload on
  change; use it, or kill it and restart.
- **Keep the Mac awake while agents run — with exactly one `caffeinate`.** Check
  `pgrep -x caffeinate` first; only if there is none, start one background `caffeinate -dims`.
- **Subagents always run on Haiku.** Pass `model: "haiku"` explicitly when spawning one.
