// ============================================================================
// QUEL FOURNISSEUR DE SMS, ET SURTOUT : JAMAIS PAR DÉFAUT
//
// CE QUI A ÉTÉ CORRIGÉ LE 2026-08-09. La sélection s'écrivait :
//
//     config.get('SMS_PROVIDER') === 'africastalking' ? africasTalking : console
//
// Autrement dit, TOUT ce qui n'était pas exactement `africastalking` basculait
// sur la console : une faute de frappe, une majuscule, une variable oubliée au
// déploiement. Or le fournisseur console écrit le message ENTIER dans le
// journal — code à usage unique compris.
//
// Un environnement qu'on croyait relié à Africa's Talking pouvait donc écrire
// les OTP en clair dans ses journaux sans que rien ne le signale. Sur une
// application exposée à Internet, c'est la divulgation d'un secret
// d'authentification.
//
// LE PRINCIPE RETENU : un fournisseur qu'on n'a pas nommé n'est jamais choisi.
// Toute valeur inconnue, absente ou vide fait ÉCHOUER LE DÉMARRAGE. Une
// application qui refuse de partir se remarque ; une application qui écrit des
// OTP dans ses journaux, non.
// ============================================================================

export type SmsProviderName = 'africastalking' | 'console';

const CONNUS: SmsProviderName[] = ['africastalking', 'console'];

export class SmsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsConfigurationError';
  }
}

// ============================================================================
// UN BOOLÉEN DE CONFIGURATION SE LIT STRICTEMENT
//
// `REQUIRE_REAL_SMS=yes` doit échouer, pas valoir « faux ». Quelqu'un qui écrit
// « yes » demande une protection ; la lui refuser silencieusement reproduirait
// exactement le défaut que ce fichier corrige, un cran plus loin.
// ============================================================================
function lireBooleen(nom: string, brut: string | undefined): boolean {
  if (brut === undefined || brut.trim() === '') return false;
  const v = brut.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new SmsConfigurationError(
    `${nom} vaut « ${brut} », qui n'est ni vrai ni faux. ` +
      `Valeurs acceptées : true, false, 1, 0, ou variable absente.`,
  );
}

// Résolution EXHAUSTIVE. Ne renvoie un nom que si la configuration le désigne
// explicitement et que rien ne l'interdit ; lève dans tous les autres cas.
export function resolveSmsProviderName(env: {
  SMS_PROVIDER?: string;
  REQUIRE_REAL_SMS?: string;
}): SmsProviderName {
  const exigeReel = lireBooleen('REQUIRE_REAL_SMS', env.REQUIRE_REAL_SMS);
  const brut = env.SMS_PROVIDER?.trim();

  if (!brut) {
    throw new SmsConfigurationError(
      "SMS_PROVIDER n'est pas renseignée. Il n'existe pas de fournisseur par " +
        `défaut : indiquez explicitement ${CONNUS.join(' ou ')}. ` +
        'Sans cela, aucun code de vérification ni aucune demande de consentement ' +
        'parental ne partirait — ou pire, partirait dans un journal.',
    );
  }

  if (!CONNUS.includes(brut as SmsProviderName)) {
    throw new SmsConfigurationError(
      `SMS_PROVIDER vaut « ${brut} », qui ne correspond à aucun fournisseur connu ` +
        `(${CONNUS.join(', ')}). La casse compte. ` +
        'Le démarrage est refusé plutôt que de retomber sur la console, qui écrirait ' +
        'les codes à usage unique en clair dans les journaux.',
    );
  }

  const nom = brut as SmsProviderName;

  if (nom === 'console' && exigeReel) {
    throw new SmsConfigurationError(
      'REQUIRE_REAL_SMS=true interdit le fournisseur console : il écrit le message ' +
        "entier — code à usage unique compris — dans le journal de l'application. " +
        'Sur un environnement joignable depuis Internet, cela revient à publier un ' +
        'secret d’authentification. Utilisez SMS_PROVIDER=africastalking.',
    );
  }

  return nom;
}
