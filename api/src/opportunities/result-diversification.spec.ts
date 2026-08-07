import {
  DEFAULT_DIVERSIFICATION,
  diversify,
  type DiversifiableResult,
} from './result-diversification';

// ============================================================================
// DIVERSIFICATION DES RÉSULTATS
//
// « Sinon le Top 20 risque de devenir : 20 stages Java à Douala. »
//
// Le test qui compte est le dernier : la diversification ne fait REMONTER
// personne. Elle fait descendre les doublons. Aucune offre ne gagne de points —
// c'est ce qui la distingue d'une mise en avant déguisée.
// ============================================================================
describe('Diversification des résultats', () => {
  const offre = (
    id: string,
    score: number,
    organizationId: string,
    occupationId: string | null,
    city = 'Douala',
  ): DiversifiableResult => ({ id, score, organizationId, occupationId, city });

  it('ne touche à rien quand tout est déjà varié', () => {
    const entree = [
      offre('a', 90, 'org-1', 'dev'),
      offre('b', 80, 'org-2', 'compta'),
      offre('c', 70, 'org-3', 'rh'),
    ];
    expect(diversify(entree).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  // --- LE CAS DU PROMOTEUR --------------------------------------------------
  it('casse une série de doublons du même métier', () => {
    // Cinq offres de développement, une de comptabilité un peu moins bien
    // notée. Sans diversification, la comptabilité arrive sixième.
    const entree = [
      offre('dev-1', 90, 'org-1', 'dev'),
      offre('dev-2', 88, 'org-2', 'dev'),
      offre('dev-3', 86, 'org-3', 'dev'),
      offre('dev-4', 84, 'org-4', 'dev'),
      offre('dev-5', 82, 'org-5', 'dev'),
      offre('compta', 80, 'org-6', 'compta'),
    ];

    const ordre = diversify(entree).map((r) => r.id);
    const rangCompta = ordre.indexOf('compta');

    // Elle remonte : sans diversification elle serait en position 5 (index).
    expect(rangCompta).toBeLessThan(5);
    // Mais la meilleure offre reste première : on ne sacrifie pas la pertinence.
    expect(ordre[0]).toBe('dev-1');
  });

  it('casse une série du même employeur, plus durement que du même métier', () => {
    const entree = [
      offre('x1', 90, 'org-unique', 'dev'),
      offre('x2', 89, 'org-unique', 'dev'),
      offre('x3', 88, 'org-unique', 'dev'),
      offre('autre', 84, 'org-autre', 'dev'),
    ];

    const ordre = diversify(entree).map((r) => r.id);
    // La répétition d'un même employeur est la plus visible et la plus
    // lassante : c'est elle qui donne l'impression que la plateforme
    // appartient à quelqu'un.
    expect(ordre[1]).toBe('autre');
  });

  // --- LES TROIS PROPRIÉTÉS -------------------------------------------------
  describe('propriétés du classement', () => {
    const jeu = [
      offre('a', 90, 'org-1', 'dev'),
      offre('b', 90, 'org-1', 'dev'),
      offre('c', 90, 'org-2', 'compta'),
      offre('d', 85, 'org-3', 'rh', 'Yaoundé'),
    ];

    it('est DÉTERMINISTE — même entrée, même sortie', () => {
      // Un classement qui varie d'une requête à l'autre est indéfendable devant
      // qui le conteste.
      const premier = diversify(jeu).map((r) => r.id);
      for (let i = 0; i < 5; i++) {
        expect(diversify(jeu).map((r) => r.id)).toEqual(premier);
      }
    });

    it('départage les égalités par l’identifiant, jamais au hasard', () => {
      const exaequo = [
        offre('zzz', 90, 'org-1', 'dev'),
        offre('aaa', 90, 'org-2', 'compta'),
      ];
      // Sans ce départage, l'ordre dépendrait de celui que la base a renvoyé,
      // qui peut varier d'une exécution à l'autre.
      expect(diversify(exaequo)[0].id).toBe('aaa');
    });

    it('est RÉVERSIBLE — à pénalité nulle, on retrouve le score pur', () => {
      const sansPenalite = diversify(jeu, {
        organizationPenalty: 0,
        occupationPenalty: 0,
        cityPenalty: 0,
        horizon: 40,
      });
      const parScore = [...jeu].sort(
        (x, y) => y.score - x.score || x.id.localeCompare(y.id),
      );
      expect(sansPenalite.map((r) => r.id)).toEqual(parScore.map((r) => r.id));
    });

    // LE TEST QUI COMPTE.
    it('ne modifie AUCUN score', () => {
      const resultat = diversify(jeu);
      for (const item of resultat) {
        const origine = jeu.find((o) => o.id === item.id)!;
        expect(item.score).toBe(origine.score);
      }
      // Un score affiché qui aurait été raboté par la diversification serait un
      // score faux.
      expect(resultat.map((r) => r.score).sort()).toEqual(
        jeu.map((r) => r.score).sort(),
      );
    });

    it('ne perd ni ne duplique aucun résultat', () => {
      const resultat = diversify(jeu);
      expect(resultat).toHaveLength(jeu.length);
      expect(new Set(resultat.map((r) => r.id)).size).toBe(jeu.length);
    });
  });

  it('cesse de diversifier au-delà de l’horizon', () => {
    // Quelqu'un qui descend à la page cinq cherche du volume, pas de la variété.
    const entree = Array.from({ length: 10 }, (_, i) =>
      offre(`o${i}`, 100 - i, 'org-unique', 'dev'),
    );

    const ordre = diversify(entree, {
      ...DEFAULT_DIVERSIFICATION,
      horizon: 3,
    }).map((r) => r.id);

    // Au-delà du rang 3, l'ordre par score est conservé tel quel.
    expect(ordre.slice(3)).toEqual(['o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9']);
  });

  it('supporte une liste vide ou à un seul élément', () => {
    expect(diversify([])).toEqual([]);
    const seul = [offre('a', 50, 'org-1', 'dev')];
    expect(diversify(seul).map((r) => r.id)).toEqual(['a']);
  });

  it('ignore le métier absent sans se tromper de pénalité', () => {
    const entree = [
      offre('a', 90, 'org-1', null),
      offre('b', 89, 'org-2', null),
      offre('c', 88, 'org-3', null),
    ];
    // Trois offres sans métier renseigné ne sont pas trois doublons de métier.
    expect(diversify(entree).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
