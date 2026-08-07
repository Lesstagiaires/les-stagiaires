import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PartnershipRequestsService } from './partnership-requests.service';

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    organizationName: 'Acme Corp',
    organizationType: 'COMPANY',
    reason: 'BECOME_PARTNER',
    status: 'NEW',
    assignedToId: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('PartnershipRequestsService', () => {
  let prisma: {
    partnershipRequest: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    partnershipRequestNote: { create: jest.Mock };
    userRole: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let notifications: { notifyAdmins: jest.Mock };
  let service: PartnershipRequestsService;

  beforeEach(() => {
    prisma = {
      partnershipRequest: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      partnershipRequestNote: { create: jest.fn() },
      userRole: { findFirst: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn() };
    notifications = { notifyAdmins: jest.fn() };
    service = new PartnershipRequestsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('create', () => {
    it('creates the request, audits it, and notifies every active admin', async () => {
      const dto = {
        organizationName: 'Acme Corp',
        organizationType: 'COMPANY' as const,
        contactName: 'Jane Doe',
        phone: '+237670000000',
        email: 'jane@acme.com',
        country: 'Cameroun',
        reason: 'BECOME_PARTNER' as const,
        subject: 'Partnership',
        description: 'We would like to partner with you.',
      };
      prisma.partnershipRequest.create.mockResolvedValue(makeRequest());

      const result = await service.create(dto);

      expect(result).toEqual({
        id: 'req-1',
        status: 'NEW',
        createdAt: makeRequest().createdAt,
      });
      expect(audit.record).toHaveBeenCalledWith(
        'PARTNERSHIP_REQUEST_SUBMITTED',
        null,
        expect.objectContaining({ requestId: 'req-1' }),
      );
      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        'PARTNERSHIP_REQUEST_NEW',
        expect.objectContaining({
          requestId: 'req-1',
          organizationName: 'Acme Corp',
        }),
      );
    });
  });

  describe('getById', () => {
    it('throws when the request does not exist', async () => {
      prisma.partnershipRequest.findUnique.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the request with its notes ordered oldest first', async () => {
      const detail = { ...makeRequest(), notes: [] };
      prisma.partnershipRequest.findUnique.mockResolvedValue(detail);

      const result = await service.getById('req-1');

      expect(result).toBe(detail);

      const [[call]] = prisma.partnershipRequest.findUnique.mock.calls as [
        [
          {
            where: { id: string };
            include: { notes: { orderBy: { createdAt: string } } };
          },
        ],
      ];
      expect(call.where).toEqual({ id: 'req-1' });
      expect(call.include.notes.orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  describe('updateStatus', () => {
    it('throws when the target request does not exist', async () => {
      prisma.partnershipRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('admin-1', 'missing', 'IN_PROGRESS'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a no-op (besides re-fetching) when the status is unchanged', async () => {
      prisma.partnershipRequest.findUnique
        .mockResolvedValueOnce(makeRequest({ status: 'NEW' })) // mustFind
        .mockResolvedValueOnce({ ...makeRequest(), notes: [] }); // getById

      await service.updateStatus('admin-1', 'req-1', 'NEW');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('updates the status and logs a structured STATUS_CHANGE note (never pre-rendered text)', async () => {
      prisma.partnershipRequest.findUnique
        .mockResolvedValueOnce(makeRequest({ status: 'NEW' }))
        .mockResolvedValueOnce({ ...makeRequest(), notes: [] });

      await service.updateStatus('admin-1', 'req-1', 'IN_PROGRESS');

      expect(prisma.partnershipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'IN_PROGRESS' },
      });
      expect(prisma.partnershipRequestNote.create).toHaveBeenCalledWith({
        data: {
          requestId: 'req-1',
          authorId: 'admin-1',
          type: 'STATUS_CHANGE',
          metadata: { previousStatus: 'NEW', newStatus: 'IN_PROGRESS' },
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'PARTNERSHIP_REQUEST_STATUS_CHANGED',
        'admin-1',
        { requestId: 'req-1', previousStatus: 'NEW', newStatus: 'IN_PROGRESS' },
      );
    });
  });

  describe('assign', () => {
    it('rejects assignment to a user who does not hold an active ADMIN role', async () => {
      prisma.partnershipRequest.findUnique.mockResolvedValue(makeRequest());
      prisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.assign('admin-1', 'req-1', 'not-an-admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('assigns to a validated admin and snapshots their lsId into the note', async () => {
      prisma.partnershipRequest.findUnique
        .mockResolvedValueOnce(makeRequest())
        .mockResolvedValueOnce({ ...makeRequest(), notes: [] });
      prisma.userRole.findFirst.mockResolvedValue({
        id: 'ur1',
        user: { id: 'admin-2', lsId: 'LS-CM-2026-ABCDEF' },
      });

      await service.assign('admin-1', 'req-1', 'admin-2');

      expect(prisma.partnershipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { assignedToId: 'admin-2' },
      });
      expect(prisma.partnershipRequestNote.create).toHaveBeenCalledWith({
        data: {
          requestId: 'req-1',
          authorId: 'admin-1',
          type: 'ASSIGNMENT',
          metadata: {
            assigneeId: 'admin-2',
            assigneeLsId: 'LS-CM-2026-ABCDEF',
          },
        },
      });
    });

    it('unassigns when given a null assignee, without checking any role', async () => {
      prisma.partnershipRequest.findUnique
        .mockResolvedValueOnce(makeRequest({ assignedToId: 'admin-2' }))
        .mockResolvedValueOnce({ ...makeRequest(), notes: [] });

      await service.assign('admin-1', 'req-1', null);

      expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
      expect(prisma.partnershipRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { assignedToId: null },
      });
      expect(prisma.partnershipRequestNote.create).toHaveBeenCalledWith({
        data: {
          requestId: 'req-1',
          authorId: 'admin-1',
          type: 'ASSIGNMENT',
          metadata: { assigneeId: null },
        },
      });
    });
  });

  describe('addNote', () => {
    it('throws when the target request does not exist', async () => {
      prisma.partnershipRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.addNote('admin-1', 'missing', 'hello'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('records the free-text note verbatim as content, with no metadata', async () => {
      prisma.partnershipRequest.findUnique
        .mockResolvedValueOnce(makeRequest())
        .mockResolvedValueOnce({ ...makeRequest(), notes: [] });

      await service.addNote('admin-1', 'req-1', 'Called the contact.');

      expect(prisma.partnershipRequestNote.create).toHaveBeenCalledWith({
        data: {
          requestId: 'req-1',
          authorId: 'admin-1',
          type: 'NOTE',
          content: 'Called the contact.',
        },
      });
    });
  });

  describe('listAssignableUsers', () => {
    it('returns only users holding an active ADMIN role', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { user: { id: 'a1', lsId: 'LS-1' } },
        { user: { id: 'a2', lsId: 'LS-2' } },
      ]);

      const result = await service.listAssignableUsers();

      expect(prisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, role: { name: 'ADMIN' } },
        }),
      );
      expect(result).toEqual([
        { id: 'a1', lsId: 'LS-1' },
        { id: 'a2', lsId: 'LS-2' },
      ]);
    });
  });
});
