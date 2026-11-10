"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The tinted strips the uploader shows above the grid and inside the report
 * drawer. One shape, one set of classes: an amber `rounded-xl` band with a
 * warning triangle and wrapped text, per design-system.md.
 *
 * `className` carries only the caller's spacing — the strip appears above the
 * table (`mb-3`), under the report's stale banner (`mb-4`) and after its tiles
 * (`mt-4`) — so the margin stays the caller's business and the styling stays here.
 *
 * `icon` swaps the triangle for a note that isn't a warning — the report's
 * *automatisch aangepast* strip takes `CheckCircle2`, as its PDF twin does.
 */
export function AmberNotice({
  className = "",
  icon: Icon = AlertTriangle,
  children,
}: {
  className?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl bg-k-amber-bg px-3.5 py-2.5 text-[13px] text-k-amber-fg ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span>{children}</span>
    </div>
  );
}

/**
 * The confirmation twin of {@link AmberNotice} — same shape, emerald, with the
 * `CheckCircle2` the project-settings dialog confirms with (design-system.md). Used for
 * the one thing in the uploader that succeeds *elsewhere*: a sheet accepted by
 * Nymbus, where nothing on screen would otherwise change to show it.
 */
export function GreenNotice({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl bg-k-green-bg px-3.5 py-2.5 text-[13px] text-k-green-fg ${className}`}
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span>{children}</span>
    </div>
  );
}

/**
 * The "neither good nor bad" tone (design-system.md §2) — sky rather than amber,
 * since nothing is wrong: a task simply sitting with Nymbus rather than the
 * client isn't a warning about the sheet.
 */
export function InfoNotice({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-xl bg-k-cyan-bg px-3.5 py-2.5 text-[13px] text-k-cyan-fg ${className}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span>{children}</span>
    </div>
  );
}

/**
 * Declared columns the sheet turned out not to have, so their checks were skipped.
 *
 * Shown in two places from one definition — above the table and in the validation
 * report — because it is the same finding about the same sheet: the table and the
 * report may never disagree about what was checked (design-system.md). Renders nothing
 * when every declared column was found, so callers need no guard.
 */
export function MissingColumnsNotice({
  columns,
  onRepair,
  className = "",
}: {
  columns: string[];
  /** Opens the column repair (admin only, above the table) — absent in the report,
   *  which describes the sheet rather than changing it. */
  onRepair?: () => void;
  className?: string;
}) {
  const t = useT();
  if (columns.length === 0) return null;
  return (
    <AmberNotice className={className}>
      {t(
        <>
          Verwachte kolom(men) niet gevonden: <strong>{columns.join(", ")}</strong>. Deze
          controles zijn overgeslagen.
        </>,
        <>
          Expected column(s) not found: <strong>{columns.join(", ")}</strong>. These checks
          were skipped.
        </>
      )}
      {onRepair && (
        <>
          {" "}
          <button
            type="button"
            onClick={onRepair}
            className="cursor-pointer font-medium text-k-cloud-deep underline-offset-2 hover:underline"
          >
            {t("Kolommen herstellen", "Repair columns")}
          </button>
        </>
      )}
    </AmberNotice>
  );
}

/**
 * A stack of notices, shown one at a time with a counter and two chevrons.
 *
 * The payload panel can raise half a dozen of these at once — an unmapped
 * variant, missing columns, unrouted rows, a failed existence read, the result of
 * the last send — and stacked they push the thing they are *about* off the
 * screen. Six amber bands in a column also stop reading as six findings: it
 * becomes a wall, and the one that matters is no more visible than the rest.
 *
 * So they page. One band, always the same height in the layout, with `2 / 5` and
 * a pair of arrows in the corner. Nothing is dropped — the count is the promise
 * that the other four are a click away, which is why the counter is not hidden
 * when it is the only one that could show it.
 *
 * **Children, not a list of strings.** Each notice is already a small piece of
 * markup (bold counts, row numbers, AFAS's own message) built by the caller, and
 * the caller decides tone per item by passing an `AmberNotice` or a
 * `GreenNotice`. This component owns only *which one is on screen*, so a mixed
 * stack pages in the order the panel declares — the order the decisions are made
 * in, not by severity, which would reshuffle the strip as facts arrive.
 *
 * Callers pass a possibly-sparse array (`cond && <AmberNotice/>`); falsey entries
 * are dropped here so no call site needs a filter of its own. Renders nothing
 * when the list is empty, and the bare notice — no chrome — when there is one.
 *
 * **The condition belongs to the caller, always.** A React element is truthy
 * whether or not the component behind it returns `null`, and a parent cannot
 * observe what a child decided — so a notice that gates itself internally still
 * counts here, and the pager promises a page that renders as an empty band. That
 * is the `1 / 2` whose second page is blank. Two notices are self-gating on
 * purpose (`AfasStageNotice`, `ModuleConversionSettingsNotice`, both admin-only);
 * each ships a `use…Notice()` predicate beside it, and the call site must ask that
 * rather than passing the element bare. Any future notice with an opinion about
 * its own visibility owes this component the same predicate.
 */
export function NoticeCarousel({
  items,
  className = "",
}: {
  items: React.ReactNode[];
  className?: string;
}) {
  const shown = items.filter(Boolean);
  const [index, setIndex] = useState(0);
  const t = useT();

  /* The stack shrinks as findings resolve — a send succeeds, a filter clears the
     unrouted rows — and the page you were on can be past the end. Clamping while
     rendering (rather than in an effect) means the visible band and the counter
     never disagree, not even for the frame an effect would take to correct. */
  const at = Math.min(index, Math.max(shown.length - 1, 0));

  if (shown.length === 0) return null;
  if (shown.length === 1) return <>{shown[0]}</>;

  return (
    <div className={`relative ${className}`.trim()}>
      {/* Over the band's own top-right corner rather than above it: the pager is
          chrome about the strip, and a row of its own would cost the vertical
          space this component exists to save. The band's text wraps clear of it
          via the padding below. */}
      <span className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setIndex(at === 0 ? shown.length - 1 : at - 1)}
          title={t("Vorige melding", "Previous notice")}
          aria-label={t("Vorige melding", "Previous notice")}
          className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-current opacity-60 transition-[opacity,box-shadow] hover:opacity-100 hover:shadow-inset-sm"
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        </button>
        <span
          aria-live="polite"
          className="px-0.5 text-xs font-semibold tabular-nums text-current opacity-70"
        >
          {at + 1} / {shown.length}
        </span>
        <button
          type="button"
          onClick={() => setIndex(at === shown.length - 1 ? 0 : at + 1)}
          title={t("Volgende melding", "Next notice")}
          aria-label={t("Volgende melding", "Next notice")}
          className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-current opacity-60 transition-[opacity,box-shadow] hover:opacity-100 hover:shadow-inset-sm"
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        </button>
      </span>
      {/* Reserves the corner on every notice in the stack, so stepping through
          them doesn't reflow the text under the pager. */}
      <div className="[&>*]:pr-24">{shown[at]}</div>
    </div>
  );
}
