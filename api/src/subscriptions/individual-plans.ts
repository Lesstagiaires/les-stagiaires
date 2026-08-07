import { SubscriptionPlan } from '../../generated/prisma/enums';

// Les deux formules individuelles, nommées par le promoteur le 2026-07-31.
// GRATUIT n'y figure pas volontairement : c'est l'état par défaut d'un compte, pas
// quelque chose qu'on souscrit — aucun paiement, donc aucun abonnement à créer.
// BUSINESS et INSTITUTION non plus : ces formules-là ne sont jamais choisies par le
// client, elles se déduisent de Organization.type côté serveur.
export const INDIVIDUAL_PLANS = [
  SubscriptionPlan.CARRIERE_SECURISEE,
  SubscriptionPlan.CARRIERE_PLUS,
] as const;

export type IndividualPlan = (typeof INDIVIDUAL_PLANS)[number];
