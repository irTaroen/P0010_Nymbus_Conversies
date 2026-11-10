import templateExplanations from "@/lib/template-explanations.json";
import { HeaderMap, normalizeHeader } from "@/lib/headers";
import { type Locale } from "@/lib/i18n";

/**
 * What a module's template says under each column header — its row 2 — for the
 * table to show under its own headers, so the instruction the client saw in Excel
 * is still there once the sheet is open in the tool (the uploader drops that row as
 * data, see `isExplanationRow` in `lib/excel.ts`).
 *
 * Read from `template-explanations.json`, which `npm run templates:sync` collects
 * from the templates themselves, keyed by the template's path below
 * `/templates/` — so the module's `templateUrl`, already in the language of the
 * moment, picks the Dutch or the English row.
 *
 * Most templates carry instructions there; one (Wagenpark) carries an example record
 * instead. A row with no instruction in it — no text of three words or more — is
 * taken for an example, and each value is shown as one ("Bijv. Z-101-GH"), since a
 * bare `12345` under *Medewerker* reads like data rather than help. A text that only
 * repeats its header (*Itemcode* under *Itemcode*) says nothing and is left out.
 *
 * `locale` is the language `templateUrl` was read in — passed rather than read from
 * the store, so a caller memoising on it re-runs on a language switch.
 *
 * `null` when the module has no template, or the template no row 2.
 */
export function columnInstructions(
  templateUrl: string | undefined,
  locale: Locale,
): HeaderMap<string> | null {
  if (!templateUrl) return null;
  const key = decodeURIComponent(templateUrl).replace(/^\/templates\//, "");
  const row = (templateExplanations as Record<string, Record<string, string>>)[key];
  if (!row) return null;

  const texts = Object.entries(row).map(
    ([header, text]) => [header, text.replace(/\s+/g, " ").trim()] as const,
  );
  const isExample = !texts.some(([, text]) => text.split(" ").length >= 3);
  const entries = texts
    .filter(([header, text]) => normalizeHeader(text) !== normalizeHeader(header))
    .map(([header, text]) => [header, isExample ? `${locale === "en" ? "E.g." : "Bijv."} ${text}` : text] as const);
  return entries.length > 0 ? new HeaderMap(entries) : null;
}
