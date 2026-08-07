import { readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// LE MOTEUR ANTIFRAUDE NE SANCTIONNE JAMAIS
//
// « Elles ne devront JAMAIS entraîner automatiquement une sanction, une
// suspension ou un refus de paiement. Leur rôle est uniquement de : détecter ;
// alerter ; journaliser ; orienter l'administration vers un contrôle manuel. »
// — arbitrage du promoteur du 2026-08-04.
//
// Ce test inspecte le CODE SOURCE, comme `no-physical-deletion.spec.ts`. Un test
// de comportement ordinaire ne verrait que ce qu'on a pensé à lui montrer ; la
// question ici n'est pas « le service sanctionne-t-il dans ce cas ? » mais « le
// service PEUT-il sanctionner ? ».
//
// La réponse tient à ses dépendances : n'ayant ni service d'ambassadeurs, ni
// service de commissions, ni service de versements, ni portefeuille, il n'a
// matériellement aucun moyen d'agir. Ce test interdit à ces dépendances de
// réapparaître un jour « pour faire au plus simple ».
// ============================================================================
describe('Antifraude — aucun pouvoir de sanction', () => {
  // LES COMMENTAIRES SONT RETIRÉS avant inspection. Sans cela, la phrase du
  // fichier qui explique « ce service ne reçoit ni AmbassadorsService, ni
  // CommissionsService… » ferait échouer le test qu'elle décrit — un test qui
  // sanctionne sa propre documentation ne mesure plus rien.
  const source = readFileSync(
    join(__dirname, 'fraud-detection.service.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Les services par lesquels une sanction passerait forcément.
  const SERVICES_INTERDITS = [
    'AmbassadorsService',
    'CommissionsService',
    'PayoutsService',
    'WalletService',
  ];

  it.each(SERVICES_INTERDITS)('n’a aucune dépendance vers %s', (service) => {
    expect(source).not.toContain(service);
  });

  // Les écritures par lesquelles une sanction se matérialiserait. Le moteur
  // n'écrit QUE dans ses propres tables.
  const ECRITURES_INTERDITES = [
    'ambassador.update',
    'commission.update',
    'payoutRequest.update',
    'ambassadorWallet.update',
    'walletTransaction.create',
  ];

  it.each(ECRITURES_INTERDITES)('n’écrit jamais via %s', (ecriture) => {
    expect(source).not.toContain(ecriture);
  });

  it('n’écrit que dans ses propres tables', () => {
    const ecritures = [
      ...source.matchAll(
        /prisma\.(\w+)\.(create|update|delete|upsert|updateMany|deleteMany)/g,
      ),
    ].map((m) => `${m[1]}.${m[2]}`);

    // Le message d'échec liste les écritures fautives : sans cela, on saurait
    // que le test casse sans savoir laquelle a été ajoutée.
    const interdites = ecritures.filter(
      (e) => !e.startsWith('fraudAlert.') && !e.startsWith('fraudRule.'),
    );
    expect(interdites).toEqual([]);
    // Et qu'il en reste au moins une : un service qui n'écrirait plus rien du
    // tout passerait ce test sans rien garantir.
    expect(ecritures.length).toBeGreaterThan(0);
  });

  it('ne prononce aucun statut de sanction', () => {
    // Ces valeurs existent dans le système ; aucune ne doit être écrite ici.
    for (const statut of ['SUSPENDED', 'TERMINATED', 'BLOCKED', 'REJECTED']) {
      expect(source).not.toContain(`AmbassadorStatus.${statut}`);
      expect(source).not.toContain(`CommissionStatus.${statut}`);
      expect(source).not.toContain(`PayoutRequestStatus.${statut}`);
    }
  });

  it('l’alerte va à l’ADMINISTRATION, jamais à l’intéressé', () => {
    // Prévenir quelqu'un qu'il est surveillé est le meilleur moyen de lui
    // apprendre à ne plus l'être.
    expect(source).toContain('notifyAdmins');
    expect(source).not.toContain('notifyAmbassador');
    expect(source).not.toContain('notifyUser');
  });
});
