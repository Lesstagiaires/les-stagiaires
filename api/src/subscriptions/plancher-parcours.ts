import { SubscriptionPlan, UserPath } from '../../generated/prisma/enums';
import { INDIVIDUAL_PLANS, type IndividualPlan } from './individual-plans';

// ============================================================================
// D-21 — LE PARCOURS FIXE LE PLANCHER D'UNE ACQUISITION
//
// CE QUE D-21 EST : une règle d'ÉLIGIBILITÉ COMMERCIALE À L'ACHAT. Elle
// RESTREINT ce qu'une personne peut acquérir selon la situation qu'elle a
// déclarée.
//
// CE QUE D-21 N'EST PAS, ET NE DOIT JAMAIS DEVENIR : une autorisation. Elle
// n'accorde aucun accès, n'ouvre aucune fonctionnalité, n'entre dans aucune
// décision d'entitlement. C'est la seule raison pour laquelle `currentPath`
// devient lisible dans ce dossier — et le test de confinement
// `parcours-non-lu-ailleurs.spec.ts` ne l'autorise nulle part ailleurs.
//
// LA TABLE EST ISOLÉE ICI, comme `derivation-intention.ts` l'est pour V6-1 :
// une correspondance métier noyée dans un service finit toujours par être
// « complétée » au fil des besoins. Ici, toute modification saute aux yeux dans
// un diff et casse un test dédié.
// ============================================================================

export const PLANCHER_PAR_PARCOURS: Record<UserPath, IndividualPlan | null> = {
  [UserPath.ACADEMIC]: SubscriptionPlan.CARRIERE_SECURISEE,
  [UserPath.PROFESSIONAL]: SubscriptionPlan.CARRIERE_PLUS,

  // EMPLOYMENT — AUCUN PLANCHER N'A ÉTÉ ARRÊTÉ.
  //
  // `null` se lit « non décidé », jamais « aucune restriction voulue ». La
  // distinction compte : rien n'est restreint aujourd'hui parce que personne n'a
  // tranché, et non parce qu'on aurait décidé de tout ouvrir. Une décision
  // ultérieure remplira cette ligne sans avoir à deviner l'intention.
  //
  // Le Record étant exhaustif, un parcours ajouté demain ne compilera pas tant
  // que son cas n'aura pas été explicitement traité.
  [UserPath.EMPLOYMENT]: null,
};

// L'ordre des formules individuelles, du plus petit plancher au plus grand.
// Il ne dit rien d'un prix : il répond seulement à « cette formule atteint-elle
// le plancher ? ». Les formules d'organisation n'y figurent pas — une
// organisation n'a pas de parcours de carrière.
const RANG: readonly IndividualPlan[] = INDIVIDUAL_PLANS;

export function atteintLePlancher(
  plan: SubscriptionPlan,
  plancher: IndividualPlan,
): boolean {
  const rangDuPlan = RANG.indexOf(plan as IndividualPlan);
  const rangDuPlancher = RANG.indexOf(plancher);
  // Une formule hors de l'échelle individuelle — BUSINESS, INSTITUTION — ne se
  // compare pas : elle ne concerne pas une personne, et la garde ne s'applique
  // qu'aux formules individuelles.
  if (rangDuPlan < 0 || rangDuPlancher < 0) return true;
  return rangDuPlan >= rangDuPlancher;
}
