import type { AgeThresholds } from './api';

// ============================================================================
// LES QUATRE PALIERS D'ÂGE, CÔTÉ APPLICATION
//
// Arbitrage du promoteur du 2026-08-07 : quatre paliers explicites, jamais un
// booléen mineur/majeur, et « nous ne devons pas figer les valeurs dans le
// code ».
//
// AUCUN SEUIL N'EST ÉCRIT ICI. Ils viennent tous du serveur
// (`GET /auth/age-thresholds/:pays`). Ce fichier remplace un `âge < 18` qui
// était codé en dur dans l'écran d'inscription : le Cameroun passe à 14 ans, un
// autre pays passera à 16, et l'application suivra sans nouvelle version sur
// les magasins — ce qui était tout l'objectif.
//
// LA DATE DE NAISSANCE NE QUITTE PAS L'APPAREIL. On reçoit des SEUILS — des
// règles publiques — et on calcule le palier localement. Envoyer la date au
// serveur pour qu'il réponde le palier aurait fait transiter une donnée
// personnelle avant même que l'utilisateur ait créé quoi que ce soit, et
// l'aurait déposée dans les journaux d'accès HTTP au passage.
// ============================================================================

export type AgeTier =
  // Sous l'âge légal de stage : inscription refusée.
  | 'BELOW_MINIMUM'
  // Accord parental OBLIGATOIRE. Le compte reste restreint jusqu'à validation.
  | 'PARENTAL_CONSENT_REQUIRED'
  // Majeur. Un contact parental peut être proposé PAR COURTOISIE — sans
  // blocage, sans validation attendue, sans droit de regard.
  | 'PARENTAL_INFO_OPTIONAL'
  // Plus aucun champ parent n'est affiché.
  | 'NO_PARENTAL_INFO';

// L'âge révolu. Le mois ET le jour comptent : comparer les seules années
// donnerait un an de trop à qui n'a pas encore eu son anniversaire — et ferait
// disparaître l'obligation parentale d'un mineur pendant plusieurs mois.
export function computeAge(dateOfBirth: Date, at: Date = new Date()): number {
  let age = at.getFullYear() - dateOfBirth.getFullYear();
  const moisEcoules = at.getMonth() - dateOfBirth.getMonth();
  if (
    moisEcoules < 0 ||
    (moisEcoules === 0 && at.getDate() < dateOfBirth.getDate())
  ) {
    age--;
  }
  return age;
}

// Le palier, déduit des seuils reçus du serveur.
//
// LA BORNE DU CONSENTEMENT EST `minParentRequiredAge`, PAS `minInternshipAge` —
// exactement comme au serveur. Les deux valent 14 au Cameroun, mais un pays
// ouvrant le stage à 15 ans en n'exigeant le parent qu'à 16 aurait une bande de
// mineurs sans obligation. Les deux calculs doivent rester d'accord, sinon
// l'écran réclamerait un numéro que le serveur n'exige pas, ou l'inverse.
export function tierFor(age: number, thresholds: AgeThresholds): AgeTier {
  if (age < thresholds.minInternshipAge) return 'BELOW_MINIMUM';
  if (
    age >= thresholds.minParentRequiredAge &&
    age < thresholds.civilMajorityAge
  ) {
    return 'PARENTAL_CONSENT_REQUIRED';
  }
  if (age < thresholds.parentalInfoMaxAge) return 'PARENTAL_INFO_OPTIONAL';
  return 'NO_PARENTAL_INFO';
}

export function tierForDateOfBirth(
  dateOfBirth: Date,
  thresholds: AgeThresholds,
  at: Date = new Date(),
): AgeTier {
  return tierFor(computeAge(dateOfBirth, at), thresholds);
}

// Le champ parent doit-il apparaître ? Vrai pour les deux paliers du milieu,
// mais pour des raisons opposées — d'où `tierFor` pour trancher ce qui en
// dépend.
export function showsParentalField(tier: AgeTier): boolean {
  return (
    tier === 'PARENTAL_CONSENT_REQUIRED' || tier === 'PARENTAL_INFO_OPTIONAL'
  );
}

// Le numéro est-il EXIGÉ pour poursuivre ? Uniquement au palier 14-17.
//
// Ne jamais confondre avec `showsParentalField` : un majeur de 19 ans voit le
// champ mais n'est bloqué par rien, quelle que soit sa réponse.
export function requiresParentalPhone(tier: AgeTier): boolean {
  return tier === 'PARENTAL_CONSENT_REQUIRED';
}
