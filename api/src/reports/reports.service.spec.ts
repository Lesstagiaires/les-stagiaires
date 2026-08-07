import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let prisma: {
    report: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: { record: jest.Mock };
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      report: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new ReportsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('persists the report, audits it, and returns only the minimal receipt', async () => {
      const dto = { category: 'HARASSMENT' as const, description: 'Details.' };
      prisma.report.create.mockResolvedValue({
        id: 'rep-1',
        status: 'OPEN',
        category: 'HARASSMENT',
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.create('reporter-1', dto, 'opp-1');

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: 'reporter-1',
          category: 'HARASSMENT',
          description: 'Details.',
          targetOpportunityId: 'opp-1',
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'REPORT_SUBMITTED',
        'reporter-1',
        {
          reportId: 'rep-1',
          category: 'HARASSMENT',
          targetOpportunityId: 'opp-1',
        },
      );
      expect(result).toEqual({
        id: 'rep-1',
        status: 'OPEN',
        createdAt: new Date('2026-01-01'),
      });
    });

    it('supports a report with no linked opportunity (e.g. reporting a user)', async () => {
      const dto = { category: 'ABUSE' as const, description: 'Details.' };
      prisma.report.create.mockResolvedValue({
        id: 'rep-2',
        status: 'OPEN',
        createdAt: new Date('2026-01-01'),
      });

      await service.create('reporter-1', dto);

      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: 'reporter-1',
          category: 'ABUSE',
          description: 'Details.',
          targetOpportunityId: undefined,
        },
      });
    });
  });

  describe('listMine', () => {
    it('returns only the caller own reports, newest first', async () => {
      const rows = [{ id: 'rep-1' }];
      prisma.report.findMany.mockResolvedValue(rows);

      const result = await service.listMine('reporter-1');

      expect(prisma.report.findMany).toHaveBeenCalledWith({
        where: { reporterId: 'reporter-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('listAll', () => {
    it('lists every report, unfiltered, with OPEN surfaced first when no status is given', async () => {
      prisma.report.findMany.mockResolvedValue([]);

      await service.listAll();

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('filters by status when one is given', async () => {
      prisma.report.findMany.mockResolvedValue([]);

      await service.listAll('REVIEWED');

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'REVIEWED' } }),
      );
    });
  });

  describe('resolve', () => {
    it('throws NotFoundException when the report does not exist', async () => {
      prisma.report.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('admin-1', 'missing', {
          status: 'REVIEWED' as const,
          note: 'Handled.',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.report.update).not.toHaveBeenCalled();
    });

    it('updates status, stamps the resolving admin and timestamp, and audits the transition', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        status: 'OPEN',
      });
      const updated = { id: 'rep-1', status: 'REVIEWED' };
      prisma.report.update.mockResolvedValue(updated);

      const result = await service.resolve('admin-1', 'rep-1', {
        status: 'REVIEWED' as const,
        note: 'Handled.',
      });

      expect(prisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rep-1' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          data: expect.objectContaining({
            status: 'REVIEWED',
            resolutionNote: 'Handled.',
            resolvedById: 'admin-1',
            resolvedAt: expect.any(Date) as Date,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith('REPORT_RESOLVED', 'admin-1', {
        reportId: 'rep-1',
        previousStatus: 'OPEN',
        newStatus: 'REVIEWED',
      });
      expect(result).toBe(updated);
    });
  });
});
