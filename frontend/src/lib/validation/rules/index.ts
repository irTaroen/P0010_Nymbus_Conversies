/**
 * Aggregates every per-module rule file into one map keyed by module id.
 *
 * Each JSON file's name IS its module id (see lib/modules.tsx). To add rules for
 * a module, edit its JSON file; to add a new module, drop a file here and import
 * it below. The engine looks rules up by the active module's id.
 */

import type { ModuleRuleSet } from "../types";

import hrmMedewerkers from "./hrm-medewerkers.json";
import hrmUitzendkrachten from "./hrm-uitzendkrachten.json";
import hrmVerlofsaldo from "./hrm-verlofsaldo.json";
import hrmSalarisparameters from "./hrm-salarisparameters.json";
import hrmVakantietoeslag from "./hrm-vakantietoeslag.json";
import hrmWagenpark from "./hrm-wagenpark.json";
import erpDebiteuren from "./erp-debiteuren.json";
import erpCrediteuren from "./erp-crediteuren.json";
import erpContactpersonen from "./erp-contactpersonen.json";
import erpArtikelen from "./erp-artikelen.json";
import erpProjecten from "./erp-projecten.json";
import erpVoorcalculatie from "./erp-voorcalculatie.json";
import erpAbonnementen from "./erp-abonnementen.json";
import erpOpenstaandposten from "./erp-openstaandposten.json";
import erpVasteActiva from "./erp-vasteActiva.json";
import erpNacalculatie from "./erp-nacalculatie.json";
import erpFinancieleContracten from "./erp-financielecontracten.json";
import erpInkoopoffertes from "./erp-inkoopoffertes.json";
import erpInkooporders from "./erp-inkooporders.json";
import erpBeginbalansen from "./erp-beginbalansen.json";
import erpDossieritems from "./erp-dossieritems.json";

export const RULE_SETS: Record<string, ModuleRuleSet> = {
  "hrm-medewerkers": hrmMedewerkers as ModuleRuleSet,
  "hrm-uitzendkrachten": hrmUitzendkrachten as ModuleRuleSet,
  "hrm-verlofsaldo": hrmVerlofsaldo as ModuleRuleSet,
  "hrm-salarisparameters": hrmSalarisparameters as ModuleRuleSet,
  "hrm-vakantietoeslag": hrmVakantietoeslag as ModuleRuleSet,
  "hrm-wagenpark": hrmWagenpark as ModuleRuleSet,
  "erp-debiteuren": erpDebiteuren as ModuleRuleSet,
  "erp-crediteuren": erpCrediteuren as ModuleRuleSet,
  "erp-contactpersonen": erpContactpersonen as ModuleRuleSet,
  "erp-artikelen": erpArtikelen as ModuleRuleSet,
  "erp-projecten": erpProjecten as ModuleRuleSet,
  "erp-voorcalculatie": erpVoorcalculatie as ModuleRuleSet,
  "erp-abonnementen": erpAbonnementen as ModuleRuleSet,
  "erp-openstaandposten": erpOpenstaandposten as ModuleRuleSet,
  "erp-vasteActiva": erpVasteActiva as ModuleRuleSet,
  "erp-nacalculatie": erpNacalculatie as ModuleRuleSet,
  "erp-financielecontracten": erpFinancieleContracten as ModuleRuleSet,
  "erp-inkoopoffertes": erpInkoopoffertes as ModuleRuleSet,
  "erp-inkooporders": erpInkooporders as ModuleRuleSet,
  "erp-beginbalansen": erpBeginbalansen as ModuleRuleSet,
  "erp-dossieritems": erpDossieritems as ModuleRuleSet,
};
