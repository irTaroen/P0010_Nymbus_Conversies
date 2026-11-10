# AFAS -> AFAS dossier conversion — migration reference

This document explains how the `afas_to_afas` mode of Dossier_Conversie works, so it can be
rebuilt inside another app. The companion file [`afas_afas_dossier.py`](./afas_afas_dossier.py)
in this same directory is a **standalone, drop-in Python module** containing every function and
class needed — copy it into the target app and call into it from that app's own UI/backend/CLI.
It has no dependency on this repo's `core/` package.

**Scope**: AFAS -> AFAS only. The local-disk adapters and the `afas_to_local` / `local_to_afas`
modes are out of scope for this migration and are not ported.

**Original source**: `core/afas/*.py`, `core/engine.py`, `core/models.py`, `core/mapping.py`,
`core/config.py`, `core/secrets.py`, `core/progress.py` in the main repo. See also
`.claude/docs/architecture.md` and `.claude/docs/afas-api.md` there for the general-engine
version of this same explanation (covering all 3 modes, not just AFAS -> AFAS).

---

## 1. What this does

Copies employee "dossier" files (contracts, IDs, payslips, etc.) that exist in one AFAS Profit
environment (the **source**) but not in another AFAS Profit environment (the **target**) —
each employee's files land in the target under the *target's own* dossier-type/kenmerk
classification and the *target's own* employee id, via a per-client mapping table.

It never touches a target record that already exists — every run is a diff first, transfer
second.

## 2. Test vs. Live

Every AFAS environment in this codebase is addressed by two things: an `environment_id`
(the numeric AFAS environment number) and an `env` (`TEST` or `LIVE`), which selects the
subdomain:

```
TEST -> https://{environment_id}.resttest.afas.online/ProfitRestServices
LIVE -> https://{environment_id}.rest.afas.online/ProfitRestServices
```

**Source and target each carry their own `env` independently** (`AfasEndpointConfig.env` in
`afas_afas_dossier.py`, section 7). Any combination is valid — e.g. rehearse a conversion from a
Test source into a Test target, then repeat unchanged against Live/Live, or even mix
Test-source-into-Live-target if that's ever a real need. There is no shared/global "environment"
setting; a UI for this should expose two independent Test/Live toggles, one per side.

## 3. The pipeline

Every run is the same four steps, regardless of client:

```
1. build source records   -- AfasSource.build_df()          -> Polars DataFrame
2. build target index     -- AfasSink.existing_index_df()   -> Polars DataFrame
3. anti-join on Unique_hash                                 -> the diff
4. transfer the diff      -- fetch_bytes() then write(), per record
```

This is `run()` in `afas_afas_dossier.py` section 11. Steps 1 and 2 call the *exact same*
function (`build_afas_df`) — a target AFAS environment is enumerated with the same GetConnector
join logic used to read the source; the only difference is that the sink applies no mapping
(see section 8 below).

### Dry-run by default

`AfasToAfasConfig.dry_run` (default `True`) or the `dry_run` param on `run()` controls whether
step 4 actually happens. In dry-run mode, `run()` returns right after the diff — nothing is
fetched or written, but `RunResult.stats` still reports exactly what *would* transfer. **Always
default new UI/CLI entry points in the target app to dry-run**, matching this repo's golden rule.

### Per-record error handling

`run()` iterates the diff row by row. A failure on one record (`FetchError` from the source,
`WriteError` from the target — both subclass `TransferError`) is caught, recorded in
`RunStats.failures`, and the loop continues to the next record. One bad file never aborts an
otherwise-successful run.

## 4. Canonical schema and the `Unique_hash` diff key

Every record — from either the source or the target AFAS environment — is represented as a row
with exactly these columns (`CANONICAL_COLUMNS` in `afas_afas_dossier.py` section 1):

```
Medewerker, Medewerker_naam, Onderwerp, Type_dossieritem, Type_dossieritem_omschrijving,
Kenmerk, Bestand_naam_volledig, Bijlage_ID
```

`Bijlage_ID` is the AFAS attachment handle used to download the file's bytes from the *source*.

`finalize()` (section 5) coerces a DataFrame to this shape and then calls `add_unique_hash`,
which:

1. Concatenates the **identity columns** — `Medewerker`, `Type_dossieritem`,
   `Bestand_naam_volledig` — with `-` into `Unique_id` (human-readable).
2. Hashes `Unique_id` with a fixed seed (`_HASH_SEED = 0`) into `Unique_hash` (`pl.UInt64`).

**Why this is the single diff key**: `run()` never compares source-shaped rows to target-shaped
rows column-by-column — it only ever anti-joins on `Unique_hash`. That only works because *both
sides compute the hash the same way from the same three identity columns, in the same
vocabulary*. This is precisely why mapping (section 8) is applied to the source **before**
`finalize()`/the hash is computed: the hash must be computed on target-vocabulary values (target
employee id, target `Type_dossieritem`) so it lines up with the target's own enumeration of
itself.

If you change the identity columns or the hash seed in a rebuild, you must change them
identically for both the "read the source" path and the "read the target" path, or the diff will
silently over- or under-report.

## 5. Configuration shape

`AfasToAfasConfig` (section 7) is the whole config for one client/conversion:

```python
from afas_afas_dossier import AfasToAfasConfig, AfasEndpointConfig, Mapping, AfasEnv

config = AfasToAfasConfig(
    name="acme",
    source=AfasEndpointConfig(
        environment_id=11111,
        env=AfasEnv.LIVE,                 # or AfasEnv.TEST
        secret_ref="ACME_SOURCE_TOKEN",   # resolved from .env, see section 6
    ),
    target=AfasEndpointConfig(
        environment_id=22222,
        env=AfasEnv.LIVE,
        secret_ref="ACME_TARGET_TOKEN",
        gebruiker="1",                    # AFAS UsId — required for a TARGET, ignored on a source
    ),
    mapping=Mapping(
        files={"7.190": {"type": "12", "kenmerk": "310"}, "7.xx": {"type": "12", "kenmerk": "300"}},
        employees={"1001": "2001"},
    ),
    dry_run=True,
)
```

Building it directly in code (as above) is the simplest integration path for a new app. If you'd
rather keep this repo's `clients/<name>/config.yaml` convention, `load_config(path)` (section 7)
parses this equivalent YAML:

```yaml
name: acme
source:
  environment_id: 11111
  env: LIVE
  secret_ref: ACME_SOURCE_TOKEN
target:
  environment_id: 22222
  env: LIVE
  secret_ref: ACME_TARGET_TOKEN
  gebruiker: "1"
mapping:
  file: mapping.py        # OR inline `files:` / `employees:` below (not both)
  # files:
  #   "7.190": {type: "12", kenmerk: "310"}
  #   "7.xx":  {type: "12", kenmerk: "300"}
  # employees:
  #   "1001": "2001"
options:
  dry_run: true
```

`connectors:` may be added under either `source:` or `target:` to override the three
GetConnector names (see section 7 below) — only needed when a client's AFAS environment uses
non-default connector names.

## 6. Secrets

**Tokens never live in config or git.** `AfasEndpointConfig.secret_ref` is an arbitrary string id
(convention: `<CLIENT>_<SOURCE|TARGET>_TOKEN`); the actual token is resolved at call time by
`resolve_secret(secret_ref)` (section 3 of the .py), which reads it from an environment variable
— loading a git-ignored `.env` file first via `python-dotenv` (real env vars always win over the
`.env` file). `resolve_secret` raises `SecretNotFoundError` if the ref isn't set anywhere.

- `.env` value = the **decoded** AFAS token XML string, e.g.
  `ACME_SOURCE_TOKEN=<token><version>1</version><data>....</data></token>` — never
  pre-base64-encoded. Base64-encoding happens per-request in `afas_auth_header` (section 4).
- `afas_afas_dossier.py` looks for `.env` next to itself (`_ENV_PATH` near the top of the file).
  **Adjust `_ENV_PATH` to wherever the target app keeps its secrets** if that's not "next to this
  file" — e.g. point it at the target app's own repo root, or replace `resolve_secret` entirely
  with a call into the target app's existing secrets manager if it has one. Nothing else in the
  module needs to change; every other function only ever calls `resolve_secret(secret_ref)` /
  goes through `AfasClient.from_endpoint`.

## 7. AFAS API specifics

Everything below is implemented in `afas_afas_dossier.py` sections 4 (encoding), 8 (`AfasClient`),
and 9 (`build_afas_df` / `AfasSource` / `AfasSink`).

### Auth

```python
def afas_auth_header(token_xml: str) -> str:
    return f"AfasToken {base64.b64encode(token_xml.encode('utf-8')).decode('utf-8')}"
```

Sent as header `authorization: AfasToken <base64>` (lowercase key) with
`content-type: application/json; charset=utf-8;` for GetConnector/UpdateConnector calls, and as
`Authorization: AfasToken <base64>` for file downloads.

`AfasClient.test_connection()` GETs `{base}/metainfo/get` and checks for HTTP 200 — a
lightweight auth+reachability probe with no side effects, useful for a "check connection" button
in the target app's UI.

### Timeouts and retries

Unlike the main repo's `core/afas/client.py` (ported verbatim with bare `requests.get`/`.post`,
no timeout), every `AfasClient` request in this migration module goes through `_request()`
(section 8), which adds a 30s timeout (`_REQUEST_TIMEOUT_S`) and retries up to 3 attempts total
(`_MAX_ATTEMPTS`) with doubling backoff (`_RETRY_BACKOFF_S`, 2s then 4s) on connection
errors/timeouts and on 5xx responses — a 4xx (bad auth, bad payload) is never retried since
retrying it can't change the outcome. This exists so an unattended/scheduled run can't hang
forever on one bad request; adjust the three constants if the target app needs different limits.

### Reading: three GetConnectors, joined

`build_afas_df(client, connectors, mapping)` calls `client.get_data(connector)` against three
GetConnectors (default names in `DEFAULT_CONNECTORS`, overridable per endpoint via
`AfasEndpointConfig.connectors`):

1. **medewerkers** — employee master data.
2. **dossieritems** — dossier item metadata (`Type_dossieritem`, `Kenmerk`, `Onderwerp`, ...).
3. **bijlagen** — the actual attachments (`Bijlage_ID`, `Bestand_naam_volledig`).

This code only *consumes* these connectors — it assumes they already exist, correctly
configured, in every AFAS environment involved. If you're pointing this at an AFAS environment
where they don't exist yet, each GetConnector's output must include at least these fields (exact
AFAS field names, as read by `pl.DataFrame(client.get_data(...))`):

| Connector | Required output columns | Used as |
|---|---|---|
| `medewerkers` | `Medewerker`, `Medewerker_naam` | `Medewerker` is the join key into `dossieritems`. |
| `dossieritems` | `Medewerker`, `Dossieritem`, `Onderwerp`, `Type_dossieritem`, `Type_dossieritem_omschrijving`, `Kenmerk` | `Medewerker` joins to `medewerkers`; `Dossieritem` joins to `bijlagen`. |
| `bijlagen` | `Dossieritem`, `Bijlage_ID`, `Bestand_naam_volledig` | `Dossieritem` is the join key back to `dossieritems`; `Bijlage_ID` is the FileConnector handle used by `fetch_bytes`. |

Any missing column raises a Polars `ColumnNotFoundError` inside `build_afas_df` (or, for the
canonical set specifically, a clear `ValueError` from `finalize`'s missing-columns check) — not a
silent partial result, so a misconfigured connector fails loudly on the first run.

```python
df = medewerkers.join(dossieritems, on="Medewerker", how="inner")
df = df.join(bijlagen, on="Dossieritem", how="inner")
```

All three joins are `inner` — an employee with no dossier items, or a dossier item with no
attachment, produces no row. Requests use `?skip=-1&take=-1` (no paging — each connector is
expected to return everything in one call). If any of the three calls returns no rows,
`build_afas_df` short-circuits to `empty_canonical_df()`.

After the join, a `Mapping` helper column is built as `"<Type_dossieritem>.<Kenmerk>"` (or bare
`Type_dossieritem` when `Kenmerk` is null/empty), the raw AFAS columns are renamed to
`Medewerker_oud` / `Type_dossieritem_oud` / `Kenmerk_oud`, and `apply_mapping` (section 8 below)
resolves them into the target's vocabulary before `finalize()` computes the hash.

**This same function is used for both source and target** — `AfasSource.build_df()` calls it
with the client's configured `mapping`; `AfasSink.existing_index_df()` calls it with an empty
`Mapping()` (the target is always enumerated as-is, never remapped).

### Downloading a file (FileConnector)

```python
endpoint = f"{record['Bijlage_ID']}/{encode_filename(record['Bestand_naam_volledig'])}"
data, status = client.download_file(endpoint)   # GET {base}/fileconnector/{endpoint}
```

On HTTP 200, `download_file` returns `response.json()["filedata"]` — already a base64 string,
AFAS's own encoding, used verbatim as the transfer medium end-to-end (`AfasSource.fetch_bytes`
returns it unchanged; `AfasSink.write` drops it straight into the upload payload — no adapter
ever decodes it). On failure it returns `(None, "<status> - <externalMessage>")`, which
`AfasSource.fetch_bytes` turns into a `FetchError`.

#### `encode_filename` — path-escaping rules

AFAS's FileConnector needs a filename escaped in a specific, non-standard way inside the URL
path (applied per `/`-separated path segment):

| Character | Encoding |
|---|---|
| alphanumeric, `.` | passed through unchanged |
| space | `%20` |
| `+` | `_2B` |
| `&` | `_26` |
| `%` | `_25` |
| `_` | `_5F` |
| `-` | passed through **unless** it sits between two digit runs that are themselves followed by another `-` later in the segment — e.g. inside a date-like token such as `2024-01-15-something` — in which case it becomes `_2D` |
| anything else | `%` + uppercase hex of the codepoint (`%{ord(c):02X}`) |

A download 404s if this doesn't match exactly, so port it verbatim — don't reimplement with a
generic URL-encoder.

### Uploading a file (KnSubject UpdateConnector)

`AfasSink.write(record, file_data_base64)` calls `build_upload_payload` and POSTs the result to
`{base}/connectors/KnSubject` (expects HTTP 201; anything else becomes a `WriteError` carrying
AFAS's `externalMessage` or the raw response text):

```json
{
  "KnSubject": {
    "Element": {
      "@SbId": 9999999,
      "Fields": {
        "StId": "<Type_dossieritem>",
        "Ds":   "<Onderwerp>",
        "Da":   "<now, %Y-%m-%dT%H:%M:%S>",
        "UsId": "<target gebruiker, or null>",
        "St":   true,
        "FvF1": "<Kenmerk>"
      },
      "Objects": [
        { "KnSubjectLink": { "Element": { "Fields": {
              "ToEm": true, "SfTp": 2, "SfId": "<Medewerker>" } } } },
        { "KnSubjectAttachment": { "Element": { "Fields": {
              "FileName": "<Bestand_naam_volledig>",
              "FileStream": "<file_data_base64>" } } } }
      ]
    }
  }
}
```

Field meanings:

- `StId` — dossier item type id (`Type_dossieritem`, already target-mapped by the source side).
- `Ds` — subject/description (`Onderwerp`).
- `Da` — date, generated fresh at upload time (`datetime.now()`), not carried over from source.
- `UsId` — the AFAS user id performing the upload — comes from the **target**
  `AfasEndpointConfig.gebruiker`, not from the record. Set this per target environment.
- `St` — hardcoded `true` (subject status/active flag).
- `FvF1` — free field 1, carries `Kenmerk`.
- `KnSubjectLink` — links the subject to the employee: `SfTp: 2` = employee subject type,
  `SfId` = the already-target-mapped `Medewerker` id, `ToEm: true`.
- `KnSubjectAttachment` — the file itself: `FileName` + `FileStream` (base64, passed straight
  through from `fetch_bytes`).
- `@SbId: 9999999` — a placeholder/sentinel subject id AFAS expects when creating a new
  KnSubject (not a real id lookup — every upload uses this same literal value).

## 8. Mapping — why the target needs its own vocabulary

A dossier item's `Type_dossieritem` (its category, e.g. "arbeidscontract") and `Kenmerk` (a
sub-classification) are **environment-specific ids** — type `7` in the source AFAS environment
is not guaranteed to mean the same thing as type `7` in the target. Likewise employee ids
(`Medewerker`) are usually different between two AFAS environments for the same person. Mapping
translates both before anything is compared or uploaded.

`Mapping` (section 6 of the .py) has two independent tables:

- **`employees`**: `{"<source employee id>": "<target employee id>"}`. Applied by
  `apply_employee_mapping`: `Medewerker_oud -> Medewerker`, falling back to the source id
  unchanged when no rule matches.
- **`files`**: keyed by `"<Type_dossieritem>.<Kenmerk>"` from the *source*. Two key forms:
  - **exact**: `"7.190": {"type": "12", "kenmerk": "310"}` — matches only that exact
    type+kenmerk combination.
  - **global/prefix**: `"7.xx": {"type": "12", "kenmerk": "300"}` — matches *any* Kenmerk under
    source type `7`. When multiple global rules could match, the longest prefix wins.
  - Falls back to the source's own `Type_dossieritem`/`Kenmerk` unchanged when nothing matches
    (or when no file mapping is configured at all — e.g. if source and target happen to share
    the same classification scheme).

`apply_mapping(df, mapping)` = `apply_employee_mapping` then `apply_file_mapping` — always
applied to the **source** side, right after the three-connector join, right before `finalize()`
computes the hash (see section 4). **The target/sink is never mapped** — `AfasSink.existing_index_df()`
always calls `build_afas_df` with an empty `Mapping()`; it just enumerates what's already there
in the target's own vocabulary, which is exactly what the (already-mapped) source diffs against.

`load_mapping_from_pyfile(path)` reads the legacy per-client shape still used by this repo's
`projects/*/mapping_*.py` files (e.g. `projects/mbs/mapping_mbs.py`) — a plain Python module with
top-level `mapping_files` / `mapping_employees` dicts:

```python
mapping_files = {
    "1.xx": {"kenmerk": 192, "type": 7},
    "21.xx": {"kenmerk": None, "type": 50},
}
mapping_employees = {}
```

This is a convenient way to carry over an existing client's real mapping table verbatim when
porting one of the 4 AFAS -> AFAS legacy clients (`mbs`, `hdi`, `paragon`, `vdk` — see
`.claude/docs/roadmap.md` Phase 2 in the main repo).

## 9. Function / class reference

All of these live in `afas_afas_dossier.py`, in the section noted (sections are marked with
`# === N. ... ===` banner comments in the file).

| Name | Section | What it does |
|---|---|---|
| `DEFAULT_CONNECTORS` | 1 | Default GetConnector names (medewerkers/dossieritems/bijlagen). |
| `CANONICAL_COLUMNS`, `CANONICAL_SCHEMA` | 1 | The 8-column canonical shape + full Polars dtypes (incl. hash columns). |
| `TransferError`, `FetchError`, `WriteError` | 2 | Per-record failure exceptions; caught in `run()` so one bad record doesn't abort the run. |
| `SecretNotFoundError` | 2 | Raised by `resolve_secret` when a `secret_ref` isn't set anywhere. |
| `resolve_secret(secret_ref)` | 3 | `secret_ref` id -> token string, from env / `.env`. |
| `encode_base64_token(token_xml)` | 4 | Base64-encodes a decoded token XML string. |
| `afas_auth_header(token_xml)` | 4 | Builds the `AfasToken <base64>` header value. |
| `encode_filename(filename)` | 4 | AFAS's FileConnector URL-path escaping (see section 7 above). |
| `add_unique_hash(df)` | 5 | Adds `Unique_id` / `Unique_hash` from the 3 identity columns. |
| `empty_canonical_df()` | 5 | Zero-row DataFrame with the full canonical schema. |
| `finalize(df)` | 5 | Coerces to canonical columns/dtypes, then calls `add_unique_hash`. |
| `Mapping` | 6 | `files` + `employees` translation tables (dataclass). |
| `apply_employee_mapping(df, employees)` | 6 | `Medewerker_oud` -> `Medewerker`. |
| `apply_file_mapping(df, files)` | 6 | `Type_dossieritem_oud`/`Kenmerk_oud` -> target values via the `Mapping` helper column. |
| `apply_mapping(df, mapping)` | 6 | Employee mapping then file mapping, in that order. |
| `load_mapping_from_pyfile(path)` | 6 | Loads a legacy `mapping_files`/`mapping_employees` `.py` file. |
| `AfasEnv` | 7 | `TEST` / `LIVE` enum — picks the AFAS subdomain. |
| `AfasEndpointConfig` | 7 | One AFAS environment: `environment_id`, `secret_ref`, `env`, `connectors`, `gebruiker`. |
| `AfasToAfasConfig` | 7 | `name`, `source`, `target` (both `AfasEndpointConfig`), `mapping`, `dry_run`. |
| `load_config(path)` | 7 | Parses a `config.yaml` (see section 5 above) into an `AfasToAfasConfig`. Requires PyYAML. |
| `_request(method, url, **kwargs)` | 8 | `requests.request` with a timeout + retry-on-transient-failure (see "Timeouts and retries" above). Used internally by every `AfasClient` method. |
| `AfasClient` | 8 | REST wrapper: `test_connection`, `get_data`, `download_file`, `create` — each goes through `_request`. `from_endpoint()` resolves the secret and builds the base URLs from `environment_id` + `env`. |
| `build_afas_df(client, connectors, mapping)` | 9 | The 3-connector join -> mapped, hashed canonical DataFrame. Shared by source and sink. |
| `AfasSource` | 9 | `build_df()` (calls `build_afas_df` with the client's `mapping`), `fetch_bytes(record)` (downloads + returns base64, raises `FetchError`). |
| `build_upload_payload(record, file_data_base64, user_id)` | 9 | Builds the KnSubject JSON body (see section 7 above). |
| `AfasSink` | 9 | `existing_index_df()` (calls `build_afas_df` with an empty `Mapping()`), `write(record, file_data_base64)` (uploads, raises `WriteError`). |
| `RunStats` | 10 | Counters: `total_source`, `already_present`, `to_transfer`, `succeeded`, `failed`, `skipped`, `failures`. |
| `ProgressReporter` | 10 | No-op hook base class (`run_start`, `diff_ready`, `item_ok`, `item_failed`, `item_skipped`, `run_end`) — subclass to stream progress into the target app's own UI. |
| `ConsoleProgress` | 10 | Prints progress to stdout — useful while wiring things up. |
| `RunResult` | 11 | `client`, `stats`, `dry_run`, `duration_s` — what `run()` returns. |
| `build_run(config)` | 11 | Builds the `(AfasSource, AfasSink)` pair from a config. Split out so tests/callers can inject fakes. |
| `run(config, source=None, sink=None, reporter=None, dry_run=None)` | 11 | The diff + transfer loop (see section 3 above). |

## 10. Integration steps for the target app

1. Copy `afas_afas_dossier.py` into the target app (any location on its Python path).
2. Install dependencies: `polars`, `requests`, `python-dotenv`, and `PyYAML` if you use
   `load_config`. See this repo's `requirements.txt` for versions known to work together
   (`polars==1.35.2`, `requests==2.32.4`, `python-dotenv==1.0.1`, `PyYAML==6.0.2`).
3. Decide how the target app will supply tokens: either keep the `.env` + `secret_ref` pattern
   (adjust `_ENV_PATH` near the top of the file to point at the right location), or replace
   `resolve_secret` with a call into the target app's own secrets store — nothing else in the
   module needs to change, since every other function reaches a token only via
   `resolve_secret(secret_ref)` / `AfasClient.from_endpoint(endpoint)`.
4. Build an `AfasToAfasConfig` per conversion — either directly in code (section 5 above) or via
   `load_config(path)` if the target app wants to keep YAML client files. Surface `source.env`
   and `target.env` as two independent Test/Live controls in whatever UI/CLI wraps this.
5. Call `run(config, dry_run=True)` first and inspect `RunResult.stats` — this is always safe,
   nothing is written. Only pass `dry_run=False` (or set `AfasToAfasConfig.dry_run = False`) once
   the target app has its own explicit "confirm live transfer" step, mirroring this repo's
   dry-run-by-default rule.
6. For live progress in a web UI, subclass `ProgressReporter` and push each hook call onto
   whatever live-update channel the target app has (SSE, WebSocket, polling row) — `run()` never
   needs to change for this, it only calls the reporter's hooks.
7. If porting one of the 4 existing AFAS -> AFAS legacy clients (`mbs`, `hdi`, `paragon`, `vdk`),
   their real mapping tables already exist at `projects/<name>/mapping_<name>.py` in the main
   repo and load as-is via `load_mapping_from_pyfile`.

## 11. Things ported verbatim — don't "clean up" without checking AFAS behavior first

- `_HASH_SEED = 0` and the exact 3 identity columns — changing either changes what counts as
  "the same file" across every existing client's data.
- `@SbId: 9999999` sentinel in the upload payload — a fixed placeholder AFAS's UpdateConnector
  expects for a new KnSubject, not a real id.
- `encode_filename`'s specific `-`-inside-digit-run rule — looks arbitrary but matches AFAS's own
  (undocumented) FileConnector escaping; a generic URL-encoder will produce 404s on date-stamped
  filenames.
- No pagination on `get_data` (`?skip=-1&take=-1`) — the three GetConnectors are expected to
  return every row in a single response. If a target AFAS environment's connector is configured
  differently and starts truncating, this will silently under-report rather than error.
- Sink `mapping`: the original repo's `AfasSink` constructor has an unused `mapping` parameter
  that the engine never actually passes a value into (it's always the default, which the class
  then hardcodes to an empty `Mapping()` regardless). This migration drops that dead parameter —
  `AfasSink` here has no `mapping` argument at all; `existing_index_df()` always uses an empty
  `Mapping()` directly, which is behaviorally identical.
