import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// UNE BORNE SANS ORDRE REND DES LIGNES QUELCONQUES
//
// PostgreSQL ne promet aucun ordre en l'absence d'ORDER BY. Un `LIMIT 500` ou
// un `take: 500` posé seul rend donc 500 lignes parmi les correspondances —
// pas les 500 mêmes d'une exécution à l'autre, selon le plan retenu ou la
// parallélisation.
//
// CE QUE ÇA CASSE. La recherche promet un classement REPRODUCTIBLE : « un ordre
// qui varie est indéfendable » devant qui le conteste. Au-delà de la borne, ce
// n'est plus le classement qui décide de ce qu'on voit, c'est le hasard du plan
// d'exécution — et personne ne s'en aperçoit, parce qu'un résultat manquant ne
// se remarque pas.
//
// POURQUOI CE TEST EXISTE. Le défaut a été commis DEUX FOIS dans le même
// fichier, à quinze lignes d'écart, alors même que la fenêtre de 200 juste
// au-dessus portait le garde-fou et son commentaire d'explication. Ce n'est
// donc pas une inattention isolée : c'est le geste naturel quand on écrit une
// borne. Un test le rattrape ; la vigilance, non.
// ============================================================================

const SOURCE = readFileSync(
  join(__dirname, 'opportunities.service.ts'),
  'utf8',
);

// Le code seul : les commentaires de ce fichier parlent d'ORDER BY et de
// `take`, et les compter fausserait tout.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^\s*\/\/.*$/gm,
  '',
);

describe('Reproductibilité de la recherche', () => {
  // --- SQL brut -------------------------------------------------------------
  describe('Requêtes SQL brutes', () => {
    it('n’écrit aucun LIMIT sans ORDER BY qui le précède', () => {
      // Les gabarits `$queryRaw` eux-mêmes, et rien d'autre. Chercher le mot
      // SELECT sans distinguer la casse attraperait le `select:` de Prisma,
      // qui n'est pas du SQL — l'erreur que ce test a d'abord commise.
      // Sans les commentaires SQL : ceux qui expliquent précisément cette
      // règle contiennent les mots « LIMIT » et « ORDER BY », et les compter
      // comme du code fausse l'analyse dans les deux sens.
      const requetes = gabaritsQueryRaw(SOURCE).map((requete) =>
        requete.replace(/--.*$/gm, ''),
      );
      expect(requetes.length).toBeGreaterThan(0);

      const fautives = requetes.filter((requete) => {
        if (!/\bLIMIT\b/.test(requete)) return false;
        const avantLimit = requete.split(/\bLIMIT\b/)[0];
        return !/\bORDER\s+BY\b/.test(avantLimit);
      });

      expect(fautives).toHaveLength(0);
    });
  });

  // --- Prisma ---------------------------------------------------------------
  describe('Requêtes Prisma', () => {
    it('n’écrit aucun take sans orderBy dans le même appel', () => {
      // Chaque bloc `findMany({ ... })`, isolé par accolades équilibrées.
      const blocs = blocsFindMany(CODE);
      expect(blocs.length).toBeGreaterThan(0);

      const fautifs = blocs.filter(
        (bloc) => /\btake\s*:/.test(bloc) && !/\borderBy\s*:/.test(bloc),
      );

      expect(fautifs).toHaveLength(0);
    });
  });
});

// Le contenu de chaque gabarit `$queryRaw`…`` — depuis l'accent grave ouvrant
// jusqu'au fermant. Suffisant ici : aucun de ces gabarits ne contient d'accent
// grave échappé.
function gabaritsQueryRaw(source: string): string[] {
  const gabarits: string[] = [];
  const marqueur = /\$queryRaw(?:<[^>]*>)?\s*`/g;

  while (marqueur.exec(source) !== null) {
    const fin = source.indexOf('`', marqueur.lastIndex);
    if (fin === -1) break;
    gabarits.push(source.slice(marqueur.lastIndex, fin));
    marqueur.lastIndex = fin + 1;
  }

  return gabarits;
}

// Extrait le contenu de chaque `findMany({ … })`, en suivant les accolades
// plutôt qu'en s'arrêtant à la première fermante — les arguments Prisma sont
// profondément imbriqués.
function blocsFindMany(source: string): string[] {
  const blocs: string[] = [];
  const marqueur = /findMany\s*\(\s*\{/g;

  while (marqueur.exec(source) !== null) {
    let profondeur = 1;
    let i = marqueur.lastIndex;
    while (i < source.length && profondeur > 0) {
      if (source[i] === '{') profondeur += 1;
      else if (source[i] === '}') profondeur -= 1;
      i += 1;
    }
    blocs.push(source.slice(marqueur.lastIndex, i - 1));
  }

  return blocs;
}
