/**
 * **Custom modules** (maatwerk): a third step some projects add to a standard module.
 *
 * A client whose AFAS carries fields no other client has (vrije velden, `U…` codes on
 * the employee) gets them written **after** the standard module: the same
 * UpdateConnector, one PUT per record the parent already created. Phases 1 and 2 of
 * Medewerkers stay the same for every project; only a project with a custom module
 * gets this extra send.
 *
 * What a custom module is **not**, and why that keeps it small:
 *
 * - **Not a sheet of its own.** Its columns sit in the parent's sheet (the client's
 *   Medewerkers export), so it reads the sheet already open under the parent — but it
 *   is shown as **itself**: the sidebar's *Maatwerk* entry (`payloadStepPath()` in
 *   [`routes.ts`](./routes.ts)) opens the payload view
 *   ([`ModulePayloadPanel`](../components/uploader/ModulePayloadPanel.tsx)) with only
 *   its bodies, and none of the parent's phases beside them.
 * - **Not validated.** A one-to-one mapping of columns or fixed values: no rule set,
 *   no help article, no codetabel checks.
 * - **Not a new connector.** It inherits the parent's, fixed by the backend when the
 *   module is added, and its schema is read from **this project's own** AFAS — the
 *   fields it exists for are the ones the template environment lacks.
 *
 * Added in *Projectinstellingen → Maatwerk*; its mapping is made in the
 * UpdateConnector explorer's client section and stored like an *Afwijkende koppeling*,
 * under `mappings/clients/<projectId>/<id>.json`. The definitions live in
 * `backend/json_files/custom_modules.json`.
 */

import { jsonBody, requestJson } from "@/lib/api";

export interface CustomModule {
  /** `<parent>--<slug>` — `hrm-medewerkers--vrije-velden`. */
  id: string;
  label: string;
  /** The catalog module whose sheet it reads and whose records it updates. */
  parentModuleId: string;
  parentLabel: string;
  /** The parent's connector, fixed when the module was added. */
  connector: string;
  /** Whether its mapping has been saved — without one there is nothing to send. */
  hasMapping: boolean;
  createdAt: string | null;
  createdBy: string | null;
}

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/custom-modules`;
}

/** This project's custom modules, in the order they were added. */
export async function fetchCustomModules(projectId: string): Promise<CustomModule[]> {
  const data = await requestJson<{ modules: CustomModule[] }>(
    base(projectId),
    undefined,
    "De maatwerkmodules konden niet worden opgehaald."
  );
  return data.modules;
}

/** Add one. The backend derives the id and the connector; a duplicate is a 409. */
export async function addCustomModule(
  projectId: string,
  label: string,
  parentModuleId: string
): Promise<CustomModule> {
  const data = await requestJson<{ module: CustomModule }>(
    base(projectId),
    jsonBody("POST", { label, parentModuleId }),
    "De maatwerkmodule kon niet worden toegevoegd."
  );
  return data.module;
}

/** Remove one **and its mapping**. Removing one that isn't there is not an error. */
export async function deleteCustomModule(projectId: string, moduleId: string): Promise<void> {
  await requestJson(
    `${base(projectId)}/${encodeURIComponent(moduleId)}`,
    { method: "DELETE" },
    "De maatwerkmodule kon niet worden verwijderd."
  );
}
