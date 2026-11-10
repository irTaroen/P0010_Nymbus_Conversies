/**
 * The project's **intake** — where the first meeting with the client stands, and on
 * which day it is or was.
 *
 * Ours, unlike its neighbours on the *Conversie* tab ([`conversion-settings.ts`](./conversion-settings.ts)):
 * AFAS has no field for it, so it is stored in our own `project_settings` table
 * (`intake_status` / `intake_datum`, see `backend/db.py`) and saved on its own route.
 * Admins set it in the project settings; the managementrapport reads every project's
 * at once, so a manager can see whether an intake has been planned yet.
 */

import { jsonBody, requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

export type IntakeStatus = "niet_ingepland" | "uitnodiging_verstuurd" | "ingepland" | "afgerond";

/*
 * The labels are getters, not strings: each is read at the moment it is shown, so the
 * language follows the switch rather than the import.
 */

/** In the order the dropdown lists them. The first is the default. */
export const INTAKE_STATUSES: readonly { value: IntakeStatus; readonly label: string }[] = [
  { value: "niet_ingepland", get label() { return tr("Nog niet ingepland", "Not yet scheduled"); } },
  { value: "uitnodiging_verstuurd", get label() { return tr("Uitnodiging verstuurd", "Invitation sent"); } },
  { value: "ingepland", get label() { return tr("Intake ingepland", "Intake scheduled"); } },
  { value: "afgerond", get label() { return tr("Intake afgerond", "Intake completed"); } },
];

export const INTAKE_LABEL: Record<IntakeStatus, string> = {
  get niet_ingepland() { return INTAKE_STATUSES[0].label; },
  get uitnodiging_verstuurd() { return INTAKE_STATUSES[1].label; },
  get ingepland() { return INTAKE_STATUSES[2].label; },
  get afgerond() { return INTAKE_STATUSES[3].label; },
};

export type Intake = {
  status: IntakeStatus;
  /** `yyyy-mm-dd`, or `""`. Only ever set for a status `intakeHasDate()` accepts. */
  datum: string;
};

export const DEFAULT_INTAKE: Intake = { status: "niet_ingepland", datum: "" };

/** Whether this status carries a day — the date field is shown for these alone. */
export function intakeHasDate(status: IntakeStatus): boolean {
  return status === "ingepland" || status === "afgerond";
}

function intakePath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/intake`;
}

/** One project's intake (admins only). Throws an `ApiError`. */
export async function fetchIntake(projectId: string): Promise<Intake> {
  const data = await requestJson<{ intake: Intake }>(
    intakePath(projectId),
    undefined,
    tr("De intake kon niet worden geladen.", "The intake could not be loaded."),
  );
  return data.intake;
}

/** Save it, and answer with what was stored — the date dropped for an undated status. */
export async function saveIntake(projectId: string, intake: Intake): Promise<Intake> {
  const data = await requestJson<{ intake: Intake }>(
    intakePath(projectId),
    jsonBody("PUT", intake),
    tr("De intake kon niet worden opgeslagen.", "The intake could not be saved."),
  );
  return data.intake;
}

/**
 * Every project's stored intake, keyed on project id — the managementrapport's one
 * read for the whole page. A project missing from the map has `DEFAULT_INTAKE`.
 */
export async function fetchAllIntakes(): Promise<Map<string, Intake>> {
  const data = await requestJson<{ intakes: Record<string, Intake> }>(
    "/api/voortgang/intakes",
    undefined,
    tr("De intakes konden niet worden geladen.", "The intakes could not be loaded."),
  );
  return new Map(Object.entries(data.intakes));
}
