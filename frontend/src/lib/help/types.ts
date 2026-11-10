/**
 * Per-module help content — the parsed shape of one `content/<id>.json`.
 *
 * Help is authored per module and rendered in the help drawer as three sections:
 * General, Columns, FAQ. Every field is optional so a module's file can be filled
 * in incrementally — empty/missing sections simply don't render.
 *
 * The Columns section is *derived*: the list of columns (and which are required)
 * comes from the module's validation rule set (`lib/validation/rules/`). This file
 * only adds a human description + example per column, keyed by the column's display
 * name (the first header for columns with synonyms). Keys with no matching rule
 * column are ignored.
 */

export interface ColumnHelp {
  description?: string;
  example?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ModuleHelp {
  /** Intro paragraphs shown under "Algemeen". */
  general?: string[];
  /** Per-column descriptions, keyed by the column's display name. */
  columns?: Record<string, ColumnHelp>;
  /** Question/answer pairs shown under "Veelgestelde vragen". */
  faq?: FaqItem[];
}
