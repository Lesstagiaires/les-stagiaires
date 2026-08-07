import { NotificationType } from '../../generated/prisma/enums';

// ============================================================================
// LIEN PROFOND — « ouvrir l'écran concerné »
//
// Le chemin est calculé à la CRÉATION de la notification et stocké, plutôt que
// déduit à l'affichage. Deux notifications d'un même type peuvent viser deux
// dossiers différents : c'est l'identifiant présent dans les métadonnées au
// moment du fait qui fait foi, pas une règle appliquée après coup.
//
// Renvoyer `null` est un cas normal : toutes les notifications ne mènent pas
// quelque part. Le Centre affiche alors la ligne sans action, plutôt qu'un lien
// mort — ce qui est pire que pas de lien du tout.
// ============================================================================
export function resolveLinkPath(
  type: NotificationType,
  metadata?: Record<string, unknown> | null,
): string | null {
  const data = metadata ?? {};
  const applicationId =
    typeof data.applicationId === 'string' ? data.applicationId : null;
  const organizationId =
    typeof data.organizationId === 'string' ? data.organizationId : null;
  const partnershipId =
    typeof data.partnershipId === 'string' ? data.partnershipId : null;

  if (type.startsWith('AMBASSADOR_PORTFOLIO')) return '/ambassador/portfolio';
  if (type.startsWith('AMBASSADOR_PAYOUT')) return '/ambassador/payouts';
  if (type.startsWith('AMBASSADOR_COMMISSION'))
    return '/ambassador/commissions';
  if (type.startsWith('AMBASSADOR_')) return '/ambassador';

  if (type === NotificationType.APPLICATION_RECOMMENDATION_RECEIVED) {
    return '/profile';
  }
  if (type === NotificationType.APPLICATION_CLOSED) return '/digital-safe';

  // Les notifications adressées à l'organisation ouvrent l'espace recruteur ;
  // celles adressées au candidat ouvrent son propre dossier. Le suffixe _ORG est
  // ce qui distingue les deux — d'où son maintien dans le nom des types.
  if (type.endsWith('_ORG')) {
    return applicationId
      ? `/recruiter/applications/${applicationId}`
      : '/recruiter';
  }
  if (type.startsWith('APPLICATION_')) {
    return applicationId ? `/applications/${applicationId}` : '/applications';
  }

  if (type.startsWith('PARTNERSHIP_')) {
    return partnershipId ? `/partnership-requests/${partnershipId}` : null;
  }
  if (
    type.startsWith('ORGANIZATION_') ||
    type === NotificationType.NEED_REQUEST_ANSWERED
  ) {
    return organizationId ? `/recruiter/organization` : '/recruiter';
  }
  if (
    type === NotificationType.LEARNER_INVITED ||
    type === NotificationType.LEARNER_VERIFIED
  ) {
    return '/profile';
  }
  if (type === NotificationType.INTERNSHIP_REPORT_REVIEWED) {
    return applicationId ? `/applications/${applicationId}` : '/applications';
  }

  return null;
}
