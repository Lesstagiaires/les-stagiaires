// ============================================================================
// DIVERSIFICATION DES RÉSULTATS
//
// Arbitrage du promoteur, 2026-08-07 :
//
//   « Sinon le Top 20 risque de devenir : 20 stages Java à Douala, alors qu'un
//     étudiant en informatique pourrait aussi être intéressé par le
//     développement mobile, le DevOps, la cybersécurité, l'IA, la donnée. »
//
// LE PROBLÈME QUE CELA RÉSOUT est réel et contre-intuitif : un classement
// parfaitement pertinent produit une première page monotone. Les vingt offres
// les mieux notées se ressemblent, parce que c'est justement ce qui les fait
// bien noter. Le candidat conclut que la plateforme n'a que ça — et il a
// raison de le conclure, puisque c'est tout ce qu'elle lui montre.
//
// LA MÉTHODE : une descente gloutonne avec pénalité de redondance.
//
// On prend la meilleure offre. Pour chaque offre suivante, on retranche une
// PÉNALITÉ proportionnelle au nombre d'offres déjà retenues qui lui ressemblent
// — même organisation, même métier, même ville. Une offre excellente et unique
// passe donc devant une offre excellente mais qui fait doublon.
//
// TROIS PROPRIÉTÉS À TENIR :
//
//   — DÉTERMINISME. À données égales, le même ordre. Un classement qui varie
//     d'une requête à l'autre est indéfendable devant qui le conteste. Les
//     égalités se départagent par l'identifiant, jamais par un aléa.
//   — RÉVERSIBILITÉ. La pénalité est un réglage, pas une loi. À zéro, on
//     retrouve exactement le classement par score pur.
//   — HONNÊTETÉ. La diversification ne fait REMONTER personne : elle fait
//     descendre les doublons. Aucune offre ne gagne de points ; certaines en
//     perdent parce qu'on en a déjà montré de semblables. La nuance compte —
//     c'est ce qui distingue une diversification d'une mise en avant déguisée.
// ============================================================================

export interface DiversifiableResult {
  id: string;
  score: number;
  organizationId: string;
  occupationId: string | null;
  city: string;
}

export interface DiversificationSettings {
  // Pénalité par doublon déjà retenu, en points de score. Zéro désactive la
  // diversification et rend le classement par score pur.
  organizationPenalty: number;
  occupationPenalty: number;
  cityPenalty: number;
  // Au-delà de ce rang, on cesse de diversifier : quelqu'un qui descend à la
  // page cinq cherche du volume, pas de la variété.
  horizon: number;
}

export const DEFAULT_DIVERSIFICATION: DiversificationSettings = {
  // La répétition d'un même EMPLOYEUR est la plus visible et la plus lassante :
  // c'est elle qui donne l'impression que la plateforme appartient à quelqu'un.
  organizationPenalty: 8,
  // Le métier, ensuite : c'est le cas du promoteur — vingt stages Java.
  occupationPenalty: 5,
  // La ville en dernier : dans un pays où l'essentiel de l'emploi formel est
  // dans deux villes, trop pénaliser Douala reviendrait à cacher le marché.
  cityPenalty: 2,
  horizon: 40,
};

// Réordonne SANS jamais modifier les scores d'origine : la pénalité sert au
// choix, elle n'est pas écrite dans le résultat. Un score affiché qui aurait été
// raboté par la diversification serait un score faux.
export function diversify<T extends DiversifiableResult>(
  results: T[],
  settings: DiversificationSettings = DEFAULT_DIVERSIFICATION,
): T[] {
  if (results.length <= 1) return [...results];

  // Au-delà de l'horizon, on garde l'ordre par score tel quel.
  const aDiversifier = results.slice(0, settings.horizon);
  const queue = results.slice(settings.horizon);

  const restants = [...aDiversifier];
  const retenus: T[] = [];

  const vusOrganisation = new Map<string, number>();
  const vusMetier = new Map<string, number>();
  const vusVille = new Map<string, number>();

  while (restants.length > 0) {
    let meilleurIndex = 0;
    let meilleurAjuste = -Infinity;

    for (let i = 0; i < restants.length; i++) {
      const candidat = restants[i];
      const penalite =
        (vusOrganisation.get(candidat.organizationId) ?? 0) *
          settings.organizationPenalty +
        (candidat.occupationId
          ? (vusMetier.get(candidat.occupationId) ?? 0) *
            settings.occupationPenalty
          : 0) +
        (vusVille.get(candidat.city.toLowerCase()) ?? 0) * settings.cityPenalty;

      const ajuste = candidat.score - penalite;

      // Départage DÉTERMINISTE : à score ajusté égal, l'identifiant tranche.
      // Sans cela, l'ordre dépendrait de celui que la base a renvoyé, qui peut
      // varier d'une exécution à l'autre.
      const gagne =
        ajuste > meilleurAjuste ||
        (ajuste === meilleurAjuste && candidat.id < restants[meilleurIndex].id);

      if (gagne) {
        meilleurAjuste = ajuste;
        meilleurIndex = i;
      }
    }

    const [choisi] = restants.splice(meilleurIndex, 1);
    retenus.push(choisi);

    vusOrganisation.set(
      choisi.organizationId,
      (vusOrganisation.get(choisi.organizationId) ?? 0) + 1,
    );
    if (choisi.occupationId) {
      vusMetier.set(
        choisi.occupationId,
        (vusMetier.get(choisi.occupationId) ?? 0) + 1,
      );
    }
    const ville = choisi.city.toLowerCase();
    vusVille.set(ville, (vusVille.get(ville) ?? 0) + 1);
  }

  return [...retenus, ...queue];
}
