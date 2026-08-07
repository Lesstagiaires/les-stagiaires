import {
  NotificationCategory,
  NotificationType,
} from '../../generated/prisma/enums';

// ============================================================================
// TYPE → CATÉGORIE
//
// `Record<NotificationType, …>` et non `Partial<…>` : le typage EXIGE que chaque
// type de notification soit classé. Ajouter un type sans lui donner de catégorie
// devient une erreur de compilation, pas une notification qui atterrit dans une
// rubrique « Autre » que personne ne consulte.
//
// C'est cette table qui pilote à la fois le regroupement du Centre de
// Notifications, le filtrage par catégorie, et les préférences de diffusion —
// une seule source, jamais deux listes à tenir synchronisées.
// ============================================================================
export const NOTIFICATION_CATEGORY: Record<
  NotificationType,
  NotificationCategory
> = {
  // --- Partenariats ---------------------------------------------------------
  // La demande entrante du formulaire public arrive dans la boîte de
  // l'administration, pas dans celle d'un partenaire : elle est classée
  // ADMINISTRATION, à la différence de tout le reste du programme.
  [NotificationType.PARTNERSHIP_REQUEST_NEW]:
    NotificationCategory.ADMINISTRATION,
  [NotificationType.PARTNERSHIP_APPLIED]: NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED]:
    NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED]:
    NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_APPROVED]: NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_REFUSED]: NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_SUSPENDED]: NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_REINSTATED]: NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_TERMINATION_REQUESTED]:
    NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN]:
    NotificationCategory.PARTNERSHIPS,
  [NotificationType.PARTNERSHIP_TERMINATED]: NotificationCategory.PARTNERSHIPS,

  // --- Ambassadeurs ---------------------------------------------------------
  [NotificationType.AMBASSADOR_APPROVED]: NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_SUSPENDED]: NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_REINSTATED]: NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_TERMINATED]: NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M]:
    NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M]:
    NotificationCategory.AMBASSADORS,
  [NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED]:
    NotificationCategory.AMBASSADORS,

  // Tout ce qui touche à de l'argent va dans PAYMENTS, pas dans AMBASSADORS :
  // un ambassadeur qui coupe les notifications de son programme ne doit pas
  // couper par mégarde celles qui l'informent d'un versement.
  [NotificationType.AMBASSADOR_COMMISSION_EARNED]:
    NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_COMMISSION_PAYABLE]:
    NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_PAYOUT_VALIDATED]: NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_PAYOUT_EXECUTED]: NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_WALLET_DIVERGENCE]:
    NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_COMMISSION_REVIEW_REQUIRED]:
    NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_FRAUD_ALERT]: NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_PAYOUT_REJECTED]: NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_PAYOUT_FAILED]: NotificationCategory.PAYMENTS,
  [NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED]:
    NotificationCategory.PAYMENTS,

  // --- Candidatures ---------------------------------------------------------
  [NotificationType.APPLICATION_SUBMITTED]: NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_DOCUMENT_REQUESTED]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_REJECTED]: NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_RECEIVED_ORG]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_DOCUMENT_SUBMITTED_ORG]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_ADMISSION_ACCEPTED_ORG]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_WITHDRAWN_ORG]:
    NotificationCategory.APPLICATIONS,
  [NotificationType.APPLICATION_RECOMMENDATION_RECEIVED]:
    NotificationCategory.APPLICATIONS,

  // --- Entretiens -----------------------------------------------------------
  [NotificationType.APPLICATION_INTERVIEW_PROPOSED]:
    NotificationCategory.INTERVIEWS,
  [NotificationType.APPLICATION_INTERVIEW_CONFIRMED_ORG]:
    NotificationCategory.INTERVIEWS,

  // --- Conventions ----------------------------------------------------------
  // Le consentement parental de déplacement conditionne la convention : il est
  // classé ici, et non dans APPLICATIONS, pour que le fil « Conventions » d'un
  // dossier raconte l'histoire complète du document.
  [NotificationType.APPLICATION_ACCEPTED_PENDING_TRAVEL_CONSENT]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED_ORG]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_EXPIRED]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED_ORG]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_ESTABLISHMENT_SIGNED]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_ESTABLISHMENT_SIGNED_ORG]:
    NotificationCategory.AGREEMENTS,
  [NotificationType.APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED]:
    NotificationCategory.AGREEMENTS,

  // --- Stages ---------------------------------------------------------------
  [NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON]:
    NotificationCategory.INTERNSHIPS,
  [NotificationType.APPLICATION_CLOSED]: NotificationCategory.INTERNSHIPS,
  [NotificationType.INTERNSHIP_REPORT_REVIEWED]:
    NotificationCategory.INTERNSHIPS,
  [NotificationType.LEARNER_INVITED]: NotificationCategory.INTERNSHIPS,
  [NotificationType.LEARNER_VERIFIED]: NotificationCategory.INTERNSHIPS,

  // --- Entreprises et organisations -----------------------------------------
  [NotificationType.ORGANIZATION_INVITATION_RECEIVED]:
    NotificationCategory.ORGANIZATIONS,
  [NotificationType.ORGANIZATION_ACCESS_REVOKED]:
    NotificationCategory.ORGANIZATIONS,
  [NotificationType.NEED_REQUEST_ANSWERED]: NotificationCategory.ORGANIZATIONS,
};

// ============================================================================
// CATÉGORIES NON DÉSACTIVABLES
//
// Un utilisateur peut couper ce qui l'encombre. Il ne peut pas couper ce qui le
// protège, ni ce qui l'engage juridiquement ou financièrement.
//
// Laisser couper SECURITY reviendrait à permettre à quelqu'un qui a pris le
// contrôle d'un compte d'éteindre les alertes qui le trahiraient. Laisser couper
// PAYMENTS ou AGREEMENTS, c'est laisser passer une échéance contractuelle sans
// que l'intéressé en ait jamais été informé — et l'ignorance ne se plaide pas.
// ============================================================================
export const UNDISABLEABLE_CATEGORIES: ReadonlySet<NotificationCategory> =
  new Set([
    NotificationCategory.SECURITY,
    NotificationCategory.PAYMENTS,
    NotificationCategory.AGREEMENTS,
    NotificationCategory.LEGAL,
  ]);

export function categoryOf(type: NotificationType): NotificationCategory {
  return NOTIFICATION_CATEGORY[type];
}
