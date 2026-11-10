"use client";

import { useState } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import ProjectPickerModal from "@/components/ProjectPickerModal";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";

/**
 * The active project in the sidebar. Anyone with more than one project gets a
 * button that opens [`ProjectPickerModal`](./ProjectPickerModal.tsx) over the app —
 * every project for admins, their own for everyone else. With a single project
 * there is nothing to switch between, so it renders as a plain tile.
 *
 * A centred dialog rather than the `PopoverPanel` this used to be: choosing a
 * project now means reading whether AFAS has a dossieritem for it, what its status
 * is and how many modules it holds, and none of that fits on a `w-72` panel hanging
 * off a `w-68` rail.
 *
 * It also **opens itself once, right after an admin signs in**: their session carries
 * every conversion project, so the project they land in is one nobody chose. `/` has
 * always asked ([`app/page.tsx`](../app/page.tsx)), but a sign-in doesn't have to happen
 * there — the address bar still holds the module a colleague linked, or the one the
 * previous session left behind — and `AuthGate` signs the user in wherever they are.
 * Asking from the shell covers every one of those doors. See `projectChoicePending`
 * in [`AuthProvider`](./AuthProvider.tsx); unlike at `/` this dialog is dismissable,
 * because behind it there is a project to work in.
 *
 * Note this is **not** an admin gate, even though in practice admins are the ones
 * who see the button: the rule is "more than one project", so a non-admin who
 * belongs to two gets it too. Anything that really is admins-only goes in
 * [`AdminOnly`](./AdminOnly.tsx) instead.
 */
export default function ProjectSelector({
  fullWidth = false,
}: {
  fullWidth?: boolean;
}) {
  const { projects, canSwitchProject, selectedProjectId, selectedProject } =
    useProject();
  const { projectChoicePending, projectChoiceOffered } = useAuth();
  const [open, setOpen] = useState(false);
  const t = useT();

  // Two ways the dialog can be up: this button, or the ask that follows a sign-in.
  // Derived rather than an effect that opens it, so there is no first frame without
  // it — and the pending flag is spent by *closing*, which is also what picking a
  // project does, so the project the admin lands in doesn't greet them with the same
  // dialog again. `canSwitchProject` guards the flag as well: only the branch below
  // renders a picker, so only it may consume the ask.
  const asking = projectChoicePending && canSwitchProject;
  const showPicker = open || asking;

  function closePicker() {
    setOpen(false);
    if (asking) projectChoiceOffered();
  }

  const badge = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-k-bg text-k-cloud-deep shadow-inset-sm">
      <Building2 className="h-4 w-4" strokeWidth={2} />
    </span>
  );

  const label = (
    <>
      {badge}
      <span className="min-w-0">
        {/* The project code beside the word, not under it: it is what a colleague
            pastes into chat and what the URL carries, and the row below is the one
            that has to truncate. */}
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-k-text-tertiary leading-none">
          Project <span className="tabular-nums">{selectedProject.id}</span>
        </span>
        <span className="block max-w-[12rem] truncate text-sm font-medium text-k-text-primary">
          {selectedProject.name}
        </span>
      </span>
    </>
  );

  // Nothing to choose from: show the project as a plain tile.
  if (!canSwitchProject) {
    return (
      <div
        title={selectedProject.name}
        className={`flex items-center gap-2.5 rounded-full bg-k-bg px-3 py-1.5 text-left shadow-raised-sm ${
          fullWidth ? "w-full" : ""
        }`}
      >
        {label}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={showPicker}
        title={t(`${selectedProject.name} — kies een ander project`, `${selectedProject.name} — choose another project`)}
        className={`neu-button flex items-center gap-2.5 rounded-full px-3 py-1.5 text-left ${
          fullWidth ? "w-full" : ""
        }`}
      >
        {label}
        <ChevronsUpDown
          className="ml-auto h-4 w-4 shrink-0 text-k-text-tertiary"
          strokeWidth={2}
        />
      </button>

      {/* Mounted only while open, so every visit starts with an empty search. */}
      {showPicker && (
        <ProjectPickerModal
          projects={projects}
          selectedProjectId={selectedProjectId}
          onClose={closePicker}
        />
      )}
    </>
  );
}
