import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import { TrainingService } from './training.service';

// ============================================================================
// FORMATION ET QUIZ BLOQUANT
// Arbitrages 8 et 9 du promoteur, 2026-08-02.
//
// LE PREMIER TEST DE CE FICHIER EST CELUI QUI COMPTE : les bonnes réponses ne
// quittent jamais le serveur.
//
// « Tout le code exécuté dans le navigateur est public » (SKILL SECURITY FIRST
// §5). Un quiz dont le corrigé circule dans la réponse HTTP n'est plus un quiz,
// c'est une formalité — et il suffit d'ouvrir l'onglet réseau pour s'en rendre
// compte.
// ============================================================================
describe('Formation et quiz', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock; update: jest.Mock };
    ambassadorEvent: { create: jest.Mock };
    trainingModule: { findMany: jest.Mock; findUnique: jest.Mock };
    trainingProgress: { findMany: jest.Mock; upsert: jest.Mock };
    quizQuestion: { findMany: jest.Mock };
    quizAttempt: { count: jest.Mock; create: jest.Mock; findFirst: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let policy: { resolve: jest.Mock };
  let service: TrainingService;

  const DOSSIER = {
    id: 'amb-1',
    status: 'TRAINING_PENDING',
    countryCode: 'CM',
    applicationCycle: 1,
    quizWaivedAt: null,
  };

  // Trois questions, dont on connaît le corrigé côté test seulement.
  const QUESTIONS = [
    { id: 'q1', prompt: 'Question 1', choices: ['A', 'B'], correctIndex: 0 },
    { id: 'q2', prompt: 'Question 2', choices: ['A', 'B'], correctIndex: 1 },
    { id: 'q3', prompt: 'Question 3', choices: ['A', 'B'], correctIndex: 0 },
  ];

  beforeEach(() => {
    prisma = {
      ambassador: {
        findUnique: jest.fn().mockResolvedValue(DOSSIER),
        update: jest.fn().mockResolvedValue(DOSSIER),
      },
      ambassadorEvent: { create: jest.fn() },
      trainingModule: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'mod-1',
          code: 'DEONTOLOGIE',
          version: 2,
          isActive: true,
        }),
      },
      trainingProgress: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn((args: { create: object; update: object }) =>
          Promise.resolve({
            moduleId: 'mod-1',
            moduleVersion: 2,
            completedAt: new Date(),
            ...args.create,
            ...args.update,
          }),
        ),
      },
      quizQuestion: { findMany: jest.fn().mockResolvedValue(QUESTIONS) },
      quizAttempt: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'att-1', ...args.data }),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    policy = {
      resolve: jest.fn().mockResolvedValue({
        countryCode: 'CM',
        quizPassScorePercent: 80,
        quizMaxAttempts: 3,
      }),
    };

    service = new TrainingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      policy as unknown as AmbassadorPolicyService,
    );
  });

  // --- LA RÈGLE QUI GOUVERNE TOUT -------------------------------------------
  describe('les bonnes réponses ne sortent JAMAIS', () => {
    it('la liste servie ne contient aucun correctIndex', async () => {
      const servi = await service.questionsFor('user-1');

      expect(JSON.stringify(servi)).not.toContain('correctIndex');
      for (const question of servi.questions) {
        expect(Object.keys(question).sort()).toEqual([
          'choices',
          'id',
          'prompt',
        ]);
      }
    });

    it('le résultat d’une tentative ne contient pas le corrigé', async () => {
      const resultat = await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 1 }],
      });

      // Donner le corrigé à chaque échec permettrait de reconstituer toutes les
      // réponses en trois tentatives.
      expect(JSON.stringify(resultat)).not.toContain('correctIndex');
      expect(Object.keys(resultat).sort()).toEqual([
        'attemptNumber',
        'passScorePercent',
        'passed',
        'remainingAttempts',
        'scorePercent',
      ]);
    });

    it('la tentative enregistrée ne stocke pas le corrigé à côté des copies', async () => {
      await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 0 }],
      });

      const data = (
        (prisma.quizAttempt.create.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(JSON.stringify(data.answers)).not.toContain('correctIndex');
    });
  });

  // --- LA CORRECTION, CÔTÉ SERVEUR ------------------------------------------
  describe('correction', () => {
    it('calcule le score à partir des VRAIES réponses', async () => {
      // 2 bonnes sur 3 = 66 %.
      const resultat = await service.submit('user-1', {
        answers: [
          { questionId: 'q1', choiceIndex: 0 }, // juste
          { questionId: 'q2', choiceIndex: 1 }, // juste
          { questionId: 'q3', choiceIndex: 1 }, // faux
        ],
      });

      expect(resultat.scorePercent).toBe(66);
      expect(resultat.passed).toBe(false);
    });

    it('accepte au-dessus du seuil', async () => {
      const resultat = await service.submit('user-1', {
        answers: [
          { questionId: 'q1', choiceIndex: 0 },
          { questionId: 'q2', choiceIndex: 1 },
          { questionId: 'q3', choiceIndex: 0 },
        ],
      });

      expect(resultat.scorePercent).toBe(100);
      expect(resultat.passed).toBe(true);
    });

    it('une question sans réponse compte comme fausse', async () => {
      // Ne pas répondre n'est pas une façon de ne pas se tromper.
      const resultat = await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 0 }],
      });
      // 1 bonne sur 3 : les deux questions sans reponse comptent comme fausses.
      expect(resultat.scorePercent).toBe(33);
      expect(resultat.passed).toBe(false);
    });

    it('suit le seuil du PAYS, pas une valeur codée en dur', async () => {
      policy.resolve.mockResolvedValue({
        quizPassScorePercent: 60,
        quizMaxAttempts: 3,
      });

      const resultat = await service.submit('user-1', {
        answers: [
          { questionId: 'q1', choiceIndex: 0 },
          { questionId: 'q2', choiceIndex: 1 },
          { questionId: 'q3', choiceIndex: 1 },
        ],
      });
      expect(resultat.passed).toBe(true); // 66 % ≥ 60 %
    });

    it('PHOTOGRAPHIE le seuil en vigueur sur la tentative', async () => {
      await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 0 }],
      });

      const data = (
        (prisma.quizAttempt.create.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      // Abaisser le seuil demain ne doit pas rendre reçu quelqu'un qui avait
      // échoué.
      expect(data.passScorePercent).toBe(80);
    });
  });

  // --- LES TENTATIVES, COMPTÉES EN BASE -------------------------------------
  describe('nombre de tentatives', () => {
    it('refuse une soumission au-delà du quota', async () => {
      prisma.quizAttempt.count.mockResolvedValue(3);

      await expect(
        service.submit('user-1', {
          answers: [{ questionId: 'q1', choiceIndex: 0 }],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    });

    it('refuse aussi de servir les questions', async () => {
      prisma.quizAttempt.count.mockResolvedValue(3);
      await expect(service.questionsFor('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('numérote la tentative depuis la BASE, pas depuis le client', async () => {
      prisma.quizAttempt.count.mockResolvedValue(1);

      const resultat = await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 0 }],
      });
      expect(resultat.attemptNumber).toBe(2);
      expect(resultat.remainingAttempts).toBe(1);
    });

    it('les tentatives se comptent PAR CYCLE de candidature', async () => {
      await service.submit('user-1', {
        answers: [{ questionId: 'q1', choiceIndex: 0 }],
      });

      const where = (
        (prisma.quizAttempt.count.mock.calls as unknown[][])[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;
      // Un redépôt six mois plus tard rouvre le quota : refuser à quelqu'un dont
      // la candidature repart de zéro serait le punir deux fois.
      expect(where.applicationCycle).toBe(1);
    });
  });

  // --- LE VERROU D'ACTIVATION -----------------------------------------------
  describe('verrou d’activation', () => {
    it('bloque tant que le quiz n’est pas réussi', async () => {
      const blocages = await service.blockingReasons('amb-1');
      expect(blocages).toContain('quiz non réussi');
    });

    it('laisse passer avec une tentative réussie au cycle en cours', async () => {
      prisma.quizAttempt.findFirst.mockResolvedValue({ id: 'att-1' });
      expect(await service.blockingReasons('amb-1')).toEqual([]);
    });

    it('la dérogation lève le blocage du quiz', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        quizWaivedAt: new Date(),
      });

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages).not.toContain('quiz non réussi');
      // Et l'on n'est même pas allé chercher de tentative : la dérogation vaut
      // décision.
      expect(prisma.quizAttempt.findFirst).not.toHaveBeenCalled();
    });

    it('bloque quand un module obligatoire manque', async () => {
      prisma.trainingModule.findMany.mockResolvedValue([
        { id: 'mod-1', code: 'DEONTOLOGIE', version: 1 },
      ]);
      prisma.quizAttempt.findFirst.mockResolvedValue({ id: 'att-1' });

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages[0]).toContain('DEONTOLOGIE');
    });

    // LA RÈGLE DE VERSION. Sans elle, une refonte de module décidée pour raison
    // de sécurité n'atteindrait jamais ceux qui sont déjà passés.
    it('bloque quand le module a été REFONDU depuis', async () => {
      prisma.trainingModule.findMany.mockResolvedValue([
        { id: 'mod-1', code: 'DEONTOLOGIE', version: 2 },
      ]);
      prisma.trainingProgress.findMany.mockResolvedValue([
        { moduleId: 'mod-1', moduleVersion: 1 }, // ancienne version suivie
      ]);
      prisma.quizAttempt.findFirst.mockResolvedValue({ id: 'att-1' });

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages[0]).toContain('DEONTOLOGIE');
    });

    it('laisse passer quand la bonne version a été suivie', async () => {
      prisma.trainingModule.findMany.mockResolvedValue([
        { id: 'mod-1', code: 'DEONTOLOGIE', version: 2 },
      ]);
      prisma.trainingProgress.findMany.mockResolvedValue([
        { moduleId: 'mod-1', moduleVersion: 2 },
      ]);
      prisma.quizAttempt.findFirst.mockResolvedValue({ id: 'att-1' });

      expect(await service.blockingReasons('amb-1')).toEqual([]);
    });
  });

  // --- LA DÉROGATION --------------------------------------------------------
  describe('dérogation', () => {
    it('journalise auteur, motif et note interne', async () => {
      await service.waiveQuiz('admin-1', 'amb-1', {
        internalNote:
          'Formatrice de terrain depuis dix ans, contenu déjà maîtrisé.',
        reasonCode: 'MUTUAL_AGREEMENT',
      });

      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_QUIZ_WAIVED',
        'admin-1',
        expect.objectContaining({ reasonCode: 'MUTUAL_AGREEMENT' }),
      );
      const data = (
        (prisma.ambassador.update.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.quizWaivedById).toBe('admin-1');
      expect(data.quizWaivedReasonCode).toBe('MUTUAL_AGREEMENT');
    });

    it('refuse une seconde dérogation', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        quizWaivedAt: new Date(),
      });

      await expect(
        service.waiveQuiz('admin-1', 'amb-1', {
          internalNote: 'Seconde tentative de dérogation, sans objet.',
          reasonCode: 'MUTUAL_AGREEMENT',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // --- LA VERSION SUIVIE ----------------------------------------------------
  it('la progression photographie la version du module', async () => {
    await service.completeModule('user-1', 'mod-1');

    const args = (
      prisma.trainingProgress.upsert.mock.calls as unknown[][]
    )[0][0] as {
      create: Record<string, unknown>;
    };
    expect(args.create.moduleVersion).toBe(2);
    expect(args.create.moduleCode).toBe('DEONTOLOGIE');
  });
});
