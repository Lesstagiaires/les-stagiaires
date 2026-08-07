import {
  NotificationType,
  PartnershipEventType,
  PartnershipEventVisibility,
  PartnershipStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import { diffOf } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PartnershipsService } from './partnerships.service';

// ============================================================================
// HISTORIQUE DES DÉCISIONS ET AUDIT — arbitrages du promoteur du 2026-08-02.
//
// « Chaque événement devra enregistrer : la date, l'auteur, la décision, le motif,
// les pièces concernées, les notifications envoyées. »
// « Je veux qu'il soit impossible de perdre l'historique d'un partenariat. »
//
// L'inaltérabilité elle-même est garantie par un déclencheur PostgreSQL, donc
// vérifiée en base et non ici. Ce que ces tests verrouillent, c'est que le code
// ÉCRIT bien tout ce qui doit l'être, et n'expose pas ce qui ne doit pas l'être.
// ============================================================================
describe('Partenariats — journal des décisions', () => {
  let prisma: {
    organization: { findUnique: jest.Mock };
    partnership: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    partnershipType: { findUnique: jest.Mock };
    partnershipInformationRequest: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    partnershipEvent: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: {
    notifyAdmins: jest.Mock;
    notifyOrganizationLeadership: jest.Mock;
  };
  let orgAccess: { assertCanManage: jest.Mock; assertCanManageTeam: jest.Mock };
  let service: PartnershipsService;

  const dossier = (status: PartnershipStatus) => ({
    id: 'cms7fe1w70004c8v9irf2993t',
    organizationId: 'org-1',
    status,
    motivation: 'x'.repeat(50),
    signedAt: null,
    actionDeadline: null,
    terminationRequestedAt: null,
    terminationRequestedBy: null,
    organization: { name: 'Coopérative Sahel' },
    type: { code: 'RECRUITMENT' },
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
        findUnique: jest
          .fn()
          .mockResolvedValue(dossier(PartnershipStatus.PENDING)),
        create: jest.fn().mockResolvedValue({ id: 'p-1' }),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'p-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      partnershipType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't-1',
          code: 'RECRUITMENT',
          isActive: true,
        }),
      },
      partnershipInformationRequest: {
        create: jest.fn().mockResolvedValue({ id: 'ir-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'ir-1' }),
        update: jest.fn(),
      },
      partnershipEvent: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = {
      notifyAdmins: jest.fn().mockResolvedValue(3),
      notifyOrganizationLeadership: jest.fn().mockResolvedValue(2),
    };
    orgAccess = { assertCanManage: jest.fn(), assertCanManageTeam: jest.fn() };

    service = new PartnershipsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      orgAccess as unknown as OrganizationAccessService,
    );
  });

  const eventData = (call = 0): Record<string, unknown> => {
    const calls = prisma.partnershipEvent.create.mock.calls as unknown[][];
    return (calls[call][0] as { data: Record<string, unknown> }).data;
  };
  // Un jest.Mock non typé rend « any » à chaque accès : ces accesseurs redonnent
  // une prise au linter, et au lecteur, sur ce qu'on inspecte réellement.
  const firstArgOf = (mock: jest.Mock): unknown =>
    (mock.mock.calls as unknown[][])[0][0];
  const metadataOf = (mock: jest.Mock): Record<string, unknown> =>
    (mock.mock.calls as unknown[][])[0][2] as Record<string, unknown>;
  const auditArgs = (call = 0) => {
    const calls = audit.recordChange.mock.calls as unknown[][];
    return {
      action: calls[call][0] as string,
      actorId: calls[call][1] as string | null,
      context: calls[call][2] as {
        entityType?: string;
        entityId?: string;
        changes?: { field: string; oldValue: unknown; newValue: unknown }[];
      },
    };
  };

  describe('chaque décision écrit un événement ET une trace d’audit', () => {
    it('les deux partent d’un seul appel — impossible d’en oublier un', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.suspend('admin-1', 'p-1', {
        internalNote: 'Signalement en cours de vérification.',
        reasonCode: 'COMPLIANCE_REVIEW',
      } as never);

      expect(prisma.partnershipEvent.create).toHaveBeenCalledTimes(1);
      expect(audit.recordChange).toHaveBeenCalledTimes(1);
    });

    it('enregistre la date, l’auteur, la décision et le motif', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.suspend('admin-1', 'p-1', {
        internalNote: 'Signalement en cours de vérification.',
        reasonCode: 'COMPLIANCE_REVIEW',
        publicMessage: 'Une vérification est en cours.',
      } as never);

      const data = eventData();
      // La date est posée par la base (`createdAt` par défaut) ; le reste, ici.
      expect(data.actorId).toBe('admin-1');
      expect(data.type).toBe(PartnershipEventType.SUSPENDED);
      expect(data.reasonCode).toBe('COMPLIANCE_REVIEW');
      expect(data.publicMessage).toBe('Une vérification est en cours.');
      expect(data.internalNote).toBe('Signalement en cours de vérification.');
    });

    it('enregistre la transition : d’où vers où', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.suspend('admin-1', 'p-1', {
        internalNote: 'Signalement en cours de vérification.',
        reasonCode: 'COMPLIANCE_REVIEW',
      } as never);

      const data = eventData();
      expect(data.fromStatus).toBe(PartnershipStatus.ACTIVE);
      expect(data.toStatus).toBe(PartnershipStatus.SUSPENDED);

      const { context } = auditArgs();
      expect(context.entityType).toBe('Partnership');
      expect(context.changes).toContainEqual({
        field: 'status',
        oldValue: PartnershipStatus.ACTIVE,
        newValue: PartnershipStatus.SUSPENDED,
      });
    });

    it('enregistre les notifications réellement envoyées', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.terminate('admin-1', 'p-1', {
        internalNote: 'Résiliation actée entre les parties.',
        reasonCode: 'MUTUAL_AGREEMENT',
      } as never);

      const data = eventData();
      expect(data.notifiedTypes).toEqual([
        NotificationType.PARTNERSHIP_TERMINATED,
      ]);
      // Le compte vient du diffuseur, pas d'une supposition du code appelant.
      expect(data.notifiedCount).toBe(2);
    });

    it('enregistre les pièces concernées', async () => {
      await service.requestAdditionalInformation('admin-1', 'p-1', {
        requestedItems: ['Récépissé', 'Attestation fiscale'],
        internalNote: 'Deux pièces manquantes.',
      });

      const data = eventData();
      expect(data.informationRequestId).toBe('ir-1');
      expect(data.metadata).toEqual({
        requestedItems: ['Récépissé', 'Attestation fiscale'],
      });
    });
  });

  describe('le journal reste lisible seul', () => {
    it('recopie l’organisation et la référence sur chaque événement', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.terminate('admin-1', 'p-1', {
        internalNote: 'Résiliation actée entre les parties.',
        reasonCode: 'MUTUAL_AGREEMENT',
      } as never);

      const data = eventData();
      // Sans ces deux champs, un événement dont le partenariat a disparu
      // deviendrait illisible : c'est exactement ce qu'il fallait empêcher.
      expect(data.organizationId).toBe('org-1');
      expect(data.reference).toBe('PART-IRF2993T');
    });

    it('la référence de l’événement est celle du dossier, à l’identique', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.terminate('admin-1', 'p-1', {
        internalNote: 'Résiliation actée entre les parties.',
        reasonCode: 'MUTUAL_AGREEMENT',
      } as never);

      const notified = metadataOf(notifications.notifyOrganizationLeadership);
      expect(eventData().reference).toBe(
        (notified as { reference: string }).reference,
      );
    });
  });

  describe('visibilité — l’organisation ne voit pas l’instruction interne', () => {
    it('les décisions qui la concernent lui sont visibles', async () => {
      prisma.partnership.findUnique.mockResolvedValue(
        dossier(PartnershipStatus.ACTIVE),
      );
      await service.suspend('admin-1', 'p-1', {
        internalNote: 'Signalement en cours de vérification.',
        reasonCode: 'COMPLIANCE_REVIEW',
      } as never);

      expect(eventData().visibility).toBe(
        PartnershipEventVisibility.ORGANIZATION,
      );
    });

    it('la lecture côté organisation filtre ET restreint les champs', async () => {
      await service.getForOrganization('user-1', 'org-1');

      const args = firstArgOf(prisma.partnership.findMany) as {
        include: {
          events: {
            where: { visibility: string };
            select: Record<string, boolean>;
          };
          informationRequests: { select: Record<string, boolean> };
        };
      };

      expect(args.include.events.where.visibility).toBe(
        PartnershipEventVisibility.ORGANIZATION,
      );
      // LE point : la note interne n'est pas dans la sélection. Deux verrous, pas
      // un — la visibilité pourrait être mal posée un jour, la sélection tient.
      expect(args.include.events.select.internalNote).toBeUndefined();
      expect(args.include.events.select.publicMessage).toBe(true);
      expect(
        args.include.informationRequests.select.internalNote,
      ).toBeUndefined();
    });

    it('l’historique d’administration ne filtre rien', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
      });
      prisma.partnershipEvent.findMany.mockResolvedValue([]);
      await service.getHistory('p-1');

      const args = firstArgOf(prisma.partnershipEvent.findMany) as {
        where: Record<string, unknown>;
        select?: unknown;
      };
      // Pas de `select` : l'instruction voit tout, notes internes comprises.
      expect(args.select).toBeUndefined();
    });

    it('sépare le dossier courant des décisions orphelines', async () => {
      prisma.partnership.findUnique.mockResolvedValue({
        id: 'p-1',
        organizationId: 'org-1',
      });
      prisma.partnershipEvent.findMany
        .mockResolvedValueOnce([{ id: 'e-1' }])
        .mockResolvedValueOnce([{ id: 'e-orphelin' }]);

      const history = await service.getHistory('p-1');

      // Les fondre en un seul tableau présenterait à l'administrateur, comme
      // appartenant au dossier courant, des décisions prises sur un dossier
      // antérieur — parfois d'un autre type, parfois contradictoires.
      expect(history.events).toEqual([{ id: 'e-1' }]);
      expect(history.orphanedEvents).toEqual([{ id: 'e-orphelin' }]);

      const calls = prisma.partnershipEvent.findMany.mock.calls as unknown[][];
      expect(
        (calls[0][0] as { where: { partnershipId: string } }).where
          .partnershipId,
      ).toBe('p-1');
      expect(
        (calls[1][0] as { where: { partnershipId: null } }).where.partnershipId,
      ).toBeNull();
    });
  });
});

describe('diffOf — ancienne et nouvelle valeur', () => {
  it('ne retient que ce qui a changé', () => {
    const changes = diffOf(
      { status: 'ACTIVE', name: 'Sahel' },
      { status: 'SUSPENDED', name: 'Sahel' },
    );
    expect(changes).toEqual([
      { field: 'status', oldValue: 'ACTIVE', newValue: 'SUSPENDED' },
    ]);
  });

  it('normalise les dates, sinon deux dates égales paraîtraient différentes', () => {
    const instant = '2026-08-02T10:00:00.000Z';
    expect(
      diffOf({ signedAt: new Date(instant) }, { signedAt: new Date(instant) }),
    ).toEqual([]);
  });

  it('distingue une valeur posée d’une valeur effacée', () => {
    const date = new Date('2026-08-02T10:00:00.000Z');
    expect(diffOf({ actionDeadline: null }, { actionDeadline: date })).toEqual([
      {
        field: 'actionDeadline',
        oldValue: null,
        newValue: '2026-08-02T10:00:00.000Z',
      },
    ]);
    expect(diffOf({ actionDeadline: date }, { actionDeadline: null })).toEqual([
      {
        field: 'actionDeadline',
        oldValue: '2026-08-02T10:00:00.000Z',
        newValue: null,
      },
    ]);
  });

  it('traite « absent » et « vidé » comme la même chose', () => {
    expect(diffOf({ note: undefined }, { note: null })).toEqual([]);
  });
});
