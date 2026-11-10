"""Writing the backend's small JSON stores to disk.

The custom modules, the field mappings (mirrored to the repo when running locally)
and the dossier-migration settings are each a JSON file the app rewrites whole. They all go through `write_json_atomic`, so each
gets the same two guarantees: a reader never sees a half-written file, and two
writes at once — saves run in worker threads — never share a temp file.

Reading stays with each store: they deliberately differ on what a missing or broken
file means (empty, skipped, or an error when that file is the only source).
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path


def write_json_atomic(path: Path, data: object) -> None:
    """Replace `path` with `data` as indented UTF-8 JSON: written beside it under a
    name of its own, then moved into place. The temp file is removed when the write
    fails, so a full disk doesn't leave litter beside the store."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temp.replace(path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
