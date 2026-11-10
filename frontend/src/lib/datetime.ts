/**
 * Dates and times as this app writes them: Dutch `dd-mm-yyyy`, local time.
 *
 * Four places formatted a date before this module existed and three of them
 * carried their own `String(n).padStart(2, "0")`: the Excel cell values
 * (`excel.ts`), the download filename (`download.ts`), the PDF's *Gegenereerd*
 * line (`report-pdf.ts`) and the progress tooltip (`project-progress.ts`). The
 * last two printed the *same* moment in the *same* notation through two different
 * mechanisms — one manual, one `Intl` — which is two ways for one format to drift.
 *
 * **Local time throughout, deliberately.** A client checked their sheet at a
 * wall-clock moment and a date cell means the day the client typed, so every
 * getter here is the local one. `toISOString()` would shift the day by one for
 * anyone not on UTC — the backend stamps its own timestamps in UTC and
 * {@link formatDateTime} is what turns those back into local wall-clock.
 *
 * Framework-free and `Intl`-free. The PDF is the reason for the second half: its
 * text has to survive a WinAnsi encoder that silently drops anything above
 * Latin-1 (see report-pdf.ts), and `Intl` is free to separate a time with a
 * narrow no-break space that would vanish there. Plain digits and hyphens can't.
 */

/** `7` → `"07"` — two-digit, zero-padded. */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `30-07-2026` — a date as every Dutch-facing surface prints it. */
export function formatDate(date: Date): string {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/**
 * A date AFAS wrote — `2026-08-09`, or `2026-08-09T00:00:00` — as `09-08-2026`.
 *
 * The ISO prefix is read off the string rather than through `new Date()`, which
 * parses a bare `yyyy-mm-dd` as **UTC midnight**: west of Greenwich that prints
 * the day before, and an opleverdatum that is one day out is worse than none.
 * A value that is already `dd-mm-yyyy` is handed back as it stands, and for the
 * same reason: `new Date("09-08-2026")` reads it as the *American* order and
 * would turn the 9th of August into the 8th of September without complaining.
 * Anything else is still tried as a date, and a string that is no date at all
 * comes back untouched rather than as "Invalid Date" — the same choice
 * `formatCheckedAt()` makes in [project-progress.ts](./project-progress.ts).
 */
export function formatIsoDate(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  if (/^\d{2}-\d{2}-\d{4}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? value : formatDate(date);
}

/**
 * A moment AFAS wrote — `2026-10-22T10:54:35Z` — as `22-10-2026 10:54`.
 *
 * AFAS stamps Dutch wall-clock time and then appends a `Z` it doesn't mean: a
 * sheet whose filename says `_105432` comes back as `10:54:35Z`. `new Date()`
 * believes the `Z`, and every browser in Dutch summer time then printed the
 * comment two hours in the future. So the digits are read off the string as they
 * stand — already Dutch time, whatever the viewer's own timezone — and anything
 * that isn't that shape falls back to {@link formatIsoDate}.
 */
export function formatAfasDateTime(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]} ${iso[4]}:${iso[5]}` : formatIsoDate(text);
}

/** `14:05`, or `14:05:30` when `seconds` is asked for. */
export function formatTime(date: Date, seconds = false): string {
  const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return seconds ? `${hm}:${pad2(date.getSeconds())}` : hm;
}

/** `30-07-2026 14:05` — a moment shown to the user. */
export function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * `2026-07-30_140530` — a filename-safe stamp for a generated download.
 *
 * ISO-ordered rather than `dd-mm-yyyy`, so the files a client collects sort
 * chronologically in their own folder; `downloadName()` in
 * [download.ts](./download.ts) matches this exact shape to strip a stamp it wrote
 * before, so the two must stay in step.
 */
export function fileStamp(date: Date): string {
  return `${isoDate(date)}_${formatTime(date, true).replaceAll(":", "")}`;
}

/** `2026-07-30` — a date's *local* parts in ISO order, so a date built for a
 *  calendar keeps its own day (`toISOString` would shift it across midnight UTC). */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
