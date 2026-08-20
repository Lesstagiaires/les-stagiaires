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
// LA DÉROGATION D-21 N'EXISTE PAS ENCORE. La gouvernance autorise le parcours à
// RESTREINDRE l'éligibilité à l'achat d'une formule, dans ce seul cadre. Aucune
// ligne du dépôt ne l'implémente aujourd'hui : ce test est donc SANS EXCEPTION.
// Le jour où V6-4 ouvrira D-21, il faudra modifier ce fichier délibérément —
// c'est précisément l'effet recherché.
// ============================================================================

const RACINE_SRC = join(__dirname, '..');

// Le module d'authentification est PROPRIÉTAIRE des deux champs : il les écrit
// à l'inscription et expose /auth/me/path. C'est le seul endroit légitime.
const DOSSIERS_AUTORISES = ['auth'];

const CHAMPS = ['currentPath', 'initialIntent'];

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

describe('Le parcours reste confiné au module d’authentification', () => {
  it('n’est lu par aucun autre module', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      const relatif = chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
      const module = relatif.split('/')[0];
      if (DOSSIERS_AUTORISES.includes(module)) continue;

      const code = codeSansCommentaires(chemin);
      for (const champ of CHAMPS) {
        if (new RegExp(`\\b${champ}\\b`).test(code)) {
          fautifs.push(`${relatif} → ${champ}`);
        }
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
