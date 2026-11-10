# AFAS Profit ERP-Kennisbank

> Conceptuele en how-to-companion bij de losse API-veldreferentie. Dit document vat de domeinkennis, concepten en werkwijzen samen; de ruwe veldtabellen per endpoint staan in de aparte API-referentie.

## Inhoud

1. [Inleiding & scope](#1-inleiding--scope)
2. [Kernbegrippen](#2-kernbegrippen)
3. [Authenticatie & autorisatie](#3-authenticatie--autorisatie)
4. [GetConnectors](#4-getconnectors)
5. [UpdateConnectors](#5-updateconnectors)
6. [Vrije velden (custom fields)](#6-vrije-velden-custom-fields)
7. [Webhooks](#7-webhooks)
8. [Domeinen](#8-domeinen)
9. [How-to's](#9-how-tos)
10. [BI-modellen](#10-bi-modellen)
11. [AppConnector Auditor & partnercertificering](#11-appconnector-auditor--partnercertificering)
12. [Troubleshooting](#12-troubleshooting)
13. [Nieuws / changelog highlights](#13-nieuws--changelog-highlights)

---

## 1. Inleiding & scope

Met AFAS Profit worden alle administratieve processen in één softwareoplossing en één database verwerkt. Daardoor sluiten bedrijfsprocessen naadloos op elkaar aan en worden gegevens eenmalig vastgelegd: de salarisadministratie volgt logisch uit de HR-administratie en de financiële administratie uit de bedrijfsprocessen. De organisatie heet AFAS, de bedrijfsadministratieve oplossing heet Profit. Het systeem bestaat uit de backoffice (Profit), de intranet/extranet-oplossing (InSite en OutSite) en de app (Pocket).

Een AFAS-klant werkt doorgaans in één omgeving (meerdere is mogelijk). Via een integratie wissel je gegevens uit tussen Profit en een andere applicatie:

- Gegevens ophalen met een **GetConnector**.
- Gegevens toevoegen, wijzigen of verwijderen met een **UpdateConnector** (mogelijkheden verschillen per connector).
- Aanvullende connectoren gebruiken, bijvoorbeeld de **SubjectConnector** voor het ophalen van bestanden.

De API is benaderbaar via zowel REST (JSON) als SOAP (XML). Deze kennisbank richt zich primair op de REST API.

**Scope van dit document.** Deze kennisbank behandelt uitsluitend **AFAS Profit** en is volledig in het **Nederlands** opgesteld. Ser Business / AFAS Focus (SB) valt buiten scope. Het document is de conceptuele/how-to-companion bij de aparte API-veldreferentie en dupliceert bewust geen ruwe veldtabellen. Bron: de publieke repository **AFAS OASContent** (github.com/AFASSoftware/OASContent).

### Releasebeleid van AFAS

AFAS brengt elk jaar twee versies (updates) uit: rond juni en rond november. Alle klanten draaien op het cloud-platform AFAS Online. Bij een nieuwe versie migreert AFAS alle klantomgevingen volgens planning; deze migratie duurt maximaal 3 maanden. Een klant zit op de laatste versie, of op de voorlaatste versie in afwachting van migratie. De migratiedatum is zichtbaar in de AFAS Klantportal.

### Rollen bij het bouwen van een koppeling

- **Profit-beheerder (klant):** volgt de Specialisatiecursus Connector, kiest een AFAS-partner, richt een App connector in met de benodigde connectoren, maakt een token aan en verstrekt `token`, `deelnemersnummer` en `omgevingstype` (productie, test of accept) aan de ontwikkelaar. Ook maakt de beheerder de ontwikkelaar aan als gebruiker in een testomgeving.
- **API-ontwikkelaar:** leest deze documentatie, ontwikkelt in REST (JSON) of SOAP (XML), test in overleg met de beheerder via connect.afas.nl en brengt de koppeling live. Let op: een token geldt per omgeving, dus een testtoken werkt niet in productie.

### Sandbox / testomgeving

AFAS biedt testomgevingen alleen binnen licenties. Twee manieren om een omgeving met demodata te krijgen: via een AFAS-klant (die je een token en/of toegang geeft), of via het **AFAS Partnerprogramma** (dat standaardintegraties certificeert en ondersteunt; aanmelden via partner.afas.nl).

---

## 2. Kernbegrippen

### App Connector

De App Connector is het onderdeel in Profit waarmee je een externe applicatie integreert. De beheerder richt deze in enkele stappen in: hier worden GetConnectoren en UpdateConnectoren geautoriseerd en hier maakt de beheerder het token aan. Een beheerder kan onbeperkt App Connectoren toevoegen. Het is goed gebruik om per koppeling één eigen App Connector, één eigen autorisatiegroep en één eigen systeemgebruiker aan te maken.

### GetConnector

Met GetConnectoren maak je zelf endpoints aan om data uit Profit op te halen. Ze zijn gebaseerd op velden uit een **gegevensverzameling** (één of meer tabellen met relevante velden uit de onderliggende SQL-database). Je roept het endpoint aan via HTTP GET; voor nieuwe data doe je een nieuwe request (polling).

### UpdateConnector

Via een UpdateConnector kan een externe applicatie records in de Profit-database toevoegen, wijzigen of verwijderen (mogelijkheden verschillen per endpoint). Voor elke UpdateConnector is een **metainfo**-request beschikbaar dat alle beschikbare velden inclusief vrije velden teruggeeft.

### Omgeving en omgevingstypes

Een klant werkt in een omgeving met een uniek omgevingsnummer (deelnemersnummer, range 10000–99999). AFAS kent 3 omgevingstypes, herkenbaar aan de eerste letter van de omgevingsnaam (Productie = O, Test = T, Accept = A):

- **Productie:** `https://{id}.rest.afas.online/ProfitRestServices` — de live omgeving waar klanten werken.
- **Test:** `https://{id}.resttest.afas.online/ProfitRestServices` — meestal een kopie van productie met een datasnapshot, of een demo-/sjabloonomgeving.
- **Accept:** `https://{id}.restaccept.afas.online/ProfitRestServices` — ontvangt als eerste een nieuwe Profit-versie, zodat klanten kunnen testen vóór productie.

Er is geen mogelijkheid om wijzigingen van accept of test naar productie te pushen. Wijzigingen in definities kun je wel importeren en exporteren.

### Opbouw request-URL

Een REST-request is opgebouwd uit protocol (`https`), het omgevings-id (bijv. `12345`), de API-service (`rest`), het omgevingstype (leeg voor productie, anders `resttest`/`restaccept`), de domeinnaam (`afas.online`), gevolgd door de API-server `.../ProfitRestServices`, het endpointpad (bijv. `/connectors/Profit_Employees`) en queryparameters (bijv. `?skip=0&take=1`).

### Tokens

Een token geeft een externe applicatie toegang tot connectoren in de omgeving waarin het token is aangemaakt. Een token is uniek per omgeving en gekoppeld aan een gebruiker; de rechten van die gebruiker bepalen de rechten van het token. Behandel een token als een waardevol geheim: verstuur het nooit onbeveiligd en laat het niet rondslingeren.

### IntegrationId

Een **IntegrationId** is een uniek nummer voor jouw integratie dat toont wie de integratie heeft gemaakt. Voor partnerintegraties is het **verplicht** en moet het als HTTP-header in elke request worden meegestuurd (voor alle klanten hetzelfde IntegrationId). Opbouw: `<abonnementsnummer>_<projectnummer>`, bijvoorbeeld `12345_678900` (bij oude IntegrationId's is het tweede deel het abonnementsregelnummer).

AFAS gebruikt het IntegrationId om te zien welke onderdelen van de API je gebruikt, wat het effect is van wijzigingen, en of er problemen zijn — en neemt bij belangrijke veranderingen contact met je op. Zonder IntegrationId: (1) verliest je integratie de status "gecertificeerd" (AFAS ziet dan geen klanten), en (2) betaalt de klant voor supporthulp bij problemen in plaats van dat AFAS jou als partner belt.

---

## 3. Authenticatie & autorisatie

Om de Profit API aan te roepen moet een externe applicatie zich authenticeren. Profit ondersteunt twee methoden:

| Methode | Omschrijving | Status |
|---|---|---|
| **OAuth** | De applicatie vraagt eerst een tijdelijk *access token* aan en gebruikt dat bij elke aanroep. Gebaseerd op de OAuth 2.1 Internet-Draft. | **Aanbevolen**, standaard voor alle nieuwe koppelingen |
| **Classic token** | De applicatie stuurt bij elke aanroep dezelfde vaste sleutel mee. | **Wordt uitgefaseerd**, werkt niet meer na 31 augustus 2027 |

Een deel van de OAuth-functionaliteit is nieuw in **Profit 9**; dat is hieronder steeds aangegeven met **(Profit 9)**.

### Classic token (wordt uitgefaseerd)

Bij een classic token gebruikt de applicatie bij elke aanroep dezelfde vaste sleutel, die vaak jarenlang geldig blijft — lekt hij uit, dan heeft een kwaadwillende langdurig toegang. Bij OAuth gaat alleen een kortlevend access token mee in de aanroep.

Een token in Profit ziet er uit als een XML-string (`<token><version>1</version><data>...</data></token>`). Om het te gebruiken converteer je de volledige XML-string naar **Base64** en geef je het mee in de header:

```
Authorization: AfasToken <base64-token>
```

Na het aanmaken kun je het token niet meer in Profit raadplegen; ben je het kwijt, verwijder het dan en maak een nieuw token aan.

**Tijdlijn:**

| Datum | Wat verandert er? |
|---|---|
| September 2026 | Bestaande classic tokens krijgen een einddatum van 1 mei 2027. |
| 1 mei 2027 | Bestaande classic tokens verlopen; koppelingen die ervan afhankelijk zijn, werken niet meer. Nieuwe classic tokens met beperkte geldigheidsduur kunnen nog wel worden aangemaakt. |
| 31 augustus 2027 | Laatste dag waarop app connectoren met een classic token werken. |

**Overstappen naar OAuth (Profit 9).** Je hoeft geen nieuwe app connector aan te maken: wijzig in de bestaande app connector het authenticatietype van **Classic token** naar **Hybride** (classic token en OAuth werken tijdelijk naast elkaar, zodat de leverancier zonder onderbreking kan omzetten en testen) of **OAuth** (alleen OAuth werkt nog). Gekoppelde connectoren en IP-restricties blijven behouden.

### Confidential client en public client

OAuth onderscheidt twee soorten clients; het verschil zit in de vraag of de applicatie een geheim veilig kan bewaren.

- **Confidential client** — draait in een door de leverancier beheerde omgeving (webserver, back-end service, geplande taak). Kan een client secret of private key veilig opslaan en voert daarom **client authenticatie** uit bij elke tokenaanvraag.
- **Public client (Profit 9)** — draait bij de eindgebruiker (SPA in de browser, mobiele app, desktopapplicatie, command-line tool). Heeft **geen** client secret; beveiliging via inloggen door de gebruiker, **PKCE** (beschermt de authorization code) en **DPoP** (bindt het access token aan een sleutel van de applicatie).

> Vuistregel: kan de code van je applicatie door een eindgebruiker worden ingezien of gedownload, dan is het een public client. Zet nooit een client secret of private key in een browserapplicatie, mobiele app of desktopapplicatie.

**Overzicht van combinaties:**

| Client type | Flow | Client authenticatie | Tokenbeveiliging | Beschikbaar vanaf |
|---|---|---|---|---|
| Confidential | Client credentials | Client secret | Bearer, optioneel DPoP | Huidige versie |
| Confidential | Client credentials | Private key JWT | Bearer, optioneel DPoP | **Profit 9** |
| Confidential | Authorization code + PKCE | Client secret | Bearer, optioneel DPoP | Huidige versie |
| Confidential | Authorization code + PKCE | Private key JWT | Bearer, optioneel DPoP | **Profit 9** |
| Public | Authorization code + PKCE | Geen | **DPoP** | **Profit 9** |

### Client authenticatie bij een confidential client

Per app connector kies je één methode. De flow bepaalt **hoe** je een token krijgt; de client authenticatie bepaalt **hoe je aantoont welke applicatie** je bent.

**Methode 1 — client secret.** Je stuurt `client_id` en `client_secret` mee in de body van de tokenaanvraag. Vanaf Profit 9 kan ook `client_secret_basic`: beide waarden in de header `Authorization: Basic <BASE64_WAARDE>`, waarbij `client_id` en `client_secret` elk afzonderlijk form-urlencoded worden (RFC 6749 §2.3.1); `client_secret` laat je dan weg uit de body. Bewaar een secret als een wachtwoord (secret store/key vault, nooit in broncode, versiebeheer of logs).

*Geldigheidsduur (Profit 9):* elke client secret heeft een instelbare geldigheidsduur (standaard **180 dagen**); de vervaldatum staat in het instellingenscherm van de app connector. Vernieuwen zonder onderbreking: nieuwe secret genereren → in de applicatie zetten → controleren dat tokens worden verkregen → oude secret intrekken.

**Methode 2 — private key JWT (Profit 9).** Werkt met een asymmetrisch sleutelpaar: de private key blijft altijd bij jou; de publieke sleutel bied je aan als **X.509-certificaat** (upload bij de app connector; een losse publieke sleutel volstaat niet; key ID optioneel, anders gebruikt Profit de SHA-1-thumbprint) of via een **JWKS-URL** (`jwks_uri`, HTTPS, geen redirects, max. 64 KB, elke sleutel `"use": "sig"`, `kid` verplicht bij meer dan één sleutel). Profit cachet een JWK Set standaard één uur en volgt `Cache-Control`; bij een onbekende `kid` wordt de set direct opnieuw opgehaald. Ondersteunde algoritmen: `RS256`, `PS256` en `ES256` (RSA minimaal 2048 bits, EC curve P-256). Gebaseerd op RFC 7523 en `private_key_jwt` uit OpenID Connect.

Bij elke tokenaanvraag stuur je in plaats van `client_secret` een nieuwe, ondertekende *client assertion* mee:

```
client_id=<CLIENT_ID>
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<ONDERTEKENDE_JWT>
```

| Claim | Waarde |
|---|---|
| `iss` / `sub` | Je `client_id` |
| `aud` | Bij `typ: JWT`: URL van het token-endpoint of de basis-URL. Bij `typ: client-authentication+jwt`: de basis-URL (token-URL zonder `/oauth/token`). |
| `jti` | Unieke waarde per JWT; hergebruik wordt afgewezen |
| `iat` | Tijdstip van aanmaken (Unix timestamp) |
| `exp` | Bij voorkeur 60 seconden na `iat`; maximaal 5 minuten (60 seconden klokafwijking toegestaan) |

Stuur je in de header een `kid` mee, dan moet die exact overeenkomen met de key ID (of thumbprint) in Profit; een onbekende `kid` wordt afgewezen. Partners met meerdere klanten gebruiken **per klantomgeving een eigen sleutelpaar** (en eigen JWK Set), en in ieder geval aparte sleutels voor productie en test/accept. **Sleutels roteren:** nieuw certificaat/JWK toevoegen (meerdere tegelijk actief mogelijk) → ondertekenen met de nieuwe sleutel → oude sleutel na een afgesproken overlapperiode verwijderen (houd rekening met de cache van één uur). Bij een vermoedelijk gelekte sleutel direct intrekken.

**Fouten bij tokenaanvragen (Profit 9).** Stuur precies één client-authenticatiemethode mee; een combinatie (bijv. `client_secret` én `client_assertion`, of Basic-auth plus een credential in de body) geeft `invalid_request`. Een onbekende client of mislukte client-authenticatie geeft `invalid_client` (HTTP `401` met `WWW-Authenticate: Basic` bij Basic-auth, anders HTTP `400`). Een ontbrekende `grant_type` — en bij een authorization code een ontbrekende `code`, `redirect_uri` of `code_verifier` — geeft `invalid_request`, net als herhaalde parameters. `error_description` wordt weggelaten als er geen beschrijving is.

### OAuth — Client credentials flow

Voor **automatische koppelingen tussen twee systemen** zonder ingelogde gebruiker; de applicatie werkt onder de gebruiker die bij de app connector is ingesteld. Voor de meeste koppelingen de juiste keuze.

POST naar het token-endpoint met `grant_type=client_credentials`, `client_id` en de client authenticatie (`client_secret` óf `client_assertion_type` + `client_assertion`). Het antwoord bevat `access_token`, `token_type` (`Bearer`) en `expires_in` (geldigheid in seconden, bijv. `3600`). Er komt geen refresh token; vanaf Profit 9 ontbreekt het veld `refresh_token` daarom in het antwoord. Hergebruik het token zolang het geldig is en vraag daarna simpelweg een nieuw token aan.

### OAuth — Authorization code flow met PKCE (confidential client)

Voor een applicatie met eigen back-end die **namens een gebruiker** gegevens ophaalt of bijwerkt. De gebruiker logt in bij Profit, dat controleert of de gebruiker lid is van de autorisatiegroep van de app connector. **PKCE is verplicht** (RFC 7636).

1. Maak een `code_verifier` (43–128 tekens: letters, cijfers en `-._~`), de `code_challenge` = `BASE64URL(SHA256(code_verifier))` zonder `=`-opvulling, en een willekeurige, niet-lege `state` (CSRF-bescherming).
2. Stuur de gebruiker naar het authorize-endpoint met `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge` en `code_challenge_method=S256`. De `redirect_uri` moet overeenkomen met de redirect-URL bij de app connector; vanaf Profit 9 worden scheme en host hoofdletterongevoelig vergeleken, pad, query en poort exact.
3. Profit stuurt terug naar `<REDIRECT_URI>?code=...&state=...`. Controleer `state`; de code is kort geldig en eenmalig. Vanaf Profit 9 komen fouten na validatie van de `redirect_uri` ook via een redirect terug (bijv. `unsupported_response_type`, of `error=server_error` in plaats van HTTP `500`).
4. Wissel de code via je back-end in: POST met `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id` plus client authenticatie. Het antwoord bevat `access_token`, `refresh_token`, `token_type` (`Bearer`) en `expires_in`.
5. Vernieuwen met `grant_type=refresh_token`, `refresh_token`, `client_id` plus client authenticatie.

**Refresh tokens** zijn **eenmalig bruikbaar**: bij inwisselen krijg je een nieuw refresh token terug (direct opslaan); een oud refresh token wordt geweigerd. Refresh tokens zijn samen maximaal **30 dagen** geldig vanaf het eerste uitgegeven refresh token; daarna moet de gebruiker opnieuw inloggen.

### Public client: Authorization code flow met PKCE en DPoP (Profit 9)

Voor SPA's, mobiele apps en desktopapplicaties zonder eigen back-end. Een public client gebruikt verplicht de Authorization code flow met PKCE, stuurt **geen** `client_secret` of `client_assertion` mee en beveiligt het access token verplicht met **DPoP** (Demonstrating Proof of Possession, RFC 9449).

**Werking DPoP:** de applicatie maakt een sleutelpaar aan (in de browser bij voorkeur *non-extractable* via de Web Crypto API, bijv. ECDSA P-256) en stuurt bij elke aanvraag een nieuwe **DPoP proof** mee in de header `DPoP`: een JWT met header `typ: dpop+jwt`, `alg` (bijv. `ES256`) en de publieke sleutel (`jwk`), en payload `jti`, `htm` (HTTP-methode), `htu` (URL zonder querystring), `iat` en `nonce`. Profit bindt het access token aan die sleutel; een gestolen token is zonder private key onbruikbaar.

- Het tokenantwoord heeft `token_type` **`DPoP`** in plaats van `Bearer`.
- Bij een API-aanroep stuur je `Authorization: DPoP <ACCESS_TOKEN>` plus een nieuwe proof die ook de claim **`ath`** bevat (`BASE64URL(SHA256(access_token))`).
- Bij vernieuwen onderteken je de proof met **dezelfde** sleutel als bij de oorspronkelijke tokenaanvraag.

**DPoP nonce.** Profit vereist een door de server bepaalde nonce in de proof. Zonder geldige nonce antwoordt Profit met HTTP `400`, `{"error": "use_dpop_nonce"}` en de header `DPoP-Nonce`; maak dan een volledig nieuwe proof (nieuwe `jti`) met die nonce en herhaal de aanvraag. Profit kan bij iedere response (ook `200`) een nieuwe `DPoP-Nonce` sturen — bewaar altijd de meest recente.

### Connector aanroepen en foutafhandeling

Confidential clients sturen `Authorization: Bearer <ACCESS_TOKEN>` mee; public clients `Authorization: DPoP <ACCESS_TOKEN>` plus de `DPoP`-header. Je kunt alleen de Get- en UpdateConnectoren aanroepen die aan de app connector zijn gekoppeld.

Vanaf **Profit 9** bevat een HTTP `401` altijd een `WWW-Authenticate`-header: zonder credentials biedt Profit zowel `Bearer` als `DPoP` aan (zonder foutcode); een afgewezen token geeft `Bearer error="invalid_token"` resp. `DPoP error="invalid_token"` (ook als de proof met een andere sleutel is ondertekend). Is de opslag voor replay-detectie tijdelijk niet beschikbaar, dan volgt HTTP `503` — een serverstoring, geen ongeldig token.

### OAuth & SOAP

De OAuth-flows gelden ook voor de SOAP API. Volg de HTTP-headervereisten van het gekozen tokentype; plaats het access token niet in de SOAP-body.

### Endpoints

| Omgeving | Authorize | Token |
|---|---|---|
| Productie | `https://<omgevingsnummer>.rest.afas.online/ProfitRestServices/oauth/authorize` | `.../ProfitRestServices/oauth/token` |
| Test | `https://<omgevingsnummer>.resttest.afas.online/ProfitRestServices/oauth/authorize` | `.../ProfitRestServices/oauth/token` |
| Accept | `https://<omgevingsnummer>.restaccept.afas.online/ProfitRestServices/oauth/authorize` | `.../ProfitRestServices/oauth/token` |

### Welke combinatie kies ik?

1. **Logt er geen gebruiker in?** → confidential client met de **Client credentials flow**.
2. **Logt er een gebruiker in en heeft de applicatie een eigen back-end?** → confidential client met de **Authorization code flow met PKCE**. Zonder back-end (SPA, mobiele app, desktop) → **public client** met PKCE en DPoP (Profit 9).
3. **Client authenticatie (confidential):** **private key JWT** (Profit 9) heeft de voorkeur — geen herbruikbaar geheim over de lijn en geen secrets uitwisselen. **Client secret** is eenvoudiger, maar moet vanaf Profit 9 periodiek worden vernieuwd.

### Platformondersteuning (Power Automate)

Controleer bij een integratieplatform of de connector de OAuth-flow en beveiligingsmaatregelen van Profit ondersteunt; alleen de vermelding 'OAuth 2.0' is niet voldoende (Profit vereist bij de Authorization code flow altijd PKCE). AFAS biedt geen ondersteuning op de inrichting van Power Automate.

- **Client credentials flow:** niet ondersteund door de standaard OAuth 2.0-optie van custom connectors. Workarounds: (1) HTTP-acties in de flow (eerst token ophalen, dan API aanroepen met `Bearer`), of (2) een custom connector met Basic-authenticatie en custom code die per aanroep een token ophaalt. Beide vereisen een **Premium-licentie**. Bewaar het secret bijv. in Azure Key Vault en zet beveiligde invoer/uitvoer aan.
- **Authorization code flow met PKCE:** de standaardoptie stuurt geen PKCE mee (fout `code challenge required`). Workaround: de niet-officieel gedocumenteerde configuratie `oauth2generic` via `apiProperties.json`, in te stellen met Power Platform CLI of `paconn`. Een update van de custom connector wist het client secret (opnieuw instellen, bijv. `paconn update --secret`).

---

## 4. GetConnectors

Een GetConnector is een endpoint waarmee een applicatie records ophaalt uit de Profit-database. Een beheerder stelt de definitie samen en bepaalt daarmee welke records en velden opvraagbaar zijn.

**Taakverdeling.** De Profit-beheerder bepaalt samen met de ontwikkelaar welke data nodig is, zoekt of maakt een GetConnector en voegt die toe aan de App connector. De ontwikkelaar roept de GetConnector aan, test en valideert. Advies: maak altijd een **nieuwe** GetConnector met bewust gekozen velden en een ingebouwd filter — de meegeleverde GetConnectoren bevatten veel overbodige velden die extra load geven. Neem in de omschrijving de naam van de koppeling op.

Met de speciale GetConnector **`MetaInfo`** vraag je een lijst op van alle GetConnectoren in een omgeving; je ziet welke beschikbaar en welke geblokkeerd zijn.

> Datumtijd-velden eindigen op een `Z`; negeer die `Z`. De tijd is altijd Amsterdam GMT.

### Filtering

Een GetConnector kan een ingebouwd filter of autorisatie bevatten (bijv. huidig jaar). Daarnaast kun je per request filteren. Gebruik connect.afas.nl om filters samen te stellen en te testen.

Beschikbare filter-operatortypes:

| Type | Beschrijving | Operator |
|------|--------------|----------|
| 1 | is gelijk aan | `=` |
| 2 | is groter of gelijk aan | `>=` |
| 3 | is kleiner of gelijk aan | `<=` |
| 4 | is groter dan | `>` |
| 5 | is kleiner dan | `<` |
| 6 | bevat | `*` |
| 7 | is niet gelijk aan | `!=` |
| 8 | is leeg | `[]` |
| 9 | is niet leeg | `![]` |
| 10 | start met | `@` |
| 11 | bevat niet | `!*` |
| 12 | start niet met | `!@` |
| 13 | eindigt met | `&` |
| 14 | eindigt niet met | `!&` |
| 15 | snelfilter | `Sf` |

Bij operators 8 en 9 (leeg/niet leeg) moet altijd een `filtervalue` worden meegegeven; dit mag een lege waarde zijn.

- **AND-filter:** scheid filtervariabelen met een komma `,`.
- **OR-filter:** scheid filtervariabelen met een puntkomma `;`.
- **JSON-filter (`filterjson`):** voor complexe combinaties. Velden binnen één filter hebben een AND-relatie; filters onderling een OR-relatie. De JSON moet URL-encoded worden, wat de URL-lengtelimiet sneller bereikt.

### Skip en take (paging)

GetConnectoren worden standaard gelimiteerd op 100 records (`skip=0`, `take=100`). Vuistregel voor de omvang: `[aantal kolommen] × [aantal regels] < 150.000`. Bij te veel data krijg je HTTP 500 met "Er is een onverwachte fout opgetreden."; in het omgevingslogboek staat dan "Insufficient memory to continue the execution of the program." of "Cannot allocate a buffer of size 2147487574.". Ook zonder foutmelding legt het opvragen van te veel data een grote druk op de AFAS-servers (langere wachttijden, problemen bij andere koppelingen). Een "get all" (`skip=-1`, `take=-1`) wordt sterk afgeraden. Bij een `skip` groter dan ~100.000 wordt het ophalen onacceptabel traag; deel de data dan op via een variabel filter (per artikel, medewerker, boekingsdatum) en gebruik daarbinnen alsnog skip/take. Maximaal 5 gelijktijdige aanroepen.

> Bij gebruik van skip/take is het **verplicht** te sorteren met `orderbyfieldids`, anders kan de sortering tussen calls verschillen (regels missen of dubbel).

### OrderBy

Met `orderbyfieldids` bepaal je de volgorde (één of meer velden). Kies bij voorkeur integer-velden (snelste index). Aflopend sorteren met een minteken: `orderbyfieldids=-Account`. Geef deze parameter altijd mee.

### Maximale URL-lengte

De string met parameters is gelimiteerd op **2049 tekens** (inclusief `?` en `&`). Bij overschrijding volgt HTTP **404 Not Found**.

### Metainfo-request

Via `/metainfo/get/<connector>` vraag je per GetConnector de velden op: veld, veldtype, label, veldlengte en (bij een gekoppelde codetabel) de codetabelwaarden.

### Rowcount

Voor een rowcount maak je een kopie van de GetConnector met een verdichting op de sleutel (Count) en zet je de overige velden onzichtbaar.

### Geblokkeerde GetConnector

AFAS hanteert een **Fair Use policy**. Elke dag krijgen de 10 zwaarste gebruikers bericht dat ze hun proces moeten aanpassen. In sommige gevallen **blokkeert** AFAS een GetConnector omdat het aantal aanroepen performanceproblemen voor andere gebruikers veroorzaakt.

Probleemanalyse: achterhaal welk proces de connector aanroept (vaak herkenbaar aan de naam), kijk welke integratie sinds de blokkade niet meer werkt of fouten geeft. Oplossing: bij een externe applicatie neem je contact op met de leverancier (bij een gecertificeerde koppeling kan die AFAS inschakelen); bij een intern proces beperk of verbeter je de aanroepen. **Deblokkeren** via **Algemeen / Uitvoer / Beheer / GetConnector**, actie **Definitie**, vink het veld **Geblokkeerd** uit (eventueel eerst via het hangslot-icoon "Geblokkeerde regels tonen").

---

## 5. UpdateConnectors

Via een UpdateConnector voeg je records toe, wijzig je ze of verwijder je ze (mogelijkheden per endpoint verschillen). In connectoren met subobjecten kun je een specifieke actie per subobject meegeven. De details en velden per endpoint staan in de aparte API-referentie; hieronder de principes.

### POST

Met POST maak je records aan. Vóór aanmaak wordt de data gevalideerd, bijvoorbeeld: een BSN moet aan de 11-proef voldoen, een adres moet een landcode bevatten, en een financiële mutatie moet in balans zijn (debet = credit). Een **HTTP 500** betekent dat de request-inhoud niet gevalideerd kon worden.

### Response

Meestal geeft een geslaagde UpdateConnector **HTTP 201**. Het `FieldId` in de response-body is de primary key van het aangemaakte object. Voorbeeld: `{ "results": { "KnSubject": { "SbId": "999999" } } }`.

### POST op subobject

Bij een geneste structuur kun je het hoofdobject updaten en op een subobject een insert doen (bijv. een artikel toevoegen aan een bestaande verkooporder). Twee methoden:

- **`@Action`-tags in de body:** je geeft `@Action` mee binnen de `Fields`-tag met waarde `insert`, `update` of `delete`. Handig bij complexe, diep geneste structuren (tot ~6 niveaus, bijv. `KnEmployee`, `KnEmployeeGuid`, `FbDeliveryNote`, `FbAssembly`, `FbSales`). De volledige body wordt gevalideerd en als één transactie verwerkt.
- **Subobject via URL:** je specificeert het subobject in het pad, bijv. `.../connectors/HrMobility/HrEmployeeMobilityRegistration`. Het updaten van het hoofdobject is dan optioneel.

### PUT

De Open API-specificatie geeft per endpoint aan welke acties zijn toegestaan. Bij een PUT zijn alleen de sleutelvelden verplicht. Een PUT werkt alle meegegeven velden bij, plus alle subobjecten waarvan de sleutel is meegegeven. Een veld leegmaken doe je door een lege waarde mee te geven (`"Ds": ""`).

### DELETE

Sommige endpoints ondersteunen DELETE — dit is een **definitieve** verwijdering. Je geeft de sleutel mee als URL-parameters, bijv. `.../connectors/KnAppointment/KnAppointment/ApId/123`. Voor een geneste regel neem je de volledige sleutel van hoofd- én subelement op in de URL.

---

## 6. Vrije velden (custom fields)

Beheerders kunnen onbeperkt **vrije velden** toevoegen in de meeste tabellen; die worden vervolgens direct beschikbaar in de endpoints. Kenmerken: eenvoudig in te richten, kunnen verwijzen naar (vrije) tabellen, en worden op omgevingsniveau beheerd. Formaten: string, date, date/time, boolean etc. Koppeling aan een tabel geeft primary-key-validatie op het veld.

Een vrij veld is herkenbaar aan de **GUID** als veld-id (bijv. `UC2DE284248374B083C966F9B4EEEE9E2`). De GUID achterhaal je op drie manieren: de beheerder geeft hem door, via de tooling op connect.afas.nl, of via een metainfo-request (`/metainfo/update/<connector>`). Je past de GUID toe op het objectniveau waar het vrije veld hoort, bijvoorbeeld als extra veld in de `Fields` van een PUT.

> Wil je een GetConnector met vrije velden in een andere omgeving gebruiken, exporteer de vrije velden dan eerst en importeer ze in de andere omgeving. Filteren op vrije velden wordt afgeraden: er wordt geen index op aangemaakt.

---

## 7. Webhooks

Webhooks zijn beschikbaar op **dossier** en sturen automatisch een real-time notificatie bij: het toevoegen, wijzigen of verwijderen van een dossieritem; het toevoegen of verwijderen van een reactie op een dossieritem; en wanneer een workflow in een workflowtaak komt of een workflowactie wordt uitgevoerd. Hiermee hoeft een externe applicatie niet meer te pollen.

> De notificatie meldt **dat** er iets gewijzigd is, niet **wat**. Gebruik een GetConnector om de gewijzigde data op te halen.

### Techniek

- Notificaties zijn **JSON** en worden via **HTTPS** POST verstuurd naar de endpoint uit de webhook (HTTP wordt niet ondersteund; het endpoint moet anoniem en publiek bereikbaar zijn).
- Elke notificatie wordt ondertekend met een **HMAC-SHA256**-handtekening in de header `X-Profit-Signature-256: sha256=<hex-encoded HMAC-SHA256 hash>`, op basis van het wachtwoord dat bij de webhook is ingesteld. Het wachtwoord wordt versleuteld opgeslagen en kan niet worden opgevraagd.
- Er wordt alleen verstuurd als zowel de app connector als de webhook niet geblokkeerd zijn.

Elke notificatie bevat minimaal `EventId`, `EnvironmentId` en `Timestamp` (UTC). EventTypes:

- Testbericht: `test.executed` (met `SubscriptionId`, `SubscriptionName`).
- Dossieritem: `subject.created` / `subject.updated` / `subject.deleted` (data: `SubjectTypeId`, `SubjectId`).
- Reactie: `subject.reaction.created` / `.updated` / `.deleted` (data ook `ReactionId`).
- Workflow: `workflow.action.executed` / `workflow.task.entered` (data: `SubjectTypeId`, `SubjectId`, `WorkflowName`, `TaskName` of `ActionName` — allemaal GUID's).

GUID's kunnen wijzigen als de workflowinrichting verandert. Je haalt ze op via Profit (CRM / Dossier / Inrichting / Type dossieritem → tabblad Workflows → Workflow Editor) of geautomatiseerd via een kopie van standaard-GetConnector **`Profit_Workflowactions`** (filter op `WorkflowName`).

### Aflevering, retry en timeout

Events worden niet direct verstuurd maar via een asynchrone batch job ("Webhooks versturen"): een event krijgt status `Registered`, wordt ingepland en asynchroon via HTTP POST verstuurd. Zo heeft een trage ontvanger geen effect op de gebruiker die de mutatie doet. Bij mislukte aflevering (niet-2xx of timeout) wordt met steeds langere intervallen opnieuw geprobeerd; na te veel pogingen wordt de status `Failed`. De **HTTP-timeout is 2 seconden**: de ontvanger moet snel bevestigen (2xx) en verdere verwerking asynchroon doen.

**Event-statussen:** `Registered` (wacht op verwerking), `Pending` (in verwerking), `Success`, `Retry` (gepland voor nieuwe poging), `Failed` (definitief mislukt), `EntityRateLimited` (bij snel opeenvolgende identieke events wordt alleen de laatste verzonden).

### Inrichting

Je richt webhooks per app connector in (Algemeen / Beheer / App connector → tabblad Webhooks): vul omschrijving, URL en wachtwoord in en verstuur een testbericht. Vervolgens bepaal je per **type dossieritem** (CRM / Dossier / Inrichting / Type dossieritem → tabblad Webhooks) en per **workflow** (open de workflow, koppel een webhook aan een taak of actie, en Publiceer) wanneer notificaties worden verstuurd. Op de starttaak van een workflow, op de speciale actie "Maak mij verantwoordelijk" en op Jonas-acties zijn geen webhooks mogelijk. Als het dataverkeer met een endpoint langere tijd niet mogelijk is, blokkeert Profit de webhook automatisch (gelogd in het omgevingslogboek).

---

## 8. Domeinen

De domeinspecificaties beschrijven op hoofdlijnen welke onderdelen per module beschikbaar zijn. De concrete connectoren en velden staan in de API-referentie.

### CRM

- **Organisaties en personen:** organisaties, personen, verkooprelaties, inkooprelaties.
- **Dossiers, bijlagen en workflows:** dossieritems, workflowacties, bijlagen, workflowreacties.

### Medewerker (HRM)

- **Medewerker en contract:** contract, rooster, functie, salaris.
- **Verlof en verzuim:** verlof, verzuim, saldo.
- **Werkgeverinstellingen:** kostenplaatsen, functies.
- **Loonadministratie:** loonmutaties, voorschotten.
- **Werving en selectie:** aanmaken sollicitaties en sollicitanten.

### Financieel (Finance)

- **Financiële mutaties:** journaalposten boeken, financiële facturen wijzigen, confrontaties, e-inkoopfacturen, SEPA-incasso, voorfactuur.
- **Financiële inrichting:** verbijzonderingscodes, grootboekrekeningen, transactie-instellingen.
- **Budgetten en activa:** contracten, reserveringen, budgetten, activa, verplichtingen.

### Projecten (inclusief bouw en flex)

- **Projecten:** nacalculatie, projecten, teams, voorcalculatie, voortgang.
- **Bouw:** optielijsten, standopnamen, bewakingscodes.
- **Flex:** plaatsingen, prijsafspraken, dagcontracten, declaraties.

### Verkoop (inkoop en verkoop)

- **Artikelen:** artikel, kostprijs, samenstelling, labels.
- **Inkoop:** inkoop, binnenkomende goederen, inkoopprijs, inkooprelaties, procuratie, verrekenprijzen.
- **Magazijn:** ontvangst, voorraadmutaties, verplaatsingen.
- **Verkoop en orders:** abonnementen, verkooporders, productie, verkoopprijs, forecast.
- **Cursusmanagement:** planning, evenementen, deelnemers.

### Fiscaal (Taxes)

- **Aangiften:** aangiften, VPB, IB, commercieel/fiscaal.
- **Proces:** aanmaken machtiging, klaarzetten aangiften (o.a. aangifte IB).

---

## 9. How-to's

Onderstaande scenario's vatten de belangrijkste stappen en connectoren samen. Raadpleeg de API-referentie voor de exacte velden per endpoint.

### Quickstart — je eerste request

Krijg van een beheerder een omgevingsnummer, omgevingstype en (client id + client secret of token), plus rechten op de gewenste endpoints. Tip: test met GetConnector **`ProfitCountries`** (bevat altijd data en is licht). Test eerst op **connect.afas.nl** (REST/GET): vul de gegevens in, klik Verbinden (er wordt automatisch een metainfo-request gedaan die de geautoriseerde GetConnectoren toont), selecteer een connector en klik Execute. Bouw daarna dezelfde aanroep na in je eigen applicatie met de gekozen OAuth-flow. Het access token geef je mee met prefix `Bearer` in de Authorization-header. Er zijn C#-voorbeelden voor het ophalen van een token (beide flows) en voor de API-aanroep.

### Medewerker synchroniseren met Active Directory

Doel: nieuwe medewerkers automatisch toegang geven en hun werk-e-mailadres in Profit vastleggen; bij uitdiensttreding toegang opzeggen en de verstrekkingswijze van loonstrook/jaaropgave aanpassen. Je maakt zelf een GetConnector aan op basis van *Medewerker Actuele gegevens* om medewerkers op te halen die indienst komen (filter: niet geblokkeerd, geen werk-e-mail gevuld, startdatum in de toekomst — op velden `EmailWork`, `EmploymentStartDate`, `UserId`). Het e-mailadres leg je vast via **PUT `KnPerson`** (`EmAd`), de UPN via **PUT `KnUser`** (`EmAd`). Bij uitdienst haal je de actuele medewerkergegevens op (filter op `EmploymentEndDate` en `EmailForDigitalDocuments`) en werk je via **PUT `KnEmployee`** (payload `AfasEmployee`) de verstrekkingsvelden bij (o.a. `PsPv`, `YsPv`, `EmAd`, `SeAt`, `PwEm`).

### Onboarden van een nieuwe kandidaat (ATS)

Standaard opzet voor een ATS met de Flex-module. Haal bestaande personen op via **`Profit_OrgPer`** (filter op `Type`=Persoon, `MailWork`). Maak een persoon aan via **`KnPerson`** (met objecten `KnContactAutRole`, `KnBasicAddressAdr`, `KnBasicAddressPad`; velden o.a. `MatchPer`, `BcCo`, `AutoNum`, `AddToPortal`, `EmailPortal`), en de kandidaat via **`KnEmployee`** (payload `AfasEmployee`, velden `ViSe`, `RlBh`, `Flex`, `Bl`). Maak een conceptplaatsing via **`PtConceptPlacementContract`** (velden `@PcCo`, `DaBe`, `EmId`, `PrId`, `ErId`, `FuId`; subobject `AfasPtConceptPlacementContractLine`). Start de onboarding via **`HrCreateApplicant`** (velden `VcSn` = volgnummer vacature, `BcCo`; response `CaId`), wat een dossieritem "Sollicitatie" (code -44) aanmaakt. AFAS raadt aan waar mogelijk de veelzijdiger **`HrOnboarding`** te gebruiken (beschikbaar sinds Profit 4).

### Data vanuit Profit naar BI

Optimaal data ophalen voor een BI-integratie via de REST API. Uitgangspunt is het AFAS-datamodel (circa 3600 tabellen, 184.000 velden, 15.000 foreign keys) met organisatie/persoon als centrale CRM-entiteit; je werkt met GetConnectoren (views/gegevensverzamelingen). Aandachtspunten: gebruik altijd een `id`-veld voor unieke regels; let bij joins op het "modified field"; houd rekening met hard deletes; weeg full load versus delta load af. Voor financiële mutaties gebruik je de gegevensverzameling *Gewijzigde boekingsdagen mutaties*; voor verwijderingen de gegevensverzamelingen *Verwijderde nacalculatie* en *Verwijderde verkoopfactuur*. Bij medewerkers is het onderscheid tussen *Dienstverband* en *Volgnummer dienstverband* belangrijk, en wordt het SCORF-model uitgelegd (Arbeidsverhouding, Dienstverband, Contract, Rooster en OE/Functie, Salaris) met de tabellen *Actuele gegevens per arbeidsverhouding* en *Actuele gegevens per dienstverband*.

### Financiële mutatie — verkoop

Een verkoopboeking vastleggen, de factuur aanmaken en bijlagen toevoegen. Basisgegevens via GetConnectoren o.a. **`Profit_Administrations`** (`UnId`), **`Profit_Journals`** (`JoCo`), **`Profit_Accounts`** (`AcNr`), **`Profit_Allocation_Assigments`**, **`Profit_Projects`**, **`Profit_Creditor`** (`CrId`), **`Profit_Debtor`** (`DbId`) en **`Profit_VAT_code`**. De mutatie maak je via **`FiEntries`** (payload `FiEntryPar`, velden o.a. `Year`, `Peri`, `UnId`, `JoCo`, en regels met `VaAs`, `AcNr`, `EnDa`, `BpDa`, `AmDe`, `AmCr`, `DaEx`, `VaId`; response `UnId`, `EnNo`, `InId`). Verbijzondering via subobject **`FiDimEntries`** (`DiC1`–`DiC5`), projectboeking via **`FiPrjEntries`** (`PrId`, `ItCd`, ...). Bijlagen via **`KnSubject`** (object `KnSubjectLink` met verkoopvelden `SiUn`, `SiTp`=1, `SiId`=`InId`, plus `KnSubjectAttachment`); de factuur deblokkeer je voor betaling via **`FiInvoice`** (`BlPa`).

### Financiële mutatie — inkoop

Goederenontvangst registreren, financiële mutatie aanmaken en de confrontatie op de inkooporder uitvoeren. Basisgegevens via **`Profit_Administrations`**, **`Profit_Journals`**, **`Profit_Accounts`**, **`Profit_VAT_code`**, **`Profit_Creditor`**, een custom endpoint voor inkooporders en **`Profit_Warehouses`** (`War`). Goederenontvangst via **`FbGoodsReceived`** (subobject `FbGoodsReceivedLines`; response `OrNu`), de mutatie via **`FiEntries`**, optioneel een bijlage via **`KnSubject`** (`KnSubjectLink` met inkoopvelden `PiUn`, `PiTp`=1, `PiId`=`InId`) en de factuur via **`FiInvoice`**. Sluit af met de confrontatie via **`FbConfrontation`** (velden `UnId`, `InId`; genest `FbGoodsReceived`/`FbGoodsReceivedLines` met `OrNu`, `GuLi`, `QuCf`).

### Btw-terugvordering via de API

Vanaf **Profit 3** is de bepaling van het percentage terug te vorderen btw gewijzigd (breaking change voor scan-en-herkenoplossingen die inkoopfacturen als financiële mutatie insturen). Nieuw: meerdere pro rata percentages per administratie; afwijken op niveau van de verbijzonderingstoewijzing; meerdere pro rata percentages aan één btw-code koppelen; pro rata per project. Algoritme per factuurregel: bepaal de btw-terugvorderingscode (achtereenvolgens op Project — veld `Btw-terugvordering > Code`; Verbijzonderingstoewijzing — `Afwijkende btw-terugvordering > Code`; Verbijzonderingscode — `Btw-terugvordering > Code`), haal het percentage op uit *BTW terugvorderingsregels*, zoek de juiste btw-code op via *BTW terugvordering per BTW code*, en haal de btw-grootboekrekening op (veld `Rekening`). In **`FiEntries`** vul je het nieuwe veld `CoVc` (btw-terugvorderingscode) samen met de btw-code.

### Verkooprelatie en klantovereenkomst — Flex

Nieuwe verkooprelaties en klantovereenkomsten aanmaken. Valideer bestaande data via **`Profit_OrgPer`** en **`Profit_Debtor`**. De verkooprelatie maak je via **`KnSalesRelationOrg`** (`@DbId`, velden `VaId`, `CuId`, `InPv`, object `KnOrganisation` met `MatchOga`=6 voor altijd nieuw, plus `KnBasicAddressAdr`; response `DbId`, `BcCo`, `BcId`). De klantovereenkomst (feitelijk een project met specifiek gedrag) maak je via **`PtProject`** met profiel `Prof` = -147 en verplicht `PrTy`=1 (verder o.a. `PrGp`, `Ds`, `DbId`, `RpDe`, `PsId`, `ClId`; response `PrId`).

### Plaatsing — Flex

Een flex-medewerker in dienst melden zodat deze voor een opdrachtgever kan werken. Twee opties: **Conceptplaatsing** (backoffice vult aan) en **Plaatsing** (direct volledig, inclusief prijsafspraken). Bij de volledige plaatsing: plaatsing aanmaken, itemset ophalen (filter op klantovereenkomst + versie, actief op huidige datum) en prijsafspraken aanmaken, waarbij de prijsafspraak het veld `PlCo`/Plaatsing bevat zodat prijs- en loonafspraak direct worden aangemaakt. De opzet overlapt met de Flex-how-to (validatie via `Profit_OrgPer`/`Profit_Debtor`, `KnSalesRelationOrg`, `PtProject`); de concrete requests voor plaatsing en itemset zijn in dit conceptartikel nog niet uitgewerkt.

### Loonadministratie aansluiten op salarisadministratie

Inzichtelijk maken uit welke berekende looncomponenten een loonjournaalpost is opgebouwd, ook bij TWK-verloning en veel medewerkers. GetConnectoren (los te downloaden): **`SH_AUDIT_Plannen`**, **`SH_AUDIT_MdwPerPlan`** en **`SH_AUDIT_Transactions`**. Stap 1: haal het hoofd-`PlanId` op via `SH_AUDIT_Plannen` (filter `Werkgever`, `Jaar`, `Periode`). Stap 2: haal de salarisverwerkingsplannen op (filter `Afwijkend_betaalplan`). Stap 3: haal medewerkers op via `SH_AUDIT_MdwPerPlan` (filter op `PlanId`). Stap 4: haal de berekende looncomponenten op via `SH_AUDIT_Transactions` (filter op `planIdBetaald`/`planIdBetrekkingOp` en `employeeNumber`; velden o.a. `code`, `Omschrijving`, `value`, `contractNumber`). Voor performance: per medewerker aanroepen, maximaal 5 tegelijk.

### Vervoermiddel voor medewerker (mobility)

Vervoermiddelen op medewerkers vastleggen, kilometerstanden bijwerken en vastleggen in het dossier. Medewerkers ophalen via **`Profit_Employees`**; merken via een zelf te maken GetConnector op *Vrije tabellen* (filter veld *Tabel* = `MarkTabl`). Het vervoermiddel maak je via **`HrMobility`** (velden o.a. `TrTy`, `CmId`, `ViMr`, `ViMd`, subobject `HrEmployeeMobility` met `@EmId`; response `CcSn`). Een kilometerstand voeg je toe via POST op subobject **`HrMobility/HrEmployeeMobilityRegistration`** (`@CcSn`, `DaEn`, `KmEn`). Optioneel vastleggen in het dossier via **`KnSubject`** (`KnSubjectLink` met `SfTp`=2, `SfId`=MedewerkerId, `CcSn`).

### Dossierbijlagen exporteren (via Systemintegrators)

Bijlagen op dossieritems laten exporteren door het team Systemintegrators (zelf doen kan via de how-to "Ophalen van bijlagen"). Maak een GetConnector met de vaste naam **`Dossierexport`**: alle velden vóór het verplichte veld `DossieritemId` bepalen de mappenstructuur, alle velden erna komen in een csv. Filter op de gewenste dossieritems (bijv. type `-2` Loonstrook). Maak een App connector (Classic token) met de GetConnectoren **`Dossierexport`** en **`Profit_Subject_Attachments`** plus de custom connector **`SubjectConnector`** (`AppConnectorSubject`). Maak een token met rechten op de definitie en de dossieritems, en geef omgevingsnaam en token beveiligd door. Je ontvangt een zip via een beveiligde, eenmalige link.

### Bijlagen ophalen uit Profit (zelf)

Haal dossieritems op met **`ProfitSubjects`** (bijv. filter `SbTy`=-2; response o.a. `SbId`, `SbTy`, `BcId`). Haal bijlagegegevens op met **`Profit_Subject_Attachments`** (filter `subject_id`; response `attachment_id`, `file_id`, `file_name`) en voor reacties met **`Profit_Subject_Reaction_Attachments`**. Haal het bestand op via de speciale **`SubjectConnector`** met URL `/ProfitRestServices/SubjectConnector/{SubjectId}/{FileId}` (response `filename`, `mimetype`, `filedata` als Base64). Een 404 betekent dat het bestand niet op schijf staat of dat de tokengebruiker geen rechten heeft — test dit altijd via Profit als gebruiker en pas zo nodig de autorisatie aan. Let op: de naam van een bijlage kan meerdere keren voorkomen, ook binnen één dossieritem of reactie; houd hier rekening mee bij het verwerken.

### AFAS Remote via de API (cmdconnector)

Met de **cmdconnector** voer je AFASRemoteCmd-acties direct via de API uit, bijvoorbeeld een **import** — eenvoudig herhaalbaar voor meerdere omgevingen en direct met OAuth-credentials. Dit kan alleen via **SOAP** (de REST-API ondersteunt deze actie niet). Nodig: een AFAS-omgeving en een AppConnector met **AFAS Remote Cmd** geactiveerd (tabblad "Connectoren").

- **Import starten:** POST naar `https://<omgevingsnummer>.soap.afas.online/profitservices/cmdconnector.asmx` met SOAP-actie `urn:Afas.Profit.Services/Execute` en `Authorization: Bearer ...`. In `<commandLine>` geef je de opdrachtregel mee (bijv. `/O"O12345AA" IMPORT /N"Import dossier nieuw" /F"ImportDossier.csv"`), in `<attachementArchive>` het importbestand (o.a. CSV of fixed-width) als base64-gecodeerde ZIP. Het element `<token>` is vooralsnog verplicht, maar de inhoud wordt genegeerd (bijv. `nit`). Het response (`ExecuteResult`) bevat de `commandId`.
- **GET-connector importeren:** zelfde aanroep met actie `DEFINITIEIMPORT`, bijv. `/O"O12345AA" DEFINITIEIMPORT /F"<GET connector naam>.gcn"`. De ZIP bevat het `.gcn`-bestand plus een `@#$MetaInfo.xml` met `<InputFile_Name><GET connector naam>.gcn</InputFile_Name>`; de bestandsnaam in de opdrachtregel moet overeenkomen met het `.gcn`-bestand.
- **Status opvragen:** SOAP-actie `urn:Afas.Profit.Services/GetState` met `<token>` en `<commandId>`, mogelijk tot 24 uur na uitvoering. Een leeg `<GetStateResult>` betekent dat de import nog niet is opgepakt of voltooid; na voltooiing bevat het een base64-gecodeerde ZIP met het importlog — dit log wordt slechts **één keer** beschikbaar gesteld.

### Dossieritems aanmaken en workflowactie uitvoeren

Basisdossieritems maak je via **`KnSubject`** met het juiste type `StId` (typen via GetConnector **`Profit_SubjectTypes`**; via een integratie kun je alleen op vrije/plus-type `StId` insturen, uitzondering `-5`). Via object `KnSubjectLink` leg je een bestemming (o.a. Medewerker=2, Organisatie/persoon=3, Verkooprelatie=4, Project=5, Werkgever=10, Inkooprelatie=11, Sollicitant=17, Vervoermiddel=43, Plaatsing=54, Prijsafspraak=55). Kenmerkcombinaties/workflows haal je op via **`Profit_FeatureCombination`**; bijlagen via object `KnSubjectAttachment` (Base64). Een workflowstap voer je uit via **`KnSubjectWorkflowReaction`** (payload `KnWorkflow` met `SbId`, `WfNm`, `TkNm`, `AcNm`, `Tx`), waarbij je beschikbare taken ophaalt via **`Profit_Subject_Tasks`** en acties via **`Profit_Workflowactions`**. De tokengebruiker moet rechten hebben op de taak.

---

## 10. BI-modellen

BI-modellen worden uitgevraagd via **OData-connectoren** (Open Data Protocol) — koppelstukken waarmee applicaties standaard en veilig gegevens uitwisselen.

**Verschil met GetConnectoren.** Bij GetConnectoren wordt data op het moment van de aanvraag gegenereerd; bij complexe connectoren geeft dat langere wachttijden. Bij BI-modellen wordt data **vooraf berekend en opgeslagen**, wat de prestaties bij grote datasets aanzienlijk verbetert. BI-modellen zijn daardoor zeer geschikt voor rapportages en analyses.

**Versies en redirects.** De endpoints blijven consistent, maar een aanroep van het standaard-endpoint (bijv. `.../bi/Verkoopomzet`) wordt geredirect naar de meest recente versie (bijv. `.../bi/Verkoopomzet/v2/`). Je client moet redirects volgen.

**Pagination.** Client-side geef je `skip` en `top` mee (sortering hoeft niet, de server houdt een vaste volgorde aan). Zonder die parameters past de server **server-side pagination** toe: de response bevat een link naar de volgende pagina, tot er geen data meer is.

**Model bouwen.** Een BI-model maak je op basis van een bestaand BI-model (kopie) of een brontabel (bijv. *Financiële mutaties*). De editor maakt automatisch een **feitentabel** aan. Efficiënter dan één grote feitentabel is een **ster-model**: veelvoorkomende waarden zet je in een **dimensietabel** waarnaar de feitentabel verwijst (bijv. een debiteurnaam één keer opslaan met een verwijzing, in plaats van 150 keer). Een dimensie voeg je toe via rechtermuisknop → *Nieuwe dimensie* (alleen waarden die in de brontabel voorkomen) of *Nieuwe dimensie (alle waarden)* (alle beschikbare waarden). Sinds Profit 8 respecteren BI-modellen de filterautorisatie op de definitie, waardoor een OData-connector minder resultaten kan geven.

---

## 11. AppConnector Auditor & partnercertificering

### AppConnector Auditor

De **AppConnector Auditor** geeft snel inzicht in de kwaliteit van een AppConnector en de bijbehorende GetConnectoren, en kijkt naar de autorisatie in de omgeving. Vereist: een AFAS-omgeving, een ingerichte AppConnector van het type "Onderhoud door klant", en het recht `Autorisatie tool > Autorisatie > Algemeen > Beheer > App connector > Acties > AppConnector auditor`. Je start hem via **Algemeen > Beheer > App connector** → eigenschappen → **Acties** → **Auditor**, en slaat het resultaat op als PDF of HTML.

Er zijn drie rapportvarianten met oplopende striktheid: voor **eindgebruikers/functioneel beheerders** (`app-connector-auditor`), voor **developers** (`Auditor (voor ontwikkelaars)`, minder strikt) en voor **AFAS Partners** (`Auditor (voor partners)`, striktste eisen, gekoppeld aan certificering). Meldingen kennen drie niveaus: **Fout** (blokkeert certificering, moet opgelost), **Waarschuwing** (oplossen of onderbouwen) en **Informatief**.

**Checklist voor een gecertificeerde koppeling (selectie van de controles):**

- Een **eigen set GetConnectoren** in gebruik (geen meegeleverde `Profit_`-connectoren: die halen te veel data op, laten geen klantfilters toe en kunnen door AFAS gewijzigd worden). Melding `STRUCT-27`.
- GetConnector-namen mogen **niet met `Profit_` beginnen** (`STRUCT-28`) en veldnamen mogen **geen punt** bevatten (`STRUCT-29`).
- Alleen **bekende velden** aanwezig; onbekende velden geven de vaste waarde "(vervangen)" (`DATA-23`). Vrije velden moeten in de doelomgeving geïmporteerd zijn (`DATA-24`).
- **Meerdere dienstverbanden** correct verwerkt: gebruik overal `Dienstverband`, niet `Volgnummer dienstverband` (`DATA-20`, `DATA-21`).
- **Financiële mutaties / Nacalculatie** slim ophalen via de gegevensverzamelingen `Gewijzigde boekingsdagen` respectievelijk `Gewijzigde boekingsdagen nacalculatie` (`PERF-30`, `PERF-31`).

**Performance-aandachtspunten (indicatie: aanroepen die >10× langer duren dan vergelijkbare):** uitvragen van een van de 10 grootste tabellen (>1.000.000 regels), meer dan 10 joins, meer dan 5 niveaus diep, filteren met `bevat`/`begint met`/`eindigt op` (indexen worden dan niet gebruikt, >100× langzamer — gebruik gelijkheidsfilters op indexvelden, `FILT-47`), verdichting, functie-/speciale velden, en subselects.

**Autorisatie, tokens en beveiliging:** maak per AppConnector een eigen autorisatiegroep en één systeemgebruiker (geen medewerker en geen meewerkgebruiker; de connectorgebruiker heeft géén toegang tot Profit Windows nodig). Deel bij voorkeur één token uit, vervang tokens die >12 maanden oud zijn, en verwijder tokens die >3 maanden niet gebruikt zijn. Richt **IP-restricties** in (Toegang = "Toestaan" per IP of range; sinds Profit 8 in CIDR-notatie en op IPv6). De IP-adressen van AFAS Connect (`52.174.142.76` en `52.174.142.140`) mogen tijdens de testfase toegestaan worden, maar moeten daarna verwijderd worden. De auditor toont ook welke velden als **privacy-gevoelig** zijn gemarkeerd (AVG-risico) — haal alleen strikt noodzakelijke gegevens op (`AUT-19`).

### Partnergegevens en koppelingen in het rapport

Het partnerrapport toont bovenaan **Partnergegevens** (alleen zichtbaar voor de partner, uit de AFAS-partneradministratie): checklist (gegevens compleet, ≥2 contactpersonen voor partner-/expertcommunicatie, geldige pentest), abonnementsnummer (eerste deel van het IntegrationId), verantwoordelijke bij AFAS en de pentest-status. **Pentest-geldigheid:** Groen 3 jaar, Oranje 15 maanden, Rood 6 maanden (gerekend vanaf de datum op het rapport). Daaronder staan per aangemelde **koppeling** het IntegrationId, de projectcode, de AFAS-projectleider, teamleden, openstaande taken en de **deadline voor certificering** (startdatum + 12 maanden).

### Certificeringsstappen voor partners

- **Fase 1 — Starten:** security check (pentest, bij voorkeur door een CCV-erkende partij, of een Security Quickscan via Defion); contactpersonen aanmaken in de klantportal; **Support+** kosteloos activeren (geeft Systemintegrators toegang tot je testomgeving).
- **Fase 2 — Bouwen:** maak een AppConnector met token (in de testfase mag een classic token; in de uiteindelijke integratie moet de klant zelf een AppConnector aanmaken en verloopt authenticatie via **OAuth**); volg de gratis Specialisatiecursus Connector (maak je integraties voor andere partners, dan moet minimaal 1 collega de experttoets "Integraties" met minimaal een 7 hebben afgerond); stuur het **IntegrationId** mee bij elke aanroep; lever een **eigen set GetConnectoren** aan (koppeling zo standaard mogelijk, klanten hooguit ~10% afwijking) en controleer ze met de AppConnector Auditor; lever een **datastroomdiagram** (high-level data flow, PDF/PNG) en een **implementatiedocument** aan.
- **Fase 3 — Opleveren:** geef een **demo** als oplevermoment; **publiceer** de koppeling op de partnerportal (naam en logo van AFAS mogen dan gebruikt worden); lever **5 referenties** aan — je certificering is pas compleet bij ≥5 gezamenlijke klanten die de koppeling actief gebruiken (gecontroleerd via het IntegrationId).

**Certificeringscriteria (samengevat):** alle fouten opgelost, waarschuwingen opgelost of onderbouwd, geldige pentest, alle projecttaken afgerond, correct IntegrationId, geldig partnerabonnement, ≥5 actieve klanten en ≥2 contactpersonen. Ondersteuning door Systemintegrators is gratis tijdens de eerste 12 maanden van het traject en voor gecertificeerde partners; anders €200 per uur.

---

## 12. Troubleshooting

**Probleemanalyse.** (1) Maakt de client verbinding met de AFAS-server? Zo nee, dan is het een probleem in de client. (2) Krijg je een specifieke HTTP-code? Zoek dan de oplossing bij die code. (3) Om welk endpointtype gaat het? Voor GetConnectoren gebruik je de tooling op connect.afas.nl; voor UpdateConnectoren analyseer je de response-body (korte melding + logboekreferentie).

**Logging.** AFAS logt **alleen fouten** in het omgevingslogboek; succesvolle requests en verbindingsfouten worden niet gelogd, en request-bodies worden **nooit** gelogd. Zorg daarom voor voldoende logging in je client en sla bij errors zowel de request- als response-body op.

**Error-omschrijving (bij 5xx).** De response-body bevat `externalMessage` (korte omschrijving zoals in Profit, vaak beknopt), `errorNumber` (meestal een standaardcode, niet geschikt om op te interpreteren) en `profitLogReference` (referentie naar het omgevingslogboek — vermeld deze altijd; de beheerder of AFAS kan hiermee de volledige fout terugvinden). De header **`X-PROFIT-ERROR` is obsolete** — gebruik hem niet; lees de melding uit de body.

### HTTP-codes

| Code | Betekenis | Toelichting |
|------|-----------|-------------|
| 200 | OK | Request succesvol verwerkt, data in de response. |
| 201 | Created | Nieuwe resource aangemaakt; de sleutel staat meestal in de response-body. |
| 400 | Bad request | Ontbrekende elementen in de request (bijv. geen `method`-parameter). |
| 401 | Unauthorized | Geen geldige verificatie; opnieuw proberen zonder juiste gegevens mislukt weer. |
| 403 | Forbidden | Geldige request maar geweigerd door IP-restricties; opnieuw proberen mislukt. |
| 404 | Not Found | Resource niet gevonden (URL onjuist, verwijderd of verplaatst; ook bij te lange URL). |
| 500 | Internal Server Error | Inhoudelijke (functionele) validatiefout; beknopte uitleg + logboekreferentie in de response. |
| 503 | Service Unavailable | Server kan de request tijdelijk niet verwerken; opnieuw proberen kan slagen. |

**Retry-advies:** 500 = *soms* (bijv. wanneer een boekingslay-out tijdelijk geblokkeerd is bij `FiEntries`); 503 = *ja* (gebruik de `retry_after`-waarde uit de response-body, in seconden); 401 en 403 = *nee*.

**Timeout.** Time-outs komen zelden voor aan AFAS-zijde; meestal komen ze uit de client. De AFAS API heeft een time-out van **900 seconden (15 minuten)**, waarna een HTTP 500 volgt met "Command timeout expired." Wacht bij twijfel de 15 minuten af voordat je een retry doet, anders kan de vorige request nog draaien en raakt de database overbelast. Gebruik een back-off strategie (het how-to-materiaal bevat een JavaScript-voorbeeld met exponentiële back-off).

**Verbindingsfouten** geven geen HTTP-code (de server is niet bereikt). `connection reset by peer` kan komen door de header `connection: close`; stuur die niet mee of gebruik `connection: keep-alive`.

**GetConnector-fouten (voorbeelden):** "Connector-veld 'X' niet gevonden" (veld zit niet meer in de definitie — pas filter/sortering aan via metainfo); "GetConnector niet ondersteund voor deze app of gebruiker niet geautoriseerd" (laat de beheerder de connector aan de App Connector toevoegen, of controleer de naam); "Deze GetConnector (definitie) is geblokkeerd" (laat de beheerder deblokkeren); "Er is een onverwachte fout opgetreden" (bijv. ongeldige skip/take-combinatie zoals `skip=2&take=-1` — corrigeer de parameters).

**UpdateConnector-fouten** zijn meestal inhoudelijke HTTP 500's (bijv. "De ingevulde waarde bij 'Medewerker' bestaat niet."). Vraag bij twijfel de volledige log op via de `profitLogReference`; gebruik anders het forum op connect.afas.nl of laat de beheerder een ticket bij AFAS Support aanmaken.

### Performance van GetConnectoren optimaliseren

1. **Vast filter** aanmaken (beheerder) — vermijd trage snelfilters (`=AFAS Software B.V.` is veel sneller dan `Sf AFAS`).
2. **Alleen gewijzigde data** ophalen (ontwikkelaar) — filter op het wijzigingsdatum-veld.
3. **Skip & Take** gebruiken (ontwikkelaar) — niet -1/-1; richtlijn `Take = 150.000 / aantal velden` (bij 20 velden → 7.500). Altijd sorteren, bij voorkeur op een uniek veld.
4. **Formaat van velden** beperken (beheerder) — conversies (bijv. naar hoofdletters) kosten performance.
5. **Afbeeldingen** — overbodige afbeeldingen weghalen; gebruik de **ImageConnector** voor optimaal ophalen.
6. **Functievelden** beperken (beheerder) — worden per regel berekend.
7. Velden op een **zo hoog mogelijk niveau** uit de gegevensverzameling halen.
8. **Meerdere tabellen** in één gegevensverzameling vermijden waar mogelijk (joins kosten tijd).
9. **Filters op vrije velden** vermijden (geen index).
10. **Parallel** maximaal **8** aanroepen; plan ze niet allemaal tegelijk om databaseblokkades te vermijden.

---

## 13. Nieuws / changelog highlights

Beknopte tijdlijn van de belangrijkste API-wijzigingen per Profit-versie en van de API-documentatie.

### API Docs (v2)

- Uitgebreide API-specificatie met meer dan 1000 voorbeeld-requests (o.a. veel bij `KnEmployee`).
- Nieuwe **How-To's** en een **"Alle endpoints overzicht"** met alle standaard connectoren.
- Betere integratie met **AFAS Connect** (directe link vanuit UpdateConnectoren) en een tooltje **XML-token naar Base64**.
- Documentatie/How-To's tonen de datum van laatste wijziging; mobile-ready verbeterd (darkmode gepland).

### Profit 3

- **Breaking:** de bepaling van btw-terugvordering is gewijzigd (zie how-to Btw-terugvordering).
- Gewijzigde validatie op einddatum contract (`KnEmployee.AfasContract.DaEn`, kijkt naar "Onbepaalde tijd").
- Nieuw object `AfasPeriodiek` bij `KnEmployee` (vervangt per Profit 4 de periodiek-velden op `AfasContract`).
- Aankondiging: bij `FbConfrontation` wordt verwijzen naar de financiële-mutatieregel op `FbGoodsReceivedLines`-niveau vermoedelijk verplicht per Profit 4.
- Nieuwe gegevensverzameling "Administratieinstellingen Financieel incl. autorisatie"; nieuwe/gewijzigde endpoints o.a. `FbUnitBasicItem` DELETE en optionele `FiContract`-velden (`APBF`, `APEF`, `APFC`, `VaRV`).

### Profit 4

- **Breaking `FbConfrontation`:** bij "Confronteren op journaalpostnummer" zijn `EnNo` en `SeNo` op `FbGoodsReceivedLines`-niveau verplicht.
- **Breaking `KnEmployee`/`KnEmployeeGUID`:** `AfasPeriodiek` vervangt de periodiek-velden op `AfasContract`; nieuw verplicht veld `AfasIdentityDocument/.../ViTy`.
- Nieuwe UpdateConnector **`HrOnboarding`** (sollicitanten/nieuwe medewerkers opvoeren, ook zonder alle verplichte velden).
- `KnEmployeeGUID`: eigen GUID's meegeven bij POST is mogelijk.
- **Breaking:** `FiContract` — `VaRV` verplicht; `PtProject` — reeks `PtTaS...`-velden verwijderd; nieuwe endpoints `FbPurchaseSales` en `KnOrgUnit/.../@OuId` DELETE.

### Profit 5

- `HrOnboarding` uitgebreid met **bijlagen**.
- `KnEmployee`: meerdere persoonsdocumenten vastleggen mogelijk (`AfasIdentityDocument` uitgebreid).
- Grootste blok wijzigingen in de **Magazijn**-specificatie; verder o.a. Medewerker en contract, Inkoop en Dossiers.

### Profit 6

- **Breaking:** de AFAS-token moet in **Base64** in de Authorization-header; een foutieve aanroep geeft **HTTP 500**.
- **Obsolete:** response-header `X-PROFIT-ERROR`.
- Nieuwe gegevensverzamelingen voor GetConnectoren: **"Profiel (Profit)"** en **"Dienstverband (incl. autorisatie)"**.
- **Breaking:** enum-waarde `KS` verwijderd uit `PsNa`/`ViNa` bij vele connectoren (o.a. `KnEmployee`, `KnPerson`, `KnOrganisation`, `KnSalesRelationOrg`/`-Per`, `HrApplicant`, `HrOnboarding`); DELETE-pad `KnAddress/.../@Ad` verwijderd.

### Profit 7

- **Breaking:** een verkeerd doorgestuurde token in de Authorization-header geeft een foutmelding; gebruik `AfasToken <base64-encoded token>`.
- Nieuwe **Fiscaal-connectoren**: o.a. `Profit_CommercialSpecs`, `TxClientIB2021/2024/2025`, `TxClientVpb2021/2024/2025`, `TxCFVpb2021/2024/2025`.
- Nieuwe gegevensverzameling **Aangiftegegevens** (IB) met veld `JSON aangifte`; Custom Connectors nu ook zichtbaar in de metainfo-request.
- Gewijzigde formattering van GetConnector-resultaten (Profit schrijft nu zelf de JSON/XML) en van de metainfo-requests.
- Nieuwe response-header **`X-Trace-Identifier`** (uniek per aanroep) voor tracing/debugging.
- Nationaliteit "Namibië" gewijzigd van `SWA` naar `NAM` (veel breaking changes, zelden een praktijkprobleem); nieuwe verplichte contractvelden `DvbDvCh` en `DvbTCh1`–`DvbTCh5` bij `KnEmployee` (POST) en `HrOnboarding`.

### Profit 8

- Nieuw: **Webhooks** in Profit.
- Afletteren van facturen/vooruitbetalingen via **`FiEntries`** met nieuw veld **Factuurnr. (intern)** id `InI2`.
- IP-restricties op de AppConnector nu in **CIDR-notatie** en op **IPv6**; **mTLS**-ondersteuning voorbereid (infrastructuur vanaf september 2026); **Microsoft Entra ID-koppeling** nu standaard.
- BI-modellen respecteren nu filterautorisatie op de definitie; acties Nieuw/Importeren/Exporteren apart autoriseerbaar.
- **Breaking:** taalcodes vereenvoudigd (volledige Microsoft-taaltabel, geen ISO-taalcodes meer); `FbPurRequisition` stelt hogere eisen aan verbijzonderingscodes; grote lijst enum-waarden verwijderd uit `AfasIdentityDocument/.../ViTt` en `AfasResidenceDocument/.../ViTt` bij `KnEmployee`/`KnEmployeeGUID`.

### Profit 9

> De release notes zijn nog in **concept** en worden bijgewerkt zodra Profit 9 op Accept beschikbaar komt.

- **Breaking:** een GetConnector gebaseerd op *Medewerker/berekende grondslagen* geeft nog maar **één regel per periode** (altijd de laatste regel van de periode), ook als de medewerker meerdere salarisregels in die periode heeft (alias `Medewerker/salaris`). Werkt daarmee gelijk aan een GetConnector op *Medewerker/berekende looncomponenten*.
- **`KnUser`:** het veld `InLn` (Voorkeur site) is vervallen en wordt niet langer ondersteund — haal het uit je koppeling. De voorkeur-InSite (vervanger) is niet via de UpdateConnector te vullen; de gebruiker stelt die zelf in op de InSite-pagina Mijn gegevens. Bij conversie krijgt elke gebruiker met een taalvoorkeur automatisch de bijbehorende InSite; anders bevat de link de Hoofd-InSite.
- **OAuth uitgebreid:** public client met PKCE en DPoP, private key JWT, `client_secret_basic`, geldigheidsduur voor client secrets (standaard 180 dagen), overstap van classic token via authenticatietype Hybride/OAuth, en strengere foutafhandeling (zie hoofdstuk 3).

---

_Bron: AFAS OASContent (github.com/AFASSoftware/OASContent), commit 112c52071d663752b3103bc95848c8861cd1d7a5. Scope: Profit, Nederlands._
