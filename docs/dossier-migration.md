# Dossier migration (AFAS → AFAS)

> **Local version.** A project is a dossier migration when its kind of conversion is
> *Dossierconversie* (project settings → *Modules*), not because of a flag on an AFAS
> dossieritem. Its settings live in the gitignored `dossier_migration_settings.json`, in
> plain text.

> Detail for [CLAUDE.md](../CLAUDE.md). A project whose "conversion" is really a straight
> AFAS → AFAS dossier migration, not the usual Excel-in/AFAS-out flow.

## What it is

Some conversion projects aren't converting an Excel export at all: the client is moving
between two real AFAS environments, and Nymbus's job is to copy the employee dossier files
(contracts, IDs, payslips, …) that exist in one (the **source**) but not yet in the other
(the **target**) — never the other way round, and never overwriting a file that's already
there. Every run diffs first and transfers second; a dry run stops after the diff.

Which kind a project is comes straight from AFAS: the project's hoofdproces row in
`Nymbus_Dossieritems_Hoofdtaak` carries `Facilitair_conversie` / `Dossier_conversie`, two booleans
`_conversion_type()` (the hosted version) reduces to one `conversionType` —
`"facilitair"` / `"dossier"` / `"standard"` when neither is set. There is no local admin flag
any more; the field travels as a normal part of the session's project list, joined in
`_project_view()` in `main.py` next to `hasDossier`/`moduleCategories`.

A `"dossier"` project gets a **dedicated page** instead of the usual sidebar and module list —
`[project]/layout.tsx` renders `DossierMigrationPage` in place of `children` the moment
`session.projects[].conversionType === "dossier"`, so the project never shows an Excel upload
flow at all.

## Origin

Built from a working design the user had already run in another app, ported as reference into
`/migration/afas_afas_dossier.md` + `.py` (not part of this app — a spec, kept for history).
That module is the source of truth for the AFAS behaviour reproduced here (the FileConnector
filename escaping, the KnSubject upload shape, the mapping semantics) but not for its own
technical choices, three of which are deliberately different in this port:

- **OAuth, not the legacy `AfasToken` header.** Both the source and the target authenticate
  with AFAS's OAuth client-credentials flow — the same `AfasEnvironment`/`afas_request()`
  machinery every other AFAS call in this app already uses, including the FileConnector
  download (`download_module_file()` (the hosted version) already proves OAuth works there). The legacy
  static `AfasToken` header the ported module used is discontinued by AFAS on 31-08-2027 and
  is not used anywhere in this feature.
- **Plain Python, no `polars`/`requests`.** Neither is a dependency of this backend (it's
  `httpx`, async, throughout). The join/diff logic is small enough over `list[dict]`. The
  ported module's diff key, `Unique_hash` (a polars-seeded hash of 3 identity columns), only
  existed to make a polars anti-join possible — since both sides of the diff are computed in
  this one process, the **plain identity tuple**
  (`dossier_migration.identity_key()`) does the same job with no hashing at all.
- **A background job, not a synchronous `run()`.** This backend has no other long-running call
  — every other route is request/response. `dossier_migration.start_run()` schedules an
  `asyncio.Task` and returns immediately; the frontend polls `GET .../runs/{runId}` for live
  progress (`DossierMigrationRunPanel`). In-memory, per-process — a restart loses in-progress
  or finished runs, an accepted limitation given a run is cheap to start again and this backend
  already has a single-instance deploy constraint.

The mapping semantics (exact key, `"7.xx"` prefix wildcard with longest-prefix-wins, fall back
to the source's own value when nothing matches) and the FileConnector/KnSubject specifics are
ported **verbatim** — both are AFAS's own undocumented behaviour, empirically confirmed
against real AFAS environments in the other app. One correctness detail worth remembering: the
FileConnector already returns a file as a **base64 string** (`payload["filedata"]`); it goes
straight into `KnSubjectAttachment.FileStream` unchanged — never decoded, never re-encoded.

## Settings — one row per project

`backend/json_files/dossier_migration_settings.json` (gitignored — an
`.example.json` alongside it, not gitignored, shows the shape), encrypted the same way
the `project_settings` table is (`backend/encryption.py`) — this store is still a JSON
file, project_settings is the one that moved to a Fabric SQL Database. One object per project:

```jsonc
{
  "projectId": "501299",
  "projectName": "…",
  "source": {
    "omgeving": "11111", "stage": "live",
    "client_id": "enc:v1:…", "client_secret": "enc:v1:…",
    "connectors": {}                 // optional per-side GetConnector overrides
  },
  "target": {
    "omgeving": "22222", "stage": "live",
    "client_id": "enc:v1:…", "client_secret": "enc:v1:…",
    "connectors": {},
    "gebruiker": "1"                 // AFAS UsId an upload is attributed to; target only
  },
  "mapping": {
    "employees": { "1001": "2001" },
    "files": { "7.190": { "type": "12", "kenmerk": "310" }, "7.xx": { "type": "12", "kenmerk": "300" } }
  }
}
```

`connectors` defaults to `DEFAULT_CONNECTORS` (`Nymbus_Conversie_Medewerkers` /
`_Dossieritems` / `_Bijlagen`) when absent — these three GetConnectors are assumed to already
exist, correctly configured, in **both** the source and target AFAS environments; this feature
only ever reads them, it doesn't set them up.

## The pipeline

Same shape on every run, dry or live:

1. **Build source records** — `dossier_migration.build_records(source_env, connectors,
   mapping)`: `medewerkers ⋈ dossieritems ⋈ bijlagen` (three `get_connector()` calls, joined
   with plain dict lookups — no pagination requested, same known non-goal the ported module
   accepted), with the project's `Mapping` applied (employee id, then dossier type/kenmerk).
2. **Build target index** — the same function, called with an **empty** `Mapping()`: the
   target is always enumerated as itself, never remapped.
3. **Diff** — `dossier_migration.diff_records()`: source records whose `identity_key()`
   (`Medewerker`, `Type_dossieritem`, `Bestand_naam_volledig` — after mapping) isn't already
   present at the target.
4. **Dry run stops here.** A live run walks the diff one record at a time: `fetch_bytes()`
   from the source (FileConnector, AFAS's own filename escaping via `encode_filename()`), then
   `write_record()` to the target (`KnSubject`, `KnSubjectLink` + `KnSubjectAttachment`).
   `TransferError` (`FetchError`/`WriteError`) is caught **per record** so one bad file doesn't
   abort the run — recorded in `RunStats.failures`, the loop continues.

A GetConnector call that doesn't **succeed** at all (unreachable environment, rejected
credentials, missing connector — as opposed to succeeding with zero rows, which is a
legitimate empty result) raises `ConnectorReadError` out of `build_records()`, which ends the
run as `"failed"` with AFAS's own message attached. Reading `.rows` alone isn't enough to tell
the two apart — `AfasResult.rows` defaults to `[]` on a failed call too — so this is checked
explicitly; without it, an unreachable source environment reads as "0 records, nothing to
transfer" instead of an error, which is exactly backwards. (Caught live during
implementation — the dry run against a deliberately unreachable fake environment reported
`0`/`0`/`0`/**done** before this fix, and `0`/`0`/`0`/**failed** with a clear Dutch message
after it.)

## API surface

All admin-only (`require_admin`, same as every other credential-touching route in this app):

- `GET`/`PUT /api/projects/{projectId}/dossier-migration/settings` — same write-only-secrets
  contract as `project_settings`'s settings routes (`clientSecretSet`, never the secret
  itself). `PUT` accepts a partial body — `source`/`target`/`mapping` each left out (`null`)
  keep what's stored, so a save can touch just one of them without resending the rest.
- `POST /api/projects/{projectId}/dossier-migration/settings/test-connection` — `{side:
  "source"|"target", omgeving, stage, clientId, clientSecret?}` → `{connection: {ok,
  message}}`, same `metainfo`-based probe and "a refusal is a 200, not an HTTP error" rule as
  the normal project settings' test-connection route.
- `POST /api/projects/{projectId}/dossier-migration/runs` — `{dryRun}` → starts a background
  run, returns immediately. 409 (`RunAlreadyInProgress`) if this project already has one
  running — a second, overlapping run against the same two environments would double-count
  and double-upload.
- `GET /api/projects/{projectId}/dossier-migration/runs/{runId}` — poll this while
  `status === "running"`. `GET .../runs` (no id) lists the project's most recent runs, newest
  first — what a page reload restores so a run in progress (or its last result) isn't lost.

## Frontend

- `lib/dossier-migration.ts` — types + fetch functions, mirroring `lib/project-settings.ts`'s
  conventions exactly.
- `components/DossierMigrationPage.tsx` — the whole page: its own header (no `Sidebar` here,
  same "own header, own way back" shape `/afas/updateconnectors` uses), source/target config
  (`EndpointSection`, `SecretField`, `ConnectionMark` — same patterns as
  `ProjectSettingsDialog`), and the two mapping tables. There is no way to turn this off from
  the app any more — AFAS's `Dossier_conversie` flag decides, so unflagging a project happens
  there.
- `components/DossierMigrationMappingTable.tsx` — `EmployeeMappingTable` /
  `FileMappingTable`, small editable add/remove-row tables (design-system.md §15's visual
  language, not its heavier virtualized machinery — these hold a handful of hand-typed rows).
- `components/DossierMigrationRunPanel.tsx` — dry-run (always the plain primary action) /
  live-run (behind a `ModalWarningHeader` confirm, since it genuinely writes into the target)
  buttons, and the polling progress display (`RunStats`, the failures list).

## Known limitations, on purpose

- **In-memory run store.** A backend restart loses in-progress/finished runs. Not solved here
  — a run is cheap to start again, and this backend already runs single-instance.
- **No pagination on the three GetConnectors**, matching the ported module. If one of them is
  configured to page in a given environment, this under-reports silently rather than erroring.
