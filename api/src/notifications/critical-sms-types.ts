import { NotificationType } from '../../generated/prisma/enums';

// ============================================================================
// POLITIQUE SMS — LISTE BLANCHE
//
// Décision du promoteur du 2026-07-31, point 3 : « Les SMS doivent être réservés
// uniquement aux opérations critiques. Toutes les autres notifications devront
// utiliser les notifications internes, les e-mails, puis ultérieurement les
// notifications Push. »
//
// Cette liste est la SEULE porte par laquelle une notification peut devenir un
// SMS. Elle est une liste BLANCHE et non une liste noire, à dessein : ajouter un
// type de notification demain le laisse par défaut hors du SMS. Une liste noire
// aurait l'effet inverse — tout nouveau type partirait en SMS jusqu'à ce que
// quelqu'un pense à l'exclure, et la facture le dirait avant le code.
//
// Ne rien ajouter ici sans se poser la question du coût ET de l'utilité : un SMS
// coûte, et un SMS de trop apprend à l'utilisateur à ne plus les lire — y compris
// celui qui protégeait son compte.
//
// ---------------------------------------------------------------------------
// NOTE SUR LES OTP ET LE CONSENTEMENT PARENTAL
//
// Ils ne figurent PAS dans cette liste, et ce n'est pas un oubli : ils n'ont
// jamais transité par NotificationsService. OtpService et ParentalConsentService
// appellent SmsProvider directement, parce que leur message doit contenir un code
// à usage unique — donnée qu'on ne stocke ni ne journalise (CLAUDE.md §2).
// ---------------------------------------------------------------------------
export const CRITICAL_SMS_TYPES: ReadonlySet<NotificationType> = new Set([
  // Les trois alertes du compte à rebours de portefeuille (point 8 des mêmes
  // arbitrages). Elles sont explicitement demandées en SMS : perdre une
  // entreprise a une conséquence financière directe pour l'ambassadeur, qui doit
  // pouvoir réagir sans avoir ouvert l'application depuis des semaines — c'est
  // justement parce qu'il ne l'ouvre plus que le compte à rebours court.
  NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
  NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M,
  NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,

  // Argent réellement parti : l'ambassadeur doit pouvoir le constater tout de
  // suite, et signaler immédiatement s'il n'a rien reçu.
  NotificationType.AMBASSADOR_PAYOUT_EXECUTED,

  // Coordonnees de versement modifiees. Le promoteur l'a prevu explicitement :
  // « une alerte de securite peut etre envoyee par SMS lorsque le risque le
  // justifie » (arbitrage 13). Le risque le justifie ici plus qu'ailleurs :
  // celui qui detourne un compte commence par couper l'acces a la boite mail.
  // Le SMS arrive sur le telephone, qu'il n'a pas.
  NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED,

  // --- Candidature : les trois seuls évènements critiques -------------------
  // Décision du promoteur du 2026-08-01. Le reste du cycle de vie d'une
  // candidature (reçue, document demandé, convention signée, clôturée...) part
  // désormais en notification interne et par e-mail, jamais en SMS.
  //
  // Ces trois-là font exception parce qu'ils portent une ÉCHÉANCE que le
  // destinataire ne peut pas rattraper : ne pas voir sa convocation d'entretien,
  // c'est manquer l'entretien ; ne pas voir le rappel de début de stage, c'est
  // ne pas se présenter. Un jeune sans forfait données ce jour-là recevra quand
  // même le SMS.
  NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED,
  NotificationType.APPLICATION_INTERVIEW_PROPOSED,
  NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON,
]);
