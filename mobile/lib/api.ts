const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// L'API renvoie { message, error, statusCode } — message est parfois un tableau
// (erreurs de validation class-validator cumulées) : on ne garde que la première,
// le formulaire appelant n'affiche qu'un message d'erreur à la fois.
function extractMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === 'object' &&
    'message' in body &&
    (body as { message?: unknown }).message
  ) {
    const message = (body as { message: unknown }).message;
    if (Array.isArray(message)) return String(message[0] ?? fallback);
    if (typeof message === 'string') return message;
  }
  return fallback;
}

// L'access token dure 15 min (JWT_ACCESS_EXPIRES_IN) — sans ce mécanisme, toute
// action déclenchée après ce délai échouerait avec un 401 brut affiché tel quel
// dans l'écran appelant. auth-context.tsx enregistre ce handler au démarrage ;
// il rafraîchit via le refresh token et renvoie le nouvel access token (ou null
// si le refresh échoue aussi, auquel cas l'appelant reçoit le 401 d'origine et
// gère la déconnexion comme avant).
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
// Le refresh token tourne à chaque appel (rotateRefreshToken côté serveur) : si
// plusieurs requêtes expirent en même temps (ex. Promise.all au chargement d'un
// écran), il ne faut qu'UN seul rafraîchissement partagé — un deuxième appel
// concurrent utiliserait un refresh token déjà révoqué par le premier.
let refreshPromise: Promise<string | null> | null = null;

export function setRefreshHandler(handler: RefreshHandler | null) {
  refreshHandler = handler;
}

async function performRequest(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string },
): Promise<Response> {
  // FormData (upload de fichier) : ni JSON.stringify, ni Content-Type explicite —
  // fetch doit fixer lui-même le boundary multipart, un Content-Type manuel le casse.
  const isFormData = options.body instanceof FormData;
  return fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : {}),
    },
    body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  let response = await performRequest(path, options);

  if (response.status === 401 && options.accessToken && refreshHandler) {
    if (!refreshPromise) {
      refreshPromise = refreshHandler().finally(() => {
        refreshPromise = null;
      });
    }
    const newAccessToken = await refreshPromise;
    if (newAccessToken) {
      response = await performRequest(path, {
        ...options,
        accessToken: newAccessToken,
      });
    }
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(
      extractMessage(body, 'Une erreur est survenue. Réessayez.'),
      response.status,
    );
  }
  return body as T;
}

export type Language = 'FR' | 'EN' | 'ES' | 'AR';
export type AccountStatus =
  | 'PENDING_VERIFICATION'
  | 'AWAITING_PARENTAL_CONSENT'
  | 'ACTIVE'
  | 'DEACTIVATED'
  | 'PENDING_DELETION'
  | 'DELETED';

export type Sex = 'MALE' | 'FEMALE';

export interface RegisterInput {
  firstName: string;
  lastName: string;
  sex: Sex;
  phone: string;
  email?: string;
  cityOfResidence: string;
  countryOfResidence: string; // code ISO 3166-1 alpha-2, ex: CM
  password: string;
  language: Language;
  dateOfBirth: string; // ISO 8601
  parentPhone?: string;
  // Code d'un ambassadeur (point 10 des arbitrages du 2026-07-31). Un code inconnu,
  // expiré ou appartenant à un ambassadeur suspendu est ignoré EN SILENCE côté serveur :
  // une inscription ne doit jamais échouer à cause d'un code de parrainage.
  ambassadorCode?: string;
}

// Issue de la tentative de rattachement à un ambassadeur. Un STATUT, jamais une
// phrase : c'est le client qui la formule, dans la langue de l'utilisateur.
// `null` = aucun code saisi. À ne pas confondre avec CODE_NOT_RECOGNIZED, qui
// signale un code saisi PUIS rejeté et doit être annoncé à l'utilisateur.
export type AmbassadorAttributionStatus =
  | 'ATTRIBUTED'
  | 'CODE_NOT_RECOGNIZED'
  | 'SELF_REFERRAL_BLOCKED'
  | 'ALREADY_ATTRIBUTED';

export interface RegisterResult {
  userId: string;
  isMinor: boolean;
  message: string;
  ambassadorAttribution: AmbassadorAttributionStatus | null;
}

export interface VerifyOtpResult {
  lsId: string;
  status: AccountStatus;
  accessToken: string;
  refreshToken: string;
  requiresParentalLink: boolean;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

// CLAUDE.md §2 : double authentification — quand elle est activée sur le compte, login()
// ne renvoie aucun jeton, seulement un défi à confirmer via verifyLoginTwoFactor().
export type LoginResult =
  | { requiresTwoFactor: true; challengeToken: string }
  | { requiresTwoFactor: false; accessToken: string; refreshToken: string };

// Appareil/session connecté (CLAUDE.md §2) — révocable individuellement, effet immédiat.
export interface Session {
  id: string;
  deviceLabel: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export type LanguageLevel = 'BASIQUE' | 'INTERMEDIAIRE' | 'AVANCE' | 'COURANT' | 'NATIF';

export interface RoleCatalogItem {
  id: string;
  name: string;
  description: string | null;
}

export interface HeldRole {
  id: string; // id de la ligne UserRole, pas du Role
  roleId: string;
  isActive: boolean;
  assignedAt: string;
  revokedAt: string | null;
  role: RoleCatalogItem;
}

export interface Education {
  id: string;
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface Experience {
  id: string;
  organization: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

// Consentement actif requis avant publication (CLAUDE.md §5) : `visible` reste à false
// tant que le titulaire (ou son parent/tuteur s'il est mineur) ne l'a pas explicitement
// affichée — jamais publiée unilatéralement par l'organisation émettrice.
export interface Recommendation {
  id: string;
  receiverId: string;
  giverId: string;
  message: string;
  visible: boolean;
  createdAt: string;
}

export interface ProfileLanguageEntry {
  id: string;
  language: string;
  level: LanguageLevel;
}

export interface Profile {
  id: string;
  userId: string;
  fullName: string | null;
  headline: string | null;
  summary: string | null;
  activeRoleId: string | null;
  activeRole: RoleCatalogItem | null;
  educations: Education[];
  experiences: Experience[];
  languages: ProfileLanguageEntry[];
}

export interface UpdateProfileInput {
  fullName?: string;
  headline?: string;
  summary?: string;
}

export interface EducationInput {
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface ExperienceInput {
  organization: string;
  title: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export type DigitalSafeDocumentCategory =
  | 'IDENTITY'
  | 'DIPLOMA'
  | 'CONVENTION'
  | 'CERTIFICATE'
  | 'ADMISSION_LETTER'
  | 'INTERNSHIP_REPORT'
  | 'OTHER';

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DigitalSafeDocument {
  id: string;
  userId: string;
  category: DigitalSafeDocumentCategory;
  title: string;
  createdAt: string;
  latestVersion: DocumentVersion | null;
}

export type ShareTargetType = 'USER' | 'LINK';

export interface DigitalSafeShare {
  id: string;
  targetType: ShareTargetType;
  sharedWithUserId?: string | null;
  expiresAt: string | null;
  revokedAt?: string | null;
  createdAt?: string;
  token?: string; // uniquement à la création d'un partage LINK — jamais revu ensuite
  shareUrl?: string;
  qrCodeDataUrl?: string;
}

export interface CreateShareInput {
  targetType: ShareTargetType;
  sharedWithUserId?: string;
  expiresAt?: string;
}

export type DigitalSafeAccessAction =
  | 'VIEWED'
  | 'DOWNLOADED'
  | 'SHARE_CREATED'
  | 'SHARE_REVOKED';

export interface AccessLogEntry {
  id: string;
  action: DigitalSafeAccessAction;
  actorUserId: string | null;
  actor: { id: string; lsId: string } | null;
  shareId: string | null;
  createdAt: string;
}

// Forme native ({uri,name,type}, cf. expo-document-picker) ou web (File réel) — les
// deux se passent tels quels à FormData.append(), qui sait gérer les deux.
export type FilePart = { uri: string; name: string; type: string } | File;

function appendFilePart(formData: FormData, file: FilePart) {
  if (file instanceof File) {
    formData.append('file', file);
  } else {
    // React Native FormData accepte cette forme bien que ce ne soit pas un vrai Blob —
    // TypeScript ne le sait pas, d'où le cast.
    formData.append('file', file as unknown as Blob, file.name);
  }
}

// --- Opportunités (module 4) ---------------------------------------------------------------

export type OpportunityType =
  | 'ACADEMIC_INTERNSHIP'
  | 'PROFESSIONAL_INTERNSHIP'
  | 'SEASONAL'
  | 'WORK_STUDY'
  | 'VOLUNTEER'
  | 'TEMPORARY';

export type WorkMode = 'ON_SITE' | 'REMOTE' | 'HYBRID';

export type OpportunityStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'PAUSED'
  | 'FILLED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REPORTED'
  | 'SUSPENDED'
  | 'ARCHIVED';

export interface OpportunityOrganization {
  id: string;
  name: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface Opportunity {
  id: string;
  organizationId: string;
  title: string;
  description: string;
  type: OpportunityType;
  sector: string;
  country: string;
  city: string;
  workMode: WorkMode;
  relocationRequired: boolean;
  accommodationProvided: boolean;
  mobilityBenefits: string | null;
  status: OpportunityStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  organization: OpportunityOrganization;

  // POURQUOI cette offre remonte — jamais À QUEL POINT.
  //
  // Arbitrage du promoteur : « Le score numérique ne doit être affiché ni aux
  // candidats ni aux entreprises. Les candidats verront uniquement les raisons
  // de la correspondance. » L'API ne transmet donc que ces codes ; le score
  // reste de l'autre côté. Absent quand la recherche n'a pas de contexte de
  // profil (visiteur non connecté).
  matchReasons?: MatchReason[];
}

// Des CODES, traduits par l'application — jamais des phrases construites côté
// serveur : LES STAGIAIRES existe en cinq langues.
export type MatchReason =
  | 'SKILLS'
  | 'OCCUPATION'
  | 'LOCATION'
  | 'EDUCATION'
  | 'AVAILABILITY';

// --- Diagnostic de qualité d'une offre (côté entreprise) --------------------
//
// Le pendant des raisons de correspondance, pour celui qui publie. Ni score, ni
// rang, ni comparaison avec les autres offres : le service qui le calcule n'a
// accès à aucune autre offre, précisément pour ne pas pouvoir en parler.

export type QualityCheck =
  | 'SKILLS_DECLARED'
  | 'OCCUPATION_LINKED'
  | 'DESCRIPTION_SUBSTANTIAL'
  | 'TITLE_INFORMATIVE'
  | 'START_DATE_SET'
  | 'STILL_FRESH'
  | 'EDUCATION_STATED'
  | 'LOCATION_USABLE';

export type CheckVerdict = 'OK' | 'A_AMELIORER' | 'MANQUANT';

// Trois niveaux NOMMÉS, pas une note : une note se compare, donc se poursuit.
export type QualityLevel = 'INCOMPLETE' | 'PERFECTIBLE' | 'COMPLETE';

export interface QualityPoint {
  check: QualityCheck;
  verdict: CheckVerdict;
  recommendation?: QualityCheck;
}

export interface OfferQualityReport {
  opportunityId: string;
  level: QualityLevel;
  points: QualityPoint[];
}

// Les seuils d'âge d'un pays, tels que le serveur les publie.
//
// L'application les LIT, elle ne les décide pas : « nous ne devons pas figer
// les valeurs dans le code ». Un pays reconfiguré au back-office change le
// comportement de l'inscription sans nouvelle version sur les magasins.
export interface AgeThresholds {
  countryCode: string;
  minInternshipAge: number;
  minParentRequiredAge: number;
  civilMajorityAge: number;
  parentalInfoMaxAge: number;
  // Le pays n'est pas encore configuré : un repli protecteur s'applique.
  isFallback: boolean;
}

export interface SearchOpportunitiesInput {
  // Les MOTS-CLÉS. Le moteur les traite en trois passes : plein texte,
  // similarité (fautes de frappe), puis synonymes — « RH » trouve « ressources
  // humaines ». Le champ existait côté API sans que l'application l'envoie
  // jamais : tout ce moteur était inatteignable.
  q?: string;
  country?: string;
  city?: string;
  sector?: string;
  type?: OpportunityType;
  page?: number;
  limit?: number;
}

export interface SearchOpportunitiesResult {
  items: Opportunity[];
  total: number;
  page: number;
  limit: number;
}

export interface OpportunityFavorite {
  id: string;
  opportunityId: string;
  createdAt: string;
  opportunity: Opportunity;
}

export interface OpportunityAlert {
  id: string;
  country: string | null;
  city: string | null;
  sector: string | null;
  type: OpportunityType | null;
  createdAt: string;
}

export interface CreateAlertInput {
  country?: string;
  city?: string;
  sector?: string;
  type?: OpportunityType;
}

export type ReportCategory = 'HARASSMENT' | 'ABUSE' | 'DANGER' | 'FRAUD' | 'OTHER';

// --- Modération (panneau ADMIN) ------------------------------------------------------------

export type ReportStatus = 'OPEN' | 'REVIEWED' | 'CLOSED';

export interface ModerationReport {
  id: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  createdAt: string;
  targetOpportunityId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  reporter: {
    id: string;
    lsId: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  targetOpportunity: { id: string; title: string } | null;
  resolvedBy: { id: string; lsId: string | null } | null;
}

export interface ResolveReportInput {
  status: ReportStatus;
  note?: string;
}

// --- CRM Partenariats (menu "Nous contacter") ----------------------------------------------

export type PartnershipRequestOrgType =
  | 'COMPANY'
  | 'NGO'
  | 'PUBLIC_ADMINISTRATION'
  | 'INTERNATIONAL_ORGANIZATION'
  | 'UNIVERSITY'
  | 'SCHOOL'
  | 'TRAINING_CENTER'
  | 'CONSULTING_FIRM'
  | 'STARTUP'
  | 'OTHER';

export type PartnershipRequestReason =
  | 'BECOME_PARTNER'
  | 'PUBLISH_OPPORTUNITIES'
  | 'RECRUITMENT_CAMPAIGN'
  | 'MASS_RECRUITMENT'
  | 'PARTNERSHIP_AGREEMENT'
  | 'PLATFORM_DEMO'
  | 'TRAINING_SUPPORT'
  | 'COMMERCIAL_INFO'
  | 'TECHNICAL_SUPPORT'
  | 'OTHER';

export type PartnershipRequestStatus = 'NEW' | 'IN_PROGRESS' | 'PROCESSED' | 'CLOSED';

export type PartnershipRequestNoteType = 'NOTE' | 'STATUS_CHANGE' | 'ASSIGNMENT';

export interface PartnershipRequestContact {
  id: string;
  lsId: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface CreatePartnershipRequestInput {
  organizationName: string;
  organizationType: PartnershipRequestOrgType;
  contactName: string;
  contactTitle?: string;
  phone: string;
  email: string;
  country: string;
  city?: string;
  reason: PartnershipRequestReason;
  subject: string;
  description: string;
}

export interface PartnershipRequest {
  id: string;
  organizationName: string;
  organizationType: PartnershipRequestOrgType;
  contactName: string;
  contactTitle: string | null;
  phone: string;
  email: string;
  country: string;
  city: string | null;
  reason: PartnershipRequestReason;
  subject: string;
  description: string;
  status: PartnershipRequestStatus;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo: PartnershipRequestContact | null;
}

export interface PartnershipRequestNote {
  id: string;
  requestId: string;
  authorId: string;
  type: PartnershipRequestNoteType;
  content: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  author: PartnershipRequestContact;
}

export interface PartnershipRequestDetail extends PartnershipRequest {
  notes: PartnershipRequestNote[];
}

// --- Abonnements / Paiement -----------------------------------------------------------------

// Formules nommées par le promoteur le 2026-07-31. GRATUIT est l'état par défaut d'un
// compte, pas quelque chose qu'on souscrit : il n'apparaît jamais dans un formulaire de
// souscription. BUSINESS et INSTITUTION ne sont jamais choisis par le client non plus —
// ils se déduisent du type d'organisation, côté serveur.
export type SubscriptionPlan =
  | 'GRATUIT'
  | 'CARRIERE_SECURISEE'
  | 'CARRIERE_PLUS'
  | 'BUSINESS'
  | 'INSTITUTION';

// Les deux seules formules qu'un individu souscrit lui-même.
export type IndividualPlan = 'CARRIERE_SECURISEE' | 'CARRIERE_PLUS';

export const INDIVIDUAL_PLANS: IndividualPlan[] = [
  'CARRIERE_SECURISEE',
  'CARRIERE_PLUS',
];
export type SubscriptionBillingCycle = 'ONE_TIME' | 'QUARTERLY' | 'ANNUAL';
export type SubscriptionStatus =
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'PAYMENT_FAILED'
  | 'EXPIRED'
  | 'CANCELLED';
export type SubscriptionOriginType = 'SELF' | 'ORGANIZATION';

export interface Subscription {
  id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  beneficiaryUserId: string | null;
  beneficiaryOrganizationId: string | null;
  originType: SubscriptionOriginType;
  initiatingOrganizationId: string | null;
  parentRedirectRequested: boolean;
  billingCycle: SubscriptionBillingCycle;
  amountMinor: number;
  currency: string;
  countryCode: string;
  startedAt: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionBeneficiaryUser {
  id: string;
  lsId: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface SubscriptionBeneficiaryOrganization {
  id: string;
  name: string;
}

// Retourné uniquement par le back-office ADMIN (listAllSubscriptions) — les relations ne
// sont jamais chargées pour listMySubscriptions/getSubscription.
export interface AdminSubscription extends Subscription {
  beneficiaryUser: SubscriptionBeneficiaryUser | null;
  beneficiaryOrganization: SubscriptionBeneficiaryOrganization | null;
}

export interface SubscribeResult {
  subscription: {
    id: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    amountMinor: number;
    currency: string;
  };
  payment: {
    id: string;
    providerReference: string | null;
    instructions?: string;
  };
}

// --- Programme d'Ambassadeurs ---------------------------------------------------------------

export type AmbassadorStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
export type AmbassadorCategory = 'CAMPUS' | 'BUSINESS';
export type AmbassadorTier =
  | 'STANDARD'
  | 'BRONZE'
  | 'ARGENT'
  | 'OR'
  | 'PLATINE'
  | 'DIAMANT';
export type AttributionSource = 'CODE' | 'LINK' | 'QR' | 'ADMIN';
export type CommissionNature =
  | 'ACQUISITION'
  | 'NEW_SERVICE'
  | 'RENEWAL'
  | 'BONUS';
export type CommissionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PAYABLE'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED'
  | 'DISPUTED'
  | 'BLOCKED';
export type PayoutRequestStatus =
  | 'REQUESTED'
  | 'VALIDATED'
  | 'EXECUTED'
  | 'REJECTED'
  | 'CANCELLED';

export interface AmbassadorWallet {
  id: string;
  currency: string;
  // Commissions nées mais pas encore exigibles (période de sécurité en cours).
  pendingMinor: number;
  availableMinor: number;
  // Immobilisé dans une demande de versement en cours d'instruction.
  reservedMinor: number;
  paidTotalMinor: number;
}

export interface Ambassador {
  id: string;
  userId: string;
  status: AmbassadorStatus;
  code: string;
  categories: AmbassadorCategory[];
  tier: AmbassadorTier;
  countryCode: string;
  // Verrou du premier versement : tant que cette date est nulle, aucune demande de
  // versement n'est recevable (décision du promoteur du 2026-07-31).
  contractSignedAt: string | null;
  contractReference: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  createdAt: string;
  wallet: AmbassadorWallet | null;
}

export interface MyAmbassador extends Ambassador {
  referralCount: number;
  portfolioCount: number;
}

export interface PortfolioOrganization {
  id: string;
  name: string;
  sector: string | null;
  city: string;
  country: string;
}

export interface PortfolioEntry {
  id: string;
  organizationId: string;
  source: AttributionSource;
  attributedAt: string;
  // Dernier paiement CONFIRMÉ. Null si l'entreprise n'a jamais acheté : le compte à
  // rebours court alors depuis attributedAt.
  lastConfirmedPurchaseAt: string | null;
  // Échéance des douze mois. SEUL un achat confirmé la repousse — ni note, ni appel,
  // ni suivi déclaré (point 7 des arbitrages du 2026-07-31).
  expiresAt: string;
  warnedAt9m: string | null;
  warnedAt11m: string | null;
  organization: PortfolioOrganization;
}

export interface Commission {
  id: string;
  status: CommissionStatus;
  nature: CommissionNature;
  productType: 'SUBSCRIPTION' | 'SERVICE';
  productKey: string;
  // Figés au calcul, jamais recalculés : un relevé émis en janvier reste vrai en
  // décembre, même si le barème change entre-temps.
  basisAmountMinor: number;
  rateBasisPoints: number;
  amountMinor: number;
  currency: string;
  securityPeriodEndsAt: string;
  payableAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  type:
    | 'COMMISSION_ACCRUED'
    | 'COMMISSION_AVAILABLE'
    | 'COMMISSION_CANCELLED'
    | 'COMMISSION_REVERSED'
    | 'PAYOUT_RESERVED'
    | 'PAYOUT_RELEASED'
    | 'PAYOUT_EXECUTED'
    | 'ADJUSTMENT';
  amountMinor: number;
  availableAfterMinor: number;
  pendingAfterMinor: number;
  reason: string | null;
  createdAt: string;
}

export interface WalletLedger {
  wallet: AmbassadorWallet | null;
  transactions: WalletTransaction[];
}

export interface PayoutRequest {
  id: string;
  status: PayoutRequestStatus;
  amountMinor: number;
  currency: string;
  method: string;
  destinationLabel: string;
  requestedAt: string;
  validatedAt: string | null;
  executedAt: string | null;
  executionReference: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

// Réponse volontairement pauvre : savoir qu'un code est valide ne donne pas le droit
// de connaître la personne derrière (CLAUDE.md §1, niveau Public).
export type AmbassadorCodeCheck =
  | { valid: true; code: string }
  | { valid: false };

// --- Notifications internes -----------------------------------------------------------------

// Un seul type existe pour l'instant ; la liste s'étend au fil des besoins, un type inconnu
// côté client (notification plus récente que la version installée) doit s'afficher sans
// crasher plutôt que de bloquer l'écran — voir notifications.tsx.
export type NotificationType = 'PARTNERSHIP_REQUEST_NEW';

export type NotificationCategory =
  | 'APPLICATIONS'
  | 'INTERVIEWS'
  | 'INTERNSHIPS'
  | 'AGREEMENTS'
  | 'ORGANIZATIONS'
  | 'AMBASSADORS'
  | 'MENTORING'
  | 'LEGAL'
  | 'PAYMENTS'
  | 'SUBSCRIPTIONS'
  | 'PARTNERSHIPS'
  | 'ADMINISTRATION'
  | 'SECURITY'
  | 'SYSTEM';

export type NotificationChannelKind = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

// Pièce jointe : une RÉFÉRENCE vers le coffre-fort numérique, jamais un fichier.
// Le document reste chiffré dans le coffre, avec sa journalisation d'accès
// (CLAUDE.md §6).
export interface NotificationAttachment {
  id: string;
  digitalSafeDocumentId: string;
  label: string | null;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  category: NotificationCategory;
  metadata: Record<string, unknown> | null;
  // Chemin vers l'écran concerné, calculé par le serveur à la création. Null
  // quand la notification ne mène nulle part — mieux qu'un lien mort.
  linkPath: string | null;
  readAt: string | null;
  starredAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  attachments: NotificationAttachment[];
}

export interface NotificationPage {
  items: AppNotification[];
  // Pagination par curseur : l'historique grossit pendant la lecture, une
  // pagination par numéro de page ferait sauter des lignes.
  nextCursor: string | null;
}

export interface NotificationCounts {
  unreadTotal: number;
  unreadByCategory: Partial<Record<NotificationCategory, number>>;
}

export interface NotificationPreferenceRow {
  category: NotificationCategory;
  channel: NotificationChannelKind;
  enabled: boolean;
  // Catégories qui protègent ou qui engagent : l'interface les affiche
  // verrouillées plutôt que de laisser découvrir le refus à la soumission.
  locked: boolean;
}

// --- Candidatures (module 5) ---------------------------------------------------------------

export type ApplicationStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ADDITIONAL_DOCUMENT_REQUESTED'
  | 'INTERVIEW_PROPOSED'
  | 'INTERVIEW_CONFIRMED'
  | 'ADMISSION_LETTER_SENT'
  | 'ACCEPTED'
  | 'AWAITING_TRAVEL_CONSENT'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'COMPLETED';

export type ApplicationDocumentRequestStatus = 'PENDING' | 'FULFILLED';
export type ApplicationArtifactKind = 'ADMISSION_LETTER' | 'CONVENTION' | 'ATTESTATION';

export interface ApplicationOrganization {
  id: string;
  name: string;
  ownerId: string;
}

export interface ApplicationOpportunity {
  id: string;
  title: string;
  type: OpportunityType;
  relocationRequired: boolean;
  city: string;
  country: string;
}

export interface DossierSnapshotRecommendation {
  id: string;
  message: string;
  createdAt: string;
  giverId: string;
}

export interface DossierSnapshot {
  lsId: string | null;
  activeRole: string | null;
  headline: string | null;
  summary: string | null;
  education: Education[];
  experience: Experience[];
  languages: ProfileLanguageEntry[];
  recommendations: DossierSnapshotRecommendation[];
}

export interface ApplicationCandidate {
  id: string;
  lsId: string | null;
}

export type TravelConsentStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED';

export interface ApplicationTravelConsent {
  id: string;
  status: TravelConsentStatus;
  consentExpiresAt: string | null;
}

export interface Application {
  id: string;
  reference: string;
  candidateId: string;
  organizationId: string;
  opportunityId: string | null;
  status: ApplicationStatus;
  dossierSnapshot: DossierSnapshot;
  willingToRelocate: boolean | null;
  hasFamilyInDestination: boolean | null;
  interviewProposedAt: string | null;
  interviewMode: string | null;
  interviewLocation: string | null;
  interviewConfirmedAt: string | null;
  decisionAt: string | null;
  decisionNote: string | null;
  candidateSignedAt: string | null;
  candidateSignedName: string | null;
  organizationSignedAt: string | null;
  organizationSignedName: string | null;
  establishmentParticipationRequested: boolean;
  establishmentSignedAt: string | null;
  establishmentSignedName: string | null;
  startedAt: string | null;
  withdrawnAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  organization: ApplicationOrganization;
  opportunity: ApplicationOpportunity | null;
  candidate?: ApplicationCandidate;
  travelConsent: ApplicationTravelConsent | null;
}

export interface ApplicationStatusEvent {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ApplicationDocumentRequest {
  id: string;
  applicationId: string;
  requestedByUserId: string;
  description: string;
  status: ApplicationDocumentRequestStatus;
  fulfilledDigitalSafeDocumentId: string | null;
  fulfilledAt: string | null;
  createdAt: string;
}

export interface ApplicationArtifact {
  id: string;
  kind: ApplicationArtifactKind;
  createdAt: string;
}

export interface ApplicationDetail extends Application {
  history: ApplicationStatusEvent[];
  documentRequests: ApplicationDocumentRequest[];
  artifacts: ApplicationArtifact[];
}

export interface CreateApplicationInput {
  opportunityId?: string;
  organizationId?: string;
  willingToRelocate?: boolean;
  hasFamilyInDestination?: boolean;
}

// --- Entreprises / Organisations (module 6, côté ENTREPRISE) -------------------------------

export type OrganizationType = 'ENTREPRISE' | 'ETABLISSEMENT';
export type OrganizationVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Organization {
  id: string;
  type: OrganizationType;
  orgId: string | null;
  ownerId: string;
  name: string;
  sector: string | null;
  country: string;
  city: string;
  logoUrl: string | null;
  description: string | null;
  website: string | null;
  verificationStatus: OrganizationVerificationStatus;
  verifiedAt: string | null;
  partnershipSignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Origine déclarée d'une organisation. STATISTIQUE MARKETING UNIQUEMENT (point 11 des
// arbitrages du 2026-07-31) : répondre « AMBASSADOR » ici ne rattache personne et
// n'ouvre aucun droit à commission. Seul `ambassadorCode` crée une attribution.
export type OrganizationAcquisitionSource =
  | 'AMBASSADOR'
  | 'INTERNET'
  | 'SOCIAL_MEDIA'
  | 'UNIVERSITY'
  | 'SCHOOL'
  | 'TRAINING_CENTER'
  | 'PARTNER_COMPANY'
  | 'TRADE_SHOW'
  | 'ADVERTISING'
  | 'RECOMMENDATION'
  | 'OTHER';

export const ACQUISITION_SOURCES: OrganizationAcquisitionSource[] = [
  'AMBASSADOR',
  'INTERNET',
  'SOCIAL_MEDIA',
  'UNIVERSITY',
  'SCHOOL',
  'TRAINING_CENTER',
  'PARTNER_COMPANY',
  'TRADE_SHOW',
  'ADVERTISING',
  'RECOMMENDATION',
  'OTHER',
];

export interface CreateOrganizationInput {
  name: string;
  sector?: string;
  country: string;
  city: string;
  // Déclaratif, à visée statistique. Ne déclenche jamais de commission.
  acquisitionSource?: OrganizationAcquisitionSource;
  acquisitionSourceNote?: string;
  // Le SEUL mécanisme d'attribution. Un code invalide est ignoré en silence côté
  // serveur : il ne doit jamais faire échouer la création de l'organisation.
  ambassadorCode?: string;
}

export interface UpdateOrganizationPageInput {
  logoUrl?: string;
  description?: string;
  website?: string;
}

export interface CreateOpportunityInput {
  organizationId: string;
  title: string;
  description: string;
  type: OpportunityType;
  sector: string;
  country: string;
  city: string;
  workMode?: WorkMode;
  relocationRequired?: boolean;
  accommodationProvided?: boolean;
  mobilityBenefits?: string;
}

export type UpdateOpportunityInput = Partial<Omit<CreateOpportunityInput, 'organizationId'>>;

export interface ListReceivedFilters {
  organizationId?: string;
  opportunityId?: string;
  status?: ApplicationStatus;
}

export interface ProposeInterviewInput {
  proposedAt: string;
  mode: string;
  location?: string;
}

export type ApplicationDecisionValue = 'ACCEPTED' | 'REJECTED';

export interface DecideApplicationInput {
  decision: ApplicationDecisionValue;
  note?: string;
}

// --- Équipe (module 6, FR-ORG-002) ----------------------------------------------------------

export type OrganizationMemberRole = 'ADMIN' | 'RECRUITER' | 'VIEWER';
export type OrganizationMemberStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface OrganizationMemberUser {
  id: string;
  lsId: string | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invitedAt: string;
  joinedAt: string | null;
  revokedAt: string | null;
  user: OrganizationMemberUser;
}

export interface OrganizationInvitationOrganization {
  id: string;
  name: string;
  orgId: string | null;
}

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invitedAt: string;
  joinedAt: string | null;
  revokedAt: string | null;
  organization: OrganizationInvitationOrganization;
}

export interface InviteMemberInput {
  phone: string;
  role: OrganizationMemberRole;
}

// --- Besoins spéciaux (FR-M4-002 / module 6) ------------------------------------------------

export type NeedRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type NeedRequestType = 'SEASONAL' | 'VOLUNTEER' | 'TEMPORARY';

export interface OrganizationNeedRequest {
  id: string;
  organizationId: string;
  type: NeedRequestType;
  quantity: number;
  description: string;
  status: NeedRequestStatus;
  adminNote: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface SubmitNeedRequestInput {
  type: NeedRequestType;
  quantity: number;
  description: string;
}

// --- Établissements (module 7) --------------------------------------------------------------

export type LearnerStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface LearnerUser {
  id: string;
  lsId: string | null;
}

export interface EstablishmentSummary {
  id: string;
  name: string;
  orgId: string | null;
}

export interface EstablishmentLearner {
  id: string;
  establishmentId: string;
  userId: string;
  status: LearnerStatus;
  invitedAt: string;
  joinedAt: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  user: LearnerUser;
}

export interface EstablishmentEnrollment {
  id: string;
  establishmentId: string;
  userId: string;
  status: LearnerStatus;
  invitedAt: string;
  joinedAt: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  establishment: EstablishmentSummary;
}

export interface InviteLearnerInput {
  phone: string;
}

export type InternshipCampaignStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

export interface InternshipCampaign {
  id: string;
  establishmentId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: InternshipCampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface LearnerApplicationSummary {
  id: string;
  reference: string;
  status: ApplicationStatus;
  candidateId: string;
  candidate: LearnerUser;
  organization: { id: string; name: string };
  opportunity: { id: string; title: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  establishmentParticipationRequested: boolean;
  establishmentSignedAt: string | null;
  establishmentSignedName: string | null;
}

export type InternshipReportStatus = 'SUBMITTED' | 'NEEDS_REVISION' | 'VALIDATED';

export interface InternshipReportApplication {
  id: string;
  reference: string;
  candidateId: string;
  candidate: LearnerUser;
}

export interface InternshipReportWithApplication {
  id: string;
  applicationId: string;
  digitalSafeDocumentId: string;
  status: InternshipReportStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  createdAt: string;
  updatedAt: string;
  application: InternshipReportApplication;
}

export type ReviewReportOutcome = 'VALIDATED' | 'NEEDS_REVISION';

export interface ReviewReportInput {
  status: ReviewReportOutcome;
  note?: string;
}

export interface EstablishmentDashboard {
  totalLearners: number;
  verifiedLearners: number;
  totalApplications: number;
  learnersWithInternship: number;
  completedInternships: number;
  insertionRate: number;
}

export interface PartnerCompany {
  id: string;
  orgId: string | null;
  name: string;
  sector: string | null;
  logoUrl: string | null;
}

// Les booléens sont acceptés et sérialisés en "true"/"false" : côté serveur, le
// DTO les valide comme chaînes puis les convertit. Sans cette conversion
// explicite, `Boolean('false')` vaudrait `true` — le piège classique, silencieux,
// qui renverrait ici la liste complète au lieu des seules non lues.
function buildQueryString(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return `?${search.toString()}`;
}

export const api = {
  register: (input: RegisterInput) =>
    request<RegisterResult>('/auth/register', { method: 'POST', body: input }),

  verifyOtp: (phone: string, code: string) =>
    request<VerifyOtpResult>('/auth/verify-otp', {
      method: 'POST',
      body: { phone, code },
    }),

  login: (identifier: string, password: string) =>
    request<LoginResult>('/auth/login', {
      method: 'POST',
      body: { identifier, password },
    }),

  verifyLoginTwoFactor: (challengeToken: string, code: string) =>
    request<RefreshResult>('/auth/2fa/verify-login', {
      method: 'POST',
      body: { challengeToken, code },
    }),

  // Réponse identique que le numéro existe ou non (pas d'énumération de comptes côté
  // serveur) — l'écran appelant affiche toujours le même message de confirmation.
  forgotPassword: (phone: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { phone },
    }),

  resetPassword: (phone: string, code: string, newPassword: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { phone, code, newPassword },
    }),

  getTwoFactorStatus: (accessToken: string) =>
    request<{ enabled: boolean }>('/auth/2fa/status', { accessToken }),

  enableTwoFactor: (accessToken: string) =>
    request<{ message: string }>('/auth/2fa/enable', {
      method: 'POST',
      accessToken,
    }),

  disableTwoFactor: (accessToken: string, password: string) =>
    request<{ message: string }>('/auth/2fa/disable', {
      method: 'POST',
      body: { password },
      accessToken,
    }),

  listSessions: (accessToken: string) =>
    request<Session[]>('/auth/sessions', { accessToken }),

  revokeSession: (accessToken: string, sessionId: string) =>
    request<{ message: string }>(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      accessToken,
    }),

  refresh: (refreshToken: string) =>
    request<RefreshResult>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    }),

  logout: (refreshToken: string) =>
    request<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: { refreshToken },
    }),

  getMyProfile: (accessToken: string) =>
    request<Profile>('/profiles/me', { accessToken }),

  updateMyProfile: (accessToken: string, input: UpdateProfileInput) =>
    request<Profile>('/profiles/me', {
      method: 'PATCH',
      body: input,
      accessToken,
    }),

  switchActiveRole: (accessToken: string, roleId: string) =>
    request<Profile>('/profiles/me/active-role', {
      method: 'PATCH',
      body: { roleId },
      accessToken,
    }),

  addEducation: (accessToken: string, input: EducationInput) =>
    request<Education>('/profiles/me/education', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  updateEducation: (accessToken: string, id: string, input: EducationInput) =>
    request<Education>(`/profiles/me/education/${id}`, {
      method: 'PATCH',
      body: input,
      accessToken,
    }),

  removeEducation: (accessToken: string, id: string) =>
    request<void>(`/profiles/me/education/${id}`, {
      method: 'DELETE',
      accessToken,
    }),

  addExperience: (accessToken: string, input: ExperienceInput) =>
    request<Experience>('/profiles/me/experience', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  updateExperience: (accessToken: string, id: string, input: ExperienceInput) =>
    request<Experience>(`/profiles/me/experience/${id}`, {
      method: 'PATCH',
      body: input,
      accessToken,
    }),

  removeExperience: (accessToken: string, id: string) =>
    request<void>(`/profiles/me/experience/${id}`, {
      method: 'DELETE',
      accessToken,
    }),

  upsertLanguage: (accessToken: string, language: string, level: LanguageLevel) =>
    request<ProfileLanguageEntry>('/profiles/me/languages', {
      method: 'PUT',
      body: { language, level },
      accessToken,
    }),

  removeLanguage: (accessToken: string, language: string) =>
    request<void>(`/profiles/me/languages/${encodeURIComponent(language)}`, {
      method: 'DELETE',
      accessToken,
    }),

  getRoleCatalog: () => request<RoleCatalogItem[]>('/auth/roles/catalog'),

  getRoleHistory: (accessToken: string) =>
    request<HeldRole[]>('/auth/roles/history', { accessToken }),

  assignRole: (accessToken: string, roleId: string) =>
    request<HeldRole>('/auth/roles', {
      method: 'POST',
      body: { roleId },
      accessToken,
    }),

  // --- Digital Safe (module 3) -----------------------------------------------------------

  listDocuments: (accessToken: string) =>
    request<DigitalSafeDocument[]>('/digital-safe/documents', { accessToken }),

  createDocument: (
    accessToken: string,
    category: DigitalSafeDocumentCategory,
    title: string,
    file: FilePart,
  ) => {
    const body = new FormData();
    body.append('category', category);
    body.append('title', title);
    appendFilePart(body, file);
    return request<DigitalSafeDocument>('/digital-safe/documents', {
      method: 'POST',
      body,
      accessToken,
    });
  },

  addDocumentVersion: (accessToken: string, documentId: string, file: FilePart) => {
    const body = new FormData();
    appendFilePart(body, file);
    return request<DocumentVersion>(`/digital-safe/documents/${documentId}/versions`, {
      method: 'POST',
      body,
      accessToken,
    });
  },

  listDocumentVersions: (accessToken: string, documentId: string) =>
    request<DocumentVersion[]>(`/digital-safe/documents/${documentId}/versions`, {
      accessToken,
    }),

  renameDocument: (accessToken: string, documentId: string, title: string) =>
    request<{ id: string; title: string }>(`/digital-safe/documents/${documentId}`, {
      method: 'PATCH',
      body: { title },
      accessToken,
    }),

  removeDocument: (accessToken: string, documentId: string) =>
    request<void>(`/digital-safe/documents/${documentId}`, {
      method: 'DELETE',
      accessToken,
    }),

  getAccessLog: (accessToken: string, documentId: string) =>
    request<AccessLogEntry[]>(`/digital-safe/documents/${documentId}/access-log`, {
      accessToken,
    }),

  listShares: (accessToken: string, documentId: string) =>
    request<DigitalSafeShare[]>(`/digital-safe/documents/${documentId}/shares`, {
      accessToken,
    }),

  createShare: (accessToken: string, documentId: string, input: CreateShareInput) =>
    request<DigitalSafeShare>(`/digital-safe/documents/${documentId}/shares`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  revokeShare: (accessToken: string, documentId: string, shareId: string) =>
    request<void>(`/digital-safe/documents/${documentId}/shares/${shareId}`, {
      method: 'DELETE',
      accessToken,
    }),

  // Distinct de request() : la réponse est le fichier binaire lui-même, pas du JSON —
  // le bénéficie du rafraîchissement de token nécessite malgré tout la même logique.
  downloadDocument: async (
    accessToken: string,
    documentId: string,
  ): Promise<{ blob: Blob; fileName: string }> => {
    const path = `/digital-safe/documents/${documentId}/download`;
    let response = await performRequest(path, { accessToken });
    if (response.status === 401 && refreshHandler) {
      if (!refreshPromise) {
        refreshPromise = refreshHandler().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;
      if (newAccessToken) {
        response = await performRequest(path, { accessToken: newAccessToken });
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        extractMessage(body, 'Téléchargement impossible.'),
        response.status,
      );
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : 'document';
    const blob = await response.blob();
    return { blob, fileName };
  },

  // Public — la recherche d'offres ne requiert pas de connexion (FR-M4-003/004).
  searchOpportunities: (query: SearchOpportunitiesInput) =>
    request<SearchOpportunitiesResult>(
      `/opportunities${buildQueryString(query as Record<string, string | number | undefined>)}`,
    ),

  // Les seuils d'âge d'un pays. PUBLIQUE, et volontairement : l'écran
  // d'inscription doit les connaître avant toute création de compte, sinon il
  // code un seuil en dur — ce qu'il faisait.
  //
  // On envoie le PAYS, jamais la date de naissance : celle-ci ne quitte
  // l'appareil qu'à l'inscription proprement dite.
  getAgeThresholds: (countryCode: string) =>
    request<AgeThresholds>(`/auth/age-thresholds/${countryCode}`),

  getOpportunity: (id: string, accessToken?: string) =>
    request<Opportunity>(`/opportunities/${id}`, { accessToken }),

  // Réservé aux membres de l'organisation qui publie l'offre : le diagnostic
  // dit ce qui manque à une offre, ce qu'un concurrent n'a pas à savoir.
  getOpportunityQuality: (accessToken: string, id: string) =>
    request<OfferQualityReport>(`/opportunities/${id}/quality`, { accessToken }),

  reportOpportunity: (
    accessToken: string,
    id: string,
    category: ReportCategory,
    description: string,
  ) =>
    request<{ id: string }>(`/opportunities/${id}/report`, {
      method: 'POST',
      body: { category, description },
      accessToken,
    }),

  // Panneau de modération — réservé ADMIN (2FA requise côté serveur).
  listAllReports: (accessToken: string, status?: ReportStatus) =>
    request<ModerationReport[]>(`/reports${buildQueryString({ status })}`, {
      accessToken,
    }),

  resolveReport: (accessToken: string, id: string, input: ResolveReportInput) =>
    request<ModerationReport>(`/reports/${id}/resolve`, {
      method: 'PATCH',
      body: input,
      accessToken,
    }),

  listFavorites: (accessToken: string) =>
    request<OpportunityFavorite[]>('/opportunities/favorites', { accessToken }),

  addFavorite: (accessToken: string, opportunityId: string) =>
    request<{ id: string }>(`/opportunities/favorites/${opportunityId}`, {
      method: 'POST',
      accessToken,
    }),

  removeFavorite: (accessToken: string, opportunityId: string) =>
    request<void>(`/opportunities/favorites/${opportunityId}`, {
      method: 'DELETE',
      accessToken,
    }),

  listAlerts: (accessToken: string) =>
    request<OpportunityAlert[]>('/opportunities/alerts', { accessToken }),

  createAlert: (accessToken: string, input: CreateAlertInput) =>
    request<OpportunityAlert>('/opportunities/alerts', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  removeAlert: (accessToken: string, id: string) =>
    request<void>(`/opportunities/alerts/${id}`, {
      method: 'DELETE',
      accessToken,
    }),

  getAlertMatches: (accessToken: string, id: string) =>
    request<Opportunity[]>(`/opportunities/alerts/${id}/matches`, { accessToken }),

  // --- Candidatures (module 5, côté candidat) ---------------------------------------------

  previewDossier: (accessToken: string) =>
    request<unknown>('/applications/preview', { accessToken }),

  createApplication: (accessToken: string, input: CreateApplicationInput) =>
    request<Application>('/applications', { method: 'POST', body: input, accessToken }),

  listMyApplications: (accessToken: string) =>
    request<Application[]>('/applications/mine', { accessToken }),

  getApplication: (accessToken: string, id: string) =>
    request<ApplicationDetail>(`/applications/${id}`, { accessToken }),

  fulfillDocumentRequest: (
    accessToken: string,
    applicationId: string,
    requestId: string,
    digitalSafeDocumentId: string,
  ) =>
    request<void>(`/applications/${applicationId}/document-requests/${requestId}/fulfill`, {
      method: 'POST',
      body: { digitalSafeDocumentId },
      accessToken,
    }),

  confirmInterview: (accessToken: string, applicationId: string) =>
    request<void>(`/applications/${applicationId}/interview/confirm`, {
      method: 'POST',
      accessToken,
    }),

  acceptAdmissionLetter: (accessToken: string, applicationId: string) =>
    request<void>(`/applications/${applicationId}/admission-letter/accept`, {
      method: 'POST',
      accessToken,
    }),

  signApplication: (accessToken: string, applicationId: string, name: string) =>
    request<void>(`/applications/${applicationId}/sign`, {
      method: 'POST',
      body: { name },
      accessToken,
    }),

  withdrawApplication: (accessToken: string, applicationId: string) =>
    request<void>(`/applications/${applicationId}/withdraw`, {
      method: 'POST',
      accessToken,
    }),

  // Public : le parent/tuteur n'a pas forcément de compte — seule la connaissance du
  // code envoyé par SMS fait foi. Utilisable aussi bien par le candidat connecté (à qui
  // le parent communique le code) que par un tiers sans session.
  confirmTravelConsent: (travelConsentId: string, code: string) =>
    request<{ message: string }>(`/applications/travel-consent/${travelConsentId}/confirm`, {
      method: 'POST',
      body: { code },
    }),

  submitInternshipReport: (
    accessToken: string,
    applicationId: string,
    digitalSafeDocumentId: string,
  ) =>
    request<{ id: string }>(`/applications/${applicationId}/report`, {
      method: 'POST',
      body: { digitalSafeDocumentId },
      accessToken,
    }),

  // Même logique de rafraîchissement que downloadDocument (Digital Safe) : la réponse
  // est un fichier binaire, pas du JSON.
  downloadArtifact: async (
    accessToken: string,
    applicationId: string,
    kind: ApplicationArtifactKind,
  ): Promise<{ blob: Blob; fileName: string }> => {
    const path = `/applications/${applicationId}/artifacts/${kind}`;
    let response = await performRequest(path, { accessToken });
    if (response.status === 401 && refreshHandler) {
      if (!refreshPromise) {
        refreshPromise = refreshHandler().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;
      if (newAccessToken) {
        response = await performRequest(path, { accessToken: newAccessToken });
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        extractMessage(body, 'Téléchargement impossible.'),
        response.status,
      );
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : 'document';
    const blob = await response.blob();
    return { blob, fileName };
  },

  // --- Entreprises / Organisations (module 6, côté ENTREPRISE) ---------------------------

  listMyOrganizations: (accessToken: string) =>
    request<Organization[]>('/organizations/mine', { accessToken }),

  createOrganization: (accessToken: string, input: CreateOrganizationInput) =>
    request<Organization>('/organizations', { method: 'POST', body: input, accessToken }),

  updateOrganizationPage: (
    accessToken: string,
    organizationId: string,
    input: UpdateOrganizationPageInput,
  ) =>
    request<Organization>(`/organizations/${organizationId}/page`, {
      method: 'PATCH',
      body: input,
      accessToken,
    }),

  // --- Offres (module 4, côté organisation) -----------------------------------------------

  listMyOpportunities: (accessToken: string) =>
    request<Opportunity[]>('/opportunities/mine', { accessToken }),

  createOpportunity: (accessToken: string, input: CreateOpportunityInput) =>
    request<Opportunity>('/opportunities', { method: 'POST', body: input, accessToken }),

  updateOpportunity: (accessToken: string, id: string, input: UpdateOpportunityInput) =>
    request<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body: input, accessToken }),

  publishOpportunity: (accessToken: string, id: string) =>
    request<void>(`/opportunities/${id}/publish`, { method: 'POST', accessToken }),

  pauseOpportunity: (accessToken: string, id: string) =>
    request<void>(`/opportunities/${id}/pause`, { method: 'POST', accessToken }),

  resumeOpportunity: (accessToken: string, id: string) =>
    request<void>(`/opportunities/${id}/resume`, { method: 'POST', accessToken }),

  fillOpportunity: (accessToken: string, id: string) =>
    request<void>(`/opportunities/${id}/fill`, { method: 'POST', accessToken }),

  cancelOpportunity: (accessToken: string, id: string) =>
    request<void>(`/opportunities/${id}/cancel`, { method: 'POST', accessToken }),

  // --- Candidatures reçues (module 5, côté organisation) -----------------------------------

  listReceivedApplications: (accessToken: string, filters: ListReceivedFilters = {}) =>
    request<Application[]>(
      `/applications/received${buildQueryString(filters as Record<string, string | undefined>)}`,
      { accessToken },
    ),

  markApplicationUnderReview: (accessToken: string, applicationId: string) =>
    request<void>(`/applications/${applicationId}/review`, {
      method: 'POST',
      accessToken,
    }),

  requestApplicationDocument: (accessToken: string, applicationId: string, description: string) =>
    request<ApplicationDocumentRequest>(`/applications/${applicationId}/document-requests`, {
      method: 'POST',
      body: { description },
      accessToken,
    }),

  proposeInterview: (accessToken: string, applicationId: string, input: ProposeInterviewInput) =>
    request<void>(`/applications/${applicationId}/interview`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  decideApplication: (accessToken: string, applicationId: string, input: DecideApplicationInput) =>
    request<void>(`/applications/${applicationId}/decision`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  completeApplication: (accessToken: string, applicationId: string) =>
    request<void>(`/applications/${applicationId}/complete`, {
      method: 'POST',
      accessToken,
    }),

  recommendCandidate: (accessToken: string, applicationId: string, message: string) =>
    request<{ id: string }>(`/applications/${applicationId}/recommend`, {
      method: 'POST',
      body: { message },
      accessToken,
    }),

  // --- Recommandations reçues (FR-PRO-011) — consentement actif avant publication ---------

  listRecommendations: (accessToken: string, userId: string) =>
    request<Recommendation[]>(`/profiles/${userId}/recommendations`, { accessToken }),

  showRecommendation: (accessToken: string, recommendationId: string) =>
    request<Recommendation>(`/profiles/me/recommendations/${recommendationId}/show`, {
      method: 'PATCH',
      accessToken,
    }),

  hideRecommendation: (accessToken: string, recommendationId: string) =>
    request<Recommendation>(`/profiles/me/recommendations/${recommendationId}/hide`, {
      method: 'PATCH',
      accessToken,
    }),

  // --- Équipe (module 6, FR-ORG-002) -------------------------------------------------------

  listTeam: (accessToken: string, organizationId: string) =>
    request<OrganizationMember[]>(`/organizations/${organizationId}/members`, { accessToken }),

  inviteMember: (accessToken: string, organizationId: string, input: InviteMemberInput) =>
    request<OrganizationMember>(`/organizations/${organizationId}/members`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  listMyInvitations: (accessToken: string) =>
    request<OrganizationInvitation[]>('/organizations/invitations', { accessToken }),

  acceptInvitation: (accessToken: string, memberId: string) =>
    request<void>(`/organizations/members/${memberId}/accept`, {
      method: 'POST',
      accessToken,
    }),

  declineInvitation: (accessToken: string, memberId: string) =>
    request<void>(`/organizations/members/${memberId}/decline`, {
      method: 'POST',
      accessToken,
    }),

  revokeMember: (accessToken: string, organizationId: string, memberId: string) =>
    request<void>(`/organizations/${organizationId}/members/${memberId}/revoke`, {
      method: 'POST',
      accessToken,
    }),

  // --- Besoins spéciaux (FR-M4-002 / module 6) ---------------------------------------------

  listNeedRequests: (accessToken: string, organizationId: string) =>
    request<OrganizationNeedRequest[]>(`/organizations/${organizationId}/need-requests`, {
      accessToken,
    }),

  submitNeedRequest: (
    accessToken: string,
    organizationId: string,
    input: SubmitNeedRequestInput,
  ) =>
    request<OrganizationNeedRequest>(`/organizations/${organizationId}/need-requests`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  // --- Établissements (module 7, côté établissement) ---------------------------------------

  listLearners: (accessToken: string, establishmentId: string) =>
    request<EstablishmentLearner[]>(`/organizations/${establishmentId}/learners`, {
      accessToken,
    }),

  inviteLearner: (accessToken: string, establishmentId: string, input: InviteLearnerInput) =>
    request<EstablishmentLearner>(`/organizations/${establishmentId}/learners`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  verifyLearner: (accessToken: string, establishmentId: string, learnerId: string) =>
    request<void>(`/organizations/${establishmentId}/learners/${learnerId}/verify`, {
      method: 'POST',
      accessToken,
    }),

  revokeLearner: (accessToken: string, establishmentId: string, learnerId: string) =>
    request<void>(`/organizations/${establishmentId}/learners/${learnerId}/revoke`, {
      method: 'POST',
      accessToken,
    }),

  listCampaigns: (accessToken: string, establishmentId: string) =>
    request<InternshipCampaign[]>(`/organizations/${establishmentId}/campaigns`, {
      accessToken,
    }),

  createCampaign: (accessToken: string, establishmentId: string, input: CreateCampaignInput) =>
    request<InternshipCampaign>(`/organizations/${establishmentId}/campaigns`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  updateCampaignStatus: (
    accessToken: string,
    establishmentId: string,
    campaignId: string,
    status: InternshipCampaignStatus,
  ) =>
    request<InternshipCampaign>(`/organizations/${establishmentId}/campaigns/${campaignId}/status`, {
      method: 'POST',
      body: { status },
      accessToken,
    }),

  listLearnerApplications: (accessToken: string, establishmentId: string) =>
    request<LearnerApplicationSummary[]>(`/organizations/${establishmentId}/learner-applications`, {
      accessToken,
    }),

  listEstablishmentReports: (accessToken: string, establishmentId: string) =>
    request<InternshipReportWithApplication[]>(`/organizations/${establishmentId}/reports`, {
      accessToken,
    }),

  reviewReport: (
    accessToken: string,
    establishmentId: string,
    applicationId: string,
    input: ReviewReportInput,
  ) =>
    request<InternshipReportWithApplication>(
      `/organizations/${establishmentId}/reports/${applicationId}/review`,
      { method: 'POST', body: input, accessToken },
    ),

  getEstablishmentDashboard: (accessToken: string, establishmentId: string) =>
    request<EstablishmentDashboard>(`/organizations/${establishmentId}/dashboard`, {
      accessToken,
    }),

  listPartnerCompanies: (accessToken: string, establishmentId: string) =>
    request<PartnerCompany[]>(`/organizations/${establishmentId}/partner-companies`, {
      accessToken,
    }),

  // --- Établissements (module 7, côté apprenant) -------------------------------------------

  listMyEnrollments: (accessToken: string) =>
    request<EstablishmentEnrollment[]>('/establishments/enrollments', { accessToken }),

  acceptEnrollment: (accessToken: string, learnerId: string) =>
    request<void>(`/establishments/enrollments/${learnerId}/accept`, {
      method: 'POST',
      accessToken,
    }),

  declineEnrollment: (accessToken: string, learnerId: string) =>
    request<void>(`/establishments/enrollments/${learnerId}/decline`, {
      method: 'POST',
      accessToken,
    }),

  // --- CRM Partenariats (menu "Nous contacter") ---------------------------------------------

  // Public — formulaire accessible sans compte (entreprises, ONG, administrations,
  // organisations internationales, universités, écoles, centres de formation...).
  submitPartnershipRequest: (input: CreatePartnershipRequestInput) =>
    request<{ id: string; status: PartnershipRequestStatus; createdAt: string }>(
      '/partnership-requests',
      { method: 'POST', body: input },
    ),

  // Back-office CRM — réservé ADMIN.
  listPartnershipRequests: (
    accessToken: string,
    filters?: {
      status?: PartnershipRequestStatus;
      reason?: PartnershipRequestReason;
      assignedToId?: string;
      q?: string;
    },
  ) =>
    request<PartnershipRequest[]>(
      `/partnership-requests${buildQueryString(filters ?? {})}`,
      { accessToken },
    ),

  getPartnershipRequest: (accessToken: string, id: string) =>
    request<PartnershipRequestDetail>(`/partnership-requests/${id}`, { accessToken }),

  listAssignablePartnershipUsers: (accessToken: string) =>
    request<PartnershipRequestContact[]>('/partnership-requests/assignable-users', {
      accessToken,
    }),

  updatePartnershipRequestStatus: (
    accessToken: string,
    id: string,
    status: PartnershipRequestStatus,
  ) =>
    request<PartnershipRequestDetail>(`/partnership-requests/${id}/status`, {
      method: 'PATCH',
      body: { status },
      accessToken,
    }),

  assignPartnershipRequest: (
    accessToken: string,
    id: string,
    assigneeId: string | null,
  ) =>
    request<PartnershipRequestDetail>(`/partnership-requests/${id}/assign`, {
      method: 'PATCH',
      body: { assigneeId },
      accessToken,
    }),

  addPartnershipRequestNote: (accessToken: string, id: string, content: string) =>
    request<PartnershipRequestDetail>(`/partnership-requests/${id}/notes`, {
      method: 'POST',
      body: { content },
      accessToken,
    }),

  // --- Centre de Notifications ---------------------------------------------------------------

  listNotifications: (
    accessToken: string,
    filters?: {
      category?: NotificationCategory;
      unreadOnly?: boolean;
      starredOnly?: boolean;
      includeArchived?: boolean;
      search?: string;
      cursor?: string;
      limit?: number;
    },
  ) =>
    request<NotificationPage>(
      `/notifications/mine${buildQueryString(filters ?? {})}`,
      { accessToken },
    ),

  notificationCounts: (accessToken: string) =>
    request<NotificationCounts>('/notifications/counts', { accessToken }),

  markNotificationRead: (accessToken: string, id: string) =>
    request<AppNotification>(`/notifications/${id}/read`, {
      method: 'PATCH',
      accessToken,
    }),

  markNotificationUnread: (accessToken: string, id: string) =>
    request<AppNotification>(`/notifications/${id}/unread`, {
      method: 'PATCH',
      accessToken,
    }),

  markAllNotificationsRead: (
    accessToken: string,
    category?: NotificationCategory,
  ) =>
    request<{ updated: number }>('/notifications/read-all', {
      method: 'POST',
      body: category ? { category } : {},
      accessToken,
    }),

  setNotificationStarred: (
    accessToken: string,
    id: string,
    starred: boolean,
  ) =>
    request<AppNotification>(
      `/notifications/${id}/${starred ? 'star' : 'unstar'}`,
      { method: 'PATCH', accessToken },
    ),

  // Archiver n'est pas supprimer : la notification reste retrouvable avec
  // includeArchived. L'historique complet ne souffre aucune suppression.
  setNotificationArchived: (
    accessToken: string,
    id: string,
    archived: boolean,
  ) =>
    request<AppNotification>(
      `/notifications/${id}/${archived ? 'archive' : 'unarchive'}`,
      { method: 'PATCH', accessToken },
    ),

  listNotificationPreferences: (accessToken: string) =>
    request<NotificationPreferenceRow[]>('/notifications/preferences', {
      accessToken,
    }),

  updateNotificationPreference: (
    accessToken: string,
    input: {
      category: NotificationCategory;
      channel: NotificationChannelKind;
      enabled: boolean;
    },
  ) =>
    request<NotificationPreferenceRow>('/notifications/preferences', {
      method: 'PUT',
      body: input,
      accessToken,
    }),

  // --- Abonnements / Paiement ---------------------------------------------------------------

  // Auto-souscription — accessible à tout compte, y compris mineur (CLAUDE.md §6 : jamais
  // bloquée en attendant un parent). Le PRIX est toujours résolu côté serveur à partir de
  // la formule : le client dit laquelle il veut, jamais combien elle coûte. Aucun PIN
  // Mobile Money n'est collecté ici — `payment.instructions` ne fait que restituer ce que
  // le prestataire (simulé pour l'instant) a renvoyé.
  subscribeSelf: (
    accessToken: string,
    input: {
      plan: IndividualPlan;
      billingCycle: SubscriptionBillingCycle;
      parentRedirectRequested?: boolean;
    },
  ) =>
    request<SubscribeResult>('/subscriptions/me', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  listMySubscriptions: (accessToken: string) =>
    request<Subscription[]>('/subscriptions/mine', { accessToken }),

  getSubscription: (accessToken: string, id: string) =>
    request<Subscription>(`/subscriptions/${id}`, { accessToken }),

  cancelSubscription: (accessToken: string, id: string) =>
    request<Subscription>(`/subscriptions/${id}/cancel`, {
      method: 'POST',
      accessToken,
    }),

  // Une organisation souscrit pour elle-même — BUSINESS/INSTITUTION dérivé
  // automatiquement de son type côté serveur, jamais choisi par le client.
  subscribeOrganization: (
    accessToken: string,
    organizationId: string,
    input: { billingCycle: SubscriptionBillingCycle },
  ) =>
    request<SubscribeResult>(`/subscriptions/organizations/${organizationId}`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  // Un établissement/entreprise souscrit une formule individuelle pour un bénéficiaire —
  // soumis à l'accord parental actif côté serveur si ce dernier est mineur (CLAUDE.md §6).
  sponsorSubscription: (
    accessToken: string,
    organizationId: string,
    beneficiaryUserId: string,
    input: { plan: IndividualPlan; billingCycle: SubscriptionBillingCycle },
  ) =>
    request<SubscribeResult>(
      `/subscriptions/organizations/${organizationId}/sponsor/${beneficiaryUserId}`,
      { method: 'POST', body: input, accessToken },
    ),

  // Back-office — réservé ADMIN.
  listAllSubscriptions: (
    accessToken: string,
    filters?: { status?: SubscriptionStatus; plan?: SubscriptionPlan },
  ) =>
    request<AdminSubscription[]>(
      `/subscriptions${buildQueryString(filters ?? {})}`,
      { accessToken },
    ),

  // --- Programme d'Ambassadeurs -------------------------------------------------------------

  getMyAmbassador: (accessToken: string) =>
    request<MyAmbassador>('/ambassadors/me', { accessToken }),

  getMyPortfolio: (accessToken: string) =>
    request<PortfolioEntry[]>('/ambassadors/me/portfolio', { accessToken }),

  getMyCommissions: (accessToken: string) =>
    request<Commission[]>('/ambassadors/me/commissions', { accessToken }),

  getMyAmbassadorWallet: (accessToken: string) =>
    request<WalletLedger>('/ambassadors/me/wallet', { accessToken }),

  listMyPayouts: (accessToken: string) =>
    request<PayoutRequest[]>('/ambassadors/me/payouts', { accessToken }),

  // Trois verrous côté serveur avant qu'un franc parte : contrat d'apporteur d'affaires
  // signé, versements ouverts pour le pays, validation administrative nominative. Le
  // client n'en contourne aucun — il se contente de restituer le refus s'il vient.
  requestPayout: (
    accessToken: string,
    input: { amountMinor: number; method: string; destinationLabel: string },
  ) =>
    request<PayoutRequest>('/ambassadors/me/payouts', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  // Vérifie un code d'affiliation avant de s'en servir, sans rien révéler du titulaire.
  verifyAmbassadorCode: (code: string) =>
    request<AmbassadorCodeCheck>('/ambassadors/verify-code', {
      method: 'POST',
      body: { code },
    }),

  // --- Back-office ambassadeurs — réservé ADMIN ---------------------------------------------

  listAmbassadors: (accessToken: string, status?: AmbassadorStatus) =>
    request<Ambassador[]>(
      `/ambassadors${buildQueryString(status ? { status } : {})}`,
      { accessToken },
    ),

  getAmbassador: (accessToken: string, id: string) =>
    request<Ambassador>(`/ambassadors/${id}`, { accessToken }),

  createAmbassador: (
    accessToken: string,
    input: {
      userId: string;
      categories: AmbassadorCategory[];
      countryCode: string;
    },
  ) =>
    request<Ambassador>('/ambassadors', {
      method: 'POST',
      body: input,
      accessToken,
    }),

  approveAmbassador: (accessToken: string, id: string) =>
    request<Ambassador>(`/ambassadors/${id}/approve`, {
      method: 'POST',
      accessToken,
    }),

  suspendAmbassador: (accessToken: string, id: string, reason: string) =>
    request<Ambassador>(`/ambassadors/${id}/suspend`, {
      method: 'POST',
      body: { reason },
      accessToken,
    }),

  reinstateAmbassador: (accessToken: string, id: string) =>
    request<Ambassador>(`/ambassadors/${id}/reinstate`, {
      method: 'POST',
      accessToken,
    }),

  terminateAmbassador: (accessToken: string, id: string, reason: string) =>
    request<Ambassador>(`/ambassadors/${id}/terminate`, {
      method: 'POST',
      body: { reason },
      accessToken,
    }),

  // Enregistre la signature du Contrat d'Apporteur d'Affaires — le fait qui lève le
  // verrou du premier versement dans un pays.
  signAmbassadorContract: (
    accessToken: string,
    id: string,
    input: { signedAt: string; contractReference: string },
  ) =>
    request<Ambassador>(`/ambassadors/${id}/contract`, {
      method: 'POST',
      body: input,
      accessToken,
    }),

  listAllPayouts: (accessToken: string, status?: PayoutRequestStatus) =>
    request<PayoutRequest[]>(
      `/ambassadors/payouts${buildQueryString(status ? { status } : {})}`,
      { accessToken },
    ),

  validatePayout: (accessToken: string, id: string) =>
    request<PayoutRequest>(`/ambassadors/payouts/${id}/validate`, {
      method: 'POST',
      accessToken,
    }),

  // Constate qu'un virement est réellement parti. Le virement lui-même se fait hors
  // application : la plateforme ne détient aucun moyen de paiement (CLAUDE.md §6).
  executePayout: (
    accessToken: string,
    id: string,
    executionReference: string,
  ) =>
    request<PayoutRequest>(`/ambassadors/payouts/${id}/execute`, {
      method: 'POST',
      body: { executionReference },
      accessToken,
    }),

  rejectPayout: (accessToken: string, id: string, reason: string) =>
    request<PayoutRequest>(`/ambassadors/payouts/${id}/reject`, {
      method: 'POST',
      body: { reason },
      accessToken,
    }),
};
