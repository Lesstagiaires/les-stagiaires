import { Language, NotificationType } from '../../generated/prisma/enums';
import type { NotificationPayload } from './notification-channel.interface';

// ============================================================================
// EXCEPTION ASSUMÉE À LA CONVENTION MAISON
//
// Partout ailleurs, le serveur stocke des données structurées et le client les
// traduit dans la langue de l'utilisateur. Un SMS n'a pas de client : le texte
// doit bien être composé quelque part, et ce ne peut être qu'ici.
//
// D'où la contrainte que s'impose ce fichier : il est le SEUL du backend à
// contenir des phrases rédigées, il ne couvre que les quatre types de la liste
// blanche CRITICAL_SMS_TYPES, et il les couvre dans TOUTES les langues du
// produit — l'exhaustivité est vérifiée par sms-templates.spec.ts, qui échoue si
// un type de la liste blanche n'a pas de gabarit, ou s'il en manque une langue.
// Toute nouvelle phrase rédigée ailleurs dans le backend est une régression.
//
// NOTE DE COÛT : un SMS en arabe passe en encodage UCS-2, qui plafonne à
// 70 caractères par segment contre 160 en GSM-7. Les textes arabes sont donc
// tenus délibérément courts — un message trop long y coûte le triple.
// ============================================================================

type Templates = Record<Language, (name: string) => string>;

const PORTFOLIO_WARNING_9M: Templates = {
  [Language.FR]: (name) =>
    `LES STAGIAIRES : ${name} n'a réalisé aucun achat depuis 9 mois. Sans nouvel achat dans les 3 prochains mois, cette entreprise sera automatiquement libérée de votre portefeuille.`,
  [Language.EN]: (name) =>
    `LES STAGIAIRES: ${name} has made no purchase for 9 months. Without a new purchase within 3 months, this company will automatically leave your portfolio.`,
  [Language.ES]: (name) =>
    `LES STAGIAIRES: ${name} no ha realizado ninguna compra desde hace 9 meses. Sin una nueva compra en 3 meses, esta empresa saldrá automáticamente de su cartera.`,
  [Language.AR]: (name) =>
    `LES STAGIAIRES: ${name} بدون شراء منذ 9 أشهر. بدون شراء خلال 3 أشهر ستخرج من محفظتك.`,
  [Language.PT]: (name) =>
    `LES STAGIAIRES: ${name} não fez nenhuma compra há 9 meses. Sem uma nova compra em 3 meses, esta empresa sairá automaticamente da sua carteira.`,
};

const PORTFOLIO_WARNING_11M: Templates = {
  [Language.FR]: (name) =>
    `LES STAGIAIRES : il ne reste qu'un mois avant l'expiration du rattachement de l'entreprise ${name} à votre portefeuille.`,
  [Language.EN]: (name) =>
    `LES STAGIAIRES: only one month left before ${name} leaves your portfolio.`,
  [Language.ES]: (name) =>
    `LES STAGIAIRES: solo queda un mes antes de que ${name} salga de su cartera.`,
  [Language.AR]: (name) =>
    `LES STAGIAIRES: شهر واحد قبل خروج ${name} من محفظتك.`,
  [Language.PT]: (name) =>
    `LES STAGIAIRES: falta apenas um mês antes de ${name} sair da sua carteira.`,
};

const PORTFOLIO_EXPIRED: Templates = {
  [Language.FR]: (name) =>
    `LES STAGIAIRES : le rattachement de l'entreprise ${name} à votre portefeuille a expiré, faute d'achat depuis 12 mois. Un nouvel achat de sa part ne vous sera plus commissionné.`,
  [Language.EN]: (name) =>
    `LES STAGIAIRES: ${name} has left your portfolio after 12 months without a purchase. Future purchases will no longer earn you a commission.`,
  [Language.ES]: (name) =>
    `LES STAGIAIRES: ${name} ha salido de su cartera tras 12 meses sin compras. Sus futuras compras ya no le generarán comisión.`,
  [Language.AR]: (name) =>
    `LES STAGIAIRES: خرجت ${name} من محفظتك بعد 12 شهرا بدون شراء. لن تحصل على عمولة عن مشترياتها.`,
  [Language.PT]: (name) =>
    `LES STAGIAIRES: ${name} saiu da sua carteira após 12 meses sem compras. As compras futuras já não lhe darão comissão.`,
};

const PAYOUT_EXECUTED: Templates = {
  [Language.FR]: (amount) =>
    `LES STAGIAIRES : votre versement de ${amount} a été exécuté. Si vous ne le recevez pas, signalez-le depuis l'application.`,
  [Language.EN]: (amount) =>
    `LES STAGIAIRES: your payout of ${amount} has been executed. If you do not receive it, report it from the app.`,
  [Language.ES]: (amount) =>
    `LES STAGIAIRES: su pago de ${amount} ha sido ejecutado. Si no lo recibe, notifíquelo desde la aplicación.`,
  [Language.AR]: (amount) =>
    `LES STAGIAIRES: تم تنفيذ دفعتك ${amount}. إن لم تصلك، أبلغ عبر التطبيق.`,
  [Language.PT]: (amount) =>
    `LES STAGIAIRES: o seu pagamento de ${amount} foi executado. Se não o receber, comunique-o pela aplicação.`,
};

// ALERTE DE SÉCURITÉ — coordonnées de versement modifiées.
//
// Aucune destination, même masquée, ne figure dans ce SMS : un message reçu par
// erreur, ou lu sur un écran verrouillé, ne doit rien apprendre à personne. Il
// dit le FAIT et l'action à mener, rien d'autre.
//
// L'impératif « signalez-le immédiatement » n'est pas une formule : la route de
// signalement existe et gèle les versements sans condition.
const PAYMENT_DETAILS_CHANGED: Templates = {
  [Language.FR]: () =>
    `LES STAGIAIRES : vos coordonnées de versement ont été modifiées. Si vous n'êtes pas à l'origine de ce changement, signalez-le immédiatement depuis l'application.`,
  [Language.EN]: () =>
    `LES STAGIAIRES: your payout details have been changed. If you did not make this change, report it immediately from the app.`,
  [Language.ES]: () =>
    `LES STAGIAIRES: sus datos de pago han sido modificados. Si no ha sido usted, notifíquelo de inmediato desde la aplicación.`,
  [Language.AR]: () =>
    `LES STAGIAIRES: تم تغيير بيانات الصرف الخاصة بك. إن لم تكن أنت من غيّرها، أبلغ فورًا عبر التطبيق.`,
  [Language.PT]: () =>
    `LES STAGIAIRES: os seus dados de pagamento foram alterados. Se não foi você, comunique-o imediatamente pela aplicação.`,
};

// --- Candidature : les trois évènements à échéance -------------------------
// Chacun tient dans un seul segment SMS. Aucun ne contient de donnée sensible :
// une référence de candidature ne dit rien à qui intercepterait le message.

const ADMISSION_LETTER: Templates = {
  [Language.FR]: (reference) =>
    `LES STAGIAIRES : bonne nouvelle, votre candidature ${reference} est acceptée. Connectez-vous pour accepter la lettre d'admission.`,
  [Language.EN]: (reference) =>
    `LES STAGIAIRES: good news, your application ${reference} has been accepted. Log in to accept the admission letter.`,
  [Language.ES]: (reference) =>
    `LES STAGIAIRES: buenas noticias, su candidatura ${reference} ha sido aceptada. Conéctese para aceptar la carta de admisión.`,
  [Language.AR]: (reference) =>
    `LES STAGIAIRES: تم قبول ترشحك ${reference}. سجّل الدخول لقبول رسالة القبول.`,
  [Language.PT]: (reference) =>
    `LES STAGIAIRES: boa notícia, a sua candidatura ${reference} foi aceite. Entre para aceitar a carta de admissão.`,
};

const INTERVIEW_PROPOSED: Templates = {
  [Language.FR]: (reference) =>
    `LES STAGIAIRES : un entretien vous est proposé pour votre candidature ${reference}. Connectez-vous pour confirmer la date.`,
  [Language.EN]: (reference) =>
    `LES STAGIAIRES: an interview has been proposed for your application ${reference}. Log in to confirm the date.`,
  [Language.ES]: (reference) =>
    `LES STAGIAIRES: le proponen una entrevista para su candidatura ${reference}. Conéctese para confirmar la fecha.`,
  [Language.AR]: (reference) =>
    `LES STAGIAIRES: مقابلة مقترحة لترشحك ${reference}. سجّل الدخول لتأكيد الموعد.`,
  [Language.PT]: (reference) =>
    `LES STAGIAIRES: foi proposta uma entrevista para a sua candidatura ${reference}. Entre para confirmar a data.`,
};

const INTERNSHIP_STARTING_SOON: Templates = {
  [Language.FR]: (reference) =>
    `LES STAGIAIRES : votre stage (candidature ${reference}) commence bientôt. Retrouvez les modalités dans l'application.`,
  [Language.EN]: (reference) =>
    `LES STAGIAIRES: your internship (application ${reference}) starts soon. Find the details in the app.`,
  [Language.ES]: (reference) =>
    `LES STAGIAIRES: sus prácticas (candidatura ${reference}) comienzan pronto. Consulte los detalles en la aplicación.`,
  [Language.AR]: (reference) =>
    `LES STAGIAIRES: تدريبك (${reference}) يبدأ قريبا. التفاصيل في التطبيق.`,
  [Language.PT]: (reference) =>
    `LES STAGIAIRES: o seu estágio (candidatura ${reference}) começa em breve. Consulte os detalhes na aplicação.`,
};

const TEMPLATES: Partial<Record<NotificationType, Templates>> = {
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M]: PORTFOLIO_WARNING_9M,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M]: PORTFOLIO_WARNING_11M,
  [NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED]: PORTFOLIO_EXPIRED,
  [NotificationType.AMBASSADOR_PAYOUT_EXECUTED]: PAYOUT_EXECUTED,
  [NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED]:
    PAYMENT_DETAILS_CHANGED,
  [NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED]: ADMISSION_LETTER,
  [NotificationType.APPLICATION_INTERVIEW_PROPOSED]: INTERVIEW_PROPOSED,
  [NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON]:
    INTERNSHIP_STARTING_SOON,
};

// Gabarits dont le texte ne reprend AUCUNE donnée du dossier. Une alerte de
// compromission en fait partie : elle se lit sur un écran verrouillé, dans le
// métro, par-dessus une épaule. Elle dit le fait et l'action à mener, rien de
// plus — pas même une destination masquée.
const SUBJECTLESS_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED,
]);

export function renderCriticalSms(
  payload: NotificationPayload,
  language: Language = Language.FR,
): string | null {
  const template = TEMPLATES[payload.type];
  if (!template) return null;

  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  // Trois formes de sujet selon la famille d'évènement : le nom d'une
  // organisation (portefeuille), une référence de candidature, ou un montant.
  const subject =
    (typeof metadata.organizationName === 'string'
      ? metadata.organizationName
      : null) ??
    (typeof metadata.reference === 'string' ? metadata.reference : null) ??
    formatAmount(metadata);

  // Certains messages sont INVARIABLES, et c'est un choix de sécurité : une
  // alerte de compromission ne reprend aucune donnée, pas même masquée, parce
  // qu'un SMS se lit sur un écran verrouillé. Exiger un sujet de ces gabarits-là
  // reviendrait à ne jamais les envoyer.
  if (SUBJECTLESS_TYPES.has(payload.type)) return template[language]('');

  // Pour les autres, pas de sujet exploitable : mieux vaut ne rien envoyer qu'un
  // SMS à trou, qui inquiéterait sans informer.
  if (!subject) return null;

  return template[language](subject);
}

function formatAmount(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.amountMinor !== 'number') return null;
  const currency =
    typeof metadata.currency === 'string' ? metadata.currency : 'XAF';
  // Convention maison : 100 unités mineures = 1 franc.
  return `${(metadata.amountMinor / 100).toLocaleString('fr-FR')} ${currency}`;
}
