"""The store behind the field mappings ("Field mappings" in `main.py`): plain JSON
files in the repo, committed like any other source.

    json_files/mappings/modules/<moduleId>.json                 the standard mapping
    json_files/mappings/clients/<projectId>/<moduleId>.json     a client's own copy

A file is one mapping document, written exactly as the editor saved it (key order
kept — a `valueMap` is read in the order it was typed). Saving in the app writes the
file, so a mapping change is a `git diff` like any other; editing the file by hand is
equally fine — every read goes back to disk.

Every function here is **blocking** (file I/O). `main.py` calls them through
`asyncio.to_thread`.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from json_store import write_json_atomic

log = logging.getLogger(__name__)

# The groups a mapping may live in: `modules` for the standard mappings (schemas from
# the AFAS OAS), `clients` per project (schemas from that client's environment).
GROUPS = ("modules", "clients")

MAPPINGS_DIR = Path(__file__).parent / "json_files" / "mappings"


def _path(group: str, project_id: str, key: str) -> Path:
    if group not in GROUPS:
        raise ValueError(f"Onbekende groep '{group}'.")
    if group == "clients":
        return MAPPINGS_DIR / group / project_id / f"{key}.json"
    return MAPPINGS_DIR / group / f"{key}.json"


def _read(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as handle:
            document = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Koppeling %s is niet te lezen: %s", path, exc)
        return None
    return document if isinstance(document, dict) else None


def entries() -> list[tuple[str, str, str, dict]]:
    """Every stored mapping as `(group, project_id, key, document)`."""
    found: list[tuple[str, str, str, dict]] = []
    for path in sorted((MAPPINGS_DIR / "modules").glob("*.json")):
        if (document := _read(path)) is not None:
            found.append(("modules", "", path.stem, document))
    for path in sorted((MAPPINGS_DIR / "clients").glob("*/*.json")):
        if (document := _read(path)) is not None:
            found.append(("clients", path.parent.name, path.stem, document))
    return found


def get(group: str, project_id: str, key: str) -> dict | None:
    return _read(_path(group, project_id, key))


def keys(group: str, project_id: str = "") -> set[str]:
    folder = MAPPINGS_DIR / group / project_id if group == "clients" else MAPPINGS_DIR / group
    return {path.stem for path in folder.glob("*.json")}


def put(group: str, project_id: str, key: str, document: dict) -> None:
    write_json_atomic(_path(group, project_id, key), document)


def put_if_missing(group: str, project_id: str, key: str, document: dict) -> bool:
    """Write the mapping only when there is none yet; True when it was written."""
    if _path(group, project_id, key).exists():
        return False
    put(group, project_id, key, document)
    return True


def delete(group: str, project_id: str, key: str) -> bool:
    try:
        _path(group, project_id, key).unlink()
    except FileNotFoundError:
        return False
    return True
