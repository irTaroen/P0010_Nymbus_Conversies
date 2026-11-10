"use client";

import { useState } from "react";
import Checkbox from "@/components/Checkbox";
import {
  ArrowRightLeft,
  Calculator,
  ChevronRight,
  CornerDownRight,
  DatabaseSearch,
  Equal,
  EyeOff,
  KeyRound,
  List,
  Link2,
  Lock,
  Rows3,
  Split,
  SquareFunction,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  fieldTypeLabel,
  fieldsOf,
  objectPath,
  objectsOf,
  type AfasSchemaField,
  type AfasSchemaObject,
} from "@/lib/afas-schema";
import {
  canMultiply,
  fieldKey,
  fixedInputKind,
  fixedValueInput,
  parseFixedValue,
  type FieldSource,
  type FixedValue,
  type GroupShape,
} from "@/lib/field-mapping";
import { lookupSummary, type AfasLookup } from "@/lib/afas-lookup";
import AfasLookupDialog, { type LookupColumn } from "@/components/afas/AfasLookupDialog";
import type { AutoFieldKind, AutoFieldRule, AutoFieldRules } from "@/lib/module-phases";
import { useT } from "@/lib/i18n";

/**
 * The mapping, as a field row needs it — one prop threaded down the recursion
 * instead of five. Left out entirely on a page that only reads a schema, which is
 * what keeps this component a schema renderer that *can* be mapped in rather than a
 * mapping editor that also renders schemas.
 *
 * The state itself lives in the explorer; everything here is a callback into it.
 */
export interface FieldMappingApi {
  /** What fills this field — a column, a fixed value, or nothing yet. */
  sourceFor: (key: string) => FieldSource | null;
  /** Map a column onto a field: a drop, or a click after one was picked. */
  assign: (key: string, column: number) => void;
  /** Give a field a value of its own, already checked against its type. */
  setFixed: (key: string, value: FixedValue) => void;
  /** Take whatever fills a field off it. */
  clear: (key: string) => void;
  /**
   * Make this field's column part of the group key, or stop it being one — the one
   * gesture behind *several rows, one record* (see *Grouping* in `field-mapping.ts`).
   * Only ever called for a column-mapped field; a fixed value can't identify a row.
   */
  toggleKey: (key: string) => void;
  /**
   * The distinct raw values this field's mapped column actually carries, from the
   * open sheet — the left side of a translation table. Empty when the field isn't
   * mapped to a column, or there's no sheet open to read them from; the row still
   * shows whatever a saved `valueMap` already names, so a translation survives a
   * closed file.
   */
  columnValues: (key: string) => string[];
  /**
   * Replace this field's column value map — what a raw cell value becomes in the
   * payload instead of going through `afasValue()` unchanged. `undefined` removes
   * it. Only ever called for a column-mapped field; a fixed value has nothing to
   * translate.
   */
  setValueMap: (key: string, valueMap: Record<string, FixedValue> | undefined) => void;
  /**
   * Fill this field by **looking its value up in AFAS** (`FieldSource.lookup`): the
   * cell of `column` picks a row of the GetConnector, and that row's value is sent.
   * Makes the field a column source on `column` if it wasn't one, and drops a value
   * map — the lookup *is* the translation. `undefined` takes the lookup off and
   * leaves the column.
   */
  setLookup: (key: string, lookup: AfasLookup | undefined, column?: LookupColumn) => void;
  /**
   * Multiply this field's cell by `factor` before it is sent (`FieldSource.multiply`)
   * — hours in the sheet, minutes in AFAS. `undefined` takes the factor off. Only
   * ever called for a column-mapped `int`/`decimal` field without a translation.
   */
  setMultiply: (key: string, factor: number | undefined) => void;
  /** The open sheet's columns, for the lookup dialog's column choice. */
  columns: LookupColumn[];
  /** The environment group the lookup dialog lists GetConnectors from. */
  lookupGroup: string;
  /**
   * What the key makes of the mapping as it stands — which object is the kop and
   * which the regel. Null while no column is marked, which is every module but
   * Voorcalculatie. Read here rather than recomputed: it is derived from the whole
   * mapping, and a row only knows its own field.
   */
  groupShape: GroupShape | null;
  /**
   * The column a field can receive right now. `source` is which gesture is holding
   * it, and the row treats the two differently: a **drag** only lights the row up
   * (the pointer is busy, and a button under it would be in the way), a **pick**
   * puts a real *Koppel* button in every row — that is the click-and-keyboard half
   * of the same gesture, and it needs something to press.
   */
  active: { index: number; header: string; source: "drag" | "pick" } | null;
}

/** A quiet pill: a fact about a field, worn next to it. */
function Badge({
  children,
  tone = "quiet",
  title,
}: {
  children: React.ReactNode;
  /** `accent` marks a field the connector insists on; `key` its primary key. */
  tone?: "quiet" | "accent" | "key";
  title?: string;
}) {
  const tones = {
    quiet: "bg-k-bg text-k-text-secondary shadow-inset-sm",
    accent: "bg-k-cloud-light/40 text-k-cloud-deep shadow-inset-sm",
    key: "bg-k-bg text-k-text-primary shadow-inset-sm",
  };
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The **cyan** ink of what the conversion fills itself — the one colour on a field row
 * that isn't the mapping's: cloud-blue is a column, ink a fixed value the admin set, and
 * cyan a rule in the code (`module-phases.ts`) the mapping can't change. Cyan because
 * the design system keeps it for "neither good nor bad", which is what this is.
 */
export const AUTO_BADGE =
  "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full bg-k-cyan-bg px-2 py-0.5 text-[11px] font-semibold leading-none text-k-cyan-fg shadow-inset-sm";

export const AUTO_ICONS: Record<AutoFieldKind, LucideIcon> = {
  computed: SquareFunction,
  always: Lock,
  conditional: Split,
  omitted: EyeOff,
};

/** A rule's badge text, in the reader's language: *Berekend*, *Altijd true*. */
export function useAutoLabel(): (rule: Pick<AutoFieldRule, "kind" | "value">) => string {
  const t = useT();
  return (rule) => {
    switch (rule.kind) {
      case "computed":
        return t("Berekend", "Computed");
      case "always":
        return `${t("Altijd", "Always")} ${String(rule.value)}`;
      case "conditional":
        return t("Voorwaardelijk", "Conditional");
      case "omitted":
        return t("Niet verstuurd", "Not sent");
    }
  };
}

/**
 * One rule the conversion applies to a field or object whatever the mapping says,
 * with the rule's own note as its tooltip — the same words the payload view prints
 * beside the value, so the two can't tell different stories.
 */
function AutoBadge({ rule }: { rule: AutoFieldRule }) {
  const t = useT();
  const label = useAutoLabel();
  const Icon = AUTO_ICONS[rule.kind];
  const explain = {
    computed: t(
      "De conversie rekent deze waarde zelf uit",
      "The conversion works this value out itself"
    ),
    always: t(
      "De conversie stuurt altijd deze waarde, wat de koppeling ook zegt",
      "The conversion always sends this value, whatever the mapping says"
    ),
    conditional: t("Alleen verstuurd voor sommige rijen", "Only sent for some rows"),
    omitted: t(
      "De conversie verstuurt dit niet, ook niet als het gekoppeld is",
      "The conversion doesn't send this, even when it is mapped"
    ),
  }[rule.kind];
  const step = rule.phase ? ` (${t("stap", "step")} ${rule.phase})` : "";
  return (
    <span className={AUTO_BADGE} title={`${explain}${step}: ${rule.note}`}>
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />
      <span className="truncate">
        {label(rule)}
        {rule.phase ? ` · ${rule.phase}` : ""}
      </span>
    </span>
  );
}

/**
 * Whether the mapping's own source for a field is **ignored** — an `always` or
 * `omitted` rule in every step. A `computed` one often reads the mapped value
 * (`EtTy`, `ViKe`), and a `conditional` one sends it for some rows, so neither
 * strikes the mapping through.
 */
function mappingIgnored(rules: AutoFieldRule[]): boolean {
  return rules.some(
    (rule) => rule.phase === null && (rule.kind === "always" || rule.kind === "omitted")
  );
}

/**
 * The box a fixed value is typed in, chosen by what the field's own metainfo
 * allows: a list where AFAS gives one, a date picker for a date, digits for a
 * number. The narrowest control that fits, so most mistakes can't be made rather
 * than being reported afterwards — and `parseFixedValue()` checks whatever comes out
 * of it against the same rules, since a `<select>` can still be bypassed and a date
 * input still hands over text.
 */
function FixedValueEditor({
  field,
  initial,
  onSave,
  onCancel,
}: {
  field: AfasSchemaField;
  /** The value being changed, or "" for a field that has none yet. */
  initial: string;
  onSave: (value: FixedValue) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const kind = fixedInputKind(field);
  const values = field.values ?? [];

  function submit() {
    const parsed = parseFixedValue(field, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    onSave(parsed.value);
  }

  const box =
    "neu-input h-8 min-w-0 rounded-full px-3 text-xs";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-k-bg px-2 py-1.5 shadow-inset-sm"
    >
      <span className="text-[11px] font-medium text-k-text-secondary">Vaste waarde</span>

      {kind === "boolean" ? (
        // Two boxes rather than a dropdown: a field with two values shouldn't cost
        // a menu. They are exclusive — ticking one unticks the other, and unticking
        // the ticked one leaves the field unset.
        <span className="flex flex-1 items-center gap-4">
          {["true", "false"].map((option, index) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-k-text-primary"
            >
              <Checkbox
                autoFocus={index === 0}
                checked={draft === option}
                onChange={() => {
                  setDraft(draft === option ? "" : option);
                  setError("");
                }}
              />
              <code className="font-mono">{option}</code>
            </label>
          ))}
        </span>
      ) : kind === "select" ? (
        <select
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          aria-label={`Vaste waarde voor ${field.fieldId}`}
          className={`${box} flex-1 cursor-pointer`}
        >
          <option value="">Kies…</option>
          {values.map((value) => (
            <option key={value.id} value={value.id}>
              {value.id} — {value.description}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          type={kind === "date" ? "date" : "text"}
          inputMode={kind === "number" ? "decimal" : undefined}
          maxLength={kind === "text" && field.length > 0 ? field.length : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          placeholder={fieldTypeLabel(field)}
          aria-label={`Vaste waarde voor ${field.fieldId}`}
          className={`${box} flex-1`}
        />
      )}

      <button
        type="submit"
        className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs font-semibold"
      >
        Opslaan
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-2 text-xs font-medium"
      >
        Annuleren
      </button>
      {error && (
        <span role="alert" className="w-full text-[11px] font-medium text-k-red-fg">
          {error}
        </span>
      )}
    </form>
  );
}

/**
 * The factor a mapped column's number is multiplied by before it is sent — the one
 * arithmetic a mapping can carry, for a sheet whose unit isn't AFAS's
 * (`hrm-verlofsaldo`'s *Huidig Saldo (in Uren)* into `HhMm`, minutes: ×60).
 */
function MultiplyEditor({
  field,
  header,
  initial,
  onSave,
  onRemove,
  onCancel,
}: {
  field: AfasSchemaField;
  /** The mapped column, for the sentence the form reads as. */
  header: string;
  /** The factor being changed, or `undefined` for a field without one yet. */
  initial: number | undefined;
  onSave: (factor: number) => void;
  /** Only offered when there is a factor to take off. */
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial === undefined ? "" : String(initial));
  const [error, setError] = useState("");

  function submit() {
    const factor = Number(draft.trim().replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(factor) || factor === 0) {
      setError("Vul een getal in dat niet 0 is, bijv. 60.");
      return;
    }
    onSave(factor);
  }

  const box =
    "neu-input h-8 w-24 min-w-0 rounded-full px-3 text-xs";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-k-bg px-2 py-1.5 shadow-inset-sm"
    >
      <span className="text-[11px] font-medium text-k-text-secondary">
        Kolom &ldquo;{header}&rdquo; vermenigvuldigen met
      </span>
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        placeholder="60"
        aria-label={`Vermenigvuldiging voor ${field.fieldId}`}
        className={box}
      />
      <button
        type="submit"
        className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs font-semibold"
      >
        Opslaan
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-2 text-xs font-medium text-k-red-fg! hover:text-k-red-fg!"
        >
          Verwijderen
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-2 text-xs font-medium"
      >
        Annuleren
      </button>
      {field.dataType.toLowerCase() === "int" && (
        <span className="w-full text-[11px] text-k-text-secondary">
          {field.fieldId} is een geheel getal: de uitkomst wordt afgerond.
        </span>
      )}
      {error && (
        <span role="alert" className="w-full text-[11px] font-medium text-k-red-fg">
          {error}
        </span>
      )}
    </form>
  );
}

/**
 * The table a mapped column's raw values are translated through before they reach
 * the field — one row per distinct value the sheet actually carries, each beside the
 * AFAS value it should become instead. Exists because the sheet carries the
 * client's own codes and AFAS regularly wants its own, not even in the same order
 * (`erp-voorcalculatie`'s *Type item*: `Wst`→`1`, `Art`→`2`, `Kst`→`6`, `Sam`→`7`).
 *
 * The target box is the same control `FixedValueEditor` uses for the same field — a
 * list where AFAS gives one, free text otherwise — so a value this app would refuse
 * as a fixed value can't be typed here either. A row left blank simply isn't
 * translated: that raw value still goes out as `afasValue()` sends it today, which
 * is a visible AFAS refusal rather than a silent guess.
 */
function ValueMapEditor({
  field,
  rawValues,
  initial,
  onSave,
  onCancel,
}: {
  field: AfasSchemaField;
  /** The column's own distinct values, in sheet order (or a saved map's, if wider). */
  rawValues: string[];
  initial: Record<string, FixedValue>;
  onSave: (map: Record<string, FixedValue>) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rawValues.map((raw) => [raw, initial[raw] !== undefined ? String(initial[raw]) : ""])
    )
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const kind = fixedInputKind(field);
  const values = field.values ?? [];

  function submit() {
    const map: Record<string, FixedValue> = {};
    const nextErrors: Record<string, string> = {};
    for (const raw of rawValues) {
      const draft = (drafts[raw] ?? "").trim();
      if (draft === "") continue; // no entry — this value stays unmapped
      const parsed = parseFixedValue(field, draft);
      if (!parsed.ok) {
        nextErrors[raw] = parsed.message;
        continue;
      }
      map[raw] = parsed.value;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSave(map);
  }

  const box =
    "neu-input h-8 min-w-0 flex-1 rounded-full px-3 text-xs";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mt-1.5 rounded-xl bg-k-bg px-2 py-1.5 shadow-inset-sm"
    >
      <p className="text-[11px] font-medium text-k-text-secondary">
        Vertaaltabel — wat de kolom bevat, tegenover wat AFAS krijgt
      </p>
      <ul className="mt-1.5 space-y-1">
        {rawValues.map((raw, index) => (
          <li key={raw} className="flex items-center gap-2">
            <code
              className="w-28 shrink-0 truncate rounded-md bg-k-bg px-2 py-1 text-xs text-k-text-primary shadow-inset-sm"
              title={raw}
            >
              {raw}
            </code>
            <span className="text-k-text-tertiary" aria-hidden>
              →
            </span>
            {kind === "select" ? (
              <select
                autoFocus={index === 0}
                value={drafts[raw] ?? ""}
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [raw]: e.target.value }));
                  setErrors((err) => ({ ...err, [raw]: "" }));
                }}
                aria-label={`AFAS-waarde voor "${raw}"`}
                className={`${box} cursor-pointer`}
              >
                <option value="">Onvertaald — gaat als tekst mee</option>
                {values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.id} — {value.description}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus={index === 0}
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "number" ? "decimal" : undefined}
                value={drafts[raw] ?? ""}
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [raw]: e.target.value }));
                  setErrors((err) => ({ ...err, [raw]: "" }));
                }}
                placeholder="onvertaald"
                aria-label={`AFAS-waarde voor "${raw}"`}
                className={box}
              />
            )}
            {errors[raw] && (
              <span role="alert" className="text-[11px] font-medium text-k-red-fg">
                {errors[raw]}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs font-semibold"
        >
          Opslaan
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="neu-button h-8 shrink-0 cursor-pointer rounded-full px-2 text-xs font-medium"
        >
          Annuleren
        </button>
      </div>
    </form>
  );
}

/**
 * One field, in four columns: its code, its label, what fills it, and what AFAS will
 * accept in it. The code leads and is set in mono — it is the only string here that
 * ends up in a payload — with the label beside it as the Dutch word for the same thing.
 *
 * Then **what fills the field**, in a column of its own: code, label and mapping all
 * have a fixed width, so every row's badge starts at the same x and the mapping reads
 * as a column of the table rather than as one more pill in the cluster on the right.
 * That cluster is the schema's own facts (type, verplicht, sleutel), which vary in
 * width per row — a mapping parked at the end of it landed somewhere different in
 * every row, which is precisely where the eye can't follow it.
 *
 * A field with a value list carries the list behind a button rather than inline:
 * some run to dozens of codes, and the answer to "what may I put here" is only
 * asked of one field at a time.
 */
function FieldRow({
  field,
  mappingFieldKey,
  mapping,
  autoRules = [],
}: {
  field: AfasSchemaField;
  /** This field's key in the mapping — its object's path plus its id. */
  mappingFieldKey: string;
  mapping?: FieldMappingApi;
  /** What the conversion does to this field itself, whatever the mapping says. */
  autoRules?: AutoFieldRule[];
}) {
  const t = useT();
  const ignored = mappingIgnored(autoRules);
  const [showValues, setShowValues] = useState(false);
  const [editing, setEditing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [multiplying, setMultiplying] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  // A drop lands on the row, not on the cell under the cursor, so the row has to
  // know whether the pointer is still inside it — hence a counter rather than a
  // boolean: dragging over a child element fires `dragleave` on the parent.
  const [over, setOver] = useState(0);
  const values = field.values ?? [];
  const source = mapping?.sourceFor(mappingFieldKey) ?? null;
  const active = mapping?.active ?? null;
  const receiving = over > 0 && active !== null;
  // The translation table's two sides: what a saved map already carries, and every
  // raw value it could carry — the union, so a value the sheet no longer shows
  // (a different file dropped) doesn't fall out of the editor and get silently
  // dropped, and a fresh value the sheet does show gets an empty row to fill in.
  // A sheet value that differs from a saved key only in casing (`WST` against `Wst`)
  // is that key's row, not a new one — the payload looks it up case-insensitively
  // (`lookupValueMap()`), so a second, empty row would only suggest it is untranslated.
  const existingValueMap = source?.kind === "column" ? (source.valueMap ?? {}) : {};
  const savedKeys = Object.keys(existingValueMap);
  const rawValues =
    source?.kind === "column"
      ? [
          ...new Set([
            ...(mapping?.columnValues(mappingFieldKey) ?? []).map(
              (raw) => savedKeys.find((k) => k.toLowerCase() === raw.toLowerCase()) ?? raw
            ),
            ...savedKeys,
          ]),
        ]
      : [];
  const hasValueMap = Object.keys(existingValueMap).length > 0;
  const lookup = source?.kind === "column" ? (source.lookup ?? null) : null;
  const multiply = source?.kind === "column" ? source.multiply : undefined;
  // A factor scales the cell's number; a translation or a lookup replaces the cell —
  // so a field takes one of the three, and only a numeric field takes a factor.
  const offerMultiply = canMultiply(field) && !lookup && !hasValueMap;
  // The button that opens the lookup dialog — the same control whether the field is
  // still empty or already reads a column, pressed in once a lookup is set, like the
  // key and translation toggles beside it.
  const lookupButton = mapping && (
    <button
      type="button"
      onClick={() => setLookingUp(true)}
      aria-label={
        lookup
          ? `AFAS-opzoeking voor ${field.fieldId} bewerken`
          : `Waarde voor ${field.fieldId} opzoeken in AFAS`
      }
      title={
        lookup
          ? `${lookupSummary(lookup)} aan kolom "${source?.kind === "column" ? source.header : ""}" — klik om te bewerken`
          : "Waarde opzoeken in AFAS — via een kolom uit het bestand, in een GetConnector van de omgeving waarnaar wordt verstuurd"
      }
      className={`inline-flex shrink-0 cursor-pointer items-center rounded-full px-1.5 py-0.5 transition-[box-shadow,color] duration-200 ${
        lookup
          ? "bg-k-bg text-k-cloud-deep shadow-inset-sm"
          : "neu-button"
      }`}
    >
      <DatabaseSearch className="h-3 w-3 shrink-0" strokeWidth={2.5} />
    </button>
  );

  return (
    <li
      onDragOver={
        mapping &&
        ((e) => {
          // Without this the browser refuses the drop — the default is "no".
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        })
      }
      onDragEnter={mapping && (() => setOver((depth) => depth + 1))}
      onDragLeave={mapping && (() => setOver((depth) => Math.max(0, depth - 1)))}
      onDrop={
        mapping &&
        ((e) => {
          e.preventDefault();
          setOver(0);
          if (active) mapping.assign(mappingFieldKey, active.index);
        })
      }
      className={`rounded-xl px-2 py-1.5 transition-colors ${
        receiving
          ? "bg-k-cloud-light/40 shadow-[var(--k-shadow-inset),0_0_0_3px_var(--k-cloud-light)]"
          : active
            ? "shadow-[0_0_0_1px_var(--k-cloud-light)] hover:bg-k-tint"
            : "hover:bg-k-tint"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <code className="w-40 shrink-0 truncate font-mono text-xs font-semibold text-k-text-primary">
          {field.fieldId}
        </code>

        <span className="w-48 shrink-0 truncate text-sm text-k-text-primary" title={field.label}>
          {field.label}
        </span>

        {/* What fills the field, in its own column behind code and label — the two
            names of the same thing stay together, and what fills it follows them.
            Only on a page that maps: a schema reader gets the old two-column row
            back, since an empty lane there would be a column about nothing. */}
        {mapping && (
          <span className="flex w-48 shrink-0 flex-wrap items-center gap-1">
            {/* Mapped and ignored anyway: the source stays (it is still the admin's
                to remove) but reads as crossed out, so nobody thinks it is sent. */}
            {ignored && source !== null && (
              <span className="sr-only">
                {t("Koppeling wordt genegeerd:", "Mapping is ignored:")}
              </span>
            )}
            <span
              className={`flex min-w-0 max-w-full items-center gap-1 ${
                ignored && source !== null ? "line-through decoration-2 opacity-45" : ""
              }`}
              title={
                ignored && source !== null
                  ? t(
                      "Deze koppeling wordt niet gebruikt — de conversie bepaalt dit veld zelf",
                      "This mapping isn't used — the conversion decides this field itself"
                    )
                  : undefined
              }
            >
            {/* Cloud-blue for a column, ink for a value of its own — two different
                kinds of answer, told apart at a glance. */}
            {source?.kind === "column" && (
              <>
                <button
                  type="button"
                  onClick={() => mapping.clear(mappingFieldKey)}
                  title={
                    lookup
                      ? `${lookup.valueField} uit ${lookup.connector}, opgezocht via kolom "${source.header}" (${lookup.matchField}) — klik om de koppeling te verwijderen`
                      : `Kolom "${source.header}" — klik om de koppeling te verwijderen`
                  }
                  className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-full bg-k-bg px-2 py-0.5 text-[11px] font-semibold leading-none text-k-cloud-deep shadow-inset-sm transition-[box-shadow,color] duration-200"
                >
                  {/* A looked-up field is named after what it is filled **with** —
                      the AFAS field whose value is sent — not after the column that
                      only finds the row; otherwise it reads exactly like a field that
                      sends that column's cell as it is. */}
                  {lookup ? (
                    <DatabaseSearch className="h-3 w-3 shrink-0" strokeWidth={2} />
                  ) : (
                    <Link2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                  )}
                  <span className="truncate">{lookup ? lookup.valueField : source.header}</span>
                  <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                </button>
                {/* *Groepeer op* — the second thing a mapped column can say, and the
                    only control behind the whole grouping concept. Beside the pill it
                    modifies rather than in the facts cluster on the right: that
                    cluster is what AFAS says about the field, this is a decision
                    about the sheet. Pressed in when on, matching the `sleutel`
                    badge's tone — both mean "this identifies the record". */}
                <button
                  type="button"
                  onClick={() => mapping.toggleKey(mappingFieldKey)}
                  aria-pressed={Boolean(source.key)}
                  aria-label={
                    source.key
                      ? `Niet meer groeperen op ${source.header}`
                      : `Groeperen op ${source.header}`
                  }
                  title={
                    source.key
                      ? `Groeperen op "${source.header}" — rijen met dezelfde waarde worden één record. Klik om dat op te heffen.`
                      : `Groeperen op "${source.header}" — maak deze kolom deel van de sleutel die rijen tot één record samenvoegt`
                  }
                  className={`inline-flex shrink-0 cursor-pointer items-center rounded-full px-1.5 py-0.5 transition-[box-shadow,color] duration-200 ${
                    source.key
                      ? "bg-k-bg text-k-cloud-deep shadow-inset-sm"
                      : "neu-button"
                  }`}
                >
                  <KeyRound className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                </button>
                {/* *Vertaaltabel* — the sheet's own codes are regularly not AFAS's;
                    only offered once there is something to translate: a raw value
                    from the open sheet, or one a saved map already names. */}
                {rawValues.length > 0 && !lookup && multiply === undefined && (
                  <button
                    type="button"
                    onClick={() => setTranslating((open) => !open)}
                    aria-pressed={translating}
                    aria-label={
                      hasValueMap
                        ? `Vertaaltabel voor ${field.fieldId} bewerken`
                        : `Vertaaltabel voor ${field.fieldId} instellen`
                    }
                    title={
                      hasValueMap
                        ? `Vertaalt ${Object.keys(existingValueMap).length} van de ${rawValues.length} waarden — klik om te bewerken`
                        : "Ruwe kolomwaarden vertalen naar wat AFAS hier verwacht"
                    }
                    className={`inline-flex shrink-0 cursor-pointer items-center rounded-full px-1.5 py-0.5 transition-[box-shadow,color] duration-200 ${
                      hasValueMap
                        ? "bg-k-bg text-k-cloud-deep shadow-inset-sm"
                        : "neu-button"
                    }`}
                  >
                    <ArrowRightLeft className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                  </button>
                )}
                {/* *Opzoeken in AFAS* — not while a translation table is set: both
                    translate the cell, and a field takes one. */}
                {/* *Vermenigvuldigen* — the sheet's unit isn't always AFAS's (hours
                    in, minutes out). Pressed in with the factor once set, like the
                    toggles beside it. */}
                {offerMultiply && (
                  <button
                    type="button"
                    onClick={() => setMultiplying((open) => !open)}
                    aria-pressed={multiplying}
                    aria-label={
                      multiply !== undefined
                        ? `Vermenigvuldiging voor ${field.fieldId} bewerken`
                        : `Vermenigvuldiging voor ${field.fieldId} instellen`
                    }
                    title={
                      multiply !== undefined
                        ? `Kolom "${source.header}" × ${multiply} — klik om te bewerken`
                        : "Kolomwaarde vermenigvuldigen voor hij naar AFAS gaat (bijv. uren × 60 = minuten)"
                    }
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none transition-[box-shadow,color] duration-200 ${
                      multiply !== undefined
                        ? "bg-k-bg text-k-cloud-deep shadow-inset-sm"
                        : "neu-button"
                    }`}
                  >
                    <Calculator className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                    {multiply !== undefined && <span>×{multiply}</span>}
                  </button>
                )}
                {!hasValueMap && multiply === undefined && lookupButton}
                {/* *Terugvalkolom* — read-only: set in the mapping file
                    (`FieldSource.fallback`), shown so the field doesn't look like
                    it only ever reads its own column. */}
                {source.fallback && (
                  <span
                    title={`Leeg in "${source.header}"? Dan geldt "${source.fallback.header}"`}
                    className="inline-flex min-w-0 shrink items-center gap-0.5 rounded-full bg-k-bg px-1.5 py-0.5 text-[11px] font-semibold leading-none text-k-text-primary shadow-inset-sm"
                  >
                    <CornerDownRight className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                    <span className="truncate">{source.fallback.header}</span>
                  </span>
                )}
              </>
            )}
            {source?.kind === "fixed" && !editing && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-k-bg px-2 py-0.5 text-[11px] font-semibold leading-none text-k-text-primary shadow-inset-sm">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Vaste waarde wijzigen"
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1"
                >
                  <Equal className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                  <span className="truncate">{String(source.value)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => mapping.clear(mappingFieldKey)}
                  aria-label="Vaste waarde verwijderen"
                  title="Vaste waarde verwijderen"
                  className="cursor-pointer opacity-80 transition-opacity hover:opacity-100"
                >
                  <X className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                </button>
              </span>
            )}
            {/* The keyboard's half of the gesture: with a column picked, every field
                offers to take it. Native drag-and-drop has no keyboard at all. */}
            {source === null && active?.source === "pick" && (
              <button
                type="button"
                onClick={() => mapping.assign(mappingFieldKey, active.index)}
                title={`Kolom "${active.header}" aan ${field.fieldId} koppelen`}
                className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-full bg-k-cloud-light/40 px-2 py-0.5 text-[11px] font-medium leading-none text-k-cloud-deep shadow-inset-sm transition-[box-shadow,color] duration-200"
              >
                <Link2 className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="truncate">Koppel {active.header}</span>
              </button>
            )}
            {/* A value of its own, for the fields that are the same for every row.
                Offered while nothing else fills the field — one field, one source.
                It shares the lane with *Koppel* while a pick is held, which is what
                the truncation on that button is for. */}
            {source === null && !editing && !ignored && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Vaste waarde voor ${field.fieldId} instellen`}
                title="Vaste waarde instellen"
                className="inline-flex shrink-0 cursor-pointer items-center rounded-full px-1.5 py-0.5 text-k-text-tertiary neu-button"
              >
                <Equal className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              </button>
            )}
            {/* The third source, beside a column and a fixed value: a value AFAS
                holds, found by a column of the sheet. */}
            {source === null && !editing && !ignored && lookupButton}
            </span>
            {autoRules.map((rule, index) => (
              <AutoBadge key={index} rule={rule} />
            ))}
          </span>
        )}

        {/* The schema's own facts, against the right edge — `ml-auto` rather than a
            stretching label, so the three columns to the left keep their width and
            every row's badge sits under the one above it. */}
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          {/* Verplicht leads: whether a field *has* to be filled decides whether the
              reader has to do something about it, where its type only says what
              with — and this is the column that tells them the mapping isn't done. */}
          {field.mandatory && <Badge tone="accent">verplicht</Badge>}
          <Badge>{fieldTypeLabel(field)}</Badge>
          {field.primaryKey && (
            <Badge tone="key" title="Sleutelveld — bij een wijziging als @-veld in Element">
              sleutel
            </Badge>
          )}
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => setShowValues((open) => !open)}
              aria-expanded={showValues}
              className="neu-button inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
            >
              <List className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              {values.length} waarden
            </button>
          )}
        </span>
      </div>

      {editing && mapping && (
        <FixedValueEditor
          field={field}
          initial={source?.kind === "fixed" ? fixedValueInput(field, source.value) : ""}
          onSave={(value) => {
            mapping.setFixed(mappingFieldKey, value);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {translating && mapping && source?.kind === "column" && (
        <ValueMapEditor
          field={field}
          rawValues={rawValues}
          initial={existingValueMap}
          onSave={(map) => {
            mapping.setValueMap(mappingFieldKey, Object.keys(map).length > 0 ? map : undefined);
            setTranslating(false);
          }}
          onCancel={() => setTranslating(false)}
        />
      )}

      {multiplying && mapping && source?.kind === "column" && (
        <MultiplyEditor
          field={field}
          header={source.header}
          initial={multiply}
          onSave={(factor) => {
            mapping.setMultiply(mappingFieldKey, factor);
            setMultiplying(false);
          }}
          onRemove={
            multiply !== undefined
              ? () => {
                  mapping.setMultiply(mappingFieldKey, undefined);
                  setMultiplying(false);
                }
              : undefined
          }
          onCancel={() => setMultiplying(false)}
        />
      )}

      {lookingUp && mapping && (
        <AfasLookupDialog
          field={field}
          group={mapping.lookupGroup}
          columns={mapping.columns}
          initial={{
            column:
              source?.kind === "column" ? { index: source.index, header: source.header } : null,
            lookup,
          }}
          onSave={({ lookup: next, column }) => {
            mapping.setLookup(mappingFieldKey, next, column);
            setLookingUp(false);
          }}
          onRemove={
            lookup
              ? () => {
                  mapping.setLookup(mappingFieldKey, undefined);
                  setLookingUp(false);
                }
              : undefined
          }
          onClose={() => setLookingUp(false)}
        />
      )}

      {showValues && (
        <ul className="mt-1.5 flex max-h-48 flex-wrap gap-1 overflow-y-auto pl-2">
          {values.map((value) => (
            <li
              key={value.id}
              className="rounded-full bg-k-bg px-2 py-0.5 text-[11px] text-k-text-secondary shadow-inset-sm"
            >
              <code className="font-mono font-semibold text-k-text-primary">{value.id}</code>{" "}
              {value.description}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One object of the payload tree, with its nested objects under it — the root
 * included, which is why this component renders itself.
 *
 * Collapsed by default (the page decides; `KnSubject` alone carries 63 nested
 * objects), and every header says what opening it will show: its own fields, how
 * many of them AFAS insists on, and how many objects hang underneath. The counts
 * are the object's **own**, not its subtree's, so the header and the body agree.
 *
 * Nested objects are indented behind a rule rather than by margin alone: at three
 * levels deep the only thing saying *this belongs to that* is the line.
 */
export default function SchemaObjectSection({
  object,
  parentPath = "",
  depth = 0,
  isOpen,
  onToggle,
  mapping,
  auto,
}: {
  object: AfasSchemaObject;
  /** The path of the object above this one; empty for the root. */
  parentPath?: string;
  depth?: number;
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  /** Left out on a page that only reads the schema; see {@link FieldMappingApi}. */
  mapping?: FieldMappingApi;
  /** What the conversion fills, limits or drops itself — `module-phases.ts`. */
  auto?: AutoFieldRules | null;
}) {
  const path = objectPath(parentPath, object.name);
  const objectRules = auto?.objects.get(path) ?? [];
  const open = isOpen(path);
  const fields = fieldsOf(object);
  const children = objectsOf(object);
  const mandatory = fields.filter((field) => field.mandatory).length;
  // Which side of the grouping this object is on, if the mapping groups at all.
  const shape = mapping?.groupShape ?? null;
  const role =
    shape === null
      ? null
      : shape.headerPath === path
        ? "header"
        : shape.linePath === path
          ? "line"
          : null;

  return (
    <section
      className={`overflow-hidden bg-k-bg ${
        depth === 0 ? "rounded-2xl shadow-raised" : "rounded-xl shadow-raised-sm"
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(path)}
        // A column dragged onto a closed object opens it, so a field two levels
        // down can be reached without dropping the drag to click first.
        onDragEnter={() => {
          if (mapping?.active && !open) onToggle(path);
        }}
        onDragOver={(e) => {
          if (mapping?.active) e.preventDefault();
        }}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-k-tint"
      >
        <ChevronRight
          aria-hidden
          className={`h-4 w-4 shrink-0 text-k-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <code
          className={`min-w-0 truncate font-mono font-semibold text-k-text-primary ${
            depth === 0 ? "text-sm" : "text-xs"
          }`}
        >
          {object.name}
        </code>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* What the group key made of this object — derived, never clicked. The one
              control is the key toggle on a field; this is the page saying what it
              understood, so *one record per offerte, one element per regel* is
              visible at the object it applies to instead of inferred. */}
          {role === "header" && (
            <span
              title="Kop — dit object wordt één keer geschreven per groep rijen, met de waarden uit de eerste rij van die groep"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-k-bg px-2 py-0.5 text-[11px] font-semibold leading-none text-k-text-primary shadow-inset-sm"
            >
              <KeyRound className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              kop
            </span>
          )}
          {role === "line" && (
            <span
              title="Regel — van dit object komt één element per rij van de groep, als array onder Element"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-k-bg px-2 py-0.5 text-[11px] font-semibold leading-none text-k-cloud-deep shadow-inset-sm"
            >
              <Rows3 className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              regel per rij
            </span>
          )}
          {objectRules.map((rule, index) => (
            <AutoBadge key={index} rule={rule} />
          ))}
          <Badge>{fields.length} velden</Badge>
          {mandatory > 0 && <Badge tone="accent">{mandatory} verplicht</Badge>}
          {children.length > 0 && <Badge tone="key">{children.length} objecten</Badge>}
        </span>
      </button>

      {open && (
        <div className="border-t border-k-divider px-3 py-2.5">
          {fields.length > 0 ? (
            <ul className="space-y-0.5">
              {fields.map((field) => (
                <FieldRow
                  key={field.fieldId}
                  field={field}
                  mappingFieldKey={fieldKey(path, field.fieldId)}
                  mapping={mapping}
                  autoRules={auto?.fields.get(fieldKey(path, field.fieldId))}
                />
              ))}
            </ul>
          ) : (
            <p className="px-2 py-1 text-sm text-k-text-secondary">
              Dit object heeft zelf geen velden.
            </p>
          )}

          {children.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-k-divider pl-3">
              {children.map((child) => (
                <SchemaObjectSection
                  key={child.name}
                  object={child}
                  parentPath={path}
                  depth={depth + 1}
                  isOpen={isOpen}
                  onToggle={onToggle}
                  mapping={mapping}
                  auto={auto}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
