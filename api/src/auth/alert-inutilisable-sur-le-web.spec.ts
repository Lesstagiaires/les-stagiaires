import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// ============================================================================
// `Alert.alert` NE FAIT RIEN SUR LE WEB — AUCUN ÉCRAN NE DOIT EN DÉPENDRE
//
// DÉFAUT TROUVÉ EN RECETTE RÉELLE, le 2026-08-09, et corrigé le même jour.
//
// L'écran de consentement parental protégeait le refus par une confirmation :
//
//     Alert.alert(titre, avertissement, [
//       { text: 'Annuler', style: 'cancel' },
//       { text: 'Confirmer', onPress: () => void refuser() },
//     ]);
//
// Sur `react-native-web`, ce module est LITTÉRALEMENT VIDE :
//
//     class Alert { static alert() {} }
//
// Le rappel `onPress` n'était donc jamais atteint. Cliquer « Je refuse » ne
// produisait rien du tout : ni dialogue, ni appel réseau, ni message d'erreur.
// Le tuteur finissait par cliquer sur le seul bouton qui réagissait, et son
// refus était enregistré comme un ACCORD.
//
// POURQUOI CE TEST VIT ICI. Le projet mobile n'a pas d'outillage de test ; le
// mettre en place dépassait le périmètre du correctif autorisé. Ce contrôle
// est statique — il lit des fichiers — donc il tourne aussi bien depuis la
// suite de l'API, et il tourne DÈS AUJOURD'HUI plutôt que jamais.
//
// CE QU'IL PROTÈGE VRAIMENT. Pas une ligne, une CLASSE DE DÉFAUTS : tout écran
// atteignable depuis un navigateur qui confierait une décision à un dialogue
// système la perdrait silencieusement. Le silence est le problème — une erreur
// visible aurait été corrigée en cinq minutes.
// ============================================================================

const ECRANS = join(__dirname, '..', '..', '..', 'mobile', 'app');

// ============================================================================
// DETTE CONNUE, ET ASSUMÉE COMME TELLE
//
// Ce garde-fou, dès sa première exécution, a trouvé deux autres écrans portant
// le même défaut — des actions DESTRUCTRICES rendues silencieusement
// inopérantes sur le web :
//
//   applications/[id].tsx   → retrait d'une candidature
//   digital-safe/[id].tsx   → suppression d'un document
//
// Ils n'ont pas été corrigés : le promoteur avait autorisé le correctif du
// refus parental, pas une refonte de tous les écrans. Ils sont signalés et
// attendent son arbitrage.
//
// POURQUOI UNE LISTE EXPLICITE PLUTÔT QU'UN TEST DÉSACTIVÉ. Un test mis en
// commentaire disparaît de la mémoire collective en une semaine. Une liste
// nommée, elle, se lit dans le code, se raccourcit quand on corrige, et REFUSE
// tout nouvel arrivant : un écran ajouté demain avec `Alert.alert` fera échouer
// la suite, même si ces deux-là y figurent encore.
//
// Toute correction doit RETIRER la ligne correspondante. Le test échouera
// sinon — un écran corrigé ne doit pas rester inscrit comme fautif.
// ============================================================================
const DETTE_CONNUE = [
  'mobile\\app\\(app)\\applications\\[id].tsx',
  'mobile\\app\\(app)\\digital-safe\\[id].tsx',
].map((c) => c.replace(/\\/g, '/'));

function fichiersEcrans(dir: string, out: string[] = []): string[] {
  for (const entree of readdirSync(dir)) {
    const chemin = join(dir, entree);
    if (statSync(chemin).isDirectory()) fichiersEcrans(chemin, out);
    else if (chemin.endsWith('.tsx')) out.push(chemin);
  }
  return out;
}

// Les commentaires sont retirés avant l'analyse : ce test ne doit pas punir la
// documentation. Le bloc d'explication de l'écran corrigé cite `Alert.alert`
// pour expliquer pourquoi il ne faut pas s'en servir — le sanctionner serait
// absurde, et pousserait à effacer précisément ce qu'il faut garder.
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Aucun écran ne confie une décision à Alert.alert', () => {
  it('le module mobile existe et est analysable', () => {
    // Si l'arborescence bouge, ce test doit échouer bruyamment plutôt que de
    // passer sur zéro fichier en donnant une fausse assurance.
    expect(fichiersEcrans(ECRANS).length).toBeGreaterThan(10);
  });

  // Chemin relatif, séparateurs uniformisés : le test doit dire la même chose
  // sous Windows et sous Linux, faute de quoi il ne tiendra pas dans la chaîne
  // d'intégration continue.
  const relatif = (f: string) =>
    f.slice(f.indexOf('mobile')).replace(/\\/g, '/');

  it('aucun NOUVEL écran n’appelle Alert.alert', () => {
    const fautifs = fichiersEcrans(ECRANS)
      .filter((f) =>
        /\bAlert\s*\.\s*alert\s*\(/.test(
          sansCommentaires(readFileSync(f, 'utf8')),
        ),
      )
      .map(relatif)
      .sort();

    expect(fautifs).toEqual([...DETTE_CONNUE].sort());
  });

  it("aucun NOUVEL écran n'importe Alert depuis react-native", () => {
    // Interdire l'import ferme la porte plus tôt que d'interdire l'appel :
    // `const { alert } = Alert` puis `alert(...)` échapperait au contrôle
    // précédent, mais pas à celui-ci.
    const fautifs = fichiersEcrans(ECRANS)
      .filter((f) => {
        const code = sansCommentaires(readFileSync(f, 'utf8'));
        const imports = code.match(
          /import\s*\{([^}]*)\}\s*from\s*'react-native'/g,
        );
        return imports?.some((i) => /\bAlert\b/.test(i)) ?? false;
      })
      .map(relatif)
      .sort();

    expect(fautifs).toEqual([...DETTE_CONNUE].sort());
  });

  it("l'écran du consentement parental ne figure plus parmi les fautifs", () => {
    // Le seul écran qu'un TUTEUR atteint — par un lien reçu par SMS, dans un
    // navigateur, sans application. C'est celui dont le défaut rendait le refus
    // impossible, et c'est celui que le correctif du 2026-08-09 a traité.
    expect(DETTE_CONNUE).not.toContain(
      'mobile/app/(auth)/consent/[linkId].tsx',
    );

    const code = sansCommentaires(
      readFileSync(join(ECRANS, '(auth)', 'consent', '[linkId].tsx'), 'utf8'),
    );
    expect(code).not.toMatch(/\bAlert\s*\.\s*alert\s*\(/);
  });

  it('la décision du tuteur reste atteignable par deux gestes', () => {
    // Le garde-fou n'a pas été supprimé au passage : refuser doit toujours
    // demander une confirmation. Un correctif qui rendrait le refus atteignable
    // EN UN SEUL CLIC échangerait un défaut contre un autre — un doigt qui
    // glisse bloquerait le compte d'un enfant.
    const ecran = readFileSync(
      join(ECRANS, '(auth)', 'consent', '[linkId].tsx'),
      'utf8',
    );
    const code = sansCommentaires(ecran);

    // Un état intermédiaire existe, et le refus effectif en dépend.
    expect(code).toMatch(/refusAConfirmer/);
    expect(code).toMatch(/setRefusAConfirmer\(true\)/);
    expect(code).toMatch(/declineParentalConsent/);
  });
});
