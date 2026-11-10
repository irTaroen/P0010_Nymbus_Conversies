"""AFAS codetabellen — the reference tables a sheet's values are validated against.

A *codetabel* is a closed set of valid values that lives in AFAS: the landen table,
the woonplaatsen table, the nationaliteitentabel. A column checked against one is
right or wrong by whether its value appears there, which is why the frontend's
validation engine needs the whole table rather than a yes/no per cell.

**A codetabel belongs to one environment, not to the process.** Landen and
woonplaatsen are near enough universal, but a nationaliteitentabel is a *vrije
tabel* and a betaalvoorwaardentabel is set up per administratie — Nymbus's own
snapshot of the latter both holds codes this customer does not use and misses two
they do — so "the codetabel" is always "this customer's codetabel". Every
function here therefore
takes an `AfasEnvironment`, the same rule `afas.py` follows, and the cache is keyed
by environment so one customer's table can never be served to another.

`fetch()` reads one environment; `resolve()` walks the fallback chain (the
client's own AFAS, then Nymbus's live environment as a stand-in) and reports
which one answered. There is no bundled-snapshot tier — see `resolve()` for why.

Deliberately free of FastAPI: it takes an environment and returns rows, so
`main.py` owns the routes and the HTTP semantics. The registry is the single place
a new table is declared — see `_register` calls at the bottom.

Connector and field names are **not** guessed: each was read off
`metainfo/get/<connector>` in a customer's live environment (see
docs/afas-integration.md). Note how little they agree with each other — the
description field is `Land`, `Woonplaats`, `Nationaliteit` and `Arbeidsvoorwaarden`
respectively, and none of them is the `Naam` that the Excel exports of the same
tables use — which is why every table brings its own mapper instead of sharing a
default one.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from enum import Enum

from afas import AfasEnvironment, AfasResult, AfasStatus, get_all_rows, get_connector

# One AFAS row -> one entry the frontend's engine understands:
#   code         the value a sheet cell must match
#   omschrijving what the value means, shown next to it in the value picker
#   scope        optional: the entry is only valid inside this scope (a woonplaats
#                belongs to one land), which a scoped rule narrows on
RowMapper = Callable[[Mapping], dict]


class UnknownCodetabel(KeyError):
    """No codetabel is registered under this key."""


@dataclass(frozen=True)
class Codetabel:
    """One reference table: where it comes from and how a row of it is read."""

    key: str
    """What a rule's `tableRef` names, and the last segment of the route."""

    connector: str
    """The GetConnector that holds it, e.g. `ALG_Landen`."""

    mapper: RowMapper
    """One AFAS row -> `{"code", "omschrijving", "scope"?}`."""

    order_by: str
    """A stable sort for the paging path. Unused when `paged` is False, but
    declared anyway: it is a property of the table, and it is what makes turning
    `paged` on later a one-word change rather than a question."""

    paged: bool = False
    """Fetch page by page instead of in one call. AFAS wants columns × rows under
    150.000 per call; a table that outgrows that sets this."""

    alternatives: tuple[tuple[str, RowMapper], ...] = ()
    """Other connectors holding the same table, tried in order when `connector`
    isn't installed — each with its own mapper, since a rename usually renames the
    description field too.

    For **one table published under more than one name**, not for a fallback to a
    different table. `Abonnementtypes` is the case: `ALG_TypeAbonnement` and
    `ALG_Abonnementtypes` answer the same eight codes with the same descriptions,
    but only the latter exists in every environment. Trying both keeps one
    customer's rename from switching another customer's check off."""

    @property
    def candidates(self) -> tuple[tuple[str, RowMapper], ...]:
        """Every (connector, mapper) to try, preferred first."""
        return ((self.connector, self.mapper), *self.alternatives)


_TABLES: dict[str, Codetabel] = {}


def _register(
    key: str,
    connector: str,
    mapper: RowMapper,
    *,
    order_by: str,
    paged: bool = False,
    alternatives: tuple[tuple[str, RowMapper], ...] = (),
) -> None:
    _TABLES[key] = Codetabel(
        key=key,
        connector=connector,
        mapper=mapper,
        order_by=order_by,
        paged=paged,
        alternatives=alternatives,
    )


def table(key: str) -> Codetabel:
    """The registered codetabel, or `UnknownCodetabel` for a key nobody declared."""
    try:
        return _TABLES[key]
    except KeyError as exc:
        raise UnknownCodetabel(key) from exc


def keys() -> list[str]:
    """Every registered key, in registration order."""
    return list(_TABLES)


# --- Cache --------------------------------------------------------------------
# Keyed by **environment** rather than by project: two projects pointing at the
# same AFAS share one copy of a 29.000-row table, and no project can ever be
# served another's. The stage is part of the key, so the same environment number
# reached at `.rest` and at `.resttest` never collide.
#
# The TTL is what makes a table changed in AFAS show up without a backend restart.

_TTL_SECONDS = 3600.0

# (omgevingnummer, stage, key) -> (entries, monotonic time it was fetched)
_cache: dict[tuple[str, str, str], tuple[list[dict], float]] = {}
# The same key -> the lock one fetch of that table holds; see `fetch()`.
_fetch_locks: dict[tuple[str, str, str], asyncio.Lock] = {}

# AFAS's own answer per (omgevingnummer, stage, connector, how it was read), for the
# tables that share a connector: `Items` and `Artikelen` are both `ALG_Items`, mapped
# two ways, and without this each paid its own full read of the same rows. Only
# successful answers, for the same TTL; `forget()` drops a table's connectors too,
# so a refresh still reaches AFAS.
_rows_cache: dict[tuple[str, str, str, str], tuple[AfasResult, float]] = {}
_rows_locks: dict[tuple[str, str, str, str], asyncio.Lock] = {}


def _rows_key(env: AfasEnvironment, connector: str, read: str) -> tuple[str, str, str, str]:
    return (env.omgevingnummer, env.stage.value, connector, read)


def _cache_key(env: AfasEnvironment, key: str) -> tuple[str, str, str]:
    return (env.omgevingnummer, env.stage.value, key)


def cached(env: AfasEnvironment, key: str) -> list[dict] | None:
    """The cached entries for this environment's table, or None when absent or stale."""
    entry = _cache.get(_cache_key(env, key))
    if entry is None:
        return None
    entries, fetched_at = entry
    if time.monotonic() - fetched_at > _TTL_SECONDS:
        return None
    return entries


def forget(env: AfasEnvironment, key: str) -> bool:
    """Drop one cached table so the next read fetches it again. True when there was
    something to drop — what a refresh route reports back."""
    for cache_key in [k for k in _rows_cache if k[:3] in _connector_keys(env, key)]:
        del _rows_cache[cache_key]
    return _cache.pop(_cache_key(env, key), None) is not None


def _connector_keys(env: AfasEnvironment, key: str) -> set[tuple[str, str, str]]:
    return {
        (env.omgevingnummer, env.stage.value, connector)
        for connector, _ in table(key).candidates
    }


async def _connector_rows(env: AfasEnvironment, connector: str, codetabel: Codetabel) -> AfasResult:
    """One connector's rows as AFAS answered them, shared between the tables that
    read the same connector the same way — see `_rows_cache`."""
    read = f"paged:{codetabel.order_by}" if codetabel.paged else "all"
    key = _rows_key(env, connector, read)
    async with _rows_locks.setdefault(key, asyncio.Lock()):
        entry = _rows_cache.get(key)
        if entry is not None and time.monotonic() - entry[1] <= _TTL_SECONDS:
            return entry[0]
        result = (
            await get_all_rows(env, connector, order_by=codetabel.order_by)
            if codetabel.paged
            else await get_connector(env, connector)
        )
        if result.succeeded:
            _rows_cache[key] = (result, time.monotonic())
        return result


# --- Fetching -----------------------------------------------------------------


def _entries(mapper: RowMapper, rows: list[dict]) -> list[dict]:
    """Map AFAS rows to entries, dropping the ones that carry no code.

    A row without a code cannot match a cell, so it would only pad the value
    picker. Mapping is tolerant of a missing field for the same reason a stored
    setting is: one unexpected row must not cost the whole table."""
    entries: list[dict] = []
    for row in rows:
        try:
            entry = mapper(row)
        except (KeyError, TypeError):
            continue
        code = str(entry.get("code") or "").strip()
        if not code:
            continue
        mapped = {"code": code, "omschrijving": str(entry.get("omschrijving") or "").strip()}
        scope = str(entry.get("scope") or "").strip()
        if scope:
            mapped["scope"] = scope
        entries.append(mapped)
    return entries


async def fetch(env: AfasEnvironment, key: str) -> tuple[list[dict] | None, AfasResult]:
    """One codetabel out of **one** environment, as `(entries, result)`.

    `entries` is None exactly when AFAS did not answer with the table — the
    credentials are missing, the connector isn't installed, the table is empty,
    AFAS is unreachable — and `result` then says which of those it was, in AFAS's
    own Dutch. Nothing is invented here: this is the single-environment
    primitive, and walking the fallback chain is `resolve()`'s job below.

    A successful fetch is cached per environment (see above); a cached table is
    returned without calling AFAS at all, so switching module never refetches.
    """
    hit = _cache_hit(env, key)
    if hit is not None:
        return hit
    # One fetch per table at a time. Opening a module asks for its tables in
    # parallel, and two validators on a cold cache would otherwise each walk the
    # same table — 29,000 rows for the woonplaatsen — page by page. The second one
    # waits here and then finds the first one's answer in the cache.
    async with _fetch_locks.setdefault(_cache_key(env, key), asyncio.Lock()):
        hit = _cache_hit(env, key)
        if hit is not None:
            return hit
        return await _fetch_uncached(env, key)


def _cache_hit(env: AfasEnvironment, key: str) -> tuple[list[dict], AfasResult] | None:
    hit = cached(env, key)
    if hit is None:
        return None
    return hit, AfasResult(
        status=AfasStatus.OK,
        message=f"{len(hit)} waarden uit de cache.",
        url="",
        environment=env.name,
    )


async def _fetch_uncached(
    env: AfasEnvironment, key: str
) -> tuple[list[dict] | None, AfasResult]:
    """`fetch()` past the cache: ask AFAS, and cache a usable answer."""
    codetabel = table(key)

    # Most tables have exactly one connector. A table published under more than one
    # name (see `alternatives`) tries them in order and takes the first that answers
    # with usable rows, so an environment that has only the older name still gets
    # its check. The message reported on a total miss is the **preferred**
    # connector's: that is the one a reader is looking for.
    result: AfasResult | None = None
    for connector, mapper in codetabel.candidates:
        attempt = await _connector_rows(env, connector, codetabel)
        if result is None:
            result = attempt
        if not attempt.succeeded:
            continue

        entries = _entries(mapper, attempt.rows)
        if not entries:
            # AFAS answered, but with nothing usable: the connector exists and is
            # authorised, yet holds no rows (or none with a code). Treated as "no
            # table" rather than as an empty one, and deliberately **not cached** —
            # an empty codetabel would make every value in the column wrong, so the
            # caller's fallback is the far better answer, and a filled-in table must
            # not have to wait out a TTL to be noticed.
            # A copy, not the answer itself: that one is shared through
            # `_rows_cache` with any other table reading this connector. When this
            # is the preferred connector, the copy becomes what a total miss reports.
            empty = replace(
                attempt, message=f"De codetabel '{key}' is leeg in {env.name} (connector {connector})."
            )
            if result is attempt:
                result = empty
            continue

        _cache[_cache_key(env, key)] = (entries, time.monotonic())
        return entries, attempt

    assert result is not None  # candidates is never empty
    return None, result


# --- Where a codetabel comes from ---------------------------------------------
# In order, most authoritative first. The client's own environment is the table
# the import will actually hit, so it wins whenever it answers. Nymbus's live
# environment is the stand-in: a real, maintained AFAS table beats nothing at
# all, and it is the same `ALG_*` set — it simply isn't installed there yet, so
# today this tier falls through and the seam sits ready for when it is.
#
# There is deliberately **no bundled-snapshot tier**. A snapshot stops tracking
# reality the day it is pasted in, and for a table that is inrichting per
# administratie it is wrong in both directions at once: measured against the
# first customer connected, our betaalvoorwaarden export accepted six codes they
# do not use and rejected two they do. Judging a sheet against that is worse
# than not judging it — so when no environment answers, the caller gets nothing
# and the check is skipped rather than run on a guess.


class Source(str, Enum):
    """Which environment a codetabel's values came from."""

    CLIENT = "client"  # the project's own AFAS — the table the import will hit
    NYMBUS = "nymbus"  # Nymbus's live environment, standing in
    NONE = "none"  # nobody answered; the check has nothing to judge against


@dataclass
class Resolution:
    """The outcome of looking a codetabel up across the environments."""

    entries: list[dict] | None
    source: Source
    environment: str = ""  # omgevingnummer that answered, for the response
    message: str = ""  # why, when nothing answered — in AFAS's own words

    @property
    def found(self) -> bool:
        return self.entries is not None


async def resolve(
    key: str,
    client: AfasEnvironment,
    nymbus: AfasEnvironment | None = None,
) -> Resolution:
    """A codetabel, from the client's environment or — failing that — Nymbus's.

    `nymbus` is optional so a caller that has no fallback to offer (or wants to
    know only what the client itself says) can leave it out. A tier that is not
    configured at all is skipped rather than reported: an environment with no
    credentials has not "failed", it simply isn't there.

    The message on a total miss names the client's reason, not Nymbus's — the
    client's own table is what the reader is missing, and Nymbus standing in is
    an implementation detail of this function."""
    entries, client_result = await fetch(client, key)
    if entries is not None:
        return Resolution(entries, Source.CLIENT, client.omgevingnummer)

    if nymbus is not None and nymbus.omgevingnummer and nymbus.client_id:
        fallback, _ = await fetch(nymbus, key)
        if fallback is not None:
            return Resolution(fallback, Source.NYMBUS, nymbus.omgevingnummer)

    return Resolution(None, Source.NONE, message=client_result.message)


# --- The tables ---------------------------------------------------------------
# To add one: register it here (field names confirmed with
# `get_connector_metainfo`, never guessed), declare it in the frontend's
# codetabellen/sources.ts, and reference it from a module's rules as
# `{ "check": "codetabel", "tableRef": "<key>" }`.
#
# `ALG_*` is the naming in a customer's environment. Nymbus's own environments
# carry neither set: its live one has only the `Nymbus_*` connectors and its
# test one an older `DV_*` set whose woonplaatsen table has no land column at all,
# so there is no Nymbus-side fallback for these — see docs/afas-integration.md.

_register(
    "Landen",
    "ALG_Landen",
    lambda row: {"code": row["Code"], "omschrijving": row["Land"]},
    order_by="Code",
)

# The place name is both the value a sheet must match and its own description, and
# the land it belongs to becomes the entry's scope: a woonplaats is only valid
# within its country ("Aadorp" for NL, not for B).
_register(
    "Woonplaatsen",
    "ALG_Woonplaatsen",
    lambda row: {
        "code": row["Woonplaats"],
        "omschrijving": row["Woonplaats"],
        "scope": row["Land"],
    },
    order_by="Land,Woonplaats",
)

# Which *type bank* a bank account gets, by the country the bank is in — a table AFAS
# ships rather than one a customer maintains, and one the tool reads rather than
# validates: no sheet column carries it, so it is never a cell that is right or wrong.
# The land is the **scope**, because that is what the lookup is keyed by, and the type
# is the code the payload sends (NL -> 528000).
#
# Six countries have more than one row (MON, NA, BQ, CW, AW, SX — overseas territories
# sharing a code); the reader takes the first, which is what AFAS's own order gives.
_register(
    "TypeBank",
    "ALG_TypeBank",
    lambda row: {
        "code": str(row["TypeBank"]),
        "omschrijving": str(row["TypeBank"]),
        "scope": row["Land"],
    },
    order_by="Land",
)

_register(
    "Nationaliteiten",
    "ALG_Nationaliteiten",
    lambda row: {"code": row["Code"], "omschrijving": row["Nationaliteit"]},
    order_by="Code",
)

# The burgerlijke staten. Small and unscoped, and it replaces a hardcoded
# `enum: ["OG", "GH", "GP", "GS", "OV", "WE"]` on the medewerkers column — which
# is missing `SA` (Samenwonend), a code the live table at 501342 does carry. That
# enum would have flagged every samenwonende medewerker red: the betaalvoorwaarden
# mistake in miniature, and the reason this belongs in a table.
_register(
    "BurgerlijkeStaat",
    "ALG_BurgerlijkeStaat",
    lambda row: {"code": row["Code"], "omschrijving": row["BurgerlijkeStaat"]},
    order_by="Code",
)

# This is the codetabel that most needed to come from the customer: a
# betaalvoorwaardentabel is set up per administratie, and Nymbus's snapshot of it
# disagrees with this customer's in *both* directions — it holds six codes they
# do not use and lacks two they do. A snapshot is not a stand-in here.
_register(
    "Betalingsvoorwaarden",
    "ALG_Betaalvoorwaardes",
    lambda row: {"code": row["Code"], "omschrijving": row["Betaalvoorwaarde"]},
    order_by="Code",
)

# The CAO's this employer runs. Tiny (two rows at the first customer) and entirely
# inrichting: until this table existed, both HRM modules carried the first
# customer's own codes as a hardcoded `enum` — which rejected one of their own two
# CAO's, and would reject every code of every other customer.
_register(
    "Caos",
    "ALG_CAO",
    lambda row: {"code": row["Code"], "omschrijving": row["CAO"]},
    order_by="Code",
)

# **Scoped by CAO.** An arbeidsvoorwaarde belongs to exactly one CAO — the
# connector says so itself, with a `CAO` column next to the code — so `SG` is a
# valid arbeidsvoorwaarde under CAO `SG` and meaningless under CAO `Basis`. Same
# shape as woonplaats-within-land, and the reason this table cannot be a flat
# code list: the codes are not unique across CAO's, so checking the value alone
# would wave through a row pairing a CAO with another CAO's voorwaarde.
_register(
    "Arbeidsvoorwaarden",
    "ALG_Arbeidsvoorwaarden",
    lambda row: {
        "code": row["Code"],
        "omschrijving": row["Arbeidsvoorwaarden"],
        "scope": row["CAO"],
    },
    order_by="CAO,Code",
)

# The financiële administraties. Two rows at the first customer — and note the
# codes are **zero-padded strings** (`01`, `02`) where the sheet columns are typed
# `integer`: a customer exporting the column numerically writes `1`, which is the
# same administratie. `numeric=True` on the frontend's declaration is what bridges
# that; see sources.ts.
_register(
    "Administraties",
    "ALG_Administraties",
    lambda row: {"code": row["Code"], "omschrijving": row["Administratie"]},
    order_by="Code",
)

# The werkgevers in this environment — the employing legal entities a medewerker,
# uitzendkracht or leaseauto is booked under. Unscoped, and like `Administraties`
# the codes are **zero-padded strings** (`01`, `02` at 501372) under a sheet column
# a customer may well export numerically; `numeric=True` on the frontend's
# declaration bridges that. Until this table existed the Werkgever column was only
# `required`, so any non-empty value passed — and since it is also the scope of
# `Functies` below, a wrong werkgever silently switched that check off too (an
# unknown scope passes). First installed at 501372 on 07-10-2026.
_register(
    "Werkgevers",
    "ALG_Werkgevers",
    lambda row: {"code": row["Code"], "omschrijving": row["Werkgever"]},
    order_by="Code",
)

# **Scoped by werkgever.** A functie is set up per werkgever, and the connector
# says so with a `Werkgever` column (plus `WerkgeverNaam`, which we drop — the
# scope is matched on the code the sheet's own Werkgever column carries, not on
# the name). The first customer has one werkgever, so no code collision across
# werkgevers is observable there yet; the scope is declared anyway because it
# costs nothing (an unknown scope passes) and is the difference between right and
# wrong the moment a project has two.
_register(
    "Functies",
    "ALG_Functies",
    lambda row: {
        "code": row["Functie"],
        "omschrijving": row["Omschrijving"],
        "scope": row["Werkgever"],
    },
    order_by="Werkgever,Functie",
)

# The organisatie-eenheden, out of the organigram — hence the connector name, and
# hence `OE` rather than a `Naam`/`Omschrijving` for the description. Unscoped:
# the organigram is one tree per environment.
_register(
    "Organisatie-eenheden",
    "ALG_Organigram",
    lambda row: {"code": row["Code"], "omschrijving": row["OE"]},
    order_by="Code",
)

# The verzamelrekeningen — the grootboekrekeningen a debiteur or crediteur is
# collected on, two rows at the first customer (`1400` Debiteuren, `1600`
# Crediteuren). Not the whole grootboek: the connector is deliberately filtered to
# the verzamelrekeningen, which is exactly what the one column referencing it needs.
#
# Note the field **id** is `Rekeningnummer` even though its *label* reads `Code` —
# the two differ here, and it is the id a row is keyed by. Reading the label would
# have produced a table of empty codes, which is the whole reason field names are
# taken off `metainfo/get` rather than from the connector's appearance in AFAS.
_register(
    "Grootboekrekeningen",
    "ALG_Grootboekrekeningen",
    lambda row: {"code": row["Rekeningnummer"], "omschrijving": row["Grootboekrekening"]},
    order_by="Rekeningnummer",
)

# The projectgroepen a project is filed under. Small and unscoped: one register per
# environment.
_register(
    "Projectgroepen",
    "ALG_Projectgroepen",
    lambda row: {"code": row["Code"], "omschrijving": row["Projectgroep"]},
    order_by="Code",
)

# **Scoped by cao**, the second table with that shape after `Arbeidsvoorwaarden` —
# and here the scope genuinely *narrows*: at the first customer cao `Basis` allows
# only `O` and `V`, so five of the seven codes (`D`, `S`, `SV`, `UI`, `Vk`) are
# invalid under it. A flat check would pass a `Basis` medewerker marked `S`.
#
# It first answered with the same (cao, code) pair several times over — 21 rows for
# 9 distinct pairs, from a join a level below the dienstbetrekking — and was
# filtered down to the 9 in AFAS on 03-09-2026. Nothing here depends on that: the
# frontend indexes codes into Sets, so a duplicate never changed a verdict, and the
# value picker collapses repeats on its own (see `CodetabelPicker`). A connector
# that starts repeating rows again is a cosmetic problem at worst.
_register(
    "Dienstbetrekkingen",
    "ALG_Dienstbetrekkingen",
    lambda row: {
        "code": row["Code"],
        "omschrijving": row["Dienstbetrekking"],
        "scope": row["CAO"],
    },
    order_by="CAO,Code",
)

# The contracttypes a medewerker's contract can carry. Unscoped, and it replaces a
# hardcoded `enum: ["O", "B"]` on the medewerkers column — the first environment to
# carry the connector (501372, 06-10-2026) answers eight codes: besides `O`
# Onbepaalde tijd and `B` Bepaalde tijd also `H`, `J`, `AJ`, `7M`, `8M` and `9M`,
# fixed-length contracts the enum would have flagged red. Note the description
# field is `Contract`, not `Contracttype`.
_register(
    "Contracttypes",
    "ALG_Contracttypes",
    lambda row: {"code": row["Code"], "omschrijving": row["Contract"]},
    order_by="Code",
)

# The verlofsoorten a saldo can be booked on. Codes usually carry the year
# (`W2025` wettelijk, `B2025` bovenwettelijk, `B2027` already present), so this
# table goes stale per *year* as well as per customer — the sharpest case in the
# registry for reading it live rather than bundling a snapshot.
#
# **Registered unscoped, though AFAS scopes it.** The connector describes itself as
# "Arbeidsvoorwaarde/verlofsoort" and carries `CAO` + `Arbeidsvoorwaarden` next to
# the code — 112 rows over six (cao, arbeidsvoorwaarde) pairs for 38 distinct codes,
# so the codes genuinely are not unique across scopes. The scope is dropped anyway
# because `hrm-verlofsaldo` has no column to narrow on: it holds Medewerker, Type
# Verlof, Boekjaar, Datum Boeking and Saldo, and a `scopeColumn` can only read a
# column in the same row — the medewerker's cao lives in the *hrm-medewerkers*
# sheet. Emitting a scope the frontend cannot supply would be worse than none: an
# uncovered scope passes, so every value would be waved through. Flat, the check
# still catches what actually goes wrong — a stale year code, a misspelling, a code
# from another customer. See the matching note in sources.ts; the cao-aware version
# waits on employee data being read from AFAS itself.
#
# Duplicate codes across scopes therefore reach the frontend, exactly as
# `Dienstbetrekkingen` did before it was filtered: harmless, because codes are
# indexed into Sets and `CodetabelPicker` collapses repeats.
#
# `Begindatum`/`Einddatum` are on the connector for the payload work, not for
# validation — a year code is checked by being in the table, not by its dates — so
# the mapper ignores them.
_register(
    "Verlofsoorten",
    "ALG_Verlofsoorten",
    lambda row: {"code": row["Code"], "omschrijving": row["Verlofsoort"]},
    order_by="Code",
)

# The items an offerteregel can point at — artikelen, kostensoorten, werksoorten
# and the layout rows (tekst, subtotaal, toeslag) in one table, with a `Type`
# column saying which kind each is.
#
# **Registered flat, and here the evidence says flat is also *correct*.** The obvious
# reading is to scope by the sheet's *Type item*, but three findings against the
# first customer (273 rows) say otherwise:
#
#   1. The codes are effectively unique across types — 269 distinct codes, and the
#      only one appearing under more than one `Type` is `*****`, a layout placeholder.
#      So a scope would narrow nothing a flat check gets wrong.
#   2. The two vocabularies **do not match**. The sheet's column is an `enum` of
#      `Art`/`Kst`/`Sam`/`Wst` while this connector answers `Artikel`, `Kosten`,
#      `Werksoort`, `Tekst`, `Subtotaal`, `Toeslag`, `Artikeldimensietotaal`. A
#      `scopeColumn: "Type item"` would compare `Art` against scope `Artikel` and
#      match nothing — and an uncovered scope *passes*, so it would silently switch
#      the check off for every row. Scoping would need a translation layer no other
#      table has, and getting it wrong fails in the invisible direction.
#   3. The connector has no `Samenstelling` rows at all, though the sheet's enum
#      offers `Sam` — so a scoped check could not judge that type even in principle.
#
# Case-sensitivity, which this column was long flagged for (an itemcode is
# case-sensitive in AFAS), turns out not to need the store's default overriding:
# there are **zero** codes differing only by case, so case-insensitive matching
# cannot produce a wrong verdict here. Worth re-checking if another customer's
# table does contain such a pair — that is the case that would need an opt-out
# beside the existing `numeric` opt-in.
_register(
    "Items",
    "ALG_Items",
    # `Type` travels as the entry's scope so the value picker can show it — the one
    # thing that tells a user why a code suits their row. No rule declares a
    # `scopeColumn` against this table, and without one the engine never reads it
    # (`engine.ts` goes straight to `codetabelHasCode`), so it is display-only.
    lambda row: {
        "code": row["Code"],
        "omschrijving": row["Item"],
        "scope": row["Type"],
    },
    order_by="Type,Code",
)

# The abonnementtypes — five rows at the first customer (`SO` Schoonmaakonderhoud,
# `GB` Glasbewassing, …). The column referencing it carried **no rules at all**,
# so anything at all passed.
#
# Note this is *not* the table behind the abonnementen sheet's `Artikel` column.
# That one is `Artikelen` below — `ALG_Items` cut to `Type = Artikel` — and the two
# are easy to mix up precisely because the code sets overlap (`SO`, `GB`, `VO`,
# `SR`, `GR` are abonnementtypes here *and* artikelcodes there at 501342). The
# column each belongs to decides which: `Type Abonnement` is an abonnementtype,
# `Artikel` an itemcode.
# Published under **two names**, and which one an environment has depends on when
# it was set up: `ALG_TypeAbonnement` (`Code` + `TypeAbonnement` + `Tabel`) is the
# newer one and the one to ask for, `ALG_Abonnementtypes` (`Code` + `Abonnement`)
# the one every environment still has. Confirmed the same table at 501342 — both
# answer the same eight codes with the same descriptions — so the choice is about
# availability, not content: at 501281 only the older name exists, and preferring
# the newer one without a fallback would have switched that customer's check off.
# `Tabel` on the newer connector is a constant ("Type abonnement") and is dropped.
#
# `ALG_TypeAbonnement` is being imported into every project. **Keep the fallback
# anyway** once it is: it costs one failed call only in an environment that lacks
# the preferred name, and dropping it would silently switch the check off for any
# environment added later from an older template. Retire it only when some
# environment stops carrying `ALG_Abonnementtypes`, not when they all carry both.
_register(
    "Abonnementtypes",
    "ALG_TypeAbonnement",
    lambda row: {"code": row["Code"], "omschrijving": row["TypeAbonnement"]},
    order_by="Code",
    alternatives=(
        (
            "ALG_Abonnementtypes",
            lambda row: {"code": row["Code"], "omschrijving": row["Abonnement"]},
        ),
    ),
)

# The factureringscycli an abonnement is billed on — `J1` Jaar, `M1` Maand, `M3`
# Kwartaal, `M6` Half jaar, `W4` 4-weken at the first customer that has the
# connector. A *vrije tabel*, so the set is inrichting per environment: the
# mapping notes for erp-abonnementen recorded the UpdateConnector's own value list
# for `VaIn` as D7/I/J1/M1/M3/W1, and the live table answers M6 and W4 instead of
# D7/I/W1 — which is exactly why this is checked against the customer's table
# rather than against a list written down here.
#
# **Being rolled out.** Present at 501342, absent at 501281 as of 14-09-2026, with
# the import to every project planned. Where it is missing the fetch returns
# nothing and the column falls back to unchecked, the same way every table behaves
# before its connector exists — so nothing here is special-cased, and nothing needs
# changing when the import lands. `backend/scripts/check_codetabel_connectors.py`
# says where it stands.
_register(
    "Cycli",
    "ALG_Cycli",
    lambda row: {"code": row["Code"], "omschrijving": row["Cyclus"]},
    order_by="Code",
)

# The HRM-periodetabellen — which calendar a werkgever's HRM periods run on (`5`
# Maand HRM, `6` 4 weken HRM, `18` Jaar Verlof HRM at 501342). Inrichting per
# environment like every other table here, and until now the only one of these the
# tool knew was a **hardcoded pair** in the frontend's `conversion-settings.ts`.
#
# Unlike every other registered table, no sheet column references this one: it is
# read by the project-settings dialog, to fill the *Periodetabel HRM* dropdown of a
# project's conversion settings, which is written onto the hoofdproces dossieritem
# (`PtId`, see the hosted version's backend). It is registered here anyway rather than through a
# route of its own — same connector shape, same per-project resolution, same cache
# — so there is one way a reference table reaches the browser, not two.
#
# **`numeric`** on the frontend's declaration: the `Code` field is an `int` here
# (AFAS answers `5`, not `"05"`), while the stored setting and the dropdown carry
# strings. See `normalizeCode` in store.ts.
#
# Being rolled out: present at 501342, absent at 501281 as of 22-09-2026. Where it
# is missing the dialog falls back to the two values the tool can derive *Herhalen
# na* from, which is the same degradation every other table has — see
# `PERIODETABELLEN` in conversion-settings.ts.
_register(
    "Periodetabellen",
    "ALG_Periodetabellen",
    lambda row: {"code": row["Code"], "omschrijving": row["Periodetabel"]},
    order_by="Code",
)

# The **artikelen** out of `ALG_Items` — the same connector as `Items` above, cut
# down to the rows whose `Type` is `Artikel`.
#
# A second key on one connector, rather than a `scopeColumn` on `Items`, because
# the narrowing is **fixed** rather than read from the row: every abonnementsregel
# is an artikel (`erp-abonnementen.json` maps `VaIt` as a fixed `2` = Artikel and
# feeds `ItCd` from the sheet's `Artikel` column), so there is no column saying
# which type to allow and nothing for a scope to resolve against. The filter lives
# in the mapper because `_entries()` drops any row it returns no code for — so a
# row of another type never reaches the table, the index, or the value picker.
#
# **The narrowing is not cosmetic.** At 501342 four codes — `VO`, `SP`, `GBL`,
# `SOL` — exist under both `Artikel` and another `Type`, so a flat `Items` check
# would pass a werksoortcode in the `Artikel` column. 11 artikelen there, 208 at
# 501281, out of 74 and 273 rows respectively.
#
# The caches do not collide: the cache key is `(omgeving, stage, key)`, so `Items`
# and `Artikelen` hold their own copies of the same fetch.
#
# No `scope` is carried. `Items` passes `Type` along so its picker can show which
# kind a code is; here every row is an artikel by construction, so a Type column
# would repeat one word down the whole picker.
_register(
    "Artikelen",
    "ALG_Items",
    lambda row: (
        {"code": row["Code"], "omschrijving": row["Item"]}
        if row["Type"] == "Artikel"
        else {}
    ),
    order_by="Code",
)

# The automerken a leaseauto carries — `HrMobility#ViMr` (Merk) is a code list in
# AFAS, so the sheet must hold the code (`2`), not the name (`Volkswagen`); a name
# resolves to its code through the picker's name lookup. Unscoped. Fields read off
# `metainfo/get/ALG_Automerken` at 501281 (13-10-2026): `Code` + `Merk`, 73 rows.
_register(
    "Automerken",
    "ALG_Automerken",
    lambda row: {"code": row["Code"], "omschrijving": row["Merk"]},
    order_by="Code",
)

# The automodellen — `HrMobility#ViMd` (Model). Despite the name these are body
# types (`1` Hatchback … `7` SUV), not models of a merk, so the table is unscoped and
# has no merk to narrow on. Fields read off `metainfo/get/ALG_Automodellen` at 501281
# (13-10-2026): `Code` + `Model`, 7 rows.
_register(
    "Automodellen",
    "ALG_Automodellen",
    lambda row: {"code": row["Code"], "omschrijving": row["Model"]},
    order_by="Code",
)

# The leasemaatschappij a leaseauto is leased from — an *instantie* in AFAS, so the
# sheet holds its code (`1000111`, or a short code like `L`), not its name. Unscoped,
# and not numeric: the codes mix instantienummers with letters. Fields read off
# `metainfo/get/ALG_Leasemaatschappijen` at 501281 (21-10-2026): `Code` (`CmId`,
# length 15) + `Leasemaatschappij`, 5 rows.
_register(
    "Leasemaatschappijen",
    "ALG_Leasemaatschappijen",
    lambda row: {"code": row["Code"], "omschrijving": row["Leasemaatschappij"]},
    order_by="Code",
)
