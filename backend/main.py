import asyncio
import contextlib
import json
import logging
import math
import os
import re
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Literal, TypeVar

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import afas_plaatsen
import codetabellen
import dossier_migration
import existing
import local_store
import lookups
import mapping_store
import payload_send
import send_progress
from afas import (
    AfasConfigError,
    AfasEnvironment,
    AfasResult,
    AfasStage,
    AfasStatus,
    get_connector,
    get_connector_metainfo,
    get_metainfo,
    update_connector_metainfo,
)
from json_store import write_json_atomic
from clock import now_iso
import http_client
import afas_reads

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)


# --- AFAS ---------------------------------------------------------------------
# The client itself lives in `afas.py`, which reports outcomes rather than raising,
# and takes the environment as a parameter rather than reading a global one. Every
# environment this backend talks to is a **client's**, built from that project's
# own settings (`project_environment()` below).


def _afas_http_error(result: AfasResult) -> HTTPException:
    """An AFAS outcome as the HTTP error a route should raise. Unreachable is a
    502 (the upstream is down); everything else is a 500 with AFAS's own words,
    since the caller can't fix a connector authorisation from the browser.

    Logged with AFAS's `profitLogReference`: a refusal like "Er is een
    onverwachte fout opgetreden." names nothing, and that reference is the only
    thing AFAS (or the Profit logboek) can trace it by."""
    status = 502 if result.status is AfasStatus.UNREACHABLE else 500
    logger.warning(
        "AFAS weigerde %s (%s, HTTP %s): %s — logreferentie %s",
        result.url,
        result.environment or "?",
        result.http_status,
        result.message,
        result.log_reference or "—",
    )
    return HTTPException(status_code=status, detail=result.message)


_T = TypeVar("_T")


# Credentials are stored in plain text in the gitignored `client_tokens.json` and
# `dossier_migration_settings.json`. These keep the old encrypt/decrypt call sites
# readable without a key behind them.
class EncryptionError(Exception):
    pass


def encrypt(value: str) -> str:
    return value


decrypt = ensure_encrypted = encrypt


def _crypto(step: Callable[[str], str], value: object) -> str:
    return step(str(value or "").strip())


@contextlib.asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Every flagged module's client copy that is still missing, made from the
    # standard mapping (`_seed_all_client_mappings`). Background, never fatal.
    backfill = asyncio.create_task(_seed_all_client_mappings_quietly())
    yield
    backfill.cancel()
    # The pooled AFAS connections (`http_client.py`), closed with the server.
    await http_client.aclose()


app = FastAPI(title="Nymbus Conversies API", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    # The local frontend's origin. Next also rewrites `/api/*` to this backend, so
    # the browser normally never needs CORS at all; this covers a direct call.
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3010")],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- The local session --------------------------------------------------------
# A local tool has no login. Every request runs as the one local user, with every
# right the app knows (`role: developer`, admin included). The dependencies below
# keep the route signatures the multi-user version had, so a route still says
# *what* it would need — they just never refuse.

LOCAL_USER = {
    "email": os.getenv("LOCAL_USER_EMAIL", "lokaal@localhost"),
    "name": os.getenv("LOCAL_USER_NAME", "Lokaal"),
    "type": "employee",
}


def _local_session() -> dict:
    return {
        "user": dict(LOCAL_USER),
        "isAdmin": True,
        "isDeveloper": True,
        "role": "admin",
        "projects": _projects_view(),
    }


def current_session() -> dict:
    return _local_session()


def _require_project_access(session: dict, project_id: str) -> None:
    """404 for a project the store doesn't have — everything else is allowed."""
    if local_store.project(project_id) is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' bestaat niet.")


def require_admin(detail: str = ""):
    def dependency() -> tuple[str, str]:
        return LOCAL_USER["email"], LOCAL_USER["name"]

    return dependency


current_admin = require_admin()
require_developer = require_admin


def require_report_access() -> None:
    return None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth/me")
def me() -> dict:
    """The local session — the shape the frontend's auth provider expects, with
    every project in the store."""
    return _local_session()


# --- Local JSON files ---------------------------------------------------------
# Everything the app holds lives in `json_files/` (see `local_store.py` for the
# project files):
#   modules.json            the module catalog: category (HRM / ERP) and order
#   projects.json           the projects and their conversion-wide settings
#   project_modules.json    per project: its modules, their stage and figures
#   client_tokens.json      per project: AFAS credentials (gitignored)
#   mappings/               the field mappings (`mapping_store.py`)
#   schemas/                the general UpdateConnector schemas, from the AFAS OAS
#   custom_modules.json     maatwerk modules per project
JSON_DIR = local_store.JSON_DIR


def _load_json(filename: str):
    with (JSON_DIR / filename).open(encoding="utf-8") as f:
        return json.load(f)


# --- Projects -----------------------------------------------------------------
# What the settings say about one project's AFAS connection, as a word the frontend
# can act on: `"none"` when nothing usable is stored, `"complete"` when the
# environment number **and** at least one of the two stages carry a full client id +
# secret, `"partial"` for everything in between. Says nothing about whether AFAS
# accepts them — that takes a call (`test_project_connection`).
ConnectionState = Literal["none", "partial", "complete", "unavailable"]

_PROJECT_STAGES = {AfasStage.TEST: "test", AfasStage.LIVE: "live"}


def _stored_omgeving(value: object) -> int | None:
    text = str(value or "").strip()
    return int(text) if text.isascii() and text.isdigit() else None


def _stage_states(project: dict, tokens: dict[str, str]) -> dict[str, bool]:
    has_omgeving = _stored_omgeving(project.get("omgeving")) is not None
    return {
        stage: has_omgeving
        and bool(tokens.get(f"{stage}_client_id"))
        and bool(tokens.get(f"{stage}_client_secret"))
        for stage in ("test", "live")
    }


def _connection_state(project: dict, tokens: dict[str, str]) -> ConnectionState:
    if any(_stage_states(project, tokens).values()):
        return "complete"
    started = _stored_omgeving(project.get("omgeving")) is not None or any(tokens.values())
    return "partial" if started else "none"


def _project_view(project: dict, modules: dict[str, dict], tokens: dict[str, str]) -> dict:
    """A project as the frontend gets it — the shape the AFAS-backed version had, so
    the picker, the sidebar and the reports read it unchanged. `moduleCategories` is
    the categories the project has at least one module in."""
    catalog = _catalog_module_ids_by_category()
    categories = [
        category.lower()
        for category, ids in catalog.items()
        if any(module_id in modules for module_id in ids)
    ]
    return {
        "id": project["id"],
        "name": project["name"] or project["id"],
        "afasName": project["name"] or project["id"],
        "dossierId": "",
        "hasDossier": bool(modules),
        "moduleCount": len(modules),
        "nymbusTaskCount": 0,
        "moduleCategories": categories,
        # Realisatie / Afgemeld — the picker's and the managementrapport's filter.
        "statusCode": "AF" if project.get("status") == "afgemeld" else "RE",
        "status": "Afgemeld" if project.get("status") == "afgemeld" else "Realisatie",
        "hrmPeriodetabel": project.get("hrmPeriodetabel"),
        "livegangDatum": str(project.get("livegangDatum") or ""),
        "appreoTestdatum": str(project.get("appreoTestdatum") or ""),
        "conversionType": project.get("conversionType") or "standard",
        "afasConnection": _connection_state(project, tokens),
        "afasStages": _stage_states(project, tokens),
        "testProject": project.get("testProject") is True,
    }


def _projects_view() -> list[dict]:
    """Every project in the store, the ones with modules first."""
    try:
        projects = local_store.projects()
        tokens = local_store.all_tokens()
        views = [
            _project_view(p, local_store.project_modules(p["id"]), tokens.get(p["id"], {}))
            for p in projects
        ]
    except local_store.StoreError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return sorted(views, key=lambda view: not view["hasDossier"])


# --- Modules per project ------------------------------------------------------
# `modules.json` is the catalog — every module the tool knows, its category (HRM /
# ERP) and its place in the sidebar. Which of them a project has is the project's
# own list in `project_modules.json` (`local_store.py`), set when the project is
# created and changed in its settings; that file also carries each module's
# opleverdatum, its stage (validatie → test → live → afgerond) and the figures of
# its last check or send.


# The catalog as last read, keyed on the file's modification time: it is asked for
# per module, per project, inside loops over both, and the file only changes by hand.
# Read-only for callers — the entries are shared, not copied.
_catalog_cache: tuple[float, dict[str, list[dict]], list[dict], dict[str, dict]] | None = None


def _catalog() -> tuple[dict[str, list[dict]], list[dict], dict[str, dict]]:
    """`modules.json` three ways: by category, flattened, and by module id."""
    global _catalog_cache
    path = JSON_DIR / "modules.json"
    mtime = path.stat().st_mtime
    cached = _catalog_cache
    if cached is None or cached[0] != mtime:
        by_category = _load_json("modules.json")["mappings"]
        flat = [
            {**module, "category": category}
            for category, modules in by_category.items()
            for module in modules
        ]
        by_id: dict[str, dict] = {}
        for module in flat:
            by_id.setdefault(str(module["moduleId"]), module)
        cached = _catalog_cache = (mtime, by_category, flat, by_id)
    return cached[1], cached[2], cached[3]


def _module_catalog() -> dict[str, list[dict]]:
    """Category (HRM / ERP) -> the app modules in it, in display order."""
    return _catalog()[0]


def _catalog_modules() -> list[dict]:
    """Every catalog entry, flattened, each tagged with its category."""
    return _catalog()[1]


def _catalog_module(module_id: str) -> dict | None:
    """One catalog entry by app module id (`hrm-medewerkers`)."""
    return _catalog()[2].get(module_id)


def _catalog_module_ids_by_category() -> dict[str, list[str]]:
    return {
        category: [str(module["moduleId"]) for module in modules]
        for category, modules in _module_catalog().items()
    }


STAGE_LABELS = {
    "validatie": "Validatie",
    "test": "Testimport",
    "live": "Live-import",
    "afgerond": "Afgerond",
}


def _project_deeltaken(project_id: str) -> dict[str, dict]:
    """Module id -> the project's own state of that module, in the shape the AFAS
    deeltaak used to have (`code`, `dossierItemId`, `stage`, the figures), so the
    send, the existence check and the reports read it as before."""
    deeltaken: dict[str, dict] = {}
    for module_id, state in local_store.project_modules(project_id).items():
        progress = state.get("progress") or {}
        stage = state["stage"]
        deeltaken[module_id] = {
            "code": module_id,
            "name": str((_catalog_module(module_id) or {}).get("moduleName") or module_id),
            "dossierItemId": "",
            "statusCode": "AF" if stage == "afgerond" else "",
            "status": STAGE_LABELS.get(stage, ""),
            "task": "",
            "deliveryDate": state.get("deliveryDate") or "",
            "stage": None if stage == "afgerond" else stage,
            "started": progress.get("completeness") is not None or stage != "validatie",
            "completeness": progress.get("completeness"),
            "totalRows": progress.get("totalRows"),
            "errorRowCount": progress.get("errorRowCount"),
            "checkedCells": progress.get("checkedCells"),
            "errorCells": progress.get("errorCells"),
            "checkedAt": progress.get("checkedAt") or "",
            "submittedBy": progress.get("submittedBy") or "",
            "fileName": progress.get("fileName") or "",
        }
    return deeltaken


def _module_view(module: dict, deeltaak: dict) -> dict:
    """One module as the sidebar gets it. There is no workflow: no actions, never
    Nymbus's turn — the stage is what the reports show as *Fase*."""
    return {
        "id": str(module["moduleId"]),
        "name": str(module["moduleName"]),
        "deeltaakcode": deeltaak["code"],
        "deeltaakName": deeltaak["name"],
        "dossierItemId": "",
        "statusCode": deeltaak["statusCode"],
        "status": deeltaak["status"],
        "task": "",
        "deliveryDate": deeltaak["deliveryDate"],
        "actions": [],
        "adminOnly": False,
        "withNymbus": False,
        "started": deeltaak["started"],
        "stage": deeltaak["stage"],
    }


@app.get("/api/modules")
def module_catalog():
    """The whole catalog, grouped by category — what the new-project dialog and the
    project settings offer to pick from."""
    return {
        "groups": [
            {
                "id": category.lower(),
                "label": category,
                "modules": [
                    {"id": str(m["moduleId"]), "name": str(m["moduleName"])} for m in modules
                ],
            }
            for category, modules in _module_catalog().items()
        ]
    }


@app.get("/api/projects/{project_id}/modules")
async def project_modules(project_id: str, session: dict = Depends(current_session)):
    """The project's modules, grouped by category in catalog order. Categories the
    project has nothing in are left out."""
    _require_project_access(session, project_id)
    deeltaken = _project_deeltaken(project_id)
    groups = [
        {
            "id": category.lower(),
            "label": category,
            "modules": [
                _module_view(module, deeltaken[str(module["moduleId"])])
                for module in modules
                if str(module["moduleId"]) in deeltaken
            ],
        }
        for category, modules in _module_catalog().items()
    ]
    return {"groups": [group for group in groups if group["modules"]]}


class ProjectModuleRequest(BaseModel):
    # `yyyy-mm-dd`, or "" for none. Left out keeps what is stored.
    deliveryDate: str | None = None
    # validatie / test / live / afgerond. Left out keeps what is stored.
    stage: str | None = None


@app.put("/api/projects/{project_id}/modules/{module_id}")
def save_project_module(project_id: str, module_id: str, payload: ProjectModuleRequest):
    """Set one module's opleverdatum or stage by hand."""
    _require_project_access({}, project_id)
    fields: dict = {}
    if payload.deliveryDate is not None:
        text = payload.deliveryDate.strip()
        if text:
            try:
                text = date.fromisoformat(text[:10]).isoformat()
            except ValueError:
                raise HTTPException(status_code=400, detail="De opleverdatum is geen geldige datum.") from None
        fields["deliveryDate"] = text
    if payload.stage is not None:
        if payload.stage not in local_store.STAGES:
            raise HTTPException(status_code=400, detail=f"Onbekende fase '{payload.stage}'.")
        fields["stage"] = payload.stage
    try:
        local_store.update_project_module(project_id, module_id, fields)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"Project '{project_id}' heeft geen module '{module_id}'."
        ) from None
    return {"ok": True}


# --- Creating and removing projects -------------------------------------------
# A project is created in the app (the *Nieuw project* dialog): an id, a name, its
# AFAS environment number, the kind of conversion and the modules it covers. The
# credentials go in afterwards, in the project settings, like before.

_PROJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


class CreateProjectRequest(BaseModel):
    id: str
    name: str = ""
    omgeving: str = ""
    conversionType: str = "standard"
    modules: list[str] = []


def _checked_module_ids(sent: list[str]) -> list[str]:
    """The module ids, in catalog order and deduplicated; a 400 for one the catalog
    doesn't know."""
    chosen = {text for text in (str(item).strip() for item in sent) if text}
    for module_id in sorted(chosen):
        if _catalog_module(module_id) is None:
            raise HTTPException(status_code=400, detail=f"Onbekende module '{module_id}'.")
    return [
        module_id
        for module_id in (str(module["moduleId"]) for module in _catalog_modules())
        if module_id in chosen
    ]


def _conversion_type(sent: str) -> str:
    if sent not in local_store.CONVERSION_TYPES:
        raise HTTPException(status_code=400, detail=f"Onbekende conversiesoort '{sent}'.")
    return sent


@app.post("/api/projects")
def create_project(payload: CreateProjectRequest):
    project_id = payload.id.strip()
    if not _PROJECT_ID.match(project_id):
        raise HTTPException(
            status_code=400,
            detail="Een projectnummer bestaat uit letters, cijfers, '-' en '_' (maximaal 64 tekens).",
        )
    if local_store.project(project_id) is not None:
        raise HTTPException(status_code=409, detail=f"Project '{project_id}' bestaat al.")
    number = _omgeving_number(payload.omgeving)
    stored = local_store.save_project(
        project_id,
        {
            "name": " ".join(payload.name.split()) or project_id,
            "omgeving": "" if number is None else str(number),
            "conversionType": _conversion_type(payload.conversionType),
        },
    )
    local_store.set_project_modules(project_id, _checked_module_ids(payload.modules))
    return {"project": _project_view(stored, local_store.project_modules(project_id), {})}


class ProjectModulesRequest(BaseModel):
    modules: list[str]


@app.put("/api/projects/{project_id}/module-list")
def save_project_module_list(project_id: str, payload: ProjectModulesRequest):
    """Which modules the project carries. A module kept keeps its stage and figures."""
    _require_project_access({}, project_id)
    module_ids = _checked_module_ids(payload.modules)
    local_store.set_project_modules(project_id, module_ids)
    return {"modules": module_ids}


class ConversionTypeRequest(BaseModel):
    conversionType: str


@app.put("/api/projects/{project_id}/conversion-type")
def save_project_conversion_type(project_id: str, payload: ConversionTypeRequest):
    _require_project_access({}, project_id)
    local_store.save_project(project_id, {"conversionType": _conversion_type(payload.conversionType)})
    return {"conversionType": payload.conversionType}


class ProjectStatusRequest(BaseModel):
    status: str


@app.put("/api/projects/{project_id}/status")
def save_project_status(project_id: str, payload: ProjectStatusRequest):
    """Realisatie or Afgemeld — what the picker and the managementrapport filter on."""
    _require_project_access({}, project_id)
    if payload.status not in local_store.PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Onbekende projectstatus '{payload.status}'.")
    local_store.save_project(project_id, {"status": payload.status})
    return {"status": payload.status}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    """Remove the project, its module state and its credentials. Its client
    mappings stay in `mappings/clients/<id>/` — they are committed work, and a
    project re-created under the same id picks them up again."""
    _require_project_access({}, project_id)
    local_store.delete_project(project_id)
    return {"deleted": True}


# --- Project settings ---------------------------------------------------------
# What a project needs before anything can be sent to AFAS on its behalf: the AFAS
# environment number (in `projects.json`) and the OAuth client credentials of its
# test and live environment (in the gitignored `client_tokens.json`).
#
# Credentials are **write-only over the API**: a GET says *whether* a secret is
# stored, never what it is. A PUT that leaves a secret out keeps the stored one;
# sending an empty string clears it.


def _project(project_id: str) -> dict:
    """The stored project, or a 404."""
    project = local_store.project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' bestaat niet.")
    return project


async def _project_name(project_id: str) -> str:
    """The project's name, or a 404."""
    project = _project(project_id)
    return project["name"] or project_id


def _settings_row(project_id: str) -> dict:
    """The project's settings in the row shape the rest of this module reads:
    `omgeving`, the four credential values, `custom_mapping_modules`."""
    project = local_store.project(project_id) or {}
    return {
        "projectId": project_id,
        "projectName": project.get("name") or project_id,
        "omgeving": project.get("omgeving") or "",
        "custom_mapping_modules": project.get("customMappingModules") or [],
        **local_store.tokens(project_id),
    }


def _settings_rows() -> list[dict]:
    return [_settings_row(project["id"]) for project in local_store.projects()]


def _omgeving_number(sent: str) -> int | None:
    """The AFAS environment number a save carries — the `12345` in
    12345.resttest.afas.online — or None when the field was left empty. 400 for
    anything that isn't a number, since AFAS has no other kind."""
    text = sent.strip()
    if not text:
        return None
    if not (text.isascii() and text.isdigit()):
        raise HTTPException(
            status_code=400, detail="Het omgevingsnummer bestaat alleen uit cijfers."
        )
    return int(text)


# --- Modules this project maps differently ------------------------------------
# Every project uses the **same** field mapping per connector, made against the
# general schema (the AFAS OAS). A customer whose environment deviates for one module
# — vrije velden, other mandatory fields — is the exception, flagged here: that module
# gets a client copy of the mapping, read against **that client's** own schema.


def _stored_custom_modules(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for text in (str(item).strip() for item in value) if text]


def _checked_custom_modules(sent: list[str] | None, stored: dict) -> list[str]:
    """What to store: the ids sent, or the stored ones when the field was left out."""
    if sent is None:
        return _stored_custom_modules(stored.get("custom_mapping_modules"))
    return _checked_module_ids(sent)


def _settings_view(project_id: str, project_name: str, row: dict) -> dict:
    def stored(key: str) -> str:
        return str(row.get(key) or "").strip()

    return {
        "projectId": project_id,
        "projectName": project_name,
        "omgeving": _stored_omgeving(row.get("omgeving")),
        "testClientId": stored("test_client_id"),
        "liveClientId": stored("live_client_id"),
        "testClientSecretSet": bool(stored("test_client_secret")),
        "liveClientSecretSet": bool(stored("live_client_secret")),
        "customMappingModules": _stored_custom_modules(row.get("custom_mapping_modules")),
    }


def _project_stage(sent: object) -> AfasStage:
    """The stage a caller names, or a 400. Saying nothing is an error rather than a
    default: a call that silently ran against the other environment would answer a
    question nobody asked — and one of the two is the customer's live data."""
    text = str(sent or "").strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Geen omgevingssoort opgegeven. Gebruik test of live.",
        )
    try:
        stage = AfasStage.parse(text)
    except AfasConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if stage not in _PROJECT_STAGES:
        raise HTTPException(
            status_code=400,
            detail="Alleen de test- en live-omgeving van een project bestaan.",
        )
    return stage


async def project_environment(
    project_id: str,
    stage: AfasStage,
    *,
    omgeving: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> AfasEnvironment:
    """**The customer's** AFAS environment, built from that project's stored settings.
    `stage` picks the credential pair and, through it, the REST subdomain — the same
    environment number at `.resttest` or at `.rest`.

    The **one server-side reader of a stored credential**: nothing here may travel
    back to a browser. A project nobody has configured yields an environment with
    holes; `require_complete()` names them in Dutch at the moment a call is made.

    The keyword overrides are for the connection test, which tries what the form
    shows before it is saved. `None` means "use what is stored"."""
    row = _settings_row(project_id)
    column = _PROJECT_STAGES[stage]

    def credential(key: str, sent: str | None) -> str:
        return (sent if sent is not None else str(row.get(key) or "")).strip()

    number = (
        _omgeving_number(omgeving)
        if omgeving is not None
        else _stored_omgeving(row.get("omgeving"))
    )
    return AfasEnvironment(
        omgevingnummer=str(number) if number is not None else "",
        stage=stage,
        client_id=credential(f"{column}_client_id", client_id),
        client_secret=credential(f"{column}_client_secret", client_secret),
        label=str(row.get("projectName") or "").strip(),
    )


async def _complete_project_environment(project_id: str, stage: AfasStage) -> AfasEnvironment:
    """`project_environment`, refused with a 400 naming what is missing when it
    can't actually be called — for the routes that are about to call it."""
    env = await project_environment(project_id, stage)
    try:
        env.require_complete()
    except AfasConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return env


@app.get("/api/projects/{project_id}/settings")
async def project_settings(project_id: str):
    """One project's settings, without its secrets."""
    name = await _project_name(project_id)
    return {"settings": _settings_view(project_id, name, _settings_row(project_id))}


class ProjectSettingsRequest(BaseModel):
    omgeving: str = ""
    testClientId: str = ""
    liveClientId: str = ""
    # Left out (null) keeps the secret that is stored; a string replaces it.
    testClientSecret: str | None = None
    liveClientSecret: str | None = None
    # The modules this project maps differently, as app module ids. Left out (null)
    # keeps what is stored.
    customMappingModules: list[str] | None = None


@app.put("/api/projects/{project_id}/settings")
async def save_project_settings(
    project_id: str,
    payload: ProjectSettingsRequest,
    _admin: tuple[str, str] = Depends(current_admin),
):
    """Save one project's settings, and answer with them as a GET would."""
    name = await _project_name(project_id)
    stored = _settings_row(project_id)
    number = _omgeving_number(payload.omgeving)
    custom = _checked_custom_modules(payload.customMappingModules, stored)
    local_store.save_project(
        project_id,
        {"omgeving": "" if number is None else str(number), "customMappingModules": custom},
    )
    tokens = {
        "test_client_id": payload.testClientId.strip(),
        "live_client_id": payload.liveClientId.strip(),
    }
    if payload.testClientSecret is not None:
        tokens["test_client_secret"] = payload.testClientSecret.strip()
    if payload.liveClientSecret is not None:
        tokens["live_client_secret"] = payload.liveClientSecret.strip()
    local_store.save_tokens(project_id, tokens)

    # A module flagged by this save starts from a copy of its standard mapping, so
    # the admin opens something to add to and remove from rather than an empty tree.
    before = set(_stored_custom_modules(stored.get("custom_mapping_modules")))
    newly_flagged = [m for m in custom if m not in before]
    await _seed_client_mappings(project_id, newly_flagged, _admin)

    return {"settings": _settings_view(project_id, name, _settings_row(project_id))}


# --- Conversion settings ------------------------------------------------------
# The periodetabel and livegangdatum of the whole conversion — they decide five
# columns of a facilitaire conversie's Medewerkers sheet (`standard-columns.ts`).
# Stored on the project in `projects.json`.


class ConversionSettingsRequest(BaseModel):
    # The HRM periodetabel (AFAS: int, max 2 digits), or "" for none.
    hrmPeriodetabel: str = ""
    # The livegangdatum as `yyyy-mm-dd`, or "" for none.
    livegangDatum: str = ""


def _periodetabel(sent: str) -> int | None:
    text = sent.strip()
    if not text:
        return None
    if not (text.isascii() and text.isdigit()) or len(text) > 2:
        raise HTTPException(
            status_code=400,
            detail="De periodetabel bestaat uit maximaal twee cijfers.",
        )
    return int(text)


def _livegang_datum(sent: str) -> str:
    """The livegangdatum as `yyyy-mm-dd`, or `""` to clear it."""
    text = sent.strip()
    if not text:
        return ""
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        raise HTTPException(
            status_code=400, detail="De datum livegang is geen geldige datum."
        ) from None


def _conversion_settings_view(project: dict) -> dict:
    periodetabel = project.get("hrmPeriodetabel")
    return {
        "projectId": project["id"],
        "projectName": project["name"] or project["id"],
        "hrmPeriodetabel": "" if periodetabel is None else str(periodetabel),
        "livegangDatum": str(project.get("livegangDatum") or "")[:10],
        # The frontend refuses to save without a dossieritem to write onto; the
        # local store always has somewhere to write.
        "dossierItemId": "local",
    }


@app.get("/api/projects/{project_id}/conversion-settings")
async def conversion_settings(project_id: str):
    return {"conversionSettings": _conversion_settings_view(_project(project_id))}


@app.put("/api/projects/{project_id}/conversion-settings")
async def save_conversion_settings(project_id: str, payload: ConversionSettingsRequest):
    _project(project_id)
    stored = local_store.save_project(
        project_id,
        {
            "hrmPeriodetabel": _periodetabel(payload.hrmPeriodetabel),
            "livegangDatum": _livegang_datum(payload.livegangDatum),
        },
    )
    return {"conversionSettings": _conversion_settings_view(stored), "logReference": ""}


# --- Intake -------------------------------------------------------------------
# Where the project's intake with the client stands, and on which day it is or was.
# Shown in the managementrapport's *Overzicht per klant*.

INTAKE_STATUSES = ("niet_ingepland", "uitnodiging_verstuurd", "ingepland", "afgerond")
# The statuses that carry a day. For any other the date is dropped on save.
INTAKE_DATED = {"ingepland", "afgerond"}


class IntakeRequest(BaseModel):
    status: str = INTAKE_STATUSES[0]
    # `yyyy-mm-dd`, or "" for none. Ignored unless the status carries a day.
    datum: str = ""


def _intake_view(intake: object) -> dict:
    intake = intake if isinstance(intake, dict) else {}
    status = str(intake.get("status") or "").strip()
    if status not in INTAKE_STATUSES:
        status = INTAKE_STATUSES[0]
    datum = str(intake.get("datum") or "")[:10] if status in INTAKE_DATED else ""
    return {"status": status, "datum": datum}


@app.get("/api/projects/{project_id}/intake")
async def project_intake(project_id: str):
    return {"intake": _intake_view(_project(project_id).get("intake"))}


@app.put("/api/projects/{project_id}/intake")
async def save_project_intake(project_id: str, payload: IntakeRequest):
    status = payload.status.strip()
    if status not in INTAKE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Onbekende intakestatus '{status}'.")
    datum = ""
    if status in INTAKE_DATED and payload.datum.strip():
        try:
            datum = date.fromisoformat(payload.datum.strip()[:10]).isoformat()
        except ValueError:
            raise HTTPException(
                status_code=400, detail="De intakedatum is geen geldige datum."
            ) from None
    _project(project_id)
    stored = local_store.save_project(project_id, {"intake": {"status": status, "datum": datum}})
    return {"intake": _intake_view(stored.get("intake"))}


# Registered before `/api/voortgang/{project_id}`, which would otherwise take
# `intakes` for a project id.
@app.get("/api/voortgang/intakes")
async def all_intakes():
    return {
        "intakes": {
            project["id"]: _intake_view(project.get("intake")) for project in local_store.projects()
        }
    }


# --- Testproject --------------------------------------------------------------
# Whether a project only exists to try the tool out. The project picker lists these
# under its *TEST* switch only, and the managementrapport leaves them out.


class TestProjectRequest(BaseModel):
    testProject: bool


@app.get("/api/projects/{project_id}/test-project")
async def project_test_flag(project_id: str):
    return {"testProject": _project(project_id).get("testProject") is True}


@app.put("/api/projects/{project_id}/test-project")
async def save_project_test_flag(project_id: str, payload: TestProjectRequest):
    _project(project_id)
    local_store.save_project(project_id, {"testProject": payload.testProject})
    return {"testProject": payload.testProject}


# --- Projectnaam --------------------------------------------------------------

DISPLAY_NAME_MAX = 256


class DisplayNameRequest(BaseModel):
    displayName: str = ""


@app.get("/api/projects/{project_id}/display-name")
async def project_display_name(project_id: str):
    project = _project(project_id)
    return {"displayName": project["name"], "afasName": project["name"] or project_id}


@app.put("/api/projects/{project_id}/display-name")
async def save_project_display_name(project_id: str, payload: DisplayNameRequest):
    display_name = " ".join(payload.displayName.split())
    if len(display_name) > DISPLAY_NAME_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"De projectnaam is te lang (maximaal {DISPLAY_NAME_MAX} tekens).",
        )
    _project(project_id)
    stored = local_store.save_project(project_id, {"name": display_name or project_id})
    return {"displayName": stored["name"], "afasName": stored["name"]}


# --- Testing a project's AFAS connection --------------------------------------
# "Are these credentials right?" answered by asking AFAS itself, before anything is
# uploaded on this project's behalf. The call is `metainfo`: it needs no connector to
# exist, touches no data, and only succeeds when the environment number resolves *and*
# the OAuth pair is accepted — which is exactly the question the admin is asking.
#
# The test runs against what the **form** currently shows, not only what is stored, so
# an admin can check a credential before saving it. The one exception is the secret: a
# stored secret never reaches the browser, so a request that leaves it out (null) is
# tested with the stored one — the same rule a save follows.

class ConnectionTestRequest(BaseModel):
    stage: str  # "test" or "live"
    # Each field left out (null) tests with what is stored; a string tests that one.
    # The settings form sends all three as typed (bar a secret it never had); the
    # project page's check on entry sends none, so it tests exactly the stored setup.
    omgeving: str | None = None
    clientId: str | None = None
    clientSecret: str | None = None


def _connection_message(result: AfasResult, env: AfasEnvironment) -> str:
    """What the admin reads. A failure speaks with AFAS's own words — they name the
    reason (token geweigerd, omgeving onbereikbaar, niet compleet ingesteld). A
    success names the host that answered and how much it exposes, so a connection to
    the wrong environment is visible as such."""
    if not result.succeeded:
        return result.message
    payload = result.payload or {}
    connectors = (("getConnectors", "GetConnectors"), ("updateConnectors", "UpdateConnectors"))
    available = ", ".join(
        f"{len(payload[key])} {label}"
        for key, label in connectors
        if isinstance(payload.get(key), list)
    )
    return (
        f"Verbinding met {env.host} gelukt"
        + (f" — {available} beschikbaar." if available else ".")
    )


def _connection_view(result: AfasResult, env: AfasEnvironment) -> dict:
    """What a connection test answers, from either settings screen: whether AFAS
    answered, and in what words — a refusal is an outcome here, not an HTTP error."""
    return {"connection": {"ok": result.succeeded, "message": _connection_message(result, env)}}


@app.post("/api/projects/{project_id}/settings/test-connection")
async def test_project_connection(
    project_id: str,
    payload: ConnectionTestRequest,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen de AFAS-verbinding testen.")
    ),
):
    """Try one environment of a project and report whether AFAS answered. A refusal
    by AFAS is an *outcome*, not an HTTP error: it comes back as `ok: false` with the
    reason, since it is the very thing the admin pressed the button to find out."""
    await _project_name(project_id)

    # The same builder every other caller uses, with the form's values on top of the
    # stored ones — so what is tested here is what a real call will build.
    env = await project_environment(
        project_id,
        _project_stage(payload.stage),
        omgeving=payload.omgeving,
        client_id=payload.clientId,
        client_secret=payload.clientSecret,
    )

    result = await get_metainfo(env)
    return _connection_view(result, env)


# --- Codetabellen -------------------------------------------------------------
# The reference tables a sheet's values are validated against — landen,
# woonplaatsen, nationaliteiten, betaalvoorwaarden. The registry, the fetching and
# the fallback chain live in `codetabellen.py`; what is here is the HTTP shape.
#
# **Per project, from the customer's own LIVE environment.** A codetabel is
# customer data: the nationaliteitentabel is a vrije tabel and a
# betaalvoorwaardentabel is set up per administratie, so serving one project's
# table to another would judge a sheet against the wrong values. Hence the project
# in the path (and `_require_project_access` behind it) and `AfasStage.LIVE` rather
# than a stage the caller picks — the conversion lands in the live environment, so
# that is the table the sheet has to match.
#
# Nymbus's own live environment is the **fallback**, resolved by
# `codetabellen.resolve()`. When neither answers there is no table, and the route
# says so rather than substituting a snapshot: the check is then skipped, which is
# the honest outcome (see `resolve()` for the reasoning).


async def _codetabel_environment(project_id: str, session: dict) -> AfasEnvironment:
    """The environment a project's codetabellen come from: its own, live. 403 unless
    this session may open the project."""
    _require_project_access(session, project_id)
    return await project_environment(project_id, AfasStage.LIVE)


def _known_codetabel(key: str) -> codetabellen.Codetabel:
    """The registered table, or a 404 naming what does exist — a key the frontend
    asks for and the backend never heard of is a wiring mistake, and guessing which
    one was meant would hide it."""
    try:
        return codetabellen.table(key)
    except codetabellen.UnknownCodetabel:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Onbekende codetabel '{key}'. "
                f"Beschikbaar: {', '.join(codetabellen.keys())}."
            ),
        ) from None


@app.get("/api/projects/{project_id}/codetabellen/{key}")
async def project_codetabel(
    project_id: str, key: str, session: dict = Depends(current_session)
):
    """One codetabel for this project: from its own live AFAS, or from Nymbus's
    live environment when that can't answer.

    A table nobody can serve is **not** an HTTP error: a project whose credentials
    aren't filled in yet is the normal early state of a conversion. It answers 200
    with `source: "none"`, no entries and AFAS's own reason, and the frontend then
    **skips** that check rather than judging the column against a stale copy —
    which for a table that is inrichting per administratie would be wrong in both
    directions. `source` tells the reader which of the three it got.
    """
    _known_codetabel(key)
    client = await _codetabel_environment(project_id, session)

    found = await codetabellen.resolve(key, client)
    return {
        "entries": found.entries or [],
        "count": len(found.entries or []),
        "source": found.source.value,
        "environment": found.environment,
        "message": found.message,
        "fetchedAt": now_iso(),
    }


@app.post("/api/projects/{project_id}/codetabellen/{key}/refresh")
async def refresh_project_codetabel(
    project_id: str,
    key: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen een codetabel verversen.")
    ),
):
    """Drop the cached copy of a codetabel, so the next read fetches it from AFAS
    again. For a table that changed in AFAS during a working day — the cache
    otherwise holds it for an hour.

    Clears **both** tiers this project reads: its own environment and the Nymbus
    one behind it. Refreshing only the first would leave a stale stand-in in place
    for exactly the project whose own table just started working."""
    _known_codetabel(key)
    client = await _codetabel_environment(project_id, session)
    dropped = [
        codetabellen.forget(env, key) for env in (client,)
    ]
    return {"refreshed": any(dropped), "codetabel": key}


# --- AFAS plaatsen (admins only) ----------------------------------------------
# The `afas_plaatsen` table (`afas_plaatsen.py`): woonplaatsen to be imported into
# AFAS. The Instellingen modal adds a sheet's unknown places to it and downloads it.

_PLAATSEN_UNREACHABLE = "De plaatsenlijst is nu niet bereikbaar. Probeer het later opnieuw."


class AfasPlaats(BaseModel):
    land: str
    plaats: str


class AfasPlaatsenRequest(BaseModel):
    places: list[AfasPlaats]


@app.post("/api/afas-plaatsen")
def add_afas_plaatsen(payload: AfasPlaatsenRequest, admin: tuple[str, str] = Depends(current_admin)):
    """Add the places the table doesn't hold yet; say how many were new."""
    places = [(p.land.strip(), p.plaats.strip()) for p in payload.places]
    if len(places) > 5000:
        raise HTTPException(status_code=400, detail="Te veel plaatsen in één keer (maximaal 5000).")
    if any(not land or not plaats or len(land) > 16 or len(plaats) > 200 for land, plaats in places):
        raise HTTPException(
            status_code=400,
            detail="Elke plaats heeft een land (max. 16 tekens) en een naam (max. 200 tekens) nodig.",
        )
    try:
        added, existing = afas_plaatsen.add(places)
    except OSError as exc:
        logger.error("AFAS plaatsen: %s", exc)
        raise HTTPException(status_code=503, detail=_PLAATSEN_UNREACHABLE) from exc
    logger.info("AFAS plaatsen: %d toegevoegd, %d bestonden al, door %s.", added, existing, admin[0])
    return {"added": added, "existing": existing}


@app.get("/api/afas-plaatsen.csv")
def download_afas_plaatsen(_admin: tuple[str, str] = Depends(current_admin)):
    """The whole table as `Data_Woonplaatsen.csv`, UTF-8 with a BOM like the seed."""
    try:
        text = afas_plaatsen.as_csv()
    except OSError as exc:
        logger.error("AFAS plaatsen: %s", exc)
        raise HTTPException(status_code=503, detail=_PLAATSEN_UNREACHABLE) from exc
    return Response(
        content=text.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="Data_Woonplaatsen.csv"'},
    )


# --- Dossier migration (admins only) ------------------------------------------
# A project whose "conversion" is really an AFAS -> AFAS dossier migration
# (`dossier_migration.py`) rather than the usual Excel-in/AFAS-out one: copying an
# employee's dossier files that exist in one AFAS environment (source) but not in
# another (target). Two arbitrary environments, each with its own OAuth
# credentials — not the test/live pair of *one* customer environment
# `project_environment()` above builds — so this gets its own settings store
# rather than reusing `project_settings.json`.
#
# `conversionType` (joined into every session's project list, `_project_view`
# above, off AFAS's own hoofdproces dossieritem) is what routes a project to the
# dedicated page instead of the module list — see `conversionType` in `projects.json`.
# The settings here are only the source/target/mapping configuration a
# `"dossier"` project needs; there is no local flag to toggle any more.


class DossierMigrationEndpointRequest(BaseModel):
    omgeving: str = ""
    stage: str = "live"
    clientId: str = ""
    # Left out (null) keeps the secret that is stored; a string replaces it.
    clientSecret: str | None = None
    # Left out (null) keeps the stored overrides; {} clears them back to the
    # DEFAULT_CONNECTORS trio.
    connectors: dict[str, str] | None = None
    gebruiker: str | None = None  # target only; ignored on a source


class DossierMigrationMappingFileRequest(BaseModel):
    type: str = ""
    kenmerk: str = ""


class DossierMigrationMappingRequest(BaseModel):
    employees: dict[str, str] = {}
    files: dict[str, DossierMigrationMappingFileRequest] = {}


class DossierMigrationSettingsRequest(BaseModel):
    # Each left out (null) keeps what is stored — so a save can touch just one
    # of source/target/mapping without resending the rest.
    source: DossierMigrationEndpointRequest | None = None
    target: DossierMigrationEndpointRequest | None = None
    mapping: DossierMigrationMappingRequest | None = None


@app.get("/api/projects/{project_id}/dossier-migration/settings")
async def dossier_migration_settings(
    project_id: str,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen dossierconversie-instellingen bekijken.")
    ),
):
    """One project's dossier-migration settings, without its secrets."""
    name = await _project_name(project_id)
    # Off the loop: a read with nothing to keep atomic.
    row = await asyncio.to_thread(dossier_migration.settings_row, project_id)
    try:
        view = dossier_migration.settings_view(project_id, name, row)
    except EncryptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"settings": view}


@app.put("/api/projects/{project_id}/dossier-migration/settings")
async def save_dossier_migration_settings(
    project_id: str,
    payload: DossierMigrationSettingsRequest,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen dossierconversie-instellingen wijzigen.")
    ),
):
    """Save one project's dossier-migration settings, and answer with them as a GET
    would. `source`/`target`/`mapping` each keep what's stored when left out —
    same null-keeps-stored rule the secrets themselves follow, one level up."""
    name = await _project_name(project_id)
    # On the loop on purpose, here and at `save_settings` below: read, merge and
    # write with no `await` between them is what keeps two saves from overwriting
    # each other — the one worker never runs another request in that gap.
    stored = dossier_migration.settings_row(project_id)

    def endpoint_fields(
        key: str, sent: DossierMigrationEndpointRequest | None, *, with_gebruiker: bool
    ) -> dict:
        stored_side = stored.get(key) or {}
        if sent is None:
            return stored_side

        def secret() -> str:
            """What to store for this side's client secret: what came in,
            encrypted — or what is already there, encrypted now if the file
            still holds it in plain text."""
            if sent.clientSecret is None:
                return _crypto(ensure_encrypted, stored_side.get("client_secret"))
            return _crypto(encrypt, sent.clientSecret)

        number = _omgeving_number(sent.omgeving)
        fields = {
            "omgeving": str(number) if number is not None else "",
            "stage": _project_stage(sent.stage).value,
            "client_id": _crypto(encrypt, sent.clientId),
            "client_secret": secret(),
            "connectors": sent.connectors if sent.connectors is not None else stored_side.get("connectors", {}),
        }
        if with_gebruiker:
            fields["gebruiker"] = (sent.gebruiker or "").strip() or None
        return fields

    def mapping_fields(sent: DossierMigrationMappingRequest | None) -> dict:
        if sent is None:
            return stored.get("mapping") or {"employees": {}, "files": {}}
        return {
            "employees": {str(k): str(v) for k, v in sent.employees.items()},
            "files": {
                str(k): {"type": v.type, "kenmerk": v.kenmerk} for k, v in sent.files.items()
            },
        }

    fields = {
        "source": endpoint_fields("source", payload.source, with_gebruiker=False),
        "target": endpoint_fields("target", payload.target, with_gebruiker=True),
        "mapping": mapping_fields(payload.mapping),
    }
    row = dossier_migration.save_settings(project_id, name, fields)
    try:
        view = dossier_migration.settings_view(project_id, name, row)
    except EncryptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"settings": view}


class DossierMigrationConnectionTestRequest(BaseModel):
    side: str  # "source" or "target"
    omgeving: str = ""
    stage: str = "live"
    clientId: str = ""
    # Left out (null) tests with the stored secret; a string tests that one.
    clientSecret: str | None = None


@app.post("/api/projects/{project_id}/dossier-migration/settings/test-connection")
async def test_dossier_migration_connection(
    project_id: str,
    payload: DossierMigrationConnectionTestRequest,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen de AFAS-verbinding testen.")
    ),
):
    """Try one side (source or target) of a project's migration and report whether
    AFAS answered — same reasoning as `test_project_connection` above: a refusal by
    AFAS is an outcome, not an HTTP error, since it's the very thing the admin
    pressed the button to find out."""
    await _project_name(project_id)
    if payload.side not in ("source", "target"):
        raise HTTPException(status_code=400, detail="side moet 'source' of 'target' zijn.")

    number = _omgeving_number(payload.omgeving)
    try:
        env = dossier_migration.migration_environment(
            project_id,
            payload.side,
            omgeving=str(number) if number is not None else None,
            stage=_project_stage(payload.stage),
            client_id=payload.clientId,
            client_secret=payload.clientSecret,
        )
        result = await get_metainfo(env)
    except EncryptionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _connection_view(result, env)


def _dossier_migration_run_view(state: dossier_migration.RunState) -> dict:
    stats = state.stats
    return {
        "runId": state.run_id,
        "status": state.status,
        "dryRun": state.dry_run,
        "startedAt": state.started_at,
        "finishedAt": state.finished_at,
        "error": state.error,
        "stats": {
            "totalSource": stats.total_source,
            "alreadyPresent": stats.already_present,
            "toTransfer": stats.to_transfer,
            "succeeded": stats.succeeded,
            "failed": stats.failed,
            "skipped": stats.skipped,
            "failures": stats.failures,
        },
    }


class StartDossierMigrationRunRequest(BaseModel):
    dryRun: bool = True


@app.post("/api/projects/{project_id}/dossier-migration/runs")
async def start_dossier_migration_run(
    project_id: str,
    payload: StartDossierMigrationRunRequest,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen een dossierconversie starten.")
    ),
):
    """Start a diff (dry run) or diff-and-transfer (live run) in the background and
    return its id right away — poll it with the GET below. 409 when this project
    already has one running: a second, overlapping run against the same two
    environments would double-count and double-upload."""
    name = await _project_name(project_id)
    try:
        state = await dossier_migration.start_run(project_id, name, payload.dryRun)
    except dossier_migration.RunAlreadyInProgress as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"run": _dossier_migration_run_view(state)}


@app.get("/api/projects/{project_id}/dossier-migration/runs/{run_id}")
async def dossier_migration_run(
    project_id: str,
    run_id: str,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen een dossierconversie bekijken.")
    ),
):
    state = dossier_migration.run(run_id)
    if state is None or state.project_id != project_id:
        raise HTTPException(status_code=404, detail="Onbekende dossierconversie-run.")
    return {"run": _dossier_migration_run_view(state)}


@app.get("/api/projects/{project_id}/dossier-migration/runs")
async def dossier_migration_runs(
    project_id: str,
    _admin: tuple[str, str] = Depends(
        require_admin("Alleen beheerders kunnen dossierconversie-runs bekijken.")
    ),
):
    """This project's most recent runs, newest first — so a page reload doesn't
    lose sight of a run still in progress or just finished."""
    return {"runs": [_dossier_migration_run_view(state) for state in dossier_migration.runs_for_project(project_id)]}


# --- UpdateConnector schemas --------------------------------------------------
# What an UpdateConnector accepts: every field with its type, whether it is
# mandatory and its allowed values, plus the tree of nested objects under it — and
# the **root key** of the body, which is regularly not the connector name
# (`KnEmployee` → `AfasEmployee`).
#
# **Two sources.**
#
#   modules  The general schemas, from AFAS's public OpenAPI specs
#            (github.com/AFASSoftware/OASContent, the content behind
#            docs.afas.help/profit) — a *pure* Profit environment, no vrije velden.
#            Converted into AFAS's own `metainfo/update` shape and committed under
#            `json_files/schemas/` by `scripts/sync_oas.py`; read from disk, never
#            from the internet at runtime. Every standard mapping is made against these.
#   clients  A client whose inrichting deviates — vrije velden, other mandatory
#            fields — for one module (flagged in the project settings, or a maatwerk
#            module): that schema is read from **the client's own environment**
#            (`metainfo/update/<connector>`) — see *Client-specific field mappings*.

SCHEMAS_DIR = JSON_DIR / "schemas"

# group id -> label. Only one general group is left: the OAS.
CONNECTOR_GROUPS: dict[str, tuple[str, str]] = {
    "modules": ("AFAS OAS", "oas"),
}


def _known_group(group: str) -> str:
    """The group, or a 400 for one this app doesn't have."""
    if group not in CONNECTOR_GROUPS:
        known = ", ".join(CONNECTOR_GROUPS)
        raise HTTPException(status_code=400, detail=f"Onbekende groep '{group}'. Gebruik: {known}.")
    return group


def _oas_index() -> dict:
    try:
        return _load_json("schemas/_index.json")
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="Er zijn nog geen AFAS-schema's. Draai `python scripts/sync_oas.py` in backend/.",
        ) from None


def _oas_environment_view() -> dict:
    index = _oas_index()
    return {
        "host": "github.com/AFASSoftware/OASContent",
        "omgeving": "",
        "stage": "oas",
        "label": "AFAS OAS",
        "info": {"commit": str(index.get("commit", ""))[:7], "source": str(index.get("source", ""))},
    }


def _oas_schema(connector: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_]+", connector):
        raise HTTPException(status_code=400, detail=f"'{connector}' is geen connectornaam.")
    path = SCHEMAS_DIR / f"{connector}.json"
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"UpdateConnector '{connector}' staat niet in de AFAS OAS.",
        ) from None


def _environment_view(env: AfasEnvironment, payload: dict) -> dict:
    """Which AFAS answered. `info` is AFAS naming itself (envid, appName)."""
    info = payload.get("info")
    return {
        "host": env.host,
        "omgeving": env.omgevingnummer,
        "stage": env.stage.value,
        "label": env.label,
        "info": info if isinstance(info, dict) else {},
    }


# Every route below is for us, not for a client.
schema_admin = require_admin()


# --- Client schema cache ------------------------------------------------------
# A client's UpdateConnector metainfo is the **shape** of a connector — not anybody's
# data — and expensive (`KnEmployee` is ~850 KB). Cached per environment **and**
# connector: the same connector in another environment is a different schema.

_SCHEMA_TTL = float(os.getenv("AFAS_SCHEMA_CACHE_TTL", "3600"))

# (omgevingnummer, stage, connector) -> (schema, monotonic time it was fetched)
_schema_cache: dict[tuple[str, str, str], tuple[dict, float]] = {}


def _schema_cache_key(env: AfasEnvironment, connector: str) -> tuple[str, str, str]:
    return (env.omgevingnummer, env.stage.value, connector)


async def _connector_schema(env: AfasEnvironment, connector: str) -> dict:
    """A client's UpdateConnector schema, from the cache when fresh, else from AFAS —
    whose refusal is raised as the route's error. A failure is never cached."""
    entry = _schema_cache.get(_schema_cache_key(env, connector))
    if entry is not None and time.monotonic() - entry[1] <= _SCHEMA_TTL:
        return entry[0]
    result = await update_connector_metainfo(env, connector)
    if not result.succeeded:
        raise _afas_http_error(result)
    schema = result.payload or {}
    if schema:
        _schema_cache[_schema_cache_key(env, connector)] = (schema, time.monotonic())
    return schema


@app.get("/api/afas/updateconnectors")
async def afas_update_connectors(_admin: tuple[str, str] = Depends(schema_admin)):
    """Every UpdateConnector in the AFAS OAS, as one group."""
    index = _oas_index()
    return {
        "groups": [
            {
                "id": "modules",
                "label": CONNECTOR_GROUPS["modules"][0],
                "environment": _oas_environment_view(),
                "connectors": [
                    {"id": c["id"], "description": c.get("description") or ""}
                    for c in index.get("connectors", [])
                ],
                "message": "",
            }
        ]
    }


@app.get("/api/afas/updateconnectors/{group}/{connector}")
async def afas_update_connector(
    group: str, connector: str, _admin: tuple[str, str] = Depends(schema_admin)
):
    """One UpdateConnector's whole schema, from the OAS: `id`, `description`, the
    body's root key in `name`, `fields` and the nested `objects`."""
    _known_group(group)
    return {"schema": _oas_schema(connector)}


# --- GetConnectors, for the AFAS-lookup dialog --------------------------------
# The mapping editor's *Opzoeken in AFAS* dialog (see `lookups.py`) offers the
# GetConnectors a value can be looked up in, their fields, and a few rows. The OAS
# has no client GetConnectors (the `CON_*` ones are ours), so these are read from a
# **project's** environment: the one named in `?project=`, else the first project
# with a working-looking connection.

_LOOKUP_SAMPLE_ROWS = 8


async def _lookup_environment(project_id: str | None) -> AfasEnvironment:
    if project_id:
        _project(project_id)
        candidates = [project_id]
    else:
        tokens = local_store.all_tokens()
        candidates = [
            p["id"]
            for p in local_store.projects()
            if any(_stage_states(p, tokens.get(p["id"], {})).values())
        ]
    for candidate in candidates:
        for stage in (AfasStage.LIVE, AfasStage.TEST):
            env = await project_environment(candidate, stage)
            try:
                env.require_complete()
            except AfasConfigError:
                continue
            return env
    raise HTTPException(
        status_code=400,
        detail="Geen project met ingevulde AFAS-gegevens om de GetConnectors uit te lezen.",
    )


@app.get("/api/afas/getconnectors/{group}")
async def afas_get_connectors(
    group: str, project: str | None = None, _admin: tuple[str, str] = Depends(schema_admin)
):
    """Every GetConnector the project's environment exposes. A refusal is an outcome
    with AFAS's reason, not an HTTP error — the dialog then lets the admin type the
    connector's name instead."""
    try:
        env = await _lookup_environment(project)
    except HTTPException as exc:
        return {"environment": None, "connectors": [], "message": str(exc.detail)}
    result = await get_metainfo(env)
    payload = result.payload or {}
    connectors = payload.get("getConnectors")
    return {
        "environment": _environment_view(env, payload),
        "connectors": connectors if isinstance(connectors, list) else [],
        "message": "" if result.succeeded else result.message,
    }


@app.get("/api/afas/getconnectors/{group}/{connector}")
async def afas_get_connector(
    group: str,
    connector: str,
    project: str | None = None,
    _admin: tuple[str, str] = Depends(schema_admin),
):
    """One GetConnector's fields (`metainfo/get`, passed through) and its first few rows."""
    if not lookups.valid_name(connector):
        raise HTTPException(status_code=400, detail=f"'{connector}' is geen connectornaam.")
    env = await _lookup_environment(project)
    meta = await get_connector_metainfo(env, connector)
    if not meta.succeeded:
        raise _afas_http_error(meta)
    sample = await get_connector(env, connector, skip=0, take=_LOOKUP_SAMPLE_ROWS)
    return {
        "metainfo": meta.payload or {},
        "rows": sample.rows if sample.succeeded else [],
        "rowsMessage": "" if sample.succeeded else sample.message,
    }


# --- Connector check at project setup -----------------------------------------
# A new client's environment has none of our GetConnectors until they are imported:
# the `.gcn` files in `connectoren/` (codetabellen `ALG_*`, existing records and
# lookups `CON_*`, `Conversie_*`), each added to the client's app connector afterwards.
# Without them a codetabel check silently passes and *Bestaat al* can't be read, so
# setup checks every one, plus the UpdateConnectors the project's modules write to.
# The tool only checks; the import is done by hand in Profit (the `.gcn` files are
# downloadable from here).

CONNECTOREN_DIR = Path(__file__).resolve().parent.parent / "connectoren"


def _gcn_files() -> list[str]:
    return sorted(path.stem for path in CONNECTOREN_DIR.glob("*.gcn"))


def _project_update_connectors(project_id: str) -> dict[str, list[str]]:
    """UpdateConnector -> the project's modules that write to it, off the standard
    mappings (a split module's variants included) and the maatwerk modules."""
    modules = set(local_store.project_modules(project_id))
    found: dict[str, list[str]] = {}
    for group, _pid, key, document in mapping_store.entries():
        if group != "modules":
            continue
        module_id = next((m for m in modules if key == m or key.startswith(f"{m}-")), None)
        connector = str(document.get("connector") or "")
        if module_id and connector:
            found.setdefault(connector, [])
            if module_id not in found[connector]:
                found[connector].append(module_id)
    for custom in _custom_modules(project_id):
        connector = str(custom.get("connector") or "")
        if connector:
            found.setdefault(connector, []).append(str(custom["id"]))
    return found


@app.get("/api/projects/{project_id}/connectors/check")
async def check_project_connectors(project_id: str, stage: str):
    """Which of our GetConnectors and the module UpdateConnectors the client's
    environment exposes to this app connector. A refusal is an outcome (`ok: false`
    with AFAS's reason), not an HTTP error."""
    _project(project_id)
    env = await project_environment(project_id, _project_stage(stage))
    result = await get_metainfo(env)
    payload = result.payload or {}
    have_get = {str(c.get("id")) for c in payload.get("getConnectors") or [] if isinstance(c, dict)}
    have_update = {str(c.get("id")) for c in payload.get("updateConnectors") or [] if isinstance(c, dict)}
    return {
        "ok": result.succeeded,
        "message": "" if result.succeeded else result.message,
        "environment": _environment_view(env, payload) if result.succeeded else None,
        "getConnectors": [
            {"id": name, "present": name in have_get, "file": f"{name}.gcn"} for name in _gcn_files()
        ],
        "updateConnectors": [
            {"id": connector, "present": connector in have_update, "modules": modules}
            for connector, modules in sorted(_project_update_connectors(project_id).items())
        ],
    }


@app.get("/api/connectoren/{name}")
def download_gcn(name: str):
    """One `.gcn` file from `connectoren/`, to import in Profit."""
    stem = name[:-4] if name.endswith(".gcn") else name
    if stem not in _gcn_files():
        raise HTTPException(status_code=404, detail=f"Connector '{name}' bestaat niet.")
    return Response(
        content=(CONNECTOREN_DIR / f"{stem}.gcn").read_bytes(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{stem}.gcn"'},
    )


# --- Field mappings -----------------------------------------------------------
# Which column of a module's Excel template — or which fixed value — fills each field
# of an UpdateConnector. Built on `/afas/updateconnectors` by dragging columns onto
# fields; this is where the result is kept, so it survives the tab it was made in.
#
# **One file per mapping**, under `json_files/mappings/<group>/<key>.json` — not a
# row in one shared array, because a mapping is sizeable and hand-edited often enough
# that touching "the Projecten mapping" should mean editing one file, not picking a
# row out of a JSON array holding a dozen others. The group is in the path rather
# than beside it: the two groups are two environments (see above) and the same
# connector name in each is a different schema, so `modules/KnSalesRelationOrg` and
# `nymbus/KnSalesRelationOrg` are two files.
#
# The **key** differs by group, because what's ambiguous differs by group:
#   - `nymbus/<Connector>.json` — keyed by connector. No module concept applies to
#     the dossier/workflow connectors this tool writes through itself.
#   - `modules/<module-id>.json` — keyed by the **app module id**
#     (`hrm-medewerkers`, `erp-projecten`, …), *not* the connector. Reason: a
#     connector can serve more than one module — `KnEmployee` maps both
#     `hrm-medewerkers` and `hrm-uitzendkrachten`, each with its own file and its own
#     (smaller) set of mapped fields — so the connector alone can't address a mapping.
#     The file's own `connector` field says which AFAS connector it targets;
#     `_mapping_rows()` trusts that value rather than deriving it from the filename,
#     which is the one place this store reads a field from file content instead of
#     from the path it found it at.
#
# **The page addresses a modules mapping the same way** — by module, not by
# connector. It did not always: keyed by `group`+`connector`, its own lookup could
# hold only one of every pair sharing a connector (four pairs, eight of the nineteen
# files), so the other silently lost the collision in the browser's map and clicking
# either row opened whichever had loaded last. **Opslaan** then wrote a *third*,
# connector-keyed file (`modules/KnEmployee.json`) beside the two real ones — a file
# nothing reads back, so the save reported success and changed nothing.
#
# Both halves are closed: the rail hands each module row its own mapping id
# (`moduleMappingKey()` in `lib/field-mapping.ts`), and `_checked_mapping_key()`
# below refuses a modules-group write that names anything other than a mapping this
# directory already holds — so a connector-keyed file cannot be created here again.
#
# **A mapping is not per client, and that is the point.** It is made against the schema
# of the *template* environment, of which every customer environment is a copy — so one
# mapping per connector is what writes the records at all of them. A
# client whose mapping has to deviate gets a copy of its own in the `clients` group,
# addressed by project and module id — module-id-keyed for the same reason
# `modules` is, since one client can flag more than one module sharing a connector too.
# See *Client-specific field mappings*, further down, for where it is read and written.
#
# The document is the frontend's own `MappingExport` (`lib/field-mapping.ts`) — every
# filled field with its object path, and either the column behind it or the constant —
# stored **as it is read on screen**, which is also how it is restored: the object trail
# plus the field code rebuild the key the page maps under. Two figures are added here:
# who saved it and when, the same way the progress store stamps a check, because "which
# of these two mappings is the newer one" shouldn't depend on a browser clock.
#
# Stored in the `field_mappings` table of the Postgres database, one row per mapping,
# addressed the way the JSON files under `json_files/mappings/` that preceded it were:
# group, project (for `clients`) and key. Those files are still the seed the table is
# filled from when it is first created — see
# `mapping_store.py`. Nothing secret, so nothing here is encrypted.
#
# Admin-only, like the schemas it is built on.

# What a stored field says about where its value comes from.
_MAPPING_SOURCES = ("column", "fixed")


class MappingFieldModel(BaseModel):
    """One filled field. `object` is its path from the root, root first."""

    object: list[str]
    field: str
    label: str = ""
    mandatory: bool = False
    source: str
    # A column's: the header it was mapped to and where it sat.
    column: str | None = None
    columnIndex: int | None = None
    # A column's, again: whether it is part of the **group key** — the columns whose
    # values decide that several rows are one record rather than one each (a
    # voorcalculatie-offerte and its regels; see *Grouping* in
    # `frontend/src/lib/field-mapping.ts`). Declared here because it is otherwise
    # dropped on the way through: Pydantic ignores keys the model doesn't name and
    # `model_dump()` only writes the ones it does, so a mapping saved from the page
    # would come back ungrouped without this line.
    #
    # `None` rather than `False` as the default so `exclude_none=True` leaves it out
    # of every field that isn't a key — a mapping that doesn't group reads in a diff
    # exactly as it did before the concept existed.
    key: bool | None = None
    # A column's, again: a translation from a raw cell value to what AFAS actually
    # receives, keyed by the trimmed cell text — the sheet carries the client's own
    # codes (a Hulptabel, a legacy system's own list) and AFAS's field regularly
    # wants its own (`erp-voorcalculatie`'s *Type item*: `Wst`→`1`, `Art`→`2`, `Kst`→
    # `6`, `Sam`→`7`). `None` rather than `{}` for the same `exclude_none` reason as
    # `key` above.
    valueMap: dict[str, Any] | None = None
    # A column's, again: the cell is **looked up** in a GetConnector of the
    # environment being written to, and that row's value is what AFAS receives
    # (`erp-abonnementen`'s `BcId`/`DbId`: the relation and debiteur behind the
    # project, from `CON_ERP_Projecten`). See `lookups.py`. `None` for the same `exclude_none`
    # reason as `key`.
    lookup: "MappingLookupModel | None" = None
    # A column's, again: a factor the cell's number is multiplied by before it is
    # sent — the sheet's unit is not always AFAS's (`hrm-verlofsaldo`'s `HhMm`: the
    # client enters hours, AFAS wants minutes, so ×60). Only on an `int`/`decimal`
    # field, and exclusive with `valueMap`/`lookup`, which replace the cell rather
    # than scale it. `None` for the same `exclude_none` reason as `key`.
    multiply: int | float | None = None
    # A column's, again: another column read when this one's cell is empty
    # (`hrm-medewerkers`' *E-mail privé* falls back to *E-mail werk*). A filled cell
    # always wins. `None` for the same `exclude_none` reason as `key`.
    fallback: "MappingFallbackModel | None" = None
    # A fixed value's: whatever type the AFAS field has (string, number, boolean).
    value: Any = None


class MappingLookupModel(BaseModel):
    """Where a looked-up field's value comes from: the row of `connector` whose
    `matchField` equals the cell, and that row's `valueField`. Field **ids**, as
    `metainfo/get/<connector>` names them — not labels."""

    connector: str
    matchField: str
    valueField: str
    # What one row of the connector is, for the panel's wording — `Project` makes a
    # miss read *Project "123" bestaat niet*. Not part of the whitelist key
    # (`_declared_lookups`), since it changes no read.
    noun: str | None = None


class MappingFallbackModel(BaseModel):
    """The column a field reads when its own cell is empty — by header and index,
    as the field's own column is."""

    column: str
    columnIndex: int


MappingFieldModel.model_rebuild()


class MappingDocument(BaseModel):
    """A whole mapping as the page built it.

    `connector` is declared even though the *file* is addressed by key, because for
    the `modules` group the key is the **module** id and no longer says which AFAS
    connector the mapping targets — `_mapping_rows()` reads that back from the file's
    own content. Leaving it off the model made Pydantic drop the `KnEmployee` the page
    sends and the stored `connector` fall back to the path segment, so a saved module
    mapping came back claiming a connector named `hrm-medewerkers` and every schema
    read for it asked AFAS for that. Empty is allowed: `nymbus` files genuinely are
    keyed by connector, so there the path stays authoritative."""

    connector: str = ""
    root: str
    file: str = ""
    sheet: str = ""
    fields: list[MappingFieldModel]


class SaveMappingRequest(BaseModel):
    mapping: MappingDocument


async def _mapping_store(call: Callable[..., _T], *args) -> _T:
    """One `mapping_store` call, off the event loop — the driver blocks — with a
    database it can't reach answered as a 500 naming why, like the settings store."""
    try:
        return await asyncio.to_thread(call, *args)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def _known_mapping_keys(group: str) -> set[str]:
    """The keys this group already holds a mapping for — the only ones a write may
    name in the `modules` group.

    Read from the store rather than from a list in code: `modules` is keyed by the app's
    **mapping id**, which for a split module is the module id plus a variant suffix
    (`erp-crediteuren-organisatie`), and that vocabulary is owned by the frontend's
    `MODULE_PAYLOAD_PLANS`. Duplicating it here would give two lists to keep in step;
    the store is already the authority both sides read back through
    (`_mapping_rows()`), so it is the authority a write is checked against too."""
    return await _mapping_store(mapping_store.keys, group)


async def _checked_mapping_key(group: str, key: str) -> str:
    """`key`, or a 400 — the guard that keeps a `modules` write addressed by module.

    `modules` files are keyed by **mapping id**, not by connector, because one
    connector serves more than one module: `KnPurchaseRelationOrg` is both
    *Crediteuren (Organisatie)* and *Contactpersonen (Crediteur)*. A write naming the
    connector instead would land in a `modules/KnPurchaseRelationOrg` row beside the
    two real ones that nothing ever reads back, so the save looks like it worked and
    changes nothing. That is the failure this refuses, loudly, rather than writing a
    row whose key already says it will be ignored.

    Only `modules` is checked. `nymbus` genuinely is keyed by connector — there is no
    module concept over the dossier connectors — so any name it offers is its own."""
    if group != "modules":
        return key
    known = await _known_mapping_keys(group)
    if key in known:
        return key
    raise HTTPException(
        status_code=400,
        detail=(
            f"'{key}' is geen module-koppeling. Een koppeling in de groep 'modules' "
            "wordt op module opgeslagen, niet op connector — kies de module in de lijst."
        ),
    )


def _safe_path_segment(value: str, *, what: str) -> str:
    """`value`, or a 400 — for anything that would turn a `Path(...) / value` into an
    escape from the directory it was meant to sit under. A project id and a module id
    address a client mapping, which running from a checkout is mirrored to a file
    below `json_files/mappings/clients/` (`mapping_store.py`), and neither is otherwise
    checked against a known list before that happens."""
    if not value or "/" in value or "\\" in value or value in (".", ".."):
        raise HTTPException(status_code=400, detail=f"Ongeldige {what}.")
    return value


def _client_mapping_address(project_id: str, module_id: str) -> tuple[str, str, str]:
    """Where one client's copy of a module's mapping is stored, as `mapping_store`
    addresses it — or a 400 for an id that couldn't be a filename."""
    return (
        "clients",
        _safe_path_segment(project_id, what="project-id"),
        _safe_path_segment(module_id, what="module-id"),
    )


async def _has_client_mapping(project_id: str, module_id: str) -> bool:
    return await _mapping_store(mapping_store.get, *_client_mapping_address(project_id, module_id)) is not None


def _mapping_row(group: str, project_id: str, key: str, document: dict) -> dict:
    """One stored mapping as the page reads it: the document plus where it is stored.

    For `nymbus` the key is authoritative over whatever the document says about
    itself under `connector`: a mapping that was moved or copied by hand shouldn't
    silently keep claiming its old address. `modules` differs because its key is the
    **module** id, not the connector — see the comment above this section — so there
    `module` comes from the key and `connector` is trusted from the document instead,
    since the key can no longer say which connector it targets. `clients` is keyed
    like `modules` and for the same reason — a connector like `KnEmployee` can serve
    more than one flagged module for the same client too — with `projectId` beside it."""
    if group == "clients":
        return {**document, "group": group, "projectId": project_id, "module": key}
    if group == "modules":
        return {**document, "group": group, "module": key}
    return {**document, "group": group, "connector": key}


async def _mapping_rows() -> list[dict]:
    """Every stored mapping — nothing saved yet is an empty store."""
    return [_mapping_row(*entry) for entry in await _mapping_store(mapping_store.entries)]


def _checked_mapping(document: MappingDocument) -> dict:
    """The document as it will be stored, or a 400 naming the field that is wrong.

    A stored mapping is read back and turned into a payload for a customer's AFAS, so
    a half-filled entry is worth refusing here rather than discovering at upload time:
    a column entry without its column would silently map nothing, and a `source` this
    app doesn't know is a document written by something else."""
    for entry in document.fields:
        where = ".".join(entry.object) + f"#{entry.field}"
        if entry.source not in _MAPPING_SOURCES:
            raise HTTPException(
                status_code=400,
                detail=f"Onbekende bron '{entry.source}' voor {where}.",
            )
        if entry.source == "column" and (entry.column is None or entry.columnIndex is None):
            raise HTTPException(
                status_code=400, detail=f"Kolomkoppeling zonder kolom voor {where}."
            )
        if entry.source == "fixed" and entry.value is None:
            raise HTTPException(
                status_code=400, detail=f"Vaste waarde zonder waarde voor {where}."
            )
        # A fixed value is the same on every row, so it can't identify one: a key on
        # it would put the whole sheet in a single group. The frontend's type already
        # rules it out; refused here too, since a document can arrive from elsewhere.
        if entry.key and entry.source != "column":
            raise HTTPException(
                status_code=400,
                detail=f"Alleen een kolomkoppeling kan een groepeersleutel zijn ({where}).",
            )
        # A fixed value already is the value it carries — there is nothing on it a
        # translation table would translate.
        if entry.valueMap and entry.source != "column":
            raise HTTPException(
                status_code=400,
                detail=f"Alleen een kolomkoppeling kan een vertaaltabel hebben ({where}).",
            )
        # A fallback is a second column to read, so it only exists beside a first one.
        if entry.fallback is not None and entry.source != "column":
            raise HTTPException(
                status_code=400,
                detail=f"Alleen een kolomkoppeling kan een terugvalkolom hebben ({where}).",
            )
        if entry.multiply is not None:
            # A factor scales the cell's own number, so it lives on a column, and not
            # beside a translation or a lookup: those replace the cell, and scaling
            # their answer is a second rule nobody wrote down.
            if entry.source != "column":
                raise HTTPException(
                    status_code=400,
                    detail=f"Alleen een kolomkoppeling kan een vermenigvuldiging hebben ({where}).",
                )
            if entry.valueMap or entry.lookup is not None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{where} heeft een vermenigvuldiging naast een vertaaltabel of "
                        "AFAS-opzoeking; kies er één."
                    ),
                )
            if not math.isfinite(entry.multiply) or entry.multiply == 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"De vermenigvuldiging voor {where} moet een getal ongelijk aan 0 zijn.",
                )
        if entry.lookup is not None:
            # A lookup reads the cell, so like a translation table it only exists on
            # a column — and it *is* the translation, so the two can't both apply.
            if entry.source != "column":
                raise HTTPException(
                    status_code=400,
                    detail=f"Alleen een kolomkoppeling kan een AFAS-opzoeking hebben ({where}).",
                )
            if entry.valueMap:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{where} heeft zowel een vertaaltabel als een AFAS-opzoeking; "
                        "kies er één."
                    ),
                )
            names = (entry.lookup.connector, entry.lookup.matchField, entry.lookup.valueField)
            if not all(lookups.valid_name(name) for name in names):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"De AFAS-opzoeking voor {where} noemt een connector of veld "
                        "dat geen AFAS-naam is."
                    ),
                )
    # `exclude_none` so a column entry doesn't carry a null `value` and a fixed one no
    # null `column`: the file is meant to be read (and reviewed in a diff), and half
    # its keys being null for every row is noise a reader has to look past.
    return document.model_dump(exclude_none=True)


async def _stored_connector(group: str, key: str, document: dict) -> str:
    """The connector a save should store, **popped out of** `document` so the spread
    that follows it can't put the raw one back.

    The two groups answer differently because they are keyed differently. `nymbus`
    files are keyed by connector, so the path segment is the connector and stays
    authoritative — `_mapping_rows()` reads them back off the path for exactly that
    reason. `modules` files are keyed by module id, which says nothing about the
    connector, so the only source is the document the page sent (`schema.id`). A
    `modules` document that names no connector keeps whatever the file already had,
    rather than falling back to the module id: a mapping written by hand, or by an
    older page that didn't send the field, is better left alone than relabelled with
    a string AFAS has no connector for."""
    sent = str(document.pop("connector", "") or "").strip()
    if group != "modules":
        return key
    if sent:
        return sent
    existing = await _mapping_store(mapping_store.get, group, "", key)
    kept = str((existing or {}).get("connector", "") or "").strip()
    # Never keep a connector equal to the module id: that is this bug's own
    # footprint, and preserving it would outlive the fix.
    if kept and kept != key:
        return kept
    raise HTTPException(
        status_code=400,
        detail=(
            f"De koppeling voor '{key}' noemt geen AFAS-connector. "
            "Open de module opnieuw in Updateconnectors en sla hem daar op."
        ),
    )


@app.get("/api/afas/mappings")
async def afas_mappings(_admin: tuple[str, str] = Depends(schema_admin)):
    """Every stored mapping, newest save first. The page reads them all at once: it
    needs to know *which* connectors have one (the list marks them) as much as what
    is in the one that is open."""
    rows = sorted(await _mapping_rows(), key=lambda row: str(row.get("savedAt", "")), reverse=True)
    return {"mappings": rows}


# Every route below writes a mapping, so it shares one message.
mapping_writer_admin = require_admin("Alleen beheerders kunnen een koppeling opslaan.")


def _saved_stamp(admin: tuple[str, str]) -> dict:
    """Who saved a mapping, and when — the same three fields on every mapping row."""
    email, name = admin
    return {"savedAt": now_iso(), "savedBy": email, "savedByName": name}


@app.put("/api/afas/mappings/{group}/{connector}")
async def save_afas_mapping(
    group: str,
    connector: str,
    payload: SaveMappingRequest,
    admin: tuple[str, str] = Depends(mapping_writer_admin),
):
    """Store this connector's mapping, replacing whatever was there. Answers with the
    stored row, so the page shows the moment the server stamped rather than its own.

    Saving through this route only ever writes the fields `MappingExport` carries —
    anything a mapping's file holds beyond that shape (a `notes` array, a
    `verifiedAgainst` provenance block) does not round-trip through the page and is
    overwritten on the next save from here. That is a gap in the page, not a reason to
    avoid writing those fields by hand."""
    _known_group(group)  # 400 for a group this app doesn't have
    # 400 for a `modules` write addressed by connector rather than by module — see
    # `_checked_mapping_key()`; without it the save writes a row nothing reads.
    await _checked_mapping_key(group, connector)
    document = _checked_mapping(payload.mapping)
    row = {
        "group": group,
        # Which connector this mapping targets. For `nymbus` that is the path segment
        # — those files are keyed by connector and the path is authoritative, the same
        # way `_mapping_rows()` reads them back. For `modules` the path segment is the
        # **module** id, so the connector can only come from the document the page
        # sent; writing the path segment here is what stored `hrm-medewerkers` as a
        # connector name and made every later schema read ask AFAS for it. A document
        # that names none leaves whatever the file already claimed untouched.
        "connector": await _stored_connector(group, connector, document),
        **document,
        **_saved_stamp(admin),
    }
    await _mapping_store(mapping_store.put, group, "", connector, row)
    # A module flagged before this standard mapping existed gets its client copy now
    # — it starts from this, like every client mapping does.
    if group == "modules":
        await _seed_all_client_mappings(admin)
    return {"mapping": row}


mapping_deleter_admin = require_admin("Alleen beheerders kunnen een koppeling verwijderen.")


@app.delete("/api/afas/mappings/{group}/{connector}")
async def delete_afas_mapping(
    group: str, connector: str, _admin: tuple[str, str] = Depends(mapping_deleter_admin)
):
    """Forget this connector's mapping. Deleting one that isn't there is not an error
    — the caller wanted it gone, and it is."""
    _known_group(group)
    deleted = await _mapping_store(mapping_store.delete, group, "", connector)
    return {"deleted": 1 if deleted else 0}


# --- Client-specific field mappings --------------------------------------------
# The exception flagged in *Projectinstellingen → Afwijkende koppelingen*
# (`custom_mapping_modules` in `project_settings.json`, see above): a module whose
# mapping has to deviate for one client gets a copy of its own, stored in the
# `clients` group under its project and module id — keyed by module id rather than
# connector for the same reason `modules` is (`_mapping_row()`).
#
# A module can only go custom once it has a **standard** mapping to start from
# (`_module_connector()`) — a client mapping is a snapshot of that one, not built from
# nothing, so there is nothing to snapshot until the standard mapping exists.
#
# The one thing that genuinely differs from the standard flow: the schema is read from
# **this project's own AFAS** (`project_environment(project_id, …)`), not from the
# template project — the whole point of flagging a module is that this customer's copy
# of the template has drifted from it. Both go through `project_environment()` now that
# the template is itself a project; what differs is *which* project id, and the stage
# (a flagged module is read at test, the template at live).


async def _module_connector(module_id: str) -> str:
    """The connector this module's **standard** mapping targets — what a client
    mapping starts as a copy of, and the schema its own copy has to be read against.
    A 400 for a module nothing has mapped yet: there is no connector to address a
    schema with, and no standard mapping to snapshot."""
    for row in await _mapping_rows():
        if row.get("group") == "modules" and row.get("module") == module_id:
            connector = row.get("connector")
            if connector:
                return str(connector)
    raise HTTPException(
        status_code=400,
        detail=f"Module '{module_id}' heeft nog geen standaardkoppeling om van te starten.",
    )


def _flagged_mapping_ids(module_id: str, standard_ids: Iterable[str]) -> list[str]:
    """The standard mappings a flag on catalog module `module_id` covers — what its
    client copies are addressed by.

    The flag names a **sidebar** module (`erp-crediteuren`), but a split module has no
    mapping under that id: its halves are stored as `<module>-<variant>`
    (`erp-crediteuren-organisatie` / `-persoon`, see `MODULE_PAYLOAD_PLANS`), and the
    payload view reads a client copy by exactly that variant id. So a flag on one
    expands to every variant — the same prefix reading `_module_connectors()` makes —
    while an ordinary module, stored under its own id, stays itself. A module with no
    standard mapping at all also stays itself, so it is still listed (unopenable)."""
    ids = set(standard_ids)
    if module_id in ids:
        return [module_id]
    prefix = f"{module_id}-"
    variants = sorted(i for i in ids if i.startswith(prefix))
    return variants or [module_id]


def _flagged_mapping_label(module_id: str, mapping_id: str) -> str:
    """`Crediteuren (Organisatie)` for a variant, the catalog label for the module
    itself — the reading the standard rail gives the same mapping."""
    label = (_catalog_module(module_id) or {}).get("moduleName", module_id)
    if mapping_id == module_id:
        return label
    suffix = mapping_id[len(module_id) + 1 :]
    return f"{label} ({suffix[:1].upper()}{suffix[1:]})"


@app.get("/api/afas/updateconnectors/clients")
async def afas_update_connector_clients(_admin: tuple[str, str] = Depends(schema_admin)):
    """Every project with at least one module flagged as mapped differently, each
    with that module's connector — resolved from its standard mapping — and whether
    a client-specific mapping already exists for it. What the page's third rail
    section lists, so an admin doesn't have to open every project's settings to find
    out which ones need attention.

    A flagged module without a standard mapping yet comes back with `connector: null`
    — the page can say so rather than offering to open a schema that has no address."""
    rows = await _mapping_rows()
    standard_connector = {
        str(row["module"]): str(row["connector"])
        for row in rows
        if row.get("group") == "modules" and row.get("module") and row.get("connector")
    }
    has_client_mapping = {
        (str(row.get("projectId")), str(row.get("module")))
        for row in rows
        if row.get("group") == "clients"
    }

    # Custom modules (maatwerk) are listed beside the flagged ones: both are a client
    # mapping read against the project's own AFAS, so the rail opens them the same way.
    # `parentModuleId` is what tells the two apart on screen.
    custom_store = await asyncio.to_thread(_custom_module_store)

    def custom_entry(project_id: str, custom: dict) -> dict:
        return {
            "moduleId": str(custom["id"]),
            "moduleLabel": str(custom.get("label") or custom["id"]),
            "connector": str(custom.get("connector") or "") or None,
            "hasMapping": (project_id, str(custom["id"])) in has_client_mapping,
            "parentModuleId": str(custom.get("parentModuleId") or ""),
        }

    projects = []
    seen: set[str] = set()
    for row in _settings_rows():
        project_id = str(row.get("projectId") or "").strip()
        if not project_id:
            continue
        module_ids = _stored_custom_modules(row.get("custom_mapping_modules"))
        # One row per mapping, not per flag: a flagged Crediteuren is two client
        # mappings (Organisatie, Persoon), each opened and saved on its own.
        modules = [
            {
                "moduleId": mapping_id,
                "moduleLabel": _flagged_mapping_label(module_id, mapping_id),
                "connector": standard_connector.get(mapping_id),
                "hasMapping": (project_id, mapping_id) in has_client_mapping,
                "parentModuleId": None,
            }
            for module_id in module_ids
            for mapping_id in _flagged_mapping_ids(module_id, standard_connector)
        ]
        modules += [custom_entry(project_id, custom) for custom in custom_store.get(project_id, [])]
        seen.add(project_id)
        if not modules:
            continue
        projects.append(
            {
                "projectId": project_id,
                "projectName": str(row.get("projectName") or "").strip() or project_id,
                "modules": modules,
            }
        )
    # A project with custom modules but no settings row yet: still listed, so its
    # mapping can be found — its schema read will say the credentials are missing.
    for project_id, customs in custom_store.items():
        if project_id in seen or not customs:
            continue
        projects.append(
            {
                "projectId": project_id,
                "projectName": project_id,
                "modules": [custom_entry(project_id, custom) for custom in customs],
            }
        )
    return {"projects": projects}


@app.get("/api/projects/{project_id}/updateconnectors/{module_id}")
async def project_update_connector(
    project_id: str, module_id: str, _admin: tuple[str, str] = Depends(schema_admin)
):
    """One flagged module's connector schema, read from **this project's own** AFAS
    test environment instead of the template — the whole point of the flag: a
    customer whose environment has drifted from the template is exactly the customer
    who needs to see its own copy rather than Nymbus's.

    A **custom module** (maatwerk) is read the same way and for a stronger reason:
    the vrije velden it exists for are not in the template at all."""
    connector = await _project_module_connector(project_id, module_id)
    env = await project_environment(project_id, AfasStage.TEST)
    # Same cache as the group route above, and safe to share: the key carries the
    # environment, so a customer's own drifted schema can never be served as the
    # template's — which is the distinction this whole route exists to make.
    schema = await _connector_schema(env, connector)
    return {
        "connector": connector,
        "schema": schema,
        "environment": _environment_view(env, {}),
    }


async def _seed_client_mappings(
    project_id: str, module_ids: list[str], admin: tuple[str, str] | None
) -> None:
    """Give each flagged module its client copy: the standard mapping as it is now —
    the snapshot the flag promises, so a client mapping **always starts as a copy of
    the standard one** rather than empty. Stamped as saved by `admin` (whoever
    flagged it or saved the standard), or, with no one to name — the startup
    backfill — left with the standard mapping's own stamp, whose work it is.

    Skipped where the copy already exists (re-flagging after an unflag, or a copy
    someone edited, must not be overwritten) and where there is no standard mapping
    to copy yet: `_seed_all_client_mappings()` fills that one in once there is."""
    standard = {
        str(row["module"]): row
        for row in await _mapping_rows()
        if row.get("group") == "modules" and row.get("module") and row.get("connector")
    }
    for mapping_id in (
        mapping_id
        for module_id in module_ids
        for mapping_id in _flagged_mapping_ids(module_id, standard)
    ):
        source = standard.get(mapping_id)
        if source is None:
            continue
        copy = {k: v for k, v in source.items() if k not in ("group", "module")}
        if admin is not None:
            copy.update(_saved_stamp(admin))
        await _mapping_store(
            mapping_store.put_if_missing, *_client_mapping_address(project_id, mapping_id), copy
        )


async def _seed_all_client_mappings(admin: tuple[str, str] | None) -> None:
    """`_seed_client_mappings()` for every project's flagged modules at once — the
    copies seeding at flag time could not make: a module flagged before its standard
    mapping existed (run again when one is saved), or before a split module's halves
    were recognised as its mappings (run at startup)."""
    for row in _settings_rows():
        project_id = str(row.get("projectId") or "").strip()
        module_ids = _stored_custom_modules(row.get("custom_mapping_modules"))
        if project_id and module_ids:
            await _seed_client_mappings(project_id, module_ids, admin)


async def _seed_all_client_mappings_quietly() -> None:
    """The startup backfill — in the background and never fatal: a database that
    can't be reached must not keep the server from coming up."""
    try:
        await _seed_all_client_mappings(None)
    except Exception:
        logger.exception("Seeding missing client mappings failed")


@app.put("/api/projects/{project_id}/mappings/{module_id}")
async def save_project_mapping(
    project_id: str,
    module_id: str,
    payload: SaveMappingRequest,
    admin: tuple[str, str] = Depends(mapping_writer_admin),
):
    """Store this client's own copy of one module's mapping — a **snapshot**: later
    edits to the standard mapping deliberately do not flow into it. The connector is
    resolved the same way the schema fetch is, never trusted from the request, so
    this file can't end up claiming a connector its own module doesn't serve."""
    connector = await _project_module_connector(project_id, module_id)
    row = {
        "connector": connector,
        **_checked_mapping(payload.mapping),
        **_saved_stamp(admin),
    }
    await _mapping_store(mapping_store.put, *_client_mapping_address(project_id, module_id), row)
    return {"mapping": {**row, "group": "clients", "projectId": project_id, "module": module_id}}


@app.delete("/api/projects/{project_id}/mappings/{module_id}")
async def delete_project_mapping(
    project_id: str, module_id: str, _admin: tuple[str, str] = Depends(mapping_deleter_admin)
):
    """Forget this client's copy. The module falls back to the standard mapping once
    something reads that fallback (docs/todo.md) — deleting a copy that isn't there
    is not an error, the caller wanted it gone and it is."""
    deleted = await _mapping_store(
        mapping_store.delete, *_client_mapping_address(project_id, module_id)
    )
    return {"deleted": 1 if deleted else 0}


# --- Custom modules (maatwerk) ---------------------------------------------------
# A **third step** some projects add to a standard module: fields only this client has
# — AFAS vrije velden (`U…` codes) on the employee, say — written to the same
# UpdateConnector as the parent module, **after** it, as a PUT on each record the
# parent created. Phases 1 and 2 of Medewerkers stay identical for every project;
# only a project with a custom module gets this extra send.
#
# What makes it cheap is what it is *not*:
#   - **Not a sheet of its own.** The columns sit in the parent's own sheet (the
#     client's Medewerkers export), so the step reads the sheet already open under the
#     parent module — no upload, no dossieritem, no deeltaak.
#   - **Not validated.** A custom module is a one-to-one mapping of columns or fixed
#     values; the mapping editor already type-checks a fixed value, and there is no
#     rule set to keep in step.
#   - **Not a new connector.** It inherits the parent's (`_module_connector()`), and the
#     schema is read from **this project's own** AFAS, since the fields it exists for
#     are exactly the ones the template environment does not have.
#
# **Stored here, as JSON, next to the mappings it belongs to** — the definition in
# `custom_modules.json` (project id -> list), its mapping in the `clients` group of the
# mapping store under `<projectId>`/`<customModuleId>`, the same place and format as an
# *Afwijkende koppeling*. Conversion config rather than a secret, so it is not in the
# `project_settings` table and needs no schema change there.
#
# The id is `<parent>--<slug>` (`hrm-medewerkers--vrije-velden`): unique within the
# project, safe as a filename, and the parent readable straight off it.

CUSTOM_MODULES_FILE = JSON_DIR / "custom_modules.json"

# The separator between parent and slug. Two dashes because a catalog id already
# contains one (`hrm-medewerkers`), so a single dash could not be split back apart.
CUSTOM_MODULE_SEPARATOR = "--"


def _custom_module_store() -> dict[str, list[dict]]:
    """Project id -> its custom modules. Missing or unreadable reads as "none": a
    hand-edited file must not take every project's sidebar down with it."""
    try:
        data = json.loads(CUSTOM_MODULES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(project_id): [row for row in rows if isinstance(row, dict) and row.get("id")]
        for project_id, rows in data.items()
        if isinstance(rows, list) and not str(project_id).startswith("_")
    }


def _write_custom_module_store(store: dict[str, list[dict]]) -> None:
    # Projects without modules are dropped, so removing the last one leaves no key.
    kept = {project_id: rows for project_id, rows in sorted(store.items()) if rows}
    write_json_atomic(CUSTOM_MODULES_FILE, kept)


def _custom_modules(project_id: str) -> list[dict]:
    return _custom_module_store().get(project_id, [])


def _custom_module(project_id: str, module_id: str) -> dict | None:
    """One project's custom module by id, or None — None also for every catalog id,
    which is what lets the routes below branch on it."""
    if CUSTOM_MODULE_SEPARATOR not in module_id:
        return None
    return next((row for row in _custom_modules(project_id) if row.get("id") == module_id), None)


def _slug(text: str) -> str:
    """`Vrije velden (HR)` -> `vrije-velden-hr`: lower-case ASCII letters and digits
    joined by single dashes, so it reads in a filename and a URL alike."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    words = "".join(ch if ch.isalnum() else " " for ch in plain.lower()).split()
    return "-".join(words)


def _custom_module_view(row: dict, has_mapping: bool) -> dict:
    """One custom module as the frontend gets it, with whether its mapping exists —
    the one thing the sidebar and the settings tab have to say about it."""
    module_id = str(row["id"])
    parent_id = str(row.get("parentModuleId") or "")
    return {
        "id": module_id,
        "label": str(row.get("label") or module_id),
        "parentModuleId": parent_id,
        "parentLabel": (_catalog_module(parent_id) or {}).get("moduleName", parent_id),
        "connector": str(row.get("connector") or ""),
        "hasMapping": has_mapping,
        "createdAt": row.get("createdAt"),
        "createdBy": row.get("createdBy"),
    }


async def _project_module_connector(project_id: str, module_id: str) -> str:
    """The connector one of a project's client mappings targets: a custom module's
    own (its parent's, fixed when it was added), otherwise the flagged catalog
    module's standard one."""
    custom = _custom_module(project_id, module_id)
    if custom is not None:
        connector = str(custom.get("connector") or "")
        if connector:
            return connector
        raise HTTPException(
            status_code=400, detail=f"Maatwerkmodule '{module_id}' noemt geen connector."
        )
    return await _module_connector(module_id)


class CustomModuleRequest(BaseModel):
    label: str
    parentModuleId: str


@app.get("/api/projects/{project_id}/custom-modules")
async def project_custom_modules(project_id: str, session: dict = Depends(current_session)):
    """This project's custom modules, in the order they were added."""
    _require_project_access(session, project_id)
    mapped = await _mapping_store(
        mapping_store.keys, "clients", _safe_path_segment(project_id, what="project-id")
    )
    return {
        "modules": [
            _custom_module_view(row, str(row["id"]) in mapped)
            for row in _custom_modules(project_id)
        ]
    }


custom_module_admin = require_admin("Alleen beheerders kunnen maatwerkmodules beheren.")


@app.post("/api/projects/{project_id}/custom-modules")
async def add_project_custom_module(
    project_id: str,
    payload: CustomModuleRequest,
    session: dict = Depends(current_session),
    admin: tuple[str, str] = Depends(custom_module_admin),
):
    """Add a custom module to a project. The connector is the parent's standard one —
    resolved here, never sent — so a custom module can only extend a module that is
    already mapped, and can never point a send at a connector its parent doesn't use.

    It starts **without** a mapping: unlike an *Afwijkende koppeling* there is nothing
    to copy, since the fields it exists for are the ones the standard mapping lacks."""
    _require_project_access(session, project_id)
    _safe_path_segment(project_id, what="project-id")
    email, name = admin
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Geef de maatwerkmodule een naam.")
    parent_id = payload.parentModuleId.strip()
    if _catalog_module(parent_id) is None:
        raise HTTPException(status_code=400, detail=f"Onbekende module '{parent_id}'.")
    slug = _slug(label)
    if not slug:
        raise HTTPException(
            status_code=400, detail="De naam moet minstens één letter of cijfer bevatten."
        )
    connector = await _module_connector(parent_id)  # 400 when the parent has no mapping yet
    module_id = f"{parent_id}{CUSTOM_MODULE_SEPARATOR}{slug}"

    # Read and written on the loop, with no `await` between: that is what makes the
    # read-modify-write atomic (one worker; see `delete_project_custom_module` too).
    store = _custom_module_store()
    rows = store.setdefault(project_id, [])
    if any(row.get("id") == module_id for row in rows):
        raise HTTPException(
            status_code=409,
            detail=f"Dit project heeft al een maatwerkmodule '{label}' onder deze module.",
        )
    row = {
        "id": module_id,
        "label": label,
        "parentModuleId": parent_id,
        "connector": connector,
        "createdAt": now_iso(),
        "createdBy": email,
        "createdByName": name,
    }
    rows.append(row)
    _write_custom_module_store(store)
    return {"module": _custom_module_view(row, await _has_client_mapping(project_id, module_id))}


@app.delete("/api/projects/{project_id}/custom-modules/{module_id}")
async def delete_project_custom_module(
    project_id: str,
    module_id: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(custom_module_admin),
):
    """Remove a custom module **and its mapping** — a mapping nothing lists any more
    is one nobody can open to delete later. Removing one that isn't there is not an
    error: the caller wanted it gone, and it is."""
    _require_project_access(session, project_id)
    store = _custom_module_store()
    rows = store.get(project_id, [])
    kept = [row for row in rows if row.get("id") != module_id]
    deleted = len(kept) != len(rows)
    if deleted:
        store[project_id] = kept
        _write_custom_module_store(store)
        await _mapping_store(
            mapping_store.delete, *_client_mapping_address(project_id, module_id)
        )
    return {"deleted": 1 if deleted else 0}


# --- Sending payloads to the customer's AFAS ----------------------------------
# The step after the payload view: the bodies that view renders, actually posted
# to the customer's own AFAS through the connector the mapping names.
#
# **The bodies are built in the browser and sent as they are.** That is deliberate
# and it is what the payload panel exists for: what an admin reads on screen is
# byte-for-byte what leaves here, so nothing can be added or dropped between
# looking and sending. Rebuilding the body server-side from the sheet would mean
# two implementations of the same mapping that could disagree — and the one on
# screen would no longer be the one that was sent.
#
# **POST, always.** AFAS gives the verb its meaning (docs/AFAS-Profit-API-Referentie.md
# §4): POST inserts, PUT updates. A conversion loads data into an environment, so
# insert is the operation; a record AFAS already has comes back as that record's
# own refusal rather than silently overwriting a customer's data.
#
# **Every record is attempted, and each one reports for itself.** AFAS has no
# transaction across calls — records already written cannot be taken back — so
# stopping halfway would leave a half-loaded environment *and* no account of which
# half. Instead each record answers ok/not-ok with AFAS's own words, and the panel
# shows that per row.

# --- Which records already exist ----------------------------------------------
# The read behind the payload view's *Bestaat al* / *Nieuw* marks: for one module,
# the record keys the customer's AFAS already holds in the environment a send would
# go to. See docs/existing-records.md, and `existing.py` for why this is not a
# codetabel.

existing_admin = require_admin("Alleen beheerders kunnen bestaande records opvragen.")


@app.get("/api/projects/{project_id}/environment")
async def project_environment_view(
    project_id: str,
    stage: str | None = None,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(existing_admin),
):
    """**Which AFAS a send would reach** — the environment number and the stage, and
    nothing else.

    It exists for the confirmation dialog in front of a send. That dialog has to name
    the environment, because the test/live switch is one click away and a record in a
    customer's live administration cannot be taken back — and "de testomgeving van dit
    project" is not a name, it is a category. Before this route the dialog took the
    name off the *previous* send's result, so the first send of a session — the one
    nobody has confirmed anything about yet — was the one that could not say where it
    was going, and eight of the fourteen modules never could: the other source was the
    existence read, which only runs for a module that has a `CON_*` lookup.

    **Carries no credential**, like the settings GET it sits beside: an omgevingsnummer
    is the address of an environment, not a way into it, and the two client secrets
    that are the way in never leave the backend. It says nothing about whether the
    credentials work either — `configured` is the same *ingesteld, niet werkt* flag the
    project list already carries, repeated here so the caller needs one round trip
    rather than two.
    """
    _require_project_access(session, project_id)
    resolved = _project_stage(stage)
    env = await project_environment(project_id, resolved)
    return {
        "projectId": project_id,
        "stage": resolved.value,
        # "" when nothing is stored — the caller shows what it can and says the rest
        # is missing, rather than printing a hole where a number belongs.
        "omgeving": env.omgevingnummer,
        "host": env.host if env.omgevingnummer else "",
        "label": env.label,
        "name": env.name,
        "configured": _stage_states(_project(project_id), local_store.tokens(project_id))[resolved.value],
    }


@app.get("/api/projects/{project_id}/existing/{module_id}")
async def project_existing_records(
    project_id: str,
    module_id: str,
    stage: str | None = None,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(existing_admin),
):
    """The record keys this module's sheet would collide with, for one environment.

    **Per stage, and never shared between them.** The question is "does this record
    exist in the environment I am about to write to", so a test environment holding
    a record says nothing about live; `stage` is required for the same reason the
    send's is, and there is no default anywhere in this path.

    Answers **404** for a module with no lookup registered — a key the frontend asks
    for and the backend never heard of is a wiring mistake, and answering "none exist"
    would be the worst possible guess: it would mark every record new and invite an
    insert of a full set of duplicates.

    A connector AFAS refuses (not installed at this customer) is **not** an HTTP
    error either — it is the normal state of a project whose app connector hasn't
    been extended yet, and it answers 200 with `available: false` and AFAS's own
    reason, so the panel can drop back to today's behaviour instead of pretending
    the environment is empty. The one thing this route must never do is let
    "could not ask" look like "nothing exists".
    """
    try:
        found = existing.source(module_id)
    except existing.UnknownExistingSource:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Voor module '{module_id}' is geen bestaande-records-controle ingericht. "
                f"Beschikbaar: {', '.join(existing.modules())}."
            ),
        ) from None

    _require_project_access(session, project_id)
    resolved = _project_stage(stage)
    env = await _complete_project_environment(project_id, resolved)

    # Cached for a minute — display only; see `afas_reads.py`.
    keys, result, fetched_at = await afas_reads.cached(
        env, "existing", module_id, lambda: existing.fetch_keys(env, module_id)
    )
    if keys is None:
        return {
            "moduleId": module_id,
            "stage": resolved.value,
            "environment": env.name,
            "connector": found.connector,
            "deletable": found.delete is not None,
            "available": False,
            "keys": {},
            "count": 0,
            "message": result.message,
            "fetchedAt": fetched_at,
        }
    return {
        "moduleId": module_id,
        "stage": resolved.value,
        "environment": env.name,
        "connector": found.connector,
        # Whether this module's payload view may offer *Verwijderen* — only a module
        # with an `existing.DeleteTarget` (Projecten, Voorcalculatie, Abonnementen).
        "deletable": found.delete is not None,
        "available": True,
        # Normalized key -> the record's name in AFAS, so a match can show what it
        # matched and a wrong one is visible rather than merely counted.
        "keys": keys,
        "count": len(keys),
        "message": result.message,
        "fetchedAt": fetched_at,
    }


async def _validation_stage(project_id: str, module_id: str) -> AfasStage:
    """The environment a module's sheet is about to be imported into, read off its
    stage (`project_modules.json`): **test** while the step open is
    *validatie* or *test* — the next import lands in test — and **live** from *Live
    conversie uitvoeren* on, and for a finished deeltaak, which sits at no task.

    A module whose deeltaak can't be read answers live, the environment the
    conversion ends in."""
    try:
        _, deeltaak = _module_for_project(project_id, module_id)
    except HTTPException:
        return AfasStage.LIVE
    return AfasStage.TEST if deeltaak.get("stage") in ("validatie", "test") else AfasStage.LIVE


@app.get("/api/projects/{project_id}/existing/{module_id}/validation")
async def project_existing_for_validation(
    project_id: str,
    module_id: str,
    session: dict = Depends(current_session),
):
    """The same key -> name list as the route above, for the **sheet's validation**
    rather than the payload view: an `existing-record` check flags a row whose
    organisation AFAS already holds under another number (see
    `lib/validation/afas-records.ts`).

    It differs from that route in the three ways the validation does. **Any project
    member**, not only admins, because a client checks their own sheet before handing
    it in. **No stage to pick**: the module's workflow task decides it
    (`_validation_stage`) — test during the test import, live during the live one —
    because a name is only a duplicate in the environment the rows are about to be
    sent to; a debiteur the test import already holds is invisible in a live that
    is still nearly empty. And **only for a module that opts in**
    (`ExistingSource.validates`), so this cannot be pointed at another module's
    list; anything else is a 404, like an unregistered module.

    Unanswerable is `available: false`, never an empty list — the credentials not yet
    filled in included, which is a project's normal early state rather than a 400.
    The frontend then leaves the check out and says so, instead of passing every row
    on the strength of a question nobody answered.
    """
    try:
        found = existing.source(module_id)
    except existing.UnknownExistingSource:
        found = None
    if found is None or not found.validates:
        raise HTTPException(
            status_code=404,
            detail=f"Module '{module_id}' controleert geen bestaande records bij het valideren.",
        )

    _require_project_access(session, project_id)
    stage = await _validation_stage(project_id, module_id)
    env = await project_environment(project_id, stage)
    body = {
        "moduleId": module_id,
        "stage": stage.value,
        "environment": env.name,
        "connector": found.connector,
        "fetchedAt": now_iso(),
    }
    try:
        env.require_complete()
    except AfasConfigError as exc:
        return {**body, "available": False, "keys": {}, "count": 0, "message": str(exc)}

    keys, result, _ = await afas_reads.cached(
        env, "existing", module_id, lambda: existing.fetch_keys(env, module_id)
    )
    if keys is None:
        return {**body, "available": False, "keys": {}, "count": 0, "message": result.message}
    return {**body, "available": True, "keys": keys, "count": len(keys), "message": result.message}


async def _declared_lookups() -> set[lookups.LookupSpec]:
    """Every AFAS lookup a stored mapping declares — standard and client copies
    alike. The whitelist `project_lookup` reads against: the three names arrive from
    the browser, and without this an admin session could read any GetConnector of a
    customer's AFAS through it."""
    declared: set[lookups.LookupSpec] = set()
    for row in await _mapping_rows():
        for entry in row.get("fields") or []:
            lookup = entry.get("lookup") if isinstance(entry, dict) else None
            if not isinstance(lookup, dict):
                continue
            declared.add(
                lookups.LookupSpec(
                    connector=str(lookup.get("connector", "")),
                    match_field=str(lookup.get("matchField", "")),
                    value_field=str(lookup.get("valueField", "")),
                )
            )
    return declared


@app.get("/api/projects/{project_id}/lookup")
async def project_lookup(
    project_id: str,
    connector: str,
    match: str,
    value: str,
    stage: str | None = None,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(existing_admin),
):
    """One AFAS lookup's table — `match` value -> `value` — read from the project's
    environment at `stage`, for the payload view to fill a looked-up field with.

    **Per stage, never shared**, like the existence read above and for the same
    reason: the number AFAS holds for a debiteur in test says nothing about live.

    Only a lookup a stored mapping declares may be read (`_declared_lookups`); any
    other triple is a 404. A connector AFAS refuses answers 200 with
    `available: false` and AFAS's reason — the panel then blocks the records that
    need it, rather than treating "could not ask" as "no match"."""
    spec = lookups.LookupSpec(connector=connector, match_field=match, value_field=value)
    if spec not in await _declared_lookups():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Geen koppeling zoekt {value} op in {connector} via {match}; "
                "alleen opzoekingen uit een opgeslagen koppeling kunnen worden gelezen."
            ),
        )

    _require_project_access(session, project_id)
    resolved = _project_stage(stage)
    env = await _complete_project_environment(project_id, resolved)

    table, result, fetched_at = await afas_reads.cached(
        env, "lookup", spec, lambda: lookups.fetch_table(env, spec)
    )
    common = {
        "stage": resolved.value,
        "environment": env.name,
        "connector": connector,
        "matchField": match,
        "valueField": value,
        "message": result.message,
        "fetchedAt": fetched_at,
    }
    if table is None:
        return {**common, "available": False, "values": {}, "ambiguous": {}, "rows": 0}
    return {
        **common,
        "available": True,
        "values": table.values,
        "ambiguous": table.ambiguous,
        "rows": table.rows,
    }


send_admin = require_admin("Alleen beheerders kunnen payloads naar AFAS sturen.")

async def _module_connectors(module_id: str) -> set[str]:
    """Every connector this module's stored mappings target — one for most modules,
    two for a split one like Debiteuren (`erp-debiteuren-organisatie` /
    `-persoon`), whose halves go to different connectors within a single send.

    This is what a record's own `connector` is checked against. The body is built in
    the browser, so the connector name arrives from the browser too, and without
    this an admin session could be used to POST an arbitrary body to any
    UpdateConnector in the customer's AFAS — a much wider door than the payload
    view it came through. Matching `_module_connector()`'s reading of the store, but
    keeping **all** the variants rather than the first."""
    prefix = f"{module_id}-"
    return {
        str(row["connector"])
        for row in await _mapping_rows()
        if row.get("group") == "modules"
        and row.get("connector")
        and (row.get("module") == module_id or str(row.get("module", "")).startswith(prefix))
    }


class PayloadRecord(BaseModel):
    """One body on its way to AFAS, with what the panel needs to report it back.

    `ordinal` and `rows` are the record's identity **on screen** — the number in
    the record list and the Excel rows behind it — carried along so an outcome
    lands on the row it belongs to rather than on whatever came back in that
    position."""

    ordinal: int
    connector: str
    rows: list[int] = []
    title: str = ""
    # What kind of record this is on screen — the variant label (`Project`,
    # `Organisatie`), so a refusal reads *Project 5019: …* in the report.
    kind: str = ""
    body: dict
    # `insert` (POST, the default and what every send did before existence
    # checking) or `update` (PUT). Decided in the browser from the existence read
    # the admin can see on screen, and **re-checked here** against the same read —
    # a stale browser must not be able to turn an insert into an update or the
    # reverse. See `_verified_verbs()`.
    action: Literal["insert", "update"] = "insert"
    # The record's key as the browser read it from the sheet column its plan names
    # (a debiteurnummer, a projectnummer). Only used to re-check an `update` claim
    # against AFAS — the body itself is nested and connector-shaped, so digging the
    # key back out of it would be a second implementation of the mapping.
    key: str = ""


async def _verified_verbs(
    env: AfasEnvironment, module_id: str, records: list[PayloadRecord]
) -> tuple[dict[int, str], str | None]:
    """Which verb each record is actually sent with, checked against AFAS itself.

    The browser decides insert-or-update from the existence read it shows the admin,
    and that decision is **not** taken on trust. A payload panel left open while
    someone else loads the same module, or a stage switched after the marks were
    drawn, would otherwise turn an insert into an update — writing over a record
    nobody looked at — or an update into an insert, which AFAS refuses as a duplicate
    key at best and silently double-loads at worst.

    So the keys are read once here, for this environment, and every record claiming
    `update` must be one AFAS actually holds. A mismatch fails the **whole request**
    rather than being quietly corrected: the admin chose a run against a picture of
    the data, and if that picture is stale the honest answer is to say so and let
    them look again, not to send something they didn't agree to.

    A module with no existence lookup keeps today's behaviour — everything inserts —
    and a record that never claimed `update` needs no check, so the AFAS read only
    happens when a run actually contains updates.
    """
    verbs = {record.ordinal: record.action for record in records}
    updates = [record for record in records if record.action == "update"]
    if not updates:
        return verbs, None

    try:
        existing.source(module_id)
    except existing.UnknownExistingSource:
        return verbs, (
            f"Module '{module_id}' heeft geen bestaande-records-controle, "
            "dus records kunnen hier niet worden bijgewerkt."
        )

    keys, result = await existing.fetch_keys(env, module_id)
    if keys is None:
        # Could not ask. Sending the updates anyway would be writing over records on
        # the strength of a browser's word alone.
        return verbs, (
            "De bestaande records konden niet bij AFAS worden opgevraagd, "
            f"dus bijwerken is nu niet veilig: {result.message}"
        )

    stale = [
        record
        for record in updates
        if existing.normalize_key(_record_key(record)) not in keys
    ]
    if stale:
        shown = ", ".join(str(record.title or record.ordinal) for record in stale[:5])
        more = f" (+{len(stale) - 5})" if len(stale) > 5 else ""
        return verbs, (
            f"{len(stale)} record(s) zouden worden bijgewerkt, maar bestaan niet "
            f"(meer) in {env.name}: {shown}{more}. Ververs de payloads en probeer opnieuw."
        )
    return verbs, None


def _record_key(record: PayloadRecord) -> str:
    """The record's own key, as the browser resolved it from the sheet column.

    Sent alongside the body rather than dug out of it: the body is nested and
    connector-shaped (a split module's two halves nest differently), while this is
    the value the admin saw in the record list and the one the mark was drawn from.
    """
    return str(record.key or "")


class SkippedRecord(BaseModel):
    """A ticked record the panel kept out of the send, and why. Only reported back."""

    ordinal: int
    rows: list[int] = []
    title: str = ""
    kind: str = ""
    reason: str = ""


class SendStepSpec(BaseModel):
    """One step of a module sent in steps, as the panel's `module-phases.ts` has it:
    its id and whether it creates the records (`insert`) or updates what an earlier
    step created (`update`) — which decides what its share is measured by."""

    id: str
    verb: str = "insert"


class SendPayloadsRequest(BaseModel):
    project_id: str
    # The **app** module id (`erp-debiteuren`) — only reported back and used to
    # check this session may open the project's module; the connector each record
    # goes to is the one the record carries, because a split module's two halves
    # go to two different connectors within one send.
    module_id: str
    # `test` or `live` — never defaulted, see `_project_stage()`.
    stage: str
    records: list[PayloadRecord]
    # Ticked records the panel did **not** send, counted so the verzendrapport can
    # say "108 van 288" rather than "108 van 108": the ones AFAS already has under
    # *Alleen nieuwe*, and the ones this phase leaves out. Only reported back.
    skipped_existing: int = 0
    skipped_phase: int = 0
    # Ticked records held back because something they look up isn't in AFAS (the
    # debiteur a project belongs to). Listed, not counted: the report names each
    # one with its reason, the thing to create before sending again.
    skipped_missing: list[SkippedRecord] = []
    # The sheet rows every record of the panel's plan covers, sent or not, and those
    # of them AFAS already held for this stage before the run (*Bestaat al*) — what
    # the run's outcome is measured against once it ends (`send_progress.outcome()`).
    # Empty from an older panel, and then nothing is stamped.
    sheet_rows: list[int] = []
    existing_rows: list[int] = []
    # The step of a multi-step module this send is (`aanmaken`), and its label
    # (`Historie`) — empty for every other module. Only carried on the run, so each
    # step's last run can be found again for one combined verzendrapport.
    phase: str = ""
    phase_label: str = ""
    # Every step of the module, this one included — so the figure the run stamps
    # holds each row against all of them (`_step_baselines()`). Empty for a module
    # without steps.
    steps: list[SendStepSpec] = []


def _send_run_view(state: payload_send.SendRunState) -> dict:
    """One run as the panel reads it.

    A superset of the `SendOutcome` the synchronous send used to return — same
    `sent`/`failed`/`inserted`/`updated`/`results`, so a finished run renders through
    the code that already existed — plus what only a run in progress has: how far it
    is (`done` of `total`), whether it is still going, and its id to keep polling."""
    return {
        "runId": state.run_id,
        "status": state.status,
        # `send` or `delete` — what the panel words the progress and notices by.
        "operation": state.operation,
        "moduleId": state.module_id,
        "stage": state.stage,
        "environment": state.environment,
        "startedAt": state.started_at,
        "finishedAt": state.finished_at,
        "error": state.error,
        "stopRequested": state.stop_requested,
        # The progress pair. `done` is counted from the results themselves rather
        # than tracked alongside them, so the two cannot drift.
        "total": state.total,
        "skippedExisting": state.skipped_existing,
        "skippedPhase": state.skipped_phase,
        "skippedMissing": state.skipped_missing,
        "phase": state.phase,
        "phaseLabel": state.phase_label,
        # The rows this run's step has in AFAS once it ended — `null` before then,
        # and for a run nothing was measured for.
        "stepRows": state.step_rows,
        "done": len(state.results),
        "sent": state.sent,
        "failed": state.failed,
        # How the run split between the two verbs, counted from what was actually
        # dispatched rather than from what the browser asked for.
        "inserted": state.inserted,
        "updated": state.updated,
        "deleted": state.deleted,
        "results": state.results,
    }


def _step_baselines(
    state: payload_send.SendRunState, steps: list[SendStepSpec], existing_rows: list[int]
) -> tuple[set[int] | None, list[set[int]]]:
    """For a module sent in steps: where this run's step starts from, and the rows
    each other step has in AFAS — `send_progress.outcome()`'s `previous_rows` and
    `other_steps`.

    A step that creates counts what AFAS holds (`existing_rows`); one that updates
    counts what its own runs got in, off the newest one the backend still holds. With
    none held it holds nothing against the others — existence, which is all it could
    fall back to, is already the creating step's measure — so a restart costs the
    step's stricter reading, never more than that."""
    previous: set[int] | None = None
    others: list[set[int]] = []
    for step in steps:
        step_id = step.id.strip()[:64]
        rows = (
            payload_send.latest_step_rows(state.project_id, state.module_id, state.stage, step_id)
            if step.verb == "update"
            else None
        )
        if step_id == state.phase:
            previous = rows
        elif step.verb != "update":
            others.append(set(existing_rows))
        elif rows is not None:
            others.append(rows)
    return previous, others


def _send_progress_stamper(
    *,
    module_id: str,
    sheet_rows: list[int],
    existing_rows: list[int],
    steps: list[SendStepSpec],
    sent_by: str,
) -> payload_send.OnFinish:
    """The hook a send runs once it has ended: how much of the sheet is in AFAS now,
    stamped onto the module's deeltaak — the **same** `Voortgang`/`Fouten`/
    `Laatste_controle`/`Aangeleverd_door` a validation stamp writes, overwriting it —
    and the detail behind it kept in `send_progress`, which is also what tells the
    sidebar this figure is a send's.

    For a module sent in steps the figure is the **module's**, not the step's: a
    row counts once every step has it in AFAS (`_step_baselines()`), so *Actueel*
    at 80% stamps 80% however far *Historie* got, and a later *Historie* run cannot
    stamp it back to 100%.

    Not for a custom module (maatwerk): it writes vrije velden on its parent's
    records, adds no rows of its own to the sheet, and has no deeltaak to stamp."""

    async def stamp(state: payload_send.SendRunState, status: str) -> None:
        previous, others = _step_baselines(state, steps, existing_rows)
        result = send_progress.outcome(
            results=state.results,
            sheet_rows=sheet_rows,
            existing_rows=existing_rows,
            held_back=state.skipped_missing,
            previous_rows=previous,
            other_steps=others,
        )
        # Kept even when nothing went: the next run of the step builds on it.
        state.step_rows = sorted(result.step_rows)
        if not state.results:
            return  # stopped before the first record: nothing changed in AFAS
        try:
            _, deeltaak = _module_for_project(state.project_id, module_id)
        except HTTPException:
            return
        sent_at = datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)
        try:
            _stamp_module(
                state.project_id,
                module_id,
                completeness=result.completeness,
                total_rows=result.total_rows,
                error_row_count=result.failed_rows,
                checked_at=sent_at.isoformat(),
                submitted_by=sent_by,
                stage=_stage_after_send(deeltaak.get("stage"), state.stage),
            )
        except Exception:
            logger.exception("send stamp not stored for %s/%s", state.project_id, module_id)
            return
        await asyncio.to_thread(
            send_progress.save,
            send_progress.SendProgress(
                project_id=state.project_id,
                module_id=module_id,
                stage=state.stage,
                environment=state.environment,
                run_status=status,
                sent_at=sent_at,
                sent_by=sent_by,
                completeness=result.completeness,
                total_rows=result.total_rows,
                in_afas_rows=result.in_afas_rows,
                refused_rows=result.refused_rows,
                held_back_rows=result.held_back_rows,
                refusals=result.refusals,
            ),
        )

    return stamp


@app.post("/api/afas/payloads/send")
async def send_payloads(
    payload: SendPayloadsRequest,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(send_admin),
):
    """Start the send and return the run straight away — the records go to AFAS in
    the background, one call per record, and the panel polls the GET below.

    Everything that can refuse the run as a whole still happens **here**, before the
    job exists: the project access, an empty selection, the connectors this module is
    allowed to write to, the environment being configured, and the re-check of every
    record claiming to be an update. Those are answers the admin needs on the press,
    not two seconds later in a progress bar — and a run that starts is one that has
    passed all of them.

    Sequential inside the job rather than parallel, unchanged from when this call was
    synchronous: AFAS rate-limits, and a burst of a few hundred inserts is exactly
    the shape it throttles. It also keeps the order of what happened readable — the
    results come back in the order the records were sent."""
    _require_project_access(session, payload.project_id)
    stage = _project_stage(payload.stage)
    if not payload.records:
        raise HTTPException(status_code=400, detail="Geen records geselecteerd om te versturen.")

    # A custom module (maatwerk) is the third step on records its parent already
    # created: its one connector is its parent's, it needs its own mapping stored, and
    # it only ever **updates** — an insert here would create a second employee holding
    # nothing but vrije velden. Existence is its parent's question, so the re-check
    # below reads the parent's lookup.
    custom = _custom_module(payload.project_id, payload.module_id)
    existence_module = payload.module_id
    if custom is not None:
        if not await _has_client_mapping(payload.project_id, payload.module_id):
            raise HTTPException(
                status_code=400,
                detail=f"Maatwerkmodule '{custom.get('label')}' heeft nog geen koppeling.",
            )
        inserts = [record for record in payload.records if record.action != "update"]
        if inserts:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Een maatwerkmodule werkt alleen bestaande records bij; "
                    f"{len(inserts)} record(s) zouden worden aangemaakt."
                ),
            )
        existence_module = str(custom.get("parentModuleId") or "")

    # Which connectors this module is allowed to write to at all. Resolved here,
    # once, so a request naming a connector outside its own module is refused before
    # a single record is posted rather than record by record.
    allowed = (
        {str(custom.get("connector") or "")} - {""}
        if custom is not None
        else await _module_connectors(payload.module_id)
    )
    if not allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Module '{payload.module_id}' heeft nog geen koppeling om mee te versturen.",
        )
    unexpected = sorted({str(r.connector or "").strip() for r in payload.records} - allowed)
    if unexpected:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Deze module schrijft niet naar {', '.join(unexpected)}. "
                f"Toegestaan: {', '.join(sorted(allowed))}."
            ),
        )

    env = await _complete_project_environment(payload.project_id, stage)

    # Every record claiming to be an update is checked against AFAS itself before a
    # single call goes out — see `_verified_verbs()`.
    verbs, verb_error = await _verified_verbs(env, existence_module, payload.records)
    if verb_error:
        raise HTTPException(status_code=400, detail=verb_error)

    jobs = [
        payload_send.SendRecordJob(
            ordinal=record.ordinal,
            # Checked against `allowed` above, so this is a name the module owns.
            connector=str(record.connector or "").strip(),
            rows=record.rows,
            title=record.title,
            kind=record.kind,
            action=verbs[record.ordinal],
            body=record.body,
        )
        for record in payload.records
    ]
    try:
        state = await payload_send.start_run(
            payload.project_id,
            payload.module_id,
            stage.value,
            env,
            jobs,
            skipped_existing=max(0, payload.skipped_existing),
            skipped_phase=max(0, payload.skipped_phase),
            skipped_missing=[record.model_dump() for record in payload.skipped_missing],
            phase=payload.phase.strip()[:64],
            phase_label=payload.phase_label.strip()[:128],
            on_finish=_send_progress_stamper(
                module_id=payload.module_id,
                sheet_rows=payload.sheet_rows,
                existing_rows=payload.existing_rows,
                steps=payload.steps,
                sent_by=session["user"]["email"],
            )
            if payload.sheet_rows and custom is None
            else None,
        )
    except payload_send.SendAlreadyInProgress as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"run": _send_run_view(state)}


delete_admin = require_admin("Alleen beheerders kunnen records uit AFAS verwijderen.")


class DeleteRecord(BaseModel):
    """One record to remove, as the panel names it. Only `key` decides anything —
    the sheet's value from the plan's key column (an offertenummer); `ordinal`,
    `rows`, `title` and `kind` are its identity on screen, carried back so the
    outcome lands on the right row."""

    ordinal: int
    rows: list[int] = []
    title: str = ""
    kind: str = ""
    key: str


class DeleteRecordsRequest(BaseModel):
    project_id: str
    module_id: str
    # `test` or `live` — never defaulted, like the send's.
    stage: str
    records: list[DeleteRecord]


@app.post("/api/afas/payloads/delete")
async def delete_records(
    payload: DeleteRecordsRequest,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(delete_admin),
):
    """Remove records from the customer's AFAS, as a background run — the same run
    store, poll route and stop button as a send, so a delete of a few hundred
    records reports the same way and survives the same reload. It also shares the
    send's one-run-per-module lock, so a delete cannot overlap a send of the same
    module.

    **The browser names keys, nothing else.** The connector, object and key field
    come from the module's `existing.DeleteTarget`, and every key is checked against
    a fresh existence read for this stage before a single call goes out: a key AFAS
    does not hold (a stale panel, the other stage's marks) fails the whole request,
    for the same reason `_verified_verbs()` fails a stale update — the admin agreed
    to delete what they saw, and if that picture is out of date they must look
    again. The URL then carries the key **as AFAS spells it** (padding and all),
    taken from that read rather than from the sheet.

    AFAS deletes are permanent and there is no undo from here; the confirmation
    dialog in front of this is the guard, and it is the frontend's job."""
    _require_project_access(session, payload.project_id)
    stage = _project_stage(payload.stage)
    if not payload.records:
        raise HTTPException(status_code=400, detail="Geen records geselecteerd om te verwijderen.")

    try:
        target = existing.source(payload.module_id).delete
    except existing.UnknownExistingSource:
        target = None
    if target is None:
        raise HTTPException(
            status_code=400,
            detail=f"Module '{payload.module_id}' biedt geen verwijderen aan.",
        )

    # The same record twice would be one DELETE that works and one that fails on a
    # record that is already gone — refused up front instead of reported as a
    # refusal that is not one.
    chosen: dict[str, DeleteRecord] = {}
    for record in payload.records:
        key = existing.normalize_key(record.key)
        if not key:
            raise HTTPException(
                status_code=400,
                detail=f"Record {record.title or record.ordinal} heeft geen sleutel om op te verwijderen.",
            )
        if key in chosen:
            raise HTTPException(
                status_code=400,
                detail=f"Sleutel {record.key} staat meer dan eens in de selectie.",
            )
        chosen[key] = record

    env = await _complete_project_environment(payload.project_id, stage)

    held, result = await existing.fetch_records(env, payload.module_id)
    if held is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "De bestaande records konden niet bij AFAS worden opgevraagd, "
                f"dus verwijderen is nu niet veilig: {result.message}"
            ),
        )
    stale = [record for key, record in chosen.items() if key not in held]
    if stale:
        shown = ", ".join(str(record.title or record.key) for record in stale[:5])
        more = f" (+{len(stale) - 5})" if len(stale) > 5 else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(stale)} record(s) bestaan niet (meer) in {env.name}: {shown}{more}. "
                "Ververs de payloads en probeer opnieuw."
            ),
        )

    jobs = [
        payload_send.SendRecordJob(
            ordinal=record.ordinal,
            connector=target.connector,
            rows=record.rows,
            title=record.title,
            kind=record.kind,
            action="delete",
            body={},
            delete_object=target.object_name,
            delete_field=target.key_field,
            # AFAS's own spelling of the key, off the read just made.
            delete_key=held[key][0],
        )
        for key, record in chosen.items()
    ]
    try:
        state = await payload_send.start_run(
            payload.project_id,
            payload.module_id,
            stage.value,
            env,
            jobs,
            operation="delete",
        )
    except payload_send.SendAlreadyInProgress as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"run": _send_run_view(state)}


@app.get("/api/afas/payloads/send/{run_id}")
async def send_payloads_run(
    run_id: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(send_admin),
):
    """One send's progress: how many records are done, and the results so far.

    The project is taken from the run rather than the URL and then checked, so this
    cannot be used to read a send belonging to a project this session may not open."""
    state = payload_send.run(run_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Onbekende verzending.")
    _require_project_access(session, state.project_id)
    return {"run": _send_run_view(state)}


@app.post("/api/afas/payloads/send/{run_id}/stop")
async def send_payloads_stop(
    run_id: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(send_admin),
):
    """Stop a send after the record it is on — the records already written stay
    written (AFAS has no undo), and the rest are simply never attempted. Returns the
    run; it reads `stopped` once the loop has noticed, a poll or so later."""
    state = payload_send.run(run_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Onbekende verzending.")
    _require_project_access(session, state.project_id)
    payload_send.request_stop(run_id)
    return {"run": _send_run_view(state)}


@app.get("/api/afas/payloads/send")
async def send_payloads_active(
    project_id: str,
    module_id: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(send_admin),
):
    """The send this module has going, if any — `null` when it has none.

    What a panel asks on mount: a send survives the screen it was started from, so
    reopening the module (or reloading the page) has to be able to find the run
    still in progress rather than showing an idle button over a live send."""
    _require_project_access(session, project_id)
    state = payload_send.active_run(project_id, module_id)
    return {"run": _send_run_view(state) if state is not None else None}


@app.get("/api/afas/payloads/runs")
async def send_payloads_by_step(
    project_id: str,
    module_id: str,
    stage: str,
    session: dict = Depends(current_session),
    _admin: tuple[str, str] = Depends(send_admin),
):
    """The newest finished send of each step of this module in this stage —
    `{ runs: [run, …] }`, oldest first. What the payload view combines into one
    verzendrapport for a module sent in more than one call per record (Medewerkers:
    *Historie*, then *Actueel*), so the report of step 2 can still carry step 1's
    results after the panel has moved on or the page was reloaded. In-memory like
    every run, so a backend restart forgets them."""
    _require_project_access(session, project_id)
    runs = payload_send.latest_by_phase(project_id, module_id, stage)
    return {"runs": [_send_run_view(state) for state in runs]}


# --- Progress per module ------------------------------------------------------
# How far a project is with each of its modules: the figures last **stamped** on the
# module in `project_modules.json`. Two things stamp them:
#
#   validation  the uploader, once a sheet has been checked (`POST
#               /api/projects/{id}/modules/{module}/validation`) — the share of rows
#               without errors, like the old hand-in to Nymbus.
#   send        a run from the payload tab, once it ends (`_send_progress_stamper`) —
#               the share of the sheet's rows that are in AFAS now — and the payload
#               view's own *voortgang vastleggen* (`/api/progress`). These also keep
#               the detail behind the figure in `send_progress` (refusals, environment),
#               which is what tells the sidebar the figure is a send's.
#
# Each overwrites the other: the figure always describes the latest thing that
# happened to the module. A send also moves the module's stage forward (validatie →
# test → live), which the reports show as *Fase*.


def _module_for_project(project_id: str, module_id: str) -> tuple[dict, dict]:
    """The catalog entry and the project's state of one of its modules, or a 404."""
    module = _catalog_module(module_id)
    if module is not None:
        deeltaak = _project_deeltaken(project_id).get(module_id)
        if deeltaak is not None:
            return module, deeltaak
    raise HTTPException(
        status_code=404, detail=f"Project '{project_id}' heeft geen module '{module_id}'."
    )


def _stamp_module(
    project_id: str,
    module_id: str,
    *,
    completeness: int,
    total_rows: int | None,
    error_row_count: int,
    checked_at: str,
    submitted_by: str,
    checked_cells: int | None = None,
    error_cells: int | None = None,
    file_name: str = "",
    stage: str | None = None,
) -> None:
    """Write one module's figures (and, for a send, its new stage)."""
    fields: dict = {
        "progress": {
            "completeness": completeness,
            "totalRows": total_rows,
            "errorRowCount": error_row_count,
            "checkedCells": checked_cells,
            "errorCells": error_cells,
            "checkedAt": checked_at,
            "submittedBy": submitted_by,
            "fileName": file_name,
        }
    }
    if stage is not None:
        fields["stage"] = stage
    local_store.update_project_module(project_id, module_id, fields)


def _stage_after_send(current: str | None, sent_to: str) -> str | None:
    """The stage a send to `sent_to` moves the module to — forward only: a test send
    after the live import doesn't take a module back, nor does any send reopen a
    module marked *afgerond*."""
    order = ["validatie", "test", "live"]
    if current is None or current not in order or sent_to not in order:
        return None
    return sent_to if order.index(sent_to) > order.index(current) else None


def _send_view(sent: send_progress.SendProgress | None, completeness: int) -> dict | None:
    """The last send behind a module's figure, or `None` when the figure isn't one."""
    if sent is None or sent.completeness != completeness:
        return None
    return {
        "stage": sent.stage,
        "environment": sent.environment,
        "status": sent.run_status,
        "sentAt": sent.sent_at.isoformat() + "Z",
        "sentBy": sent.sent_by,
        "totalRows": sent.total_rows,
        "inAfasRows": sent.in_afas_rows,
        "refusedRows": sent.refused_rows,
        "heldBackRows": sent.held_back_rows,
        "refusals": [{"message": r.message, "rows": r.rows} for r in sent.refusals],
    }


def _module_progress_view(
    module: dict, deeltaak: dict, sent: send_progress.SendProgress | None = None
) -> dict | None:
    """One module's progress as the frontend gets it, or `None` when nothing has
    stamped it yet."""
    completeness = deeltaak.get("completeness")
    if completeness is None:
        return None
    return {
        "moduleId": str(module["moduleId"]),
        "moduleName": str(module["moduleName"]),
        "completeness": completeness,
        "totalRows": deeltaak.get("totalRows"),
        "errorRowCount": deeltaak.get("errorRowCount"),
        "checkedCells": deeltaak.get("checkedCells"),
        "errorCells": deeltaak.get("errorCells"),
        "checkedAt": deeltaak.get("checkedAt") or "",
        "submittedBy": deeltaak.get("submittedBy") or "",
        "fileName": deeltaak.get("fileName") or "",
        "send": _send_view(sent, completeness),
    }


@app.get("/api/projects/{project_id}/progress")
async def project_progress(project_id: str, session: dict = Depends(current_session)):
    """The last stamped figures, per module. A module never stamped has no entry."""
    _require_project_access(session, project_id)
    deeltaken = _project_deeltaken(project_id)
    sends = send_progress.for_project(project_id)
    progress = []
    for module in _catalog_modules():
        deeltaak = deeltaken.get(str(module["moduleId"]))
        if deeltaak is None:
            continue
        view = _module_progress_view(module, deeltaak, sends.get(str(module["moduleId"])))
        if view is not None:
            progress.append(view)
    return {"progress": progress}


@app.get("/api/voortgang/{project_id}")
async def voortgang_project(project_id: str, session: dict = Depends(current_session)):
    """One project's line on the `/voortgang` page (the managementrapport): its
    modules and the last figures per module, in one call."""
    modules = await project_modules(project_id, session)
    progress = (await project_progress(project_id, session))["progress"]
    return {"groups": modules["groups"], "progress": progress}


def _completeness(sent: int) -> int:
    if not 0 <= sent <= 100:
        raise HTTPException(
            status_code=400, detail="Het voortgangspercentage ligt tussen 0 en 100."
        )
    return sent


def _row_count(sent: int, what: str) -> int:
    if sent < 0:
        raise HTTPException(status_code=400, detail=f"{what} kan niet negatief zijn.")
    return sent


def _now_stamp() -> str:
    """Bare ISO in UTC, no `Z` — the form the AFAS-backed figures had."""
    return datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat()


class ValidationProgressRequest(BaseModel):
    """The figures of a sheet just validated in the uploader — `sheetMetrics()`'s."""

    completeness: int
    total_rows: int
    error_row_count: int
    checked_cells: int | None = None
    error_cells: int | None = None
    file_name: str = ""


@app.post("/api/projects/{project_id}/modules/{module_id}/validation")
async def stamp_validation(project_id: str, module_id: str, payload: ValidationProgressRequest):
    """Stamp a module with the figures of the sheet just validated. Replaces
    whatever the last send left there."""
    _module_for_project(project_id, module_id)
    total_rows = _row_count(payload.total_rows, "Het aantal rijen")
    error_row_count = _row_count(payload.error_row_count, "Het aantal rijen met fouten")
    if error_row_count > total_rows:
        raise HTTPException(status_code=400, detail="Er zijn meer foute rijen dan rijen.")
    checked_at = _now_stamp()
    _stamp_module(
        project_id,
        module_id,
        completeness=_completeness(payload.completeness),
        total_rows=total_rows,
        error_row_count=error_row_count,
        checked_cells=payload.checked_cells,
        error_cells=payload.error_cells,
        checked_at=checked_at,
        submitted_by=LOCAL_USER["email"],
        file_name=payload.file_name.strip()[:255],
    )
    send_progress.clear(project_id, module_id)
    return {"stored": True, "checkedAt": checked_at}


class ProgressUpdateRequest(BaseModel):
    """The payload view's *voortgang vastleggen*: how much of the sheet AFAS already
    holds in one environment, without sending a record (`progress-payload.ts`)."""

    project_id: str
    # The **app** module id (`hrm-medewerkers`).
    module_id: str
    # The environment whose *Bestaat al* marks the figures count, `test` or `live`.
    stage: str
    completeness: int
    total_rows: int
    error_row_count: int


@app.post("/api/progress")
async def push_progress(payload: ProgressUpdateRequest):
    """Stamp a module with the figures the payload view sends. Kept in
    `send_progress` as a send with nothing refused, since nothing was sent."""
    module, deeltaak = _module_for_project(payload.project_id, payload.module_id)
    stage = _project_stage(payload.stage)
    env = await _complete_project_environment(payload.project_id, stage)
    completeness = _completeness(payload.completeness)
    total_rows = _row_count(payload.total_rows, "Het aantal rijen")
    error_row_count = _row_count(payload.error_row_count, "Het aantal rijen met fouten")
    if error_row_count > total_rows:
        raise HTTPException(
            status_code=400,
            detail="Er kunnen niet meer rijen ontbreken dan er rijen zijn.",
        )
    sent_at = datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)
    checked_at = sent_at.isoformat()
    _stamp_module(
        payload.project_id,
        payload.module_id,
        completeness=completeness,
        total_rows=total_rows,
        error_row_count=error_row_count,
        checked_at=checked_at,
        submitted_by=LOCAL_USER["email"],
    )
    send_progress.save(
        send_progress.SendProgress(
            project_id=payload.project_id,
            module_id=payload.module_id,
            stage=stage.value,
            environment=env.name,
            run_status="done",
            sent_at=sent_at,
            sent_by=LOCAL_USER["email"],
            completeness=completeness,
            total_rows=total_rows,
            in_afas_rows=total_rows - error_row_count,
            refused_rows=0,
            held_back_rows=0,
        )
    )
    return {
        "stored": True,
        "message": f"Voortgang van '{module['moduleName']}' is vastgelegd.",
        "moduleId": payload.module_id,
        "moduleName": module["moduleName"],
        "deeltaakcode": deeltaak["code"],
        "dossierItemId": "",
        "completeness": completeness,
        "checkedAt": checked_at,
        "submittedBy": LOCAL_USER["email"],
        "logReference": "",
    }
