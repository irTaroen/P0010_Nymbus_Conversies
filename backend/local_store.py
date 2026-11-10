"""The tool's own data, as JSON files on disk — the stand-in for everything that used
to live in the hosted version's AFAS environment and in Postgres.

    json_files/projects.json          committed  the conversion projects and their
                                                 conversion-wide settings
    json_files/project_modules.json   committed  per project: which modules it has,
                                                 their opleverdatum and stage, and the
                                                 figures of the last check or send
    json_files/client_tokens.json     ignored    per project: the AFAS OAuth client
                                                 id + secret of its test and live
                                                 environment — plain text, never in git
    json_files/state/send_progress.json  ignored the last send per module (refusals
                                                 quote client data: a BSN, an IBAN)

Every read goes back to disk, so a hand edit applies on the next request. Writes go
through `write_json_atomic` under one process-wide lock, so two saves can't
interleave a read-modify-write. Every function is **blocking** (file I/O); routes
call them directly — the files are small enough that a thread hop costs more than
the read.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Callable

from json_store import write_json_atomic

log = logging.getLogger(__name__)

JSON_DIR = Path(os.getenv("JSON_DIR") or Path(__file__).parent / "json_files")

PROJECTS_FILE = JSON_DIR / "projects.json"
PROJECT_MODULES_FILE = JSON_DIR / "project_modules.json"
CLIENT_TOKENS_FILE = JSON_DIR / "client_tokens.json"
SEND_PROGRESS_FILE = JSON_DIR / "state" / "send_progress.json"

CONVERSION_TYPES = ("standard", "facilitair", "dossier")
PROJECT_STATUSES = ("realisatie", "afgemeld")
STAGES = ("validatie", "test", "live", "afgerond")
TOKEN_KEYS = ("test_client_id", "test_client_secret", "live_client_id", "live_client_secret")

_lock = threading.RLock()


def _read(path: Path, default: Any) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default
    except (OSError, json.JSONDecodeError) as exc:
        # A broken file is a hand edit gone wrong. Saying so beats silently
        # answering "no projects" — and beats overwriting it on the next save.
        raise StoreError(f"{path.name} is niet te lezen: {exc}") from exc


class StoreError(Exception):
    """A store file exists but can't be read."""


def _update(path: Path, default: Any, change: Callable[[Any], Any]) -> Any:
    """Read, change, write — under the lock. `change` mutates the data in place;
    whatever it returns is ignored. The stored result is returned."""
    with _lock:
        data = _read(path, default)
        change(data)
        write_json_atomic(path, data)
        return data


# --- Projects -----------------------------------------------------------------


def _blank_project(project_id: str) -> dict:
    return {
        "id": project_id,
        "name": "",
        "omgeving": "",
        "conversionType": "standard",
        "status": "realisatie",
        "testProject": False,
        "intake": {"status": "niet_ingepland", "datum": ""},
        "hrmPeriodetabel": None,
        "livegangDatum": "",
        "appreoTestdatum": "",
        "customMappingModules": [],
    }


def projects() -> list[dict]:
    """Every project, in file order, each filled out with the defaults so callers
    never have to `.get()` a field that a hand-written entry left out."""
    with _lock:
        rows = _read(PROJECTS_FILE, {"projects": []}).get("projects", [])
    return [
        {**_blank_project(str(row.get("id", ""))), **row, "id": str(row.get("id", ""))}
        for row in rows
        if isinstance(row, dict) and str(row.get("id", "")).strip()
    ]


def project(project_id: str) -> dict | None:
    return next((row for row in projects() if row["id"] == project_id), None)


def save_project(project_id: str, fields: dict) -> dict:
    """Create the project or update the given fields of it; returns the stored row."""

    def change(data: dict) -> None:
        rows = data.setdefault("projects", [])
        row = next((r for r in rows if str(r.get("id")) == project_id), None)
        if row is None:
            row = _blank_project(project_id)
            rows.append(row)
        row.update(fields)

    _update(PROJECTS_FILE, {"projects": []}, change)
    stored = project(project_id)
    assert stored is not None
    return stored


def delete_project(project_id: str) -> bool:
    found = False

    def change(data: dict) -> None:
        nonlocal found
        rows = data.setdefault("projects", [])
        kept = [r for r in rows if str(r.get("id")) != project_id]
        found = len(kept) != len(rows)
        data["projects"] = kept

    _update(PROJECTS_FILE, {"projects": []}, change)
    _update(PROJECT_MODULES_FILE, {}, lambda data: data.pop(project_id, None))
    _update(CLIENT_TOKENS_FILE, {}, lambda data: data.pop(project_id, None))
    return found


# --- Modules per project ------------------------------------------------------


def project_modules(project_id: str) -> dict[str, dict]:
    """Module id -> the project's own state of that module:
    `{deliveryDate, stage, progress}` where `progress` is the last stamped figures
    (`None` until something stamped them)."""
    with _lock:
        data = _read(PROJECT_MODULES_FILE, {})
    modules = data.get(project_id) or {}
    return {
        str(module_id): {
            "deliveryDate": str(state.get("deliveryDate") or ""),
            "stage": state.get("stage") if state.get("stage") in STAGES else "validatie",
            "progress": state.get("progress") if isinstance(state.get("progress"), dict) else None,
        }
        for module_id, state in modules.items()
        if isinstance(state, dict)
    }


def set_project_modules(project_id: str, module_ids: list[str]) -> None:
    """Make the project carry exactly these modules. A module kept keeps its state;
    a module dropped loses it."""

    def change(data: dict) -> None:
        current = data.get(project_id) or {}
        data[project_id] = {m: current.get(m) or {"stage": "validatie"} for m in module_ids}

    _update(PROJECT_MODULES_FILE, {}, change)


def update_project_module(project_id: str, module_id: str, fields: dict) -> dict:
    """Merge `fields` into one module's state; the module must be on the project."""

    def change(data: dict) -> None:
        modules = data.setdefault(project_id, {})
        if module_id not in modules:
            raise KeyError(module_id)
        state = modules[module_id] or {}
        state.update(fields)
        modules[module_id] = state

    _update(PROJECT_MODULES_FILE, {}, change)
    return project_modules(project_id)[module_id]


# --- Client tokens ------------------------------------------------------------


def tokens(project_id: str) -> dict[str, str]:
    """The project's four credential values, `""` for any not set."""
    with _lock:
        data = _read(CLIENT_TOKENS_FILE, {})
    row = data.get(project_id) or {}
    return {key: str(row.get(key) or "").strip() for key in TOKEN_KEYS}


def all_tokens() -> dict[str, dict[str, str]]:
    with _lock:
        data = _read(CLIENT_TOKENS_FILE, {})
    return {
        str(pid): {key: str((row or {}).get(key) or "").strip() for key in TOKEN_KEYS}
        for pid, row in data.items()
    }


def save_tokens(project_id: str, values: dict[str, str]) -> None:
    def change(data: dict) -> None:
        row = data.setdefault(project_id, {})
        for key in TOKEN_KEYS:
            if key in values:
                row[key] = values[key]

    _update(CLIENT_TOKENS_FILE, {}, change)


# --- Last send per module -----------------------------------------------------


def send_rows(project_id: str) -> dict[str, dict]:
    with _lock:
        data = _read(SEND_PROGRESS_FILE, {})
    return dict(data.get(project_id) or {})


def save_send_row(project_id: str, module_id: str, row: dict) -> None:
    _update(
        SEND_PROGRESS_FILE, {}, lambda data: data.setdefault(project_id, {}).update({module_id: row})
    )


def clear_send_row(project_id: str, module_id: str) -> None:
    _update(
        SEND_PROGRESS_FILE, {}, lambda data: (data.get(project_id) or {}).pop(module_id, None)
    )
