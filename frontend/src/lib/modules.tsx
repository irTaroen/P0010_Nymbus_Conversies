/**
 * Module catalog + filename-based recognition.
 *
 * A "module type" is one AFAS import (Medewerkers, Debiteuren, …). The catalog below
 * holds the static metadata of every module the tool supports — label, filename
 * patterns, template — keyed by the id that rules, help and AFAS mapping share, and
 * mapped to its AFAS module id.
 *
 * *Which* of them a project may actually import is not decided here: the backend
 * answers that per project (`GET /api/projects/{id}/modules`), and
 * `fetchProjectModules()` resolves its module ids against this catalog into the
 * groups the sidebar and the module picker render.
 */

import { Users, Building2, LayoutGrid } from "lucide-react";
import { requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

export interface ModuleDef {
  id: string;
  /**
   * The module's **deeltaakcode** in Nymbus's AFAS environment (`MW`, `DB`, …) —
   * the join between this catalog and `Nymbus_Deeltaaktypes`.
   *
   * Not unique, and not a key: AFAS's `VP` (Verlofsaldi en parameters) covers
   * both *Verlofsaldo* and *Salarisparameters*, and `OP` covers both *Openstaande
   * posten* and *Vaste activa*. Each keeps its own template, rule set and help, and
   * both show that one deeltaak's workflow status. Empty means AFAS has no
   * deeltaak for this module, so no project can ever offer it.
   */
  afasModuleId: string;
  /** The module's name in the language right now — see `localizedModule`. */
  readonly label: string;
  /**
   * Lower-cased substrings in a filename that indicate this module — the Dutch and
   * the English names both, whatever the app's language: a client names their file
   * in their own language, not in ours.
   */
  patterns: string[];
  /**
   * Path to the downloadable Excel template, served from /public — the English copy
   * under `/templates/en/` when the app is in English and the module has one.
   */
  readonly templateUrl?: string;
}

/** A catalog entry as written: both languages, before `localizedModule` picks one. */
interface ModuleSource extends Omit<ModuleDef, "label" | "templateUrl"> {
  label: string;
  labelEn: string;
  templateUrl?: string;
  templateUrlEn?: string;
}

/**
 * A catalog entry whose `label` and `templateUrl` are **read** in the language of the
 * moment rather than fixed at load — getters, so the hundred-odd places that print
 * `module.label` follow the NL/EN switch without each picking a language itself. A
 * component re-renders on a switch through its own `useT()`; the getter then hands
 * it the new name. (A spread copy — `{ ...module }` — keeps the name it was copied
 * in, so pass the def itself around.)
 */
function localizedModule({ label, labelEn, templateUrl, templateUrlEn, ...rest }: ModuleSource): ModuleDef {
  return {
    ...rest,
    get label() {
      return tr(label, labelEn);
    },
    get templateUrl() {
      return (templateUrlEn && tr(templateUrl, templateUrlEn)) || templateUrl;
    },
  };
}

/**
 * What a deeltaak's workflow status means for the person looking at it. AFAS has
 * eighteen status codes; a sidebar needs four answers.
 */
export type ModuleStatusTone = "done" | "rejected" | "client" | "nymbus";

/** Statuses that settle the tone whatever the task: finished, or turned down. */
const STATUS_TONES: Record<string, ModuleStatusTone> = {
  A: "done", // Afgerond
  NA: "rejected", // Niet akkoord
  IA: "rejected", // Testimport niet akkoord
  LN: "rejected", // Live import niet akkoord
};

/**
 * Done and turned-down settle it; otherwise it is whose turn the current task is —
 * `withNymbus`, the same flag behind the sidebar's hourglass, decided per task in
 * the backend (`CLIENT_TASKS` in the hosted version's backend). Not by status code: *Controle
 * testimport* arrived as `CI` and read as "Bij Nymbus" while it was the client's.
 */
export function moduleStatusTone(
  status: Pick<ModuleStatus, "statusCode" | "withNymbus">
): ModuleStatusTone {
  const byStatus = STATUS_TONES[status.statusCode.toUpperCase()];
  if (byStatus) return byStatus;
  return status.withNymbus ? "nymbus" : "client";
}

/**
 * Whether a module's conversion has **started**: its deeltaak has left *Template
 * vullen*, or is *Afgerond* — a finished deeltaak sits at no task, so the backend's
 * flag alone would call it unstarted. A module AFAS answers no status for hasn't.
 */
export function moduleStarted(status: ModuleStatus | null | undefined): boolean {
  if (!status) return false;
  return status.started || moduleStatusTone(status) === "done";
}

/**
 * The four tones in reading order, each with the word a surface names it by — the
 * projectrapport's status meter, its legend and its per-module chips.
 *
 * Best first, worst last: *Afgerond* is where a module is going and *Niet akkoord* is
 * the one that needs someone, so a project's meter fills from the left as it
 * progresses. AFAS's own status description (*Sjabloon gevuld*) is always the sharper
 * answer for a **single** module and is what a row shows; these labels are for the
 * places that have to put eighteen status codes in four buckets and add them up.
 */
export const MODULE_STATUS_SEGMENTS = [
  { id: "done", label: "Afgerond" },
  { id: "nymbus", label: "Bij Nymbus" },
  { id: "client", label: "Bij de klant" },
  { id: "rejected", label: "Niet akkoord" },
] as const satisfies readonly { id: ModuleStatusTone; label: string }[];

/**
 * The fill each tone is drawn in — one map, because it is read by two surfaces in
 * the same medium: the sidebar's status dot and the projectrapport's meter, legend
 * and row chips. Status colours, not series colours; and nothing ever says a status
 * with colour alone (see design-system.md).
 */
export const STATUS_TONE_FILL: Record<ModuleStatusTone, string> = {
  done: "bg-k-green-fg",
  rejected: "bg-k-red-fg",
  client: "bg-k-cloud-deep",
  nymbus: "bg-k-cyan-fg",
};

/** One workflow action at a deeltaak's current task — see `ModuleStatus.actions`. */
export interface WorkflowAction {
  /** The action's `ActieId` at its task — what `POST /api/workflow/action` takes. */
  number: number;
  /** Its button label (*Template gevuld*, *Import akkoord*) — the backend's
   *  `ACTION_LABELS` entry for its task and number, the AFAS caption without one. */
  label: string;
  /** The hand-in: carries the sheet itself, so it is the *Aanleveren* flow
   *  (`/api/upload`) rather than a plain reaction. */
  submit: boolean;
}

/** Where a module stands in AFAS — the backend reads it off the deeltaak. */
export interface ModuleStatus {
  /** The deeltaak's workflow status code (`KL`, `SG`, `NA`, `A`, …). */
  statusCode: string;
  /** Its description, as AFAS words it (*Klant*, *Sjabloon gevuld*, …). */
  status: string;
  /** The workflow task it is waiting on (*Template vullen*). */
  task: string;
  /** The dossieritem a sheet for this module is attached to. */
  dossierItemId: string;
  /**
   * When this module is due to be delivered, as AFAS writes a date
   * (`2026-08-09`), or `""` when it has none — which is every module today: the
   * dossieritem connector has no such field yet (`OPLEVERDATUM_FIELD` in
   * the hosted version's backend), so the projectrapport's column shows a dash until it does.
   */
  deliveryDate: string;
  /**
   * Every workflow action at the deeltaak's current task, in AFAS's order — one
   * toolbar button each, labelled with the action's own AFAS caption, so an
   * action reworded in AFAS renames its button. *Verwijderen* is never among
   * them (`HIDDEN_ACTIONS` in the hosted version's backend). `[]` on a finished deeltaak.
   */
  actions: WorkflowAction[];
  /**
   * Whether those buttons are for admins (and so developers) only: the task's
   * AFAS `Gebruikersgroepen` name Nymbus's Datateam (`ADMIN_GROUP` in
   * the hosted version's backend). Everyone else on the project sees the buttons of every
   * other task.
   */
  adminOnly: boolean;
  /**
   * The current task is Nymbus's rather than the client's — decided per task in
   * the backend (`CLIENT_TASKS`, see `_with_nymbus()` (the hosted version)). While true, the
   * workflow actions are admin-only and the client sees a waiting notice
   * instead — they can still read comments/files and use the checker.
   */
  withNymbus: boolean;
  /**
   * The deeltaak has left its first task, *Template vullen* — a sheet has been
   * uploaded and handed in at least once (`START_TASK` in the hosted version's backend). The
   * projectrapport's *opgestart*; false for a finished deeltaak, which sits at no
   * task, so read it through `moduleStarted()`.
   */
  started: boolean;
  /**
   * The conversion step open at the current task — validatie, test or live
   * (`STAGE_TASKS` in the hosted version's backend); null at no task, which is where a
   * finished deeltaak sits, so read it through `conversionSteps()`/`conversionPhase()`.
   */
  stage: ConversionStage | null;
}

/**
 * The conversion's three steps, in order: the sheet is **validated**, then imported
 * in the **test** environment, then in the **live** one — and the client judges
 * both imports. Without them a module at 100% reads as finished while it is only
 * clean, or only in test; a module is done once the live step is.
 */
export type ConversionStage = "validatie" | "test" | "live";

export const CONVERSION_STEPS = [
  { id: "validatie", label: "Validatie" },
  { id: "test", label: "Test" },
  { id: "live", label: "Live" },
] as const satisfies readonly { id: ConversionStage; label: string }[];

/** One step as a module stands on it: behind it, on it, turned down on it, or ahead. */
export type StepState = "done" | "current" | "rejected" | "todo";

export interface ConversionStep {
  id: ConversionStage;
  label: string;
  state: StepState;
}

/**
 * A module's three steps, or null for one AFAS gives no step for (no status, or a
 * task outside the three). The steps before the open one are done; the open one is
 * `current`, or `rejected` when the status says *niet akkoord* — the same tone the
 * status column's dot is drawn in, so the two can't disagree. *Afgerond* is every
 * step done: it sits at no task, so it is read off the status, as `moduleStarted()`
 * reads it.
 */
export function conversionSteps(status: ModuleStatus | null | undefined): ConversionStep[] | null {
  if (!status) return null;
  const tone = moduleStatusTone(status);
  if (tone === "done") return CONVERSION_STEPS.map((step) => ({ ...step, state: "done" }));
  if (!status.stage) return null;
  const open = CONVERSION_STEPS.findIndex((step) => step.id === status.stage);
  return CONVERSION_STEPS.map((step, i) => ({
    ...step,
    state: i < open ? "done" : i > open ? "todo" : tone === "rejected" ? "rejected" : "current",
  }));
}

/**
 * Where a module is in the conversion, as one bucket a meter can count: the open
 * step, or *afgerond* once the live import is approved. Null for a module AFAS gives
 * no step for.
 */
export type ConversionPhase = "afgerond" | ConversionStage;

export function conversionPhase(status: ModuleStatus | null | undefined): ConversionPhase | null {
  if (!status) return null;
  if (moduleStatusTone(status) === "done") return "afgerond";
  return status.stage;
}

/**
 * The phases in the order a module goes through them — *Validatie*, *Test*, *Live*,
 * *Afgerond* — so the reports' *Fase* meter and legend read left to right like the
 * stepper on each row does, and the green grows towards the right as modules move on.
 */
export const CONVERSION_PHASE_SEGMENTS = [
  { id: "validatie", label: "Validatie" },
  { id: "test", label: "Test" },
  { id: "live", label: "Live" },
  { id: "afgerond", label: "Afgerond" },
] as const satisfies readonly { id: ConversionPhase; label: string }[];

/**
 * The phase fills: grey for the modules nothing has been imported for yet, green for
 * *Test*, cyan for *Live* and purple for *Afgerond* — four hues that can't be
 * mistaken for each other side by side. Chosen with Nymbus, 23-10-2026.
 */
export const PHASE_FILL: Record<ConversionPhase, string> = {
  afgerond: "bg-k-purple-fg",
  live: "bg-k-cyan-fg",
  test: "bg-k-green-fg",
  validatie: "bg-k-text-tertiary",
};

export interface ModuleGroup {
  /** Category id, lower-cased (`hrm`, `erp`). */
  id: string;
  label: string;
  icon: React.ReactNode;
  items: ModuleDef[];
}

/**
 * Every module the tool supports; a project gets a subset.
 *
 * The order here is the order the sidebar shows them in, per category. Keep it in
 * step with `backend/json_files/modules.json`, which carries the same ids, labels
 * and deeltaakcodes — that file is what the backend groups a project's deeltaken
 * with.
 */
export const MODULE_CATALOG: ModuleDef[] = ([
  { id: "hrm-medewerkers", afasModuleId: "MW", label: "Medewerkers", labelEn: "Employees", patterns: ["medewerker", "personeel", "employee"], templateUrl: "/templates/HRM_1_Medewerkers.xlsx", templateUrlEn: "/templates/en/HRM_1_Employees.xlsx" },
  { id: "hrm-uitzendkrachten", afasModuleId: "UZ", label: "Uitzendkrachten", labelEn: "Contractors", patterns: ["uitzendkracht", "uitzend", "contractor", "temporary worker", "temp worker"], templateUrl: "/templates/HRM_2_Uitzendkrachten.xlsx", templateUrlEn: "/templates/en/HRM_2_Contractors.xlsx" },
  { id: "hrm-verlofsaldo", afasModuleId: "VP", label: "Verlofsaldo", labelEn: "Leave balance", patterns: ["verlofsaldo", "verlof", "leave balance"], templateUrl: "/templates/HRM_4_Verlofsaldo.xlsx", templateUrlEn: "/templates/en/HRM_4_Leave%20balance.xlsx" },
  { id: "hrm-salarisparameters", afasModuleId: "SA", label: "Salarisparameters", labelEn: "Payroll parameters", patterns: ["salarisparameter", "payroll parameter", "salary parameter"], templateUrl: "/templates/HRM_6_Salarisparameter.xlsx", templateUrlEn: "/templates/en/HRM_6_Payroll%20parameters.xlsx" },
  { id: "hrm-wagenpark", afasModuleId: "WA", label: "Wagenpark", labelEn: "Fleet", patterns: ["wagenpark", "leaseauto", "fleet", "lease car"], templateUrl: "/templates/HRM_3_Wagenpark.xlsx", templateUrlEn: "/templates/en/HRM_3_Fleet.xlsx" },
  // Geen deeltaak in AFAS — zie backend/json_files/modules.json en docs/todo.md.
  { id: "hrm-vakantietoeslag", afasModuleId: "GV", label: "Vakantietoeslag", labelEn: "Holiday allowance", patterns: ["vakantietoeslag", "vakantiegeld", "holiday allowance", "holiday pay"], templateUrl: "/templates/HRM_5_Grondslag%20Vakantietoeslag.xlsx", templateUrlEn: "/templates/en/HRM_5_Holiday%20allowance%20basis.xlsx" },
  { id: "erp-debiteuren", afasModuleId: "DB", label: "Debiteuren", labelEn: "Debtors", patterns: ["debiteur", "debtor"], templateUrl: "/templates/ERP_1_Debiteuren.xlsx", templateUrlEn: "/templates/en/ERP_1_Debtors.xlsx" },
  { id: "erp-crediteuren", afasModuleId: "CR", label: "Crediteuren", labelEn: "Creditors", patterns: ["crediteur", "creditor"], templateUrl: "/templates/ERP_2_Crediteuren.xlsx", templateUrlEn: "/templates/en/ERP_2_Creditors.xlsx" },
  { id: "erp-contactpersonen", afasModuleId: "CO", label: "Contactpersonen", labelEn: "Contact persons", patterns: ["contactpersoon", "contactpersonen", "contact person", "contacts"], templateUrl: "/templates/ERP_3_Contacten.xlsx", templateUrlEn: "/templates/en/ERP_3_Contacts.xlsx" },
  // Geen deeltaak in AFAS — zie backend/json_files/modules.json en docs/todo.md.
  // Connector: FbItemArticle (bevestigd via live metainfo).
  { id: "erp-artikelen", afasModuleId: "AR", label: "Artikelen", labelEn: "Items", patterns: ["artikel", "article"], templateUrl: "/templates/ERP_4_Artikelen.xlsx", templateUrlEn: "/templates/en/ERP_4_Items.xlsx" },
  { id: "erp-projecten", afasModuleId: "PR", label: "Projecten", labelEn: "Projects", patterns: ["project"], templateUrl: "/templates/ERP_5_Projecten.xlsx", templateUrlEn: "/templates/en/ERP_5_Projects.xlsx" },
  { id: "erp-voorcalculatie", afasModuleId: "VC", label: "Voorcalculatie", labelEn: "Pre-calculation", patterns: ["voorcalculatie", "pre-calculation", "precalculation"], templateUrl: "/templates/ERP_6_Voorcalculatie.xlsx", templateUrlEn: "/templates/en/ERP_6_Pre-calculation.xlsx" },
  { id: "erp-abonnementen", afasModuleId: "AB", label: "Abonnementen", labelEn: "Subscriptions", patterns: ["abonnement", "subscription"], templateUrl: "/templates/ERP_7_Abonnementen.xlsx", templateUrlEn: "/templates/en/ERP_7_Subscriptions.xlsx" },
  { id: "erp-vasteActiva", afasModuleId: "OP", label: "Vaste activa", labelEn: "Fixed assets", patterns: ["vaste activa", "vasteactiva", "fixed asset"], templateUrl: "/templates/ERP_8_Vaste%20Activa.xlsx", templateUrlEn: "/templates/en/ERP_8_Fixed%20assets.xlsx" },
  { id: "erp-openstaandposten", afasModuleId: "OP", label: "Openstaande posten", labelEn: "Outstanding invoices", patterns: ["openstaande posten", "outstanding invoice", "open item"], templateUrl: "/templates/ERP_9_Openstaande%20posten.xlsx", templateUrlEn: "/templates/en/ERP_9_Outstanding%20invoices.xlsx" },
  // Nieuw (22-09-2026): zes ERP-modules waarvan de regelsets zijn afgeleid van de
  // officiële AFAS OpenAPI-specificatie (github.com/afassoftware/oascontent) —
  // Nacalculatie (PtRealization), Financiële contracten (FiContract), Inkoopoffertes
  // (FbPurchQuotation), Inkooporders (FbPurch), Beginbalansen (FiEntries) en
  // Dossieritems (KnSubject, waar ook de inkoopfacturen onder vallen).
  // LET OP: de deeltaakcodes hieronder zijn NOG NIET in AFAS aangemaakt
  // (Nymbus_Deeltaaktypes). Zolang dat niet gebeurd is, levert AFAS voor deze
  // modules geen dossieritem en verschijnen ze niet in de sidebar — een onbekende
  // deeltaakcode wordt overgeslagen. Een templateUrl alleen waar het sjabloon er is
  // (Financiële contracten, 20-10-2026); de rest heeft er nog geen.
  // Zie docs/todo.md.
  { id: "erp-nacalculatie", afasModuleId: "NC", label: "Nacalculatie", labelEn: "Post-calculation", patterns: ["nacalculatie", "post-calculation", "postcalculation"] },
  { id: "erp-financielecontracten", afasModuleId: "FC", label: "Financiële contracten", labelEn: "Financial contracts", patterns: ["financiele contracten", "financiële contracten", "contracten", "financial contract"], templateUrl: "/templates/ERP_10_Financi%C3%ABle%20contracten.xlsx", templateUrlEn: "/templates/en/ERP_10_Financial%20contracts.xlsx" },
  { id: "erp-inkoopoffertes", afasModuleId: "IOF", label: "Inkoopoffertes", labelEn: "Purchase quotations", patterns: ["inkoopoffertes", "inkoopofferte", "purchase quotation"] },
  { id: "erp-inkooporders", afasModuleId: "IOR", label: "Inkooporders", labelEn: "Purchase orders", patterns: ["inkooporders", "inkooporder", "purchase order"] },
  { id: "erp-beginbalansen", afasModuleId: "BB", label: "Beginbalansen", labelEn: "Opening balances", patterns: ["beginbalansen", "beginbalans", "opening balance"] },
  { id: "erp-dossieritems", afasModuleId: "DI", label: "Dossieritems", labelEn: "Dossier items", patterns: ["dossieritems", "dossieritem", "inkoopfacturen", "inkoopfactuur", "dossier item", "purchase invoice"] },
] satisfies ModuleSource[]).map(localizedModule);

const BY_ID = new Map(MODULE_CATALOG.map((m) => [m.id, m]));

/** One category of modules — the HRM / ERP split the sidebar groups by. */
export interface ModuleCategory {
  /** Lower-cased, as the backend groups them (`hrm`, `erp`). */
  id: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * Every category there is, in display order — the same two `modules.json` keys the
 * backend groups a project's deeltaken under, so keep them in step with it like
 * `MODULE_CATALOG` above.
 *
 * A project only ever carries the categories it *has* modules in, so anything that
 * shows a column or a heading per category (the project picker's HRM/ERP boxes)
 * needs the full list from somewhere. This is that somewhere.
 */
export const MODULE_CATEGORIES: ModuleCategory[] = [
  { id: "hrm", label: "HRM", icon: <Users className="h-4 w-4" strokeWidth={1.8} /> },
  { id: "erp", label: "ERP", icon: <Building2 className="h-4 w-4" strokeWidth={1.8} /> },
];

const CATEGORY_ICONS = new Map(MODULE_CATEGORIES.map((c) => [c.id, c.icon]));

export function getModule(id: string): ModuleDef | undefined {
  return BY_ID.get(id);
}

/** `GET /api/projects/{id}/modules` — categories with the project's modules. */
export interface ProjectModulesResponse {
  groups: {
    id: string;
    label: string;
    modules: ({ id: string; name: string; deeltaakcode: string } & ModuleStatus)[];
  }[];
}

/** What one project's module fetch produced. */
export interface ProjectModules {
  groups: ModuleGroup[];
  /**
   * Where each module stands in AFAS, keyed by catalog module id.
   *
   * It rides along with the groups rather than having a fetch of its own because
   * it comes out of the same connector read: the deeltaak row *is* both "this
   * project has this module" and "and it stands here".
   */
  statuses: Map<string, ModuleStatus>;
}

/**
 * The module groups a project may import, in the order the backend returns them,
 * each module with the workflow status AFAS holds for its deeltaak.
 *
 * The backend answers in the app's own module ids, so nothing has to be resolved
 * through the AFAS code here — which matters, because that code is not unique.
 * Ids the catalog doesn't know are skipped: a module only shows up once it has an
 * entry above, and with it a rule set and help content.
 */
export async function fetchProjectModules(projectId: string): Promise<ProjectModules> {
  const data = await requestJson<ProjectModulesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/modules`,
    undefined,
    "De modules konden niet worden opgehaald."
  );
  return parseProjectModules(data);
}

/**
 * A modules answer as the app holds it. Split from the fetch so `/voortgang`'s own
 * endpoint, which returns the same `groups`, goes through exactly this.
 */
export function parseProjectModules(data: ProjectModulesResponse): ProjectModules {
  const statuses = new Map<string, ModuleStatus>();
  const groups = data.groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      icon: CATEGORY_ICONS.get(group.id) ?? <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />,
      items: group.modules
        .map((m) => {
          const def = BY_ID.get(m.id);
          if (!def) return undefined;
          statuses.set(def.id, {
            statusCode: m.statusCode,
            status: m.status,
            task: m.task,
            dossierItemId: m.dossierItemId,
            deliveryDate: m.deliveryDate ?? "",
            actions: m.actions ?? [],
            adminOnly: m.adminOnly ?? false,
            withNymbus: m.withNymbus,
            started: m.started ?? false,
            stage: m.stage ?? null,
          });
          return def;
        })
        .filter((m): m is ModuleDef => m !== undefined),
    }))
    .filter((group) => group.items.length > 0);

  return { groups, statuses };
}

export type ModuleRecognition =
  | { status: "recognized"; moduleId: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unknown" };

/**
 * Infer the module type from a filename, choosing only between `modules` — the
 * project's own set, so a file is never matched to a module it can't import.
 *
 * - `recognized` — exactly one module's patterns matched.
 * - `ambiguous`  — several matched; the user must choose.
 * - `unknown`    — nothing matched; the user must choose.
 */
export function recognizeModule(
  fileName: string,
  modules: ModuleDef[]
): ModuleRecognition {
  const name = fileName.toLowerCase();
  const matches = modules
    .filter((m) => m.patterns.some((p) => name.includes(p)))
    .map((m) => m.id);

  if (matches.length === 1) return { status: "recognized", moduleId: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "unknown" };
}
