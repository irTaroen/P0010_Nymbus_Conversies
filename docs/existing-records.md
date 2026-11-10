# Bestaande records — wat staat er al in AFAS?

The **Payloads** view builds every body a sheet would send. It has never known
whether AFAS already holds the record behind one. So a re-send inserts a duplicate,
or AFAS refuses it, and either way the admin finds out one record at a time after
pressing send.

This is the read that answers it before the send: for the module on screen, ask the
customer's environment which keys it already has, mark each payload accordingly, and
let the admin choose what to do with the two groups. It changes what a send *means* —
from "insert all of these" to "insert the new ones, update the ones that exist".

It is a **payload-side** feature. The `CON_ERP_*` connectors it reads are not
codetabellen and must not be registered as one: a codetabel judges a *cell* against a
closed set of valid values, while this judges a *record* against what exists right
now. A debiteurnummer that isn't in AFAS yet is the normal case here and an error
there. See [afas-integration.md](afas-integration.md#codetabellen-codetabel-checks)
for the other kind.

## 1. The connectors

### The ERP set

Eight `CON_ERP_*` GetConnectors exist at the first customer (env 38690, probed
08-09-2026). They are deliberately thin — a key plus enough to recognise the record
by eye — because that is all this feature reads:

| Connector | Fields (**id**, not label) | Rows |
| --- | --- | --- |
| `CON_ERP_Debiteuren` | `Debiteur` + `Nummer` + `Naam` | 8 |
| `CON_ERP_Crediteuren` | `Crediteur` + `Nummer` + `Naam` | — |
| `CON_ERP_Projecten` | `Project` + `Project_naam` + `Debiteur_nummer` | 5 |
| `CON_ERP_Voorcalculatie` | `Offerte` + `Regelnummer` + `Omschrijving` + `GUID` | — |
| `CON_ERP_Abonnementsregel` | `Abonnement` + `Regelnummer` + `Debiteur` + `Project` | 0 |
| `CON_ERP_FinAdministratie` | `Organisatie` + `Debiteur` + `Crediteur` + `Naam` | — |
| `CON_ERP_FinMutaties` | `Rekeningnummer` + `BoekstuknummerAFAS` + … | — |
| `CON_ERP_Verstrekking` | `Contact_ID` + `Rapport_ID` | — |

> **Read the id, never the label.** `CON_ERP_Projecten`'s second field is id
> `Project_naam` but *labelled* `ProjectNaam`, and `CON_ERP_Voorcalculatie`'s
> `Omschrijving` is *labelled* `Project`. This is the `ALG_Grootboekrekeningen` trap
> again (id `Rekeningnummer`, label `Code`) — and here it fails in the dangerous
> direction: a mapper reading the label yields blank keys, every payload looks new,
> and the send inserts a full set of duplicates.

Three of the eight (`FinAdministratie`, `FinMutaties`, `Verstrekking`) have no module
whose payloads they'd mark, so they get no plan entry yet — listed here so the next
person knows they exist rather than re-probing.

### The HRM set

Five `CON_HRM_*` followed (same environment, probed **live**, 09-09-2026):

| Connector | Fields (**id**) | Rows live | Registered |
| --- | --- | --- | --- |
| `CON_HRM_Medewerker` | `Medewerker` + `MedewerkerNaam` + `Werkgever` + `BegindatumContract` + `DatumInDienst` + `Functie` + `Periodetabel` | 18 | **yes** — `hrm-medewerkers`, `hrm-uitzendkrachten` |
| `CON_HRM_Wagenpark` | `Medewerker` + `Kenteken` + `BegindatumContract` + `Volgnummer` | 0 | **yes** — `hrm-wagenpark` |
| `CON_HRM_Verlofsaldo` | `Medewerker` + `TypeVerlof` + `Omschrijving` + `SaldoAFAS` + `SaldoOpgenomen` + `Boekjaar` | 88 | no — composite key |
| `CON_HRM_Loonmutaties_Vakantietoeslag` | `Periodetabel` + `Boekjaar` + `Periode` + `Datum` + `Medewerker` + `LC` + `LCNummer` + `LCOmschrijving` + `Waarde1` + `GeboektDoor` | 0 | no — composite key, mostly absent from the sheet |
| `CON_HRM_Looncomponenten` | `Nummer` + `Intern_nummer` + `Looncomponent` + `Stamnummer` + `CAO` | 897 | no — a codetabel, not an existence list |

> **Every field id equals its label in the HRM set.** The `Project_naam`/`ProjectNaam`
> divergence that makes the ERP table above dangerous does not occur in any of these
> five — stated so the next reader does not re-probe to find out. It is a property of
> how these connectors happen to be built, not a rule: read the id anyway.

Three of the five are registered nowhere, and the reasons are the useful part:

- **`CON_HRM_Verlofsaldo`** keys on `Medewerker` + `TypeVerlof` + `Boekjaar`. One
  medewerker holds a saldo per verlofsoort per year — 88 rows over 18 medewerkers
  live, one code repeating six times. Keying `hrm-verlofsaldo` on *Medewerker* alone
  would mark every row of an employee who has any saldo as *Bestaat al* and decline to
  write their other verlofsoorten. `ExistingSource` carries a single `key_field` by
  design; a composite needs that seam widened, in both halves, before this connector
  can be used at all.
- **`CON_HRM_Loonmutaties_Vakantietoeslag`** has the same problem five columns deep,
  and worse: `hrm-vakantietoeslag`'s sheet carries only *Medewerker*, *Bedrag* and
  *Grondslag*, so four of the five key parts are not in the sheet. Widening the seam
  would not be enough — there is nothing to compare them against.
- **`CON_HRM_Looncomponenten`** is not an existence list for any module. It is the
  customer's looncomponent *catalogue* — a closed set of valid values, 897 of them,
  scoped by `CAO`. That makes it a **codetabel** in this app's terms, the other kind of
  read this doc's opening paragraph separates itself from. If `hrm-salarisparameters`
  should check its *Parameter* column against it, that belongs in
  [`codetabellen.py`](../backend/codetabellen.py) with a `codetabel` rule and the
  picker the working agreements require — not here.

## 2. The matching rule, and the trap under it

**Keys are zero-padded in AFAS and unpadded in the sheet.** `CON_ERP_Debiteuren`
answers `07750`; the sheet's *Debiteur Nummer* is typed `integer`, so Excel hands
over `7750`. For `CON_ERP_Projecten` it is not an edge case but the whole table —
every key is `000001`-shaped while *Projectnummer* is `integer`.

Comparing as strings would mark existing records as new and then insert duplicates of
them. So matching normalizes both sides the way the codetabel store already does for
`Administraties` (`normalizeCode` in
[`store.ts`](../frontend/src/lib/validation/codetabellen/store.ts)): trim, upper-case,
and strip leading zeros **when the value is entirely digits**. `07750` ≡ `7750`, while
a key that merely looks numeric elsewhere keeps its own shape.

Unlike the codetabel store this is **not opt-in per table**. There, equating `01` with
`1` everywhere would be a guess about a customer's inrichting. Here every key in scope
is an AFAS record number — a number AFAS pads for display — and the cost of the two
mistakes is asymmetric: a false *new* writes a duplicate into a customer's live
administratie, a false *exists* refuses to write and says so on screen.

## 3. What is compared

One key per module, named in the plan, taken from the **sheet column** rather than
from the built body. The body is nested and connector-shaped; the sheet column is the
thing the admin can see and the thing the rule set already validates.

| Module | sheet column | connector | field | live today |
| --- | --- | --- | --- | --- |
| `erp-debiteuren` | *Debiteur Nummer* | `CON_ERP_Debiteuren` | `Debiteur` | **yes** |
| `erp-crediteuren` | *Crediteur Nummer* | `CON_ERP_Crediteuren` | `Crediteur` | **yes** |
| `erp-projecten` | *Projectnummer* | `CON_ERP_Projecten` | `Project` | **yes** — and deletable, see §7 |
| `hrm-medewerkers` | *Medewerker* | `CON_HRM_Medewerker` | `Medewerker` | **yes** |
| `hrm-uitzendkrachten` | *Medewerker* | `CON_HRM_Medewerker` | `Medewerker` | **yes** |
| `hrm-wagenpark` | *Kenteken* | `CON_HRM_Wagenpark` | `Kenteken` | **yes** |
| `erp-voorcalculatie` | *Offerte* | `CON_ERP_Voorcalculatie` | `Offerte` | **yes** — and deletable, see §7 |
| `erp-abonnementen` | *Abonnement nummer* | `CON_ERP_Abonnementsregel` | `Abonnement` | **yes** — and deletable, see §7 |

`erp-voorcalculatie` and `erp-abonnementen` are the **grouped** modules here. Its connector answers one
row per offerteregel (`Offerte` + `Regelnummer`), while a record in the payload view is
the whole offerte — `KnQuotation` with its regels. Keyed on `Offerte` alone, the regels
collapse into their offerte (`fetch_records()` keeps one entry per key), which is
exactly the payload view's record; the frontend reads the key off the group's first
row, where the kop columns repeat. `order_by` is `Offerte,Regelnummer`, because
`Offerte` alone repeats and would not page stably. `erp-abonnementen` is the same
shape one level over: `CON_ERP_Abonnementsregel` answers per regel (`Abonnement` +
`Regelnummer`), keyed on `Abonnement` and sorted on both. It has no name field, so
the mark shows `Debiteur` — the relatie the abonnement is billed to.

`hrm-medewerkers` and `hrm-uitzendkrachten` share one connector and one key: an
uitzendkracht is a medewerker to AFAS, written through the same `KnEmployee` family,
so there is one list of codes that are taken and both modules read it. Only the `noun`
differs, because the counts and the confirm dialog are read by someone who knows which
sheet they uploaded.

`hrm-wagenpark` keys on *Kenteken* rather than on *Medewerker* — one medewerker can
hold several vervoermiddelen, so the medewerkercode is not the record's identity here.
Its connector answers **0 rows** at this customer today, which is a legitimately empty
environment and not a failure: `fetch_keys` returns an empty dict, every payload is
marked *Nieuw*, and the send inserts. That is the whole point of keeping `{}` and
`None` apart.

**Both halves of the registration have to be there**, and they are deliberately not
symmetrical:

- `backend/existing.py` registers the module → connector + key field, because the
  route is read-only and a registered module that nobody asks about costs nothing.
- `MODULE_PAYLOAD_PLANS` (frontend) names the **sheet column** the key is read from,
  and that half is what switches the feature on for a module. A plan entry without an
  `existing` block keeps the plain behaviour.

They stay separate because they answer different questions — which connector holds the
records, and which column of *this* sheet identifies one — and because a connector can
be registered before any module has a plan that uses it. Both `erp-crediteuren` and
`erp-projecten` spent time in exactly that state: registered in the backend, no
`existing` block, nothing fetched. Adding the block was all it took once they had
plans.

A module without an `existing` block keeps today's behaviour exactly: nothing is
fetched, nothing is marked, the send inserts. That is the default, so adding this to
one module cannot change another.

## 4. Where the state lives

`GET /api/projects/{id}/existing/{module_id}?stage=test|live` → `{ keys, count,
connector, field, environment, stage, fetchedAt }`.

- **Per stage, and never cached across one.** The whole point is "does it exist in the
  environment I am about to write to", so switching the panel's Test/Live toggle
  re-reads. A test environment holding a record proves nothing about live.
- **Keys only.** The route returns the normalized key set, not the records. It is
  cheaper, and it keeps a customer's debiteurenlijst out of a response that only has
  to answer a yes/no per row.
- **Admin-only**, like every other route behind this panel, plus the session's own
  project access.
- **A failed read is not a failed panel.** If the connector isn't installed at this
  customer (`FORBIDDEN` — these connectors are per-customer app-connector entries, and
  a second customer starts with none of them), the panel says the
  check is unavailable and falls back to today's behaviour: nothing marked, send
  inserts. The one thing it must never do is treat "couldn't ask" as "nothing
  exists" — that is the silent-pass trap the codetabellen already taught us, and here
  it would insert duplicates rather than merely skip a check.

## 5. What the admin sees and chooses

Each record row gains one of two marks: **Bestaat al** (with the AFAS name beside it,
so a wrong match is visible) or **Nieuw**. A third state, *niet gecontroleerd*, is
what an unavailable read leaves behind.

**A send updates the marks itself.** Each record AFAS accepts turns *Bestaat al* the
moment its result arrives, read off the run's `results` (only for a run against the
stage on screen). When the run finishes, the key set is re-read for that stage, and
the old marks stay up until the new ones arrive. Where the read works, the early mark
counts for the send too, so *Alleen nieuwe* will not send the record again. A module
with no existence lookup, or one whose read failed, still shows the mark, but only as
a badge: no mode switch is on screen there, so the mark must not quietly take a record
out of the next send.

In the records rail's header, an *Alleen nieuwe* toggle replaces the implicit "send everything":

| Mode | What it sends |
| --- | --- |
| **Alleen nieuwe** (default) | POST for the new records; existing ones are **hidden from the list** and so not sent |
| **Off** | POST for new, **PUT for existing** — the update, not a second insert |

*Alleen nieuwe* is the default because it is the safe half of the choice: it can add
records but never change one that is already there.

## 6. POST vs PUT — what "overwrite" actually is

AFAS's verbs carry the meaning (AFAS-Profit-API-Referentie §4). POST inserts. PUT
updates: only key fields are mandatory, a field left out is left unchanged — **and a
field sent empty is cleared**.

That last clause is the sharp edge, and the reason the mode switch says *Alles* rather
than *Overschrijven*: the body is built from the sheet, so a column the sheet leaves
blank travels as an empty value and PUT will **empty that field in AFAS**, even though
the sheet never meant to say anything about it. On an insert this is harmless; on an
update it can wipe data the conversion was never handling.

The panel therefore states, in the confirm dialog for a run containing updates, how
many records will be updated and that mapped-but-empty columns are cleared. It does
not try to be clever about which blanks are "meant" — the send is already the one
place in this app that shows exactly what leaves, and inventing a rule about blanks
would break that correspondence.

The per-record verb travels **with the record**, decided in the browser from the same
match the admin can see on screen, and is re-checked server-side against the same
existence read — so a stale browser cannot turn an insert into an update or the
reverse.

## 6a. Herstellen — re-sending part of a record

*Alles* updates an existing record with its **whole** body. That's the wrong tool when a
record is mostly right: a medewerker whose salary is missing, or a debiteur whose address
never arrived. The *Herstellen* toggle (`Wrench`, beside *Alleen nieuwe*) is the third mode
for that case ([`repair-send.ts`](../frontend/src/lib/repair-send.ts)):

- **Only records marked *Bestaat al*** are listed and sent. A new record has nothing to
  repair, and one that is *niet gecontroleerd* is not sent at all.
- **A card above the body lists the nested objects** the mapping (and the active phase)
  fills. For each one the admin picks *Overslaan* (left out of the body), *Bijwerken*
  (`"@Action": "update"`) or *Toevoegen* (`"@Action": "insert"`), per
  AFAS-Profit-API-Referentie §4.1. Everything starts as *Overslaan*. The root is always a
  PUT with `@Action: update` on its key. A child of a skipped object is greyed out: AFAS
  nests it inside its parent's `Element`, so it can't travel on its own.
- **Empty fields are never sent** (`withoutEmpty`). The mapping already omits an empty
  cell; this also catches a fill or an override that produced `""`. So unlike *Alles*, a
  repair cannot clear a field.
- **It stacks on the phase.** For `hrm-medewerkers`, *Actueel* + *Herstellen* with
  *AfasSalary = Toevoegen* sends the livegang salary with the phase's date and overrides,
  and nothing else.
- **No backend change.** Every repair record is an `update` with its key, so
  `_verified_verbs()` re-checks it like any other update (§6).

Still to confirm against a test environment: what `@Action: update` on a **dated** object
(a salary on `DaBe`) needs in order to address the existing record and not a new one.

## 7. Deleting what exists

The payload view can also **remove** the records marked *Bestaat al* — the
*Verwijder n uit test/live* button beside the send. Only for a module whose source in
[`existing.py`](../backend/existing.py) carries a `DeleteTarget`, which today is
`erp-projecten`, `erp-voorcalculatie` and `erp-abonnementen`; the existence route says so as `deletable`, and the button
appears only when that is true **and** the read came back (no marks, nothing to
delete).

- **The browser sends keys, nothing else.** `POST /api/afas/payloads/delete` takes
  `{ ordinal, rows, title, kind, key }` per record. The connector, object and key field
  of the DELETE — `connectors/KnQuotation/KnQuotation/QuId/{offerte}`
  (AFAS-Profit-API-Referentie §4.3) — are the `DeleteTarget`'s, so an admin session
  cannot be aimed at another UpdateConnector.
- **Every key is re-checked first**, against a fresh read of the stage it will run
  on. One key AFAS does not hold fails the whole request — the same rule as a stale
  `update` (§6).
- **The URL carries AFAS's spelling of the key**, taken from that read rather than
  from the sheet. The two agree after `normalize_key`, not before: `07750` and `7750`
  match each other, but only `07750` finds the record in a URL.
- **It is a run like a send's** (`payload_send.py`, `operation: "delete"`): the same
  progress strip, stop button, poll route and one-run-per-module lock, so a delete
  cannot overlap a send of the same module. A removed record turns *Nieuw* the moment
  its result lands, and the marks are re-read when the run ends.
- **The confirmation lists the records**, each key with the name AFAS holds under it,
  because afterwards there is nothing left to look at. On **live** the admin types the
  count before the button enables.

`KnQuotation`'s key is `QuId` (*Nummer offerte*, `primaryKey: true` in
`metainfo/update/KnQuotation`). Proven end to end on 23-09-2026 at 38892 (test): a
throwaway offerte `ZZTESTCLAUDE01` was posted, deleted through the route (AFAS answered
200), and gone from `CON_ERP_Voorcalculatie` afterwards, **regels included**. A DELETE
on the kop removes its regels too.

The other two were proven the same way on 28-09-2026 at 38892 (test), through the
route itself:

- **`PtProject` on `PrId`** — `connectors/PtProject/PtProject/PrId/{project}`.
  `metainfo/update/PtProject` flags **no** root field `primaryKey: true` (only its
  `PtProjectStage` subobject carries flags), so the key is the referentie's (§5.5)
  rather than read off the schema. A throwaway `ZZTESTCLAUDE01` was posted, deleted
  (200), and gone from `CON_ERP_Projecten`.
- **`FbSubscription` on `SuNr`** (*Nummer abonnement*, `primaryKey: true`) —
  `connectors/FbSubscription/FbSubscription/SuNr/{abonnement}`. A throwaway
  `999999901` with one regel was posted, deleted (200), and gone — kop included:
  a PUT on it afterwards answers *"De ingevulde waarde bij 'Abonnement' bestaat niet"*.

> **An abonnement without regels is invisible here.** `CON_ERP_Abonnementsregel`
> answers one row per *regel*, so a kop with none never shows up: it is marked
> *Nieuw* and cannot be deleted from the payload view. A send from this tool never
> leaves one behind — the mapping's regel fields are mandatory, and AFAS takes a kop
> and its regels in one call — but one made by hand in AFAS will re-insert as a
> duplicate attempt (which AFAS refuses on `SuNr`) rather than update.

To give another module a delete: read its UpdateConnector's primary key off
`metainfo/update/<connector>`, add `delete=DeleteTarget(...)` to its `_register`, and
prove it once on a test environment. The frontend needs nothing more than its
`existing` block (and a `plural` for the dialog).

## 8. Order of work

1. Backend: `existing_records()` in [`existing.py`](../backend/existing.py) + the
   route. Read-only, no UI depends on it yet.
2. Frontend: `existing-records.ts` (fetch + normalize + match), plan entries.
3. Panel: the marks, the mode switch, the counts.
4. Send: per-record verb, backend accepting it, dialog wording.

Steps 1–2 are inert on their own; the behaviour changes at step 3.

## 9. In the sheet's validation — `existing-record`

Everything above is payload-side and admin-only: it marks records and changes what a
send does. Debiteuren and Crediteuren also read the same list **while the sheet is
validated**, because a client's export often carries organisations AFAS already holds
*under another number* — and no POST/PUT choice fixes that, since the record's key
itself is wrong.

The rule sits on *Organisatie Naam* in
[`rules/erp-debiteuren.json`](../frontend/src/lib/validation/rules/erp-debiteuren.json)
(and the same in `erp-crediteuren.json`, keyed on *Crediteur Nummer*):

```json
{ "check": "existing-record", "keyColumn": "Debiteur Nummer",
  "when": { "column": "Organisatie of Persoon", "op": "==", "value": "O" },
  "message": "… {nummer} …", "keyMessage": "Debiteur id bestaat al in AFAS, als \"{naam}\"" }
```

Per row with a name and a number, against the **live** environment:

| AFAS holds the name … | AFAS holds the number … | Verdict |
| --- | --- | --- |
| not at all | not at all | fine — a new debiteur |
| under this number (among others or alone) | as this name | fine — the same record; the payload view updates it |
| only under other numbers | — | **error on the name**: change the row's number in the sheet to the one AFAS knows it by; the message lists those numbers |
| — | as another name | **error on the number**: *Debiteur id bestaat al* |

Both are ordinary `Issue`s, so they block a client's hand-in like any other error.
Names compare case- and whitespace-insensitively, punctuation kept (`Nymbus BV` ≠
`Nymbus B.V.`), keys by `normalizeKey` (§2). Persons (`P`) are skipped: AFAS's `Naam`
for a persoon is the person's name, not the sheet's organisatienaam.

**How it gets the list.** `GET /api/projects/{id}/existing/{module}/validation` —
any project member (a client checks before handing in), and in the environment the
module's **workflow task** imports into next — test while the deeltaak's step is
*validatie* or *test*, live from *Live conversie uitvoeren* on and once it is
*Afgerond* (`_validation_stage` in main.py, off `STAGE_TASKS` in the hosted version's backend). It
used to be live only, and missed every duplicate during the test import: a name the
first test send had created under another number sat in test, while live still held
eleven debiteuren (501282, 28-10-2026). The messages name the environment
(`{omgeving}`), so the reader looks for the clash where it is. Only for a module registered with
`validates=True` in [`existing.py`](../backend/existing.py), so it cannot be pointed
at `CON_HRM_Medewerker`'s roster. The `CodetabellenProvider` fetches it beside the
module's codetabellen ([`afas-records.ts`](../frontend/src/lib/validation/afas-records.ts)),
so the sheet re-validates on the same `loadedAt`, and it is re-read on every visit to
the module rather than once per session — this list grows as records are sent.

**A list it couldn't read skips the check, loudly.** Credentials missing, connector
not installed, AFAS down: the route answers `available: false`, the rows go unjudged,
and the toolbar's *niet gecontroleerd* badge names `bestaande records
(CON_ERP_Debiteuren)` — the codetabellen's rule, for the codetabellen's reason.

To give another module the check: register its source with `validates=True` and add
the rule to its name column, as Crediteuren did against `CON_ERP_Crediteuren`.
