import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import type { CommissionCapsService } from './commission-caps.service';
import type { CommissionRulesService } from './commission-rules.service';
import { CommissionsService } from './commissions.service';
import type { WalletService } from './wallet.service';

// ============================================================================
// ARBITRAGE D'UNE COMMISSION MISE EN CONTRÔLE PAR UN PLAFOND
//
// « L'administration doit alors valider ou corriger la commission, avec
// journalisation complète. » — arbitrage 15 du promoteur, 2026-08-02.
//
// Trois issues et trois seulement. Ce qui se joue ici, ce n'est pas le calcul —
// il a déjà eu lieu — mais le moment du CRÉDIT : tant qu'une commission est en
// contrôle, aucune écriture ne touche le portefeuille. Créditer puis reprendre
// ferait apparaître à l'ambassadeur un solde qu'on lui retirerait ensuite, et
// laisserait dans le grand livre deux écritures pour un fait qui n'a jamais eu
// lieu.
// ============================================================================
describe('Commission en contrôle — arbitrage', () => {
  let prisma: {
    commission: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    commissionEvent: { create: jest.Mock };
    ambassador: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock; notifyAdmins: jest.Mock };
  let wallet: { accrue: jest.Mock };
  let service: CommissionsService;

  const EN_CONTROLE = {
    id: 'com-1',
    ambassadorId: 'amb-1',
    status: 'REVIEW_REQUIRED',
    amountMinor: 200_000,
    currency: 'XAF',
    reviewReason: 'CAP_EXCEEDED',
    securityPeriodEndsAt: new Date('2026-09-03T00:00:00Z'),
  };

  const MOTIF = {
    internalNote:
      'Plafond mensuel franchi, dossier vérifié avec la comptabilité.',
    reasonCode: 'COMPLIANCE_REVIEW' as never,
  };

  beforeEach(() => {
    prisma = {
      commission: {
        findUnique: jest.fn().mockResolvedValue(EN_CONTROLE),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...EN_CONTROLE, ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      commissionEvent: { create: jest.fn() },
      ambassador: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'u-1' }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn(), notifyAdmins: jest.fn() };
    wallet = { accrue: jest.fn() };

    service = new CommissionsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      {} as unknown as CommissionRulesService,
      wallet as unknown as WalletService,
      {} as unknown as AmbassadorPolicyService,
      {} as unknown as CommissionCapsService,
    );
  });

  const callsOf = (mock: jest.Mock) => mock.mock.calls as unknown[][];

  const updateData = () =>
    (
      callsOf(prisma.commission.update)[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  const eventData = (call = 0) =>
    (
      callsOf(prisma.commissionEvent.create)[call][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --- Le verrou d'état -----------------------------------------------------
  describe('seule une commission EN CONTRÔLE est modifiable', () => {
    it.each(['PENDING', 'PAYABLE', 'PAID', 'CANCELLED'])(
      'refuse d’arbitrer une commission en %s',
      async (status) => {
        prisma.commission.findUnique.mockResolvedValue({
          ...EN_CONTROLE,
          status,
        });

        // Le constat financier redevient immuable dès l'instant où il a été
        // validé. Sans ce verrou, « corriger » deviendrait un moyen de retoucher
        // une commission déjà payée.
        await expect(
          service.correctReviewed('admin-1', 'com-1', {
            ...MOTIF,
            amountMinor: 100_000,
          }),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('refuse une commission inexistante', async () => {
      prisma.commission.findUnique.mockResolvedValue(null);
      await expect(
        service.releaseReviewed('admin-1', 'com-x', {
          internalNote: 'Vérification faite auprès du service comptable.',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --- Validation en l'état -------------------------------------------------
  describe('validation en l’état', () => {
    it('rend la commission au circuit normal pour le montant du barème', async () => {
      await service.releaseReviewed('admin-1', 'com-1', {
        internalNote:
          'Gros contrat, dépassement légitime, validé par la direction.',
      });

      expect(updateData().status).toBe('PENDING');
      expect(updateData().reviewedById).toBe('admin-1');
      // Le montant N'EST PAS touché : valider, c'est servir ce que le barème
      // avait calculé.
      expect(updateData().amountMinor).toBeUndefined();
      expect(updateData().originalAmountMinor).toBeUndefined();
    });

    it('crédite le portefeuille MAINTENANT, et pas avant', async () => {
      await service.releaseReviewed('admin-1', 'com-1', {
        internalNote: 'Dépassement contrôlé et justifié par la comptabilité.',
      });

      expect(wallet.accrue).toHaveBeenCalledTimes(1);
      expect(wallet.accrue).toHaveBeenCalledWith(
        prisma,
        'amb-1',
        'XAF',
        200_000,
        'com-1',
      );
    });

    it('journalise l’ancien et le nouveau statut, note interne comprise', async () => {
      await service.releaseReviewed('admin-1', 'com-1', {
        internalNote: 'Client historique, montant conforme au contrat cadre.',
      });

      const [action, actorId, context] = callsOf(audit.recordChange)[0] as [
        string,
        string,
        {
          changes: { field: string; oldValue: unknown; newValue: unknown }[];
          metadata: Record<string, unknown>;
        },
      ];
      expect(action).toBe('AMBASSADOR_COMMISSION_REVIEW_RELEASED');
      expect(actorId).toBe('admin-1');
      expect(context.changes).toContainEqual({
        field: 'status',
        oldValue: 'REVIEW_REQUIRED',
        newValue: 'PENDING',
      });
      expect(context.metadata.internalNote).toBe(
        'Client historique, montant conforme au contrat cadre.',
      );
    });
  });

  // --- Correction -----------------------------------------------------------
  describe('correction', () => {
    it('refuse une correction À LA HAUSSE', async () => {
      // Le contrôle d'un dépassement ne doit pas devenir le chemin par lequel on
      // s'accorde plus que le barème. La base l'interdit aussi.
      await expect(
        service.correctReviewed('admin-1', 'com-1', {
          ...MOTIF,
          amountMinor: 300_000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse une correction au montant identique', async () => {
      await expect(
        service.correctReviewed('admin-1', 'com-1', {
          ...MOTIF,
          amountMinor: 200_000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse une correction à zéro — c’est une annulation', async () => {
      await expect(
        service.correctReviewed('admin-1', 'com-1', {
          ...MOTIF,
          amountMinor: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('conserve le montant du barème à côté du montant retenu', async () => {
      await service.correctReviewed('admin-1', 'com-1', {
        ...MOTIF,
        amountMinor: 150_000,
      });

      expect(updateData().amountMinor).toBe(150_000);
      // Sans ce champ, la commission ressemblerait rétrospectivement à un calcul
      // ordinaire et la décision humaine aurait disparu du dossier.
      expect(updateData().originalAmountMinor).toBe(200_000);
    });

    it('ne crédite QUE le montant corrigé', async () => {
      await service.correctReviewed('admin-1', 'com-1', {
        ...MOTIF,
        amountMinor: 150_000,
      });

      expect(wallet.accrue).toHaveBeenCalledWith(
        prisma,
        'amb-1',
        'XAF',
        150_000,
        'com-1',
      );
    });

    it('journalise le montant avant et après', async () => {
      await service.correctReviewed('admin-1', 'com-1', {
        ...MOTIF,
        amountMinor: 150_000,
      });

      const context = callsOf(audit.recordChange)[0][2] as {
        changes: { field: string; oldValue: unknown; newValue: unknown }[];
      };
      expect(context.changes).toContainEqual({
        field: 'amountMinor',
        oldValue: 200_000,
        newValue: 150_000,
      });
    });
  });

  // --- LA RÈGLE DES TROIS NIVEAUX DE MOTIF ---------------------------------
  describe('aucune note interne ne part en notification', () => {
    it('la notification de correction porte le CODE, jamais la note', async () => {
      const note = 'Soupçon de complaisance sur ce dossier, à surveiller.';

      await service.correctReviewed('admin-1', 'com-1', {
        internalNote: note,
        reasonCode: 'COMPLIANCE_REVIEW',
        amountMinor: 150_000,
      });

      const [userId, type, metadata] = callsOf(notifications.notifyUser)[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(userId).toBe('u-1');
      expect(type).toBe('AMBASSADOR_COMMISSION_EARNED');
      expect(metadata.reasonCode).toBe('COMPLIANCE_REVIEW');
      expect(JSON.stringify(metadata)).not.toContain('complaisance');
      expect(metadata.internalNote).toBeUndefined();
    });

    it('la notification annonce le montant RETENU, pas celui du barème', async () => {
      await service.correctReviewed('admin-1', 'com-1', {
        ...MOTIF,
        amountMinor: 150_000,
      });

      const metadata = callsOf(notifications.notifyUser)[0][2] as {
        amountMinor: number;
      };
      // Annoncer 200 000 puis en verser 150 000 serait la pire des issues.
      expect(metadata.amountMinor).toBe(150_000);
    });

    it('le message facultatif destiné à l’ambassadeur, lui, passe', async () => {
      await service.correctReviewed('admin-1', 'com-1', {
        ...MOTIF,
        amountMinor: 150_000,
        publicMessage: 'Le montant a été ajusté au plafond mensuel en vigueur.',
      });

      const metadata = callsOf(notifications.notifyUser)[0][2] as {
        publicMessage?: string;
      };
      expect(metadata.publicMessage).toBe(
        'Le montant a été ajusté au plafond mensuel en vigueur.',
      );
    });
  });

  // --- Annulation -----------------------------------------------------------
  describe('annulation', () => {
    it('inscrit un CODE dans cancelReason, jamais la note interne', async () => {
      await service.cancelReviewed('admin-1', 'com-1', {
        internalNote:
          'Vente fictive montée avec un complice, dossier transmis.',
        reasonCode: 'COMPLIANCE_REVIEW',
      });

      expect(updateData().status).toBe('CANCELLED');
      // `cancelReason` est un champ texte hérité — seul un motif structuré y
      // entre désormais, ce qui rend impossible qu'une note ressorte un jour par
      // un export ou un écran.
      expect(updateData().cancelReason).toBe('COMPLIANCE_REVIEW');
    });

    it('ne défait aucune écriture : rien n’avait été crédité', async () => {
      await service.cancelReviewed('admin-1', 'com-1', MOTIF);
      expect(wallet.accrue).not.toHaveBeenCalled();
    });

    it('ne notifie pas l’ambassadeur d’une commission qu’il n’a jamais vue', async () => {
      await service.cancelReviewed('admin-1', 'com-1', MOTIF);

      // Il n'a jamais été informé de cette commission : lui annoncer son
      // annulation n'apporterait qu'une inquiétude sans objet. Le fait, lui, est
      // journalisé.
      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(audit.recordChange).toHaveBeenCalledWith(
        'AMBASSADOR_COMMISSION_REVIEW_CANCELLED',
        'admin-1',
        expect.anything(),
      );
    });

    it('la note interne reste dans l’évènement et dans l’audit', async () => {
      const note = 'Vente fictive montée avec un complice, dossier transmis.';
      await service.cancelReviewed('admin-1', 'com-1', {
        internalNote: note,
        reasonCode: 'COMPLIANCE_REVIEW',
      });

      expect(
        (eventData().metadata as Record<string, unknown>).internalNote,
      ).toBe(note);
      const context = callsOf(audit.recordChange)[0][2] as {
        metadata: Record<string, unknown>;
      };
      expect(context.metadata.internalNote).toBe(note);
    });
  });

  // --- Dossier anonymisé ----------------------------------------------------
  it('un dossier anonymisé ne bloque pas l’arbitrage', async () => {
    prisma.ambassador.findUnique.mockResolvedValue({ userId: null });

    await service.releaseReviewed('admin-1', 'com-1', {
      internalNote:
        'Dossier clos côté RGPD, la commission reste due au dossier.',
    });

    // Le journal perd l'auteur, jamais le fait : la décision est prise et
    // journalisée, il n'y a simplement personne à prévenir.
    expect(notifications.notifyUser).not.toHaveBeenCalled();
    expect(wallet.accrue).toHaveBeenCalled();
  });
});
