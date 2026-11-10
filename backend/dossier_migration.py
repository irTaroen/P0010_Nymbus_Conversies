"""Dossier migration: copying an employee's dossier files (contracts, IDs,
payslips, …) that exist in one AFAS environment (the source) but not in
another (the target) — for a project whose "conversion" is really a straight
AFAS -> AFAS migration rather than the usual Excel-in/AFAS-out one.

Built entirely on `afas.py`'s existing OAuth (Bearer) client — there is no
separate auth path here. Source and target are two arbitrary AFAS
environments, each with its own OAuth client id/secret and TEST/LIVE stage,
configured per project in `json_files/dossier_migration_settings.json`
(gitignored, credentials in plain text like `client_tokens.json`).
No FastAPI import, same as the hosted version's backend — routes in `main.py` stay thin and
translate what this module raises into HTTP.

Ported from `/migration/afas_afas_dossier.md` + `.py` — a standalone module
the user built and ran in another app. That document is the source of truth
for the AFAS behaviour reproduced here (the FileConnector filename escaping,
the KnSubject upload shape, the mapping semantics) and explains it in full;
three things are deliberately *not* carried over as-is:

  - OAuth via `afas.py`, not the ported module's legacy `AfasToken` header
    (AFAS discontinues that 31-08-2027).
  - Plain Python list/dict joins instead of `polars` — neither `polars` nor
    `requests` is a dependency of this app. The diff key is the plain
    3-tuple identity (`Medewerker`, `Type_dossieritem`, `Bestand_naam_volledig`)
    rather than a polars-seeded hash of it: both sides of the diff are
    computed in this one process, so the tuple itself does the anti-join's
    job with no hashing at all.
  - A background job (`start_run` + polling `RunState`) instead of the ported
    module's synchronous `run()` — this backend had no other long-running
    call, so the job store here is new: in-memory, per-process, one active
    run per project.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from afas import (
    AfasEnvironment,
    AfasStage,
    afas_element,
    afas_envelope,
    download_file,
    get_connector,
    insert_record,
)
from json_store import write_json_atomic
from clock import now_iso

# --- Settings store -------------------------------------------------------
# One row per project in `dossier_migration_settings.json` — source and target
# AFAS environment (each with its own OAuth client id/secret, stage, and
# optional connector-name overrides) and the employee/dossier-type mapping.
# Whether a project *is* a dossier migration comes from AFAS itself now
# (`_conversion_type()` (the hosted version)); this store only holds the configuration a
# project flagged that way needs. Read and rewritten whole per request,
# atomically, exactly like `project_settings.json` in `main.py`.

# `JSON_DIR` in the environment moves the whole folder — on Nodge it points at the
# persistent volume (/data/json_files, seeded from this folder by /start.sh), because
# the app writes mappings and custom modules here and a container's own disk is
# thrown away on every deploy.
JSON_DIR = Path(os.getenv("JSON_DIR") or Path(__file__).parent / "json_files")
SETTINGS_FILE = "dossier_migration_settings.json"

Side = Literal["source", "target"]

# Standard Nymbus conversion connectors; a project overrides only the ones
# that differ (per-side `connectors` in the settings store).
DEFAULT_CONNECTORS = {
    "medewerkers": "Nymbus_Conversie_Medewerkers",
    "dossieritems": "Nymbus_Conversie_Dossieritems",
    "bijlagen": "Nymbus_Conversie_Bijlagen",
}

_UPLOAD_CONNECTOR = "KnSubject"
# Placeholder/sentinel @SbId AFAS's UpdateConnector expects when creating a
# new KnSubject — not a real id lookup, every upload uses this same literal
# value. Ported verbatim from the source module.
_SBID_SENTINEL = 9999999

CANONICAL_COLUMNS = (
    "Medewerker",
    "Medewerker_naam",
    "Onderwerp",
    "Type_dossieritem",
    "Type_dossieritem_omschrijving",
    "Kenmerk",
    "Bestand_naam_volledig",
    "Bijlage_ID",
)


def _rows() -> list[dict]:
    """Every stored project's dossier-migration settings — none yet is an
    empty store, not an error."""
    try:
        with (JSON_DIR / SETTINGS_FILE).open(encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    return data if isinstance(data, list) else []


def _write_rows(rows: list[dict]) -> None:
    """Replace the settings file, atomically — written beside the target and
    moved into place, so a failed write can't leave it half-saved."""
    write_json_atomic(JSON_DIR / SETTINGS_FILE, rows)


def settings_row(project_id: str) -> dict:
    """One project's stored dossier-migration settings, or an empty row for a
    project nobody has configured yet."""
    return next((row for row in _rows() if str(row.get("projectId")) == project_id), {})


def save_settings(project_id: str, project_name: str, fields: dict) -> dict:
    """Upsert this project's row and write the store atomically. `fields` is
    already the plain (pre-encrypted-where-needed) row shape `main.py`'s
    route built — this function only knows how to store and retrieve it,
    same split as `project_settings.json`'s `_upsert_row` + `_settings_view`."""
    rows = _rows()
    index = next((i for i, r in enumerate(rows) if str(r.get("projectId")) == project_id), None)
    row = {**fields, "projectId": project_id, "projectName": project_name}
    if index is None:
        rows.append(row)
    else:
        rows[index] = row
    _write_rows(rows)
    return row


def settings_view(project_id: str, project_name: str, row: dict) -> dict:
    """The settings as the frontend gets them: camelCase, the client ids
    decrypted, each secret reduced to whether it is set (a question about the
    *stored* value, so it needs no decryption) — same rule
    `project_settings.json` follows. 
    the caller (a `main.py` route) turns that into a 500."""

    def endpoint_view(key: Side, *, with_gebruiker: bool) -> dict:
        side = row.get(key) or {}
        view = {
            "omgeving": str(side.get("omgeving") or ""),
            "stage": str(side.get("stage") or "live"),
            "clientId": str(side.get("client_id") or ""),
            "clientSecretSet": bool(str(side.get("client_secret") or "").strip()),
            "connectors": {**DEFAULT_CONNECTORS, **(side.get("connectors") or {})},
        }
        if with_gebruiker:
            view["gebruiker"] = side.get("gebruiker") or None
        return view

    mapping = row.get("mapping") or {}
    return {
        "projectId": project_id,
        "projectName": project_name,
        "source": endpoint_view("source", with_gebruiker=False),
        "target": endpoint_view("target", with_gebruiker=True),
        "mapping": {
            "employees": {str(k): str(v) for k, v in (mapping.get("employees") or {}).items()},
            "files": {
                str(k): {"type": str(v.get("type", "")), "kenmerk": str(v.get("kenmerk", ""))}
                for k, v in (mapping.get("files") or {}).items()
                if isinstance(v, dict)
            },
        },
    }


def migration_environment(
    project_id: str,
    side: Side,
    project_name: str = "",
    *,
    omgeving: str | None = None,
    stage: AfasStage | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> AfasEnvironment:
    """One side (source or target) of a project's dossier migration, as an
    `AfasEnvironment` — built from that side's stored OAuth credentials,
    same shape `main.py`'s `project_environment()` builds for a normal
    project's customer environment. The four keyword overrides are for the
    connection-test form, where the point is to try what's on screen before
    it's saved; `None` means "use what is stored". May raise"""
    row = settings_row(project_id)
    endpoint = row.get(side) or {}

    def credential(key: str, sent: str | None) -> str:
        return (sent if sent is not None else str(endpoint.get(key) or "")).strip()

    resolved_stage = (
        stage if stage is not None else AfasStage.parse(endpoint.get("stage"), default=AfasStage.LIVE)
    )
    label = f"{project_name or row.get('projectName') or ''} ({side})".strip()
    return AfasEnvironment(
        omgevingnummer=(omgeving if omgeving is not None else str(endpoint.get("omgeving") or "")).strip(),
        stage=resolved_stage,
        client_id=credential("client_id", client_id),
        client_secret=credential("client_secret", client_secret),
        label=label,
    )


def connectors_for(row: dict, side: Side) -> dict:
    """The three GetConnector names this side reads — the defaults, with
    whatever that side's settings override."""
    return {**DEFAULT_CONNECTORS, **((row.get(side) or {}).get("connectors") or {})}


def gebruiker_for(row: dict) -> str | None:
    """The target's AFAS user id (`UsId`) to attribute an upload to — only
    ever read off the target, ignored on a source."""
    value = (row.get("target") or {}).get("gebruiker")
    text = str(value or "").strip()
    return text or None


# --- Mapping ----------------------------------------------------------------
# Translates the SOURCE side's employee id and dossier type/kenmerk into the
# TARGET's own vocabulary — environment-specific ids that aren't guaranteed to
# mean the same thing in two different AFAS environments. Applied to the
# source only; the target is always enumerated as-is (`Mapping()`, empty).


@dataclass
class Mapping:
    employees: dict[str, str] = field(default_factory=dict)
    files: dict[str, dict[str, str]] = field(default_factory=dict)


def mapping_from_row(row: dict) -> Mapping:
    stored = row.get("mapping") or {}
    return Mapping(
        employees={str(k): str(v) for k, v in (stored.get("employees") or {}).items()},
        files={
            str(k): {"type": str(v.get("type", "")), "kenmerk": str(v.get("kenmerk", ""))}
            for k, v in (stored.get("files") or {}).items()
            if isinstance(v, dict)
        },
    )


def _mapping_key(type_dossieritem: str, kenmerk: str) -> str:
    return f"{type_dossieritem}.{kenmerk}" if kenmerk else str(type_dossieritem)


def apply_mapping(record: dict, mapping: Mapping) -> dict:
    """Fill `record`'s `Medewerker`/`Type_dossieritem`/`Kenmerk` from its
    `*_oud` (pre-mapping) values, translated through `mapping`. Two key forms
    for `files`: exact (`"7.190"`) matches only that type+kenmerk; global
    (`"7.xx"`) matches any kenmerk under that type, longest prefix wins when
    several could match. Falls back to the source's own value when nothing
    matches — including when `mapping` is empty, which is how the target side
    (always called with `Mapping()`) ends up enumerated as-is."""
    medewerker_oud = record["Medewerker_oud"]
    record["Medewerker"] = mapping.employees.get(medewerker_oud, medewerker_oud)

    type_oud = record["Type_dossieritem_oud"]
    kenmerk_oud = record["Kenmerk_oud"]
    key = _mapping_key(type_oud, kenmerk_oud)

    exact = mapping.files.get(key)
    if exact is not None:
        record["Type_dossieritem"] = exact.get("type") or type_oud
        record["Kenmerk"] = exact.get("kenmerk") or kenmerk_oud
        return record

    best_prefix = ""
    best_value: dict | None = None
    for raw_key, value in mapping.files.items():
        if not raw_key.endswith(".xx"):
            continue
        prefix = raw_key[:-3].rstrip(".")
        # Whole segments only: `"7"` is a prefix of `"70.190"` as text, but type 70
        # is not type 7.
        covers = key == prefix or key.startswith(prefix + ".")
        if covers and len(prefix) > len(best_prefix):
            best_prefix, best_value = prefix, value

    if best_value is not None:
        record["Type_dossieritem"] = best_value.get("type") or type_oud
        record["Kenmerk"] = best_value.get("kenmerk") or kenmerk_oud
    else:
        record["Type_dossieritem"] = type_oud
        record["Kenmerk"] = kenmerk_oud
    return record


# --- Canonical records + diff ------------------------------------------------
# `build_records` reads the same three GetConnectors for either side of a
# migration — the source with its own mapping applied, the target with an
# empty one — so the diff below compares like with like: both sides expressed
# in the target's own vocabulary.


class ConnectorReadError(RuntimeError):
    """A GetConnector call itself failed (unreachable environment, rejected
    credentials, missing connector, …) — as opposed to succeeding with zero
    rows, which is a legitimate empty result. `_execute` lets this end the run
    as `"failed"` with the AFAS message attached, rather than reporting a
    connectivity failure as "0 records, nothing to transfer"."""


async def build_records(env: AfasEnvironment, connectors: dict[str, str], mapping: Mapping) -> list[dict]:
    """medewerkers ⋈ dossieritems ⋈ bijlagen, mapped and reduced to the 8
    canonical columns. Ported from the .md's `build_afas_df` without polars:
    the joins are plain dict-keyed lookups over the connectors' rows. A
    connector that genuinely has no rows short-circuits to `[]`, matching the
    ported module's `empty_canonical_df()` behaviour; a connector call that
    didn't *succeed* at all (`AfasResult.succeeded` false — unreachable,
    unauthorized, forbidden, not found) raises `ConnectorReadError` instead of
    being read as the same "empty" — `get_connector`'s `.rows` defaults to `[]`
    on a failed call too, so this distinction has to be made explicitly or a
    down environment reads as an empty one. No pagination is requested
    (`get_connector`'s default `skip=-1&take=-1`), so a connector configured
    to page will silently under-report rather than error, same known
    limitation the ported module accepted."""

    async def rows_of(connector: str) -> list[dict]:
        result = await get_connector(env, connectors[connector])
        if not result.succeeded:
            raise ConnectorReadError(f"{connectors[connector]}: {result.message}")
        return result.rows

    medewerkers_rows = await rows_of("medewerkers")
    if not medewerkers_rows:
        return []
    dossieritems_rows = await rows_of("dossieritems")
    if not dossieritems_rows:
        return []
    bijlagen_rows = await rows_of("bijlagen")
    if not bijlagen_rows:
        return []

    medewerker_names = {
        str(row.get("Medewerker")): str(row.get("Medewerker_naam") or "")
        for row in medewerkers_rows
    }
    bijlagen_by_dossieritem: dict[str, list[dict]] = {}
    for row in bijlagen_rows:
        bijlagen_by_dossieritem.setdefault(str(row.get("Dossieritem")), []).append(row)

    records: list[dict] = []
    for item in dossieritems_rows:
        medewerker_id = str(item.get("Medewerker"))
        if medewerker_id not in medewerker_names:
            continue
        for bijlage in bijlagen_by_dossieritem.get(str(item.get("Dossieritem")), []):
            record = {
                "Medewerker_oud": medewerker_id,
                "Medewerker_naam": medewerker_names[medewerker_id],
                "Onderwerp": str(item.get("Onderwerp") or ""),
                "Type_dossieritem_oud": str(item.get("Type_dossieritem") or ""),
                "Type_dossieritem_omschrijving": str(item.get("Type_dossieritem_omschrijving") or ""),
                "Kenmerk_oud": str(item.get("Kenmerk") or ""),
                "Bestand_naam_volledig": str(bijlage.get("Bestand_naam_volledig") or ""),
                "Bijlage_ID": str(bijlage.get("Bijlage_ID") or ""),
            }
            apply_mapping(record, mapping)
            records.append({column: record[column] for column in CANONICAL_COLUMNS})
    return records


def identity_key(record: dict) -> tuple[str, str, str]:
    """The 3-column identity a record is diffed on — replaces the ported
    module's `Unique_hash` (a polars-seeded hash of the same 3 columns): both
    sides of the diff are computed in this one process, so the plain tuple
    does the anti-join's job with no hashing needed. Must be computed
    identically (same columns) on both the mapped source and the unmapped
    target, or the diff silently over- or under-reports."""
    return (record["Medewerker"], record["Type_dossieritem"], record["Bestand_naam_volledig"])


def diff_records(source_records: list[dict], target_records: list[dict]) -> list[dict]:
    """Source records whose identity isn't already present at the target —
    what the run would transfer."""
    target_keys = {identity_key(r) for r in target_records}
    return [r for r in source_records if identity_key(r) not in target_keys]


# --- File transfer ------------------------------------------------------------


class TransferError(RuntimeError):
    """A single record failed to fetch or write; the run continues past it."""


class FetchError(TransferError):
    """Could not read the file bytes from the source AFAS environment."""


class WriteError(TransferError):
    """Could not write the file bytes to the target AFAS environment."""


def encode_filename(filename: str) -> str:
    """Escape a filename for an AFAS FileConnector URL path — AFAS's own
    (undocumented) escaping, not standard URL-encoding; a download 404s if
    this doesn't match exactly. Ported verbatim from
    `/migration/afas_afas_dossier.py` — do not replace with a generic
    URL-encoder, it will 404 on date-stamped filenames."""

    def encode_part(part: str) -> str:
        result: list[str] = []
        i = 0
        n = len(part)
        while i < n:
            c = part[i]
            if c.isalnum() or c == ".":
                result.append(c)
            elif c == " ":
                result.append("%20")
            elif c == "+":
                result.append("_2B")
            elif c == "&":
                result.append("_26")
            elif c == "%":
                result.append("_25")
            elif c == "_":
                result.append("_5F")
            elif c == "-":
                # Only escape '-' inside a digit run followed by another '-'
                # (date-stamped filenames); a literal hyphen elsewhere passes
                # through unchanged.
                if (
                    i > 0
                    and i + 2 < n
                    and part[i - 1].isdigit()
                    and part[i + 1 : i + 3].isdigit()
                    and "-" in part[i + 3 :]
                ):
                    result.append("_2D")
                else:
                    result.append("-")
            else:
                result.append(f"%{ord(c):02X}")
            i += 1
        return "".join(result)

    return "/".join(encode_part(p) for p in filename.split("/"))


async def fetch_bytes(source_env: AfasEnvironment, record: dict) -> str:
    """The file's bytes as AFAS's own base64 string — passed straight through
    to `write_record`, never decoded here (it's re-encoded exactly nowhere in
    this pipeline)."""
    endpoint = f"{record['Bijlage_ID']}/{encode_filename(record['Bestand_naam_volledig'])}"
    result = await download_file(source_env, endpoint)
    if not result.succeeded:
        raise FetchError(result.message)
    filedata = (result.payload or {}).get("filedata")
    if not isinstance(filedata, str):
        raise FetchError("AFAS gaf geen bestandsinhoud terug.")
    return filedata


async def write_record(
    target_env: AfasEnvironment, record: dict, file_data_b64: str, gebruiker: str | None
) -> None:
    """Upload one file as a `KnSubject`: linked to the employee via
    `KnSubjectLink`, the file itself via `KnSubjectAttachment`. Payload shape
    ported verbatim from `/migration/afas_afas_dossier.py` section 7 —
    confirmed against real AFAS environments in the other app. `file_data_b64`
    goes straight into `FileStream` unchanged — it is already AFAS's own
    base64 from `fetch_bytes`, not raw bytes, so it must not be re-encoded."""
    body = afas_envelope(
        "KnSubject",
        afas_element(
            {
                "StId": record["Type_dossieritem"],
                "Ds": record["Onderwerp"],
                "Da": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                "UsId": gebruiker,
                "St": True,
                "FvF1": record["Kenmerk"],
            },
            keys={"SbId": _SBID_SENTINEL},
            objects={
                "KnSubjectLink": {
                    "Fields": {"ToEm": True, "SfTp": 2, "SfId": record["Medewerker"]}
                },
                "KnSubjectAttachment": {
                    "Fields": {
                        "FileName": record["Bestand_naam_volledig"],
                        "FileStream": file_data_b64,
                    }
                },
            },
        ),
    )
    result = await insert_record(target_env, _UPLOAD_CONNECTOR, body)
    if not result.succeeded:
        raise WriteError(result.message)


# --- Background job engine ----------------------------------------------------
# Nothing like this exists elsewhere in the backend yet — every other route is
# request/response. A migration can involve many files, each a fetch+upload
# round trip to AFAS, so a run happens in an `asyncio.Task` the caller doesn't
# await: `start_run` returns as soon as the job exists, and `run`/
# `runs_for_project` let a route poll its `RunState` as it progresses.
#
# In-memory and per-process — acceptable given this backend's single-instance
# deploy constraint, but a restart loses in-progress/finished runs. A known
# limitation, not solved here: a run is cheap to start again.


@dataclass
class RunStats:
    total_source: int = 0
    already_present: int = 0
    to_transfer: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    failures: list[dict] = field(default_factory=list)


@dataclass
class RunState:
    run_id: str
    project_id: str
    dry_run: bool
    status: str = "running"  # "running" | "done" | "failed"
    started_at: str = ""
    finished_at: str | None = None
    stats: RunStats = field(default_factory=RunStats)
    error: str | None = None


class RunAlreadyInProgress(Exception):
    """This project already has a run in progress; the route turns this into
    a 409 rather than starting a second, overlapping one against the same two
    environments."""

    def __init__(self, run_id: str):
        super().__init__(f"Er loopt al een dossierconversie voor dit project ({run_id}).")
        self.run_id = run_id


_runs: dict[str, RunState] = {}
_runs_by_project: dict[str, list[str]] = {}
_active_run: dict[str, str] = {}




def run(run_id: str) -> RunState | None:
    return _runs.get(run_id)


def runs_for_project(project_id: str, limit: int = 10) -> list[RunState]:
    """This project's most recent runs, newest first."""
    ids = _runs_by_project.get(project_id, [])[-limit:]
    return [_runs[run_id] for run_id in reversed(ids) if run_id in _runs]


async def start_run(project_id: str, project_name: str, dry_run: bool) -> RunState:
    """Start a diff (dry run) or diff-and-transfer (live run) in the
    background and return immediately — the caller polls `run(run_id)` for
    progress. Refuses a second concurrent run for the same project."""
    if project_id in _active_run:
        raise RunAlreadyInProgress(_active_run[project_id])

    state = RunState(run_id=uuid4().hex, project_id=project_id, dry_run=dry_run, started_at=now_iso())
    _runs[state.run_id] = state
    _runs_by_project.setdefault(project_id, []).append(state.run_id)
    _active_run[project_id] = state.run_id
    asyncio.create_task(_execute(state, project_name))
    return state


async def _execute(state: RunState, project_name: str) -> None:
    """The diff + transfer loop. 1. build both sides' records. 2. diff on
    identity. 3. dry run stops there; a live run fetches+writes the diff, one
    record at a time, catching `TransferError` per record so one bad file
    doesn't abort the run — mirrors the ported module's `run()` exactly,
    minus the synchronous return."""
    try:
        row = settings_row(state.project_id)
        source_env = migration_environment(state.project_id, "source", project_name)
        target_env = migration_environment(state.project_id, "target", project_name)
        mapping = mapping_from_row(row)
        gebruiker = gebruiker_for(row)

        source_records = await build_records(source_env, connectors_for(row, "source"), mapping)
        target_records = await build_records(target_env, connectors_for(row, "target"), Mapping())

        state.stats.total_source = len(source_records)
        diff = diff_records(source_records, target_records)
        state.stats.to_transfer = len(diff)
        state.stats.already_present = state.stats.total_source - state.stats.to_transfer

        if state.dry_run:
            state.stats.skipped = state.stats.to_transfer
        else:
            for record in diff:
                try:
                    file_data = await fetch_bytes(source_env, record)
                    await write_record(target_env, record, file_data, gebruiker)
                    state.stats.succeeded += 1
                except TransferError as exc:
                    state.stats.failed += 1
                    state.stats.failures.append(
                        {
                            "medewerker": record.get("Medewerker"),
                            "bestand": record.get("Bestand_naam_volledig"),
                            "bijlageId": record.get("Bijlage_ID"),
                            "error": str(exc),
                        }
                    )
        state.status = "done"
    except Exception as exc:
        # A job's own failure (bad credentials, an unreachable environment, a
        # missing connector) must land in RunState for the polling route to
        # show, not vanish into an orphaned asyncio task.
        state.status = "failed"
        state.error = str(exc)
    finally:
        state.finished_at = now_iso()
        _active_run.pop(state.project_id, None)
