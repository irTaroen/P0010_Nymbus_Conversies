/**
 * Matching a sheet's column headers by name — **case- and whitespace-insensitively**,
 * everywhere, once.
 *
 * Every name the app holds for a column (a rule set's `column`, a payload plan's
 * discriminator, a stored mapping's `header`, a standard-column fill) is written the
 * way *we* spell it. The sheet is written the way the **client** spells it, and that
 * is not a promise: the same export arrived as both `Org. eenheid` and
 * `Org. Eenheid`, which an exact match reads as two different columns — the first
 * missing, the second unchecked. A capital letter is not a different column, so it
 * must not be treated as one.
 *
 * What is normalised is deliberately narrow: case, and runs of whitespace collapsed
 * to one space plus trimmed (Excel headers pick up trailing spaces and the odd
 * non-breaking space from a copy-paste). Punctuation is **kept** — `Org. eenheid` and
 * `Org eenheid` stay distinct, because dropping the dot would start merging columns
 * whose names really do differ, and a wrongly merged column writes the wrong value
 * into AFAS. Case was the reported problem; this is the smallest fix that covers it.
 */

/** A header name reduced to what identifying it should not depend on. */
export function normalizeHeader(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The index of `name` among `headers`, or `-1` — the case-insensitive `indexOf`.
 *
 * First match wins, exactly as `indexOf` does, so a sheet carrying both spellings of
 * one column behaves as it did before: the leftmost is the one that counts.
 */
export function headerIndex(headers: readonly string[], name: string): number {
  const target = normalizeHeader(name);
  return headers.findIndex((header) => normalizeHeader(header) === target);
}

/**
 * A lookup keyed by header name that answers to any spelling of it — what `Map` and
 * `Set` keyed by the raw string cannot do.
 *
 * Built from entries rather than filled by the caller because every use here is
 * "build it once from a table, then ask it per column"; the last entry for a name
 * wins, which only arises if a source table lists one column twice.
 */
export class HeaderMap<T> {
  private readonly byName: Map<string, T>;

  constructor(entries: Iterable<readonly [string, T]> = []) {
    this.byName = new Map();
    for (const [name, value] of entries) this.byName.set(normalizeHeader(name), value);
  }

  get(name: string): T | undefined {
    return this.byName.get(normalizeHeader(name));
  }

  has(name: string): boolean {
    return this.byName.has(normalizeHeader(name));
  }

  get size(): number {
    return this.byName.size;
  }
}
