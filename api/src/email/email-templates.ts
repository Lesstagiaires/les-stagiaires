import {
  Language,
  NotificationType,
  AmbassadorDecisionReason,
  PartnershipDecisionReason,
} from '../../generated/prisma/enums';
import type { EmailContent } from './email-layout';
import { partnerSpaceCta } from './partner-space';

// Variables dynamiques disponibles pour un gabarit. Elles proviennent des
// métadonnées structurées de la notification — jamais d'une phrase pré-rédigée
// par un service métier, ce qui est justement la règle qui rend la traduction
// possible.
export interface TemplateVars {
  reference?: string;
  organizationName?: string;
  description?: string;
  proposedAt?: string;
  note?: string;
  amount?: string;
  reason?: string;
  effectiveAt?: string;
  executionReference?: string;
  destinationLabel?: string;

  // --- Partenariats ---------------------------------------------------------
  // `reasonCode` est un code de la liste contrôlée (PartnershipDecisionReason),
  // traduit ici ; `publicMessage` est le message complémentaire déjà relu et validé
  // pour l'organisation. La note interne de l'administrateur n'a volontairement
  // aucune variable : elle n'entre jamais dans un gabarit.
  reasonCode?: string;
  publicMessage?: string;
  // Liste structuree : le serveur envoie les intitules, le gabarit les met en
  // forme. Seule variable non scalaire, d'ou l'elargissement de la signature
  // d'index ci-dessous.
  requestedItems?: string[];
  actionDeadline?: string;
  contradictoryProcedure?: string;
  startDate?: string;
  partnershipType?: string;
  establishmentName?: string;
  role?: string;
  decisionDate?: string;
  effectiveDate?: string;
  requestedAt?: string;
  requestedBy?: string;
  recipient?: string;

  [key: string]: string | string[] | undefined;
}

type Localized = Record<Language, (v: TemplateVars) => EmailContent>;

// Raccourci : la très grande majorité des e-mails partagent la même forme —
// un titre, un paragraphe, un bouton. L'écrire une fois évite cinquante
// répétitions et garantit que tous se ressemblent.
function simple(
  subject: string,
  heading: string,
  body: string,
  cta?: { label: string; path: string },
  footnote?: string,
): EmailContent {
  return { subject, heading, paragraphs: [body], cta, footnote };
}

const REF = (v: TemplateVars) => v.reference ?? '';

// ============================================================================
// PARCOURS DU CANDIDAT
//
// Ces gabarits couvrent la totalité des changements de statut d'une candidature
// vus par le candidat — l'e-mail y est OBLIGATOIRE (décision du promoteur du
// 2026-08-01), au même titre que la notification interne.
// ============================================================================

const APPLICATION_SUBMITTED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Candidature ${REF(v)} bien reçue`,
      'Votre candidature est enregistrée',
      `Nous avons bien reçu votre candidature ${REF(v)}. Vous serez informé à chaque étape de son avancement.`,
      { label: 'Suivre ma candidature', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Application ${REF(v)} received`,
      'Your application has been recorded',
      `We have received your application ${REF(v)}. You will be informed at every stage.`,
      { label: 'Track my application', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Candidatura ${REF(v)} recibida`,
      'Su candidatura ha sido registrada',
      `Hemos recibido su candidatura ${REF(v)}. Le informaremos en cada etapa.`,
      { label: 'Seguir mi candidatura', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `تم استلام الترشح ${REF(v)}`,
      'تم تسجيل ترشحك',
      `استلمنا ترشحك ${REF(v)}. سنعلمك في كل مرحلة من مراحل تقدمه.`,
      { label: 'متابعة ترشحي', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Candidatura ${REF(v)} recebida`,
      'A sua candidatura foi registada',
      `Recebemos a sua candidatura ${REF(v)}. Será informado em cada etapa.`,
      { label: 'Acompanhar a minha candidatura', path: '/applications' },
    ),
};

const DOCUMENT_REQUESTED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Document demandé — candidature ${REF(v)}`,
      'Un document complémentaire vous est demandé',
      `Pour votre candidature ${REF(v)}, il vous est demandé : ${v.description ?? ''}`,
      { label: 'Déposer le document', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Document requested — application ${REF(v)}`,
      'An additional document is required',
      `For your application ${REF(v)}, the following is requested: ${v.description ?? ''}`,
      { label: 'Upload the document', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Documento solicitado — candidatura ${REF(v)}`,
      'Se le solicita un documento adicional',
      `Para su candidatura ${REF(v)}, se solicita: ${v.description ?? ''}`,
      { label: 'Subir el documento', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `مطلوب مستند — الترشح ${REF(v)}`,
      'مطلوب مستند إضافي',
      `بخصوص ترشحك ${REF(v)}، المطلوب: ${v.description ?? ''}`,
      { label: 'إرسال المستند', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Documento solicitado — candidatura ${REF(v)}`,
      'É-lhe pedido um documento adicional',
      `Para a sua candidatura ${REF(v)}, é solicitado: ${v.description ?? ''}`,
      { label: 'Enviar o documento', path: '/applications' },
    ),
};

const INTERVIEW_PROPOSED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Entretien proposé — candidature ${REF(v)}`,
      'Un entretien vous est proposé',
      `Une date d’entretien vous est proposée pour votre candidature ${REF(v)}. Connectez-vous pour la confirmer ou en demander une autre.`,
      { label: 'Confirmer la date', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Interview proposed — application ${REF(v)}`,
      'An interview has been proposed',
      `An interview date has been proposed for your application ${REF(v)}. Log in to confirm it or request another.`,
      { label: 'Confirm the date', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Entrevista propuesta — candidatura ${REF(v)}`,
      'Le proponen una entrevista',
      `Le proponen una fecha de entrevista para su candidatura ${REF(v)}. Conéctese para confirmarla o solicitar otra.`,
      { label: 'Confirmar la fecha', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `مقابلة مقترحة — الترشح ${REF(v)}`,
      'تم اقتراح مقابلة',
      `اقتُرح موعد مقابلة لترشحك ${REF(v)}. سجّل الدخول لتأكيده أو طلب موعد آخر.`,
      { label: 'تأكيد الموعد', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Entrevista proposta — candidatura ${REF(v)}`,
      'Foi-lhe proposta uma entrevista',
      `Foi proposta uma data de entrevista para a sua candidatura ${REF(v)}. Entre para confirmar ou pedir outra.`,
      { label: 'Confirmar a data', path: '/applications' },
    ),
};

const ADMISSION_LETTER: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Bonne nouvelle — candidature ${REF(v)} acceptée`,
      'Votre candidature est acceptée',
      `Vous avez reçu une lettre d’admission pour votre candidature ${REF(v)}. Elle doit être acceptée de votre part pour que le stage soit confirmé.`,
      { label: 'Voir la lettre d’admission', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Good news — application ${REF(v)} accepted`,
      'Your application has been accepted',
      `You have received an admission letter for your application ${REF(v)}. You must accept it for the internship to be confirmed.`,
      { label: 'View the admission letter', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Buenas noticias — candidatura ${REF(v)} aceptada`,
      'Su candidatura ha sido aceptada',
      `Ha recibido una carta de admisión para su candidatura ${REF(v)}. Debe aceptarla para que las prácticas queden confirmadas.`,
      { label: 'Ver la carta de admisión', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `خبر سار — قبول الترشح ${REF(v)}`,
      'تم قبول ترشحك',
      `وصلتك رسالة قبول بخصوص ترشحك ${REF(v)}. يجب أن تقبلها ليُثبَّت التدريب.`,
      { label: 'عرض رسالة القبول', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Boa notícia — candidatura ${REF(v)} aceite`,
      'A sua candidatura foi aceite',
      `Recebeu uma carta de admissão para a sua candidatura ${REF(v)}. Tem de a aceitar para que o estágio seja confirmado.`,
      { label: 'Ver a carta de admissão', path: '/applications' },
    ),
};

const APPLICATION_REJECTED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Candidature ${REF(v)} — réponse`,
      'Votre candidature n’a pas été retenue',
      `Votre candidature ${REF(v)} n’a pas été retenue cette fois. D’autres offres correspondant à votre profil restent disponibles.`,
      { label: 'Voir d’autres offres', path: '/opportunities' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Application ${REF(v)} — outcome`,
      'Your application was not selected',
      `Your application ${REF(v)} was not selected this time. Other opportunities matching your profile remain available.`,
      { label: 'Browse other opportunities', path: '/opportunities' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Candidatura ${REF(v)} — respuesta`,
      'Su candidatura no ha sido seleccionada',
      `Su candidatura ${REF(v)} no ha sido seleccionada esta vez. Siguen disponibles otras ofertas que coinciden con su perfil.`,
      { label: 'Ver otras ofertas', path: '/opportunities' },
    ),
  [Language.AR]: (v) =>
    simple(
      `الترشح ${REF(v)} — الرد`,
      'لم يُقبل ترشحك',
      `لم يُقبل ترشحك ${REF(v)} هذه المرة. ما زالت هناك عروض أخرى تناسب ملفك.`,
      { label: 'استعراض عروض أخرى', path: '/opportunities' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Candidatura ${REF(v)} — resposta`,
      'A sua candidatura não foi selecionada',
      `A sua candidatura ${REF(v)} não foi selecionada desta vez. Continuam disponíveis outras ofertas adequadas ao seu perfil.`,
      { label: 'Ver outras ofertas', path: '/opportunities' },
    ),
};

const PENDING_TRAVEL_CONSENT: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Candidature ${REF(v)} — accord parental attendu`,
      'Votre candidature est acceptée, sous réserve',
      `Votre candidature ${REF(v)} est acceptée. Le stage nécessitant un déplacement, l’accord de votre parent ou tuteur est requis. Un code lui a été envoyé par SMS.`,
      undefined,
      'Cette étape protège les candidats mineurs et ne peut pas être contournée.',
    ),
  [Language.EN]: (v) =>
    simple(
      `Application ${REF(v)} — parental consent needed`,
      'Your application is accepted, pending consent',
      `Your application ${REF(v)} has been accepted. As the internship requires travel, your parent or guardian must consent. A code has been sent to them by SMS.`,
      undefined,
      'This step protects underage candidates and cannot be bypassed.',
    ),
  [Language.ES]: (v) =>
    simple(
      `Candidatura ${REF(v)} — falta el consentimiento parental`,
      'Su candidatura ha sido aceptada, con reserva',
      `Su candidatura ${REF(v)} ha sido aceptada. Como las prácticas requieren desplazamiento, se necesita el consentimiento de su padre, madre o tutor. Se le ha enviado un código por SMS.`,
      undefined,
      'Esta etapa protege a los candidatos menores de edad y no puede omitirse.',
    ),
  [Language.AR]: (v) =>
    simple(
      `الترشح ${REF(v)} — بانتظار موافقة الولي`,
      'تم قبول ترشحك بشرط',
      `تم قبول ترشحك ${REF(v)}. وبما أن التدريب يقتضي التنقل، فموافقة والدك أو وليك مطلوبة. أُرسل إليه رمز عبر رسالة نصية.`,
      undefined,
      'هذه الخطوة تحمي المترشحين القاصرين ولا يمكن تجاوزها.',
    ),
  [Language.PT]: (v) =>
    simple(
      `Candidatura ${REF(v)} — falta consentimento parental`,
      'A sua candidatura foi aceite, sob reserva',
      `A sua candidatura ${REF(v)} foi aceite. Como o estágio exige deslocação, é necessário o consentimento do seu progenitor ou tutor. Foi-lhe enviado um código por SMS.`,
      undefined,
      'Esta etapa protege os candidatos menores e não pode ser contornada.',
    ),
};

const TRAVEL_CONSENT_CONFIRMED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Candidature ${REF(v)} confirmée`,
      'L’accord parental est confirmé',
      `L’accord de votre parent ou tuteur pour le déplacement est enregistré. Votre candidature ${REF(v)} est désormais acceptée.`,
      { label: 'Voir ma candidature', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Application ${REF(v)} confirmed`,
      'Parental consent confirmed',
      `Your parent or guardian's consent for travel has been recorded. Your application ${REF(v)} is now accepted.`,
      { label: 'View my application', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Candidatura ${REF(v)} confirmada`,
      'Consentimiento parental confirmado',
      `Se ha registrado el consentimiento de su padre, madre o tutor para el desplazamiento. Su candidatura ${REF(v)} ya está aceptada.`,
      { label: 'Ver mi candidatura', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `تأكيد الترشح ${REF(v)}`,
      'تم تأكيد موافقة الولي',
      `سُجّلت موافقة والدك أو وليك على التنقل. ترشحك ${REF(v)} مقبول الآن.`,
      { label: 'عرض ترشحي', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Candidatura ${REF(v)} confirmada`,
      'Consentimento parental confirmado',
      `O consentimento do seu progenitor ou tutor para a deslocação foi registado. A sua candidatura ${REF(v)} está agora aceite.`,
      { label: 'Ver a minha candidatura', path: '/applications' },
    ),
};

const TRAVEL_CONSENT_EXPIRED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Candidature ${REF(v)} bloquée`,
      'L’accord parental n’a pas été confirmé à temps',
      `Votre candidature ${REF(v)} reste bloquée : l’accord de votre parent ou tuteur pour le déplacement n’a pas été confirmé dans le délai. Vous pouvez redemander le consentement ou retirer la candidature.`,
      { label: 'Voir ma candidature', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Application ${REF(v)} on hold`,
      'Parental consent was not confirmed in time',
      `Your application ${REF(v)} is on hold: your parent or guardian's travel consent was not confirmed within the deadline. You can request it again or withdraw the application.`,
      { label: 'View my application', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Candidatura ${REF(v)} bloqueada`,
      'El consentimiento parental no se confirmó a tiempo',
      `Su candidatura ${REF(v)} está bloqueada: el consentimiento de su padre, madre o tutor no se confirmó dentro del plazo. Puede volver a solicitarlo o retirar la candidatura.`,
      { label: 'Ver mi candidatura', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `الترشح ${REF(v)} معلّق`,
      'لم تُؤكَّد موافقة الولي في الوقت المحدد',
      `ترشحك ${REF(v)} معلّق: لم تُؤكَّد موافقة والدك أو وليك على التنقل في الأجل المحدد. يمكنك طلبها من جديد أو سحب الترشح.`,
      { label: 'عرض ترشحي', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Candidatura ${REF(v)} bloqueada`,
      'O consentimento parental não foi confirmado a tempo',
      `A sua candidatura ${REF(v)} está bloqueada: o consentimento do seu progenitor ou tutor para a deslocação não foi confirmado no prazo. Pode voltar a pedi-lo ou retirar a candidatura.`,
      { label: 'Ver a minha candidatura', path: '/applications' },
    ),
};

const AGREEMENT_SIGNED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Convention signée — candidature ${REF(v)}`,
      'Votre convention est signée',
      `La convention de la candidature ${REF(v)} est signée par les deux parties. Votre stage peut démarrer.`,
      { label: 'Voir la convention', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Agreement signed — application ${REF(v)}`,
      'Your agreement is signed',
      `The agreement for application ${REF(v)} has been signed by both parties. Your internship can begin.`,
      { label: 'View the agreement', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Convenio firmado — candidatura ${REF(v)}`,
      'Su convenio está firmado',
      `El convenio de la candidatura ${REF(v)} ha sido firmado por ambas partes. Sus prácticas pueden comenzar.`,
      { label: 'Ver el convenio', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `توقيع الاتفاقية — الترشح ${REF(v)}`,
      'تم توقيع اتفاقيتك',
      `وقّع الطرفان اتفاقية الترشح ${REF(v)}. يمكن أن يبدأ تدريبك.`,
      { label: 'عرض الاتفاقية', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Acordo assinado — candidatura ${REF(v)}`,
      'O seu acordo está assinado',
      `O acordo da candidatura ${REF(v)} foi assinado por ambas as partes. O seu estágio pode começar.`,
      { label: 'Ver o acordo', path: '/applications' },
    ),
};

const ESTABLISHMENT_SIGNED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Établissement signataire — candidature ${REF(v)}`,
      'Votre établissement a signé la convention',
      `Votre établissement a signé la convention de la candidature ${REF(v)}.`,
      { label: 'Voir la convention', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `School signed — application ${REF(v)}`,
      'Your school has signed the agreement',
      `Your school has signed the agreement for application ${REF(v)}.`,
      { label: 'View the agreement', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Centro firmante — candidatura ${REF(v)}`,
      'Su centro ha firmado el convenio',
      `Su centro educativo ha firmado el convenio de la candidatura ${REF(v)}.`,
      { label: 'Ver el convenio', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `توقيع المؤسسة — الترشح ${REF(v)}`,
      'وقّعت مؤسستك الاتفاقية',
      `وقّعت مؤسستك التعليمية اتفاقية الترشح ${REF(v)}.`,
      { label: 'عرض الاتفاقية', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Instituição assinou — candidatura ${REF(v)}`,
      'A sua instituição assinou o acordo',
      `A sua instituição de ensino assinou o acordo da candidatura ${REF(v)}.`,
      { label: 'Ver o acordo', path: '/applications' },
    ),
};

const INTERNSHIP_STARTING: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Votre stage commence bientôt — ${REF(v)}`,
      'Votre stage approche',
      `Votre stage (candidature ${REF(v)}) commence bientôt. Retrouvez le lieu, les dates et les modalités dans l’application.`,
      { label: 'Voir les modalités', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Your internship starts soon — ${REF(v)}`,
      'Your internship is approaching',
      `Your internship (application ${REF(v)}) starts soon. Find the location, dates and details in the app.`,
      { label: 'View the details', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Sus prácticas comienzan pronto — ${REF(v)}`,
      'Sus prácticas se acercan',
      `Sus prácticas (candidatura ${REF(v)}) comienzan pronto. Consulte el lugar, las fechas y los detalles en la aplicación.`,
      { label: 'Ver los detalles', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    simple(
      `تدريبك يبدأ قريبا — ${REF(v)}`,
      'اقترب موعد تدريبك',
      `تدريبك (الترشح ${REF(v)}) يبدأ قريبا. تجد المكان والتواريخ والتفاصيل في التطبيق.`,
      { label: 'عرض التفاصيل', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    simple(
      `O seu estágio começa em breve — ${REF(v)}`,
      'O seu estágio aproxima-se',
      `O seu estágio (candidatura ${REF(v)}) começa em breve. Consulte o local, as datas e os detalhes na aplicação.`,
      { label: 'Ver os detalhes', path: '/applications' },
    ),
};

const APPLICATION_CLOSED: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Stage clôturé — candidature ${REF(v)}`,
      'Votre stage est clôturé',
      `Votre stage (candidature ${REF(v)}) est clôturé. Votre attestation est disponible dans votre coffre-fort numérique.`,
      { label: 'Voir mon attestation', path: '/digital-safe' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Internship completed — application ${REF(v)}`,
      'Your internship is complete',
      `Your internship (application ${REF(v)}) is complete. Your certificate is available in your digital safe.`,
      { label: 'View my certificate', path: '/digital-safe' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Prácticas finalizadas — candidatura ${REF(v)}`,
      'Sus prácticas han finalizado',
      `Sus prácticas (candidatura ${REF(v)}) han finalizado. Su certificado está disponible en su caja fuerte digital.`,
      { label: 'Ver mi certificado', path: '/digital-safe' },
    ),
  [Language.AR]: (v) =>
    simple(
      `انتهاء التدريب — الترشح ${REF(v)}`,
      'انتهى تدريبك',
      `انتهى تدريبك (الترشح ${REF(v)}). شهادتك متاحة في خزنتك الرقمية.`,
      { label: 'عرض شهادتي', path: '/digital-safe' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Estágio concluído — candidatura ${REF(v)}`,
      'O seu estágio está concluído',
      `O seu estágio (candidatura ${REF(v)}) está concluído. O seu certificado está disponível no seu cofre digital.`,
      { label: 'Ver o meu certificado', path: '/digital-safe' },
    ),
};

const RECOMMENDATION_RECEIVED: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Vous avez reçu une recommandation',
      'Une recommandation a été ajoutée à votre profil',
      `${v.organizationName ?? 'Une organisation'} vous a laissé une recommandation à l’issue de votre stage (candidature ${REF(v)}).`,
      { label: 'Voir ma recommandation', path: '/profile' },
    ),
  [Language.EN]: (v) =>
    simple(
      'You received a recommendation',
      'A recommendation was added to your profile',
      `${v.organizationName ?? 'An organisation'} left you a recommendation after your internship (application ${REF(v)}).`,
      { label: 'View my recommendation', path: '/profile' },
    ),
  [Language.ES]: (v) =>
    simple(
      'Ha recibido una recomendación',
      'Se ha añadido una recomendación a su perfil',
      `${v.organizationName ?? 'Una organización'} le ha dejado una recomendación tras sus prácticas (candidatura ${REF(v)}).`,
      { label: 'Ver mi recomendación', path: '/profile' },
    ),
  [Language.AR]: (v) =>
    simple(
      'وصلتك توصية',
      'أُضيفت توصية إلى ملفك',
      `تركت لك ${v.organizationName ?? 'إحدى المؤسسات'} توصية بعد تدريبك (الترشح ${REF(v)}).`,
      { label: 'عرض توصيتي', path: '/profile' },
    ),
  [Language.PT]: (v) =>
    simple(
      'Recebeu uma recomendação',
      'Foi adicionada uma recomendação ao seu perfil',
      `${v.organizationName ?? 'Uma organização'} deixou-lhe uma recomendação após o seu estágio (candidatura ${REF(v)}).`,
      { label: 'Ver a minha recomendação', path: '/profile' },
    ),
};

// ============================================================================
// MASQUAGE DES DONNÉES SENSIBLES
//
// Exigence du promoteur du 2026-08-01 : « Les données sensibles ne doivent jamais
// apparaître intégralement dans l'e-mail. Les coordonnées bancaires ou de
// paiement doivent être masquées. »
//
// Un e-mail traverse des serveurs qu'on ne maîtrise pas, reste des années dans
// une boîte, et s'affiche sur un écran qu'un tiers peut regarder. Un numéro
// Mobile Money complet n'y a pas sa place — quatre chiffres suffisent à ce que
// son propriétaire le reconnaisse, et ne suffisent à personne d'autre.
// ============================================================================
function maskDestination(value?: string): string {
  if (!value) return '—';
  // Ne conserve que les quatre derniers caractères de chaque suite de chiffres
  // longue, en laissant intact le libellé lisible (« MTN MoMo — Awa N. »).
  return value.replace(/\d{5,}/g, (digits) => `••••${digits.slice(-4)}`);
}

// MOTIFS COMMUNICABLES À L'AMBASSADEUR — traduits dans les cinq langues.
//
// Le serveur envoie un CODE, jamais une phrase. Auparavant, `dto.reason` — un
// champ libre de 1 000 caractères rempli par un administrateur — était transmis
// tel quel dans la notification de suspension et de résiliation. Une note du type
// « soupçon de fraude, à surveiller » serait partie chez l'intéressé.
//
// La suspicion de fraude n'a volontairement pas de code : elle se dit
// COMPLIANCE_REVIEW — « vérification en cours » — ce qui est vrai, suffisant, et
// ne préjuge de rien.
const AMBASSADOR_REASON_LABELS: Record<
  Language,
  Record<AmbassadorDecisionReason, string>
> = {
  [Language.FR]: {
    INCOMPLETE_FILE: 'dossier incomplet',
    IDENTITY_NOT_VERIFIED: 'identité non vérifiée',
    DOCUMENTS_EXPIRED: 'pièces justificatives expirées',
    INELIGIBLE_PROFILE: 'profil ne répondant pas aux conditions du programme',
    DUPLICATE_APPLICATION: 'candidature faisant double emploi',
    CONTRACT_BREACH: 'manquement aux engagements contractuels',
    CONDUCT_REVIEW: 'examen des conditions d’exercice en cours',
    COMPLIANCE_REVIEW: 'vérification de conformité en cours',
    INACTIVITY: 'absence d’activité constatée sur la période',
    AMBASSADOR_REQUEST: 'à votre demande',
    MUTUAL_AGREEMENT: 'd’un commun accord entre les parties',
    PAYMENT_DETAILS_INVALID: 'coordonnées de paiement incomplètes ou invalides',
    PAYMENT_DETAILS_RECENTLY_CHANGED:
      'coordonnées de paiement modifiées récemment',
    INSUFFICIENT_BALANCE: 'solde disponible insuffisant',
    VERIFICATION_PENDING: 'vérification en cours',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'Le motif de cette décision n’est pas communiqué.',
  },
  [Language.EN]: {
    INCOMPLETE_FILE: 'incomplete file',
    IDENTITY_NOT_VERIFIED: 'identity not verified',
    DOCUMENTS_EXPIRED: 'supporting documents expired',
    INELIGIBLE_PROFILE: 'profile not meeting the programme conditions',
    DUPLICATE_APPLICATION: 'duplicate application',
    CONTRACT_BREACH: 'breach of contractual commitments',
    CONDUCT_REVIEW: 'review of operating conditions in progress',
    COMPLIANCE_REVIEW: 'compliance review in progress',
    INACTIVITY: 'no activity recorded over the period',
    AMBASSADOR_REQUEST: 'at your request',
    MUTUAL_AGREEMENT: 'by mutual agreement between the parties',
    PAYMENT_DETAILS_INVALID: 'payment details incomplete or invalid',
    PAYMENT_DETAILS_RECENTLY_CHANGED: 'payment details changed recently',
    INSUFFICIENT_BALANCE: 'insufficient available balance',
    VERIFICATION_PENDING: 'verification in progress',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'The grounds for this decision are not disclosed.',
  },
  [Language.ES]: {
    INCOMPLETE_FILE: 'expediente incompleto',
    IDENTITY_NOT_VERIFIED: 'identidad no verificada',
    DOCUMENTS_EXPIRED: 'documentos justificativos caducados',
    INELIGIBLE_PROFILE: 'perfil que no reúne las condiciones del programa',
    DUPLICATE_APPLICATION: 'candidatura duplicada',
    CONTRACT_BREACH: 'incumplimiento de los compromisos contractuales',
    CONDUCT_REVIEW: 'examen de las condiciones de ejercicio en curso',
    COMPLIANCE_REVIEW: 'verificación de conformidad en curso',
    INACTIVITY: 'ausencia de actividad durante el periodo',
    AMBASSADOR_REQUEST: 'a petición suya',
    MUTUAL_AGREEMENT: 'de común acuerdo entre las partes',
    PAYMENT_DETAILS_INVALID: 'datos de pago incompletos o no válidos',
    PAYMENT_DETAILS_RECENTLY_CHANGED: 'datos de pago modificados recientemente',
    INSUFFICIENT_BALANCE: 'saldo disponible insuficiente',
    VERIFICATION_PENDING: 'verificación en curso',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'El motivo de esta decisión no se comunica.',
  },
  [Language.AR]: {
    INCOMPLETE_FILE: 'ملف غير مكتمل',
    IDENTITY_NOT_VERIFIED: 'هوية غير مُتحقَّق منها',
    DOCUMENTS_EXPIRED: 'وثائق مؤيدة منتهية الصلاحية',
    INELIGIBLE_PROFILE: 'ملف لا يستوفي شروط البرنامج',
    DUPLICATE_APPLICATION: 'ترشح مكرر',
    CONTRACT_BREACH: 'إخلال بالالتزامات التعاقدية',
    CONDUCT_REVIEW: 'دراسة شروط الممارسة جارية',
    COMPLIANCE_REVIEW: 'مراجعة مطابقة جارية',
    INACTIVITY: 'عدم وجود نشاط خلال الفترة',
    AMBASSADOR_REQUEST: 'بناء على طلبكم',
    MUTUAL_AGREEMENT: 'باتفاق مشترك بين الطرفين',
    PAYMENT_DETAILS_INVALID: 'بيانات الدفع ناقصة أو غير صالحة',
    PAYMENT_DETAILS_RECENTLY_CHANGED: 'تم تعديل بيانات الدفع مؤخرا',
    INSUFFICIENT_BALANCE: 'الرصيد المتاح غير كاف',
    VERIFICATION_PENDING: 'التحقق جار',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'لا يُفصح عن سبب هذا القرار.',
  },
  [Language.PT]: {
    INCOMPLETE_FILE: 'processo incompleto',
    IDENTITY_NOT_VERIFIED: 'identidade não verificada',
    DOCUMENTS_EXPIRED: 'documentos comprovativos caducados',
    INELIGIBLE_PROFILE: 'perfil que não reúne as condições do programa',
    DUPLICATE_APPLICATION: 'candidatura duplicada',
    CONTRACT_BREACH: 'incumprimento dos compromissos contratuais',
    CONDUCT_REVIEW: 'análise das condições de exercício em curso',
    COMPLIANCE_REVIEW: 'verificação de conformidade em curso',
    INACTIVITY: 'ausência de atividade no período',
    AMBASSADOR_REQUEST: 'a seu pedido',
    MUTUAL_AGREEMENT: 'por acordo mútuo entre as partes',
    PAYMENT_DETAILS_INVALID: 'dados de pagamento incompletos ou inválidos',
    PAYMENT_DETAILS_RECENTLY_CHANGED:
      'dados de pagamento alterados recentemente',
    INSUFFICIENT_BALANCE: 'saldo disponível insuficiente',
    VERIFICATION_PENDING: 'verificação em curso',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'O motivo desta decisão não é comunicado.',
  },
};

// Compose la phrase de motif de l'ambassadeur, ou rend une chaîne vide. Un code
// inconnu est IGNORÉ plutôt qu'affiché brut : un identifiant technique dans un
// e-mail vaut moins qu'un silence.
function ambassadorReason(language: Language, v: TemplateVars): string {
  const code = v.reasonCode as AmbassadorDecisionReason | undefined;
  const label = code ? AMBASSADOR_REASON_LABELS[language][code] : undefined;
  const extra = v.publicMessage ? ` ${v.publicMessage}` : '';

  if (!label) return extra;
  if (code === AmbassadorDecisionReason.NOT_DISCLOSED) {
    return ` ${label}${extra}`;
  }
  return ` ${REASON_INTRO[language]} : ${label}.${extra}`;
}

const AMBASSADOR_APPROVED_TPL: Localized = {
  [Language.FR]: () =>
    simple(
      'Bienvenue parmi les ambassadeurs LES STAGIAIRES',
      'Votre candidature est acceptée',
      `Félicitations. Votre dossier a été validé et vous rejoignez le programme d’ambassadeurs. Il reste la signature du contrat et de la charte, puis la formation, avant l’activation de votre code personnel.`,
      { label: 'Voir mon espace ambassadeur', path: '/ambassador' },
    ),
  [Language.EN]: () =>
    simple(
      'Welcome to the LES STAGIAIRES ambassadors',
      'Your application has been accepted',
      'Congratulations. Your file has been approved and you are joining the ambassador programme. The contract and charter signature, then the training, remain before your personal code is activated.',
      { label: 'Open my ambassador space', path: '/ambassador' },
    ),
  [Language.ES]: () =>
    simple(
      'Bienvenido a los embajadores de LES STAGIAIRES',
      'Su candidatura ha sido aceptada',
      'Enhorabuena. Su expediente ha sido aprobado y se incorpora al programa de embajadores. Quedan la firma del contrato y de la carta, y después la formación, antes de activar su código personal.',
      { label: 'Ver mi espacio de embajador', path: '/ambassador' },
    ),
  [Language.AR]: () =>
    simple(
      'مرحبا بك في سفراء LES STAGIAIRES',
      'تم قبول ترشحك',
      'تهانينا. تمت الموافقة على ملفك وأنت تنضم إلى برنامج السفراء. يبقى توقيع العقد والميثاق، ثم التكوين، قبل تفعيل رمزك الشخصي.',
      { label: 'فتح فضاء السفير', path: '/ambassador' },
    ),
  [Language.PT]: () =>
    simple(
      'Bem-vindo aos embaixadores da LES STAGIAIRES',
      'A sua candidatura foi aceite',
      'Parabéns. O seu processo foi aprovado e junta-se ao programa de embaixadores. Faltam a assinatura do contrato e da carta, e depois a formação, antes da ativação do seu código pessoal.',
      { label: 'Ver o meu espaço de embaixador', path: '/ambassador' },
    ),
};

// Ton neutre et factuel, sans accusation : la suspension est réversible, et
// l'e-mail n'est pas le lieu où l'on instruit un dossier.
const AMBASSADOR_SUSPENDED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Votre compte ambassadeur est suspendu',
      'Suspension de votre compte ambassadeur',
      `Votre compte ambassadeur est suspendu à compter de ce jour.${ambassadorReason(Language.FR, v)} Pendant cette période, vous ne pouvez ni parrainer ni percevoir. Vos commissions déjà acquises restent dues.`,
      { label: 'Voir mon espace ambassadeur', path: '/ambassador' },
      'Une suspension est réversible. Pour toute question, contactez l’administration depuis l’application.',
    ),
  [Language.EN]: (v) =>
    simple(
      'Your ambassador account is suspended',
      'Suspension of your ambassador account',
      `Your ambassador account is suspended as of today.${ambassadorReason(Language.EN, v)} During this period you can neither refer nor earn. Commissions already earned remain owed to you.`,
      { label: 'Open my ambassador space', path: '/ambassador' },
      'A suspension is reversible. For any question, contact the administration from the app.',
    ),
  [Language.ES]: (v) =>
    simple(
      'Su cuenta de embajador está suspendida',
      'Suspensión de su cuenta de embajador',
      `Su cuenta de embajador queda suspendida a partir de hoy.${ambassadorReason(Language.ES, v)} Durante este periodo no puede captar ni cobrar. Las comisiones ya adquiridas siguen siendo suyas.`,
      { label: 'Ver mi espacio de embajador', path: '/ambassador' },
      'Una suspensión es reversible. Para cualquier duda, contacte con la administración desde la aplicación.',
    ),
  [Language.AR]: (v) =>
    simple(
      'حساب السفير الخاص بك موقوف',
      'إيقاف حساب السفير',
      `حساب السفير الخاص بك موقوف ابتداء من اليوم.${ambassadorReason(Language.AR, v)} خلال هذه الفترة لا يمكنك الاستقطاب ولا التحصيل. تبقى عمولاتك المكتسبة مستحقة لك.`,
      { label: 'فتح فضاء السفير', path: '/ambassador' },
      'الإيقاف قابل للرجوع. لأي سؤال، اتصل بالإدارة عبر التطبيق.',
    ),
  [Language.PT]: (v) =>
    simple(
      'A sua conta de embaixador está suspensa',
      'Suspensão da sua conta de embaixador',
      `A sua conta de embaixador fica suspensa a partir de hoje.${ambassadorReason(Language.PT, v)} Durante este período não pode angariar nem receber. As comissões já adquiridas continuam a ser-lhe devidas.`,
      { label: 'Ver o meu espaço de embaixador', path: '/ambassador' },
      'Uma suspensão é reversível. Para qualquer questão, contacte a administração pela aplicação.',
    ),
};

// Ton formel : date d'effet et conséquences, explicitement demandés.
const AMBASSADOR_TERMINATED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Fin de votre participation au programme d’ambassadeurs',
      'Résiliation de votre statut d’ambassadeur',
      `Votre participation au programme d’ambassadeurs prend fin${v.effectiveAt ? ` à compter du ${v.effectiveAt}` : ''}.${ambassadorReason(Language.FR, v)} À cette date, votre code d’affiliation cesse d’ouvrir droit à commission et les entreprises de votre portefeuille redeviennent libres. Les commissions acquises avant cette date vous restent dues et vous seront versées selon les modalités habituelles.`,
      { label: 'Consulter mon solde', path: '/ambassador/payouts' },
    ),
  [Language.EN]: (v) =>
    simple(
      'End of your participation in the ambassador programme',
      'Termination of your ambassador status',
      `Your participation in the ambassador programme ends${v.effectiveAt ? ` as of ${v.effectiveAt}` : ''}.${ambassadorReason(Language.EN, v)} From that date, your referral code no longer earns commission and the companies in your portfolio become available again. Commissions earned before that date remain owed to you and will be paid under the usual terms.`,
      { label: 'Check my balance', path: '/ambassador/payouts' },
    ),
  [Language.ES]: (v) =>
    simple(
      'Fin de su participación en el programa de embajadores',
      'Rescisión de su condición de embajador',
      `Su participación en el programa de embajadores finaliza${v.effectiveAt ? ` a partir del ${v.effectiveAt}` : ''}.${ambassadorReason(Language.ES, v)} A partir de esa fecha, su código de referido deja de generar comisión y las empresas de su cartera quedan libres. Las comisiones adquiridas antes de esa fecha siguen siendo suyas y se le pagarán según las condiciones habituales.`,
      { label: 'Consultar mi saldo', path: '/ambassador/payouts' },
    ),
  [Language.AR]: (v) =>
    simple(
      'انتهاء مشاركتك في برنامج السفراء',
      'إنهاء صفة السفير',
      `تنتهي مشاركتك في برنامج السفراء${v.effectiveAt ? ` ابتداء من ${v.effectiveAt}` : ''}.${ambassadorReason(Language.AR, v)} من هذا التاريخ، لم يعد رمزك يمنح الحق في عمولة، وتصبح شركات محفظتك متاحة من جديد. تبقى العمولات المكتسبة قبل هذا التاريخ مستحقة لك وستُصرف وفق الشروط المعتادة.`,
      { label: 'الاطلاع على رصيدي', path: '/ambassador/payouts' },
    ),
  [Language.PT]: (v) =>
    simple(
      'Fim da sua participação no programa de embaixadores',
      'Rescisão do seu estatuto de embaixador',
      `A sua participação no programa de embaixadores termina${v.effectiveAt ? ` a partir de ${v.effectiveAt}` : ''}.${ambassadorReason(Language.PT, v)} A partir dessa data, o seu código deixa de dar direito a comissão e as empresas da sua carteira ficam novamente livres. As comissões adquiridas antes dessa data continuam a ser-lhe devidas e ser-lhe-ão pagas nas condições habituais.`,
      { label: 'Consultar o meu saldo', path: '/ambassador/payouts' },
    ),
};

// Les trois alertes de portefeuille : progressives et pédagogiques. Elles
// expliquent la règle plutôt que de brandir la sanction — l'ambassadeur doit
// comprendre ce qui se joue, pas se sentir menacé.
const PORTFOLIO_9M_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      `${v.organizationName ?? 'Une entreprise'} : neuf mois sans achat`,
      'Un point sur votre portefeuille',
      `${v.organizationName ?? 'Une entreprise de votre portefeuille'} n’a réalisé aucun achat depuis neuf mois. Le rattachement d’une entreprise se renouvelle à chaque achat confirmé ; sans nouvel achat dans les trois prochains mois, celle-ci quittera votre portefeuille. C’est le bon moment pour reprendre contact.`,
      { label: 'Voir mon portefeuille', path: '/ambassador/portfolio' },
    ),
  [Language.EN]: (v) =>
    simple(
      `${v.organizationName ?? 'A company'}: nine months without a purchase`,
      'An update on your portfolio',
      `${v.organizationName ?? 'A company in your portfolio'} has made no purchase for nine months. A company link renews with every confirmed purchase; without a new one within three months, it will leave your portfolio. Now is a good time to get back in touch.`,
      { label: 'View my portfolio', path: '/ambassador/portfolio' },
    ),
  [Language.ES]: (v) =>
    simple(
      `${v.organizationName ?? 'Una empresa'}: nueve meses sin compras`,
      'Un repaso a su cartera',
      `${v.organizationName ?? 'Una empresa de su cartera'} no ha realizado ninguna compra desde hace nueve meses. El vínculo con una empresa se renueva con cada compra confirmada; sin una nueva en los próximos tres meses, saldrá de su cartera. Es buen momento para retomar el contacto.`,
      { label: 'Ver mi cartera', path: '/ambassador/portfolio' },
    ),
  [Language.AR]: (v) =>
    simple(
      `${v.organizationName ?? 'إحدى الشركات'}: تسعة أشهر بلا شراء`,
      'نظرة على محفظتك',
      `${v.organizationName ?? 'إحدى شركات محفظتك'} لم تقم بأي شراء منذ تسعة أشهر. يتجدد ارتباط الشركة مع كل عملية شراء مؤكدة؛ وبدون شراء جديد خلال ثلاثة أشهر ستخرج من محفظتك. هذا وقت مناسب لإعادة التواصل.`,
      { label: 'عرض محفظتي', path: '/ambassador/portfolio' },
    ),
  [Language.PT]: (v) =>
    simple(
      `${v.organizationName ?? 'Uma empresa'}: nove meses sem compras`,
      'Um ponto sobre a sua carteira',
      `${v.organizationName ?? 'Uma empresa da sua carteira'} não fez qualquer compra há nove meses. A ligação a uma empresa renova-se a cada compra confirmada; sem uma nova nos próximos três meses, sairá da sua carteira. É boa altura para retomar o contacto.`,
      { label: 'Ver a minha carteira', path: '/ambassador/portfolio' },
    ),
};

const PORTFOLIO_11M_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      `${v.organizationName ?? 'Une entreprise'} : un mois avant l’échéance`,
      'Il reste un mois',
      `Le rattachement de ${v.organizationName ?? 'cette entreprise'} arrive à échéance dans un mois. Un seul achat confirmé de sa part suffit à repartir pour douze mois.`,
      { label: 'Voir mon portefeuille', path: '/ambassador/portfolio' },
    ),
  [Language.EN]: (v) =>
    simple(
      `${v.organizationName ?? 'A company'}: one month before expiry`,
      'One month remains',
      `The link with ${v.organizationName ?? 'this company'} expires in one month. A single confirmed purchase on their side restarts the twelve-month clock.`,
      { label: 'View my portfolio', path: '/ambassador/portfolio' },
    ),
  [Language.ES]: (v) =>
    simple(
      `${v.organizationName ?? 'Una empresa'}: un mes antes del vencimiento`,
      'Queda un mes',
      `El vínculo con ${v.organizationName ?? 'esta empresa'} vence dentro de un mes. Una sola compra confirmada por su parte reinicia los doce meses.`,
      { label: 'Ver mi cartera', path: '/ambassador/portfolio' },
    ),
  [Language.AR]: (v) =>
    simple(
      `${v.organizationName ?? 'إحدى الشركات'}: شهر قبل الانتهاء`,
      'بقي شهر واحد',
      `ينتهي ارتباط ${v.organizationName ?? 'هذه الشركة'} خلال شهر. عملية شراء مؤكدة واحدة من جانبها تكفي لإعادة العد اثني عشر شهرا.`,
      { label: 'عرض محفظتي', path: '/ambassador/portfolio' },
    ),
  [Language.PT]: (v) =>
    simple(
      `${v.organizationName ?? 'Uma empresa'}: um mês antes do prazo`,
      'Falta um mês',
      `A ligação com ${v.organizationName ?? 'esta empresa'} termina dentro de um mês. Uma única compra confirmada da parte dela reinicia os doze meses.`,
      { label: 'Ver a minha carteira', path: '/ambassador/portfolio' },
    ),
};

const PORTFOLIO_EXPIRED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      `${v.organizationName ?? 'Une entreprise'} a quitté votre portefeuille`,
      'Rattachement arrivé à échéance',
      `Faute d’achat depuis douze mois, ${v.organizationName ?? 'cette entreprise'} n’est plus rattachée à votre portefeuille. Concrètement : si elle achète de nouveau, la commission ne vous reviendra plus. Rien ne vous empêche de la réintéresser — un nouveau rattachement reste possible.`,
      { label: 'Voir mon portefeuille', path: '/ambassador/portfolio' },
      'Vos commissions déjà acquises sur cette entreprise ne sont pas affectées.',
    ),
  [Language.EN]: (v) =>
    simple(
      `${v.organizationName ?? 'A company'} has left your portfolio`,
      'The link has expired',
      `After twelve months without a purchase, ${v.organizationName ?? 'this company'} is no longer linked to your portfolio. In practice: if it buys again, the commission will no longer be yours. Nothing stops you from winning it back — a new link remains possible.`,
      { label: 'View my portfolio', path: '/ambassador/portfolio' },
      'Commissions you already earned on this company are unaffected.',
    ),
  [Language.ES]: (v) =>
    simple(
      `${v.organizationName ?? 'Una empresa'} ha salido de su cartera`,
      'El vínculo ha vencido',
      `Tras doce meses sin compras, ${v.organizationName ?? 'esta empresa'} ya no está vinculada a su cartera. En la práctica: si vuelve a comprar, la comisión ya no será suya. Nada le impide recuperarla — un nuevo vínculo sigue siendo posible.`,
      { label: 'Ver mi cartera', path: '/ambassador/portfolio' },
      'Las comisiones ya adquiridas sobre esta empresa no se ven afectadas.',
    ),
  [Language.AR]: (v) =>
    simple(
      `${v.organizationName ?? 'إحدى الشركات'} خرجت من محفظتك`,
      'انتهى الارتباط',
      `بعد اثني عشر شهرا بلا شراء، لم تعد ${v.organizationName ?? 'هذه الشركة'} مرتبطة بمحفظتك. عمليا: إذا اشترت من جديد، لن تعود العمولة إليك. لا شيء يمنعك من استعادتها — ارتباط جديد يبقى ممكنا.`,
      { label: 'عرض محفظتي', path: '/ambassador/portfolio' },
      'العمولات التي اكتسبتها بالفعل من هذه الشركة لا تتأثر.',
    ),
  [Language.PT]: (v) =>
    simple(
      `${v.organizationName ?? 'Uma empresa'} saiu da sua carteira`,
      'A ligação expirou',
      `Após doze meses sem compras, ${v.organizationName ?? 'esta empresa'} deixou de estar ligada à sua carteira. Na prática: se voltar a comprar, a comissão já não será sua. Nada o impede de a reconquistar — uma nova ligação continua possível.`,
      { label: 'Ver a minha carteira', path: '/ambassador/portfolio' },
      'As comissões já adquiridas sobre esta empresa não são afetadas.',
    ),
};

// --- Versements : confirmation claire, montant, statut, référence -----------

const PAYOUT_VALIDATED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Versement de ${v.amount ?? ''} validé`,
      'Votre demande de versement est validée',
      `Votre demande de versement de ${v.amount ?? ''} a été validée par l’administration. Le virement sera exécuté prochainement ; vous recevrez une confirmation avec sa référence.`,
      { label: 'Suivre mes versements', path: '/ambassador/payouts' },
    ),
  [Language.EN]: (v) =>
    simple(
      `Payout of ${v.amount ?? ''} validated`,
      'Your payout request is approved',
      `Your payout request of ${v.amount ?? ''} has been approved by the administration. The transfer will be made shortly; you will receive a confirmation with its reference.`,
      { label: 'Track my payouts', path: '/ambassador/payouts' },
    ),
  [Language.ES]: (v) =>
    simple(
      `Pago de ${v.amount ?? ''} validado`,
      'Su solicitud de pago está aprobada',
      `Su solicitud de pago de ${v.amount ?? ''} ha sido aprobada por la administración. La transferencia se realizará en breve; recibirá una confirmación con su referencia.`,
      { label: 'Seguir mis pagos', path: '/ambassador/payouts' },
    ),
  [Language.AR]: (v) =>
    simple(
      `اعتماد صرف ${v.amount ?? ''}`,
      'تم اعتماد طلب الصرف',
      `اعتمدت الإدارة طلب صرف ${v.amount ?? ''}. سيُنفَّذ التحويل قريبا، وستصلك رسالة تأكيد تحمل مرجعه.`,
      { label: 'متابعة مدفوعاتي', path: '/ambassador/payouts' },
    ),
  [Language.PT]: (v) =>
    simple(
      `Pagamento de ${v.amount ?? ''} validado`,
      'O seu pedido de pagamento está aprovado',
      `O seu pedido de pagamento de ${v.amount ?? ''} foi aprovado pela administração. A transferência será efetuada em breve; receberá uma confirmação com a respetiva referência.`,
      { label: 'Acompanhar os meus pagamentos', path: '/ambassador/payouts' },
    ),
};

const PAYOUT_EXECUTED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      `Versement de ${v.amount ?? ''} effectué`,
      'Votre versement a été effectué',
      `Le virement de ${v.amount ?? ''} a été exécuté vers ${maskDestination(v.destinationLabel)}.${v.executionReference ? ` Référence : ${v.executionReference}.` : ''} Conservez cette référence : elle permet de retrouver l’opération auprès de votre opérateur.`,
      { label: 'Voir mes versements', path: '/ambassador/payouts' },
      'Si vous ne recevez rien sous quelques jours, signalez-le depuis l’application.',
    ),
  [Language.EN]: (v) =>
    simple(
      `Payout of ${v.amount ?? ''} completed`,
      'Your payout has been sent',
      `The transfer of ${v.amount ?? ''} has been made to ${maskDestination(v.destinationLabel)}.${v.executionReference ? ` Reference: ${v.executionReference}.` : ''} Keep this reference: it lets you trace the operation with your provider.`,
      { label: 'View my payouts', path: '/ambassador/payouts' },
      'If you receive nothing within a few days, report it from the app.',
    ),
  [Language.ES]: (v) =>
    simple(
      `Pago de ${v.amount ?? ''} efectuado`,
      'Su pago ha sido enviado',
      `La transferencia de ${v.amount ?? ''} se ha realizado a ${maskDestination(v.destinationLabel)}.${v.executionReference ? ` Referencia: ${v.executionReference}.` : ''} Conserve esta referencia: permite localizar la operación con su operador.`,
      { label: 'Ver mis pagos', path: '/ambassador/payouts' },
      'Si no recibe nada en unos días, notifíquelo desde la aplicación.',
    ),
  [Language.AR]: (v) =>
    simple(
      `تنفيذ صرف ${v.amount ?? ''}`,
      'تم تنفيذ دفعتك',
      `نُفِّذ تحويل ${v.amount ?? ''} إلى ${maskDestination(v.destinationLabel)}.${v.executionReference ? ` المرجع: ${v.executionReference}.` : ''} احتفظ بهذا المرجع: يتيح لك تتبع العملية لدى مشغّلك.`,
      { label: 'عرض مدفوعاتي', path: '/ambassador/payouts' },
      'إن لم تصلك خلال أيام، أبلغنا عبر التطبيق.',
    ),
  [Language.PT]: (v) =>
    simple(
      `Pagamento de ${v.amount ?? ''} efetuado`,
      'O seu pagamento foi enviado',
      `A transferência de ${v.amount ?? ''} foi efetuada para ${maskDestination(v.destinationLabel)}.${v.executionReference ? ` Referência: ${v.executionReference}.` : ''} Guarde esta referência: permite localizar a operação junto do seu operador.`,
      { label: 'Ver os meus pagamentos', path: '/ambassador/payouts' },
      'Se não receber nada dentro de alguns dias, comunique-o pela aplicação.',
    ),
};

const PAYOUT_REJECTED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Votre demande de versement n’a pas été retenue',
      'Demande de versement refusée',
      `Votre demande de versement n’a pas pu être traitée.${ambassadorReason(Language.FR, v)} Votre solde n’est pas affecté : les montants concernés restent disponibles et vous pouvez déposer une nouvelle demande.`,
      { label: 'Déposer une nouvelle demande', path: '/ambassador/payouts' },
    ),
  [Language.EN]: (v) =>
    simple(
      'Your payout request was not approved',
      'Payout request declined',
      `Your payout request could not be processed.${ambassadorReason(Language.EN, v)} Your balance is unaffected: the amounts remain available and you can submit a new request.`,
      { label: 'Submit a new request', path: '/ambassador/payouts' },
    ),
  [Language.ES]: (v) =>
    simple(
      'Su solicitud de pago no ha sido aprobada',
      'Solicitud de pago rechazada',
      `No se ha podido tramitar su solicitud de pago.${ambassadorReason(Language.ES, v)} Su saldo no se ve afectado: los importes siguen disponibles y puede presentar una nueva solicitud.`,
      { label: 'Presentar una nueva solicitud', path: '/ambassador/payouts' },
    ),
  [Language.AR]: (v) =>
    simple(
      'لم يُقبل طلب الصرف',
      'رُفض طلب الصرف',
      `تعذّرت معالجة طلب الصرف الخاص بك.${ambassadorReason(Language.AR, v)} رصيدك لم يتأثر: المبالغ ما زالت متاحة ويمكنك تقديم طلب جديد.`,
      { label: 'تقديم طلب جديد', path: '/ambassador/payouts' },
    ),
  [Language.PT]: (v) =>
    simple(
      'O seu pedido de pagamento não foi aprovado',
      'Pedido de pagamento recusado',
      `Não foi possível processar o seu pedido de pagamento.${ambassadorReason(Language.PT, v)} O seu saldo não é afetado: os montantes continuam disponíveis e pode apresentar um novo pedido.`,
      { label: 'Apresentar um novo pedido', path: '/ambassador/payouts' },
    ),
};

// ALERTE DE SÉCURITÉ — coordonnées de versement modifiées.
//
// Ce message n'annonce pas une bonne nouvelle : il est écrit pour être lu par
// quelqu'un qui n'a rien demandé. D'où l'ordre des informations — le fait, puis
// le délai qui protège, puis l'action à mener — et le bouton qui mène au
// signalement plutôt qu'aux coordonnées.
//
// La destination y figure MASQUÉE : assez pour reconnaître son propre compte,
// pas assez pour en apprendre un autre. Un e-mail se transfère, se retrouve dans
// une boîte compromise, s'imprime.
// Les variables de gabarit sont typées `string | string[]`. Celles-ci sont
// toujours scalaires, mais on les normalise plutôt que de le supposer : une
// alerte de sécurité qui afficherait « [object Object] » serait pire que pas
// d'alerte du tout.
const scalaire = (
  valeur: string | string[] | undefined,
  defaut = '',
): string => (Array.isArray(valeur) ? valeur.join(', ') : (valeur ?? defaut));

const PAYMENT_DETAILS_CHANGED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Vos coordonnées de versement ont été modifiées',
      'Modification de vos coordonnées de versement',
      `Vos coordonnées de versement ont été modifiées${v.destinationMasked ? ` vers ${scalaire(v.destinationMasked)}` : ''}. Par sécurité, aucun virement ne sera exécuté pendant ${scalaire(v.cooldownHours, '72')} heures. Si vous n’êtes pas à l’origine de ce changement, signalez-le sans attendre : les versements resteront bloqués le temps de l’instruction.`,
      {
        label: 'Signaler une modification non autorisée',
        path: '/ambassador/payment-details',
      },
    ),
  [Language.EN]: (v) =>
    simple(
      'Your payout details have been changed',
      'Change to your payout details',
      `Your payout details have been changed${v.destinationMasked ? ` to ${scalaire(v.destinationMasked)}` : ''}. As a precaution, no transfer will be made for ${scalaire(v.cooldownHours, '72')} hours. If you did not make this change, report it without delay: payouts will stay blocked while it is investigated.`,
      {
        label: 'Report an unauthorised change',
        path: '/ambassador/payment-details',
      },
    ),
  [Language.ES]: (v) =>
    simple(
      'Sus datos de pago han sido modificados',
      'Modificación de sus datos de pago',
      `Sus datos de pago han sido modificados${v.destinationMasked ? ` a ${scalaire(v.destinationMasked)}` : ''}. Por seguridad, no se efectuará ninguna transferencia durante ${scalaire(v.cooldownHours, '72')} horas. Si no ha sido usted, notifíquelo sin demora: los pagos seguirán bloqueados mientras se instruye el caso.`,
      {
        label: 'Notificar una modificación no autorizada',
        path: '/ambassador/payment-details',
      },
    ),
  [Language.AR]: (v) =>
    simple(
      'تم تغيير بيانات الصرف الخاصة بك',
      'تغيير في بيانات الصرف',
      `تم تغيير بيانات الصرف الخاصة بك${v.destinationMasked ? ` إلى ${scalaire(v.destinationMasked)}` : ''}. لدواعٍ أمنية، لن تُنفَّذ أي حوالة خلال ${scalaire(v.cooldownHours, '72')} ساعة. إن لم تكن أنت من أجرى هذا التغيير، فأبلغ دون تأخير: تبقى الحوالات موقوفة إلى حين انتهاء الفحص.`,
      {
        label: 'الإبلاغ عن تغيير غير مصرَّح به',
        path: '/ambassador/payment-details',
      },
    ),
  [Language.PT]: (v) =>
    simple(
      'Os seus dados de pagamento foram alterados',
      'Alteração dos seus dados de pagamento',
      `Os seus dados de pagamento foram alterados${v.destinationMasked ? ` para ${scalaire(v.destinationMasked)}` : ''}. Por segurança, nenhuma transferência será efetuada durante ${scalaire(v.cooldownHours, '72')} horas. Se não foi você, comunique-o sem demora: os pagamentos ficarão bloqueados enquanto o caso é analisado.`,
      {
        label: 'Comunicar uma alteração não autorizada',
        path: '/ambassador/payment-details',
      },
    ),
};

// ÉCHEC D'UN VIREMENT DÉJÀ ORDONNÉ — à distinguer soigneusement du refus
// ci-dessus. Là, une demande n'a pas été retenue ; ici, elle l'avait été, un
// virement est parti et n'est jamais arrivé.
//
// Deux choses doivent être dites, et rien d'autre : l'argent n'est pas perdu, et
// il n'y a pas besoin d'attendre pour en redemander le versement. La référence de
// l'opération n'y figure pas — une référence qui ne correspond à aucun mouvement
// n'aiderait personne à retrouver quoi que ce soit et inviterait à des recherches
// vaines auprès de l'opérateur.
const PAYOUT_FAILED_TPL: Localized = {
  [Language.FR]: (v) =>
    simple(
      'Votre virement n’a pas abouti',
      'Virement non abouti',
      `Le virement de ${v.amount ?? ''} n’a pas pu être effectué.${ambassadorReason(Language.FR, v)} La somme est revenue à votre solde disponible : elle vous reste due, et vous pouvez déposer une nouvelle demande dès à présent.`,
      { label: 'Déposer une nouvelle demande', path: '/ambassador/payouts' },
    ),
  [Language.EN]: (v) =>
    simple(
      'Your transfer did not go through',
      'Transfer not completed',
      `The transfer of ${v.amount ?? ''} could not be completed.${ambassadorReason(Language.EN, v)} The amount has returned to your available balance: it remains owed to you, and you can submit a new request right away.`,
      { label: 'Submit a new request', path: '/ambassador/payouts' },
    ),
  [Language.ES]: (v) =>
    simple(
      'Su transferencia no se ha realizado',
      'Transferencia no realizada',
      `No se ha podido efectuar la transferencia de ${v.amount ?? ''}.${ambassadorReason(Language.ES, v)} El importe ha vuelto a su saldo disponible: sigue siéndole debido y puede presentar una nueva solicitud desde ahora.`,
      { label: 'Presentar una nueva solicitud', path: '/ambassador/payouts' },
    ),
  [Language.AR]: (v) =>
    simple(
      'لم تُنفَّذ حوالتك',
      'حوالة غير منفَّذة',
      `تعذَّر تنفيذ حوالة ${v.amount ?? ''}.${ambassadorReason(Language.AR, v)} عاد المبلغ إلى رصيدك المتاح: فهو لا يزال مستحقًّا لك، ويمكنك تقديم طلب جديد من الآن.`,
      { label: 'تقديم طلب جديد', path: '/ambassador/payouts' },
    ),
  [Language.PT]: (v) =>
    simple(
      'A sua transferência não foi concluída',
      'Transferência não concluída',
      `Não foi possível efetuar a transferência de ${v.amount ?? ''}.${ambassadorReason(Language.PT, v)} O montante voltou ao seu saldo disponível: continua a ser-lhe devido e pode apresentar um novo pedido desde já.`,
      { label: 'Apresentar um novo pedido', path: '/ambassador/payouts' },
    ),
};

// ============================================================================
// PARTENARIATS — REGISTRE INSTITUTIONNEL
//
// Consigne du promoteur du 2026-08-02 : « Un partenariat engage l'image, la
// réputation et parfois les engagements contractuels d'une organisation. »
// Le registre est donc distinct de celui des ambassadeurs : là où l'on s'adresse
// à une personne, on peut être chaleureux ; ici on écrit à une institution, et le
// message doit rester sobre, précis et juridiquement prudent.
//
// Ce que ces gabarits ne font JAMAIS :
//   — porter un jugement sur l'organisation (« votre comportement », « vous avez
//     échoué », « vous ne correspondez pas à nos valeurs ») ; la décision porte
//     sur une demande ou une relation, jamais sur ce que vaut l'organisation ;
//   — recopier une note d'administration : seul le code de motif, traduit
//     ci-dessous, et le message explicitement validé sont diffusés ;
//   — exposer un contrat, un signalement, une pièce d'identité, une coordonnée
//     bancaire ou une observation d'enquête. Le détail sensible reste dans
//     l'espace partenaire, derrière une authentification.
// ============================================================================

// Le bouton vers l'espace partenaire n'apparaît que si cet espace est réellement
// déployé — voir partner-space.ts. Le défaut est fermé : un oubli de configuration
// produit un e-mail sans bouton, jamais un bouton qui ne mène nulle part.

const REASON_LABELS: Record<
  Language,
  Record<PartnershipDecisionReason, string>
> = {
  [Language.FR]: {
    INCOMPLETE_FILE: 'dossier incomplet',
    DOCUMENTS_NOT_VERIFIED: 'pièces justificatives non vérifiées',
    INELIGIBLE_ACTIVITY: 'activité hors du périmètre du programme',
    DUPLICATE_REQUEST: 'demande faisant double emploi avec un dossier existant',
    CONDITIONS_NOT_MET: 'conditions du programme non réunies à ce stade',
    COMPLIANCE_REVIEW: 'vérification de conformité en cours',
    REPORTED_CONTENT: 'signalement en cours d’examen',
    INACTIVITY: 'absence d’activité constatée sur la période',
    ORGANIZATION_REQUEST: 'à la demande de l’organisation',
    MUTUAL_AGREEMENT: 'd’un commun accord entre les parties',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'Le motif de cette décision n’est pas communiqué.',
  },
  [Language.EN]: {
    INCOMPLETE_FILE: 'incomplete file',
    DOCUMENTS_NOT_VERIFIED: 'supporting documents not verified',
    INELIGIBLE_ACTIVITY: 'activity outside the scope of the programme',
    DUPLICATE_REQUEST: 'request duplicating an existing file',
    CONDITIONS_NOT_MET: 'programme conditions not met at this stage',
    COMPLIANCE_REVIEW: 'compliance review in progress',
    REPORTED_CONTENT: 'report under examination',
    INACTIVITY: 'no activity recorded over the period',
    ORGANIZATION_REQUEST: 'at the organisation’s request',
    MUTUAL_AGREEMENT: 'by mutual agreement between the parties',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'The grounds for this decision are not disclosed.',
  },
  [Language.ES]: {
    INCOMPLETE_FILE: 'expediente incompleto',
    DOCUMENTS_NOT_VERIFIED: 'documentos justificativos no verificados',
    INELIGIBLE_ACTIVITY: 'actividad fuera del ámbito del programa',
    DUPLICATE_REQUEST: 'solicitud que duplica un expediente existente',
    CONDITIONS_NOT_MET: 'condiciones del programa no reunidas en esta fase',
    COMPLIANCE_REVIEW: 'verificación de conformidad en curso',
    REPORTED_CONTENT: 'denuncia en curso de examen',
    INACTIVITY: 'ausencia de actividad durante el periodo',
    ORGANIZATION_REQUEST: 'a petición de la organización',
    MUTUAL_AGREEMENT: 'de común acuerdo entre las partes',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'El motivo de esta decisión no se comunica.',
  },
  [Language.AR]: {
    INCOMPLETE_FILE: 'ملف غير مكتمل',
    DOCUMENTS_NOT_VERIFIED: 'وثائق مؤيدة غير مُتحقَّق منها',
    INELIGIBLE_ACTIVITY: 'نشاط خارج نطاق البرنامج',
    DUPLICATE_REQUEST: 'طلب مكرر لملف قائم',
    CONDITIONS_NOT_MET: 'شروط البرنامج غير مستوفاة في هذه المرحلة',
    COMPLIANCE_REVIEW: 'مراجعة مطابقة جارية',
    REPORTED_CONTENT: 'بلاغ قيد الفحص',
    INACTIVITY: 'عدم وجود نشاط خلال الفترة',
    ORGANIZATION_REQUEST: 'بناء على طلب المؤسسة',
    MUTUAL_AGREEMENT: 'باتفاق مشترك بين الطرفين',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'لا يُفصح عن سبب هذا القرار.',
  },
  [Language.PT]: {
    INCOMPLETE_FILE: 'processo incompleto',
    DOCUMENTS_NOT_VERIFIED: 'documentos comprovativos não verificados',
    INELIGIBLE_ACTIVITY: 'atividade fora do âmbito do programa',
    DUPLICATE_REQUEST: 'pedido que duplica um processo existente',
    CONDITIONS_NOT_MET: 'condições do programa não reunidas nesta fase',
    COMPLIANCE_REVIEW: 'verificação de conformidade em curso',
    REPORTED_CONTENT: 'denúncia em fase de análise',
    INACTIVITY: 'ausência de atividade no período',
    ORGANIZATION_REQUEST: 'a pedido da organização',
    MUTUAL_AGREEMENT: 'por acordo mútuo entre as partes',
    NO_PUBLIC_REASON: '',
    NOT_DISCLOSED: 'O motivo desta decisão não é comunicado.',
  },
};

const REASON_INTRO: Record<Language, string> = {
  [Language.FR]: 'Motif communiqué',
  [Language.EN]: 'Reason given',
  [Language.ES]: 'Motivo comunicado',
  [Language.AR]: 'السبب المبلَّغ',
  [Language.PT]: 'Motivo comunicado',
};

// Compose la phrase de motif — ou rend une chaîne vide, ce qui fait simplement
// disparaître le paragraphe. Une valeur inconnue est ignorée plutôt qu'affichée
// brute : un code technique dans un e-mail institutionnel serait pire qu'un
// silence.
function reasonSentence(language: Language, v: TemplateVars): string {
  const code = v.reasonCode as PartnershipDecisionReason | undefined;
  const label = code ? REASON_LABELS[language][code] : undefined;
  const extra = v.publicMessage ? ` ${v.publicMessage}` : '';

  // NO_PUBLIC_REASON — libellé vide, donc la ligne de motif disparaît
  // entièrement. C'est le cas ORDINAIRE. Le promoteur a explicitement refusé que
  // « le motif de cette décision n'est pas communiqué » s'affiche automatiquement
  // partout : cette phrase est un choix délibéré, pas un remplissage par défaut.
  if (!label) return extra.trim();
  // NOT_DISCLOSED est déjà une phrase complète : elle dit franchement qu'aucun
  // motif ne sera donné, plutôt que de laisser un blanc à interpréter.
  if (code === PartnershipDecisionReason.NOT_DISCLOSED) {
    return `${label}${extra}`;
  }
  return `${REASON_INTRO[language]} : ${label}.${extra}`;
}

// Variante de `simple()` pour les messages à plusieurs paragraphes. Le filtre
// élimine les paragraphes vides : une donnée absente ne laisse pas de trou.
function institutional(
  subject: string,
  heading: string,
  paragraphs: string[],
  cta?: { label: string; path: string },
  footnote?: string,
): EmailContent {
  return {
    subject,
    heading,
    paragraphs: paragraphs.filter((p) => p.trim().length > 0),
    cta,
    footnote,
  };
}

const ORG_FALLBACK: Record<Language, string> = {
  [Language.FR]: 'votre organisation',
  [Language.EN]: 'your organisation',
  [Language.ES]: 'su organización',
  [Language.AR]: 'مؤسستكم',
  [Language.PT]: 'a sua organização',
};

// --- 1. Partenariat accepté ---------------------------------------------------
// Positif et valorisant, sans emphase commerciale. Le pied de page porte la nuance
// juridique exigée : accepter une demande n'est pas signer une convention.
const PARTNERSHIP_APPROVED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Partenariat accepté — ${v.organizationName ?? 'votre organisation'}`,
      'Votre demande de partenariat est acceptée',
      [
        `Nous avons le plaisir de vous informer que la demande de partenariat de ${v.organizationName ?? ORG_FALLBACK.FR} avec LES STAGIAIRES a été acceptée${v.decisionDate ? ` le ${v.decisionDate}` : ''}. Référence du dossier : ${v.reference ?? '—'}.`,
        v.effectiveDate
          ? `La date de prise d’effet retenue est le ${v.effectiveDate}.`
          : '',
        'Les prochaines étapes et, le cas échéant, les documents à compléter ou à signer sont disponibles dans votre espace partenaire.',
      ],
      partnerSpaceCta('Accéder à mon espace partenaire'),
      'L’acceptation administrative de votre demande ne vaut pas signature d’une convention. Les engagements réciproques prennent effet dans les conditions prévues par le contrat conclu entre les parties.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `Partnership approved — ${v.organizationName ?? 'your organisation'}`,
      'Your partnership request has been approved',
      [
        `We are pleased to inform you that the partnership request submitted by ${v.organizationName ?? ORG_FALLBACK.EN} to LES STAGIAIRES has been approved${v.decisionDate ? ` on ${v.decisionDate}` : ''}. File reference: ${v.reference ?? '—'}.`,
        v.effectiveDate ? `The effective date is ${v.effectiveDate}.` : '',
        'The next steps and, where applicable, the documents to complete or sign are available in your partner area.',
      ],
      partnerSpaceCta('Open my partner area'),
      'Administrative approval of your request does not constitute the signature of an agreement. Reciprocal commitments take effect under the terms of the contract concluded between the parties.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `Asociación aceptada — ${v.organizationName ?? 'su organización'}`,
      'Su solicitud de asociación ha sido aceptada',
      [
        `Nos complace informarle de que la solicitud de asociación de ${v.organizationName ?? ORG_FALLBACK.ES} con LES STAGIAIRES ha sido aceptada${v.decisionDate ? ` el ${v.decisionDate}` : ''}. Referencia del expediente: ${v.reference ?? '—'}.`,
        v.effectiveDate
          ? `La fecha de entrada en vigor es el ${v.effectiveDate}.`
          : '',
        'Los siguientes pasos y, en su caso, los documentos que deben completarse o firmarse están disponibles en su espacio de socio.',
      ],
      partnerSpaceCta('Acceder a mi espacio de socio'),
      'La aceptación administrativa de su solicitud no equivale a la firma de un convenio. Los compromisos recíprocos surten efecto en las condiciones previstas por el contrato celebrado entre las partes.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `قبول الشراكة — ${v.organizationName ?? 'مؤسستكم'}`,
      'تم قبول طلب الشراكة',
      [
        `يسرنا إعلامكم بأن طلب الشراكة المقدَّم من ${v.organizationName ?? ORG_FALLBACK.AR} إلى LES STAGIAIRES قد قُبل${v.decisionDate ? ` بتاريخ ${v.decisionDate}` : ''}. مرجع الملف: ${v.reference ?? '—'}.`,
        v.effectiveDate ? `تاريخ بدء السريان هو ${v.effectiveDate}.` : '',
        'الخطوات التالية، وعند الاقتضاء الوثائق الواجب استكمالها أو توقيعها، متاحة في فضاء الشريك الخاص بكم.',
      ],
      partnerSpaceCta('الدخول إلى فضاء الشريك'),
      'قبول الطلب إداريا لا يعادل توقيع اتفاقية. تسري الالتزامات المتبادلة وفق الشروط المنصوص عليها في العقد المبرم بين الطرفين.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `Parceria aceite — ${v.organizationName ?? 'a sua organização'}`,
      'O seu pedido de parceria foi aceite',
      [
        `Temos o prazer de o informar de que o pedido de parceria de ${v.organizationName ?? ORG_FALLBACK.PT} com a LES STAGIAIRES foi aceite${v.decisionDate ? ` em ${v.decisionDate}` : ''}. Referência do processo: ${v.reference ?? '—'}.`,
        v.effectiveDate
          ? `A data de produção de efeitos é ${v.effectiveDate}.`
          : '',
        'Os próximos passos e, se aplicável, os documentos a completar ou assinar estão disponíveis no seu espaço de parceiro.',
      ],
      partnerSpaceCta('Aceder ao meu espaço de parceiro'),
      'A aceitação administrativa do seu pedido não equivale à assinatura de uma convenção. Os compromissos recíprocos produzem efeitos nas condições previstas no contrato celebrado entre as partes.',
    ),
};

// --- 1 bis. Complément requis -------------------------------------------------
// AUCUNE DÉCISION N'EST PRISE. C'est la seule chose que ce gabarit doit réussir à
// faire comprendre : une organisation qui lit « il manque une pièce » et croit son
// dossier rejeté ne reviendra pas. Le mot « refus » n'y figure donc nulle part, et
// la phrase sur l'absence de décision arrive avant le détail de ce qui manque.
//
// Les pièces attendues sont rendues une par paragraphe : une liste écrasée en une
// seule phrase est illisible, et le lecteur doit pouvoir cocher mentalement.
const requestedItemLines = (v: TemplateVars): string[] =>
  (Array.isArray(v.requestedItems) ? v.requestedItems : []).map(
    (item) => `— ${item}`,
  );

const PARTNERSHIP_INFORMATION_REQUIRED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Complément attendu sur votre demande de partenariat — ${v.reference ?? ''}`.trim(),
      'Votre dossier appelle un complément',
      [
        `L’examen de la demande de partenariat de ${v.organizationName ?? ORG_FALLBACK.FR} (référence ${v.reference ?? '—'}) nécessite des éléments complémentaires. Aucune décision n’a été prise à ce stade : votre demande reste ouverte et sera réexaminée dès réception.`,
        requestedItemLines(v).length > 0 ? 'Éléments attendus :' : '',
        ...requestedItemLines(v),
        v.publicMessage ?? '',
        v.actionDeadline
          ? `Nous vous remercions de nous les transmettre avant le ${v.actionDeadline}.`
          : '',
        'Vous pouvez compléter votre dossier depuis votre espace partenaire, sans avoir à déposer une nouvelle demande : votre candidature initiale est conservée.',
      ],
      partnerSpaceCta('Compléter mon dossier'),
    ),
  [Language.EN]: (v) =>
    institutional(
      `Additional information required — ${v.reference ?? ''}`.trim(),
      'Your file requires additional information',
      [
        `The review of the partnership request submitted by ${v.organizationName ?? ORG_FALLBACK.EN} (reference ${v.reference ?? '—'}) requires additional items. No decision has been taken at this stage: your request remains open and will be reviewed again upon receipt.`,
        requestedItemLines(v).length > 0 ? 'Items required:' : '',
        ...requestedItemLines(v),
        v.publicMessage ?? '',
        v.actionDeadline
          ? `We would be grateful to receive them before ${v.actionDeadline}.`
          : '',
        'You can complete your file from your partner area, without having to submit a new request: your initial application is retained.',
      ],
      partnerSpaceCta('Complete my file'),
    ),
  [Language.ES]: (v) =>
    institutional(
      `Documentación complementaria requerida — ${v.reference ?? ''}`.trim(),
      'Su expediente requiere documentación complementaria',
      [
        `El examen de la solicitud de asociación de ${v.organizationName ?? ORG_FALLBACK.ES} (referencia ${v.reference ?? '—'}) requiere elementos complementarios. No se ha tomado ninguna decisión en esta fase: su solicitud sigue abierta y será reexaminada en cuanto los recibamos.`,
        requestedItemLines(v).length > 0 ? 'Elementos requeridos:' : '',
        ...requestedItemLines(v),
        v.publicMessage ?? '',
        v.actionDeadline
          ? `Le agradecemos que nos los remita antes del ${v.actionDeadline}.`
          : '',
        'Puede completar su expediente desde su espacio de socio, sin necesidad de presentar una nueva solicitud: su candidatura inicial se conserva.',
      ],
      partnerSpaceCta('Completar mi expediente'),
    ),
  [Language.AR]: (v) =>
    institutional(
      `عناصر مكمّلة مطلوبة — ${v.reference ?? ''}`.trim(),
      'ملفكم يستدعي عناصر مكمّلة',
      [
        `تتطلب دراسة طلب الشراكة المقدَّم من ${v.organizationName ?? ORG_FALLBACK.AR} (المرجع ${v.reference ?? '—'}) عناصر مكمّلة. لم يُتَّخذ أي قرار في هذه المرحلة: طلبكم يبقى مفتوحا وسيُعاد النظر فيه فور توصلنا بها.`,
        requestedItemLines(v).length > 0 ? 'العناصر المطلوبة:' : '',
        ...requestedItemLines(v),
        v.publicMessage ?? '',
        v.actionDeadline
          ? `نشكركم على موافاتنا بها قبل ${v.actionDeadline}.`
          : '',
        'يمكنكم استكمال ملفكم من فضاء الشريك، دون الحاجة إلى تقديم طلب جديد: ترشحكم الأصلي محفوظ.',
      ],
      partnerSpaceCta('استكمال ملفي'),
    ),
  [Language.PT]: (v) =>
    institutional(
      `Elementos complementares necessários — ${v.reference ?? ''}`.trim(),
      'O seu processo carece de elementos complementares',
      [
        `A análise do pedido de parceria de ${v.organizationName ?? ORG_FALLBACK.PT} (referência ${v.reference ?? '—'}) requer elementos complementares. Nenhuma decisão foi tomada nesta fase: o seu pedido mantém-se aberto e será reapreciado logo que os recebamos.`,
        requestedItemLines(v).length > 0 ? 'Elementos necessários:' : '',
        ...requestedItemLines(v),
        v.publicMessage ?? '',
        v.actionDeadline
          ? `Agradecemos o seu envio antes de ${v.actionDeadline}.`
          : '',
        'Pode completar o seu processo a partir do seu espaço de parceiro, sem ter de apresentar um novo pedido: a sua candidatura inicial é conservada.',
      ],
      partnerSpaceCta('Completar o meu processo'),
    ),
};

// --- 2. Partenariat refusé ----------------------------------------------------
// Le mot « refusé » vit dans le statut ; le corps du message emploie la formule
// institutionnelle demandée. La dernière phrase — « ne constitue pas une
// appréciation générale de votre organisation » — n'est pas une politesse : elle
// préserve une relation qu'une candidature ultérieure pourra reprendre.
const PARTNERSHIP_REFUSED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Suite donnée à votre demande de partenariat — ${v.reference ?? ''}`.trim(),
      'Votre demande de partenariat',
      [
        `Après examen de la demande de partenariat de ${v.organizationName ?? ORG_FALLBACK.FR} (référence ${v.reference ?? '—'}), nous ne sommes pas en mesure d’y donner une suite favorable à ce stade${v.decisionDate ? `. Décision du ${v.decisionDate}` : ''}.`,
        reasonSentence(Language.FR, v),
        'Cette décision concerne la demande soumise et ne constitue pas une appréciation générale de votre organisation. Vous pouvez, le cas échéant, compléter votre dossier et soumettre une nouvelle demande.',
      ],
      partnerSpaceCta('Consulter mon dossier'),
      'Pour toute question relative à cette décision, vous pouvez nous écrire depuis votre espace.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `Outcome of your partnership request — ${v.reference ?? ''}`.trim(),
      'Your partnership request',
      [
        `Having reviewed the partnership request submitted by ${v.organizationName ?? ORG_FALLBACK.EN} (reference ${v.reference ?? '—'}), we are not in a position to approve it at this stage${v.decisionDate ? `. Decision dated ${v.decisionDate}` : ''}.`,
        reasonSentence(Language.EN, v),
        'This decision concerns the request as submitted and does not constitute a general assessment of your organisation. You may, where appropriate, complete your file and submit a new request.',
      ],
      partnerSpaceCta('View my file'),
      'For any question regarding this decision, you may write to us from your area.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `Resolución de su solicitud de asociación — ${v.reference ?? ''}`.trim(),
      'Su solicitud de asociación',
      [
        `Tras examinar la solicitud de asociación de ${v.organizationName ?? ORG_FALLBACK.ES} (referencia ${v.reference ?? '—'}), no estamos en condiciones de darle una respuesta favorable en esta fase${v.decisionDate ? `. Decisión del ${v.decisionDate}` : ''}.`,
        reasonSentence(Language.ES, v),
        'Esta decisión se refiere a la solicitud presentada y no constituye una valoración general de su organización. Puede, en su caso, completar su expediente y presentar una nueva solicitud.',
      ],
      partnerSpaceCta('Consultar mi expediente'),
      'Para cualquier duda relativa a esta decisión, puede escribirnos desde su espacio.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `مآل طلب الشراكة — ${v.reference ?? ''}`.trim(),
      'طلب الشراكة الخاص بكم',
      [
        `بعد دراسة طلب الشراكة المقدَّم من ${v.organizationName ?? ORG_FALLBACK.AR} (المرجع ${v.reference ?? '—'})، لا يسعنا الاستجابة له في هذه المرحلة${v.decisionDate ? `. قرار بتاريخ ${v.decisionDate}` : ''}.`,
        reasonSentence(Language.AR, v),
        'يتعلق هذا القرار بالطلب المقدَّم ولا يشكل تقييما عاما لمؤسستكم. ويمكنكم، عند الاقتضاء، استكمال ملفكم وتقديم طلب جديد.',
      ],
      partnerSpaceCta('الاطلاع على ملفي'),
      'لأي سؤال بخصوص هذا القرار، يمكنكم مراسلتنا من فضائكم.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `Decisão sobre o seu pedido de parceria — ${v.reference ?? ''}`.trim(),
      'O seu pedido de parceria',
      [
        `Após análise do pedido de parceria de ${v.organizationName ?? ORG_FALLBACK.PT} (referência ${v.reference ?? '—'}), não estamos em condições de lhe dar seguimento favorável nesta fase${v.decisionDate ? `. Decisão de ${v.decisionDate}` : ''}.`,
        reasonSentence(Language.PT, v),
        'Esta decisão diz respeito ao pedido apresentado e não constitui uma apreciação geral da sua organização. Pode, se for caso disso, completar o seu processo e apresentar um novo pedido.',
      ],
      partnerSpaceCta('Consultar o meu processo'),
      'Para qualquer questão relativa a esta decisão, pode escrever-nos a partir do seu espaço.',
    ),
};

// --- 3. Partenariat suspendu --------------------------------------------------
// Factuel et non accusatoire. La phrase décisive est « ne constitue pas, à elle
// seule, une résiliation » : sans elle, une organisation lit une rupture là où il
// n'y a qu'un gel, et réagit en conséquence.
const PARTNERSHIP_SUSPENDED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Suspension temporaire du partenariat — ${v.organizationName ?? ''}`.trim(),
      'Suspension temporaire de votre partenariat',
      [
        `Le partenariat de ${v.organizationName ?? ORG_FALLBACK.FR} avec LES STAGIAIRES est temporairement suspendu${v.effectiveDate ? ` à compter du ${v.effectiveDate}` : ''}. Référence du dossier : ${v.reference ?? '—'}.`,
        reasonSentence(Language.FR, v),
        'Pendant la suspension, le badge de partenaire et les avantages associés ne sont plus actifs. Les engagements contractuels en cours restent régis par le contrat conclu entre les parties ; leur portée est consultable dans votre espace partenaire.',
        'Cette mesure ne constitue pas, à elle seule, une résiliation du partenariat. Les conditions d’un éventuel réexamen sont disponibles dans votre espace partenaire.',
      ],
      partnerSpaceCta('Accéder à mon espace partenaire'),
    ),
  [Language.EN]: (v) =>
    institutional(
      `Temporary suspension of the partnership — ${v.organizationName ?? ''}`.trim(),
      'Temporary suspension of your partnership',
      [
        `The partnership between ${v.organizationName ?? ORG_FALLBACK.EN} and LES STAGIAIRES is temporarily suspended${v.effectiveDate ? ` as of ${v.effectiveDate}` : ''}. File reference: ${v.reference ?? '—'}.`,
        reasonSentence(Language.EN, v),
        'During the suspension, the partner badge and the associated benefits are no longer active. Existing contractual commitments remain governed by the contract concluded between the parties; their scope is available in your partner area.',
        'This measure does not, in itself, constitute a termination of the partnership. The conditions for a possible review are available in your partner area.',
      ],
      partnerSpaceCta('Open my partner area'),
    ),
  [Language.ES]: (v) =>
    institutional(
      `Suspensión temporal de la asociación — ${v.organizationName ?? ''}`.trim(),
      'Suspensión temporal de su asociación',
      [
        `La asociación de ${v.organizationName ?? ORG_FALLBACK.ES} con LES STAGIAIRES queda temporalmente suspendida${v.effectiveDate ? ` a partir del ${v.effectiveDate}` : ''}. Referencia del expediente: ${v.reference ?? '—'}.`,
        reasonSentence(Language.ES, v),
        'Durante la suspensión, el distintivo de socio y las ventajas asociadas dejan de estar activos. Los compromisos contractuales en curso siguen regidos por el contrato celebrado entre las partes; su alcance puede consultarse en su espacio de socio.',
        'Esta medida no constituye, por sí sola, una rescisión de la asociación. Las condiciones de un eventual reexamen están disponibles en su espacio de socio.',
      ],
      partnerSpaceCta('Acceder a mi espacio de socio'),
    ),
  [Language.AR]: (v) =>
    institutional(
      `تعليق مؤقت للشراكة — ${v.organizationName ?? ''}`.trim(),
      'تعليق مؤقت لشراكتكم',
      [
        `شراكة ${v.organizationName ?? ORG_FALLBACK.AR} مع LES STAGIAIRES معلَّقة مؤقتا${v.effectiveDate ? ` ابتداء من ${v.effectiveDate}` : ''}. مرجع الملف: ${v.reference ?? '—'}.`,
        reasonSentence(Language.AR, v),
        'خلال فترة التعليق، لا تعود شارة الشريك والمزايا المرتبطة بها سارية. وتظل الالتزامات التعاقدية الجارية خاضعة للعقد المبرم بين الطرفين، ويمكن الاطلاع على نطاقها في فضاء الشريك.',
        'لا يشكل هذا الإجراء بحد ذاته إنهاء للشراكة. وشروط إعادة النظر المحتملة متاحة في فضاء الشريك الخاص بكم.',
      ],
      partnerSpaceCta('الدخول إلى فضاء الشريك'),
    ),
  [Language.PT]: (v) =>
    institutional(
      `Suspensão temporária da parceria — ${v.organizationName ?? ''}`.trim(),
      'Suspensão temporária da sua parceria',
      [
        `A parceria de ${v.organizationName ?? ORG_FALLBACK.PT} com a LES STAGIAIRES está temporariamente suspensa${v.effectiveDate ? ` a partir de ${v.effectiveDate}` : ''}. Referência do processo: ${v.reference ?? '—'}.`,
        reasonSentence(Language.PT, v),
        'Durante a suspensão, o selo de parceiro e as vantagens associadas deixam de estar ativos. Os compromissos contratuais em curso mantêm-se regidos pelo contrato celebrado entre as partes; o seu alcance pode ser consultado no seu espaço de parceiro.',
        'Esta medida não constitui, por si só, uma rescisão da parceria. As condições de uma eventual reapreciação estão disponíveis no seu espaço de parceiro.',
      ],
      partnerSpaceCta('Aceder ao meu espaço de parceiro'),
    ),
};

// --- 4. Demande de résiliation reçue ------------------------------------------
// ACCUSÉ DE RÉCEPTION, et non confirmation d'une résiliation. Trois destinataires
// possibles, donc trois textes : l'administration qui doit instruire, l'organisation
// qui vient de demander, et l'organisation que la plateforme prévient de son
// intention. Le même e-mail pour les trois dirait nécessairement faux à deux d'entre
// eux.
function terminationRequestFR(v: TemplateVars): EmailContent {
  const org = v.organizationName ?? ORG_FALLBACK.FR;
  const ref = v.reference ?? '—';

  if (v.recipient === 'ADMIN') {
    return institutional(
      `Demande de résiliation — ${org}`,
      'Demande de résiliation reçue',
      [
        `${org} a déposé une demande de résiliation de son partenariat${v.requestedAt ? ` le ${v.requestedAt}` : ''}. Référence du dossier : ${ref}.`,
        v.publicMessage
          ? `Motif indiqué par l’organisation : ${v.publicMessage}`
          : '',
        'Le partenariat reste en vigueur tant qu’une décision administrative explicite n’a pas été prononcée.',
      ],
      { label: 'Instruire le dossier', path: '/partnerships-admin' },
    );
  }

  if (v.requestedBy === 'PLATFORM') {
    return institutional(
      `Intention de résiliation du partenariat — ${org}`,
      'Intention de résiliation du partenariat',
      [
        `LES STAGIAIRES a engagé${v.requestedAt ? `, le ${v.requestedAt},` : ''} une demande de résiliation du partenariat liant ${org} à LES STAGIAIRES. Référence du dossier : ${ref}.`,
        reasonSentence(Language.FR, v),
        `Le partenariat n’est pas résilié à ce jour et demeure soumis à ses conditions actuelles.${v.contradictoryProcedure ? ' Conformément à la procédure applicable, un échange est ouvert entre les parties avant toute décision.' : ''}`,
      ],
      partnerSpaceCta('Accéder à mon espace partenaire'),
    );
  }

  return institutional(
    `Demande de résiliation enregistrée — ${org}`,
    'Votre demande de résiliation a bien été reçue',
    [
      `Nous confirmons la réception${v.requestedAt ? `, le ${v.requestedAt},` : ''} de votre demande de résiliation du partenariat liant ${org} à LES STAGIAIRES. Référence du dossier : ${ref}.`,
      'Cette demande est en cours de traitement. Le partenariat demeure soumis à ses conditions actuelles jusqu’à la confirmation de sa résiliation effective, sauf disposition contraire applicable.',
      'Vous serez informés de la décision et de sa date d’effet. Tant que celle-ci n’est pas prononcée, votre demande peut être retirée depuis votre espace partenaire.',
    ],
    partnerSpaceCta('Accéder à mon espace partenaire'),
  );
}

function terminationRequestEN(v: TemplateVars): EmailContent {
  const org = v.organizationName ?? ORG_FALLBACK.EN;
  const ref = v.reference ?? '—';

  if (v.recipient === 'ADMIN') {
    return institutional(
      `Termination request — ${org}`,
      'Termination request received',
      [
        `${org} has submitted a request to terminate its partnership${v.requestedAt ? ` on ${v.requestedAt}` : ''}. File reference: ${ref}.`,
        v.publicMessage
          ? `Reason stated by the organisation: ${v.publicMessage}`
          : '',
        'The partnership remains in force until an explicit administrative decision has been issued.',
      ],
      { label: 'Review the file', path: '/partnerships-admin' },
    );
  }

  if (v.requestedBy === 'PLATFORM') {
    return institutional(
      `Intention to terminate the partnership — ${org}`,
      'Intention to terminate the partnership',
      [
        `LES STAGIAIRES has initiated${v.requestedAt ? `, on ${v.requestedAt},` : ''} a request to terminate the partnership between ${org} and LES STAGIAIRES. File reference: ${ref}.`,
        reasonSentence(Language.EN, v),
        `The partnership is not terminated as of today and remains subject to its current terms.${v.contradictoryProcedure ? ' In accordance with the applicable procedure, a discussion is open between the parties before any decision.' : ''}`,
      ],
      partnerSpaceCta('Open my partner area'),
    );
  }

  return institutional(
    `Termination request recorded — ${org}`,
    'Your termination request has been received',
    [
      `We confirm receipt${v.requestedAt ? `, on ${v.requestedAt},` : ''} of your request to terminate the partnership between ${org} and LES STAGIAIRES. File reference: ${ref}.`,
      'This request is being processed. The partnership remains subject to its current terms until its effective termination is confirmed, unless otherwise applicable.',
      'You will be informed of the decision and of its effective date. Until it is issued, your request may be withdrawn from your partner area.',
    ],
    partnerSpaceCta('Open my partner area'),
  );
}

function terminationRequestES(v: TemplateVars): EmailContent {
  const org = v.organizationName ?? ORG_FALLBACK.ES;
  const ref = v.reference ?? '—';

  if (v.recipient === 'ADMIN') {
    return institutional(
      `Solicitud de rescisión — ${org}`,
      'Solicitud de rescisión recibida',
      [
        `${org} ha presentado una solicitud de rescisión de su asociación${v.requestedAt ? ` el ${v.requestedAt}` : ''}. Referencia del expediente: ${ref}.`,
        v.publicMessage
          ? `Motivo indicado por la organización: ${v.publicMessage}`
          : '',
        'La asociación permanece en vigor mientras no se haya dictado una decisión administrativa expresa.',
      ],
      { label: 'Tramitar el expediente', path: '/partnerships-admin' },
    );
  }

  if (v.requestedBy === 'PLATFORM') {
    return institutional(
      `Intención de rescindir la asociación — ${org}`,
      'Intención de rescindir la asociación',
      [
        `LES STAGIAIRES ha iniciado${v.requestedAt ? `, el ${v.requestedAt},` : ''} una solicitud de rescisión de la asociación que vincula a ${org} con LES STAGIAIRES. Referencia del expediente: ${ref}.`,
        reasonSentence(Language.ES, v),
        `La asociación no está rescindida a día de hoy y sigue sujeta a sus condiciones actuales.${v.contradictoryProcedure ? ' Conforme al procedimiento aplicable, se abre un diálogo entre las partes antes de cualquier decisión.' : ''}`,
      ],
      partnerSpaceCta('Acceder a mi espacio de socio'),
    );
  }

  return institutional(
    `Solicitud de rescisión registrada — ${org}`,
    'Su solicitud de rescisión ha sido recibida',
    [
      `Confirmamos la recepción${v.requestedAt ? `, el ${v.requestedAt},` : ''} de su solicitud de rescisión de la asociación que vincula a ${org} con LES STAGIAIRES. Referencia del expediente: ${ref}.`,
      'Esta solicitud está en curso de tramitación. La asociación sigue sujeta a sus condiciones actuales hasta la confirmación de su rescisión efectiva, salvo disposición contraria aplicable.',
      'Se le informará de la decisión y de su fecha de efecto. Mientras no se dicte, su solicitud puede retirarse desde su espacio de socio.',
    ],
    partnerSpaceCta('Acceder a mi espacio de socio'),
  );
}

function terminationRequestAR(v: TemplateVars): EmailContent {
  const org = v.organizationName ?? ORG_FALLBACK.AR;
  const ref = v.reference ?? '—';

  if (v.recipient === 'ADMIN') {
    return institutional(
      `طلب إنهاء الشراكة — ${org}`,
      'ورد طلب إنهاء الشراكة',
      [
        `قدّمت ${org} طلبا لإنهاء شراكتها${v.requestedAt ? ` بتاريخ ${v.requestedAt}` : ''}. مرجع الملف: ${ref}.`,
        v.publicMessage ? `السبب الذي ذكرته المؤسسة: ${v.publicMessage}` : '',
        'تبقى الشراكة سارية ما لم يصدر قرار إداري صريح.',
      ],
      { label: 'دراسة الملف', path: '/partnerships-admin' },
    );
  }

  if (v.requestedBy === 'PLATFORM') {
    return institutional(
      `نية إنهاء الشراكة — ${org}`,
      'نية إنهاء الشراكة',
      [
        `باشرت LES STAGIAIRES${v.requestedAt ? ` بتاريخ ${v.requestedAt}` : ''} طلبا لإنهاء الشراكة التي تربط ${org} بـ LES STAGIAIRES. مرجع الملف: ${ref}.`,
        reasonSentence(Language.AR, v),
        `الشراكة غير منتهية إلى حد اليوم وتظل خاضعة لشروطها الحالية.${v.contradictoryProcedure ? ' ووفقا للإجراء المعمول به، يُفتح حوار بين الطرفين قبل أي قرار.' : ''}`,
      ],
      partnerSpaceCta('الدخول إلى فضاء الشريك'),
    );
  }

  return institutional(
    `تسجيل طلب إنهاء الشراكة — ${org}`,
    'تم استلام طلبكم لإنهاء الشراكة',
    [
      `نؤكد استلام${v.requestedAt ? ` بتاريخ ${v.requestedAt}` : ''} طلبكم إنهاء الشراكة التي تربط ${org} بـ LES STAGIAIRES. مرجع الملف: ${ref}.`,
      'الطلب قيد المعالجة. وتظل الشراكة خاضعة لشروطها الحالية إلى حين تأكيد إنهائها الفعلي، ما لم ينص على خلاف ذلك.',
      'سيتم إعلامكم بالقرار وبتاريخ سريانه. وما دام لم يصدر، يمكن سحب طلبكم من فضاء الشريك.',
    ],
    partnerSpaceCta('الدخول إلى فضاء الشريك'),
  );
}

function terminationRequestPT(v: TemplateVars): EmailContent {
  const org = v.organizationName ?? ORG_FALLBACK.PT;
  const ref = v.reference ?? '—';

  if (v.recipient === 'ADMIN') {
    return institutional(
      `Pedido de rescisão — ${org}`,
      'Pedido de rescisão recebido',
      [
        `${org} apresentou um pedido de rescisão da sua parceria${v.requestedAt ? ` em ${v.requestedAt}` : ''}. Referência do processo: ${ref}.`,
        v.publicMessage
          ? `Motivo indicado pela organização: ${v.publicMessage}`
          : '',
        'A parceria mantém-se em vigor enquanto não for proferida uma decisão administrativa expressa.',
      ],
      { label: 'Analisar o processo', path: '/partnerships-admin' },
    );
  }

  if (v.requestedBy === 'PLATFORM') {
    return institutional(
      `Intenção de rescindir a parceria — ${org}`,
      'Intenção de rescindir a parceria',
      [
        `A LES STAGIAIRES iniciou${v.requestedAt ? `, em ${v.requestedAt},` : ''} um pedido de rescisão da parceria que liga ${org} à LES STAGIAIRES. Referência do processo: ${ref}.`,
        reasonSentence(Language.PT, v),
        `A parceria não está rescindida à data de hoje e mantém-se sujeita às suas condições atuais.${v.contradictoryProcedure ? ' Nos termos do procedimento aplicável, é aberto um diálogo entre as partes antes de qualquer decisão.' : ''}`,
      ],
      partnerSpaceCta('Aceder ao meu espaço de parceiro'),
    );
  }

  return institutional(
    `Pedido de rescisão registado — ${org}`,
    'O seu pedido de rescisão foi recebido',
    [
      `Confirmamos a receção${v.requestedAt ? `, em ${v.requestedAt},` : ''} do seu pedido de rescisão da parceria que liga ${org} à LES STAGIAIRES. Referência do processo: ${ref}.`,
      'Este pedido está a ser tratado. A parceria mantém-se sujeita às suas condições atuais até à confirmação da sua rescisão efetiva, salvo disposição aplicável em contrário.',
      'Será informado da decisão e da sua data de produção de efeitos. Enquanto não for proferida, o seu pedido pode ser retirado a partir do seu espaço de parceiro.',
    ],
    partnerSpaceCta('Aceder ao meu espaço de parceiro'),
  );
}

const PARTNERSHIP_TERMINATION_REQUESTED_TPL: Localized = {
  [Language.FR]: terminationRequestFR,
  [Language.EN]: terminationRequestEN,
  [Language.ES]: terminationRequestES,
  [Language.AR]: terminationRequestAR,
  [Language.PT]: terminationRequestPT,
};

// --- 5. Partenariat résilié ---------------------------------------------------
// Formel, définitif, respectueux. Le dernier paragraphe est le plus important :
// il n'est JAMAIS écrit que toutes les obligations s'éteignent, parce que ce serait
// faux et qu'une organisation pourrait s'en prévaloir.
const PARTNERSHIP_TERMINATED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Fin du partenariat — ${v.organizationName ?? ''}`.trim(),
      'Fin de votre partenariat avec LES STAGIAIRES',
      [
        `Nous vous informons que le partenariat entre ${v.organizationName ?? ORG_FALLBACK.FR} et LES STAGIAIRES a pris fin${v.effectiveDate ? ` avec effet au ${v.effectiveDate}` : ''}. Référence du dossier : ${v.reference ?? '—'}.`,
        reasonSentence(Language.FR, v),
        'À cette date, le badge de partenaire et les accès liés au programme sont désactivés. Les conséquences sur les services en cours, les documents et les modalités d’accès à l’historique sont détaillées dans votre espace partenaire.',
        'Certaines obligations demeurent applicables après la fin du partenariat — à titre d’exemple, la confidentialité, la protection des données, le règlement des sommes éventuellement dues, la conservation des documents ou la responsabilité au titre des opérations antérieures. Cette énumération est indicative : seul le contrat conclu entre les parties, consultable dans votre espace partenaire, en fixe la portée exacte.',
      ],
      partnerSpaceCta('Accéder à mon espace partenaire'),
      'Pour toute demande d’explication relative à cette décision, vous pouvez nous écrire depuis votre espace.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `End of the partnership — ${v.organizationName ?? ''}`.trim(),
      'End of your partnership with LES STAGIAIRES',
      [
        `We inform you that the partnership between ${v.organizationName ?? ORG_FALLBACK.EN} and LES STAGIAIRES has ended${v.effectiveDate ? ` with effect from ${v.effectiveDate}` : ''}. File reference: ${v.reference ?? '—'}.`,
        reasonSentence(Language.EN, v),
        'As of that date, the partner badge and the accesses linked to the programme are deactivated. The consequences for ongoing services, documents and access to historical records are set out in your partner area.',
        'Certain obligations remain applicable after the end of the partnership — by way of example, confidentiality, data protection, settlement of any amounts due, retention of documents or liability for prior operations. This list is indicative: only the contract concluded between the parties, available in your partner area, determines its exact scope.',
      ],
      partnerSpaceCta('Open my partner area'),
      'For any request for clarification regarding this decision, you may write to us from your area.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `Fin de la asociación — ${v.organizationName ?? ''}`.trim(),
      'Fin de su asociación con LES STAGIAIRES',
      [
        `Le informamos de que la asociación entre ${v.organizationName ?? ORG_FALLBACK.ES} y LES STAGIAIRES ha finalizado${v.effectiveDate ? ` con efecto a ${v.effectiveDate}` : ''}. Referencia del expediente: ${v.reference ?? '—'}.`,
        reasonSentence(Language.ES, v),
        'A partir de esa fecha, el distintivo de socio y los accesos vinculados al programa quedan desactivados. Las consecuencias sobre los servicios en curso, los documentos y las modalidades de acceso al historial se detallan en su espacio de socio.',
        'Determinadas obligaciones siguen siendo aplicables tras el fin de la asociación — a título de ejemplo, la confidencialidad, la protección de datos, la liquidación de las cantidades eventualmente debidas, la conservación de documentos o la responsabilidad por las operaciones anteriores. Esta enumeración es indicativa: solo el contrato celebrado entre las partes, consultable en su espacio de socio, fija su alcance exacto.',
      ],
      partnerSpaceCta('Acceder a mi espacio de socio'),
      'Para cualquier solicitud de aclaración relativa a esta decisión, puede escribirnos desde su espacio.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `انتهاء الشراكة — ${v.organizationName ?? ''}`.trim(),
      'انتهاء شراكتكم مع LES STAGIAIRES',
      [
        `نعلمكم بأن الشراكة بين ${v.organizationName ?? ORG_FALLBACK.AR} و LES STAGIAIRES قد انتهت${v.effectiveDate ? ` بأثر من ${v.effectiveDate}` : ''}. مرجع الملف: ${v.reference ?? '—'}.`,
        reasonSentence(Language.AR, v),
        'من هذا التاريخ، تُعطَّل شارة الشريك والصلاحيات المرتبطة بالبرنامج. وتفاصيل الآثار على الخدمات الجارية والوثائق وكيفيات الاطلاع على السجل متاحة في فضاء الشريك.',
        'تظل بعض الالتزامات سارية بعد انتهاء الشراكة، على سبيل المثال السرية وحماية البيانات وتسوية المبالغ المستحقة عند الاقتضاء وحفظ الوثائق والمسؤولية عن العمليات السابقة. هذا التعداد إرشادي: العقد المبرم بين الطرفين، المتاح في فضاء الشريك، هو وحده الذي يحدد نطاقها بدقة.',
      ],
      partnerSpaceCta('الدخول إلى فضاء الشريك'),
      'لأي طلب توضيح بخصوص هذا القرار، يمكنكم مراسلتنا من فضائكم.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `Fim da parceria — ${v.organizationName ?? ''}`.trim(),
      'Fim da sua parceria com a LES STAGIAIRES',
      [
        `Informamos que a parceria entre ${v.organizationName ?? ORG_FALLBACK.PT} e a LES STAGIAIRES terminou${v.effectiveDate ? ` com efeitos a ${v.effectiveDate}` : ''}. Referência do processo: ${v.reference ?? '—'}.`,
        reasonSentence(Language.PT, v),
        'A partir dessa data, o selo de parceiro e os acessos associados ao programa são desativados. As consequências para os serviços em curso, os documentos e as modalidades de acesso ao histórico estão detalhadas no seu espaço de parceiro.',
        'Determinadas obrigações mantêm-se aplicáveis após o fim da parceria — a título de exemplo, a confidencialidade, a proteção de dados, o pagamento de quantias eventualmente devidas, a conservação de documentos ou a responsabilidade pelas operações anteriores. Esta enumeração é indicativa: apenas o contrato celebrado entre as partes, consultável no seu espaço de parceiro, fixa o seu alcance exato.',
      ],
      partnerSpaceCta('Aceder ao meu espaço de parceiro'),
      'Para qualquer pedido de esclarecimento relativo a esta decisão, pode escrever-nos a partir do seu espaço.',
    ),
};

// ============================================================================
// ORGANISATIONS ET ÉQUIPES
//
// Le destinataire est ici une PERSONNE agissant au nom d'une organisation — ni le
// candidat du parcours ci-dessus, ni l'institution des partenariats. Le registre
// est donc intermédiaire : professionnel et direct, sans la solennité juridique
// d'une décision de partenariat.
//
// Deux de ces messages annoncent ou retirent un accès. Ils NOMMENT toujours
// l'organisation concernée : « votre accès a été révoqué », sans dire lequel, est
// inexploitable pour qui en gère plusieurs — et se lit comme un hameçonnage.
// ============================================================================

// Rôles d'équipe, traduits. Le serveur envoie le code, jamais le libellé.
const MEMBER_ROLE_LABELS: Record<Language, Record<string, string>> = {
  [Language.FR]: {
    ADMIN: 'administrateur',
    RECRUITER: 'recruteur',
    VIEWER: 'lecture seule',
  },
  [Language.EN]: {
    ADMIN: 'administrator',
    RECRUITER: 'recruiter',
    VIEWER: 'read-only',
  },
  [Language.ES]: {
    ADMIN: 'administrador',
    RECRUITER: 'reclutador',
    VIEWER: 'solo lectura',
  },
  [Language.AR]: {
    ADMIN: 'مدير',
    RECRUITER: 'مسؤول توظيف',
    VIEWER: 'اطلاع فقط',
  },
  [Language.PT]: {
    ADMIN: 'administrador',
    RECRUITER: 'recrutador',
    VIEWER: 'apenas leitura',
  },
};

// Rend la mention du rôle, ou rien si le code est inconnu. Un code technique brut
// dans un e-mail vaut moins qu'un silence.
function roleClause(language: Language, v: TemplateVars): string {
  const role = typeof v.role === 'string' ? v.role : undefined;
  const label = role ? MEMBER_ROLE_LABELS[language][role] : undefined;
  if (!label) return '';
  const intro: Record<Language, string> = {
    [Language.FR]: `Rôle proposé : ${label}.`,
    [Language.EN]: `Proposed role: ${label}.`,
    [Language.ES]: `Función propuesta: ${label}.`,
    [Language.AR]: `الدور المقترح: ${label}.`,
    [Language.PT]: `Função proposta: ${label}.`,
  };
  return intro[language];
}

const ORG_INVITATION_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Invitation à rejoindre ${v.organizationName ?? 'une organisation'} sur LES STAGIAIRES`,
      'Vous êtes invité à rejoindre une équipe',
      [
        `${v.organizationName ?? 'Une organisation'} vous invite à rejoindre son équipe sur LES STAGIAIRES. ${roleClause(Language.FR, v)}`.trim(),
        'Vous pouvez accepter ou décliner cette invitation depuis votre espace. Tant que vous ne l’avez pas acceptée, vous n’avez accès à aucune donnée de cette organisation.',
      ],
      { label: 'Voir l’invitation', path: '/profile' },
      'Si cette invitation ne vous semble pas légitime, ignorez-la : elle expire sans action de votre part, et personne n’accède à votre compte.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `Invitation to join ${v.organizationName ?? 'an organisation'} on LES STAGIAIRES`,
      'You have been invited to join a team',
      [
        `${v.organizationName ?? 'An organisation'} invites you to join its team on LES STAGIAIRES. ${roleClause(Language.EN, v)}`.trim(),
        'You can accept or decline this invitation from your area. Until you accept it, you have access to none of this organisation’s data.',
      ],
      { label: 'View the invitation', path: '/profile' },
      'If this invitation does not look legitimate, ignore it: it expires without any action from you, and nobody gains access to your account.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `Invitación para unirse a ${v.organizationName ?? 'una organización'} en LES STAGIAIRES`,
      'Le han invitado a unirse a un equipo',
      [
        `${v.organizationName ?? 'Una organización'} le invita a unirse a su equipo en LES STAGIAIRES. ${roleClause(Language.ES, v)}`.trim(),
        'Puede aceptar o rechazar esta invitación desde su espacio. Mientras no la acepte, no tiene acceso a ningún dato de esta organización.',
      ],
      { label: 'Ver la invitación', path: '/profile' },
      'Si esta invitación no le parece legítima, ignórela: caduca sin acción por su parte y nadie accede a su cuenta.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `دعوة للانضمام إلى ${v.organizationName ?? 'مؤسسة'} على LES STAGIAIRES`,
      'تمت دعوتك للانضمام إلى فريق',
      [
        `${v.organizationName ?? 'مؤسسة'} تدعوك للانضمام إلى فريقها على LES STAGIAIRES. ${roleClause(Language.AR, v)}`.trim(),
        'يمكنك قبول الدعوة أو رفضها من فضائك. وما دمت لم تقبلها، فليس لديك أي اطلاع على بيانات هذه المؤسسة.',
      ],
      { label: 'الاطلاع على الدعوة', path: '/profile' },
      'إذا بدت لك هذه الدعوة غير مشروعة، فتجاهلها: تنتهي صلاحيتها دون أي إجراء منك، ولا يصل أحد إلى حسابك.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `Convite para integrar ${v.organizationName ?? 'uma organização'} na LES STAGIAIRES`,
      'Foi convidado para integrar uma equipa',
      [
        `${v.organizationName ?? 'Uma organização'} convida-o a integrar a sua equipa na LES STAGIAIRES. ${roleClause(Language.PT, v)}`.trim(),
        'Pode aceitar ou recusar este convite a partir do seu espaço. Enquanto não o aceitar, não tem acesso a nenhum dado desta organização.',
      ],
      { label: 'Ver o convite', path: '/profile' },
      'Se este convite não lhe parecer legítimo, ignore-o: caduca sem qualquer ação da sua parte e ninguém acede à sua conta.',
    ),
};

// Ton neutre et factuel. Perdre un accès n'est pas une sanction : c'est le plus
// souvent un départ, une réorganisation, une fin de mission. Le message ne présume
// donc rien, et ne laisse pas croire à une faute.
const ORG_ACCESS_REVOKED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Fin de votre accès à ${v.organizationName ?? 'une organisation'}`,
      'Votre accès a pris fin',
      [
        `Votre accès à l’espace de ${v.organizationName ?? 'cette organisation'} sur LES STAGIAIRES a été retiré par l’un de ses administrateurs.`,
        'Votre compte personnel LES STAGIAIRES n’est pas affecté : votre profil, vos documents et vos candidatures restent les vôtres.',
      ],
      { label: 'Accéder à mon compte', path: '/profile' },
      'Pour toute question sur cette décision, adressez-vous directement à l’organisation concernée.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `End of your access to ${v.organizationName ?? 'an organisation'}`,
      'Your access has ended',
      [
        `Your access to the ${v.organizationName ?? 'organisation'} area on LES STAGIAIRES has been withdrawn by one of its administrators.`,
        'Your personal LES STAGIAIRES account is unaffected: your profile, your documents and your applications remain yours.',
      ],
      { label: 'Open my account', path: '/profile' },
      'For any question about this decision, please contact the organisation directly.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `Fin de su acceso a ${v.organizationName ?? 'una organización'}`,
      'Su acceso ha finalizado',
      [
        `Su acceso al espacio de ${v.organizationName ?? 'esta organización'} en LES STAGIAIRES ha sido retirado por uno de sus administradores.`,
        'Su cuenta personal de LES STAGIAIRES no se ve afectada: su perfil, sus documentos y sus candidaturas siguen siendo suyos.',
      ],
      { label: 'Acceder a mi cuenta', path: '/profile' },
      'Para cualquier duda sobre esta decisión, diríjase directamente a la organización.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `انتهاء اطلاعك على ${v.organizationName ?? 'مؤسسة'}`,
      'انتهى اطلاعك',
      [
        `تم سحب اطلاعك على فضاء ${v.organizationName ?? 'هذه المؤسسة'} على LES STAGIAIRES من طرف أحد مسيّريها.`,
        'حسابك الشخصي على LES STAGIAIRES غير متأثر: ملفك ووثائقك وترشيحاتك تبقى لك.',
      ],
      { label: 'الدخول إلى حسابي', path: '/profile' },
      'لأي سؤال بخصوص هذا القرار، توجّه مباشرة إلى المؤسسة المعنية.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `Fim do seu acesso a ${v.organizationName ?? 'uma organização'}`,
      'O seu acesso terminou',
      [
        `O seu acesso ao espaço de ${v.organizationName ?? 'esta organização'} na LES STAGIAIRES foi retirado por um dos seus administradores.`,
        'A sua conta pessoal LES STAGIAIRES não é afetada: o seu perfil, os seus documentos e as suas candidaturas continuam a ser seus.',
      ],
      { label: 'Aceder à minha conta', path: '/profile' },
      'Para qualquer questão sobre esta decisão, dirija-se diretamente à organização.',
    ),
};

// L'établissement est invité à s'associer à une convention. L'association est
// FACULTATIVE et ne conditionne ni la signature candidat/entreprise ni le début du
// stage : le gabarit le dit, sans quoi un établissement croirait bloquer le stage
// de son apprenant en tardant à répondre.
const ESTABLISHMENT_ASSOCIATION_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Convention ${REF(v)} — association de votre établissement`,
      'Un de vos apprenants a une convention de stage',
      [
        `Un apprenant rattaché à votre établissement est concerné par la convention de stage ${REF(v)}. Vous pouvez y associer votre établissement par une signature déclarative depuis votre espace.`,
        'Cette association est facultative : elle ne conditionne ni la signature du candidat et de l’entreprise, ni le démarrage du stage. Elle atteste simplement du suivi pédagogique de votre établissement.',
      ],
      { label: 'Consulter la convention', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    institutional(
      `Agreement ${REF(v)} — association of your institution`,
      'One of your learners has an internship agreement',
      [
        `A learner registered with your institution is covered by internship agreement ${REF(v)}. You may associate your institution with it through a declarative signature from your area.`,
        'This association is optional: it conditions neither the candidate’s and company’s signature nor the start of the internship. It simply attests to your institution’s educational follow-up.',
      ],
      { label: 'View the agreement', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    institutional(
      `Convenio ${REF(v)} — asociación de su centro`,
      'Uno de sus alumnos tiene un convenio de prácticas',
      [
        `Un alumno vinculado a su centro está afectado por el convenio de prácticas ${REF(v)}. Puede asociar su centro mediante una firma declarativa desde su espacio.`,
        'Esta asociación es facultativa: no condiciona ni la firma del candidato y de la empresa, ni el inicio de las prácticas. Simplemente acredita el seguimiento pedagógico de su centro.',
      ],
      { label: 'Consultar el convenio', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    institutional(
      `اتفاقية ${REF(v)} — ربط مؤسستكم`,
      'أحد متعلميكم لديه اتفاقية تدريب',
      [
        `متعلم منتسب إلى مؤسستكم معني باتفاقية التدريب ${REF(v)}. ويمكنكم ربط مؤسستكم بها بتوقيع تصريحي من فضائكم.`,
        'هذا الربط اختياري: فهو لا يشترط توقيع المترشح والمقاولة ولا انطلاق التدريب. وإنما يشهد فقط على المتابعة البيداغوجية لمؤسستكم.',
      ],
      { label: 'الاطلاع على الاتفاقية', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    institutional(
      `Convenção ${REF(v)} — associação do seu estabelecimento`,
      'Um dos seus formandos tem uma convenção de estágio',
      [
        `Um formando inscrito no seu estabelecimento é abrangido pela convenção de estágio ${REF(v)}. Pode associar o seu estabelecimento através de uma assinatura declarativa a partir do seu espaço.`,
        'Esta associação é facultativa: não condiciona a assinatura do candidato e da empresa, nem o início do estágio. Apenas atesta o acompanhamento pedagógico do seu estabelecimento.',
      ],
      { label: 'Consultar a convenção', path: '/applications' },
    ),
};

// ============================================================================
// CANDIDATURES — VUE DE L'ORGANISATION
//
// Ces deux-là sont les seuls évènements de recrutement qui forcent l'e-mail chez
// un recruteur (voir notification-delivery.ts) : les autres restent dans
// l'application. Ils le forcent parce qu'ils appellent une ACTION ou scellent un
// ENGAGEMENT — pas parce qu'ils sont intéressants.
// ============================================================================
const ADMISSION_ACCEPTED_ORG_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Candidature ${REF(v)} — le candidat a accepté`,
      'Le candidat a accepté votre lettre d’admission',
      [
        `Le candidat de la candidature ${REF(v)} a accepté votre lettre d’admission. La convention de stage a été générée et vous attend.`,
        'Le stage ne peut démarrer qu’une fois la convention signée par toutes les parties.',
      ],
      { label: 'Ouvrir la candidature', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    institutional(
      `Application ${REF(v)} — the candidate has accepted`,
      'The candidate accepted your admission letter',
      [
        `The candidate of application ${REF(v)} has accepted your admission letter. The internship agreement has been generated and is waiting for you.`,
        'The internship can only start once the agreement has been signed by all parties.',
      ],
      { label: 'Open the application', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    institutional(
      `Candidatura ${REF(v)} — el candidato ha aceptado`,
      'El candidato ha aceptado su carta de admisión',
      [
        `El candidato de la candidatura ${REF(v)} ha aceptado su carta de admisión. El convenio de prácticas se ha generado y le está esperando.`,
        'Las prácticas solo pueden comenzar una vez firmado el convenio por todas las partes.',
      ],
      { label: 'Abrir la candidatura', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    institutional(
      `الترشيح ${REF(v)} — قبل المترشح`,
      'قبل المترشح رسالة القبول',
      [
        `قبل مترشح الملف ${REF(v)} رسالة القبول التي وجهتموها إليه. وقد أُنشئت اتفاقية التدريب وهي في انتظاركم.`,
        'لا يمكن أن ينطلق التدريب إلا بعد توقيع الاتفاقية من جميع الأطراف.',
      ],
      { label: 'فتح الملف', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    institutional(
      `Candidatura ${REF(v)} — o candidato aceitou`,
      'O candidato aceitou a sua carta de admissão',
      [
        `O candidato da candidatura ${REF(v)} aceitou a sua carta de admissão. A convenção de estágio foi gerada e aguarda-o.`,
        'O estágio só pode começar depois de a convenção ser assinada por todas as partes.',
      ],
      { label: 'Abrir a candidatura', path: '/applications' },
    ),
};

const AGREEMENT_SIGNED_ORG_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `Convention ${REF(v)} — signée par toutes les parties`,
      'La convention est intégralement signée',
      [
        `La convention de stage ${REF(v)} est signée par toutes les parties. Le stage peut démarrer aux dates convenues.`,
        'La convention signée est disponible dans la candidature, et le stagiaire apparaît désormais dans votre suivi de stages.',
      ],
      { label: 'Ouvrir la candidature', path: '/applications' },
    ),
  [Language.EN]: (v) =>
    institutional(
      `Agreement ${REF(v)} — signed by all parties`,
      'The agreement is fully signed',
      [
        `Internship agreement ${REF(v)} has been signed by all parties. The internship may start on the agreed dates.`,
        'The signed agreement is available in the application, and the intern now appears in your internship tracking.',
      ],
      { label: 'Open the application', path: '/applications' },
    ),
  [Language.ES]: (v) =>
    institutional(
      `Convenio ${REF(v)} — firmado por todas las partes`,
      'El convenio está íntegramente firmado',
      [
        `El convenio de prácticas ${REF(v)} está firmado por todas las partes. Las prácticas pueden comenzar en las fechas acordadas.`,
        'El convenio firmado está disponible en la candidatura, y el alumno en prácticas figura ya en su seguimiento.',
      ],
      { label: 'Abrir la candidatura', path: '/applications' },
    ),
  [Language.AR]: (v) =>
    institutional(
      `الاتفاقية ${REF(v)} — موقعة من جميع الأطراف`,
      'الاتفاقية موقعة بالكامل',
      [
        `اتفاقية التدريب ${REF(v)} موقعة من جميع الأطراف. ويمكن أن ينطلق التدريب في التواريخ المتفق عليها.`,
        'الاتفاقية الموقعة متاحة في الملف، والمتدرب يظهر الآن في متابعتكم للتداريب.',
      ],
      { label: 'فتح الملف', path: '/applications' },
    ),
  [Language.PT]: (v) =>
    institutional(
      `Convenção ${REF(v)} — assinada por todas as partes`,
      'A convenção está integralmente assinada',
      [
        `A convenção de estágio ${REF(v)} foi assinada por todas as partes. O estágio pode começar nas datas acordadas.`,
        'A convenção assinada está disponível na candidatura, e o estagiário consta agora do seu acompanhamento de estágios.',
      ],
      { label: 'Abrir a candidatura', path: '/applications' },
    ),
};

// ============================================================================
// APPRENANTS
//
// Le destinataire peut être MINEUR (CLAUDE.md §5). Le message reste donc simple,
// nomme l'établissement, et dit ce que le rattachement change — un apprenant, ou
// son parent, doit pouvoir décider en comprenant.
// ============================================================================
const LEARNER_INVITED_TPL: Localized = {
  [Language.FR]: (v) =>
    institutional(
      `${v.establishmentName ?? 'Votre établissement'} vous invite à vous rattacher`,
      'Votre établissement vous invite',
      [
        `${v.establishmentName ?? 'Un établissement'} vous invite à vous rattacher à son espace sur LES STAGIAIRES, en tant qu’apprenant.`,
        'Une fois rattaché, votre établissement pourra suivre vos stages et vos conventions. Il n’accède ni à vos documents personnels, ni à vos candidatures en cours.',
        'Vous restez libre d’accepter ou de refuser.',
      ],
      { label: 'Voir l’invitation', path: '/profile' },
      'Si vous ne connaissez pas cet établissement, ignorez ce message.',
    ),
  [Language.EN]: (v) =>
    institutional(
      `${v.establishmentName ?? 'Your institution'} invites you to link your account`,
      'Your institution is inviting you',
      [
        `${v.establishmentName ?? 'An institution'} invites you to link your account to its area on LES STAGIAIRES, as a learner.`,
        'Once linked, your institution will be able to follow your internships and agreements. It accesses neither your personal documents nor your ongoing applications.',
        'You remain free to accept or decline.',
      ],
      { label: 'View the invitation', path: '/profile' },
      'If you do not know this institution, ignore this message.',
    ),
  [Language.ES]: (v) =>
    institutional(
      `${v.establishmentName ?? 'Su centro'} le invita a vincularse`,
      'Su centro le invita',
      [
        `${v.establishmentName ?? 'Un centro'} le invita a vincularse a su espacio en LES STAGIAIRES, como alumno.`,
        'Una vez vinculado, su centro podrá seguir sus prácticas y sus convenios. No accede ni a sus documentos personales ni a sus candidaturas en curso.',
        'Usted sigue siendo libre de aceptar o rechazar.',
      ],
      { label: 'Ver la invitación', path: '/profile' },
      'Si no conoce este centro, ignore este mensaje.',
    ),
  [Language.AR]: (v) =>
    institutional(
      `${v.establishmentName ?? 'مؤسستكم'} تدعوك إلى الانتساب`,
      'مؤسستك تدعوك',
      [
        `${v.establishmentName ?? 'مؤسسة'} تدعوك إلى الانتساب إلى فضائها على LES STAGIAIRES بصفتك متعلما.`,
        'بعد الانتساب، ستتمكن مؤسستك من متابعة تداريبك واتفاقياتك. وهي لا تطّلع على وثائقك الشخصية ولا على ترشيحاتك الجارية.',
        'وتبقى حرا في القبول أو الرفض.',
      ],
      { label: 'الاطلاع على الدعوة', path: '/profile' },
      'إذا كنت لا تعرف هذه المؤسسة، فتجاهل هذه الرسالة.',
    ),
  [Language.PT]: (v) =>
    institutional(
      `${v.establishmentName ?? 'O seu estabelecimento'} convida-o a associar-se`,
      'O seu estabelecimento convida-o',
      [
        `${v.establishmentName ?? 'Um estabelecimento'} convida-o a associar-se ao seu espaço na LES STAGIAIRES, na qualidade de formando.`,
        'Depois de associado, o seu estabelecimento poderá acompanhar os seus estágios e as suas convenções. Não acede aos seus documentos pessoais nem às suas candidaturas em curso.',
        'Mantém-se livre de aceitar ou recusar.',
      ],
      { label: 'Ver o convite', path: '/profile' },
      'Se não conhece este estabelecimento, ignore esta mensagem.',
    ),
};

// ============================================================================
// REGISTRE
//
// `Partial<Record<…>>` à dessein, et non `Record<…>` complet : tous les types de
// notification n'ont pas vocation à devenir un e-mail. Une absence ici n'est pas
// un oubli mais une décision — le canal e-mail se tait, la notification interne
// reste. La couverture réelle est mesurée par email-templates.spec.ts, qui
// vérifie qu'aucun gabarit présent ne manque une langue.
// ============================================================================
const TEMPLATES: Partial<Record<NotificationType, Localized>> = {
  [NotificationType.APPLICATION_SUBMITTED]: APPLICATION_SUBMITTED,
  [NotificationType.APPLICATION_DOCUMENT_REQUESTED]: DOCUMENT_REQUESTED,
  [NotificationType.APPLICATION_INTERVIEW_PROPOSED]: INTERVIEW_PROPOSED,
  [NotificationType.APPLICATION_ADMISSION_LETTER_ISSUED]: ADMISSION_LETTER,
  [NotificationType.APPLICATION_REJECTED]: APPLICATION_REJECTED,
  [NotificationType.APPLICATION_ACCEPTED_PENDING_TRAVEL_CONSENT]:
    PENDING_TRAVEL_CONSENT,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_CONFIRMED]:
    TRAVEL_CONSENT_CONFIRMED,
  [NotificationType.APPLICATION_TRAVEL_CONSENT_EXPIRED]: TRAVEL_CONSENT_EXPIRED,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED]: AGREEMENT_SIGNED,
  [NotificationType.APPLICATION_ESTABLISHMENT_SIGNED]: ESTABLISHMENT_SIGNED,
  [NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON]: INTERNSHIP_STARTING,
  [NotificationType.APPLICATION_CLOSED]: APPLICATION_CLOSED,
  [NotificationType.APPLICATION_RECOMMENDATION_RECEIVED]:
    RECOMMENDATION_RECEIVED,

  // --- Ambassadeurs ---
  [NotificationType.AMBASSADOR_APPROVED]: AMBASSADOR_APPROVED_TPL,
  [NotificationType.AMBASSADOR_SUSPENDED]: AMBASSADOR_SUSPENDED_TPL,
  [NotificationType.AMBASSADOR_TERMINATED]: AMBASSADOR_TERMINATED_TPL,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M]: PORTFOLIO_9M_TPL,
  [NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M]: PORTFOLIO_11M_TPL,
  [NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED]: PORTFOLIO_EXPIRED_TPL,

  // --- Versements ---
  [NotificationType.AMBASSADOR_PAYOUT_VALIDATED]: PAYOUT_VALIDATED_TPL,
  [NotificationType.AMBASSADOR_PAYOUT_EXECUTED]: PAYOUT_EXECUTED_TPL,
  [NotificationType.AMBASSADOR_PAYOUT_REJECTED]: PAYOUT_REJECTED_TPL,
  [NotificationType.AMBASSADOR_PAYOUT_FAILED]: PAYOUT_FAILED_TPL,
  [NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED]:
    PAYMENT_DETAILS_CHANGED_TPL,

  // --- Organisations et équipes ---
  [NotificationType.ORGANIZATION_INVITATION_RECEIVED]: ORG_INVITATION_TPL,
  [NotificationType.ORGANIZATION_ACCESS_REVOKED]: ORG_ACCESS_REVOKED_TPL,
  [NotificationType.APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED]:
    ESTABLISHMENT_ASSOCIATION_TPL,

  // --- Candidatures, vue de l'organisation ---
  [NotificationType.APPLICATION_ADMISSION_ACCEPTED_ORG]:
    ADMISSION_ACCEPTED_ORG_TPL,
  [NotificationType.APPLICATION_AGREEMENT_FULLY_SIGNED_ORG]:
    AGREEMENT_SIGNED_ORG_TPL,

  // --- Apprenants ---
  [NotificationType.LEARNER_INVITED]: LEARNER_INVITED_TPL,

  // --- Partenariats ---
  [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED]:
    PARTNERSHIP_INFORMATION_REQUIRED_TPL,
  [NotificationType.PARTNERSHIP_APPROVED]: PARTNERSHIP_APPROVED_TPL,
  [NotificationType.PARTNERSHIP_REFUSED]: PARTNERSHIP_REFUSED_TPL,
  [NotificationType.PARTNERSHIP_SUSPENDED]: PARTNERSHIP_SUSPENDED_TPL,
  [NotificationType.PARTNERSHIP_TERMINATION_REQUESTED]:
    PARTNERSHIP_TERMINATION_REQUESTED_TPL,
  [NotificationType.PARTNERSHIP_TERMINATED]: PARTNERSHIP_TERMINATED_TPL,
};

export function hasEmailTemplate(type: NotificationType): boolean {
  return TEMPLATES[type] !== undefined;
}

export function listTypesWithTemplate(): NotificationType[] {
  return Object.keys(TEMPLATES) as NotificationType[];
}

export function renderEmailContent(
  type: NotificationType,
  vars: TemplateVars,
  language: Language,
): EmailContent | null {
  const template = TEMPLATES[type];
  if (!template) return null;
  return tidy(template[language](normalize(vars)));
}

// Rattrape les espaces laissées par une variable absente.
//
// Un gabarit écrit « la candidature ${REF(v)} a été acceptée » ; sans référence,
// il reste « la candidature  a été acceptée ». Le défaut est invisible en
// relecture et systématique en production, là où les métadonnées sont parfois
// incomplètes. Le corriger ICI plutôt que dans chaque gabarit garantit qu'aucun
// gabarit futur n'aura à y penser.
//
// Seules les suites d'espaces ordinaires sont réduites : les espaces insécables
// (fines ou non) portent du sens typographique et sont laissées intactes.
function tidy(content: EmailContent): EmailContent {
  const clean = (text: string) => text.replace(/ {2,}/g, ' ').trim();
  return {
    ...content,
    subject: clean(content.subject),
    heading: clean(content.heading),
    paragraphs: content.paragraphs.map(clean).filter((p) => p.length > 0),
    footnote: content.footnote ? clean(content.footnote) : content.footnote,
  };
}

// Dérive les variables de présentation depuis les métadonnées brutes.
//
// Les services métier envoient des FAITS — un montant en unité mineure, une
// devise — jamais du texte mis en forme. La mise en forme dépend de la langue,
// et un service métier ne connaît pas la langue du destinataire. C'est donc ici,
// au plus près du rendu, qu'elle se fait.
function normalize(vars: TemplateVars): TemplateVars {
  const raw = vars as Record<string, unknown>;
  const out: TemplateVars = { ...vars };

  if (typeof raw.amountMinor === 'number') {
    const currency = typeof raw.currency === 'string' ? raw.currency : 'XAF';
    // Convention maison : 100 unités mineures = 1 franc.
    out.amount = `${(raw.amountMinor / 100).toLocaleString('fr-FR')} ${currency}`;
  }

  // Une date brute ISO ne se montre pas telle quelle dans un e-mail.
  for (const key of [
    'effectiveAt',
    'startDate',
    'proposedAt',
    'decisionDate',
    'effectiveDate',
    'requestedAt',
    'actionDeadline',
  ] as const) {
    const value = raw[key];
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        out[key] = date.toLocaleDateString('fr-FR');
      }
    }
  }

  return out;
}
