import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CommissionRulesService,
  type CommissionRuleInput,
} from './commission-rules.service';

// ============================================================================
// BARÈMES VERSIONNÉS — arbitrage du promoteur du 2026-08-02, phase 1 item 4.
//
// « Une transaction doit conserver la règle exacte appliquée au moment de son
// calcul. Une modification future du barème ne doit jamais recalculer
// rétroactivement une commission déjà acquise. »
//
// La photographie sur la commission satisfait la seconde phrase. Mais modifier un
// taux EN PLACE rendrait la question « quel était le taux le 15 mars ? » sans
// réponse : d'où la chaîne de versions, et ces tests.
// ============================================================================
describe('Barèmes de commission — versionnage', () => {
  let prisma: {
    commissionRule: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: CommissionRulesService;

  const TAUX: CommissionRuleInput = {
    label: 'Acquisition abonnement',
    productType: 'SUBSCRIPTION',
    nature: 'ACQUISITION',
    rateBasisPoints: 2000,
  };

  const PRIME: CommissionRuleInput = {
    label: 'Prime de lancement',
    productType: 'SUBSCRIPTION',
    nature: 'ACQUISITION',
    fixedAmountMinor: 500_000,
    currency: 'XAF',
  };

  const EXISTANTE = {
    id: 'r-1',
    lineageKey: 'r-1',
    version: 1,
    label: 'Acquisition abonnement',
    rateBasisPoints: 2000,
    fixedAmountMinor: null,
    currency: null,
    validFrom: new Date('2026-01-01'),
    validUntil: null,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      commissionRule: {
        findUnique: jest.fn().mockResolvedValue(EXISTANTE),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'r-nouveau', ...args.data }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...EXISTANTE, ...args.data }),
        ),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new CommissionRulesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  const updateData = (call = 0): { data: Record<string, unknown> } => {
    const calls = prisma.commissionRule.update.mock.calls as unknown[][];
    return calls[call][0] as { data: Record<string, unknown> };
  };
  const createData = (call = 0): Record<string, unknown> => {
    const calls = prisma.commissionRule.create.mock.calls as unknown[][];
    return (calls[call][0] as { data: Record<string, unknown> }).data;
  };

  // --- Un seul mode de calcul ----------------------------------------------
  describe('taux OU montant fixe', () => {
    it('accepte un taux seul', async () => {
      await service.create('admin-1', TAUX);
      expect(createData().rateBasisPoints).toBe(2000);
      expect(createData().fixedAmountMinor).toBeNull();
    });

    it('accepte une prime forfaitaire avec sa devise', async () => {
      await service.create('admin-1', PRIME);
      expect(createData().fixedAmountMinor).toBe(500_000);
      expect(createData().currency).toBe('XAF');
      expect(createData().rateBasisPoints).toBeNull();
    });

    it('refuse les DEUX à la fois', async () => {
      await expect(
        service.create('admin-1', { ...TAUX, fixedAmountMinor: 500_000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse AUCUN des deux — un barème incalculable paierait zéro en silence', async () => {
      await expect(
        service.create('admin-1', { ...TAUX, rateBasisPoints: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un montant fixe sans devise', async () => {
      await expect(
        service.create('admin-1', { ...PRIME, currency: null }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --- Le calcul ------------------------------------------------------------
  describe('calcul du montant', () => {
    it('applique le taux à l’assiette', () => {
      // 20 % de 200 000 unités mineures.
      expect(service.computeAmountMinor(200_000, 2000)).toBe(40_000);
    });

    it('une prime forfaitaire NE dépend PAS de l’assiette', () => {
      // 5 000 F que l'abonnement coûte 10 000 ou 200 000 : c'est le principe même
      // d'un forfait.
      expect(service.computeAmountMinor(1_000_000, null, 500_000)).toBe(
        500_000,
      );
      expect(service.computeAmountMinor(10_000, null, 500_000)).toBe(500_000);
    });

    it('refuse de calculer sans taux ni montant', () => {
      expect(() => service.computeAmountMinor(200_000, null, null)).toThrow(
        BadRequestException,
      );
    });

    it('arrondit à l’inférieur — le sens sûr de l’erreur', () => {
      // 1 999 × 3,33 % = 66,5667… Payer un franc de moins ne crée pas, à grande
      // échelle, un passif que personne n'a décidé.
      expect(service.computeAmountMinor(1999, 333)).toBe(66);
    });
  });

  // --- La chaîne de versions ------------------------------------------------
  describe('remplacement de version', () => {
    it('clôt l’ancienne version au lieu de la modifier', async () => {
      const effet = new Date('2026-06-01');
      await service.supersede(
        'admin-1',
        'r-1',
        { ...TAUX, rateBasisPoints: 2500 },
        effet,
      );

      const updateArgs = updateData();
      // La version sortante reçoit UNE SEULE modification : sa date de fin. Ses
      // conditions économiques restent celles sous lesquelles les commissions
      // passées ont été calculées.
      expect(Object.keys(updateArgs.data)).toEqual(['validUntil']);
      expect(updateArgs.data.validUntil).toBe(effet);
    });

    it('crée une version suivante dans la MÊME lignée', async () => {
      await service.supersede(
        'admin-1',
        'r-1',
        { ...TAUX, rateBasisPoints: 2500 },
        new Date('2026-06-01'),
      );

      const data = createData();
      expect(data.lineageKey).toBe('r-1');
      expect(data.version).toBe(2);
      expect(data.supersedesId).toBe('r-1');
      expect(data.rateBasisPoints).toBe(2500);
    });

    it('refuse de remplacer un barème déjà clos', async () => {
      prisma.commissionRule.findUnique.mockResolvedValue({
        ...EXISTANTE,
        validUntil: new Date('2026-03-01'),
      });

      await expect(
        service.supersede('admin-1', 'r-1', TAUX, new Date('2026-06-01')),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse une prise d’effet antérieure à la version remplacée', async () => {
      // Deux versions valides au même instant rendraient le départage aléatoire.
      await expect(
        service.supersede('admin-1', 'r-1', TAUX, new Date('2025-12-01')),
      ).rejects.toThrow(BadRequestException);
    });

    it('journalise ce qui a changé économiquement', async () => {
      await service.supersede(
        'admin-1',
        'r-1',
        { ...TAUX, rateBasisPoints: 2500 },
        new Date('2026-06-01'),
      );

      const [action, actorId, context] = audit.recordChange.mock.calls[0] as [
        string,
        string,
        {
          entityType: string;
          changes: { field: string; oldValue: unknown; newValue: unknown }[];
          metadata: Record<string, unknown>;
        },
      ];

      expect(action).toBe('COMMISSION_RULE_SUPERSEDED');
      expect(actorId).toBe('admin-1');
      expect(context.entityType).toBe('CommissionRule');
      expect(context.changes).toContainEqual({
        field: 'rateBasisPoints',
        oldValue: 2000,
        newValue: 2500,
      });
      expect(context.metadata.fromVersion).toBe(1);
      expect(context.metadata.toVersion).toBe(2);
    });

    it('valide le mode de calcul de la nouvelle version aussi', async () => {
      await expect(
        service.supersede(
          'admin-1',
          'r-1',
          { ...TAUX, fixedAmountMinor: 1000 },
          new Date('2026-06-01'),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('création d’une lignée', () => {
    it('la clé de lignée est l’identifiant du premier barème', async () => {
      await service.create('admin-1', TAUX);

      const updateArgs = updateData();
      // Stable et sans collision possible : c'est ce qui permet de retrouver
      // toutes les versions d'un même barème des années plus tard.
      expect(updateArgs.data.lineageKey).toBe('r-nouveau');
    });

    it('démarre à la version 1', async () => {
      await service.create('admin-1', TAUX);
      expect(createData().version).toBe(1);
    });
  });

  describe('désactivation', () => {
    it('retire du jeu sans supprimer — les commissions restent justifiables', async () => {
      await service.deactivate('admin-1', 'r-1');

      const updateArgs = updateData();
      expect(updateArgs.data.isActive).toBe(false);
      expect(updateArgs.data.validUntil).toBeInstanceOf(Date);
    });
  });
});
