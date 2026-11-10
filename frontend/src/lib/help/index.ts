/**
 * Aggregates every per-module help file into one map keyed by module id.
 *
 * Each JSON file's name IS its module id (see lib/modules.tsx). To add or edit a
 * module's help, edit its file in `content/`; to add a new module, drop a file
 * there and import it below. The help drawer looks content up by module id.
 */

import { getLocale } from "@/lib/i18n";
import type { ModuleHelp } from "./types";

import hrmMedewerkers from "./content/hrm-medewerkers.json";
import hrmUitzendkrachten from "./content/hrm-uitzendkrachten.json";
import hrmVerlofsaldo from "./content/hrm-verlofsaldo.json";
import hrmSalarisparameters from "./content/hrm-salarisparameters.json";
import hrmVakantietoeslag from "./content/hrm-vakantietoeslag.json";
import hrmWagenpark from "./content/hrm-wagenpark.json";
import erpDebiteuren from "./content/erp-debiteuren.json";
import erpCrediteuren from "./content/erp-crediteuren.json";
import erpContactpersonen from "./content/erp-contactpersonen.json";
import erpArtikelen from "./content/erp-artikelen.json";
import erpProjecten from "./content/erp-projecten.json";
import erpVoorcalculatie from "./content/erp-voorcalculatie.json";
import erpAbonnementen from "./content/erp-abonnementen.json";
import erpOpenstaandposten from "./content/erp-openstaandposten.json";
import erpVasteActiva from "./content/erp-vasteActiva.json";
import erpNacalculatie from "./content/erp-nacalculatie.json";
import erpFinancieleContracten from "./content/erp-financielecontracten.json";
import erpInkoopoffertes from "./content/erp-inkoopoffertes.json";
import erpInkooporders from "./content/erp-inkooporders.json";
import erpBeginbalansen from "./content/erp-beginbalansen.json";
import erpDossieritems from "./content/erp-dossieritems.json";

// The English twins — the same shape, merged over the Dutch per field (see below).
import hrmMedewerkersEn from "./content/en/hrm-medewerkers.json";
import hrmUitzendkrachtenEn from "./content/en/hrm-uitzendkrachten.json";
import hrmVerlofsaldoEn from "./content/en/hrm-verlofsaldo.json";
import hrmSalarisparametersEn from "./content/en/hrm-salarisparameters.json";
import hrmVakantietoeslagEn from "./content/en/hrm-vakantietoeslag.json";
import hrmWagenparkEn from "./content/en/hrm-wagenpark.json";
import erpDebiteurenEn from "./content/en/erp-debiteuren.json";
import erpCrediteurenEn from "./content/en/erp-crediteuren.json";
import erpContactpersonenEn from "./content/en/erp-contactpersonen.json";
import erpArtikelenEn from "./content/en/erp-artikelen.json";
import erpProjectenEn from "./content/en/erp-projecten.json";
import erpVoorcalculatieEn from "./content/en/erp-voorcalculatie.json";
import erpAbonnementenEn from "./content/en/erp-abonnementen.json";
import erpOpenstaandpostenEn from "./content/en/erp-openstaandposten.json";
import erpVasteActivaEn from "./content/en/erp-vasteActiva.json";
import erpNacalculatieEn from "./content/en/erp-nacalculatie.json";
import erpFinancieleContractenEn from "./content/en/erp-financielecontracten.json";
import erpInkoopoffertesEn from "./content/en/erp-inkoopoffertes.json";
import erpInkoopordersEn from "./content/en/erp-inkooporders.json";
import erpBeginbalansenEn from "./content/en/erp-beginbalansen.json";
import erpDossieritemsEn from "./content/en/erp-dossieritems.json";

const HELP: Record<string, ModuleHelp> = {
  "hrm-medewerkers": hrmMedewerkers,
  "hrm-uitzendkrachten": hrmUitzendkrachten,
  "hrm-verlofsaldo": hrmVerlofsaldo,
  "hrm-salarisparameters": hrmSalarisparameters,
  "hrm-vakantietoeslag": hrmVakantietoeslag,
  "hrm-wagenpark": hrmWagenpark,
  "erp-debiteuren": erpDebiteuren,
  "erp-crediteuren": erpCrediteuren,
  "erp-contactpersonen": erpContactpersonen,
  "erp-artikelen": erpArtikelen,
  "erp-projecten": erpProjecten,
  "erp-voorcalculatie": erpVoorcalculatie,
  "erp-abonnementen": erpAbonnementen,
  "erp-openstaandposten": erpOpenstaandposten,
  "erp-vasteActiva": erpVasteActiva,
  "erp-nacalculatie": erpNacalculatie,
  "erp-financielecontracten": erpFinancieleContracten,
  "erp-inkoopoffertes": erpInkoopoffertes,
  "erp-inkooporders": erpInkooporders,
  "erp-beginbalansen": erpBeginbalansen,
  "erp-dossieritems": erpDossieritems,
};

const HELP_EN: Record<string, ModuleHelp> = {
  "hrm-medewerkers": hrmMedewerkersEn,
  "hrm-uitzendkrachten": hrmUitzendkrachtenEn,
  "hrm-verlofsaldo": hrmVerlofsaldoEn,
  "hrm-salarisparameters": hrmSalarisparametersEn,
  "hrm-vakantietoeslag": hrmVakantietoeslagEn,
  "hrm-wagenpark": hrmWagenparkEn,
  "erp-debiteuren": erpDebiteurenEn,
  "erp-crediteuren": erpCrediteurenEn,
  "erp-contactpersonen": erpContactpersonenEn,
  "erp-artikelen": erpArtikelenEn,
  "erp-projecten": erpProjectenEn,
  "erp-voorcalculatie": erpVoorcalculatieEn,
  "erp-abonnementen": erpAbonnementenEn,
  "erp-openstaandposten": erpOpenstaandpostenEn,
  "erp-vasteActiva": erpVasteActivaEn,
  "erp-nacalculatie": erpNacalculatieEn,
  "erp-financielecontracten": erpFinancieleContractenEn,
  "erp-inkoopoffertes": erpInkoopoffertesEn,
  "erp-inkooporders": erpInkoopordersEn,
  "erp-beginbalansen": erpBeginbalansenEn,
  "erp-dossieritems": erpDossieritemsEn,
};

/** Help content for a module, or undefined if the module id is unknown. */
export function getModuleHelp(moduleId: string): ModuleHelp | undefined {
  const nl = HELP[moduleId];
  const en = HELP_EN[moduleId];
  if (!nl || getLocale() !== "en" || !en) return nl;
  return mergeHelp(nl, en);
}

/**
 * The English article: each part from `content/en/` where it has one, the Dutch
 * where it doesn't — per paragraph list, per column and per FAQ list, so a module
 * translated halfway reads in English as far as it goes and in Dutch after that,
 * never with a hole in it.
 */
function mergeHelp(nl: ModuleHelp, en: ModuleHelp): ModuleHelp {
  const columns: NonNullable<ModuleHelp["columns"]> = { ...nl.columns };
  for (const [name, help] of Object.entries(en.columns ?? {})) {
    columns[name] = { ...columns[name], ...help };
  }
  return {
    general: en.general?.length ? en.general : nl.general,
    columns,
    faq: en.faq?.length ? en.faq : nl.faq,
  };
}
