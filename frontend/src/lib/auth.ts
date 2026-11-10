/**
 * The session and its projects.
 *
 * There is no login: the backend runs as one local user with every right, and
 * `/api/auth/me` answers with that user and every project in `projects.json`.
 * Projects come from the session — there is no separate project catalog on the
 * frontend.
 */

import { requestJson } from "@/lib/api";
import { tr } from "@/lib/i18n";

export type Project = {
  id: string;
  /**
   * The name to show: the *Projectnaam* set in the projectinstellingen
   * (`lib/display-name.ts`) when there is one, AFAS's own name otherwise. Resolved
   * on the backend, and refreshed with `testProject`, so nothing here picks.
   */
  name: string;
  /**
   * AFAS's own name for the project, whatever `name` shows. Optional only because a
   * session stored before it existed lacks it until the next `/me`.
   */
  afasName?: string;
  /** AFAS dossier the project belongs to — its hoofdproces dossieritem. */
  dossierId: string;
  /**
   * Whether AFAS holds **any** dossieritem for this project (hoofdproces or
   * deeltaak). False means the conversion hasn't been set up yet: no item to hand
   * a sheet to and no modules to import, so there is nothing to do in it. The
   * project picker sorts these last and flags them; see `ProjectPickerModal`.
   */
  hasDossier: boolean;
  /** How many deeltaken hang under the project — its modules, before the catalog
   *  narrows them down. 0 whenever `hasDossier` is false. */
  moduleCount: number;
  /** How many of those deeltaken currently wait on Nymbus — their task is Nymbus's,
   *  not the client's (`withNymbus` on a `ModuleStatus`, summed per project). */
  nymbusTaskCount: number;
  /**
   * The categories (`"hrm"`, `"erp"` — `MODULE_CATEGORIES` in `lib/modules.tsx`)
   * the project has at least one importable module in, in catalog order. Which
   * deeltaak belongs to which category is `modules.json`'s answer, not AFAS's, so
   * the backend does the grouping; empty whenever `hasDossier` is false.
   */
  moduleCategories: string[];
  /** The project's own status code in AFAS (`200`) — not a module's workflow status. */
  statusCode: string;
  /** That status as AFAS words it (*Realisatie*). */
  status: string;
  /** The HRM-conversion's periodetabel, off the hoofdproces dossieritem — `null`
   *  for a project that doesn't need one (an ERP-only conversion). */
  hrmPeriodetabel: number | null;
  /** The conversion's livegangdatum, off the hoofdproces dossieritem — `""` until
   *  AFAS has one. */
  livegangDatum: string;
  /** The Appreo-integration's testdatum, off the hoofdproces dossieritem — `""`
   *  until AFAS has one. */
  appreoTestdatum: string;
  /**
   * What kind of conversion this project is, off the hoofdproces dossieritem's
   * `Facilitair_conversie` / `Dossier_conversie` flags (`"standard"` when
   * neither is set) — see `_conversion_type()` in the hosted version's backend. A
   * `"dossier"` project is really an AFAS -> AFAS dossier migration and gets
   * `DossierMigrationPage` instead of the usual module list; see
   * `[project]/layout.tsx`.
   */
  conversionType: "standard" | "facilitair" | "dossier";
  /**
   * How far this project's **AFAS connection** is set up in the projectinstellingen:
   * the environment number and the OAuth client id + secret of its test and live
   * environment. `"complete"` when the environment number and at least one of the two
   * stages are stored, `"none"` when nothing is, `"partial"` for a form somebody
   * started — see `_connection_state()` on the backend.
   *
   * `"unavailable"` is the odd one out: it says nothing about the form, only that
   * the settings store (the Fabric database holding it) could not be read, so how
   * far the form got is **unknown**. Treat it as neither connected nor unconnected —
   * a project that is fully set up reads this way during a Fabric outage, and every
   * message about it has to say *we can't reach the instellingen* rather than
   * *there are none*.
   *
   * The counterpart of `hasDossier` from the other side of the setup: that one says
   * *AFAS has no dossieritem for this project*, this one *Nymbus has given it no AFAS
   * to talk to* — and unlike the first, it is a gap an admin can close from inside
   * the app (`ProjectSettingsDialog`). Anything short of `"complete"` means every
   * upload, codetabel and existence check in the project would fail, so the picker
   * flags it and the project page says so; see `AfasConnectionNotice`.
   *
   * It carries **no** credential — only how far the form got, the same thing the
   * settings route already says per field.
   */
  afasConnection: AfasConnectionState;
  /**
   * The same settings store as `afasConnection`, read one level finer: whether
   * **each** of the project's two AFAS environments is set up — an omgevingsnummer
   * (shared by both) plus that stage's own client id and secret. The project
   * picker's *Connection* column shows the two side by side, where `afasConnection`
   * only answers whether there is any AFAS behind the project at all.
   *
   * **Only meaningful while `afasConnection` is not `"unavailable"`.** There is no
   * third value for a boolean, so an unreadable settings store leaves both `false` —
   * which is right in that nothing may be assumed set up, and wrong as a claim that
   * nothing *is*. Anything drawing these has to check `afasConnection` first.
   *
   * `true` means *ingesteld*, not *werkt*: whether AFAS accepts the credentials
   * takes a call to AFAS, and the session can't make two of those for every project
   * an admin carries. The connection test in `ProjectSettingsDialog` is what
   * answers that question, one stage at a time and on request.
   *
   * Carries no credential — only whether each half is filled in.
   */
  afasStages: AfasStageStates;
  /**
   * Whether the projectinstellingen mark this as a **test project** — one that
   * exists to try the tool out rather than to convert a client
   * (`lib/test-project.ts`). Read off the same settings row as `afasConnection`, and
   * refreshed with it. The project picker lists these under its *TEST* switch alone;
   * the managementrapport leaves them out (`isTestProject()`).
   *
   * Optional only because a session stored before it existed lacks it until the
   * next `/me`; read it as `false` then.
   */
  testProject?: boolean;
};

/** How far a project's AFAS connection got, or `"unavailable"` when the settings
 *  store could not be read — see `Project.afasConnection`. */
export type AfasConnectionState = "none" | "partial" | "complete" | "unavailable";

/** Which of a project's two AFAS environments have their credentials stored — see
 *  `Project.afasStages`. */
export type AfasStageStates = { test: boolean; live: boolean };

export type AuthUser = {
  email: string;
  name: string;
  /**
   * Nymbus staff vs. customer contact (`backend/oidc.py`'s `classify_user`) —
   * a display/routing fact only. It is not the authorization boundary: that
   * stays `Session.isAdmin`, checked again server-side on every admin route
   * regardless of `type`.
   */
  type: "employee" | "client";
};

export type Session = {
  user: AuthUser;
  /** Admins may switch between all projects; other users are bound to their own. */
  isAdmin: boolean;
  /**
   * A developer: an admin who may also manage the Nymbus logins. Display only —
   * the backend checks again on every route behind it (`require_developer`).
   * Absent on a non-admin session, and on one stored before the role existed.
   */
  isDeveloper?: boolean;
  /**
   * What this login may do. `"admin"` runs the tool; `"manager"` (a project manager
   * or team lead in the Nymbus logins, the hosted version) carries every project
   * lands on the managementrapport (`/voortgang`) and may open each one as a team
   * member would, but nothing admin-only; `"member"` is a project's own team member; `"visitor"`
   * is a Nymbus colleague who is signed in and nothing more yet — listed so in
   * the Nymbus logins, or anyone with a nymbus.nl address who signed in with an
   * e-mail code. Absent on a session stored before the field existed, which reads
   * as `isAdmin` says.
   */
  role?: "admin" | "manager" | "member" | "visitor";
  /** Projects this user may open — never empty, except for a visitor's. */
  projects: Project[];
  /**
   * The admin behind this session while they view the app as `user` (see
   * `impersonate`). Absent on a normal session.
   */
  impersonatedBy?: AuthUser;
};

/** One project on an `ImpersonatableUser`'s list — just enough to show it in the
 *  picker: its number, its name, and its AFAS status. */
/**
 * The local session, fresh from the backend: the one local user and every project
 * in the store.
 */
export async function fetchMe(): Promise<Session> {
  return requestJson<Session>(
    "/api/auth/me",
    undefined,
    tr("De sessie kon niet worden opgehaald.", "The session could not be fetched.")
  );
}

/** The same as {@link fetchMe} — kept as the name the refresh buttons call. */
export const reloadMe = fetchMe;
