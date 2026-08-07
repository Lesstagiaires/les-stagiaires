import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  PartnershipEventType,
  PartnershipParty,
  PartnershipStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PartnershipsService } from './partnerships.service';

describe('PartnershipsService', () => {
  let prisma: {
    organization: { findUnique: jest.Mock };
    partnershipType: { findUnique: jest.Mock };
    partnershipInformationRequest: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
    partnership: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    partnershipEvent: { create: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: {
    notifyAdmins: jest.Mock;
    notifyOrganizationLeadership: jest.Mock;
  };
  let orgAccess: { assertCanManage: jest.Mock; assertCanManageTeam: jest.Mock };
  let service: PartnershipsService;

  const VERIFIED_ORG = {
    id: 'org-1',
    name: 'Test Corp SARL',
    verificationStatus: 'VERIFIED',
  };
  const MOTIVATION = 'x'.repeat(50);
  // Une candidature nomme desormais le type de partenariat demande.
  const REQUEST_DTO = { typeCode: 'RECRUITMENT', motivation: MOTIVATION };
  const RECRUITMENT_TYPE = {
    id: 'ptype_recruitment',
    code: 'RECRUITMENT',
    isActive: true,
  };

  const lastUpdateData = () => {
    const calls = prisma.partnership.update.mock.calls as [
      { data: Record<string, unknown> },
    ][];
    return calls[calls.length - 1][0].data;
  };

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue(VERIFIED_ORG) },
      partnershipType: {
        findUnique: jest.fn().mockResolvedValue(RECRUITMENT_TYPE),
      },
      partnershipInformationRequest: {
        create: jest.fn().mockResolvedValue({ id: 'ir-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      partnership: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'p-1', organizationId: 'org-1' }),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'p-1', organizationId: 'org-1', ...data }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      partnershipEvent: { create: jest.fn() },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = {
      notifyAdmins: jest.fn().mockResolvedValue(1),
      notifyOrganizationLeadership: jest.fn().mockResolvedValue(2),
    };
    orgAccess = {
      assertCanManage: jest.fn().mockResolvedValue(undefined),
      assertCanManageTeam: jest.fn().mockResolvedValue(undefined),
    };

    service = new PartnershipsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      orgAccess as unknown as OrganizationAccessService,
    );
  });

  // ==========================================================================
  // Garde-fou de la décision du promoteur du 2026-07-31 : un partenariat n'a
  // AUCUNE durée dans la plateforme. Ces tests échouent si quelqu'un réintroduit
  // un jour une échéance — c'est précisément la règle qui avait été codée par
  // erreur, puis retirée.
  // ==========================================================================
  describe('aucune notion de durée', () => {
    it("n'écrit jamais de date de fin à l'acceptation", async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.PENDING,
      });

      await service.approve('admin-1', 'p-1', {});

      const data = lastUpdateData();
      expect(data.termEndsAt).toBeUndefined();
      expect(data.terminationEffectiveAt).toBeUndefined();
      expect(data.expiresAt).toBeUndefined();
    });

    it("n'expose aucun statut dérivé du temps", () => {
      // Les cinq statuts décrivent une situation décidée, jamais une échéance.
      expect(Object.values(PartnershipStatus).sort()).toEqual([
        'ACTIVE',
        // Ajoute le 2026-08-02 : un dossier incomplet n'est pas un refus. Comme les
        // autres, ce statut decrit une situation DECIDEE, pas une echeance — aucune
        // tache planifiee ne le fait changer.
        'ADDITIONAL_INFORMATION_REQUIRED',
        'PENDING',
        'REFUSED',
        'SUSPENDED',
        'TERMINATED',
      ]);
    });

    it('ne connaît aucun événement de reconduction', () => {
      expect(Object.values(PartnershipEventType)).not.toContain('RENEWED');
      expect(Object.values(PartnershipEventType)).not.toContain('EXPIRED');
    });
  });

  describe('request', () => {
    it("refuse une organisation qui n'est pas vérifiée", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...VERIFIED_ORG,
        verificationStatus: 'PENDING',
      });

      await expect(
        service.request('user-1', 'org-1', REQUEST_DTO),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.partnership.create).not.toHaveBeenCalled();
    });

    it('exige les droits de direction, pas la simple gestion', async () => {
      await service.request('user-1', 'org-1', REQUEST_DTO);
      // Candidater engage l'organisation : assertCanManageTeam (propriétaire/ADMIN),
      // jamais assertCanManage qui laisserait passer un RECRUITER.
      expect(orgAccess.assertCanManageTeam).toHaveBeenCalledWith(
        'org-1',
        'user-1',
      );
      expect(orgAccess.assertCanManage).not.toHaveBeenCalled();
    });

    it.each([
      PartnershipStatus.PENDING,
      PartnershipStatus.ACTIVE,
      PartnershipStatus.SUSPENDED,
    ])(
      'refuse une seconde demande quand le partenariat est %s',
      async (status) => {
        prisma.partnership.findUnique.mockResolvedValue({ id: 'p-1', status });

        await expect(
          service.request('user-1', 'org-1', REQUEST_DTO),
        ).rejects.toThrow(ConflictException);
      },
    );

    it.each([PartnershipStatus.REFUSED, PartnershipStatus.TERMINATED])(
      "autorise une nouvelle candidature après %s, en repartant d'une ardoise propre",
      async (status) => {
        prisma.partnership.findUnique.mockResolvedValue({ id: 'p-1', status });

        await service.request('user-1', 'org-1', REQUEST_DTO);

        const data = lastUpdateData();
        expect(data.status).toBe(PartnershipStatus.PENDING);
        // Aucune trace du cycle précédent ne doit rester collée au nouveau dossier.
        expect(data.decisionReason).toBeNull();
        expect(data.signedAt).toBeNull();
        expect(data.terminatedAt).toBeNull();
        expect(data.terminationReason).toBeNull();
        expect(data.suspensionReason).toBeNull();
      },
    );

    it('notifie les administrateurs', async () => {
      await service.request('user-1', 'org-1', REQUEST_DTO);
      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        NotificationType.PARTNERSHIP_APPLIED,
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.PENDING,
      });
    });

    it('active le partenariat et enregistre la date de signature du jour par défaut', async () => {
      await service.approve('admin-1', 'p-1', {});

      const data = lastUpdateData();
      expect(data.status).toBe(PartnershipStatus.ACTIVE);
      expect(data.signedAt).toBeInstanceOf(Date);
    });

    it('accepte une date de signature distincte de la date de décision', async () => {
      // Le contrat peut avoir été signé avant son traitement administratif.
      await service.approve('admin-1', 'p-1', { signedAt: '2026-05-04' });

      const data = lastUpdateData() as { signedAt: Date; decidedAt: Date };
      expect(data.signedAt.toISOString()).toContain('2026-05-04');
      expect(data.signedAt.getTime()).not.toBe(data.decidedAt.getTime());
    });

    it("refuse d'accepter un partenariat qui n'est pas en attente", async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
      });

      await expect(service.approve('admin-1', 'p-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lève une 404 sur un partenariat inexistant', async () => {
      prisma.partnership.findUnique.mockResolvedValue(null);
      await expect(service.approve('admin-1', 'p-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('refuse', () => {
    it("transmet le motif à l'organisation — jamais de décision muette", async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.PENDING,
      });

      await service.refuse('admin-1', 'p-1', {
        internalNote: 'Dossier incomplet.',
        reasonCode: 'INCOMPLETE_FILE',
      });

      expect(notifications.notifyOrganizationLeadership).toHaveBeenCalledWith(
        'org-1',
        NotificationType.PARTNERSHIP_REFUSED,
        expect.objectContaining({ reasonCode: 'INCOMPLETE_FILE' }),
      );
    });
  });

  describe('suspend / reinstate', () => {
    it('suspend avec effet immédiat', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
      });

      await service.suspend('admin-1', 'p-1', {
        internalNote: 'Signalement grave.',
        reasonCode: 'REPORTED_CONTENT',
      });

      const data = lastUpdateData();
      expect(data.status).toBe(PartnershipStatus.SUSPENDED);
      expect(data.suspendedAt).toBeInstanceOf(Date);
    });

    it('efface le motif à la réintégration', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.SUSPENDED,
      });

      await service.reinstate('admin-1', 'p-1');

      const data = lastUpdateData();
      expect(data.status).toBe(PartnershipStatus.ACTIVE);
      expect(data.suspensionReason).toBeNull();
    });
  });

  describe('terminate', () => {
    it.each([PartnershipStatus.ACTIVE, PartnershipStatus.SUSPENDED])(
      'résilie un partenariat %s avec effet immédiat',
      async (status) => {
        prisma.partnership.findUnique.mockResolvedValue({
          id: 'p-1',
          organizationId: 'org-1',
          organization: { name: 'Coopérative Test' },
          type: { code: 'RECRUITMENT' },
          status,
        });

        await service.terminate('admin-1', 'p-1', {
          internalNote: 'Résiliation actée entre les parties.',
          reasonCode: 'MUTUAL_AGREEMENT',
        });

        const data = lastUpdateData();
        expect(data.status).toBe(PartnershipStatus.TERMINATED);
        expect(data.terminatedAt).toBeInstanceOf(Date);
        expect(data.terminatedById).toBe('admin-1');
      },
    );

    it('refuse de résilier un partenariat encore en attente', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.PENDING,
      });

      await expect(
        service.terminate('admin-1', 'p-1', {
          internalNote: 'Motif quelconque.',
          reasonCode: 'NOT_DISCLOSED',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('requestTermination', () => {
    beforeEach(() => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
        terminationRequestedAt: null,
      });
    });

    it("ne change PAS le statut et n'arme aucun compte à rebours", async () => {
      await service.requestTermination(
        'user-1',
        'p-1',
        PartnershipParty.ORGANIZATION,
        { reason: 'Réorientation stratégique.' },
      );

      const data = lastUpdateData();
      // Une demande informe, elle ne décide pas : seul un ADMIN résilie.
      expect(data.status).toBeUndefined();
      expect(data.terminationEffectiveAt).toBeUndefined();
      expect(data.terminationRequestedBy).toBe(PartnershipParty.ORGANIZATION);
    });

    it("vérifie les droits quand l'organisation est à l'initiative", async () => {
      await service.requestTermination(
        'user-1',
        'p-1',
        PartnershipParty.ORGANIZATION,
        { reason: 'Réorientation stratégique.' },
      );
      expect(orgAccess.assertCanManageTeam).toHaveBeenCalledWith(
        'org-1',
        'user-1',
      );
    });

    it("prévient l'organisation quand la plateforme est à l'initiative", async () => {
      await service.requestTermination(
        'admin-1',
        'p-1',
        PartnershipParty.PLATFORM,
        { reason: 'Non-respect de la charte.' },
      );

      // L'autorisation vient du garde de rôle ADMIN du contrôleur.
      expect(orgAccess.assertCanManageTeam).not.toHaveBeenCalled();
      expect(notifications.notifyOrganizationLeadership).toHaveBeenCalledWith(
        'org-1',
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        expect.anything(),
      );
    });

    it('refuse une seconde demande', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
        terminationRequestedAt: new Date(),
      });

      await expect(
        service.requestTermination(
          'user-1',
          'p-1',
          PartnershipParty.ORGANIZATION,
          { reason: 'Deuxieme demande.' },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('withdrawTerminationRequest', () => {
    it("interdit à une partie de retirer la demande de l'autre", async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
        terminationRequestedAt: new Date(),
        terminationRequestedBy: PartnershipParty.PLATFORM,
      });

      await expect(
        service.withdrawTerminationRequest(
          'user-1',
          'p-1',
          PartnershipParty.ORGANIZATION,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('efface la demande quand la bonne partie la retire', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
        terminationRequestedAt: new Date(),
        terminationRequestedBy: PartnershipParty.ORGANIZATION,
      });

      await service.withdrawTerminationRequest(
        'user-1',
        'p-1',
        PartnershipParty.ORGANIZATION,
      );

      const data = lastUpdateData();
      expect(data.terminationRequestedAt).toBeNull();
      expect(data.terminationRequestedBy).toBeNull();
    });

    it('refuse le retrait quand aucune demande ne court', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.ACTIVE,
        terminationRequestedAt: null,
      });

      await expect(
        service.withdrawTerminationRequest(
          'user-1',
          'p-1',
          PartnershipParty.ORGANIZATION,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('historique', () => {
    it('journalise chaque décision en ajout seul', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
        organization: { name: 'Coopérative Test' },
        type: { code: 'RECRUITMENT' },
        status: PartnershipStatus.PENDING,
      });

      await service.approve('admin-1', 'p-1', {});

      const [[call]] = prisma.partnershipEvent.create.mock.calls as [
        [{ data: { type: string; actorId: string } }],
      ];
      expect(call.data.type).toBe(PartnershipEventType.APPROVED);
      expect(call.data.actorId).toBe('admin-1');
    });
  });

  describe('listAll', () => {
    it("pagine et filtre par pays via l'organisation", async () => {
      await service.listAll({ country: 'CM', page: 2, limit: 10 });

      const [[call]] = prisma.partnership.findMany.mock.calls as [
        [{ where: Record<string, unknown>; skip: number; take: number }],
      ];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(10);
      expect(call.where).toEqual({ organization: { country: 'CM' } });
    });

    it("n'expose jamais le téléphone ni l'email de l'organisation", async () => {
      await service.listAll({});

      const [[call]] = prisma.partnership.findMany.mock.calls as [
        [{ include: { organization: { select: Record<string, boolean> } } }],
      ];
      const selected = Object.keys(call.include.organization.select);
      expect(selected).not.toContain('phone');
      expect(selected).not.toContain('email');
      expect(selected).not.toContain('ownerId');
    });
  });
});
