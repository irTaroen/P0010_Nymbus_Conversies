/**
 * Validation config + engine output types.
 *
 * The per-module JSON files in `rules/` are parsed into `ModuleRuleSet`. The
 * engine ({@link file:./engine.ts}) runs a rule set against a sheet's headers +
 * cell strings and returns a {@link ValidationResult} keyed for cheap per-cell
 * lookup in the table.
 */

/** One entry in an AFAS reference list. Matches the AFAS connector field names. */
export interface CodetabelEntry {
  code: string;
  omschrijving: string;
  /**
   * The entry is only valid inside this scope, and read by a rule's
   * `scopeColumn`. Set on lists whose codes only mean something within another
   * column's value: a woonplaats belongs to one land ("Aadorp" is valid for
   * `NL`, not for `B`), an arbeidsvoorwaarde to one cao (`SG` under cao `SG`,
   * not under cao `Basis`). Such codes are typically **not unique** across
   * scopes, so a flat check would pass a row pairing one scope with another's
   * code.
   */
  scope?: string;
}

export type ColumnType = "text" | "integer" | "decimal" | "date" | "boolean";

/** One check applied to a column's cells. Extra fields depend on `check`. */
export interface RuleCheck {
  check:
    | "required"
    | "default-if-empty"
    | "unique"
    | "email"
    | "iban"
    | "bsn"
    | "btw"
    | "postcode"
    | "phone"
    | "enum"
    | "clear"
    | "split-huisnummer"
    | "codetabel"
    | "min"
    | "max"
    | "length"
    | "regex"
    | "notice"
    | "existing-record"
    | "matches-count"
    | "same-in-group";
  /**
   * notice — not a check but a remark: a cell whose value is one of `values`
   * gets `message` as a **non-blocking** notice (amber, see
   * {@link ValidationResult.notices}). For a value the tool accepts but will send
   * differently, where the user has to know what happens to it.
   */
  message?: string; // override the default NL message
  /** `message` in English — read through `localized()` (lib/i18n.ts), Dutch when absent. */
  messageEn?: string;
  /**
   * enum — the allowed values, matched **case-insensitively**: these are short
   * code lists where casing carries no meaning, and a client typing `WST` for
   * `Wst` is not an error worth flagging. Write them in AFAS's own casing anyway;
   * that is what the message and the help article show the user.
   *
   * clear — values that mean "nothing" in this column: a cell holding one is
   * emptied by the autofix (`autofix.ts`) before validation runs, with the same
   * notice and report line as any other repair. Matched case-insensitively, and
   * numerically when both sides are numbers, so `0` also clears `0,00`.
   *
   * postcode — the AFAS landcodes whose format is checked (`NL`, `B`, `D`, `PL`,
   * `E`, see `POSTCODE_FORMATS` in checks.ts). Default `["NL"]`.
   */
  values?: string[];
  /**
   * enum — other spellings of an allowed value, keyed by that value: a cell
   * holding one (case-insensitively) is rewritten to the key before validation
   * runs, by the same autofix that resolves a codetabel name (`autofix.ts`). For
   * a code the client writes in words — `J`/`Ja` where the column wants `1`.
   */
  aliases?: Record<string, string[]>;
  /**
   * split-huisnummer — the toevoeging column of the address whose huisnummer this
   * rule sits on. A huisnummer written with its toevoeging (`17-19`, `12 A`) is
   * split by the autofix (`autofix.ts`): the leading number stays, the rest moves
   * into this column — only while that cell is still empty, so nothing the client
   * filled in is overwritten.
   */
  intoColumn?: string;
  /** codetabel */
  tableRef?: string;
  /**
   * codetabel — narrow the table to the entries whose `scope` matches this
   * column's value in the same row (Woonplaats within Land, Arbeidsvoorwaarde
   * within Cao). The check is skipped when the scope is empty or the list holds
   * no entries for it, so a list that only covers one country never flags the
   * others.
   *
   * postcode — the land column the postcode belongs to. With a `scopeColumn`
   * a row is checked against its land's format, but only where that land is in
   * the rule's `values` (`NL` alone without them; any other foreign postcode is
   * left alone); without one every row gets the Dutch format.
   */
  scopeColumn?: string;
  /** codetabel / postcode — scope to fall back on when `scopeColumn` is empty or absent. */
  scopeDefault?: string;
  /**
   * codetabel — a value the list doesn't hold is not an error but **unlisted**
   * ({@link ValidationResult.unlisted}): amber instead of red, never blocking, and
   * still with the value picker. For a list the value can be added to rather than
   * corrected against: the woonplaatsen of Medewerkers and Uitzendkrachten, which an
   * admin collects into the `afas_plaatsen` table (*Plaatsen toevoegen* in the
   * Instellingen modal) to be imported into AFAS.
   */
  allowUnlisted?: boolean;
  /**
   * codetabel, with `allowUnlisted` — an unlisted value is also **left out of the
   * payload**: the field is omitted from that record's body (`withoutUnlisted()` in
   * module-payloads.ts), so the rest of the record still goes to AFAS. A rule and
   * the `omitUnlisted` rule of its `scopeColumn` are left out together, both or
   * neither. For a field not worth holding a record back for: Geboorteland and
   * Geboorteplaats of Medewerkers and Uitzendkrachten.
   */
  omitUnlisted?: boolean;
  /**
   * matches-count — the columns counted against this one: the cell must equal how
   * many of them hold a number above 0 in the same row. A row where none of them
   * does is not judged — there is nothing to count. For *Aantal dagen per week*
   * against *Uren Maandag* t/m *Zondag*: AFAS ticks a werkdag for every day with
   * hours and refuses the rooster when the two disagree. Columns the sheet lacks
   * count as empty.
   */
  columns?: string[];
  /**
   * same-in-group — the column whose value makes rows one record: every row sharing
   * a value there must hold the same value in this column too. For Voorcalculatie,
   * where one offerte is spread over a row per regel and `Projectnummer`,
   * `Begindatum Offerte` and `Einddatum Offerte` repeat on each: the payload builds
   * the offerte's kop from its first row (`groupRows()` in field-mapping.ts), so a
   * row that disagrees would be dropped silently. Groups are matched like the
   * payload matches them — trimmed, exact; a blank group cell is no group. A blank
   * cell in this column counts as a value of its own (one row without an einddatum
   * still disagrees with one that has it), dates compare as dates. Every row of a
   * disagreeing group is flagged: the sheet doesn't say which one is right.
   * `message` may say `{groep}` (the group's value) and `{waarden}` (the values found).
   */
  groupColumn?: string;
  /** min / max (numeric bound) */
  value?: number;
  /** length */
  min?: number;
  max?: number;
  /** regex */
  pattern?: string;
  flags?: string;
  /**
   * existing-record — the column holding the record's AFAS key (*Debiteur Nummer*),
   * for a rule declared on the column holding its **name**. The row is judged
   * against the records the customer's AFAS already holds for this module — in the
   * environment the module's workflow task imports into next, test or live
   * (`afas-records.ts`): a name AFAS has only under other keys is an error on this
   * column — the record exists and the sheet would add it again — and a key AFAS
   * holds under another name is an error on the key column.
   */
  keyColumn?: string;
  /**
   * existing-record — only rows where this holds are judged (*Organisatie of
   * Persoon* is `O`: a persoon's AFAS name is not the sheet's organisatienaam). A
   * row where it can't be evaluated — the column absent — is skipped.
   */
  when?: CrossFieldCondition;
  /**
   * existing-record — the error on the key column when AFAS holds that key under
   * another name; `{naam}` becomes AFAS's name for it. (`message` is the error on
   * the name column, with `{nummer}` for the keys AFAS holds the name under.) Both
   * may say `{omgeving}` — `test` or `live`, the environment that was read — so a
   * reader looks for the record where it actually is.
   */
  keyMessage?: string;
  /** `keyMessage` in English, as `messageEn` is to `message`. */
  keyMessageEn?: string;
  /**
   * default-if-empty — the value a blank *cell* is treated as, row by row. A
   * cell left empty under this check is never an error: the engine records it in
   * {@link ValidationResult.defaults} instead, so the table can show the default
   * and mark it as one rather than as user-entered data, and the payload sends
   * it (`ruleDefaultsByKey()` in module-payloads.ts). It never answers for an
   * absent *column*, which is still reported missing — so a rule set says plainly
   * which columns a sheet must carry. The one fallback for a defaulted column;
   * the old `required-or-default`, which let a column go missing silently, was
   * retired for that reason (Taroen, 13-10-2026).
   */
  defaultValue?: string;
}

/** Rules bound to one column (matched by exact header text, or any synonym). */
export interface ColumnRules {
  column: string | string[];
  type?: ColumnType;
  /** Date format(s), e.g. "DD-MM-YYYY" or "DD-MM-YYYY | YYYY-MM-DD". */
  format?: string;
  rules: RuleCheck[];
}

export type CrossFieldOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "isEmpty"
  | "isNotEmpty";

/** One side of a cross-field rule: a column compared to a value or another column. */
export interface CrossFieldCondition {
  column: string;
  op: CrossFieldOp;
  /** Literal, or { column } to compare against another field. Omit for isEmpty/isNotEmpty. */
  value?: string | number | { column: string };
}

/**
 * Several conditions on one side of a rule: `allOf` when every one must hold (an
 * `if` that needs two columns to agree), `anyOf` when one is enough (a `then`
 * satisfied by whichever of several columns is filled, an `if` armed by any of
 * them — "once any address field is filled"). A condition whose column the sheet
 * lacks counts as not holding.
 */
export type CrossFieldSide =
  | CrossFieldCondition
  | { allOf: CrossFieldCondition[] }
  | { anyOf: CrossFieldCondition[] };

/** "IF <if> THEN <then> must hold", else flag the offending cell. */
export interface CrossFieldRule {
  if: CrossFieldSide;
  then: CrossFieldSide;
  /**
   * Header of the cell to highlight; defaults to the `then` column — or, for a
   * combined `then`, its first condition's column. Name it explicitly there.
   */
  flag?: string;
  message?: string;
  /** `message` in English, as on a `RuleCheck`. */
  messageEn?: string;
}

/** A module's full rule set — the parsed content of one `rules/<id>.json`. */
export interface ModuleRuleSet {
  columns: ColumnRules[];
  crossField: CrossFieldRule[];
}

/**
 * A single problem found in one cell. Every issue is an error — a rule either
 * blocks the upload or isn't worth flagging. There used to be a second severity
 * (`warning`, amber, surfaced but allowed); two of the fourteen rule sets ever
 * used it, on one check, so it cost every renderer a colour branch to say
 * something nobody acted on.
 */
export interface Issue {
  row: number;
  col: number;
  message: string;
  /**
   * Set **only** on a failed `codetabel` check: the list the value was compared
   * against. It is what lets the table offer that list back to the user as a
   * picker — a wrong value from a closed set of valid ones is the one kind of
   * error the tool can hand over the answer to, instead of only naming it.
   */
  tableRef?: string;
  /**
   * The scope the list was narrowed to for this row (a scoped `codetabel` check
   * — the row's land for a woonplaats). Absent on an unscoped list. A scoped
   * check only flags a cell when the scope is non-empty *and* the list covers
   * it, so an issue carrying a `tableRef` for a scoped list always has this too.
   */
  tableScope?: string;
}

export interface ValidationResult {
  /** "row:col" -> issues on that cell (same key scheme as the table's dirtyKeys). */
  byCell: Map<string, Issue[]>;
  errorCount: number;
  /**
   * How many cells the rule set actually judged: the sheet's data rows × the
   * declared columns it found in them **that something checks** (`columnIsChecked()`
   * in checks.ts). The denominator of the field figures (`sheetMetrics()` in
   * metrics.ts), which is why the engine counts it rather than the caller: only
   * the engine knows which declared columns the sheet turned out to have. Two
   * kinds of column stay out of it, because neither can be right or wrong: one
   * the sheet doesn't have (it lands in `missingColumns`) and one nothing checks.
   */
  checkedCells: number;
  /**
   * Declared columns not found in the sheet's headers. Reported in a banner of
   * their own rather than as issues — there is no cell to flag, and a column the
   * sheet doesn't have never blocks the upload.
   */
  missingColumns: string[];
  /**
   * "row:col" -> the value a blank cell under a `default-if-empty` rule will be
   * treated as. Not a second severity on `Issue` — a defaulted cell carries no
   * issue at all, it is simply not user-entered data yet. The table tints it to
   * say so (amber, not the red a blocking issue gets) and shows the value as a
   * hint of what an empty cell becomes.
   */
  defaults: Map<string, string>;
  /**
   * "row:col" -> remarks from `notice` rules: a **filled** cell whose value is
   * accepted but not sent as written (a *Type rooster* 2 goes to AFAS as 1). Not
   * an `Issue` and not counted in `errorCount` — it never blocks the upload. The
   * table tints the cell amber, like a default, and shows the remark on hover.
   */
  notices: Map<string, string[]>;
  /**
   * "row:col" -> what the codetabel check rewrote there: the cell held an entry's
   * omschrijving (`from`) and now holds its code (`to`). For a toevoeging filled by
   * a `split-huisnummer` rule, `from` is the huisnummer it was split off. Filled in by
   * `recordAutofixes()` in autofix.ts, read by the report so the PDF can say which
   * cells the tool changed. Not an issue and never blocking; the same cells carry
   * an amber notice in `notices` for the table.
   */
  autofixed: Map<string, { from: string; to: string }>;
  /**
   * "row:col" -> a value an `allowUnlisted` codetabel check didn't find in its list
   * (an unknown woonplaats). Shaped like an `Issue` — it carries the `tableRef` and
   * `tableScope` the value picker needs — but not one: it is not in `byCell`, not
   * counted in `errorCount`, and never blocks. The table tints it amber.
   */
  unlisted: Map<string, Issue>;
}
