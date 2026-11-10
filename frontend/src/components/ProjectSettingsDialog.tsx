"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  PlugZap,
  Plus,
  Puzzle,
  Save,
  Trash2,
} from "lucide-react";
import Checkbox from "@/components/Checkbox";
import Modal, { ModalButton, ModalCloseButton } from "@/components/Modal";
import {
  ConnectionMark,
  Field,
  inputClass,
  Notice,
  SecretField,
  secretToSend,
  UNTESTED,
  UNTOUCHED,
  type ConnectionState,
  type SecretDraft,
} from "@/components/settings/SettingsFields";
import { useModule } from "@/components/ModuleProvider";
import ConnectorCheckTab from "@/components/settings/ConnectorCheckTab";
import ProjectModulesTab from "@/components/settings/ProjectModulesTab";
import { ApiError } from "@/lib/api";
import {
  fetchConversionSettings,
  saveConversionSettings,
  PERIODETABELLEN,
  type ConversionSettings,
} from "@/lib/conversion-settings";
import {
  fetchProjectSettings,
  saveProjectSettings,
  testProjectConnection,
  type ProjectSettings,
  type SettingsStage,
} from "@/lib/project-settings";
import { fetchCodetabelEntries } from "@/lib/validation/codetabellen";
import { herhalenNa } from "@/lib/standard-columns";
import {
  DEFAULT_INTAKE,
  fetchIntake,
  INTAKE_STATUSES,
  intakeHasDate,
  saveIntake,
  type Intake,
  type IntakeStatus,
} from "@/lib/intake";
import { fetchTestProject, saveTestProject } from "@/lib/test-project";
import { fetchDisplayName, saveDisplayName, type DisplayName } from "@/lib/display-name";
import { addCustomModule, deleteCustomModule } from "@/lib/custom-modules";
import { payloadPlanFor } from "@/lib/module-payloads";
import { reloadMe } from "@/lib/auth";
import { setSession, withSessionReload } from "@/lib/session-store";
import { tr, useT } from "@/lib/i18n";
import type { ModuleGroup } from "@/lib/modules";

/**
 * The configuration of one project, in **six tabs** —
 *
 *   *Conversie*      the settings of the conversion itself — its periodetabel and
 *                    livegangdatum, where the intake stands, and whether it is a
 *                    test project;
 *   *Modules*        which modules the project carries, the kind of conversion, and
 *                    removing the project (`settings/ProjectModulesTab`);
 *   *AFAS-omgeving*  its environment number and the OAuth client credentials of its
 *                    test and live environment;
 *   *Connectoren*    whether the client's environment offers every GetConnector the
 *                    tool reads (`settings/ConnectorCheckTab`) — checked, not installed;
 *   *Maatwerk*       (id `koppelingen`) which of the project's modules are mapped
 *                    differently from every other project's;
 *   *Vrije Velden*   (id `maatwerk`) custom modules — an extra step after a standard
 *                    module for the fields only this client has (see
 *                    `lib/custom-modules.ts`); saved per action, like *Conversie*,
 *                    since it is a store of its own.
 *
 * **Each tab saves what it shows.** The *AFAS-omgeving* and *Maatwerk* tabs are one
 * stored object (the environment number in `projects.json`, the credentials in the
 * gitignored `client_tokens.json`) and share the footer's *Opslaan*. *Conversie*,
 * *Modules* and *Vrije Velden* each save on their own button or action, and the
 * footer's *Opslaan* is hidden while they are open.
 *
 * A project's *Dossierconversie* setup (source/target AFAS environment, the
 * employee/dossier-type mapping) lives in `DossierMigrationPage` instead; whether a
 * project gets that page is its kind of conversion, set on the *Modules* tab.
 *
 * Opened from [`ProjectSettings`](./ProjectSettings.tsx) in the sidebar and mounted
 * only while open, so the settings are fetched fresh every time.
 *
 * A stored secret is never sent to the browser (see `lib/project-settings.ts`), so
 * its field starts empty and stays empty unless the admin replaces the secret: the
 * hint underneath says whether one is stored, and **Wissen** is the only way to
 * remove it.
 *
 * Each environment can be **tried** before it is saved: *Verbinding testen* asks AFAS
 * for its `metainfo` with the credentials as the form has them, so a wrong client id
 * shows here rather than at the first upload.
 */

/** The four parts of the dialog. Exported because `initialTab` is a caller's
 *  choice — see the prop. */
export type Tab = "afas" | "koppelingen" | "maatwerk" | "conversie" | "modules" | "connectoren";

const TABS: { id: Tab; label: string; labelEn: string }[] = [
  { id: "conversie", label: "Conversie", labelEn: "Conversion" },
  { id: "modules", label: "Modules", labelEn: "Modules" },
  { id: "afas", label: "AFAS-omgeving", labelEn: "AFAS environment" },
  { id: "connectoren", label: "Connectoren", labelEn: "Connectors" },
  { id: "koppelingen", label: "Maatwerk", labelEn: "Custom mappings" },
  { id: "maatwerk", label: "Vrije Velden", labelEn: "Custom fields" },
];

/**
 * What the *Conversie* tab hands the dialog so its footer can draw the save button:
 * whether there is anything to save, whether a save is running, and the save itself.
 * The tab writes to AFAS rather than to our store, so the dialog can't share its
 * submit — but the *button* belongs in the footer with every other save, and this is
 * what lets it live there.
 */
type ConversionTabState = {
  canSave: boolean;
  saving: boolean;
  /** *Opslaan in AFAS* when AFAS is all it writes to, *Opslaan* otherwise. */
  label: string;
  save: () => Promise<void>;
};

export default function ProjectSettingsDialog({
  projectId,
  projectName,
  initialTab = "conversie",
  onClose,
  onProjectDeleted,
}: {
  projectId: string;
  projectName: string;
  /**
   * Which tab the dialog opens on. *Conversie*, the first tab, unless a caller has
   * a reason — a notice about a missing AFAS connection opens on *AFAS-omgeving*,
   * so the form it names is the one in front of the reader instead of a click away.
   * It is only the **initial** tab: the dialog is mounted fresh per open, and
   * switching tabs afterwards is the reader's business, not the caller's.
   */
  initialTab?: Tab;
  onClose: () => void;
  /** The project was removed on the *Modules* tab — the caller leaves its page. */
  onProjectDeleted?: () => void;
}) {
  // The project's modules, already fetched for the sidebar and resolved against the
  // catalog — the same list, from the same deeltaken in Nymbus's live environment.
  // This dialog is always the **active** project's, which is the one the provider holds.
  const { groups, status: modulesState } = useModule();
  const t = useT();

  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [omgeving, setOmgeving] = useState("");
  // Required, and the gate for everything below it on the tab: a client id belongs
  // to an environment, so there is nothing to fill in — or test — until it is named.
  const omgevingValid = /^\d+$/.test(omgeving.trim());
  const [testClientId, setTestClientId] = useState("");
  const [liveClientId, setLiveClientId] = useState("");
  const [testSecret, setTestSecret] = useState<SecretDraft>(UNTOUCHED);
  const [liveSecret, setLiveSecret] = useState<SecretDraft>(UNTOUCHED);
  const [customModules, setCustomModules] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Record<SettingsStage, ConnectionState>>({
    test: UNTESTED,
    live: UNTESTED,
  });
  // The *Conversie* tab's save, published by the tab itself — see `ConversionTabState`.
  // `useCallback` so the tab's effect doesn't re-publish on every parent render.
  const [conversion, setConversion] = useState<ConversionTabState | null>(null);
  const onConversionState = useCallback((state: ConversionTabState) => {
    setConversion(state);
  }, []);

  // Load once per open — the stores are files that anyone may have edited.
  useEffect(() => {
    let current = true;
    fetchProjectSettings(projectId)
      .then((loaded) => {
        if (!current) return;
        setSettings(loaded);
        setOmgeving(loaded.omgeving === null ? "" : String(loaded.omgeving));
        setTestClientId(loaded.testClientId);
        setLiveClientId(loaded.liveClientId);
        setCustomModules(loaded.customMappingModules);
      })
      .catch((err) => {
        if (current) {
          setLoadError(
            err instanceof ApiError
              ? err.message
              : tr("De projectinstellingen konden niet worden geladen.", "The project settings could not be loaded.")
          );
        }
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  /** Any edit clears a stale save error — it was about the values as they were. */
  function clearSaveError() {
    setSaveError(null);
  }

  /**
   * A credential edit does that **and** drops the connection results of whatever it
   * changed, since those were about the values as they were. `stage` names the
   * environment the edit belongs to; the omgevingsnummer belongs to both, so it
   * clears both.
   */
  function edited(stage?: SettingsStage) {
    clearSaveError();
    setConnections((current) =>
      stage ? { ...current, [stage]: UNTESTED } : { test: UNTESTED, live: UNTESTED }
    );
  }

  /**
   * Mark a module as mapped differently, or put it back on the standard mapping. No
   * connection result is touched: this says nothing about credentials.
   */
  function toggleCustomModule(moduleId: string) {
    setCustomModules((current) =>
      current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [...current, moduleId]
    );
    clearSaveError();
  }

  /** Try one environment with the credentials the form has right now. */
  async function runTest(stage: SettingsStage) {
    if (connections[stage].testing) return;
    setConnections((current) => ({ ...current, [stage]: { testing: true, result: null } }));
    const clientId = stage === "test" ? testClientId : liveClientId;
    const secret = stage === "test" ? testSecret : liveSecret;
    try {
      const result = await testProjectConnection(projectId, stage, {
        omgeving: omgeving.trim(),
        clientId,
        clientSecret: secretToSend(secret),
      });
      setConnections((current) => ({ ...current, [stage]: { testing: false, result } }));
    } catch (err) {
      setConnections((current) => ({
        ...current,
        [stage]: {
          testing: false,
          result: {
            ok: false,
            message:
              err instanceof ApiError
                ? err.message
                : tr("De verbinding met AFAS kon niet worden getest.", "The connection to AFAS could not be tested."),
          },
        },
      }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter in a field submits the form that contains it, and *Conversie*'s fields
    // sit in this one — but this handler saves the **credentials**, and the button
    // on screen there says *Opslaan in AFAS*. Without this guard, Enter in the
    // livegang date would write the other tab's data and close the dialog, which is
    // neither what it says nor what was typed. That tab saves through its own
    // handle instead.
    // *Maatwerk* saves each add and remove on its own, for the same reason.
    if (tab === "conversie" || tab === "maatwerk" || tab === "modules" || tab === "connectoren") return;
    if (saving || !settings) return;
    // *Vrije Velden* submits the same object, so it can reach here without the
    // number on screen — take the reader to the field that is missing.
    if (!omgevingValid) {
      setTab("afas");
      setSaveError(tr("Vul eerst het omgevingsnummer in.", "Fill in the environment number first."));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await saveProjectSettings(projectId, {
        omgeving: omgeving.trim(),
        testClientId,
        liveClientId,
        testClientSecret: secretToSend(testSecret),
        liveClientSecret: secretToSend(liveSecret),
        customMappingModules: customModules,
      });
      // The secrets are stored now, so the drafts have served their purpose; what
      // the fields show from here on is the backend's answer.
      setSettings(stored);
      setOmgeving(stored.omgeving === null ? "" : String(stored.omgeving));
      setTestClientId(stored.testClientId);
      setLiveClientId(stored.liveClientId);
      setCustomModules(stored.customMappingModules);
      setTestSecret(UNTOUCHED);
      setLiveSecret(UNTOUCHED);
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : tr("De projectinstellingen konden niet worden opgeslagen.", "The project settings could not be saved.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onDismiss={onClose} className="flex h-[90vh] max-w-7xl flex-col overflow-hidden">
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-k-divider px-6 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-k-text-primary">{t("Projectinstellingen", "Project settings")}</h2>
              <p className="mt-1 text-sm text-k-text-secondary">
                {projectName} <span className="text-k-text-tertiary">· project {projectId}</span>
              </p>
            </div>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* The tab rail (§10.11): the active tab is a cyan inset well. `type="button"`
              on each, or picking a tab would submit the form both tabs share. */}
          <nav aria-label={t("Instellingen", "Settings")} className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto py-3 pl-4">
            {TABS.map((option) => {
              const active = tab === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTab(option.id)}
                  aria-pressed={active}
                  className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-[12.5px] font-medium transition-[box-shadow,color] duration-200 ${
                    active ? "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm" : "text-k-text-secondary hover:text-k-text-primary"
                  }`}
                >
                  {t(option.label, option.labelEn)}
                  {option.id === "koppelingen" && customModules.length > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums shadow-inset-sm ${
                        active ? "bg-k-bg/60 text-k-cyan-fg" : "bg-k-cloud-light/40 text-k-cloud-deep"
                      }`}
                    >
                      {customModules.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="w-px shrink-0 bg-k-divider" />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
            {loadError ? (
              <Notice tone="error">{loadError}</Notice>
            ) : !settings ? (
              <p className="text-sm text-k-text-secondary">{t("Instellingen laden…", "Loading settings…")}</p>
            ) : tab === "conversie" ? (
              <ConversionTab projectId={projectId} onState={onConversionState} />
            ) : tab === "maatwerk" ? (
              <CustomModulesTab projectId={projectId} />
            ) : tab === "modules" ? (
              <ProjectModulesTab projectId={projectId} onDeleted={() => (onProjectDeleted ?? onClose)()} />
            ) : tab === "connectoren" ? (
              <ConnectorCheckTab projectId={projectId} />
            ) : tab === "koppelingen" ? (
              <CustomMappings
                groups={groups}
                modulesState={modulesState}
                selected={customModules}
                onToggle={toggleCustomModule}
              />
            ) : (
              <>
                {/* The omgevingsnummer needs no heading — it is the first thing in a
                    dialog whose title already says what this is. */}
                <Field
                  id="settings-omgeving"
                  label={t("Omgevingsnummer", "Environment number")}
                  required
                  hint={
                    omgevingValid
                      ? t("Het nummer in 12345.resttest.afas.online — alleen cijfers.", "The number in 12345.resttest.afas.online — digits only.")
                      : t("Verplicht — vul dit eerst in om de omgevingen hieronder in te stellen. Alleen cijfers, het nummer in 12345.resttest.afas.online.", "Required — fill this in first to set up the environments below. Digits only, the number in 12345.resttest.afas.online.")
                  }
                >
                  <input
                    id="settings-omgeving"
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={omgeving}
                    onChange={(e) => {
                      setOmgeving(e.target.value);
                      edited();
                    }}
                    placeholder="12345"
                    required
                    aria-required="true"
                    aria-invalid={omgeving.trim() !== "" && !omgevingValid}
                    className={`${inputClass} mt-1.5 w-40`}
                    aria-describedby="settings-omgeving-hint"
                  />
                </Field>

                <Section
                  title={t("Testomgeving", "Test environment")}
                  stage="test"
                  connection={connections.test}
                  onTest={() => runTest("test")}
                  disabled={!omgevingValid}
                >
                  <Field id="settings-test-id" label={t("Client id", "Client ID")}>
                    <input
                      id="settings-test-id"
                      type="text"
                      autoComplete="off"
                      value={testClientId}
                      onChange={(e) => {
                        setTestClientId(e.target.value);
                        edited("test");
                      }}
                      className={`${inputClass} mt-1.5 w-full`}
                    />
                  </Field>
                  <SecretField
                    id="settings-test-secret"
                    stored={settings.testClientSecretSet}
                    draft={testSecret}
                    onChange={(next) => {
                      setTestSecret(next);
                      edited("test");
                    }}
                  />
                </Section>

                <Section
                  title={t("Live-omgeving", "Live environment")}
                  stage="live"
                  connection={connections.live}
                  onTest={() => runTest("live")}
                  disabled={!omgevingValid}
                >
                  <Field id="settings-live-id" label={t("Client id", "Client ID")}>
                    <input
                      id="settings-live-id"
                      type="text"
                      autoComplete="off"
                      value={liveClientId}
                      onChange={(e) => {
                        setLiveClientId(e.target.value);
                        edited("live");
                      }}
                      className={`${inputClass} mt-1.5 w-full`}
                    />
                  </Field>
                  <SecretField
                    id="settings-live-secret"
                    stored={settings.liveClientSecretSet}
                    draft={liveSecret}
                    onChange={(next) => {
                      setLiveSecret(next);
                      edited("live");
                    }}
                  />
                </Section>

                <p className="mt-5 text-xs text-k-text-tertiary">
                  {t(
                    "Deze gegevens gelden alleen voor dit project en staan lokaal in backend/json_files/client_tokens.json (niet in git); een opgeslagen secret komt nooit terug naar de browser.",
                    "These details apply to this project only and are kept locally in backend/json_files/client_tokens.json (not in git); a saved secret never goes back to the browser.",
                  )}
                </p>
              </>
            )}

            {saveError && (
              <div className="mt-4">
                <Notice tone="error">{saveError}</Notice>
              </div>
            )}
          </div>
        </div>

        {/* Saving only — closing is the X in the corner. Both buttons are the same
            *Opslaan*, bottom right; they differ only in where the write lands, which
            is the tab's business and not something the footer should look like it is
            choosing between. `type` is what separates them: the first two tabs are
            one form and submit it, *Conversie* writes to AFAS on its own. */}
        <div className="flex shrink-0 justify-end border-t border-k-divider px-6 py-4">
          {tab === "modules" || tab === "connectoren" ? (
            <p className="py-2 text-xs text-k-text-tertiary">
              {tab === "modules"
                ? t("De modules worden opgeslagen met de knop hierboven.", "The modules are saved with the button above.")
                : t("Alleen controleren — er wordt niets opgeslagen.", "Checking only — nothing is saved.")}
            </p>
          ) : tab === "maatwerk" ? (
            <p className="py-2 text-xs text-k-text-tertiary">
              {t("Toevoegen en verwijderen worden direct opgeslagen.", "Adding and removing are saved straight away.")}
            </p>
          ) : tab === "conversie" ? (
            <ModalButton
              tone="primary"
              onClick={() => void conversion?.save()}
              disabled={!conversion?.canSave || conversion.saving}
            >
              {conversion?.saving ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Save className="h-4 w-4" strokeWidth={1.8} />
              )}
              {conversion ? `${conversion.label}${conversion.saving ? "…" : ""}` : t("Opslaan", "Save")}
            </ModalButton>
          ) : (
            <ModalButton
              tone="primary"
              type="submit"
              disabled={saving || !settings || (tab === "afas" && !omgevingValid)}
            >
              {saving ? t("Opslaan…", "Saving…") : t("Opslaan", "Save")}
            </ModalButton>
          )}
        </div>
      </form>
    </Modal>
  );
}

/** One entry of the *Periodetabel HRM* dropdown. */
type PeriodetabelOption = { value: string; label: string };

/**
 * The periodetabellen this project's AFAS actually has, for the dropdown.
 *
 * Read from the `Periodetabellen` codetabel (`ALG_Periodetabellen` in the project's
 * own live environment), because which tabellen exist is **inrichting per
 * werkgever**: 501342 carries `5` Maand HRM, `6` 4 weken HRM and `18` Jaar Verlof
 * HRM, while the pair hardcoded in `conversion-settings.ts` knows only the first
 * two. Offering a list written down here would be the betaalvoorwaarden mistake in
 * a dropdown — right for the customer it was copied from and wrong for the next.
 *
 * **Falls back to `PERIODETABELLEN` when no environment answers** (the connector
 * isn't imported into this project yet, the credentials aren't filled in), rather
 * than to an empty select. That is where this differs from a `codetabel` *check*,
 * which skips rather than guesses: a check with no table simply doesn't judge, but a
 * dropdown with no options can't be used at all, and the two fallback values are the
 * ones the tool can derive *Herhalen na* from — so the degraded list is still a
 * working form. `loaded` says which of the two the user is looking at, so the field
 * can say so.
 */
function usePeriodetabellen(projectId: string): {
  options: PeriodetabelOption[];
  /** True once AFAS's own table is what `options` holds. */
  loaded: boolean;
} {
  const [options, setOptions] = useState<PeriodetabelOption[]>([
    ...PERIODETABELLEN,
  ]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let current = true;
    // Never rejects — an unservable table is a normal early state of a conversion,
    // so this resolves either way and the fallback simply stays.
    // Fetched outside the codetabel store: this dialog can be open for any project,
    // and the store holds one table per name — the open module's project's.
    void fetchCodetabelEntries(projectId, PERIODETABEL_KEY).then((entries) => {
      if (!current || !entries) return;
      setOptions(
        entries.map((entry) => ({
          value: String(entry.code),
          // `5 — Maand HRM`: the code is what AFAS stores and what the tool
          // derives from, so it leads, with the table's own description behind it.
          label: entry.omschrijving
            ? `${entry.code} — ${entry.omschrijving}`
            : String(entry.code),
        }))
      );
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  return { options, loaded };
}

/** The registered codetabel behind the dropdown — see `codetabellen/sources.ts`. */
const PERIODETABEL_KEY = "Periodetabellen";

/**
 * *Conversie* — the settings of the conversion itself, as AFAS holds them.
 *
 * **Its own fetch and its own save**, unlike the other two tabs. These values are not
 * in our store: they live on the project's hoofdproces dossieritem in AFAS, which is
 * also where the consultant setting the conversion up maintains them, and the tool
 * reads them from there on every session. Saving is therefore an AFAS write, and a
 * shared *Opslaan* that wrote to two systems at once could only half succeed.
 *
 * **Why they are worth editing here at all.** Together they decide five columns of a
 * facilitaire conversie's Medewerkers sheet ([`standard-columns.ts`](../lib/standard-columns.ts)):
 * the periodetabel fills *Periodetabel HRM* and derives *Herhalen na*, the
 * livegangdatum derives *Jaar volgende periodiek*. A conversion that starts before
 * AFAS has them filled in leaves those columns empty — and nothing in the tool could
 * say so, let alone fix it, until this tab existed.
 *
 * The consequence is shown rather than left to be known: each field says underneath
 * what the tool will do with the value, recomputed as it is typed, so an admin sees
 * *Herhalen na* become 13 before they save rather than discovering it in a payload.
 *
 * Below them, under a rule, the **Projectnaam**, the **intake** and the
 * **Testproject** box — stored in our own database instead (`lib/display-name.ts`,
 * `lib/intake.ts`, `lib/test-project.ts`), so loaded and saved apart from the AFAS
 * pair: the one footer button writes whichever part changed, and each says under its
 * own fields whether it landed.
 */
function ConversionTab({
  projectId,
  onState,
}: {
  projectId: string;
  /**
   * Publishes this tab's save to the dialog, whose footer draws the button — so
   * *Opslaan* sits bottom right here exactly as it does on the other two tabs,
   * even though this one writes somewhere else entirely.
   */
  onState: (state: ConversionTabState) => void;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<ConversionSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [periodetabel, setPeriodetabel] = useState("");
  // The dropdown's own list, out of this project's AFAS — see `usePeriodetabellen`.
  // Its own fetch, deliberately not folded into the settings fetch below: the two
  // read different things (a dossieritem, a codetabel) and a table that can't be
  // served must not stop the form from loading.
  const periodetabellen = usePeriodetabellen(projectId);
  const [livegang, setLivegang] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The intake: ours, not AFAS's (`lib/intake.ts`), so its own fetch and its own
  // write — loaded and saved independently of the pair above, and shown even for a
  // project AFAS has no dossieritem for, since nothing about it needs one.
  const [intakeLoaded, setIntakeLoaded] = useState<Intake | null>(null);
  const [intakeLoadError, setIntakeLoadError] = useState<string | null>(null);
  const [intakeStatus, setIntakeStatus] = useState<IntakeStatus>(
    DEFAULT_INTAKE.status,
  );
  const [intakeDatum, setIntakeDatum] = useState("");
  const [intakeSaveError, setIntakeSaveError] = useState<string | null>(null);
  const [intakeSaved, setIntakeSaved] = useState(false);

  // The name the tool shows instead of AFAS's: ours too (`lib/display-name.ts`), a
  // part of its own like the two below. `Project.name` carries it once the dialog
  // closes and `fetchMe()` re-reads the settings rows.
  const [nameLoaded, setNameLoaded] = useState<DisplayName | null>(null);
  const [nameLoadError, setNameLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [nameSaveError, setNameSaveError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // Whether this is a test project: ours too (`lib/test-project.ts`), and a part of
  // its own for the same reason the intake is. The picker shows these under *TEST*
  // alone; the session picks the new value up when the dialog closes (`fetchMe()`
  // re-reads the settings rows).
  const [testLoaded, setTestLoaded] = useState<boolean | null>(null);
  const [testLoadError, setTestLoadError] = useState<string | null>(null);
  const [testProject, setTestProject] = useState(false);
  const [testSaveError, setTestSaveError] = useState<string | null>(null);
  const [testSaved, setTestSaved] = useState(false);

  useEffect(() => {
    let current = true;
    fetchConversionSettings(projectId)
      .then((settings) => {
        if (!current) return;
        setLoaded(settings);
        setPeriodetabel(settings.hrmPeriodetabel);
        setLivegang(settings.livegangDatum);
      })
      .catch((err) => {
        if (current) {
          setLoadError(
            err instanceof ApiError
              ? err.message
              : tr("De conversie-instellingen konden niet worden geladen.", "The conversion settings could not be loaded."),
          );
        }
      });
    fetchIntake(projectId)
      .then((intake) => {
        if (!current) return;
        setIntakeLoaded(intake);
        setIntakeStatus(intake.status);
        setIntakeDatum(intake.datum);
      })
      .catch((err) => {
        if (current) {
          setIntakeLoadError(
            err instanceof ApiError
              ? err.message
              : tr("De intake kon niet worden geladen.", "The intake could not be loaded."),
          );
        }
      });
    fetchDisplayName(projectId)
      .then((stored) => {
        if (!current) return;
        setNameLoaded(stored);
        setDisplayName(stored.displayName);
      })
      .catch((err) => {
        if (current) {
          setNameLoadError(
            err instanceof ApiError
              ? err.message
              : tr("De projectnaam kon niet worden geladen.", "The project name could not be loaded."),
          );
        }
      });
    fetchTestProject(projectId)
      .then((flag) => {
        if (!current) return;
        setTestLoaded(flag);
        setTestProject(flag);
      })
      .catch((err) => {
        if (current) {
          setTestLoadError(
            err instanceof ApiError
              ? err.message
              : tr("Kon niet worden geladen of dit een testproject is.", "Could not load whether this is a test project."),
          );
        }
      });
    return () => {
      current = false;
    };
  }, [projectId]);

  /** Any edit clears both the stale error and the stale confirmation. */
  function edited() {
    setSaveError(null);
    setSaved(false);
  }

  function intakeEdited() {
    setIntakeSaveError(null);
    setIntakeSaved(false);
  }

  function nameEdited() {
    setNameSaveError(null);
    setNameSaved(false);
  }

  function testEdited() {
    setTestSaveError(null);
    setTestSaved(false);
  }

  // What each part would save. The date only counts while the status carries one:
  // the field is hidden otherwise and the backend drops it, so a day still typed in
  // behind a hidden field must not make the form look unsaved.
  const afasDirty =
    loaded !== null &&
    loaded.dossierItemId !== "" &&
    (periodetabel !== loaded.hrmPeriodetabel ||
      livegang !== loaded.livegangDatum);
  const intakeDatumToSave = intakeHasDate(intakeStatus) ? intakeDatum : "";
  const intakeDirty =
    intakeLoaded !== null &&
    (intakeStatus !== intakeLoaded.status ||
      intakeDatumToSave !== intakeLoaded.datum);
  const testDirty = testLoaded !== null && testProject !== testLoaded;
  // Compared the way the backend stores it (spaces collapsed), so a trailing space
  // doesn't make the form look unsaved.
  const nameDirty =
    nameLoaded !== null &&
    displayName.trim().replace(/\s+/g, " ") !== nameLoaded.displayName;

  async function saveAfas() {
    try {
      const stored = await saveConversionSettings(projectId, {
        hrmPeriodetabel: periodetabel,
        livegangDatum: livegang,
      });
      // What AFAS actually stored, not what was sent.
      setLoaded(stored);
      setPeriodetabel(stored.hrmPeriodetabel);
      setLivegang(stored.livegangDatum);
      setSaved(true);
      // The session carries its own copy of both settings (`selectedProject`), and
      // that copy is what the payload panel builds with — the begin dates of phase 2
      // and of the fiscus, the periodetabel fills. Only a **deep** reload re-reads
      // the dossieritem: the `fetchMe()` the openers run on close replays the stored
      // session, so without this the panel keeps the values from login time over a
      // form showing the new ones. Fire-and-forget: the save itself has landed, and a
      // failed refresh is no reason to report it as failed.
      void withSessionReload(reloadMe)
        .then(setSession)
        .catch(() => {});
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? err.message
          : tr("De conversie-instellingen konden niet worden opgeslagen.", "The conversion settings could not be saved."),
      );
    }
  }

  async function saveIntakePart() {
    try {
      const stored = await saveIntake(projectId, {
        status: intakeStatus,
        datum: intakeDatumToSave,
      });
      setIntakeLoaded(stored);
      setIntakeStatus(stored.status);
      setIntakeDatum(stored.datum);
      setIntakeSaved(true);
    } catch (err) {
      setIntakeSaveError(
        err instanceof ApiError
          ? err.message
          : tr("De intake kon niet worden opgeslagen.", "The intake could not be saved."),
      );
    }
  }

  async function saveNamePart() {
    try {
      const stored = await saveDisplayName(projectId, displayName);
      setNameLoaded(stored);
      setDisplayName(stored.displayName);
      setNameSaved(true);
    } catch (err) {
      setNameSaveError(
        err instanceof ApiError
          ? err.message
          : tr("De projectnaam kon niet worden opgeslagen.", "The project name could not be saved."),
      );
    }
  }

  async function saveTestPart() {
    try {
      const stored = await saveTestProject(projectId, testProject);
      setTestLoaded(stored);
      setTestProject(stored);
      setTestSaved(true);
    } catch (err) {
      setTestSaveError(
        err instanceof ApiError
          ? err.message
          : tr("Kon niet worden opgeslagen of dit een testproject is.", "Could not save whether this is a test project."),
      );
    }
  }

  /**
   * One button, two stores — each part saved only when it changed, and each
   * reporting its own outcome under its own fields. They can't half-succeed as one
   * write, because they are not one: a failed AFAS save leaves a saved intake saved,
   * and says which part didn't land.
   */
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await Promise.all([
        afasDirty ? saveAfas() : null,
        intakeDirty ? saveIntakePart() : null,
        testDirty ? saveTestPart() : null,
        nameDirty ? saveNamePart() : null,
      ]);
    } finally {
      setSaving(false);
    }
  }

  // What the footer's button should do and show. Reported from an effect rather
  // than during render: React may re-render this tab without committing, and a
  // parent's state must only be set from a render that actually landed. The label
  // names AFAS only when AFAS is all it will write to.
  const canSave = afasDirty || intakeDirty || testDirty || nameDirty;
  const label =
    afasDirty && !intakeDirty && !testDirty && !nameDirty ? t("Opslaan", "Save") : t("Opslaan", "Save");
  // `save` closes over the current draft, so it is rebuilt every render. The footer
  // gets a stable wrapper that calls whichever one is **latest**, through this ref:
  // publishing `save` itself only when `canSave` flipped handed the footer the
  // closure from that moment — pick *Intake afgerond*, then a date, and the save
  // sent the status with the date still empty. Kept current from an effect, since
  // a ref must not be written during render.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const saveLatest = useCallback(() => saveRef.current(), []);
  useEffect(() => {
    onState({ canSave, saving, label, save: saveLatest });
  }, [canSave, saving, label, saveLatest, onState]);

  // A value AFAS already holds that the dropdown's list doesn't offer. Shown as an
  // option of its own rather than silently reset to "geen": the select would
  // otherwise look like it was clearing a setting nobody touched. Measured against
  // the list actually on screen, so a value that *is* in the customer's own table
  // stops being "onbekend" the moment that table arrives.
  const unknown =
    periodetabel !== "" &&
    !periodetabellen.options.some((option) => option.value === periodetabel);

  return (
    <div className="space-y-5">
      {loadError ? (
        <Notice tone="error">{loadError}</Notice>
      ) : !loaded ? (
        <p className="text-sm text-k-text-secondary">{t("Instellingen laden…", "Loading settings…")}</p>
      ) : !loaded.dossierItemId ? (
        // No hoofdproces dossieritem means there is nowhere in AFAS to write these, so
        // the tab says that instead of offering a form whose save could only fail. The
        // same gap `hasDossier` reports in the project picker, from the other end.
        <Notice tone="error">
          {t(
            "Dit project heeft nog geen hoofdproces-dossieritem in AFAS. De periodetabel en de datum livegang worden daarop bewaard, dus die zijn hier nog niet in te stellen.",
            "This project does not have a main-process dossier item in AFAS yet. The period table and the go-live date are stored there, so they cannot be set here yet.",
          )}
        </Notice>
      ) : (
        <>
          <p className="text-sm text-k-text-secondary">
            {t(
              "Instellingen van de conversie zelf. Deze staan in ",
              "Settings of the conversion itself. These are held in ",
            )}
            <span className="font-medium text-k-text-primary">AFAS</span>
            {t(
              ", op het hoofdproces-dossieritem van dit project — niet in Nymbus Conversies — en worden hier rechtstreeks aangepast.",
              ", on the main-process dossier item of this project — not in the conversion tool — and changed here directly.",
            )}
          </p>

          {/* Side by side, each as wide as its value needs: a two-digit table and a
              date don't want the dialog's full width. They wrap onto two lines on a
              narrow screen. Each field is fixed-width, so its hint wraps under it. */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-5 rounded-xl bg-k-bg p-4 shadow-raised-sm">
            <div className="w-64">
              <Field
                id="conversie-periodetabel"
                label="Periodetabel HRM"
                hint={periodetabelHint(periodetabel)}
              >
                <select
                  id="conversie-periodetabel"
                  value={periodetabel}
                  onChange={(e) => {
                    setPeriodetabel(e.target.value);
                    edited();
                  }}
                  className={`${inputClass} mt-1.5 w-full cursor-pointer`}
                  aria-describedby="conversie-periodetabel-hint"
                >
                  <option value="">{t("Niet ingesteld", "Not set")}</option>
                  {periodetabellen.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {unknown && (
                    <option value={periodetabel}>
                      {t(`${periodetabel} — onbekende tabel`, `${periodetabel} — unknown table`)}
                    </option>
                  )}
                </select>
              </Field>
            </div>

            <div className="w-64">
              <Field
                id="conversie-livegang"
                label={t("Datum livegang", "Go-live date")}
                hint={livegangHint(livegang)}
              >
                <input
                  id="conversie-livegang"
                  type="date"
                  value={livegang}
                  onChange={(e) => {
                    setLivegang(e.target.value);
                    edited();
                  }}
                  className={`${inputClass} mt-1.5 w-48`}
                  aria-describedby="conversie-livegang-hint"
                />
              </Field>
            </div>
          </div>

          {/* The button itself is the dialog's one footer button, bottom right like
              every other save — this tab only reports where the save stands. */}
          {!afasDirty && saved && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-k-green-fg">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              {t("Opgeslagen", "Saved")}
            </p>
          )}

          {saveError && <Notice tone="error">{saveError}</Notice>}
        </>
      )}

      {/* The parts that are ours, under a rule of their own: they are stored
          somewhere else than the pair above, and the intro there says "in AFAS". */}
      <div className="space-y-5 border-t border-k-divider pt-5">
        {nameLoadError ? (
          <Notice tone="error">{nameLoadError}</Notice>
        ) : !nameLoaded ? (
          <p className="text-sm text-k-text-secondary">{t("Projectnaam laden…", "Loading project name…")}</p>
        ) : (
          <>
            {/* As wide as the two fields of a row below together (2 × w-64 + gap-x-6). */}
            <div className="w-full max-w-[34rem] rounded-xl bg-k-bg p-4 shadow-raised-sm">
              <Field
                id="conversie-projectnaam"
                label={t("Projectnaam", "Project name")}
                hint={t("Getoond in de projectknop, de projectkiezer en het managementrapport. Leeg laten om de naam uit AFAS te tonen.", "Shown on the project button, in the project picker and in the management report. Leave empty to show the name from AFAS.")}
              >
                <input
                  id="conversie-projectnaam"
                  type="text"
                  value={displayName}
                  maxLength={256}
                  placeholder={nameLoaded.afasName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    nameEdited();
                  }}
                  className={`${inputClass} mt-1.5 w-full`}
                  aria-describedby="conversie-projectnaam-hint"
                />
              </Field>
            </div>

            {!nameDirty && nameSaved && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-k-green-fg">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {t("Projectnaam opgeslagen", "Project name saved")}
              </p>
            )}

            {nameSaveError && <Notice tone="error">{nameSaveError}</Notice>}
          </>
        )}

        {intakeLoadError ? (
          <Notice tone="error">{intakeLoadError}</Notice>
        ) : !intakeLoaded ? (
          <p className="text-sm text-k-text-secondary">{t("Intake laden…", "Loading intake…")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-5 rounded-xl bg-k-bg p-4 shadow-raised-sm">
              <div className="w-64">
                <Field
                  id="conversie-intake"
                  label={t("Intake", "Intake")}
                  hint={t("Bewaard in Nymbus Conversies en zichtbaar in het managementrapport.", "Kept in the conversion tool and shown in the management report.")}
                >
                  <select
                    id="conversie-intake"
                    value={intakeStatus}
                    onChange={(e) => {
                      setIntakeStatus(e.target.value as IntakeStatus);
                      intakeEdited();
                    }}
                    className={`${inputClass} mt-1.5 w-full cursor-pointer`}
                    aria-describedby="conversie-intake-hint"
                  >
                    {INTAKE_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Always there, so the row doesn't jump; greyed out and empty for a
                  status without a day. What was typed survives in the draft, so
                  flipping the status back brings it back. */}
              <div
                className={`w-64 transition-opacity ${
                  intakeHasDate(intakeStatus) ? "" : "opacity-50"
                }`}
              >
                <Field id="conversie-intake-datum" label={t("Datum intake", "Intake date")}>
                  <input
                    id="conversie-intake-datum"
                    type="date"
                    value={intakeDatumToSave}
                    disabled={!intakeHasDate(intakeStatus)}
                    onChange={(e) => {
                      setIntakeDatum(e.target.value);
                      intakeEdited();
                    }}
                    className={`${inputClass} mt-1.5 w-48`}
                  />
                </Field>
              </div>
            </div>

            {!intakeDirty && intakeSaved && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-k-green-fg">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {t("Intake opgeslagen", "Intake saved")}
              </p>
            )}

            {intakeSaveError && <Notice tone="error">{intakeSaveError}</Notice>}
          </>
        )}

        {testLoadError ? (
          <Notice tone="error">{testLoadError}</Notice>
        ) : testLoaded === null ? (
          <p className="text-sm text-k-text-secondary">{t("Laden…", "Loading…")}</p>
        ) : (
          <>
            <label
              htmlFor="conversie-testproject"
              className="flex w-fit cursor-pointer items-start gap-2.5 rounded-xl bg-k-bg p-4 shadow-raised-sm"
            >
              <Checkbox
                id="conversie-testproject"
                checked={testProject}
                onChange={(checked) => {
                  setTestProject(checked);
                  testEdited();
                }}
                className="mt-0.5"
                aria-describedby="conversie-testproject-hint"
              />
              <span>
                <span className="block text-sm font-medium text-k-text-primary">{t("Testproject", "Test project")}</span>
                <span id="conversie-testproject-hint" className="mt-1 block text-xs text-k-text-secondary">
                  {t(
                    "Alleen zichtbaar in de projectkiezer onder TEST, en niet in het managementrapport.",
                    "Only shown in the project picker under TEST, and not in the management report.",
                  )}
                </span>
              </span>
            </label>

            {!testDirty && testSaved && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-k-green-fg">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {t("Opgeslagen", "Saved")}
              </p>
            )}

            {testSaveError && <Notice tone="error">{testSaveError}</Notice>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the tool will do with this periodetabel, under the field.
 *
 * *Herhalen na* is derived from it and nothing else — **12 for 5, 13 for 6**
 * (`herhalenNa()` in `standard-columns.ts`) — so those two values say what they will
 * fill and anything else says what it will **not**: a periodetabel the tool has no
 * answer for leaves that column empty, which is worth knowing before saving rather
 * than after a payload comes out short.
 *
 * That third case is no longer hypothetical now the dropdown lists the customer's
 * own table: 501342 offers `18` (Jaar Verlof HRM), which is a perfectly real
 * periodetabel the tool has no *Herhalen na* for. It is offered and saved anyway —
 * the value belongs to AFAS, not to what this tool happens to derive from it — and
 * the hint is what keeps that honest.
 *
 * The numbers are read from `herhalenNa` itself rather than repeated here, so the
 * hint cannot drift from the value that actually lands in the payload.
 */
function periodetabelHint(value: string): string {
  if (!value) {
    return tr(
      "Bij een facilitaire conversie vult de tool hiermee 'Periodetabel HRM' en 'Herhalen na'; zonder waarde blijven die kolommen leeg.",
      "In a facilities conversion the tool fills 'Periodetabel HRM' and 'Herhalen na' with this; without a value those columns stay empty.",
    );
  }
  const herhalen = herhalenNa(Number(value));
  if (herhalen) return tr(`De tool vult 'Herhalen na' met ${herhalen}.`, `The tool fills 'Herhalen na' with ${herhalen}.`);
  return tr(
    "Voor deze periodetabel kent de tool geen 'Herhalen na'; die kolom blijft leeg.",
    "For this period table the tool has no 'Herhalen na'; that column stays empty.",
  );
}

/**
 * What the tool will do with this livegangdatum. *Jaar volgende periodiek* is the
 * year **after** it (`jaarVolgendePeriodiek()` in `standard-columns.ts`), so the hint
 * names the year that will actually be written rather than the rule that produces it.
 */
function livegangHint(value: string): string {
  const year = Number(value.slice(0, 4));
  if (!Number.isFinite(year) || !year) {
    return tr(
      "Bij een facilitaire conversie leidt de tool hier 'Jaar volgende periodiek' uit af; zonder datum blijft die kolom leeg.",
      "In a facilities conversion the tool derives 'Jaar volgende periodiek' from this; without a date that column stays empty.",
    );
  }
  return tr(`De tool vult 'Jaar volgende periodiek' met ${year + 1}.`, `The tool fills 'Jaar volgende periodiek' with ${year + 1}.`);
}

/**
 * *Afwijkende koppelingen* — the project's own modules, each with a checkbox saying
 * whether this client is mapped differently from every other one.
 *
 * **Why a module can be an exception at all.** A field mapping is made once, against
 * the schema of Nymbus's *test* environment: that environment is the template every
 * customer environment is a copy of, so one mapping per connector fills the records at
 * all of them. A customer whose data doesn't fit that mapping for one module is ticked
 * here — its schema is then read from *this* customer's own AFAS and the module keeps a
 * copy of the mapping of its own. Everything else about the conversion is unchanged.
 *
 * The list is the project's **modules**, not connector names: it is a statement about a
 * part of this conversion, and these are the same modules as in the sidebar — its
 * deeltaken in Nymbus's live environment, already fetched by `ModuleProvider` and
 * resolved against the catalog, so the dialog adds no call of its own.
 *
 * A flag for a module the project no longer has is listed apart rather than hidden:
 * something you cannot see is something you cannot switch off.
 */
function CustomMappings({
  groups,
  modulesState,
  selected,
  onToggle,
}: {
  groups: ModuleGroup[];
  modulesState: "loading" | "ready" | "error";
  selected: string[];
  onToggle: (moduleId: string) => void;
}) {
  const t = useT();
  const known = new Set(groups.flatMap((group) => group.items.map((item) => item.id)));
  const orphans = selected.filter((id) => !known.has(id));

  return (
    <div className="space-y-5">
      <p className="text-sm text-k-text-secondary">
        {t(
          "Elk project gebruikt dezelfde koppeling per connector — gemaakt op het schema van de sjabloonomgeving, waarvan elke klantomgeving een kopie is. Zet een module aan als ",
          "Every project uses the same mapping per connector — made against the schema of the template environment, of which every client environment is a copy. Switch a module on if ",
        )}
        <span className="font-medium text-k-text-primary">{t("deze klant", "this client")}</span>{" "}
        {t(
          "een afwijkende koppeling nodig heeft: het schema wordt dan uit de AFAS-omgeving van dit project gelezen en de module krijgt een eigen kopie van de koppeling.",
          "needs a mapping of its own: the schema is then read from the AFAS environment of this project, and the module gets a copy of the mapping of its own.",
        )}
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-k-text-secondary">
          {modulesState === "loading"
            ? t("Modules laden…", "Loading modules…")
            : modulesState === "error"
              ? t("De modules van dit project konden niet worden geladen.", "The modules of this project could not be loaded.")
              : t("Dit project heeft geen modules.", "This project has no modules.")}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="rounded-xl bg-k-bg p-4 shadow-raised-sm">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
              <span className="text-k-text-tertiary">{group.icon}</span>
              {group.label}
            </h3>
            <div className="mt-2 space-y-0.5">
              {group.items.map((item) => (
                <ModuleToggle
                  key={item.id}
                  id={`custom-${item.id}`}
                  label={item.label}
                  checked={selected.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {orphans.length > 0 && (
        <div className="rounded-xl bg-k-bg p-4 shadow-raised-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
            {t("Niet (meer) in dit project", "Not (or no longer) in this project")}
          </h3>
          <p className="mt-1 text-xs text-k-text-secondary">
            {t(
              "Deze modules staan als afwijkend aangemerkt, maar horen niet bij de deeltaken van dit project. Zet ze uit als dat niet klopt.",
              "These modules are marked as non-standard, but do not belong to the subtasks of this project. Switch them off if that is not right.",
            )}
          </p>
          <div className="mt-2 space-y-0.5">
            {orphans.map((id) => (
              <ModuleToggle
                key={id}
                id={`custom-${id}`}
                label={id}
                mono
                checked
                onChange={() => onToggle(id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * *Maatwerk* — the project's custom modules: an extra step after a standard module,
 * for the fields only this client has (AFAS vrije velden), written to the same
 * connector as a PUT on the records the module created. See
 * [`lib/custom-modules.ts`](../lib/custom-modules.ts).
 *
 * Only a name and the module it follows are asked for: the connector is the parent's,
 * fixed by the backend, and the mapping is made afterwards — from the step itself in
 * the parent's payload view (*Koppeling maken*), against this project's own AFAS.
 *
 * Only modules with a payload view are offered as a parent, because that view is
 * where the step lives; a module without one would get a step nobody can open.
 *
 * Saved per action rather than through the footer: this is a store of its own, and a
 * remove also deletes the mapping — not something to stage behind a later *Opslaan*.
 */
function CustomModulesTab({ projectId }: { projectId: string }) {
  const { groups, status, customModules, refreshCustomModules } = useModule();
  const t = useT();
  const parents = groups.flatMap((group) =>
    group.items.filter((item) => payloadPlanFor(item.id) !== null),
  );
  const [label, setLabel] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The module whose *Verwijderen* was pressed once — the second press removes it. */
  const [confirming, setConfirming] = useState<string | null>(null);

  // The first parent until someone picks one — derived, so it needs no effect to
  // follow the modules arriving.
  const parent = parentId || parents[0]?.id || "";

  async function add() {
    if (busy || !label.trim() || !parent) return;
    setBusy(true);
    setError(null);
    try {
      await addCustomModule(projectId, label.trim(), parent);
      setLabel("");
      await refreshCustomModules();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : tr("De maatwerkmodule kon niet worden toegevoegd.", "The custom module could not be added."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(moduleId: string) {
    if (busy) return;
    if (confirming !== moduleId) {
      setConfirming(moduleId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteCustomModule(projectId, moduleId);
      setConfirming(null);
      await refreshCustomModules();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : tr("De maatwerkmodule kon niet worden verwijderd.", "The custom module could not be removed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-k-text-secondary">
        {t("Velden die", "Fields that")}{" "}
        <span className="font-medium text-k-text-primary">{t("alleen deze klant", "only this client")}</span>{" "}
        {t(
          "heeft — zoals vrije velden op de medewerker — gaan als extra stap ná de standaardmodule naar AFAS: dezelfde connector, als update op de records die de module al heeft aangemaakt. De kolommen staan in het bestand van die module; er is geen apart bestand en geen validatie.",
          "has — like custom fields on the employee — go to AFAS as an extra step after the standard module: the same connector, as an update on the records the module has already created. The columns are in that module's file; there is no separate file and no validation.",
        )}
      </p>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field id="custom-module-label" label={t("Naam", "Name")}>
            <input
              id="custom-module-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                // Enter would submit the dialog's form, which saves the credentials.
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              placeholder={t("Vrije velden", "Custom fields")}
              className={`${inputClass} mt-1.5 w-full`}
            />
          </Field>
        </div>
        <div className="w-48 shrink-0">
          <Field id="custom-module-parent" label={t("Na module", "After module")}>
            <select
              id="custom-module-parent"
              value={parent}
              onChange={(e) => setParentId(e.target.value)}
              disabled={parents.length === 0}
              className={`${inputClass} mt-1.5 w-full cursor-pointer`}
            >
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ModalButton
          tone="primary"
          onClick={() => void add()}
          disabled={busy || !label.trim() || !parent}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          )}
          {t("Toevoegen", "Add")}
        </ModalButton>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {customModules.length === 0 ? (
        <p className="text-sm text-k-text-secondary">
          {status === "loading"
            ? t("Modules laden…", "Loading modules…")
            : t("Dit project heeft nog geen maatwerkmodules.", "This project has no custom modules yet.")}
        </p>
      ) : (
        <div className="space-y-2">
          {customModules.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-lg bg-k-bg px-3 py-2.5 shadow-raised-sm transition-shadow duration-200 hover:shadow-(--k-shadow-hover-card)"
            >
              <Puzzle
                className="h-4 w-4 shrink-0 text-k-text-tertiary"
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-k-text-primary">
                  {item.label}
                </span>
                <span className="block truncate text-xs text-k-text-secondary">
                  {t("na", "after")} {item.parentLabel} ·{" "}
                  <span className="font-mono">{item.connector}</span>
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-inset-sm ${
                  item.hasMapping
                    ? "bg-k-green-bg text-k-green-fg"
                    : "bg-k-bg text-k-text-secondary"
                }`}
              >
                {item.hasMapping ? t("Gekoppeld", "Mapped") : t("Geen koppeling", "No mapping")}
              </span>
              <button
                type="button"
                onClick={() => void remove(item.id)}
                onBlur={() =>
                  setConfirming((current) =>
                    current === item.id ? null : current,
                  )
                }
                disabled={busy}
                title={t("Verwijdert de maatwerkmodule én de koppeling", "Removes the custom module and its mapping")}
                className={`neu-button flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  confirming === item.id
                    ? "text-k-red-fg! hover:text-k-red-fg!"
                    : "text-k-text-secondary hover:text-k-red-fg!"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                {confirming === item.id ? t("Zeker weten?", "Sure?") : t("Verwijderen", "Delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One module row: the whole row is the label, so the hit area is the line. */
function ModuleToggle({
  id,
  label,
  checked,
  onChange,
  mono = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  mono?: boolean;
}) {
  const t = useT();
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-[box-shadow,background-color] duration-200 hover:shadow-inset-sm ${
        checked ? "bg-k-cloud-light/40 shadow-inset-sm" : ""
      }`}
    >
      <Checkbox id={id} checked={checked} onChange={onChange} />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          mono ? "font-mono text-xs text-k-text-secondary" : checked ? "font-medium text-k-text-primary" : "text-k-text-secondary"
        }`}
      >
        {label}
      </span>
      {checked && (
        <span className="shrink-0 rounded-full bg-k-cloud-light/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-k-cloud-deep shadow-inset-sm">
          {t("Afwijkend", "Non-standard")}
        </span>
      )}
    </label>
  );
}

/**
 * The two environment badges. Green for test, cyan for live — the Nymbus green and cyan
 * pairs. The colour is a second signal only: the badge says *Testomgeving* or
 * *Live-omgeving* in words, so nothing here rests on it.
 */
const BADGE_TONE = {
  test: "bg-k-green-bg text-k-green-fg shadow-inset-sm",
  live: "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm",
} as const;

/**
 * One environment: its heading, its fields, and the test that says whether AFAS
 * accepts them. Every group but the first is divided off by a hairline.
 *
 * The heading is a **badge**, because it is what tells an admin which of two
 * identical credential pairs they are typing into, and getting that wrong means a
 * live environment configured as a test one — a form where nothing else differs
 * should carry that difference as loudly as it can.
 *
 * It is a `<fieldset>` so `disabled` reaches every control inside — the fields,
 * *Wissen*, the eye and *Verbinding testen* — without each one being told.
 */
function Section({
  title,
  stage,
  connection,
  onTest,
  disabled = false,
  children,
}: {
  title: string;
  stage: SettingsStage;
  connection: ConnectionState;
  onTest: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <fieldset
      disabled={disabled}
      className="mt-5 min-w-0 space-y-4 rounded-xl bg-k-bg p-4 shadow-raised-sm transition-opacity first:mt-0 disabled:opacity-50"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${BADGE_TONE[stage]}`}
        >
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <ConnectionMark connection={connection} />
          <button
            type="button"
            onClick={onTest}
            disabled={connection.testing}
            className="neu-action-secondary"
          >
            <PlugZap className="h-3.5 w-3.5" strokeWidth={1.8} />
            {connection.testing ? t("Testen…", "Testing…") : t("Verbinding testen", "Test connection")}
          </button>
        </div>
      </div>
      {children}
      {connection.result && (
        <Notice tone={connection.result.ok ? "success" : "error"}>
          {connection.result.message}
        </Notice>
      )}
    </fieldset>
  );
}
