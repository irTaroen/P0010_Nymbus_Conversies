/**
 * A client's own copy of a module's field mapping — the exception a project states
 * in *Projectinstellingen → Afwijkende koppelingen*: this module doesn't fit the
 * standard mapping, made against the schema of Nymbus's **template** (test)
 * environment, so it needs its own, read against **this project's own** AFAS.
 *
 * This is a different address space from [`afas-schema.ts`](./afas-schema.ts) and
 * [`field-mapping.ts`](./field-mapping.ts): the standard flow is addressed by
 * `group`+`connector`, because the question there is *which environment*. Here the
 * question is *which project, which module* — a project can only ever read its own
 * AFAS, and a module can be flagged without naming a connector at all (the app side
 * of the flag, in `project-settings.ts`), so `/api/projects/{id}/…` and
 * `/api/afas/updateconnectors/clients` are kept apart rather than forced through
 * `mappingKey()`.
 *
 * A module can only be opened here once it has a **standard** mapping to start
 * from — a client's copy is a snapshot of that one, not built from nothing — which
 * is why `connector` below is nullable: a flagged module nothing has mapped yet has
 * no schema to read and nothing to snapshot.
 */

import { jsonBody, requestJson } from "@/lib/api";
import type { AfasSchemaEnvironment, AfasUpdateSchema } from "@/lib/afas-schema";
import {
  forgetStoredMappings,
  type MappingExport,
  type StoredMapping,
} from "@/lib/field-mapping";
import { tr } from "@/lib/i18n";

/** One module a project has flagged as mapped differently. */
export interface ClientMappingModule {
  moduleId: string;
  moduleLabel: string;
  /** The connector its standard mapping targets, or `null` — nothing mapped yet, so
   * nothing here to open either. */
  connector: string | null;
  hasMapping: boolean;
  /**
   * The catalog module a **custom module** (maatwerk) rides on, or `null` for a
   * flagged catalog module. Both are a client mapping read against the project's own
   * AFAS, so the rail lists them together; this is what tells them apart. See
   * [`custom-modules.ts`](./custom-modules.ts).
   */
  parentModuleId: string | null;
}

/** One project with at least one flagged module. */
export interface ClientMappingProject {
  projectId: string;
  projectName: string;
  modules: ClientMappingModule[];
}

/** Every project with a flagged module, and where each one stands. */
export async function fetchClientMappingProjects(): Promise<ClientMappingProject[]> {
  const data = await requestJson<{ projects: ClientMappingProject[] }>(
    "/api/afas/updateconnectors/clients",
    undefined,
    tr("De klantkoppelingen konden niet worden opgehaald.", "The client mappings couldn't be loaded.")
  );
  return data.projects;
}

/** One flagged module's schema, and which connector and environment it came from. */
export interface ClientUpdateSchema {
  connector: string;
  schema: AfasUpdateSchema;
  environment: AfasSchemaEnvironment;
}

/** A module's connector schema, read from that project's own AFAS test environment. */
export async function fetchProjectUpdateSchema(
  projectId: string,
  moduleId: string
): Promise<ClientUpdateSchema> {
  return requestJson<ClientUpdateSchema>(
    `/api/projects/${encodeURIComponent(projectId)}/updateconnectors/${encodeURIComponent(moduleId)}`,
    undefined,
    tr(
      `De opbouw van ${moduleId} kon niet worden opgehaald.`,
      `The structure of ${moduleId} couldn't be loaded.`
    )
  );
}

/** Store this project's own copy of one module's mapping — a snapshot, not a link. */
export async function saveClientMapping(
  projectId: string,
  moduleId: string,
  document: MappingExport
): Promise<StoredMapping> {
  const data = await requestJson<{ mapping: StoredMapping }>(
    `/api/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(moduleId)}`,
    jsonBody("PUT", { mapping: document }),
    tr("De koppeling kon niet worden opgeslagen.", "The mapping couldn't be saved.")
  );
  // The payload view reads client mappings from the same cached list as the
  // standard ones (a custom module's step), so a save has to drop it too.
  forgetStoredMappings();
  return data.mapping;
}

/** Forget this project's copy. Deleting one that isn't there is not an error. */
export async function deleteClientMapping(projectId: string, moduleId: string): Promise<void> {
  await requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/mappings/${encodeURIComponent(moduleId)}`,
    { method: "DELETE" },
    tr("De koppeling kon niet worden verwijderd.", "The mapping couldn't be deleted.")
  );
  forgetStoredMappings();
}
