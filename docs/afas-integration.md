# AFAS integration

> **Local version.** This doc was written for the hosted version. Here there is **no own
> environment**: no `Nymbus_*` connectors, no deeltaak dossieritems, no
> workflow reactions or actions, no progress stamped in AFAS, no SSO. Projects and their
> modules are local JSON ([architecture.md](architecture.md)); general UpdateConnector
> schemas come from the AFAS OAS, not from a template environment; codetabellen come from
> the client's live environment only, without a fallback. What this doc says about
> the client's environment — authentication, envelopes, existing records, lookups,
> sending — still applies.

> Detail for [CLAUDE.md](../CLAUDE.md). How the backend talks to AFAS Profit — for the
> projects and modules the app is built around, and for handing a finished sheet back.

## Why everything goes through the backend

AFAS credentials (the OAuth client id + secret) must never reach the browser. The frontend asks the backend, which holds the credentials, calls AFAS and answers in the app's own vocabulary — keeping secrets server-side and giving one place to re-validate and audit.

## The two environments

The tool talks to **two different AFAS environments**, and keeping them apart is the
whole reason the client takes an environment as a parameter.

| | Nymbus's own environment | A customer's environment |
|---|---|---|
| Holds | the conversion projects, who is on them, the deeltaken and their workflow — **and the UpdateConnector schemas** | the customer's own data |
| Used for | login, the project list, the sidebar, handing a sheet in | codetabellen, the converted rows, **and every field mapping** |
| Which one | its own **live** environment (*NymbusConversies*) for the dossier and workflow | one per project, and two of them: that customer's test and live |
| Credentials | `backend/.env` | per project, encrypted in the Fabric SQL Database's `project_settings` table |
| Built by | `nymbus_environment(stage)` in [afas.py](../backend/afas.py) | `project_environment(project_id, stage)` in [main.py](../backend/main.py) |
| Status | **implemented** | **implemented** — the connection test, the codetabellen, the existence reads, the converted rows and the module schemas all use it |

**One environment is the template.** Every customer environment is a copy of the same
AFAS inrichting, so the module UpdateConnectors have the same schema everywhere they
are installed. That is why a field mapping is made **once**, against the template, and
then used to write records into every customer's environment — and why the connector
explorer has no client to pick. A customer whose mapping has to deviate is the
exception: it gets a copy of its own, flagged per project, see [todo.md](todo.md).

**Which environment that is changed on 21-09-2026.** It was Nymbus's own test
environment (app connector *Data Conversie*); it then became project 501342
(Balans), omgeving 38892, and since 13-10-2026 it is **omgeving 38690 (Multiclean),
live** — `MODULE_TEMPLATE_OMGEVING` in [main.py](../backend/main.py). The first move was because Balans carried the most
up-to-date API schema and Nymbus's test environment had drifted behind it, so mappings
were being made against an older set of fields than any customer actually has. This is
**temporary** — the intent is to move back to a Nymbus-owned template once that one is
brought up to date, see [todo.md](todo.md). The template is named by **omgevingsnummer**,
not by project, so it doesn't depend on one conversion project's lifetime; its
credentials are those of whichever project is stored with that omgeving and has a
client id for the stage (`_template_environment()`). Moving it is a one-line change.

**Map against the template, deliver to the customer** (Taroen, 05-09-2026). These are
two decisions, not one, and blurring them is the mistake to avoid:

- *Which column fills which field* is an assertion about the **Excel sjabloon**, which
  every customer fills in identically. It is customer-independent, so it is made once,
  against the template, and there is exactly one schema it can be right or wrong
  against. Binding it per customer would mean thirteen mappings times every client, each
  needing the same edit when a template column moves, and no definition of "correct".
- *Where the records land* is the **customer's own environment**, through
  `project_environment(project_id, stage)`. The same reasoning the codetabellen already
  follow: the conversion lands there, so that is the environment the data has to satisfy.

The consequence worth stating: a preview of what an upload would send is only honest
when it is rendered against the environment that will **receive** it. Rendering it
against the template shows a clean body for a customer whose environment has drifted —
the one case the preview exists to catch. See *Seeing the bodies a sheet would send*.

`project_environment()` is the join the tool was missing: it reads that project's row
from the Fabric SQL Database's `project_settings` table ([fabric_db.py](../backend/fabric_db.py)),
decrypts the credential pair belonging to the stage asked for, and hands back an
`AfasEnvironment` labelled with the project's name. It is
the **one server-side reader of a stored credential** — the settings routes stay
write-only, a GET only ever says *whether* a secret is set — and that must stay true.
A project nobody has configured yields an environment with holes rather than an error;
`require_complete()` names them in Dutch at the moment a call is made, which is where
an admin can act on it (*De AFAS-omgeving Multiclean — 38690 (test) is niet compleet
ingesteld: client secret ontbreekt*).

Which stage of a customer's environment is used is the **caller's** decision, not a
setting: the connection test asks the admin which panel they pressed, and the conversion
itself should follow the deeltaak — a testimport to test, a live conversie to live
([todo.md](todo.md)).

## Credentials

- Stored in `backend/.env` (gitignored); `backend/.env.example` documents the keys.
- Loaded via `python-dotenv` with `override=True`, so editing `.env` actually takes
  effect on the next reload. Without it `python-dotenv` leaves variables already in
  `os.environ` alone and a running process keeps calling the environment it started
  with while the file says otherwise.
- Never log the credentials or the access token; never return them to the client.

| Key | Meaning |
|-----|---------|
| `OMGEVING` | `LIVE`, `ACCEPT` or `TEST` — the default stage, picking the REST subdomain **and** the credential pair below |
| `AFAS_OMGEVING` | the environment number, i.e. the `12345` in `https://12345.rest.afas.online` |
| `{LIVE,ACCEPT,TEST}_Oauth_Client_Id` | the app connector's OAuth client id, per stage |
| `{LIVE,ACCEPT,TEST}_Oauth_Client_Secret` | its secret — AFAS shows this once at creation and cannot retrieve it later |
| `NYMBUS_STAGE` | which stage Nymbus's own data comes from; **defaults to `live`** (see below) |
| `NYMBUS_OMGEVING` | its environment number, defaulting to `AFAS_OMGEVING` |
| `NYMBUS_CACHE_TTL` | seconds a NymbusConversies connector is cached in-process (default 300) |

## Authentication (OAuth, client-credentials flow)

AFAS Profit offers two OAuth flows; we use **client credentials**, the server-to-server one — no end user is involved, which is what a background uploader needs. (The other, authorization code with PKCE, is for acting on behalf of a logged-in user.) The older static `AfasToken` header is **discontinued as of 31 August 2027** and is not used here. Reference: [docs.afas.help/profit/en/authentication](https://docs.afas.help/profit/en/authentication).

The stage selects the host — `live` → `rest.afas.online`, `accept` → `restaccept.afas.online`, `test` → `resttest.afas.online`.

1. `POST {base}/oauth/token`, form-encoded: `grant_type=client_credentials`, `client_id`, `client_secret`.
2. The response carries `access_token`, `token_type: Bearer`, and `expires_in` (seconds, an hour in practice). `refresh_token` is always `null` in this flow — **there is nothing to refresh**; an expired token is simply replaced.
3. Send it on every call as `Authorization: Bearer <access_token>`.

[`afas.py`](../backend/afas.py) caches tokens **per `AfasEnvironment`** — number, stage *and* client id — and re-fetches once within 60s of expiry, so no request leaves with a token that dies in flight and two environments can never share one. A lock keeps concurrent callers from each fetching their own.

> The docs at `docs.afas.help/sb/...` describe **AFAS SB** — a different product on `*.afasfocus.nl`, with its own `/app/auth` + `/app/token` endpoints and an admin-center/customer-environment split. It does not apply to us; use the `/profit/...` pages.

## The client — [`backend/afas.py`](../backend/afas.py)

Imports no FastAPI, so it is equally usable from a route, a script or a test, and it
reads no global "current environment": every call is told which environment it is
for. Four layers, each on top of the previous one.

**1. Environment.** `AfasEnvironment(omgevingnummer, stage, client_id, client_secret, label)`
— frozen and hashable, so it doubles as the token-cache key. `AfasStage` is
`LIVE`/`ACCEPT`/`TEST` and knows its own subdomain. `environment_from_env(stage=…)`
builds one from `.env`; `nymbus_environment()` is Nymbus's own. A customer's will be
built the same way from that project's stored credentials.
`require_complete()` refuses a half-configured environment with an explanation
instead of letting it fail as a DNS error.

**2. Transport.** `afas_request(env, method, endpoint, params=…, json_body=…)` — auth,
timeout, one automatic retry on `401` with a fresh token, and the classification below.

**3. Verbs.** `afas_get` / `afas_post` / `afas_put` / `afas_delete`, deliberately thin.
AFAS gives each method a fixed meaning (referentie §4) — POST inserts, PUT updates,
DELETE removes with the key in the URL — so the point of these is that a call site
says which of those it is doing without anyone reading a string argument.

**4. Intent.** Named for what they do to the data:

```python
get_connector(env, connector, skip=…, take=…, order_by=…, filters=[AfasFilter(...)])
get_all_rows(env, connector, order_by=…)      # pages; order_by is mandatory here
get_metainfo(env)                              # every connector this app connector may use
get_connector_metainfo(env, connector)         # a GetConnector's fields
update_connector_metainfo(env, connector)      # an UpdateConnector's whole schema
insert_record(env, connector, body)            # POST
update_record(env, connector, body)            # PUT
insert_subobject(env, connector, sub, body)    # POST on a subobject
delete_record(env, connector, object, field, value)   # DELETE, key in the URL
```

**Builders**, so a mapping states what it sends rather than how AFAS spells it:

- `AfasFilter(field, value, operator=AfasOperator.EQ)` + `filter_params()` — the three
  parallel querystring parameters, built together so field *i*, value *i* and operator
  *i* can't drift apart. `AfasOperator` is the full table from referentie §2.4.
- `afas_element(fields, keys=…, objects=…, action=…)` and `afas_envelope(root, element)`
  — the `{"<Root>": {"Element": {"Fields": …, "Objects": […]}}}` shape, with `@` written
  onto keys and `@Action` for you.
- `afas_file(bytes)` — base64 for a `blob` field.

> **Never guess the root key.** It is regularly not the connector name:
> `KnSubjectReaction` expects `KnReaction`, `KnSubjectWorkflowReaction` expects
> `KnWorkflow`, `KnEmployee` expects `AfasEmployee`, `FiEntries` expects `FiEntryPar`.
> `update_connector_metainfo()` reports the right one in `payload["name"]`, along with
> every field, whether it is mandatory and its allowed values. Read it before writing
> a payload — that is what CLAUDE.md's "never guess AFAS payloads" means in practice,
> and it is how every field code below was established.

### Paging

`skip=-1&take=-1` ("get all") is `get_connector`'s default because codetabellen are mostly small, but **AFAS discourages it**: keep columns × rows under 150.000 per call or AFAS answers `500` ("Out of memory"). For anything sizeable use `get_all_rows()`, which pages — and there `order_by` is a **required argument**, not an option: without a stable sort AFAS may repeat or skip rows between pages. Prefix a field with `-` for descending. AFAS also caps the querystring at 2049 characters (a long filter can reach it) and asks for at most 5 concurrent calls.

Two things about filters the reference doesn't say, both measured against Nymbus's environment on 29-10-2026:

- **Past the querystring cap AFAS answers `404`**, not a filter error — 60 OR-ed `reaction_id`s (1.6 KB) passed, 80 (2.1 KB) 404'd. A long id list has to be split over calls (`REACTION_IDS_PER_CALL` in the hosted version's backend).
- **Don't mix `,` (AND) and `;` (OR).** `Dossieritem,Instuurdatum;Dossieritem,Instuurdatum` returns only rows when its *first* group matches — swap the groups and the same filter answers an empty list, with a `200`. One field OR-ed (`_any_of()` (the hosted version)) is fine in any order. `filterjson` gets the mix right, but at ~240 bytes a group it hits the cap at about eight. A date filter also needs the full `2026-10-01T00:00:00`; a bare `2026-10-01` is an "onverwachte fout".

### Reading the outcome

**AFAS is not RESTful about failure.** A connector that does not exist and one you are not authorized for *both* return **HTTP 500**, with the reason only in the body; a rejected token returns **401 with an empty body**. So status codes alone cannot tell you what went wrong — `AfasResult.status` does. It never raises for an answer AFAS actually gave:

AFAS answers a *success* in three different shapes, and the classifier has to know all three or it mislabels them: a GetConnector returns `rows`, an UpdateConnector returns `results` holding the new record's primary key (`{"results": {"KnSubject": {"SbId": "999999"}}}`, usually with `201`), and `metainfo/…` returns its own body. Only a genuinely contentless answer — a `DELETE`, or a connector with no matching rows — is `empty`. Read a write's key from `result.results`.

| `status` | Means | AFAS signal |
|----------|-------|-------------|
| `ok` | rows retrieved, or a write accepted | `2xx` with `rows`, `results`, or another body |
| `empty` | call succeeded, no content | `2xx` with `rows: []`, or no body at all |
| `unauthorized` | token missing, invalid or revoked | `401`, empty body |
| `forbidden` | connector exists, this app connector may not use it | `500` + *"niet geautoriseerd"* |
| `not_found` | no such connector or URL, or a querystring over 2049 chars | `500` + `errorNumber -2147200799`, or a real `404` |
| `unreachable` | wrong omgevingnummer, or network down | DNS/connect/timeout, no HTTP at all |
| `config_error` | credentials missing, or AFAS refused to issue a token | no request made, or the token call failed |
| `error` | AFAS refused for some other reason | anything else |

Use `.ok` for "there is data", `.succeeded` for "AFAS accepted the call" (`ok` **or** `empty`), `.first` for a call filtered to one record. Results also carry `logReference` — AFAS support asks for that when you report a failing call — plus `errorNumber`, `httpStatus`, the resolved `url` and the `environment` that answered. `to_dict()` gives a JSON-serializable view for returning straight from a route.

A `401` is retried exactly once with a freshly fetched token, so a revoked or early-expired token heals itself; a second `401` is reported as `unauthorized`.

In [`main.py`](../backend/main.py), `afas_fetch(connector)` is the shorthand for "rows, or an `HTTPException` for my route", and `_afas_http_error()` maps an outcome to `502` (unreachable) or `500`.

## The hosted version's own environment

Everything about who may open what. The app connector is **NymbusConversies**, in its
own **live** environment — the test environment carries a different app connector
("Data Conversie") with the `DV_*` reference tables and no projects at all, which is why
`NYMBUS_STAGE` defaults to `live`.

```
Nymbus_Projecten          een conversieproject      Project = "501277"
  Nymbus_Teamleden        wie erop zit              Mailadres, Rol_teamlid
  Nymbus_Dossieritems_Hoofdtaak  hoofdproces        (1 per project)
  Nymbus_Dossieritems_Deeltaak   deeltaak           (1 per module)
Nymbus_Deeltaaktypes      de deeltaakcodes          MW, UZ, SA, WA, KI, VP,
                                                           DB, CR, PR, VC, AB, OP
Nymbus_Workflowstatus     de statuscodes            KL, SG, NA, A, …  (18)
Nymbus_WorkflowTakenActies  welke actie bij welke taak hoort, met GUID's
Nymbus_Bestanden_bij_reactie   de bijlagen die al binnen zijn
Nymbus_Reacties           de reactietekst bij een bijlage (Reactie = reaction_id)
```

**A module is a deeltaak.** One `Nymbus_Dossieritems_Deeltaak` row,
carrying the deeltaakcode, the workflow status (`Status`) and the task it waits on
(`Taakcode`). So AFAS — not a JSON file — decides which modules a project has and how
far each one is. `modules.json` supplies only what AFAS doesn't: the category
(HRM / ERP), the display order, and which app module a deeltaakcode maps to.

Nymbus added five fields to the (then-single) `Nymbus_Dossieritems` connector
on 23-08-2026; both fields and connector now live split across the two above (split
31-08-2026, see [todo.md](todo.md)). On the **deeltaak** connector: `Opleverdatum`
(read as `nymbus.OPLEVERDATUM_FIELD`, live in the projectrapport now) and, since
27-08-2026, `Laatste_controle`, `Voortgang`, `Fouten`, `Aangeleverd_door` — the
per-hand-off figures the sidebar and projectrapport show, read here but written
through a different connector entirely: this GetConnector is read-only, so
`update_deeltaak_progress()` (the hosted version) PUTs the underlying `KnSubject`'s `KnS51`
vrije-velden subobject instead (see [architecture.md](architecture.md#api-surface)
and [todo.md](todo.md)). On the **hoofdtaak** connector instead — settings of the
whole conversion, not of one module — `HRM-periodetabel`, `Datum_livegang` and
`Appreo_testdatum`, read into every project's `hrmPeriodetabel` / `livegangDatum` /
`appreoTestdatum`.

The first two of those are also **written** from the tool, by admins, in the
projectinstellingen dialog's *Conversie* tab — they decide five columns of a
facilitaire conversie's Medewerkers sheet, and a conversion that starts before AFAS
has them filled in leaves those columns empty. The write takes the same route the
deeltaak figures do and for the same reason: the hoofdtaak GetConnector is read-only,
so `update_conversion_settings()` (the hosted version) PUTs the underlying `KnSubject`'s `KnS51`
instead, keyed by the hoofdproces dossieritem's `SbId` (a project's `dossierId`). One
`KnS51` serves both kinds of dossieritem; which of its fields mean anything is decided
by the item the `SbId` names. The field codes there are the raw GUIDs AFAS assigned —
only the GetConnector exposes the friendly `HRM-periodetabel` / `Datum_livegang` names
— confirmed live against `metainfo/update/KnSubject` on 22-09-2026:
`U53A1D8CE6BF64688B0BF7D322EEE1D9A` (HRM-periodetabel, `int`, length 2) and
`UAE5151C3FEC149F5A5A7E78B8E31E91D` (Datum livegang, `date`). Both are sent on every
save, so an emptied field **clears** the value in AFAS rather than leaving it as it
was — a form whose whole point is that a setting can be taken away again. Like the
progress write this touches only the vrije velden: no reaction and no workflow action,
so nothing in the conversion moves because a setting changed.

That last mapping is **not always one-to-one**, which is the one wrinkle worth knowing:
AFAS's `OP` (*Openstaande posten en activa*) still covers both *Openstaande posten* and
*Vaste activa* — each app module keeps its own template, rule set and help, and both show
that one deeltaak's status, because in AFAS they really are one deeltaak. `VP` used to
cover *Verlofsaldo* and *Salarisparameters* the same way, and *Vakantietoeslag*,
*Contactpersonen* and *Artikelen* had no deeltaak at all — until 26-08-2026, when
`Nymbus_Deeltaaktypes` gained dedicated `SA`, `GV`, `CO` and `AR` codes, all
four confirmed live and mapped in `modules.json`/`modules.tsx`.

the hosted version's backend caches each connector for `NYMBUS_CACHE_TTL` seconds behind a per-key lock,
so a cold cache costs one AFAS call rather than one per concurrent request, and
`clear_cache()` drops it after a write. A failure raises `NymbusUnavailable`, which
carries the `AfasResult` so the route can pick the right HTTP status.

## Handing a sheet back — *Aanleveren bij Nymbus*

`POST /api/upload` attaches the checked workbook to the module's deeltaak-dossieritem
and fires the workflow action that says the template has been filled in — exactly what a
client does by hand in InSite today, so the file lands where Nymbus already looks for it
and the deeltaak moves on by itself.

An admin may send more on the same reaction: the PDF validation report, dropped files
and pasted screenshots go up as further `KnReactionAttachment`s after the workbook
(`SheetSubmission.extra_attachments`), the same multi-attachment shape the review
decisions below use. A client's hand-in is the workbook and nothing else (403).

The connector is `KnSubjectWorkflowReaction`, whose body root is **`KnWorkflow`**. Every
field below is confirmed live against `metainfo/update/KnSubjectWorkflowReaction`
(24-08-2026) — `SbId` is the **only** field AFAS itself marks mandatory; `WfNm`/`TkNm`/
`AcNm` are what this app relies on to fire the workflow action, not a schema requirement.
All three take AFAS's own workflow/task/action **GUIDs**, confirmed against AFAS's help
center (`App_Conect_UpdDsc_175`) after two guesses were rejected live with *"De taak,
actie of activiteit bestaat niet"* — neither the captions (`Workflow`/`Task`/`Actie`) nor
the human-readable numeric codes (`WorkflowId`/`TaskId`/`ActieId`) work, despite metainfo
typing all three fields as plain `string` regardless of which. The GUIDs come from
`Nymbus_WorkflowTakenActies` (`WorkflowGuid`/`TaskGuid`/`ActieGuid`) — a connector
Nymbus added specifically for this, replacing `Nymbus_Workflowgegevens`, which never
carried them:

```jsonc
{
  "KnWorkflow": {
    "Element": {
      "Fields": {
        "SbId": "317597",                                // het dossieritem van de deeltaak
        "WfNm": "008D215F528641E580D50BD58FF93218",       // WorkflowGuid van "Conversie deelproces"
        "TkNm": "B82C994F61004E3EAA0B84783EB2DDFD",       // TaskGuid van "Template vullen"
        "AcNm": "8091C53A7D1442C58C9F52B1048D9801",       // ActieGuid van "Template gevuld"
        "Tx":   "instuurder: Taroen Sitaldin\nemail: lokaal@localhost\n\n…",  // zie hieronder
        "VaRe": "EI"        // zichtbaar: I = intern, EI = extern en intern
      },
      "Objects": [
        {
          "KnReactionAttachment": {
            "Element": {
              "Fields": {
                "FileName": "Medewerkers_2026-08-09_141005.xlsx",
                "FileStream": "UEsDBBQ…"   // het bestand, base64
              }
            }
          }
        }
      ]
    }
  }
}
```

The attachment is `KnReactionAttachment`, a **nested object** of `KnSubjectWorkflowReaction`
itself (confirmed in the same metainfo call, alongside `KnReactionLabel`/`KnReactionEmoji`) —
not a URL subobject: `../connectors/KnSubjectWorkflowReaction/KnReactionAttachment` (referentie
§4.2) is for adding a subobject to an **existing** parent record and does not apply here. Both
go up in the one `POST connectors/KnSubjectWorkflowReaction` call above.

Which action fires is **not** hard-coded to "action 1": action 1 of *Controle testimport*
is *Import akkoord* — the **client's** verdict on the test import Nymbus ran, which this
tool must never fire on their behalf. `SUBMIT_TASKS`
in the hosted version's backend pins the two tasks at which a client hands a template in —
`1002634 Template vullen` → actienr `1` (*Template gevuld*) and `1002635 Vullen import
template` → actienr `1` (*Template aangepast*) — by their stable numeric `TaskId`/`ActieId`,
while the GUIDs themselves are read from `Nymbus_WorkflowTakenActies` at call time
via `workflow_actions()`/`submit_action_for()`, so a workflow rebuild that reissues them
doesn't break the call. A deeltaak on any other task is refused with a `409` explaining why.

**The button's own gate** is what's left in front of it, and it is now **two** conditions
for a client rather than one: the workflow must be at a task that takes a hand-in at all
(a `submit` entry in the module's `actions` — `SUBMIT_TASKS` again; see
[architecture.md](architecture.md#api-surface)) **and** the sheet must have been checked,
carry no error and be unedited since. The first exists so a client is never shown a live
"send" button for a sheet AFAS has already moved past — the 409 `_resolve_submission()`
answers with below used to be the *only* place that was said, discovered by pressing the
button and reading the refusal. **An admin is held by neither** — a loaded file is enough
on any workflow step, checked or not, clean or not.

There used to be a second guard, `NYMBUS_SUBMIT_ENABLED` (off unless set, so a development
run couldn't post into a live customer dossier by accident) — removed once real submissions
were deliberately turned on, so there is one fewer environment variable to keep straight.

**Pressing the button — for admin and client alike — opens
[`SubmitCommentDialog`](../frontend/src/components/uploader/SubmitCommentDialog.tsx)
before anything is sent**: one **Reactie** field, and it is mandatory — the confirm
button stays disabled on an empty (or all-whitespace) comment, and `POST /api/upload`
checks again itself, `400`ing a comment that arrives empty rather than trusting the
frontend gate. There is nothing to redact or read here — no envelope, no file, no
payload preview at all (the review dialogs below dropped theirs the same way) — it
exists purely to make someone say why before a reaction lands in a customer's dossier.

**What actually lands in `Tx` is not the comment alone.** `_submission_text()` (the hosted version)
always prepends a header the dialog never shows and the request never carries: the
sender's name and e-mail, both read off the **verified session** server-side
(`session["user"]["name"]`/`["email"]`) rather than trusted from the request body —

```
instuurder: Taroen Sitaldin
email: lokaal@localhost

<de reactie zoals getypt>
```

so the dossieritem always says who actually pressed the button, independent of whatever
the comment itself says. `UsTa` (*Gebruiker*, the AFAS usercode of whoever is posting)
was tried for the same purpose and dropped again — `build_workflow_reaction()` no
longer accepts one at all — since the sender is now identified in `Tx` itself and
`Nymbus_Teamleden` has no AFAS usercode to map an e-mail to anyway.

The file sent is the **written** workbook — the same bytes *Opslaan en downloaden*
produces, via the shared `buildSheetFile()` in [`lib/excel.ts`](../frontend/src/lib/excel.ts) —
so the client's corrections travel with it and the two ways out of the browser can't
produce two different files. It goes up as base64 in the JSON body rather than as
multipart, because AFAS wants base64 in `FileStream` anyway.

> **What this does not do:** write the rows into the *customer's* AFAS. That is the other
> half of the upload — it needs their environment and a field mapping per module, and
> neither exists yet. See [todo.md](todo.md).

## Workflow actions after the hand-in

The step after *Aanleveren bij Nymbus*: once a client's template lands, the deeltaak
moves to **`1003302 Controle ingevulde template`**, and an admin records the outcome.

**This is not an approval step, and hasn't been since 07-09-2026.** A client can only
hand a sheet in once it validates, so there is nothing here for Nymbus to approve —
the step became *"we ran the test import"*, and the client judges that import at the
**next** task. Nymbus and the client alternate from here on, twice: we import, they
verdict, first on test then on live. The whole of `WorkflowId 1000525 Conversie
deelproces`, read off `Nymbus_WorkflowTakenActies` (07-09-2026, live):

| Task | Who acts | Actions |
|---|---|---|
| `1002634` Template vullen | client | `1` *Template gevuld* |
| `1003302` Controle ingevulde template | **Nymbus** | `4` *Import afgerond* · `2` *Controle uitgevoerd, data niet akkoord* |
| `1003304` Controle testimport | **client** | `1` *Import akkoord* · `2` *Import niet akkoord* |
| `1003305` Live conversie uitvoeren | **Nymbus** | `1` *Import afgerond* |
| `1003306` Controle live import | **client** | `1` *Akkoord, deelproces afronden* · `2` *Import niet akkoord* |

**Every action at the deeltaak's current task gets a button** (since 12-10-2026), not
just a pinned pair. `project_modules()` reads `Nymbus_WorkflowTakenActies` once
and carries the current task's actions on each module row as `actions: [{ number,
label, submit }]`, in `ActieId` order — so a new action in AFAS is a new button with
no change here. **The label is ours, keyed by code**: `ACTION_LABELS` in
the hosted version's backend maps `(TaskId, ActieId)` to the button's text, so
rewording an action in AFAS leaves its button alone (the action number alone isn't
unique — `1` exists at every task). An action missing from the map falls back to its
AFAS caption. Only the button and its dialog use it; the reaction text and the
mails keep the AFAS caption. The dot's colour is read off the label (`actionTone()`),
so an alias should keep *akkoord* / *niet akkoord* / *afgerond* where it had them. Two
exceptions:

- **`submit`** marks the hand-in (`SUBMIT_TASKS`, above). Its button is *Aanleveren*,
  which carries the sheet through `/api/upload`; the generic route refuses it.
- ***Verwijderen*** (on every task, `ActieId` 2 or 3) is never offered — this tool
  doesn't delete a deeltaak. Matched by caption (`HIDDEN_ACTIONS`), since its number
  differs per task.

**Who sees them is the task's.** The deeltaak's `Gebruikersgroepen` list the AFAS
groups that may act at its current task; when they name **Datateam** (`ADMIN_GROUP`,
a case-insensitive substring) the task is Nymbus's and its buttons are admin-only —
`adminOnly` on the module row. Every other task's buttons are open to anyone on the
project, admins and developers included: they see every button on every task. Live on
12-10-2026 only *Controle ingevulde template* names the Datateam. This is separate
from `withNymbus` (`CLIENT_TASKS`), which only decides the client's "this task is with
Nymbus" notice and the hand-in's refusal.

**Which step a task belongs to is a third map**, `STAGE_TASKS` (22-10-2026), sent as
`stage` on the module row: `validatie` at the two template tasks, `test` from
*Controle ingevulde template* (Nymbus runs the test import) through *Controle
testimport*, `live` from *Live conversie uitvoeren* through *Controle live import*.
The two *Import niet akkoord* tasks (`1003307`, `1003308`) take their step from the
**status** instead (`STAGE_STATUSES`: `IA` test, `LN` live): on 23-10-2026 the one
deeltaak at `1003308` was `IA` *Testimport niet akkoord*, though the comments on
`CLIENT_TASKS` and `CLIENT_NOTICES` place `1003308` after the live import. *Afgerond* sits at no
task, so the frontend reads it off the status (`conversionSteps()` in
[modules.tsx](../frontend/src/lib/modules.tsx)). It is what lets the reports tell
"100% gevalideerd" from "100% in Live" — a module is only through once its live step is.

**`POST /api/workflow/action`** fires one: `{ project_id, module_id, action_number,
comment?, attachments?, completeness?, total_rows?, error_row_count? }`. It resolves
the action against the deeltaak's *current* task via `action_for()` — the GUIDs read
from AFAS at call time, as for the hand-in — so a deeltaak that moved on since the page
loaded is refused with a `409`. `403` for a client on an `adminOnly` task, or a client
sending attachments; a client's figures are dropped rather than stamped, for the reason
`/api/progress` is admin-only.

**No file is required.** An action posts the same `KnSubjectWorkflowReaction` /
`KnWorkflow` envelope as handing a sheet back — `build_workflow_reaction()` is shared —
but the workbook is already attached from the hand-in itself, so a bare action sends
`attachments=[]` and the body carries no `Objects` at all. An admin may add their own on
top: the edited sheet (`buildSheetFile()`), the PDF validation report
(`buildReportPdf()`), or screenshots pasted into the Reactie field — each its own
`KnReactionAttachment` under one `Objects` entry, `Element` an array of them. Sending
*more than one* `KnReactionAttachment` in one call hadn't been live-tested as of
27-08-2026; confirm via `update_connector_metainfo(env, "KnSubjectWorkflowReaction")`
or a live test post before relying on it.

In the toolbar each action is a `WorkflowActionButton` in
[`SheetToolbar`](../frontend/src/components/uploader/SheetToolbar.tsx)'s workflow
column, its dot toned from the caption (`actionTone()`: *niet akkoord* red, *akkoord* /
*afgerond* emerald, anything else orange). Each opens
[`WorkflowActionDialog`](../frontend/src/components/uploader/WorkflowActionDialog.tsx):
an optional **Reactie** (empty falls back to `_default_action_comment()`), and for an
admin the attachment options, confirmed with **Vastleggen: {caption}**.

## Field mapping

Each module will map to a connector and field layout in the **customer's** environment
(all **TBD**). Keep the mapping as config keyed by module id, alongside the rule sets, so
the two stay in sync.

### Making the mapping — `/afas/updateconnectors`

The page below is also where a mapping is **made**: drop the module's template
(`HRM 1_Medewerkers.xlsx`) on it and its header row appears above the connector's
fields, one draggable button per column. Dragging a header onto a field maps it;
the field then wears the column's name and the JSON tab shows the body with that
column's value from the example row in it, so a column that landed in the wrong
field is visible immediately rather than at upload time.

A field that is the same for every row — a dossieritemtype, a verwerkingscode, a flag
AFAS insists on — takes a **fixed value** instead, typed once into the field's own row
(`=`). It is checked against the field's metainfo before it is accepted
(`parseFixedValue()`): type, length, decimals, `notzero` and the allowed values, which
are the refusals AFAS itself would give, minutes earlier.

### Where a value comes from

The mapping model knows **two** sources today — a sheet column or a fixed value — and
that is not the finished picture. Most modules will fill their AFAS fields from **three**
places, and a conversion is only correct when all three are available:

| Source | What it holds | Status |
|---|---|---|
| **The client's Excel sheet** | what only the client can know — their own numbers, names, codes, saldi | **implemented** (`column`) |
| **Configuration on the project or the dossieritem** | settings of the conversion itself, identical for every row: the periodetabel, the livegangdatum, an administratienummer, a boekjaar | **partly** — the periodetabel and livegangdatum have a confirmed home, `HRM-periodetabel` / `Datum_livegang` on the hoofdproces dossieritem (`projects()` (the hosted version)'s `hrmPeriodetabel` / `livegangDatum`), and since 09-09-2026 a **facilitaire** conversie really does consume them: [`lib/standard-columns.ts`](../frontend/src/lib/standard-columns.ts) fills five of `hrm-medewerkers`' columns from them, in the validation and the payload alike (see [file-types.md](file-types.md#columns-the-tool-fills-itself)). It is a resolver over the existing mapping rather than the general `FieldSource` variant, so a standard conversion is unchanged and every other module is still stood in for by `fixed` values typed once, or by a script |
| **A GET connector against the customer's AFAS** | data AFAS already has and the client should not retype: a medewerker's datum in dienst or werkgever, an existing debiteurnummer, a projectgroep | **partly** — since 29-09-2026 a column can be **looked up** (`lookup` on a column source, see [*AFAS lookups*](#afas-lookups--a-value-found-by-a-cell) below): the cell picks a row of a GetConnector in the environment being sent to, and that row's value is sent. What isn't built is a value AFAS holds with *no* cell to find it by |

Plus a fourth thing that is not a source but a step: values **derived** from the
others — `max(datum in dienst, livegangdatum)`, that date's year and month, hours ×60
into minutes, a Hulptabel code translated into AFAS's own. See
[todo.md](todo.md) item 6 → *Row-level transforms*.

`hrm-vakantietoeslag` is the module where this became concrete, and it is worth reading
as the worked example: of its seven input columns only **two** are the client's
(*Medewerker*, *Grondslag*). The periodetabel and the livegangdatum are configuration,
the datum in dienst and the werkgever come out of AFAS per employee, and *Datum*,
*Boekjaar* and *Periode* are all computed from those. A conversion script currently does
all of it and hands the tool a flat seven-column dataset; the mapping is made against
that dataset rather than against the three-column sjabloon, because the sjabloon cannot
fill four of the eight AFAS fields. `mappings/modules/hrm-vakantietoeslag.json` records
which of its columns comes from where.

The practical consequence while the general variant doesn't exist: outside the five
facilitaire columns above, a field that will eventually be read from configuration or
from AFAS is either a **fixed value** typed in once (right when it really is the same for the whole conversion — a boekjaar, a
verwerkingscode) or it is **left unmapped with a note** (right when it varies per row and
therefore cannot be faked, like a per-employee datum in dienst). Several mappings already
carry exactly that note — `erp-abonnementen`'s `VaDu`, `erp-projecten`'s `PrSt` —
and they are waiting on this, not on the mapping. A value that follows from the
livegangdatum needs neither: `erp-openstaandposten`'s `Year`/`Peri`/`EnDa` are `derive`
overrides on `read.livegang` in `MODULE_OVERRIDES` (`frontend/src/lib/module-phases.ts`).

### AFAS lookups — a value found by a cell

Some fields want a value only AFAS has, but the sheet carries something that finds it.
`erp-abonnementen`'s kop needs two relation keys — `FbSubscription#BcId`
(Organisatie/persoon, the **relation number**) and `#DbId` (Verkooprelatie, the
debiteurnummer) — and both belong to the abonnement's **project**. So neither is read
from the sheet: the *Projectnummer* cell is looked up in `CON_ERP_Projecten` (`Project`,
padded `000001` in AFAS), whose rows carry `Debiteur_nummer` and `Organisatie_nummer`.
The template has no *Debiteur* column any more. (Until 06-11-2026
`DbId` was the *Debiteur* cell as typed and `BcId` its relation number from
`CON_ERP_Debiteuren` — `Debiteur` → `Nummer`, `VR10004` → `1000001`.) A `valueMap`
can't carry any of this — it differs per customer and per stage (at 501342, 187
debiteuren in test against 6 in live, 29-09-2026) — so the mapping stores the **rule**
and the value is read when the payload is built:

```jsonc
{ "object": ["FbSubscription"], "field": "BcId", "source": "column",
  "column": "Projectnummer", "columnIndex": 0,
  "lookup": { "connector": "CON_ERP_Projecten", "matchField": "Project",
              "valueField": "Organisatie_nummer", "noun": "Project" } },
{ "object": ["FbSubscription"], "field": "DbId", "source": "column",
  "column": "Projectnummer", "columnIndex": 0,
  "lookup": { "connector": "CON_ERP_Projecten", "matchField": "Project",
              "valueField": "Debiteur_nummer", "noun": "Project" } }
```

A project in `CON_ERP_Projecten` with an empty `Organisatie_nummer` or `Debiteur_nummer`
has no answer for that field, so its abonnementen are blocked from the send rather than
sent without the relation.

- **Made in the editor** with the database-search button on a field row (beside `=`, and
  beside the key/translation toggles once a column is mapped). The dialog reads as the
  rule — *zoek in* a GetConnector, *de rij waar* a field *gelijk is aan kolom* …, *en
  neem* a field — with the connector's first rows underneath, the two chosen fields
  tinted. Connectors and preview come from the mapping's group environment
  (`GET /api/afas/getconnectors/{group}[/{connector}]`, admin-only).
- **Resolved per stage** from the project's own AFAS
  (`GET /api/projects/{id}/lookup?stage=…&connector=…&match=…&value=…`,
  [`backend/lookups.py`](../backend/lookups.py)). Only a triple a stored mapping declares
  is served; anything else is a 404, so the route can't read an arbitrary GetConnector.
- **Keys are normalized like existence keys** (`normalize_key`): AFAS pads, Excel strips.
- **No answer ⇒ the record is not sent.** No match, more than one distinct value, a
  connector AFAS refuses, a stage without credentials, or a table still loading: the field
  resolves to `null` with the reason as its note, the record gets a red *Niet gevonden*
  badge and is left out of the send (`ModulePayload.blocked`). Passing the raw cell
  through — what an untranslated `valueMap` entry does — would link the record to
  whichever relation happens to carry that number, which AFAS can't catch.
- **A lookup can double as an existence check.** With `matchField` = `valueField` the
  value sent is the cell itself, in AFAS's spelling, so all the lookup adds is the
  question "does this row exist in the environment being sent to?". `erp-voorcalculatie`'s
  `PrId` does this against `CON_ERP_Projecten` (`Project`): an offerte whose project isn't in that
  environment is greyed out and left out of the send. `erp-projecten`'s `DbId` does the
  same against `CON_ERP_Debiteuren` (`Debiteur`), for a project whose debiteur is missing. An optional `noun` (`"Project"`)
  rewords the miss as *Project "123" bestaat niet in …*. It is set in the JSON only, and
  the dialog keeps it as long as the connector stays the same.
- A blank cell omits the field, as any blank cell does. A lookup and a `valueMap` are
  exclusive on one field; the backend refuses both at once, a lookup on a fixed value,
  and connector/field names that aren't AFAS ids.

### A factor on a column (`multiply`)

A column source can carry `"multiply": <number>`: the cell's number is multiplied by it
before it goes into the body — for a sheet whose unit isn't AFAS's. The first is
`hrm-verlofsaldo`'s `HhMm`: the client enters hours in *Huidig Saldo (in Uren)*, AFAS
wants minutes, so `"multiply": 60` (13-10-2026). `scaledValue()` in
[`lib/field-mapping.ts`](../frontend/src/lib/field-mapping.ts) rounds the product to a
whole number for an `int` field (AFAS refuses a fraction there) and to six decimals
otherwise; a cell that isn't a number goes out unscaled, for the rule set and AFAS to
refuse. Set in the mapping editor with the calculator button beside a mapped column, on
an `int`/`decimal` field only. Exclusive with `valueMap` and `lookup`, which replace the
cell rather than scale it; the backend refuses the combination, a factor on a fixed
value, and a factor of 0.

### A second column for an empty cell (`fallback`)

A column source can carry `"fallback": {"column": …, "columnIndex": …}`: when the
field's own cell is blank, that column's cell is read instead; a filled cell always
wins, and with both blank the field is left out as usual. The first is
`hrm-medewerkers`' `EmA2` (*E-mail privé*), falling back to *E-mail werk*: `EmAd` is
fixed to `P` (digital documents go to the private address), so an employee with only
a work address would otherwise receive none (03-11-2026). The fallback column is
re-pointed by header like the field's own (`remapToSheet()`), and dropped on its own
when the sheet no longer has it. `valueMap`, `lookup` and `multiply` apply to whichever
cell was read. The payload view's note names the borrowed column (*E-mail werk
(E-mail privé leeg)*). Set in the mapping file only; the editor shows it as a badge
beside the column but can't edit it yet. The backend refuses it on a fixed value.

### What a cell becomes in the body

A cell is text; a field has a type. `afasValue()` in
[`lib/field-mapping.ts`](../frontend/src/lib/field-mapping.ts) converts the one into the
other **per the field's own `dataType` out of metainfo**, and only where the conversion is
unambiguous:

| `dataType` | What the cell becomes | Left as text when |
|---|---|---|
| `int`, `decimal` | a JSON **number** — `1234`, `40.5`, a comma decimal read as a point | it doesn't parse as a number |
| `boolean` | `true` / `false`, from `ja/j/1/waar` and `nee/n/0/onwaar` | the cell says anything else |
| `date`, `datetime` | **`yyyy-mm-dd`** — `23-08-2026` becomes `2026-08-23`; a cell carrying a time keeps it, as `2026-08-23T08:00:00` | the notation is none the rule sets accept, or it names a day that doesn't exist |
| everything else | the text, unchanged | — |

Nothing here *refuses* a value: these are the client's cells, so a conversion that can't
be made leaves the text standing where the payload preview shows it, rather than a `0` or
a guessed year that hides it. A **fixed** value is the other way round — it is being typed
now, by someone who can fix it now — so `parseFixedValue()` does refuse, against the
length, decimals, `notzero` and allowed values metainfo states.

Two things about that table are decisions rather than readings, and both were confirmed
against AFAS itself:

- **The date format is `yyyy-mm-dd`.** The referentie states no format anywhere; every
  example in it happens to be ISO. Confirmed 23-08-2026 with a `CsDa` (*Klant sinds*) POST
  on `KnSalesRelationOrg` against a test environment, which takes
  `"2026-08-23"`. The parsing goes through the validation engine's own `toDate()` rather
  than a second date parser, so the mapping and a column's `date` check cannot disagree
  about what a date is. Note one asymmetry left standing on purpose: a *fixed* date is
  written `2026-08-23T00:00:00`, the form the referentie also shows, so one field can
  carry either depending on where its value came from.
- **An empty cell omits its key** — it is not sent as `""` and not as `null`. This is not
  tidiness: on a **PUT** an empty value *clears* the field it is sent for (§4), so a body
  carrying `""` for every blank cell would empty half a record it was only meant to add
  to. `fieldValues()` answers `{ omit: true }` for a mapped column whose cell is blank,
  which `fieldsLines()` in [`lib/afas-schema.ts`](../frontend/src/lib/afas-schema.ts)
  drops from `Fields`. It is a different answer from *unmapped*, which keeps its
  placeholder so a body still shows its whole shape.

### Insert or update

**Not built** — the decision is made and this is what it commits to
([todo.md](todo.md) item 3).

A conversion is not one verb applied to a file. Per module the default is an **insert**;
what makes a row an update is finding that AFAS already has it. So a run reads the
customer's environment first — a **GET connector per module**, its employees for
`hrm-medewerkers` — matches every Excel row against what came back, and decides per row:

| The row | Verb |
|---|---|
| matches a record already there | **update** |
| exists only in the sheet | **insert** |

One body can carry both. `erp-contactpersonen` hangs a contact on an existing
debiteur/crediteur, so the relation is *updated* while the contact is *inserted*, in one
call — the key as an `@`-property on the element it belongs to, the new record as a nested
object:

```json
{
  "KnSalesRelationOrg": {
    "Element": {
      "@DbId": "12345",
      "Fields": { "CsDa": "2026-08-23" },
      "Objects": [
        { "KnOrganisation": { "Element": { "Objects": [
          { "KnContact": { "Element": { "Fields": {
            "ViKc": "PRS", "FuDs": "Directeur", "ViMd": "EMA",
            "TeNr": "1234568", "MbNr": "06123455", "EmAd": "test@email.nl"
          } } } }
        ] } } }
      ]
    }
  }
}
```

Which half is which is said with AFAS's own mechanism: **`@Action`** — `insert`, `update`
or `delete` — inside each object's own `Fields`
([referentie §4.1](AFAS-Profit-API-Referentie.md)), keys as `@`-properties (`@DbId`,
`@EmId`, `@AcId`). AFAS validates and processes **the whole body as one transaction**,
which is worth knowing before designing batching: atomicity *within* a body is not a
choice the tool gets to make.

Two consequences reach back into things already written:

- **`mandatory` in metainfo describes the insert.** On a PUT *alleen sleutelvelden zijn
  verplicht* (§4), so a field AFAS flags mandatory is no blocker at all on the update
  path. Several mapping notes were written before that was clear — see
  [todo.md](todo.md) item 1 for the pair still worth a create call.
- **The empty-cell rule above is load-bearing here.** `""` on an update is an
  instruction to clear, so omitting the key is what keeps a conversion additive.

Still to specify: which GetConnector serves which module, and **the match key per
module** — the fields that decide "this row is that record". That is a business answer per
module rather than a schema one, and a wrong key silently updates the wrong record instead
of failing.

### Several rows, one record — grouping

Every module above reads **one row into one record**. *Voorcalculatie* doesn't fit
that: one offerte carries several regels, and the sheet states it flat — in
`ERP 4_Voorcalculatie.xlsx` the four offerte columns (*Projectnummer*, *Offerte*,
*Begindatum Offerte*, *Einddatum Offerte*) repeat identically on every row of one
offerte and only the regel columns differ. Three rows are **one** `KnQuotation` with
three `KnQuotationLine`s, not three quotations.

So a mapped column can say one more thing about itself: that it is part of the
**group key**. That is the only control — the key icon beside the column's own pill in
the **Structuur** tab (`toggleKey` on `FieldMappingApi`) — and it is offered on a
column alone, never on a fixed value: a constant is the same on every row, so it would
put the whole sheet in one group and identify nothing.

Everything else is **derived**, so there is no second setting to keep in step:

| | Which object | What it produces |
|---|---|---|
| **kop** | the object the key fields sit in (`KnQuotation`) | written **once per group**, from the group's first row |
| **regel** | the shallowest object below it that has a column of its own (`KnQuotation.KnQuotationLine`) | **one element per row** of the group |

`groupShape()` in [`lib/field-mapping.ts`](../frontend/src/lib/field-mapping.ts) reads
both straight off the mapping — a mapping key already carries its object's path, so no
tree walk is needed and the filtered schema on screen can't change the answer. Objects
deeper than the regel ride along inside each one, which is right: one row is one regel,
so a row can carry at most one of whatever hangs under it. A mapping with no key yields
`null` and every caller falls back to one-row-one-record, which is what the other
thirteen modules are.

The repeated half goes out in **AFAS's own array form** — `"Element": [ {…}, {…} ]`
under the sub-object, exactly as `FbSales` → `FbSalesLines` does it in
[the referentie](AFAS-Profit-API-Referentie.md) §3.2 and §6.3. `PayloadRepeat` in
[`lib/afas-schema.ts`](../frontend/src/lib/afas-schema.ts) renders it, taking one
resolver per row so each element carries its own row's values through the same
`fieldValues()` the ungrouped body uses.

Three things make a grouping **checkable instead of taken on faith**, which is the
point of putting it on this page rather than in a config file:

- The **kop** and **regel per rij** badges on the object headers, so what the page made
  of the key is visible at the object it applies to.
- **`3 records uit 12 rijen`** beside the other figures. A grouping that is wrong is
  usually wrong in that number first.
- The **JSON** tab shows the whole group the example row belongs to, so
  `KnQuotationLine` visibly becomes an array of three with three different itemcodes in
  it. The line above it names the rows that went in and the columns they grouped on.

**Key columns and ordinary kop columns behave differently on a typo, and that is the
reason to mark only the identifying ones.** A key column can't disagree within a group
— a different value *is* a different group, so a typo'd *Offerte* silently yields a
second quotation. A column mapped into the kop but **not** marked as key must agree
across the group, and `groupDisagreements()` reports it when it doesn't (*"Begindatum
Offerte: `01-01-2026` tegenover `09-09-2026` (rij 4)"*) rather than letting the first
row's value win unnoticed. So marking *Projectnummer + Offerte* as the key and leaving
the two dates as ordinary kop fields catches a mistyped date; marking all four makes
that same mistype a second offerte instead. Which is wanted is a business call per
module — the mapping records it either way.

The result is a `MappingExport` (**Koppeling** tab) — connector, root key, file, and
every filled field with the column or the constant behind it, in schema order. That
document is what a mapping *is*, wherever it ends up stored; **Opslaan** stamps it with
who saved it and when and puts it in the store (admin-only, `GET`/`PUT`/`DELETE
/api/afas/mappings[/{connector}]`). The connector list marks the connectors that
already have one, and reopening one restores it — re-pointed at whichever copy of the
template is open.

**A counter-line per row.** A journaalpost has to balance (AFAS reference §6.4), and a
sheet of open debiteurenposten is all debet. So a grouped module can name a
`counterLine` in its payload plan (`MODULE_PAYLOAD_PLANS` in
`frontend/src/lib/module-payloads.ts`). The repeated regel is then written **twice per
row**: the row's own line, then the same line turned around — the account from a sheet
column, constants written over it, two amount fields swapped, and the fields that
only mean something on the row's own account left out. `erp-openstaandposten` is the
one user (Taroen, 13-10-2026): `AcNr` from *Tussenrekening*, `VaAs` 1, `AmDe` ↔ `AmCr`,
without `AuPa`/`InId`/`DaEx`. One counter-line per row rather than one per post keeps
each boekstuk balanced on its own. The opposite amount field is mapped as a fixed 0,
because the body only carries mapped fields and the swap needs both of them there.

### Where a mapping lives — one row per mapping

A mapping is one of three kinds, and each is **one row** of the `field_mappings` table
in Postgres ([`mapping_store.py`](../backend/mapping_store.py)), addressed by group,
project (for `clients`) and key, with the whole mapping document as JSON. The table
replaced one JSON file per mapping under `backend/json_files/mappings/<group>/`, and
the paths below are still how those files are laid out. The table is the store; the
files are how a change travels through git: every backend **syncs** them into its
database on start, merging what git changed since the last sync into the row so an
edit made in the app elsewhere in the mapping survives (git wins where both touched
the same field). A save in the app from a local checkout writes the file as well, so
it lands in `git diff`. See the
docstring of [`mapping_store.py`](../backend/mapping_store.py).

| Kind | Path | Keyed by | What it is |
|---|---|---|---|
| **Modules** | `mappings/modules/<module-id>.json` | the **app module id** (`erp-projecten`, `hrm-medewerkers`, …) — the file's own `connector` field names the real AFAS connector | made once against the **template** environment (project 501342, Balans live), used at every customer — see "A mapping is not per client" above |
| **Nymbus** | `mappings/nymbus/<Connector>.json` | the connector | the dossier/workflow connectors this tool writes through in Nymbus's own **live** environment (`KnSubject`, `KnSubjectWorkflowReaction`, …) — not tied to a module |
| **Client** | `mappings/clients/<projectId>/<module-id>.json` | the project id, then the **app module id** — same reason as `modules`: one client can flag two modules sharing a connector too | a project's own copy of one module's mapping, for a customer whose data forces it to deviate from the modules one — created only when that happens. Also where a **custom module**'s mapping lives, keyed by its own id (`hrm-medewerkers--vrije-velden`) — see *Custom modules* below |

`modules` and `nymbus` are the two groups `CONNECTOR_GROUPS` already knows (the same
two the schema explorer reads), so `/api/afas/mappings/{group}/{key}` reads and writes
this layout for both — but what `{key}` means differs by group. For `nymbus`, the
path is authoritative: `group`/`connector` are rebuilt from wherever the file was
found, so a copied or renamed file can't disagree with its own address. `modules`
can't work that way — **one connector can serve more than one module**, which is
exactly why this is keyed by module rather than connector: `KnEmployee` maps both
`hrm-medewerkers` and `hrm-uitzendkrachten`, each its own file with its own (smaller)
set of fields. So for `modules`, `module` comes from the path and `connector` is
trusted from the file's own content instead.

That split is a deliberate half-step: the **page** at `/afas/updateconnectors` still
only ever knows a connector, never a module. Two modules-group files sharing one
connector both report that same `connector`, so the page's own connector-keyed lookup
(`mappingKey()` in `lib/field-mapping.ts`) can only hold one of the two at a time —
the other loses the collision silently in the browser's map, not on disk — and the
page has no way to open either by its module id at all. Clicking **Opslaan** while
browsing `KnEmployee` there writes a *third*, connector-keyed file
(`modules/KnEmployee.json`) alongside the two module-keyed ones rather than either of
them. Giving the page a module picker is open, see [todo.md](todo.md) item 8.

**`clients` is wired up, on its own address space** — a project's own copy of a
module's mapping never shares the standard flow's `group`+`connector` addressing,
because the question it answers is different ("which project, which module", not
"which of the two Nymbus environments"). Three routes, all admin-only:

- `GET /api/afas/updateconnectors/clients` — every project with at least one module
  flagged in *Projectinstellingen → Afwijkende koppelingen*, each with the connector
  its **standard** mapping targets (`connector: null` if there isn't a standard
  mapping yet — nothing to snapshot, so nothing to open) and whether a client-specific
  copy already exists. What the schema explorer's third rail section, *Klanten*,
  lists. The list is **per mapping, not per flag**: a flagged split module
  (Debiteuren, Crediteuren, Contactpersonen, Openstaande posten) has no mapping under
  its sidebar id, so it expands to its variants — `erp-crediteuren-organisatie` and
  `-persoon` — each its own client copy, which is the id the payload view reads it by
  (`_flagged_mapping_ids()`; seeding on flag does the same).
- `GET /api/projects/{projectId}/updateconnectors/{moduleId}` — that module's
  connector schema, read from **this project's own** AFAS test environment
  (`project_environment()`) instead of the template — the whole point of the flag: a
  customer whose environment has drifted from the template is exactly the customer who
  needs to see its own copy. A project with incomplete AFAS credentials answers with
  the same *niet compleet ingesteld* refusal `require_complete()` gives everywhere
  else, naming what is missing.
- `PUT`/`DELETE /api/projects/{projectId}/mappings/{moduleId}` — save or forget that
  project's copy. The connector is resolved server-side the same way the schema fetch
  is (`_module_connector()`), never trusted from the request, so a client file can't
  end up claiming a connector its own module doesn't serve.

A client mapping is a **snapshot**: it starts as whatever the schema explorer's
*Koppeling* builder has on screen when it is first saved for that project+module —
typically the standard mapping, re-opened against the project's own schema and edited
where it differs — and later edits to the standard mapping do not flow into it.
The payload view reads "this project's copy, else the standard one": per variant it
takes `clients/<projectId>/<mappingId>` when that file exists — with the schema from
the project's own AFAS — and the `modules` mapping otherwise
(`useVariantContexts` in `ModulePayloadPanel.tsx`). The send posts the bodies built
there, so it follows the same rule, and the payload view's *Koppeling* (`{}`) button
opens the copy it was built from. The copy wins whether or not the module is still
ticked under *Afwijkende koppelingen* — unticking doesn't delete it, so wipe the copy
(**Opgeslagen versie wissen**) to go back to the standard mapping. Saving through
the page only ever writes what `MappingExport` carries, so anything a file holds
beyond that (a `notes` array, `verifiedAgainst`) is dropped the next time someone
clicks **Opslaan** on it — a gap in the page, not a reason to avoid writing those
fields by hand.

`modules/erp-projecten.json` is the first one written this way — built from the
Conversie tab of `ERP 3_Projecten.xlsx` and AFAS's own OpenAPI schema for `PtProject`,
then cross-checked against a live `GET /api/afas/updateconnectors/modules/PtProject`
(186 fields, 6 verplicht, 3 objects — matched). The schema came from
`AFASSoftware/OASContent` on GitHub rather than that live call directly: the reference
doc's field dictionary had nothing for `PtProject` beyond "zie endpoint-schema" at the
time this mapping was drafted (now filled in, §5.5), and MetaInfo wasn't reachable
from the environment that drafted it. Read the file's `notes` before trusting it
further — `mandatory` follows the **template's** required columns rather than AFAS's
own schema (which is sometimes wrong: it flags only `PrGp` as required, not `PrId`),
and `Projectstatus` (`PrSt`) is left unmapped — the template has no column for it
because it's expected to be a fixed value filled in during mapping, not a template
gap, and Taroen is filling those values in himself.

`modules/hrm-medewerkers.json` (`KnEmployee`) followed, built the same way but with
live MetaInfo actually reachable (1068 fields across the whole tree) — every field
code there is verified against the real schema, not a public-spec fallback.

`modules/erp-artikelen.json` (`FbItemArticle`) is the smallest of the three: six sheet
columns onto six of the connector's 119 fields, root key confirmed to be the connector
name itself (no divergence), the other 113 fields all optional and left unmapped.
`erp-artikelen` (and `erp-contactpersonen`) had no deeltaak at all when this mapping
was made, so it was groundwork rather than something a project could actually import —
since 26-08-2026 both have one (`AR`/`CO` in `Nymbus_Deeltaaktypes`, wired into
`modules.json`, [file-types.md](file-types.md)), so that no longer holds.

Three rules the model carries, worth keeping wherever the mapping ends up living:
the key is the **field** (`objectpad#veldcode`), not the column, because one column
can feed several fields but a field takes one value; **one field has one source**, so a
column and a constant exclude each other; and a column is remembered by **index *and*
header**, so re-reading an edited template re-points every field to the column with its
own name and drops the ones whose column is gone — a mapping pointing at a column that
no longer exists would write the wrong value into AFAS. Fixed values belong to no sheet
and survive any of that.

A fourth, added with grouping: **the key marks a column, but is stored on the field.**
`key: true` sits on a field's source like everything else, yet two fields fed by one
marked column are one part of the key rather than two — a record is identified by the
*values* in the sheet, not by how many AFAS fields they happen to fill, so
`groupShape()` dedupes by column index. It is also the one property that survives
`remapToSheet()` untouched: a re-read template moves a column, it doesn't stop the
column being what identifies the record.

### Reading a connector before you map to it

The shape comes from AFAS, never from memory — `update_connector_metainfo(env, connector)`
answers with every field, whether it is mandatory, its allowed values, the nested objects
and the **root key of the body** (`payload["name"]`, regularly *not* the connector name:
`KnSubjectReaction` → `KnReaction`).

That is also on screen. `/afas/updateconnectors` (admins) lists the UpdateConnectors
**per environment** — *Nymbus* (live, app connector *NymbusConversies*: the dossier and
workflow connectors this tool writes through) and *Modules* (omgeving **38690**, Multiclean,
**live**: the conversion connectors a module's sheet is mapped onto, the template every
customer environment copies). Nothing names a
connector in code: both lists are whatever `metainfo` answers with, so adding one in
AFAS is enough. It shows one as a collapsible tree plus the **payload skeleton** it
describes — the same envelope `afas_envelope()`/`afas_element()` build, narrowed to the
mandatory fields with one toggle. Two endpoints behind it,
`GET /api/afas/updateconnectors[/{group}/{connector}]`, which pass AFAS's answer through
unchanged; the shape and everything derived from it live in
[`lib/afas-schema.ts`](../frontend/src/lib/afas-schema.ts).

The **mapping** made there is one per connector for every customer, because it is made
against the template. A client that needs a different one for a module gets a copy of
its own — see [todo.md](todo.md).

### Seeing the bodies a sheet would send — *Payloads*

A module's page has a second reading of the open sheet, admins only: `?view=payloads`
(the switch beside the filename in `SheetToolbar`, wrapped in `AdminOnly`). It runs the
module's **stored mapping** over the **grid on screen** and shows the resulting AFAS
bodies, one per record, with the column that filled each field beside it.

Nothing is posted anywhere: it is `lib/module-payloads.ts` calling the same
`fieldValues()` + `payloadLines()` the mapping editor already used for its one-row
*Voorbeeld*, once per record instead of once. Two things it adds:

- **It reads the edited grid, not the parsed file.** The hand-off uploads `cellData`,
  so a preview built from the untouched parse would hide exactly the corrections it
  exists to prove.
- **It branches per row.** `MODULE_PAYLOAD_PLANS` maps a module to one or more
  **variants** — a stored mapping plus the cell values that route a row to it — and,
  where there is more than one, the column that decides. Debiteuren is the case that
  forced this: *Organisatie of Persoon* sends an `O` row through `KnSalesRelationOrg`
  and a `P` row through `KnSalesRelationPer`, same sheet, same columns, different
  object underneath, so neither stored file is "the mapping for Debiteuren". A row
  whose discriminator matches nothing is **reported**, not dropped — a row that would
  never reach AFAS is the finding, and this is where it becomes visible before an
  upload rather than after.

The schemas come from the `modules` group (the template environment), the same template
the mapping was made against — asking *this* customer's own AFAS would answer a
different question than the stored mapping does. Two scopes: the whole connector, or
only the fields the mapping fills — the latter is the body as it would really be sent,
via `filterSchema`'s `keepField`, the same hook the editor's *Alleen gevuld* uses.

Grouped modules need no extra configuration: whether several rows are one record is
read off the mapping's own `key: true` columns (*Several rows, one record*, above),
per variant.

**Koppeling** in that header opens this connector's mapping **in a dialog**
(`UpdateConnectorsDialog`) — the same `UpdateConnectorExplorer` the page at
`/afas/updateconnectors` renders, given an `onClose` instead of a back-link and seeded
to the connector on screen (`?connector=`, built by `updateConnectorsPath()`). The
sidebar's own *Updateconnectors* row opens that same dialog, without a seeded
connector. Two reasons it is a dialog and not a navigation:
the mapping is opened to explain the payload behind it, so the payload has to still be
there when it closes; and leaving the module page would unmount the uploader, drop the
workbook and raise the leave prompt over a sheet nobody is leaving. It is the real
explorer, not a reduced copy, so the two can't drift — inside a dialog its only
`GuardedLink` (the back-arrow) is replaced by the close button, so it performs no
navigation at all.

### Custom modules (maatwerk) — a third step after a standard module

Some clients carry fields no other client has — AFAS **vrije velden** (`U…` codes) on
the employee, say — and those columns sit in the very sheet they send for the standard
module. A **custom module** writes them: the parent's own connector, **after** the
parent's own steps, as one **PUT per record the parent created**. Medewerkers' phases
1 (*Historie*) and 2 (*Livegang*) stay identical for every project; only a project
with a custom module gets this third call.

**Where it starts.** *Projectinstellingen → Maatwerk* (admins): a name and the module
it follows (only modules with a payload view are offered, since that view is where the
step lives). The backend fixes the connector to the parent's standard one
(`_module_connector()`) — never sent by the browser — so a parent without a standard
mapping is a 400. The id is `<parent>--<slug>`.

**Where it is stored.** Two files, both conversion config and neither secret:

| What | Where |
|---|---|
| The definition — id, label, parent, connector, who added it | `backend/json_files/custom_modules.json`, project id → list |
| Its field mapping | the `clients` group of `field_mappings`, under `<projectId>`/`<customModuleId>` — same place and format as an *Afwijkende koppeling* |

Not in the Fabric `project_settings` table: it holds nothing secret, it belongs next to
its mapping, and it needed no schema change. Removing a custom module removes its
mapping too.

**Where it is visible.** A *Maatwerk* group in the sidebar, under HRM/ERP, admins only
(`CustomModuleGroup`). Each entry links to its **parent** module's payload view with its
own step open — `/{project}/{parent}?view=payloads&stap=<id>` (`payloadStepPath()`) —
because a custom module has no sheet of its own: it builds from the sheet already open
under the parent. The dot is green once a mapping is saved, grey before; there is no
deeltaak, so no AFAS status and no percentage. There it is **its own module**: the
payload view shows only its bodies and its send, without the parent's phase toggle
(Historie · Livegang) — the parent's view in turn never lists it. The sidebar is the way
between the two.

**What it deliberately is not.** No rule set, no help article, no codetabel checks — it is
a one-to-one mapping of columns and fixed values, and the mapping editor already
type-checks a fixed value. No upload and no dossieritem either.

**The mapping** is made in the UpdateConnector explorer's client section (the rail marks
custom modules with a puzzle icon), or straight from the step: *Koppeling maken* opens the
same explorer in a dialog on that entry. Its schema is read from **this project's own**
AFAS (`GET /api/projects/{id}/updateconnectors/{customModuleId}`, test stage), since the
fields it exists for are exactly the ones the template environment lacks. Map the key
(`EmId` from *Medewerker*) plus the vrije velden — nothing else, since a PUT writes
whatever it carries.

**The send** goes through the ordinary `POST /api/afas/payloads/send` under the custom
module's own id, and the backend narrows it (`send_payloads()`):

- no stored mapping yet → 400;
- any record with `action: "insert"` → 400 — an insert here would create a second
  employee holding nothing but vrije velden;
- a connector other than the custom module's own → 400;
- every `update` is re-checked against the **parent's** existence lookup
  (`_verified_verbs(env, parent, …)`), so an employee phase 1 never created fails the
  whole request before a single call goes out.

The body carries no `@Action`: a phase-2 PUT adds `@Action: insert` to nested objects to
add dated records beside phase 1's, but a custom module *updates* the fields it names.
Its run is its own (`SendRunProvider` keyed by the custom id), and *Verwijderen* is never
offered on it — deleting would remove the parent's record, not the fields.

**Not yet verified against AFAS** (27-09-2026): where the vrije velden sit in
`KnEmployee` — the root `AfasEmployee` `Fields` or a nested object — has to be read from
the project's own schema (`update_connector_metainfo`) when the first mapping is made.

## Codetabellen (codetabel checks)

A **codetabel** is a reference table in AFAS holding the values a column is allowed to contain — landen, woonplaatsen, nationaliteiten, betaalvoorwaarden. A column opts in from its rule set ([file-types.md](file-types.md#rule-sets)):

```jsonc
{ "check": "codetabel", "tableRef": "Nationaliteiten", "message": "Ongeldige nationaliteit" }
```

The value must match an entry's **`code`**, compared case-insensitively (AFAS codes are upper case, customer sheets are not).

**They come from the customer's own live AFAS**, per project — never from a snapshot in this repo. That is the whole point: a nationaliteitentabel is a *vrije tabel* and a betaalvoorwaardentabel is set up per administratie, so "the codetabel" only ever means "this customer's codetabel".

Two tiers, resolved by `resolve()` in [`codetabellen.py`](../backend/codetabellen.py), and reported as `source`:

| `source` | Where from | When |
| --- | --- | --- |
| `client` | the project's own live AFAS | normal case — the table the import will actually hit |
| `nymbus` | Nymbus's live environment | the client's couldn't answer. **Seam only today**: the `ALG_*` connectors aren't installed there yet, so this tier falls through until they are — no code change needed then |
| `none` | nowhere | neither answered. There is no table, so **the check is skipped** |

**There is deliberately no bundled-snapshot tier.** The four exports that used to sit in `codetabellen/` were deleted: a snapshot stops tracking reality the day it is pasted in, and for a table that is inrichting per administratie it is wrong in *both* directions at once. Judging a sheet against that is worse than not judging it, so `none` means the column is left unchecked and the UI says so (a *niet gecontroleerd* badge in the help drawer). `checkCodetabel` in [`engine.ts`](../frontend/src/lib/validation/engine.ts) guards this with `codetabelIsLoaded()` — without it an absent table would mark **every** value in its column wrong, which is the worst of the three possible answers.

| Key | Connector | What a cell must be |
| --- | --- | --- |
| `Landen` | `ALG_Landen` | an AFAS country code — **not ISO**: België is `B`, Duitsland `D`, Afghanistan `AFG` |
| `Woonplaatsen` | `ALG_Woonplaatsen` | an official place name, scoped by country (see below) |
| `Nationaliteiten` | `ALG_Nationaliteiten` | a nationality code — `NL`, `B`, `000` (onbekend), `499` (staatloos) |
| `Betalingsvoorwaarden` | `ALG_Betaalvoorwaardes` | a betaalvoorwaardecode — `30`, `AI`, `C` |
| `Caos` | `ALG_CAO` | a cao code as set up for this employer — pure inrichting, no standard set |
| `Arbeidsvoorwaarden` | `ALG_Arbeidsvoorwaarden` | an arbeidsvoorwaardecode, **scoped by cao** (see below) |
| `Administraties` | `ALG_Administraties` | a financiële administratie — `01`, `02`. **Numeric**: `1` matches `01`, see below |
| `Werkgevers` | `ALG_Werkgevers` | a werkgevercode — `01`, `02`. **Numeric**, like `Administraties`; also the scope `Functies` narrows on |
| `Functies` | `ALG_Functies` | a functiecode, **scoped by werkgever**. **`numericScope`**: werkgever `1` narrows to `01`'s functies (`codetabelScopeKey` in store.ts) |
| `Organisatie-eenheden` | `ALG_Organigram` | an organisatie-eenheid out of the organigram — `MDW-FIN`, `BL-SCH` |
| `Grootboekrekeningen` | `ALG_Grootboekrekeningen` | a **verzamelrekening** — `1400` (Debiteuren), `1600` (Crediteuren). Not the whole grootboek |
| `Projectgroepen` | `ALG_Projectgroepen` | a projectgroep out of the projectgroepenregister — `SO`, `GB`, `ALG` |
| `Dienstbetrekkingen` | `ALG_Dienstbetrekkingen` | a dienstbetrekkingcode, **scoped by cao** |
| `Verlofsoorten` | `ALG_Verlofsoorten` | a verlofsoortcode — `W2025` wettelijk, `B2025` bovenwettelijk, `BV`, `OV`. AFAS scopes it by cao **and** arbeidsvoorwaarde; registered **flat** because the sheet has neither column, see below |
| `Items` | `ALG_Items` | an artikel-, kostensoort- of werksoortcode an offerteregel points at — `SK0001`, `VV`, `D001`. Flat, **not** scoped by *Type item*, see below |
| `Abonnementtypes` | `ALG_TypeAbonnement`, else `ALG_Abonnementtypes` | an abonnementtype — `SO`, `GB`, `VO`, `SR`, `GR`. **Two connectors, one table**; see below |
| `Cycli` | `ALG_Cycli` | a factureringscyclus — `M1` maand, `M3` kwartaal, `J1` jaar, `M6`, `W4` |
| `Artikelen` | `ALG_Items`, cut to `Type = Artikel` | an **artikelcode** — the abonnementsregel's item. Same connector as `Items`, narrowed; see below |
| `Periodetabellen` | `ALG_Periodetabellen` | an HRM-periodetabel — `5` Maand HRM, `6` 4 weken HRM, `18` Jaar Verlof HRM. **Numeric**, and the only key **no rule references**; see below |
| `Automerken` | `ALG_Automerken` | the merk of a leaseauto (`HrMobility#ViMr`) — `1` Opel, `2` Volkswagen. The sheet holds the code; a name resolves to it |
| `Automodellen` | `ALG_Automodellen` | the model of a leaseauto (`HrMobility#ViMd`) — a body type, `1` Hatchback … `7` SUV, not a model of a merk, so unscoped |
| `Leasemaatschappijen` | `ALG_Leasemaatschappijen` | the leasemaatschappij of a leaseauto — an instantie, `1000111` Athlon, or a short code like `L`. The sheet holds the code; a name resolves to it |

Field names per connector, read off `metainfo/get/<connector>` and **not** guessed — note that no two agree, and none of them is the `Naam` the Excel exports use, which is why every table declares its own mapper:

| Connector | Fields | Rows (first customer) |
| --- | --- | --- |
| `ALG_Landen` | `Code` + `Land` | 256 |
| `ALG_Woonplaatsen` | `Land` + `Landnaam` + `Woonplaats` | 29 255, over 204 countries |
| `ALG_Nationaliteiten` | `Code` + `Nationaliteit` | 210 |
| `ALG_Betaalvoorwaardes` | `Code` + `Betaalvoorwaarde` | 9 |
| `ALG_CAO` | `Code` + `CAO` | 2 |
| `ALG_Arbeidsvoorwaarden` | `Code` + `CAO` + `Arbeidsvoorwaarden` | 6, over 2 cao's |
| `ALG_Administraties` | `Code` + `Administratie` | 2 |
| `ALG_Werkgevers` | `Code` + `Werkgever` | 2 at 501372; absent at 501281, 501282, 501342 as of 07-10-2026 |
| `ALG_Functies` | `Werkgever` + `WerkgeverNaam` + `Functie` + `Omschrijving` | 60, over 1 werkgever |
| `ALG_Organigram` | `Code` + `OE` | 30 |
| `ALG_Grootboekrekeningen` | **`Rekeningnummer`** (labelled `Code`) + `Grootboekrekening` | 2 |
| `ALG_Projectgroepen` | `Code` + `Projectgroep` | 6 |
| `ALG_Dienstbetrekkingen` | `CAO` + `Code` + `Dienstbetrekking` | 9, over 2 cao's |
| `ALG_Verlofsoorten` | `CAO` + `Arbeidsvoorwaarden` + `Code` + `Verlofsoort` (+ `Begindatum`/`Einddatum`, unused) | 112, over 6 (cao, arbeidsvoorwaarde) pairs — only **38 distinct codes** |
| `ALG_Items` | `Type` + `Code` + `Item` | 273 — 208 Artikel, 39 Werksoort, 20 Kosten, 6 layout rows |
| `ALG_Abonnementtypes` | `Code` + `Abonnement` | 5 at 501281, 8 at 501342 |
| `ALG_TypeAbonnement` | `Code` + `TypeAbonnement` + `Tabel` | 8 — the same table under a newer name; being rolled out to every project |
| `ALG_Cycli` | `Code` + `Cyclus` | 5 — `J1`, `M1`, `M3`, `M6`, `W4`; being rolled out to every project |
| `ALG_Periodetabellen` | `Code` (an **`int`**) + `Periodetabel` | 3 at 501342 — `5` Maand HRM, `6` 4 weken HRM, `18` Jaar Verlof HRM; absent at 501281 |
| `ALG_Automerken` | `Code` + `Merk` | 73 at 501281 (13-10-2026); being rolled out to every live environment |
| `ALG_Automodellen` | `Code` + `Model` | 7 at 501281 (13-10-2026); being rolled out to every live environment |
| `ALG_Leasemaatschappijen` | `Code` (`CmId`) + `Leasemaatschappij` | 5 at 501281 (21-10-2026); absent everywhere else as of that date |

> `ALG_Grootboekrekeningen` is the sharpest argument for reading `metainfo/get` rather than the connector as it appears in AFAS: its first field is **labelled** `Code` but its **id** is `Rekeningnummer`, and the id is what a row is keyed by. A mapper written off the label would have produced a table of empty codes — which, since an empty code is dropped, means an empty table, which makes the check pass silently for every value.

> The country codes being AFAS' own (`B`/`D`, 1–3 letters) is why these columns can't be checked with an ISO-2 regex — that pattern rejected most of the table.

> **Why the snapshots are gone.** Measured against the first customer connected, the bundled betaalvoorwaarden export held six codes they do not use (`120`, `15`, `8`, `AI30`, `CONT`, `INC.`) and missed two they do (`7`, `C`) — it would have accepted invalid codes *and* rejected valid ones. The woonplaatsen snapshot covered NL only (3260) where the live table carries 204 countries: a misspelled Belgian town passed on the snapshot and is caught live. A copy that wrong is not a safety net, which is why the chain ends at `none` rather than at a bundled file.

**Scoped tables** — a woonplaats is only valid inside its country, so entries carry a `scope` (their `Land`) and the rule names the column holding it:

```jsonc
{
  "check": "codetabel",
  "tableRef": "Woonplaatsen",
  "scopeColumn": "Land (Adres)", // the row's country decides which entries count
  "scopeDefault": "NL",          // used when that column is empty or absent
  "message": "Onbekende woonplaats voor dit land"
}
```

Four tables are scoped today — meaning a rule names a `scopeColumn` against them — for three different reasons. (`Items` carries a `scope` too, but no rule reads it; it exists only so the picker can show the item's type, see below.)

| Table | `scope` is | Why |
| --- | --- | --- |
| `Woonplaatsen` | the entry's `Land` | place names *are* near-unique, but the table covers 204 countries — without the scope, a Dutch town would be accepted on a Belgian address |
| `Arbeidsvoorwaarden` | the entry's `CAO` | the codes are **not unique across cao's**, so the scope is what makes the check correct at all rather than merely stricter |
| `Functies` | the entry's `Werkgever` | a functie is set up per werkgever. The first customer has one, so nothing changes there yet — declared because an uncovered scope passes, making it free insurance for a project with two |
| `Dienstbetrekkingen` | the entry's `CAO` | the scope genuinely **narrows**: at the first customer cao `Basis` allows only `O` and `V`, so five of the seven codes are invalid under it while valid under cao `SG` |

That second case is worth spelling out, because it is the one a flat code list gets *wrong* rather than lenient. At the first customer, `KT` is an arbeidsvoorwaarde under cao `SG` and `1` is one under cao `Basis`; a row pairing cao `Basis` with voorwaarde `KT` uses two codes that both exist and still cannot be imported. Checking the value alone would pass it. So `Arbeidsvoorwaarden` names `scopeColumn: "Cao"`, and the `Cao` column carries its own `codetabel` check against `Caos` — the two are checked as a pair:

```jsonc
{ "check": "codetabel", "tableRef": "Caos", "message": "Onbekende cao voor deze werkgever" },
{
  "check": "codetabel",
  "tableRef": "Arbeidsvoorwaarden",
  "scopeColumn": "Cao",              // this row's cao decides which entries count
  "message": "Onbekende arbeidsvoorwaarde voor deze cao"
}
```

One consequence of the pair, and the intended one: when the **cao itself** is misspelled, the table holds no entries for that scope, so the arbeidsvoorwaarde is left unchecked and only the cao is flagged. Reporting both would blame the arbeidsvoorwaarde for the cao's typo; once the cao is corrected the voorwaarde is judged against the right scope on the next run.

Both HRM modules (`hrm-medewerkers`, `hrm-uitzendkrachten`) carry exactly this pair. They previously disagreed — medewerkers had a hardcoded `enum: ["SG", "SPAAR", "KT"]` on both columns and uitzendkrachten only on `Cao` — and that enum was the first customer's own inrichting, which **rejected one of their own two cao's** (`Basis`) and four of their six arbeidsvoorwaarden. It was the betaalvoorwaarden mistake in a second place: wrong in both directions, for every customer including the one it was copied from.

**When a table AFAS scopes is registered flat — `Verlofsoorten`.** Not every scoped table can be checked as one. `ALG_Verlofsoorten` is the most strongly scoped table in the registry: it describes itself as *"Arbeidsvoorwaarde/verlofsoort"*, carries `CAO` + `Arbeidsvoorwaarden` next to the code, and answers 112 rows over six (cao, arbeidsvoorwaarde) pairs for only **38 distinct codes** — 24 of which appear in more than one scope. By the `Arbeidsvoorwaarden` argument above it is a prime candidate for `scopeColumn`.

It is registered **flat** anyway, because `hrm-verlofsaldo` has no column to narrow on: the sheet holds Medewerker, Type Verlof, Boekjaar, Datum Boeking and Saldo, and `scopeColumn` can only name a column **in the same row** — the medewerker's cao lives in the *hrm-medewerkers* sheet, which the engine validates independently. And here the fallback behaviour decides it: since a scope the table holds no entries for **passes** (next paragraph), declaring a scope the frontend cannot supply would not be stricter-but-incomplete — it would wave through *every* value in the column. A flat check is the stricter of the two.

Flat still catches what actually goes wrong on this column: a stale year code (`W2024` on a 2025 saldo), a misspelling, a code from another customer. What it cannot catch is a code valid under some other cao than this medewerker's — which needs the medewerker's cao, i.e. employee data read from AFAS rather than from a sibling sheet. So the rule of thumb is not "scope it if AFAS scopes it" but **scope it if the sheet carries the scope**; otherwise flat, and say in the rule set why.

**A second reason to register flat — a vocabulary mismatch (`Items`).** `Verlofsoorten` above is flat because the sheet lacks the scope column. `ALG_Items` is flat for a sharper reason: the sheet *has* the column and it still cannot be used. `erp-voorcalculatie` carries *Type item* as an enum of `Art`/`Kst`/`Sam`/`Wst`, while the connector's own `Type` answers `Artikel`, `Kosten`, `Werksoort`, `Tekst`, `Subtotaal`, `Toeslag`, `Artikeldimensietotaal`. A `scopeColumn: "Type item"` would compare `Art` against scope `Artikel`, match nothing, and — since a scope the table holds no entries for **passes** — quietly switch the check off for every row in the sheet. Two vocabularies for the same concept need a translation layer, and there is no place in a rule to declare one; until there is, flat is both simpler and stricter. (The connector also has no `Samenstelling` rows at all, though the enum offers `Sam`, so a scoped check could not judge that type even in principle.)

Flat costs nothing here because the codes are effectively unique across types anyway: 269 distinct codes in 273 rows, and the only one appearing under more than one `Type` is `*****`, a layout placeholder. The `Type` is still carried as each entry's **`scope`** so the picker can show it — with no `scopeColumn` on the rule the engine never reads it (`engine.ts` goes straight to `codetabelHasCode`), so that is display-only and changes no verdict. The general rule: **scope it if the sheet carries the scope *in the table's own vocabulary*** — otherwise flat, and say why in the mapper.

> `ALG_Items` also retired a long-standing worry rather than confirming it. An itemcode is case-sensitive in AFAS, so the store's case-insensitive matching looked wrong for this column — but the live table holds **zero** codes differing only by case, so it cannot produce a wrong verdict, and no per-table opt-out was added. That is a measurement about one customer's data, not a property of the column: a table that does contain such a pair would want an opt-out beside the existing `numeric` opt-in.

**One connector, two keys — a fixed narrowing (`Artikelen`).** `erp-abonnementen`'s *Artikel* column is checked against `Artikelen`: `ALG_Items` cut to the rows whose `Type` is `Artikel`. It is a **second registered key on the same connector**, not a `scopeColumn` on `Items`, because the narrowing is fixed rather than per row — every abonnementsregel is an artikel by construction (`erp-abonnementen.json` maps `VaIt` as a fixed `2` = Artikel and feeds `ItCd` from this column), so there is no column for a scope to resolve against. The filter lives in the **mapper**: a row of another type is mapped to `{}`, and `_entries()` drops any row it gets no code for, so the other types never reach the table, the index or the value picker. The caches don't collide — the cache key is `(omgevingnummer, stage, key)`, so `Items` and `Artikelen` keep separate copies of the one fetch (74 vs 11 entries at 501342, 273 vs 208 at 501281).

This is the narrowing `Items` above explains it *cannot* do for `erp-voorcalculatie`, and the difference is worth being precise about: there the scope would come from the sheet's own `Art`/`Kst`/`Wst` vocabulary, which doesn't match AFAS's `Artikel`/`Kosten`/`Werksoort` and would silently switch the check off. Here nothing is read off the sheet at all — the type is a constant in the mapper — so that failure mode can't arise. **Scope from the sheet needs the sheet's vocabulary to match; a fixed filter needs nothing from the sheet.**

The narrowing is not cosmetic. At 501342 four codes — `VO`, `SP`, `GBL`, `SOL` — exist under both `Artikel` and another `Type`, so the flat table passes a werksoortcode in the `Artikel` column; measured end to end, flat reports 3 errors on a test sheet where the narrowed table reports 4, the extra one being `TO` (Tijd voor tijd opname, a werksoort) sitting in an artikelkolom.

> **This corrects an earlier entry here**, which said *Artikel* must stay unchecked because AFAS wants an **abonnementsartikel** ("met aanschaf" / "zonder aanschaf") and `ALG_Items` holds ordinary ones — evidenced by "none of the five abonnementtype codes appears in `ALG_Items`". That evidence compared the wrong two things: abonnement**typen** (`ALG_Abonnementtypes`, what *Type Abonnement* names) against item codes (what *Artikel* names). They are different columns pointing at different tables, and the code sets overlapping at 501342 (`SO`, `GB`, `VO`, `SR`, `GR` are both) is what made the confusion easy. The `abonnementsartikel` requirement itself is real but is a **property of the artikel's inrichting in AFAS**, not a separate table this tool can read — so the check catches codes that don't exist or are the wrong `Type`, and AFAS still has the last word on whether an existing artikel is set up as an abonnementsartikel. That is a narrower check than none, not a wrong one. Before pointing a column at a table because the names align, confirm the table holds *that* column's set — and before ruling one out, confirm the counter-evidence is about that column too.

Three cases deliberately **pass** rather than flag: **no table at all** (`source: "none"` — see above), an empty scope with no `scopeDefault` (without a country there's nothing to compare against — the country column has its own rules), and a scope the table holds no entries for (a table covering only NL shouldn't flag every Belgian town). Use `scopeDefault` only where an empty country really means that country (the ERP modules document "leeg = NL").

**Zero-padded codes (`numeric`)** — AFAS writes the administratiecodes as `01` and `02`, while all three sheet columns holding one are typed `integer` and Excel strips a leading zero from any numeric cell as a matter of course. A correct sheet therefore arrives carrying `1`, and comparing strictly would flag the whole column red over formatting — the wrong-verdict failure the codetabellen exist to prevent. A table declares its way out of that:

```ts
registerCodetabel("Administraties", { numeric: true, picker: … });
```

`normalizeCode()` in [`store.ts`](../frontend/src/lib/validation/codetabellen/store.ts) then strips leading zeros from **both** sides when the code is entirely digits, so `1` ≡ `01` while `03` and `3` are still flagged and `AI30` / `1.5` are untouched. It is **opt-in per table**, not the default: a code table whose codes merely *look* numeric may genuinely distinguish `01` from `1`, and equating them everywhere would be a guess dressed up as leniency. The upload is unaffected either way — what goes to AFAS is the mapped payload, not the cell as typed.

**The value picker** — a cell a codetabel rejected doesn't only get flagged: it carries a small button in its top-right corner that opens the table itself, searchable, and writes the picked entry into the cell. It is offered for `codetabel` errors alone, since this is the one check whose answer the tool already holds. Two things make it work:

- The failed check puts the table on the issue — `Issue.tableRef`, plus `tableScope` for a scoped rule (the row's resolved land). The engine records the scope it judged the cell against, so the picker offers exactly that narrowed table.
- **Repeated rows are collapsed for display.** A connector may answer with the same value several times over — `ALG_Dienstbetrekkingen` first returned 21 rows for 9 distinct (cao, code) pairs, from a join a level below the dienstbetrekking — which would have offered *Vaste medewerker* five times under cao `SG`. The picker dedupes on code **plus** scope, so a code valid under two cao's survives in both. The store deliberately keeps every row as AFAS sent it (its indexes are `Set`s, so a duplicate never changed a verdict); collapsing belongs at the point of display, where a repeat is a defect rather than data.
- Each table declares how it is shown, next to its fallback in `sources.ts`: `picker: { columns: [{ label, field }, …] }`, where `label` is the AFAS table's own field name and `field` is the `CodetabelEntry` part it shows. Both columns are searchable. A pick always writes the entry's **`code`** — the field the check compares — which is why the woonplaatsen table declares `Woonplaats` on `code` and `Land` on `scope`. A table without a `picker` falls back to `Code` + `Omschrijving`.

UI detail in [design-system.md](design-system.md#25-core-ui-elements).

**Backend** — [`codetabellen.py`](../backend/codetabellen.py) owns the registry and the fetching; [`main.py`](../backend/main.py) owns the routes. A table is declared once with its connector, its row mapper and a stable `order_by`:

```python
_register("Landen", "ALG_Landen",
          lambda row: {"code": row["Code"], "omschrijving": row["Land"]},
          order_by="Code")
```

- `GET /api/projects/{project_id}/codetabellen/{key}` → `{ entries, count, source, environment, message, fetchedAt }`. Requires a session **and** access to the project (`_require_project_access`), and resolves the client environment with `project_environment(project_id, AfasStage.LIVE)` — always live, because that is the environment the conversion lands in. Unknown key → `404`.
- A table nobody can serve is **not** an HTTP error: the route answers `200` with `source: "none"`, no entries and AFAS's own Dutch reason, since a project mid-setup is a normal state. `source` is `client` or `nymbus` otherwise.
- `POST /api/projects/{project_id}/codetabellen/{key}/refresh` (admin only) drops the cached copy **of both tiers** — refreshing only the client's would leave a stale stand-in for exactly the project whose own table just started working. Called from the sheet's settings modal (**Codetabellen verversen**, admin-only) for every table the module needs, which then also clears the page's own once-per-load cache (`refreshCodetabellenForModule` in `registry.ts`) and re-validates — a page reload alone just gets the backend's stale copy back.
- **The cache is keyed by `(omgevingnummer, stage, key)`** with a one-hour TTL — by *environment*, not by project, so two projects on one AFAS share a copy and no project is ever served another's table.
- `paged=True` on a table fetches it with `get_all_rows` instead of one call, for a table over AFAS's columns × rows ≤ 150.000 guidance. None needs it yet: woonplaatsen is ~88k cells and returns in well under a second.

**Frontend** — codetabellen live in [`lib/validation/codetabellen/`](../frontend/src/lib/validation/codetabellen/):

- `store.ts` — the live `CODETABELLEN` map plus the lookups the engine's `codetabel` check uses (`codetabelHasCode`, `codetabelCoversScope`, `codetabelHasCodeInScope`). Setting a table also (re)builds an upper-cased index per table, so a 29.000-entry table costs one `Set` lookup per cell instead of a scan.
- `registry.ts` — `registerCodetabel(key, { endpoint?, staticOnly?, picker?, numeric? })`, plus `ensureCodetabel(projectId, key)` / `ensureCodetabellenForModule(projectId, moduleId)`, which fetch a table **once per project per session**. The dedupe keys are `<projectId>:<key>`, so opening another project fetches its own tables rather than reusing the previous customer's. `sourceOf(key)` reports `"client"` / `"nymbus"` / `"none"` — what the UI shows; `undefined` means nothing has been attempted yet, deliberately distinct from `"none"`. A `"none"` outcome is logged as a **warning**, not an error: the check degrades to "not checked" rather than to a wrong verdict, and a `console.error` would pop the Next dev overlay for a project that simply isn't configured yet. It is also **not** marked loaded, so a project whose credentials are filled in later gets a real table on the next visit. `staticOnly` is for a table with no connector yet: nothing is fetched at all.
- `sources.ts` — the one place codetabellen are declared: a key, and how the picker shows it. Nothing is bundled and nothing is seeded, so a table holds only what an AFAS environment answered with.

The tables a module needs are **derived from its rules** (`codetabelKeysForModule`). [`CodetabellenProvider`](../frontend/src/components/CodetabellenProvider.tsx) watches the active module (`useModule`) and project (`useProject`) and fetches that module's tables when either changes — each once per project.

**Adding a codetabel** — three edits, all keyed by the same `tableRef`:

1. `_register("<key>", "<Connector>", mapper, order_by=…)` in [`codetabellen.py`](../backend/codetabellen.py). Confirm the field names with `get_connector_metainfo()` first; don't guess them. Skip this and pass `staticOnly: true` below while the connector is unknown.
2. `registerCodetabel("<key>", { picker })` in [`sources.ts`](../frontend/src/lib/validation/codetabellen/sources.ts). The `picker` is what the user picks a valid value from — name its columns after the table's own fields. No fallback file: an unserved table is skipped, not guessed.
3. `{ "check": "codetabel", "tableRef": "<key>" }` on the column in the module's rules.

> **A codetabel nothing validates against: `Periodetabellen`.** Every other key above is a column's `tableRef`; this one fills the *Periodetabel HRM* dropdown in the project settings dialog ([`ProjectSettingsDialog.tsx`](../frontend/src/components/ProjectSettingsDialog.tsx)), whose value is written onto the project's **hoofdproces dossieritem** (`PtId`) rather than into a sheet cell. So it skips step 3 above, and `codetabelKeysForModule` never yields it — `CodetabellenProvider` will not fetch it, and the dialog asks for it by name with `ensureCodetabel(projectId, "Periodetabellen")`.
>
> It also **falls back differently**, and deliberately. A `codetabel` check with no table *skips* — judging a column against an empty list would flag every value in it — but a dropdown with no options can't be used at all, so when no environment answers, the dialog falls back to the two values hardcoded in [`conversion-settings.ts`](../frontend/src/lib/conversion-settings.ts) (`5` maandelijks, `6` vierwekelijks). Those two are not an arbitrary pair: they are the only ones `herhalenNa()` derives *Herhalen na* from ([`standard-columns.ts`](../frontend/src/lib/standard-columns.ts)), so the degraded list is still a form that fills every column it promises to. 501281 is in exactly that state today.
>
> Reading the real table is what surfaced `18` (Jaar Verlof HRM) at 501342 — a genuine periodetabel the hardcoded pair does not know. It is offered and saved like any other; the field's hint then says *Herhalen na* stays empty, since the tool has no confirmed answer for it. The value belongs to AFAS, not to what this tool happens to derive from it.

**Is the connector actually there?** A codetabel only checks anything in an environment that has its connector, and that is per customer and changes as `.gcn` files are imported. `backend/scripts/check_codetabel_connectors.py` sweeps every configured project and says which connectors are missing where — run it with no arguments for the whole registry (`alternatives` included), or name the connectors you just imported:

```
cd backend && python3 scripts/check_codetabel_connectors.py ALG_Cycli ALG_TypeAbonnement
```

A missing connector is not a failure — the check degrades to *niet gecontroleerd* — so this reports rather than errors.

The **key** (frontend `tableRef` + URL path) and the **connector** (backend-only) are decoupled — only the key is shared across the stack, which is why `Betalingsvoorwaarden` can sit on `ALG_Betaalvoorwaardes` without either side renaming.

**One table, several connector names (`alternatives`).** An environment set up at a different time may publish the same codetabel under a different connector name. `_register` therefore takes `alternatives=((connector, mapper), …)`, tried in order after the preferred one, **each with its own mapper** — a rename usually renames the description field too:

```python
_register("Abonnementtypes", "ALG_TypeAbonnement",
          lambda row: {"code": row["Code"], "omschrijving": row["TypeAbonnement"]},
          order_by="Code",
          alternatives=(("ALG_Abonnementtypes",
                         lambda row: {"code": row["Code"], "omschrijving": row["Abonnement"]}),))
```

`fetch()` takes the first candidate that answers with usable rows and caches under the **key**, so the fallback costs one extra call only in the environments that need it, and only until the TTL. Traced live: 501342 stops at `ALG_TypeAbonnement` (8 entries), 501281 tries it, gets *"Connector ALG_TypeAbonnement bestaat niet"*, and falls through to `ALG_Abonnementtypes` (5 entries).

This is for **one table under two names**, not a fallback to a different table — the two must be interchangeable, which is worth confirming rather than assuming: these two answer the same codes with the same descriptions at the environment that has both. Preferring the newer name *without* the fallback would have switched the check off at every customer that hasn't been migrated, which is the failure this mechanism exists to prevent.

> **The Nymbus tier is wired but not yet live.** Nymbus's **live** environment carries only the 10 `Nymbus_*` connectors today — the `ALG_*` codetabellen are to be added there, and `resolve()` already tries them under the same names, so that tier starts working the moment they exist with no code change. Nymbus's **test** environment carries an older `DV_*` set (`DV_Landen`, `DV_Woonplaatsen`, `DV_Debiteuren`, `DV_Crediteuren`, `DV_Grootboekrekeningen`, `DV_kostenplaatsen`, `DV_kostendragers`, `DV_Items`, `DV_Administraties`, `DV_Projecten`, `DV_Projectgroepen`, `DV_Abotype`, `DV_Frequentie`, `DV_Activagroepen`), which is **not** used as a fallback and could not serve as one: `DV_Woonplaatsen` has a single column and **no land**, so it cannot feed the scoped woonplaats check, and `DV_Landen` names its fields `Landcode`/`Co`.

## Error handling

- Surface AFAS errors per row; do not fail the whole batch silently.
- Decide and document batch semantics (all-or-nothing vs. best-effort) once the connector behavior is confirmed.
