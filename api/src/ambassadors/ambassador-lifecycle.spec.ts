import { BadRequestException } from '@nestjs/common';
import { AmbassadorStatus } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import { AmbassadorsService } from './ambassadors.service';
import type { WalletService } from './wallet.service';
import type { IdentityDocumentsService } from './identity-documents.service';
import type { TrainingService } from './training.service';

// ============================================================================
// LE CODE D'AFFILIATION EST UN TITRE À PERCEVOIR.
//
// Il ouvre droit à commission sur chaque achat de chaque filleul. Le générer trop
// tôt — à la candidature, comme c'était le cas avant le 2026-08-01 — laissait
// circuler ce titre avant tout engagement contractuel, avant toute vérification
// d'identité, avant toute formation.
//
// Ces tests verrouillent la correction : ils échouent si le code réapparaît avant
// l'activation, ou si l'une des cinq conditions d'activation est contournée.
// ============================================================================
describe('AmbassadorsService — cycle de vie', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    ambassador: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    ambassadorEvent: { create: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let wallet: { ensureWallet: jest.Mock };
  let service: AmbassadorsService;

  // Un dossier complet, prêt à activer. Chaque test en retire une pièce pour
  // vérifier que l'activation échoue.
  const READY = {
    id: 'amb-1',
    userId: 'user-1',
    code: null,
    status: AmbassadorStatus.TRAINING_PENDING,
    countryCode: 'CM',
    identityVerifiedAt: new Date('2026-07-01'),
    approvedAt: new Date('2026-07-05'),
    contractSignedAt: new Date('2026-07-10'),
    charterSignedAt: new Date('2026-07-10'),
    trainingCompletedAt: new Date('2026-07-15'),
  };

  // findUnique sert à DEUX choses dans le service : retrouver le dossier par son
  // id, et vérifier qu'un code tiré au hasard est libre. Les confondre faisait
  // croire à allocateUniqueCode que tous les codes étaient pris.
  const mockDossier = (dossier: Record<string, unknown> | null) => {
    prisma.ambassador.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; code?: string } }) =>
        Promise.resolve(where.code !== undefined ? null : dossier),
    );
  };

  const lastUpdateData = () => {
    const calls = prisma.ambassador.update.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls[calls.length - 1][0].data;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      ambassador: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'amb-1' }),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'amb-1', ...data }),
          ),
      },
      ambassadorEvent: { create: jest.fn() },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn() };
    wallet = { ensureWallet: jest.fn() };

    service = new AmbassadorsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      {
        resolve: jest.fn().mockResolvedValue({ currency: 'XAF' }),
      } as unknown as AmbassadorPolicyService,
      wallet as unknown as WalletService,
      // Aucune piece manquante par defaut : les tests de piece d'identite vivent
      // dans identity-documents.service.spec.ts.
      {
        blockingReasons: jest.fn().mockResolvedValue([]),
      } as unknown as IdentityDocumentsService,
      // Formation reputee achevee : ses tests vivent dans training.service.spec.ts.
      {
        blockingReasons: jest.fn().mockResolvedValue([]),
      } as unknown as TrainingService,
    );
  });

  describe('dépôt de candidature', () => {
    it('NE GÉNÈRE AUCUN CODE', async () => {
      // La régression que ces tests existent pour empêcher.
      await service.create('admin-1', {
        userId: 'user-1',
        categories: ['CAMPUS'],
        countryCode: 'CM',
      });

      const [[call]] = prisma.ambassador.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(call.data.code).toBeUndefined();
    });

    it('laisse le statut initial à SUBMITTED', async () => {
      await service.create('admin-1', {
        userId: 'user-1',
        categories: ['CAMPUS'],
        countryCode: 'CM',
      });

      const [[call]] = prisma.ambassador.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      // Le défaut du schéma vaut SUBMITTED : ne rien écrire est correct, écrire
      // autre chose ne le serait pas.
      expect(call.data.status).toBeUndefined();
    });
  });

  describe('enchaînement des étapes', () => {
    it.each([
      ['startReview depuis VERIFIED', 'startReview', AmbassadorStatus.VERIFIED],
      [
        'verifyIdentity depuis SUBMITTED',
        'verifyIdentity',
        AmbassadorStatus.SUBMITTED,
      ],
      ['approve depuis SUBMITTED', 'approve', AmbassadorStatus.SUBMITTED],
      ['activate depuis APPROVED', 'activate', AmbassadorStatus.APPROVED],
    ])('refuse %s', async (_label, method, status) => {
      mockDossier({ ...READY, status });

      await expect(
        (
          service as unknown as Record<
            string,
            (a: string, b: string) => Promise<unknown>
          >
        )[method]('admin-1', 'amb-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('approuver ne fait PAS passer à ACTIVE mais à CONTRACT_PENDING', async () => {
      // La confusion que le promoteur a fait corriger : accepter une candidature
      // n'est pas activer un ambassadeur.
      mockDossier({ ...READY, status: AmbassadorStatus.VERIFIED });

      await service.approve('admin-1', 'amb-1');

      expect(lastUpdateData().status).toBe(AmbassadorStatus.CONTRACT_PENDING);
      expect(lastUpdateData().code).toBeUndefined();
    });

    it('exige contrat ET charte avant de passer à TRAINING_PENDING', async () => {
      // Contrat signé, charte absente : on reste en CONTRACT_PENDING.
      mockDossier({
        ...READY,
        status: AmbassadorStatus.CONTRACT_PENDING,
        charterSignedAt: null,
        contractSignedAt: null,
      });

      await service.signContract('admin-1', 'amb-1', {
        contractReference: 'CAA-2026-001',
      });

      expect(lastUpdateData().status).toBe(AmbassadorStatus.CONTRACT_PENDING);
    });

    it('bascule vers TRAINING_PENDING quand les deux documents sont signés', async () => {
      mockDossier({
        ...READY,
        status: AmbassadorStatus.CONTRACT_PENDING,
        charterSignedAt: new Date('2026-07-09'),
        contractSignedAt: null,
      });

      await service.signContract('admin-1', 'amb-1', {
        contractReference: 'CAA-2026-001',
      });

      expect(lastUpdateData().status).toBe(AmbassadorStatus.TRAINING_PENDING);
    });
  });

  describe('activation', () => {
    it('génère le code, et seulement là', async () => {
      mockDossier(READY);

      await service.activate('admin-1', 'amb-1');

      const data = lastUpdateData();
      expect(data.status).toBe(AmbassadorStatus.ACTIVE);
      expect(typeof data.code).toBe('string');
      expect((data.code as string).length).toBe(6);
      expect(data.activatedById).toBe('admin-1');
    });

    it('crée le portefeuille à l’activation', async () => {
      // Un ambassadeur activé doit voir un solde à zéro, pas un écran vide qui
      // laisse croire à une panne.
      mockDossier(READY);

      await service.activate('admin-1', 'amb-1');

      expect(wallet.ensureWallet).toHaveBeenCalled();
    });

    it.each([
      ['identité non vérifiée', 'identityVerifiedAt'],
      ['candidature non approuvée', 'approvedAt'],
      ['contrat non signé', 'contractSignedAt'],
      ['charte non signée', 'charterSignedAt'],
      ['formation non achevée', 'trainingCompletedAt'],
    ])('refuse l’activation si %s', async (_label, field) => {
      // Les conditions sont revérifiées à l'activation même si le cycle de
      // statuts les a déjà imposées : un statut peut être atteint par un chemin
      // imprévu — correction manuelle, reprise de données, futur endpoint.
      mockDossier({ ...READY, [field]: null });

      await expect(service.activate('admin-1', 'amb-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.ambassador.update).not.toHaveBeenCalled();
    });

    it('nomme précisément ce qui manque', async () => {
      mockDossier({
        ...READY,
        charterSignedAt: null,
        trainingCompletedAt: null,
      });

      await expect(service.activate('admin-1', 'amb-1')).rejects.toThrow(
        /charte non signée.*formation non achevée/,
      );
    });

    it('ne régénère PAS le code d’un ambassadeur déjà codé', async () => {
      // Régénérer rendrait muets tous les liens et QR codes déjà distribués.
      prisma.ambassador.findUnique.mockResolvedValue({
        ...READY,
        code: 'K7RQ4M',
      });

      await service.activate('admin-1', 'amb-1');

      expect(lastUpdateData().code).toBe('K7RQ4M');
    });
  });

  describe('moteur d’attribution', () => {
    it.each([
      AmbassadorStatus.SUBMITTED,
      AmbassadorStatus.UNDER_REVIEW,
      AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
      AmbassadorStatus.VERIFIED,
      AmbassadorStatus.APPROVED,
      AmbassadorStatus.CONTRACT_PENDING,
      AmbassadorStatus.TRAINING_PENDING,
      AmbassadorStatus.SUSPENDED,
      AmbassadorStatus.TERMINATED,
      AmbassadorStatus.REJECTED,
    ])('refuse un code porté par un ambassadeur %s', async (status) => {
      // Seconde couche : même si un code existe (réactivation, reprise de
      // données), aucun statut hors ACTIVE n'ouvre droit au parrainage.
      prisma.ambassador.findUnique.mockResolvedValue({
        id: 'amb-1',
        userId: 'user-9',
        code: 'K7RQ4M',
        status,
      });

      const outcome = await service.attributeUser('user-1', 'K7RQ4M');
      expect(outcome.status).toBe('CODE_NOT_RECOGNIZED');
    });
  });
});
