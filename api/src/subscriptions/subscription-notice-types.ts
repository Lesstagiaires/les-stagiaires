import {
  NotificationType,
  SubscriptionNoticeType,
} from '../../generated/prisma/enums';
import { FENETRE_RENOUVELLEMENT_JOURS } from './subscriptions.service';

// ============================================================================
// CE QUE V6-5 SIGNALE, ET COMMENT
//
// FICHIER ISOLÉ, comme `plancher-parcours.ts` l'est pour D-21 et
// `derivation-intention.ts` pour V6-1. Une correspondance métier noyée dans un
// service finit toujours par être « complétée » au fil des besoins ; ici, toute
// modification saute aux yeux dans un diff et casse un test dédié.
//
// V6-5 N'AJOUTE QUE DU SIGNAL. Rien dans ce fichier n'accorde un droit, ne
// modifie un statut, ni n'entre dans une décision d'accès. Les transitions du
// cycle de vie — activation, reconduction, ACTIVE → EXPIRED — restent
// exactement où elles étaient avant ce chantier.
// ============================================================================

// ----------------------------------------------------------------------------
// CONSTAT OU SOLLICITATION — la distinction qui décide de ce qu'un mineur reçoit
//
// Un CONSTAT dit ce qui vient d'arriver : le paiement est passé, la couverture
// s'est arrêtée. Il informe une personne de sa propre situation, déjà réalisée.
//
// Une SOLLICITATION invite à agir avant une échéance. Pour un mineur, l'acte
// qu'elle appelle — payer un abonnement — relève juridiquement du représentant
// légal (CLAUDE.md §6). L'inviter lui-même reviendrait à contourner cette règle
// par le canal des notifications, ce que V6-5 refuse.
//
// LE DÉPÔT NE SAIT PAS ATTEINDRE LE REPRÉSENTANT LÉGAL sur les canaux de V6-5.
// Mesuré en reconnaissance : `ParentalLink.parentId` est nullable et « jamais
// requis » — le tuteur n'a le plus souvent aucun compte, donc ni notification
// interne ni adresse électronique. Le seul canal qui l'atteindrait est le SMS,
// hors périmètre. La sollicitation est donc SUPPRIMÉE, jamais redirigée : c'est
// un manque assumé et documenté, pas un contournement.
//
// Record EXHAUSTIF : un sixième type d'avis ne compilera pas tant que sa nature
// n'aura pas été tranchée. On ne veut pas qu'une sollicitation entre un jour
// dans le système en étant traitée par défaut comme un constat.
// ----------------------------------------------------------------------------
export enum NatureDeLAvis {
  CONSTAT = 'CONSTAT',
  SOLLICITATION = 'SOLLICITATION',
}

export const NATURE_DE_L_AVIS: Record<SubscriptionNoticeType, NatureDeLAvis> = {
  [SubscriptionNoticeType.ACTIVATED]: NatureDeLAvis.CONSTAT,
  [SubscriptionNoticeType.RENEWED]: NatureDeLAvis.CONSTAT,
  [SubscriptionNoticeType.COVERAGE_ENDED]: NatureDeLAvis.CONSTAT,
  [SubscriptionNoticeType.RENEWAL_WINDOW_OPEN]: NatureDeLAvis.SOLLICITATION,
  [SubscriptionNoticeType.EXPIRING_SOON]: NatureDeLAvis.SOLLICITATION,
};

// Le type d'avis (registre d'idempotence) et le type de notification (message
// diffusé) sont deux vocabulaires distincts, reliés ici et nulle part ailleurs.
export const NOTIFICATION_DE_L_AVIS: Record<
  SubscriptionNoticeType,
  NotificationType
> = {
  [SubscriptionNoticeType.ACTIVATED]: NotificationType.SUBSCRIPTION_ACTIVATED,
  [SubscriptionNoticeType.RENEWED]: NotificationType.SUBSCRIPTION_RENEWED,
  [SubscriptionNoticeType.COVERAGE_ENDED]:
    NotificationType.SUBSCRIPTION_COVERAGE_ENDED,
  [SubscriptionNoticeType.RENEWAL_WINDOW_OPEN]:
    NotificationType.SUBSCRIPTION_RENEWAL_WINDOW_OPEN,
  [SubscriptionNoticeType.EXPIRING_SOON]:
    NotificationType.SUBSCRIPTION_EXPIRING_SOON,
};

export interface SeuilAvantEcheance {
  readonly type: SubscriptionNoticeType;
  readonly joursAvant: number;
}

// ----------------------------------------------------------------------------
// LES SEUILS, DU PLUS URGENT AU MOINS URGENT
//
// L'ORDRE EST LA RÈGLE, pas une commodité de lecture. Mesuré le 2026-08-24 : le
// balayage n'avait pas tourné depuis TREIZE JOURS, faute de processus API
// vivant. Un balayage qui se réveille ne doit pas rattraper son retard en
// rafale — recevoir « il reste 30 jours » puis « il reste 7 jours » dans la même
// minute est incohérent, et le second contredit le premier.
//
// On retient donc UN SEUL seuil : le plus avancé qui soit atteint. Même
// principe que `portfolio.service.ts` pour le compte à rebours ambassadeurs,
// où il évite d'envoyer trois mois d'alertes d'un coup.
//
// ATTENTION AU SENS DE L'ORDRE. Ici le compte à rebours DIMINUE : moins il
// reste de jours, plus c'est urgent. Le plus urgent est donc le plus PETIT
// nombre de jours — d'où 7 avant 30, là où le portefeuille ambassadeur trie ses
// mois écoulés en décroissant. Les deux disent la même chose : le seuil le plus
// avancé d'abord.
//
// LE J-30 EST LA FENÊTRE DE RECONDUCTION ELLE-MÊME, importée et non recopiée.
// Annoncer une ouverture à une date où `assertRenouvelable` refuse encore
// produirait un bouton qui échoue — et les deux valeurs auraient dérivé sans que
// rien ne le dise.
// ----------------------------------------------------------------------------
export const SEUILS_AVANT_ECHEANCE: readonly SeuilAvantEcheance[] = [
  { type: SubscriptionNoticeType.EXPIRING_SOON, joursAvant: 7 },
  {
    type: SubscriptionNoticeType.RENEWAL_WINDOW_OPEN,
    joursAvant: FENETRE_RENOUVELLEMENT_JOURS,
  },
];

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// Le seuil le plus avancé atteint, ou `null` si l'échéance est encore lointaine.
//
// CALCULÉ DEPUIS LES DATES EN BASE, jamais depuis l'instant où le balayage s'est
// réveillé : c'est ce qui rend le résultat identique que le balayage soit à
// l'heure ou en retard de deux semaines.
export function seuilAtteint(
  periodEnd: Date,
  maintenant: Date,
): SeuilAvantEcheance | null {
  const restantMs = periodEnd.getTime() - maintenant.getTime();

  // Échéance déjà passée : ce n'est plus une alerte d'anticipation mais une fin
  // de couverture, et c'est le balayage d'expiration qui la porte.
  if (restantMs <= 0) return null;

  for (const seuil of SEUILS_AVANT_ECHEANCE) {
    if (restantMs <= seuil.joursAvant * MS_PAR_JOUR) return seuil;
  }
  return null;
}
