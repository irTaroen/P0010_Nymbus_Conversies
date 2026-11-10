"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import Checkbox from "@/components/Checkbox";
import Modal, { ModalButton, ModalCloseButton } from "@/components/Modal";
import { Field, inputClass, Notice } from "@/components/settings/SettingsFields";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import type { Project } from "@/lib/auth";
import {
  CONVERSION_TYPES,
  createProject,
  fetchModuleCatalog,
  type CatalogGroup,
  type ConversionType,
} from "@/lib/projects";
import { tr, useT } from "@/lib/i18n";

/**
 * *Nieuw project*: the id, name and AFAS environment number of a conversion, the
 * kind of conversion, and the modules it covers. Saved to `projects.json` /
 * `project_modules.json`; the credentials go in afterwards, in the project
 * settings — where the *Connectoren* tab then checks that every GetConnector the
 * tool reads is installed in the client's environment.
 *
 * `onCreated` gets the new project once the session has been refreshed, so the
 * caller can navigate to it (the sidebar through the navigation guard, the empty
 * home page directly).
 */
export default function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const t = useT();
  const { refresh } = useAuth();
  const [catalog, setCatalog] = useState<CatalogGroup[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [omgeving, setOmgeving] = useState("");
  const [conversionType, setConversionType] = useState<ConversionType>("standard");
  const [modules, setModules] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchModuleCatalog()
      .then((groups) => current && setCatalog(groups))
      .catch((err) => current && setCatalogError(err instanceof Error ? err.message : String(err)));
    return () => {
      current = false;
    };
  }, []);

  const idValid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id.trim());
  const omgevingValid = omgeving.trim() === "" || /^\d+$/.test(omgeving.trim());
  const canSave = idValid && omgevingValid && !saving;

  function toggle(moduleId: string) {
    setModules((current) =>
      current.includes(moduleId) ? current.filter((m) => m !== moduleId) : [...current, moduleId]
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const project = await createProject({
        id: id.trim(),
        name: name.trim(),
        omgeving: omgeving.trim(),
        conversionType,
        modules,
      });
      await refresh();
      onCreated(project);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : tr("Het project kon niet worden aangemaakt.", "The project could not be created.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onDismiss={onClose} className="flex h-[min(85vh,52rem)] max-w-2xl flex-col overflow-hidden">
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-k-divider px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-k-text-primary">{t("Nieuw project", "New project")}</h2>
              <p className="mt-1 text-sm text-k-text-secondary">
                {t(
                  "De AFAS-gegevens vul je daarna in bij de projectinstellingen.",
                  "You fill in the AFAS details afterwards, in the project settings."
                )}
              </p>
            </div>
            <ModalCloseButton onClose={onClose} />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 rounded-xl bg-k-bg p-4 shadow-raised-sm sm:grid-cols-2">
            <Field
              id="new-project-id"
              label={t("Projectnummer", "Project number")}
              required
              hint={t("Letters, cijfers, '-' en '_' — staat in de URL.", "Letters, digits, '-' and '_' — appears in the URL.")}
            >
              <input
                id="new-project-id"
                type="text"
                autoFocus
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="501282"
                aria-invalid={id.trim() !== "" && !idValid}
                className={`${inputClass} mt-1.5 w-full`}
              />
            </Field>
            <Field
              id="new-project-omgeving"
              label={t("Omgevingsnummer", "Environment number")}
              hint={t("Het nummer in 12345.rest.afas.online.", "The number in 12345.rest.afas.online.")}
            >
              <input
                id="new-project-omgeving"
                type="text"
                inputMode="numeric"
                value={omgeving}
                onChange={(e) => setOmgeving(e.target.value)}
                placeholder="12345"
                aria-invalid={!omgevingValid}
                className={`${inputClass} mt-1.5 w-full`}
              />
            </Field>
          </div>

          <Field id="new-project-name" label={t("Projectnaam", "Project name")}>
            <input
              id="new-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Naam van de klant", "Client name")}
              className={`${inputClass} mt-1.5 w-full`}
            />
          </Field>

          <Field id="new-project-type" label={t("Soort conversie", "Kind of conversion")}>
            <select
              id="new-project-type"
              value={conversionType}
              onChange={(e) => setConversionType(e.target.value as ConversionType)}
              className={`${inputClass} mt-1.5 w-full`}
            >
              {CONVERSION_TYPES.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(option.label, option.labelEn)}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <p className="text-sm font-medium text-k-text-primary">{t("Modules", "Modules")}</p>
            {catalogError ? (
              <div className="mt-2">
                <Notice tone="error">{catalogError}</Notice>
              </div>
            ) : !catalog ? (
              <p className="mt-2 text-sm text-k-text-secondary">{t("Modules laden…", "Loading modules…")}</p>
            ) : (
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                {catalog.map((group) => (
                  <div key={group.id} className="rounded-xl bg-k-bg p-4 shadow-raised-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">
                      {group.label}
                    </h3>
                    <div className="mt-2 space-y-0.5">
                      {group.modules.map((module) => {
                        const checked = modules.includes(module.id);
                        return (
                          <label
                            key={module.id}
                            htmlFor={`new-module-${module.id}`}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-[box-shadow,background-color] duration-200 hover:shadow-inset-sm ${
                              checked ? "bg-k-cloud-light/40 shadow-inset-sm" : ""
                            }`}
                          >
                            <Checkbox
                              id={`new-module-${module.id}`}
                              checked={checked}
                              onChange={() => toggle(module.id)}
                            />
                            <span className={`text-sm ${checked ? "font-medium text-k-text-primary" : "text-k-text-secondary"}`}>
                              {module.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <div className="flex shrink-0 justify-end border-t border-k-divider px-6 py-4">
          <ModalButton tone="primary" type="submit" disabled={!canSave}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2} />
            )}
            {saving ? t("Aanmaken…", "Creating…") : t("Project aanmaken", "Create project")}
          </ModalButton>
        </div>
      </form>
    </Modal>
  );
}
