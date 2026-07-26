import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';
import * as secureStorage from '../secure-storage';
import ar from './locales/ar.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

export type AppLanguage = 'fr' | 'en' | 'es' | 'ar';

export const SUPPORTED_LANGUAGES: {
  code: AppLanguage;
  nativeLabel: string;
  rtl: boolean;
}[] = [
  { code: 'fr', nativeLabel: 'Français', rtl: false },
  { code: 'en', nativeLabel: 'English', rtl: false },
  { code: 'es', nativeLabel: 'Español', rtl: false },
  { code: 'ar', nativeLabel: 'العربية', rtl: true },
];

const LANGUAGE_STORAGE_KEY = 'lesStagiaires.language';

function isSupportedLanguage(value: string | undefined | null): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((entry) => entry.code === value);
}

// Détecte la langue du téléphone au tout premier lancement, avant toute préférence
// enregistrée — se limite aux 4 langues supportées, repli sur le français sinon.
function detectDeviceLanguage(): AppLanguage {
  for (const locale of Localization.getLocales()) {
    if (isSupportedLanguage(locale.languageCode)) return locale.languageCode;
  }
  return 'fr';
}

export function isRtlLanguage(language: AppLanguage): boolean {
  return SUPPORTED_LANGUAGES.find((entry) => entry.code === language)?.rtl ?? false;
}

// L'inversion RTL de React Native (I18nManager) ne prend effet, côté natif, qu'après un
// redémarrage complet de l'app — contrairement au web, où positionner l'attribut `dir`
// sur le document suffit à faire suivre au moteur du navigateur (alignement du texte,
// sens de saisie) le nouveau sens d'écriture immédiatement. Retourne true si un
// redémarrage natif est nécessaire pour que le changement s'applique visuellement.
export function applyRtlDirection(language: AppLanguage): boolean {
  const shouldBeRtl = isRtlLanguage(language);

  if (Platform.OS === 'web') {
    document.documentElement.dir = shouldBeRtl ? 'rtl' : 'ltr';
  }

  if (I18nManager.isRTL === shouldBeRtl) return false;
  I18nManager.allowRTL(shouldBeRtl);
  I18nManager.forceRTL(shouldBeRtl);
  return Platform.OS !== 'web';
}

let initPromise: Promise<AppLanguage> | null = null;

export function initI18n(): Promise<AppLanguage> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await secureStorage.getItem(LANGUAGE_STORAGE_KEY);
    const language = isSupportedLanguage(stored) ? stored : detectDeviceLanguage();

    await i18next.use(initReactI18next).init({
      resources: {
        fr: { translation: fr },
        en: { translation: en },
        es: { translation: es },
        ar: { translation: ar },
      },
      lng: language,
      fallbackLng: 'fr',
      interpolation: { escapeValue: false },
    });

    applyRtlDirection(language);
    return language;
  })();
  return initPromise;
}

// Retourne { reloadRequired } : côté natif (iOS/Android), l'appelant doit proposer un
// redémarrage de l'app pour que le sens RTL/LTR s'applique réellement (limite de
// I18nManager) — le texte, lui, change immédiatement dans tous les cas.
export async function setAppLanguage(language: AppLanguage): Promise<{ reloadRequired: boolean }> {
  await secureStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await i18next.changeLanguage(language);
  const reloadRequired = applyRtlDirection(language);
  return { reloadRequired };
}

export function getCurrentLanguage(): AppLanguage {
  return isSupportedLanguage(i18next.language) ? i18next.language : 'fr';
}
