import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// LES FRONTIÈRES DE LA COUCHE D'ENTITLEMENTS
//
// POURQUOI UN TEST DE SOURCE PLUTÔT QUE DES TESTS DE COMPORTEMENT. Un test
// fonctionnel ne prouve une absence que là où il pense à regarder. Ici l'absence
// doit valoir PARTOUT — dans un garde, un service d'offres, un module
// d'ambassadeurs. Seule une lecture du code entier le montre. C'est le troisième
// test de ce type dans le dépôt, après `is-minor-not-read-elsewhere.spec.ts` et
// `parcours-non-lu-ailleurs.spec.ts`, et pour la même raison : sur ce projet,
// une règle seulement écrite en commentaire a déjà été violée deux fois.
//
// LA RÈGLE À TENIR : hors de `subscriptions/`, aucune lecture directe de
// l'abonnement ne peut fonder une décision d'accès. `EntitlementsService`
// demeure l'unique décideur des capacités payantes.
//
// CETTE RÈGLE SE DÉCOMPOSE EN DEUX, PARCE QUE LE DÉPÔT L'IMPOSE.
//
//   Le STATUT — actif, expiré, résilié — est la notion qui dit « cette personne
//   a droit à ceci maintenant ». Le lire ailleurs, c'est décider ailleurs. Il
//   est donc strictement confiné.
//
//   Le PLAN est aussi un libellé commercial. `commissions.service.ts` s'en sert
//   comme clé produit pour résoudre un barème et distinguer une acquisition d'un
//   renouvellement — un usage antérieur de plusieurs mois à V6-4, qui n'autorise
//   rien. L'interdire aurait exigé une exemption nominative, et une exemption
//   par fichier s'érode : le cas légitime suivant en demanderait une autre.
//
// D'OÙ LE SECOND TEST, qui ne cherche pas le plan mais la DÉCISION : un fichier
// qui lit le plan ET refuse un accès prend une décision d'entitlement hors de
// la couche. Aujourd'hui aucun ne fait les deux — `commissions.service.ts` ne
// lève aucun refus d'accès. Il n'est donc pas une exception inscrite : il est
// hors du champ sémantique de la règle.
// ============================================================================

const RACINE_SRC = join(__dirname, '..');

// Propriétaires légitimes de la notion d'abonnement : le module qui la gère, et
// celui qui en tire les droits.
const DOSSIERS_ABONNEMENT = ['subscriptions', 'entitlements'];

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

function relatif(chemin: string): string {
  return chemin.slice(RACINE_SRC.length + 1).replace(/\\/g, '/');
}

function moduleDe(chemin: string): string {
  return relatif(chemin).split('/')[0];
}

describe('Frontières de la couche d’entitlements', () => {
  // ==========================================================================
  // 1. LE STATUT D'ABONNEMENT NE SE LIT QUE LÀ OÙ IL A UN SENS
  // ==========================================================================
  it('ne laisse aucun autre module déterminer qu’un abonnement est actif', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      if (chemin.endsWith('.spec.ts')) continue;
      if (DOSSIERS_ABONNEMENT.includes(moduleDe(chemin))) continue;

      const code = codeSansCommentaires(chemin);
      if (/\bSubscriptionStatus\b|\bsubscription\.status\b/.test(code)) {
        fautifs.push(relatif(chemin));
      }
    }

    expect(fautifs).toEqual([]);
  });

  // ==========================================================================
  // 2. LE PLAN NE DEVIENT JAMAIS UNE DÉCISION D'ACCÈS AILLEURS
  //
  // On ne cherche pas la lecture — elle peut être commerciale et légitime. On
  // cherche la CONJONCTION : lire le plan ET refuser un accès dans le même
  // fichier. C'est la signature d'une décision d'entitlement prise hors de la
  // couche, et c'est exactement ce que l'architecture interdit.
  // ==========================================================================
  it('ne laisse aucun autre module fonder un refus d’accès sur la formule', () => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(RACINE_SRC)) {
      if (chemin.endsWith('.spec.ts')) continue;
      if (DOSSIERS_ABONNEMENT.includes(moduleDe(chemin))) continue;

      const code = codeSansCommentaires(chemin);
      const litLaFormule = /\bSubscriptionPlan\b|\bsubscription\.plan\b/.test(
        code,
      );
      const refuseUnAcces =
        /\bForbiddenException\b|\bUnauthorizedException\b/.test(code);

      if (litLaFormule && refuseUnAcces) {
        fautifs.push(relatif(chemin));
      }
    }

    expect(fautifs).toEqual([]);
  });

  // ==========================================================================
  // 3. CE QUI N'ENTRE JAMAIS DANS LA COUCHE
  //
  // Les gratuités ne sont pas des entrées autorisées : elles n'ont aucune
  // entrée. Si `APPLICATION_SUBMIT` ou `REPORT_ABUSE` apparaissaient ici, une
  // règle mal écrite pourrait un jour les fermer — candidater ou signaler une
  // situation dangereuse deviendrait payant. C'est la seule protection qui rend
  // cela structurellement impossible plutôt qu'improbable.
  // ==========================================================================
  it.each([
    ['APPLICATION_SUBMIT', /\bAPPLICATION_SUBMIT\b/],
    ['REPORT_ABUSE', /\bREPORT_ABUSE\b/],
    // Le parcours ne peut être lu que par le décideur central, qui l'utilise
    // maintenant pour vérifier l'éligibilité de la formule aux droits.
    ['initialIntent', /\binitialIntent\b/],
    // La catégorie d'organisation est descriptive (V6-3), jamais décisionnelle.
    ['OrganizationCategory', /\bOrganizationCategory\b/],
    // Les règles mineurs ne se monnaient pas.
    ['MinorGatedAction', /\bMinorGatedAction\b/],
  ])('n’introduit jamais %s dans src/entitlements/', (_nom, motif) => {
    const fautifs: string[] = [];

    for (const chemin of fichiersSources(join(RACINE_SRC, 'entitlements'))) {
      if (chemin.endsWith('.spec.ts')) continue;
      if (motif.test(codeSansCommentaires(chemin))) {
        fautifs.push(relatif(chemin));
      }
    }

    expect(fautifs).toEqual([]);
  });
});
