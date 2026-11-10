"""A mapped field whose value is **looked up in the AFAS environment being written to**.

A third kind of source beside a column and a fixed value, and closest to a column's
`valueMap`: the cell is still read, but what goes into the body is what AFAS itself
holds against it. `erp-abonnementen` is the case that made it: `FbSubscription#BcId`
(Organisatie/persoon) and `#DbId` (Verkooprelatie) are the relation and debiteur of
the abonnement's **project**, and the sheet only carries the projectnummer. A static
`valueMap` can't hold that — it differs per customer and per stage, and changes
whenever a project is added — so both are read off `CON_ERP_Projecten` at the moment
the payload is built:

    mapping entry   column "Projectnummer" + lookup {CON_ERP_Projecten, Project → Organisatie_nummer}
    this module     every row of that connector, as normalized Project -> Organisatie_nummer

**Which environment.** The one the send goes to — the project's own test or live —
never the template the mapping was made against: a relation number in test says
nothing about live, exactly as for the existence read in `existing.py`, and like it
this never shares an answer between stages.

**Never a guess.** A cell with no match, or with more than one distinct value behind
it, has no answer, and the frontend blocks that record from the send rather than
passing the raw cell through — sending a debiteurnummer where a relation number
belongs links the record to whichever relation happens to carry that number. So this
module reports ambiguity explicitly instead of letting the last row win, and a
connector AFAS refuses comes back as a failure, never as an empty table.

**Which connectors may be read.** Only a `(connector, matchField, valueField)` triple
that a stored mapping declares — `main.py` checks that before calling here — so an
admin session can't be pointed at an arbitrary GetConnector of a customer's AFAS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from afas import AfasEnvironment, AfasResult, get_all_rows
from existing import normalize_key

# Connector and field ids as AFAS spells them: `CON_ERP_Debiteuren`, `Debiteur`,
# `Project_naam`. Anything else in a stored document is refused, since these end up
# in a URL path and a query string.
_NAME = re.compile(r"^[A-Za-z0-9_]+$")


def valid_name(value: str) -> bool:
    """Whether `value` can be a connector or field id."""
    return bool(_NAME.fullmatch(value or ""))


@dataclass(frozen=True)
class LookupSpec:
    """One lookup as a mapping declares it."""

    connector: str
    """The GetConnector the value is read from, e.g. `CON_ERP_Debiteuren`."""

    match_field: str
    """The field **id** whose value must equal the cell — `Debiteur`."""

    value_field: str
    """The field **id** whose value goes into the body — `Nummer`."""


@dataclass
class LookupTable:
    """A connector read into `match -> value`, with what could not be decided."""

    values: dict[str, str]
    """Normalized match key -> the value AFAS holds for it, as AFAS spells it."""

    ambiguous: dict[str, list[str]]
    """Normalized match keys that carry more than one distinct value, each with the
    values found — no answer for these, and the frontend says so per record."""

    rows: int
    """How many rows AFAS answered with, for the line above the marks."""


async def fetch_table(env: AfasEnvironment, spec: LookupSpec) -> tuple[LookupTable | None, AfasResult]:
    """Every row of the connector, as a lookup table — or **None** when AFAS could
    not answer, which the caller must keep apart from an empty table.

    Keys are normalized the way `existing.normalize_key` does it, for the same
    reason: AFAS pads its record numbers (`07750`) and the sheet's integer column
    delivers `7750`. The value is kept exactly as AFAS answered it; it is what goes
    into a body, and a relation number is its own spelling.

    A row with a blank match or a blank value is skipped: it can never be the answer
    for a filled cell, and keeping a blank value would send `""` — which on a PUT
    clears the field (docs/updateconnector-schema-mapping.md §5.4)."""
    # Sorted on both fields so paging is stable even where the match field repeats.
    order_by = (
        spec.match_field
        if spec.match_field == spec.value_field
        else f"{spec.match_field},{spec.value_field}"
    )
    result = await get_all_rows(env, spec.connector, order_by=order_by)
    if not result.succeeded:
        return None, result

    found: dict[str, list[str]] = {}
    for row in result.rows:
        key = normalize_key(row.get(spec.match_field))
        value = str(row.get(spec.value_field) if row.get(spec.value_field) is not None else "").strip()
        if not key or not value:
            continue
        seen = found.setdefault(key, [])
        if value not in seen:
            seen.append(value)

    return (
        LookupTable(
            values={key: values[0] for key, values in found.items() if len(values) == 1},
            ambiguous={key: values for key, values in found.items() if len(values) > 1},
            rows=len(result.rows),
        ),
        result,
    )
