import { SubscriptionPlan } from '../../generated/prisma/enums';

// ============================================================================
// V6-4 — CE QU'UNE FORMULE AUTORISE
//
// LE CATALOGUE EST VOLONTAIREMENT VIDE, et ce n'est pas un oubli.
//
// La gouvernance désigne des capacités payantes — assistance juridique,
// optimisation de CV, simulations d'entretien, mentorat. Vérification faite,
// AUCUNE n'existe dans le code : il n'y a ni module juridique, ni générateur de
// lettre, ni simulateur. On ne garde pas une porte qui n'a pas été construite.
//
// Inscrire ces capacités ici les ferait exister aux yeux de la couche
// d'autorisation sans exister pour l'utilisateur. La couche prétendrait
// protéger un service que personne ne peut rendre — et le premier test écrit
// contre elle ne prouverait rien d'autre que sa propre cohérence.
//
// V6-4 livre donc le MÉCANISME et VERROUILLE LES GRATUITÉS, sans simuler ce qui
// n'existe pas encore. Le jour où une capacité payante est réellement
// implémentée, elle s'ajoute ici, et la garde est déjà en place.
//
// POURQUOI UN OBJET CONST PLUTÔT QU'UNE ÉNUMÉRATION. Mesuré : une `enum` vide a
// un type NOMINAL, non assignable à `string`. Le contrôle d'appartenance ne
// compilait pas, et le faire passer exigeait quatre transtypages — qui, le jour
// où des capacités existeraient, masqueraient de vraies erreurs de type. Ici,
// `keyof typeof` d'un objet vide donne `never`, qui est assignable à tout : le
// code compile sans un seul `as`, aujourd'hui vide comme demain rempli.
//
// CE QUI N'ENTRERA JAMAIS ICI. Les capacités gratuites ne sont pas des entrées
// autorisées : elles n'ont aucune entrée du tout. Consulter une offre,
// candidater (`APPLICATION_SUBMIT`) et signaler un abus (`REPORT_ABUSE`) ne
// posent jamais la question à cette couche — c'est la seule façon de garantir
// qu'une règle mal écrite ne puisse pas les fermer. Un test de source l'impose.
// ============================================================================
export const CAPABILITIES = {} as const;

export type EntitlementCapability = keyof typeof CAPABILITIES;

// Le motif accompagne TOUJOURS la décision, y compris quand elle autorise.
// Une décision qui ne dit pas pourquoi ne se débogue pas, et l'appelant ne peut
// rien en construire — ni message, ni proposition de formule.
export enum EntitlementReason {
  INCLUDED = 'INCLUDED',
  CAPABILITY_UNKNOWN = 'CAPABILITY_UNKNOWN',
  PLAN_UNKNOWN = 'PLAN_UNKNOWN',
  NOT_INCLUDED_IN_PLAN = 'NOT_INCLUDED_IN_PLAN',
  NO_ACTIVE_SUBSCRIPTION = 'NO_ACTIVE_SUBSCRIPTION',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
}

// JAMAIS UN BOOLÉEN. Un refus doit pouvoir dire à l'interface quelle formule
// débloquerait l'action ; un booléen obligerait chaque appelant à le redeviner,
// et chacun le devinerait un peu différemment.
//
// `requiredPlan` est nul quand aucune formule ne peut être proposée : soit
// l'action est autorisée, soit l'état est déclaré INCONNU — et on ne calcule
// pas une recommandation à partir de ce qu'on vient de déclarer inconnu.
export interface EntitlementDecision {
  allowed: boolean;
  reason: EntitlementReason;
  requiredPlan: SubscriptionPlan | null;
}
