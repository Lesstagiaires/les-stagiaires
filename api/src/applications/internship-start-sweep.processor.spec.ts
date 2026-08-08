import type { ConfigService } from '@nestjs/config';
import { NotificationType } from '../../generated/prisma/enums';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { InternshipStartSweepProcessor } from './internship-start-sweep.processor';

// ============================================================================
// Le rappel de début de stage touche à deux choses fragiles : de l'argent, non —
// mais un premier jour manqué, et un mineur qui part en stage sans que son
// responsable légal en ait été prévenu. D'où l'attention portée ici à
// l'idempotence et au chemin parental.
// ============================================================================
describe('InternshipStartSweepProcessor', () => {
  let prisma: {
    application: { findMany: jest.Mock };
    internshipStartReminder: { create: jest.Mock; updateMany: jest.Mock };
    parentalLink: { findFirst: jest.Mock };
  };
  let config: { get: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let sms: { send: jest.Mock };
  let minorPolicy: { requiresParentalConsent: jest.Mock };
  let processor: InternshipStartSweepProcessor;

  // LES JEUX D'ESSAI PORTENT UNE DATE DE NAISSANCE, PLUS UN BOOLÉEN.
  //
  // Ils déclaraient `candidate: { isMinor: false }`. C'était le même raccourci
  // que celui corrigé dans le code : un âge décrit par un drapeau qui ne bouge
  // jamais. Le processeur recalcule désormais l'âge par la politique du pays, et
  // les jeux d'essai doivent décrire ce qui sert vraiment à ce calcul.
  const MAJOR = {
    id: 'app-1',
    reference: 'CAND-2026-0042',
    candidateId: 'user-1',
    internshipStartDate: new Date('2026-08-08'),
    candidate: {
      dateOfBirth: new Date('2000-01-01'),
      countryOfResidence: 'CM',
      status: 'ACTIVE',
    },
  };
  const MINOR = {
    ...MAJOR,
    id: 'app-2',
    candidate: {
      dateOfBirth: new Date('2011-01-01'),
      countryOfResidence: 'CM',
      status: 'AWAITING_PARENTAL_CONSENT',
    },
  };

  const whereOfCall = (index: number) => {
    const calls = prisma.application.findMany.mock.calls as [
      { where: Record<string, unknown> },
    ][];
    return calls[index][0].where;
  };

  beforeEach(() => {
    prisma = {
      application: { findMany: jest.fn().mockResolvedValue([]) },
      internshipStartReminder: {
        create: jest.fn().mockResolvedValue({ id: 'rem-1' }),
        updateMany: jest.fn(),
      },
      parentalLink: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ parentPhone: '+237690000000' }),
      },
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    notifications = { notifyUser: jest.fn() };
    sms = { send: jest.fn() };
    // Le bouchon tranche sur la DATE DE NAISSANCE reçue, comme le vrai moteur.
    // Une valeur fixe ferait passer les deux cas pour la même raison.
    minorPolicy = {
      requiresParentalConsent: jest.fn((user: { dateOfBirth: Date | null }) =>
        Promise.resolve(
          !!user.dateOfBirth &&
            new Date().getFullYear() - user.dateOfBirth.getFullYear() < 18,
        ),
      ),
    };

    processor = new InternshipStartSweepProcessor(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      notifications as unknown as NotificationsService,
      sms,
      minorPolicy as unknown as MinorPolicyService,
    );
  });

  describe('paliers', () => {
    it('balaie J-7, J-1 et le jour même par défaut', async () => {
      await processor.process();

      expect(prisma.application.findMany).toHaveBeenCalledTimes(3);
      expect(whereOfCall(0).startReminders).toEqual({
        none: { offsetDays: 7 },
      });
      expect(whereOfCall(1).startReminders).toEqual({
        none: { offsetDays: 1 },
      });
      expect(whereOfCall(2).startReminders).toEqual({
        none: { offsetDays: 0 },
      });
    });

    it('accepte des paliers configurés', async () => {
      config.get.mockReturnValue('30, 7');
      await processor.process();
      expect(prisma.application.findMany).toHaveBeenCalledTimes(2);
    });

    it('retombe sur le défaut si la configuration est illisible', async () => {
      // Mieux vaut prévenir trop tôt que ne pas prévenir : une valeur cassée ne
      // doit pas faire taire les rappels.
      config.get.mockReturnValue('abc,,-3');
      await processor.process();
      expect(prisma.application.findMany).toHaveBeenCalledTimes(3);
    });
  });

  describe('sélection', () => {
    it('ne retient que les candidatures ACCEPTED', async () => {
      // Une candidature acceptée dont la convention n'est pas signée n'a pas de
      // premier jour à rappeler.
      await processor.process();
      expect(whereOfCall(0).status).toBe('ACCEPTED');
    });

    it('borne la recherche sur un jour civil, pas un instant', async () => {
      // Sans cela, un balayage lancé à 14 h manquerait les stages du jour.
      await processor.process();
      const range = whereOfCall(0).internshipStartDate as {
        gte: Date;
        lt: Date;
      };
      expect(range.gte.getHours()).toBe(0);
      expect(range.lt.getTime() - range.gte.getTime()).toBe(
        24 * 60 * 60 * 1000,
      );
    });
  });

  describe('candidat majeur', () => {
    it('notifie le candidat sans écrire au moindre parent', async () => {
      prisma.application.findMany.mockResolvedValueOnce([MAJOR]);

      await processor.process();

      const [[userId, type]] = notifications.notifyUser.mock.calls as [
        [string, NotificationType],
      ];
      expect(userId).toBe('user-1');
      expect(type).toBe(NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON);
      expect(sms.send).not.toHaveBeenCalled();
    });
  });

  describe('candidat mineur', () => {
    it('prévient AUSSI le représentant légal par SMS', async () => {
      // Le parent n'a ni compte ni adresse e-mail : le SMS est le seul canal qui
      // l'atteigne (CLAUDE.md §5).
      prisma.application.findMany.mockResolvedValueOnce([MINOR]);

      await processor.process();

      expect(notifications.notifyUser).toHaveBeenCalled();
      const [[phone, message]] = sms.send.mock.calls as [[string, string]];
      expect(phone).toBe('+237690000000');
      expect(message).toContain('CAND-2026-0042');
    });

    it("ne contacte qu'un lien parental ACTIF", async () => {
      // Écrire à un parent qui n'a jamais consenti ferait de ce rappel un premier
      // contact, ce qu'il n'est pas.
      prisma.application.findMany.mockResolvedValueOnce([MINOR]);

      await processor.process();

      const [[query]] = prisma.parentalLink.findFirst.mock.calls as [
        [{ where: { status: string } }],
      ];
      expect(query.where.status).toBe('ACTIVE');
    });

    it('poursuit le balayage même si le SMS échoue', async () => {
      prisma.application.findMany.mockResolvedValueOnce([MINOR]);
      sms.send.mockRejectedValue(new Error('opérateur injoignable'));

      await expect(processor.process()).resolves.toBeUndefined();
      // La notification interne, elle, est bien partie.
      expect(notifications.notifyUser).toHaveBeenCalled();
      // Et l'écart reste visible : parentNotified n'a pas été positionné.
      expect(prisma.internshipStartReminder.updateMany).not.toHaveBeenCalled();
    });

    it('ne fait rien de particulier si aucun parent n’est joignable', async () => {
      prisma.application.findMany.mockResolvedValueOnce([MINOR]);
      prisma.parentalLink.findFirst.mockResolvedValue(null);

      await processor.process();

      expect(sms.send).not.toHaveBeenCalled();
      expect(notifications.notifyUser).toHaveBeenCalled();
    });
  });

  describe('idempotence', () => {
    it('trace AVANT d’envoyer', async () => {
      // L'ordre inverse enverrait deux fois si l'écriture échouait après l'envoi.
      prisma.application.findMany.mockResolvedValueOnce([MAJOR]);
      const order: string[] = [];
      prisma.internshipStartReminder.create.mockImplementation(() => {
        order.push('trace');
        return Promise.resolve({ id: 'rem-1' });
      });
      notifications.notifyUser.mockImplementation(() => {
        order.push('envoi');
        return Promise.resolve();
      });

      await processor.process();

      expect(order).toEqual(['trace', 'envoi']);
    });

    it('n’envoie rien si la trace existe déjà', async () => {
      // La contrainte d'unicité (applicationId, offsetDays) est le verrou : deux
      // instances qui balaient en même temps ne peuvent pas doubler l'envoi.
      prisma.application.findMany.mockResolvedValueOnce([MAJOR]);
      prisma.internshipStartReminder.create.mockRejectedValue({
        code: 'P2002',
      });

      await processor.process();

      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(sms.send).not.toHaveBeenCalled();
    });
  });
});
