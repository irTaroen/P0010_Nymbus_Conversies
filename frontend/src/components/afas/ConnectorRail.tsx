"use client";

import { useMemo, useState } from "react";
import { ChevronRight, LayoutGrid, Puzzle } from "lucide-react";
import { AmberNotice } from "@/components/uploader/Notices";
import { clientMappingKey, mappingKey, moduleMappingKey } from "@/lib/field-mapping";
import { MODULE_CATALOG, MODULE_CATEGORIES, getModule, type ModuleCategory } from "@/lib/modules";
import type { AfasConnectorGroup, AfasConnectorSummary } from "@/lib/afas-schema";
import type { ClientMappingModule, ClientMappingProject } from "@/lib/client-mapping";
import CompactSearch from "@/components/CompactSearch";

/**
 * Anything whose name doesn't place it — kept in view under its own heading rather
 * than guessed into HRM or ERP. Same fallback icon the sidebar gives a category it
 * doesn't know.
 */
const OTHER_CATEGORY: ModuleCategory = {
  id: "overig",
  label: "Overig",
  icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.8} />,
};

/**
 * Which side of Profit a connector serves — **read off its name**, which is AFAS's
 * own convention: the prefix names the functiegebied (`Kn` CRM/relaties, `Fb`
 * logistiek/verkoop/inkoop, `Fi` financieel, `Hr` HR/verzuim, `Pt` projecten), see
 * [AFAS-Profit-API-Referentie.md](../../../../docs/AFAS-Profit-API-Referentie.md)
 * §5. So `Hr*` is HRM and the rest is ERP.
 *
 * It is a reading of the name, not something AFAS states, so an unknown prefix lands
 * under *Overig* instead of being guessed into a category — a connector added in AFAS
 * still shows up, which is the whole point of taking the list from `metainfo`.
 *
 * The real answer comes later: once a module carries the connector it converts into
 * (todo.md → *Upload to AFAS*), the category is the module's own and this map goes.
 */
const CATEGORY_BY_PREFIX: Record<string, string> = {
  Hr: "hrm",
  Kn: "erp",
  Fb: "erp",
  Fi: "erp",
  Pt: "erp",
};

/** The connectors their prefix gets wrong: `KnEmployee` is CRM-shaped but is HRM. */
const CATEGORY_BY_CONNECTOR: Record<string, string> = {
  KnEmployee: "hrm",
};

function categoryOf(connectorId: string): string {
  return (
    CATEGORY_BY_CONNECTOR[connectorId] ??
    CATEGORY_BY_PREFIX[connectorId.slice(0, 2)] ??
    OTHER_CATEGORY.id
  );
}

/**
 * The left edge of each level. Four pixels a step, and no rule or indent guide: the
 * rail is 240px wide with `KnSubjectWorkflowReaction` in it, so the indent is there to
 * be felt rather than measured — the type does the rest of the work. A connector under
 * a category sits one step deeper than one whose group has no categories.
 */
const RAIL_INDENT = {
  group: "pl-3",
  category: "pl-4",
  connector: "pl-4",
  nestedConnector: "pl-5",
} as const;

/** One category's connectors within a group. */
type Section = { category: ModuleCategory; connectors: AfasConnectorSummary[] };

/** A group's connectors per category, in the sidebar's order, *Overig* last. */
function sectionsOf(connectors: AfasConnectorSummary[]): Section[] {
  return [...MODULE_CATEGORIES, OTHER_CATEGORY]
    .map((category) => ({
      category,
      connectors: connectors.filter((c) => categoryOf(c.id) === category.id),
    }))
    .filter((section) => section.connectors.length > 0);
}

/** The heading's tooltip: which AFAS is behind this group. */
function environmentTitle(group: AfasConnectorGroup): string | undefined {
  const { host, info } = group.environment;
  if (!host) return undefined;
  return info.appName ? `${host} · ${info.appName}` : host;
}

/**
 * A heading that folds its list away, at one of the rail's **three levels**, which
 * step down together in size, weight and indent (`RAIL_INDENT`):
 *
 *   group     `text-xs` `font-bold` uppercase in the primary ink — the environment, said out loud
 *   category  `text-[11px]` `font-semibold` in the primary ink — HRM / ERP, with its icon
 *   connector `text-[11px]` `font-medium` over a `text-[10px]` secondary line — mono
 *             on whichever of the two is the AFAS name (`ConnectorRow`, below)
 *
 * Each step is small on its own; the three together are what makes a `w-60` list of
 * seventeen rows readable as a tree instead of one run of equal lines.
 */
function Heading({
  label,
  count,
  open,
  onToggle,
  title,
  icon,
  tone = "group",
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  title?: string;
  icon?: React.ReactNode;
  tone?: "group" | "category";
}) {
  const category = tone === "category";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={title}
      className={`flex w-full cursor-pointer items-center gap-1.5 rounded-xl pr-2 text-left transition-colors ${
        category
          ? `${RAIL_INDENT.category} py-1 text-[11px] font-semibold text-k-text-primary hover:text-k-cloud-deep`
          : `${RAIL_INDENT.group} pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-k-text-primary hover:text-k-cloud-deep`
      }`}
    >
      <ChevronRight
        aria-hidden
        className={`shrink-0 transition-transform ${category ? "h-3 w-3" : "h-3.5 w-3.5"} ${
          open ? "rotate-90" : ""
        }`}
        strokeWidth={2.5}
      />
      {/* The category's own icon, brought down to this level's size — it arrives
          from `MODULE_CATEGORIES` at the sidebar's `h-4`, which outweighs 11px type. */}
      {icon && (
        <span aria-hidden className="shrink-0 text-k-text-tertiary [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* The count is the heading's footnote, not part of its weight. */}
      <span
        className={`shrink-0 tabular-nums text-k-text-tertiary ${
          category ? "text-[10px]" : "text-[11px] font-semibold"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/** `MODULE_CATALOG`'s own order, so a connector's modules list the way the sidebar
 *  would rather than the order they happened to save in. */
const CATALOG_ORDER = new Map(MODULE_CATALOG.map((m, index) => [m.id, index]));

function sortByCatalogOrder(moduleIds: string[]): string[] {
  return [...moduleIds].sort(
    (a, b) => (CATALOG_ORDER.get(a) ?? 0) - (CATALOG_ORDER.get(b) ?? 0)
  );
}

/**
 * A module split across two connectors by an "Organisatie of Persoon" column
 * (Debiteuren → `KnSalesRelationOrg`/`KnSalesRelationPer`, Crediteuren →
 * `KnPurchaseRelationOrg`/`KnPurchaseRelationPer`) can't name both its mapping
 * files after the one catalog id, so they're addressed as `<catalogId>-organisatie` /
 * `-persoon` instead — see docs/todo.md → "one module, two connectors has no reader
 * yet". Neither suffixed id is in `MODULE_CATALOG`, so `getModule()` alone would show
 * the raw id (`erp-debiteuren-organisatie`); this recognizes the suffix and reads the
 * real label off the base id instead.
 */
const MODULE_VARIANT_SUFFIXES: Record<string, string> = {
  organisatie: "Organisatie",
  persoon: "Persoon",
  debiteur: "Debiteur",
  crediteur: "Crediteur",
};

/** The catalog's label for a module id, or its variant reading, or the raw id. */
function moduleDisplayLabel(moduleId: string): string {
  const direct = getModule(moduleId)?.label;
  if (direct) return direct;
  for (const [suffix, suffixLabel] of Object.entries(MODULE_VARIANT_SUFFIXES)) {
    if (!moduleId.endsWith(`-${suffix}`)) continue;
    const baseLabel = getModule(moduleId.slice(0, -(suffix.length + 1)))?.label;
    if (baseLabel) return `${baseLabel} (${suffixLabel})`;
  }
  return moduleId;
}

/**
 * The dot at the end of a row, and it marks **what is still missing**: a connector or
 * a flagged module with no mapping stored yet. A mapped row gets nothing — most of
 * the rail is mapped by now, so a dot per done row is a column of noise that says
 * least exactly where the eye should land.
 *
 * Red, `bg-k-red-fg` — the same fill the sidebar's completeness dot uses for its worst
 * band (`COMPLETENESS_TONE_FILL.poor`), so red means "needs work" in both rails. The
 * colour is left free for a second state the mapping doesn't have yet: amber for a
 * mapping that exists but no longer fits its schema.
 *
 * It keeps its red on the selected row too: the row's own highlight already says
 * which one is open, and a dot that changed colour with the selection would be
 * reporting the selection rather than the mapping.
 */
function MissingMappingDot() {
  return (
    <span
      aria-hidden
      title="Nog geen koppeling opgeslagen"
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-k-red-fg"
    />
  );
}

/** One clickable row in the rail — a connector on its own, or a module it serves. */
type ConnectorRow = {
  key: string;
  connectorId: string;
  primary: string;
  primaryMono: boolean;
  secondary: string;
  secondaryMono: boolean;
  stored: boolean;
  /**
   * The mapping this row opens, when the row *is* a module — `modules` group only.
   * Null on a plain connector row, which is addressed by connector as before.
   */
  moduleId: string | null;
};

/**
 * A connector with no known module still shows as itself (raw id, AFAS's own
 * description) — most of `Nymbus`'s connectors and any `modules` one nothing has
 * been mapped onto yet. A connector `connectorModules` names is shown **once per
 * module it serves** instead: the module's own label, with the connector it shares
 * (`KnEmployee (Medewerker)`) underneath — because `KnEmployee` alone serves both
 * *Medewerkers* and *Uitzendkrachten*, and a single mono id would say neither.
 *
 * Both rows read the one schema `KnEmployee` is, but they open **different
 * mappings**: the store keeps a file per module, so *Medewerkers* and
 * *Uitzendkrachten* each have their own and each row carries the `moduleId` that
 * names it. One schema, one mapping per row — which is why a row hands `onChoose`
 * its module as well as its connector.
 */
function connectorRows(
  groupId: string,
  connectors: AfasConnectorSummary[],
  connectorModules: Record<string, string[]>,
  isStored: (key: string) => boolean
): ConnectorRow[] {
  return connectors.flatMap((connector): ConnectorRow[] => {
    const moduleIds = connectorModules[connector.id];
    if (!moduleIds || moduleIds.length === 0) {
      return [
        {
          key: connector.id,
          connectorId: connector.id,
          primary: connector.id,
          primaryMono: true,
          secondary: connector.description,
          secondaryMono: false,
          stored: isStored(mappingKey(groupId, connector.id)),
          moduleId: null,
        },
      ];
    }
    return sortByCatalogOrder(moduleIds).map((moduleId) => ({
      key: `${connector.id}::${moduleId}`,
      connectorId: connector.id,
      primary: moduleDisplayLabel(moduleId),
      primaryMono: false,
      secondary: `${connector.id} (${connector.description})`,
      secondaryMono: true,
      // Only shown because a mapping file for this module exists — always stored.
      stored: true,
      moduleId,
    }));
  });
}

/**
 * The connectors themselves — the rail's last level, and its only clickable rows
 * besides the headings. Lightest of the three: the primary line in `font-medium`
 * over a secondary line a step smaller again, so a list of ten sits *under* the HRM
 * above it rather than shouting over it.
 */
function ConnectorList({
  groupId,
  connectors,
  selectedKey,
  isStored,
  connectorModules,
  onChoose,
  nested,
}: {
  groupId: string;
  connectors: AfasConnectorSummary[];
  selectedKey: string;
  isStored: (key: string) => boolean;
  /** Module ids each connector serves, by connector id — `modules` group only. */
  connectorModules: Record<string, string[]>;
  onChoose: (group: string, connector: string, moduleId: string | null) => void;
  /** Under a category heading, so one step deeper than a group's own list. */
  nested?: boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {connectorRows(groupId, connectors, connectorModules, isStored).map((row) => {
        // A module row is its own mapping, so it is its own selection: two rows on
        // one connector must not both light up because the connector is open.
        const active =
          (row.moduleId ? moduleMappingKey(row.moduleId) : mappingKey(groupId, row.connectorId)) ===
          selectedKey;
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onChoose(groupId, row.connectorId, row.moduleId)}
              aria-current={active ? "true" : undefined}
              className={`w-full cursor-pointer rounded-xl py-1.5 pr-2 text-left transition-colors ${
                nested ? RAIL_INDENT.nestedConnector : RAIL_INDENT.connector
              } ${
                active
                  ? "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm"
                  : "text-k-text-secondary hover:text-k-text-primary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`min-w-0 flex-1 truncate text-[11px] ${
                    row.primaryMono ? "font-mono" : ""
                  } ${active ? "font-semibold" : "font-medium"}`}
                >
                  {row.primary}
                </span>
                {/* A dot for a connector nothing has been mapped onto yet — "which
                    of these still need doing" is the list's other question. */}
                {!row.stored && <MissingMappingDot />}
              </span>
              <span
                className={`block truncate text-[10px] text-k-text-secondary ${
                  row.secondaryMono ? "font-mono" : ""
                }`}
              >
                {row.secondary}
                {!row.stored && <span className="sr-only"> — nog geen koppeling</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One project's flagged modules — the rail's *client* row, one level deeper than a
 * project heading the way a connector sits under a category. Unlike a connector row,
 * a module here can be **unopenable**: one flagged before its standard mapping
 * existed has no connector to read a schema with (`ClientMappingModule.connector`
 * is `null`), and is shown dimmed with its own tooltip rather than a click that
 * would 400.
 */
function ClientModuleList({
  projectId,
  projectName,
  modules,
  selectedKey,
  onChoose,
}: {
  projectId: string;
  projectName: string;
  modules: ClientMappingModule[];
  selectedKey: string;
  onChoose: (projectId: string, projectName: string, module: ClientMappingModule) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {modules.map((module) => {
        const key = clientMappingKey(projectId, module.moduleId);
        const active = key === selectedKey;
        const openable = Boolean(module.connector);
        return (
          <li key={module.moduleId}>
            <button
              type="button"
              onClick={() => openable && onChoose(projectId, projectName, module)}
              disabled={!openable}
              aria-current={active ? "true" : undefined}
              title={
                openable ? undefined : "Nog geen standaardkoppeling om van te starten"
              }
              className={`w-full rounded-xl py-1.5 pr-2 text-left transition-colors ${RAIL_INDENT.nestedConnector} ${
                !openable
                  ? "cursor-not-allowed opacity-50"
                  : active
                    ? "cursor-pointer bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm"
                    : "cursor-pointer text-k-text-secondary hover:text-k-text-primary"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`min-w-0 flex-1 truncate text-[11px] ${
                    active ? "font-semibold" : "font-medium"
                  }`}
                >
                  {module.moduleLabel}
                </span>
                {/* A custom module (maatwerk) — an extra step on a standard module
                    rather than a flagged copy of one; the tooltip names which. */}
                {module.parentModuleId && (
                  <span
                    className="shrink-0 text-k-text-tertiary"
                    title={`Maatwerk na ${getModule(module.parentModuleId)?.label ?? module.parentModuleId}`}
                  >
                    <Puzzle className="h-3 w-3" strokeWidth={2} />
                  </span>
                )}
                {/* Same reading as a connector row's dot: this one has no client copy
                    yet. On an unopenable module it fades with the row, which is the
                    right emphasis — still to do, but not from here. */}
                {!module.hasMapping && <MissingMappingDot />}
              </span>
              <span className="block truncate text-[10px] font-mono text-k-text-secondary">
                {module.connector ?? "geen standaardkoppeling"}
                {!module.hasMapping && (
                  <span className="sr-only"> — nog geen koppeling</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The connector rail: what there is to pick from, and which one the page is showing.
 *
 * **Two groups, because there are two environments** — *Nymbus* is the app connector
 * this tool writes the dossier and the workflow through, *Modules* the conversion
 * connectors a module's sheet is mapped onto (the app connector installed at a
 * customer). The split is not cosmetic: the same connector name in the other group is
 * a different schema, which is why a connector is addressed as group + id everywhere.
 * Neither list is hardcoded — both are whatever `metainfo` answers with.
 *
 * **Both fold shut**, and the categories under them too, because the two are worked in
 * one at a time: the fourteen conversion connectors otherwise push the three dossier
 * ones off the top of a `w-60` rail. Open unless the reader closed it, like the
 * sidebar's module groups, so nothing collapses on its own.
 *
 * The conversion connectors arrive **per category, HRM and ERP** — the same two the
 * sidebar groups modules by, labels and icons included, since it is the same question
 * asked from the other end ("which module is this for"). A group whose connectors all
 * land in one category is left as a plain list: *Nymbus*'s three are the tool's own
 * plumbing, not a side of Profit, and a lone **ERP** heading over them would be a
 * claim rather than a grouping.
 *
 * A **search** narrows within the groups and never removes a group heading — the two
 * are what the rail is for, and one vanishing mid-search reads as though its
 * environment had gone. It does drop a category that has no hit (that heading is
 * organisation, not an environment), and it forces every group open: a search that
 * answers with a row of collapsed headings hasn't answered.
 *
 * **A third heading, `Klanten`, below the two — and it is not a third environment.**
 * It lists every project with a module flagged in *Projectinstellingen → Afwijkende
 * koppelingen*, one project per category-level heading and one flagged module per
 * row (`ClientModuleList`, not `ConnectorList` — a client row is addressed by
 * project + module, never by connector, since one project can flag two modules
 * sharing a connector the same way `modules` itself can). Hidden while nothing is
 * flagged anywhere, so an admin who has never used the feature never sees an empty
 * heading for it.
 */
export default function ConnectorRail({
  groups,
  state,
  message,
  selectedKey,
  isStored,
  connectorModules,
  onChoose,
  clientProjects,
  clientState,
  clientMessage,
  selectedClientKey,
  onChooseClient,
}: {
  groups: AfasConnectorGroup[];
  /** How the connector fetch went — the list is empty while it is not `ready`. */
  state: "loading" | "ready" | "error";
  /** Why the fetch failed, when it did. */
  message: string;
  /**
   * What is open: `moduleMappingKey(moduleId)` for a module row, and
   * `mappingKey(group, connector)` for a plain connector one — the same two
   * addresses the store itself uses, so a row lights up only when *its own* mapping
   * is the one on screen.
   */
  selectedKey: string;
  /** Whether a connector has a mapping in the store — its *absence* is the dot on
   *  the row ({@link MissingMappingDot}). */
  isStored: (key: string) => boolean;
  /** Module ids each connector serves, by connector id — `modules` group only. */
  connectorModules: Record<string, string[]>;
  /** `moduleId` is the mapping the row opens, or null for a plain connector row. */
  onChoose: (group: string, connector: string, moduleId: string | null) => void;
  /** Every project with at least one module flagged as mapped differently. */
  clientProjects: ClientMappingProject[];
  /** How that fetch went — independent of `state`, a different call entirely. */
  clientState: "loading" | "ready" | "error";
  clientMessage: string;
  /** The open client module, as `clientMappingKey(projectId, moduleId)`. */
  selectedClientKey: string;
  onChooseClient: (projectId: string, projectName: string, module: ClientMappingModule) => void;
}) {
  const [query, setQuery] = useState("");
  // Open unless the reader closed it. Groups and categories share one map, keyed by
  // group id and `group/category` — they are the same gesture at two depths.
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const searching = query.trim() !== "";

  function isOpen(key: string): boolean {
    return searching || !closed[key];
  }

  function toggle(key: string) {
    setClosed((current) => ({ ...current, [key]: !current[key] }));
  }

  // The rail as it is drawn. The **shape** is decided on the whole group — whether it
  // splits into categories at all — and only then is the search applied inside it, so
  // a search that happens to leave one category standing doesn't also strip the
  // heading that says which one it is.
  const rail = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.map((group) => {
      const sections = sectionsOf(group.connectors);
      const narrowed = needle
        ? sections
            .map((section) => ({
              ...section,
              connectors: section.connectors.filter(
                (connector) =>
                  connector.id.toLowerCase().includes(needle) ||
                  connector.description.toLowerCase().includes(needle) ||
                  // A row now names its module rather than the connector, so a
                  // search for "uitzend" has to reach `KnEmployee` through it.
                  (connectorModules[connector.id] ?? []).some((moduleId) =>
                    moduleDisplayLabel(moduleId).toLowerCase().includes(needle)
                  )
              ),
            }))
            .filter((section) => section.connectors.length > 0)
        : sections;
      return {
        group,
        sections: narrowed,
        // One category is not a split — that group renders as a plain list.
        split: sections.length > 1,
        count: narrowed.reduce((total, section) => total + section.connectors.length, 0),
      };
    });
  }, [groups, query, connectorModules]);

  // Client projects, narrowed the same way: a search matches the project or one of
  // its module labels, and a project with nothing left to show drops out entirely —
  // unlike the two environment groups, a project is not an environment, so nothing
  // is lost by a search leaving none of them standing.
  const clientRail = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const narrowed = needle
      ? clientProjects
          .map((project) => ({
            ...project,
            modules: project.modules.filter(
              (module) =>
                module.moduleLabel.toLowerCase().includes(needle) ||
                project.projectName.toLowerCase().includes(needle) ||
                (module.connector ?? "").toLowerCase().includes(needle)
            ),
          }))
          .filter((project) => project.modules.length > 0)
      : clientProjects;
    return {
      projects: narrowed,
      count: narrowed.reduce((total, project) => total + project.modules.length, 0),
    };
  }, [clientProjects, query]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-k-divider bg-k-bg">
      <div className="shrink-0 px-3 py-3">
        <CompactSearch
          value={query}
          onChange={setQuery}
          placeholder="Zoek connector"
          label="Zoek connector"
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {state === "loading" && (
          <p className="px-3 py-2 text-sm text-k-text-secondary">Connectoren laden…</p>
        )}
        {state === "error" && <AmberNotice className="mx-1">{message}</AmberNotice>}

        {rail.map(({ group, sections, split, count }) => {
          const open = isOpen(group.id);
          return (
            <div key={group.id} className="mb-2 last:mb-0">
              <Heading
                label={group.label}
                count={count}
                open={open}
                onToggle={() => toggle(group.id)}
                title={environmentTitle(group)}
              />

              {open && (
                <>
                  {group.message ? (
                    <AmberNotice className="mx-1 mb-1">{group.message}</AmberNotice>
                  ) : count === 0 ? (
                    <p className={`${RAIL_INDENT.connector} py-1 pr-2 text-[11px] text-k-text-secondary`}>
                      {searching
                        ? "Geen connector met deze naam."
                        : "Nog geen connectoren in deze omgeving."}
                    </p>
                  ) : null}

                  {sections.map(({ category, connectors }) => {
                    if (!split) {
                      return (
                        <ConnectorList
                          key={category.id}
                          groupId={group.id}
                          connectors={connectors}
                          selectedKey={selectedKey}
                          isStored={isStored}
                          connectorModules={connectorModules}
                          onChoose={onChoose}
                        />
                      );
                    }
                    const categoryKey = `${group.id}/${category.id}`;
                    return (
                      <div key={category.id}>
                        <Heading
                          tone="category"
                          icon={category.icon}
                          label={category.label}
                          count={connectors.length}
                          open={isOpen(categoryKey)}
                          onToggle={() => toggle(categoryKey)}
                        />
                        {isOpen(categoryKey) && (
                          <ConnectorList
                            nested
                            groupId={group.id}
                            connectors={connectors}
                            selectedKey={selectedKey}
                            isStored={isStored}
                            connectorModules={connectorModules}
                            onChoose={onChoose}
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}

        {/* Klanten — every project with a module flagged in *Projectinstellingen →
            Afwijkende koppelingen*. A third heading rather than a third
            `AfasConnectorGroup`: it isn't an environment (there is no single
            "clients" AFAS to read `metainfo` from), it's a per-project address, so
            it gets its own row shape (`ClientModuleList`) instead of
            `connectorRows()`. Hidden entirely while nothing is flagged, rather than
            an empty heading nobody can act on. */}
        {(clientState !== "ready" || clientRail.projects.length > 0) && (
          <div className="mb-2 last:mb-0">
            <Heading
              label="Klanten"
              count={clientRail.count}
              open={isOpen("clients")}
              onToggle={() => toggle("clients")}
              title="Modules met een afwijkende koppeling, per project"
            />
            {isOpen("clients") && (
              <>
                {clientState === "loading" && (
                  <p className={`${RAIL_INDENT.connector} py-1 pr-2 text-[11px] text-k-text-secondary`}>
                    Laden…
                  </p>
                )}
                {clientState === "error" && (
                  <AmberNotice className="mx-1 mb-1">{clientMessage}</AmberNotice>
                )}
                {clientState === "ready" &&
                  clientRail.projects.length === 0 &&
                  searching && (
                    <p className={`${RAIL_INDENT.connector} py-1 pr-2 text-[11px] text-k-text-secondary`}>
                      Geen klantmodule met deze naam.
                    </p>
                  )}
                {clientRail.projects.map((project) => {
                  const categoryKey = `clients/${project.projectId}`;
                  return (
                    <div key={project.projectId}>
                      <Heading
                        tone="category"
                        label={project.projectName}
                        count={project.modules.length}
                        open={isOpen(categoryKey)}
                        onToggle={() => toggle(categoryKey)}
                      />
                      {isOpen(categoryKey) && (
                        <ClientModuleList
                          projectId={project.projectId}
                          projectName={project.projectName}
                          modules={project.modules}
                          selectedKey={selectedClientKey}
                          onChoose={onChooseClient}
                        />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
