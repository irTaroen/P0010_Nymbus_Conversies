/**
 * Pure, value-level checks. Each works on the trimmed cell string and returns
 * `null` when OK or a default NL message when it fails. The engine decides
 * may override the message; these functions never throw.
 *
 * Empty values are the engine's concern: only `required` flags them, every
 * other check is skipped for an empty cell.
 */

// Relative and with its extension: scripts/sync-module-help.mts runs this file
// straight through Node, which knows neither the `@/` alias nor extensionless paths.
import { tr } from "../i18n.ts";
import type { ColumnRules, RuleCheck } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Postcode format per AFAS landcode — AFAS codes countries the way the road signs
 * do, not ISO: Belgium is `B`, Germany `D`, Spain `E` (`S` is Sweden). A land with
 * no entry here has no format check. Which of these a column applies is the
 * rule's `values`; without them only `NL`.
 */
const POSTCODE_FORMATS: Record<string, { re: RegExp; message: () => string }> = {
  // 1234 AB, space optional (the SA/SD/SS letter exclusions are ignored).
  NL: {
    re: /^[1-9][0-9]{3}\s?[a-zA-Z]{2}$/,
    message: () =>
      tr(
        "Ongeldige postcode — een Nederlandse postcode is 4 cijfers en 2 letters (bijv. 1013 BG)",
        "Invalid postcode — a Dutch postcode is 4 digits and 2 letters (e.g. 1013 BG)",
      ),
  },
  B: {
    re: /^[1-9][0-9]{3}$/,
    message: () =>
      tr(
        "Ongeldige postcode — een Belgische postcode is 4 cijfers (bijv. 1000)",
        "Invalid postcode — a Belgian postcode is 4 digits (e.g. 1000)",
      ),
  },
  D: {
    re: /^[0-9]{5}$/,
    message: () =>
      tr(
        "Ongeldige postcode — een Duitse postcode is 5 cijfers (bijv. 10115)",
        "Invalid postcode — a German postcode is 5 digits (e.g. 10115)",
      ),
  },
  PL: {
    re: /^[0-9]{2}-[0-9]{3}$/,
    message: () =>
      tr(
        "Ongeldige postcode — een Poolse postcode is 2 cijfers, een streepje en 3 cijfers (bijv. 00-950)",
        "Invalid postcode — a Polish postcode is 2 digits, a hyphen and 3 digits (e.g. 00-950)",
      ),
  },
  // The first two digits are the province, 01–52.
  E: {
    re: /^(0[1-9]|[1-4][0-9]|5[0-2])[0-9]{3}$/,
    message: () =>
      tr(
        "Ongeldige postcode — een Spaanse postcode is 5 cijfers, beginnend met 01 t/m 52 (bijv. 28013)",
        "Invalid postcode — a Spanish postcode is 5 digits, starting with 01 to 52 (e.g. 28013)",
      ),
  },
};

/** Postcode check for one land; a land without a known format always passes. */
function postcodeError(value: string, land: string): string | null {
  const format = POSTCODE_FORMATS[land.toUpperCase()];
  if (!format) return null;
  return format.re.test(value) ? null : format.message();
}
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,}$/;

/**
 * Parse a numeric string, tolerating a comma decimal separator (40,5).
 *
 * Only the shape the `decimal` type accepts (`-12`, `40,5`, `3.25`): `Number`
 * alone also takes `Infinity`, `0x1F` and `1e5`, which would then pass a `min`
 * or `max` the sheet's value never met.
 */
export function toNum(s: string): number | null {
  const text = s.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
  return Number(text.replace(",", "."));
}

/** IBAN check: structure + mod-97. */
function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // mod-97 in chunks to avoid BigInt/precision issues.
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/**
 * Dutch BSN: 9 digits passing the 11-proef. An 8-digit BSN is one with a leading
 * zero — Excel stores the column as a number and drops it — so it is padded back
 * before the proef rather than rejected.
 */
function isValidBsn(value: string): boolean {
  let bsn = value.replace(/\s/g, "");
  if (/^[0-9]{8}$/.test(bsn)) bsn = "0" + bsn;
  if (!/^[0-9]{9}$/.test(bsn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const weight = i === 8 ? -1 : 9 - i;
    sum += Number(bsn[i]) * weight;
  }
  return sum % 11 === 0;
}

/**
 * The body of a btw-nummer after its country prefix, per EU member state — the
 * formats the EU's VIES service validates against. `EL` is Greece (VIES never
 * uses `GR`), `XI` Northern Ireland, which kept EU VAT for goods after Brexit.
 * AFAS refuses a btw-nummer that doesn't start with one of these ("Het ingevulde
 * btw-nummer is niet juist. Dit moet beginnen met een code land uit de EU").
 */
const VAT_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/**
 * Btw-nummer: an EU country code followed by that country's format. The value
 * goes to AFAS as written, so spaces, dots and lower case are errors too rather
 * than something normalised away here.
 */
function vatError(value: string): string | null {
  const prefix = value.slice(0, 2).toUpperCase();
  const format = VAT_FORMATS[prefix];
  if (!format)
    return prefix === "GR"
      ? tr(
          "Ongeldig btw-nummer — Griekenland gebruikt landcode EL, niet GR",
          "Invalid VAT number — Greece uses country code EL, not GR",
        )
      : tr(
          "Ongeldig btw-nummer — moet beginnen met een landcode uit de EU (bijv. NL, BE, DE)",
          "Invalid VAT number — must start with an EU country code (e.g. NL, BE, DE)",
        );
  if (/[\s.\-]/.test(value))
    return tr(
      "Ongeldig btw-nummer — zonder spaties, punten of koppeltekens",
      "Invalid VAT number — no spaces, dots or hyphens",
    );
  if (value !== value.toUpperCase())
    return tr(
      "Ongeldig btw-nummer — gebruik hoofdletters (bijv. NL123456789B01)",
      "Invalid VAT number — use capital letters (e.g. NL123456789B01)",
    );
  if (!format.test(value.slice(2)))
    return prefix === "NL"
      ? tr(
          "Ongeldig btw-nummer — Nederlands formaat is NL + 9 cijfers + B + 2 cijfers",
          "Invalid VAT number — the Dutch format is NL + 9 digits + B + 2 digits",
        )
      : tr(
          `Ongeldig btw-nummer — klopt niet met het formaat voor ${prefix}`,
          `Invalid VAT number — does not match the format for ${prefix}`,
        );
  return null;
}

/** Does `value` match the date `format` (any of several, separated by "|")? */
function dateMatches(value: string, format: string): boolean {
  return format.split("|").some((f) => {
    const tokens = parseDateTokens(value.trim(), f.trim());
    if (!tokens) return false;
    // A format that spells out a full date must name a day that exists; one that
    // doesn't (a time like "HH:mm") has no calendar to check it against.
    return hasFullDate(tokens) ? timestampFrom(tokens) !== null : true;
  });
}

/**
 * Parse a cell as a date in any of `format`'s alternatives, as a UTC timestamp —
 * what lets a cross-field rule compare two date cells chronologically instead of
 * as text, where "28-01-2026" would outrank "01-02-2026".
 *
 * Null when the value matches none of the formats, names a day that doesn't exist
 * (31-02-2025), or carries no full date at all (a time-only format). Callers treat
 * that as "can't say" rather than as a failed comparison — the column's own `date`
 * type check is what reports a malformed value.
 */
export function toDate(value: string, format = "DD-MM-YYYY"): number | null {
  for (const f of format.split("|")) {
    const tokens = parseDateTokens(value.trim(), f.trim());
    if (tokens && hasFullDate(tokens)) {
      const ts = timestampFrom(tokens);
      if (ts !== null) return ts;
    }
  }
  return null;
}

const DATE_TOKEN_RE = /(YYYY|YY|DD|MM|HH|mm|ss)/g;

// A compiled date format: the matching regex plus the capture-group order.
// Compiling is cheap but runs once per cell otherwise — cache by format string
// so a full column reuses one compiled form.
const formatCache = new Map<string, { re: RegExp; order: string[] }>();

function compileFormat(format: string): { re: RegExp; order: string[] } {
  const cached = formatCache.get(format);
  if (cached) return cached;

  let regex = "^";
  const order: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  DATE_TOKEN_RE.lastIndex = 0;
  while ((m = DATE_TOKEN_RE.exec(format))) {
    regex += escapeRegex(format.slice(last, m.index));
    regex += m[1] === "YYYY" ? "(\\d{4})" : "(\\d{2})";
    order.push(m[1]);
    last = m.index + m[1].length;
  }
  regex += escapeRegex(format.slice(last)) + "$";

  const compiled = { re: new RegExp(regex), order };
  formatCache.set(format, compiled);
  return compiled;
}

/**
 * The tokens `format` finds in `value` (`{ DD: 1, MM: 2, YYYY: 2026 }`), or null
 * when the pattern doesn't match or a token is out of its own range. Range alone
 * can't reject 31-02 — every token is in range — so that is {@link timestampFrom}'s
 * job.
 */
function parseDateTokens(value: string, format: string): Record<string, number> | null {
  const { re, order } = compileFormat(format);
  const match = re.exec(value);
  if (!match) return null;

  const v: Record<string, number> = {};
  order.forEach((tok, i) => (v[tok] = Number(match![i + 1])));
  if (v.MM !== undefined && (v.MM < 1 || v.MM > 12)) return null;
  if (v.DD !== undefined && (v.DD < 1 || v.DD > 31)) return null;
  if (v.HH !== undefined && v.HH > 23) return null;
  if (v.mm !== undefined && v.mm > 59) return null;
  if (v.ss !== undefined && v.ss > 59) return null;
  return v;
}

/** The parsed tokens name a whole date (a two-digit year counts as 20YY). */
function hasFullDate(v: Record<string, number>): boolean {
  return (v.YYYY !== undefined || v.YY !== undefined) && v.MM !== undefined && v.DD !== undefined;
}

/**
 * The tokens as a UTC timestamp, or null when they name a day that doesn't exist.
 * `Date.UTC` rolls 31-02 over into March rather than refusing it, so reading the
 * parts back out is what catches an impossible date.
 */
function timestampFrom(v: Record<string, number>): number | null {
  const year = v.YYYY ?? 2000 + (v.YY ?? 0);
  const ts = Date.UTC(year, v.MM - 1, v.DD, v.HH ?? 0, v.mm ?? 0, v.ss ?? 0);
  const date = new Date(ts);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === v.MM - 1 &&
    date.getUTCDate() === v.DD
    ? ts
    : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cache regexes from `regex` rules so a column's pattern compiles once, not per cell.
const ruleRegexCache = new Map<string, RegExp>();

function ruleRegex(pattern: string, flags?: string): RegExp {
  // A NUL joins the two halves: it can occur in neither, so no flags/pattern
  // pair can collide with another's key. Spelled as an escape — a literal NUL
  // byte makes git treat this file as binary and hides it from grep.
  const key = `${flags ?? ""}\u0000${pattern}`;
  let re = ruleRegexCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    ruleRegexCache.set(key, re);
  }
  return re;
}

/**
 * Whether a column can produce a finding at all: it carries a rule, or a `type`
 * {@link runTypeCheck} actually enforces (`text`, and no type, enforce nothing).
 * A column that only carries a name — `Roepnaam`, `Voorvoegsel` — is described
 * by the rule set but checked by nothing, so its cells stay out of the
 * completeness figure's denominator (`ValidationResult.checkedCells`). Counting
 * them would flatter the percentage, and drift it upwards every time a
 * prose-only column is declared.
 */
export function columnIsChecked(col: ColumnRules): boolean {
  return (col.rules?.length ?? 0) > 0 || (!!col.type && col.type !== "text");
}

/**
 * A column's primary name — the first of its spellings when the rule set lists
 * several (`["Land", "Landcode"]`). The name the app shows and writes for it.
 */
export function primaryColumnName(column: string | string[]): string {
  return Array.isArray(column) ? column[0] : column;
}

/** A column's declared `type` check (text = no check). Skips empty values. */
export function runTypeCheck(col: ColumnRules, value: string): string | null {
  if (value === "" || !col.type || col.type === "text") return null;
  switch (col.type) {
    case "integer":
      return /^-?\d+$/.test(value) ? null : tr("Moet een geheel getal zijn", "Must be a whole number");
    case "decimal":
      return /^-?\d+([.,]\d+)?$/.test(value) ? null : tr("Moet een getal zijn", "Must be a number");
    case "boolean":
      return /^(ja|nee|yes|no|true|false|1|0)$/i.test(value)
        ? null
        : tr("Moet een ja/nee-waarde zijn", "Must be a yes/no value");
    case "date": {
      const fmt = col.format ?? "DD-MM-YYYY";
      return dateMatches(value, fmt) ? null : tr(`Ongeldige datum (verwacht ${fmt})`, `Invalid date (expected ${fmt})`);
    }
    default:
      return null;
  }
}

/**
 * Run one rule's check against a cell value. `unique` is handled by the engine
 * (it needs the whole column) and always returns null here. `land` is the AFAS
 * landcode a `postcode` is checked for — the engine resolves it from the rule's
 * `scopeColumn`.
 */
export function runCheck(rule: RuleCheck, value: string, land = "NL"): string | null {
  // Only `required` cares about empties; everything else passes on empty.
  if (rule.check !== "required" && value === "") return null;

  switch (rule.check) {
    case "required":
      return value === "" ? tr("Verplicht veld", "Required field") : null;
    case "default-if-empty":
      // Never a per-cell error, empty or not — the engine reads `defaultValue`
      // itself and records a blank cell in `ValidationResult.defaults`.
      return null;
    case "email":
      return EMAIL_RE.test(value) ? null : tr("Ongeldig e-mailadres", "Invalid e-mail address");
    case "iban":
      return isValidIban(value) ? null : tr("Ongeldig IBAN", "Invalid IBAN");
    case "btw":
      return vatError(value);
    case "bsn":
      return isValidBsn(value) ? null : tr("Ongeldig BSN", "Invalid BSN (Dutch citizen service number)");
    case "postcode":
      return postcodeError(value, land);
    case "phone":
      return PHONE_RE.test(value) ? null : tr("Ongeldig telefoonnummer", "Invalid phone number");
    case "enum":
      // Case-insensitive, like the `boolean` type check above: every enum in the
      // rule sets is a short code list (`J`/`N`, `O`/`P`, `Wst`/`Art`/`Kst`/`Sam`)
      // where casing carries no meaning, and clients type them in caps as often as
      // not. The payload is unaffected — a `valueMap` is offered per raw value the
      // sheet actually carries, so `WST` gets its own row to translate.
      return rule.values?.some((v) => v.toLowerCase() === value.toLowerCase())
        ? null
        : tr(`Moet één van zijn: ${rule.values?.join(", ") ?? ""}`, `Must be one of: ${rule.values?.join(", ") ?? ""}`);
    case "min": {
      const n = toNum(value);
      if (rule.value === undefined) return null;
      return n !== null && n >= rule.value ? null : tr(`Moet ≥ ${rule.value} zijn`, `Must be ≥ ${rule.value}`);
    }
    case "max": {
      const n = toNum(value);
      if (rule.value === undefined) return null;
      return n !== null && n <= rule.value ? null : tr(`Moet ≤ ${rule.value} zijn`, `Must be ≤ ${rule.value}`);
    }
    case "length":
      if (rule.min !== undefined && value.length < rule.min)
        return tr(`Minimaal ${rule.min} tekens`, `At least ${rule.min} characters`);
      if (rule.max !== undefined && value.length > rule.max)
        return tr(`Maximaal ${rule.max} tekens`, `At most ${rule.max} characters`);
      return null;
    case "regex":
      if (!rule.pattern) return null;
      return ruleRegex(rule.pattern, rule.flags).test(value)
        ? null
        : tr("Ongeldige waarde", "Invalid value");
    case "unique":
      return null; // engine handles uniqueness across the column
    case "notice":
      return null; // a remark, never an error — the engine records it
    case "matches-count":
      return null; // reads other columns of the row — the engine judges it
    case "same-in-group":
      return null; // compares rows with each other — the engine judges it
    case "clear":
      return null; // a repair, never an error — autofix.ts empties the cell
    case "split-huisnummer":
      return null; // a repair, never an error — autofix.ts splits the cell
    default:
      return null;
  }
}
