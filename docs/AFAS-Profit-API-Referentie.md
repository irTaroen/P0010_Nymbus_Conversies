# AFAS Profit API-Referentie

> Veld- en payload-referentie voor de UpdateConnectors en GetConnectors van AFAS Profit. Dit document is de technische companion bij de afzonderlijke, conceptuele *AFAS Profit ERP-kennisbank*: hier staan de exacte veldcodes, payloadstructuren en endpoints; de kennisbank behandelt de functionele ERP-concepten.

## 1. Inleiding & scope

Dit document beschrijft de **payload- en veldstructuur** van de AFAS Profit REST API, zoals gepubliceerd in de openbare repository [AFAS OASContent](https://github.com/AFASSoftware/OASContent). Het is bedoeld voor ontwikkelaars die een koppeling bouwen met AFAS Profit.

**Scope en uitgangspunten:**

- **Alleen Profit.** SB-connectoren (Small Business) vallen buiten dit document.
- **Nederlandstalig.** De toelichtende teksten zijn in het Nederlands. Veldcodes en objectnamen (bijvoorbeeld `KnPerson`, `MatchOga`, `BcCo`) blijven in hun oorspronkelijke vorm, exact zoals in de bron.
- **Bron.** Alle veldcodes, veldnamen, types en endpoints komen rechtstreeks uit de OpenAPI-specificaties (`OpenApiSpecs/profit/en/*.json`) en de Nederlandstalige endpoint-documentatie (`markdownpages/endpoint/nl/*.md`) van de repository. Er zijn geen veldcodes of types verzonnen.
- De veldbeschrijvingen (kolom *Naam/omschrijving*) zijn overgenomen uit de OpenAPI-specificatie. Waar in de specificatie een codelijst (enumeratie) hoort, is dit gemarkeerd met "(met codelijst)"; de volledige codelijst staat in de OpenAPI-specificatie en de Meta-info van het endpoint.

De API bestaat uit twee soorten connectoren:

- **UpdateConnectors** — voor het aanmaken (POST), wijzigen (PUT) en verwijderen (DELETE) van records. Deze bepalen de payload/veldstructuur en vormen de kern van dit document.
- **GetConnectors** — voor het ophalen (GET) van records. Zie hoofdstuk 5.

### Basis-URL en endpoints

Alle connectoren worden aangeroepen op de Profit REST-service. De basis-URL bevat een 5-cijferig omgevingsnummer:

| Omgeving | Basis-URL |
|---|---|
| Productie | `https://{id}.rest.afas.online/ProfitRestServices` |
| Test | `https://{id}.resttest.afas.online/ProfitRestServices` |
| Accept | `https://{id}.restaccept.afas.online/ProfitRestServices` |
| Cursus | `https://{id}.restcursus.afas.online/ProfitRestServices` |

Een UpdateConnector roep je aan via het pad `/connectors/{ConnectorNaam}`, bijvoorbeeld:

```
POST https://12345.rest.afas.online/ProfitRestServices/connectors/KnUser
```

**Headers** (uit de brondocumentatie):

```
Accept: application/json
Accept-Language: nl-nl
Authorization: AfasToken <base64-token>
Content-Type: application/json
```

> Bij OAuth vervang je de `Authorization`-header door `Authorization: Bearer <access_token>` (confidential client) of `Authorization: DPoP <access_token>` plus een `DPoP`-proofheader (public client, Profit 9). Classic tokens (`AfasToken`) worden uitgefaseerd: bestaande tokens verlopen op 1 mei 2027 en na 31 augustus 2027 werken app connectoren met een classic token niet meer. Zie hoofdstuk 3 van de ERP-kennisbank.

## 2. Algemene payload-structuur van UpdateConnectors

Een UpdateConnector-payload (JSON) is opgebouwd volgens een vast nestingpatroon:

```
{
  "<Connector>": {                // hoofdobject, bv. KnPerson, KnOrganisation
    "Element": {                  // één record (of een array van records)
      "@<Sleutel>": "...",        // @-attributen: sleutel- en matchvelden
      "Fields": {                 // de eigenlijke veldwaarden
        "@Action": "insert",      // optioneel: insert | update | delete
        "<Veldcode>": "<waarde>"
      },
      "Objects": [                // optioneel: geneste subobjecten
        {
          "<SubConnector>": {
            "Element": { "Fields": { ... } }
          }
        }
      ]
    }
  }
}
```

### Element / Fields / Objects

- **Element** — bevat één record. Bij connectoren die meerdere regels toestaan, is `Element` een array van records.
- **Fields** — de losse veldwaarden. Elke veldcode (bijvoorbeeld `Nm`, `BcCo`, `EmId`) hoort hier.
- **Objects** — geneste subobjecten. Zo bevat `KnOrganisation` bijvoorbeeld de subobjecten `KnBasicAddressAdr` (adres), `KnBasicAddressPad` (postadres), `KnBankAccount` en `KnPerson`. De nesting kan tot circa 6 niveaus diep gaan (met name bij medewerker- en orderconnectoren).

### @-attributen (sleutel- en matchvelden)

Velden die met een `@` beginnen, geven aan hoe Profit het record verwerkt: als sleutel (primary key) of als actie. Enkele belangrijke voorbeelden:

- **`@Action`** — de actie op (sub)objectniveau, binnen `Fields`. Toegestane waarden: `insert`, `update`, `delete`. Hiermee kun je in één request bijvoorbeeld het hoofdobject updaten en een subobject inserten. De volledige body wordt gevalideerd en als één transactie verwerkt.
- **Matchvelden** bepalen of Profit een bestaand record hergebruikt of een nieuw record aanmaakt, bijvoorbeeld:
  - **`MatchOga`** (op `KnOrganisation`) — organisatie vergelijken op: `0` = zoek op BcCo; `1` = KvK-nummer; `2` = fiscaal nummer; `3` = naam; `4` = adres; `5` = postadres; `6` = altijd nieuw toevoegen.
  - **`MatchPer`** (op `KnPerson`) — persoon vergelijken op onder andere BcCo, BSN, naam+geboortedatum, of "altijd nieuw toevoegen".
- Sleutel-attributen zoals `@UsId`, `@EmId`, `@ApId`, `@CcSn` staan op `Element`-niveau en identificeren het record.

### Verplichte velden

In de OpenAPI-specificatie is per `Fields`-blok een `required`-lijst opgenomen. In de veldtabellen hieronder is dit weergegeven in de kolom **Verplicht** (`Ja`). Bij een **POST** zijn dit de velden die minimaal aangeleverd moeten worden. Bij een **PUT** zijn doorgaans alléén de sleutelvelden verplicht; een PUT werkt alle meegegeven velden bij (een lege waarde `""` maakt een veld leeg).

### Twee methoden voor acties op subobjecten

1. **`@Action`-tag in de body** — geschikt voor complexe, diep geneste structuren met verschillende acties per object (bv. `KnEmployee`, `FbDeliveryNote`, `FbSales`).
2. **Subobject via de URL** — bijvoorbeeld `POST /connectors/HrMobility/HrEmployeeMobilityRegistration` maakt direct een subobject aan, optioneel met update van het hoofdobject.

### Response

Een geslaagde POST geeft doorgaans `HTTP 201`. De response-body bevat het `FieldId` (de primary key) van het aangemaakte object, bijvoorbeeld:

```json
{ "results": { "KnSubject": { "SbId": "999999" } } }
```

Een `HTTP 500` betekent dat de body niet succesvol gevalideerd kon worden (bijvoorbeeld: BSN voldoet niet aan de 11-proef, adres mist een landcode, of een financiële mutatie is niet in balans).

## 3. Overzicht van connectoren per domein

De UpdateConnectors zijn in de OpenAPI-specificaties gegroepeerd per functioneel domein (één JSON-bestand per domein). Onderstaande tabel geeft de belangrijkste connectoren met hun domein en doel. Daarna volgt de volledige lijst per domein.

### Belangrijkste connectoren

| Connector-code | Domein | Doel |
|---|---|---|
| `KnPerson` | Organisaties en personen | Persoon aanmaken/wijzigen (ook als subobject) |
| `KnOrganisation` | Organisaties en personen | Organisatie aanmaken/wijzigen |
| `KnContact` | Organisaties en personen | Contactpersoon bij organisatie |
| `KnAddress` | Organisaties en personen | Los adres toevoegen/verwijderen |
| `KnSalesRelationOrg` / `KnSalesRelationPer` | Organisaties en personen | Verkooprelatie (debiteur) org/persoon |
| `KnPurchaseRelationOrg` / `KnPurchaseRelationPer` | Inkoop / Org. en personen | Inkooprelatie (crediteur) org/persoon |
| `KnUser` | Organisaties en personen | Gebruiker aanmaken/wijzigen |
| `KnEmployee` / `KnEmployeeGUID` | Medewerker en contract | Medewerker + contract/rooster/functie/salaris |
| `KnSubject` | Dossiers, bijlagen en workflows | Dossieritem (notitie/document) vastleggen |
| `KnSubjectWorkflowReaction` | Dossiers, bijlagen en workflows | Workflow-reactie op dossieritem |
| `FiEntries` | Mutaties | Financiële mutatie (journaalpost) |
| `FiElectronicInvoicePurchase` | Mutaties | E-inkoopfactuur insturen (UBL/PDF) |
| `FbConfrontation` | Mutaties | Confrontatie/afletteren |
| `HrCompMut` | Loonadministratie | Salaris-/component­mutatie |
| `HrAbsence` | Verlof en Ziekte | Verlofboeking |
| `HrIllness` | Verlof en Ziekte | Ziekmelding |
| `HrRelative` | Overige | Familielid-mutatie (via workflow) |
| `HrOnboarding` | Werving en selectie | Onboardingproces nieuwe medewerker |
| `PtLinesToBeUnraveled` | Projecten en nacalculatie | Gewerkte uren (ontrafeling naar urensoorten) |
| `PtPriceAgreement` | Flex | Prijsafspraak |
| `FbSales` | Verkoop en Orders | Verkooporder |
| `FbPurch` | Inkoop | Inkooporder |
| `KnBankTransaction` | Financiële Inrichting | Bankmutatie/-transactie |
| `FiFixedAssets` | Budgetten en activa | Vaste activa |

> **Profit 9 — `KnUser`:** het veld `InLn` (Voorkeur site) is vervallen en wordt niet langer ondersteund; stuur het niet meer mee. De vervangende voorkeur-InSite is niet via de UpdateConnector te vullen (bron: release notes Profit 9, concept). De OpenAPI-specificatie in de bron is hierop nog niet aangepast.

### Volledige lijst per domein

_Alle POST-UpdateConnectors per OpenAPI-specificatiebestand (domein), met de API-versie uit de specificatie._

### Artikelen  (API-versie 8.8.11, 10 UpdateConnectors)

`FbBatchNumber`, `FbComposition`, `FbCostPrice`, `FbGenSSCCForBit`, `FbItemArticle`, `FbSerialNumber`, `FbUnitBasicItem`, `FbUpdateAdB`, `PtPriceRevisionFormula`, `PtPriceRevisionIndex`

### Bakkerijen  (API-versie 8.8.11, 3 UpdateConnectors)

`FbDough`, `FbDoughLines`, `FbRawMaterialIngredient`

### Bouw  (API-versie 8.8.11, 6 UpdateConnectors)

`PtAllowedOutPurch`, `PtConProjectForecast`, `PtMeasurement`, `PtMonitor`, `PtOptionList`, `PtOptionListLine`

### Budgetten en activa  (API-versie 8.8.11, 8 UpdateConnectors)

`FiBudget`, `FiBudgetRequest`, `FiCommitment`, `FiContract`, `FiFixedAssets`, `FiFixedAssetsBuy`, `FiFixedAssetsSale`, `FiReservation`

### Cursusmanagement  (API-versie 8.8.11, 3 UpdateConnectors)

`KnCourseEvent`, `KnCourseGroupLines`, `KnCourseMember`

### Dossiers en bijlagen en workflows  (API-versie 8.8.11, 4 UpdateConnectors)

`KnSubject`, `KnSubjectDynamic`, `KnSubjectReaction`, `KnSubjectWorkflowReaction`

### Financiële Inrichting  (API-versie 8.8.11, 4 UpdateConnectors)

`FiIVY`, `KnAccount`, `KnBankTransaction`, `KnDimCode`

### Fiscaal  (API-versie 8.8.11, 17 UpdateConnectors)

`TxCFVpb2021`, `TxCFVpb2022`, `TxCFVpb2023`, `TxCFVpb2024`, `TxCFVpb2025`, `TxClientIB2021`, `TxClientIB2022`, `TxClientIB2023`, `TxClientIB2024`, `TxClientIB2025`, `TxClientVpb2021`, `TxClientVpb2022`, `TxClientVpb2023`, `TxClientVpb2024`, `TxClientVpb2025`, `TxKlaarzettenAangifte`, `TxMachtiging`

### Flex  (API-versie 8.8.11, 14 UpdateConnectors)

`HrReservation`, `KnSreCostCentre`, `PtConceptPlacementContract`, `PtCostPriceComponent`, `PtCostPriceModel`, `PtCostPriceModelPerProject`, `PtDeclaration`, `PtDeclarationCorrection`, `PtFunction`, `PtItemSet`, `PtItemSetFunction`, `PtPlacementContract`, `PtPriceAgreement`, `PtTariff`

### Inkoop  (API-versie 8.8.11, 12 UpdateConnectors)

`FbBitVatTarifGroup`, `FbDelNoteReceived`, `FbGoodsReceived`, `FbIncomingGoods`, `FbPurRequisition`, `FbPurch`, `FbPurchPrice`, `FbPurchQuotation`, `FbStandardPrice`, `FiProcurationLines`, `KnPurchaseRelationOrg`, `KnPurchaseRelationPer`

### Inrichting  (API-versie 8.8.11, 33 UpdateConnectors)

`KnCSRLine`, `KnCustomK01`, `KnCustomK02`, `KnCustomK03`, `KnCustomK04`, `KnCustomK05`, `KnCustomK06`, `KnCustomK07`, `KnCustomK08`, `KnCustomK09`, `KnCustomK10`, `KnCustomLinkC01`, `KnCustomLinkC02`, `KnCustomLinkC03`, `KnCustomLinkC04`, `KnCustomLinkC05`, `KnCustomLinkC06`, `KnCustomLinkC07`, `KnCustomLinkC08`, `KnCustomLinkC09`, `KnCustomLinkC10`, `KnCustomLinkC11`, `KnCustomLinkC12`, `KnCustomLinkC13`, `KnCustomLinkC14`, `KnCustomLinkC15`, `KnCustomLinkC16`, `KnCustomLinkC17`, `KnCustomLinkC18`, `KnCustomLinkC19`, `KnCustomLinkC20`, `KnKpiRow`, `KnPeppol`

### Loonadministratie  (API-versie 8.8.11, 7 UpdateConnectors)

`HrCalculationplan`, `HrCompMut`, `HrCompMutGUID`, `HrEmpCareerHistory`, `HrEmpPaySlip`, `HrEmployeeDeposit`, `HrVarValue`

### Magazijn  (API-versie 8.8.11, 9 UpdateConnectors)

`FbExtraBarcode`, `FbGoodsReceived`, `FbItemCodeWarehouse`, `FbPurchaseSales`, `FbStockMutation`, `FbUpdateStocktaking`, `FbWarTransferIn`, `FbWarTransferOut`, `FbWarTransferPrep`

### Medewerker en contract  (API-versie 8.8.11, 5 UpdateConnectors)

`HrEmpPayDoc`, `HrEmpTravelDistance`, `KnEmployee`, `KnEmployeeGUID`, `KnOrgEmrFun`

### Mutaties  (API-versie 8.8.11, 6 UpdateConnectors)

`FbConfrontation`, `FbInstalment`, `FiElectronicInvoicePurchase`, `FiEntries`, `FiLoan`, `FiSepaDirectDebit`

### Organisaties en personen  (API-versie 8.8.11, 32 UpdateConnectors)

`KnAddress`, `KnAppointment`, `KnCurrencyRates`, `KnCustomLinkC01`, `KnCustomLinkC03`, `KnCustomLinkC04`, `KnCustomLinkC05`, `KnCustomLinkC06`, `KnCustomLinkC07`, `KnCustomLinkC08`, `KnCustomLinkC09`, `KnCustomLinkC10`, `KnCustomLinkC11`, `KnCustomLinkC12`, `KnCustomLinkC13`, `KnCustomLinkC14`, `KnCustomLinkC15`, `KnCustomLinkC16`, `KnCustomLinkC17`, `KnCustomLinkC18`, `KnCustomLinkC19`, `KnCustomLinkC20`, `KnOrganisation`, `KnPerson`, `KnProfileContactRole`, `KnProvApplication`, `KnPurchaseRelationOrg`, `KnPurchaseRelationPer`, `KnRelationship`, `KnSalesRelationOrg`, `KnSalesRelationPer`, `KnUser`

### Overige  (API-versie 8.8.11, 29 UpdateConnectors)

`FbDeliveryNoteFast`, `FbGoodsReceivedPocket`, `HrCareerBreak`, `HrDeclarationInSite`, `HrEmpBinMutInSite`, `HrEmpCourse`, `HrEmpEwhMutInsite`, `HrEmpMutInSite`, `HrEmpWorkLocation`, `HrEmployeeWorkweekTransition`, `HrEmployeeducationScope`, `HrFavTravelDeclarations`, `HrJudgement`, `HrMobility`, `HrRelative`, `HrSelectionModel`, `HrTimeRegSocSec`, `KnCustomK01`, `KnCustomK02`, `KnCustomK03`, `KnCustomK04`, `KnCustomK05`, `KnCustomK06`, `KnCustomK07`, `KnCustomK08`, `KnCustomK09`, `KnCustomK10`, `KnDayContract`, `KnPocketNotStatus`

### Projecten en nacalculatie  (API-versie 8.8.11, 13 UpdateConnectors)

`KnQuotation`, `KnTeamMember`, `PtLinesToBeInvoiced`, `PtLinesToBeUnraveled`, `PtPrognosisProject`, `PtProject`, `PtProjectDimCode`, `PtProjectProgress`, `PtProjectRaiseRules`, `PtRealization`, `PtRealizationWeek`, `PtTariff`, `PtValComb`

### Verkoop en Orders  (API-versie 8.8.11, 17 UpdateConnectors)

`CmForecast`, `CmForecastContactMoment`, `FbAssembly`, `FbAssemblyPrep`, `FbDeliveryNote`, `FbDirectInvoice`, `FbFreeOrder`, `FbGenSSCCForDen`, `FbItemCodeCustomer`, `FbItemCodeSupplier`, `FbProductGroup`, `FbProductGroupLines`, `FbSales`, `FbSalesPrice`, `FbSalesQuotation`, `FbSettleOrder`, `FbSubscription`

### Verlof en Ziekte  (API-versie 8.8.11, 8 UpdateConnectors)

`HrAbsCorrection`, `HrAbsence`, `HrAbsenceID`, `HrAbsenceInSite`, `HrIllness`, `HrIllnessGUID`, `HrIllnessInSite`, `HrIllnessProgressInSite`

### Werkgever  (API-versie 8.8.11, 6 UpdateConnectors)

`HrCostCarrier`, `HrCostCentre`, `HrEmployerDeclarationInSite`, `HrSalTable`, `KnOrgEmrFun`, `KnOrgUnit`

### Werving en selectie  (API-versie 8.8.11, 5 UpdateConnectors)

`HrApplicant`, `HrCreateApplicant`, `HrOnboarding`, `HrVacancy`, `HrVacancyJobalert`

## 4. Belangrijke connectoren met veldtabellen

Per connector volgt een korte toelichting en een veldtabel per (sub)object. De tabellen tonen: **Veldcode** (exact uit de bron), **Naam/omschrijving**, **Type**, **Max** (maximale lengte indien opgegeven) en **Verplicht**. Alleen het hoofdelement en de belangrijkste directe subobjecten worden getoond; diepere nesting staat volledig in de OpenAPI-specificatie.

### 4.1 KnPerson — Persoon

Aanmaken of aanpassen van een persoon. Beschikbaar als losse UpdateConnector, maar ook als subobject bij onder andere `KnOrganisation` en `KnEmployee`; de werking is nagenoeg identiek. De subobjecten ondersteunen geen van alle meerdere regels (voor bijvoorbeeld meerdere bankrekeningen zijn meerdere calls nodig). Het matchveld `MatchPer` bepaalt of een bestaande persoon wordt hergebruikt.
<!-- bron: Organisaties en personen.json -->

**KnPerson** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `AutoNum` | Autonummering | boolean |  | Ja |
| `MatchPer` | Persoon vergelijken op (met codelijst) | string | 1 | Ja |
| `BcId` | Organisation/Person (internal) | integer |  | Ja |
| `BcCo` | Number | string | 15 | Ja |
| `SeNm` | Search name | string | 10 |  |
| `CaNm` | Usual name | string | 80 |  |
| `FiNm` | First name | string | 50 |  |
| `In` | Initials | string | 15 |  |
| `Is` | Prefix | string | 15 |  |
| `LaNm` | Last name | string | 80 |  |
| `SpNm` | Enter surname at birth seperately | boolean |  |  |
| `IsBi` | Birth name prefix | string | 15 |  |
| `NmBi` | Surname at birth | string | 80 |  |
| `IsPa` | Prefix partner | string | 15 |  |
| `NmPa` | Partner's usual name | string | 80 |  |
| `ViUs` | Name use (met codelijst) | string | 20 |  |
| `ViGe` | Gender (met codelijst) | string | 20 |  |
| `PsNa` | Nationality (met codelijst) | string | 20 |  |
| `DaBi` | Date of birth | string |  |  |
| `CoBi` | Country of birth | string | 3 |  |
| `RsBi` | Place of birth | string | 50 |  |
| `SoSe` | 'BSN' | string | 25 |  |
| `Sdla` | Personal ID | string | 10 |  |
| `ViCs` | Marital status (met codelijst) | string | 20 |  |
| `DaMa` | Wedding date | string |  |  |
| `DaDi` | Date of divorce | string |  |  |
| `DaDe` | Date deceased | string |  |  |
| `TtId` | Title/salutation | string | 3 |  |
| `TtEx` | Secondary title | string | 3 |  |
| `LeHe` | Salutation | string | 255 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `TeN2` | Personal phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `MbN2` | Private mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `EmA2` | Personal e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `Re` | Remark | string |  |  |
| `StId` | Status | string | 20 |  |
| `SocN` | Social media | string | 255 |  |
| `CrIb` | CRIB number | string | 9 |  |
| `Face` | Facebook | string | 255 |  |
| `Link` | LinkedIn | string | 255 |  |
| `Twtr` | X (formerly Twitter) | string | 255 |  |
| `LgId` | Language | string | 5 |  |
| `CoLw` | Legislative country | string | 2 |  |
| `CcNr` | CoC number | string | 30 |  |
| `CcDa` | CoC date | string |  |  |
| `BrNr` | Branch number | string | 30 |  |
| `FiNr` | Fiscal number | string | 9 |  |
| `EmAm` | Number of employees (met codelijst) | string | 20 |  |
| `SBIc` | SBI code | string | 10 |  |
| `FileId` | Bestand | string | 32 |  |
| `FileName` | Naam bestand | string | 255 |  |
| `FileStream` | Afbeelding | string |  |  |
| `AddToPortal` | Persoon toegang geven tot afgeschermde deel van de portal(s) | boolean |  | Ja |
| `EmailPortal` | E-mail toegang | string | 255 |  |

**KnPerson / KnContactAutRole** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `AutRoleDs` | Autorisatierol | string | 80 | Ja |

**KnPerson / KnBankAccount** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country of bank | string | 3 | Ja |
| `IbCk` | IBAN check | boolean |  |  |
| `Iban` | IBAN number | string | 40 |  |
| `BaAc` | Bank account | string | 40 |  |
| `BkTp` | Bank type | integer |  |  |
| `BkIc` | Bank | string | 15 |  |
| `AcGa` | 'G'-account | boolean |  |  |
| `AcCk` | Cheque | boolean |  |  |
| `DiNm` | Deviating name | string | 80 |  |
| `DiPl` | Deviating city | string | 35 |  |
| `Bic` | BIC code | string | 11 |  |
| `BaNm` | Name of the bank | string | 35 |  |
| `BaFi` | Branch of the bank | string | 35 |  |
| `BaAd` | Bank address | string | 35 |  |
| `BaPl` | Bank business location | string | 35 |  |
| `CalM` | On-charge code (met codelijst) | string | 20 |  |

**KnPerson / KnBasicAddressAdr** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country | string | 3 | Ja |
| `PbAd` | P.O. Box address | boolean |  | Ja |
| `StAd` | Add. for street | string | 255 |  |
| `Ad` | Street | string | 60 |  |
| `HmNr` | House number | integer |  |  |
| `HmAd` | Extension (a, b, etc.) to house number | string | 30 |  |
| `ZpCd` | Postal code | string | 15 |  |
| `Rs` | City | string | 50 |  |
| `AdAd` | Addition to address | string | 255 |  |
| `BeginDate` | Ingangsdatum adreswijziging (wordt genegeerd bij eerste datum) | string |  | Ja |
| `ResZip` | Zoek woonplaats bij postcode | boolean |  | Ja |

**KnPerson / KnBasicAddressPad** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country | string | 3 | Ja |
| `PbAd` | P.O. Box address | boolean |  | Ja |
| `StAd` | Add. for street | string | 255 |  |
| `Ad` | Street | string | 60 |  |
| `HmNr` | House number | integer |  |  |
| `HmAd` | Extension (a, b, etc.) to house number | string | 30 |  |
| `ZpCd` | Postal code | string | 15 |  |
| `Rs` | City | string | 50 |  |
| `AdAd` | Addition to address | string | 255 |  |
| `BeginDate` | Ingangsdatum adreswijziging (wordt genegeerd bij eerste datum) | string |  | Ja |
| `ResZip` | Zoek woonplaats bij postcode | boolean |  | Ja |

**KnPerson / KnContact** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `ViKc` | Soort Contact (met codelijst) | string | 3 |  |
| `ExAd` | Department | string | 255 |  |
| `ViFu` | Job (met codelijst) | string | 20 |  |
| `FuDs` | Job on business card | string | 50 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Re` | Comment | string |  |  |
| `Bl` | Blocked | boolean |  |  |
| `AtLn` | Attn. of line | string | 255 |  |
| `LeHe` | Salutation | string | 255 |  |
| `SocN` | Social media | string | 255 |  |
| `Face` | Facebook | string | 255 |  |
| `Link` | LinkedIn | string | 255 |  |
| `Twtr` | X (formerly Twitter) | string | 255 |  |

### 4.2 KnOrganisation — Organisatie

Aanmaken of aanpassen van een organisatie. Ook beschikbaar als subobject (bv. bij `KnSalesRelationOrg`). Subobjecten: `KnBasicAddressAdr` (adres), `KnBasicAddressPad` (postadres — genegeerd als `PadAdr` = true), `KnBankAccount` en `KnPerson`. Het matchveld `MatchOga` bepaalt of een bestaande organisatie wordt hergebruikt.
<!-- bron: Organisaties en personen.json -->

**KnOrganisation** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `AutoNum` | Autonummering | boolean |  | Ja |
| `MatchOga` | Organisatie vergelijken op (met codelijst) | string | 1 | Ja |
| `BcId` | Organisation/Person (internal) | integer |  | Ja |
| `BcCo` | Number | string | 15 | Ja |
| `SeNm` | Search name | string | 10 |  |
| `Nm` | Name | string | 255 | Ja |
| `ViLe` | Legal form (met codelijst) | string | 20 |  |
| `ViLb` | Sector (met codelijst) | string | 20 |  |
| `CcNr` | CoC number | string | 30 |  |
| `CcDa` | CoC date | string |  |  |
| `BrNr` | Branch number | string | 30 |  |
| `NmRg` | Name (statutory) | string | 80 |  |
| `RsRg` | Registered office | string | 50 |  |
| `TtId` | Title/salutation | string | 3 |  |
| `LeHe` | Salutation | string | 255 |  |
| `OuId` | Organisational unit | string | 10 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `Re` | Remark | string |  |  |
| `FiNr` | Fiscal number | string | 9 |  |
| `StId` | Status | string | 20 |  |
| `EmAm` | Number of employees (met codelijst) | string | 20 |  |
| `SocN` | Social media | string | 255 |  |
| `CrIb` | CRIB number | string | 9 |  |
| `Face` | Facebook | string | 255 |  |
| `Link` | LinkedIn | string | 255 |  |
| `Twtr` | X (formerly Twitter) | string | 255 |  |
| `LgId` | Language | string | 5 |  |
| `XpRe` | External key | string | 40 |  |
| `SBIc` | SBI code | string | 10 |  |
| `BcPa` | Part of organisation | string | 15 |  |
| `FileId` | Bestand id | string | 32 |  |
| `FileName` | Naam bestand | string | 255 |  |
| `FileStream` | Afbeelding | string |  |  |

**KnOrganisation / KnBankAccount** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country of bank | string | 3 | Ja |
| `IbCk` | IBAN check | boolean |  |  |
| `Iban` | IBAN number | string | 40 |  |
| `BaAc` | Bank account | string | 40 |  |
| `BkTp` | Bank type | integer |  |  |
| `BkIc` | Bank | string | 15 |  |
| `AcGa` | 'G'-account | boolean |  |  |
| `AcCk` | Cheque | boolean |  |  |
| `DiNm` | Deviating name | string | 80 |  |
| `DiPl` | Deviating city | string | 35 |  |
| `Bic` | BIC code | string | 11 |  |
| `BaNm` | Name of the bank | string | 35 |  |
| `BaFi` | Branch of the bank | string | 35 |  |
| `BaAd` | Bank address | string | 35 |  |
| `BaPl` | Bank business location | string | 35 |  |
| `CalM` | On-charge code (met codelijst) | string | 20 |  |

**KnOrganisation / KnBasicAddressAdr** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country | string | 3 | Ja |
| `PbAd` | P.O. Box address | boolean |  | Ja |
| `StAd` | Add. for street | string | 255 |  |
| `Ad` | Street | string | 60 |  |
| `HmNr` | House number | integer |  |  |
| `HmAd` | Extension (a, b, etc.) to house number | string | 30 |  |
| `ZpCd` | Postal code | string | 15 |  |
| `Rs` | City | string | 50 |  |
| `AdAd` | Addition to address | string | 255 |  |
| `BeginDate` | Ingangsdatum adreswijziging (wordt genegeerd bij eerste datum) | string |  | Ja |
| `ResZip` | Zoek woonplaats bij postcode | boolean |  | Ja |

**KnOrganisation / KnBasicAddressPad** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CoId` | Country | string | 3 | Ja |
| `PbAd` | P.O. Box address | boolean |  | Ja |
| `StAd` | Add. for street | string | 255 |  |
| `Ad` | Street | string | 60 |  |
| `HmNr` | House number | integer |  |  |
| `HmAd` | Extension (a, b, etc.) to house number | string | 30 |  |
| `ZpCd` | Postal code | string | 15 |  |
| `Rs` | City | string | 50 |  |
| `AdAd` | Addition to address | string | 255 |  |
| `BeginDate` | Ingangsdatum adreswijziging (wordt genegeerd bij eerste datum) | string |  | Ja |
| `ResZip` | Zoek woonplaats bij postcode | boolean |  | Ja |

**KnOrganisation / KnContact** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `ViKc` | Soort Contact (met codelijst) | string | 3 |  |
| `ExAd` | Department | string | 255 |  |
| `ViFu` | Job (met codelijst) | string | 20 |  |
| `FuDs` | Job on business card | string | 50 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Re` | Comment | string |  |  |
| `Bl` | Blocked | boolean |  |  |
| `AtLn` | Attn. of line | string | 255 |  |
| `LeHe` | Salutation | string | 255 |  |
| `SocN` | Social media | string | 255 |  |
| `Face` | Facebook | string | 255 |  |
| `Link` | LinkedIn | string | 255 |  |
| `Twtr` | X (formerly Twitter) | string | 255 |  |

### 4.3 KnAddress — Adres

UpdateConnector voor het toevoegen en verwijderen van losse adressen (zonder organisatie of persoon). Na een INSERT/POST krijgt het adres een unieke code (adresID) die in andere UpdateConnectoren gebruikt kan worden (overal waar `AfasKnBasicAddress` voorkomt). Ieder adres komt maar één keer voor in de database; bestaande adressen worden samengevoegd.
<!-- bron: Organisaties en personen.json -->

**KnAddress** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `Ad` | Street | string | 60 |  |
| `AdAd` | Addition to address | string | 255 |  |
| `PbAd` | P.O. Box address | boolean |  |  |
| `CoId` | Country | string | 3 | Ja |
| `Rs` | City | string | 50 |  |
| `HmNr` | House number | integer |  |  |
| `HmAd` | Extension (a, b, etc.) to house number | string | 30 |  |
| `ZpCd` | Postal code | string | 15 |  |
| `AddrType` | Adres type | integer |  |  |
| `KnCdtCdId` | Contact data | integer |  |  |

### 4.4 KnEmployee — Medewerker en contract

Aanmaken/wijzigen van een medewerker, inclusief geneste subobjecten voor contract, functie, rooster, salaris en instanties. Voor een **in dienst melding** moeten ook de subobjecten `AfasContract`, `AfasOrgunitFunction`, `AfasTimeTable`, `AfasSalary` en `AfasAgencyFiscus` worden aangeleverd. Verschil met `KnEmployeeGUID`: via GUID kun je een begindatum van contract/rooster/functie/salaris aanpassen; via `KnEmployee` kun je bij een vervolgcontract mutaties op contract én rooster/functie/salaris in één keer aanmaken. De persoonsgegevens worden aangeleverd via het subobject `KnPerson` (zie 4.1). Hieronder het hoofdelement en de belangrijkste directe subobjecten.
<!-- bron: Medewerker en contract.json -->

**AfasEmployee** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `EmId` | Employee | string | 15 | Ja |
| `DaDe` | Date deceased | string |  |  |
| `DaMa` | Wedding date | string |  |  |
| `DaDi` | Date of divorce | string |  |  |
| `ViSe` | Status (met codelijst) | string | 20 | Ja |
| `WrLv` | Work level | integer |  |  |
| `Bl` | Blocked | boolean |  |  |
| `LwOb` | Objection to recording | boolean |  | Ja |
| `LwTg` | Belonging to target group | boolean |  | Ja |
| `LwRs` | Place of birth | string | 50 |  |
| `LwNa` | Country of birth | string | 3 |  |
| `LwFa` | Father's country of birth | string | 3 |  |
| `LwMo` | Country of birth mother | string | 3 |  |
| `ExTm` | Export employee to time registration | boolean |  |  |
| `Re` | Remark | string |  |  |
| `LgId` | Language differs from employer | string | 5 |  |
| `RlBh` | Account manager | string | 15 |  |
| `StFs` | Start phase (met codelijst) | string | 20 |  |
| `BeSf` | Start phase start date | string |  |  |
| `BePe` | Previous employer start date | string |  |  |
| `DlWk` | Date when last worked | string |  |  |
| `WkWh` | Weeks worked in employment history | integer |  |  |
| `CF3h` | Phase 3 calendar weeks in employment history | integer |  |  |
| `CFBh` | Phase B calendar weeks in employment history | integer |  |  |
| `AF3h` | Number of phase 3 contracts in employment history | integer |  |  |
| `AFBh` | Number of phase B contracts in employment history | integer |  |  |
| `ViPa` | Payment frequency (met codelijst) | string | 20 |  |
| `BlPa` | Blocked for payment | boolean |  |  |
| `PsPv` | Pay slip supply (met codelijst) | string | 20 |  |
| `YsPv` | Annual statement supply (met codelijst) | string | 20 |  |
| `EmAd` | E-mail for digital documents (met codelijst) | string | 20 |  |
| `SeAt` | Secure e-mail attachments | boolean |  |  |
| `PwEm` | Password | string | 70 |  |
| `EmUp` | My private email address may be issued | boolean |  |  |
| `BeVo` | Administration | boolean |  |  |
| `LdBb` | Last bicycle purchase date | string |  |  |
| `C32` | C3.2 (met codelijst) | string | 20 |  |
| `ViTr` | Transitional scheme 2022 (met codelijst) | string | 20 |  |
| `Flex` | Flex employee | boolean |  |  |
| `CrId` | Preferred purchase contact | string | 16 |  |
| `Isle` | Island (met codelijst) | string | 20 |  |

**AfasEmployee / AfasContract** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `DaBe` | Contract start date | string |  | Ja |
| `ClId` | CLA | string | 15 | Ja |
| `WcId` | Term of employment | string | 15 | Ja |
| `ApCo` | Contract type (met codelijst) | string | 20 | Ja |
| `DaEn` | End date contract | string |  |  |
| `PEmTy` | Type dienstverband | string | 1 |  |
| `DvSn` | Sequence number employment | integer |  |  |
| `CmId` | Employer | string | 15 | Ja |
| `DaEe` | Employment end date | string |  |  |
| `EmMt` | Employee type (met codelijst) | string | 20 | Ja |
| `DbYs` | Employed (re. seniority) | string |  |  |
| `ViEt` | Employment type (met codelijst) | string | 20 | Ja |
| `ViRe` | Reason (met codelijst) | string | 20 |  |
| `ViIe` | Initiative (met codelijst) | string | 20 |  |
| `ViTo` | Probationary period (met codelijst) | string | 20 |  |
| `DaEt` | End probationary period per | string |  |  |
| `PeNo` | Period number periodic | integer |  |  |
| `PeRp` | Repeat after (periods) | integer |  |  |
| `PeFt` | Period next increase | string | 15 |  |
| `ViBg` | Reason employed (met codelijst) | string | 20 |  |
| `RtDa` | Apply qualifying days | boolean |  | Ja |
| `ViTK` | End of employment reason (TKP) (met codelijst) | string | 20 |  |
| `TkRe` | Reason end employment (TKP Transport) (met codelijst) | string | 20 |  |
| `TpWr` | Labour relation type (met codelijst) | string | 20 |  |
| `FiBr` | Financing source (met codelijst) | string | 20 |  |
| `InTp` | Insurance (met codelijst) | string | 20 |  |
| `InMe` | Method for granting periodic increase (met codelijst) | string | 20 |  |
| `Pfmm` | Deviating min./max. factor | number |  |  |
| `InVl` | Increase by an amount | number |  |  |
| `InPc` | Increase by a percentage | number |  |  |
| `ViFz` | Flex and Security phase classification (met codelijst) | string | 20 |  |
| `ViRf` | Reason of end labour relationship flex-worker (met codelijst) | string | 20 |  |
| `DaSc` | Contract chain start date | string |  |  |
| `ViKe` | Chain number (met codelijst) | string | 20 |  |
| `PdQ1` | Scheduled hours (quarter 1) | integer |  |  |
| `PdQ2` | Scheduled hours (quarter 2) | integer |  |  |
| `PdQ3` | Scheduled hours (quarter 3) | integer |  |  |
| `PdQ4` | Scheduled hours (quarter 4) | integer |  |  |
| `PdQ5` | Scheduled hours (quarter 5) | integer |  |  |
| `JcIn` | Commission paritaire indexatie | string | 7 |  |
| `AcDe` | Education degree (met codelijst) | string | 20 |  |
| `RDDF` | RDDF | boolean |  |  |
| `BaAp` | Appointment basis | string | 10 |  |
| `Sco1` | Educational field 1 | string | 10 |  |
| `Sco2` | Educational field 2 | string | 10 |  |
| `Sco3` | Educational field 3 | string | 10 |  |
| `Sco4` | Educational field 4 | string | 10 |  |
| `PCK` | Contract specification (met codelijst) | string | 20 |  |
| `Stat` | Statute (met codelijst) | string | 20 |  |
| `CtTy` | Contract type (met codelijst) | string | 20 |  |
| `TRsz` | Type #1 employee (met codelijst) | string | 20 |  |
| `TRs2` | Type #2 employee (met codelijst) | string | 20 |  |
| `SCAc` | Salary processing (met codelijst) | string | 20 |  |
| `RSRi` | Reduce and date of rule | boolean |  |  |
| `RSDa` | Start National Office for Social Security reductio | string |  |  |
| `StAc` | Seniority start date | string |  |  |
| `FiAn` | Fictitious seniority date | string |  |  |
| `DaRt` | Start ‘aanwervingskader’ | string |  |  |
| `ReTy` | Recruitment context (met codelijst) | string | 20 |  |
| `SoMb` | Sociale Maribel | number |  |  |
| `PeEx` | Notie vrijstelling prestaties (met codelijst) | string | 20 |  |
| `DaEx` | Exemption start date | string |  |  |
| `DaEd` | Training status start date | string |  |  |
| `StEd` | Training status (met codelijst) | string | 20 |  |
| `WrCt` | Written employment contract | boolean |  |  |
| `StCd` | Steering group key | string | 20 |  |
| `ViAc` | Professional category (met codelijst) | string | 20 |  |
| `FaGr` | Invoicing group | integer |  |  |
| `KRS` | 'RSZ' indicator | string | 20 |  |
| `RMfa` | DMFA Risk class (met codelijst) | string | 20 |  |
| `Z36` | Fixed-term contract (met codelijst) | string | 20 |  |
| `CDT` | Full-time/part-time (met codelijst) | string | 20 |  |
| `COR` | Subject to 'RSZ' | boolean |  |  |
| `CCW` | RSZ-categorie (met codelijst) | string | 20 |  |
| `BOR` | Foreign origin | number |  |  |
| `DtIn` | Dismissal on | string |  |  |
| `Yh35` | 3 of 5 years in the cla from | string |  |  |
| `Yh5c` | 5 consecutive years in the cla from | string |  |  |
| `ViPp` | Subsequent payment type (met codelijst) | string | 20 |  |
| `SDGr` | Group SD Worx | string | 20 |  |
| `PaGr` | Partena Group | string | 20 |  |
| `PaCc` | Contract categorie (met codelijst) | string | 20 |  |
| `PaCt` | Contract type (met codelijst) | string | 20 |  |
| `BrMo` | Incomplete month calculation | boolean |  |  |
| `PaPc` | Contract specification (met codelijst) | string | 20 |  |
| `PaTc` | Temporary contract (met codelijst) | string | 20 |  |
| `PaNr` | Student number | string | 15 |  |
| `PaTl` | Type of student (met codelijst) | string | 20 |  |
| `PaRe` | Region apprenticeship contract (met codelijst) | string | 20 |  |
| `PaRu` | Reason end employment (met codelijst) | string | 20 |  |
| `PaJf` | Fictitious seniority years | number |  |  |
| `PaPr` | Prof. years | number |  |  |
| `PaTi` | Title (met codelijst) | string | 20 |  |
| `PaOp` | Educational level (met codelijst) | string | 20 |  |
| `PaEd` | Last study end date | string |  |  |
| `PaDp` | Prof. seniority | string |  |  |
| `PaCa` | CAO42 | boolean |  |  |
| `LeAg` | Contract of employment (met codelijst) | string | 20 |  |
| `RSZE` | RSZ exemption (met codelijst) | string | 20 |  |
| `HaCa` | Voorgaande regels niet | boolean |  |  |
| `DvbTCh1` | Ambtstijd | boolean |  | Ja |
| `DvbTCh2` | Onderwijstijd | boolean |  | Ja |
| `DvbTCh3` | Bestuurtijd | boolean |  | Ja |
| `DvbTCh4` | Schooltijd | boolean |  | Ja |
| `DvbTCh5` | Directietijd | boolean |  | Ja |
| `DvbDvCh` | Dienstverband | boolean |  | Ja |
| `DvbAbId` | Verzuim | integer |  |  |
| `DvbLeId` | Verlof | integer |  |  |
| `DvbSEns` | DV Verlof | integer |  |  |
| `DvbSuDv` | Vervangingsdienstverband | boolean |  | Ja |
| `DvbIsAt` | Uitbreiding | boolean |  | Ja |
| `DvbDecl` | Declareren bij | boolean |  | Ja |
| `DvbPool` | Poolvervanger | boolean |  | Ja |
| `DvbViCv` | Contractvorm | string | 10 |  |
| `DvbSubs` | Vervangt | string | 15 |  |
| `DvbInFt` | Vervanging binnen | boolean |  | Ja |
| `EnS2` | Income relationship no. | integer |  |  |
| `EnSe` | Employment | integer |  |  |
| `DvbEnSe` | Dienstverband | integer |  |  |
| `DvbZ59` | Einde | string |  |  |
| `DvbDAP` | Begindatum | string |  |  |
| `DvbStat` | Statuut | string | 10 |  |
| `DvbPNR` | Medewerkernummer | number |  |  |
| `DvbCCK` | Contractcategorie | string | 10 | Ja |
| `DvbCPI` | RIZIV pensioen | string | 10 |  |
| `DvbPRR` | Periodiciteit RIZIV | string | 10 |  |
| `DvbAGK` | Onderworpen aan | boolean |  | Ja |
| `DvbZ27` | Medische dienst | number |  |  |
| `DvbBSZ` | Onderworpen bijz. soc. | boolean |  | Ja |
| `DvbSBZ` | Bijz. soc. | string | 10 |  |
| `DvbIBZ` | Inschrijfnummer | string | 8 |  |
| `DvbZIV` | Afhouding Z.I.V. | string | 10 |  |
| `DvbSdNr` | Identificatie SD | string | 2 |  |
| `DvbRESd` | Reden uit dienst | string | 10 |  |
| `DvbFiTy` | Ontslagwijze | string | 10 |  |
| `DvbViSs` | Wijze betekening | string | 10 |  |
| `DvbSdDi` | Betekening | string |  |  |
| `DvbSdDa` | Datum | string |  |  |
| `DvbDaDi` | Begindatum | string |  |  |
| `DvbTxEm` | Fiscale | string | 10 |  |
| `DvbStAn` | Startdatum | string |  |  |
| `DvbSeAc` | Volgnummer Acerta | integer |  |  |
| `DvbREAc` | Reden uit dienst | string | 10 |  |
| `DvbCtTy` | ContractType | string | 10 |  |
| `DvbTRsz` | Type #1 medewerker | string | 10 |  |
| `DvbTRs2` | Type #2 medewerker | string | 10 |  |
| `DvbSwt` | Code brugpensioen | string | 10 |  |
| `DvbRizi` | RIZIV code | string | 10 |  |
| `DvbPRiz` | Periodiciteit | string | 10 |  |
| `DvbRvpC` | RVP categorie | string | 10 |  |
| `DvbMaWe` | Maatregel | string | 10 |  |
| `DvbDaLa` | Datum | string |  |  |
| `DvbRrRe` | Rijksregisternr | string | 11 |  |
| `DvbDeNo` | Notie debiteur | string | 10 |  |
| `DvbNoDm` | Teller breuk DMFA | integer |  |  |
| `DvbSbo` | Startbaanovereenkomst | string | 10 |  |
| `DvbViAo` | Reden einde | string | 10 |  |
| `DvbWWHe` | WW herzien | boolean |  | Ja |
| `DvbCAHi` | Cao-code inlener | string | 10 |  |
| `DvbGmAk` | Einddatum | string |  |  |
| `DvbViRe` | Reden einde | string | 10 |  |
| `DvbViMa` | Wijze einde | string | 10 |  |
| `ArvStPn` | Start | string | 10 |  |
| `ArvStwp` | Start weken pensioen | integer |  |  |
| `ArvDaLw` | Laatste | string |  |  |
| `PeDa` | Statutory pension date | string |  |  |
| `B2Pp` | 2st pension pillar contribution | boolean |  |  |
| `DbYT` | Start of employment connected with transit. allow. | string |  |  |

**AfasEmployee / AfasOrgunitFunction** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `DaBe` | Start date function | string |  | Ja |
| `DpId` | Organisational unit | string | 10 | Ja |
| `FuId` | Job | string | 10 | Ja |
| `CcId` | Cost unit | string | 30 | Ja |
| `CrId` | Cost centre | string | 30 | Ja |
| `PjId` | Project | string | 15 |  |
| `TmPr` | Team member profile | integer |  |  |
| `DvSn` | Sequence number employment | integer |  |  |
| `FpId` | Position | string | 15 |  |
| `EIId` | Educational institution | string | 15 |  |
| `BFun` | Multi-school function | boolean |  |  |
| `RePe` | Research percentage | number |  |  |
| `SoSe` | Social benefit (met codelijst) | string | 20 |  |
| `PaAc` | Activity | string | 20 |  |
| `PaBr` | Sector | string | 20 |  |
| `PaSt` | Statute (met codelijst) | string | 20 |  |
| `PaSb` | Specific job (met codelijst) | string | 20 |  |
| `PaDi` | Management | boolean |  |  |
| `PaTi` | Title (met codelijst) | string | 20 |  |
| `PaBa` | Salary scale category | string | 10 |  |
| `PaBd` | Salary scale date | string |  |  |
| `PaGm` | Pensioned employee | boolean |  |  |
| `PaRi` | Disability risk group (met codelijst) | string | 20 |  |
| `PaAp` | A.P.E. (met codelijst) | string | 20 |  |
| `FuLe` | Job level (met codelijst) | string | 20 |  |
| `DeGi` | Cash group settlement (met codelijst) | string | 20 |  |
| `ReTy` | Investigation type (met codelijst) | string | 20 |  |
| `GrFu` | Scale/job (met codelijst) | string | 20 |  |
| `MPCa` | MZG personnel category (met codelijst) | string | 20 |  |
| `MFun` | MZG job (met codelijst) | string | 20 |  |
| `MQua` | MZG qualification (met codelijst) | string | 20 |  |
| `MNun` | MZG nursing unit | string | 20 |  |
| `MCCd` | MZG campus code | string | 20 |  |
| `HiPh` | Historical physical Department | string | 20 |  |
| `PeT1` | Personnel cat-type1 (met codelijst) | string | 20 |  |
| `PeT2` | Type of personnel - nature2 (met codelijst) | string | 20 |  |
| `NVP` | Group insurance policy no. | string | 12 |  |
| `CVM` | Group insurance company | number |  |  |
| `CVR` | Group insurance different cash register | boolean |  |  |
| `RsWk` | Residence of work location | string | 24 |  |
| `W06` | Branch number | string | 20 |  |
| `Z26` | Accident insurance company code | string | 3 |  |
| `Z28` | Community (met codelijst) | string | 20 |  |
| `Z29` | Desired (met codelijst) | string | 20 |  |
| `ZpWk` | Postcode of work location | string | 5 |  |
| `CoWk` | Country of work activities (met codelijst) | string | 20 |  |

**AfasEmployee / AfasTimeTable** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `DaBg` | Timetable start date | string |  | Ja |
| `DvSn` | Sequence number employment | integer |  |  |
| `SeNo` | Default timetable | integer |  |  |
| `EtTy` | Timetable type (met codelijst) | string | 20 |  |
| `StIn` | Suspension hour type | string | 5 |  |
| `DfHo` | Reporting deviating h/w | number |  |  |
| `StPa` | Variable work pattern | boolean |  |  |
| `Spec` | Alternating work pattern with work timetable | boolean |  |  |
| `PtDu` | Flexible working hours | boolean |  |  |
| `DyWk` | Number of days per week | number |  |  |
| `HrWk` | Number of hours per week | number |  |  |
| `AhWk` | Leave accrual a week | number |  |  |
| `TbSu` | Start time Sunday | string |  |  |
| `TeSu` | Sunday end time | string |  |  |
| `PsSu` | Length of break Sunday | string |  |  |
| `TbMo` | Start time Monday | string |  |  |
| `TeMo` | Monday end time | string |  |  |
| `PsMo` | Length of break Monday | string |  |  |
| `TbTu` | Start time Tuesday | string |  |  |
| `TeTu` | Tuesday end time | string |  |  |
| `PsTu` | Length of break Tuesday | string |  |  |
| `TbWe` | Start time Wednesday | string |  |  |
| `TeWe` | Wednesday end time | string |  |  |
| `PsWe` | Length of break Wednesday | string |  |  |
| `TbTh` | Start time Thursday | string |  |  |
| `TeTh` | Thursday end time | string |  |  |
| `PsTh` | Length of break Thursday | string |  |  |
| `TbFr` | Start time Friday | string |  |  |
| `TeFr` | Friday end time | string |  |  |
| `PsFr` | Length of break Friday | string |  |  |
| `TbSa` | Start time Saturday | string |  |  |
| `TeSa` | Saturday end time | string |  |  |
| `PsSa` | Length of break Saturday | string |  |  |
| `PcPt` | Part-time (%) | number |  | Ja |
| `WdSu` | Sunday working day | boolean |  |  |
| `WdMo` | Monday working day | boolean |  |  |
| `WdTu` | Tuesday working day | boolean |  |  |
| `WdWe` | Wednesday working day | boolean |  |  |
| `WdTh` | Thursday working day | boolean |  |  |
| `WdFr` | Friday working day | boolean |  |  |
| `WdSa` | Saturday working day | boolean |  |  |
| `FtSv` | 5 'SV' days | boolean |  |  |
| `ClAg` | On-call agreement | boolean |  |  |
| `Immc` | Apply min./max. contract in Payroll | boolean |  |  |
| `HrMn` | Minimum hours per week | number |  |  |
| `HrMx` | Maximum hours per week | number |  |  |
| `YrHr` | Annual hour standard | boolean |  |  |
| `HrPm` | Min. hours per period | number |  |  |
| `HrPr` | Hour promise (met codelijst) | string | 20 |  |
| `Ft` | Number of FTE | number |  |  |
| `FtSu` | FTE Sunday | number |  |  |
| `FtMo` | FTE Monday | number |  |  |
| `FtTu` | FTE Tuesday | number |  |  |
| `FtWe` | FTE Wednesday | number |  |  |
| `FtTh` | FTE Thursday | number |  |  |
| `FtFr` | FTE Friday | number |  |  |
| `FtSa` | FTE Saturday | number |  |  |
| `HrSu` | Hours Sunday | number |  |  |
| `HrMo` | Hours Monday | number |  |  |
| `HrTu` | Hours Tuesday | number |  |  |
| `HrWe` | Hours Wednesday | number |  |  |
| `HrTh` | Hours Thursday | number |  |  |
| `HrFr` | Hours Friday | number |  |  |
| `HrSa` | Hours Saturday | number |  |  |
| `FtBp` | 'BAPO' FTE | number |  |  |
| `FtSb` | Save 'BAPO' FTE | number |  |  |
| `ReRa` | Remuneration percentage | number |  |  |
| `ReWt` | Working hours reorganisation (met codelijst) | string | 20 |  |
| `IrEm` | Irregular employment | boolean |  |  |
| `InPt` | Part-time involuntarily (met codelijst) | string | 20 |  |
| `CoWo` | Work schedule code (met codelijst) | string | 20 |  |
| `WsTC` | Work schedule type (met codelijst) | string | 20 |  |
| `CDoc` | C-Documents (met codelijst) | string | 20 |  |
| `Cl42` | CLA 42 (met codelijst) | string | 20 |  |
| `ShRe` | Shift/night reduction (met codelijst) | string | 20 |  |
| `WrNu` | Progressive work resumption counter | number |  |  |
| `WrDe` | Progressive work resumption denominator. | number |  |  |
| `WrRe` | Progressive work resumption system | number |  |  |
| `ReCo` | Regularity code (met codelijst) | string | 20 |  |
| `PsBi` | % Shift work BIS | number |  |  |
| `PlaFaSn` | Kind | integer |  |  |
| `PlaPhWk` | Uren | number |  |  |
| `PlaViTy` | Ouderschapsverlof | string | 10 |  |
| `PlaAmBl` | Aantal blokken (BE) | integer |  |  |
| `PlaVaDl` | Type verdeling | string | 10 |  |
| `PlaPerc` | Percentage | number |  |  |
| `PlaPlDe` | Geplande | string |  |  |
| `PhMo` | Monday parental leave hours | number |  |  |
| `PhTu` | Tuesday parental leave hours | number |  |  |
| `PhWe` | Wednesday parental leave hours | number |  |  |
| `PhTh` | Thursday parental leave hours | number |  |  |
| `PhFr` | Friday parental leave hours | number |  |  |
| `PhSa` | Saturday parental leave hours | number |  |  |
| `PhSu` | Sunday parental leave hours | number |  |  |
| `PfMo` | FTE Monday parental leave | number |  |  |
| `PfTu` | FTE Tuesday parental leave | number |  |  |
| `PfWe` | FTE Wednesday parental leave | number |  |  |
| `PfTh` | FTE Thursday parental leave | number |  |  |
| `PfFr` | FTE Friday parental leave | number |  |  |
| `PfSa` | FTE Saturday parental leave | number |  |  |
| `PfSu` | FTE Sunday parental leave | number |  |  |
| `PaPr` | Printout C131A/C131B (met codelijst) | string | 20 |  |
| `SDCW` | Work schedule code (met codelijst) | string | 20 |  |
| `Rgim` | System (met codelijst) | string | 20 |  |

**AfasEmployee / AfasSalary** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `DaBe` | Salary start date | string |  | Ja |
| `DvSn` | Sequence number employment | integer |  |  |
| `SaSt` | Step | number |  |  |
| `SaS2` | Final step | number |  |  |
| `SaPe` | Salary type (met codelijst) | string | 20 | Ja |
| `EmSa` | Salary | number |  | Ja |
| `SaPr` | Surcharge percentage | boolean |  |  |
| `SaNr` | Pension number | string | 15 |  |
| `NtSa` | Net salary | boolean |  | Ja |
| `PtId` | Period table | integer |  | Ja |
| `SaYe` | Annual pay ST | number |  | Ja |
| `EmSc` | Allowance | number |  |  |
| `TaId` | Wage scale type | integer |  |  |
| `VaSc` | Wage scale (met codelijst) | string | 20 |  |
| `TtPy` | Apply timetable in Payroll | boolean |  |  |
| `FuTa` | Job grade type | integer |  |  |
| `FuSc` | Job grade (met codelijst) | string | 20 |  |
| `Rsp` | RSP | number |  |  |
| `ApSc` | Apply Barema | boolean |  |  |
| `ScTy` | Wage scale type | integer |  |  |
| `AcLs` | Type of wage scale (met codelijst) | string | 20 |  |
| `PaRe` | Partena reason (met codelijst) | string | 20 |  |
| `PaCp` | Partena comments | string | 100 |  |
| `PaBf` | Flexible job amount | number |  |  |
| `PaZl` | Soft landing premium | boolean |  |  |
| `ScCo` | Wage scale code | string | 9 |  |
| `Z70` | Code % of options (met codelijst) | string | 20 |  |
| `Z71` | % OF OPTIONS IN SHARES | number |  |  |

**AfasEmployee / AfasBankInfo** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `AcId` | Account number | string | 42 | Ja |
| `NoBk` | Cash payment | boolean |  | Ja |
| `SeNo` | Sequence number | integer |  | Ja |
| `SaAc` | Salary account | boolean |  | Ja |
| `Ds` | Payment reference | string | 32 |  |
| `Nm` | Deviating name | string | 80 |  |
| `Rs` | Deviating city | string | 50 |  |
| `ScId` | Wage component | integer |  |  |
| `CoId` | Country | string | 3 |  |
| `BkTp` | Bank type | integer |  | Ja |
| `BkIc` | Bank | string | 15 |  |
| `ViBk` | Bank (expired) (met codelijst) | string | 20 |  |
| `FoPa` | Account outside SEPA area | boolean |  |  |
| `DsTp` | Payment reference incl. payment text | boolean |  |  |
| `IbCk` | IBAN controle | boolean |  |  |
| `Iban` | IBAN nummer | string | 40 |  |
| `Bic` | BIC Code | string | 40 |  |

**AfasEmployee / AfasAgencyFiscus** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `DaBe` | Start date | string |  | Ja |
| `AyId` | Agency | string | 15 | Ja |
| `DaEn` | End date | string |  |  |
| `ViIn` | Income relationship type (met codelijst) | string | 20 | Ja |
| `ViEm` | Labour relation type (met codelijst) | string | 20 | Ja |
| `ViTs` | 'Tabelkleur' (met codelijst) | string | 20 | Ja |
| `ViCd` | Table code (met codelijst) | string | 20 | Ja |
| `ViLk` | 'Loonheffingskorting' (met codelijst) | string | 20 | Ja |
| `ViZv` | 'ZVW' (met codelijst) | string | 20 | Ja |
| `YnZW` | PR | boolean |  |  |
| `YnWW` | 'WW' | boolean |  |  |
| `YWAO` | 'WAO/WIA' | boolean |  |  |
| `DoPs` | 'Ufo' | boolean |  |  |
| `ViRi` | Deviating 'Sector risicogroep' (met codelijst) | string | 20 |  |
| `ViFc` | Deviating CBS CLA (met codelijst) | string | 20 |  |
| `ViOk` | Alleenstaande ouderenkorting (met codelijst) | string | 20 | Ja |
| `ViHa` | Premium reduction (met codelijst) | string | 20 | Ja |
| `ViVb` | 'Vakantiebonnen' (met codelijst) | string | 20 | Ja |
| `ViCx` | No car addition reason (met codelijst) | string | 20 |  |
| `TxF4` | Student and pupil arrangement | boolean |  |  |
| `TrI` | Transport for withholding entity | boolean |  |  |
| `Loan` | Staff loan (interest/costs no pay) | boolean |  |  |
| `TxIs` | 'Zelfstandige binnenschipper' | boolean |  |  |
| `TxHc` | In-house staff and/or working children | boolean |  |  |
| `TxGf` | No relationship of authority with owner's family | boolean |  |  |
| `TxGo` | No relationship of authority with previous owner | boolean |  |  |
| `TxCs` | 'Directeur/grootaandeelhouder' | boolean |  |  |
| `TxGy` | On-call/stand-in worker without obligation | boolean |  |  |
| `TxGn` | On-call/stand-in worker with obligation | boolean |  |  |
| `TxAo` | State pension benefit for single persons | boolean |  |  |
| `TxF5` | 'Wajong' benefit | boolean |  |  |
| `Dblr` | 'Doorbetaaldloon' regulation payer | boolean |  |  |
| `OuVr` | 'Ouderenvrijstelling' | boolean |  |  |
| `Cons` | Conscientious objections | boolean |  |  |
| `PMA` | 'Premievrijstelling marginale arbeid' | boolean |  |  |
| `NRsk` | No-risk policy | boolean |  |  |
| `PiAw` | LKV for 'arbeidsgehandicapte' employee | boolean |  |  |
| `PkBa` | LKV banenafspraak | boolean |  |  |
| `PkHa` | LKV for reinstating 'arbeidsgehandicapte' employee | boolean |  |  |
| `PkBc` | Withholding tax at foreign source | boolean |  |  |
| `DaEk` | LKV end date | string |  |  |
| `Lkvo` | LKV for older employee | boolean |  |  |
| `CoDi` | Non-standard country of residence | string | 3 |  |
| `WWHe` | Unemployment reviewed | boolean |  |  |
| `CAHi` | Hirer's collective agreement code (met codelijst) | string | 20 |  |
| `TyDt` | Application of daily table (met codelijst) | string | 20 |  |

### 4.5 KnSubject — Dossieritem

Met dossieritems leg je notities en documenten vast op een relatie, vaak gecombineerd met workflows. Er zijn twee hoofdsoorten: door AFAS beheerde Profit-types (negatief typenummer) en Gebruiker-types (vrij in te richten). Subobjecten: `KnSubjectLink` (koppeling relatie–dossieritem) en `KnSubjectAttachment` (bestanden toevoegen; maximaal 75 MB per aanroep inclusief bijlagen).
<!-- bron: Dossiers en bijlagen en workflows.json -->

**KnSubject** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `SbId` | Dossier item | integer |  | Ja |
| `StId` | Dossier item type | integer |  | Ja |
| `Ds` | Subject | string | 255 | Ja |
| `SbTx` | Comment | string |  |  |
| `Da` | Submission date | string |  |  |
| `UsId` | Sender | string | 80 |  |
| `EmId` | Resp. person | string | 80 |  |
| `SbHi` | Cause | integer |  |  |
| `SaId` | Action type | string | 5 |  |
| `ViPr` | Priority (met codelijst) | string | 20 |  |
| `ScId` | Source | string | 5 |  |
| `DtFr` | Start date | string |  |  |
| `DtTo` | End date | string |  |  |
| `St` | Completed | boolean |  |  |
| `DtSt` | Date completed | string |  |  |
| `FeCo` | With regard to | integer |  |  |
| `FvF1` | Feature value 1 | integer |  |  |
| `FvF2` | Feature value 2 | integer |  |  |
| `FvF3` | Feature value 3 | integer |  |  |
| `SbBl` | Blocked | boolean |  |  |
| `SbPa` | FileName of the attachment | string | 255 |  |
| `FileId` | File Id | string | 32 |  |
| `FileTrans` | Save file with subject | boolean |  |  |
| `FileStream` | File as byte-array | string |  |  |
| `MarkOpened` | Mark subject as opened | boolean |  |  |
| `ProfileId` | Profiel ID | integer |  |  |
| `SubjectHandler` | HandlerId | string | 38 |  |

**KnSubject / KnSubjectLink** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `SbId` | Dossier item | integer |  | Ja |
| `DoCRM` | Save in CRM Subject | boolean |  |  |
| `ToBC` | Organisation/person | boolean |  |  |
| `ToEm` | Employee | boolean |  |  |
| `ToSR` | Sales contact | boolean |  |  |
| `ToPR` | Purchase contact | boolean |  |  |
| `ToCl` | Income tax client | boolean |  |  |
| `ToCV` | Client Vpb | boolean |  |  |
| `ToEr` | Employer | boolean |  |  |
| `ToAp` | Applicant | boolean |  |  |
| `ToOb` | Cliënt OB | boolean |  |  |
| `SfTp` | Type bestemming (met codelijst) | string |  |  |
| `SfId` | Bestemming | string | 50 |  |
| `BcId` | Organisation/person | string | 15 |  |
| `CdId` | Contact | integer |  |  |
| `SiUn` | Administration (Sales) | integer |  |  |
| `SiTp` | Invoice type (sales) | integer |  |  |
| `SiId` | Sales invoice | string | 12 |  |
| `PiUn` | Administration (Purchasing) | integer |  |  |
| `PiTp` | Invoice type (purchase) | integer |  |  |
| `PiId` | Purchase invoice | string | 12 |  |
| `FiYe` | Fiscal year | integer |  |  |
| `PjId` | Project | string | 15 |  |
| `CaId` | Campaign | integer |  |  |
| `FaSn` | Asset | integer |  |  |
| `QuId` | Cost estimate | string | 21 |  |
| `SjId` | Dossier item | integer |  |  |
| `SuNr` | Subscription | integer |  |  |
| `DvSn` | Employment | integer |  |  |
| `VaIt` | Item type (met codelijst) | string | 20 |  |
| `BiId` | Item code | string | 40 |  |
| `CrId` | Course event | integer |  |  |
| `AbId` | Absence entry | integer |  |  |
| `FoSn` | Forecast | integer |  |  |
| `CoNo` | Contract | string | 16 |  |
| `CcSn` | Means of transport | integer |  |  |
| `Ou` | Organisational unit | string | 10 |  |
| `PlId` | Salary processing plan | integer |  |  |
| `Por` | Purchase order | string | 12 |  |
| `Squ` | Sales quotation | string | 12 |  |
| `Sor` | Sales order | string | 12 |  |
| `Pqu` | Purchase quotation | string | 12 |  |
| `LoId` | Location | string | 25 |  |
| `DcId` | Claim number | string | 16 |  |
| `PcId` | Placement | string | 12 |  |
| `PAId` | Price agreement | string | 15 |  |
| `OrNu` | Packing slip | string | 12 |  |
| `GoRe` | Receipt | string | 12 |  |
| `Seri` | Serial number | string | 100 |  |
| `Batc` | Lot number | string | 100 |  |
| `ApId` | Application | integer |  |  |
| `OlNu` | Option list | string | 12 |  |
| `UnSc` | Budget scenario admin | integer |  |  |
| `ScId` | Budget scenario | string | 6 |  |
| `SeId` | Session | integer |  |  |
| `PnId` | Period closing line | integer |  |  |
| `CfId` | Control framework line | integer |  |  |
| `CfRI` | Reporting requirement | integer |  |  |
| `CfMI` | Control measure | string | 14 |  |
| `Year` | Year | integer |  |  |
| `RlId` | Role | string | 25 |  |

**KnSubject / KnSubjectAttachment** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `FileName` | FileName | string | 255 |  |
| `FileId` | File Id | string | 32 |  |
| `FileStream` | File as byte-array | string |  |  |

### 4.6 FiEntries — Financiële mutatie (journaalpost)

UpdateConnector voor financiële mutaties. Vooraf zijn gegevens nodig uit onder andere `Profit_Administrations`, `Profit_Journals`, `Profit_Accounts`, `Profit_VAT_code`, `Profit_Creditor` en `Profit_Debtor`. Een mutatie moet in balans zijn (debet = credit). Belangrijke velden: `UnId` (administratie), `EnDa` (boekingsdatum), `BpDa` (boekstukdatum — bepaalt periode en factuurnummering), `AcNr` (rekeningnummer). Verbijzonderingen leg je vast in subobject `FiDimEntries`. Advies: maximaal ~1.000 regels per journaalpost.
<!-- bron: Mutaties.json -->

**FiEntryPar** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `Year` | Financial year | integer |  | Ja |
| `Peri` | Period | integer |  | Ja |
| `UnId` | Administration number | integer |  |  |
| `JoCo` | Journal | string | 6 | Ja |
| `AdDc` | Maak verbijzonderingscode | boolean |  |  |
| `AdDa` | Maak verbijzonderingstoewijzing | boolean |  |  |
| `PrTp` | Entry type | integer |  |  |
| `AuNu` | Autonummering factuur | boolean |  |  |

**FiEntryPar / FiEntries** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `EnNo` | Journal entry number | integer |  | Ja |
| `VaAs` | Account feature (met codelijst) | string | 10 | Ja |
| `AcNr` | Account number | string | 16 | Ja |
| `EnDa` | Date entry | string |  | Ja |
| `BpDa` | Voucher date | string |  | Ja |
| `BpNr` | Entry number | string | 32 |  |
| `InId` | Invoice number | string | 12 |  |
| `InI2` | Internal invoice number | string | 12 |  |
| `Ds` | Description entry | string | 255 |  |
| `AmDe` | Amount debit | number |  |  |
| `AmCr` | Amount credit | number |  |  |
| `VaId` | VAT code | string | 3 |  |
| `CoVc` | VAT reclaim | string | 16 |  |
| `CuId` | Currency | string | 3 |  |
| `Rate` | Exchange rate | number |  |  |
| `AmDc` | Debit currency amount | number |  |  |
| `AmCc` | Credit currency amount | number |  |  |
| `DaEx` | Expiry date | string |  |  |
| `PaId` | Payment reference | string | 32 |  |
| `Judg` | Reviewer | string | 15 |  |
| `BlPa` | Block for payment | boolean |  |  |
| `AmGa` | 'G'-account amount | number |  |  |
| `RsNo` | Reservation number | integer |  |  |
| `CmNo` | Obligation number | integer |  |  |
| `PaCd` | Payment condition | string | 5 |  |
| `AuPa` | Automatic payment/collection | boolean |  |  |
| `PaBa` | Refund | boolean |  |  |
| `IB47` | UBD - Amounts Paid to Third Parties | boolean |  |  |
| `CaId` | Campaign | integer |  |  |
| `OrNu` | Sales order number | string | 12 |  |
| `Mref` | Reconciliation reference | string | 32 |  |
| `Fref` | Invoice reference | string | 32 |  |
| `PrId` | Project | string | 15 |  |
| `PoCo` | POP code | string | 50 |  |
| `BankAccount` | Afwijkende betaalrekeningnr. | string | 40 |  |
| `IdBa` | Deviating payment account | integer |  |  |
| `DdId` | Deviating mandate feature | string | 35 |  |
| `DaCl` | Days credit restriction | integer |  |  |
| `VaPa` | Payment discount incl. VAT | boolean |  |  |
| `DaDp` | Days payment discount | integer |  |  |
| `AmDp` | Payment discount | number |  |  |
| `AcPa` | Payment discount in currency | number |  |  |
| `DsId` | Deviating reminder set | integer |  |  |

### 4.7 FiElectronicInvoicePurchase — E-inkoopfactuur

UpdateConnector voor het insturen van e-inkoopfacturen. Lever een UBL-bestand aan in het veld `XML` (base64) of een PDF in het veld `PDF` (base64); minstens één van beide is vereist. `FXml`/`FPdf` markeren welk veld gevuld is. `Proc` bepaalt of de factuur automatisch verwerkt wordt (werkt alleen zonder UBL). `UnId` geeft de administratie op.
<!-- bron: Mutaties.json -->

**FiElectronicInvoicePurchase** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `FXml` | XML file name | string | 255 |  |
| `XML` | Inhoud XML | string |  |  |
| `FPdf` | PDF file name | string | 255 |  |
| `PDF` | Inhoud PDF | string |  |  |
| `Proc` | Direct verwerken e-factuurregels | boolean |  |  |
| `UnId` | Administration | integer |  |  |

### 4.8 FbConfrontation — Confrontatie / afletteren

UpdateConnector uit het domein Mutaties voor confrontatie (afletteren van boekingen).
<!-- bron: Mutaties.json -->

**FbConfrontation** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `UnId` | Administration | integer |  |  |
| `InId` | Invoice number | string | 12 | Ja |
| `CfBc` | Confronteren in basisvaluta | boolean |  |  |

**FbConfrontation / FbGoodsReceived** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `OrNu` | Number | string | 12 | Ja |

### 4.9 HrCompMut — Componentmutatie (loon)

UpdateConnector voor mutaties op salariscomponenten in de loonadministratie.
<!-- bron: Loonadministratie.json -->

**HrCompMut** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PtId` | Period table | integer |  | Ja |
| `Year` | Financial year | integer |  | Ja |
| `PeId` | Period | integer |  | Ja |
| `Id` | Line number | integer |  | Ja |
| `DaTi` | Date | string |  | Ja |
| `EmId` | Employee | string | 15 | Ja |
| `ErId` | Employer | string | 15 | Ja |
| `Sc02` | Looncomponent | integer |  | Ja |
| `Ds` | Description | string | 255 |  |
| `EmDp` | Employee organisational unit | string | 10 |  |
| `VaD1` | Value 1 | number |  |  |
| `VaD2` | Value 2 | number |  |  |
| `VaD3` | Value 3 | number |  |  |
| `CrId` | Employee cost centre | string | 30 |  |
| `CcId` | Employee cost unit | string | 30 |  |
| `EnSe` | Employment | integer |  |  |
| `FuId` | Job | string | 30 |  |
| `Rem` | Remark | string | 30 |  |
| `ViTr` | Transport means for WPM reporting (met codelijst) | string | 20 |  |
| `ViTv` | Type of journey (met codelijst) | string | 20 |  |

### 4.10 HrAbsence — Verlofboeking

UpdateConnector voor verlofboekingen (meerdere records mogelijk, vrije velden mogelijk). `EmId` (medewerker) is verplicht; aanmaken kan alleen voor medewerkers waarop de gebruiker rechten heeft. `DaBe`/`DaEn` zijn begin- en einddatum/-tijd (einde moet na begin liggen). `DuRa` is de duur in minuten (alleen bij niet-gespecificeerd rooster). `LeDt` bepaalt of hele dagen gelden; `PaTs`/`PaTe` zijn pauzebegin/-eind (alleen als de omgevingsinstelling pauzes toestaat).
<!-- bron: Verlof en Ziekte.json -->

**HrAbsence** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `EmId` | Employee | string | 15 | Ja |
| `ViAt` | Leave type | string | 20 | Ja |
| `DaBe` | Start date/time | string |  | Ja |
| `DaEn` | End date/time | string |  | Ja |
| `ViLr` | Reason leave (met codelijst) | string | 20 |  |
| `EnSe` | Employment | integer |  | Ja |
| `DuRa` | Number of hours | integer |  | Ja |
| `EmRp` | Substitute | string | 15 |  |
| `Re` | Remark | string |  |  |
| `LeDt` | Partial leave | boolean |  | Ja |
| `PaTs` | Start date break length | integer |  |  |
| `PaTe` | End date break length | integer |  |  |
| `DuBe` | Leave hours start date | integer |  |  |
| `DuEn` | Leave hours end date | integer |  |  |
| `ReLe` | 'VF' absence reason (met codelijst) | string | 20 |  |
| `FaSn` | Child | integer |  |  |
| `MuCh` | Multiple birth | integer |  |  |

### 4.11 HrRelative — Familielid-mutatie

Via dit endpoint maak je een dossieritem (type Familielid mutatie (Profit) / -41) met workflow aan voor een leidinggevende in InSite. Het familielid wordt beschikbaar op de medewerker na goedkeuring (handmatig, via workflow-actie, of via UpdateConnector `KnSubjectWorkflowReaction`).
<!-- bron: Overige.json -->

**HrRelative** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `EmId` | Employee | string | 15 | Ja |
| `FaSn` | Sequence number | integer |  | Ja |
| `MuId` | Entry ID | string | 32 | Ja |
| `ViFt` | Family relationship | string | 20 | Ja |
| `CpEm` | Emergency contact person | boolean |  |  |
| `Nm` | Last name | string | 30 |  |
| `In` | Initials | string | 10 |  |
| `Is` | Prefix | string | 10 |  |
| `FiNm` | First name | string | 30 |  |
| `ViGe` | Gender (met codelijst) | string | 20 | Ja |
| `DaBi` | Date of birth | string |  | Ja |
| `DaDe` | Date deceased | string |  |  |
| `Te` | Phone no. | string | 16 |  |
| `PaHi` | Collective med. ins. participant | boolean |  |  |
| `Mchi` | Multiple birth | boolean |  |  |
| `PaLe` | Is eligible for partner leave | boolean |  |  |
| `Hdcp` | Has a disability or impairment | boolean |  |  |
| `ProfileId` | Profielselectie | string | 3 |  |

**HrRelative / HrRelativeAttachment** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `FileName` | FileName | string | 255 |  |
| `FileId` | File Id | string | 32 |  |
| `FileStream` | File as Base64 string | string |  |  |

### 4.12 HrOnboarding — Onboarding

Met deze UpdateConnector start je het onboardingproces voor een nieuwe medewerker. Bestaat de medewerker al, vul dan `EmId` met het juiste medewerkernummer; de flow gebruikt dan de bestaande medewerker (geen match meer nodig in de workflow — van belang voor automatische workflowtaken). Onderstaand het hoofdelement; de connector kent diverse geneste subobjecten (zie de OpenAPI-specificatie).
<!-- bron: Werving en selectie.json -->

**AfasPerson** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `AutoNum` | Autonummering | boolean |  | Ja |
| `PrId` | Profiel | integer |  | Ja |
| `BcCo` | Number | string | 15 | Ja |
| `SeNm` | Search name | string | 10 |  |
| `CaNm` | Usual name | string | 80 |  |
| `FiNm` | First name | string | 50 |  |
| `In` | Initials | string | 15 |  |
| `Is` | Prefix | string | 15 |  |
| `LaNm` | Last name | string | 80 |  |
| `SpNm` | Enter surname at birth seperately | boolean |  |  |
| `IsBi` | Birth name prefix | string | 15 |  |
| `NmBi` | Surname at birth | string | 80 |  |
| `IsPa` | Prefix partner | string | 15 |  |
| `NmPa` | Partner's usual name | string | 80 |  |
| `ViUs` | Name use (met codelijst) | string | 20 |  |
| `ViGe` | Gender (met codelijst) | string | 20 |  |
| `PsNa` | Nationality (met codelijst) | string | 20 |  |
| `DaBi` | Date of birth | string |  |  |
| `CoBi` | Country of birth | string | 3 |  |
| `RsBi` | Place of birth | string | 50 |  |
| `SoSe` | BSN number | string | 25 |  |
| `ViCs` | Marital status (met codelijst) | string | 20 |  |
| `DaMa` | Wedding date | string |  |  |
| `DaDi` | Date of divorce | string |  |  |
| `DaDe` | Date deceased | string |  |  |
| `TtId` | Title/salutation | string | 3 |  |
| `TtEx` | Secondary title | string | 3 |  |
| `LeHe` | Salutation | string | 255 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `TeN2` | Personal phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `MbN2` | Private mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `EmA2` | Personal e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `Re` | Remark | string |  |  |
| `CoLw` | Legislative country | string | 2 |  |
| `FileId` | Naam bestand | string | 32 |  |
| `FileName` | Naam bestand | string | 255 |  |
| `FileStream` | Afbeelding | string |  |  |
| `AddToPortal` | Persoon toegang geven tot afgeschermde deel van de portal(s) | boolean |  | Ja |
| `EmailPortal` | E-mail toegang | string | 255 |  |

### 4.13 PtLinesToBeUnraveled — Gewerkte uren (ontrafeling)

Geef per medewerker de gewerkte uren met begin- en eindtijd; Profit splitst deze automatisch uit naar urensoorten op basis van een ontrafelschema. Meerdere records mogelijk. `EmId` (medewerker) is verplicht. `DaTi` = begindatum, `ItCd` = itemcode (bepaalt samen met de medewerker de werksoort), `StTi`/`EnTi` = begin-/eindtijd, `PaTi` = pauzeduur, `V1Cd`..`V5Cd` = verbijzonderingscodes, `Di01`..`Di05` = vrije dimensies. Bijlagen via `FileId` (eerder geüpload) of `FileName` + `FileStream` (base64).
<!-- bron: Projecten en nacalculatie.json -->

**PtLinesToBeUnraveled** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `ApprovWorkflow` | Declaratie goedkeuren via workflow | boolean |  |  |
| `Id` | Code | integer |  |  |
| `DaTi` | Date | string |  | Ja |
| `EmId` | Employee | string | 15 | Ja |
| `VaIt` | Item type (met codelijst) | string | 10 | Ja |
| `ItCd` | Itemcode | string | 40 | Ja |
| `Ds` | Description | string | 255 |  |
| `QuUn` | Number | number |  |  |
| `QuSa` | Sales (number) | number |  |  |
| `CuId` | Currency | string | 3 |  |
| `AmCo` | Cost price | number |  |  |
| `CoAm` | Reimbursement | number |  |  |
| `VaRc` | VAT rate group | string | 4 |  |
| `Ch` | Charge | boolean |  |  |
| `V1Cd` | Exception axis code 1 | string | 16 |  |
| `V2Cd` | Exception axis code 2 | string | 16 |  |
| `V3Cd` | Exception axis code 3 | string | 16 |  |
| `V4Cd` | Exception axis code 4 | string | 16 |  |
| `V5Cd` | Exception axis code 5 | string | 16 |  |
| `PrId` | Project | string | 15 |  |
| `PrSt` | Project phase | string | 15 |  |
| `DbId` | Sales contact | string | 16 |  |
| `StTi` | Start time | string |  |  |
| `EnTi` | End time | string |  |  |
| `PaTi` | Break time | string |  |  |
| `Di01` | (Not used) | integer |  |  |
| `Di02` | (Not used) | integer |  |  |
| `Di03` | (Not used) | integer |  |  |
| `Di04` | (Not used) | integer |  |  |
| `Di05` | (Not used) | integer |  |  |
| `ErId` | Employer | string | 15 |  |
| `EnSe` | Employment | integer |  |  |
| `FuId` | Job | string | 30 |  |
| `CoLa` | Legislative country | string | 3 |  |
| `Rem` | Remark | string | 30 |  |
| `AxId` | Project allocation axis | string | 1 |  |
| `VbCo` | Allocation code | string | 16 |  |
| `UpFc` | Price per unit | number |  |  |
| `AmFc` | Sales price | number |  |  |
| `PcId` | Placement | string | 12 |  |
| `AmPy` | Wage price | number |  |  |
| `CcSr` | Cost centre sales contact | string | 30 |  |
| `RfCs` | Order number/reference | string | 100 |  |
| `Fref` | Invoice reference | string | 32 |  |
| `StId` | Hour type | string | 5 |  |
| `DsIn` | Internal description | string | 255 |  |
| `DsEx` | Description external | string | 255 |  |
| `WoHo` | Working from home | boolean |  |  |
| `ViTr` | Transport means for WPM reporting (met codelijst) | string | 20 |  |
| `ViTv` | Type of journey (met codelijst) | string | 20 |  |
| `ViTm` | Transport means for hour unraveling (met codelijst) | string | 20 |  |
| `FileId` | File Id | string | 32 |  |
| `FileName` | Filename | string | 255 |  |
| `FileStream` | File as byte-array | string |  |  |
| `DcCo` | Declaration code | string | 16 |  |

### 4.14 PtPriceAgreement — Prijsafspraak

UpdateConnector uit het domein Flex voor het vastleggen van prijsafspraken (tarieven).
<!-- bron: Flex.json -->

**PtPriceAgreement** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PAId` | Price agreement ID | string | 15 |  |
| `Ds` | Description | string | 100 |  |
| `Type` | Type of price agreement (met codelijst) | string | 20 |  |
| `PrId` | Customer agreement | string | 15 |  |
| `FuId` | Job | string | 10 |  |
| `PRe` | Purchase contact | string | 16 |  |
| `ApCo` | Placement type (met codelijst) | string | 20 |  |
| `VaFz` | Phase (met codelijst) | string | 20 |  |
| `ViSe` | Temporary employment method (met codelijst) | string | 20 |  |
| `UsAg` | Age-specific | boolean |  |  |
| `AgFr` | Age from | integer |  |  |
| `AgTo` | Age to | integer |  |  |

**PtPriceAgreement / PtPriceAgreementVersion** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PAVe` | Price agreement version | integer |  |  |
| `DaBe` | Start date | string |  |  |
| `DaEn` | End date | string |  |  |
| `GHWg` | Gross hourly wage | number |  |  |
| `Stat` | Price agreement version status (met codelijst) | string | 20 |  |
| `TaBa` | Basic rate | number |  |  |
| `PuBa` | Base purchase price | number |  |  |

### 4.15 KnPurchaseRelationOrg — Inkooprelatie (organisatie)

UpdateConnector voor het aanmaken/wijzigen van een inkooprelatie (crediteur) voor een organisatie, met genest de organisatiegegevens.
<!-- bron: Inkoop.json -->

**KnPurchaseRelationOrg** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `CrId` | Creditor number | string | 16 |  |
| `Iban` | Voorkeur Iban nummer | string | 40 |  |
| `BaAc` | Voorkeur bank-/gironummer | string | 40 |  |
| `CoId` | Voorkeur bank-/gironummer land code | string | 3 |  |
| `IsCr` | Is creditor | boolean |  |  |
| `ToAc` | Preferred contra account | string | 16 |  |
| `VaId` | VAT identification number | string | 21 |  |
| `PaCd` | Payment condition | string | 5 |  |
| `VeId` | Purchaser | string | 16 |  |
| `OrId` | Ordered by | string | 15 |  |
| `LgId` | Language | string | 5 |  |
| `CuId` | Currency | string | 3 | Ja |
| `VaDu` | VAT duty | string | 3 |  |
| `PfId` | Profile | string | 16 |  |
| `PrLi` | % Line discount | number |  |  |
| `PrFc` | Invoice discount (%) | number |  |  |
| `ClPc` | Credit restriction (%) | number |  |  |
| `PrPt` | Payment discount (%) | number |  |  |
| `Krli` | Credit limit | number |  |  |
| `PrVn` | Use prices from | string | 16 |  |
| `PrLs` | Preferred price list | string | 5 |  |
| `VkMa` | Preferred warehouse | string | 15 |  |
| `Bl` | Block temporarily | boolean |  |  |
| `BlTl` | Block completely, no longer visible | boolean |  |  |
| `VaYN` | Deviating VAT rate group | boolean |  |  |
| `VaIg` | Group administration code | string | 20 |  |
| `DsGr` | Discount group | string | 5 |  |
| `PaSp` | Payment specification | boolean |  |  |
| `PayM` | Payment method (met codelijst) | string | 20 |  |
| `AuPa` | Automatic payment | boolean |  |  |
| `PaCo` | Compress | boolean |  |  |
| `IB47` | UBD - Amounts Paid to Third Parties | boolean |  |  |
| `WaOr` | Order/quotation warning | boolean |  |  |
| `WaTx` | Warning text | string | 255 |  |
| `CsTy` | CBS types | string | 1 |  |
| `Rm` | Remark | string |  |  |
| `CtP1` | Contact person | integer |  |  |
| `CtP2` | Extra contact person | integer |  |  |
| `ColA` | Summary account | string | 16 |  |
| `CsDa` | Supplier since | string |  |  |
| `BcBy` | Entered by | string | 15 |  |
| `CtI1` | Preferred contact | integer |  |  |
| `IvJu` | Reviewer | string | 15 |  |
| `InPv` | Preferred issue method (met codelijst) | string | 20 |  |
| `SpIV` | Sales price including VAT | boolean |  |  |
| `CoSu` | Invoicing via advance invoice | boolean |  |  |
| `PeDR` | Surcharge/discount % | number |  |  |
| `DbLe` | Debtor no. (supplier) | string | 14 |  |
| `ViFc` | Category record 281.50 (met codelijst) | string | 20 |  |
| `ViFs` | Fiche 281.50 sub-category (met codelijst) | string | 20 |  |
| `Prof` | Profession | string | 80 |  |
| `WiOf` | Wife of | string | 80 |  |
| `KBOn` | KBO number | string | 12 |  |
| `FiCo` | Country code for fiche 281.50 (met codelijst) | string | 20 |  |
| `ALiAcNc` | ALiAcNc | string | 16 |  |
| `PReAxUnId` | PReAxUnId | integer |  |  |
| `PReAxVbC2` | PReAxVbC2 | string | 16 |  |
| `PReAxVaId` | PReAxVaId | string | 3 |  |
| `PReAxPcMa` | PReAxPcMa | number |  |  |
| `PReAxVbC4` | PReAxVbC4 | string | 16 |  |
| `VaA1` | VaA1 | string | 10 |  |
| `VaA2` | VaA2 | string | 10 |  |
| `VaA3` | VaA3 | string | 10 |  |
| `VaA4` | VaA4 | string | 10 |  |
| `VaA5` | VaA5 | string | 10 |  |
| `EnId` | eConnection company ID | string | 50 |  |
| `DeCa` | Apply the order and delivery calendar | boolean |  |  |
| `DDa1` | Order day Monday | boolean |  |  |
| `DDa2` | Order day Tuesday | boolean |  |  |
| `DDa3` | Order day Wednesday | boolean |  |  |
| `DDa4` | Order day Thursday | boolean |  |  |
| `DDa5` | Order day Friday | boolean |  |  |
| `DDa6` | Order day Saturday | boolean |  |  |
| `DDa7` | Order day Sunday | boolean |  |  |
| `DTi1` | Order for Monday | string |  |  |
| `DTi2` | Order for Tuesday | string |  |  |
| `DTi3` | Order for Wednesday | string |  |  |
| `DTi4` | Order for Thursday | string |  |  |
| `DTi5` | Order for Friday | string |  |  |
| `DTi6` | Order for Saturday | string |  |  |
| `DTi7` | Order for Sunday | string |  |  |
| `DDe1` | Number of Monday delivery days | integer |  |  |
| `DDe2` | Number of Tuesday delivery days | integer |  |  |
| `DDe3` | Number of Wednesday delivery days | integer |  |  |
| `DDe4` | Number of Thursday delivery days | integer |  |  |
| `DDe5` | Number of Friday delivery days | integer |  |  |
| `DDe6` | Number of Saturday delivery days | integer |  |  |
| `DDe7` | Number of Sunday delivery days | integer |  |  |
| `PoCo` | POP code | string | 50 |  |
| `VaTp` | Purchase contact  type | string | 20 |  |

**KnPurchaseRelationOrg / KnOrganisation** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `PadAdr` | Postadres is adres | boolean |  | Ja |
| `AutoNum` | Autonummering | boolean |  | Ja |
| `MatchOga` | Organisatie vergelijken op (met codelijst) | string | 1 | Ja |
| `BcId` | Organisation/Person (internal) | integer |  | Ja |
| `BcCo` | Number | string | 15 | Ja |
| `SeNm` | Search name | string | 10 |  |
| `Nm` | Name | string | 255 | Ja |
| `ViLe` | Legal form (met codelijst) | string | 20 |  |
| `ViLb` | Sector (met codelijst) | string | 20 |  |
| `CcNr` | CoC number | string | 30 |  |
| `CcDa` | CoC date | string |  |  |
| `NmRg` | Name (statutory) | string | 80 |  |
| `RsRg` | Registered office | string | 50 |  |
| `LeHe` | Salutation | string | 255 |  |
| `OuId` | Organisational unit | string | 10 |  |
| `TeNr` | Work phone no. | string | 255 |  |
| `FaNr` | Work fax | string | 255 |  |
| `MbNr` | Work mobile no. | string | 255 |  |
| `EmAd` | Work e-mail | string | 255 |  |
| `HoPa` | Website | string | 255 |  |
| `Corr` | Correspondence | boolean |  |  |
| `ViMd` | Preferred medium (met codelijst) | string | 20 |  |
| `Re` | Remark | string |  |  |
| `FiNr` | Fiscal number | string | 9 |  |
| `SocN` | Social media | string | 255 |  |
| `CrIb` | CRIB number | string | 9 |  |
| `Face` | Facebook | string | 255 |  |
| `Link` | LinkedIn | string | 255 |  |
| `Twtr` | X (formerly Twitter) | string | 255 |  |

### 4.16 FbPurch — Inkooporder

UpdateConnector voor inkooporders, met genest een subobject voor de orderregels.
<!-- bron: Inkoop.json -->

**FbPurch** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `OrNu` | Number | string | 12 |  |
| `OrDa` | Date | string |  |  |
| `CrId` | Purchase contact | string | 16 | Ja |
| `Ds` | Description | string | 255 |  |
| `DaDe` | Required delivery date | string |  |  |
| `DaPr` | Delivery date (promised) | string |  |  |
| `CuId` | Currency | string | 3 |  |
| `Rate` | Exchange rate | number |  |  |
| `RfCs` | Purchase contact reference | string | 50 |  |
| `VaDu` | VAT duty | string | 3 |  |
| `PaCd` | Payment condition | string | 5 |  |
| `PaTp` | Payment method | string | 5 |  |
| `Re` | Remark | string |  |  |
| `Unit` | Administration | integer |  |  |
| `Coll` | Automatic payment | boolean |  |  |
| `CrOr` | Credit order | boolean |  |  |
| `War` | Warehouse | string | 15 |  |
| `LgId` | Language | string | 5 |  |
| `CsTy` | CBS types | string | 1 |  |
| `VaTr` | Type of Statistics Netherlands transport (met codelijst) | string | 20 |  |
| `VaSt` | 'CBS' statistical system (met codelijst) | string | 20 |  |
| `VaGs` | 'CBS' goods flow (met codelijst) | string | 20 |  |
| `VaTa` | 'CBS' transaction (met codelijst) | string | 20 |  |
| `CoId` | CBS country of origin | string | 3 |  |
| `VaCl` | Credit restriction including VAT | boolean |  |  |
| `ClPc` | Credit restriction (%) | number |  |  |
| `PaPc` | Payment discount (%) | number |  |  |
| `VaPa` | Payment discount incl. VAT | boolean |  |  |
| `VaYN` | Deviating VAT rate group | boolean |  |  |
| `VaBc` | Barcode type (met codelijst) | string | 20 |  |
| `BaCo` | Barcode | string | 30 |  |
| `PrLa` | Report | string | 32 |  |
| `JoCo` | Journal invoice | string | 6 |  |
| `SbAt` | Attachment | integer |  |  |
| `CtI1` | Deviating contact | integer |  |  |
| `PrId` | Project | string | 15 |  |
| `PrSt` | Project phase | string | 15 |  |
| `MoId` | Monitoring code | string | 15 |  |
| `CoNo` | Contract | string | 16 |  |
| `CoYn` | Create obligations | boolean |  |  |
| `JuYN` | Block obligations for payment | boolean |  |  |
| `Judg` | Reviewer | string | 15 |  |
| `PCoC` | Complete order lines when releasing obligation | boolean |  |  |
| `BcDa` | Delivery organisation/person | string | 15 |  |
| `DlAd` | Delivery address | integer |  |  |
| `Cycl` | Cycle (met codelijst) | string | 20 |  |
| `Time` | Term | integer |  |  |
| `DaBg` | Start date invoice cycle | string |  |  |
| `Fina` | Order definitief maken | boolean |  |  |
| `InSc` | Instalment schedule | boolean |  |  |
| `PPIn` | Generate purchasing | boolean |  |  |
| `PuTy` | Purchasing method (met codelijst) | string | 20 |  |
| `PuPe` | Cumulative purchasing period (met codelijst) | string | 20 |  |
| `PuMe` | Cumulative purchasing method (met codelijst) | string | 20 |  |
| `Freq` | Purchasing billing frequency | integer |  |  |
| `Fday` | Extra days billing frequency | integer |  |  |

**FbPurch / FbPurchLines** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `VaIt` | Item type (met codelijst) | string | 10 | Ja |
| `ItCd` | Itemcode | string | 40 | Ja |
| `Ds` | Description | string | 255 |  |
| `VaRc` | VAT rate group | string | 4 |  |
| `BiUn` | Unit | string | 15 | Ja |
| `QuUn` | Number of units | number |  | Ja |
| `QuLe` | Length | number |  |  |
| `QuWi` | Width | number |  |  |
| `QuHe` | Height | number |  |  |
| `Qu` | Quantity ordered | number |  |  |
| `PrLi` | Price list | string | 5 |  |
| `War` | Warehouse | string | 15 |  |
| `DlDa` | Deviating delivery date | string |  |  |
| `VaWt` | Weight unit (met codelijst) | string | 20 |  |
| `NeWe` | Net weight | number |  |  |
| `GrWe` | Gross weight | number |  |  |
| `Upri` | Price per unit | number |  |  |
| `CoPr` | Cost price | number |  |  |
| `VaAD` | Discount allowed (met codelijst) | string | 20 |  |
| `PRDc` | % Line discount | number |  |  |
| `ARDc` | Amount line discount | number |  |  |
| `MaAD` | Manual line discount amount | boolean |  |  |
| `AmTo` | Line amount | number |  |  |
| `Re` | Remark | string |  |  |
| `PrId` | Project | string | 15 |  |
| `PrSt` | Project phase | string | 15 |  |
| `GuLi` | GUID line | string | 38 |  |
| `StL1` | Article dimension code 1 | string | 10 |  |
| `StL2` | Article dimension code 2 | string | 10 |  |
| `V1Cd` | Exception axis code 1 | string | 16 |  |
| `V2Cd` | Exception axis code 2 | string | 16 |  |
| `V3Cd` | Exception axis code 3 | string | 16 |  |
| `V4Cd` | Exception axis code 4 | string | 16 |  |
| `V5Cd` | Exception axis code 5 | string | 16 |  |
| `Di01` | (Not used) | integer |  |  |
| `Di02` | (Not used) | integer |  |  |
| `Di03` | (Not used) | integer |  |  |
| `Di04` | (Not used) | integer |  |  |
| `Di05` | (Not used) | integer |  |  |
| `MoId` | Monitoring code | string | 15 |  |
| `CoTy` | Type of project costs (met codelijst) | string | 20 |  |
| `QuId` | Quotation number | string | 21 |  |
| `QuGu` | Quotation line GUID | string | 38 |  |
| `ReId` | Reservation | integer |  |  |
| `MWrk` | Additional work | boolean |  |  |
| `HiBc` | Purchasing person | string | 15 |  |
| `HiBg` | Date from purchase | string |  |  |
| `HiEn` | Date to purchase | string |  |  |

### 4.17 FbSales — Verkooporder

UpdateConnector voor verkooporders, met genest een subobject voor de orderregels. Vaak gebruikt met `@Action`-tags vanwege de geneste structuur.
<!-- bron: Verkoop en Orders.json -->

**FbSales** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `OrNu` | Number | string | 12 |  |
| `OrDa` | Date | string |  |  |
| `DbId` | Sales contact | string | 16 | Ja |
| `SoQu` | Corresponding quotation | string | 12 |  |
| `FaTo` | Invoice to | string | 16 |  |
| `DaDe` | Required delivery date | string |  |  |
| `DaPr` | Delivery date (promised) | string |  |  |
| `CuId` | Currency | string | 3 |  |
| `Rate` | Exchange rate | number |  |  |
| `BkOr` | Backorder | boolean |  |  |
| `RfCs` | Order number/reference | string | 100 |  |
| `SaCh` | Sales channel (met codelijst) | string | 20 |  |
| `VaDu` | VAT duty | string | 3 |  |
| `InVa` | Price incl. VAT | boolean |  |  |
| `PaCd` | Payment condition | string | 5 |  |
| `PaTp` | Payment method | string | 5 |  |
| `Re` | Remark | string |  |  |
| `Unit` | Administration | integer |  |  |
| `Coll` | Collect | boolean |  |  |
| `CrOr` | Credit order | boolean |  |  |
| `Rout` | Route code (met codelijst) | string | 20 |  |
| `War` | Warehouse | string | 15 |  |
| `CoDn` | Collection packing slip | boolean |  |  |
| `CoIn` | Group invoice | boolean |  |  |
| `DlPr` | Delivery priority | integer |  |  |
| `LgId` | Language | string | 5 |  |
| `DeCo` | Delivery conditions (met codelijst) | string | 20 |  |
| `CsTy` | CBS types | string | 1 |  |
| `VaTr` | Type of Statistics Netherlands transport (met codelijst) | string | 20 |  |
| `VaSt` | 'CBS' statistical system (met codelijst) | string | 20 |  |
| `VaGs` | 'CBS' goods flow (met codelijst) | string | 20 |  |
| `VaTa` | 'CBS' transaction (met codelijst) | string | 20 |  |
| `InPc` | Invoice discount (%) | number |  |  |
| `VaCl` | Credit restriction including VAT | boolean |  |  |
| `ClPc` | Credit restriction (%) | number |  |  |
| `PaPc` | Payment discount (%) | number |  |  |
| `VaPa` | Payment discount incl. VAT | boolean |  |  |
| `VaYN` | Deviating VAT rate group | boolean |  |  |
| `VaBc` | Barcode type (met codelijst) | string | 20 |  |
| `BaCo` | Barcode | string | 30 |  |
| `PrLa` | Report | string | 32 |  |
| `JoCo` | Journal invoice | string | 6 |  |
| `FuOr` | Future order | boolean |  |  |
| `DtId` | Delivery type | integer |  |  |
| `PrId` | Project | string | 15 |  |
| `PrSt` | Project phase | string | 15 |  |
| `SeSt` | Status shipment (met codelijst) | string | 20 |  |
| `SeWe` | Shipping weight | number |  |  |
| `QuCl` | Number of packaging units | integer |  |  |
| `PkTp` | Packaging type (met codelijst) | string | 20 |  |
| `TrPt` | Transporter | string | 16 |  |
| `SsId` | Service | string | 10 |  |
| `OrPr` | Processing order (met codelijst) | string | 20 |  |
| `AmDp` | Down payment amount | number |  |  |
| `VeId` | Sales representative | string | 16 |  |
| `DlAd` | Delivery address | integer |  |  |
| `ExAd` | Delivery address description | string | 255 |  |
| `BaDe` | Delivery address barcode | string | 30 |  |
| `SbAt` | Attachment | integer |  |  |
| `CtI1` | Deviating contact | integer |  |  |
| `CoId` | 'CBS' destination country | string | 3 |  |
| `PuSa` | Purchase per sales order | boolean |  |  |
| `ETOr` | Order type (met codelijst) | string | 20 |  |
| `Fref` | Invoice reference | string | 32 |  |
| `CoDs` | Discount/surcharge scale | string | 8 |  |
| `FxBl` | Order blokkeren | boolean |  |  |
| `DlYN` | Uitleverbaar | boolean |  |  |

**FbSales / FbSalesLines** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `VaIt` | Item type (met codelijst) | string | 10 | Ja |
| `ItCd` | Itemcode | string | 40 | Ja |
| `Ds` | Description | string | 255 |  |
| `VaRc` | VAT rate group | string | 4 |  |
| `BiUn` | Unit | string | 15 | Ja |
| `QuUn` | Number of units | number |  | Ja |
| `QuLe` | Length | number |  |  |
| `QuWi` | Width | number |  |  |
| `QuHe` | Height | number |  |  |
| `Qu` | Quantity ordered | number |  |  |
| `QuDl` | Quantity to deliver | number |  |  |
| `QuBo` | Pending order quantity | number |  |  |
| `QuAd` | Quantity on order proposal | number |  |  |
| `PrLi` | Price list | string | 5 |  |
| `War` | Warehouse | string | 15 |  |
| `EUSe` | Service calculation | boolean |  |  |
| `VaWt` | Weight unit (met codelijst) | string | 20 |  |
| `NeWe` | Total net weight | number |  |  |
| `GrWe` | Total gross weight | number |  |  |
| `Upri` | Price per unit | number |  |  |
| `CoPr` | Cost price | number |  |  |
| `VaAD` | Discount allowed (met codelijst) | string | 20 |  |
| `PRDc` | % Line discount | number |  |  |
| `ARDc` | Amount line discount | number |  |  |
| `MaAD` | Manual line discount amount | boolean |  |  |
| `Re` | Remark | string |  |  |
| `DlDa` | Deviating delivery date | string |  |  |
| `GuLi` | GUID line | string | 38 |  |
| `StL1` | Article dimension code 1 | string | 10 |  |
| `StL2` | Article dimension code 2 | string | 10 |  |
| `DiDe` | Direct supply from supplier | boolean |  |  |
| `NoIn` | Do not invoice | boolean |  |  |
| `V1Cd` | Exception axis code 1 | string | 16 |  |
| `V2Cd` | Exception axis code 2 | string | 16 |  |
| `V3Cd` | Exception axis code 3 | string | 16 |  |
| `V4Cd` | Exception axis code 4 | string | 16 |  |
| `V5Cd` | Exception axis code 5 | string | 16 |  |
| `Di01` | (Not used) | integer |  |  |
| `Di02` | (Not used) | integer |  |  |
| `Di03` | (Not used) | integer |  |  |
| `Di04` | (Not used) | integer |  |  |
| `Di05` | (Not used) | integer |  |  |
| `MoId` | Monitoring code | string | 15 |  |
| `CoTy` | Type of project costs (met codelijst) | string | 20 |  |

### 4.18 KnBankTransaction — Bankmutatie

UpdateConnector uit het domein Financiële Inrichting voor bankmutaties/-transacties.
<!-- bron: Financiële Inrichting.json -->

**KnBankTransaction** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `Id` | Line number | integer |  |  |
| `BcCo` | Bank | string | 15 | Ja |
| `TrCd` | Transaction code | string | 8 | Ja |
| `SeVa` | Search value | string | 32 |  |
| `Ds` | Description | string | 80 |  |
| `AcId` | Account | string | 16 |  |
| `VaId` | VAT code | string | 3 |  |
| `CmYN` | Automatically credit commission to expense acct. | boolean |  |  |
| `AcCm` | Rekening (commissie) | string | 16 |  |
| `VaCm` | Btw-code (commissie) | string | 3 |  |

**KnBankTransaction / KnTransactionDimension** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `Srch` | Search value | string | 32 |  |
| `DiC1` | Axis allocation code 1 | string | 16 |  |
| `DiC2` | Axis allocation code 2 | string | 16 |  |
| `DiC3` | Axis allocation code 3 | string | 16 |  |
| `DiC4` | Axis allocation code 4 | string | 16 |  |
| `DiC5` | Axis allocation code 5 | string | 16 |  |

### 4.19 FiFixedAssets — Vaste activa

UpdateConnector uit het domein Budgetten en activa voor het vastleggen van vaste activa.
<!-- bron: Budgetten en activa.json -->

**FiFixedAssets** — velden:

| Veldcode | Naam/omschrijving | Type | Max | Verplicht |
|---|---|---|---|---|
| `AutoNum` | Vast actief autonummeren | boolean |  | Ja |
| `SeNo` | Asset code | integer |  |  |
| `Ds` | Asset name | string | 120 | Ja |
| `FgSn` | Asset group | integer |  | Ja |
| `DaPu` | Date purchase | string |  | Ja |
| `DaSe` | Date in use | string |  |  |
| `EmId` | Employee | string | 15 |  |
| `SpId` | Supplier | string | 16 |  |
| `LoId` | Location | string | 25 |  |
| `NpBu` | Quantity purchased | integer |  |  |
| `RefN` | Reference number | string | 40 |  |
| `LiFa` | Linked to asset | integer |  |  |
| `BuVa` | Purchase value | number |  |  |
| `AdVa` | Additional costs | number |  |  |
| `ANO1` | Allocation 1 | string | 16 |  |
| `ANO2` | Allocation 2 | string | 16 |  |
| `ANO3` | Allocation 3 | string | 16 |  |
| `ANO4` | Allocation 4 | string | 16 |  |
| `ANO5` | Allocation 5 | string | 16 |  |
| `FiYn` | Fisc. depreciation | boolean |  |  |
| `ViAk` | Type of asset (met codelijst) | string | 20 |  |
| `ViDf` | Depreciation method (met codelijst) | string | 20 |  |
| `FiAm` | Deprec. amount by year | number |  |  |
| `LiYe` | Depreciation period | integer |  |  |
| `RrFa` | Reinvestment.reserve previous asset | number |  |  |
| `Botm` | Bottom value | number |  |  |
| `SaVa` | Residual value | number |  |  |
| `DaSd` | Start date depreciation | string |  |  |
| `FyLi` | Initial depreciation up to financial year | integer |  |  |
| `FpLi` | Initial depreciation up to period | integer |  |  |
| `FiDi` | Depreciation initial | number |  |  |
| `AmEd` | Amount of depreciation (accelerated) | number |  |  |
| `FiYe` | Number of years of accelerated deprec. | integer |  |  |
| `FiDp` | % Depreciation | number |  |  |
| `CoYn` | Comm. depreciation | boolean |  |  |
| `ViDc` | Depreciation method (met codelijst) | string | 20 |  |
| `FiCa` | Deprec. amount by year | number |  |  |
| `LiCo` | Depreciation period | integer |  |  |
| `SaCo` | Residual value | number |  |  |
| `DaCo` | Start date depreciation | string |  |  |
| `CyLi` | Initial depreciation up to financial year | integer |  |  |
| `CpLi` | Initial depreciation up to period | integer |  |  |
| `CoCu` | Depreciation initial | number |  |  |
| `FiPc` | % Depreciation | number |  |  |
| `Bach` | Serial number | string | 80 |  |
| `Pik` | PUK code | string | 40 |  |
| `WaDa` | Guarantee until | string |  |  |
| `Memo` | Memo | string |  |  |
| `PrId` | Project | string | 15 |  |
| `PrSt` | Project phase | string | 15 |  |
| `VaIt` | Item type | string | 10 |  |
| `ItCd` | Itemcode | string | 40 |  |
| `MoId` | Monitoring code | string | 15 |  |
| `ViPr` | Type of project costs (met codelijst) | string | 20 |  |
| `DiPt` | Tijdsafhankelijke verbijzondering op basis van pro | boolean |  |  |
| `FileName` | Filename | string | 255 |  |
| `FileStream` | File as byte-array | string |  |  |

## 5. GetConnectors — records ophalen

Een **GetConnector** is een endpoint waarmee een applicatie records ophaalt uit de Profit-database. Een AFAS-beheerder stelt de GetConnector-definities samen en bepaalt daarmee welke records en velden opgehaald kunnen worden. Aanbevolen wordt een eigen GetConnector aan te maken met alleen de benodigde velden en een passend filter.

### Aanroep

```bash
curl -X GET "https://12345.rest.afas.online/ProfitRestServices/connectors/Profit_Address?skip=0&take=100" \
 -H "Accept: application/json" \
 -H "Accept-Language: nl-nl" \
 -H "Authorization: AfasToken <base64-token>"
```

De response is JSON met `skip`, `take` en een array `rows`. Datumtijdvelden eindigen op `Z`; deze `Z` kun je negeren (tijd is altijd Amsterdam GMT).

Met de GetConnector `MetaInfo` (`GET /MetaInfo`) vraag je een lijst op van alle GetConnectoren in een omgeving, inclusief welke geblokkeerd zijn.

### Filtering

Een request-filter bestaat uit drie parallelle query-parameters: `filterfieldids`, `filtervalues` en `operatortypes`. Beschikbare operators:

| Type | Beschrijving | Operator |
|---|---|---|
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

- **AND**: scheid filtervariabelen met een komma `,`.
- **OR**: scheid filtervariabelen met een puntkomma `;`.
- Voor complexe filters kun je een **JSON-filter** (`filterjson=`, URL-encoded) gebruiken: velden binnen één filter hebben een AND-relatie, filters onderling een OR-relatie.

Voorbeeld AND-filter:

```
/connectors/Profit_Administrations?filterfieldids=fieldid,fieldid&filtervalues=value,value&operatortypes=type,type
```

### Skip, take en sortering

- Standaard `skip=0`, `take=100`. Vuistregel: `[aantal kolommen] x [aantal regels] < 150.000`.
- Bij `skip` > 100.000 wordt het traag; deel de data dan op via filters (bv. per medewerker/boekingsdatum). Maximaal 5 gelijktijdige aanroepen.
- **Get all** (`skip=-1`, `take=-1`) wordt sterk afgeraden.
- **Altijd** `orderbyfieldids` meegeven bij gebruik van skip/take, anders is de sortering niet gegarandeerd (kans op missende/dubbele regels). Aflopend sorteren met een minteken: `orderbyfieldids=-Account`. Kies bij voorkeur integer-velden (snelste index).

### Meta-info per GetConnector

Met `GET /metainfo/get/{Connector}` vraag je per GetConnector de velden op, met veldtype, label, veldlengte en (bij gekoppelde codetabellen) de codetabelwaarden. Voorbeeld: `/metainfo/get/Profit_Accounts`.

### Maximale URL-lengte

De parameterstring is gelimiteerd op **2049 tekens**; langer levert `HTTP 404 Not Found` op.

### SubjectConnector — bijlagen ophalen

Om de SubjectConnector aan te roepen heb je een `SubjectId` en `FileId` nodig. Deze id's vraag je op via bijvoorbeeld `ProfitSubjectsAuthorized` en `Profit_Subject_Attachments`.

De best practice is om op basis van de `ProfitSubjectsAuthorized` door de `Profit_Subject_Attachments` te loopen, want één dossieritem kan meerdere bijlagen bevatten. Daarna roep je per row in `Profit_Subject_Attachments` de `SubjectConnector` aan met de ontvangen id's.

- **Let op 1:** de naam van een bijlage kan meerdere keren voorkomen, ook binnen één dossieritem of reactie. Houd hier rekening mee bij het verwerken van bijlagen.
- **Let op 2:** foutmelding `404 (Not Found)` betekent dat het bestand niet op schijf beschikbaar is óf dat je er geen rechten op hebt. Test dit altijd via AFAS Profit als gebruiker en pas eventueel de autorisatie aan zodat de tokengebruiker voldoende rechten heeft.

_Bron: AFAS OASContent (github.com/AFASSoftware/OASContent), commit 112c52071d663752b3103bc95848c8861cd1d7a5. Scope: Profit, Nederlands._
