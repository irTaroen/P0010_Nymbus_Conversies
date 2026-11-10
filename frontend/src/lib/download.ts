/**
 * Handing a generated file to the browser. Shared by both writers — the
 * annotated Excel export (`excel.ts`) and the PDF report (`report-pdf.ts`) — so
 * the download path and the `project_name_timestamp.ext` convention stay
 * identical.
 */

import { fileStamp } from "@/lib/datetime";

/**
 * A timestamp this tool appended, at the very end of a base name. Matches what
 * `fileStamp()` in [datetime.ts](./datetime.ts) writes — the two are one
 * convention read in both directions, so a change to either needs the other.
 */
const OWN_TIMESTAMP = /_\d{4}-\d{2}-\d{2}_\d{6}$/;

/**
 * A project number this tool put at the very front of a base name — `501282_`.
 * Six digits is what AFAS hands out and what every project id in the session
 * looks like; the shape is kept deliberately narrow so a client's own
 * `2026_Wagenpark` isn't mistaken for one of ours.
 *
 * Read in both directions, exactly like {@link OWN_TIMESTAMP}: written by
 * {@link downloadName}, stripped by it on the way back in.
 */
const OWN_PROJECT = /^\d{6}_/;

/**
 * Strip the project number this tool wrote in front of a base name, if it is
 * there. Used by {@link downloadName} before writing a fresh one, and by
 * anything that wants the client's own name back out of a file we handed them.
 *
 * Only the tool's own exact shape goes, and the loop handles a name that
 * collected several over a few round trips. Stripping stops one short of taking
 * everything, so a file called `501282.xlsx` keeps its name rather than becoming
 * nothing — the number is all it has.
 */
export function stripProjectNumber(base: string): string {
  let stem = base;
  while (OWN_PROJECT.test(stem)) {
    const rest = stem.replace(OWN_PROJECT, "").replace(/^_+/, "");
    if (!rest) return stem;
    stem = rest;
  }
  return stem;
}

/**
 * The project number this tool wrote in front of a file name, or null when the
 * name carries none — the read side of {@link downloadName}'s write.
 *
 * What it is *for* is the upload: a client on several conversions at once has
 * every project's sheets in one downloads folder, and the number in the name is
 * the only thing telling them apart. Reading it back lets the tool notice a file
 * from another project before it is validated against this one's rules.
 *
 * A name without the prefix answers null, not "wrong" — the client's own file,
 * uploaded before it ever went through this tool, is the normal first case and
 * nothing is known about which project it belongs to.
 */
export function projectNumberIn(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const match = OWN_PROJECT.exec(base);
  return match ? match[0].slice(0, -1) : null;
}

/**
 * Name for a generated download: the project number, the upload's base name, a
 * fresh timestamp, and `extension` — with `prefix` in front when the file isn't
 * the sheet itself.
 *
 * The project number goes **first**, before `prefix`, so a client working on
 * several conversions can sort a folder by name and have each project's files —
 * sheet and validatierapport alike — fall together. That is the whole point of
 * carrying it: the files leave this tool, get mailed around, and come back with
 * nothing but their name to say which project they belong to.
 *
 * Anything this tool put there before — project number at the front, timestamp
 * at the end — is **replaced, not stacked**. Clients re-upload the file the tool
 * handed them (that's the point of the annotated export), so appending blindly
 * grows a tail one stamp per round trip:
 * `…_2026-07-30_132557_2026-07-30_153149.pdf`, and a head one number per
 * project switch. Only our own exact shapes are stripped, and only at their own
 * end, so a client's own `Wagenpark_2026-07-30` keeps its date; the loops handle
 * names that already collected several. If stripping would leave nothing at all,
 * the base name is kept as it was.
 *
 * `projectId` is optional because one caller has no project to name: the
 * standalone schema pages under `/afas`, which belong to no conversion. A file
 * written without one is named exactly as it was before this existed.
 */
export function downloadName(
  fileName: string,
  extension: string,
  prefix = "",
  projectId?: string | null
): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  let stem = stripProjectNumber(base);
  while (OWN_TIMESTAMP.test(stem)) stem = stem.replace(OWN_TIMESTAMP, "");
  stem = stem.trimEnd() || base;
  const project = projectId ? `${projectId}_` : "";
  return `${project}${prefix}${stem}_${fileStamp(new Date())}.${extension}`;
}

/**
 * Name for a copy of a file this tool did **not** generate — a module template
 * handed straight out of `public/templates/`, which is a fixed file on disk that
 * every project downloads the same bytes of.
 *
 * So only the name can say whose it is, and that matters more here than
 * anywhere: the template is an *empty* sheet, indistinguishable from any other
 * project's until someone fills it in. No timestamp — the file has no moment to
 * record, and a client who downloads it twice should get the same name twice.
 */
export function projectFileName(fileName: string, projectId?: string | null): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  const stem = stripProjectNumber(base);
  return projectId ? `${projectId}_${stem}${ext}` : `${stem}${ext}`;
}

/**
 * Hand a generated file to the browser as a download.
 *
 * Re-wrapped as `application/octet-stream`: Safari (and some Chrome setups)
 * ignore the `download` attribute for a blob URL whose type it can render
 * inline — a PDF opens in a new tab instead of saving. A type the browser
 * has no viewer for leaves it no choice but to download.
 */
export function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
