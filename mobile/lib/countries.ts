import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

// Seule donnée à maintenir à la main : la liste des codes ISO 3166-1 alpha-2 des pays et
// territoires africains. Indicatifs téléphoniques et noms localisés sont dérivés
// automatiquement (libphonenumber-js / Intl.DisplayNames) plutôt que recopiés à la main.
// Pour ouvrir la plateforme à un autre continent : ajouter un tableau du même type
// (ex. EUROPEAN_COUNTRY_CODES) et l'exposer de la même façon — aucun autre fichier
// n'a besoin de connaître la distinction entre continents.
export const AFRICAN_COUNTRY_CODES: CountryCode[] = [
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD',
  'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET',
  'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG',
  'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW',
  'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG',
  'TN', 'UG', 'ZM', 'ZW',
];

export interface CountryOption {
  code: CountryCode;
  callingCode: string; // sans le préfixe "+", ex. "237"
}

export const AFRICAN_COUNTRIES: CountryOption[] = AFRICAN_COUNTRY_CODES.map(
  (code) => ({ code, callingCode: getCountryCallingCode(code) }),
);

// Intl.DisplayNames restitue le nom du pays dans la langue demandée sans avoir à
// maintenir de table de traduction séparée pour ~54 pays × 4 langues. Le code ISO sert
// de repli si l'environnement ne supporte pas cette API (garanti en pratique sur Hermes
// récent et sur tous les navigateurs utilisés par le mode web).
export function getCountryDisplayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
