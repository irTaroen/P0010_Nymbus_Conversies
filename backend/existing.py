"""Which records a module would send **already exist** in the customer's AFAS.

The payload view builds a body per row and, until now, could only offer to insert
them. This is the read that tells it which of those records AFAS already holds, so a
re-send can update them instead of inserting duplicates, and so an admin can see the
split before pressing anything.

**Not a codetabel**, although it looks like one from a distance. A codetabel judges a
*cell* against a closed set of valid values, and a value outside it is an error. This
judges a *record* against what exists right now, and "not present" is the normal,
expected answer for most rows of a conversion sheet. They also differ in what a
failure costs: an unreadable codetabel skips a check, while an unreadable existence
list — if it were treated as "nothing exists" — would insert a duplicate of every
record into a customer's administratie. So this module never returns an empty set to
mean "could not ask"; it returns the failure. See `codetabellen.py` for the other kind.

Like every other AFAS call here, each function takes an `AfasEnvironment` rather than
reading a global: the whole question is "does it exist in the environment I am about
to write to", so test and live are different answers and must never share a cache.

Connector and field names are **read off `metainfo/get`**, never guessed — and here
that matters more than usual, because two of these connectors label a field differently
from its id (`CON_ERP_Projecten`: id `Project_naam`, label `ProjectNaam`;
`CON_ERP_Voorcalculatie`: id `Omschrijving`, label `Project`). A mapper written off a
label yields blank keys, every payload looks new, and the send writes a full set of
duplicates.
"""

from __future__ import annotations

from dataclasses import dataclass

from afas import AfasEnvironment, AfasResult, get_all_rows


class UnknownExistingSource(KeyError):
    """No existence lookup is registered for this module."""


@dataclass(frozen=True)
class ExistingSource:
    """Where a module's already-present record keys are read from."""

    module_id: str
    """The app module id, as the URL and the sidebar carry it."""

    connector: str
    """The GetConnector holding the existing records, e.g. `CON_ERP_Debiteuren`."""

    key_field: str
    """The **field id** the record's key comes back under — not its label."""

    label_field: str
    """A human-readable field shown next to a match, so a wrong one is visible."""

    order_by: str
    """A stable sort for the paging path. Required by `get_all_rows`: AFAS pages
    over whatever order it happens to return, so without one rows can repeat or go
    missing between pages."""

    delete: DeleteTarget | None = None
    """How one of these records is removed from AFAS, or `None` for a module whose
    payload view offers no delete — which is every module that has not been given
    one explicitly."""

    validates: bool = False
    """Whether the module's **sheet validation** reads this list too (an
    `existing-record` check in its rule set), which opens it to every member of the
    project rather than to admins alone — in the environment the module's workflow
    task imports into next, see `project_existing_for_validation` in main.py. Off unless a module asks: the
    list holds a customer's names, and `CON_HRM_Medewerker` would hand any project
    member the personnel roster."""


@dataclass(frozen=True)
class DeleteTarget:
    """The DELETE a record of this module is removed with:
    `connectors/{connector}/{object_name}/{key_field}/{key}` (referentie §4.3).

    Declared here, per module, and **never taken from the browser**. The key is the
    only thing a delete request carries; the connector, the object and the field it
    is matched on are this table's, so an admin session cannot be pointed at an
    arbitrary UpdateConnector — the same door `_module_connectors()` closes for the
    send."""

    connector: str
    object_name: str
    key_field: str
    """The UpdateConnector's primary-key field — read off
    `metainfo/update/<connector>` (`primaryKey: true`), not guessed."""


_SOURCES: dict[str, ExistingSource] = {}


def _register(
    module_id: str,
    connector: str,
    *,
    key_field: str,
    label_field: str,
    order_by: str,
    delete: DeleteTarget | None = None,
    validates: bool = False,
) -> None:
    _SOURCES[module_id] = ExistingSource(
        module_id=module_id,
        connector=connector,
        key_field=key_field,
        label_field=label_field,
        order_by=order_by,
        delete=delete,
        validates=validates,
    )


def source(module_id: str) -> ExistingSource:
    """The registered lookup, or `UnknownExistingSource` for a module without one."""
    try:
        return _SOURCES[module_id]
    except KeyError as exc:
        raise UnknownExistingSource(module_id) from exc


def modules() -> list[str]:
    """Every module id that has an existence lookup, in registration order."""
    return list(_SOURCES)


def normalize_key(value: object) -> str:
    """A record key in the one shape both sides are compared in.

    **AFAS pads its record numbers and Excel strips the padding.**
    `CON_ERP_Debiteuren` answers `07750` while the sheet's *Debiteur Nummer* column
    is typed `integer`, so a correct sheet arrives carrying `7750`;
    `CON_ERP_Projecten` pads *every* key (`000001`) against an `integer`
    *Projectnummer*. Comparing as strings would mark existing records as new and
    then insert a duplicate of each one.

    So an all-digits key drops its leading zeros, exactly as `normalizeAfasCode` in
    the frontend (`lib/afas-keys.ts`) does — the one copy both the existing-records
    marks and the codetabel store use, and which this must keep agreeing with.
    Anything else is only trimmed and upper-cased — a key that merely *looks*
    numeric keeps its shape.

    Unlike that store this is **not opt-in per source**: every key in scope here is an
    AFAS record number, and the two mistakes cost very differently. A false *new*
    writes a duplicate into a customer's administratie; a false *exists* declines to
    write and says so on screen.
    """
    text = str(value or "").strip().upper()
    return str(int(text)) if text.isascii() and text.isdigit() else text


async def fetch_keys(env: AfasEnvironment, module_id: str) -> tuple[dict | None, AfasResult]:
    """The keys this environment already holds for a module, normalized.

    Returns `(keys, result)` where `keys` maps a normalized key to the record's label
    — or **None** when AFAS could not answer. The caller must keep those apart: an
    empty dict means "this environment holds none of these records", while None means
    "we do not know", and only the first is safe to send against.

    Paged, because a debiteurenlijst outgrows AFAS's one-call limit long before a
    codetabel does.
    """
    records, result = await fetch_records(env, module_id)
    if records is None:
        return None, result
    return {key: label for key, (_, label) in records.items()}, result


async def fetch_records(
    env: AfasEnvironment, module_id: str
) -> tuple[dict[str, tuple[str, str]] | None, AfasResult]:
    """`fetch_keys`, keeping each key **as AFAS spells it** beside its label:
    normalized key -> (AFAS key, label).

    The normalized form is for comparing against the sheet; the AFAS form is what a
    DELETE has to name. `07750` and `7750` are the same debiteur to the matcher and
    two different URLs to AFAS, and only the padded one finds the record.

    A key repeating over several rows (`CON_ERP_Voorcalculatie` answers one row per
    offerteregel) collapses into one entry — the record here is the group — and the
    first row's label stands for it."""
    found = source(module_id)
    result = await get_all_rows(env, found.connector, order_by=found.order_by)
    if not result.succeeded:
        return None, result

    records: dict[str, tuple[str, str]] = {}
    for row in result.rows:
        raw = str(row.get(found.key_field) or "").strip()
        key = normalize_key(raw)
        if not key:
            # A row without a key can never match a payload, and keeping it would
            # only let a blank cell "match" something.
            continue
        if key not in records:
            records[key] = (raw, str(row.get(found.label_field) or "").strip())
    return records, result


# --- The sources --------------------------------------------------------------
# To add one: register it here with the field **ids** read off
# `metainfo/get/<connector>`, then give the module's payload plan an `existing`
# block naming the sheet column its key comes from (frontend
# `lib/module-payloads.ts`). A module absent here keeps today's behaviour — nothing
# marked, the send inserts — which is why adding one cannot affect another.
#
# Three more `CON_ERP_*` connectors exist at the first customer (`FinAdministratie`,
# `FinMutaties`, `Verstrekking`). They are unregistered because their modules have no
# payload plan that could use them — see docs/existing-records.md.

# `Debiteur` is the debiteurnummer; `Nummer` is the organisatie/persoon number behind
# it, which is a different thing and deliberately not the key.
#
# `validates`: the Debiteuren rule set checks each organisation's name against
# `Naam` here — a name AFAS already holds under another debiteurnummer is a
# duplicate in the making (`existing-record` in rules/erp-debiteuren.json).
_register(
    "erp-debiteuren",
    "CON_ERP_Debiteuren",
    key_field="Debiteur",
    label_field="Naam",
    order_by="Debiteur",
    validates=True,
)

# `validates`: the same name check as Debiteuren, against `Naam` here.
_register(
    "erp-crediteuren",
    "CON_ERP_Crediteuren",
    key_field="Crediteur",
    label_field="Naam",
    order_by="Crediteur",
    validates=True,
)

# Note `Project_naam` — the field **id**. Its label reads `ProjectNaam`, and the two
# differ; the id is what a row is keyed by.
#
# Deletable on `PrId`, the field the mapping fills from *Projectnummer*. Unlike
# `KnQuotation`'s `QuId`, `metainfo/update/PtProject` flags **no** root field
# `primaryKey: true` (probed 28-09-2026 at 38892, test and live — only the
# `PtProjectStage` subobject carries flags); `PrId` is the key by the referentie
# (§5.5) and by being what AFAS matches a project on.
_register(
    "erp-projecten",
    "CON_ERP_Projecten",
    key_field="Project",
    label_field="Project_naam",
    order_by="Project",
    delete=DeleteTarget(connector="PtProject", object_name="PtProject", key_field="PrId"),
)


# One row per **offerteregel** (`Offerte` + `Regelnummer`), while a Voorcalculatie
# record in the payload view is the whole offerte — `KnQuotation` with its regels as
# one group. Keyed on `Offerte` alone, the regels collapse into the offerte they
# belong to (`fetch_records`), which is exactly the payload view's record. Sorted on
# both fields because `Offerte` alone repeats and would not page stably.
#
# `Omschrijving` is the field **id** — AFAS *labels* it `Project`, and it holds the
# project number, which is what makes a match recognisable by eye.
#
# The first module with a delete: `KnQuotation`'s primary key is `QuId`
# ("Nummer offerte", `primaryKey: true` in `metainfo/update/KnQuotation`, probed
# 23-09-2026 at 38892), the field the mapping fills from the same *Offerte* column.
_register(
    "erp-voorcalculatie",
    "CON_ERP_Voorcalculatie",
    key_field="Offerte",
    label_field="Omschrijving",
    order_by="Offerte,Regelnummer",
    delete=DeleteTarget(connector="KnQuotation", object_name="KnQuotation", key_field="QuId"),
)

# Grouped like Voorcalculatie: one row per **abonnementsregel** (`Abonnement` +
# `Regelnummer`, both `int`), and a record in the payload view is the whole
# abonnement — `FbSubscription` with its `FbSubscriptionLines`. Keyed on `Abonnement`
# alone, the regels collapse into their abonnement. No label field says more than
# the key, so `Debiteur` stands beside a match: the relatie it is billed to.
#
# Deletable on `SuNr` ("Nummer abonnement", `primaryKey: true` in
# `metainfo/update/FbSubscription`, probed 28-09-2026 at 38892), the field the
# mapping fills from *Abonnement nummer*.
_register(
    "erp-abonnementen",
    "CON_ERP_Abonnementsregel",
    key_field="Abonnement",
    label_field="Debiteur",
    order_by="Abonnement,Regelnummer",
    delete=DeleteTarget(connector="FbSubscription", object_name="FbSubscription", key_field="SuNr"),
)


# --- HRM ----------------------------------------------------------------------
# Five `CON_HRM_*` GetConnectors were added at the first customer and probed live
# (env 38690, stage live, 09-09-2026). Unlike the ERP set, every field's **id equals
# its label** here, so the `Project_naam`/`ProjectNaam` trap above does not apply to
# any of them — which is worth stating rather than leaving the next reader to re-probe.
#
# Only two of the five key a record the way this feature needs: one column, unique per
# record, and present in the module's own sheet. The other three are registered nowhere
# and the reasons are recorded at the bottom of this file, because "we looked and it
# does not fit" is the expensive half of the work.

# `Medewerker` is the medewerkercode, unique across the connector (18 rows, 18
# distinct, live). Both `hrm-medewerkers` and `hrm-uitzendkrachten` carry a
# `Medewerker` column that the rule set already makes `required` + `unique`, and both
# write the same kind of AFAS record through `KnEmployee` — so the two modules share
# one source rather than each getting a near-copy.
_register(
    "hrm-medewerkers",
    "CON_HRM_Medewerker",
    key_field="Medewerker",
    label_field="MedewerkerNaam",
    order_by="Medewerker",
)

_register(
    "hrm-uitzendkrachten",
    "CON_HRM_Medewerker",
    key_field="Medewerker",
    label_field="MedewerkerNaam",
    order_by="Medewerker",
)

# `Kenteken` is the vervoermiddel's own key and `required` + `unique` in
# `hrm-wagenpark`'s rule set. The connector answers 0 rows at this customer today,
# which is a legitimately empty environment rather than a failure — and exactly the
# distinction `fetch_keys` keeps: an empty dict means "holds none of these", `None`
# means "could not ask". `Medewerker` is deliberately not the key; one medewerker can
# hold several vervoermiddelen.
_register(
    "hrm-wagenpark",
    "CON_HRM_Wagenpark",
    key_field="Kenteken",
    label_field="Medewerker",
    order_by="Kenteken",
)

# --- Probed and deliberately not registered -----------------------------------
# `CON_HRM_Verlofsaldo` (`Medewerker` + `TypeVerlof` + `Boekjaar`, 88 rows over 18
#   medewerkers live) — a composite key. `Medewerker` alone repeats up to six times,
#   so keying `hrm-verlofsaldo` on it would mark every row of an employee who has any
#   saldo as "bestaat al" and refuse to write the other verlofsoorten. `ExistingSource`
#   holds one `key_field` by design; a composite needs that seam widened first.
# `CON_HRM_Loonmutaties_Vakantietoeslag` (`Periodetabel` + `Boekjaar` + `Periode` +
#   `Medewerker` + `LC`) — the same composite problem, five columns deep, and
#   `hrm-vakantietoeslag`'s sheet carries only *Medewerker*, *Bedrag* and *Grondslag*:
#   the other four key parts are not in the sheet at all, so there is nothing to
#   compare even with a widened seam.
# `CON_HRM_Looncomponenten` (`Nummer` + `Stamnummer` + `CAO`, 897 rows) — not an
#   existence list for any module's records. It is the customer's looncomponent
#   *catalogue*: a closed set of valid values, which makes it a **codetabel** in this
#   app's terms rather than a payload-side existence read. If `hrm-salarisparameters`
#   should validate its *Parameter* column against it, that belongs in
#   `codetabellen.py` — see docs/afas-integration.md — not here.
