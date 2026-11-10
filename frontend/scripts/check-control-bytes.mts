/**
 * Rejects a literal NUL byte in the frontend's own source — `src/` and `scripts/`.
 *
 * Three files once held one where a six-character escape was meant — two cache-key
 * separators in `checks.ts` and `report.ts`, the lower bound of a WinAnsi range check
 * in `report-pdf.ts`. All three were functionally correct and all three were
 * invisible: git classified the files as *binary* (`Bin 21849 -> 21620 bytes` instead
 * of a diff, so a merge conflict there wouldn't even show), and `grep`/`rg` silently
 * skip a binary file — searching the repo for a symbol defined in one of the three
 * returned nothing at all. See docs/todo.md, "Nothing stops a stray control byte
 * getting back into a source file."
 *
 * This is the seam that was missing: a byte-level check that runs in CI and, wired up
 * as a git hook, before a commit — so the next stray byte a paste or a bad encoding
 * drops into a source file fails loudly instead of silently becoming unsearchable.
 *
 * **`scripts/` is in scope because this file itself proved it has to be.** The first
 * draft scanned `src/` only, matching the wording of the todo entry — and was written
 * with a literal NUL in the very sentence describing the bug, which it then cheerfully
 * declined to notice about itself. A checker that can't see its own directory is the
 * same blind spot one level up.
 *
 * Usage:
 *   npm run check:control-bytes                 — scan every tracked src/ + scripts/ file
 *   npm run check:control-bytes -- a.ts b.ts     — scan just these paths, relative to
 *                                                   frontend/
 *   node check-control-bytes.mts --repo-root a b — same, but the paths are relative to
 *                                                   the repo root instead (what
 *                                                   `../.githooks/pre-commit` passes,
 *                                                   since `git diff --cached` names
 *                                                   files that way)
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

/**
 * The directories under `frontend/` this scans, relative to it. Everything the repo
 * hand-writes as frontend code lives in one of the two; `public/` (the Excel
 * sjablonen) and `node_modules/` are deliberately outside — binary by nature and not
 * ours, respectively.
 */
const SCANNED_DIRS = ["src", "scripts"];

/**
 * `src/` also carries binary assets (`favicon.ico`) that legitimately contain NUL
 * bytes as part of their format — this check is about text source files losing an
 * escape, not about auditing every byte in the tree. Text-only, and
 * TypeScript/JSON/CSS rather than everything text: narrow on purpose, so a new binary
 * kind added later doesn't need to be excluded by hand — only these extensions are
 * ever scanned.
 */
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".css", ".mts"]);

/** True for a path this check covers: inside a scanned dir, with a text extension. */
function inScope(file: string): boolean {
  if (!TEXT_EXTENSIONS.has(path.extname(file))) return false;
  return SCANNED_DIRS.some((dir) => file.startsWith(dir + path.sep));
}

/** Every tracked file in the scanned dirs with a text extension, relative to `frontend/`. */
function trackedSourceFiles(): string[] {
  const out = execFileSync("git", ["ls-files", ...SCANNED_DIRS], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean).filter(inScope);
}

/** Byte offsets of every NUL in `file`, empty when it holds none. */
function findControlBytes(file: string): number[] {
  const buffer = readFileSync(path.join(ROOT, file));
  const at: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x00) at.push(i);
  }
  return at;
}

const args = process.argv.slice(2);
const fromRepoRoot = args.includes("--repo-root");
const explicit = args.filter((a) => a !== "--repo-root");
const files =
  explicit.length > 0
    ? explicit.map((f) => (fromRepoRoot ? path.relative("frontend", f) : f))
    : trackedSourceFiles();

let failed = 0;
for (const file of files) {
  // A path passed explicitly (the pre-commit hook hands over the whole staged list,
  // not just this frontend's) that falls outside the scanned dirs is skipped rather
  // than erroring, so the caller never has to filter first.
  if (!inScope(file)) continue;
  let offsets: number[];
  try {
    offsets = findControlBytes(file);
  } catch {
    // Deleted or renamed away in this diff — nothing left on disk to scan.
    continue;
  }
  if (offsets.length === 0) continue;
  failed++;
  console.error(
    `${file}: ${offsets.length} NUL byte(s) at offset ${offsets.slice(0, 5).join(", ")}${
      offsets.length > 5 ? ", …" : ""
    } — did you mean the escape \\u0000?`
  );
}

if (failed > 0) {
  console.error(
    `\n${failed} file(s) hold a literal NUL byte. git treats a file with one as binary — ` +
      "diffs, merges and grep all silently stop working on it. Replace the byte with " +
      "the six characters \\u0000 instead."
  );
  process.exit(1);
}
