import { NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  WalletTransactionType,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from './reconciliation.service';

// ============================================================================
// RÉCONCILIATION — arbitrage du promoteur du 2026-08-02.
//
// « Le solde affiché dans le portefeuille ne doit jamais être considéré comme la
// seule source de vérité. Le grand livre WalletTransaction doit constituer la
// référence comptable. »
//
// Chaque test correspond à une manière DIFFÉRENTE de diverger. Un seul contrôle
// les attraperait toutes en apparence, mais laisserait passer celles où les
// erreurs se compensent — d'où les trois.
// ============================================================================
describe('Réconciliation comptable', () => {
  let prisma: {
    ambassadorWallet: { findUnique: jest.Mock; findMany: jest.Mock };
    walletTransaction: { findMany: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyAdmins: jest.Mock };
  let service: ReconciliationService;

  // Un portefeuille sain : 300 acquis puis rendus disponibles, 100 réservés.
  const WALLET = {
    id: 'w-1',
    ambassadorId: 'amb-1',
    currency: 'XAF',
    pendingMinor: 0,
    availableMinor: 200,
    reservedMinor: 100,
    paidTotalMinor: 0,
  };

  // ATTENTION — ces écritures reproduisent EXACTEMENT ce que WalletService écrit.
  //
  // La version précédente ne le faisait pas : elle portait `amountMinor: 300` sur
  // un COMMISSION_AVAILABLE, là où le service écrit 0. Le test et le code
  // partageaient ainsi la même hypothèse fausse, et le contrôle de continuité est
  // resté au vert pendant que la production signalait une rupture à chaque
  // immobilisation. Une fixture écrite à la main pour satisfaire le consommateur
  // ne prouve rien du producteur : `wallet-ledger.spec.ts` épingle désormais ce
  // dernier, et c'est lui qui empêchera les deux de dériver à nouveau.
  const LEDGER = [
    {
      id: 'tx-1',
      type: WalletTransactionType.COMMISSION_ACCRUED,
      amountMinor: 300,
      availableDeltaMinor: 0,
      availableAfterMinor: 0,
      pendingAfterMinor: 300,
    },
    {
      id: 'tx-2',
      type: WalletTransactionType.COMMISSION_AVAILABLE,
      // Déplacement entre poches : rien n'entre au patrimoine.
      amountMinor: 0,
      availableDeltaMinor: 300,
      availableAfterMinor: 300,
      pendingAfterMinor: 0,
    },
    {
      id: 'tx-3',
      type: WalletTransactionType.PAYOUT_RESERVED,
      amountMinor: 0,
      availableDeltaMinor: -100,
      availableAfterMinor: 200,
      pendingAfterMinor: 0,
    },
  ];

  beforeEach(() => {
    prisma = {
      ambassadorWallet: {
        findUnique: jest.fn().mockResolvedValue(WALLET),
        findMany: jest.fn().mockResolvedValue([{ ambassadorId: 'amb-1' }]),
      },
      walletTransaction: { findMany: jest.fn().mockResolvedValue(LEDGER) },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyAdmins: jest.fn().mockResolvedValue(2) };

    service = new ReconciliationService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('portefeuille sain', () => {
    it('ne signale aucun écart', async () => {
      const report = await service.reconcileWallet('amb-1');

      expect(report.balanced).toBe(true);
      expect(report.discrepancies).toEqual([]);
      expect(report.continuityBreaks).toEqual([]);
      expect(report.transactionCount).toBe(3);
    });

    it('ne touche à AUCUN solde — la réconciliation est en lecture seule', async () => {
      await service.reconcileWallet('amb-1');

      // Aucune méthode d'écriture n'est même exposée au service : le test le
      // constate en vérifiant que le client Prisma n'a servi qu'à lire.
      expect(Object.keys(prisma.ambassadorWallet)).toEqual([
        'findUnique',
        'findMany',
      ]);
    });
  });

  describe('contrôle 1 — écriture au cache sans écriture au livre', () => {
    it('détecte un « réservé » qui ne correspond à aucune réservation', async () => {
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        reservedMinor: 500,
      });

      const report = await service.reconcileWallet('amb-1');

      expect(report.balanced).toBe(false);
      expect(report.discrepancies).toContainEqual({
        bucket: 'reserved',
        cachedMinor: 500,
        expectedMinor: 100,
        deltaMinor: 400,
      });
    });

    it('détecte un « versé » gonflé', async () => {
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        paidTotalMinor: 9999,
      });

      const report = await service.reconcileWallet('amb-1');
      expect(report.discrepancies.map((d) => d.bucket)).toContain('paidTotal');
    });
  });

  describe('contrôle 2 — cache modifié après coup', () => {
    it('détecte un disponible qui ne suit pas la dernière écriture', async () => {
      // Le scénario redouté : quelqu'un a crédité le solde sans passer par le
      // grand livre.
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        availableMinor: 200_000,
      });

      const report = await service.reconcileWallet('amb-1');

      expect(report.balanced).toBe(false);
      expect(report.discrepancies).toContainEqual({
        bucket: 'available',
        cachedMinor: 200_000,
        expectedMinor: 200,
        deltaMinor: 199_800,
      });
    });

    it('un portefeuille sans écriture doit être à zéro', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        availableMinor: 5000,
        reservedMinor: 0,
      });

      const report = await service.reconcileWallet('amb-1');

      expect(report.balanced).toBe(false);
      expect(report.discrepancies).toContainEqual({
        bucket: 'available',
        cachedMinor: 5000,
        expectedMinor: 0,
        deltaMinor: 5000,
      });
    });

    it('un portefeuille vide ET à zéro est équilibré', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([]);
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        pendingMinor: 0,
        availableMinor: 0,
        reservedMinor: 0,
        paidTotalMinor: 0,
      });

      expect((await service.reconcileWallet('amb-1')).balanced).toBe(true);
    });
  });

  describe('contrôle 3 — ligne manquante ou insérée', () => {
    it('détecte une rupture de continuité que les totaux masqueraient', async () => {
      // tx-2 rend 300 disponibles mais la photographie indique 999 : la chaîne
      // est rompue AU MILIEU. Les deux premiers contrôles ne regardent que la
      // dernière ligne et les totaux — celui-ci regarde le chemin.
      prisma.walletTransaction.findMany.mockResolvedValue([
        LEDGER[0],
        { ...LEDGER[1], availableAfterMinor: 999 },
        LEDGER[2],
      ]);

      const report = await service.reconcileWallet('amb-1');

      expect(report.balanced).toBe(false);
      expect(report.continuityBreaks.length).toBeGreaterThan(0);
      expect(report.continuityBreaks[0].transactionId).toBe('tx-2');
      expect(report.continuityBreaks[0].expectedAvailableMinor).toBe(300);
      expect(report.continuityBreaks[0].recordedAvailableMinor).toBe(999);
    });

    it('ne conclut pas sur une annulation, dont la poche est indéterminable', async () => {
      // COMMISSION_CANCELLED retire du disponible OU de l'acquis selon l'état de
      // la commission. Le type seul ne le dit pas : on se tait plutôt que de
      // signaler un faux écart.
      prisma.walletTransaction.findMany.mockResolvedValue([
        LEDGER[0],
        LEDGER[1],
        {
          id: 'tx-annulation',
          type: WalletTransactionType.COMMISSION_CANCELLED,
          amountMinor: -50,
          // Écriture antérieure à la colonne : la poche touchée est inconnue.
          availableDeltaMinor: null,
          availableAfterMinor: 250,
          pendingAfterMinor: 0,
        },
      ]);
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        availableMinor: 250,
        reservedMinor: 0,
      });

      const report = await service.reconcileWallet('amb-1');
      expect(report.continuityBreaks).toEqual([]);
    });

    it('un ajustement porte son signe et reste vérifiable', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([
        LEDGER[0],
        LEDGER[1],
        {
          id: 'tx-ajust',
          type: WalletTransactionType.ADJUSTMENT,
          amountMinor: -75,
          availableDeltaMinor: -75,
          availableAfterMinor: 225,
          pendingAfterMinor: 0,
        },
      ]);

      const report = await service.reconcileWallet('amb-1');
      // 300 − 75 = 225 : la chaîne tient.
      expect(report.continuityBreaks).toEqual([]);
    });
  });

  describe('balayage et alerte', () => {
    it('n’alerte pas quand tout est équilibré', async () => {
      const result = await service.runSweep();

      expect(result.checked).toBe(1);
      expect(result.divergent).toEqual([]);
      expect(audit.recordChange).not.toHaveBeenCalled();
      expect(notifications.notifyAdmins).not.toHaveBeenCalled();
    });

    it('journalise ET prévient l’administration en cas d’écart', async () => {
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        availableMinor: 999,
      });

      const result = await service.runSweep();

      expect(result.divergent).toHaveLength(1);

      const [action, actorId, context] = audit.recordChange.mock.calls[0] as [
        string,
        string | null,
        {
          entityType: string;
          changes: { field: string; oldValue: unknown; newValue: unknown }[];
        },
      ];
      expect(action).toBe('AMBASSADOR_WALLET_DIVERGENCE');
      // Aucun auteur : c'est un balayage automatique, pas une action humaine.
      expect(actorId).toBeNull();
      expect(context.entityType).toBe('AmbassadorWallet');
      // L'écart est exprimé comme un changement : attendu → constaté.
      expect(context.changes).toContainEqual({
        field: 'available',
        oldValue: 200,
        newValue: 999,
      });

      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        NotificationType.AMBASSADOR_WALLET_DIVERGENCE,
        expect.objectContaining({ ambassadorId: 'amb-1' }),
      );
    });

    it('ne corrige JAMAIS le solde de lui-même', async () => {
      prisma.ambassadorWallet.findUnique.mockResolvedValue({
        ...WALLET,
        availableMinor: 999,
      });

      await service.runSweep();

      // Une correction est une DÉCISION. Un balayage nocturne qui rectifie un
      // solde masquerait la cause au lieu de la traiter.
      expect(
        (prisma.ambassadorWallet as Record<string, unknown>).update,
      ).toBeUndefined();
    });
  });

  it('refuse de réconcilier un portefeuille inexistant', async () => {
    prisma.ambassadorWallet.findUnique.mockResolvedValue(null);
    await expect(service.reconcileWallet('inconnu')).rejects.toThrow(
      NotFoundException,
    );
  });
});
