import { NotificationType } from '../../generated/prisma/enums';

// ============================================================================
// COMPORTEMENT DE DIFFUSION — arbitrage du promoteur du 2026-08-01
//
// « Il n'est pas nécessaire d'envoyer un e-mail pour chacun des 50 types. Cela
// produirait trop de messages et dégraderait l'expérience utilisateur. En
// revanche, aucun type ne doit rester sans comportement explicitement défini. »
//
// D'où cette table, et surtout son typage : `Record<NotificationType, …>` et non
// `Partial`. Ajouter un type sans décider de son comportement devient une erreur
// de compilation. Aucun évènement ne peut donc glisser dans un défaut implicite —
// ni « on envoie tout », qui noierait l'utilisateur, ni « on n'envoie rien », qui
// lui ferait manquer une échéance.
//
// LA NOTIFICATION INTERNE EST TOUJOURS ÉCRITE, quel que soit le comportement :
// elle constitue l'historique du Centre de Notifications. Cette table ne décide
// que du canal E-MAIL.
// ============================================================================
export enum DeliveryPolicy {
  // L'e-mail part quelles que soient les préférences. Réservé à ce qui porte une
  // échéance, un engagement contractuel, de l'argent, ou une action attendue de
  // la personne. Couper ces e-mails reviendrait à la laisser manquer quelque
  // chose qu'elle ne pourrait pas rattraper.
  EMAIL_REQUIRED = 'EMAIL_REQUIRED',

  // L'e-mail part sauf si l'utilisateur a coupé la catégorie. C'est le cas des
  // évènements utiles mais non contraignants — savoir sans avoir à agir.
  EMAIL_OPTIONAL = 'EMAIL_OPTIONAL',

  // Jamais d'e-mail. L'évènement a sa place dans l'historique, pas dans une boîte
  // de réception : un recruteur qui reçoit cinquante candidatures par jour ne
  // veut pas cinquante e-mails.
  IN_APP_ONLY = 'IN_APP_ONLY',

  // Évènement interne d'administration. Il s'adresse à l'équipe LES STAGIAIRES,
  // pas à un utilisateur final, et relève d'un outil de back-office plutôt que
  // d'une messagerie personnelle.
  ADMINISTRATIVE = 'ADMINISTRATIVE',
}

export const NOTIFICATION_DELIVERY: Record<NotificationType, DeliveryPolicy> = {
  // --- Candidature, vue du candidat -----------------------------------------
  // Le promoteur a rendu l'e-mail OBLIGATOIRE à chaque changement de statut vu
  // par le candidat. Deux exceptions assumées ci-dessous, signalées comme telles.
  [NotificationType.APPLICATION_SUBMITTED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_DOCUMENT_REQUESTED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_INTERVIEW_PROPOSED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_REJECTED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_ACCEPTED_PENDING_TRAVEL_CONSENT]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_EXPIRED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_ESTABLISHMENT_SIGNED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_CLOSED]: DeliveryPolicy.EMAIL_REQUIRED,
  // Une recommandation fait plaisir, elle n'attend rien. Aucune raison de forcer
  // un e-mail que la personne ne pourrait pas refuser.
  [NotificationType.APPLICATION_RECOMMENDATION_RECEIVED]:
    DeliveryPolicy.EMAIL_OPTIONAL,

  // --- Candidature, vue de l'organisation -----------------------------------
  // Un recruteur actif reçoit des dizaines d'évènements par jour : la règle par
  // défaut est ici l'inverse de celle du candidat. Seul ce qui appelle une action
  // ou engage contractuellement force l'e-mail.
  [NotificationType.APPLICATION_RECEIVED_ORG]: DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.APPLICATION_DOCUMENT_SUBMITTED_ORG]:
    DeliveryPolicy.IN_APP_ONLY,
  [NotificationType.APPLICATION_INTERVIEW_CONFIRMED_ORG]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  // Le candidat a accepté : l'organisation doit générer la convention.
  [NotificationType.APPLICATION_ADMISSION_ACCEPTED_ORG]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED_ORG]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED_ORG]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.APPLICATION_ESTABLISHMENT_SIGNED_ORG]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.APPLICATION_WITHDRAWN_ORG]: DeliveryPolicy.IN_APP_ONLY,
  // L'établissement doit décider s'il s'associe à la convention.
  [NotificationType.APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED]:
    DeliveryPolicy.EMAIL_REQUIRED,

  // --- Établissement et apprenants ------------------------------------------
  // Une invitation attend une réponse ; une confirmation n'attend rien.
  [NotificationType.LEARNER_INVITED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.LEARNER_VERIFIED]: DeliveryPolicy.IN_APP_ONLY,
  [NotificationType.INTERNSHIP_REPORT_REVIEWED]: DeliveryPolicy.EMAIL_OPTIONAL,

  // --- Organisations ---------------------------------------------------------
  [NotificationType.ORGANIZATION_INVITATION_RECEIVED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  // Perdre l'accès à une organisation touche aux droits : la personne doit
  // l'apprendre, y compris si elle n'ouvre plus l'application.
  [NotificationType.ORGANIZATION_ACCESS_REVOKED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.NEED_REQUEST_ANSWERED]: DeliveryPolicy.EMAIL_OPTIONAL,

  // --- Ambassadeurs ----------------------------------------------------------
  [NotificationType.AMBASSADOR_APPROVED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_SUSPENDED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_REINSTATED]: DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.AMBASSADOR_TERMINATED]: DeliveryPolicy.EMAIL_REQUIRED,
  // Les trois alertes du compte à rebours : perdre une entreprise de son
  // portefeuille a une conséquence financière directe, et le compte à rebours
  // court précisément parce que l'ambassadeur n'ouvre plus l'application.
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED]:
    DeliveryPolicy.EMAIL_REQUIRED,

  // --- Paiements et commissions ----------------------------------------------
  // Une commission peut naître plusieurs fois par jour : la forcer en e-mail
  // transformerait la boîte de l'ambassadeur en journal comptable. Les mouvements
  // d'ARGENT RÉEL, eux, ne se coupent pas.
  [NotificationType.AMBASSADOR_COMMISSION_EARNED]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.AMBASSADOR_COMMISSION_PAYABLE]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.AMBASSADOR_PAYOUT_VALIDATED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_PAYOUT_EXECUTED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.AMBASSADOR_PAYOUT_REJECTED]: DeliveryPolicy.EMAIL_REQUIRED,

  // --- Partenariats ----------------------------------------------------------
  [NotificationType.PARTNERSHIP_APPLIED]: DeliveryPolicy.EMAIL_OPTIONAL,
  // Le promoteur l'a exigé explicitement : « déclencher une notification interne et
  // un e-mail obligatoire ». Une organisation qui ignore qu'il manque une pièce voit
  // son dossier s'enliser sans jamais savoir pourquoi.
  [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  // Destinataire : l'administration. Même nature et même audience que
  // PARTNERSHIP_APPLIED — un dossier attend d'être examiné — donc même politique.
  [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.PARTNERSHIP_APPROVED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.PARTNERSHIP_REFUSED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.PARTNERSHIP_SUSPENDED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.PARTNERSHIP_REINSTATED]: DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.PARTNERSHIP_TERMINATION_REQUESTED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN]:
    DeliveryPolicy.EMAIL_OPTIONAL,
  [NotificationType.PARTNERSHIP_TERMINATED]: DeliveryPolicy.EMAIL_REQUIRED,

  // --- Administration --------------------------------------------------------
  // Destinataire : l'équipe LES STAGIAIRES, pas un utilisateur final. Relève d'un
  // back-office, pas d'une messagerie personnelle.
  [NotificationType.PARTNERSHIP_REQUEST_NEW]: DeliveryPolicy.ADMINISTRATIVE,
  // Écart comptable : s adresse à l équipe LES STAGIAIRES, relève du back-office
  // et non d une boîte de réception personnelle.
  [NotificationType.AMBASSADOR_WALLET_DIVERGENCE]:
    DeliveryPolicy.ADMINISTRATIVE,
  // Le virement n'est jamais arrivé et la somme est revenue au solde disponible.
  // Destinataire : l'ambassadeur. Il doit l'apprendre par nous, et non par le
  // silence de son opérateur.
  [NotificationType.AMBASSADOR_PAYOUT_FAILED]: DeliveryPolicy.EMAIL_REQUIRED,
  // ALERTE DE SECURITE. C'est la notification par laquelle quelqu'un dont le
  // compte a ete detourne peut s'en apercevoir : elle part quelles que soient
  // les preferences, et elle figure aussi dans CRITICAL_SMS_TYPES. Couper cette
  // alerte-la reviendrait a offrir le silence a celui qui detourne.
  [NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED]:
    DeliveryPolicy.EMAIL_REQUIRED,
  // Commission mise de côté par un plafond : c'est à l'administration d'arbitrer,
  // et l'ambassadeur n'a rien reçu à ce stade — le prévenir reviendrait à lui
  // annoncer une somme que personne n'a encore validée.
  [NotificationType.AMBASSADOR_COMMISSION_REVIEW_REQUIRED]:
    DeliveryPolicy.ADMINISTRATIVE,
  // Alerte antifraude : elle s'adresse à l'équipe LES STAGIAIRES et à personne
  // d'autre. Prévenir l'intéressé qu'il est surveillé serait lui apprendre à ne
  // plus l'être.
  [NotificationType.AMBASSADOR_FRAUD_ALERT]: DeliveryPolicy.ADMINISTRATIVE,

  // --- Cycle de vie d'un abonnement (V6-5) ---
  //
  // Arbitrage du promoteur du 2026-08-24. La granularité est assumée AU TYPE :
  // la catégorie SUBSCRIPTIONS reste coupable dans les préférences, et
  // `UNDISABLEABLE_CATEGORIES` n'a pas été touchée pour autant. Verrouiller la
  // catégorie entière aurait rendu obligatoire tout ce qui viendra s'y ranger
  // demain, pour ne régler que la question de l'échéance.
  //
  // De l'argent a été débité. Un reçu ne se coupe pas.
  [NotificationType.SUBSCRIPTION_ACTIVATED]: DeliveryPolicy.EMAIL_REQUIRED,
  [NotificationType.SUBSCRIPTION_RENEWED]: DeliveryPolicy.EMAIL_REQUIRED,
  // Un droit vient d'être perdu — le constater après coup, par surprise, est
  // exactement ce que cette table cherche à éviter.
  [NotificationType.SUBSCRIPTION_COVERAGE_ENDED]: DeliveryPolicy.EMAIL_REQUIRED,
  // J-7 : l'échéance est assez proche pour qu'un e-mail manqué ne se rattrape
  // pas. Elle passe donc outre la préférence, comme tout ce qui porte une date
  // butoir dans cette table.
  [NotificationType.SUBSCRIPTION_EXPIRING_SOON]: DeliveryPolicy.EMAIL_REQUIRED,
  // J-30 : information anticipée, sans urgence. C'est le seul des cinq qui
  // relève du confort, donc le seul que l'utilisateur peut couper.
  [NotificationType.SUBSCRIPTION_RENEWAL_WINDOW_OPEN]:
    DeliveryPolicy.EMAIL_OPTIONAL,
};

export function deliveryPolicyOf(type: NotificationType): DeliveryPolicy {
  return NOTIFICATION_DELIVERY[type];
}

// L'e-mail est-il envisagé pour ce type, indépendamment des préférences ?
export function mayEmail(type: NotificationType): boolean {
  const policy = deliveryPolicyOf(type);
  return (
    policy === DeliveryPolicy.EMAIL_REQUIRED ||
    policy === DeliveryPolicy.EMAIL_OPTIONAL
  );
}

// Les préférences de l'utilisateur s'appliquent-elles ?
//
// Non pour EMAIL_REQUIRED : ces évènements portent une échéance, un engagement ou
// de l'argent. Le promoteur a demandé que l'on puisse « désactiver les e-mails
// tout en conservant la notification interne » — mais LORSQUE L'ÉVÉNEMENT N'EST
// PAS CRITIQUE. C'est exactement cette frontière.
export function respectsPreferences(type: NotificationType): boolean {
  return deliveryPolicyOf(type) === DeliveryPolicy.EMAIL_OPTIONAL;
}
