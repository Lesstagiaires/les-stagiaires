import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// `User.currentPath` ET `User.initialIntent` NE SE LISENT NULLE PART AILLEURS
//
// L'INVARIANT QUE CE FICHIER FAIT RESPECTER (gouvernance V6, D-1) :
//
//   `initialIntent` et `currentPath` n'accordent jamais et n'élargissent jamais
//   un droit : ni rôle, ni permission, ni entitlement, ni accès payant, ni
//   droit de lecture ou d'écriture.
//
// POURQUOI UN TEST DE SOURCE PLUTÔT QU'UN TEST DE COMPORTEMENT. Un test
// fonctionnel ne peut prouver qu'une absence là où il pense à regarder. Ici
// l'absence doit valoir PARTOUT : dans un garde, un service d'abonnement, un
// moteur de classement, un DTO destiné à un recruteur. Seule une lecture du
// code entier le montre.
//
// C'est le même dispositif que `is-minor-not-read-elsewhere.spec.ts`, et pour
// la même raison : sur ce projet, une règle seulement écrite en commentaire a
// déjà été violée deux fois. Un commentaire ne s'exécute pas.
//
// CE QUE LA VIOLATION COÛTERAIT. Trois dérives, dans l'ordre de gravité :
//   — une décision d'autorisation lisant le parcours ferait du déclaratif une
//     permission, et il suffirait de se déclarer autrement pour obtenir un
//     droit ;
//   — un service d'abonnement le lisant anticiperait D-21, explicitement
//     REPORTÉE à V6-4 ;
//   — un DTO tiers l'exposant divulguerait à un recruteur la situation
//     personnelle d'un candidat, classée CONFIDENTIEL.
//
// LA DÉROGATION D-21 EST OUVERTE DEPUIS V6-4 — et ce fichier a dû être modifié
// délibérément pour cela, ce qui était exactement l'effet recherché.
//
// CE QU'ELLE AUTORISE, ET RIEN DE PLUS : `subscriptions/` peut lire
// `currentPath` pour RESTREINDRE l'éligibilité à l'ACHAT d'une formule. Elle
// n'accorde aucun accès, n'ouvre aucune fonctionnalité, n'entre dans aucune
// décision d'entitlement — `entitlements-confinement.spec.ts` interdit d'ailleurs
// `currentPath` dans `src/entitlements/`.
//
// CE QU'ELLE N'AUTORISE PAS : `initialIntent` reste sans aucune dérogation. Il
// est immuable et sert à comprendre d'où vient une personne, jamais à décider
// quoi que ce soit à son sujet.
//
// ----------------------------------------------------------------------------
// POURQUOI DEUX ÉTAGES, ET POURQUOI AUCUNE LISTE D'EXEMPTION
//
// La première version de ce fichier cherchait le NOM du champ. Deux défauts,
// tous deux relevés en revue contradictoire, tous deux mesurés :
//
//   — un double Prisma écrivant `currentPath: null` était compté comme lecteur,
//     alors qu'il ne lit rien et ne décide rien. Il a fallu l'inscrire parmi les
//     lecteurs autorisés, ce qui était faux ;
//   — `entitlements-confinement.spec.ts`, qui INTERDIT ce champ dans la couche
//     d'entitlements, doit écrire son nom pour le chercher. Deux gardes de même
//     nature se déclaraient mutuellement en faute, et une exemption avait été
//     créée pour les réconcilier.
//
// Les deux venaient de la même erreur : confondre une MENTION et un USAGE. La
// règle porte désormais sur ce qu'un fichier FAIT du champ, ce qui supprime les
// deux listes plutôt que de les entretenir.
//
//   ÉTAGE 1 — LECTURE EFFECTIVE. Accès membre (`u.currentPath`, `u?.currentPath`),
//   accès par crochets (`u['currentPath']`), ou projection Prisma
//   (`select: { currentPath: true }`). C'est par là qu'une valeur entre dans une
//   décision. Réservé au module propriétaire et aux fichiers nommés ci-dessous.
//
//   ÉTAGE 2 — TOUTE OCCURRENCE, une fois retirés commentaires, chaînes et
//   expressions régulières. Filet plus large qui continue d'attraper une
//   écriture, un DTO qui exposerait le champ, un fixture égaré hors périmètre.
//   Réservé aux dossiers ci-dessous.
//
// L'étage 1 conserve les chaînes de caractères : sans elles, `u['currentPath']`
// deviendrait indétectable. L'étage 2 les retire : c'est ce qui fait qu'un test
// cherchant une violation n'en constitue pas une.
// ============================================================================

const RACINE_SRC = join(__dirname, '..');

// ÉTAGE 2 — le module d'authentification est PROPRIÉTAIRE des deux champs : il
// les écrit à l'inscription et expose /auth/me/path. D-21 rend le parcours
// manipulable dans `subscriptions/` (garde, table, fixtures de test), sans pour
// autant y autoriser sa lecture — c'est l'étage 1 qui en décide.
const DOSSIERS_AUTORISES: Record<string, readonly string[]> = {
  initialIntent: ['auth'],
  currentPath: ['auth', 'subscriptions'],
};

const CHAMPS = Object.keys(DOSSIERS_AUTORISES);

// ÉTAGE 1 — les seuls fichiers autorisés à LIRE le champ hors de `auth/`.
// `subscriptions.service.ts` porte la garde D-21 et rien d'autre ne la porte :
// ni la table des planchers, qui ne connaît que des parcours en type ; ni les
// specs, qui écrivent des fixtures sans jamais les relire pour décider.
const LECTEURS_AUTORISES: Record<string, readonly string[]> = {
  initialIntent: [],
  currentPath: ['subscriptions/subscriptions.service.ts'],
};

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) {
      trouves.push(...fichiersSources(chemin));
    } else if (entree.name.endsWith('.ts')) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

// Le CODE seul : un commentaire qui EXPLIQUE la règle ne la viole pas.
function codeSansCommentaires(chemin: string): string {
  return readFileSync(chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

// Le code SANS les mentions : en plus des commentaires, les chaînes et les
// expressions régulières. Un test qui cherche `currentPath` doit l'écrire pour
// le chercher ; le neutraliser ici est ce qui rend inutile toute exemption
// nommée pour les tests de confinement.
//
// Le retrait des littéraux d'expression régulière est HEURISTIQUE — la barre
// oblique sert aussi à la division. C'est acceptable pour l'étage 2, qui est un
// filet complémentaire : l'étage 1, lui, ne dépend pas de ce retrait.
function codeSansMentions(chemin: string): string {
  return codeSansCommentaires(chemin)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuy]*/g, '/RE/');
}

// CE QUI COMPTE COMME UNE LECTURE — les trois formes par lesquelles la valeur
// entre réellement dans du code. Déclarer `currentPath: null` dans un double, ou
// l'écrire en base dans un fixture, n'en fait pas partie : rien n'est lu, donc
// rien ne peut être décidé.
function lectureEffective(champ: string): RegExp {
  return new RegExp(
    // beneficiaire.currentPath / beneficiaire?.currentPath
    `[.?]\\s*${champ}\\b` +
      // user['currentPath'] — d'où la conservation des chaînes à cet étage
      `|\\[\\s*['"]${champ}['"]\\s*\\]` +
      // select: { currentPath: true } — la projection Prisma qui la fait sortir
      `|\\b${champ}\\s*:\\s*true\\b`,
  );
}

describe('Le parcours reste confiné au module d’authentification', () => {
  // ÉTAGE 1 — CELUI QUI PORTE L'INVARIANT.
  it('n’est LU par aucun fichier hors de ceux qui en portent la décision', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      const relatif = chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
      if (relatif.split('/')[0] === 'auth') continue;

      const code = codeSansCommentaires(chemin);
      for (const champ of CHAMPS) {
        if (LECTEURS_AUTORISES[champ].includes(relatif)) continue;
        if (lectureEffective(champ).test(code)) {
          fautifs.push(`${relatif} → lit ${champ}`);
        }
      }
    }

    expect(fautifs).toEqual([]);
  });

  // ÉTAGE 2 — LE FILET. Il attrape ce que l'étage 1 ne regarde pas : une
  // écriture, un DTO qui exposerait le champ, un fixture égaré. Il vaut au
  // dossier, non au fichier — c'est ce qui permet aux doubles et aux fixtures de
  // `subscriptions/` d'exister sans être promus au rang de lecteurs.
  it('n’apparaît sous aucune forme dans un module étranger', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      const relatif = chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
      const module = relatif.split('/')[0];

      const code = codeSansMentions(chemin);
      for (const champ of CHAMPS) {
        if (DOSSIERS_AUTORISES[champ].includes(module)) continue;
        if (new RegExp(`\\b${champ}\\b`).test(code)) {
          fautifs.push(`${relatif} → ${champ}`);
        }
      }
    }

    expect(fautifs).toEqual([]);
  });

  // `initialIntent` NOMMÉ SÉPARÉMENT. Les deux tests ci-dessus le couvrent déjà,
  // mais les tables sont modifiables champ par champ : si une ligne
  // `initialIntent` y était ajoutée un jour, ce test-ci tomberait quand même.
  // C'est la seule protection qui survit à l'assouplissement des tables.
  it('ne laisse jamais l’intention initiale sortir du module d’authentification', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      const relatif = chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
      if (relatif.split('/')[0] === 'auth') continue;

      if (/\binitialIntent\b/.test(codeSansMentions(chemin))) {
        fautifs.push(relatif);
      }
    }

    expect(fautifs).toEqual([]);
  });

  // Le garde des rôles est le point exact où une confusion parcours/permission
  // se matérialiserait. Il est déjà couvert par le test ci-dessus, mais il est
  // nommé ici pour que l'échec désigne la faute plutôt que de la faire deviner.
  it('n’apparaît dans aucun garde d’autorisation', () => {
    const gardes = fichiersSources(join(RACINE_SRC, 'auth', 'guards'));
    const fautifs: string[] = [];

    for (const chemin of gardes) {
      const code = codeSansCommentaires(chemin);
      for (const champ of CHAMPS) {
        if (new RegExp(`\\b${champ}\\b`).test(code)) {
          fautifs.push(`${chemin} → ${champ}`);
        }
      }
    }

    expect(fautifs).toEqual([]);
  });
});
