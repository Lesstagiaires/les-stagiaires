import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// `User.isMinor` NE SE LIT NULLE PART HORS DU MODULE D'AUTHENTIFICATION
//
// Le champ est écrit à l'inscription et n'est JAMAIS mis à jour — vérifié sur
// tout le code. Un jeune inscrit à 17 ans reste donc `isMinor = true`
// indéfiniment, y compris à vingt-cinq ans.
//
// CE QUE ÇA A COÛTÉ. Deux modules le lisaient. Le pire était le balayage de
// début de stage : il envoyait un SMS au « représentant légal » du candidat.
// Un majeur de vingt-cinq ans voyait donc un message partir vers le numéro
// qu'il avait déclaré comme parental à ses seize ans. Ce n'est pas une gêne
// fonctionnelle — c'est une information sur la situation professionnelle d'un
// adulte, envoyée à un tiers qui n'a plus aucun titre à la recevoir.
//
// POURQUOI UN TEST ET PAS UN COMMENTAIRE. La règle était DÉJÀ écrite, dans
// `auth.module.ts` : « jamais une comparaison directe à `User.isMinor` hors de
// ce module ». Elle était écrite, et violée deux fois. Un commentaire ne
// s'exécute pas ; ce test échoue à la seconde même.
//
// L'ALTERNATIVE EST À UN APPEL : `minorPolicy.requiresParentalConsent(user)`
// recalcule l'âge depuis la date de naissance et la politique du pays. Rien
// n'est stocké, donc rien ne périme.
// ============================================================================

const RACINE_SRC = join(__dirname, '..');

// Le module d'authentification EST propriétaire du champ : il l'écrit à
// l'inscription et le déclare au schéma. C'est le seul endroit légitime.
const DOSSIERS_AUTORISES = ['auth'];

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

// Le CODE seul. Ce fichier-ci, et les commentaires qui expliquent la règle,
// mentionnent forcément `isMinor` — les compter reviendrait à punir
// l'explication de la règle.
function codeSansCommentaires(chemin: string): string {
  return readFileSync(chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

describe('`User.isMinor` reste confiné au module d’authentification', () => {
  it('n’est lu par aucun autre module', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      const relatif = chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
      const premierSegment = relatif.split('/')[0];

      if (DOSSIERS_AUTORISES.includes(premierSegment)) continue;
      // Ce test lui-même vit dans `auth/`, donc il est déjà exclu ; on garde la
      // garde au cas où il déménagerait.
      if (relatif.endsWith('is-minor-not-read-elsewhere.spec.ts')) continue;

      // LES FICHIERS DE TEST SONT HORS PÉRIMÈTRE, et c'est un choix.
      //
      // Un jeu d'essai construit légitimement un objet `User` complet, colonne
      // `isMinor` comprise — la mentionner n'est pas en tirer une décision. Ce
      // que cette règle protège, ce sont les décisions de PRODUCTION : les
      // trois occurrences qui ont posé problème étaient toutes dans du code qui
      // tourne. Un test, lui, n'expédie aucun SMS à personne.
      if (relatif.endsWith('.spec.ts')) continue;

      if (/\bisMinor\b/.test(codeSansCommentaires(chemin))) {
        fautifs.push(relatif);
      }
    }

    // Le message d'échec doit dire QUOI FAIRE, pas seulement qu'on a échoué :
    // celui qui le lira aura ajouté la ligne sans connaître l'historique.
    expect(fautifs).toEqual([]);
  });

  // La règle n'a d'intérêt que s'il existe une alternative. Si cette méthode
  // disparaissait, le test ci-dessus n'aurait plus de sens — et le raccourci
  // reviendrait faute de mieux.
  it('offre bien une alternative recalculée', () => {
    const moteur = readFileSync(
      join(RACINE_SRC, 'auth', 'minor-policy.service.ts'),
      'utf8',
    );
    expect(moteur).toContain('requiresParentalConsent');
  });
});
