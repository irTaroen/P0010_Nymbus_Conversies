"""The woonplaatsen AFAS knows, one row per land + plaats: `json_files/afas_plaatsen.csv`
(AFAS's own export, `Land;Plaats`, UTF-8 with a BOM). The file is the store.

The values are kept as AFAS spells them, trailing spaces included (`Aruba ` and
`Aruba` are both in there): they are AFAS's values, and trimming them here would
hide which one AFAS actually holds.

From the Instellingen modal a sheet's unknown woonplaatsen and geboorteplaatsen
(Medewerkers, Uitzendkrachten — whose land is valid) are added (`add()`), and the
whole list downloaded (`as_csv()`). "Already there" is judged case-insensitively and
without the spaces around a value, so `Utrecht` from a sheet is not added beside
AFAS's `Utrecht `. Blocking file I/O.
"""

from __future__ import annotations

import csv
import io
import threading
from pathlib import Path

CSV_FILE = Path(__file__).parent / "json_files" / "afas_plaatsen.csv"

_lock = threading.Lock()


def _read(path: Path = CSV_FILE) -> list[tuple[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=";")
            return [
                (str(row.get("Land") or ""), str(row.get("Plaats") or ""))
                for row in reader
                if (row.get("Land") or "").strip() and (row.get("Plaats") or "").strip()
            ]
    except FileNotFoundError:
        return []


def _key(land: str, plaats: str) -> tuple[str, str]:
    return land.strip().upper(), plaats.strip().lower()


def _render(rows: list[tuple[str, str]]) -> str:
    """The seed file's shape: a `Land;Plaats` header, semicolons (what Excel expects
    on a Dutch machine), CRLF line ends. Sorted by land, then plaats, deduplicated."""
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow(["Land", "Plaats"])
    writer.writerows(sorted(set(rows)))
    return out.getvalue()


def add(places: list[tuple[str, str]]) -> tuple[int, int]:
    """Add every (land, plaats) the file doesn't hold yet. Returns how many were
    added and how many were already there (a repeat within `places` counts as
    already there)."""
    with _lock:
        rows = _read()
        held = {_key(land, plaats) for land, plaats in rows}
        new: list[tuple[str, str]] = []
        for land, plaats in places:
            key = _key(land, plaats)
            if key in held:
                continue
            held.add(key)
            new.append((land.strip().upper(), plaats.strip()))
        if new:
            temp = CSV_FILE.with_suffix(".csv.tmp")
            temp.write_text(_render(rows + new), encoding="utf-8-sig", newline="")
            temp.replace(CSV_FILE)
    return len(new), len(places) - len(new)


def as_csv() -> str:
    with _lock:
        return _render(_read())
