"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { projectNumberIn } from "@/lib/download";
import { parseExcelFile, type ParsedWorkbook } from "@/lib/excel";
import { recognizeModule, type ModuleRecognition } from "@/lib/modules";
import {
  clearPendingUpload,
  peekPendingUpload,
  stashPendingUpload,
  type PendingUpload,
} from "@/lib/pending-upload";
import { modulePath } from "@/lib/routes";
import { tr, useT } from "@/lib/i18n";
import { useModule } from "@/components/ModuleProvider";
import { useNavigationGuard } from "@/components/NavigationGuard";
import { useProject } from "@/components/ProjectProvider";
import ModulePicker from "@/components/uploader/ModulePicker";
import SheetPicker from "@/components/uploader/SheetPicker";
import SwitchModulePrompt from "@/components/uploader/SwitchModulePrompt";
import SwitchProjectPrompt from "@/components/uploader/SwitchProjectPrompt";

/**
 * Taking a file in: read it, work out which module it belongs to, and either commit it
 * here or send it to the page of the module it turns out to be for.
 *
 * Every page using this has its own module — the sequence of questions the three modals
 * ask comes out of `elements` in the order the answer is needed:
 *
 *     project the filename names another project   → confirm reading it anyway
 *     module  the filename didn't identify it       → the user picks
 *     switch  it isn't the module of this page      → confirm the move
 *     sheet   the workbook has more than one        → the user picks
 *
 * The project question comes first because it is the only one that can make the
 * others pointless: a file from another conversion shouldn't be handed off to a
 * module page, it should be stopped. It only fires for a file this tool named
 * itself — see `projectNumberIn()` in [lib/download.ts](../../lib/download.ts).
 *
 * The move itself is what the routes changed: a file that belongs elsewhere used to
 * just re-label the page it landed on, and now it has to travel. It goes through
 * [`lib/pending-upload.ts`](../../lib/pending-upload.ts) — parse and all, so the
 * target doesn't read the file twice. A single-sheet hand-off is hers to seed her own
 * state from directly — see `initialCommit` below and its use in `ExcelUploader`.
 */

/** Extensions the file picker offers and `handleFile` accepts. */
const ACCEPTED = ".xlsx,.xls,.csv";

function isExcelFile(file: File): boolean {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

/** A file that has been read and is ready to be shown. */
export interface CommittedUpload {
  /** The file as the user gave it to us — the export re-opens it to keep its formatting. */
  file: File;
  parsed: ParsedWorkbook;
  /** Which of `parsed.sheets` to show. */
  sheetIndex: number;
}

/** A file being read, before it's known what to do with it. */
interface Intake {
  file: File;
  parsed: ParsedWorkbook;
}

/** The question currently on screen; null when nothing is pending. */
type Stage =
  | { kind: "project"; intake: Intake; fileProjectId: string }
  | { kind: "module"; intake: Intake; recognition: ModuleRecognition }
  | { kind: "switch"; intake: Intake; toModuleId: string }
  | { kind: "sheet"; intake: Intake };

export interface FileIntake {
  /**
   * A file already waiting for this module when it mounted — the single-sheet case
   * of a hand-off from another module's page. Read exactly once, at mount: feed it to
   * your own `useState` initialisers the same render, the way `ExcelUploader` does, so
   * the table appears on the very first paint instead of an effect's repaint later.
   * Multi-sheet hand-offs can't resolve this early — there's a question to ask first —
   * and show through `elements`' sheet picker instead, same as a fresh upload.
   */
  initialCommit: CommittedUpload | null;
  /**
   * Reading a file, and anything that went wrong doing it — or null when there is
   * nothing to report. The page places it: under the dropzone while there is no
   * table, directly above the table once there is, since a re-read can fail with
   * data already on screen.
   */
  notice: React.ReactNode | null;
  /**
   * Put a message in that same notice. The page's other failures (a save that
   * couldn't be written) belong in one place with the read failures, and this is
   * where that place lives.
   */
  setError: (message: string | null) => void;
  /** True while a modal is resolving a file — the dropzone steps aside for it. */
  resolving: boolean;
  /** Read this file and route it. Wrap the call if the page has edits to protect. */
  handleFile: (file: File) => void;
  /** Open the file picker. Same. */
  openFilePicker: () => void;
  /** The hidden file input plus whichever modal the current stage needs. */
  elements: React.ReactNode;
}

export function useFileIntake({
  moduleId,
  onCommit,
}: {
  /** The module of the page taking the file in. */
  moduleId: string;
  /** A file that belongs to `moduleId` — show it. */
  onCommit: (upload: CommittedUpload) => void;
}): FileIntake {
  const { modules } = useModule();
  const { selectedProject, selectedProjectId } = useProject();
  const { navigate } = useNavigationGuard();
  const t = useT();

  /**
   * A hand-off waiting for this module when it mounted, read once via a lazy
   * initialiser — safe against React's development double-invoke because `peek`
   * (unlike the old `take`) doesn't clear the slot, so a replay sees the same value
   * rather than finding it already gone. `initialStage` below seeds `stage` from it
   * for the multi-sheet case; `initialCommit`, further down, is the single-sheet case,
   * read out for the caller to seed its own state with. Either way the slot itself is
   * cleared once, after mount (`useEffect` below) — clearing it here in the
   * initialiser would hit the same double-invoke trap `peek` was split out to avoid.
   */
  const [handedOff] = useState<PendingUpload | null>(() => peekPendingUpload(moduleId));

  const initialStage = useCallback((): Stage | null => {
    if (!handedOff) return null;
    if (handedOff.parsed.sheets.length > 1) return { kind: "sheet", intake: handedOff };
    return null;
  }, [handedOff]);

  const [stage, setStage] = useState<Stage | null>(initialStage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The single-sheet hand-off case: nothing left to ask, so it isn't a `stage` at
  // all — the caller reads it back as `initialCommit` and seeds its own state with
  // it in the same render. `stage` already claimed the multi-sheet case above.
  const initialCommit: CommittedUpload | null =
    handedOff && handedOff.parsed.sheets.length === 1
      ? { ...handedOff, sheetIndex: 0 }
      : null;

  // Release the slot once mounted, whichever of the two paths above claimed it — a
  // second visit to this module must not re-open a hand-off already taken up. Not a
  // `set-state-in-effect` case: this clears module-level state outside React, the
  // same shape any effect that talks to the world outside the component is.
  useEffect(() => {
    if (handedOff) clearPendingUpload(moduleId);
    // Only ever run once, right after the mount that read `handedOff` — a later
    // change to `moduleId` (there isn't one; the page remounts on it, see
    // `ExcelUploader`'s own doc comment) must not re-clear a different module's slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  /** The file belongs here: ask which sheet if there's a choice, else show it. */
  const proceed = useCallback(
    (intake: Intake) => {
      if (intake.parsed.sheets.length > 1) {
        setStage({ kind: "sheet", intake });
        return;
      }
      setStage(null);
      onCommit({ ...intake, sheetIndex: 0 });
    },
    [onCommit]
  );

  /**
   * The file belongs to another module: leave it for that module's page and go there.
   *
   * Past the guard on purpose. Handing a file to the tool is already a decision to
   * replace whatever is on screen — and the unsaved-changes prompt at the call site
   * has already asked about edits — so putting the "leave this module?" prompt in
   * front of it as well would be asking the same question twice. That prompt is for
   * the sidebar, where the user isn't replacing anything.
   */
  const handOff = useCallback(
    (intake: Intake, toModuleId: string) => {
      setStage(null);
      stashPendingUpload({ moduleId: toModuleId, ...intake });
      navigate(modulePath(selectedProjectId, toModuleId), { force: true });
    },
    [navigate, selectedProjectId]
  );

  /** Route a file whose module is settled — here, or over to where it belongs. */
  const resolve = useCallback(
    (intake: Intake, toModuleId: string) => {
      if (toModuleId === moduleId) proceed(intake);
      // Moving away is the user's call: they may well have meant this file for the
      // module they were already on.
      else setStage({ kind: "switch", intake, toModuleId });
    },
    [moduleId, proceed]
  );

  /**
   * Work out which module the file is for and route it. Split out of
   * `handleFile` so the project prompt can call it once the user has said to
   * read the file anyway — the module question is the same question either way.
   */
  const routeToModule = useCallback(
    (intake: Intake) => {
      const recognition = recognizeModule(intake.parsed.fileName, modules);
      if (recognition.status === "recognized") {
        resolve(intake, recognition.moduleId);
      } else {
        // Couldn't identify the module from the name — ask the user first.
        setStage({ kind: "module", intake, recognition });
      }
    },
    [modules, resolve]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!isExcelFile(file)) {
        setError(
          tr(
            `"${file.name}" is geen Excel- of CSV-bestand.`,
            `"${file.name}" is not an Excel or CSV file.`
          )
        );
        return;
      }
      setLoading(true);
      try {
        const parsed = await parseExcelFile(file);
        const intake = { file, parsed };
        // Only a file this tool named itself carries a number, and only a
        // *different* number is worth a word: the common case — the client's own
        // export, never downloaded from here — reads null and passes straight
        // through, as it did before any of this existed.
        const fileProjectId = projectNumberIn(parsed.fileName);
        if (fileProjectId && fileProjectId !== selectedProjectId) {
          setStage({ kind: "project", intake, fileProjectId });
          return;
        }
        routeToModule(intake);
      } catch (e) {
        setError(e instanceof Error ? e.message : tr("Kon het bestand niet inlezen.", "The file could not be read."));
      } finally {
        setLoading(false);
      }
    },
    [selectedProjectId, routeToModule]
  );

  const notice =
    loading || error ? (
      <>
        {loading && <p className="text-sm text-k-text-secondary">{t("Bestand wordt ingelezen…", "Reading file…")}</p>}
        {error && (
          <p className="rounded-xl bg-k-red-bg px-4 py-3 text-sm text-k-red-fg">
            {error}
          </p>
        )}
      </>
    ) : null;

  const elements = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      {/* 1. Project confirmation — when the filename names another project */}
      {stage?.kind === "project" && (
        <SwitchProjectPrompt
          fileName={stage.intake.parsed.fileName}
          fileProjectId={stage.fileProjectId}
          currentProjectId={selectedProjectId}
          currentProjectName={selectedProject.name}
          onConfirm={() => {
            // Read it here after all. The number in the name is not carried over:
            // the next download is named for *this* project, which is now the
            // project the sheet is being worked on in.
            setStage(null);
            routeToModule(stage.intake);
          }}
          onCancel={() => {
            setStage(null);
            resetInput();
          }}
        />
      )}

      {/* 2. Module picker — when the filename didn't identify the module */}
      {stage?.kind === "module" && (
        <ModulePicker
          fileName={stage.intake.parsed.fileName}
          recognition={stage.recognition}
          onSelect={(picked) => resolve(stage.intake, picked)}
          onCancel={() => {
            setStage(null);
            resetInput();
          }}
        />
      )}

      {/* 3. Module-switch confirmation — when the file belongs to another module */}
      {stage?.kind === "switch" && (
        <SwitchModulePrompt
          from={moduleId}
          to={stage.toModuleId}
          onConfirm={() => handOff(stage.intake, stage.toModuleId)}
          // Declined: the file stays here, under this page's module.
          onCancel={() => proceed(stage.intake)}
        />
      )}

      {/* 4. Sheet picker — when the workbook has multiple sheets */}
      {stage?.kind === "sheet" && (
        <SheetPicker
          workbook={stage.intake.parsed}
          onSelect={(sheetIndex) => {
            setStage(null);
            onCommit({ ...stage.intake, sheetIndex });
          }}
          onCancel={() => {
            setStage(null);
            resetInput();
          }}
        />
      )}
    </>
  );

  return {
    initialCommit,
    notice,
    setError,
    resolving: stage !== null,
    handleFile,
    openFilePicker: () => inputRef.current?.click(),
    elements,
  };
}
