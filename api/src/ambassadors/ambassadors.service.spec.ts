import { AmbassadorAttributionSource } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import { AmbassadorsService } from './ambassadors.service';
import type { WalletService } from './wallet.service';
import type { IdentityDocumentsService } from './identity-documents.service';
import type { TrainingService } from './training.service';

// ============================================================================
// L'ATTRIBUTION EST LA PORTE D'ENTRÉE DE TOUTE COMMISSION.
//
// Aucun euro ne peut être dû à un ambassadeur sans qu'un AmbassadorReferral ou un
// AmbassadorPortfolioEntry existe. Ces tests couvrent donc les quatre issues
// possibles d'une tentative de rattachement, et surtout le fait qu'aucune d'elles
// ne reste silencieuse — décision du promoteur du 2026-08-01 : un code non reconnu
// doit être DIT à l'utilisateur, jamais avalé.
// ============================================================================
describe('AmbassadorsService — attribution', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock };
    ambassadorReferral: { create: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: AmbassadorsService;

  const ACTIVE_AMBASSADOR = {
    id: 'amb-1',
    userId: 'user-ambassador',
    code: 'K7RQ4M',
    status: 'ACTIVE',
  };

  const auditCalls = () =>
    audit.record.mock.calls as [
      string,
      string | null,
      Record<string, unknown>,
    ][];

  const lastAuditOfType = (type: string) =>
    auditCalls()
      .filter((call) => call[0] === type)
      .at(-1);

  beforeEach(() => {
    prisma = {
      ambassador: {
        findUnique: jest.fn().mockResolvedValue(ACTIVE_AMBASSADOR),
      },
      ambassadorReferral: {
        create: jest.fn().mockResolvedValue({ id: 'ref-1' }),
      },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new AmbassadorsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as unknown as NotificationsService,
      {} as unknown as AmbassadorPolicyService,
      {} as unknown as WalletService,
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

  describe('code valide', () => {
    it('rattache le filleul et renvoie ATTRIBUTED', async () => {
      const outcome = await service.attributeUser('user-1', 'K7RQ4M');

      expect(outcome).toEqual({ status: 'ATTRIBUTED', referralId: 'ref-1' });
      const [[call]] = prisma.ambassadorReferral.create.mock.calls as [
        [{ data: { ambassadorId: string; referredUserId: string } }],
      ];
      expect(call.data.ambassadorId).toBe('amb-1');
      expect(call.data.referredUserId).toBe('user-1');
    });

    it.each([
      ['minuscules', 'k7rq4m'],
      ['espaces', ' K7RQ 4M '],
      ['tirets', 'K7R-Q4M'],
      ['préfixe LS', 'LS-K7RQ4M'],
    ])(
      'accepte un code saisi avec %s — un code se recopie depuis une affiche',
      async (_label, raw) => {
        const outcome = await service.attributeUser('user-1', raw);
        expect(outcome.status).toBe('ATTRIBUTED');
      },
    );
  });

  describe('code non reconnu', () => {
    it("renvoie CODE_NOT_RECOGNIZED plutôt que d'échouer en silence", async () => {
      prisma.ambassador.findUnique.mockResolvedValue(null);

      const outcome = await service.attributeUser('user-1', 'ZZZZZZ');

      expect(outcome).toEqual({ status: 'CODE_NOT_RECOGNIZED' });
      expect(prisma.ambassadorReferral.create).not.toHaveBeenCalled();
    });

    it('journalise la tentative AVEC le code saisi', async () => {
      // C'est cette trace qui permet de distinguer une affiche mal imprimée d'un
      // balayage automatisé. Sans le code, l'audit ne sert à rien.
      prisma.ambassador.findUnique.mockResolvedValue(null);

      await service.attributeUser('user-1', ' zzz-zzz ');

      const call = lastAuditOfType('AMBASSADOR_CODE_REJECTED');
      expect(call).toBeDefined();
      expect(call![1]).toBe('user-1');
      expect(call![2]).toMatchObject({
        attemptedCode: 'ZZZZZZ',
        reason: 'INCONNU_OU_INACTIF',
      });
    });

    it('traite un ambassadeur SUSPENDU comme un code non reconnu, sans nommer la suspension', async () => {
      // Dire « cet ambassadeur est suspendu » révélerait à un tiers une décision
      // administrative concernant quelqu'un d'autre. La trace d'audit, elle, garde
      // la distinction.
      prisma.ambassador.findUnique.mockResolvedValue({
        ...ACTIVE_AMBASSADOR,
        status: 'SUSPENDED',
      });

      const outcome = await service.attributeUser('user-1', 'K7RQ4M');

      expect(outcome).toEqual({ status: 'CODE_NOT_RECOGNIZED' });
      expect(prisma.ambassadorReferral.create).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'TERMINATED'])(
      'refuse aussi un ambassadeur %s',
      async (status) => {
        prisma.ambassador.findUnique.mockResolvedValue({
          ...ACTIVE_AMBASSADOR,
          status,
        });

        const outcome = await service.attributeUser('user-1', 'K7RQ4M');
        expect(outcome.status).toBe('CODE_NOT_RECOGNIZED');
      },
    );

    it('ne consulte même pas la base pour un code vide', async () => {
      const outcome = await service.attributeUser('user-1', '   ');

      expect(outcome.status).toBe('CODE_NOT_RECOGNIZED');
      expect(prisma.ambassador.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('auto-parrainage', () => {
    it("refuse qu'un ambassadeur se parraine lui-même", async () => {
      // Sans ce contrôle, la commission de 20 % deviendrait une remise de 20 % que
      // n'importe qui pourrait s'accorder en devenant ambassadeur avant de souscrire.
      const outcome = await service.attributeUser('user-ambassador', 'K7RQ4M');

      expect(outcome).toEqual({ status: 'SELF_REFERRAL_BLOCKED' });
      expect(prisma.ambassadorReferral.create).not.toHaveBeenCalled();
      expect(lastAuditOfType('AMBASSADOR_SELF_REFERRAL_BLOCKED')).toBeDefined();
    });
  });

  describe('filleul déjà parrainé', () => {
    it('garde le premier parrain et renvoie ALREADY_ATTRIBUTED', async () => {
      // Le premier reste le bon : sans cette règle, il suffirait de faire ressaisir
      // un code à un filleul pour le voler à son parrain.
      prisma.ambassadorReferral.create.mockRejectedValue({ code: 'P2002' });

      const outcome = await service.attributeUser('user-1', 'K7RQ4M');

      expect(outcome).toEqual({ status: 'ALREADY_ATTRIBUTED' });
      expect(lastAuditOfType('AMBASSADOR_CODE_REJECTED')![2]).toMatchObject({
        reason: 'DEJA_PARRAINE',
      });
    });

    it("laisse remonter une erreur base qui n'est pas un conflit d'unicité", async () => {
      // Un incident réel ne doit pas être maquillé en « code non reconnu » :
      // l'utilisateur croirait avoir mal saisi, et personne n'enquêterait.
      prisma.ambassadorReferral.create.mockRejectedValue(
        new Error('connexion perdue'),
      );

      await expect(service.attributeUser('user-1', 'K7RQ4M')).rejects.toThrow(
        'connexion perdue',
      );
    });
  });

  describe("source de l'attribution", () => {
    it('conserve la source transmise (lien, QR, décision administrative)', async () => {
      await service.attributeUser(
        'user-1',
        'K7RQ4M',
        AmbassadorAttributionSource.QR,
      );

      const [[call]] = prisma.ambassadorReferral.create.mock.calls as [
        [{ data: { source: string } }],
      ];
      expect(call.data.source).toBe(AmbassadorAttributionSource.QR);
    });

    it('retient CODE par défaut', async () => {
      await service.attributeUser('user-1', 'K7RQ4M');

      const [[call]] = prisma.ambassadorReferral.create.mock.calls as [
        [{ data: { source: string } }],
      ];
      expect(call.data.source).toBe(AmbassadorAttributionSource.CODE);
    });
  });
});
