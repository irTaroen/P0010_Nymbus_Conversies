"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  Check,
  CircleAlert,
  CloudUpload,
  Copy,
  Download,
  List,
  Loader2,
  Pencil,
  Plus,
  Send,
  Square,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { isNarrowScreen } from "@/lib/narrow-screen";
import { useProgress } from "@/components/ProgressProvider";
import { buildProgressUpdate, pushProgressToAfas } from "@/lib/progress-payload";
import {
  fetchUpdateSchema,
  payloadJson,
  type AfasUpdateSchema,
} from "@/lib/afas-schema";
import { clientMappingKey, fetchStoredMappings } from "@/lib/field-mapping";
import { fetchProjectUpdateSchema } from "@/lib/client-mapping";
import type { CustomModule } from "@/lib/custom-modules";
import { resolveStandardColumns } from "@/lib/standard-columns";
import CompactSearch from "@/components/CompactSearch";
import {
  fetchLookupTable,
  lookupId,
  type AfasLookup,
  type LookupState,
  type LookupTables,
} from "@/lib/afas-lookup";
import {
  buildModulePayloads,
  contextLookups,
  planMappingIds,
  type ModulePayload,
  type ModulePayloadPlan,
  type PayloadField,
  type VariantContext,
} from "@/lib/module-payloads";
import {
  SEND_STAGES,
  isDeleteRun,
  toDeleteRecord,
  toSendRecord,
  type SendAction,
  type SendResult,
  type SendStage,
  type SendEnvironment,
  fetchSendEnvironment,
  refusedValues,
  refusalIssues,
  missingIssues,
  fetchStepRuns,
  type SendOutcome,
  groupRefusals,
  groupMissing,
  refusalText,
  type RefusedValue,
} from "@/lib/payload-send";
import {
  useModuleSendRun,
  useSendRuns,
} from "@/components/SendRunProvider";
import {
  fetchExistingRecords,
  matchKey,
  normalizeKey,
  type ExistingMatch,
  type ExistingRecords,
} from "@/lib/existing-records";
import {
  applyFilters,
  isActive,
  matchesSearch,
  newFilter,
  type PayloadFilter,
} from "@/lib/payload-filter";
import type { ParsedSheet } from "@/lib/excel";
import type { Issue } from "@/lib/validation/types";
import Checkbox from "@/components/Checkbox";
import {
  AmberNotice,
  GreenNotice,
  NoticeCarousel,
} from "@/components/uploader/Notices";
import SendPayloadsDialog from "@/components/uploader/SendPayloadsDialog";
import DeleteRecordsDialog from "@/components/uploader/DeleteRecordsDialog";
import SendProgress from "@/components/uploader/SendProgress";
import RefusalsDialog from "@/components/uploader/RefusalsDialog";
import ToolbarButton from "@/components/uploader/ToolbarButton";
import { percentageOf, type MetricText } from "@/lib/validation/metrics";
import {
  buildSendReportPdf,
  downloadSendReportPdf,
  sendReportFileName,
  type SendReportContext,
  type SendReportStep,
} from "@/lib/send-report-pdf";
import PayloadFilterBar from "@/components/uploader/PayloadFilterBar";
import UpdateConnectorsDialog from "@/components/afas/UpdateConnectorsDialog";
import { AfasStageNotice, useAfasStageNotice } from "@/components/AfasConnection";
import {
  ModuleConversionSettingsNotice,
  useModuleConversionSettingsNotice,
} from "@/components/ConversionSettingsNotice";
import {
  buildPhaseOf,
  phasesOf,
  type ModulePhase,
  type PhaseId,
} from "@/lib/module-phases";
import { EMPTY_REPAIR, describeRepair, type RepairPlan } from "@/lib/repair-send";
import RepairChooser from "@/components/uploader/RepairChooser";
import { useCodetabellen } from "@/components/CodetabellenProvider";
import { useProject } from "@/components/ProjectProvider";
import { useModule } from "@/components/ModuleProvider";

/** The "nothing built yet" list, shared so it is the same object every render. */
const NO_PAYLOADS: ModulePayload[] = [];

/** One offerte a delete removes: its first record, and every row behind the key. */
interface DeleteGroup {
  payload: ModulePayload;
  /** The record's name in AFAS, off the existence read. */
  name: string;
  rows: number[];
}

/** "Nothing to delete", shared so the memo's empty answer is one object. */
const NO_DELETES: DeleteGroup[] = [];

/** Likewise for the picker's options before anything has been built. */
const NO_FIELDS: PayloadField[] = [];

/** The filter bar over the records is switched off for now, not removed: flip this
 *  to bring it back. With it hidden the filter state stays at its one empty row, so
 *  `applyFilters` passes every record and nothing else notices. */
const SHOW_PAYLOAD_FILTER = false;

/** What the panel is doing — one of three things, and each says so on screen. */
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; contexts: Map<string, VariantContext> };

/** A finished load, stamped with the plan it was made for. See `useVariantContexts`. */
type Fetched = (LoadState & { status: "error" | "ready" }) & { key: string };

/**
 * Everything a plan needs before a body can be written: each variant's stored
 * mapping, and the schema of the connector that mapping targets.
 *
 * The schemas come from the **`modules` group** — the template environment every
 * customer environment is a copy of, and the same environment the mapping was made
 * against (see the note above `CONNECTOR_GROUPS` in
 * [main.py](../../../backend/main.py)). Reading them from the project's own AFAS
 * would be asking a different question than the one the stored mapping answers.
 *
 * The one exception is a project with its **own copy** of a variant's mapping
 * (`mappings/clients/<projectId>/<mappingId>.json`, an *Afwijkende koppeling*): that
 * copy wins over the standard one, and its schema is read from the project's own
 * AFAS — the environment the copy was made against. That is the rule the copy exists
 * for: "this project's copy if there is one, the standard mapping otherwise".
 *
 * A variant whose mapping isn't stored yet is **left out rather than failing the
 * panel**: the other half of a split module still has bodies worth showing, and the
 * missing one is reported as its own notice. Only having nothing at all is an error.
 */
function useVariantContexts(
  plan: ModulePayloadPlan,
  reload: number,
  /** The project whose own copies take precedence over the standard mappings. */
  projectId: string,
  /**
   * Set for a **custom module** (maatwerk): its mapping only exists as a client
   * mapping of this project — the vrije velden it maps exist nowhere else — so there
   * is no standard one to fall back to.
   */
  clientOnly: boolean,
): LoadState {
  // The plan is a module-keyed constant, but a caller could still hand a fresh
  // object; the ids are what the fetch actually depends on, and what a finished one
  // is stamped with.
  //
  // `reload` is part of the key, not just an extra dependency, for the same reason
  // the plan's ids are: a result carrying the previous count is an answer about the
  // mapping as it was *before* the save, so stamping it that way makes the panel read
  // as loading until the new one lands — rather than showing bodies built from a
  // mapping that no longer exists while the refetch is in flight.
  const ids = planMappingIds(plan).join(",");
  const key = `${projectId}|${clientOnly ? "c" : "s"}|${ids}|r${reload}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { byModuleFile, clientMappings } = await fetchStoredMappings();
        const contexts = new Map<string, VariantContext>();
        // Sequential rather than parallel: two variants means two connectors, and
        // AFAS's metainfo endpoint is the slow, rate-limited kind. Two calls in a
        // row is a moment; hammering it per variant is a habit worth not starting.
        for (const id of ids.split(",")) {
          const own = clientMappings[clientMappingKey(projectId, id)];
          const mapping = own ?? (clientOnly ? undefined : byModuleFile[id]);
          if (!mapping) continue;
          const schema: AfasUpdateSchema = own
            ? (await fetchProjectUpdateSchema(projectId, id)).schema
            : await fetchUpdateSchema("modules", mapping.connector);
          contexts.set(id, { mapping, schema, client: own !== undefined });
        }
        if (cancelled) return;
        setFetched(
          contexts.size === 0
            ? {
                key,
                status: "error",
                message: clientOnly
                  ? "Deze maatwerkmodule heeft nog geen koppeling. Maak er een met de knop hieronder — de velden komen uit de eigen AFAS-omgeving van dit project."
                  : "Voor deze module is nog geen koppeling opgeslagen. Maak er een op /afas/updateconnectors.",
              }
            : { key, status: "ready", contexts },
        );
      } catch (error) {
        if (cancelled) return;
        setFetched({
          key,
          status: "error",
          message:
            error instanceof ApiError
              ? error.message
              : "De payloads konden niet worden opgebouwd.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ids, key, projectId, clientOnly]);

  // Loading is **derived**, not a state the effect writes: a result stamped with
  // another plan's key is by definition not this plan's answer, so it reads as
  // loading without anything having to reset it first. Same shape as
  // [`ModuleFilesPanel`](./ModuleFilesPanel.tsx), and it is what keeps a synchronous
  // setState out of the effect body (the React Compiler forbids it).
  return fetched?.key === key ? fetched : { status: "loading" };
}

/**
 * What a send does with records AFAS already holds.
 *
 * `new` is the default because it is the safe half of the choice: it can add records
 * but can never change one that is already there. `all` sends both — inserting the
 * new and **updating** the existing (PUT), which is what "overschrijven" actually
 * means to AFAS. `repair` (*Herstellen*) sends **only** the existing ones, each as a
 * PUT carrying just the objects the admin chose, with the `@Action` chosen for each
 * ([`repair-send.ts`](../../lib/repair-send.ts)).
 */
type SendMode = "new" | "all" | "repair";

/**
 * Which records this mode would actually send, given their marks.
 *
 * A record the **phase** skips is never sent, whatever the mode or the tick: a
 * medewerker whose contract ended before livegang has no second contract to write,
 * and a tick is the admin saying "include this record", not "override the reason it
 * doesn't apply". It is still on screen with its reason — see `ModulePayload.skipped`.
 *
 * A phase whose verb is `update` also sends **only** updates: its premise is that
 * phase 1 already created the employee, so an insert here would be a second
 * employee under the same code rather than a later record on the existing one.
 * A custom module (maatwerk) is the same case, one step further on — `updateOnly`.
 *
 * A record whose rows fail the module's **validation** is never sent either — the
 * sheet's own verdict that the data is not ready, and the same rule the progress
 * badge counts by ("rijen zonder fouten"). Fixing the cells and checking again is
 * what puts it back, not a tick.
 */
function recordsFor(
  mode: SendMode,
  chosen: ModulePayload[],
  matchOf: (payload: ModulePayload) => ExistingMatch,
  updateOnly: boolean,
  invalid: ReadonlyMap<number, number>,
): { payload: ModulePayload; action: SendAction }[] {
  return chosen.flatMap(
    (payload): { payload: ModulePayload; action: SendAction }[] => {
      if (payload.skipped !== null) return [];
      // A looked-up field without an answer: the body would carry `null` where AFAS
      // expects a relation number, and no mode or tick changes that.
      if (payload.blocked !== null) return [];
      if (invalid.has(payload.ordinal)) return [];
      const { state } = matchOf(payload);
      // A repair is an update of a record AFAS holds, by definition — one it can't
      // be sure of is not repaired, it is left for a plain send.
      if (mode === "repair") {
        return state === "exists" ? [{ payload, action: "update" }] : [];
      }
      if (updateOnly) return [{ payload, action: "update" }];
      // `unknown` — no read, a failed one, or a blank key column — is sent as an
      // insert in both modes: it is exactly what the panel did before existence
      // checking, and an update needs a key we are sure of.
      if (state !== "exists") return [{ payload, action: "insert" }];
      return mode === "all" ? [{ payload, action: "update" }] : [];
    },
  );
}

/**
 * The plan a custom module builds with: its own mapping as the only variant, and
 * its parent's existence key — the records it updates are the parent's, so *Bestaat
 * al* is the parent's question and the send re-checks against the parent's lookup.
 */
function customPlan(plan: ModulePayloadPlan, custom: CustomModule): ModulePayloadPlan {
  return {
    discriminatorColumn: null,
    variants: [{ mappingId: custom.id, label: custom.label, match: [] }],
    existing: plan.existing,
  };
}

/**
 * The keys the project's AFAS already holds for this module, per environment.
 *
 * Re-read whenever the **stage** switch moves, because that is the whole question:
 * a record in test says nothing about live. A module with no `existing` plan never
 * fetches at all.
 *
 * A failure is a state, not a throw: the `CON_ERP_*` / `CON_HRM_*` connector may not be on this
 * customer's app connector yet, and the panel must then fall back to marking nothing
 * rather than treating "could not ask" as "nothing exists" — which would mark every
 * record new and invite a duplicate insert of the whole sheet.
 *
 * `refresh` re-reads without changing the key: a finished send has just changed the
 * answer, so the panel passes that run's id and the list re-marks itself. The
 * previous answer stays on screen until the new one lands — it is the same
 * environment, only older, and blanking every badge for a round trip would read as
 * the check having failed.
 */
function useExistingRecords(
  projectId: string,
  moduleId: string,
  stage: SendStage,
  enabled: boolean,
  refresh: string,
): { data: ExistingRecords | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{
    key: string;
    data: ExistingRecords | null;
    error: string | null;
  } | null>(null);
  const key = `${projectId}:${moduleId}:${stage}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchExistingRecords(projectId, moduleId, stage);
        if (!cancelled) setState({ key, data, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({
          key,
          data: null,
          error:
            error instanceof ApiError || error instanceof Error
              ? error.message
              : "De bestaande records konden niet worden opgevraagd.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `refresh` is not read in the body: it is the signal to ask again.
  }, [projectId, moduleId, stage, enabled, key, refresh]);

  if (!enabled) return { data: null, loading: false, error: null };
  // A stamped result that isn't for the current key is a previous environment's
  // answer; showing it against the new stage would be worse than showing nothing.
  if (state?.key !== key) return { data: null, loading: true, error: null };
  return { data: state.data, loading: false, error: state.error };
}

/** No lookups to load — shared, so the hook's key stays stable. */
const NO_LOOKUP_SPECS: AfasLookup[] = [];

/**
 * The AFAS tables this module's looked-up fields read (`FieldSource.lookup`), from
 * the project's own environment at the **stage the switch points at** — test and
 * live hold different relation numbers, so a switch re-reads, and a table stamped
 * with the other stage is never used.
 *
 * Every lookup has a state from the first render (`loading` until it lands), so a
 * record built before its table arrives is `blocked` rather than sent with a gap;
 * the build re-runs when the map changes. A failure is a state too — the records
 * that need it stay blocked and the panel says why.
 */
function useLookupTables(
  projectId: string,
  stage: SendStage,
  lookups: AfasLookup[],
  enabled: boolean,
): { tables: LookupTables; loading: boolean } {
  const ids = lookups.map(lookupId).join(",");
  const key = `${projectId}:${stage}:${ids}`;
  const [fetched, setFetched] = useState<{
    key: string;
    tables: Map<string, LookupState>;
  } | null>(null);

  useEffect(() => {
    if (!enabled || lookups.length === 0) return;
    let cancelled = false;
    (async () => {
      const tables = new Map<string, LookupState>();
      // One after the other, like every other AFAS read here: AFAS rate-limits,
      // and a module has one or two lookups at most.
      for (const lookup of lookups) {
        try {
          const table = await fetchLookupTable(projectId, stage, lookup);
          tables.set(lookupId(lookup), { status: "ready", table });
        } catch (error) {
          tables.set(lookupId(lookup), {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : `${lookup.connector} kon niet worden opgevraagd.`,
          });
        }
        if (cancelled) return;
      }
      if (!cancelled) setFetched({ key, tables });
    })();
    return () => {
      cancelled = true;
    };
    // `lookups` is read through `key`, which carries its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, stage, key, enabled]);

  return useMemo(() => {
    if (fetched?.key === key) return { tables: fetched.tables, loading: false };
    // Not loaded for this stage yet — or not allowed to load (no credentials for
    // it): every lookup reads as unanswered, so its records are blocked.
    const pending = new Map<string, LookupState>(
      lookups.map((lookup) => [
        lookupId(lookup),
        enabled
          ? { status: "loading" }
          : {
              status: "error",
              message: "Voor deze omgeving zijn geen AFAS-inloggegevens opgeslagen.",
            },
      ]),
    );
    return { tables: pending, loading: enabled && lookups.length > 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, key, enabled]);
}

/**
 * Which AFAS the stage switch is currently pointing at — the number and the host.
 *
 * Read for its own sake rather than taken off something else, because the one place
 * it has to be right is the confirmation dialog, and both of the sources that used
 * to supply it are absent exactly there. The previous send's result only exists
 * after a send, so the first one of a session — the one nobody has confirmed
 * anything about yet — could not name its target; and the existence read only runs
 * for the six modules that have a `CON_*` lookup, so the other eight never could.
 *
 * Re-read when the stage moves, like the existence read above and for the same
 * reason: the two stages are two hosts, and showing one while the switch says the
 * other is the single mistake this whole dialog exists to prevent.
 *
 * A failure is a state, not a throw. The dialog then names the stage without the
 * number instead of refusing to open — a send that can't be confirmed because a
 * label lookup failed would be worse than one confirmed with less detail.
 */
function useSendEnvironment(
  projectId: string,
  stage: SendStage,
): { data: SendEnvironment | null; loading: boolean } {
  const [state, setState] = useState<{
    key: string;
    data: SendEnvironment | null;
  } | null>(null);
  const key = `${projectId}:${stage}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchSendEnvironment(projectId, stage);
        if (!cancelled) setState({ key, data });
      } catch {
        // Named without its number rather than not at all — see above.
        if (!cancelled) setState({ key, data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, stage, key]);

  // An answer stamped with another key belongs to the stage the switch just left.
  if (state?.key !== key) return { data: null, loading: true };
  return { data: state.data, loading: false };
}

/** The mark beside a record: what AFAS already has, as an icon-only square — the
 *  word (*Nieuw* / *Bestaat al*) is on the tooltip and the accessible name, since
 *  a 288px row has to keep room for the record's own title. */
function ExistingBadge({ match }: { match: ExistingMatch }) {
  if (match.state === "unknown") return null;
  const exists = match.state === "exists";
  const label = exists
    ? match.name
      ? `Bestaat al in AFAS als: ${match.name}`
      : "Bestaat al in AFAS"
    : "Nieuw in AFAS";
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full shadow-inset-sm ${
        exists
          ? "bg-k-amber-bg text-k-amber-fg"
          : "bg-k-green-bg text-k-green-fg"
      }`}
    >
      {exists ? (
        <Pencil className="h-2.5 w-2.5" strokeWidth={2.4} />
      ) : (
        <Plus className="h-2.5 w-2.5" strokeWidth={2.4} />
      )}
    </span>
  );
}

/**
 * The record list on the left — one row per body, in sheet order, each with the tick
 * box that decides whether it is sent.
 *
 * **The tick box and the row are two controls in one row**, and deliberately so: the
 * question "which records go" and the question "what does this one look like" are
 * asked at the same moment and would otherwise fight over the same click. The box
 * selects; the rest of the row opens the body on the right. A `<label>` around the
 * box gives it the hit area a bare 16px checkbox doesn't have, without swallowing
 * the row's own click.
 */
/** The verdict of a record nothing has been said about yet — one object, so a
 *  memoised row sees the same one each render. */
const UNKNOWN_MATCH: ExistingMatch = { state: "unknown", key: "", name: "" };

/**
 * What the selection knows a record by: its first sheet row. Unique, since a row
 * goes to one record, and — unlike the ordinal — the same in every phase.
 */
function recordRow(payload: ModulePayload): number {
  return payload.rowNumbers[0] ?? payload.ordinal;
}

/**
 * One record in the rail. Memoised: the rail holds every record of the sheet (288
 * at the first customer), and a keystroke in the search or a click on another record
 * used to re-render each of them. The parent hands it stable callbacks that take the
 * row's own `index`/`ordinal`, and a badge that only changes when its verdict does.
 */
const RecordRow = memo(function RecordRow({
  payload,
  index,
  active,
  selected,
  result,
  sent,
  match,
  errors,
  skipped,
  onSelect,
  onToggle,
}: {
  payload: ModulePayload;
  active: boolean;
  selected: boolean;
  /** What AFAS said about this record in the last run, if it was in one. */
  result: SendResult | undefined;
  /** For a refusal: the values sent for the fields AFAS named in it. */
  sent: RefusedValue[] | undefined;
  /** Whether AFAS already holds this record — the badge under the title. */
  match: ExistingMatch;
  /** How many validation errors the record's rows carry — `0` for a clean one. */
  errors: number;
  /**
   * Ticked, but it will not be sent — either this mode leaves it out (an existing
   * record in *Alleen nieuwe*) or the **phase** does (a contract that ended before
   * livegang).
   *
   * Dimmed rather than unticked: the tick is the admin's choice and stays theirs.
   * A phase skip also carries its reason as a badge, since that one is a fact about
   * the record rather than about the switch above it.
   */
  skipped: boolean;
  /** This record's place in the rail, handed back to `onSelect`. */
  index: number;
  onSelect: (index: number) => void;
  /** Handed the record's {@link recordRow}, which is what the selection is kept by. */
  onToggle: (row: number) => void;
}) {
  const rows = payload.rowNumbers;
  const rowLabel =
    rows.length > 1
      ? `rij ${rows[0]}–${rows[rows.length - 1]}`
      : `rij ${rows[0]}`;
  return (
    <div
      className={`flex items-start gap-1 rounded-xl transition-[box-shadow,background-color] duration-200 ${
        active ? "bg-k-cloud-light/40 shadow-inset-sm" : "hover:bg-k-tint"
      }`}
    >
      {/* Top-aligned with the title line, not centred on the two-line row: the box
          belongs to the record's name, and the badges under it are its footnotes. */}
      <label
        className="flex cursor-pointer items-start self-stretch pt-[0.6rem] pb-2 pl-2.5 pr-0.5 pointer-coarse:pl-3.5 pointer-coarse:pr-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onChange={() => onToggle(recordRow(payload))}
          aria-label={`${payload.title || "(leeg)"} meesturen`}
        />
      </label>
      {/* Below `lg` there is no body beside the list to open, so the row ticks
          the record instead — the one question a phone asks of it. */}
      <button
        type="button"
        onClick={() => (isNarrowScreen() ? onToggle(recordRow(payload)) : onSelect(index))}
        aria-pressed={active}
        className={`flex min-w-0 flex-1 cursor-pointer flex-col gap-1 py-2 pr-3 text-left ${
          active ? "text-k-cloud-deep" : "text-k-text-secondary"
        } ${skipped ? "opacity-45" : ""}`}
      >
        {/* Two lines per record. The rail is 288px, and on one line the badges and
            row numbers left the identifier — the thing the list is scanned for —
            five characters. So the title gets the first line to itself (sharing it
            only with the verdict of the last run) and the badges drop to the second. */}
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Fixed-width number column, right-aligned, so every title starts at the
              same x and the badge line under it lines up down the list. */}
          <span className="w-6 shrink-0 text-right text-xs tabular-nums opacity-70">
            {payload.ordinal}
          </span>
          <span
            title={payload.title || undefined}
            className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums"
          >
            {payload.title || "(leeg)"}
          </span>
          {/* The outcome of the last run, as a mark rather than a sentence: the
              reason lives in the results list under the toolbar, and a row this
              narrow can carry the verdict but not the explanation. */}
          {result &&
            (result.ok ? (
              <Check
                className="h-3.5 w-3.5 shrink-0 text-k-green-fg"
                strokeWidth={2.4}
                aria-label={
                  result.action === "delete"
                    ? "Uit AFAS verwijderd"
                    : "Door AFAS verwerkt"
                }
              />
            ) : (
              // The reason on hover — grouped with the other refusals in the
              // notice above the list, and in the verzendrapport.
              <span title={refusalText(result, sent)} className="shrink-0">
                <X
                  className="h-3.5 w-3.5 text-k-red-fg"
                  strokeWidth={2.4}
                  aria-label={`Door AFAS geweigerd: ${result.message}`}
                />
              </span>
            ))}
        </span>
        {/* Indented past the number column (w-6 + gap-1.5) so the badges sit under
            the title they describe. */}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[1.875rem]">
          <span
            title={payload.variant.label}
            className="shrink-0 rounded-full bg-k-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-text-secondary shadow-inset-sm"
          >
            {payload.variant.short ?? payload.variant.label}
          </span>
          <ExistingBadge match={match} />
          {/* Why this record is out of the phase, on the row itself — the count in
              the notice says how many, and this says which. Amber rather than the
              neutral grey of the variant badge: it is a reason the record will not
              be sent, which is worth noticing while scrolling past it. */}
          {payload.skipped !== null && (
            <span
              title={payload.skipped}
              className="shrink-0 rounded-full bg-k-amber-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-amber-fg shadow-inset-sm"
            >
              Niet in stap
            </span>
          )}
          {/* A looked-up field with no answer in this environment — red rather than
              amber: not a choice anything made, but a value that is missing. */}
          {payload.blocked !== null && (
            <span
              title={payload.blocked}
              className="shrink-0 rounded-full bg-k-red-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-red-fg shadow-inset-sm"
            >
              Niet gevonden
            </span>
          )}
          {/* The sheet's own check failed on one of this record's rows — red for the
              same reason: data that is wrong, not a choice anything made. */}
          {errors > 0 && (
            <span
              title={`${errors} ${
                errors === 1 ? "fout" : "fouten"
              } bij de controle — pas de cellen aan en controleer opnieuw`}
              className="shrink-0 rounded-full bg-k-red-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-red-fg shadow-inset-sm"
            >
              Fouten
            </span>
          )}
          <span className="ml-auto shrink-0 whitespace-nowrap text-right text-xs tabular-nums opacity-70">
            {rowLabel}
          </span>
        </span>
      </button>
    </div>
  );
});

/**
 * What a settled run hands a workflow action as its attachments — the very files
 * the refusal notice's *Download* gives: the verzendrapport, and the cells of the
 * sheet to tint, refused and held back alike (empty when the run marks none).
 * `ExcelUploader` writes the sheet itself, since the file and its edits live there.
 */
export interface RunAttachments {
  pdf: { blob: Blob; fileName: string };
  sheetIssues: Map<string, Issue[]>;
}

/**
 * *Payloads* — every body this sheet would send to AFAS, one per record, built by
 * running the module's stored mapping over the rows on screen, and the place those
 * bodies are actually sent from.
 *
 * It is the mapping and the sheet put together: what is on screen is what leaves the
 * browser (`payloadBody()` parses back the very lines that are rendered), which is
 * what makes a send button defensible here at all. The environment switch and the
 * per-record tick boxes are the two things that decide what a press means — which
 * AFAS, and which records — so both sit above and beside the list rather than inside
 * the dialog that confirms it.
 *
 * Admin-only by placement — [`SheetToolbar`](./SheetToolbar.tsx) wraps the tab that
 * opens it in `AdminOnly`, and every endpoint behind it (`/api/afas/mappings`, the
 * connector schemas, and the send itself) is admin-checked on the backend regardless.
 */
export default function ModulePayloadPanel({
  plan,
  sheet,
  issues,
  moduleId,
  moduleLabel,
  onDownloadSheet,
  onRunAttachments,
  onActivity,
  onMetrics,
  step: requestedStep = null,
  className = "",
}: {
  plan: ModulePayloadPlan;
  /** The sheet as it stands on screen, edits included. */
  sheet: ParsedSheet;
  /**
   * The last validation run's issues, `"row:col"` by grid row — what marks a record
   * *Fouten* and keeps it out of the send. From the uploader, which owns the run.
   */
  issues: ReadonlyMap<string, Issue[]>;
  /** The app module id (`erp-debiteuren`) — what a send is recorded against. */
  moduleId: string;
  moduleLabel: string;
  /** Writes the uploaded sheet with these cells tinted red — the uploader's own
   *  download, handed in because the file and its edits live there. */
  onDownloadSheet?: (issues: Map<string, Issue[]>) => Promise<void>;
  /**
   * Hands the uploader a builder of {@link RunAttachments} while a settled run has
   * something to report (the refusal notice is up), and `null` once it hasn't — so a
   * workflow action's *Excel-bestand* and *PDF-rapport* attach what *Download*
   * gives rather than the validation's files, which say nothing about a refusal.
   */
  onRunAttachments?: (build: (() => Promise<RunAttachments | null>) | null) => void;
  /** Short-lived background work this panel is doing (*Bestaande records …
   *  opzoeken…*), or `null` — shown by the uploader in the toolbar's metrics row
   *  instead of above the list, where it pushed everything down on each switch. */
  onActivity?: (text: string | null) => void;
  /**
   * The record counts — how much of the sheet AFAS already holds, how many are
   * ticked, how many repair mode hides, how many errors keep out — as the figures the toolbar shows **in place of** the
   * validation's while this view is open, or `null` on the way out. In the bar
   * rather than above the list: they are this view's headline, and the rail is
   * 288px, where the environment's name alone wrapped to two lines.
   */
  onMetrics?: (metrics: MetricText[] | null) => void;
  /**
   * The custom module (maatwerk) the URL names (`?stap=`) — how the sidebar's
   * *Maatwerk* entry opens this panel as **that module**: its own mapping, its own
   * send, and none of the parent's phases on screen.
   */
  step?: string | null;
  className?: string;
}) {
  /**
   * Bumped when the mapping dialog closes after a save — the payload bodies below
   * are built from that mapping, so they have to be rebuilt from the stored one
   * rather than the copy fetched when this panel mounted. A counter rather than a
   * boolean: two saves in a row are two reloads, and a flag that is already `true`
   * would make the second one a no-op.
   */
  const [mappingReload, setMappingReload] = useState(0);
  // The project a send goes to, and what the explorer's "terug" arrow comes back to
  // rather than reopening the project picker — see `updateConnectorsPath`.
  const { selectedProject } = useProject();

  /**
   * A **custom module** (maatwerk) this panel is showing instead of the module
   * itself, or `null`. It is its own thing: the sidebar opens it by URL, and the
   * parent's phases are not offered beside it — it only borrows the parent's sheet.
   * See [`custom-modules.ts`](../../lib/custom-modules.ts).
   */
  const { customModules, refreshCustomModules } = useModule();
  const custom: CustomModule | null = requestedStep
    ? (customModules.find(
        (entry) => entry.id === requestedStep && entry.parentModuleId === moduleId,
      ) ?? null)
    : null;

  /**
   * Which call of a multi-step module is on screen
   * ([`module-phases.ts`](../../lib/module-phases.ts)) — `null` for the modules that
   * are one body and one send, which is all but Medewerkers, and always `null` on a
   * custom module.
   *
   * It is the **first** phase until somebody switches, never the last one they were
   * on: the phases run in order, and opening a sheet on *Livegang* would offer to
   * update employees the environment has not been given yet.
   */
  const phases = useMemo(
    () => (custom ? null : phasesOf(moduleId)),
    [custom, moduleId],
  );
  const [phaseId, setPhaseId] = useState<PhaseId | null>(
    () => phasesOf(moduleId)?.[0]?.id ?? null,
  );
  const phase: ModulePhase | null = useMemo(
    () => phases?.find((entry) => entry.id === phaseId) ?? phases?.[0] ?? null,
    [phases, phaseId],
  );
  /**
   * The phase the **build** gets: the one on screen, or for a one-call module with
   * standing overrides (the debiteur's derived bank fields) an implicit one carrying
   * just those. Never shown — `phase` stays what the toggle and the send label read.
   */
  const buildPhase = useMemo(
    () => (custom ? phase : buildPhaseOf(moduleId, phase)),
    [custom, moduleId, phase],
  );
  /** The plan the bodies are built from — a custom module's own, or the module's. */
  const activePlan = useMemo(
    () => (custom ? customPlan(plan, custom) : plan),
    [plan, custom],
  );
  /**
   * What a send is recorded against. A custom module is its **own** run: it goes to
   * the backend under its own id (which is how the send knows to allow only updates,
   * to its own connector), and its progress must not be mistaken for the parent's.
   */
  const runModuleId = custom?.id ?? moduleId;
  const state = useVariantContexts(
    activePlan,
    mappingReload,
    selectedProject.id,
    custom !== null,
  );
  // Always the `mapped` scope: only the fields the mapping fills, which is also the
  // body the send posts. The whole connector shape (`all`) would put typed
  // placeholders into AFAS as if they were data, so this view never offers it.
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  /** The pending reset of {@link copied}, so a second copy restarts it. */
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    []
  );
  /**
   * The mapping open in the dialog, or `null` when none is — the **mapping id**, not
   * the connector: a split module's two halves share one connector and have a file
   * each, so the connector alone would open whichever of them sorts first.
   */
  const [mappingOpen, setMappingOpen] = useState<string | null>(null);

  // --- Sending ---------------------------------------------------------------
  // Test by default, and never inherited from anywhere: live has to be picked, on
  // this screen, in view of the record count it applies to.
  const [stage, setStage] = useState<SendStage>("test");
  /** The records **left out** of the send, by {@link recordRow} — absent = selected.
   *  By sheet row rather than ordinal, so the ticks survive a phase switch: the
   *  phases build the same records from the same rows, but a phase that drops an
   *  object can drop a variant with it and renumber everything after. */
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * The run, and everything about it, lives in `SendRunProvider` — a send is a
   * background job that keeps going while this panel is closed, so its state cannot
   * be owned by a component that unmounts on a tab switch.
   *
   * `outcome` is therefore whatever this module has going or last finished, polled
   * from the backend. `starting` is only the moment between the press and the
   * backend accepting the run — a second or two — and `running` is the minutes
   * after that: once the run is accepted the progress strip takes over, because
   * from then on there is something better to show than a spinner.
   */
  const {
    start: startRun,
    startDelete,
    stop: stopRun,
    clear: clearRun,
  } = useSendRuns();
  const outcome = useModuleSendRun(runModuleId);
  const running = outcome?.status === "running";
  /** Asked to stop, and the record in flight has not answered yet. Read off the
   *  run rather than held here, so a reopened panel still shows it. */
  const stopping = running && outcome?.stopRequested === true;
  const [stopPressed, setStopPressed] = useState(false);
  const requestStop = async () => {
    setStopPressed(true);
    setSendError(null);
    try {
      await stopRun(runModuleId);
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "De verzending kon niet worden gestopt.",
      );
    } finally {
      setStopPressed(false);
    }
  };
  const [starting, setStarting] = useState(false);
  /** The delete confirmation, and the moment between its press and the backend
   *  accepting the run — the delete's own `confirmOpen`/`starting`. */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Why the backend refused the delete — shown **in the dialog**, which stays
   *  open: a refusal closed into the notice carousel lands on a page nobody is
   *  looking at, and the press reads as having done nothing. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  /** *Voortgang naar AFAS sturen* on its way, and what came of it — a notice in
   *  the carousel below, like a send's. */
  const [progressPushing, setProgressPushing] = useState(false);
  const [progressNote, setProgressNote] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const { refresh: refreshProgress } = useProgress();
  /** Whether the dialog listing every refused record is open. */
  const [refusalsOpen, setRefusalsOpen] = useState(false);
  /** Headings of the user's own for refusal groups, keyed by AFAS's message —
   *  what the verzendrapport prints instead (`RefusalsDialog`). Per run: a
   *  generic *AFAS gaf een fout terug (500).* means something else next time. */
  const [refusalHeadings, setRefusalHeadings] = useState(
    () => new Map<string, string>(),
  );
  const [headingsRun, setHeadingsRun] = useState(outcome?.runId);
  if (headingsRun !== outcome?.runId) {
    setHeadingsRun(outcome?.runId);
    setRefusalHeadings(new Map());
  }
  /** The verzendrapport being drawn — jsPDF is loaded on the first press. */
  const [reporting, setReporting] = useState(false);
  /** The sheet with the refused cells marked, being written — ExcelJS loads on
   *  the first press. */
  const [marking, setMarking] = useState(false);
  /** What to do with records AFAS already has. `new` — the safe half — by default:
   *  it can add but never change, so updating what is already there (`all`, the
   *  toolbar toggle switched off) is the option a person picks. */
  const [mode, setMode] = useState<SendMode>("new");
  /** What a *Herstellen* send does per object. Starts with nothing but the root, so
   *  every object that changes is one the admin chose. */
  const [repair, setRepair] = useState<RepairPlan>(EMPTY_REPAIR);
  /** Whether the records that will not go because of errors — the sheet's
   *  validation, or a lookup without an answer — are **taken off the list** rather
   *  than shown dimmed. Off by default: dimmed says which ones and why, and hiding
   *  is the step for when the question has become "what does go". */
  const [hideFaulty, setHideFaulty] = useState(false);
  /**
   * Switching phase clears the module's finished run: both phases send under the same
   * module id, and last run's results describe a set of bodies that no longer exists.
   */
  const switchPhase = useCallback(
    (next: PhaseId) => {
      setPhaseId(next);
      // Drops a *finished* run only — `clear` refuses one still going, and the
      // guard on the phase toggle below keeps it from being reached mid-send.
      clearRun(moduleId);
    },
    [clearRun, moduleId],
  );

  /**
   * A phase switch — or moving between the module and a custom module — rebuilds
   * every payload, so what was chosen against the last bodies has to go with it.
   *
   * Except the **selection** on a phase switch: *Historie* and *Actueel* are the same
   * medewerkers from the same rows, and the admin who ticked five to try in test
   * means those five in both steps. So the ticks (kept by row) and the open record
   * stay; only moving to or from a custom module — another connector, another
   * question — starts the list over.
   *
   * Reset **during render**, against the view last seen, rather than in an effect or
   * in the click handler: a custom module arrives by URL (the sidebar), which no
   * handler here sees, and an effect would clear one render *after* the new list
   * appeared — for a frame the old step's ticks over the new step's records.
   */
  const activeStepId = custom?.id ?? phase?.id ?? null;
  const [seenStepId, setSeenStepId] = useState(activeStepId);
  const [seenCustomId, setSeenCustomId] = useState(custom?.id ?? null);
  if (seenStepId !== activeStepId) {
    setSeenStepId(activeStepId);
    // Another step carries other objects (phase 2 has no `KnPerson`), so a repair
    // chosen against the last one would describe objects that are not there.
    setRepair(EMPTY_REPAIR);
    setSendError(null);
    if (seenCustomId !== (custom?.id ?? null)) {
      setSeenCustomId(custom?.id ?? null);
      setExcluded(new Set());
      setSelected(0);
    }
  }
  /** The conditions narrowing the list — one blank row to start, so the bar always
   *  has a field picker on it rather than only a button that produces one. */
  const [filters, setFilters] = useState<PayloadFilter[]>(() => [newFilter()]);
  /** The free-text search over the record list — every field at once. */
  const [search, setSearch] = useState("");

  /**
   * Whether the stage the switch is pointing at has credentials stored at all.
   *
   * This is the **cause** of everything else on this screen that would otherwise
   * complain about AFAS: with no client id or secret for this environment, the
   * existence read fails, and it fails with AFAS's own wording about an
   * environment that is *niet compleet ingesteld* — a symptom that reads like an
   * outage. So it is checked here, before the read is even asked for, and the
   * notice it drives replaces those downstream messages rather than joining them.
   *
   * Per stage, not per project: test set up and live empty is the normal way to
   * be half configured, and it is exactly the difference the switch above makes.
   *
   * `false` also while the **settings store** is unreachable, since the flag has no
   * third value — and that is the right behaviour here even though it is the wrong
   * *sentence*: the backend can't read those credentials either, so the existence
   * read would fail whatever this said, and skipping it still saves the round trip.
   * Only the wording has to know the difference, and `AfasStageNotice` gets it from
   * `afasConnection` rather than from this flag.
   */
  const stageConfigured = selectedProject.afasStages[stage];

  /* Whether the two self-gating notices below have anything to say, asked before
     they are built: `NoticeCarousel` can only count the items it is handed, and a
     React element is truthy even when the component behind it returns `null` — so
     an unasked notice would claim a page of its own and the counter would promise
     a band that renders empty. Each predicate ships with its notice, so the
     condition is never a copy that can drift from the one the component applies. */
  const hasConversionSettingsNotice = useModuleConversionSettingsNotice(
    selectedProject,
    moduleId,
  );
  const hasStageNotice = useAfasStageNotice(selectedProject, stage);

  // Which AFAS this stage points at, for the confirmation dialog — fetched whatever
  // the module is and before any send, which is exactly when the dialog needs it.
  const { data: sendEnvironment } = useSendEnvironment(
    selectedProject.id,
    stage,
  );

  // Which records this environment already holds. Only asked when the module's plan
  // says how to recognise one, and never when this stage has no credentials — the
  // call would spend a round trip to come back with a failure we can already name.
  const {
    data: existing,
    loading: existingLoading,
    error: existingError,
  } = useExistingRecords(
    selectedProject.id,
    moduleId,
    stage,
    Boolean(plan.existing) && stageConfigured,
    // The last run against this stage, once it has finished: what it wrote is now
    // in AFAS, so the marks are re-read rather than left describing the environment
    // as it was before the press.
    outcome && outcome.status !== "running" && outcome.stage === stage
      ? outcome.runId
      : "",
  );

  // The AFAS tables the mappings' looked-up fields read — none for most modules.
  const lookupSpecs = useMemo(
    () =>
      state.status === "ready" ? contextLookups(state.contexts) : NO_LOOKUP_SPECS,
    [state],
  );
  const { tables: lookupTables, loading: lookupsLoading } = useLookupTables(
    selectedProject.id,
    stage,
    lookupSpecs,
    stageConfigured,
  );

  // Progress, not a finding, and over within a second: reported up to the toolbar's
  // metrics row rather than drawn above the list, where it shifted the whole panel
  // down and back on every environment switch.
  const activity =
    plan.existing && stageConfigured && existingLoading
      ? `Bestaande records in ${
          stage === "live" ? "de live-omgeving" : "de testomgeving"
        } opzoeken…`
      : lookupsLoading
        ? `${lookupSpecs.map((lookup) => lookup.connector).join(", ")} in ${
            stage === "live" ? "de live-omgeving" : "de testomgeving"
          } ophalen…`
        : null;
  useEffect(() => {
    onActivity?.(activity);
  }, [activity, onActivity]);
  // Cleared on unmount too — leaving the payload view mid-read must not strand it.
  useEffect(() => () => onActivity?.(null), [onActivity]);

  // The columns this conversion fills from its own configuration rather than from
  // the sheet — empty for a standard project. Memoised because it is a dependency of
  // the build below, and a fresh Map every render would rebuild every payload.
  const fills = useMemo(
    () => resolveStandardColumns(selectedProject, moduleId),
    [selectedProject, moduleId],
  );

  // The codetabellen arrive **after** the first render (an async fetch, nothing
  // bundled — see `CodetabellenProvider`), and a phase override reads one to produce
  // a value: `BkTp`, the type bank for the country of the account. Built before the
  // table lands, that field is simply absent — no error, no red cell, just a payload
  // quietly missing a field. So the build depends on `loadedAt` and runs again once
  // the tables are there, the same contract every other reader of the tables has.
  const { loadedAt } = useCodetabellen();

  const built = useMemo(
    () =>
      state.status === "ready"
        ? buildModulePayloads(
            activePlan,
            state.contexts,
            sheet,
            "mapped",
            fills,
            buildPhase,
            selectedProject.livegangDatum,
            lookupTables,
            mode === "repair" ? repair : null,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state,
      activePlan,
      sheet,
      fills,
      buildPhase,
      selectedProject.livegangDatum,
      lookupTables,
      mode,
      repair,
      // Not read in the body: a change signal, so the payloads are rebuilt once the
      // codetabellen a phase reads have arrived. The linter can't see that — the
      // tables live in a module-level store, so nothing in the body mentions them.
      loadedAt,
    ],
  );

  // `NO_PAYLOADS` rather than a fresh `[]`: this list is a dependency of the memos
  // below, and a new empty array every render would rebuild them while nothing has
  // loaded yet.
  const payloads = built?.payloads ?? NO_PAYLOADS;
  /**
   * The records the filter lets through — **the list, for every purpose below**.
   *
   * Everything downstream counts and sends from this rather than from `payloads`:
   * hiding a record is how an admin says "not this one", so a record off screen is
   * off the send by construction, not by a second rule that has to remember to
   * agree. `payloads` is only used for the two figures that are honestly about the
   * whole sheet — the filter bar's "of N" and the record list's total.
   */
  const filtered = useMemo(
    () =>
      applyFilters(payloads, filters).filter((payload) =>
        matchesSearch(payload, search),
      ),
    [payloads, filters, search],
  );
  /** Whether the filter or the search is doing anything — what decides if the
   *  list says so. */
  const filtering = filters.some(isActive) || search.trim() !== "";

  /** How many of the built records this phase leaves out — what the notice counts. */
  const skippedCount = useMemo(
    () => payloads.filter((payload) => payload.skipped !== null).length,
    [payloads],
  );
  /** Records a lookup left without a value — never sent, and counted in a notice. */
  const blockedPayloads = useMemo(
    () => payloads.filter((payload) => payload.blocked !== null),
    [payloads],
  );
  /**
   * Validation errors per record, by ordinal — only the records that have any.
   *
   * The issues are keyed by **grid** row and a payload names its **Excel** rows, so
   * the grid index goes through `sheet.rowNumbers` first. Every row of a grouped
   * record counts: one bad regel is a body AFAS would get wrong.
   */
  const invalid = useMemo(() => {
    const byRow = new Map<number, number>();
    for (const cell of issues.values()) {
      for (const issue of cell) {
        const row = sheet.rowNumbers[issue.row] ?? issue.row + 1;
        byRow.set(row, (byRow.get(row) ?? 0) + 1);
      }
    }
    const map = new Map<number, number>();
    if (byRow.size === 0) return map;
    for (const payload of payloads) {
      let count = 0;
      for (const row of payload.rowNumbers) count += byRow.get(row) ?? 0;
      if (count > 0) map.set(payload.ordinal, count);
    }
    return map;
  }, [issues, sheet.rowNumbers, payloads]);
  /** Out of the send because of errors — a lookup without an answer or a failed
   *  check. What *Fouten verbergen* hides. */
  const isFaulty = useCallback(
    (payload: ModulePayload) =>
      payload.blocked !== null || invalid.has(payload.ordinal),
    [invalid],
  );

  /**
   * The records AFAS accepted in the last run against **this** stage, by ordinal —
   * each of them exists there now, whatever the read above last said.
   *
   * Read off the run rather than waiting for the re-read: `results` grows while the
   * run goes, so a row turns *Bestaat al* the moment its own record lands, and a
   * module with no existence lookup at all gets the mark too. A run against the
   * other stage says nothing about this one, so it marks nothing.
   */
  const accepted = useMemo(() => {
    const set = new Set<number>();
    if (outcome?.stage !== stage || isDeleteRun(outcome)) return set;
    for (const result of outcome.results) if (result.ok) set.add(result.ordinal);
    return set;
  }, [outcome, stage]);

  /**
   * The other direction: records a delete run against this stage has just removed.
   * Each is gone from AFAS the moment its result is in, so its row turns *Nieuw*
   * then rather than after the re-read — and, like `accepted`, only where the read
   * works, so the next send inserts it instead of trying to update a record that
   * no longer exists.
   */
  //
  // By **key**, not by ordinal: one offerte can be several records here (its rows
  // differ in a kop column the grouping keys on, such as a date), the delete sends
  // it once under the first one's ordinal, and every record built from it is gone.
  const removed = useMemo(() => {
    const set = new Set<string>();
    if (outcome?.stage !== stage || !isDeleteRun(outcome)) return set;
    const keyOf = new Map(
      payloads.map((payload) => [payload.ordinal, normalizeKey(payload.existingKey)]),
    );
    for (const result of outcome.results) {
      const key = result.ok ? keyOf.get(result.ordinal) : undefined;
      if (key) set.add(key);
    }
    return set;
  }, [outcome, stage, payloads]);

  /** Every payload's verdict against the environment, by ordinal. */
  const matches = useMemo(() => {
    const map = new Map<number, ExistingMatch>();
    for (const payload of payloads) {
      const match = matchKey(existing, payload.existingKey);
      // A record just written counts as existing for the **send** too, but only
      // where the read is working: then the mode switch is on screen and it is the
      // same verdict the re-read is about to give. Without a working read the mode
      // switch is hidden, and letting a session-local mark skip a record there
      // would leave it out of the next send with no control to put it back — so
      // that case is display-only, via `badgeOf` below.
      map.set(
        payload.ordinal,
        match.state === "new" && accepted.has(payload.ordinal)
          ? { ...match, state: "exists", name: payload.title }
          : match.state === "exists" && removed.has(match.key)
            ? { ...match, state: "new", name: "" }
            : match,
      );
    }
    return map;
  }, [payloads, existing, accepted, removed]);

  const matchOf = useCallback(
    (payload: ModulePayload): ExistingMatch =>
      matches.get(payload.ordinal) ?? UNKNOWN_MATCH,
    [matches],
  );

  /** The badge beside a record: its verdict, or — where there is none to give —
   *  *Bestaat al* for a record the last run wrote. */
  const badgeOf = useCallback(
    (payload: ModulePayload): ExistingMatch => {
      const match = matchOf(payload);
      if (match.state !== "unknown" || !accepted.has(payload.ordinal))
        return match;
      return { ...match, state: "exists", name: payload.title };
    },
    [matchOf, accepted],
  );
  /** Every record's badge, built once per change of verdicts rather than per render
   *  — a fresh object each time would defeat `RecordRow`'s memo. */
  const badges = useMemo(
    () => new Map(payloads.map((payload) => [payload.ordinal, badgeOf(payload)])),
    [payloads, badgeOf],
  );

  /**
   * Each step's newest finished run in this stage, for a module sent in steps
   * (Medewerkers: *Historie*, then *Actueel*) — read from the backend, which keeps
   * them, because switching step clears the run on screen and a reload forgets it.
   * Asked again whenever the run on screen starts or ends, so a step just finished
   * is in the list by the time its report is asked for. Kept per scope (project,
   * module, stage) rather than per ask, so the last list stays usable while the
   * next is on its way.
   */
  const stepScope =
    phases && phases.length > 1 && !custom
      ? `${selectedProject.id}|${runModuleId}|${stage}`
      : "";
  const [stepRuns, setStepRuns] = useState<{
    scope: string;
    runs: SendOutcome[];
  } | null>(null);
  const stepRunsTrigger = `${stepScope}|${outcome?.runId ?? ""}|${outcome?.status ?? ""}`;
  useEffect(() => {
    if (!stepScope) return;
    let cancelled = false;
    fetchStepRuns(selectedProject.id, runModuleId, stage)
      .then((runs) => {
        if (!cancelled) setStepRuns({ scope: stepScope, runs });
      })
      .catch((error) => {
        // A missing list costs the combined report, never the run's own one.
        console.warn("Eerdere stappen niet opgehaald:", error);
      });
    return () => {
      cancelled = true;
    };
    // `stepRunsTrigger` holds the scope plus the run on screen: a new ask per
    // started or finished run, not per poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepRunsTrigger]);

  /**
   * For a module sent in steps, the rows each step that **updates** what an earlier
   * one created has in AFAS, by step id — off its newest run the backend still holds
   * (`stepRows`). Existence can't say how far such a step got: once *Historie* is in,
   * every employee exists, whether *Actueel* reached them or not. A step with no run
   * held is left out and its rows count as existence says, which is the backend's
   * reading too (`_step_baselines()` in `main.py`).
   */
  const stepDone = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!stepScope || !phases) return map;
    const updating = new Set(
      phases.filter((step) => step.verb === "update").map((step) => step.id),
    );
    const runs = stepRuns?.scope === stepScope ? [...stepRuns.runs] : [];
    // The run on screen last: the freshest copy of its step, once it is measured.
    if (outcome && !isDeleteRun(outcome)) runs.push(outcome);
    for (const run of runs) {
      if (run.stage === stage && run.phase && updating.has(run.phase) && run.stepRows) {
        map.set(run.phase, new Set(run.stepRows));
      }
    }
    return map;
  }, [stepScope, phases, stepRuns, outcome, stage]);

  /**
   * How much of the sheet AFAS holds in this stage, in **sheet rows**: every row the
   * module's records cover, and of those the rows where every record on it is
   * marked *Bestaat al* or was written by this session's last run here. What a send
   * hands the backend to measure its outcome against, and what *Voortgang naar AFAS
   * sturen* stamps on its own — one count, so the two can't describe the same
   * environment differently.
   *
   * For a module sent in steps a row also has to be in every updating step's
   * {@link stepDone}: `existingRows` is then the module's figure, the one a run
   * stamps. The send hands the backend `presentRows` — existence alone — since it
   * holds the steps against it itself.
   */
  const coverage = useMemo(() => {
    const sheetRows = new Set<number>();
    const absent = new Set<number>();
    const notThere = new Set<number>();
    const steps = [...stepDone.values()];
    for (const payload of payloads) {
      const there =
        matchOf(payload).state === "exists" || accepted.has(payload.ordinal);
      for (const row of payload.rowNumbers) {
        sheetRows.add(row);
        if (!there) absent.add(row);
        if (!there || steps.some((done) => !done.has(row))) notThere.add(row);
      }
    }
    return {
      sheetRows: [...sheetRows],
      existingRows: [...sheetRows].filter((row) => !notThere.has(row)),
      presentRows: [...sheetRows].filter((row) => !absent.has(row)),
    };
  }, [payloads, matchOf, accepted, stepDone]);

  /**
   * *Alleen nieuwe* takes the records AFAS already holds **out of the list**, not
   * just out of the send: the list is what goes to AFAS, so a record that won't go
   * has no business in it. Only while the existence read works — without it nothing
   * is marked and the switch is not on screen. The filter bar's records come first,
   * so its "of N" stays about the sheet.
   */
  const hideExisting =
    mode === "new" && Boolean(plan.existing && existing?.available);
  /** *Herstellen* is the mirror image: only what AFAS holds can be repaired, so the
   *  new records leave the list. */
  const hideNew = mode === "repair";
  const withoutExisting = useMemo(
    () =>
      hideExisting
        ? filtered.filter((payload) => matchOf(payload).state !== "exists")
        : hideNew
          ? filtered.filter((payload) => matchOf(payload).state === "exists")
          : filtered,
    [filtered, hideExisting, hideNew, matchOf],
  );
  /** Records hidden because AFAS already holds them — what the rail counts. */
  const hiddenExisting = filtered.length - withoutExisting.length;
  /** Of what is left, the records that won't go because of errors — counted
   *  whether or not they are hidden, so the rail can say either. */
  const faultyCount = useMemo(
    () => withoutExisting.filter(isFaulty).length,
    [withoutExisting, isFaulty],
  );
  const visible = useMemo(
    () =>
      hideFaulty
        ? withoutExisting.filter((payload) => !isFaulty(payload))
        : withoutExisting,
    [withoutExisting, hideFaulty, isFaulty],
  );

  // A shorter list — a re-read with a different startrij, or a filter that just hid
  // the record that was open — can leave the selection past the end; clamping in the
  // render keeps it in range without an effect. Against `visible`, because that is
  // the list on screen: a body shown for a record the filter has excluded would be
  // the panel contradicting itself about what is going to be sent.
  // Named, because two things now read it: the body below and the focus-mode
  // stepper in its header. Off raw `selected` the stepper would grey out its
  // *Volgende* on a stale index while the body was showing a record halfway up the
  // list — the arrows have to agree with what is on screen, not with the state.
  const selectedIndex = Math.min(selected, Math.max(visible.length - 1, 0));
  const current = visible[selectedIndex] ?? null;

  const chosen = useMemo(
    () => visible.filter((payload) => !excluded.has(recordRow(payload))),
    [visible, excluded],
  );
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  /** The ticked records this mode would actually send, each with its verb. */
  const outgoing = useMemo(
    () =>
      recordsFor(
        mode,
        chosen,
        matchOf,
        phase?.verb === "update" || custom !== null,
        invalid,
      ),
    [mode, chosen, matchOf, phase, custom, invalid],
  );
  /** What the send button says out loud: it shows only an icon and the count, so
   *  the phase ("Verstuur 248" means two different things in the two steps) and
   *  the environment live in its tooltip and accessible name. */
  const repairSummary =
    mode === "repair" ? describeRepair(repair, built?.objects ?? []) : null;
  const sendLabel = `${mode === "repair" ? "Herstel" : "Verstuur"} ${outgoing.length}${
    phase ? ` · ${phase.label.toLowerCase()}` : ""
  }${repairSummary ? ` · ${repairSummary}` : ""} naar ${stage === "live" ? "live" : "test"}`;
  const updating = outgoing.filter(
    (record) => record.action === "update",
  ).length;

  // The figures for the toolbar (`onMetrics`) — **always exactly two**, the same
  // two slots the Data view fills with the check's figures, so switching views
  // swaps the text in place and moves nothing in the column (the workflow buttons
  // and the files under it least of all). So what used to be figures of their own
  // rides along in the second one's detail line: the records a filter, repair mode
  // or errors keep out of the send. How many AFAS already holds is in neither as a
  // count of its own — the lead says that of the whole sheet.

  // The lead: how much of the sheet this stage already holds, and how much not yet.
  // `coverage` in sheet rows and `percentageOf` — the very figure *Voortgang naar
  // AFAS sturen* stamps on the deeltaak, so the bar and the badge can't disagree.
  // Only with an existence read that came back: without one nothing is marked, and
  // 0% would be a guess dressed as a figure — a dash holds the slot instead.
  const lead: MetricText =
    plan.existing &&
    !existingLoading &&
    existing?.available &&
    coverage.sheetRows.length > 0
      ? {
          figure: `${percentageOf(coverage.existingRows.length, coverage.sheetRows.length)}%`,
          caption: "van de rijen staat al in AFAS",
          // The environment only in the tooltip: the Test/Live switch beside the
          // body already says which, and the full name would cost the row a figure.
          detail: `${coverage.existingRows.length} van ${coverage.sheetRows.length} rijen, ${
            coverage.sheetRows.length - coverage.existingRows.length
          } nog niet`,
          title: `${coverage.existingRows.length} van ${coverage.sheetRows.length} rijen staan al in ${
            existing.environment
          }: elk record op de rij bestaat al, of is in deze sessie verstuurd${
            stepDone.size > 0 ? ", en elke stap heeft de rij verstuurd" : ""
          }. ${coverage.sheetRows.length - coverage.existingRows.length} nog niet.`,
        }
      : {
          figure: "–",
          caption: "van de rijen staat al in AFAS",
          // While the read runs the bar puts its activity line here instead.
          detail: plan.existing ? "nog niet bekend" : "niet na te gaan voor deze module",
        };

  // What keeps a record out of the send although it is in the sheet, each only
  // once there is any: a filter (with one on, "van 12" is a different 12 from the
  // sheet's own), repair mode hiding what AFAS doesn't hold yet, and errors.
  const filteredOut = filtering ? payloads.length - filtered.length : 0;
  const hiddenNew = plan.existing && hideNew && existing?.available ? hiddenExisting : 0;
  const keptOut: { short: string; long: string }[] = [
    ...(filteredOut > 0
      ? [{ short: `${filteredOut} weggefilterd`, long: `${filteredOut} weggefilterd` }]
      : []),
    ...(hiddenNew > 0
      ? [
          {
            short: `${hiddenNew} nieuw verborgen`,
            long: `${hiddenNew} ${hiddenNew === 1 ? "staat" : "staan"} nog niet in AFAS en ${
              hiddenNew === 1 ? "kan" : "kunnen"
            } niet worden hersteld`,
          },
        ]
      : []),
    ...(faultyCount > 0
      ? [
          {
            short: `${faultyCount} met fouten`,
            long: `${faultyCount} met fouten ${
              hideFaulty ? "verborgen" : "overgeslagen"
            } (fouten bij de controle, of een waarde die AFAS niet kent)`,
          },
        ]
      : []),
  ];
  const payloadMetrics: MetricText[] = [
    lead,
    {
      figure: String(chosen.length),
      caption: "geselecteerd",
      detail: [
        `van ${visible.length} ${visible.length === 1 ? "payload" : "payloads"}`,
        ...keptOut.map((k) => k.short),
      ].join(", "),
      ...(keptOut.length > 0 && {
        title: `${chosen.length} van ${visible.length} geselecteerd. Niet verstuurd: ${keptOut
          .map((k) => k.long)
          .join("; ")}.`,
      }),
    },
  ];
  // Keyed on the text, so the uploader's state only changes when a figure does —
  // a fresh array every render would re-render it, and so this panel, forever.
  const metricsKey = JSON.stringify(payloadMetrics);
  useEffect(() => {
    onMetrics?.(JSON.parse(metricsKey) as MetricText[]);
  }, [metricsKey, onMetrics]);
  useEffect(() => () => onMetrics?.(null), [onMetrics]);

  /**
   * Whether this module offers *Verwijderen* at all: the plan has an existence key,
   * the read came back, and the backend says the module has a delete target. All
   * three, because the delete removes exactly the records marked *Bestaat al* — no
   * working read, no marks, nothing to delete.
   */
  const canDelete = Boolean(
    // Never for a custom module: it only ever adds fields to the parent's records,
    // and deleting would remove the parent's employee, not the vrije velden.
    !custom && plan.existing && existing?.available && existing.deletable,
  );
  /**
   * What a delete would remove: the ticked records AFAS holds, **one per key**.
   *
   * Not one per record. A grouped module splits an offerte into two records when
   * its rows disagree on a kop column (28 offertes at 501342 carry two begindatums),
   * but AFAS holds one offerte under that number and one DELETE removes it — so the
   * key goes once, under its first record, with every row behind it. Sending it
   * twice made the backend refuse the whole run as a duplicate selection.
   */
  const deletable = useMemo(() => {
    if (!canDelete) return NO_DELETES;
    const byKey = new Map<string, DeleteGroup>();
    for (const payload of chosen) {
      const match = matchOf(payload);
      if (payload.existingKey === "" || match.state !== "exists") continue;
      const group = byKey.get(match.key);
      if (group) group.rows.push(...payload.rowNumbers);
      else
        byKey.set(match.key, {
          payload,
          name: match.name,
          rows: [...payload.rowNumbers],
        });
    }
    for (const group of byKey.values()) group.rows.sort((a, b) => a - b);
    return [...byKey.values()];
  }, [canDelete, chosen, matchOf]);

  /** Last run's verdict per record, by ordinal — what puts a mark on a row. */
  const resultsByOrdinal = useMemo(() => {
    const map = new Map<number, SendResult>();
    for (const result of outcome?.results ?? [])
      map.set(result.ordinal, result);
    return map;
  }, [outcome]);

  /**
   * What each refused record sent for the fields AFAS names in its refusal — the
   * value behind *De ingevulde waarde bij 'Verkooprelatie' bestaat niet*, which AFAS
   * itself never repeats. Read from the body the backend kept with the refusal and
   * this connector's schema, which is what turns AFAS's label back into a field code.
   */
  const refusedValuesOf = useCallback(
    (run: SendOutcome | null): Map<number, RefusedValue[]> => {
      const map = new Map<number, RefusedValue[]>();
      if (state.status !== "ready" || !run) return map;
      const schemas = new Map(
        [...state.contexts.values()].map((context) => [
          context.schema.id,
          context.schema,
        ]),
      );
      for (const result of run.results) {
        if (result.ok) continue;
        const values = refusedValues(
          result.message,
          result.body,
          schemas.get(result.connector),
        );
        if (values.length > 0) map.set(result.ordinal, values);
      }
      return map;
    },
    [state],
  );
  const refusedByOrdinal = useMemo(
    () => refusedValuesOf(outcome),
    [refusedValuesOf, outcome],
  );

  /**
   * The module's records against AFAS once the run is over, for the
   * verzendrapport's figures: every record on screen, and how many AFAS holds —
   * marked *Bestaat al* or written by the run (`matchOf` folds both in), minus what
   * the run refused, as `send_progress.outcome()` counts it. Only while the
   * existence read for the **run's** stage is working: without it the records sent
   * before this run are unknown, and the report keeps to the run alone. Not for a
   * custom module, whose records only add fields to the parent's.
   *
   * A step that updates records phase 1 created finds every one of them in AFAS,
   * so "in AFAS" says nothing about whether *this* step reached them: it counts the
   * records whose rows are in its own runs' `stepRows` instead, and keeps to the run
   * alone where the backend measured none.
   */
  const reportRecords = (
    run: SendOutcome | null,
    verb: "insert" | "update" = "insert",
  ): SendReportContext["records"] => {
    if (!run || isDeleteRun(run) || custom || payloads.length === 0) return null;
    if (verb === "update") {
      if (!run.stepRows) return null;
      const done = new Set(run.stepRows);
      const inAfas = payloads.filter((payload) =>
        payload.rowNumbers.every((row) => done.has(row)),
      ).length;
      return { total: payloads.length, inAfas };
    }
    if (run.stage !== stage || !plan.existing || !existing?.available) return null;
    const refused = new Set(
      run.results.filter((result) => !result.ok).map((result) => result.ordinal),
    );
    let inAfas = 0;
    for (const payload of payloads) {
      if (!refused.has(payload.ordinal) && matchOf(payload).state === "exists") inAfas += 1;
    }
    return { total: payloads.length, inAfas };
  };

  /**
   * The steps a combined verzendrapport covers, oldest first — each step's newest
   * finished run in the stage of the run on screen, that one itself for its own
   * step (it is the freshest copy). `null` unless at least two steps have a run:
   * a report of one step is the ordinary report.
   */
  const reportSteps = (): SendReportStep[] | null => {
    if (!phases || phases.length < 2 || custom || !outcome || isDeleteRun(outcome)) {
      return null;
    }
    const byPhase = new Map<string, SendOutcome>();
    for (const run of stepRuns?.scope === stepScope ? stepRuns.runs : []) {
      if (run.stage === outcome.stage && run.phase) byPhase.set(run.phase, run);
    }
    if (outcome.phase) byPhase.set(outcome.phase, outcome);
    const steps = phases.flatMap((step, index): SendReportStep[] => {
      const run = byPhase.get(step.id);
      if (!run) return [];
      return [
        {
          run,
          label: `Stap ${index + 1} · ${step.label}`,
          records: reportRecords(run, step.verb),
          refusedValues: refusedValuesOf(run),
        },
      ];
    });
    return steps.length > 1 ? steps : null;
  };

  /**
   * The module as a whole in a combined verzendrapport: the records **every** step
   * has in AFAS — the figure the run stamped on the deeltaak, counted in records
   * like the rest of the report. Only where each step can be measured: the
   * existence read for the run's stage, and every updating step's `stepRows`.
   */
  const reportComplete = (
    steps: SendReportStep[] | null,
  ): SendReportContext["complete"] => {
    if (
      !steps ||
      !phases ||
      !outcome ||
      outcome.stage !== stage ||
      !plan.existing ||
      !existing?.available ||
      phases.some((step) => step.verb === "update" && !stepDone.has(step.id))
    ) {
      return null;
    }
    const done = [...stepDone.values()];
    const inAfas = payloads.filter(
      (payload) =>
        matchOf(payload).state === "exists" &&
        done.every((rows) => payload.rowNumbers.every((row) => rows.has(row))),
    ).length;
    return { total: payloads.length, inAfas };
  };

  /** What the verzendrapport is drawn under — the notice's download and a
   *  workflow action's attachment alike. */
  const reportContext = (): SendReportContext => {
    const steps = reportSteps();
    return {
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      moduleLabel,
      phaseLabel: phase?.label ?? custom?.label ?? null,
      refusedValues: refusedByOrdinal,
      headings: refusalHeadings,
      records: reportRecords(outcome, phase?.verb),
      steps,
      complete: reportComplete(steps),
    };
  };

  /**
   * The cells the last run points at: every refused record's
   * ({@link refusalIssues}) and every held-back one's lookup cell
   * ({@link missingIssues}) — what the marked Excel tints, wherever it goes.
   */
  const runSheetIssues = (): Map<string, Issue[]> => {
    if (!outcome || state.status !== "ready") return new Map();
    // Every step's, when the report combines them: the Excel goes with that report,
    // and a cell step 1 refused is as much to fix as one step 2 did.
    const runs = reportSteps()?.map((step) => step.run) ?? [outcome];
    const marked = new Map<string, Issue[]>();
    const add = (issues: Map<string, Issue[]>) => {
      for (const [key, list] of issues) {
        marked.set(key, [...(marked.get(key) ?? []), ...list]);
      }
    };
    for (const run of runs) {
      add(refusalIssues(run.results, refusedValuesOf(run), state.contexts, sheet));
      add(missingIssues(run.skippedMissing ?? [], state.contexts, sheet));
    }
    return marked;
  };

  /**
   * Whether the last run has a report to give — the condition the refusal notice
   * and its *Download* are shown under, so the attachments are offered exactly
   * when that button is.
   */
  const stepsToReport = outcome && outcome.status !== "running" ? reportSteps() : null;
  const hasRunReport =
    !!outcome &&
    outcome.status !== "running" &&
    (stepsToReport?.map((step) => step.run) ?? [outcome]).some(
      (run) => run.failed > 0 || (run.skippedMissing?.length ?? 0) > 0,
    );

  const buildRunAttachments = async (): Promise<RunAttachments | null> => {
    if (!outcome || outcome.status === "running") return null;
    const context = reportContext();
    return {
      pdf: {
        blob: await buildSendReportPdf(outcome, context),
        fileName: sendReportFileName(outcome, context),
      },
      sheetIssues: runSheetIssues(),
    };
  };
  // Registered once per "has a report" rather than per render: the builder reads
  // the latest run, headings and sheet through the ref when it is called, and the
  // uploader is not re-rendered on every keystroke in the refusal headings.
  const runAttachmentsRef = useRef(buildRunAttachments);
  useEffect(() => {
    runAttachmentsRef.current = buildRunAttachments;
  });
  useEffect(() => {
    if (!onRunAttachments || !hasRunReport) return;
    onRunAttachments(() => runAttachmentsRef.current());
    return () => onRunAttachments(null);
  }, [onRunAttachments, hasRunReport]);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const toggle = useCallback((row: number) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (!next.delete(row)) next.add(row);
      return next;
    });
  }, []);

  /** Select-all is a **three-state** control in behaviour if not in looks: with any
   *  record left out it selects everything, and only from all-selected does it clear
   *  — the order that makes the common press ("I unticked three, give them back")
   *  the one that needs no thought. */
  const toggleAll = useCallback(() => {
    setExcluded((current) => {
      const next = new Set(current);
      // Only the records on screen: with a filter on, "alles" means the list the
      // admin is looking at. Ticking rows they have filtered away would be answering
      // a question they didn't ask, and the counts beside the box are the visible
      // ones — a press has to move the number it sits next to.
      const shown = visible.map(recordRow);
      const anyExcluded = shown.some((row) => next.has(row));
      for (const row of shown) {
        if (anyExcluded) next.delete(row);
        else next.add(row);
      }
      return next;
    });
  }, [visible]);

  /** One condition edited in place. A changed field clears the text with it: the
   *  old query was written about another field, and carrying it over would filter on
   *  a phrase the admin never typed for this one. */
  const changeFilter = useCallback(
    (id: string, patch: Partial<PayloadFilter>) => {
      setFilters((current) =>
        current.map((filter) =>
          filter.id !== id
            ? filter
            : {
                ...filter,
                ...patch,
                ...(patch.fieldId !== undefined &&
                patch.fieldId !== filter.fieldId
                  ? { query: "" }
                  : {}),
              },
        ),
      );
    },
    [],
  );

  const addFilter = useCallback(() => {
    setFilters((current) => [...current, newFilter()]);
  }, []);

  const removeFilter = useCallback((id: string) => {
    setFilters((current) => {
      const next = current.filter((filter) => filter.id !== id);
      // Never nothing: an empty bar has no field picker on it, so the only way back
      // to filtering would be a button whose purpose isn't obvious from an empty row.
      return next.length === 0 ? [newFilter()] : next;
    });
  }, []);

  /** Back to one blank row — the state the panel opens in. */
  const clearFilters = useCallback(() => setFilters([newFilter()]), []);

  /**
   * Hand the records to the backend and close the dialog — the records themselves
   * go to AFAS in the background from there, and the progress bar below follows the
   * run.
   *
   * What is awaited here is only the backend *accepting* the run, which is where
   * every refusal that applies to the whole send arrives (not an admin, a stage
   * without credentials, a record claiming to update something AFAS no longer has,
   * a send of this module already going). Those are answers worth holding the
   * dialog open for; the minutes of AFAS calls after them are not.
   */
  const send = useCallback(async () => {
    setStarting(true);
    setSendError(null);
    try {
      const records = outgoing.map(({ payload, action }) =>
        toSendRecord(payload, action),
      );
      // What was ticked but stays behind, and why — so the report can say
      // "108 van 288" rather than count only what went.
      const phaseSkipped = chosen.filter((p) => p.skipped !== null).length;
      // Blocked on a lookup is neither "already exists" nor "out of this step", and
      // counting it as either would misstate the report; it is left out of both.
      // A failed check the same: ticked, not sent, and neither of the two reasons.
      const blocked = chosen.filter(
        (p) =>
          p.skipped === null && (p.blocked !== null || invalid.has(p.ordinal)),
      ).length;
      // The lookup-blocked ones are also listed by name: each is something missing
      // in AFAS (a debiteur, a project) that the report and the dialog should name.
      const missing = chosen
        .filter((p) => p.skipped === null && p.blocked !== null)
        .map((p) => ({
          ordinal: p.ordinal,
          rows: p.rowNumbers,
          title: p.title,
          kind: p.variant.label,
          reason: p.blocked ?? "",
        }));
      await startRun(
        runModuleId,
        stage,
        records,
        {
          phase: phaseSkipped,
          existing: chosen.length - phaseSkipped - blocked - records.length,
          missing,
        },
        // What the outcome is measured against — see `coverage`.
        { sheetRows: coverage.sheetRows, existingRows: coverage.presentRows },
        // Which step this is, so the combined verzendrapport can find it again, and
        // the others, which the stamped figure holds every row against.
        phases && phases.length > 1 && phase
          ? {
              id: phase.id,
              label: phase.label,
              steps: phases.map((step) => ({ id: step.id, verb: step.verb })),
            }
          : null,
      );
      setConfirmOpen(false);
    } catch (error) {
      setSendError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "De payloads konden niet naar AFAS worden verstuurd.",
      );
      setConfirmOpen(false);
    } finally {
      setStarting(false);
    }
  }, [
    outgoing,
    chosen,
    invalid,
    runModuleId,
    stage,
    startRun,
    coverage,
    phases,
    phase,
  ]);

  /**
   * Why *Voortgang naar AFAS sturen* can't be pressed now, or `null` when it can.
   * Its figure is `coverage`, so it needs what `coverage` stands on: an existence
   * read for this module that came back for this stage — without one nothing is
   * marked *Bestaat al*, and the stamp would call the whole sheet unsent. Not during
   * a run either: the marks are still moving, and the run stamps its own figure
   * when it ends.
   */
  const progressBlocked = !plan.existing
    ? "deze module kan nog niet nagaan welke records al in AFAS staan"
    : !stageConfigured
      ? "deze omgeving heeft nog geen inloggegevens"
      : existingLoading
        ? "bestaande records worden nog opgezocht"
        : !existing?.available
          ? "de bestaande records konden niet worden opgezocht"
          : running
            ? "wacht tot de verzending klaar is"
            : coverage.sheetRows.length === 0
              ? "er zijn geen records om te tellen"
              : null;
  const inAfasRows = coverage.existingRows.length;
  const sheetRowCount = coverage.sheetRows.length;

  /**
   * Stamp the module's deeltaak with how much of the sheet AFAS holds in this
   * stage, without sending a record — `Voortgang` the share of rows in AFAS,
   * `Fouten` the rows still to send ([progress-payload.ts](../../lib/progress-payload.ts)).
   * For records that went in another way than a send from here, where the badge
   * still describes the state before them. The sidebar is read back from AFAS
   * afterwards, so the badge shows what the dossieritem holds, not this count.
   */
  const pushProgress = async () => {
    if (progressBlocked || custom) return;
    setProgressPushing(true);
    setProgressNote(null);
    try {
      const result = await pushProgressToAfas(
        buildProgressUpdate({
          projectId: selectedProject.id,
          moduleId,
          stage,
          sheetRows: sheetRowCount,
          inAfasRows,
        }),
      );
      await refreshProgress();
      setProgressNote({
        ok: true,
        text: `${result.message} ${inAfasRows} van ${sheetRowCount} rijen staan in ${
          existing?.environment ?? stage
        }, ${sheetRowCount - inAfasRows} nog niet (${result.completeness}%).`,
      });
    } catch (error) {
      setProgressNote({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "De voortgang kon niet naar AFAS worden gestuurd.",
      });
    } finally {
      setProgressPushing(false);
    }
  };

  /**
   * Hand the keys to the backend and close the dialog — the same run as a send's,
   * so the progress strip, the stop button and the re-read of the marks all follow
   * it without a second path. The backend re-checks every key against AFAS before
   * the first DELETE, so a stale mark refuses the whole run here rather than
   * failing record by record.
   */
  const removeRecords = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    setSendError(null);
    try {
      await startDelete(
        moduleId,
        stage,
        deletable.map((group) => ({
          ...toDeleteRecord(group.payload),
          rows: group.rows,
        })),
      );
      setDeleteOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "De records konden niet uit AFAS worden verwijderd.",
      );
    } finally {
      setDeleting(false);
    }
  }, [startDelete, moduleId, stage, deletable]);

  /**
   * The mapping, over the payload it explains — see `UpdateConnectorsDialog` for why
   * it is a dialog and not a navigation. A custom module's mapping is a client
   * mapping of this project, so it opens on that entry of the explorer's client
   * section, with its schema read from this project's own AFAS — and so does a
   * standard module this project has its own copy of, since that copy is the one
   * the payload was built from.
   */
  const openContext =
    mappingOpen && state.status === "ready" ? state.contexts.get(mappingOpen) : undefined;
  const mappingDialog = mappingOpen ? (
    <UpdateConnectorsDialog
      fromProjectId={selectedProject.id}
      initialModuleId={custom || openContext?.client ? null : mappingOpen}
      initialClient={
        custom
          ? {
              projectId: selectedProject.id,
              projectName: selectedProject.name,
              moduleId: custom.id,
              moduleLabel: custom.label,
              connector: custom.connector,
            }
          : openContext?.client
            ? {
                projectId: selectedProject.id,
                projectName: selectedProject.name,
                moduleId: mappingOpen,
                moduleLabel,
                connector: openContext.mapping.connector,
              }
            : null
      }
      onClose={({ saved }) => {
        setMappingOpen(null);
        // Only on a save: a reload is a `/api/afas/mappings` read plus an AFAS
        // metainfo call per variant, and opening the mapping to look at it is
        // the common case.
        if (saved) {
          setMappingReload((n) => n + 1);
          // The sidebar's dot says whether a custom module has a mapping.
          if (custom) void refreshCustomModules();
        }
      }}
    />
  ) : null;

  /**
   * The phase toggle. A segmented control for the same reason the stage switch is
   * one: two options, both worth reading, and which is armed decides what the button
   * sends. Absent for every single-phase module and for a custom module.
   */
  const stepToggle =
    phases && phases.length > 1 ? (
      <span className="flex items-center gap-2.5">
        <span role="group" aria-label="Stap" className="flex h-9 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm pointer-coarse:h-11">
          {phases.map((option, index) => {
            const on = phase?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => switchPhase(option.id)}
                aria-pressed={on}
                // A phase switch rebuilds every payload, so doing it
                // mid-run would put the other step's bodies under the
                // marks of records being written right now — the same
                // reason `switchPhase` clears the results at all.
                disabled={running && !on}
                title={
                  running && !on
                    ? "Kan niet van stap wisselen terwijl er wordt verstuurd"
                    : option.description
                }
                className={`flex h-8 items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-[box-shadow,color] duration-200 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:h-10 ${
                  on
                    ? "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                    : "cursor-pointer rounded-full text-k-text-tertiary hover:text-k-text-primary"
                }`}
              >
                {/* The number, because the phases are a sequence and not a
                    pair of alternatives: an admin has to run 1 before 2,
                    and a bare pair of words would not say so. */}
                <span className={on ? "text-k-cloud-deep/70" : "text-k-text-tertiary"}>
                  {index + 1}
                </span>
                {option.label}
              </button>
            );
          })}
        </span>
      </span>
    ) : null;

  if (state.status === "loading") {
    return (
      <p className="px-1 py-2 text-sm text-k-text-secondary">
        Koppeling en connectoren laden…
      </p>
    );
  }
  if (state.status === "error") {
    if (!custom) return <AmberNotice>{state.message}</AmberNotice>;
    // A custom module that has no mapping yet (or whose schema can't be read): the
    // mapping is offered right here rather than on a page the admin has to find.
    return (
      <div className="flex flex-col gap-3">
        {mappingDialog}
        <AmberNotice>
          <span>{state.message}</span>{" "}
          <button
            type="button"
            onClick={() => setMappingOpen(custom.id)}
            className="cursor-pointer font-semibold underline underline-offset-2"
          >
            Koppeling maken
          </button>
        </AmberNotice>
      </div>
    );
  }

  // A variant the plan names but the store hasn't got — the other half of a split
  // module still renders, so this is a notice rather than the panel's whole answer.
  const missing = activePlan.variants.filter(
    (variant) => !state.contexts.has(variant.mappingId),
  );
  const refusalGroups = groupRefusals(outcome?.results ?? [], refusedByOrdinal);
  const missingGroups = groupMissing(outcome?.skippedMissing ?? []);
  const missingCount = outcome?.skippedMissing?.length ?? 0;

  async function downloadReport() {
    if (!outcome || reporting) return;
    setReporting(true);
    try {
      await downloadSendReportPdf(outcome, reportContext());
    } finally {
      setReporting(false);
    }
  }

  /**
   * The sheet back out with every refused cell red — and every held-back
   * record's lookup cell — and every older mark wiped: the file a client fixes and
   * re-uploads. Only offered when something was refused or held back: a run AFAS
   * took whole has no cell to point at.
   */
  async function downloadRefusedSheet() {
    if (!outcome || marking || !onDownloadSheet || state.status !== "ready") return;
    setMarking(true);
    try {
      await onDownloadSheet(runSheetIssues());
    } catch {
      setSendError("Kon het Excel-bestand met de weigeringen niet maken.");
    } finally {
      setMarking(false);
    }
  }
  // `hasRunReport` rather than this run's own counts: in a combined report a cell
  // step 1 refused is still to fix after a clean step 2.
  const canMarkSheet =
    !!onDownloadSheet && state.status === "ready" && hasRunReport;

  /**
   * The refusal notice's single download: the report, plus the marked sheet when
   * there is one. One after the other, not at once — a burst of programmatic
   * downloads can get the second file dropped silently (see `saveAndDownload` in
   * ExcelUploader).
   */
  async function downloadRefusals() {
    try {
      await downloadReport();
    } finally {
      if (canMarkSheet) await downloadRefusedSheet();
    }
  }

  // Below `lg` the panel is for sending, not reading: the body pane's controls
  // (step, environment, send) lead, the records follow at full width with their
  // tick boxes, and the JSON itself is left out — on a phone it took the room the
  // controls need, and checking bodies line by line is desk work. A screen tall,
  // like the Data view's table card, so the controls stay put over a scrolling list.
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 max-lg:h-[calc(100dvh-6rem)] max-lg:flex-none ${className}`}
    >
      {/* The mapping, over the payload it explains — see `UpdateConnectorsDialog`
          for why it is a dialog and not a navigation. */}
      {mappingDialog}

      {refusalsOpen && outcome && (
        <RefusalsDialog
          groups={refusalGroups}
          missing={missingGroups}
          environment={outcome.environment}
          headings={refusalHeadings}
          onHeadingChange={(message, heading) =>
            setRefusalHeadings((current) => {
              const next = new Map(current);
              if (heading) next.set(message, heading);
              else next.delete(message);
              return next;
            })
          }
          onClose={() => setRefusalsOpen(false)}
        />
      )}

      {confirmOpen && (
        <SendPayloadsDialog
          count={outgoing.length}
          updating={updating}
          repair={repairSummary}
          stage={stage}
          moduleLabel={moduleLabel}
          omgeving={sendEnvironment?.omgeving || ""}
          host={sendEnvironment?.host || ""}
          projectName={selectedProject.name}
          sending={starting}
          onConfirm={() => void send()}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {deleteOpen && plan.existing && (
        <DeleteRecordsDialog
          records={deletable.map((group) => ({
            ordinal: group.payload.ordinal,
            key: group.payload.existingKey,
            name: group.name,
            rows: group.rows,
          }))}
          error={deleteError}
          noun={plan.existing.noun}
          plural={plan.existing.plural ?? "records"}
          stage={stage}
          moduleLabel={moduleLabel}
          omgeving={sendEnvironment?.omgeving || ""}
          host={sendEnvironment?.host || ""}
          projectName={selectedProject.name}
          deleting={deleting}
          onConfirm={() => void removeRecords()}
          onClose={() => {
            setDeleteOpen(false);
            setDeleteError(null);
          }}
        />
      )}

      {/* Every message this panel can raise, paged rather than stacked — see
          `NoticeCarousel`. The order is the order the work happens in: what the
          mapping could not cover, why this conversion isn't filling its own
          columns, then what this sheet is missing, then what the last send did,
          then what the environment could not tell us. Findings about the sheet
          come before findings about AFAS because the first are the user's to fix
          and the second are usually not — and a cause comes before the symptom it
          would otherwise be mistaken for. */}
      <NoticeCarousel
        className="shrink-0"
        items={[
          missing.length > 0 && (
            <AmberNotice key="unmapped">
              Nog geen koppeling opgeslagen voor{" "}
              {missing.map((variant) => variant.label).join(" en ")} — die rijen
              staan hieronder niet tussen de payloads.
            </AmberNotice>
          ),
          skippedCount > 0 && phase?.skip && (
            <AmberNotice key="phase-skipped">
              <span className="font-semibold">
                {skippedCount === 1
                  ? "1 record valt buiten deze stap"
                  : `${skippedCount} records vallen buiten deze stap`}
              </span>{" "}
              — {phase.skip.reason}. Ze staan er wel tussen, maar worden niet
              verstuurd.
            </AmberNotice>
          ),
          invalid.size > 0 && (
            <AmberNotice key="validation-errors">
              <span className="font-semibold">
                {invalid.size === 1
                  ? "1 record heeft fouten"
                  : `${invalid.size} records hebben fouten`}
              </span>{" "}
              bij de controle en {invalid.size === 1 ? "wordt" : "worden"} niet
              verstuurd. Pas de rode cellen aan in de tabel en controleer
              opnieuw.
            </AmberNotice>
          ),
          /* Before the missing-column banner, because it is its cause: those three
             columns are ones this conversion should be filling itself, and the
             banner's "controleer of dit bestand de juiste versie van het sjabloon
             is" sends the reader after the wrong thing while the dossieritem is
             empty. It does not replace the banner — the columns really are absent
             — it explains it, so the pair reads cause then effect. */
          hasConversionSettingsNotice && (
            <ModuleConversionSettingsNotice
              key="conversion-settings"
              project={selectedProject}
              moduleId={moduleId}
            />
          ),
          blockedPayloads.length > 0 && !lookupsLoading && (
            <AmberNotice key="lookup-blocked">
              <span className="font-semibold">
                {blockedPayloads.length === 1
                  ? "1 record wordt niet verstuurd"
                  : `${blockedPayloads.length} records worden niet verstuurd`}
              </span>{" "}
              — een veld dat in AFAS wordt opgezocht heeft daar geen antwoord.
              Bijvoorbeeld record {blockedPayloads[0]?.ordinal}:{" "}
              {blockedPayloads[0]?.blocked}. Voeg de ontbrekende waarden toe in{" "}
              {stage === "live" ? "de live-omgeving" : "de testomgeving"}, of pas de
              cellen aan.
            </AmberNotice>
          ),
          built && built.missingColumns.length > 0 && (
            <AmberNotice key="missing-columns">
              <span className="font-semibold">
                {built.missingColumns.length === 1
                  ? "1 gekoppelde kolom staat niet in dit bestand"
                  : `${built.missingColumns.length} gekoppelde kolommen staan niet in dit bestand`}
              </span>{" "}
              — de bijbehorende velden blijven leeg:{" "}
              <strong className="font-semibold">
                {Array.from(
                  new Set(built.missingColumns.map((column) => column.header)),
                )
                  .slice(0, 8)
                  .join(", ")}
              </strong>
              {new Set(built.missingColumns.map((column) => column.header))
                .size > 8
                ? "…"
                : ""}
              . Controleer of dit bestand de juiste versie van het sjabloon is.
            </AmberNotice>
          ),
          built && built.unrouted.length > 0 && (
            <AmberNotice key="unrouted">
              <span className="font-semibold">
                {built.unrouted.length}{" "}
                {built.unrouted.length === 1 ? "rij gaat" : "rijen gaan"} naar
                geen enkele connector
              </span>
              {plan.discriminatorColumn && (
                <>
                  {" "}
                  —{" "}
                  <strong className="font-semibold">
                    {plan.discriminatorColumn}
                  </strong>{" "}
                  is leeg of onbekend op rij{" "}
                  <span className="tabular-nums">
                    {built.unrouted
                      .slice(0, 10)
                      .map((row) => row.rowNumber)
                      .join(", ")}
                    {built.unrouted.length > 10 ? "…" : ""}
                  </span>
                  .
                </>
              )}
            </AmberNotice>
          ),

          /* What a run did, stated as two numbers and then the refusals by name.
             AFAS's own words per record: a rejection is nearly always a field it
             can name, and paraphrasing it here would lose the only thing that
             fixes it. */
          sendError && <AmberNotice key="send-error">{sendError}</AmberNotice>,
          progressNote &&
            (progressNote.ok ? (
              <GreenNotice key="progress">{progressNote.text}</GreenNotice>
            ) : (
              <AmberNotice key="progress">{progressNote.text}</AmberNotice>
            )),
          /* Only once the run has settled. While it is going these counts are
             partial — "3 records aangemaakt" over a run of 265 is true and
             useless — and the progress strip is already saying it better. */
          outcome && !running && outcome.failed === 0 && missingCount === 0 && (
            <GreenNotice key="sent">
              {outcome.sent} {outcome.sent === 1 ? "record" : "records"}{" "}
              {isDeleteRun(outcome)
                ? `verwijderd uit ${outcome.environment}`
                : `aangemaakt in ${outcome.environment}`}
              .
              {/* A clean step still has a report worth having once it completes a
                  module sent in steps: the combined one, every step in one PDF. */}
              {stepsToReport && (
                <button
                  type="button"
                  onClick={downloadRefusals}
                  disabled={reporting || marking}
                  title={`Verzendrapport (PDF) van alle ${stepsToReport.length} stappen downloaden${
                    canMarkSheet ? ", met het Excel van de weigeringen" : ""
                  }`}
                  className="ml-3 inline-flex cursor-pointer items-baseline gap-1 font-semibold hover:text-k-green-fg disabled:cursor-wait disabled:opacity-60"
                >
                  {reporting || marking ? (
                    <Loader2 className="h-4 w-4 shrink-0 self-center animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Download className="h-4 w-4 shrink-0 self-center" strokeWidth={1.8} />
                  )}
                  Verzendrapport
                </button>
              )}
            </GreenNotice>
          ),
          outcome && !running && (outcome.failed > 0 || missingCount > 0) && (
            <AmberNotice key="send-failed">
              <span className="font-semibold">
                {outcome.sent}{" "}
                {isDeleteRun(outcome) ? "verwijderd" : "aangemaakt"}
                {outcome.failed > 0 && `, ${outcome.failed} geweigerd`}
                {/* Held back before the send: something they look up (the
                    debiteur, the project) isn't in this environment. */}
                {missingCount > 0 && `, ${missingCount} niet verstuurd`}
              </span>{" "}
              in {outcome.environment}.
              {/* One line: the counts, then two quiet actions. The refusals live
                  in a dialog — listed here, forty of them pushed the payload off
                  the screen — and one download carries both files: the PDF says
                  what AFAS refused and why, the Excel is the sheet to fix. */}
              <button
                type="button"
                onClick={() => setRefusalsOpen(true)}
                title={
                  missingCount > 0
                    ? "Weigeringen en niet verstuurde records weergeven"
                    : "Alle weigeringen weergeven"
                }
                className="ml-3 inline-flex cursor-pointer items-baseline gap-1 font-semibold hover:text-k-amber-fg"
              >
                <List className="h-4 w-4 shrink-0 self-center" strokeWidth={1.8} />
                Bekijk
              </button>
              <button
                type="button"
                onClick={downloadRefusals}
                disabled={reporting || marking}
                title={
                  canMarkSheet
                    ? "Verzendrapport (PDF) en Excel met de weigeringen en niet verstuurde records downloaden"
                    : "Verzendrapport (PDF) downloaden"
                }
                className="ml-3 inline-flex cursor-pointer items-baseline gap-1 font-semibold hover:text-k-amber-fg disabled:cursor-wait disabled:opacity-60"
              >
                {reporting || marking ? (
                  <Loader2 className="h-4 w-4 shrink-0 self-center animate-spin" strokeWidth={1.8} />
                ) : (
                  <Download className="h-4 w-4 shrink-0 self-center" strokeWidth={1.8} />
                )}
                Download
              </button>
            </AmberNotice>
          ),

          /* Reading the environment, and what came back. A failed read is stated
             rather than hidden: without it every record shows as unmarked, and an
             admin who expected marks has to be told why there are none —
             otherwise "no badge" silently reads as "all new". */
          /* The cause, over the symptoms. While this stage has no credentials the
             two notices below are suppressed entirely: both would be describing
             the same gap from the far end of a failed call, in AFAS's words
             rather than in the words of the form somebody still has to fill in. */
          hasStageNotice && (
            <AfasStageNotice key="stage" project={selectedProject} stage={stage} />
          ),
          plan.existing && stageConfigured && existingError && (
            <AmberNotice key="existing-error">
              <span className="font-semibold">
                Kon niet ophalen welke records al in AFAS staan
              </span>{" "}
              — {existingError} Er wordt niets gemarkeerd; versturen maakt alles
              aan als nieuw record.
            </AmberNotice>
          ),
          plan.existing &&
            stageConfigured &&
            existing &&
            !existing.available && (
              <AmberNotice key="existing-unavailable">
                <span className="font-semibold">
                  {existing.connector} is niet beschikbaar in{" "}
                  {existing.environment}
                </span>{" "}
                — {existing.message} Zolang die connector ontbreekt kan de tool
                niet zien wat er al bestaat; versturen maakt alles aan als nieuw
                record.
              </AmberNotice>
            ),
        ]}
      />

      {/* The filter, over the list it narrows and above the split it spans. It comes
          **after** the existing-records card and before the columns because that is
          the order the decisions are made in: which environment and what to do with
          records already there, then which records at all, then each one. */}
      {SHOW_PAYLOAD_FILTER && payloads.length > 0 && (
        <PayloadFilterBar
          filters={filters}
          fields={built?.fields ?? NO_FIELDS}
          matched={filtered.length}
          total={payloads.length}
          onChange={changeFilter}
          onAdd={addFilter}
          onRemove={removeFilter}
          onClear={clearFilters}
        />
      )}

      <div className="flex min-h-0 flex-1 gap-4 max-lg:flex-col max-lg:gap-3">
        {/* The records. A real list rather than a stepper: the question here is
            "does every row come out right", which means scanning them, not paging.

            **Stays in focus mode**, unlike the two panels outside this component.
            Those are ways of reaching a sheet; this is part of reading the one
            already open — the set the payload on the right is one of, and the only
            place to pick another. Full screen is for seeing more of that sheet, and
            288 records is as much "the sheet" as the body beside them. */}
        <div className="flex w-72 shrink-0 flex-col rounded-2xl bg-k-bg shadow-raised max-lg:min-h-0 max-lg:w-full max-lg:flex-1">
          <div className="flex shrink-0 items-center gap-2 border-b border-k-divider px-3 py-2">
            <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-k-text-secondary">
              Records
            </p>
            {/* The counts that stood here — ticked, already in AFAS, with errors —
                are the toolbar's figures now (`onMetrics`), where the validation's
                stand in the Data view. */}
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
            {/* *Fouten verbergen* — a filter and nothing more: those records are
                out of the send either way, so the switch only decides whether the
                list shows them. Offered while there is something to hide, or while
                it is on, so it can always be switched back. */}
            {(faultyCount > 0 || hideFaulty) && (
              <ToolbarButton
                onClick={() => setHideFaulty((on) => !on)}
                active={hideFaulty}
                trailing
                label={
                  hideFaulty
                    ? "Records met fouten verborgen"
                    : "Records met fouten verbergen"
                }
              >
                <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              </ToolbarButton>
            )}
            {/* *Alleen nieuwe* lives on the list because it decides what the list
                is: on, the records AFAS already holds leave it (and so the send);
                off, they stay and are updated (PUT). Only while the existence read
                came back — without it nothing is marked, and the switch would
                promise a filter the panel cannot apply. */}
            {/* Kept while the next environment is read, too — the setting is the
                admin's, not the read's, and it applies as soon as the marks arrive. */}
            {plan.existing && (existing?.available || existingLoading) && (
              <ToolbarButton
                onClick={() => setMode((m) => (m === "new" ? "all" : "new"))}
                active={mode === "new"}
                trailing
                label={
                  mode === "new"
                    ? "Alleen nieuwe — bestaande records verborgen"
                    : "Alleen nieuwe — bestaande records verbergen"
                }
              >
                <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              </ToolbarButton>
            )}
            {/* *Herstellen* — the existing records only, each re-sent with the
                objects and actions chosen in the card above the body. Not for a
                custom module, which only ever updates already, and only while the
                read came back: without marks there is nothing it could repair. */}
            {plan.existing && !custom && existing?.available && (
              <ToolbarButton
                onClick={() => setMode((m) => (m === "repair" ? "new" : "repair"))}
                active={mode === "repair"}
                trailing
                label={
                  mode === "repair"
                    ? "Herstellen — bestaande records opnieuw versturen per onderdeel"
                    : "Herstellen: bestaande records opnieuw versturen per onderdeel"
                }
              >
                <Wrench className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              </ToolbarButton>
            )}
            </span>
          </div>
          {/* The search, between the counts and the list it narrows. Any field,
              substring, case-insensitive, with AFAS's `a;b` and `!a` (`matchesSearch`)
              — and like the filter,
              what it hides is out of the send, which the line above then says. */}
          <div className="shrink-0 border-b border-k-divider px-3 py-2">
            <CompactSearch
              value={search}
              onChange={setSearch}
              placeholder="Zoek in alle velden…"
              label="Zoek in alle velden"
              title="waarde1;waarde2 zoekt op een van beide, !waarde sluit uit"
            />
          </div>
          {/* Select-all sits **in the list's own header row**, above the first record
            and aligned with the boxes under it, so it reads as the column's switch
            rather than as one more toolbar button somewhere else on the screen. */}
          <label
            className={`flex shrink-0 cursor-pointer items-center gap-2.5 border-b border-k-divider px-3 py-2 text-sm transition-colors hover:bg-k-tint ${
              visible.length === 0 ? "pointer-events-none opacity-50" : ""
            }`}
          >
            <Checkbox
              checked={allChosen}
              // Some but not all: the box shows a dash rather than on or off, which
              // is the honest state and the only one that doesn't lie about what a
              // press is about to do.
              indeterminate={chosen.length > 0 && !allChosen}
              onChange={toggleAll}
              disabled={visible.length === 0}
            />
            <span className="font-medium text-k-text-primary">Alles selecteren</span>
          </label>
          {/* Faint dividers between the records: at two lines each, a badge line
              could otherwise be read as belonging to the title below it. */}
          <div className="min-h-0 flex-1 divide-y divide-k-divider overflow-y-auto overflow-x-hidden p-1.5">
            {/* A filter that matches nothing is a finding, not an empty rail: the
              records are still there and the reason they are not is the condition
              above, so the list names it rather than looking like a failed build. */}
            {visible.length === 0 && hideFaulty && faultyCount > 0 && !filtering && (
              <p className="px-2 py-3 text-sm text-k-text-secondary">
                Alle records hebben fouten en zijn verborgen. Zet de knop
                hierboven uit om ze te zien.
              </p>
            )}
            {visible.length === 0 && filtering && (
              <p className="px-2 py-3 text-sm text-k-text-secondary">
                Geen enkel record voldoet aan de zoekopdracht. Pas die aan of
                maak het zoekveld leeg.
              </p>
            )}
            {visible.map((payload, index) => (
              <RecordRow
                key={payload.ordinal}
                payload={payload}
                active={payload === current}
                selected={!excluded.has(recordRow(payload))}
                result={resultsByOrdinal.get(payload.ordinal)}
                sent={refusedByOrdinal.get(payload.ordinal)}
                match={badges.get(payload.ordinal) ?? UNKNOWN_MATCH}
                errors={invalid.get(payload.ordinal) ?? 0}
                skipped={payload.skipped !== null || isFaulty(payload)}
                index={index}
                onSelect={setSelected}
                onToggle={toggle}
              />
            ))}
          </div>
        </div>

        {/* The body itself. Below `lg`: its header only, above the records — see
            the note at the top of this return. */}
        <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-k-bg shadow-raised max-lg:order-first max-lg:flex-none">
          <div className="flex shrink-0 items-center gap-4 border-b border-k-divider px-4 py-2.5 max-lg:flex-wrap max-lg:gap-3 max-lg:border-b-0 max-lg:py-3">
            <span className="flex min-w-0 items-center gap-2.5 max-lg:hidden">
              <span className="min-w-0">
                <p className="truncate text-sm font-semibold text-k-text-primary">
                  {current ? current.connector : moduleLabel}
                </p>
                {/* Which record this body is, and where it sits in the sheet. The
                    selection and existence counts are **not** repeated here: the
                    rail beside it carries them in every mode, and the same numbers
                    twice a few hundred pixels apart read as two different facts. */}
                {current && (
                  <p className="truncate text-xs text-k-text-secondary">
                    {current.variant.label} · rij{" "}
                    <span className="tabular-nums">
                      {current.rowNumbers.join(", ")}
                    </span>
                  </p>
                )}
              </span>
            </span>
            {/* Everything but the name, on the name's own row: the toggles and tools
                straight after it, the send button pushed to the far right. One row,
                never wrapped: the name truncates first. The toggles carry no Omgeving/Stap caption: their own words
                already say what they switch (the groups keep it as aria-label). */}
            <span className="flex flex-1 items-center gap-3 max-lg:flex-wrap">
            {/* Where the records actually go, and the press that sends them, on the
                same row as the record's name. The environment switch is a
                segmented control rather than a dropdown: two options, both worth
                reading without opening anything, and which one is armed is the
                single most important fact on this screen. */}
            <span className="flex items-center gap-3">
              {/* Before the environment: the steps run in order, so *which call* is
                  read first and *where does it go* after it. A segmented
                  control for the same reason the stage switch is one — two options,
                  both worth reading, and which is armed decides what the button
                  below sends. Absent for every single-phase module, which is all but
                  these two. */}
              {stepToggle}
            <span className="flex items-center gap-2.5">
              <span role="group" aria-label="Omgeving" className="flex h-9 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm pointer-coarse:h-11">
                {SEND_STAGES.map((option) => {
                  const on = stage === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setStage(option.id)}
                      aria-pressed={on}
                      className={`flex h-8 cursor-pointer items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-[box-shadow,color] duration-200 pointer-coarse:h-10 ${
                        on
                          ? // Live is the app's one red control: it is the only
                            // switch here whose setting can't be undone, and cloud-blue
                            // is the colour of every other active state in the app.
                            option.id === "live"
                            ? "bg-k-bg text-k-red-fg shadow-raised-xs"
                            : "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                          : "rounded-full text-k-text-tertiary hover:text-k-text-primary"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </span>
            </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {/* The two tools about the body on screen — none on a phone, which
                  doesn't show it. `contents` keeps them items of this row here. */}
              <span className="contents max-lg:hidden">
              <ToolbarButton
                onClick={() => current && copy(payloadJson(current.lines))}
                label={copied ? "Gekopieerd" : "Kopieer JSON"}
                trailing={!current}
              >
                {copied ? (
                  <Check
                    className="h-4 w-4 shrink-0 text-k-green-fg"
                    strokeWidth={2}
                  />
                ) : (
                  <Copy className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                )}
              </ToolbarButton>
              {/* This connector's own mapping — the question the payload on the left
                  raises ("why is that field empty / why that value?") is answered
                  there and nowhere else, and reaching it through the sidebar means
                  arriving at whichever connector sorts first and picking this one out
                  of the rail by hand.

                  **In a dialog, not a navigation.** The mapping is opened to explain
                  the payload behind it, so the payload has to still be there when it
                  closes — and leaving the module page would unmount the uploader,
                  drop the workbook and (rightly) raise the leave prompt over a sheet
                  nobody is leaving. */}
              {current && (
                <ToolbarButton
                  onClick={() => setMappingOpen(current.variant.mappingId)}
                  label={`Koppeling van ${current.connector} openen`}
                  trailing
                >
                  <Braces className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                </ToolbarButton>
              )}
              </span>
              {/* How much of the sheet this stage already holds, onto the module's
                  deeltaak — the figure the badge shows, without sending a record.
                  Never on a custom module: it only adds fields to the parent's
                  records, and a send of one doesn't stamp either. */}
              {!custom && (
                <ToolbarButton
                  onClick={() => void pushProgress()}
                  disabled={progressPushing || progressBlocked !== null}
                  label={
                    progressPushing
                      ? "Voortgang wordt naar AFAS gestuurd…"
                      : progressBlocked
                        ? `Voortgang naar AFAS sturen — ${progressBlocked}`
                        : `Voortgang naar AFAS sturen · ${inAfasRows} van ${sheetRowCount} rijen in ${
                            stage === "live" ? "live" : "test"
                          }`
                  }
                  trailing
                  adminOnly
                >
                  {progressPushing ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <CloudUpload className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  )}
                </ToolbarButton>
              )}
            </span>
            {running ? (
              // While a run is going the send button *is* the stop button, in the
              // same place: a second send is the one thing that press must not do,
              // and stopping is the one thing somebody watching a run of refusals
              // wants. No confirm — stopping only ever writes less. The record in
              // flight still finishes (see `payload_send._execute`), hence *Stoppen…*
              // until it has.
              <button
                type="button"
                onClick={() => void requestStop()}
                disabled={stopping || stopPressed}
                // Worded for the run it stops: after a delete it is what is *already
                // gone* that stays gone, not what was written that stays written.
                title={
                  isDeleteRun(outcome)
                    ? "Stoppen na het record dat nu verwijderd wordt — wat al weg is, blijft weg"
                    : "Stoppen na het record dat nu verstuurd wordt — wat al in AFAS staat blijft staan"
                }
                // Full width on a phone, where it is the screen's one big target.
                className="neu-action-danger ml-auto shrink-0 gap-2 pointer-coarse:h-11 max-lg:ml-0 max-lg:w-full max-lg:justify-center"
              >
                {stopping || stopPressed ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Square className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                )}
                {stopping || stopPressed
                  ? "Stoppen…"
                  : isDeleteRun(outcome)
                    ? "Stop verwijderen"
                    : "Stop verzending"}
              </button>
            ) : (
            <span className="ml-auto flex shrink-0 items-center gap-2 max-lg:ml-0 max-lg:w-full">
            {/* *Verwijderen* beside the send, never instead of it, and in the
                `DANGER` outline rather than a filled red: it is the rarer press, and
                the one that must not be the eye's first stop. Only on a module whose
                existing records can be removed, and only the ticked ones marked
                *Bestaat al* — the count says how many. */}
            {canDelete && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={
                  deleting || starting || deletable.length === 0 || !stageConfigured
                }
                title={
                  hideExisting
                    ? "Zet Alleen nieuwe uit om bestaande records te verwijderen"
                    : deletable.length === 0
                    ? "Geen van de geselecteerde records staat in AFAS"
                    : `Verwijder ${deletable.length} bestaande records uit ${stage === "live" ? "live" : "test"}`
                }
                aria-label={`Verwijder ${deletable.length} uit ${stage === "live" ? "live" : "test"}`}
                className="neu-action-danger shrink-0 gap-2 pointer-coarse:h-11"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                )}
                {deletable.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              // An unconfigured stage is a press that can only fail — and fail
              // after the confirm dialog, which is the one place a send is meant to
              // be irreversible-looking rather than impossible. The notice above
              // says why; the button just refuses.
              //
              // `running` is the new one: while this module has a send going, a
              // second press would be the same records a second time. The backend
              // refuses it too (409), but the button should not be offering it.
              disabled={
                starting ||
                running ||
                outgoing.length === 0 ||
                !stageConfigured
              }
              title={
                running
                  ? "Er loopt al een verzending voor deze module"
                  : !stageConfigured
                    ? `Voor de ${stage === "live" ? "live-omgeving" : "testomgeving"} zijn geen AFAS-inloggegevens opgeslagen`
                    : sendLabel
              }
              aria-label={sendLabel}
              // Cloud-blue in both environments. The red that marks *live* stays on
              // the environment switch, where the choice is actually made; a red
              // send button restated it on the press rather than on the setting,
              // and the confirm dialog is what guards the irreversible half.
              // On a phone it fills the row: the press the whole view is there for.
              className="neu-action-commit shrink-0 gap-2 pointer-coarse:h-11 max-lg:flex-1 max-lg:justify-center"
            >
              {starting ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin"
                  strokeWidth={1.8}
                />
              ) : (
                <Send className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              )}
              {/* The count is what this mode would actually send, not what is
                  ticked: in *Alleen nieuwe* the existing records stay ticked (the
                  admin's choice) but do not go, and a button promising to send them
                  would be lying about the press. The phase and the environment are
                  in the tooltip and on the toggles beside it. */}
              Verzenden
              <span className="tabular-nums text-k-bg/80">{outgoing.length}</span>
            </button>
            </span>
            )}
            </span>
          </div>

          {/* How far the send has got, under the controls that started it and above
              the payload it is sending — the one place on this screen that is about
              the run rather than about the records. Present for a finished run too,
              until it is dismissed: "did that go through" is asked after the fact
              far more often than during. */}
          {outcome && (
            <div className="shrink-0 px-3 pb-3">
              <SendProgress
                run={outcome}
                onDismiss={() => clearRun(runModuleId)}
                onReport={downloadReport}
                reporting={reporting}
                onMarkedSheet={canMarkSheet ? downloadRefusedSheet : undefined}
                markingSheet={marking}
              />
            </div>
          )}

          {/* One element per line, so a filled field can name its column beside it.
              The note is **not** in the JSON — a body with a comment in it is not a
              body AFAS takes, and the copy button hands over exactly the text on the
              left of these arrows, which is also what the send posts. */}
          {mode === "repair" && built && (
            <div className="shrink-0 px-3 pb-3">
              <RepairChooser
                objects={built.objects}
                plan={repair}
                onChange={setRepair}
                disabled={running}
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto p-4 max-lg:hidden">
            {current ? (
              <pre className="text-xs leading-relaxed text-k-text-primary">
                <code>
                  {current.lines.map((entry, index) => (
                    <span key={index} className="block whitespace-pre">
                      {entry.text}
                      {/* The column each value came from, always shown. It is the
                          only thing tying a four-letter AFAS field code back to
                          the sheet the reader knows, so it is what the payload is
                          read *for* rather than an extra. Never in the JSON
                          itself: a body with a comment in it is not a body AFAS
                          takes, and the copy button hands over exactly the text
                          left of these arrows. */}
                      {entry.note && (
                        <span className="text-k-cloud-deep">
                          {"   ← "}
                          {entry.note}
                        </span>
                      )}
                    </span>
                  ))}
                </code>
              </pre>
            ) : (
              <p className="text-sm text-k-text-secondary">
                Geen rij van dit blad komt bij een connector uit.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
