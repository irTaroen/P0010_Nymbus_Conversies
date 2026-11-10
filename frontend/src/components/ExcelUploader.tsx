"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Upload } from "lucide-react";
import {
  downloadSheet,
  cellToString,
  type DownloadRequest,
  type ParsedWorkbook,
} from "@/lib/excel";
import { getModule } from "@/lib/modules";
import { codetabelColumns, validateSheet } from "@/lib/validation/engine";
import { codetabelIsLoaded } from "@/lib/validation/codetabellen";
import { applyAutofix, recordAutofixes } from "@/lib/validation/autofix";
import {
  standardColumnFills,
  NO_STANDARD_FILLS,
  type StandardColumnFills,
} from "@/lib/standard-columns";
import { useCodetabellen } from "@/components/CodetabellenProvider";
import { buildValidationReport, type ValidationReport } from "@/lib/validation/report";
import {
  errorRowIndexes,
  sheetMetrics,
  type MetricText,
} from "@/lib/validation/metrics";
import { buildReportPdf, downloadReportPdf } from "@/lib/report-pdf";
import { downloadName, triggerDownload } from "@/lib/download";
import {
  addAfasPlaatsen,
  downloadAfasPlaatsen,
  moduleHasUnlistedPlaces,
  unlistedPlaces,
} from "@/lib/afas-plaatsen";
import { type Issue, type ValidationResult } from "@/lib/validation/types";
import { stampValidation } from "@/lib/progress-payload";
import { parseAppPath } from "@/lib/routes";
import { payloadPlanFor } from "@/lib/module-payloads";
import { isNarrowScreen } from "@/lib/narrow-screen";
import type { Project } from "@/lib/auth";
import { useAuth, useIsAdmin } from "@/components/AuthProvider";
import { useNavigationGuard } from "@/components/NavigationGuard";
import { useModule } from "@/components/ModuleProvider";
import { useProject } from "@/components/ProjectProvider";
import { useFocusMode } from "@/components/FocusModeProvider";
import { useProgress } from "@/components/ProgressProvider";
import SheetToolbar, { type SheetView } from "@/components/uploader/SheetToolbar";
import ModulePayloadPanel from "@/components/uploader/ModulePayloadPanel";
import DataTable from "@/components/uploader/DataTable";
import ModuleStartCard, {
  ModuleIntroCopy,
} from "@/components/uploader/ModuleStartCard";
import ModuleHelpDrawer from "@/components/uploader/ModuleHelpDrawer";
import ValidationReportDrawer from "@/components/uploader/ValidationReportDrawer";
import SheetSettings from "@/components/uploader/SheetSettings";
import UnsavedChangesPrompt from "@/components/uploader/UnsavedChangesPrompt";
import LeaveModulePrompt from "@/components/uploader/LeaveModulePrompt";
import UploadLanding from "@/components/uploader/UploadLanding";
import Hero from "@/components/Hero";
import { useFileIntake, type CommittedUpload } from "@/components/uploader/useFileIntake";
import {
  MissingColumnsNotice,
} from "@/components/uploader/Notices";
import DraftRestoreNotice from "@/components/uploader/DraftRestoreNotice";
import { useSheetDraft } from "@/components/uploader/useSheetDraft";
import ColumnRepairDialog from "@/components/uploader/ColumnRepairDialog";
import { applyColumnRepairs, type ColumnRepair } from "@/lib/column-repair";
import { normalizeHeader } from "@/lib/headers";
import type { SheetDraft } from "@/lib/draft-store";
import { peekPendingUpload } from "@/lib/pending-upload";
import { tr, useLocale, useT } from "@/lib/i18n";
import { columnInstructions } from "@/lib/column-instructions";

// Stable empty maps so DataTable's `issues`/`defaults` props keep a constant
// identity before the first validation (avoids needless re-renders).
const EMPTY_ISSUES = new Map<string, never>();
const EMPTY_DEFAULTS = new Map<string, never>();
const EMPTY_NOTICES = new Map<string, never>();

/**
 * Where a link leads, in words the leave prompt can use: the module it opens, or —
 * for the project's own page — the project's name. `href` comes from the navigation
 * guard, which is handed a path and nothing else.
 */
function destinationLabel(href: string, projects: Project[]): string {
  const { projectId, moduleId } = parseAppPath(href);
  if (moduleId) return getModule(moduleId)?.label ?? moduleId;
  const project = projects.find((p) => p.id === projectId);
  return project?.name ?? tr("een andere pagina", "another page");
}

/** The sheet state a committed upload seeds — everything `commit()` builds from it. */
interface SheetState {
  workbook: ParsedWorkbook;
  cellData: string[][];
  /** Cells the codetabel autofix rewrote — edited from the start, as far as the
   *  export and the unsaved-changes guard are concerned. */
  dirtyKeys: Set<string>;
  result: ValidationResult;
  sourceFile: File;
  committedSheetIndex: number;
}

type ParsedSheet = ParsedWorkbook["sheets"][number];

/** The sheet's cells as read from the file — the baseline every edit is measured from. */
function originalCells(s: ParsedSheet): string[][] {
  return s.rows.map((row) => s.headers.map((_, c) => cellToString(row[c])));
}

/**
 * One validation run: the repairs first — a name where a code belongs (`Nederland`
 * for `NL`, or an enum alias like `Ja` for `1`) is rewritten to that code, see
 * [`lib/validation/autofix.ts`](../lib/validation/autofix.ts) — then `validateSheet`
 * over the repaired grid, then the amber notice on every cell that was repaired.
 *
 * Every run goes through here — a fresh file, a restored draft, Hercontroleren and
 * the codetabellen arriving — because the fix *is* part of the codetabel check
 * rather than a step of its own: a name typed after the upload is resolved by the
 * next check just as one in the file was. `cells` is the input grid itself when
 * nothing was fixed, so a caller can skip writing it back.
 */
function checkSheet(
  moduleId: string,
  s: ParsedSheet,
  cellData: string[][],
  fills: StandardColumnFills
): { cells: string[][]; fixed: string[]; result: ValidationResult } {
  const { cells, fixed } = applyAutofix(moduleId, s.headers, cellData);
  const result = validateSheet(moduleId, s.headers, cells, fills);
  recordAutofixes(moduleId, s.headers, originalCells(s), cells, result);
  return { cells, fixed, result };
}

/**
 * The pure half of committing a file: read its chosen sheet and validate it against
 * `moduleId`'s rules. No state setter here — `commit()` calls this and writes the
 * result into React state on an ordinary commit; `ExcelUploader`'s own `useState`
 * initializers call it too, to seed the page's state directly from a hand-off already
 * waiting when the page mounts (see the block below `useFileIntake`).
 *
 * `fills` are the columns the conversion fills itself rather than asking the client
 * for — see [`lib/standard-columns.ts`](../lib/standard-columns.ts). Passed in rather
 * than derived here so this stays the pure function it is, and so the three call
 * sites cannot each resolve it differently.
 */
function sheetStateFrom(
  { file, parsed, sheetIndex }: CommittedUpload,
  moduleId: string,
  fills: StandardColumnFills
): SheetState {
  const s = parsed.sheets[sheetIndex];
  const { cells: cellData, fixed, result } = checkSheet(moduleId, s, originalCells(s), fills);
  return {
    workbook: { fileName: parsed.fileName, sheets: parsed.sheets },
    cellData,
    dirtyKeys: new Set(fixed),
    result,
    sourceFile: file,
    committedSheetIndex: sheetIndex,
  };
}

/**
 * One module's page: read a sheet, check it against that module's rules, correct it,
 * and hand it over.
 *
 * The module is the route's, and it can't change under this component — the page keys
 * it on the module, so moving to another one unmounts this and mounts a fresh one.
 * That is what lets everything below simply be "the sheet of `moduleId`": there is no
 * second module to tell it apart from, and no way for the table on screen to have been
 * validated against rules other than the ones the URL names.
 */
export default function ExcelUploader({
  moduleId,
  view,
  onViewChange,
  step = null,
}: {
  moduleId: string;
  /** Which reading of the sheet the URL asks for — see `SheetView`. */
  view: SheetView;
  /** Put another view in the address bar. The URL is the state; this only writes it. */
  onViewChange: (view: SheetView) => void;
  /** The custom module (maatwerk) the URL names (`?stap=`), shown in the payload
   *  view instead of this module. Handed straight to `ModulePayloadPanel`. */
  step?: string | null;
}) {
  // The project is half "Aanleveren bij Nymbus"'s envelope. `projects` names the
  // destination of a leave prompt that points at another project.
  const { selectedProject, projects } = useProject();
  const { session } = useAuth();
  const t = useT();
  const isAdmin = useIsAdmin();
  // The figures stamped per module — what the sidebar badge shows. Read here for
  // the start card (before a file is loaded, the last stamped figure is the only
  // one there is), and refreshed after every validation run, which stamps new ones.
  const { focused } = useFocusMode();
  const { byModule, refresh: refreshProgress } = useProgress();
  const { setNavigationGuard, navigate, isHistoryReturn } = useNavigationGuard();

  /**
   * A single-sheet hand-off already waiting when this page mounted, read once here so
   * every seeded `useState` below can draw from the same value — reading
   * `peekPendingUpload` again per field could see a second mount's different hand-off,
   * or (in development Strict Mode) a stale one already cleared by another peeker.
   * Non-destructive and safe to evaluate twice by design (see its doc comment); the
   * slot itself is released once, by `useFileIntake`'s own effect below — this only
   * reads it, it never claims it.
   *
   * Only the single-sheet case seeds state directly: a multi-sheet hand-off has a
   * question to ask first (which sheet), so it stays with `useFileIntake`'s own
   * `stage`, resolved through the ordinary sheet-picker modal.
   */
  const [initialCommit] = useState<CommittedUpload | null>(() => {
    const handed = peekPendingUpload(moduleId);
    return handed && handed.parsed.sheets.length === 1
      ? { ...handed, sheetIndex: 0 }
      : null;
  });
  /**
   * The columns this conversion fills from its own configuration instead of asking
   * the client for them — a facilitaire conversie's periodetabel, kostenplaats and
   * the rest ([`lib/standard-columns.ts`](../lib/standard-columns.ts)). Empty for a
   * standard project, so every module of one validates exactly as it did.
   *
   * `selectedProject` is nullable here (the uploader also renders on a route without
   * one), and no project means no configuration to fill from: the sheet is judged as
   * the client's own, which is the honest answer rather than a fill invented from
   * defaults.
   *
   * Memoised because it is a dependency of `recheck` and of the two effects that call
   * it — a fresh object every render would re-validate the whole sheet on every one.
   */
  const fills = useMemo(
    () =>
      selectedProject
        ? standardColumnFills(selectedProject, moduleId)
        : NO_STANDARD_FILLS,
    [selectedProject, moduleId]
  );

  const initialSheetState = initialCommit
    ? sheetStateFrom(initialCommit, moduleId, fills)
    : null;

  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(
    initialSheetState?.workbook ?? null
  );
  // cellData mirrors sheet.rows as editable strings; reset each time a file is committed.
  const [cellData, setCellData] = useState<string[][] | null>(
    initialSheetState?.cellData ?? null
  );
  // Keys ("row:col") of cells whose current value differs from the parsed original.
  // Maintained incrementally on each edit so dirtiness never re-scans the whole grid.
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(
    () => initialSheetState?.dirtyKeys ?? new Set()
  );
  // Validation issues from the last run (on commit, or a manual recheck).
  const [result, setResult] = useState<ValidationResult | null>(
    initialSheetState?.result ?? null
  );
  // True once cells have been edited since the last validation — results are stale.
  const [resultStale, setResultStale] = useState(false);
  // Toolbar filter: show only the rows that have at least one validation error.
  const [errorsOnly, setErrorsOnly] = useState(false);
  // The flagged cell the toolbar's vorige/volgende buttons last jumped to — the
  // place the next jump counts from. `seq` makes a repeat jump to the same cell
  // (a sheet with one error) a fresh request `DataTable` acts on again.
  const [errorFocus, setErrorFocus] = useState<
    { row: number; col: number; seq: number } | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  // Help drawer for the module, reachable from the toolbar so the column reference
  // stays available while the data is on screen.
  const [helpOpen, setHelpOpen] = useState(false);
  // Validation report drawer — the sheet-level view of the same issues the table
  // shows per cell.
  const [reportOpen, setReportOpen] = useState(false);
  // The column repair dialog, opened from the missing-column banner (admin only).
  const [repairOpen, setRepairOpen] = useState(false);
  // Missing columns an admin marked *Negeren* in that dialog: no longer named by the
  // banner or the report, for this upload only — a new file starts without any.
  const [ignoredColumns, setIgnoredColumns] = useState<string[]>([]);
  // The raw uploaded file + the committed sheet index, kept so the export can
  // re-open the upload and write the edited sheet back into it.
  const [sourceFile, setSourceFile] = useState<File | null>(
    initialSheetState?.sourceFile ?? null
  );
  const [committedSheetIndex, setCommittedSheetIndex] = useState(
    initialSheetState?.committedSheetIndex ?? 0
  );
  // The grid and the validation run the last save wrote out — the two things both
  // downloaded files are built from. Kept by identity, not by value: `cellData` and
  // `result` are each replaced wholesale by an edit, a recheck or a new file, so the
  // comparison in `isSaved` below is exact and nothing has to remember to invalidate
  // this. Null until the first save, and again after one that didn't finish.
  const [savedSnapshot, setSavedSnapshot] = useState<{
    cells: string[][];
    result: ValidationResult | null;
  } | null>(null);
  // An action that would discard unsaved edits, held until the user resolves the
  // unsaved-changes prompt (null when there's nothing pending).
  const [discardAction, setDiscardAction] = useState<{ run: () => void } | null>(null);
  // A page the user asked to go to while this sheet is open, held until the leave
  // prompt is resolved (null when there's nothing pending).
  const [leaveToHref, setLeaveToHref] = useState<string | null>(null);
  /** The payload view's background work, shown in the toolbar's metrics row. */
  const [payloadActivity, setPayloadActivity] = useState<string | null>(null);
  /** The payload view's record counts, which the toolbar shows in that view. */
  const [payloadMetrics, setPayloadMetrics] = useState<MetricText[] | null>(null);
  /**
   * Autosave. Everything above is the open sheet, and all of it dies with the tab —
   * which the two guards below (`beforeunload`, the leave prompt) can only ask about
   * when the user is the one leaving. A crash, a flat battery or a tab the OS drops
   * asks nobody, so a copy of the edited grid goes to the browser's own storage while
   * it is being worked on, and whatever an interrupted session left behind is offered
   * back on the landing. See [`useSheetDraft`](./uploader/useSheetDraft.ts).
   */
  const {
    pending: pendingDraft,
    accept: acceptDraft,
    clear: clearDraft,
  } = useSheetDraft({
    moduleId,
    projectId: selectedProject?.id ?? null,
    email: session?.user.email ?? null,
    workbook,
    cellData,
    dirtyKeys,
    sheetIndex: committedSheetIndex,
    sourceFile,
  });

  /**
   * The sheet on screen has already been handed over as the pair the client leaves
   * with — the annotated workbook and its validatierapport — and nothing has changed
   * since. A recheck counts as a change: it moves the flags the workbook carries and
   * the stale stamp on the PDF, so the two files on disk would be a run behind.
   */
  const isSaved =
    savedSnapshot !== null &&
    savedSnapshot.cells === cellData &&
    savedSnapshot.result === result;

  /**
   * Edits that would be lost. `dirtyKeys` on its own can't say this: it means "edited
   * since the file was read", which the export needs to know (those are the cells it
   * patches and marks) and a save therefore must not clear — every copy written after
   * one still carries them. So saving doesn't empty that set, it satisfies it.
   */
  const hasUnsavedChanges = dirtyKeys.size > 0 && !isSaved;

  // Warn on refresh / tab-close / window-close / external navigation while there
  // are unsaved edits. Browsers only allow their own native prompt here — a
  // custom popup isn't permitted on unload — so this is the best available guard.
  // It is also all that stands between an open sheet and the browser's back button:
  // that is not a navigation the app is asked about (see `NavigationGuard`).
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  /**
   * While a sheet is on screen, a link the user follows goes through the leave prompt
   * first (`LeaveModulePrompt` → `confirmLeave`): the page it opens comes with an
   * empty table, so the sheet is saved on the way out unless it already has been.
   * Every workbook is stopped, saved or not — closing a table is worth a yes/no even
   * when it costs nothing, and the prompt is where that yes is given. The guard is only
   * installed while there is a workbook, which is also what keeps it from closing over
   * a stale one — without a file, leaving is free and the click applies straight away.
   */
  useEffect(() => {
    if (!workbook) return;
    setNavigationGuard((href) => {
      setLeaveToHref(href);
      return true;
    });
    return () => setNavigationGuard(null);
  }, [workbook, setNavigationGuard]);

  /**
   * Run `action`, but if there are unsaved edits first open the unsaved-changes
   * prompt and defer it until the user chooses save / discard.
   */
  function guardUnsaved(action: () => void) {
    if (hasUnsavedChanges) setDiscardAction({ run: action });
    else action();
  }

  /**
   * Show a read file: validate its chosen sheet against this module and display it.
   *
   * The grid-building and validation are `sheetStateFrom()`, shared with the initial
   * `useState`s above — this is that same step, plus the surrounding state an
   * ordinary commit also has to reset (the send/review dialogs, the report drawer,
   * the errors-only filter) that a fresh mount already starts at by construction and
   * so needs no seeding.
   */
  const commit = useCallback(
    (upload: CommittedUpload) => {
      const { workbook: wb, cellData: data, dirtyKeys: fixedKeys, result: validated, sourceFile: file, committedSheetIndex: idx } =
        sheetStateFrom(upload, moduleId, fills);
      // Every sheet is kept, not just the committed one, so the export can carry
      // the whole workbook out again; `committedSheetIndex` marks the edited one.
      setWorkbook(wb);
      setCellData(data);
      setDirtyKeys(fixedKeys);
      setResult(validated);
      setResultStale(false);
      setErrorsOnly(false);
      setErrorFocus(null);
      // The open report describes the sheet being replaced — close it with it.
      setReportOpen(false);
      setIgnoredColumns([]);
      setSourceFile(file);
      setCommittedSheetIndex(idx);
      // On a phone an admin opens a sheet to send it, not to read its grid — so a
      // module that has payloads lands on them. The grid is a tap away on the
      // view switch; on a desk the sheet opens as it always has.
      if (isAdmin && isNarrowScreen() && payloadPlanFor(moduleId)) onViewChange("payloads");
      // Note what is *not* here: clearing the autosaved draft. A new file does
      // replace it — but by being written over on its own first edit, not by being
      // deleted the moment another sheet arrives. The two are the same in every case
      // except the one that matters: a file that lands here without the user having
      // read the restore offer (one handed over by another module's page, or dropped
      // straight onto the dropzone under it) would otherwise take an afternoon of
      // corrections with it silently. So the draft is only ever thrown away by
      // someone saying so — *Weggooien* on the offer, or handing the sheet in.
    },
    [moduleId, fills, isAdmin, onViewChange]
  );

  /**
   * Put a stored draft back on screen — the same seeding `commit()` does, from the
   * pieces the autosave kept rather than from a fresh parse.
   *
   * The validation run is deliberately **not** among those pieces: it is derived, and
   * re-running it costs milliseconds where storing it would mean keeping a
   * `ValidationResult` in step with a rule set that changes under it. Re-checking here
   * is also the honest answer — the flags on a restored table are this module's rules
   * as they stand now, not the ones that happened to be loaded when the tab died.
   *
   * Nothing counts as saved afterwards (`savedSnapshot` stays null): a draft exists
   * precisely because the sheet never made it out to the two files.
   */
  const restoreDraft = useCallback(
    (stored: SheetDraft) => {
      const s = stored.sheets[stored.sheetIndex];
      const { cells, fixed, result: validated } = checkSheet(moduleId, s, stored.cells, fills);
      setWorkbook({ fileName: stored.fileName, sheets: stored.sheets });
      setCellData(cells);
      setDirtyKeys(new Set([...stored.dirtyKeys, ...fixed]));
      setResult(validated);
      setResultStale(false);
      setErrorsOnly(false);
      setErrorFocus(null);
      setIgnoredColumns([]);
      setSourceFile(stored.file);
      setCommittedSheetIndex(stored.sheetIndex);
      setSavedSnapshot(null);
      // The offer has been taken; the record stays and goes on being updated.
      acceptDraft();
    },
    [moduleId, fills, acceptDraft]
  );

  /**
   * Back/forward doesn't ask this page anything before unmounting it — see
   * `NavigationGuard`'s doc comment — so an edited sheet lost that way has to come
   * back on its own rather than through `DraftRestoreNotice`'s click. This is the one
   * difference from a fresh visit: `isHistoryReturn()` reads true only while this
   * module's route is the one a `popstate` just landed on, and only then does a
   * pending draft apply itself instead of waiting to be offered.
   *
   * Guarded to run once per mount, not once per `pendingDraft` value: `useSheetDraft`
   * reads the stored draft asynchronously (see its effect on `key`), so this fires
   * the moment that read resolves rather than racing it on the first render — and the
   * ref stops a second resolution (there isn't one today, but nothing here should
   * assume it) from restoring twice.
   */
  const autoRestoreChecked = useRef(false);
  useEffect(() => {
    if (autoRestoreChecked.current) return;
    if (!pendingDraft) return;
    autoRestoreChecked.current = true;
    // A one-shot claim on an async read resolving, not a cascading render — the same
    // shape `useFileIntake`'s pending-upload claim guards with a render-time ref
    // check instead (it has no async read to wait on, so it doesn't need the effect
    // at all). The rule can't tell a one-shot claim from a cascading render, but the
    // guard above can only be wrong once, right after a read the effect itself did
    // not cause.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (isHistoryReturn()) restoreDraft(pendingDraft);
  }, [pendingDraft, isHistoryReturn, restoreDraft]);

  const intake = useFileIntake({ moduleId, onCommit: commit });
  // The notice's setter, pulled out on its own: it is a state setter and so stable
  // across renders, which the callbacks below can depend on — `intake` itself is a
  // fresh object every render and would make every one of them fresh too.
  const { setError } = intake;

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) guardUnsaved(() => intake.handleFile(file));
  }

  const sheet = workbook?.sheets[committedSheetIndex];
  /**
   * Re-run validation against the current edited cell values. A name the user typed
   * where a code belongs is resolved here too (`checkSheet`), and lands in the grid
   * as an edit of its own.
   */
  const recheck = useCallback(() => {
    if (!sheet || !cellData) return;
    const { cells: grid, fixed, result: next } = checkSheet(moduleId, sheet, cellData, fills);
    if (fixed.length > 0) {
      setCellData(grid);
      setDirtyKeys((prev) => new Set([...prev, ...fixed]));
    }
    setResult(next);
    setResultStale(false);
    // Every error is fixed — leave the errors-only view rather than stranding
    // the user on an empty table.
    if (next.errorCount === 0) setErrorsOnly(false);
  }, [sheet, cellData, moduleId, fills]);

  /**
   * Validate again once this module's codetabellen have arrived.
   *
   * They are fetched from the client's own AFAS and nothing is bundled, so a sheet
   * loaded before that fetch resolves was judged with its `codetabel` checks
   * skipped — an absent table passes, by design (`codetabelVerdict` in engine.ts).
   * Without this the window is invisible: a wrong landcode carries no error, and so
   * no value picker either, and the user has no way to tell that column simply
   * wasn't checked.
   *
   * Keyed on `loadedAt` rather than run once: switching module or project fetches a
   * different set, and each arrival deserves the same second look. It is a no-op
   * when nothing is loaded (`recheck` returns early) and when the tables were
   * already in hand before the sheet — the second run then produces the same
   * result.
   */
  const { loadedAt, refresh: refreshCodetabellen } = useCodetabellen();

  /**
   * The sheet's codetabel columns whose values are in hand — where an empty cell
   * offers the value picker as well as a wrong one. Only loaded tables: a picker
   * over a table that hasn't arrived would open empty.
   *
   * The store it asks is outside React, so `loadedAt` is what says it changed — and
   * it is **read** here (nothing has loaded while it is 0), not just listed: the
   * React Compiler memoises on what a body reads, and a dependency it never sees
   * used would leave the buttons missing after the tables land.
   */
  const pickerColumns = useMemo(
    () =>
      new Map(
        (sheet && loadedAt > 0 ? codetabelColumns(moduleId, sheet.headers) : [])
          .filter((column) => codetabelIsLoaded(column.rule.tableRef ?? ""))
          .map((column) => [column.idx, column])
      ),
    [moduleId, sheet, loadedAt]
  );
  useEffect(() => {
    if (loadedAt === 0) return;
    // A response to an async fetch resolving, not a render cascade: `loadedAt`
    // changes only when the provider's fetch settles, so this runs once per arrival
    // and the state it sets (the validation result) is not what triggered it. The
    // same shape as the draft auto-restore above, which the rule can't distinguish
    // either.
    //
    // That second look also repairs: the codetabel check resolves a name to its code
    // (`checkSheet`), and a `Nederland` read before `Landen` was in hand could not be
    // resolved then.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    recheck();
    // `recheck` is deliberately not a dependency: it changes identity on every cell
    // edit, so depending on it would re-validate (and re-record progress) on each
    // keystroke. The signal worth acting on is the tables arriving — `loadedAt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedAt]);

  /**
   * Validate again when the language is switched, so the cell errors — which the
   * engine writes as text at run time — follow the NL/EN switch.
   *
   * Only while the result is current: with edits that haven't been re-checked yet,
   * re-validating here would accept them behind the user's back, which is what
   * *Hercontroleren* is for. Those errors switch language on that next check.
   */
  const locale = useLocale();
  // The template's row 2 per column, shown above the table's search fields.
  // `templateUrl` follows the language switch, hence `locale`.
  const instructions = useMemo(
    () => columnInstructions(getModule(moduleId)?.templateUrl, locale),
    [moduleId, locale]
  );
  const checkedLocale = useRef(locale);
  useEffect(() => {
    // The ref only tells a switch from the first render.
    if (checkedLocale.current === locale) return;
    checkedLocale.current = locale;
    // A user's choice settling, not a render cascade — the same shape as the
    // codetabellen arrival above.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (!resultStale) recheck();
    // `recheck` and `resultStale` are deliberately not dependencies: the signal is
    // the switch itself, as `loadedAt` is above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  /**
   * The last validation run as a report, or null while there is nothing to
   * report on. Both readers of it go through here — the drawer and the PDF that
   * rides along with a save — so the two can never describe the sheet
   * differently. Regrouping every issue isn't free, hence a function rather than
   * a value: it runs when a report is actually asked for.
   */
  /**
   * The missing columns the banner and the report name: the last run's, less the
   * ones an admin chose to ignore. Their checks are still skipped — ignoring says
   * the absence is known and fine, not that the column was checked.
   */
  const missingColumns = useMemo(() => {
    const ignored = new Set(ignoredColumns.map(normalizeHeader));
    return (result?.missingColumns ?? []).filter((c) => !ignored.has(normalizeHeader(c)));
  }, [result, ignoredColumns]);

  const makeReport = useCallback((): ValidationReport | null => {
    if (!workbook || !sheet || !result) return null;
    return buildValidationReport({
      fileName: workbook.fileName,
      projectId: selectedProject?.id ?? null,
      sheetName: sheet.name,
      moduleLabel: getModule(moduleId)?.label ?? moduleId,
      headers: sheet.headers,
      rowNumbers: sheet.rowNumbers,
      firstColumnNumber: sheet.firstColumnNumber,
      result: { ...result, missingColumns },
      stale: resultStale,
    });
  }, [workbook, sheet, result, missingColumns, moduleId, resultStale, selectedProject]);

  /**
   * What every write of this sheet starts from — *Opslaan en downloaden*, the
   * marked sheet after a send, the hand-in, an attachment — so the four can't drift
   * into writing different files. Only `issues`, the cells to tint, differ between
   * them. Null while there is no sheet to write.
   */
  const sheetExport = useCallback(
    (issues: Map<string, Issue[]> | undefined): DownloadRequest | null =>
      workbook && cellData
        ? {
            fileName: workbook.fileName,
            projectId: selectedProject?.id ?? null,
            sheets: workbook.sheets,
            sheetIndex: committedSheetIndex,
            rows: cellData,
            dirtyKeys,
            issues,
            defaults: result?.defaults,
            sourceFile,
          }
        : null,
    [workbook, cellData, selectedProject, committedSheetIndex, dirtyKeys, result, sourceFile]
  );

  /**
   * Save the edited table back to the sheet and download it (name + timestamp),
   * with the validatierapport as a PDF alongside it.
   *
   * Two files, because the pair is what gets mailed on: the annotated sheet is
   * what the client corrects in, the report is what tells them what to correct.
   * Downloading the sheet alone left the PDF a second trip through the report
   * drawer, and one of the two would arrive at the client without the other.
   *
   * They are handed over one after the other, not at once: browsers treat a
   * burst of programmatic downloads as one "multiple files" decision, and the
   * second can be dropped silently. The report is built here, before either
   * writer is awaited, so both files describe the grid as it was when the button
   * was pressed.
   */
  const saveAndDownload = useCallback(() => {
    if (!workbook || !sheet || !cellData) return;
    const report = makeReport();
    // Both files are about to be written from exactly this grid and this run — mark
    // which, so everything that asks "is this saved?" (the leave prompt, the
    // unsaved-changes guard, the pulse on the save button) can tell whether they
    // still describe what's on screen. Set here rather than when the writers
    // resolve: this is the moment the snapshot they work from is taken.
    setSavedSnapshot({ cells: cellData, result });
    // Fire-and-forget: the writers are loaded on demand, and everything they
    // need is snapshotted here, so a caller may move on straight away — which is
    // also what lets the leave prompt save and navigate in one click.
    void (async () => {
      try {
        // `result?.byCell` carries the flags into the file (pale fill + a note
        // per cell). It's the last validation run, so a stale result exports
        // stale flags — same trade-off the table itself makes until
        // Hercontroleren, and the PDF below is stamped stale for the same reason.
        // `sourceFile` lets the export re-open the upload and patch it, keeping
        // the client's own formatting; `dirtyKeys` keeps it to the cells
        // actually edited.
        const request = sheetExport(result?.byCell);
        if (request) await downloadSheet(request);
      } catch {
        setSavedSnapshot(null);
        setError(tr("Kon het bestand niet opslaan.", "The file couldn't be saved."));
        return;
      }
      // No validation has run, so there is no report to write — the sheet on
      // its own is still a complete save, and nothing is reported as failed.
      if (!report) return;
      try {
        await downloadReportPdf(report);
      } catch {
        // The workbook is out but the report isn't, and it is the pair that counts —
        // so this doesn't stand as saved, and the prompts go on offering to write it.
        setSavedSnapshot(null);
        setError(
          tr(
            "Het bestand is opgeslagen, maar het PDF-rapport kon niet worden gemaakt.",
            "The file was saved, but the PDF report couldn't be made."
          )
        );
      }
    })();
  }, [workbook, sheet, cellData, result, sheetExport, makeReport, setError]);

  /**
   * The sheet as *Opslaan en downloaden* writes it, with `issues` tinted instead of
   * the last check's — what the payload view hands in after a send, so the cells
   * AFAS refused come out red on the client's own file. Same writer, so the older
   * marks are wiped first there too.
   */
  const downloadMarkedSheet = useCallback(
    async (issues: Map<string, Issue[]>) => {
      const request = sheetExport(issues);
      if (request) await downloadSheet(request);
    },
    [sheetExport]
  );

  /**
   * Every validation run stamps the module's figures — the sidebar badge and the
   * voortgang — with what this sheet scored, the way a hand-in used to. Once per
   * result: `result` is replaced wholesale by a commit or a recheck, so its identity
   * says "a new run"; an edit only marks it stale, and a stale result is not stamped.
   */
  const stampedResult = useRef<ValidationResult | null>(null);
  useEffect(() => {
    if (!result || resultStale || !cellData || !selectedProject || !workbook) return;
    if (stampedResult.current === result) return;
    stampedResult.current = result;
    // An empty sheet (the bare template) says nothing about the module's progress.
    if (cellData.length === 0) return;
    void stampValidation({
      projectId: selectedProject.id,
      moduleId,
      metrics: sheetMetrics(result, cellData.length),
      fileName: workbook.fileName,
    })
      .then(() => refreshProgress())
      .catch(() => {
        // Best-effort: the sheet on screen is what matters; a badge that didn't
        // move is the only cost.
      });
  }, [result, resultStale, cellData, selectedProject, workbook, moduleId, refreshProgress]);

  /**
   * The user chose to go on to the page they asked for: hand over the two files —
   * unless they are already downloaded and still current, in which case the click
   * meant only "yes, close the table" and saving again would just duplicate them.
   * Nothing is cleared on the way out: this component goes with the route, and
   * `saveAndDownload()` has already snapshotted everything the writers need.
   *
   * `force`, because the guard being satisfied is exactly what this click means.
   */
  function confirmLeave() {
    if (!leaveToHref) return;
    if (!isSaved) saveAndDownload();
    navigate(leaveToHref, { force: true });
    setLeaveToHref(null);
  }

  /**
   * The user chose to go on without the sheet and its report — a test upload, a
   * wrong file, edits they don't want after all. Nothing is saved on the way out.
   */
  function discardLeave() {
    if (!leaveToHref) return;
    navigate(leaveToHref, { force: true });
    setLeaveToHref(null);
  }

  /**
   * Row indexes with at least one error-severity issue, ascending — what the
   * "alleen rijen met fouten" filter shows. Derived from the last validation
   * run, so rows stay put while they're being edited and the set only refreshes
   * on Hercontroleren (a row vanishing mid-typing would be jarring).
   */
  const errorRows = useMemo(
    () => (result ? errorRowIndexes(result) : []),
    [result]
  );

  /**
   * The report behind the report drawer. Built only while the drawer is open —
   * it regroups every issue, which is wasted work on a recheck nobody is looking
   * at the report for.
   */
  const report = useMemo(
    // `locale` is read so the report regroups in the new language on a switch — the
    // React Compiler memoises on what a body reads, not on what is listed.
    () => (reportOpen && locale ? makeReport() : null),
    [reportOpen, makeReport, locale]
  );

  /**
   * Every flagged cell in reading order — down the rows, across each row — the
   * stops the toolbar's vorige/volgende buttons walk. From the same last run as
   * `errorRows`, so a cell being fixed doesn't drop out of the walk mid-edit.
   */
  const errorCells = useMemo(() => {
    if (!result) return [];
    const cells: { row: number; col: number }[] = [];
    for (const [key, cellIssues] of result.byCell) {
      if (cellIssues.length === 0) continue;
      const [row, col] = key.split(":").map(Number);
      cells.push({ row, col });
    }
    return cells.sort((a, b) => a.row - b.row || a.col - b.col);
  }, [result]);

  // Where the last jump landed in `errorCells`, for the buttons' "3 van 16" —
  // `null` before the first jump, or once a recheck cleared that cell.
  const errorPosition = errorFocus
    ? errorCells.findIndex((c) => c.row === errorFocus.row && c.col === errorFocus.col)
    : -1;

  /**
   * Jump to the next (`1`) or previous (`-1`) flagged cell after the last one
   * jumped to, wrapping at either end. Counted from the cell itself rather than
   * its index, so a recheck that fixed a few cells moves on from the same spot.
   * From the payload view it switches to the grid first — that's where cells are.
   */
  const goToError = useCallback(
    (dir: 1 | -1) => {
      if (errorCells.length === 0) return;
      if (view !== "data") onViewChange("data");
      setErrorFocus((prev) => {
        const after = (c: { row: number; col: number }) =>
          !prev || c.row > prev.row || (c.row === prev.row && c.col > prev.col);
        const before = (c: { row: number; col: number }) =>
          !prev || c.row < prev.row || (c.row === prev.row && c.col < prev.col);
        const target =
          dir === 1
            ? (errorCells.find(after) ?? errorCells[0])
            : (errorCells.findLast(before) ?? errorCells[errorCells.length - 1]);
        return { row: target.row, col: target.col, seq: (prev?.seq ?? 0) + 1 };
      });
    },
    [errorCells, view, onViewChange]
  );

  /**
   * The errors-only filter. Switching it on also lands on the sheet's first
   * flagged cell: the narrowed grid is there to fix errors, so it opens on one
   * rather than on a row the user then has to scan for the red. Switching it off
   * leaves the cursor where it was.
   */
  const toggleErrorsOnly = useCallback(() => {
    const turningOn = !errorsOnly;
    setErrorsOnly(turningOn);
    if (turningOn && errorCells.length > 0) {
      if (view !== "data") onViewChange("data");
      const first = errorCells[0];
      setErrorFocus((prev) => ({ row: first.row, col: first.col, seq: (prev?.seq ?? 0) + 1 }));
    }
  }, [errorsOnly, errorCells, view, onViewChange]);

  // The filter only bites while there is something to filter down to, so the
  // table never ends up empty because every error was fixed.
  const filterErrors = errorsOnly && errorRows.length > 0;

  // Nudge the save button once there are edits that Hercontroleren has re-checked
  // (not stale) and approved (no errors) — i.e. good, unsaved changes ready to go.
  const saveReady =
    hasUnsavedChanges && !resultStale && result !== null && result.errorCount === 0;

  const moduleLabel = getModule(moduleId)?.label ?? moduleId;

  /**
   * The toolbar's live figures — the same `SheetMetrics` the validatierapport and
   * the sidebar badge read, counted once here. Null until a sheet has been
   * validated, which is what makes the bar fall back to the stored check.
   */
  const metrics = useMemo(
    () => (result && cellData ? sheetMetrics(result, cellData.length) : null),
    [result, cellData]
  );

  /**
   * How this module's rows become AFAS bodies — one connector, or several with a
   * column deciding between them. `null` for a module whose mapping hasn't had that
   * question answered yet, which is what hides the *Payloads* tab entirely rather
   * than offering a view that can only say "nothing here".
   */
  const payloadPlan = useMemo(() => payloadPlanFor(moduleId), [moduleId]);

  /**
   * The sheet **as it stands on screen**, corrections included — what the payload
   * view reads.
   *
   * `sheet` is the file as it was parsed; `cellData` is the grid the user has been
   * fixing. The hand-off already sends the edited grid (`buildUploadRequest` writes
   * `cellData` into the workbook it uploads), so a payload preview built from the
   * untouched parse would be showing bodies that no longer match what would be sent
   * — the corrections would be invisible in exactly the view meant to prove them.
   *
   * Only built while the payload view is on screen: it copies the whole grid, and
   * the ordinary case is a client who never opens this tab.
   */
  const editedSheet = useMemo(() => {
    if (!sheet || !cellData || view !== "payloads") return null;
    return { ...sheet, rows: cellData.map((row) => [...row]) };
  }, [sheet, cellData, view]);

  // The module's last recorded check, shown on the start card while no file is
  // loaded. Absent for a module nobody has checked yet — then the card simply
  // carries no percentage, the same rule as the sidebar badge.
  const storedProgress = byModule.get(moduleId) ?? null;

  /**
   * The settings modal's *Codetabellen verversen*: this module's tables again from
   * AFAS, past the backend's hour-long cache. The re-validation is not done here —
   * the provider bumps `loadedAt` and the effect above runs `recheck`, the same path
   * the first arrival of the tables takes.
   */
  const refreshTables = useCallback(async () => {
    const count = await refreshCodetabellen();
    if (count === 0) return tr("Deze module controleert geen codetabellen.", "This module checks no code tables.");
    return count === 1
      ? tr("1 codetabel opnieuw opgehaald uit AFAS.", "1 code table fetched again from AFAS.")
      : tr(`${count} codetabellen opnieuw opgehaald uit AFAS.`, `${count} code tables fetched again from AFAS.`);
  }, [refreshCodetabellen]);

  /**
   * The Instellingen modal's *Plaatsen toevoegen* and *AFAS plaatsen downloaden*,
   * admin-only and only on a module whose woonplaatsen may be unlisted. The places
   * are read off the last validation, so they are the amber cells on screen.
   */
  const placesToAdd = useMemo(
    () =>
      isAdmin && sheet && cellData && result && moduleHasUnlistedPlaces(moduleId)
        ? unlistedPlaces(moduleId, sheet.headers, cellData, result)
        : [],
    [isAdmin, moduleId, sheet, cellData, result]
  );
  const plaatsen = useMemo(
    () =>
      isAdmin && moduleHasUnlistedPlaces(moduleId)
        ? {
            count: placesToAdd.length,
            onAdd: async () => {
              const { added, existing } = await addAfasPlaatsen(placesToAdd);
              const addedText = added === 1
                ? tr("1 plaats toegevoegd", "1 place added")
                : tr(`${added} plaatsen toegevoegd`, `${added} places added`);
              if (existing === 0) return `${addedText}.`;
              const existingText = existing === 1
                ? tr("1 stond er al in", "1 was already in it")
                : tr(`${existing} stonden er al in`, `${existing} were already in it`);
              return `${addedText}, ${existingText}.`;
            },
            onDownload: async () => {
              // Always this name, no project or timestamp: the file AFAS imports.
              triggerDownload(await downloadAfasPlaatsen(), "Data_Woonplaatsen.csv");
              return null;
            },
          }
        : undefined,
    [isAdmin, moduleId, placesToAdd]
  );

  /**
   * What stands above the dropzone on the landing: the offer to restore work an
   * interrupted session left in the browser, and whatever the intake has to report
   * about the file it is reading. Both when both apply — the slot stacks them — and
   * null when neither does, so the landing reserves no space for an empty strip.
   *
   * The offer is only ever built here, on the page with no sheet on it. There is no
   * second place a draft could be taken up: while a workbook is open the same storage
   * is being *written*, and a restore over it would be the tool discarding the file
   * the user is looking at.
   */
  const landingNotice =
    pendingDraft || intake.notice ? (
      <>
        {pendingDraft && (
          <DraftRestoreNotice
            fileName={pendingDraft.fileName}
            savedAt={pendingDraft.savedAt}
            editCount={pendingDraft.dirtyKeys.size}
            onRestore={() => restoreDraft(pendingDraft)}
            onDiscard={clearDraft}
          />
        )}
        {intake.notice}
      </>
    ) : null;

  /**
   * An admin's column repair (`ColumnRepairDialog`): ignore, rename or add columns, then
   * check the sheet again straight away — the repair exists to bring skipped checks
   * back, so the banner and the flags should answer for it at once rather than after
   * a *Hercontroleren*. The workbook is replaced rather than patched, so everything
   * keyed on it (the autosave's stored source, the table's widths) sees a new sheet.
   */
  const applyRepairs = useCallback(
    (repairs: ColumnRepair[], ignored: string[]) => {
      setRepairOpen(false);
      if (ignored.length > 0) setIgnoredColumns((prev) => [...prev, ...ignored]);
      if (repairs.length === 0 || !workbook || !sheet || !cellData) return;
      const repaired = applyColumnRepairs(moduleId, sheet, cellData, dirtyKeys, repairs);
      const sheets = workbook.sheets.map((s, i) =>
        i === committedSheetIndex ? repaired.sheet : s
      );
      const { cells, fixed, result: next } = checkSheet(
        moduleId,
        repaired.sheet,
        repaired.cellData,
        fills
      );
      setWorkbook({ ...workbook, sheets });
      setCellData(cells);
      setDirtyKeys(new Set([...repaired.dirtyKeys, ...fixed]));
      setResult(next);
      setResultStale(false);
    },
    [workbook, sheet, cellData, dirtyKeys, committedSheetIndex, moduleId, fills]
  );

  const handleCellChange = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      setCellData((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[rowIdx] = [...next[rowIdx]];
        next[rowIdx][colIdx] = value;
        return next;
      });
      // Existing results no longer reflect the edited grid until a recheck.
      setResultStale(true);
      // Update just this cell's dirty flag — no full-grid scan.
      setDirtyKeys((prev) => {
        const original = sheet ? cellToString(sheet.rows[rowIdx]?.[colIdx] ?? null) : "";
        const key = `${rowIdx}:${colIdx}`;
        const dirty = value !== original;
        if (dirty === prev.has(key)) return prev;
        const next = new Set(prev);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [sheet]
  );

  // With a sheet open the grid takes what padding it can spare: from `lg` 8px
  // around the table card instead of the shell's 16–24px — kept rather than
  // dropped, so the card still reads as one against the page. The landing keeps
  // the full padding; it has height to spare.
  const sheetOpen = Boolean(workbook && sheet);

  // Below `lg` this is the pane that scrolls: a phone can't hold the hero, the module
  // card and the dropzone — or the stacked toolbar and a table — in one screen, so
  // the page moves and the table card below takes a screen's height of its own.
  return (
    <div
      id="upload"
      className={`flex-1 min-h-0 flex w-full flex-col pb-6 max-lg:overflow-y-auto ${
        sheetOpen ? "lg:pb-2" : ""
      }`}
    >
      {/* The file input and the modals that resolve an incoming file */}
      {intake.elements}

      {/* The sheet's settings — the validatierapport and the admin tools */}
      {showConfig && (
        <SheetSettings
          onCancel={() => setShowConfig(false)}
          hasResult={result !== null}
          onReport={() => setReportOpen(true)}
          onRefreshCodetabellen={refreshTables}
          plaatsen={plaatsen}
        />
      )}

      {/* Module help, opened from the toolbar. Rendered here rather than inside
          the toolbar so its fixed overlay isn't trapped in the bar's stacking
          context. */}
      <ModuleHelpDrawer
        moduleId={moduleId}
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {/* Column repair, opened from the missing-column banner — admin only. */}
      {repairOpen && sheet && result && (
        <ColumnRepairDialog
          moduleId={moduleId}
          headers={sheet.headers}
          missing={missingColumns}
          onApply={applyRepairs}
          onClose={() => setRepairOpen(false)}
        />
      )}

      {/* Validation report, opened from the Instellingen modal (`SheetSettings`).
          Mounted only while open, so it slides in on mount and no report is
          built for a closed drawer. */}
      {reportOpen && report && (
        <ValidationReportDrawer report={report} onClose={() => setReportOpen(false)} />
      )}

      {/* Unsaved-changes guard before an in-app action that discards edits */}
      {discardAction && (
        <UnsavedChangesPrompt
          onSave={() => {
            const { run } = discardAction;
            saveAndDownload();
            setDiscardAction(null);
            run();
          }}
          onDiscard={() => {
            const { run } = discardAction;
            setDiscardAction(null);
            run();
          }}
          onCancel={() => setDiscardAction(null)}
        />
      )}

      {/* Leave guard before a link takes the open sheet off the screen */}
      {leaveToHref && workbook && (
        <LeaveModulePrompt
          fromLabel={moduleLabel}
          toLabel={destinationLabel(leaveToHref, projects)}
          fileName={workbook.fileName}
          saved={isSaved}
          onLeave={confirmLeave}
          onDiscard={discardLeave}
          onCancel={() => setLeaveToHref(null)}
        />
      )}

      {/* With a sheet open, its bar is a column beside the grid rather than a bar
          over it, so the grid gets the page's full height. Below `lg` the column
          goes above the sheet — a phone has no 320px to spare. */}
      <div
        className={`flex min-h-0 flex-1 transition-[gap] duration-200 ease-in-out max-lg:shrink-0 max-lg:flex-col max-lg:gap-3 ${
          focused && !sheetOpen ? "gap-0" : sheetOpen ? "gap-6 lg:gap-2" : "gap-6"
        }`}
      >
        {/* The sheet's bar, in a column of its own — and only with a sheet. It
            comes with the sheet it describes: before one, every action in it is one
            you can't take yet, and the page has exactly one move to offer instead
            (see `SheetToolbar` and `ModuleStartCard`). From `lg` it bleeds out of
            the page's padding so it meets the app sidebar, the top and the bottom,
            like a second sidebar. */}
        {workbook && sheet && (
          <section
            className={`flex w-80 min-h-0 shrink-0 flex-col rounded-2xl bg-k-bg shadow-raised max-lg:w-full lg:-mb-2 lg:-mt-4 lg:rounded-none lg:border-0 lg:border-r lg:border-k-divider lg:shadow-none ${
              focused ? "" : "lg:-ml-4"
            }`}
          >
              <SheetToolbar
                moduleLabel={moduleLabel}
                fileName={workbook.fileName}
                hasResult={result !== null}
                metrics={metrics}
                stale={resultStale}
                errorRowCount={errorRows.length}
                errorCellCount={errorCells.length}
                errorPosition={errorPosition >= 0 ? errorPosition : null}
                onPrevError={() => goToError(-1)}
                onNextError={() => goToError(1)}
                filterErrors={filterErrors}
                saveReady={saveReady}
                onRecheck={recheck}
                onSave={saveAndDownload}
                onUpload={() => guardUnsaved(intake.openFilePicker)}
                onToggleFilter={toggleErrorsOnly}
                onConfig={() => setShowConfig(true)}
                onHelp={() => setHelpOpen(true)}
                view={payloadPlan ? view : null}
                onViewChange={onViewChange}
                activity={view === "payloads" ? payloadActivity : null}
                payloadMetrics={view === "payloads" ? payloadMetrics : null}
              />
            <div className="min-h-0 flex-1 border-t border-k-divider bg-k-bg shadow-inset-sm max-lg:hidden" />
          </section>
        )}

        {/* With a sheet, 8px of the shell's top and right padding go to the grid
            (see `sheetOpen`); focus mode's right padding already is 8px. */}
        <div
          className={`flex min-w-0 flex-1 flex-col ${
            sheetOpen ? `lg:-mt-2 ${focused ? "" : "lg:-mr-2"}` : ""
          }`}
        >
          {/* The hero, in the same place as on the project page: at the top, above
              everything the page does. It goes as soon as a sheet arrives — from then on
              the page is the table, the bar belongs to it, and the heading would be
              holding the grid down for nothing. */}
          {!workbook && <Hero intro={<ModuleIntroCopy moduleId={moduleId} />} />}

          {/* Landing — the module's card and the dropzone, which takes the height the
              toolbar gave up. The help drawer above is this card's too: one drawer per
              module page, opened from whichever of the two is on screen. */}
          {!workbook && (
            <UploadLanding
              intro={
                <ModuleStartCard
                  moduleId={moduleId}
                  progress={storedProgress}
                  onHelp={() => setHelpOpen(true)}
                />
              }
              notice={landingNotice}
              showDropzone={!intake.resolving}
              onFile={(file) => guardUnsaved(() => intake.handleFile(file))}
              onOpen={() => guardUnsaved(intake.openFilePicker)}
            />
          )}

          {/* Reading a new file can fail with the old table still on screen —
              report it above the grid, under the bar. */}
          {workbook && intake.notice && (
            <div className="mb-4 shrink-0 space-y-3">{intake.notice}</div>
          )}

          {/* The AFAS bodies this sheet would send — the mapping and the grid put
              together, one payload per record. Admin-only by the tab that opens it
              (`SheetToolbar` wraps the switch in `AdminOnly`), and only for a module
              whose plan says how its rows reach a connector. It replaces the grid
              rather than sitting beside it: both are readings of the same sheet, and
              a page showing two of them at once has room for neither. Both views
              come in with `.view-enter` (globals.css), since each mounts fresh on
              the switch — a short fade rather than a hard cut between two layouts. */}
          {workbook && editedSheet && payloadPlan && view === "payloads" && (
            <ModulePayloadPanel
              plan={payloadPlan}
              sheet={editedSheet}
              issues={result?.byCell ?? EMPTY_ISSUES}
              moduleId={moduleId}
              moduleLabel={moduleLabel}
              onDownloadSheet={downloadMarkedSheet}
              onActivity={setPayloadActivity}
              onMetrics={setPayloadMetrics}
              step={step}
              className="view-enter"
            />
          )}

          {/* Parsed data */}
          {workbook && sheet && view === "data" && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDragging(false);
                }
              }}
              onDrop={onDrop}
              // Below `lg` a screen tall, less the top bar: scroll the toolbar away
              // and the table fills the phone, with its own scroll inside.
              className={`view-enter relative flex-1 min-h-0 flex flex-col rounded-2xl bg-k-bg shadow-raised transition-shadow duration-200 max-lg:h-[calc(100dvh-6rem)] max-lg:flex-none ${
                isDragging ? "ring-2 ring-k-cloud-light" : ""
              }`}
            >
              {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl bg-k-cloud-light/40">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-k-cloud-light/40 text-k-cloud-deep">
                    <Upload className="h-7 w-7" strokeWidth={1.5} />
                  </span>
                  <p className="text-base font-semibold text-k-cloud-deep">{t("Bestand loslaten om te vervangen", "Drop a file to replace it")}</p>
                </div>
              )}
              {/* No padding: the grid is the card, edge to edge. The notice
                  above it brings its own margin instead. */}
              <div className="min-h-0 flex-1 flex flex-col">
                <MissingColumnsNotice
                  columns={missingColumns}
                  onRepair={isAdmin ? () => setRepairOpen(true) : undefined}
                  className="m-5 mb-3 max-sm:m-2"
                />
                <DataTable
                  sheet={sheet}
                  cellData={cellData ?? []}
                  dirtyKeys={dirtyKeys}
                  issues={result?.byCell ?? EMPTY_ISSUES}
                  defaults={result?.defaults ?? EMPTY_DEFAULTS}
                  notices={result?.notices ?? EMPTY_NOTICES}
                  unlisted={result?.unlisted}
                  visibleRows={filterErrors ? errorRows : undefined}
                  focusCell={errorFocus}
                  pickerColumns={pickerColumns}
                  instructions={instructions}
                  onCellChange={handleCellChange}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
