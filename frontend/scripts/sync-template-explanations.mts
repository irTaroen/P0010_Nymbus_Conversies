/**
 * Collects the explanation row of every template in `public/templates/` into
 * `src/lib/template-explanations.json`, which `parseExcelFile()` reads to tell that
 * row apart from data.
 *
 * Most templates carry a line of explanation under the headers (*"O voor Organisatie,
 * P voor persoon"*), some an example record, some nothing — and a client fills the
 * template in, so that row arrives back in the sheet unless they deleted it. The
 * parser starts at the first row with data; a row that repeats the template's own
 * row 2 is the template talking, not the client, and is skipped. The text has to come
 * from the templates themselves, because nothing about the row — no style SheetJS can
 * read, no position — tells it from a record.
 *
 * Only each template's first sheet is read: the others are hulptabellen, whose row 2
 * is lookup data and must never be mistaken for an explanation.
 *
 * The English copies in `public/templates/en/` are read too, after the Dutch.
 *
 * Usage (from `frontend/`), after adding or changing a template:
 *   npm run templates:sync    — rewrite the JSON
 *   npm run templates:check   — report only; exits 1 when the JSON is out of date
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const ROOT = path.join(import.meta.dirname, "..");
const TEMPLATE_DIR = path.join(ROOT, "public", "templates");
const OUT = path.join(ROOT, "src", "lib", "template-explanations.json");

type CellValue = string | number | boolean | Date | null;

/** Template file → header → the text under it in row 2. */
const explanations: Record<string, Record<string, string>> = {};

// The Dutch templates, then their English copies under `en/` (built by
// `npm run templates:translate`) — a client may fill in either, so both explanation
// rows have to be recognised. Keyed by the path below `public/templates/`.
const templateFiles = [
  ...readdirSync(TEMPLATE_DIR).filter((f) => /\.xlsx?$/i.test(f)).sort(),
  ...(existsSync(path.join(TEMPLATE_DIR, "en"))
    ? readdirSync(path.join(TEMPLATE_DIR, "en"))
        .filter((f) => /\.xlsx?$/i.test(f))
        .sort()
        .map((f) => `en/${f}`)
    : []),
];

for (const file of templateFiles) {
  const workbook = XLSX.read(readFileSync(path.join(TEMPLATE_DIR, file)), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) continue;
  const [headers = [], row = []] = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: null,
  });

  const entries: Record<string, string> = {};
  headers.forEach((header, i) => {
    const text = row[i] === null || row[i] === undefined ? "" : String(row[i]).trim();
    if (header !== null && text !== "") entries[String(header).trim()] = text;
  });
  if (Object.keys(entries).length > 0) explanations[file] = entries;
}

const next = JSON.stringify(explanations, null, 2) + "\n";
const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.log("! template-explanations.json is out of date — run `npm run templates:sync`.");
    process.exit(1);
  }
  console.log("template-explanations.json is up to date.");
} else if (next !== current) {
  writeFileSync(OUT, next);
  console.log(`Wrote ${Object.keys(explanations).length} templates to template-explanations.json.`);
} else {
  console.log("template-explanations.json is up to date.");
}
