// ============================================================================
// LE PÉRIMÈTRE « TOUS PAYS »
//
// Plusieurs tables portent un réglage qui vaut soit pour un pays, soit partout :
// le barème de pertinence, les modules de formation. Le périmètre général se
// note '*'.
//
// POURQUOI PAS NULL — la question mérite d'être tranchée une fois, parce que
// NULL était le choix naturel et qu'il était faux.
//
// PostgreSQL considère deux NULL comme distincts. Une clef unique qui contient
// une colonne nullable ne contraint donc rien sur les lignes où elle est
// nulle : le réglage GÉNÉRAL — le seul qui existe au lancement, celui que tout
// le monde lit — était précisément celui qu'aucun index ne protégeait. Vérifié
// sur la base le 2026-08-07 : deux règles SKILL_MATCH globales, actives,
// s'insèrent sans erreur, et le classement dépend alors de l'ordre de lecture.
// Deux modules de formation « Déontologie » v1 aussi.
//
// S'y ajoute que Prisma refuse un NULL dans une clef unique composée : le
// back-office ne pouvait pas relire le réglage global qu'il venait d'écrire, et
// en créait un nouveau à chaque modification au lieu de le mettre à jour.
//
// '*' n'est le code ISO 3166-1 alpha-2 d'aucun pays : la confusion avec un vrai
// périmètre national est impossible. Les tables concernées portent une
// contrainte CHECK qui n'accepte que '*' ou deux majuscules.
// ============================================================================
export const ALL_COUNTRIES = '*';

// Le périmètre le plus précis l'emporte : la règle du pays, sinon la générale.
// Écrit une fois ici plutôt que réinventé à chaque appel — c'est le genre de
// priorité qu'on inverse par distraction.
export function scopedToCountry(countryCode?: string | null) {
  return {
    OR: [
      { countryCode: ALL_COUNTRIES },
      ...(countryCode && countryCode !== ALL_COUNTRIES
        ? [{ countryCode }]
        : []),
    ],
  };
}
