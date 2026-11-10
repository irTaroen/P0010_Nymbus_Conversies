"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Asterisk,
  Braces,
  Check,
  Copy,
  Equal,
  Filter,
  Link2,
  Loader2,
  Save,
  Trash2,
  Unlink,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { ModalCloseButton } from "@/components/Modal";
import { GuardedLink } from "@/components/NavigationGuard";
import ConnectorRail from "@/components/afas/ConnectorRail";
import ExcelColumnsPanel from "@/components/afas/ExcelColumnsPanel";
import SchemaObjectSection, {
  AUTO_BADGE,
  AUTO_ICONS,
  useAutoLabel,
  type FieldMappingApi,
} from "@/components/afas/SchemaObjectSection";
import { AmberNotice } from "@/components/uploader/Notices";
import { ApiError } from "@/lib/api";
import {
  countSchema,
  fieldsOf,
  objectPath,
  objectsOf,
  type AfasSchemaObject,
  fetchUpdateConnectors,
  fetchUpdateSchema,
  filterSchema,
  payloadJson,
  payloadLines,
  type AfasConnectorGroup,
  type AfasSchemaEnvironment,
  type AfasUpdateSchema,
} from "@/lib/afas-schema";
import {
  buildMappingExport,
  clientMappingKey,
  columnFields,
  deleteStoredMapping,
  distinctColumnValues,
  fetchStoredMappings,
  fieldKey,
  fieldValues,
  fromMappingExport,
  groupDisagreements,
  groupOfRow,
  groupRows,
  groupShape,
  mappingKey,
  moduleMappingKey,
  remapToSheet,
  saveStoredMapping,
  sourceCounts,
  type FieldMapping,
  type FieldSource,
  type StoredMapping,
} from "@/lib/field-mapping";
import {
  deleteClientMapping,
  fetchClientMappingProjects,
  fetchProjectUpdateSchema,
  saveClientMapping,
  type ClientMappingProject,
} from "@/lib/client-mapping";
import { parseExcelFile, type ParsedWorkbook } from "@/lib/excel";
import { useLocale, useT } from "@/lib/i18n";
import { autoFieldRules, type AutoFieldKind, type AutoFieldRules } from "@/lib/module-phases";
import { moduleOfMapping } from "@/lib/module-payloads";
import { formatCheckedAt } from "@/lib/project-progress";
import { HOME_PATH, projectPath } from "@/lib/routes";
import CompactSearch from "@/components/CompactSearch";

/** The shape every control on this page shares, per nymbus-styling.md: one 36px pill. */
const BTN_BASE =
  "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full text-sm font-medium transition-[box-shadow,color] duration-200";

/** The quiet raised tone this page is built from: `neu-button` lifts on hover and handles disabled. */
const QUIET_TONE = "neu-button";

/** Its pressed twin — the inset well a toggle sits in while it is on. No `neu-button` here, so it doesn't lift. */
const ACTIVE_TONE = "bg-k-bg text-k-cloud-deep shadow-inset-sm";

const QUIET_BTN = `${BTN_BASE} ${QUIET_TONE} gap-1.5 px-3`;
const ACTIVE_BTN = `${BTN_BASE} ${ACTIVE_TONE} gap-1.5 px-3`;

/**
 * The same two as **square icon buttons**, for the toolbar over the tree: label,
 * filter, mapping actions and the view switcher have to stand on one row beside a
 * search box, and three words' worth of button is what pushed the switcher onto a
 * second. Each carries its label in `title` *and* `aria-label` — an icon-only button
 * without both is a button only its author can read.
 */
const QUIET_ICON_BTN = `${BTN_BASE} ${QUIET_TONE} w-9 justify-center`;
const ACTIVE_ICON_BTN = `${BTN_BASE} ${ACTIVE_TONE} w-9 justify-center`;

/**
 * The footer's **Opslaan** — the one primary, labelled button on the page.
 *
 * Everything else here is quiet and raised on purpose: the toolbar is a row of
 * toggles and views, none of which changes anything. Saving does, it is the only
 * thing on the page that does, and it is what the reader came to press. So it gets
 * the primary action and a word rather than an icon, which is also what makes it
 * findable from the payload and mapping tabs without the reader hunting the toolbar
 * for a disk glyph.
 */
const PRIMARY_BTN = "neu-action-primary h-9 shrink-0";

/** What a fetch is doing, for the two panels that each run their own. */
type Loading = "loading" | "ready" | "error";

/** Stable identities for "nothing yet", so the memos below don't churn. */
const NO_GROUPS: AfasConnectorGroup[] = [];
const NO_CLIENT_PROJECTS: ClientMappingProject[] = [];
const NO_MAPPING: FieldMapping = {};

/**
 * The connector list as it was fetched — `groups: null` means the call itself failed
 * and `message` says why. A *group* that failed is not that: it comes back as a group
 * with no connectors and its own message, since the two are read from different
 * environments and one being unreachable says nothing about the other.
 */
type ConnectorListState = {
  groups: AfasConnectorGroup[] | null;
  message: string;
};

/**
 * Every project with at least one module flagged as mapped differently
 * (*Projectinstellingen → Afwijkende koppelingen*) — `projects: null` means the call
 * itself failed. Kept apart from `ConnectorListState`: a different endpoint, on a
 * different lifecycle, and empty is a perfectly normal answer here rather than
 * something to explain.
 */
type ClientListState = {
  projects: ClientMappingProject[] | null;
  message: string;
};

/**
 * What is open: an environment's connector (`group` + `connector`, the two are two
 * AFAS environments and the same connector name in each is a different schema), or
 * a client's own flagged module (`projectId` + `moduleId`, since a project is never
 * one of the two environments — it reads its own AFAS instead). `connector` rides
 * along on the client variant only for display before its schema has loaded; the
 * rail never offers a module whose connector is unknown, so it is never empty here.
 */
/** A client mapping to open on arrival — see `initialClient` on the explorer. */
export interface InitialClientMapping {
  projectId: string;
  projectName: string;
  moduleId: string;
  moduleLabel: string;
  connector: string;
}

type ChosenRef =
  | {
      kind: "connector";
      group: string;
      connector: string;
      /**
       * Which mapping of that connector is open — the `modules` file's own id, or
       * null when the connector *is* the address (`nymbus`, or a `modules`
       * connector nothing has mapped yet).
       *
       * It exists because one connector serves more than one module, so the
       * connector alone cannot say which document is being edited: without it
       * *Crediteuren (Organisatie)* and *Contactpersonen (Crediteur)* — both
       * `KnPurchaseRelationOrg` — open and save as if they were one mapping.
       */
      moduleId: string | null;
    }
  | {
      kind: "client";
      projectId: string;
      projectName: string;
      moduleId: string;
      moduleLabel: string;
      connector: string;
    };

/**
 * One schema, **tagged with what it belongs to** — the same shape `ModuleProvider`
 * keeps its per-project fetch in. Anything tagged with another key is stale by
 * definition, so clicking down the list shows the new one loading instead of the
 * previous one's fields. The tag is `mappingKey` for a connector and
 * `clientMappingKey` for a client module — two disjoint formats, so one map of keys
 * never confuses the two. `environment` is carried here rather than derived from
 * `groups` because a client schema's environment is that **project's** AFAS, which
 * only this fetch knows — a connector schema still gets it from `groups`.
 */
type LoadedSchema = {
  key: string;
  schema: AfasUpdateSchema | null;
  message: string;
  environment: AfasSchemaEnvironment | null;
};

/** The message behind an unknown failure — an `ApiError` already carries its own. */
function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Onbekende fout.";
}

/** How many fields of `object`, nested ones included, the conversion fills itself. */
function countAutoFields(
  object: AfasSchemaObject,
  rules: AutoFieldRules,
  parent = ""
): number {
  const path = objectPath(parent, object.name);
  return (
    fieldsOf(object).filter((field) => rules.fields.has(fieldKey(path, field.fieldId)))
      .length +
    objectsOf(object).reduce((total, child) => total + countAutoFields(child, rules, path), 0)
  );
}

/**
 * The key to a field row's mapping lane, above the tree: what each colour means, so
 * *where does this value come from* is answered by the schema itself — cloud-blue a
 * column, ink a fixed value the admin set, cyan a rule in the code. The cyan entries
 * only for a module that has such rules; a legend for marks that can't appear is
 * noise.
 */
function SourceLegend({ kinds }: { kinds: AutoFieldKind[] }) {
  const t = useT();
  const label = useAutoLabel();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-k-text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-k-bg px-1.5 py-0.5 text-k-cloud-deep shadow-inset-sm">
          <Link2 className="h-3 w-3" strokeWidth={2} />
        </span>
        {t("kolom uit het bestand", "column from the file")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-k-bg px-1.5 py-0.5 text-k-text-primary shadow-inset-sm">
          <Equal className="h-3 w-3" strokeWidth={2.5} />
        </span>
        {t("vaste waarde in de koppeling", "fixed value in the mapping")}
      </span>
      {kinds.length > 0 && (
        <>
          <span className="text-k-text-tertiary" aria-hidden>
            |
          </span>
          <span>{t("Door de conversie zelf:", "By the conversion itself:")}</span>
          {kinds.map((kind) => {
            const Icon = AUTO_ICONS[kind];
            return (
              <span key={kind} className={AUTO_BADGE}>
                <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />
                {kind === "always"
                  ? `${t("Altijd", "Always")} …`
                  : label({ kind })}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * One figure about the connector on screen, printed above its tree. These are the
 * **whole** connector's — every nested object included — where a section header
 * below counts only what opening it shows; the tooltip says so, since 27 velden in
 * the root under 731 velden up here reads as a contradiction otherwise.
 */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="flex items-baseline gap-1.5"
      title={`${value} ${label} in de hele connector, geneste objecten meegeteld`}
    >
      <span className="text-lg font-bold leading-none tabular-nums text-k-text-primary">
        {value}
      </span>
      <span className="text-xs text-k-text-secondary">{label}</span>
    </span>
  );
}

/**
 * The UpdateConnector explorer, in three panes that each scroll on their own:
 * **the connectors** to pick from, **the sheet's columns** once a template is
 * dropped, and **the connector's fields** — a collapsible section per object, one
 * row per field, with the body it produces behind the **JSON** tab.
 *
 * The middle pane is the source of the mapping and sits beside its target on
 * purpose: a column is dragged sideways onto a field, one short move between two
 * lists that both stay where they were. (It was a table of rows across the top, and
 * a 78-column sheet scrolling sideways over fields scrolling down meant half the
 * drags started with the target off screen.)
 *
 * It exists because every module is going to hand AFAS a payload, and CLAUDE.md's
 * rule for those is *never guess*: the shape has to come from
 * `metainfo/update/{connector}`. Reading that by hand means a REST call and a 300 KB
 * JSON file (`KnSubject` alone carries 63 nested objects), which is exactly the kind
 * of reading a page does better than a person.
 *
 * The connector rail is [`ConnectorRail`](./ConnectorRail.tsx): **two groups, because
 * there are two environments, both Nymbus's own** — *Nymbus* is the live app connector
 * this tool writes the dossier and the workflow through, *Modules* the conversion
 * connectors a module's sheet is mapped onto, split there into HRM and ERP. Neither
 * list is hardcoded; both are whatever `metainfo` answers with, so a connector added in
 * AFAS appears without a code change. A group that can't be read says so under its own
 * heading and leaves the other one working.
 *
 * **There is no client to choose here, on purpose.** The module connectors live in
 * Nymbus's *test* environment because that environment is the **template**: every
 * customer environment is a copy of it, so the schema is the same everywhere and the
 * mapping made on this page — once per connector — is the one used to write records
 * into all of them. A customer whose mapping has to deviate is the exception, flagged
 * in that project's settings and kept as a copy of its own (docs/todo.md); it is an
 * exception to the mapping, not to where the schema is read.
 *
 * Two things it puts in front of the reader on purpose:
 *   - **The root key where it differs from the connector id**, under the title. It is
 *     `KnReaction` for `KnSubjectReaction`, and a body built on the connector name
 *     instead is the single most common way an AFAS call fails. Where the two are the
 *     same the tree's own root section already carries it, so nothing is said twice.
 *   - **Which environment answered**, in the header, following the open connector's
 *     group — the same connector name in another environment is a different schema,
 *     which is why a connector is addressed as group + id throughout, the stored
 *     mapping included.
 *
 * Admin-only by placement — the page gates it — and the backend checks again.
 *
 * `fromProjectId` is the project whose sidebar linked here (`updateConnectorsPath`,
 * read back from the `from` query param by the page) — where the header's "terug"
 * arrow returns to. Null when there wasn't one (a bookmark, a typed-in address), in
 * which case it falls back to `HOME_PATH` like before.
 */
export default function UpdateConnectorExplorer({
  fromProjectId,
  initialConnector,
  initialModuleId,
  initialClient,
  onClose,
  onSaved,
}: {
  fromProjectId: string | null;
  /**
   * A `modules` connector to open on arrival instead of the first one in the list —
   * `?connector=` on the address, set by the payload view's *Koppeling* button so it
   * lands on the connector whose body was on screen.
   *
   * It seeds `chosen` rather than being held as a separate "initial" state: from the
   * first render it *is* the reader's choice, so clicking another connector replaces
   * it like any other and the URL doesn't have to be rewritten to stay honest.
   */
  initialConnector?: string | null;
  /**
   * A `modules` **mapping** to open on arrival — the payload view's *Koppeling*
   * button, which knows which of a split module's two files produced the body on
   * screen. Takes precedence over `initialConnector`, which can only name the
   * connector the two share and so cannot tell them apart.
   */
  initialModuleId?: string | null;
  /**
   * A **client** mapping to open on arrival — the payload view's *Koppeling* button
   * on a custom module (maatwerk), whose mapping lives in the client section and whose
   * schema is that project's own. Takes precedence over both of the above.
   */
  initialClient?: InitialClientMapping | null;
  /**
   * Close the explorer instead of linking back out of it — passed when it is opened
   * **inside a dialog** (the payload view's *Koppeling* button) rather than as its
   * own page.
   *
   * It swaps the header's back-arrow for a close button and nothing else: the whole
   * explorer below is the same component either way, so the mapping opened over a
   * sheet is the mapping page, not a reduced copy of it that could drift from the
   * real one.
   *
   * A save is reported through `onSaved` instead, not through this: the dialog can
   * also be dismissed with Esc or the backdrop, which never reaches this handler.
   */
  onClose?: () => void;
  /**
   * Called the moment a mapping is stored, for a caller that derives from it — the
   * payload view, whose bodies were built from the mapping this explorer just
   * rewrote. Separate from `onClose` because the two answer different questions and
   * a dialog can be dismissed by Esc or the backdrop without `onClose` running here
   * at all; reporting the save when it happens is what makes those paths agree.
   */
  onSaved?: () => void;
}) {
  const { session } = useAuth();
  // Who is asking, as a string: the fetches below re-run when that changes (a sign-in,
  // an impersonation), not on every new session object — a reload or a session-store
  // write would otherwise refetch every list and collapse the open schema tree.
  const viewer = session?.user.email ?? null;
  const backHref = fromProjectId ? projectPath(fromProjectId) : HOME_PATH;
  const backLabel = fromProjectId
    ? "Terug naar project"
    : "Terug naar projecten";

  const [list, setList] = useState<ConnectorListState | null>(null);
  const [clientList, setClientList] = useState<ClientListState | null>(null);
  const [loaded, setLoaded] = useState<LoadedSchema | null>(null);
  // What the reader picked; null until they do, so the first connector in AFAS's own
  // order is derived rather than written into state the moment the list arrives.
  // Seeded from `?connector=` when the address named one — always in the `modules`
  // group, the only one a module's payload can be built from.
  // A mapping id names one file and so is preferred; `?connector=` can only name the
  // connector a split module's two halves share, and is kept for an address typed or
  // bookmarked before the page addressed mappings by module.
  const [chosen, setChosen] = useState<ChosenRef | null>(
    initialClient
      ? { kind: "client", ...initialClient }
      : initialModuleId
      ? {
          kind: "connector",
          group: "modules",
          connector: "",
          moduleId: initialModuleId,
        }
      : initialConnector
        ? {
            kind: "connector",
            group: "modules",
            connector: initialConnector,
            moduleId: null,
          }
        : null,
  );

  // The template being mapped, and where the mapping stands. Session edits
  // (`mappings`) are kept under one key regardless of kind — `mappingKey` and
  // `clientMappingKey` are disjoint formats, so a connector's edits and a client
  // module's never collide in the same map — so clicking through the list to
  // compare two doesn't throw work away.
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [fileError, setFileError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [exampleRow, setExampleRow] = useState(0);
  const [mappings, setMappings] = useState<Record<string, FieldMapping>>({});
  // What the store has, per connector — where a mapping comes back from after a
  // refresh, and what "unsaved changes" is measured against.
  const [storedDocs, setStoredDocs] = useState<Record<string, StoredMapping>>(
    {},
  );
  // The same, for a client's own copies — kept apart because `clientMappingKey`
  // (project + module) and `mappingKey` (group + connector) are different addresses.
  const [clientDocs, setClientDocs] = useState<Record<string, StoredMapping>>(
    {},
  );
  // Which module ids each `modules`-group connector serves — for the rail, which
  // labels a row by module rather than by raw connector id.
  const [connectorModules, setConnectorModules] = useState<
    Record<string, string[]>
  >({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // The column waiting for a field: picked by click, or held by a drag.
  const [picked, setPicked] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const [query, setQuery] = useState("");
  const [onlyMandatory, setOnlyMandatory] = useState(false);
  const [view, setView] = useState<"tree" | "json" | "mapping">("tree");
  // Whether the payload names the column behind each filled value. On by default:
  // with a mapping on screen, "which column is this" is the question being asked.
  const [showNotes, setShowNotes] = useState(true);
  // Whether the payload is narrowed to the mapped fields (with their objects). Also
  // on by default, and both only bite once something is mapped.
  const [onlyMapped, setOnlyMapped] = useState(true);
  // Which object paths the reader opened. Null until a schema arrives, and then the
  // root and nothing else — `KnSubject` would otherwise unfold 63 sections at once.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const groups = list?.groups ?? NO_GROUPS;
  const listState: Loading = !list
    ? "loading"
    : list.groups
      ? "ready"
      : "error";
  const clientProjects = clientList?.projects ?? NO_CLIENT_PROJECTS;
  const clientListState: Loading = !clientList
    ? "loading"
    : clientList.projects
      ? "ready"
      : "error";

  // The open thing, as a client module (if that is what was picked) — everything
  // below branches on this rather than on `chosen.kind` directly, so a stray branch
  // can't drift out of sync with it.
  const activeClient = chosen?.kind === "client" ? chosen : null;

  // The open connector: the reader's choice, or the first one any group offers, but
  // only when nothing (or a client module) is open — a client selection must not
  // fall back to "the first connector" the moment its own fields are read. Kept as
  // two strings rather than one object — an object rebuilt every render would make
  // the schema effect below refetch forever.
  const firstGroup = groups.find((group) => group.connectors.length > 0);
  const selectedGroup =
    chosen?.kind === "connector"
      ? chosen.group
      : !chosen
        ? (firstGroup?.id ?? "")
        : "";
  // Which module's mapping is open, when one is — the `modules` group only.
  const selectedModule = chosen?.kind === "connector" ? chosen.moduleId : null;
  const selected =
    chosen?.kind === "connector"
      ? // A selection seeded by module id alone (the payload view's dialog) has no
        // connector yet: the store is what knows which one that module maps onto, so
        // it is read from there once the mappings arrive, and the connector the
        // reader clicked is used whenever there is one.
        chosen.connector ||
        (selectedModule
          ? (storedDocs[moduleMappingKey(selectedModule)]?.connector ?? "")
          : "")
      : !chosen
        ? (firstGroup?.connectors[0]?.id ?? "")
        : "";
  // A `modules` mapping is addressed by module, everything else by connector — the
  // same split the store makes, so the page reads back exactly what a save writes.
  const selectedKey = selectedModule
    ? moduleMappingKey(selectedModule)
    : selected
      ? mappingKey(selectedGroup, selected)
      : "";
  const selectedClientKey = activeClient
    ? clientMappingKey(activeClient.projectId, activeClient.moduleId)
    : "";
  // Whichever of the two is actually open — what the schema cache and the stored
  // mapping are both read back by.
  const openKey = activeClient ? selectedClientKey : selectedKey;

  // The environment behind the open connector — the header names it, because the two
  // groups come from two different AFAS environments. A client module's environment
  // is that project's own, which only its own schema fetch knows (`loaded`, below),
  // never the two Nymbus environments in `groups`.
  const environment = activeClient
    ? loaded?.key === openKey
      ? loaded.environment
      : null
    : (groups.find((group) => group.id === selectedGroup)?.environment ?? null);

  // Anything fetched for another connector (or module) is stale, so a click shows
  // the new one loading rather than the previous one's fields.
  const current = loaded?.key === openKey ? loaded : null;
  const schema = current?.schema ?? null;
  const schemaState: Loading = !current
    ? "loading"
    : current.schema
      ? "ready"
      : "error";

  // The connector list, once. It also names the environment, so the header can say
  // which AFAS answered before any schema is asked for.
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    fetchUpdateConnectors()
      .then((fetched) => {
        if (live) setList({ groups: fetched, message: "" });
      })
      .catch((err: unknown) => {
        if (live) setList({ groups: null, message: errorMessage(err) });
      });
    return () => {
      live = false;
    };
  }, [viewer]);

  // Every project with a module flagged as mapped differently, once — the rail's
  // third section. Independent of the connector list above: a different endpoint,
  // and a failure here says nothing about whether the two environments are reachable.
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    fetchClientMappingProjects()
      .then((fetched) => {
        if (live) setClientList({ projects: fetched, message: "" });
      })
      .catch((err: unknown) => {
        if (live) setClientList({ projects: null, message: errorMessage(err) });
      });
    return () => {
      live = false;
    };
  }, [viewer]);

  // Every stored mapping, once. All of them rather than the open one: the connector
  // list marks which are already mapped, which is the first thing a reader wants to
  // know, and there are as many rows as there are connectors.
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    fetchStoredMappings()
      .then(({ byKey, connectorModules, clientMappings }) => {
        if (live) {
          setStoredDocs(byKey);
          setConnectorModules(connectorModules);
          setClientDocs(clientMappings);
        }
      })
      .catch(() => {
        // A store that can't be read leaves the page fully usable — it just has
        // nothing to start from, and a save will say what went wrong.
      });
    return () => {
      live = false;
    };
  }, [viewer]);

  // The open schema: a connector's, from one of the two Nymbus environments, or a
  // client module's, from that project's own. `live` because a reader clicking down
  // the list outruns the fetches: without it a slow earlier answer lands on a later
  // choice.
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    if (activeClient) {
      const key = selectedClientKey;
      fetchProjectUpdateSchema(activeClient.projectId, activeClient.moduleId)
        .then((fetched) => {
          if (!live) return;
          setLoaded({
            key,
            schema: fetched.schema,
            message: "",
            environment: fetched.environment,
          });
          setExpanded(new Set([fetched.schema.name]));
        })
        .catch((err: unknown) => {
          if (live)
            setLoaded({
              key,
              schema: null,
              message: errorMessage(err),
              environment: null,
            });
        });
    } else if (selected) {
      // Tagged with the open mapping's key, not the connector's: two modules sharing
      // a connector are two selections, and a schema tagged by connector would read
      // as already-loaded when the reader moved between them.
      const key = selectedKey;
      fetchUpdateSchema(selectedGroup, selected)
        .then((fetched) => {
          if (!live) return;
          setLoaded({ key, schema: fetched, message: "", environment: null });
          setExpanded(new Set([fetched.name]));
        })
        .catch((err: unknown) => {
          if (live)
            setLoaded({
              key,
              schema: null,
              message: errorMessage(err),
              environment: null,
            });
        });
    }
    return () => {
      live = false;
    };
  }, [
    viewer,
    selectedGroup,
    selected,
    selectedKey,
    activeClient,
    selectedClientKey,
  ]);

  const sheet = workbook?.sheets[sheetIndex] ?? null;
  const storedDoc =
    (activeClient ? clientDocs[openKey] : storedDocs[openKey]) ?? null;

  // The stored mapping as this page uses it, re-pointed at the sheet on screen —
  // a mapping saved against one copy of the template must survive being opened
  // beside another (`remapToSheet` is the same rule a re-dropped file follows).
  const storedMapping = useMemo(() => {
    if (!storedDoc) return null;
    const restored = fromMappingExport(storedDoc);
    return sheet ? remapToSheet(restored, sheet.headers) : restored;
  }, [storedDoc, sheet]);

  // What is on screen: this session's edits once there are any, the stored mapping
  // until then. Derived rather than copied into state on arrival, so there is no
  // moment where the page shows an empty mapping a fetch is about to fill.
  const mapping = mappings[openKey] ?? storedMapping ?? NO_MAPPING;
  // Filled fields, split by what fills them — the two are different work and the
  // figures above the tree name them apart.
  const counts = useMemo(() => sourceCounts(mapping), [mapping]);
  const mappedCount = counts.columns + counts.fixed;
  // The mapping read backwards, for the column list: which fields each column feeds.
  const fieldsByColumn = useMemo(() => columnFields(mapping), [mapping]);
  // The column a field can receive: the one being dragged, or the one picked by
  // click. A drag wins while it lasts — it is the more specific gesture.
  const active = useMemo(() => {
    const index = dragging ?? picked;
    if (index === null || !sheet) return null;
    return {
      index,
      header: sheet.headers[index] ?? `Kolom ${index + 1}`,
      source: (dragging !== null ? "drag" : "pick") as "drag" | "pick",
    };
  }, [dragging, picked, sheet]);

  // What the tree and the JSON both render: the schema as the filters leave it.
  const filtered = useMemo(
    () => (schema ? filterSchema(schema, { query, onlyMandatory }) : null),
    [schema, query, onlyMandatory],
  );
  const totals = useMemo(() => (schema ? countSchema(schema) : null), [schema]);

  // What the conversion fills, limits or drops **itself**, whatever this mapping says
  // (`module-phases.ts`) — read for the open mapping's sidebar module, so a client
  // copy shows the same rules as the standard mapping it was copied from: both are
  // built by the same code. The locale in the deps because the notes it generates
  // are worded in the reader's language.
  const t = useT();
  const locale = useLocale();
  const rulesMappingId = activeClient ? activeClient.moduleId : selectedModule;
  const autoRules = useMemo(
    () => autoFieldRules(rulesMappingId ? moduleOfMapping(rulesMappingId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` re-words the notes
    [rulesMappingId, locale],
  );
  const autoCount = useMemo(
    () => (schema && autoRules ? countAutoFields(schema, autoRules) : 0),
    [schema, autoRules],
  );
  // The kinds that actually occur in this schema, in the legend's fixed order.
  const autoKinds = useMemo(() => {
    if (!autoRules) return [];
    const present = new Set(
      [...autoRules.fields.values(), ...autoRules.objects.values()].flatMap((rules) =>
        rules.map((rule) => rule.kind),
      ),
    );
    return (["computed", "always", "conditional", "omitted"] as const).filter((kind) =>
      present.has(kind),
    );
  }, [autoRules]);

  // --- Grouping ---------------------------------------------------------------
  // Several rows, one record: what the key columns make of this mapping and of the
  // sheet beside it. All three are null/empty for the twelve modules that don't
  // group, which is what keeps the rest of the page unchanged for them.
  const shape = useMemo(() => groupShape(mapping), [mapping]);
  // `recordGroups`, not `groups` — this page already has connector groups, and the
  // two are unrelated.
  const recordGroups = useMemo(
    () => (shape && sheet ? groupRows(shape.keyColumns, sheet) : null),
    [shape, sheet],
  );
  // The group the example row is in — the one the payload shows, so *Voorbeeld*
  // still picks what is on screen, just a whole offerte instead of one regel.
  const exampleGroup = useMemo(
    () => (recordGroups ? groupOfRow(recordGroups, exampleRow) : null),
    [recordGroups, exampleRow],
  );
  // Kop columns that don't agree across the group. A key column can't disagree (a
  // different value is a different group), so this is exactly the typo that would
  // otherwise be swallowed by taking the first row's value.
  const disagreements = useMemo(
    () =>
      shape && sheet && exampleGroup
        ? groupDisagreements(mapping, shape, sheet, exampleGroup)
        : [],
    [mapping, shape, sheet, exampleGroup],
  );

  // The body, with the mapped fields carrying real values out of the example row —
  // the whole point of the mapping, and the fastest way to see that a column landed
  // in the wrong field. Without a sheet it stays the typed skeleton. Lines rather
  // than a string, so every filled field can name the column it came from.
  //
  // **Alleen gekoppeld** narrows it to the fields that are actually filled, keeping
  // the objects they live in — the body as it is being built, rather than 651 empty
  // fields with three real values somewhere in them. It filters the *payload* only:
  // the tree beside it is how you find the next field to map, and a tree that hid
  // everything unmapped would hide exactly what you are looking for.
  const lines = useMemo(() => {
    if (!schema) return [];
    const narrowed = filterSchema(schema, {
      query,
      onlyMandatory,
      keepField:
        onlyMapped && mappedCount > 0
          ? (path, field) => Boolean(mapping[fieldKey(path, field.fieldId)])
          : undefined,
    });
    if (!narrowed) return [];
    // Grouped, the body is the whole group: the kop read from its first row, and the
    // regel object written once per row as an array (`PayloadRepeat`). Ungrouped it
    // is the example row alone, exactly as before.
    const lineRows = exampleGroup?.rows ?? null;
    if (shape?.linePath && lineRows && sheet) {
      return payloadLines(
        narrowed,
        fieldValues(mapping, sheet, lineRows[0] ?? exampleRow),
        {
          path: shape.linePath,
          count: lineRows.length,
          resolveAt: (index) =>
            fieldValues(mapping, sheet, lineRows[index] ?? exampleRow),
        },
      );
    }
    return payloadLines(narrowed, fieldValues(mapping, sheet, exampleRow));
  }, [
    schema,
    query,
    onlyMandatory,
    onlyMapped,
    mappedCount,
    mapping,
    sheet,
    exampleRow,
    shape,
    exampleGroup,
  ]);
  const json = useMemo(() => payloadJson(lines), [lines]);

  // The mapping as the document that is read, copied and stored — one shape for all
  // three, so what the Koppeling tab shows is exactly what a save sends.
  const mappingDoc = useMemo(
    () =>
      schema
        ? buildMappingExport(
            schema,
            mapping,
            workbook?.fileName ?? "",
            sheet?.name ?? "",
          )
        : null,
    [schema, mapping, workbook, sheet],
  );
  const mappingJson = useMemo(
    () => (mappingDoc ? JSON.stringify(mappingDoc, null, 2) : ""),
    [mappingDoc],
  );

  // Only the fields are compared: `file` and `sheet` follow whichever copy of the
  // template happens to be open, and a different filename is not a change to the
  // mapping. Nothing stored yet counts as changed the moment something is filled.
  const dirty =
    !!mappingDoc &&
    JSON.stringify(mappingDoc.fields) !==
      JSON.stringify(storedDoc?.fields ?? null);

  // A filter has already removed everything it hides, so what is left of the tree is
  // shown open — a search that answers with a row of collapsed sections hasn't
  // answered. Outside a filter the reader's own choices decide.
  const filtering = query.trim() !== "" || onlyMandatory;
  const isOpen = (path: string) => filtering || expanded.has(path);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  /** Re-point every connector's mapping at a (possibly new) sheet's columns, by
   *  header name — the rule a re-dropped file and a switched sheet both follow. */
  function remapAllMappings(headers: string[]) {
    setMappings((current) =>
      Object.fromEntries(
        Object.entries(current).map(([connector, existing]) => [
          connector,
          remapToSheet(existing, headers),
        ]),
      ),
    );
  }

  /** Read a dropped template. The mapping of every connector follows it over. */
  async function readFile(file: File) {
    setParsing(true);
    setFileError("");
    try {
      const parsed = await parseExcelFile(file);
      setWorkbook(parsed);
      setSheetIndex(0);
      setExampleRow(0);
      setPicked(null);
      // Re-point what was already mapped at the new file's columns: the usual
      // reason to drop a file again is that it was edited.
      remapAllMappings(parsed.sheets[0]?.headers ?? []);
    } catch {
      setFileError(
        "Dit bestand kon niet worden gelezen. Gebruik een .xlsx, .xls of .csv.",
      );
    } finally {
      setParsing(false);
    }
  }

  /** Another worksheet of the same workbook — same rule for the mapping. */
  function chooseSheet(index: number) {
    setSheetIndex(index);
    setExampleRow(0);
    setPicked(null);
    remapAllMappings(workbook?.sheets[index]?.headers ?? []);
  }

  /** Write one field's source into the open mapping — connector or client module. */
  function setSource(key: string, source: FieldSource) {
    setMappings((current) => ({
      ...current,
      [openKey]: { ...(current[openKey] ?? mapping), [key]: source },
    }));
  }

  /**
   * What a field row does with a drop, a click, or a typed value. Always provided,
   * not only with a sheet open: a **fixed value** is part of the body whether or not
   * a template has been dropped, and `active` being null is what tells the rows
   * there is no column to receive.
   */
  const fieldMapping: FieldMappingApi = {
    sourceFor: (key) => mapping[key] ?? null,
    assign: (key, index) => {
      if (!sheet) return;
      setSource(key, {
        kind: "column",
        index,
        header: sheet.headers[index] ?? `Kolom ${index + 1}`,
      });
      // The gesture is finished — holding the pick would map the next field too.
      setPicked(null);
    },
    // Already checked against the field's type by `parseFixedValue()` in the editor;
    // this only stores what came back.
    setFixed: (key, value) => setSource(key, { kind: "fixed", value }),
    clear: (key) => {
      setMappings((current) => {
        const next = { ...(current[openKey] ?? mapping) };
        delete next[key];
        return { ...current, [openKey]: next };
      });
    },
    // Only a column can be part of the key — a fixed value is the same on every row,
    // so it would put the whole sheet in one group and identify nothing. Guarded here
    // as well as in the type, since this is where a stray call would land.
    toggleKey: (key) => {
      const source = mapping[key];
      if (source?.kind !== "column") return;
      const { key: wasKey, ...rest } = source;
      setSource(key, wasKey ? rest : { ...rest, key: true });
    },
    columnValues: (key) => {
      const source = mapping[key];
      if (!sheet || source?.kind !== "column") return [];
      return distinctColumnValues(sheet, source.index);
    },
    setValueMap: (key, valueMap) => {
      const source = mapping[key];
      if (source?.kind !== "column") return;
      if (valueMap) {
        setSource(key, { ...source, valueMap });
        return;
      }
      setSource(key, {
        kind: "column",
        index: source.index,
        header: source.header,
        ...(source.key ? { key: source.key } : {}),
        ...(source.lookup ? { lookup: source.lookup } : {}),
      });
    },
    setMultiply: (key, factor) => {
      const source = mapping[key];
      if (source?.kind !== "column") return;
      const next = { ...source, multiply: factor };
      if (factor === undefined) delete next.multiply;
      setSource(key, next);
    },
    setLookup: (key, lookup, column) => {
      const current = mapping[key];
      const from = current?.kind === "column" ? current : null;
      // The column the dialog chose re-points the field; without one (the lookup
      // taken off) it keeps the column it had. The key flag stays with the field, a
      // value map goes — the lookup replaces it, and a field takes one translation.
      const target = column ?? (from ? { index: from.index, header: from.header } : null);
      if (!target) return;
      setSource(key, {
        kind: "column",
        index: target.index,
        header: target.header,
        ...(from?.key ? { key: from.key } : {}),
        ...(lookup ? { lookup } : {}),
      });
    },
    columns: sheet
      ? sheet.headers.map((header, index) => ({
          index,
          header: header || `Kolom ${index + 1}`,
        }))
      : [],
    // A client module's GetConnectors live in its own AFAS, which no group route
    // reads; the template's list names the same `CON_*` connectors.
    lookupGroup: selectedGroup || "modules",
    groupShape: shape,
    active,
  };

  function clearMapping() {
    setMappings((current) => ({ ...current, [openKey]: {} }));
    setPicked(null);
  }

  /** Store this mapping — the same document the Koppeling tab shows — as a
   * connector's standard mapping, or as a client's own copy of a module's. */
  async function saveMapping() {
    if (!mappingDoc) return;
    if (!activeClient && !selected) return;
    setSaving(true);
    setSaveError("");
    try {
      // By module where there is one: `modules` files are keyed by mapping id, and
      // saving under the connector would write a file beside the real ones that
      // nothing reads back — the save would look like it worked and change nothing.
      const saved = activeClient
        ? await saveClientMapping(
            activeClient.projectId,
            activeClient.moduleId,
            mappingDoc,
          )
        : await saveStoredMapping(
            selectedGroup,
            selectedModule ?? selected,
            mappingDoc,
          );
      // Announced before any state is set: from here the store has changed, so a
      // caller deriving from it is stale whatever happens to this component next.
      onSaved?.();
      if (activeClient) {
        setClientDocs((current) => ({ ...current, [openKey]: saved }));
      } else {
        setStoredDocs((current) => ({ ...current, [openKey]: saved }));
      }
      // Drop the session's copy: it and the stored one are the same mapping now, and
      // deriving from the store keeps one of them on screen rather than two equal ones.
      setMappings((current) => {
        const next = { ...current };
        delete next[openKey];
        return next;
      });
    } catch (err: unknown) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Forget the stored copy. What is on screen **stays** on screen, as an unsaved
   * mapping: this button unsaves a mapping, it doesn't throw the work away — that is
   * what *Alles leegmaken* is for, and the two shouldn't be one press apart.
   */
  async function removeStoredMapping() {
    if (!activeClient && !selected) return;
    setSaving(true);
    setSaveError("");
    try {
      if (activeClient) {
        await deleteClientMapping(
          activeClient.projectId,
          activeClient.moduleId,
        );
        setClientDocs((current) => {
          const next = { ...current };
          delete next[openKey];
          return next;
        });
      } else {
        await deleteStoredMapping(selectedGroup, selectedModule ?? selected);
        setStoredDocs((current) => {
          const next = { ...current };
          delete next[openKey];
          return next;
        });
      }
      setMappings((current) => ({ ...current, [openKey]: mapping }));
    } catch (err: unknown) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A blocked clipboard is not worth a failure state — the JSON is on screen.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Page header. As a page there is no sidebar here — this hangs beside the
          project shell rather than inside one — so it carries its own way back, a
          back arrow in the leading corner. As a **dialog** there is nothing to go
          back to: the way out is to shut it, so the control moves to the trailing
          corner and becomes the X every dialog in the app closes with. Two
          different acts, and they don't share a slot. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-k-divider bg-k-bg px-6 py-4">
        {!onClose && (
          <GuardedLink
            href={backHref}
            className="neu-icon-btn shrink-0"
            aria-label={backLabel}
            title={backLabel}
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.8} />
          </GuardedLink>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-k-text-primary">
            <Braces className="h-5 w-5 shrink-0 text-k-cloud-deep" strokeWidth={2} />
            Updateconnectors
          </h1>
          <p className="mt-0.5 text-sm text-k-text-secondary">
            De opbouw van een AFAS-payload: uit de AFAS OAS voor de standaardkoppelingen, uit{" "}
            <code className="font-mono text-xs">metainfo/update</code> van de klant voor maatwerk.
          </p>
        </div>

        {environment && (
          <p className="shrink-0 text-right text-xs text-k-text-secondary">
            <span className="font-medium text-k-text-primary">{environment.host}</span>
            <br />
            {[environment.info.appName, environment.info.envid, environment.info.commit]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {/* Trailing corner, dialog only — see the note on the header. */}
        {onClose && <ModalCloseButton onClose={onClose} />}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The connector list. Narrower than the two panes beside it: it is picked
            from a few times a session, where they are worked in continuously. */}
        <ConnectorRail
          groups={groups}
          state={listState}
          message={list?.message ?? ""}
          selectedKey={selectedKey}
          isStored={(key) => Boolean(storedDocs[key])}
          connectorModules={connectorModules}
          onChoose={(group, connector, moduleId) =>
            setChosen({ kind: "connector", group, connector, moduleId })
          }
          clientProjects={clientProjects}
          clientState={clientListState}
          clientMessage={clientList?.message ?? ""}
          selectedClientKey={selectedClientKey}
          onChooseClient={(projectId, projectName, module) =>
            module.connector &&
            setChosen({
              kind: "client",
              projectId,
              projectName,
              moduleId: module.moduleId,
              moduleLabel: module.moduleLabel,
              connector: module.connector,
            })
          }
        />

        {/* The mapping's two sides, side by side: the sheet's columns and the
            connector's fields. Each scrolls on its own, so a drag stays a short
            move between two lists that both stay where they were. */}
        <ExcelColumnsPanel
          workbook={workbook}
          sheetIndex={sheetIndex}
          onSheetIndex={chooseSheet}
          onFile={readFile}
          onClearFile={() => {
            setWorkbook(null);
            setPicked(null);
          }}
          parsing={parsing}
          error={fileError}
          exampleRow={exampleRow}
          onExampleRow={setExampleRow}
          picked={picked}
          onPick={setPicked}
          onDragColumn={setDragging}
          fieldsByColumn={fieldsByColumn}
        />

        {/* A flex column, not a scroll area: the schema scrolls in the div below and
            the save bar is pinned under it, so Opslaan stays put through all 289
            fields of a connector rather than scrolling off with them. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {schemaState === "loading" && (selected || activeClient) && (
              <p className="flex items-center gap-2 text-sm text-k-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                {activeClient ? activeClient.connector : selected} laden…
              </p>
            )}
            {schemaState === "error" && (
              <AmberNotice>{current?.message}</AmberNotice>
            )}

            {schemaState === "ready" && schema && totals && (
              <div className="mx-auto max-w-4xl">
                {/* The connector's heading, figures and toolbar stay pinned while the
                  fields scroll under them, so search and the view switcher are
                  always one click away. `-mt-6 pt-6` pulls the block up over the
                  scroll area's top padding, so rows can't show through that gap
                  once it sticks; the background matches whatever hosts it — the
                  dialog or the page. */}
                <div
                  className={`sticky top-0 z-10 -mt-6 pb-4 pt-6 ${
                    onClose ? "bg-k-bg" : "bg-k-bg"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      {/* Unmissable on purpose: this schema and this mapping are read
                      from and written to one project's own AFAS, not the template
                      every other module here is made against — a save here can
                      never be mistaken for a save to the standard mapping. */}
                      {activeClient && (
                        <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-k-cloud-light/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-k-cloud-deep shadow-inset-sm">
                          Klantkoppeling — {activeClient.projectName} ·{" "}
                          {activeClient.moduleLabel}
                        </p>
                      )}
                      <h2 className="truncate font-mono text-xl font-bold tracking-tight text-k-text-primary">
                        {schema.id}
                      </h2>
                      <p className="mt-0.5 text-sm text-k-text-secondary">
                        {schema.description}
                      </p>
                      {/* The root key, but only where it is *not* the connector id:
                      `KnReaction` for `KnSubjectReaction`, and a body built on the id
                      instead is the most common way an AFAS call fails. Where the two
                      are the same it is already on screen as the tree's own root
                      section, which is why the line that used to stand here for every
                      connector is gone. */}
                      {schema.name !== schema.id && (
                        <p className="mt-1 text-sm text-k-text-secondary">
                          Root van de body:{" "}
                          <code className="font-mono font-semibold text-k-text-primary">
                            {schema.name}
                          </code>{" "}
                          — niet de connectornaam.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-2">
                      <Stat value={totals.fields} label="velden" />
                      <Stat value={totals.mandatory} label="verplicht" />
                      <Stat value={totals.objects} label="objecten" />
                      {counts.columns > 0 && (
                        <span
                          className="flex items-baseline gap-1.5"
                          title="Velden die hun waarde uit een kolom halen"
                        >
                          <span className="text-lg font-bold leading-none tabular-nums text-k-cloud-deep">
                            {counts.columns}
                          </span>
                          <span className="text-xs text-k-cloud-deep">
                            gekoppeld
                          </span>
                        </span>
                      )}
                      {counts.fixed > 0 && (
                        <span
                          className="flex items-baseline gap-1.5"
                          title="Velden met een vaste waarde, gelijk voor elke rij"
                        >
                          <span className="text-lg font-bold leading-none tabular-nums text-k-text-primary">
                            {counts.fixed}
                          </span>
                          <span className="text-xs text-k-text-secondary">vast</span>
                        </span>
                      )}
                      {autoCount > 0 && (
                        <span
                          className="flex items-baseline gap-1.5"
                          title={t(
                            "Velden die de conversie zelf invult, beperkt of weglaat — wat de koppeling ook zegt",
                            "Fields the conversion fills, limits or leaves out itself — whatever the mapping says",
                          )}
                        >
                          <span className="text-lg font-bold leading-none tabular-nums text-k-cyan-fg">
                            {autoCount}
                          </span>
                          <span className="text-xs text-k-cyan-fg">
                            {t("automatisch", "automatic")}
                          </span>
                        </span>
                      )}
                      {/* The figure that says the grouping is right: how many records the
                      sheet's rows collapse into. "3 records uit 12 rijen" is wrong at
                      a glance in a way a key flag on its own never is. */}
                      {recordGroups && (
                        <span
                          className="flex items-baseline gap-1.5"
                          title={`Gegroepeerd op ${shape?.keyColumns
                            .map((column) => column.header)
                            .join(
                              " + ",
                            )} — rijen met dezelfde waarden in die kolommen worden één record`}
                        >
                          <span className="text-lg font-bold leading-none tabular-nums text-k-text-primary">
                            {recordGroups.length}
                          </span>
                          <span className="text-xs text-k-text-secondary">
                            {recordGroups.length === 1 ? "record" : "records"}{" "}
                            uit {sheet?.rows.length ?? 0} rijen
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* A kop column that disagrees within its group — the error grouping
                  exists to catch. Above the tabs because it is about the sheet, not
                  about whichever view happens to be open. */}
                  {disagreements.length > 0 && (
                    <AmberNotice className="mt-3">
                      {disagreements.length === 1
                        ? "Eén kopkolom verschilt binnen deze groep; "
                        : `${disagreements.length} kopkolommen verschillen binnen deze groep; `}
                      de eerste rij bepaalt wat er verstuurd wordt.{" "}
                      {disagreements
                        .map(
                          (entry) =>
                            `${entry.header}: "${entry.used}" tegenover ${entry.others
                              .map(
                                (other) =>
                                  `"${other.value}" (rij ${other.rowNumber})`,
                              )
                              .join(", ")}`,
                        )
                        .join(" · ")}
                    </AmberNotice>
                  )}

                  {/* One row: a search box that gives way, three icon buttons, and the
                  view switcher. `flex-wrap` stays as the last resort for a pane
                  squeezed narrower than the switcher itself. */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <CompactSearch
                      value={query}
                      onChange={setQuery}
                      placeholder="Zoek veld, label, object of waarde"
                      label="Zoek in de opbouw"
                      className="min-w-40 flex-1"
                    />

                    <button
                      type="button"
                      onClick={() => setOnlyMandatory((on) => !on)}
                      aria-pressed={onlyMandatory}
                      aria-label="Alleen verplichte velden"
                      title="Alleen verplicht — de velden die AFAS verplicht stelt"
                      className={
                        onlyMandatory ? ACTIVE_ICON_BTN : QUIET_ICON_BTN
                      }
                    >
                      <Asterisk className="h-4 w-4 shrink-0" strokeWidth={2} />
                    </button>

                    {mappedCount > 0 && (
                      <button
                        type="button"
                        onClick={clearMapping}
                        aria-label="Alles leegmaken"
                        title={`Alles leegmaken — alle ${mappedCount} gevulde velden van ${schema.id}, koppelingen én vaste waarden`}
                        className={QUIET_ICON_BTN}
                      >
                        <Unlink
                          className="h-4 w-4 shrink-0"
                          strokeWidth={1.8}
                        />
                      </button>
                    )}

                    {/* Structuur / JSON / Koppeling — the schema, the body it produces,
                    and the mapping that fills it, each answering its own question. */}
                    <div className="flex h-9 shrink-0 items-center rounded-full bg-k-bg p-0.5 shadow-inset-sm">
                      {(["tree", "json", "mapping"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setView(option)}
                          aria-pressed={view === option}
                          className={`h-8 cursor-pointer rounded-full px-3 text-sm font-medium transition-[box-shadow,color] duration-200 ${
                            view === option
                              ? "bg-k-bg text-k-cloud-deep shadow-raised-xs"
                              : "text-k-text-tertiary hover:text-k-text-primary"
                          }`}
                        >
                          {option === "tree"
                            ? "Structuur"
                            : option === "json"
                              ? "JSON"
                              : "Koppeling"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* A failed save, in every view — said here rather than in the footer
                  bar that starts it, because a full-width notice is readable where a
                  line squeezed in beside Opslaan is not. */}
                  {saveError && (
                    <AmberNotice className="mt-2">{saveError}</AmberNotice>
                  )}
                </div>

                {view === "mapping" ? (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="min-w-56 flex-1 text-xs text-k-text-secondary">
                        {mappedCount === 0
                          ? "Nog niets gevuld — sleep een kolom op een veld, of geef een veld een vaste waarde."
                          : `${mappedCount} velden van ${schema.id} zijn gevuld: ${counts.columns} uit ${workbook?.fileName || "een kolom"}, ${counts.fixed} met een vaste waarde.`}
                      </p>
                      {/* No Opslaan here — it is in the toolbar above, the same button
                        this tab and Structuur both save with. */}
                      <span className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copy(mappingJson)}
                          className={QUIET_BTN}
                        >
                          {copied ? (
                            <Check
                              className="h-4 w-4 shrink-0 text-k-green-fg"
                              strokeWidth={2}
                            />
                          ) : (
                            <Copy
                              className="h-4 w-4 shrink-0"
                              strokeWidth={1.8}
                            />
                          )}
                          {copied ? "Gekopieerd" : "Kopieer JSON"}
                        </button>
                        {storedDoc && (
                          <button
                            type="button"
                            onClick={removeStoredMapping}
                            disabled={saving}
                            title="De opgeslagen versie verwijderen — wat op het scherm staat blijft staan"
                            className={QUIET_BTN}
                          >
                            <Trash2
                              className="h-4 w-4 shrink-0"
                              strokeWidth={1.8}
                            />
                            Opgeslagen versie wissen
                          </button>
                        )}
                      </span>
                    </div>

                    <pre className="mt-2 overflow-x-auto rounded-2xl bg-k-bg px-4 py-3 text-xs leading-relaxed text-k-text-primary shadow-raised">
                      <code>{mappingJson}</code>
                    </pre>

                    {/* Where it stands with the store, in one line: who saved it, when,
                      and whether what is on screen is still that. */}
                    <p className="mt-2 text-xs text-k-text-secondary">
                      {storedDoc ? (
                        <>
                          {dirty ? (
                            <span className="font-semibold text-k-cloud-deep">
                              Niet-opgeslagen wijzigingen.{" "}
                            </span>
                          ) : null}
                          Opgeslagen door{" "}
                          {storedDoc.savedByName || storedDoc.savedBy} op{" "}
                          {formatCheckedAt(storedDoc.savedAt)}
                          {storedDoc.file
                            ? `, gemaakt met ${storedDoc.file}`
                            : ""}
                          .
                        </>
                      ) : (
                        "Nog niet opgeslagen."
                      )}{" "}
                      De koppeling staat in{" "}
                      <code className="font-mono">
                        {activeClient
                          ? `backend/json_files/mappings/clients/${activeClient.projectId}/${activeClient.moduleId}.json`
                          : // The file a save actually writes: a `modules` mapping is
                            // named after its module, not the connector it shares.
                            `backend/json_files/mappings/${selectedGroup}/${selectedModule ?? selected}.json`}
                      </code>
                      .
                    </p>
                  </div>
                ) : view === "tree" ? (
                  filtered ? (
                    <div className="mt-4">
                      <SourceLegend kinds={autoKinds} />
                      <div className="mt-3">
                        <SchemaObjectSection
                          object={filtered}
                          isOpen={isOpen}
                          onToggle={toggle}
                          mapping={fieldMapping}
                          auto={autoRules}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl bg-k-bg px-3 py-3 shadow-raised-sm text-sm text-k-text-secondary">
                      Geen veld of object voldoet aan dit filter.
                    </p>
                  )
                ) : (
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-k-text-secondary">
                        {mappedCount > 0 ? (
                          <>
                            {onlyMapped ? (
                              <>
                                Alleen de{" "}
                                <span className="font-semibold text-k-text-primary">
                                  gevulde
                                </span>{" "}
                                velden, met de objecten waarin ze zitten.
                              </>
                            ) : (
                              <>De hele body die deze connector beschrijft.</>
                            )}
                            {counts.columns > 0 &&
                              (sheet ? (
                                exampleGroup && shape ? (
                                  // Grouped: the body is a whole record, so the line has
                                  // to say which rows went into it — otherwise an array
                                  // of three regels beside a *Voorbeeld* pointing at one
                                  // row reads as a bug.
                                  <>
                                    {" "}
                                    Eén record uit{" "}
                                    <span className="font-semibold text-k-text-primary">
                                      {exampleGroup.rows.length}{" "}
                                      {exampleGroup.rows.length === 1
                                        ? "rij"
                                        : "rijen"}
                                    </span>{" "}
                                    (
                                    {exampleGroup.rows
                                      .map(
                                        (row) =>
                                          sheet.rowNumbers[row] ?? row + 1,
                                      )
                                      .join(", ")}
                                    ) van {sheet.name}, gegroepeerd op{" "}
                                    <span className="font-semibold text-k-text-primary">
                                      {shape.keyColumns
                                        .map((column) => column.header)
                                        .join(" + ")}
                                    </span>
                                    {shape.linePath && (
                                      <>
                                        {" "}
                                        —{" "}
                                        <code className="font-mono">
                                          {shape.linePath}
                                        </code>{" "}
                                        krijgt één element per rij
                                      </>
                                    )}
                                    .
                                  </>
                                ) : (
                                  <>
                                    {" "}
                                    De gekoppelde waarden komen uit rij{" "}
                                    <span className="font-semibold text-k-text-primary">
                                      {sheet.rowNumbers[exampleRow] ?? "—"}
                                    </span>{" "}
                                    van {sheet.name} — kies links een andere
                                    onder <em>Voorbeeld</em>.
                                  </>
                                )
                              ) : (
                                // The fields are in the body, with `null` where the row
                                // would be: without this line a reader sees nulls and
                                // wonders whether the mapping survived.
                                <>
                                  {" "}
                                  De {counts.columns} gekoppelde velden staan op{" "}
                                  <code className="font-mono">null</code> — open
                                  links het sjabloon om er echte waarden in te
                                  zien.
                                </>
                              ))}
                            {!onlyMapped &&
                              " De rest is een voorbeeld per type."}
                          </>
                        ) : (
                          "De body die deze connector beschrijft. De waarden zijn voorbeelden per type — koppel een kolom of geef een veld een vaste waarde."
                        )}
                      </p>
                      <span className="flex shrink-0 items-center gap-2">
                        {mappedCount > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setOnlyMapped((on) => !on)}
                              aria-pressed={onlyMapped}
                              title="Alleen de gevulde velden tonen — kolom of vaste waarde — met de objecten waarin ze zitten"
                              className={onlyMapped ? ACTIVE_BTN : QUIET_BTN}
                            >
                              <Filter
                                className="h-4 w-4 shrink-0"
                                strokeWidth={1.8}
                              />
                              Alleen gevuld
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowNotes((on) => !on)}
                              aria-pressed={showNotes}
                              title="De kolom achter elke gevulde waarde tonen"
                              className={showNotes ? ACTIVE_BTN : QUIET_BTN}
                            >
                              <Link2
                                className="h-4 w-4 shrink-0"
                                strokeWidth={1.8}
                              />
                              Kolomnamen
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => copy(json)}
                          className={QUIET_BTN}
                        >
                          {copied ? (
                            <Check
                              className="h-4 w-4 shrink-0 text-k-green-fg"
                              strokeWidth={2}
                            />
                          ) : (
                            <Copy
                              className="h-4 w-4 shrink-0"
                              strokeWidth={1.8}
                            />
                          )}
                          {copied ? "Gekopieerd" : "Kopieer JSON"}
                        </button>
                      </span>
                    </div>
                    {/* One element per line, so a filled field can name its column
                      beside it. The note is **not** in the JSON — a body with a
                      comment in it is not a body AFAS takes, and the copy button
                      hands over exactly the text on the left of these arrows. */}
                    {lines.length === 0 ? (
                      <p className="mt-2 rounded-xl bg-k-bg px-3 py-3 shadow-raised-sm text-sm text-k-text-secondary">
                        Geen veld voldoet aan dit filter.
                      </p>
                    ) : (
                      <pre className="mt-2 overflow-x-auto rounded-2xl bg-k-bg px-4 py-3 text-xs leading-relaxed text-k-text-primary shadow-raised">
                        <code>
                          {lines.map((entry, index) => (
                            <span key={index} className="block whitespace-pre">
                              {entry.text}
                              {showNotes && entry.note && (
                                <span className="text-k-cloud-deep">
                                  {"   ← "}
                                  {entry.note}
                                </span>
                              )}
                            </span>
                          ))}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The bar sits **outside** the scroll area above, so Opslaan is in the
              same place whether the reader is at the top of `KnPurchaseRelationOrg`
              or 289 fields down it. Inside `<main>` it would scroll away, which for
              a 289-field schema means the save button is off screen for almost the
              whole of the work it saves.

              Shown only once something is mapped, like the toolbar's own disk icon:
              before that there is nothing to save and a permanently greyed bar
              across the pane is a promise the page can't keep. */}
          {schemaState === "ready" && schema && mappedCount > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-k-divider bg-k-bg px-6 py-3">
              {/* Where it stands, left of the button that changes it — the same
                  sentence the Koppeling tab carries, so the reader doesn't have to
                  open a tab to find out whether their work is safe. */}
              <p className="mr-auto min-w-0 text-xs text-k-text-secondary">
                {dirty ? (
                  <span className="font-medium text-k-text-primary">
                    Niet opgeslagen — {mappedCount}{" "}
                    {mappedCount === 1 ? "veld" : "velden"} gevuld.
                  </span>
                ) : storedDoc ? (
                  <>
                    Opgeslagen door {storedDoc.savedByName || storedDoc.savedBy}{" "}
                    op {formatCheckedAt(storedDoc.savedAt)}.
                  </>
                ) : (
                  "Nog niet opgeslagen."
                )}
              </p>

              <button
                type="button"
                onClick={saveMapping}
                disabled={saving || !dirty}
                title={
                  saving
                    ? "Opslaan…"
                    : dirty
                      ? `Opslaan — de koppeling van ${schema.id}`
                      : "Opgeslagen — er zijn geen wijzigingen"
                }
                className={PRIMARY_BTN}
              >
                {saving ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : dirty ? (
                  <Save className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                ) : (
                  <Check className="h-4 w-4 shrink-0" strokeWidth={2} />
                )}
                {saving ? "Opslaan…" : dirty ? "Opslaan" : "Opgeslagen"}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
