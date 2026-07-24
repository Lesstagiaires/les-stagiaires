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

export type Language = 'FR' | 'EN';
export type AccountStatus =
  | 'PENDING_VERIFICATION'
  | 'AWAITING_PARENTAL_CONSENT'
  | 'ACTIVE'
  | 'DEACTIVATED'
  | 'PENDING_DELETION'
  | 'DELETED';

export interface RegisterInput {
  phone: string;
  password: string;
  language: Language;
  dateOfBirth: string; // ISO 8601
  parentPhone?: string;
}

export interface RegisterResult {
  userId: string;
  isMinor: boolean;
  message: string;
}

export interface VerifyOtpResult {
  lsId: string;
  status: AccountStatus;
  accessToken: string;
  refreshToken: string;
  requiresParentalLink: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
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

export interface ProfileLanguageEntry {
  id: string;
  language: string;
  level: LanguageLevel;
}

export interface Profile {
  id: string;
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
}

export interface SearchOpportunitiesInput {
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

export interface CreateOrganizationInput {
  name: string;
  sector?: string;
  country: string;
  city: string;
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

function buildQueryString(params: Record<string, string | number | undefined>): string {
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

  refresh: (refreshToken: string) =>
    request<LoginResult>('/auth/refresh', {
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

  getOpportunity: (id: string, accessToken?: string) =>
    request<Opportunity>(`/opportunities/${id}`, { accessToken }),

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
};
