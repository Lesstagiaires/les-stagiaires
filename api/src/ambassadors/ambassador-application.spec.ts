import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import { AmbassadorsService } from './ambassadors.service';
import type { WalletService } from './wallet.service';
import type { IdentityDocumentsService } from './identity-documents.service';
import type { TrainingService } from './training.service';

// ============================================================================
// CANDIDATURE PUBLIQUE
// Arbitrages 4 et 11 du promoteur, 2026-08-02.
//
// « Un candidat ne devient JAMAIS ambassadeur automatiquement. »
//
// Le premier test de ce fichier est celui qui compte : déposer une candidature
// n'accorde RIEN. Pas de code, pas de statut avancé, pas de droit. Tout le reste
// — l'âge, le délai de redépôt, les blocages — n'est que la mécanique qui décide
// si le dossier s'ouvre.
// ============================================================================
describe('Candidature au programme Ambassadeurs', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    ambassador: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    ambassadorEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let policy: { resolve: jest.Mock };
  let service: AmbassadorsService;

  const MAJEUR = {
    id: 'user-1',
    dateOfBirth: new Date('1998-05-12'),
    countryOfResidence: 'CM',
  };

  const CANDIDATURE = {
    motivation:
      'Je connais bien les campus de Douala et je souhaite aider les jeunes de ma promotion à trouver leur premier stage.',
    categories: ['CAMPUS' as never],
  };

  const DOSSIER = {
    id: 'amb-1',
    userId: 'user-1',
    status: 'REJECTED',
    applicationCycle: 1,
    categories: ['CAMPUS'],
    createdAt: new Date('2026-01-01'),
    rejectedAt: new Date('2026-01-15'),
    lastRejectedAt: new Date('2026-01-15'),
    reapplicationBlocked: false,
    reapplicationBlockedReason: null,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T12:00:00Z'));

    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(MAJEUR) },
      ambassador: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'amb-neuf',
            status: 'SUBMITTED',
            applicationCycle: 1,
            createdAt: new Date(),
            ...args.data,
          }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...DOSSIER, ...args.data }),
        ),
      },
      ambassadorEvent: { create: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    policy = {
      resolve: jest.fn().mockResolvedValue({
        countryCode: 'CM',
        minAmbassadorAge: 18,
        reapplicationDelayMonths: 6,
      }),
    };

    service = new AmbassadorsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      { notifyUser: jest.fn() } as unknown as NotificationsService,
      policy as unknown as AmbassadorPolicyService,
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

  afterEach(() => jest.useRealTimers());

  const creePar = () =>
    (
      (prisma.ambassador.create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --- LA RÈGLE QUI GOUVERNE TOUT -------------------------------------------
  it('une candidature n’accorde AUCUN droit', async () => {
    const recu = await service.apply('user-1', CANDIDATURE);

    expect(creePar().status).toBeUndefined(); // le défaut du schéma : SUBMITTED
    // Pas de code : il naît à l'activation, et nulle part ailleurs. Tant qu'il
    // n'existe pas, il ne peut ni fuiter, ni être distribué, ni être accepté par
    // le moteur d'attribution.
    expect(creePar().code).toBeUndefined();
    expect(JSON.stringify(recu)).not.toContain('code');
  });

  it('l’accusé de réception ne dit que l’essentiel', async () => {
    const recu = await service.apply('user-1', CANDIDATURE);

    expect(recu.status).toBe('SUBMITTED');
    expect(recu.applicationCycle).toBe(1);
    expect(Object.keys(recu).sort()).toEqual([
      'applicationCycle',
      'categories',
      'id',
      'status',
      'submittedAt',
    ]);
  });

  // --- VERROU 1 : la majorité -----------------------------------------------
  describe('âge minimum', () => {
    it('refuse un mineur', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...MAJEUR,
        dateOfBirth: new Date('2010-05-12'), // 16 ans au 2026-08-05
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.ambassador.create).not.toHaveBeenCalled();
    });

    it('accepte quelqu’un qui vient d’atteindre le seuil', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...MAJEUR,
        dateOfBirth: new Date('2008-08-05'), // 18 ans jour pour jour
      });

      await expect(service.apply('user-1', CANDIDATURE)).resolves.toBeDefined();
    });

    it('refuse la veille des 18 ans', async () => {
      // Un arrondi généreux ferait entrer un mineur dans un programme qui verse
      // de l'argent.
      prisma.user.findUnique.mockResolvedValue({
        ...MAJEUR,
        dateOfBirth: new Date('2008-08-06'),
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('suit le seuil du PAYS, pas une valeur codée en dur', async () => {
      policy.resolve.mockResolvedValue({
        minAmbassadorAge: 21,
        reapplicationDelayMonths: 6,
      });
      prisma.user.findUnique.mockResolvedValue({
        ...MAJEUR,
        dateOfBirth: new Date('2008-01-01'), // 18 ans, mais le pays en exige 21
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    // ÉCHEC FERMÉ. Sans la donnée, on refuse — sinon l'absence de date de
    // naissance serait le moyen le plus simple de contourner le contrôle.
    it('refuse quand la date de naissance manque', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...MAJEUR,
        dateOfBirth: null,
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // --- VERROU 2 : le blocage définitif --------------------------------------
  describe('blocage de redépôt', () => {
    it('refuse un dossier bloqué', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        reapplicationBlocked: true,
        reapplicationBlockedReason: 'CONDUCT_REVIEW',
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('ne révèle PAS le motif du blocage au candidat', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        reapplicationBlocked: true,
        reapplicationBlockedReason: 'CONDUCT_REVIEW',
      });

      // Le motif porte souvent une qualification qu'on n'annonce pas dans une
      // réponse d'API. Il est au dossier, et l'assistance le tient.
      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        /assistance/,
      );
    });
  });

  // --- VERROU 3 : le délai de redépôt ---------------------------------------
  describe('délai après refus', () => {
    it('refuse avant l’échéance', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        lastRejectedAt: new Date('2026-06-01'), // + 6 mois = 2026-12-01
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('accepte une fois le délai écoulé', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        lastRejectedAt: new Date('2026-01-15'), // + 6 mois = 2026-07-15, dépassé
      });

      await expect(service.apply('user-1', CANDIDATURE)).resolves.toBeDefined();
    });

    it('suit le délai du PAYS', async () => {
      policy.resolve.mockResolvedValue({
        minAmbassadorAge: 18,
        reapplicationDelayMonths: 0, // un pays peut l'ouvrir immédiatement
      });
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        lastRejectedAt: new Date('2026-08-04'), // la veille
      });

      await expect(service.apply('user-1', CANDIDATURE)).resolves.toBeDefined();
    });
  });

  // --- LE NOUVEAU CYCLE ------------------------------------------------------
  describe('redépôt', () => {
    beforeEach(() => {
      prisma.ambassador.findUnique.mockResolvedValue(DOSSIER);
    });

    it('incrémente le cycle', async () => {
      const recu = await service.apply('user-1', CANDIDATURE);
      expect(recu.applicationCycle).toBe(2);
    });

    it('efface les traces du refus précédent SAUF sa date', async () => {
      await service.apply('user-1', CANDIDATURE);

      const data = (
        (prisma.ambassador.update.mock.calls as unknown[][])[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;

      expect(data.status).toBe('SUBMITTED');
      expect(data.rejectedAt).toBeNull();
      expect(data.rejectionReasonCode).toBeNull();
      // `lastRejectedAt` n'est PAS effacé : l'effacer offrirait une remise à
      // zéro du délai à chaque tentative.
      expect(data.lastRejectedAt).toBeUndefined();
    });

    it('refuse tant que le dossier est en cours d’instruction', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        status: 'UNDER_REVIEW',
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuse à un ambassadeur déjà actif', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        status: 'ACTIVE',
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        /déjà ambassadeur/,
      );
    });

    it('renvoie vers l’assistance après une résiliation', async () => {
      // Une résiliation clôt une relation qui a existé : son retour se décide,
      // il ne se demande pas par formulaire.
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        status: 'TERMINATED',
      });

      await expect(service.apply('user-1', CANDIDATURE)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
