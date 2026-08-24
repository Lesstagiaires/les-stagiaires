import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// `Organization.category` N'EST LUE PAR AUCUNE ZONE SENSIBLE
//
// L'INVARIANT (gouvernance V6-3, V3-16) : la catégorie est DESCRIPTIVE. Elle
// n'intervient dans aucune décision de tarification, d'entitlement,
// d'autorisation, de RBAC, d'abonnement ni de commission.
//
// POURQUOI CE TEST N'EST PAS UNE SIMPLE RECHERCHE DE MOT. Le mot « category »
// est partout dans ce dépôt — `NotificationCategory`, `ReportCategory`,
// `DocumentCategory`, `AmbassadorCategory`, `DigitalSafeDocumentCategory`. Le
// chercher tel quel produirait un bruit tel que le test serait désactivé au
// premier faux positif, et il ne prouverait plus rien.
//
// On cherche donc DEUX FORMES PRÉCISES, les seules par lesquelles la catégorie
// d'une organisation peut être lue :
//   — le type `OrganizationCategory`, qu'il faut nommer pour la manipuler ;
//   — un accès `.category` PORTÉ PAR UNE ORGANISATION, et non par n'importe
//     quoi : `document.category` (coffre-fort) et `notification.category` sont
//     d'autres champs, et les compter aurait rendu ce test ininterprétable.
//
// LA LIMITE, ÉNONCÉE PLUTÔT QUE MASQUÉE. Un accès via une variable nommée
// autrement — `o.category` — échapperait au second motif. Le premier, lui, ne
// s'échappe pas : dans un code typé, on ne manipule pas une valeur de cette
// énumération sans nommer son type quelque part. C'est lui qui porte la
// garantie ; le second n'est qu'un filet supplémentaire.
//
// LE RISQUE CONCRET QU'IL FERME. `AmbassadorCategory` (CAMPUS/BUSINESS)
// influence, elle, la résolution des barèmes de commission. La proximité des
// deux noms rend l'analogie facile : quelqu'un pourrait conclure que la
// catégorie d'organisation a la même portée commerciale. Ce test est ce qui
// l'en empêche.
//
// LES ZONES SURVEILLÉES sont celles où une lecture serait une faute :
// abonnements et paiements (tarification), gardes d'authentification (RBAC),
// commissions. Le module `opportunities` en est exclu : il est PROPRIÉTAIRE de
// la catégorie — il l'écrit, la valide et l'expose.
// ============================================================================

const RACINE_SRC = join(__dirname, '..');

const ZONES_SENSIBLES = [
  { chemin: 'subscriptions', motif: 'tarification et formules' },
  { chemin: join('auth', 'guards'), motif: 'décisions RBAC' },
  { chemin: 'ambassadors', motif: 'commissions' },
];

// Les deux seules façons de lire la catégorie d'une organisation.
const LECTURES_INTERDITES = [
  /\bOrganizationCategory\b/,
  /\borganizations?\??\.category\b/i,
  /\borgs?\??\.category\b/i,
];

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

// Le CODE seul : un commentaire qui explique la règle ne la viole pas.
function codeSansCommentaires(chemin: string): string {
  return readFileSync(chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

describe('La catégorie d’organisation reste descriptive', () => {
  it.each(ZONES_SENSIBLES)(
    'n’est lue nulle part dans $chemin ($motif)',
    ({ chemin }) => {
      const fautifs: string[] = [];

      for (const fichier of fichiersSources(join(RACINE_SRC, chemin))) {
        const code = codeSansCommentaires(fichier);
        for (const lecture of LECTURES_INTERDITES) {
          if (lecture.test(code)) {
            const relatif = fichier
              .slice(RACINE_SRC.length + 1)
              .replace(/\\/g, '/');
            fautifs.push(`${relatif} → ${lecture.source}`);
          }
        }
      }

      expect(fautifs).toEqual([]);
    },
  );

  // La dérivation de formule est LE point où la confusion coûterait de l'argent :
  // lire la catégorie plutôt que la famille ferait basculer une ONG de BUSINESS
  // vers autre chose, ou une école hors d'INSTITUTION. Le fichier est donc
  // vérifié nommément, pour que l'échec désigne la faute au lieu de la faire
  // chercher.
  it('la dérivation de formule continue de lire la FAMILLE, jamais la catégorie', () => {
    const code = codeSansCommentaires(
      join(RACINE_SRC, 'subscriptions', 'subscriptions.service.ts'),
    );

    expect(code).toContain('OrganizationType.ETABLISSEMENT');
    expect(code).not.toMatch(/\bOrganizationCategory\b/);
    expect(code).not.toMatch(/\borganizations?\??\.category\b/i);
  });
});
