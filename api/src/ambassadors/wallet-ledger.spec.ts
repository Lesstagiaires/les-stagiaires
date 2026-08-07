import type { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

// ============================================================================
// CE QUE LE GRAND LIVRE ÉCRIT, EXACTEMENT
//
// Ce fichier existe à cause d'un défaut trouvé le 2026-08-04 par la première
// recette de versement menée de bout en bout — jamais par un test unitaire.
//
// `ReconciliationService` supposait que PAYOUT_RESERVED portait le montant
// déplacé dans `amountMinor`. `WalletService` y écrivait ZÉRO. Les deux se
// contredisaient depuis des semaines, et les tests étaient au vert : la fixture
// de la réconciliation avait été écrite À LA MAIN pour satisfaire le
// consommateur, sans jamais confronter ce que le producteur écrit vraiment.
//
// Une fixture n'est pas une preuve. Ces tests-ci vérifient le PRODUCTEUR : ce
// que chaque méthode de WalletService inscrit réellement. Tant qu'ils existent,
// le consommateur ne peut plus dériver sans qu'on le voie.
//
// DEUX COLONNES, DEUX SENS — la distinction qui avait été manquée :
//   `amountMinor`         ce qui ENTRE ou SORT du patrimoine de l'ambassadeur.
//                         Zéro sur un déplacement entre poches.
//   `availableDeltaMinor` l'effet sur la SEULE poche « disponible ».
// ============================================================================
describe('Grand livre — ce que chaque écriture porte', () => {
  let prisma: {
    ambassadorWallet: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    walletTransaction: { create: jest.Mock };
  };
  let service: WalletService;

  const WALLET = {
    id: 'wallet-1',
    ambassadorId: 'amb-1',
    currency: 'XAF',
    availableMinor: 500000,
    pendingMinor: 200000,
    reservedMinor: 0,
    paidTotalMinor: 0,
  };

  beforeEach(() => {
    prisma = {
      ambassadorWallet: {
        findUnique: jest.fn().mockResolvedValue(WALLET),
        findUniqueOrThrow: jest.fn().mockResolvedValue(WALLET),
        create: jest.fn().mockResolvedValue(WALLET),
        update: jest.fn().mockResolvedValue(WALLET),
      },
      walletTransaction: { create: jest.fn() },
    };
    service = new WalletService(prisma as unknown as PrismaService);
  });

  const written = () =>
    (
      (prisma.walletTransaction.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  it('une commission acquise ENTRE au patrimoine, sans toucher au disponible', async () => {
    await service.accrue(
      prisma as unknown as PrismaService,
      'amb-1',
      'XAF',
      40000,
      'com-1',
    );

    const entry = written();
    expect(entry.type).toBe('COMMISSION_ACCRUED');
    expect(entry.amountMinor).toBe(40000);
    // Elle entre en ATTENTE : le disponible ne bouge pas.
    expect(entry.availableDeltaMinor).toBe(0);
  });

  it('la mise à disposition ne fait que DÉPLACER — zéro au patrimoine', async () => {
    await service.makeAvailable(
      prisma as unknown as PrismaService,
      'wallet-1',
      40000,
      'com-1',
    );

    const entry = written();
    expect(entry.type).toBe('COMMISSION_AVAILABLE');
    // Rien n'est gagné : la commission l'était déjà.
    expect(entry.amountMinor).toBe(0);
    expect(entry.availableDeltaMinor).toBe(40000);
  });

  it('une immobilisation retire du disponible sans rien retirer du dû', async () => {
    await service.reserveForPayout(
      prisma as unknown as PrismaService,
      'wallet-1',
      100000,
      'payout-1',
    );

    const entry = written();
    expect(entry.type).toBe('PAYOUT_RESERVED');
    // C'EST LE CŒUR DU DÉFAUT CORRIGÉ : zéro ici, le montant là.
    expect(entry.amountMinor).toBe(0);
    expect(entry.availableDeltaMinor).toBe(-100000);
  });

  it('la libération rend au disponible, toujours sans toucher au dû', async () => {
    await service.releaseReservation(
      prisma as unknown as PrismaService,
      'wallet-1',
      100000,
      'payout-1',
      'REJET',
    );

    const entry = written();
    expect(entry.type).toBe('PAYOUT_RELEASED');
    expect(entry.amountMinor).toBe(0);
    expect(entry.availableDeltaMinor).toBe(100000);
  });

  it('un versement exécuté SORT du patrimoine, depuis l’immobilisé', async () => {
    await service.executePayout(
      prisma as unknown as PrismaService,
      'wallet-1',
      100000,
      'payout-1',
      'admin-1',
    );

    const entry = written();
    expect(entry.type).toBe('PAYOUT_EXECUTED');
    expect(entry.amountMinor).toBe(-100000);
    // L'argent quitte l'immobilisé : le disponible n'a jamais été touché.
    expect(entry.availableDeltaMinor).toBe(0);
  });

  it('une annulation dit DE QUELLE POCHE elle retire', async () => {
    await service.cancelAccrual(
      prisma as unknown as PrismaService,
      'wallet-1',
      40000,
      'com-1',
      true, // depuis le disponible
      'FRAUDE',
    );

    const entry = written();
    expect(entry.amountMinor).toBe(-40000);
    expect(entry.availableDeltaMinor).toBe(-40000);
  });

  it('… et une annulation depuis l’attente ne touche pas au disponible', async () => {
    await service.cancelAccrual(
      prisma as unknown as PrismaService,
      'wallet-1',
      40000,
      'com-1',
      false, // depuis l'attente
      'FRAUDE',
    );

    const entry = written();
    expect(entry.amountMinor).toBe(-40000);
    expect(entry.availableDeltaMinor).toBe(0);
  });

  it('un ajustement porte son signe dans les deux colonnes', async () => {
    await service.adjust(
      prisma as unknown as PrismaService,
      'wallet-1',
      -7500,
      'admin-1',
      'Reprise après impayé du prestataire de paiement.',
    );

    const entry = written();
    expect(entry.amountMinor).toBe(-7500);
    expect(entry.availableDeltaMinor).toBe(-7500);
  });

  // LA PROPRIÉTÉ QU'IL NE FAUT PAS CASSER : la somme de `amountMinor` donne, à
  // tout instant, ce qui est dû à l'ambassadeur. Elle ne tient que si les
  // déplacements entre poches y valent zéro.
  it('la somme des montants donne ce qui est dû, déplacements exclus', async () => {
    const db = prisma as unknown as PrismaService;
    await service.accrue(db, 'amb-1', 'XAF', 40000, 'com-1'); // +40 000
    await service.makeAvailable(db, 'wallet-1', 40000, 'com-1'); //      0
    await service.reserveForPayout(db, 'wallet-1', 40000, 'payout-1'); // 0
    await service.executePayout(db, 'wallet-1', 40000, 'payout-1', 'a'); // −40 000

    const total = (prisma.walletTransaction.create.mock.calls as unknown[][])
      .map(
        (call) =>
          (call[0] as { data: { amountMinor: number } }).data.amountMinor,
      )
      .reduce((sum, amount) => sum + amount, 0);

    // Gagné puis intégralement versé : plus rien n'est dû.
    expect(total).toBe(0);
  });
});
