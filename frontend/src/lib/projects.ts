/**
 * Creating, changing and removing projects — the local stand-in for what Nymbus's
 * own AFAS environment used to answer. A project lives in `projects.json`, its
 * modules (and their stage and figures) in `project_modules.json`, its AFAS
 * credentials in the gitignored `client_tokens.json` (`backend/local_store.py`).
 *
 * After any of these the session's project list is stale: callers refresh it
 * (`useAuth().refresh()`).
 */

import { apiUrl, jsonBody, requestJson } from "@/lib/api";
import type { Project } from "@/lib/auth";
import { tr } from "@/lib/i18n";

export type ConversionType = Project["conversionType"];

export const CONVERSION_TYPES: { id: ConversionType; label: string; labelEn: string }[] = [
  { id: "standard", label: "Standaard", labelEn: "Standard" },
  { id: "facilitair", label: "Facilitair", labelEn: "Facility services" },
  { id: "dossier", label: "Dossierconversie (AFAS → AFAS)", labelEn: "Dossier conversion (AFAS → AFAS)" },
];

/** One category of the module catalog (`modules.json`), as the pickers list it. */
export interface CatalogGroup {
  id: string;
  label: string;
  modules: { id: string; name: string }[];
}

/** Every module the tool knows, grouped by category. */
export async function fetchModuleCatalog(): Promise<CatalogGroup[]> {
  const data = await requestJson<{ groups: CatalogGroup[] }>(
    "/api/modules",
    undefined,
    tr("De modulelijst kon niet worden geladen.", "The module list could not be loaded.")
  );
  return data.groups ?? [];
}

export interface NewProject {
  id: string;
  name: string;
  omgeving: string;
  conversionType: ConversionType;
  modules: string[];
}

export async function createProject(project: NewProject): Promise<Project> {
  const data = await requestJson<{ project: Project }>(
    "/api/projects",
    jsonBody("POST", project),
    tr("Het project kon niet worden aangemaakt.", "The project could not be created.")
  );
  return data.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
    tr("Het project kon niet worden verwijderd.", "The project could not be removed.")
  );
}

/** Make the project carry exactly these modules. A module kept keeps its figures. */
export async function saveProjectModules(projectId: string, modules: string[]): Promise<void> {
  await requestJson<{ modules: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/module-list`,
    jsonBody("PUT", { modules }),
    tr("De modules konden niet worden opgeslagen.", "The modules could not be saved.")
  );
}

export async function saveConversionType(
  projectId: string,
  conversionType: ConversionType
): Promise<void> {
  await requestJson<{ conversionType: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/conversion-type`,
    jsonBody("PUT", { conversionType }),
    tr("De conversiesoort kon niet worden opgeslagen.", "The conversion type could not be saved.")
  );
}

export type ProjectStatus = "realisatie" | "afgemeld";

export const PROJECT_STATUSES: { id: ProjectStatus; label: string; labelEn: string }[] = [
  { id: "realisatie", label: "Realisatie", labelEn: "In progress" },
  { id: "afgemeld", label: "Afgemeld", labelEn: "Closed" },
];

/** Realisatie or Afgemeld — what the picker and the managementrapport filter on. */
export async function saveProjectStatus(projectId: string, status: ProjectStatus): Promise<void> {
  await requestJson<{ status: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/status`,
    jsonBody("PUT", { status }),
    tr("De projectstatus kon niet worden opgeslagen.", "The project status could not be saved.")
  );
}

/** A module's stage: where it is in the conversion, shown in the reports as *Fase*. */
export type ModuleStage = "validatie" | "test" | "live" | "afgerond";

/** Set a module's opleverdatum (`yyyy-mm-dd`, `""` clears) and/or its stage. */
export async function saveProjectModule(
  projectId: string,
  moduleId: string,
  fields: { deliveryDate?: string; stage?: ModuleStage }
): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/modules/${encodeURIComponent(moduleId)}`,
    jsonBody("PUT", fields),
    tr("De module kon niet worden opgeslagen.", "The module could not be saved.")
  );
}

/** What the connector check found in one environment of a client. */
export interface ConnectorCheck {
  ok: boolean;
  /** AFAS's reason when `ok` is false — usually missing or wrong credentials. */
  message: string;
  environment: { host: string; omgeving: string; stage: string } | null;
  /** Every `.gcn` in `connectoren/`: whether the app connector exposes it. */
  getConnectors: { id: string; present: boolean; file: string }[];
  /** The UpdateConnectors this project's modules write to. */
  updateConnectors: { id: string; present: boolean; modules: string[] }[];
}

export async function checkProjectConnectors(
  projectId: string,
  stage: "test" | "live"
): Promise<ConnectorCheck> {
  return requestJson<ConnectorCheck>(
    `/api/projects/${encodeURIComponent(projectId)}/connectors/check?stage=${stage}`,
    undefined,
    tr("De connectoren konden niet worden gecontroleerd.", "The connectors could not be checked.")
  );
}

/** Where a `.gcn` file downloads from, to import in Profit. */
export function gcnDownloadUrl(file: string): string {
  return apiUrl(`/api/connectoren/${encodeURIComponent(file)}`);
}
