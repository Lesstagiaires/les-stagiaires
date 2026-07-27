import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportStatus } from '../../generated/prisma/enums';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

// Mécanisme de signalement minimal — harcèlement, abus, danger — accessible dès le MVP,
// même sous une forme simple (CLAUDE.md §5, non négociable pour la protection des mineurs).
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    reporterId: string,
    dto: CreateReportDto,
    targetOpportunityId?: string,
  ) {
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        category: dto.category,
        description: dto.description,
        targetOpportunityId,
      },
    });

    await this.audit.record('REPORT_SUBMITTED', reporterId, {
      reportId: report.id,
      category: report.category,
      targetOpportunityId,
    });

    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt,
    };
  }

  async listMine(reporterId: string) {
    return this.prisma.report.findMany({
      where: { reporterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Panneau de modération — réservé ADMIN (RolesGuard). Les OPEN d'abord, pour que les
  // signalements non traités restent visibles en priorité quel que soit leur âge.
  async listAll(status?: ReportStatus) {
    return this.prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        reporter: {
          select: { id: true, lsId: true, firstName: true, lastName: true },
        },
        targetOpportunity: { select: { id: true, title: true } },
        resolvedBy: { select: { id: true, lsId: true } },
      },
    });
  }

  async resolve(adminId: string, reportId: string, dto: ResolveReportDto) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Signalement introuvable.');

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.status,
        resolutionNote: dto.note,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
      include: {
        reporter: {
          select: { id: true, lsId: true, firstName: true, lastName: true },
        },
        targetOpportunity: { select: { id: true, title: true } },
        resolvedBy: { select: { id: true, lsId: true } },
      },
    });

    await this.audit.record('REPORT_RESOLVED', adminId, {
      reportId,
      previousStatus: report.status,
      newStatus: dto.status,
    });

    return updated;
  }
}
