/**
 * Builds the English templates in `public/templates/en/` from the Dutch ones in
 * `public/templates/`, using the dictionary in `scripts/template-translations.en.json`.
 *
 * The Dutch templates stay the source: change one, then run this to bring its English
 * copy along. What gets translated:
 *
 * - on a **data sheet** (the one the client fills in), only **row 2** — the
 *   explanation line under the headers. Row 1 stays Dutch: those headers are the
 *   column names the uploader matches on (`lib/headers.ts`), and the example records
 *   below row 2 stay as they are, because they have to remain valid input;
 * - on a **lookup sheet** (`Hulptabel`, `Hulptabellen`, `Landen`), every cell — those
 *   are descriptions next to codes, and the codes themselves are in the dictionary as
 *   their own translation;
 * - every **sheet name** the dictionary has.
 *
 * The workbook is edited as XML, not through ExcelJS: two templates carry Excel tables,
 * which an ExcelJS round-trip is known to damage. A translated cell is pointed at a
 * **new** shared string rather than having its string rewritten in place, because Excel
 * shares one string between every cell holding the same text — rewriting it would also
 * rename a header that happens to read the same as an explanation somewhere else.
 *
 * Usage (from `frontend/`):
 *   npm run templates:translate        — rewrite public/templates/en/
 *   npm run templates:translate:check  — report only; exits 1 when a translatable
 *                                        cell has no entry in the dictionary
 * Then run `npm run templates:sync`, since the English explanation rows have to be
 * recognised too.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.join(import.meta.dirname, "..");
const SOURCE_DIR = path.join(ROOT, "public", "templates");
const TARGET_DIR = path.join(SOURCE_DIR, "en");
const DICTIONARY = path.join(ROOT, "scripts", "template-translations.en.json");

/** Sheets whose every cell is a description beside a code, rather than client input. */
const LOOKUP_SHEETS = /^(Hulptabel|Hulptabellen|Landen)$/;

const { files, strings } = JSON.parse(readFileSync(DICTIONARY, "utf8")) as {
  /** Dutch template file name → the English copy's file name. */
  files: Record<string, string>;
  /** Dutch text → English text. A code or a name maps to itself. */
  strings: Record<string, string>;
};

const checkOnly = process.argv.includes("--check");
const missing = new Map<string, Set<string>>();

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The plain text of each `<si>` in sharedStrings.xml, rich-text runs joined. */
function readSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, inner]) =>
    // `<rPh>` holds phonetic hints, not text.
    [...inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(([, t]) => unescapeXml(t))
      .join(""),
  );
}

/** Whether a text is worth looking up — the extraction skipped codes like `J` and `01`. */
function isProse(text: string): boolean {
  return /[a-zA-Zë]{3}/.test(text);
}

function translate(file: string, raw: string): string | null {
  // Excel stores a line break inside a cell as CRLF (sometimes spelled `_x000D_`);
  // the dictionary, like every reader of it, has plain LF.
  const text = raw.replace(/_x000D_/g, "\r").replace(/\r\n?/g, "\n");
  if (!isProse(text)) return null;
  const english = strings[text];
  if (english === undefined) {
    if (!missing.has(file)) missing.set(file, new Set());
    missing.get(file)!.add(text);
    return null;
  }
  return english === text ? null : english;
}

/** Workbook-relative sheet paths by sheet name, in workbook order. */
function sheetPaths(workbookXml: string, relsXml: string): { name: string; path: string }[] {
  const targets = new Map(
    [...relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map(([, id, target]) => [
      id,
      target,
    ]),
  );
  return [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)].map(([, name, id]) => ({
    name: unescapeXml(name),
    path: "xl/" + (targets.get(id) ?? "").replace(/^\/?xl\//, ""),
  }));
}

async function buildOne(file: string): Promise<void> {
  const englishName = files[file];
  if (!englishName) {
    if (!missing.has(file)) missing.set(file, new Set());
    missing.get(file)!.add("(no English file name in `files`)");
    return;
  }
  const zip = await JSZip.loadAsync(readFileSync(path.join(SOURCE_DIR, file)));
  const read = (p: string) => zip.file(p)!.async("string");

  let workbookXml = await read("xl/workbook.xml");
  const sheets = sheetPaths(workbookXml, await read("xl/_rels/workbook.xml.rels"));
  const sstXml = await read("xl/sharedStrings.xml");
  const shared = readSharedStrings(sstXml);
  const added: string[] = [];
  // One new string per distinct English text, however many cells point at it.
  const addedIndex = new Map<string, number>();

  for (const sheet of sheets) {
    const lookup = LOOKUP_SHEETS.test(sheet.name);
    const xml = await read(sheet.path);
    const next = xml.replace(
      /<c\b([^>]*)>(\s*)<v>(\d+)<\/v>(\s*)<\/c>/g,
      (whole, attrs: string, before: string, index: string, after: string) => {
        if (!/\bt="s"/.test(attrs)) return whole;
        const row = Number(/\br="[A-Z]+(\d+)"/.exec(attrs)?.[1]);
        if (lookup ? false : row !== 2) return whole;
        const english = translate(file, shared[Number(index)] ?? "");
        if (english === null) return whole;
        let at = addedIndex.get(english);
        if (at === undefined) {
          at = shared.length + added.length;
          added.push(english);
          addedIndex.set(english, at);
        }
        return `<c${attrs}>${before}<v>${at}</v>${after}</c>`;
      },
    );
    zip.file(sheet.path, next);

    const englishSheet = strings[sheet.name];
    if (englishSheet && englishSheet !== sheet.name) {
      workbookXml = workbookXml.replace(
        `name="${escapeXml(sheet.name)}"`,
        `name="${escapeXml(englishSheet.slice(0, 31))}"`,
      );
      // The sheet list Excel shows in File → Info; harmless if it is out of step, but
      // there is no reason to leave it so.
      const app = zip.file("docProps/app.xml");
      if (app) {
        const appXml = await app.async("string");
        zip.file(
          "docProps/app.xml",
          appXml.replace(`<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`, `<vt:lpstr>${escapeXml(englishSheet.slice(0, 31))}</vt:lpstr>`),
        );
      }
    }
  }
  zip.file("xl/workbook.xml", workbookXml);

  if (added.length > 0) {
    const items = added
      .map((s) => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ""}>${escapeXml(s)}</t></si>`)
      .join("");
    const uniqueCount = shared.length + added.length;
    zip.file(
      "xl/sharedStrings.xml",
      sstXml
        .replace(/<\/sst>\s*$/, `${items}</sst>`)
        .replace(/\buniqueCount="\d+"/, `uniqueCount="${uniqueCount}"`),
    );
  }

  if (!checkOnly) {
    const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(path.join(TARGET_DIR, englishName), out);
  }
}

mkdirSync(TARGET_DIR, { recursive: true });
const sources = readdirSync(SOURCE_DIR).filter((f) => /\.xlsx$/i.test(f)).sort();
for (const file of sources) await buildOne(file);

if (missing.size > 0) {
  for (const [file, texts] of missing) {
    console.log(`! ${file} — no translation for:`);
    for (const t of texts) console.log(`    ${JSON.stringify(t)}`);
  }
  console.log("Add them to scripts/template-translations.en.json (a code or a name maps to itself).");
  if (checkOnly) process.exit(1);
}
console.log(
  checkOnly
    ? "English templates: every translatable cell has a translation."
    : `Wrote ${sources.length - [...missing.keys()].filter((f) => !files[f]).length} English templates to public/templates/en/.`,
);
