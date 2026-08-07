import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  NotificationType,
  PartnershipEventType,
  PartnershipStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PartnershipTypesService } from './partnership-types.service';
import { PartnershipsService } from './partnerships.service';

// ============================================================================
// COMPLÉMENT REQUIS ET TYPOLOGIE — arbitrages du promoteur du 2026-08-02
//
// Deux changements de fond sont testés ici :
//   — « Un dossier incomplet ne doit pas être traité comme un refus » ;
//   — « Une même organisation devra pouvoir avoir plusieurs partenariats de types
//     différents ».
// ============================================================================
describe('Partenariats — complément requis et typologie', () => {
  const RECRUITMENT = {
    id: 'ptype_recruitment',
    code: 'RECRUITMENT',
    isActive: true,
  };
  const ACADEMIC = { id: 'ptype_academic', code: 'ACADEMIC', isActive: true };
  const MOTIVATION = 'x'.repeat(50);

  let prisma: {
    organization: { findUnique: jest.Mock };
    partnership: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    partnershipType: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    partnershipInformationRequest: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    partnershipEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: {
    notifyAdmins: jest.Mock;
    notifyOrganizationLeadership: jest.Mock;
  };
  let orgAccess: { assertCanManage: jest.Mock; assertCanManageTeam: jest.Mock };
  let service: PartnershipsService;
  let types: PartnershipTypesService;

  // Un dossier tel que `getOrThrow` le renvoie désormais : avec son organisation
  // ET son type.
  const dossier = (status: PartnershipStatus, typeCode = 'RECRUITMENT') => ({
    id: 'p-1',
    organizationId: 'org-1',
    status,
    motivation: MOTIVATION,
    organization: { name: 'Coopérative Sahel' },
    type: { code: typeCode },
  });

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Coopérative Sahel',
          verificationStatus: 'VERIFIED',
        }),
      },
      partnership: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'p-1' }),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'p-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      partnershipType: {
        findUnique: jest.fn().mockResolvedValue(RECRUITMENT),
        findMany: jest.fn().mockResolvedValue([RECRUITMENT, ACADEMIC]),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'new', ...args.data }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 't-1', ...args.data }),
        ),
        count: jest.fn().mockResolvedValue(5),
      },
      partnershipInformationRequest: {
        create: jest.fn().mockResolvedValue({ id: 'ir-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'ir-1' }),
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
      assertCanManage: jest.fn(),
      assertCanManageTeam: jest.fn(),
    };

    service = new PartnershipsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      orgAccess as unknown as OrganizationAccessService,
    );
    types = new PartnershipTypesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  // jest.Mock non typé rend `any` à chaque accès. Cet accesseur redonne au
  // linter — et au lecteur — une prise sur ce qu'on inspecte, plutôt que de
  // disséminer des cast dans chaque assertion.
  type PrismaArgs = { data: Record<string, unknown>; where?: { id?: string } };
  const argsOf = (mock: jest.Mock, call = 0): PrismaArgs => {
    const calls = mock.mock.calls as unknown[][];
    return calls[call][0] as PrismaArgs;
  };
  const lastArgsOf = (mock: jest.Mock): PrismaArgs =>
    argsOf(mock, (mock.mock.calls as unknown[][]).length - 1);
  const metadataOf = (mock: jest.Mock, call = 0): Record<string, unknown> => {
    const calls = mock.mock.calls as unknown[][];
    return calls[call][2] as Record<string, unknown>;
  };

  const lastUpdate = () => lastArgsOf(prisma.partnership.update).data;

  // --- 1. Le statut « complément requis » ---------------------------------
  describe('demande de complément', () => {
    beforeEach(() => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.PENDING),
      );
    });

    it('ouvre le statut sans jamais toucher au refus', async () => {
      await service.requestAdditionalInformation('admin-1', 'p-1', {
        requestedItems: ['Récépissé de déclaration'],
        internalNote: 'Dossier reçu sans pièce justificative.',
      });

      const data = lastUpdate();
      expect(data.status).toBe(
        PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
      );
      expect(data.status).not.toBe(PartnershipStatus.REFUSED);
      // La candidature initiale n'est PAS écrasée.
      expect(data.motivation).toBeUndefined();
    });

    it('conserve l’historique de ce qui a été demandé', async () => {
      await service.requestAdditionalInformation('admin-1', 'p-1', {
        requestedItems: ['Récépissé', 'Attestation fiscale'],
        internalNote: 'Deux pièces manquantes au dépôt.',
        actionDeadline: '2026-09-01T00:00:00.000Z',
      });

      const created = argsOf(prisma.partnershipInformationRequest.create).data;
      expect(created.requestedItems).toEqual([
        'Récépissé',
        'Attestation fiscale',
      ]);
      expect(created.partnershipId).toBe('p-1');
      expect(created.requestedById).toBe('admin-1');
      expect(created.actionDeadline).toBeInstanceOf(Date);
      // La note interne vit dans l'historique, pas dans la notification.
      expect(created.internalNote).toBe('Deux pièces manquantes au dépôt.');
    });

    it('transmet la liste structurée, et jamais la note interne', async () => {
      await service.requestAdditionalInformation('admin-1', 'p-1', {
        requestedItems: ['Récépissé de déclaration'],
        internalNote: 'Société probablement fictive, à vérifier.',
        publicMessage: 'Une copie simple suffit.',
      });

      expect(notifications.notifyOrganizationLeadership).toHaveBeenCalledWith(
        'org-1',
        NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
        expect.objectContaining({
          requestedItems: ['Récépissé de déclaration'],
          publicMessage: 'Une copie simple suffit.',
          organizationName: 'Coopérative Sahel',
        }),
      );

      const metadata = metadataOf(notifications.notifyOrganizationLeadership);
      expect(JSON.stringify(metadata)).not.toContain('probablement fictive');
    });

    it('peut être renouvelée sur un dossier déjà en attente de complément', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED),
      );
      await expect(
        service.requestAdditionalInformation('admin-1', 'p-1', {
          requestedItems: ['Pièce encore manquante'],
          internalNote: 'La première pièce reçue était illisible.',
        }),
      ).resolves.toBeDefined();
    });

    it('est refusée sur un partenariat déjà actif', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await expect(
        service.requestAdditionalInformation('admin-1', 'p-1', {
          requestedItems: ['Pièce'],
          internalNote: 'Note quelconque suffisante.',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('journalise l’événement dans l’historique du dossier', async () => {
      await service.requestAdditionalInformation('admin-1', 'p-1', {
        requestedItems: ['Récépissé'],
        internalNote: 'Pièce manquante au dépôt initial.',
      });
      expect(argsOf(prisma.partnershipEvent.create).data.type).toBe(
        PartnershipEventType.ADDITIONAL_INFORMATION_REQUESTED,
      );
    });
  });

  describe('réponse de l’organisation', () => {
    beforeEach(() => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED),
      );
      prisma.partnershipInformationRequest.findFirst.mockResolvedValue({
        id: 'ir-1',
      });
    });

    it('remet le dossier en examen sans créer de nouvelle demande', async () => {
      await service.provideAdditionalInformation('user-1', 'p-1', {
        response: 'y'.repeat(30),
      });

      expect(lastUpdate().status).toBe(PartnershipStatus.PENDING);
      // Aucune création de partenariat : c'est le MÊME dossier qui poursuit.
      expect(prisma.partnership.create).not.toHaveBeenCalled();
      expect(lastUpdate().actionDeadline).toBeNull();
    });

    it('clôt la demande de complément en y attachant la réponse', async () => {
      await service.provideAdditionalInformation('user-1', 'p-1', {
        response: 'z'.repeat(30),
      });

      const update = argsOf(prisma.partnershipInformationRequest.update);
      expect(update.where?.id).toBe('ir-1');
      expect(update.data.resolvedAt).toBeInstanceOf(Date);
      expect(update.data.response).toBe('z'.repeat(30));
    });

    it('vérifie les droits sur l’organisation avant d’écrire', async () => {
      await service.provideAdditionalInformation('user-1', 'p-1', {
        response: 'w'.repeat(30),
      });
      expect(orgAccess.assertCanManageTeam).toHaveBeenCalledWith(
        'org-1',
        'user-1',
      );
    });

    it('est refusée si aucun complément n’est attendu', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.PENDING),
      );
      await expect(
        service.provideAdditionalInformation('user-1', 'p-1', {
          response: 'w'.repeat(30),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('décisions depuis un dossier incomplet', () => {
    it('un dossier resté incomplet peut être refusé', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED),
      );
      await expect(
        service.refuse('admin-1', 'p-1', {
          internalNote: 'Sans réponse après relance.',
          reasonCode: 'INCOMPLETE_FILE',
        } as never),
      ).resolves.toBeDefined();
    });

    it('un complément reçu hors plateforme ne bloque pas l’acceptation', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED),
      );
      await expect(
        service.approve('admin-1', 'p-1', {}),
      ).resolves.toBeDefined();
    });
  });

  // --- 2. Typologie ---------------------------------------------------------
  describe('typologie des partenariats', () => {
    it('refuse un type absent du catalogue', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue(null);
      await expect(
        service.request('user-1', 'org-1', {
          typeCode: 'INVENTE',
          motivation: MOTIVATION,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un type retiré du catalogue', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue({
        ...ACADEMIC,
        isActive: false,
      });
      await expect(
        service.request('user-1', 'org-1', {
          typeCode: 'ACADEMIC',
          motivation: MOTIVATION,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cherche le doublon sur le COUPLE organisation + type', async () => {
      await service.request('user-1', 'org-1', {
        typeCode: 'RECRUITMENT',
        motivation: MOTIVATION,
      });
      expect(prisma.partnership.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_typeId: {
            organizationId: 'org-1',
            typeId: 'ptype_recruitment',
          },
        },
      });
    });

    it('laisse une organisation candidater à un second type', async () => {
      // Aucun partenariat ACADEMIC existant, même si l'organisation est déjà
      // partenaire au titre du recrutement.
      prisma.partnershipType.findUnique.mockResolvedValue(ACADEMIC);
      prisma.partnership.findUnique.mockResolvedValue(null);

      await expect(
        service.request('user-1', 'org-1', {
          typeCode: 'ACADEMIC',
          motivation: MOTIVATION,
        }),
      ).resolves.toBeDefined();
      expect(prisma.partnership.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          typeId: 'ptype_academic',
          motivation: MOTIVATION,
        },
      });
    });

    it('oriente vers le complément plutôt que vers une nouvelle demande', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        status: PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
      });
      await expect(
        service.request('user-1', 'org-1', {
          typeCode: 'RECRUITMENT',
          motivation: MOTIVATION,
        }),
      ).rejects.toThrow(ConflictException);

      await service
        .request('user-1', 'org-1', {
          typeCode: 'RECRUITMENT',
          motivation: MOTIVATION,
        })
        .catch((error: Error) => {
          expect(error.message).toMatch(/Complétez-la depuis votre espace/i);
        });
    });

    it('transmet le code du catalogue, pas la nature de l’organisation', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.PENDING, 'ACADEMIC'),
      );
      await service.approve('admin-1', 'p-1', {});

      expect(notifications.notifyOrganizationLeadership).toHaveBeenCalledWith(
        'org-1',
        NotificationType.PARTNERSHIP_APPROVED,
        expect.objectContaining({ partnershipType: 'ACADEMIC' }),
      );
    });
  });

  describe('catalogue des types', () => {
    it('ne propose que les types actifs à une organisation', async () => {
      await types.listActive();
      expect(prisma.partnershipType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('normalise le code en majuscules à la création', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue(null);
      await types.create('admin-1', {
        code: 'sponsoring',
        labelFr: 'Mécénat',
        labelEn: 'Sponsorship',
        labelEs: 'Mecenazgo',
        labelAr: 'رعاية',
        labelPt: 'Mecenato',
      });
      expect(argsOf(prisma.partnershipType.create).data.code).toBe(
        'SPONSORING',
      );
    });

    it('n’expose aucun moyen de modifier un code existant', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue(RECRUITMENT);
      await types.update('admin-1', 't-1', { labelFr: 'Nouveau libellé' });

      const data = argsOf(prisma.partnershipType.update).data;
      // Renommer un code orphelinerait silencieusement les partenariats.
      expect(data.code).toBeUndefined();
      expect(data.labelFr).toBe('Nouveau libellé');
    });

    it('refuse de désactiver le dernier type proposable', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue(RECRUITMENT);
      prisma.partnershipType.count.mockResolvedValue(0);
      await expect(types.setActive('admin-1', 't-1', false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('désactive au lieu de supprimer', async () => {
      prisma.partnershipType.findUnique.mockResolvedValue(RECRUITMENT);
      prisma.partnershipType.count.mockResolvedValue(4);
      await types.setActive('admin-1', 't-1', false);
      expect(argsOf(prisma.partnershipType.update).data).toEqual({
        isActive: false,
      });
    });
  });
});
