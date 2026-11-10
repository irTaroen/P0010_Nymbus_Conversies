"""AFAS -> AFAS dossier conversion -- standalone migration module.

Self-contained port of this repo's ``afas_to_afas`` mode: everything under
``core/afas/*``, ``core/engine.py``, ``core/models.py``, ``core/mapping.py``,
``core/config.py``, ``core/secrets.py`` and ``core/progress.py`` that is
reachable when both the source and the target are AFAS environments. The
``local`` adapters and the ``afas_to_local`` / ``local_to_afas`` modes are
intentionally NOT ported here -- this file is AFAS <-> AFAS only.

This is a LIBRARY, not a CLI: the target app is expected to build an
``AfasToAfasConfig`` (directly, or via ``load_config`` from a YAML file) and
call ``run()`` itself from its own UI/backend/CLI layer.

Companion doc: ``afas_afas_dossier.md`` in this same directory explains the
concepts (canonical schema, ``Unique_hash`` diff, mapping, AFAS API specifics)
and has a full function/class reference plus integration steps. Read that
file first if you are rebuilding this in another project.

Dependencies (see this repo's requirements.txt for pinned versions):
    polars, requests, python-dotenv, PyYAML (only if you use load_config)
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import polars as pl
import requests
from dotenv import load_dotenv

# ============================================================================
# 1. Constants
# ============================================================================

# Standard Nymbus conversion connectors; a client overrides only the ones that
# differ (see AfasEndpointConfig.connectors / config.yaml `connectors:`).
DEFAULT_CONNECTORS = {
    "medewerkers": "Nymbus_Conversie_Medewerkers",
    "dossieritems": "Nymbus_Conversie_Dossieritems",
    "bijlagen": "Nymbus_Conversie_Bijlagen",
}

_DEFAULT_FILTER = "?skip=-1&take=-1"  # no paging -- connectors are expected to return everything in one call
_UPLOAD_CONNECTOR = "KnSubject"
_SBID_SENTINEL = 9999999  # placeholder @SbId AFAS expects when creating a new KnSubject (not a real id lookup)

# Canonical columns every source/sink DataFrame carries (see section 5).
CANONICAL_COLUMNS: list[str] = [
    "Medewerker",
    "Medewerker_naam",
    "Onderwerp",
    "Type_dossieritem",
    "Type_dossieritem_omschrijving",
    "Kenmerk",
    "Bestand_naam_volledig",
    "Bijlage_ID",
]

CANONICAL_SCHEMA: dict[str, pl.DataType] = {
    "Medewerker": pl.Utf8,
    "Medewerker_naam": pl.Utf8,
    "Onderwerp": pl.Utf8,
    "Type_dossieritem": pl.Utf8,
    "Type_dossieritem_omschrijving": pl.Utf8,
    "Kenmerk": pl.Utf8,
    "Bestand_naam_volledig": pl.Utf8,
    "Bijlage_ID": pl.Utf8,
    "Unique_id": pl.Utf8,
    "Unique_hash": pl.UInt64,
}

_HASH_SEED = 0  # fixed seed -> Unique_hash is reproducible for the same identity columns
_IDENTITY_COLUMNS = ["Medewerker", "Type_dossieritem", "Bestand_naam_volledig"]

# secret_ref ids are resolved from this .env file (falls back to real env vars,
# which always take precedence). Point this at wherever the target app keeps
# its secrets if it differs from "next to this file".
_ENV_PATH = Path(__file__).resolve().parent / ".env"
_env_loaded = False


# ============================================================================
# 2. Errors
# ============================================================================

class TransferError(RuntimeError):
    """A single record failed to fetch or write; the run continues past it."""


class FetchError(TransferError):
    """Could not read the file bytes from the source AFAS environment."""


class WriteError(TransferError):
    """Could not write the file bytes to the target AFAS environment."""


class SecretNotFoundError(RuntimeError):
    """A config references a secret_ref that isn't set in the environment/.env."""


# ============================================================================
# 3. Secrets  (secret_ref -> token, resolved from .env at runtime)
# ============================================================================

def resolve_secret(secret_ref: str) -> str:
    """Return the token string for ``secret_ref``. Loads ``.env`` once per process.

    Real environment variables take precedence over the ``.env`` file. A token
    must be the DECODED AFAS token XML (e.g.
    ``"<token><version>1</version><data>...</data></token>"``), never
    pre-base64-encoded -- the encoding happens per-request in
    ``afas_auth_header``.
    """
    global _env_loaded
    if not _env_loaded:
        load_dotenv(dotenv_path=_ENV_PATH, override=False)
        _env_loaded = True
    value = os.environ.get(secret_ref)
    if not value:
        raise SecretNotFoundError(
            f"Secret '{secret_ref}' is not set. Add it to {_ENV_PATH.name} "
            f"(or the environment) as '{secret_ref}=<token xml>'."
        )
    return value


# ============================================================================
# 4. Encoding  (auth header + AFAS FileConnector filename escaping)
# ============================================================================

def encode_base64_token(token_xml: str) -> str:
    """Base64-encode a decoded AFAS token XML string."""
    return base64.b64encode(token_xml.encode("utf-8")).decode("utf-8")


def afas_auth_header(token_xml: str) -> str:
    """Full ``Authorization`` header value for AFAS REST: ``AfasToken <base64>``."""
    return f"AfasToken {encode_base64_token(token_xml)}"


def encode_filename(filename: str) -> str:
    """Escape a filename for an AFAS FileConnector URL path.

    This is AFAS's own escaping scheme, not standard URL-encoding -- a file
    download 404s if this doesn't match exactly what AFAS expects.
    """

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
                # (date-stamped filenames); a literal hyphen elsewhere passes through.
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


# ============================================================================
# 5. Canonical model + Unique_hash contract
# ============================================================================

def add_unique_hash(df: pl.DataFrame) -> pl.DataFrame:
    """Add ``Unique_id`` (human-readable) and ``Unique_hash`` (the diff key).

    Both the source and target DataFrames must compute this identically (same
    identity columns, same string values) for the anti-join in ``run()`` to be
    meaningful -- see afas_afas_dossier.md section on the hash contract.
    """
    df = df.with_columns(
        pl.concat_str(
            [pl.col(c).cast(pl.Utf8) for c in _IDENTITY_COLUMNS],
            separator="-",
        ).alias("Unique_id")
    )
    return df.with_columns(pl.col("Unique_id").hash(seed=_HASH_SEED).alias("Unique_hash"))


def empty_canonical_df() -> pl.DataFrame:
    """A zero-row DataFrame with the full canonical schema (incl. hash columns)."""
    return pl.DataFrame(schema=CANONICAL_SCHEMA)


def finalize(df: pl.DataFrame) -> pl.DataFrame:
    """Coerce ``df`` to the canonical column set/dtypes and append the hash columns."""
    if df.is_empty():
        return empty_canonical_df()
    missing = [c for c in CANONICAL_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"DataFrame is missing canonical columns: {missing}")
    df = df.select([pl.col(c).cast(CANONICAL_SCHEMA[c]) for c in CANONICAL_COLUMNS])
    return add_unique_hash(df)


# ============================================================================
# 6. Mapping  (source Type_dossieritem/Kenmerk/Medewerker -> target vocabulary)
# ============================================================================

@dataclass
class Mapping:
    """Translates source-side dossier classification/employee ids into the
    TARGET AFAS environment's own ids. Only ever applied to the source side --
    the target/sink enumerates itself as-is (see AfasSink.existing_index_df)."""

    files: dict[str, dict] = field(default_factory=dict)
    employees: dict[str, str] = field(default_factory=dict)


def apply_employee_mapping(df: pl.DataFrame, employees: dict[str, str]) -> pl.DataFrame:
    """Map ``Medewerker_oud`` -> ``Medewerker`` (target employee id)."""
    if employees:
        return df.with_columns(
            pl.when(pl.col("Medewerker_oud").is_in(list(employees.keys())))
            .then(pl.col("Medewerker_oud").replace(employees))
            .otherwise(pl.col("Medewerker_oud"))
            .alias("Medewerker")
        )
    return df.with_columns(pl.col("Medewerker_oud").alias("Medewerker"))


def apply_file_mapping(df: pl.DataFrame, files: dict[str, dict]) -> pl.DataFrame:
    """Map ``Type_dossieritem_oud``/``Kenmerk_oud`` -> target values via the
    ``Mapping`` column (``"<Type>.<Kenmerk>"``). Keys are either exact
    (``"7.190"``) or a global prefix suffixed with ``.xx`` (``"7.xx"`` matches
    any Kenmerk under Type 7). Falls back to the ``*_oud`` value when nothing
    matches (or when no file mapping is configured at all)."""
    if not files:
        return df.with_columns(
            pl.col("Type_dossieritem_oud").alias("Type_dossieritem"),
            pl.col("Kenmerk_oud").alias("Kenmerk"),
        )

    exact_map: dict[str, dict] = {}
    global_map: dict[str, dict] = {}
    for key, value in files.items():
        if key.endswith(".xx"):
            global_map[key[:-3].rstrip(".")] = value
        else:
            exact_map[key] = value

    exact_type_map = {k: v["type"] for k, v in exact_map.items()}
    exact_kenmerk_map = {k: v["kenmerk"] for k, v in exact_map.items()}

    mapping_col = pl.col("Mapping").cast(str)
    sorted_global = sorted(global_map.items(), key=lambda x: len(x[0]), reverse=True)  # longest prefix wins

    def build_expr(exact: dict, key: str, oud_col: str, alias: str) -> pl.Expr:
        expr = pl.when(mapping_col.is_in(exact.keys())).then(mapping_col.replace(exact))
        for prefix, values in sorted_global:
            # Whole segments only: type 70 must not pick up a `7.xx` rule.
            covers = (mapping_col == prefix) | mapping_col.str.starts_with(prefix + ".")
            expr = expr.when(covers).then(pl.lit(values[key]))
        return expr.otherwise(pl.col(oud_col)).alias(alias)

    type_expr = build_expr(exact_type_map, "type", "Type_dossieritem_oud", "Type_dossieritem")
    kenmerk_expr = build_expr(exact_kenmerk_map, "kenmerk", "Kenmerk_oud", "Kenmerk")
    return df.with_columns([type_expr, kenmerk_expr])


def apply_mapping(df: pl.DataFrame, mapping: Mapping) -> pl.DataFrame:
    """Apply employee then file mapping. ``df`` must carry the ``*_oud`` columns
    (and a ``Mapping`` column when file rules are present)."""
    df = apply_employee_mapping(df, mapping.employees)
    df = apply_file_mapping(df, mapping.files)
    return df


def load_mapping_from_pyfile(path: Path) -> Mapping:
    """Load a legacy-style ``mapping.py`` (top-level ``mapping_files`` /
    ``mapping_employees`` dicts, e.g. ``projects/mbs/mapping_mbs.py``)."""
    spec = importlib.util.spec_from_file_location(f"_mapping_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    files = {str(k): v for k, v in getattr(module, "mapping_files", {}).items()}
    employees = {str(k): str(v) for k, v in getattr(module, "mapping_employees", {}).items()}
    return Mapping(files=files, employees=employees)


# ============================================================================
# 7. Config  (one AFAS environment on each side, each independently TEST/LIVE)
# ============================================================================

class AfasEnv(str, Enum):
    LIVE = "LIVE"
    TEST = "TEST"


@dataclass
class AfasEndpointConfig:
    """One AFAS environment -- used as either the source or the target."""

    environment_id: int
    secret_ref: str  # id resolved via resolve_secret(), never a literal token
    env: AfasEnv = AfasEnv.TEST  # TEST -> *.resttest.afas.online, LIVE -> *.rest.afas.online
    connectors: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_CONNECTORS))
    gebruiker: str | None = None  # AFAS UsId -- only read when this endpoint is used as the TARGET


@dataclass
class AfasToAfasConfig:
    name: str
    source: AfasEndpointConfig
    target: AfasEndpointConfig
    mapping: Mapping = field(default_factory=Mapping)
    dry_run: bool = True  # default to safe; the caller overrides per-invocation to go live


def load_config(path: str | Path) -> AfasToAfasConfig:
    """Load a client ``config.yaml`` (AFAS -> AFAS shape only).

    See afas_afas_dossier.md section "Configuration shape" for the full YAML
    schema. Requires PyYAML (only imported here, so the rest of this module
    works without it).
    """
    import yaml

    path = Path(path)
    if path.is_dir():
        path = path / "config.yaml"
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    config_dir = path.parent

    def _endpoint(d: dict[str, Any]) -> AfasEndpointConfig:
        connectors = dict(DEFAULT_CONNECTORS)
        connectors.update(d.get("connectors") or {})
        return AfasEndpointConfig(
            environment_id=int(d["environment_id"]),
            secret_ref=str(d["secret_ref"]),
            env=AfasEnv(str(d.get("env", "TEST")).upper()),
            connectors=connectors,
            gebruiker=(str(d["gebruiker"]) if d.get("gebruiker") is not None else None),
        )

    mapping_raw = raw.get("mapping") or {}
    if mapping_raw.get("file"):
        mapping = load_mapping_from_pyfile(config_dir / mapping_raw["file"])
    else:
        mapping = Mapping(
            files={str(k): v for k, v in (mapping_raw.get("files") or {}).items()},
            employees={str(k): str(v) for k, v in (mapping_raw.get("employees") or {}).items()},
        )

    return AfasToAfasConfig(
        name=str(raw.get("name", config_dir.name)),
        source=_endpoint(raw["source"]),
        target=_endpoint(raw["target"]),
        mapping=mapping,
        dry_run=bool((raw.get("options") or {}).get("dry_run", True)),
    )


# ============================================================================
# 8. AfasClient  (thin REST wrapper)
# ============================================================================

_REQUEST_TIMEOUT_S = 30  # AFAS has no documented SLA; bound every call so a hung request can't hang a whole run
_MAX_ATTEMPTS = 3  # 1 initial try + 2 retries
_RETRY_BACKOFF_S = 2  # doubles each retry: 2s, 4s


def _request(method: str, url: str, **kwargs) -> requests.Response:
    """``requests.request`` with a timeout and retry-on-transient-failure.

    Retries connection errors/timeouts and 5xx responses (network/AFAS-side
    hiccups, worth retrying); a 4xx (bad auth, bad payload) is returned
    immediately since retrying it won't change the outcome -- the caller's own
    status-code handling deals with it exactly as before. After the final
    attempt, whatever happened (exception or 5xx) is surfaced to the caller
    rather than retried further.

    Only GETs are retried. A POST that timed out or came back 5xx may still have
    been written -- AFAS can store the ``KnSubject`` and fail afterwards -- so a
    retry would upload the same file twice. It gets one attempt, and the run
    reports the failure for a person to check.
    """
    kwargs.setdefault("timeout", _REQUEST_TIMEOUT_S)
    attempts = _MAX_ATTEMPTS if method.upper() == "GET" else 1
    for attempt in range(attempts):
        is_last = attempt == attempts - 1
        try:
            r = requests.request(method, url, **kwargs)
        except requests.exceptions.RequestException:
            if is_last:
                raise
            time.sleep(_RETRY_BACKOFF_S * (2**attempt))
            continue
        if r.status_code < 500 or is_last:
            return r
        time.sleep(_RETRY_BACKOFF_S * (2**attempt))
    raise AssertionError("unreachable")  # the is_last branch above always returns or raises


class AfasClient:
    def __init__(self, environment_id: int, token_xml: str, env: AfasEnv = AfasEnv.TEST):
        self.environment_id = environment_id
        self.env = env
        sub = "rest" if env is AfasEnv.LIVE else "resttest"
        base = f"https://{environment_id}.{sub}.afas.online/ProfitRestServices"
        self.connectors_url = f"{base}/connectors/"
        self.fileconnector_url = f"{base}/fileconnector/"
        self.metainfo_url = f"{base}/metainfo/get"
        self._auth = afas_auth_header(token_xml)

    @classmethod
    def from_endpoint(cls, endpoint: AfasEndpointConfig) -> "AfasClient":
        token_xml = resolve_secret(endpoint.secret_ref)
        return cls(endpoint.environment_id, token_xml, endpoint.env)

    @property
    def _json_headers(self) -> dict:
        return {"authorization": self._auth, "content-type": "application/json; charset=utf-8;"}

    # -- reads -------------------------------------------------------------
    def test_connection(self) -> bool:
        r = _request("GET", self.metainfo_url, headers=self._json_headers)
        return r.status_code == 200

    def get_data(self, connector: str, filters: str = _DEFAULT_FILTER) -> list[dict]:
        r = _request("GET", f"{self.connectors_url}{connector}{filters}", headers=self._json_headers)
        if r.status_code == 200:
            return r.json().get("rows", [])
        return []

    def download_file(self, file_endpoint: str) -> tuple[str | None, object]:
        """Download a file from the FileConnector.

        Returns ``(base64_str, 200)`` on success, or ``(None, "<status> - <msg>")``.
        """
        r = _request(
            "GET",
            f"{self.fileconnector_url}{file_endpoint}",
            headers={"Authorization": self._auth},
        )
        if r.status_code == 200:
            return r.json()["filedata"], 200

        external_message = ""
        try:
            external_message = r.json().get("externalMessage") or ""
        except ValueError:
            pass
        return None, f"{r.status_code} - {external_message or 'Unknown AFAS error'}"

    # -- writes ------------------------------------------------------------
    def create(self, connector: str, payload: str) -> tuple[int, object]:
        r = _request("POST", f"{self.connectors_url}{connector}", headers=self._json_headers, data=payload)
        if r.status_code == 201:
            return r.status_code, r.json()
        try:
            msg = r.json().get("externalMessage", r.text)
        except ValueError:
            msg = r.text
        return r.status_code, f"{r.status_code} - {msg}"


# ============================================================================
# 9. Source / Sink
#    build_afas_df is shared -- a sink enumerates the target with the exact
#    same function a source would use to enumerate itself.
# ============================================================================

def build_afas_df(client: AfasClient, connectors: dict[str, str], mapping: Mapping) -> pl.DataFrame:
    """Join medewerkers + dossieritems + bijlagen into one canonical DataFrame."""
    medewerkers = client.get_data(connectors["medewerkers"])
    dossieritems = client.get_data(connectors["dossieritems"])
    if not medewerkers or not dossieritems:
        return empty_canonical_df()

    df_medewerkers = pl.DataFrame(medewerkers)
    df_dossieritems = pl.DataFrame(dossieritems)
    df = df_medewerkers.join(df_dossieritems, on="Medewerker", how="inner")

    bijlagen = client.get_data(connectors["bijlagen"])
    if not bijlagen:
        return empty_canonical_df()
    df_bijlagen = pl.DataFrame(
        bijlagen,
        schema_overrides={"Bijlage_ID": pl.Utf8},
        infer_schema_length=None,
    )
    df = df.join(df_bijlagen, on="Dossieritem", how="inner")

    # Build the "<Type>.<Kenmerk>" mapping key, then rename source cols to *_oud.
    df = (
        df.select(
            [
                "Medewerker",
                "Medewerker_naam",
                "Onderwerp",
                "Dossieritem",
                "Type_dossieritem",
                "Type_dossieritem_omschrijving",
                "Kenmerk",
                "Bestand_naam_volledig",
                "Bijlage_ID",
            ]
        )
        .with_columns(
            pl.when(pl.col("Kenmerk").is_null() | (pl.col("Kenmerk").cast(pl.Utf8) == ""))
            .then(pl.col("Type_dossieritem").cast(pl.Utf8))
            .otherwise(
                pl.concat_str(
                    [
                        pl.col("Type_dossieritem").cast(pl.Utf8),
                        pl.lit("."),
                        pl.col("Kenmerk").cast(pl.Utf8),
                    ]
                )
            )
            .alias("Mapping")
        )
        .rename(
            {
                "Medewerker": "Medewerker_oud",
                "Type_dossieritem": "Type_dossieritem_oud",
                "Kenmerk": "Kenmerk_oud",
            }
        )
    )

    df = apply_mapping(df, mapping)
    return finalize(df)


class AfasSource:
    """Reads records and file bytes from the SOURCE AFAS environment."""

    def __init__(self, client: AfasClient, connectors: dict[str, str], mapping: Mapping):
        self.client = client
        self.connectors = connectors
        self.mapping = mapping

    def build_df(self) -> pl.DataFrame:
        return build_afas_df(self.client, self.connectors, self.mapping)

    def fetch_bytes(self, record: dict) -> str:
        """Return the file as a base64 string, or raise FetchError."""
        endpoint = f"{record['Bijlage_ID']}/{encode_filename(record['Bestand_naam_volledig'])}"
        data, status = self.client.download_file(endpoint)
        if data is None:
            raise FetchError(str(status))
        return data


def build_upload_payload(record: dict, file_data_base64: str, user_id: str | None) -> str:
    """Build the KnSubject JSON payload for one file upload."""
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    payload = {
        "KnSubject": {
            "Element": {
                "@SbId": _SBID_SENTINEL,
                "Fields": {
                    "StId": record["Type_dossieritem"],
                    "Ds": record["Onderwerp"],
                    "Da": now,
                    "UsId": user_id,
                    "St": True,
                    "FvF1": record["Kenmerk"],
                },
                "Objects": [
                    {
                        "KnSubjectLink": {
                            "Element": {
                                "Fields": {"ToEm": True, "SfTp": 2, "SfId": record["Medewerker"]}
                            }
                        }
                    },
                    {
                        "KnSubjectAttachment": {
                            "Element": {
                                "Fields": {
                                    "FileName": record["Bestand_naam_volledig"],
                                    "FileStream": file_data_base64,
                                }
                            }
                        }
                    },
                ],
            }
        }
    }
    return json.dumps(payload)


class AfasSink:
    """Uploads records into the TARGET AFAS environment."""

    def __init__(self, client: AfasClient, connectors: dict[str, str], gebruiker: str | None):
        self.client = client
        self.connectors = connectors
        self.gebruiker = gebruiker

    def existing_index_df(self) -> pl.DataFrame:
        """Records already present at the target (for the diff).

        A sink never remaps -- it enumerates the target as-is, hence the empty
        ``Mapping()`` regardless of what the source side's mapping is.
        """
        return build_afas_df(self.client, self.connectors, Mapping())

    def write(self, record: dict, file_data_base64: str) -> None:
        payload = build_upload_payload(record, file_data_base64, self.gebruiker)
        status, message = self.client.create(_UPLOAD_CONNECTOR, payload)
        if status != 201:
            raise WriteError(str(message))


# ============================================================================
# 10. Progress / stats
# ============================================================================

@dataclass
class RunStats:
    total_source: int = 0
    already_present: int = 0
    to_transfer: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    failures: list[dict] = field(default_factory=list)

    @property
    def done(self) -> int:
        return self.succeeded + self.failed + self.skipped

    def as_dict(self) -> dict:
        return {
            "total_source": self.total_source,
            "already_present": self.already_present,
            "to_transfer": self.to_transfer,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "skipped": self.skipped,
            "failures": self.failures,
        }


class ProgressReporter:
    """Base reporter -- no-op hooks. Override to route run events elsewhere
    (e.g. push each call onto an SSE/WebSocket stream for a web UI)."""

    def run_start(self, client: str, stats: RunStats) -> None: ...

    def diff_ready(self, stats: RunStats) -> None: ...

    def item_ok(self, record: dict, stats: RunStats) -> None: ...

    def item_failed(self, record: dict, message: str, stats: RunStats) -> None: ...

    def item_skipped(self, record: dict, message: str, stats: RunStats) -> None: ...

    def run_end(self, stats: RunStats) -> None: ...


class ConsoleProgress(ProgressReporter):
    """Prints progress to stdout -- handy while wiring this up standalone."""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def run_start(self, client: str, stats: RunStats) -> None:
        print(f"\n== {client} :: afas_to_afas ==")

    def diff_ready(self, stats: RunStats) -> None:
        print(f"Source records:    {stats.total_source}")
        print(f"Already at target: {stats.already_present}")
        print(f"To transfer:       {stats.to_transfer}\n")

    def item_ok(self, record: dict, stats: RunStats) -> None:
        if self.verbose:
            print(
                f"[{stats.done}/{stats.to_transfer}] OK   "
                f"{record.get('Medewerker')} - {record.get('Bestand_naam_volledig')}"
            )

    def item_failed(self, record: dict, message: str, stats: RunStats) -> None:
        print(
            f"[{stats.done}/{stats.to_transfer}] FAIL "
            f"{record.get('Medewerker')} - {record.get('Bestand_naam_volledig')}: {message}"
        )

    def item_skipped(self, record: dict, message: str, stats: RunStats) -> None:
        if self.verbose:
            print(
                f"[{stats.done}/{stats.to_transfer}] SKIP "
                f"{record.get('Medewerker')} - {record.get('Bestand_naam_volledig')}: {message}"
            )

    def run_end(self, stats: RunStats) -> None:
        print(
            f"\nDone. transferred={stats.succeeded} "
            f"failed={stats.failed} skipped={stats.skipped}"
        )
        if stats.failed:
            print(f"({stats.failed} failures -- see run result for details)")


# ============================================================================
# 11. Engine  (build source/target pair -> diff -> transfer)
# ============================================================================

@dataclass
class RunResult:
    client: str
    stats: RunStats
    dry_run: bool
    duration_s: float


def build_run(config: AfasToAfasConfig) -> tuple[AfasSource, AfasSink]:
    """Instantiate the Source/Sink pair for a config. Split out from run() so
    a caller can inject fakes for testing (see the offline smoke test in the
    original repo, tests/test_engine_smoke.py, for the pattern)."""
    source = AfasSource(AfasClient.from_endpoint(config.source), config.source.connectors, config.mapping)
    sink = AfasSink(AfasClient.from_endpoint(config.target), config.target.connectors, config.target.gebruiker)
    return source, sink


def run(
    config: AfasToAfasConfig,
    source: AfasSource | None = None,
    sink: AfasSink | None = None,
    reporter: ProgressReporter | None = None,
    dry_run: bool | None = None,
) -> RunResult:
    """The diff + transfer loop -- the one code path for every AFAS -> AFAS run.

    1. build_df() on the source, existing_index_df() on the target.
    2. Anti-join on Unique_hash -> the rows that exist at the source but not
       at the target.
    3. If dry_run: report the diff and stop (nothing fetched or written).
       Otherwise: fetch_bytes() from the source and write() to the target for
       every diff row, catching TransferError per-record so one failure does
       not abort the run.
    """
    reporter = reporter or ConsoleProgress()
    if source is None or sink is None:
        source, sink = build_run(config)
    dry_run = config.dry_run if dry_run is None else dry_run

    stats = RunStats()
    reporter.run_start(config.name, stats)
    started = time.monotonic()

    df_source = source.build_df()
    df_target = sink.existing_index_df()

    stats.total_source = df_source.height
    if df_target.height:
        df_diff = df_source.join(df_target, on="Unique_hash", how="anti")
    else:
        df_diff = df_source
    stats.to_transfer = df_diff.height
    stats.already_present = stats.total_source - stats.to_transfer
    reporter.diff_ready(stats)

    if dry_run:
        stats.skipped = stats.to_transfer
        elapsed = time.monotonic() - started
        reporter.run_end(stats)
        return RunResult(config.name, stats, True, elapsed)

    for record in df_diff.iter_rows(named=True):
        try:
            data = source.fetch_bytes(record)
            sink.write(record, data)
            stats.succeeded += 1
            reporter.item_ok(record, stats)
        except TransferError as e:
            stats.failed += 1
            stats.failures.append(
                {
                    "Medewerker": record.get("Medewerker"),
                    "Bestand": record.get("Bestand_naam_volledig"),
                    "Bijlage_ID": record.get("Bijlage_ID"),
                    "error": str(e),
                }
            )
            reporter.item_failed(record, str(e), stats)

    elapsed = time.monotonic() - started
    reporter.run_end(stats)
    return RunResult(config.name, stats, False, elapsed)
