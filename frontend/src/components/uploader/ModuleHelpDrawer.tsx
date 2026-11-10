"use client";

import { useEffect, useRef, useState } from "react";
import { TextSearch } from "lucide-react";
import Drawer, { DrawerCloseButton } from "@/components/Drawer";
import { ModalSearch } from "@/components/Modal";
import { getModule } from "@/lib/modules";
import { getModuleHelp } from "@/lib/help";
import { RULE_SETS } from "@/lib/validation/rules";
import CodetabelPicker from "@/components/uploader/CodetabelPicker";
import { sourceOf } from "@/lib/validation/codetabellen";
import { useCodetabellen } from "@/components/CodetabellenProvider";
import { useProject } from "@/components/ProjectProvider";
import { useT } from "@/lib/i18n";
import {
  resolveStandardColumns,
  type StandardColumn,
} from "@/lib/standard-columns";

interface DerivedColumn {
  name: string;
  required: boolean;
  unique: boolean;
  type?: string;
  allowed?: string[];
  /**
   * The AFAS reference list this column is checked against, if any — carried
   * along so the drawer can open the same picker a rejected cell does.
   */
  tableRef?: string;
  /**
   * Scope to narrow that list to. The drawer has no row to read a
   * `scopeColumn` from, so this is only ever the rule's static
   * `scopeDefault` — a scoped list without one shows unscoped here.
   */
  tableScope?: string;
  description?: string;
  example?: string;
  /**
   * The value the **app** fills this column with, for a conversion that does not ask
   * the client for it — a facilitaire conversie's periodetabel and the rest, see
   * [`lib/standard-columns.ts`](../../lib/standard-columns.ts). Absent for every
   * column the client does fill, which is nearly all of them.
   *
   * It replaces the *verplicht* badge rather than joining it: a column the tool fills
   * is not something the client owes, and a drawer demanding a value the app is about
   * to supply is the same false alarm the missing-column banner used to raise.
   */
  fill?: StandardColumn;
}

/**
 * The Columns section is derived: the list of columns, their type and whether
 * they're required come from the module's validation rules; the help JSON only
 * supplies a description + example per column (keyed by display name).
 */
function deriveColumns(
  moduleId: string,
  fills: ReadonlyMap<string, StandardColumn>
): DerivedColumn[] {
  const ruleSet = RULE_SETS[moduleId];
  if (!ruleSet) return [];
  const help = getModuleHelp(moduleId);
  return ruleSet.columns.map((col) => {
    const name = Array.isArray(col.column) ? col.column[0] : col.column;
    const enumRule = col.rules.find((r) => r.check === "enum");
    const listRule = col.rules.find((r) => r.check === "codetabel");
    const h = help?.columns?.[name];
    const fill = fills.get(name);
    return {
      name,
      fill,
      // A column the app fills is never the client's to supply, whatever its rules
      // say — the rules are written for a standard conversion, where it is.
      required:
        !fill &&
        col.rules.some((r) => r.check === "required"),
      unique: col.rules.some((r) => r.check === "unique"),
      type: col.type,
      allowed: enumRule?.values,
      tableRef: listRule?.tableRef,
      tableScope: listRule?.scopeDefault,
      description: h?.description,
      example: h?.example,
    };
  });
}

function Section({
  title,
  children,
  innerRef,
}: {
  title: string;
  children: React.ReactNode;
  innerRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={innerRef}
      className="scroll-mt-0 border-t border-k-divider px-6 py-5 first:border-t-0"
    >
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-k-text-secondary">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Gate for the drawer below. Callers hold the open flag (the intro card and the
 * toolbar both do), so nothing is rendered until it is set — which means the body
 * mounts fresh on every open, and its search term and active tab reset with it
 * rather than needing an effect to clear them.
 */
export default function ModuleHelpDrawer({
  moduleId,
  open,
  onClose,
}: {
  moduleId: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <ModuleHelpDrawerBody moduleId={moduleId} onClose={onClose} />;
}

function ModuleHelpDrawerBody({
  moduleId,
  onClose,
}: {
  moduleId: string;
  onClose: () => void;
}) {
  const t = useT();
  // Scroll container + per-section elements, so the tabs can jump to a section
  // and highlight whichever one is currently in view.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [activeId, setActiveId] = useState<string>("");

  // Column search. While it holds a term the drawer narrows to the matching
  // columns — looking up one column is the reason to search, so the intro and
  // FAQ step aside rather than pushing the hits off-screen.
  const [query, setQuery] = useState("");

  // The list-backed column whose AFAS list is open, if any. Read-only here —
  // the drawer has no cell to write a pick into, so it's just the values.
  const [openList, setOpenList] = useState<DerivedColumn | null>(null);

  // Filtering swaps out the list under the user, so each new term starts at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // Escape peels off one layer at a time: the list picker (which has its own
  // Escape handler too, so this only matters for the layer beneath it), then
  // an active search, and only then the drawer itself.
  const onEscape = () => {
    if (openList) setOpenList(null);
    else if (query) setQuery("");
    else onClose();
  };

  // The source badges below read `sourceOf()` at render time, and the tables are
  // fetched asynchronously — so a drawer already open when they land would keep
  // showing "niet gecontroleerd" for a column that is now checked. Depending on the
  // arrival signal re-renders it once they do.
  useCodetabellen();

  const label = getModule(moduleId)?.label ?? moduleId;
  const help = getModuleHelp(moduleId);
  const general = help?.general ?? [];
  // What this conversion fills itself — empty for a standard project, so the drawer
  // reads exactly as it did. `selectedProject` is never null: this drawer only
  // renders inside `ExcelUploader`, which is under `[project]/layout.tsx`.
  const { selectedProject } = useProject();
  const columns = deriveColumns(
    moduleId,
    resolveStandardColumns(selectedProject, moduleId)
  );
  const faq = help?.faq ?? [];
  const isEmpty = general.length === 0 && columns.length === 0 && faq.length === 0;

  // Match on the description too, so a term from the sheet ("bijtelling", "IBAN")
  // finds the column even when it isn't part of the column's name.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const shownColumns = searching
    ? columns.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q),
      )
    : columns;

  // Searching collapses the drawer to the column list, which also leaves a single
  // section — so the tab row drops out on its own.
  const showGeneral = general.length > 0 && !searching;
  const showFaq = faq.length > 0 && !searching;

  // Only surface tabs for sections that actually have content.
  const tabs = [
    showGeneral && { id: "algemeen", label: t("Algemeen", "General") },
    columns.length > 0 && { id: "kolommen", label: t("Kolommen", "Columns") },
    showFaq && { id: "faq", label: "FAQ" },
  ].filter((t): t is { id: string; label: string } => Boolean(t));

  // Before any scroll, treat the first section as active.
  const currentTab = activeId || tabs[0]?.id;

  const scrollTo = (id: string) => {
    const target = sectionRefs.current[id];
    const scroll = scrollRef.current;
    if (!target || !scroll) return;
    scroll.scrollTo({ top: target.offsetTop, behavior: "smooth" });
    setActiveId(id);
  };

  // Highlight the tab for the section nearest the top of the scroll area.
  const onScroll = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const top = scroll.scrollTop;
    let current = tabs[0]?.id ?? "";
    for (const t of tabs) {
      const el = sectionRefs.current[t.id];
      if (el && el.offsetTop - 8 <= top) current = t.id;
    }
    setActiveId(current);
  };

  return (
    <Drawer onClose={onClose} onEscape={onEscape} label={t(`Uitleg ${label}`, `${label} help`)}>
      <div className="flex shrink-0 items-start justify-between gap-4 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-k-text-primary">{label}</h2>
          <p className="mt-0.5 text-sm text-k-text-secondary">
            {t(`Hoe vul ik het ${label}-bestand in?`, `How do I fill in the ${label} file?`)}
          </p>
        </div>
        <DrawerCloseButton onClick={onClose} />
      </div>

      {/* Sits above the tabs so it keeps its place when a search filters the
          other sections away. */}
      {columns.length > 0 && (
        <div className="shrink-0 border-b border-k-divider px-6 pb-4">
          <ModalSearch
            value={query}
            onChange={setQuery}
            placeholder={t("Zoek een kolom…", "Search for a column…")}
            label={t("Zoek een kolom", "Search for a column")}
            autoFocus={false}
          />
        </div>
      )}

      {tabs.length > 1 && (
        <div className="flex shrink-0 gap-2 border-b border-k-divider px-6 py-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => scrollTo(t.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-[box-shadow,color] duration-200 ${
                currentTab === t.id
                  ? "bg-k-cloud-light/40 text-k-cloud-deep shadow-inset-sm"
                  : "bg-k-bg text-k-text-secondary shadow-raised-xs hover:text-k-cloud-deep hover:shadow-inset-sm"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        {isEmpty && (
          <p className="px-6 py-5 text-sm text-k-text-secondary">
            {t("Er is nog geen uitleg beschikbaar voor deze module.", "There is no help available for this module yet.")}
          </p>
        )}

        {showGeneral && (
          <Section title={t("Algemeen", "General")} innerRef={(el) => { sectionRefs.current.algemeen = el; }}>
            <div className="space-y-3 text-sm leading-relaxed text-k-text-secondary">
              {general.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Section>
        )}

        {columns.length > 0 && (
          <Section
            title={searching ? t(`Kolommen (${shownColumns.length})`, `Columns (${shownColumns.length})`) : t("Kolommen", "Columns")}
            innerRef={(el) => { sectionRefs.current.kolommen = el; }}
          >
            {shownColumns.length === 0 && (
              <p className="text-sm text-k-text-secondary">
                {t(
                  <>Geen kolom gevonden voor &ldquo;{query.trim()}&rdquo;.</>,
                  <>No column found for &ldquo;{query.trim()}&rdquo;.</>
                )}
              </p>
            )}
            <ul className="space-y-4">
              {shownColumns.map((c) => (
                <li key={c.name}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-k-text-primary">{c.name}</span>
                    {c.type && (
                      <span className="rounded-full bg-k-bg px-2 py-0.5 text-xs font-medium text-k-text-secondary shadow-inset-sm">
                        {c.type}
                      </span>
                    )}
                    {c.required && (
                      <span className="rounded-full bg-k-cloud-light/40 px-2 py-0.5 text-xs font-medium text-k-cloud-deep shadow-inset-sm">
                        {t("verplicht", "required")}
                      </span>
                    )}
                    {c.fill && (
                      <span
                        className="rounded-full bg-k-bg px-2 py-0.5 text-xs font-medium text-k-text-secondary shadow-inset-sm"
                        title={t(
                          `De tool vult deze kolom zelf (${c.fill.note}) — je hoeft hem niet aan te leveren. Staat er wél een waarde in, dan gebruikt de tool die.`,
                          `The tool fills this column itself (${c.fill.note}) — you don't need to hand it in. If a value is in it, the tool uses that one.`
                        )}
                      >
                        {t("vult de tool", "filled by the tool")}
                      </span>
                    )}
                    {c.unique && (
                      <span className="rounded-full bg-k-cloud-light/40 px-2 py-0.5 text-xs font-medium text-k-cloud-deep shadow-inset-sm">
                        {t("uniek", "unique")}
                      </span>
                    )}
                  </div>
                  {c.description && (
                    <p className="mt-1 text-sm leading-relaxed text-k-text-secondary">{c.description}</p>
                  )}
                  {/* The value itself, not only that there is one: "vult de tool"
                      answers whether to fill the column in, and this answers the
                      next question — with what — which is the one somebody checking
                      a conversion actually has. */}
                  {c.fill && c.fill.value !== null && (
                    <p className="mt-1 text-sm leading-relaxed text-k-text-secondary">
                      {t(
                        <>
                          Deze conversie vult hier{" "}
                          <strong className="font-semibold text-k-text-primary">{c.fill.value}</strong>{" "}
                          ({c.fill.note}). Laat de kolom leeg of weg; een ingevulde waarde
                          gaat vóór.
                        </>,
                        <>
                          This conversion fills in here{" "}
                          <strong className="font-semibold text-k-text-primary">{c.fill.value}</strong>{" "}
                          ({c.fill.note}). Leave the column empty or out; a value you do enter
                          takes precedence.
                        </>
                      )}
                    </p>
                  )}
                  {c.allowed && c.allowed.length > 0 && (
                    <p className="mt-1 text-xs text-k-text-secondary">
                      {t("Toegestaan", "Allowed")}: {c.allowed.map((v) => `"${v}"`).join(", ")}
                    </p>
                  )}
                  {c.tableRef && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* Only offered when there is actually a table behind it —
                          a button opening an empty modal is worse than no button. */}
                      {sourceOf(c.tableRef) !== "none" && (
                        <button
                          type="button"
                          onClick={() => setOpenList(c)}
                          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-k-cloud-deep hover:underline"
                        >
                          <TextSearch className="h-3 w-3" strokeWidth={2.5} />
                          {t("Bekijk de codetabel", "View the code table")}
                        </button>
                      )}
                      {/* Which table the check actually judged against. Silent for
                          the client's own — that is the expected case; the two worth
                          saying are a stand-in (Nymbus's table, which is exactly
                          where this client's own codes go missing) and no table at
                          all, where the column simply wasn't checked. */}
                      {sourceOf(c.tableRef) === "nymbus" && (
                        <span
                          className="inline-flex items-center rounded-full bg-k-amber-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-amber-fg shadow-inset-sm"
                          title={t(
                            "De codetabel van deze klant kon niet worden opgehaald. Deze controle gebruikt de tabel van Nymbus, die kan afwijken.",
                            "This client's code table could not be retrieved. This check uses Nymbus's table, which may differ."
                          )}
                        >
                          {t("tabel van Nymbus", "Nymbus table")}
                        </span>
                      )}
                      {sourceOf(c.tableRef) === "none" && (
                        <span
                          className="inline-flex items-center rounded-full bg-k-bg px-1.5 py-0.5 text-[10px] font-semibold leading-none text-k-text-secondary shadow-inset-sm"
                          title={t(
                            "Geen AFAS-omgeving kon deze codetabel leveren, dus deze kolom is niet tegen een lijst gecontroleerd.",
                            "No AFAS environment could supply this code table, so this column was not checked against a list."
                          )}
                        >
                          {t("niet gecontroleerd", "not checked")}
                        </span>
                      )}
                    </div>
                  )}
                  {c.example && (
                    <p className="mt-1 text-xs text-k-text-secondary">
                      {t("Voorbeeld", "Example")}: <span className="font-mono text-k-text-primary">{c.example}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {showFaq && (
          <Section title="FAQ" innerRef={(el) => { sectionRefs.current.faq = el; }}>
            <dl className="space-y-4">
              {faq.map((item, i) => (
                <div key={i}>
                  <dt className="text-sm font-medium text-k-text-primary">{item.question}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-k-text-secondary">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}
      </div>

      {/* Read-only here: the drawer has no cell to write a pick into, so a
          click just shows the values were found and closes the picker. */}
      {openList?.tableRef && (
        <CodetabelPicker
          tableRef={openList.tableRef}
          scope={openList.tableScope}
          columnName={openList.name}
          currentValue=""
          onSelect={() => setOpenList(null)}
          onClose={() => setOpenList(null)}
        />
      )}
    </Drawer>
  );
}
