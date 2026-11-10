/**
 * The one rule for comparing an AFAS code or record number with what a sheet
 * holds: upper-cased, and an all-digits value stripped of its leading zeros —
 * AFAS pads (`07750`, `01`), Excel drops the padding from any numeric cell.
 *
 * Shared by the existing-records marks ([existing-records.ts](./existing-records.ts))
 * and the codetabel store's numeric lists ([store.ts](./validation/codetabellen/store.ts)),
 * and mirrored by `normalize_key()` in `backend/existing.py`, which must agree:
 * the browser draws the marks and the backend re-checks them before writing.
 *
 * Stripped as text, not through `Number`: a key past 2^53 would come back rounded
 * and no longer match the backend's exact `int()`.
 */
export function normalizeAfasCode(value: string): string {
  const upper = value.toUpperCase();
  return /^\d+$/.test(upper) ? upper.replace(/^0+(?=\d)/, "") : upper;
}
