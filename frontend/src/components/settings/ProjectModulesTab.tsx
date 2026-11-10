"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import Checkbox from "@/components/Checkbox";
import { ModalButton } from "@/components/Modal";
import { Field, inputClass, Notice } from "@/components/settings/SettingsFields";
import { useAuth } from "@/components/AuthProvider";
import { useModule } from "@/components/ModuleProvider";
import { useProject } from "@/components/ProjectProvider";
import { ApiError } from "@/lib/api";
import {
  CONVERSION_TYPES,
  PROJECT_STATUSES,
  deleteProject,
  fetchModuleCatalog,
  saveConversionType,
  saveProjectModules,
  saveProjectStatus,
  type CatalogGroup,
  type ConversionType,
  type ProjectStatus,
} from "@/lib/projects";
import { tr, useT } from "@/lib/i18n";

/**
 * The *Modules* tab of the project settings: which modules this project carries,
 * what kind of conversion it is, its status (Realisatie / Afgemeld), and — at the
 * bottom — removing the project. Saves
 * on its own button, like *Conversie*: these are `projects.json` /
 * `project_modules.json`, not the credentials the footer saves.
 *
 * A module taken off keeps nothing (its stage and figures go with it); a module
 * kept keeps both. `onDeleted` is the caller's way out once the project is gone.
 */
export default function ProjectModulesTab({
  projectId,
  onDeleted,
}: {
  projectId: string;
  onDeleted: () => void;
}) {
  const t = useT();
  const { refresh: refreshSession } = useAuth();
  const { groups, status: modulesStatus, refresh: refreshModules } = useModule();
  const { selectedProject } = useProject();
  const [catalog, setCatalog] = useState<CatalogGroup[] | null>(null);
  // The sidebar's list until the first edit — and nothing before it has loaded, or
  // a save in that moment would take every module off the project.
  const [edited, setEdited] = useState<string[] | null>(null);
  const selected =
    edited ??
    (modulesStatus === "ready" ? groups.flatMap((group) => group.items.map((item) => item.id)) : null);
  const [conversionType, setConversionType] = useState<ConversionType>(
    selectedProject.conversionType
  );
  const initialStatus: ProjectStatus =
    selectedProject.status.trim().toLowerCase() === "afgemeld" ? "afgemeld" : "realisatie";
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let current = true;
    fetchModuleCatalog()
      .then((loaded) => current && setCatalog(loaded))
      .catch((err) => current && setNotice({ tone: "error", text: err instanceof Error ? err.message : String(err) }));
    return () => {
      current = false;
    };
  }, []);

  function toggle(moduleId: string) {
    setNotice(null);
    if (selected === null) return;
    setEdited(
      selected.includes(moduleId) ? selected.filter((m) => m !== moduleId) : [...selected, moduleId]
    );
  }

  async function save() {
    if (selected === null) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveProjectModules(projectId, selected);
      if (conversionType !== selectedProject.conversionType) {
        await saveConversionType(projectId, conversionType);
      }
      if (projectStatus !== initialStatus) {
        await saveProjectStatus(projectId, projectStatus);
      }
      await Promise.all([refreshSession(), refreshModules()]);
      setNotice({ tone: "success", text: tr("Opgeslagen.", "Saved.") });
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof ApiError ? err.message : tr("Opslaan is niet gelukt.", "Saving failed."),
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteProject(projectId);
      await refreshSession();
      onDeleted();
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof ApiError ? err.message : tr("Verwijderen is niet gelukt.", "Removing failed."),
      });
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl bg-k-bg p-4 shadow-raised-sm sm:grid-cols-2">
        <Field id="project-conversion-type" label={t("Soort conversie", "Kind of conversion")}>
          <select
            id="project-conversion-type"
            value={conversionType}
            onChange={(e) => {
              setConversionType(e.target.value as ConversionType);
              setNotice(null);
            }}
            className={`${inputClass} mt-1.5 w-full`}
          >
            {CONVERSION_TYPES.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.label, option.labelEn)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="project-status" label={t("Projectstatus", "Project status")}>
          <select
            id="project-status"
            value={projectStatus}
            onChange={(e) => {
              setProjectStatus(e.target.value as ProjectStatus);
              setNotice(null);
            }}
            className={`${inputClass} mt-1.5 w-full`}
          >
            {PROJECT_STATUSES.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.label, option.labelEn)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div>
        <p className="text-sm font-medium text-k-text-primary">{t("Modules van dit project", "This project's modules")}</p>
        <p className="mt-1 text-xs text-k-text-secondary">
          {t(
            "Een module die je uitzet verliest zijn fase en voortgang; een module die blijft houdt ze.",
            "A module you switch off loses its stage and progress; a module that stays keeps them."
          )}
        </p>
        {!catalog || selected === null ? (
          <p className="mt-3 text-sm text-k-text-secondary">{t("Modules laden…", "Loading modules…")}</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {catalog.map((group) => (
              <div key={group.id} className="rounded-xl bg-k-bg p-4 shadow-raised-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-k-text-tertiary">{group.label}</h3>
                <div className="mt-2 space-y-0.5">
                  {group.modules.map((module) => {
                    const checked = selected.includes(module.id);
                    return (
                      <label
                        key={module.id}
                        htmlFor={`project-module-${module.id}`}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 transition-[box-shadow,background-color] duration-200 hover:shadow-inset-sm ${
                          checked ? "bg-k-cloud-light/40 shadow-inset-sm" : ""
                        }`}
                      >
                        <Checkbox
                          id={`project-module-${module.id}`}
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

      <div className="flex items-center justify-end gap-3">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <ModalButton tone="primary" onClick={() => void save()} disabled={saving || !catalog || selected === null}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Save className="h-4 w-4" strokeWidth={1.8} />
          )}
          {saving ? t("Opslaan…", "Saving…") : t("Opslaan", "Save")}
        </ModalButton>
      </div>

      <div className="border-t border-k-divider pt-5">
        <p className="text-sm font-medium text-k-text-primary">{t("Project verwijderen", "Remove project")}</p>
        <p className="mt-1 text-xs text-k-text-secondary">
          {t(
            "Haalt het project, zijn modules en zijn AFAS-gegevens weg uit de lokale bestanden. De koppelingen in mappings/clients/ blijven staan. Niets in AFAS verandert.",
            "Removes the project, its modules and its AFAS details from the local files. The mappings in mappings/clients/ stay. Nothing in AFAS changes."
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {confirmDelete ? (
            <>
              <ModalButton tone="danger" onClick={() => void remove()} disabled={deleting}>
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                )}
                {t(`Ja, verwijder ${projectId}`, `Yes, remove ${projectId}`)}
              </ModalButton>
              <ModalButton onClick={() => setConfirmDelete(false)} disabled={deleting}>
                {t("Annuleren", "Cancel")}
              </ModalButton>
            </>
          ) : (
            <ModalButton tone="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              {t("Project verwijderen", "Remove project")}
            </ModalButton>
          )}
        </div>
      </div>
    </div>
  );
}
