import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { api, setRefreshHandler, type RegisterInput } from './api';
import * as secureStorage from './secure-storage';

const ACCESS_TOKEN_KEY = 'lesStagiaires.accessToken';
const REFRESH_TOKEN_KEY = 'lesStagiaires.refreshToken';

interface AuthContextValue {
  accessToken: string | null;
  isLoading: boolean;
  register: (input: RegisterInput) => ReturnType<typeof api.register>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function persistSession(accessToken: string, refreshToken: string) {
  await Promise.all([
    secureStorage.setItem(ACCESS_TOKEN_KEY, accessToken),
    secureStorage.setItem(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

async function clearSession() {
  await Promise.all([
    secureStorage.deleteItem(ACCESS_TOKEN_KEY),
    secureStorage.deleteItem(REFRESH_TOKEN_KEY),
  ]);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Session restaurée au démarrage depuis le stockage sécurisé — jamais depuis un
  // état en mémoire seul, pour survivre à un redémarrage de l'app.
  useEffect(() => {
    secureStorage.getItem(ACCESS_TOKEN_KEY).then((token) => {
      setAccessToken(token);
      setIsLoading(false);
    });
  }, []);

  // Enregistré une seule fois : appelé par lib/api.ts quand une requête authentifiée
  // reçoit un 401 (access token expiré, 15 min) — évite qu'un simple délai d'attente
  // de l'utilisateur transforme une action en erreur brute non récupérable.
  useEffect(() => {
    setRefreshHandler(async () => {
      const refreshToken = await secureStorage.getItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;
      try {
        const result = await api.refresh(refreshToken);
        await persistSession(result.accessToken, result.refreshToken);
        setAccessToken(result.accessToken);
        return result.accessToken;
      } catch {
        // Refresh token lui-même expiré/révoqué (30 j, ou déjà utilisé) : la session
        // ne peut plus être sauvée, l'appelant recevra le 401 d'origine.
        await clearSession();
        setAccessToken(null);
        return null;
      }
    });
    return () => setRefreshHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isLoading,
      register: (input) => api.register(input),
      verifyOtp: async (phone, code) => {
        const result = await api.verifyOtp(phone, code);
        await persistSession(result.accessToken, result.refreshToken);
        setAccessToken(result.accessToken);
      },
      login: async (identifier, password) => {
        const result = await api.login(identifier, password);
        await persistSession(result.accessToken, result.refreshToken);
        setAccessToken(result.accessToken);
      },
      logout: async () => {
        const refreshToken = await secureStorage.getItem(REFRESH_TOKEN_KEY);
        if (refreshToken) {
          // Best-effort : la session locale est effacée même si l'appel réseau échoue
          // (mode avion, backend indisponible) — l'utilisateur doit pouvoir se
          // déconnecter localement dans tous les cas.
          await api.logout(refreshToken).catch(() => undefined);
        }
        await clearSession();
        setAccessToken(null);
      },
    }),
    [accessToken, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l’intérieur de <AuthProvider>.');
  }
  return context;
}
