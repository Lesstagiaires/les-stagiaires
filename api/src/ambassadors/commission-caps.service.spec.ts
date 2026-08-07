import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CommissionCapsService,
  type CapEvaluationInput,
} from './commission-caps.service';

// ============================================================================
// PLAFONDS DE COMMISSION — arbitrage 15 du promoteur, 2026-08-02.
//
// « Le dépassement ne doit pas entraîner une réduction silencieuse. »
//
// Le premier test de ce fichier est celui qui compte : le service ne rend JAMAIS
// un montant. Il ne sait pas rogner. Tout le reste — les fenêtres, les portées,
// la devise — n'est que la mécanique qui décide s'il y a lieu de contrôler.
// ============================================================================
describe('Plafonds de commission', () => {
  let prisma: {
    commissionCap: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    commission: { aggregate: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: CommissionCapsService;

  const VENTE: CapEvaluationInput = {
    ambassadorId: 'amb-1',
    amountMinor: 40_000,
    currency: 'XAF',
    countryCode: 'CM',
    productKey: 'CARRIERE_PLUS',
    campaignKey: null,
    at: new Date('2026-08-04T10:00:00Z'),
  };

  const plafond = (over: Record<string, unknown> = {}) => ({
    id: 'cap-1',
    label: 'Journalier',
    scope: 'AMBASSADOR',
    scopeKey: null,
    countryCode: null,
    window: 'DAY',
    amountMinor: 100_000,
    currency: 'XAF',
    isActive: true,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      commissionCap: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(plafond()),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'cap-neuf', ...args.data }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...plafond(), ...args.data }),
        ),
      },
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0 } }),
      },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new CommissionCapsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  const whereOf = (call = 0) => {
    const calls = prisma.commission.aggregate.mock.calls as unknown[][];
    return (calls[call][0] as { where: Record<string, unknown> }).where;
  };

  // --- LA RÈGLE QUI GOUVERNE TOUT ------------------------------------------
  it('ne rend jamais de montant — seulement un verdict', async () => {
    prisma.commissionCap.findMany.mockResolvedValue([
      plafond({ window: 'TRANSACTION', amountMinor: 10_000 }),
    ]);

    const verdict = await service.evaluate(VENTE);

    // Un plafond de 10 000 face à une commission de 40 000. Si ce service savait
    // rogner, il rendrait 10 000 ici — et l'ambassadeur toucherait le quart de ce
    // que le barème lui promettait, sans que personne ne l'ait décidé.
    expect(verdict.exceeded).toBe(true);
    expect(Object.keys(verdict)).toEqual(['exceeded', 'trace']);
    expect(JSON.stringify(verdict)).not.toContain('amountMinor');
  });

  // --- Les quatre fenêtres --------------------------------------------------
  describe('fenêtres', () => {
    it('la fenêtre TRANSACTION ne regarde que la commission elle-même', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({ window: 'TRANSACTION', amountMinor: 50_000 }),
      ]);

      const verdict = await service.evaluate(VENTE);

      // Aucun cumul à interroger : la question ne porte que sur cette vente.
      expect(prisma.commission.aggregate).not.toHaveBeenCalled();
      expect(verdict.trace[0].consumedMinor).toBe(0);
      expect(verdict.exceeded).toBe(false);
    });

    it('la fenêtre DAY part de minuit UTC', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([plafond()]);
      await service.evaluate(VENTE);

      const since = (whereOf().createdAt as { gte: Date }).gte;
      expect(since.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    });

    it('la fenêtre MONTH part du premier du mois UTC', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({ window: 'MONTH' }),
      ]);
      await service.evaluate(VENTE);

      const since = (whereOf().createdAt as { gte: Date }).gte;
      expect(since.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    it('la fenêtre LIFETIME ne pose aucune borne de date', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({ scope: 'CAMPAIGN', scopeKey: 'RENTREE', window: 'LIFETIME' }),
      ]);
      await service.evaluate({ ...VENTE, campaignKey: 'RENTREE' });

      expect(whereOf().createdAt).toBeUndefined();
    });
  });

  // --- Le cumul -------------------------------------------------------------
  describe('cumul', () => {
    it('ajoute la commission candidate au déjà-consommé', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({ amountMinor: 100_000 }),
      ]);
      prisma.commission.aggregate.mockResolvedValue({
        _sum: { amountMinor: 70_000 },
      });

      const verdict = await service.evaluate(VENTE);

      // 70 000 déjà servis + 40 000 candidats = 110 000 > 100 000.
      expect(verdict.trace[0].totalMinor).toBe(110_000);
      expect(verdict.exceeded).toBe(true);
    });

    it('atteindre le plafond exactement ne le dépasse pas', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({ amountMinor: 100_000 }),
      ]);
      prisma.commission.aggregate.mockResolvedValue({
        _sum: { amountMinor: 60_000 },
      });

      const verdict = await service.evaluate(VENTE);

      // Un plafond de 100 000 autorise 100 000. Le contrôle se déclenche
      // au-delà, pas à hauteur.
      expect(verdict.trace[0].totalMinor).toBe(100_000);
      expect(verdict.exceeded).toBe(false);
    });

    it('compte les commissions EN CONTRÔLE, ignore les annulées et reprises', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([plafond()]);
      await service.evaluate(VENTE);

      // Sans cela, un ambassadeur dont la première commission attend un arbitrage
      // verrait les suivantes passer sous le plafond une à une.
      expect(whereOf().status).toEqual({
        notIn: ['CANCELLED', 'REVERSED'],
      });
    });

    it('une fenêtre vide donne un cumul nul, pas une erreur', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([plafond()]);
      prisma.commission.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const verdict = await service.evaluate(VENTE);
      expect(verdict.trace[0].consumedMinor).toBe(0);
    });
  });

  // --- Les portées ----------------------------------------------------------
  describe('portées', () => {
    it('un plafond de campagne ne mord pas sur une vente hors campagne', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({
          scope: 'CAMPAIGN',
          scopeKey: 'RENTREE',
          window: 'LIFETIME',
          amountMinor: 1,
        }),
      ]);

      // `campaignKey` nul : cette vente n'entame aucune enveloppe de campagne.
      // Sans ce filtre, l'enveloppe de rentrée s'appliquerait à toute l'activité.
      const verdict = await service.evaluate(VENTE);
      expect(verdict.trace).toHaveLength(0);
      expect(verdict.exceeded).toBe(false);
    });

    it('un plafond de campagne mord sur la campagne correspondante', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({
          scope: 'CAMPAIGN',
          scopeKey: 'RENTREE',
          window: 'LIFETIME',
          amountMinor: 1,
        }),
      ]);

      const verdict = await service.evaluate({
        ...VENTE,
        campaignKey: 'RENTREE',
      });
      expect(verdict.exceeded).toBe(true);
      // L'enveloppe est partagée par TOUS les ambassadeurs : le cumul ne se
      // restreint pas à celui qui vient de vendre.
      expect(whereOf().ambassadorId).toBeUndefined();
      expect(whereOf().appliedCampaignKey).toBe('RENTREE');
    });

    it('un plafond de produit ne mord que sur son produit', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([
        plafond({
          scope: 'PRODUCT',
          scopeKey: 'CARRIERE_SECURISEE',
          window: 'MONTH',
          amountMinor: 1,
        }),
      ]);

      const verdict = await service.evaluate(VENTE); // vend CARRIERE_PLUS
      expect(verdict.trace).toHaveLength(0);
    });

    it('un plafond par ambassadeur ne cumule que le sien', async () => {
      prisma.commissionCap.findMany.mockResolvedValue([plafond()]);
      await service.evaluate(VENTE);
      expect(whereOf().ambassadorId).toBe('amb-1');
    });
  });

  // --- Devise ---------------------------------------------------------------
  it('n’interroge que les plafonds de la devise de la commission', async () => {
    await service.evaluate(VENTE);

    // Comparer 500 000 XAF à 900 USD produirait des contrôles au hasard, dans un
    // sens comme dans l'autre.
    const findManyCalls = prisma.commissionCap.findMany.mock
      .calls as unknown[][];
    const where = (
      findManyCalls[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where.currency).toBe('XAF');
    expect(where.OR).toEqual([{ countryCode: null }, { countryCode: 'CM' }]);
  });

  // --- Plusieurs plafonds ---------------------------------------------------
  it('un seul plafond franchi suffit, et la trace les garde tous', async () => {
    prisma.commissionCap.findMany.mockResolvedValue([
      plafond({
        id: 'cap-jour',
        window: 'TRANSACTION',
        amountMinor: 1_000_000,
      }),
      plafond({ id: 'cap-strict', window: 'TRANSACTION', amountMinor: 10_000 }),
    ]);

    const verdict = await service.evaluate(VENTE);

    expect(verdict.exceeded).toBe(true);
    // La trace conserve AUSSI le plafond qui n'a pas mordu : « pourquoi
    // celui-ci n'a-t-il rien dit ? » est une question légitime en litige.
    expect(verdict.trace).toHaveLength(2);
    expect(verdict.trace.filter((t) => t.exceeded)).toHaveLength(1);
  });

  it('aucun plafond configuré : rien n’est retenu', async () => {
    const verdict = await service.evaluate(VENTE);
    expect(verdict.exceeded).toBe(false);
    expect(verdict.trace).toEqual([]);
  });

  // --- Back-office ----------------------------------------------------------
  describe('gestion des plafonds', () => {
    it('refuse un plafond de campagne sans clé', async () => {
      await expect(
        service.create('admin-1', {
          label: 'Enveloppe',
          scope: 'CAMPAIGN',
          window: 'LIFETIME',
          amountMinor: 100,
          currency: 'XAF',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse une clé sur un plafond par ambassadeur', async () => {
      await expect(
        service.create('admin-1', {
          label: 'Journalier',
          scope: 'AMBASSADOR',
          scopeKey: 'RENTREE',
          window: 'DAY',
          amountMinor: 100,
          currency: 'XAF',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un plafond nul — ce serait une interdiction déguisée', async () => {
      await expect(
        service.create('admin-1', {
          label: 'Zéro',
          scope: 'AMBASSADOR',
          window: 'DAY',
          amountMinor: 0,
          currency: 'XAF',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('journalise la création avec ses conditions', async () => {
      await service.create('admin-1', {
        label: 'Journalier 500 000 F',
        scope: 'AMBASSADOR',
        window: 'DAY',
        amountMinor: 50_000_000,
        currency: 'XAF',
      });

      const recordChangeCalls = audit.recordChange.mock.calls as unknown[][];
      const [action, actorId, context] = recordChangeCalls[0] as [
        string,
        string,
        { entityType: string; metadata: Record<string, unknown> },
      ];
      expect(action).toBe('COMMISSION_CAP_CREATED');
      expect(actorId).toBe('admin-1');
      expect(context.entityType).toBe('CommissionCap');
      expect(context.metadata.amountMinor).toBe(50_000_000);
    });

    it('désactive sans supprimer — les contrôles passés restent explicables', async () => {
      const updated = await service.deactivate('admin-1', 'cap-1');
      expect(updated.isActive).toBe(false);

      const updateCalls = prisma.commissionCap.update.mock.calls as unknown[][];
      const args = updateCalls[0][0] as {
        data: Record<string, unknown>;
      };
      // Rien d'autre que la désactivation : le montant et la portée restent tels
      // qu'ils étaient quand ils ont retenu des commissions.
      expect(Object.keys(args.data)).toEqual(['isActive']);
    });

    it('refuse de désactiver un plafond inexistant', async () => {
      prisma.commissionCap.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('admin-1', 'cap-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
