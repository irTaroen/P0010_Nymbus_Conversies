/**
 * Keeps every module's help article in step with its validation rule set.
 *
 * The two files that make up a module's help are split by what can be derived:
 *
 *   rules/<id>.json         — the columns, their type, and their checks.
 *   help/content/<id>.json  — the human prose (description + example) per column.
 *
 * The help drawer already reads the *structure* straight from the rule set (see
 * `deriveColumns` in `components/uploader/ModuleHelpDrawer.tsx`), so the badges —
 * type, "verplicht", "uniek", the allowed enum values — are never out of date and
 * are not this script's problem. What does drift is the prose, and prose can't be
 * generated. So this script does the two things a machine can:
 *
 *   1. Sync the column keys — add an empty entry for every column a rule set has
 *      gained, drop entries for columns it has lost, and keep the file in rule
 *      order so it reads alongside the rules. New entries are left blank on
 *      purpose: a placeholder string would render in the UI as if it were real
 *      help. The report tells the author what to write.
 *   2. Report prose the rules have outdated — a description that says "laat leeg"
 *      for a column that is now required, or an `example` that the validation
 *      engine itself would reject. Examples are checked with the engine's own
 *      `checks.ts`, so this can never disagree with what the user sees in the table.
 *
 * Usage (from `frontend/`):
 *   npm run help:sync    — apply the key sync and print the report
 *   npm run help:check   — report only; exits 1 when out of sync or prose is wrong
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { primaryColumnName, runCheck, runTypeCheck } from "../src/lib/validation/checks.ts";
import type { ColumnRules, ModuleRuleSet } from "../src/lib/validation/types.ts";
import type { ColumnHelp, ModuleHelp } from "../src/lib/help/types.ts";

const ROOT = path.join(import.meta.dirname, "..");
const RULES_DIR = path.join(ROOT, "src", "lib", "validation", "rules");
const HELP_DIR = path.join(ROOT, "src", "lib", "help", "content");

/** Phrases that promise a column may be left blank — a lie once it's required. */
const SAYS_OPTIONAL = /laat leeg|mag leeg|leeg blijven|optioneel|niet verplicht/i;

/**
 * Negations to drop before testing the above: "mag niet leeg blijven" states the
 * opposite of what its words match, and telling an author their prose contradicts
 * the rules when it agrees with them is worse than missing a stale line.
 */
const NEGATED_OPTIONAL = /\b(niet|nooit)\s+(leeg|optioneel)\b/gi;

/** "Niet verplicht." says the column is optional — the opposite of a claim. */
const NEGATED_REQUIRED = /\b(niet|nooit)\s+verplicht\b/gi;

/** Words that make a "verplicht" in the prose conditional rather than absolute. */
const SAYS_CONDITIONAL = /\b(bij|wanneer|indien|als|tenzij|mits)\b/i;

type Level = "error" | "info";

interface Finding {
  level: Level;
  column: string;
  message: string;
}

interface ModuleReport {
  moduleId: string;
  /** Columns the rule set has that the help file didn't. */
  added: string[];
  /** Help entries whose column is gone from the rule set. */
  removed: string[];
  /** True when only the key order differed. */
  reordered: boolean;
  findings: Finding[];
  /** Set when the module has no help file at all to sync into. */
  missingHelpFile: boolean;
  /** True when the file's content would change (or did, in write mode). */
  changed: boolean;
}

/** The help key for a column — its first header, matching the drawer. */
function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** 2-space JSON with a trailing newline — the shape these files are already in. */
function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The help file's columns rebuilt in rule order: existing prose carried over,
 * blank entries for new columns, entries for dropped columns left behind.
 */
function syncColumns(
  ruleSet: ModuleRuleSet,
  help: ModuleHelp,
  prune: boolean,
): {
  columns: Record<string, ColumnHelp>;
  added: string[];
  removed: string[];
  reordered: boolean;
} {
  const existing = help.columns ?? {};
  const names = ruleSet.columns.map((col) => primaryColumnName(col.column));
  const columns: Record<string, ColumnHelp> = {};
  const added: string[] = [];

  for (const name of names) {
    if (name in existing) {
      columns[name] = existing[name];
    } else {
      columns[name] = {};
      added.push(name);
    }
  }

  const removed = Object.keys(existing).filter((k) => !names.includes(k));

  // A column vanishing from the rules is usually a rename, and the prose written
  // for it belongs on the new name. Deleting it here would throw that text away,
  // so orphans move to the end of the file — visible, still readable, and the
  // drawer ignores them — and only `--prune` actually drops them.
  if (!prune) for (const name of removed) columns[name] = existing[name];
  const kept = Object.keys(existing).filter((k) => names.includes(k));
  const reordered =
    added.length === 0 &&
    removed.length === 0 &&
    kept.join("\0") !== names.join("\0");

  return { columns, added, removed, reordered };
}

/**
 * Prose problems for one column. The `example` is run through the engine's own
 * checks, so anything flagged here is a value the table would mark red.
 */
function checkColumn(col: ColumnRules, name: string, entry: ColumnHelp): Finding[] {
  const findings: Finding[] = [];
  const add = (level: Level, message: string) =>
    findings.push({ level, column: name, message });

  const required = col.rules.some((r) => r.check === "required");
  const description = entry.description?.trim();
  const example = entry.example?.trim();

  const claims = description?.replace(NEGATED_OPTIONAL, " ") ?? "";
  if (required && SAYS_OPTIONAL.test(claims)) {
    add("error", "is verplicht, maar de omschrijving zegt dat de kolom leeg mag blijven");
  }

  // Only an unconditional "verplicht" contradicts an optional column; "verplicht
  // bij type contract = B" is a cross-field rule being explained, not a mismatch.
  if (
    !required &&
    description &&
    /verplicht/i.test(description.replace(NEGATED_REQUIRED, " ")) &&
    !SAYS_CONDITIONAL.test(description)
  ) {
    add("error", "is niet verplicht, maar de omschrijving noemt de kolom verplicht");
  }

  if (example) {
    const typeMessage = runTypeCheck(col, example);
    if (typeMessage) add("error", `voorbeeld "${example}": ${typeMessage.toLowerCase()}`);
    for (const rule of col.rules) {
      const message = runCheck(rule, example);
      if (message) add("error", `voorbeeld "${example}": ${message.toLowerCase()}`);
    }
  }

  if (!description) add("info", "geen omschrijving");
  else if (!example) add("info", "geen voorbeeld");

  return findings;
}

export interface SyncOptions {
  /** Write the synced files. With `false` nothing is touched — what `--check` uses. */
  write: boolean;
  /** Also delete help entries whose column is gone from the rule set. */
  prune: boolean;
}

/** Sync and check one module. Returns null when it has no rule file. */
function syncModule(moduleId: string, { write, prune }: SyncOptions): ModuleReport | null {
  const rulesFile = path.join(RULES_DIR, `${moduleId}.json`);
  if (!existsSync(rulesFile)) return null;

  const helpFile = path.join(HELP_DIR, `${moduleId}.json`);
  const ruleSet = readJson<ModuleRuleSet>(rulesFile);

  const report: ModuleReport = {
    moduleId,
    added: [],
    removed: [],
    reordered: false,
    findings: [],
    missingHelpFile: !existsSync(helpFile),
    changed: false,
  };

  // A rule set with no columns has nothing to describe yet, so an absent or
  // empty help file is correct rather than something to fill in.
  if (report.missingHelpFile) {
    if (ruleSet.columns.length > 0) return report;
    report.missingHelpFile = false;
    return report;
  }

  const original = readFileSync(helpFile, "utf8");
  const help = JSON.parse(original) as ModuleHelp & Record<string, unknown>;
  const { columns, added, removed, reordered } = syncColumns(ruleSet, help, prune);
  report.added = added;
  report.removed = removed;
  report.reordered = reordered;

  for (const col of ruleSet.columns) {
    const name = primaryColumnName(col.column);
    report.findings.push(...checkColumn(col, name, columns[name]));
  }

  // Rebuild in the order types.ts documents, passing through any other key so a
  // future section can't be dropped by a sync. `columns` is only written when
  // there is something in it, so modules without rules yet stay at `{}`.
  const next: Record<string, unknown> = {};
  if (help.general !== undefined) next.general = help.general;
  if (Object.keys(columns).length > 0 || help.columns !== undefined) {
    next.columns = columns;
  }
  if (help.faq !== undefined) next.faq = help.faq;
  for (const [key, value] of Object.entries(help)) {
    if (key === "general" || key === "columns" || key === "faq") continue;
    next[key] = value;
  }

  const serialized = serialize(next);
  report.changed = serialized !== original;
  if (report.changed && write) writeFileSync(helpFile, serialized, "utf8");

  return report;
}

/** Every module id that has a rule file, in directory order. */
function moduleIds(): string[] {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/** Sync every module's help article to its rule set, one report per module. */
export function syncModuleHelp(options: SyncOptions): ModuleReport[] {
  return moduleIds()
    .map((id) => syncModule(id, options))
    .filter((r): r is ModuleReport => r !== null);
}

function report(reports: ModuleReport[], { write, prune }: SyncOptions): number {
  const lines: string[] = [];
  // Everything the script cannot decide for itself: contradicting prose, an
  // orphaned entry that may be a rename, a module with no help file at all.
  let handwork = 0;
  let pending = 0;

  for (const r of reports) {
    const errorFindings = r.findings.filter((f) => f.level === "error");
    const missingProse = r.findings.filter((f) => f.level === "info");
    const structural =
      r.added.length > 0 || r.removed.length > 0 || r.reordered || r.missingHelpFile;
    handwork += errorFindings.length;
    if (!prune) handwork += r.removed.length;
    if (r.missingHelpFile) handwork++;
    if (r.changed) pending++;

    if (!structural && errorFindings.length === 0) continue;

    lines.push(`\n${r.moduleId}`);
    if (r.missingHelpFile) {
      lines.push(
        `  ! geen help-bestand — maak src/lib/help/content/${r.moduleId}.json en importeer het in src/lib/help/index.ts`,
      );
    }
    if (r.added.length > 0) {
      lines.push(
        `  + ${r.added.length} nieuwe kolom(men), nog zonder tekst: ${r.added.join(", ")}`,
      );
    }
    if (r.removed.length > 0) {
      const list = r.removed.join(", ");
      lines.push(
        prune
          ? `  - ${r.removed.length} kolom(men) verwijderd, stonden niet meer in de rules: ${list}`
          : `  ! ${r.removed.length} kolom(men) staan niet meer in de rules: ${list} — hernoemd? verplaats de tekst naar de nieuwe kolom, of gooi hem weg met --prune`,
      );
    }
    if (r.reordered) lines.push("  ~ volgorde gelijkgetrokken met de rules");
    for (const f of errorFindings) lines.push(`  ! ${f.column}: ${f.message}`);
    if (missingProse.length > 0) {
      lines.push(`    (${missingProse.length}x nog geen omschrijving/voorbeeld)`);
    }
  }

  if (lines.length === 0) {
    console.log("Help-artikelen zijn in lijn met de rules.");
    return 0;
  }

  console.log(lines.join("\n").trimStart());
  console.log(
    `\n${pending} bestand(en) ${write ? "bijgewerkt" : "lopen achter"}, ${handwork} punt(en) die handwerk vragen.`,
  );
  if (handwork > 0) {
    console.log("Regels met ! kan dit script niet voor je oplossen.");
  }

  // Write mode did its job even when prose still needs work, so it stays green;
  // --check is the gate that fails.
  if (write) return 0;
  return pending > 0 || handwork > 0 ? 1 : 0;
}

const options: SyncOptions = {
  write: !process.argv.includes("--check"),
  prune: process.argv.includes("--prune"),
};
process.exit(report(syncModuleHelp(options), options));
