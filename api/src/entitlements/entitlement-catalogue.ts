import { SubscriptionPlan } from '../../generated/prisma/enums';
import {
  CAPABILITIES,
  type EntitlementCapability,
} from './entitlement-capability';

// ============================================================================
// CE QUE CHAQUE FORMULE INCLUT
//
// FICHIER DÉLIBÉRÉMENT SÉPARÉ DU SERVICE. Ce n'est pas un rangement : ESLint
// interdit de l'importer ailleurs que depuis `entitlements.service.ts`. Sans
// cette séparation, n'importe quel module pourrait lire le catalogue et trancher
// lui-même — la décision cesserait d'être centralisée sans que rien ne le
// signale, et deux endroits finiraient par ne plus dire la même chose.
//
// `Record<SubscriptionPlan, …>` EXHAUSTIF, et c'est la garantie principale :
// oublier une formule NE COMPILE PAS. Mesuré — retirer une ligne produit
// « TS2741: Property '[SubscriptionPlan.BUSINESS]' is missing ». La règle
// « inconnu = refusé » est donc portée par le compilateur, pas par une
// vérification d'exécution qu'on pourrait oublier d'écrire.
//
// MONOTONIE. Les ensembles doivent rester emboîtés :
//   GRATUIT ⊆ CARRIÈRE SÉCURISÉE ⊆ CARRIÈRE PLUS
// Payer davantage ne doit jamais retirer quelque chose. Un test la vérifie en
// parcourant ce catalogue, de sorte qu'il gardera son sens quand des capacités
// y seront ajoutées — aujourd'hui il passe sur des ensembles vides, demain il
// mordra.
//
// GRATUIT N'EST PAS UNE FORMULE QU'ON SOUSCRIT. Le dépôt le documente
// (`individual-plans.ts`) : c'est l'état par défaut d'un compte. Une capacité
// inscrite ici serait donc ouverte à tous, y compris à qui n'a jamais payé —
// et le service la consulte AVANT de refuser pour absence d'abonnement.
//
// BUSINESS et INSTITUTION concernent les organisations. Leurs lignes existent
// parce que le Record est exhaustif, non parce qu'une capacité leur est promise.
//
// ----------------------------------------------------------------------------
// À LIRE AVANT D'INSCRIRE LA PREMIÈRE CAPACITÉ RÉELLE
//
// L'exhaustivité porte sur les FORMULES, jamais sur les CAPACITÉS. Déclarer une
// capacité sans l'inscrire dans au moins un ensemble ci-dessus compile donc sans
// aucune erreur — vérifié par mesure en revue V6-4.
//
// Une telle capacité orpheline reste fail-closed : elle est refusée avec
// `NOT_INCLUDED_IN_PLAN` et `requiredPlan: null`, puisque aucune formule ne
// l'inclut. Rien de dangereux, donc, mais rien de visible non plus : la
// fonctionnalité serait inaccessible à tout le monde, silencieusement, y compris
// à qui vient de payer pour elle.
//
// Au moment d'ajouter la première capacité, vérifier donc qu'elle appartient à
// au moins une formule. Aucun contrôle n'est ajouté aujourd'hui pour un problème
// qui n'existe pas encore, et aucune capacité fictive n'est créée pour l'éprouver.
// ============================================================================
export const ENTITLEMENT_CATALOGUE: Record<
  SubscriptionPlan,
  readonly EntitlementCapability[]
> = {
  [SubscriptionPlan.GRATUIT]: [],
  [SubscriptionPlan.CARRIERE_SECURISEE]: [
    CAPABILITIES.GMAIL_ACCOUNT_OPENING_ASSISTANCE,
    CAPABILITIES.CV_AND_COVER_LETTER_ASSISTANCE,
    CAPABILITIES.LEGAL_CONTENTION_ASSISTANCE,
  ],
  [SubscriptionPlan.CARRIERE_PLUS]: [
    CAPABILITIES.GMAIL_ACCOUNT_OPENING_ASSISTANCE,
    CAPABILITIES.CV_AND_COVER_LETTER_ASSISTANCE,
    CAPABILITIES.LEGAL_CONTENTION_ASSISTANCE,
    CAPABILITIES.PERSONALITY_ORIENTATION_REPORT,
    CAPABILITIES.EXPLANATION_REQUEST_WRITING_ASSISTANCE,
    CAPABILITIES.DATA_PROTECTION_ASSISTANCE,
  ],
  [SubscriptionPlan.BUSINESS]: [],
  [SubscriptionPlan.INSTITUTION]: [],
};

// L'ordre de proposition d'une formule à qui n'y a pas droit. Il ne dit rien
// d'un prix ni d'une hiérarchie commerciale : il sert uniquement à répondre
// « quelle est la plus petite formule qui inclut cette capacité ? ».
export const ORDRE_DE_PROPOSITION: readonly SubscriptionPlan[] = [
  SubscriptionPlan.GRATUIT,
  SubscriptionPlan.CARRIERE_SECURISEE,
  SubscriptionPlan.CARRIERE_PLUS,
  SubscriptionPlan.BUSINESS,
  SubscriptionPlan.INSTITUTION,
];
