// ============================================================================
// EXPANSION DE LA REQUÊTE PAR SYNONYMES
//
// Arbitrage du promoteur, 2026-08-07 : « Intègre une recherche tolérante aux
// fautes d'orthographe et un système de synonymes. »
//
// Le problème, concrètement : quelqu'un tape « RH », l'offre dit « ressources
// humaines », et rien ne remonte. Le candidat en conclut qu'il n'y a pas
// d'offre — pas que son vocabulaire ne correspond pas à celui du recruteur.
// C'est le genre d'échec invisible : personne ne se plaint d'un résultat qu'il
// n'a pas vu.
//
// DEUX RÈGLES GOUVERNENT CE FICHIER.
//
// 1. L'EXPANSION N'ÉLARGIT JAMAIS QU'EN PLUS. Les termes trouvés s'ajoutent à
//    la recherche d'origine, ils ne la remplacent pas. Si la table de synonymes
//    est vide, mal alimentée, ou si l'expansion se trompe, le candidat obtient
//    exactement ce qu'il aurait obtenu sans elle. Une recherche qui rendrait
//    MOINS de résultats après « amélioration » serait pire que pas
//    d'amélioration du tout.
//
// 2. RIEN N'EST CONCATÉNÉ DANS DU SQL. Ce fichier ne produit que des chaînes
//    normalisées, passées ensuite en PARAMÈTRES. La requête de recherche est le
//    seul endroit du projet où du texte utilisateur atteint du SQL brut : c'est
//    précisément là qu'on ne prend aucune liberté.
// ============================================================================

// FORME COMPARABLE d'un terme : minuscules, sans accent, sans ponctuation,
// espaces réduits.
//
// C'est elle qui porte l'unicité en base. Sans normalisation, « R.H. », « RH »
// et « r h » seraient trois entrées distinctes pour la même chose — et la
// recherche n'en reconnaîtrait qu'une, celle que l'utilisateur n'a pas tapée.
export function normalizeTerm(raw: string): string {
  return (
    raw
      .normalize('NFD')
      // Retire les diacritiques : « développeur » et « developpeur » se
      // comparent alors, ce que la recherche plein texte française ne fait pas
      // toujours.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

// Bornes. Une requête est déjà tronquée à 120 caractères en amont ; ces bornes
// protègent de ce qui reste : une phrase de vingt mots produirait sinon une
// quarantaine de clefs, puis une disjonction SQL démesurée.
const MAX_MOTS = 12;
export const MAX_EXPANSIONS = 8;

// Les CLEFS À CHERCHER dans la table des synonymes, pour une requête donnée.
//
// Trois formes, parce qu'un synonyme n'a pas toujours la taille d'un mot :
//
//   — la requête entière      « ressources humaines » → « rh »
//   — chaque mot              « stage rh douala »     → « rh »
//   — chaque paire adjacente  « offre ressources humaines » → « ressources humaines »
//
// Les paires sont ce qui rattrape les expressions noyées dans une phrase. Sans
// elles, « stage en ressources humaines » ne reconnaîtrait aucun synonyme,
// alors que « ressources humaines » seul en reconnaîtrait un.
export function lookupKeys(raw: string): string[] {
  const normalise = normalizeTerm(raw);
  if (!normalise) return [];

  const mots = normalise.split(' ').filter(Boolean).slice(0, MAX_MOTS);
  const clefs = new Set<string>([normalise, ...mots]);

  for (let i = 0; i < mots.length - 1; i++) {
    clefs.add(`${mots[i]} ${mots[i + 1]}`);
  }

  return [...clefs];
}

// La requête plein texte ÉLARGIE, ou `null` s'il n'y a rien à ajouter.
//
// `websearch_to_tsquery` comprend « or » comme un opérateur, quelle que soit la
// configuration linguistique. On lui rend donc une disjonction — et on lui rend
// une CHAÎNE, qui partira en paramètre : cette fonction ne sait pas ce qu'est
// une requête SQL, et c'est voulu.
//
// `null` plutôt qu'une chaîne vide : un appelant qui oublierait de tester
// obtiendrait une erreur de type, pas une clause silencieusement fausse.
export function expandedTextQuery(canoniques: string[]): string | null {
  const propres = [
    ...new Set(
      canoniques.map((c) => normalizeTerm(c)).filter((c) => c.length > 0),
    ),
  ].slice(0, MAX_EXPANSIONS);

  return propres.length > 0 ? propres.join(' or ') : null;
}
