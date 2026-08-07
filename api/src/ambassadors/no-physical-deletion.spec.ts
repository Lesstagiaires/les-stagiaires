import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// DETTE TECHNIQUE MAÎTRISÉE — SIX cascades conservées sciemment
//
// Six clés étrangères restent en `onDelete: Cascade` depuis `Ambassador` :
// AmbassadorReferral, AmbassadorPortfolioEntry, AmbassadorWallet, Commission,
// PayoutRequest et AmbassadorPaymentDetail.
//
// CORRECTION DU 2026-08-05. La note initiale n'en citait que deux et
// sous-estimait donc la portée : DEUX D'ENTRE ELLES SONT FINANCIÈRES —
// AmbassadorWallet et Commission. La revue de phase 1 l'a établi en interrogeant
// la base plutôt qu'en relisant la documentation, ce qui est précisément
// pourquoi une revue interroge la base.
//
// Le promoteur a validé leur maintien provisoire le 2026-08-02, à quatre
// conditions, dont celle-ci :
//
//   « la suppression physique d'un dossier Ambassador reste impossible dans le
//     code métier, et cette hypothèse est protégée par un test. »
//
// C'est ce test. Il n'inspecte pas un comportement mais le CODE LUI-MÊME : la
// garantie porte sur l'absence d'une opération, et une absence ne s'observe pas à
// l'exécution.
//
// SI CE TEST ÉCHOUE, ne le neutralisez pas. Il signale que quelqu'un vient
// d’introduire une suppression de dossier — auquel cas les SIX cascades doivent
// être supprimées AVANT, faute de quoi le portefeuille, les commissions, le
// parrainage et les demandes de versement disparaîtraient avec le dossier — soit
// tout ce qui justifie les sommes déjà payées.
// ============================================================================
describe('Ambassadeurs — aucune suppression physique de dossier', () => {
  const SRC = path.resolve(__dirname, '..');

  // Opérations Prisma qui détruiraient un dossier et déclencheraient les deux
  // cascades restantes.
  const FORBIDDEN = [
    /\.ambassador\s*\.\s*delete\s*\(/,
    /\.ambassador\s*\.\s*deleteMany\s*\(/,
  ];

  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      // Les fichiers de test sont exclus : un test a le droit de simuler une
      // suppression pour vérifier qu'elle est refusée.
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [full]
        : [];
    });

  it('aucun service n’appelle delete() ni deleteMany() sur Ambassador', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.test(content)) {
          offenders.push(`${path.relative(SRC, file)} — ${pattern.source}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('la sortie du programme passe par un STATUT, pas par une suppression', () => {
    const service = fs.readFileSync(
      path.join(SRC, 'ambassadors', 'ambassadors.service.ts'),
      'utf8',
    );

    // `terminate()` doit exister et écrire un statut : c'est la seule façon de
    // faire sortir quelqu'un du programme.
    expect(service).toContain('async terminate(');
    expect(service).toContain('AmbassadorStatus.TERMINATED');
  });
});
