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

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

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
    request<{ fullName: string | null; headline: string | null }>(
      '/profiles/me',
      { accessToken },
    ),
};
