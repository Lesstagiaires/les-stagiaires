import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';

// Mécanisme de signalement minimal — harcèlement, abus, danger — accessible dès le MVP,
// même sous une forme simple (CLAUDE.md §5, non négociable pour la protection des mineurs).
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(reporterId: string, dto: CreateReportDto) {
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        category: dto.category,
        description: dto.description,
      },
    });

    await this.audit.record('REPORT_SUBMITTED', reporterId, {
      reportId: report.id,
      category: report.category,
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
}
