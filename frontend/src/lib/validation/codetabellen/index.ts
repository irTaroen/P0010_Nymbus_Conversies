/**
 * AFAS codetabellen — the reference tables a sheet's values are validated against.
 * `CODETABELLEN` is the live store the engine checks against; `sources.ts` declares
 * each table on import; `registry.ts` fetches its values on demand, per project and
 * module, from the client's own AFAS (or Nymbus's, standing in). Nothing is bundled:
 * a table no environment could serve stays absent, and the engine skips that check.
 */

export {
  CODETABELLEN,
  setCodetabel,
  hasCodetabel,
  getCodetabel,
  codetabelHasCode,
  codetabelCoversScope,
  codetabelHasCodeInScope,
  codetabelIsLoaded,
  codetabelCodeForName,
  codetabelCodeForNameInScope,
  codetabelScopeKey,
} from "./store";
export {
  registerCodetabel,
  ensureCodetabellenForModule,
  fetchCodetabelEntries,
  refreshCodetabellenForModule,
  codetabelKeysForModule,
  codetabelPicker,
  sourceOf,
  unresolvedCodetabellen,
  type CodetabelSource,
  type CodetabelSourceKind,
  type CodetabelPickerColumns,
  type CodetabelColumn,
} from "./registry";

// Side-effect: register all tables + seed their fallbacks. Kept last so the store
// is fully initialized before any registration runs.
import "./sources";
