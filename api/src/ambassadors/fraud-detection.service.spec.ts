import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FraudDetectionService } from './fraud-detection.service';

// ============================================================================
// MOTEUR ANTIFRAUDE — première version
// Arbitrage du promoteur du 2026-08-04.
//
// « Détecter ; alerter ; journaliser ; orienter l'administration vers un
// contrôle manuel. » Rien de plus, et surtout rien d'automatique.
//
// Le complément indispensable de ce fichier est `fraud-no-sanction.spec.ts`,
// qui vérifie que le service n'a MATÉRIELLEMENT pas les moyens de sanctionner.
// Ici, on vérifie qu'il compte juste et qu'il alerte au bon moment.
// ============================================================================
describe('Détection de fraude', () => {
  let prisma: {
    fraudRule: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    fraudAlert: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    ambassador: { findUnique: jest.Mock };
    ambassadorReferral: { groupBy: jest.Mock };
    ambassadorPortfolioEntry: { groupBy: jest.Mock };
    ambassadorPaymentDetail: { findMany: jest.Mock };
    commission: { groupBy: jest.Mock };
    payoutRequest: { groupBy: jest.Mock; findMany: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyAdmins: jest.Mock };
  let service: FraudDetectionService;

  const MAINTENANT = new Date('2026-08-05T12:00:00Z');

  const REGLE_RAFALE = {
    id: 'r-1',
    code: 'ATTRIBUTION_BURST',
    label: 'Rafale d’attributions',
    signal: 'ATTRIBUTION_BURST',
    countryCode: null,
    thresholdValue: 5,
    windowHours: 24,
    severity: 'WARNING',
    isActive: true,
    cooldownHours: 24,
  };

  beforeEach(() => {
    prisma = {
      fraudRule: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(REGLE_RAFALE),
        create: jest.fn((a: { data: object }) =>
          Promise.resolve({ id: 'r-neuf', ...a.data }),
        ),
        update: jest.fn((a: { data: object }) =>
          Promise.resolve({ ...REGLE_RAFALE, ...a.data }),
        ),
      },
      fraudAlert: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((a: { data: object }) =>
          Promise.resolve({ id: 'a-1', ...a.data }),
        ),
        update: jest.fn((a: { data: object }) =>
          Promise.resolve({ id: 'a-1', ...a.data }),
        ),
      },
      ambassador: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ code: 'K7RQ4M', countryCode: 'CM' }),
      },
      ambassadorReferral: { groupBy: jest.fn().mockResolvedValue([]) },
      ambassadorPortfolioEntry: { groupBy: jest.fn().mockResolvedValue([]) },
      ambassadorPaymentDetail: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { groupBy: jest.fn().mockResolvedValue([]) },
      payoutRequest: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyAdmins: jest.fn() };

    service = new FraudDetectionService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });

  const alerteCreee = () =>
    (
      (prisma.fraudAlert.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --- LE SEUIL ---------------------------------------------------------------
  describe('rafale d’attributions', () => {
    beforeEach(() => {
      prisma.fraudRule.findMany.mockResolvedValue([REGLE_RAFALE]);
    });

    it('n’alerte pas SOUS le seuil', async () => {
      prisma.ambassadorReferral.groupBy.mockResolvedValue([
        { ambassadorId: 'amb-1', _count: { _all: 4 } },
      ]);

      const rapport = await service.runSweep(MAINTENANT);
      expect(rapport.raised).toBe(0);
      expect(prisma.fraudAlert.create).not.toHaveBeenCalled();
    });

    it('alerte À PARTIR du seuil', async () => {
      prisma.ambassadorReferral.groupBy.mockResolvedValue([
        { ambassadorId: 'amb-1', _count: { _all: 5 } },
      ]);

      const rapport = await service.runSweep(MAINTENANT);
      expect(rapport.raised).toBe(1);
      expect(alerteCreee().observedValue).toBe(5);
      expect(alerteCreee().thresholdValue).toBe(5);
    });

    it('additionne parrainages ET rattachements', async () => {
      // Les séparer laisserait passer quelqu'un qui alterne entre les deux
      // chemins d'attribution.
      prisma.ambassadorReferral.groupBy.mockResolvedValue([
        { ambassadorId: 'amb-1', _count: { _all: 3 } },
      ]);
      prisma.ambassadorPortfolioEntry.groupBy.mockResolvedValue([
        { ambassadorId: 'amb-1', _count: { _all: 3 } },
      ]);

      await service.runSweep(MAINTENANT);
      expect(alerteCreee().observedValue).toBe(6);
      expect(alerteCreee().evidence).toEqual({
        parrainages: 3,
        rattachements: 3,
      });
    });

    it('la fenêtre remonte de windowHours', async () => {
      prisma.ambassadorReferral.groupBy.mockResolvedValue([]);
      await service.runSweep(MAINTENANT);

      const where = (
        (prisma.ambassadorReferral.groupBy.mock.calls as unknown[][])[0][0] as {
          where: { attributedAt: { gte: Date } };
        }
      ).where;
      // 2026-08-05T12:00 moins 24 h.
      expect(where.attributedAt.gte.toISOString()).toBe(
        '2026-08-04T12:00:00.000Z',
      );
    });
  });

  // --- LE CONSTAT EST FIGÉ ----------------------------------------------------
  it('l’alerte porte le seuil EN VIGUEUR au moment de la mesure', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([REGLE_RAFALE]);
    prisma.ambassadorReferral.groupBy.mockResolvedValue([
      { ambassadorId: 'amb-1', _count: { _all: 9 } },
    ]);

    await service.runSweep(MAINTENANT);

    // Régler le seuil autrement demain ne doit pas rendre incompréhensible une
    // alerte d'aujourd'hui.
    expect(alerteCreee().thresholdValue).toBe(5);
    expect(alerteCreee().windowHours).toBe(24);
    expect(alerteCreee().ruleCode).toBe('ATTRIBUTION_BURST');
  });

  it('recopie le code et le pays de l’ambassadeur', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([REGLE_RAFALE]);
    prisma.ambassadorReferral.groupBy.mockResolvedValue([
      { ambassadorId: 'amb-1', _count: { _all: 9 } },
    ]);

    await service.runSweep(MAINTENANT);
    // L'alerte doit rester identifiable après anonymisation du dossier.
    expect(alerteCreee().ambassadorCode).toBe('K7RQ4M');
    expect(alerteCreee().countryCode).toBe('CM');
  });

  // --- LE DÉLAI DE RE-SIGNALEMENT --------------------------------------------
  it('ne rejoue pas la même alerte pendant le délai', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([REGLE_RAFALE]);
    prisma.ambassadorReferral.groupBy.mockResolvedValue([
      { ambassadorId: 'amb-1', _count: { _all: 9 } },
    ]);
    prisma.fraudAlert.findFirst.mockResolvedValue({ id: 'deja' });

    const rapport = await service.runSweep(MAINTENANT);
    // Une alerte qui revient chaque matin finit par ne plus être lue — et c'est
    // ce matin-là que la vraie passe inaperçue.
    expect(rapport.raised).toBe(0);
    expect(prisma.fraudAlert.create).not.toHaveBeenCalled();
  });

  it('un délai à zéro re-signale à chaque passage', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([
      { ...REGLE_RAFALE, cooldownHours: 0 },
    ]);
    prisma.ambassadorReferral.groupBy.mockResolvedValue([
      { ambassadorId: 'amb-1', _count: { _all: 9 } },
    ]);
    prisma.fraudAlert.findFirst.mockResolvedValue({ id: 'deja' });

    const rapport = await service.runSweep(MAINTENANT);
    expect(rapport.raised).toBe(1);
    // Le délai n'est même pas interrogé.
    expect(prisma.fraudAlert.findFirst).not.toHaveBeenCalled();
  });

  // --- DESTINATAIRE ET TRACE --------------------------------------------------
  it('prévient l’ADMINISTRATION, et journalise', async () => {
    prisma.fraudRule.findMany.mockResolvedValue([REGLE_RAFALE]);
    prisma.ambassadorReferral.groupBy.mockResolvedValue([
      { ambassadorId: 'amb-1', _count: { _all: 9 } },
    ]);

    await service.runSweep(MAINTENANT);

    expect(notifications.notifyAdmins).toHaveBeenCalledWith(
      'AMBASSADOR_FRAUD_ALERT',
      expect.objectContaining({ ruleCode: 'ATTRIBUTION_BURST' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      'AMBASSADOR_FRAUD_ALERT_RAISED',
      null,
      expect.objectContaining({ observedValue: 9 }),
    );
  });

  it('une règle inactive n’est pas évaluée', async () => {
    // `findMany` filtre sur isActive : on vérifie que le filtre est bien posé.
    await service.runSweep(MAINTENANT);
    const where = (
      (prisma.fraudRule.findMany.mock.calls as unknown[][])[0][0] as {
        where: { isActive: boolean };
      }
    ).where;
    expect(where.isActive).toBe(true);
  });

  // --- L'INSTRUCTION ----------------------------------------------------------
  describe('instruction d’une alerte', () => {
    const OUVERTE = {
      id: 'a-1',
      status: 'OPEN',
      ruleCode: 'ATTRIBUTION_BURST',
      ambassadorId: 'amb-1',
    };

    beforeEach(() => {
      prisma.fraudAlert.findUnique.mockResolvedValue(OUVERTE);
    });

    it('refuse de laisser une alerte « ouverte » pour toute instruction', async () => {
      await expect(
        service.review('admin-1', 'a-1', {
          status: 'OPEN',
          note: 'Ni confirmée ni écartée.',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse d’instruire deux fois', async () => {
      prisma.fraudAlert.findUnique.mockResolvedValue({
        ...OUVERTE,
        status: 'CONFIRMED',
      });
      await expect(
        service.review('admin-1', 'a-1', {
          status: 'DISMISSED',
          note: 'Tentative de seconde instruction.',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('enregistre l’auteur, la date et la note', async () => {
      await service.review('admin-1', 'a-1', {
        status: 'DISMISSED',
        note: 'Campagne de rentrée, volume attendu et vérifié.',
      });

      const data = (
        (prisma.fraudAlert.update.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.status).toBe('DISMISSED');
      expect(data.reviewedById).toBe('admin-1');
      expect(data.reviewedAt).toBeInstanceOf(Date);
      expect(data.reviewNote).toContain('Campagne de rentrée');
    });

    it('l’instruction ne touche à RIEN d’autre que l’alerte', async () => {
      await service.review('admin-1', 'a-1', {
        status: 'CONFIRMED',
        note: 'Fraude confirmée, dossier transmis à la direction.',
      });

      // Même CONFIRMÉE, une alerte ne suspend personne. Les suites se prennent
      // par les chemins existants, qui exigent un motif écrit et un auteur.
      expect(prisma.ambassador.findUnique).not.toHaveBeenCalled();
      expect(audit.recordChange).toHaveBeenCalledWith(
        'AMBASSADOR_FRAUD_ALERT_REVIEWED',
        'admin-1',
        expect.anything(),
      );
    });
  });

  // --- LES RÈGLES -------------------------------------------------------------
  it('ajuster un seuil exige un motif, et le journalise', async () => {
    await service.updateRuleThreshold('admin-1', 'r-1', {
      thresholdValue: 50,
      windowHours: 24,
      note: 'Seuil desserré après analyse du volume réel de la rentrée.',
    });

    const [action, actorId, contexte] = (
      audit.recordChange.mock.calls as unknown[][]
    )[0] as [
      string,
      string,
      { changes: unknown[]; metadata: Record<string, unknown> },
    ];

    expect(action).toBe('FRAUD_RULE_ADJUSTED');
    expect(actorId).toBe('admin-1');
    // Desserrer un seuil est exactement ce que ferait un administrateur complice
    // avant de laisser passer une fraude.
    expect(contexte.changes).toContainEqual({
      field: 'thresholdValue',
      oldValue: 5,
      newValue: 50,
    });
    expect(contexte.metadata.note).toContain('desserré');
  });
});
