import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import { ALL_COUNTRIES } from '../common/country-scope';
import type { PrismaService } from '../prisma/prisma.service';
import { TrainingAdminService } from './training-admin.service';

// ============================================================================
// BACK-OFFICE DE LA FORMATION
//
// Deux règles reprises des barèmes de commission, pour la même raison :
//   1. un module publié ne se MODIFIE pas, il se REMPLACE ;
//   2. rien ne se supprime, tout se désactive.
//
// Et une troisième, propre au quiz : la bonne réponse n'entre jamais au journal
// d'audit. Un journal se consulte, s'exporte, se transmet — y recopier le
// corrigé reviendrait à le sortir du seul endroit qui le protège.
// ============================================================================
describe('Back-office de la formation', () => {
  let prisma: {
    trainingModule: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    quizQuestion: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: TrainingAdminService;

  const MODULE = {
    id: 'mod-1',
    code: 'DEONTOLOGIE',
    title: 'Déontologie de l’ambassadeur',
    body: 'Contenu initial du module de déontologie, version un.',
    version: 1,
    sortOrder: 0,
    countryCode: ALL_COUNTRIES,
    isActive: true,
  };

  const NOUVELLE_VERSION = {
    code: 'DEONTOLOGIE',
    title: 'Déontologie de l’ambassadeur',
    body: 'Contenu revu après le rappel réglementaire de juillet 2026.',
  };

  beforeEach(() => {
    prisma = {
      trainingModule: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(MODULE),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'mod-neuf', version: 1, ...args.data }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...MODULE, ...args.data }),
        ),
      },
      quizQuestion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'q-1', isActive: true }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'q-neuf', ...args.data }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'q-1', ...args.data }),
        ),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new TrainingAdminService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  const creePar = (mock: jest.Mock) =>
    (
      (mock.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --- REMPLACER, PAS MODIFIER ----------------------------------------------
  describe('remplacement de version', () => {
    it('désactive l’ancienne version et en crée une suivante', async () => {
      await service.supersedeModule('admin-1', 'mod-1', NOUVELLE_VERSION);

      const desactivation = (
        prisma.trainingModule.update.mock.calls as unknown[][]
      )[0][0] as { data: Record<string, unknown> };
      // L'ancienne version est RETIRÉE, jamais supprimée : les progressions qui
      // la citent doivent rester lisibles.
      expect(desactivation.data).toEqual({ isActive: false });
      expect(creePar(prisma.trainingModule.create).version).toBe(2);
    });

    it('garde le CODE, qui fait la lignée', async () => {
      await service.supersedeModule('admin-1', 'mod-1', NOUVELLE_VERSION);
      expect(creePar(prisma.trainingModule.create).code).toBe('DEONTOLOGIE');
    });

    it('refuse de changer le code d’une version à l’autre', async () => {
      // Changer le code romprait la lignée : les progressions passées ne se
      // rattacheraient plus à rien, et chacun serait réputé n'avoir rien suivi.
      await expect(
        service.supersedeModule('admin-1', 'mod-1', {
          ...NOUVELLE_VERSION,
          code: 'AUTRE_CODE',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse de remplacer un module déjà retiré', async () => {
      prisma.trainingModule.findUnique.mockResolvedValue({
        ...MODULE,
        isActive: false,
      });

      await expect(
        service.supersedeModule('admin-1', 'mod-1', NOUVELLE_VERSION),
      ).rejects.toThrow(ConflictException);
    });

    it('journalise ce qui a changé ET l’effet de la décision', async () => {
      await service.supersedeModule('admin-1', 'mod-1', NOUVELLE_VERSION);

      const [action, actorId, contexte] = (
        audit.recordChange.mock.calls as unknown[][]
      )[0] as [
        string,
        string,
        {
          changes: { field: string }[];
          metadata: Record<string, unknown>;
        },
      ];

      expect(action).toBe('TRAINING_MODULE_SUPERSEDED');
      expect(actorId).toBe('admin-1');
      expect(contexte.changes.map((c) => c.field)).toContain('body');
      expect(contexte.metadata.fromVersion).toBe(1);
      expect(contexte.metadata.toVersion).toBe(2);
      // La conséquence est DITE : tous ceux qui avaient achevé l'ancienne
      // version devront refaire celle-ci avant activation.
      expect(contexte.metadata.effet).toBe('PROGRESSIONS_PRECEDENTES_CADUQUES');
    });

    it('refuse un second module actif sous le même code', async () => {
      prisma.trainingModule.findFirst.mockResolvedValue(MODULE);

      await expect(
        service.createModule('admin-1', {
          code: 'DEONTOLOGIE',
          title: 'Doublon',
          body: 'Un second module actif sous le même code, sans objet.',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // --- LE CORRIGÉ NE VA PAS AU JOURNAL --------------------------------------
  describe('questions de quiz', () => {
    it('la bonne réponse n’entre JAMAIS dans le journal d’audit', async () => {
      await service.createQuestion('admin-1', {
        prompt: 'Un ambassadeur peut-il parrainer son propre compte ?',
        choices: ['Oui', 'Non'],
        correctIndex: 1,
      });

      const contexte = (audit.recordChange.mock.calls as unknown[][])[0][2] as {
        metadata: Record<string, unknown>;
      };
      expect(contexte.metadata.correctIndex).toBeUndefined();
      expect(JSON.stringify(contexte)).not.toContain('correctIndex');
      // Ce qui EST journalisé : de quoi savoir qu'une question a été créée, et
      // par qui.
      expect(contexte.metadata.choiceCount).toBe(2);
    });

    it('refuse une bonne réponse qui ne désigne aucune proposition', async () => {
      await expect(
        service.createQuestion('admin-1', {
          prompt: 'Une question dont la réponse pointe dans le vide.',
          choices: ['A', 'B'],
          correctIndex: 5,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.quizQuestion.create).not.toHaveBeenCalled();
    });

    it('désactive sans supprimer', async () => {
      await service.deactivateQuestion('admin-1', 'q-1');

      const data = (
        (prisma.quizQuestion.update.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data).toEqual({ isActive: false });
    });

    it('refuse de désactiver une question inexistante', async () => {
      prisma.quizQuestion.findUnique.mockResolvedValue(null);
      await expect(
        service.deactivateQuestion('admin-1', 'q-x'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --- LES LISTES -----------------------------------------------------------
  it('ne liste que l’actif par défaut', async () => {
    await service.listModules();
    const where = (
      (prisma.trainingModule.findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where.isActive).toBe(true);
  });

  it('sait montrer l’historique complet sur demande', async () => {
    await service.listModules(true);
    const where = (
      (prisma.trainingModule.findMany.mock.calls as unknown[][])[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where).toEqual({});
  });
});
