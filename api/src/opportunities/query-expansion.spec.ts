import {
  MAX_EXPANSIONS,
  expandedTextQuery,
  lookupKeys,
  normalizeTerm,
} from './query-expansion';

// ============================================================================
// EXPANSION DE LA REQUÊTE PAR SYNONYMES
//
// Le cas qui justifie tout ce fichier : quelqu'un tape « RH », l'offre dit
// « ressources humaines », et rien ne remonte. Le candidat en conclut qu'il n'y
// a pas d'offre — pas que son vocabulaire diffère de celui du recruteur. C'est
// un échec invisible : personne ne se plaint d'un résultat qu'il n'a pas vu.
//
// La garantie la plus importante n'est pas que l'expansion trouve, c'est
// qu'elle ne RETIRE jamais rien. Une recherche qui rendrait moins de résultats
// après « amélioration » serait pire que pas d'amélioration.
// ============================================================================
describe('Expansion de la requête', () => {
  describe('normalizeTerm', () => {
    it.each([
      ['Développeur', 'developpeur'],
      ['DEVELOPPEUR', 'developpeur'],
      ['R.H.', 'r h'],
      ['  Ressources   Humaines  ', 'ressources humaines'],
      ['Économie', 'economie'],
      ['!!!', ''],
    ])('« %s » → « %s »', (entree, attendu) => {
      expect(normalizeTerm(entree)).toBe(attendu);
    });

    // Le back-office écrit les synonymes avec cette fonction, la recherche les
    // relit avec elle. Si les deux divergeaient, un synonyme enregistré ne
    // serait jamais retrouvé — et rien ne le signalerait.
    it('est stable : normaliser deux fois ne change rien', () => {
      for (const entree of ['R.H.', 'Développeur Web', '  ÉCONOMIE  ']) {
        const une = normalizeTerm(entree);
        expect(normalizeTerm(une)).toBe(une);
      }
    });
  });

  describe('lookupKeys', () => {
    it('cherche la requête entière', () => {
      expect(lookupKeys('ressources humaines')).toContain(
        'ressources humaines',
      );
    });

    it('cherche chaque mot séparément', () => {
      const clefs = lookupKeys('stage rh douala');
      expect(clefs).toContain('rh');
      expect(clefs).toContain('stage');
      expect(clefs).toContain('douala');
    });

    // Les paires rattrapent les expressions noyées dans une phrase. Sans elles,
    // « stage en ressources humaines » ne reconnaîtrait aucun synonyme, alors
    // que « ressources humaines » seul en reconnaîtrait un.
    it('cherche les paires de mots adjacents', () => {
      const clefs = lookupKeys('offre ressources humaines douala');
      expect(clefs).toContain('ressources humaines');
      expect(clefs).toContain('offre ressources');
      expect(clefs).toContain('humaines douala');
    });

    it('ne fabrique pas de paire à partir de mots non adjacents', () => {
      expect(lookupKeys('stage rh douala')).not.toContain('stage douala');
    });

    it('ne rend rien pour une saisie sans caractère comparable', () => {
      expect(lookupKeys('!!! ???')).toEqual([]);
      expect(lookupKeys('   ')).toEqual([]);
    });

    it('ne rend pas deux fois la même clef', () => {
      const clefs = lookupKeys('stage stage stage');
      expect(new Set(clefs).size).toBe(clefs.length);
    });

    // Une phrase longue produirait sinon des dizaines de clefs, puis une
    // requête `IN (...)` démesurée sur chaque recherche.
    it('borne le nombre de mots examinés', () => {
      const clefs = lookupKeys(
        'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze',
      );
      expect(clefs).toContain('un');
      expect(clefs).not.toContain('treize');
      expect(clefs).not.toContain('quatorze');
    });
  });

  describe('expandedTextQuery', () => {
    it('rend une disjonction que websearch_to_tsquery comprend', () => {
      expect(expandedTextQuery(['JavaScript', 'React'])).toBe(
        'javascript or react',
      );
    });

    it('normalise les termes canoniques', () => {
      expect(expandedTextQuery(['Ressources Humaines'])).toBe(
        'ressources humaines',
      );
    });

    it('ne répète pas un terme présent deux fois', () => {
      expect(expandedTextQuery(['React', 'react', 'RÉACT'])).toBe('react');
    });

    // `null` plutôt qu'une chaîne vide : un appelant qui oublierait de tester
    // obtiendrait une erreur de type, pas une clause silencieusement fausse qui
    // remonterait des offres au hasard.
    it('rend null quand il n’y a rien à ajouter', () => {
      expect(expandedTextQuery([])).toBeNull();
      expect(expandedTextQuery(['', '   ', '!!!'])).toBeNull();
    });

    it('borne le nombre de termes ajoutés', () => {
      const beaucoup = Array.from({ length: 30 }, (_, i) => `terme${i}`);
      const rendu = expandedTextQuery(beaucoup);

      expect(rendu?.split(' or ')).toHaveLength(MAX_EXPANSIONS);
    });

    // Ce fichier ne produit que des chaînes normalisées, passées ensuite en
    // PARAMÈTRES. La normalisation retire de toute façon tout ce qui n'est pas
    // alphanumérique — une apostrophe ou un point-virgule n'atteint jamais la
    // requête.
    it('ne laisse passer aucun caractère de ponctuation', () => {
      const rendu = expandedTextQuery([`'; DROP TABLE "Opportunity"; --`]);

      expect(rendu).not.toContain("'");
      expect(rendu).not.toContain(';');
      expect(rendu).not.toContain('"');
      expect(rendu).not.toContain('-');
    });
  });
});
