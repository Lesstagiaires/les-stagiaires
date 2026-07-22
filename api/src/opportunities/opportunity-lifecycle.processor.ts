import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpportunityStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const ARCHIVABLE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.FILLED,
  OpportunityStatus.EXPIRED,
  OpportunityStatus.CANCELLED,
  OpportunityStatus.REPORTED,
  OpportunityStatus.SUSPENDED,
];

// FR-M4-013 : transitions automatiques du cycle de vie — expiration puis archivage, sans
// intervention de l'organisation.
@Processor('opportunity-lifecycle')
export class OpportunityLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(OpportunityLifecycleProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const expired = await this.prisma.opportunity.updateMany({
      where: {
        status: { in: [OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED] },
        expiresAt: { lte: new Date() },
      },
      data: { status: OpportunityStatus.EXPIRED },
    });

    const archiveAfterDays = Number(
      this.config.get<string>('OPPORTUNITY_ARCHIVE_AFTER_DAYS', '90'),
    );
    const archiveCutoff = new Date(
      Date.now() - archiveAfterDays * 24 * 60 * 60 * 1000,
    );
    const archived = await this.prisma.opportunity.updateMany({
      where: {
        status: { in: ARCHIVABLE_STATUSES },
        updatedAt: { lte: archiveCutoff },
      },
      data: { status: OpportunityStatus.ARCHIVED },
    });

    if (expired.count > 0 || archived.count > 0) {
      await this.audit.record('OPPORTUNITY_LIFECYCLE_SWEEP', null, {
        expiredCount: expired.count,
        archivedCount: archived.count,
      });
      this.logger.log(
        `${expired.count} offre(s) expirée(s), ${archived.count} offre(s) archivée(s).`,
      );
    }
  }
}
