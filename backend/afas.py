"""Client for the AFAS Profit REST API.

Everything the backend needs to talk to *an* AFAS environment: which environment,
how to authenticate against it, and how to read what came back. Deliberately free
of FastAPI — this is a plain async client, so it can be used from routes, scripts
or tests alike. Routes translate an `AfasResult` into an HTTP response themselves;
see `afas_fetch` in `main.py` for the shorthand.

The module is organised in four layers, each built on the one above it:

1. **Environment** — `AfasEnvironment` (omgevingnummer + stage + credentials) is
   passed to every call. Nothing here reads a global "current environment": every
   environment is a client's, built from that project's settings
   (`project_environment()` in `main.py`).
2. **Transport** — `afas_request()` does auth, retry, timeout and classification.
3. **Verbs** — `afas_get/post/put/delete`, so a call site reads as the HTTP verb
   it performs. AFAS gives the verbs meaning: POST inserts, PUT updates, DELETE
   removes (key in the URL, never in the body).
4. **Intent** — `get_connector`, `get_all_rows`, `get_metainfo`, `insert_record`, … plus the
   builders (`afas_envelope`, `afas_element`) that know AFAS's conventions so
   callers don't have to reproduce them.

Reference: docs/AFAS-Profit-API-Referentie.md and
https://docs.afas.help/profit/en/authentication
"""

from __future__ import annotations

import asyncio
import base64
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv


import http_client

# Load `backend/.env` by path rather than by search, so importing this module
# works regardless of the working directory the process was started from.
#
# `override=True` because without it `python-dotenv` leaves variables that are
# already in `os.environ` alone — so under uvicorn's reloader an edit to `.env`
# has no effect at all, and the process keeps calling the environment it was
# started with while the file says otherwise. That silence is worse than the
# thing override risks: a real environment variable losing to a stale `.env`,
# which cannot happen where there is no `.env` file to begin with.
load_dotenv(Path(__file__).with_name(".env"), override=True)

_AFAS_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# AFAS caps the querystring at this many characters; a long filter can reach it.
_MAX_QUERYSTRING = 2049


class AfasConfigError(Exception):
    """An environment is missing its number or its OAuth credentials."""


# --- Environments -------------------------------------------------------------
# An AFAS environment is an environment number plus a stage (live / accept /
# test), and the stage decides the REST subdomain. Credentials belong to the
# environment rather than to the process, so a token is always issued by the very
# environment it is sent to — you cannot accidentally send a test token to
# production, and two environments can be called side by side in one request.


class AfasStage(str, Enum):
    """Which flavour of an AFAS environment to address."""

    LIVE = "live"
    ACCEPT = "accept"
    TEST = "test"

    @property
    def subdomain(self) -> str:
        """The REST subdomain: `12345.<subdomain>.afas.online`."""
        return {"live": "rest", "accept": "restaccept", "test": "resttest"}[self.value]

    @property
    def env_prefix(self) -> str:
        """The prefix of this stage's credential keys in `.env` (`LIVE_Oauth_…`)."""
        return self.name

    @classmethod
    def parse(cls, value: object, default: "AfasStage | None" = None) -> "AfasStage":
        """Read a stage from configuration. Accepts the spellings that occur in
        practice — `LIVE`, `rest`, `productie`, `resttest`, … — because this value
        comes out of a `.env` file or an admin form, not out of code."""
        text = str(value or "").strip().lower()
        if not text:
            if default is None:
                raise AfasConfigError("Geen AFAS-omgevingssoort opgegeven (live, accept of test).")
            return default
        aliases = {
            "live": cls.LIVE, "rest": cls.LIVE, "prod": cls.LIVE, "productie": cls.LIVE,
            "accept": cls.ACCEPT, "restaccept": cls.ACCEPT, "acceptatie": cls.ACCEPT,
            "test": cls.TEST, "resttest": cls.TEST,
        }
        if text not in aliases:
            known = ", ".join(sorted({stage.value for stage in cls}))
            raise AfasConfigError(f"Onbekende AFAS-omgevingssoort '{value}'. Gebruik: {known}.")
        return aliases[text]


@dataclass(frozen=True)
class AfasEnvironment:
    """One AFAS environment and the credentials to reach it.

    Frozen and hashable, so it doubles as the key of the token cache. `label` is
    only ever used in messages — it is what tells an admin *which* environment
    refused the call."""

    omgevingnummer: str
    stage: AfasStage
    client_id: str = ""
    client_secret: str = ""
    label: str = ""

    @property
    def subdomain(self) -> str:
        return self.stage.subdomain

    @property
    def host(self) -> str:
        return f"{self.omgevingnummer}.{self.subdomain}.afas.online"

    @property
    def name(self) -> str:
        """How this environment is named in an error message. Stripped, because an
        environment without a number is exactly the one `require_complete()` reports
        on — and a message with a hole where the number belongs reads as a bug."""
        base = f"{self.omgevingnummer} ({self.stage.value})".strip()
        return f"{self.label} — {base}" if self.label else base

    def url(self, endpoint: str) -> str:
        """The full ProfitRestServices URL for an endpoint, e.g.
        `connectors/DV_Administraties` → https://12345.resttest.afas.online/…"""
        return f"https://{self.host}/ProfitRestServices/{endpoint.lstrip('/')}"

    def require_complete(self) -> None:
        """Raise unless this environment can actually be called. Checked before a
        request goes out, so a half-configured project fails with an explanation
        rather than a DNS error for `.rest.afas.online`."""
        missing = [
            name
            for name, value in (
                ("omgevingsnummer", self.omgevingnummer),
                ("client id", self.client_id),
                ("client secret", self.client_secret),
            )
            if not str(value).strip()
        ]
        if missing:
            raise AfasConfigError(
                f"De AFAS-omgeving {self.name} is niet compleet ingesteld: "
                f"{', '.join(missing)} ontbreekt."
            )


# --- OAuth --------------------------------------------------------------------
# AFAS Profit authenticates with OAuth's client-credentials flow: POST the app
# connector's client id + secret to the token endpoint, get a short-lived access
# token back, send that as a bearer token. This flow has no refresh token (AFAS
# returns null for it), so an expired token is simply replaced by a new one.

# Treat a token as stale this many seconds before AFAS expires it, so a request
# never leaves with a token that dies in flight.
_TOKEN_EXPIRY_MARGIN = 60

# environment -> (access token, monotonic time it goes stale). Keyed on the whole
# environment, so the same number under two stages — or under two client ids —
# never share a token.
_token_cache: dict[AfasEnvironment, tuple[str, float]] = {}
_token_lock = asyncio.Lock()


async def _fetch_access_token(env: AfasEnvironment) -> tuple[str, float]:
    """Exchange the client credentials for an access token + its lifetime in seconds."""
    env.require_complete()
    response = await http_client.async_client().post(
        env.url("oauth/token"),
        data={
            "grant_type": "client_credentials",
            "client_id": env.client_id,
            "client_secret": env.client_secret,
        },
        timeout=_AFAS_TIMEOUT,
    )
    if response.status_code != 200:
        # Deliberately without the response body — it can echo what we just sent.
        raise AfasConfigError(
            f"AFAS gaf geen access token voor {env.name} ({response.status_code}). "
            "Controleer de client id en secret."
        )
    # A 200 that isn't the token AFAS documents (an HTML page from a proxy, a body
    # without `access_token`) is raised as the one error `afas_request` turns into
    # a result, rather than escaping it as a bare KeyError/ValueError.
    try:
        payload = response.json()
        token = payload["access_token"]
        expires_in = float(payload.get("expires_in", 0))
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise AfasConfigError(f"AFAS gaf een onleesbaar tokenantwoord voor {env.name}.") from exc
    if not isinstance(token, str) or not token:
        raise AfasConfigError(f"AFAS gaf een leeg access token voor {env.name}.")
    return token, expires_in


async def _access_token(env: AfasEnvironment) -> str:
    """A valid access token for one environment, cached until shortly before AFAS
    expires it. The lock keeps concurrent callers from each fetching their own."""
    async with _token_lock:
        cached = _token_cache.get(env)
        if cached and time.monotonic() < cached[1]:
            return cached[0]
        token, expires_in = await _fetch_access_token(env)
        _token_cache[env] = (token, time.monotonic() + max(expires_in - _TOKEN_EXPIRY_MARGIN, 0))
        return token


async def _discard_access_token(env: AfasEnvironment) -> None:
    """Drop a cached token so the next caller fetches a fresh one."""
    async with _token_lock:
        _token_cache.pop(env, None)


async def _headers(env: AfasEnvironment) -> dict:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-language": "nl-nl",
        "Authorization": f"Bearer {await _access_token(env)}",
    }


# --- Outcome of a call --------------------------------------------------------
# AFAS is not RESTful about failure: a connector that does not exist and one you
# are not authorized for both come back as HTTP 500 with the reason in the body,
# while a rejected token is a 401 with an *empty* body. `_classify` turns all of
# that into one of the AfasStatus values below, so callers branch on meaning
# instead of re-reading status codes.

# errorNumber values seen in AFAS 500 bodies.
_ERR_UNKNOWN_CONNECTOR = -2147200799  # "Connector X bestaat niet."


class AfasStatus(str, Enum):
    """The outcome of an AFAS call, as something callers can branch on."""

    OK = "ok"  # 2xx with data
    EMPTY = "empty"  # 2xx, but the connector returned no rows
    UNAUTHORIZED = "unauthorized"  # 401 — token missing, invalid or revoked
    FORBIDDEN = "forbidden"  # connector exists, this app connector may not use it
    NOT_FOUND = "not_found"  # no such connector, or no such URL
    UNREACHABLE = "unreachable"  # DNS/connect/timeout — wrong omgevingnummer, or network
    CONFIG_ERROR = "config_error"  # credentials or environment number missing
    ERROR = "error"  # AFAS refused for some other reason


@dataclass
class AfasResult:
    """What an AFAS call produced. Check `status` (or `succeeded`) to tell
    "no data" apart from "something went wrong"."""

    status: AfasStatus
    message: str
    url: str
    rows: list[dict] = field(default_factory=list)
    payload: dict | None = None  # the response body as JSON, when there was one
    http_status: int | None = None
    error_number: int | None = None
    # AFAS support asks for this reference when you report a failing call.
    log_reference: str | None = None
    environment: str = ""  # which environment answered, for the error message

    @property
    def succeeded(self) -> bool:
        """True when AFAS accepted the call, whether or not it produced rows."""
        return self.status in (AfasStatus.OK, AfasStatus.EMPTY)

    @property
    def results(self) -> dict:
        """The `results` block an UpdateConnector answers with, holding the primary
        key of the record AFAS just wrote — e.g. `{"KnSubject": {"SbId": "999999"}}`."""
        if not self.payload:
            return {}
        results = self.payload.get("results")
        return results if isinstance(results, dict) else {}


def _classify(response: httpx.Response, url: str, env: AfasEnvironment) -> AfasResult:
    """Read an AFAS response into an AfasResult."""
    # AFAS puts its reason in a JSON body, but not on every status (401 and 404
    # come back empty), so parsing has to be allowed to fail.
    payload: dict | None = None
    try:
        parsed = response.json()
        payload = parsed if isinstance(parsed, dict) else {"value": parsed}
    except ValueError:
        payload = None

    external = str(payload.get("externalMessage", "")).strip() if payload else ""
    error_number = payload.get("errorNumber") if payload else None
    log_reference = payload.get("profitLogReference") if payload else None

    def result(status: AfasStatus, message: str) -> AfasResult:
        return AfasResult(
            status=status,
            message=message,
            url=url,
            payload=payload,
            http_status=response.status_code,
            error_number=error_number,
            log_reference=log_reference,
            environment=env.name,
        )

    if response.is_success:
        # AFAS answers successes in three different shapes: a GetConnector returns
        # `rows`, an UpdateConnector returns `results` holding the new record's key,
        # and metainfo returns its own body (`fields`). Only a genuinely contentless
        # answer is EMPTY — a write that worked must not look like "no data".
        if not payload:
            # DELETE, and some PUTs, answer 2xx with no body at all.
            return result(AfasStatus.EMPTY, f"Gelukt ({response.status_code}), zonder inhoud.")

        if "rows" in payload:
            rows = payload["rows"]
            if not isinstance(rows, list):
                return result(
                    AfasStatus.ERROR, "Onverwacht antwoord van AFAS: 'rows' is geen lijst."
                )
            if not rows:
                return result(AfasStatus.EMPTY, "Gelukt, maar de connector gaf geen rijen terug.")
            outcome = result(AfasStatus.OK, f"{len(rows)} rijen opgehaald uit AFAS.")
            outcome.rows = rows
            return outcome

        if "results" in payload:
            return result(
                AfasStatus.OK, f"AFAS heeft de wijziging verwerkt ({response.status_code})."
            )

        return result(AfasStatus.OK, f"Gelukt ({response.status_code}).")

    if response.status_code == 401:
        # Body is empty here, so the explanation has to come from us.
        return result(
            AfasStatus.UNAUTHORIZED,
            f"AFAS heeft het token voor {env.name} geweigerd (401). "
            "Controleer de OAuth client id en secret.",
        )

    if response.status_code == 404:
        # A 404 is also how AFAS reports a querystring over 2049 characters, which
        # a long filter can reach — hence the second half of this message.
        return result(
            AfasStatus.NOT_FOUND,
            "Deze URL bestaat niet bij AFAS (404). Bij een lang filter: de querystring "
            f"mag maximaal {_MAX_QUERYSTRING} tekens zijn.",
        )

    # From here on AFAS is answering 500 and the body is the only thing that says why.
    if error_number == _ERR_UNKNOWN_CONNECTOR or "bestaat niet" in external.lower():
        return result(AfasStatus.NOT_FOUND, external or "Deze connector bestaat niet.")

    if "geautoriseerd" in external.lower() or "niet ondersteund" in external.lower():
        return result(
            AfasStatus.FORBIDDEN,
            f"{external} Voeg de connector toe aan de app connector van {env.name} in AFAS.",
        )

    return result(
        AfasStatus.ERROR,
        external or f"AFAS gaf een fout terug ({response.status_code}).",
    )


# --- Transport ----------------------------------------------------------------
# One place that talks to AFAS, so retrieving/creating/updating/deleting all get
# the same auth, the same timeout and the same reading of what AFAS answered.


async def afas_request(
    env: AfasEnvironment,
    method: str,
    endpoint: str,
    *,
    params: Mapping | None = None,
    json_body: object = None,
) -> AfasResult:
    """Call any endpoint in one AFAS environment and report the outcome. Never
    raises for an answer AFAS gave — a rejected token or a missing connector comes
    back as a status, so a route decides what that means for the user.

    Prefer the verb wrappers (`afas_get`, `afas_post`, `afas_put`, `afas_delete`)
    at a call site; they exist so the HTTP method is visible without reading a
    string argument."""
    return await _afas_request(env, method, endpoint, params=params, json_body=json_body)


async def _afas_request(
    env: AfasEnvironment,
    method: str,
    endpoint: str,
    *,
    params: Mapping | None,
    json_body: object,
) -> AfasResult:
    url = env.url(endpoint)

    async def send() -> httpx.Response:
        # The pooled client (`http_client.py`): a send of hundreds of records reuses
        # one connection to the host rather than a TLS handshake per record.
        return await http_client.async_client().request(
            method,
            url,
            headers=await _headers(env),
            params=dict(params) if params else None,
            json=json_body,
            timeout=_AFAS_TIMEOUT,
        )

    try:
        env.require_complete()
        response = await send()
        if response.status_code == 401:
            # Token revoked, or expired sooner than advertised. Retry once with
            # a fresh one; a second 401 means the credentials are the problem.
            await _discard_access_token(env)
            response = await send()
    except AfasConfigError as exc:
        return AfasResult(
            status=AfasStatus.CONFIG_ERROR, message=str(exc), url=url, environment=env.name
        )
    except httpx.HTTPError as exc:
        return AfasResult(
            status=AfasStatus.UNREACHABLE,
            message=(
                f"AFAS is niet bereikbaar op {env.host} ({type(exc).__name__}). "
                "Controleer het omgevingsnummer en de omgevingssoort."
            ),
            url=url,
            environment=env.name,
        )

    return _classify(response, url, env)


# --- Verbs --------------------------------------------------------------------
# AFAS gives each HTTP method a fixed meaning (referentie §4): POST inserts, PUT
# updates, DELETE removes with the key in the URL. These wrappers are deliberately
# thin — their whole purpose is that a call site says which of those it is doing.


async def afas_get(
    env: AfasEnvironment, endpoint: str, *, params: Mapping | None = None
) -> AfasResult:
    """Retrieve. Used for GetConnectors and every metainfo endpoint."""
    return await afas_request(env, "GET", endpoint, params=params)


async def afas_post(env: AfasEnvironment, endpoint: str, body: object) -> AfasResult:
    """Insert. AFAS validates the whole body first and answers 201 with the new
    record's primary key in `results`."""
    return await afas_request(env, "POST", endpoint, json_body=body)


async def afas_put(env: AfasEnvironment, endpoint: str, body: object) -> AfasResult:
    """Update. Only key fields are mandatory; a field sent empty (`"Ds": ""`) is
    *cleared*, so send the fields you mean to change and leave the rest out."""
    return await afas_request(env, "PUT", endpoint, json_body=body)


async def afas_delete(env: AfasEnvironment, endpoint: str) -> AfasResult:
    """Delete — permanently. AFAS takes the key from the URL, never from a body:
    `connectors/KnAppointment/KnAppointment/ApId/123` (referentie §4.3)."""
    return await afas_request(env, "DELETE", endpoint)


# --- Envelope builders --------------------------------------------------------
# Every UpdateConnector body is the same nested shape (referentie §3.1). These
# build it, so a mapping states *what* it sends and not how AFAS spells it.


def afas_element(
    fields: Mapping | None = None,
    *,
    keys: Mapping | None = None,
    objects: Mapping[str, object] | None = None,
    action: str | None = None,
) -> dict:
    """One record: its `Fields`, optionally its `@`-prefixed key fields, nested
    `Objects`, and an `@Action` (`insert` / `update` / `delete`).

    `keys` and `action` are written with the `@` AFAS uses to mark a value as a
    key or an action rather than an ordinary field, so callers pass plain names."""
    element: dict = {}
    for name, value in (keys or {}).items():
        element[name if name.startswith("@") else f"@{name}"] = value

    payload = dict(fields or {})
    if action:
        payload = {"@Action": action, **payload}
    element["Fields"] = payload

    if objects:
        # The list form; AFAS accepts an object too, but a list is what the nested
        # examples in the reference use and it keeps ordering explicit.
        element["Objects"] = [{name: {"Element": value}} for name, value in objects.items()]
    return element


def afas_envelope(root: str, element: Mapping | Sequence) -> dict:
    """Wrap one record — or a list of them — in the connector envelope.

    `root` is **not** always the connector name: the `KnEmployee` endpoint expects
    `AfasEmployee`, `FiEntries` expects `FiEntryPar`, and `KnSubjectReaction`
    expects `KnReaction`. `update_connector_metainfo()` reports the right one in
    its `name` field — take it from there rather than from the URL."""
    return {root: {"Element": element}}


def afas_file(content: bytes) -> str:
    """A file as AFAS wants it in a `blob` field (`FileStream`, `FiDa`): base64,
    without a data-URI prefix."""
    return base64.b64encode(content).decode("ascii")


# --- Intent: retrieving -------------------------------------------------------


async def get_connector(
    env: AfasEnvironment,
    connector: str,
    *,
    skip: int = -1,
    take: int = -1,
    order_by: str | None = None,
    extra_params: Mapping | None = None,
) -> AfasResult:
    """Retrieve rows from a GetConnector.

    `skip`/`take` default to -1/-1, AFAS's "get all". That is convenient for small
    reference lists but **AFAS discourages it**: keep columns × rows under 150.000
    per call or AFAS answers 500 ("Out of memory")."""
    params: dict = {"skip": skip, "take": take}
    if order_by:
        params["orderbyfieldids"] = order_by
    params.update(extra_params or {})
    return await afas_get(env, f"connectors/{connector}", params=params)


async def get_all_rows(
    env: AfasEnvironment,
    connector: str,
    *,
    order_by: str,
    page_size: int = 10_000,
    extra_params: Mapping | None = None,
) -> AfasResult:
    """Every row of a GetConnector, fetched in pages of `page_size`.

    For a connector too big for one call — AFAS wants columns × rows under 150.000
    and answers 500 ("Out of memory") past it. `get_connector` is the right call
    below that; this one is for a table that has outgrown it.

    `order_by` is a **required argument**, not an option: AFAS pages with
    `skip`/`take` over whatever order it happens to return, so without a stable
    sort rows can repeat or go missing between pages. Name a field that is unique
    (or a combination that is), e.g. `"Land,Woonplaats"`.

    Paging stops on the first short page, and the pages are fetched one after the
    other rather than concurrently — AFAS asks for at most 5 concurrent calls, and
    a sequential walk needs no row count up front. The result is the last page's
    outcome with every row collected into it, so a failure mid-walk is reported as
    the failure it is instead of a silently truncated list."""
    rows: list[dict] = []
    skip = 0
    while True:
        page = await get_connector(
            env,
            connector,
            skip=skip,
            take=page_size,
            order_by=order_by,
            extra_params=extra_params,
        )
        if not page.succeeded:
            return page
        rows.extend(page.rows)
        if len(page.rows) < page_size:
            page.rows = rows
            page.status = AfasStatus.OK if rows else AfasStatus.EMPTY
            page.message = f"{len(rows)} rijen opgehaald uit AFAS."
            return page
        skip += page_size


async def download_file(env: AfasEnvironment, file_endpoint: str) -> AfasResult:
    """Download a file from the FileConnector. `file_endpoint` is
    `"{Bijlage_ID}/{escaped filename}"` — AFAS's own filename escaping, not a
    connector name, so build it with a caller-side escaper rather than
    guessing at one here. On success, `result.payload["filedata"]` is the
    file's bytes, base64-encoded (AFAS's own encoding, not decoded here)."""
    return await afas_get(env, f"fileconnector/{file_endpoint}")


async def get_metainfo(env: AfasEnvironment) -> AfasResult:
    """Every connector this app connector may use, as
    `{"getConnectors": [...], "updateConnectors": [...], "info": {...}}`. The
    quickest way to find out what an environment actually offers — and `info`
    names the environment, which is worth checking before writing to it."""
    return await afas_get(env, "metainfo")


async def get_connector_metainfo(env: AfasEnvironment, connector: str) -> AfasResult:
    """The fields of a **Get**Connector, as `{"name", "description", "fields": [...]}`
    — each field's `id` (the key it comes back under in a row), its `dataType`, its
    label and its length.

    Read this before mapping a connector's rows: the field names are regularly not
    what an export of the same table calls them (`ALG_Landen` answers `Code` +
    `Land`, while the Excel export of it says `Code` + `Naam`). Its UpdateConnector
    counterpart is `update_connector_metainfo` below."""
    return await afas_get(env, f"metainfo/get/{connector}")


async def update_connector_metainfo(env: AfasEnvironment, connector: str) -> AfasResult:
    """The schema of an **Update**Connector: every field with its type, whether it
    is mandatory, its allowed values, and the whole tree of nested objects.

    Read this before writing any payload. Besides the field codes it reports the
    body's root key in `payload["name"]`, which is regularly *not* the connector
    name (`KnSubjectReaction` → `KnReaction`)."""
    return await afas_get(env, f"metainfo/update/{connector}")


# --- Intent: writing ----------------------------------------------------------
# POST / PUT / DELETE against an UpdateConnector, named after what they do to the
# data rather than after the verb that carries them.


async def insert_record(env: AfasEnvironment, connector: str, body: Mapping) -> AfasResult:
    """Create a record (POST). `body` is a full envelope — build it with
    `afas_envelope()` + `afas_element()`. Read the new key from `result.results`."""
    return await afas_post(env, f"connectors/{connector}", body)


async def update_record(env: AfasEnvironment, connector: str, body: Mapping) -> AfasResult:
    """Update an existing record (PUT). `body` is a full envelope — build it with
    `afas_envelope()` + `afas_element()`. Only the key fields are mandatory; a
    field left out is left unchanged, one sent empty is cleared."""
    return await afas_put(env, f"connectors/{connector}", body)


async def delete_record(
    env: AfasEnvironment, connector: str, object_name: str, key_field: str, key: str
) -> AfasResult:
    """Remove a record (DELETE) — **permanently**. AFAS takes the key from the URL,
    never from a body: `connectors/KnQuotation/KnQuotation/QuId/OFF000030`
    (referentie §4.3). `key` is sent the way AFAS spells it — padding included — and
    percent-encoded as one path segment, so a key holding a `/` cannot reach a
    different object."""
    segments = "/".join(quote(str(part), safe="") for part in (object_name, key_field, key))
    return await afas_delete(env, f"connectors/{connector}/{segments}")
