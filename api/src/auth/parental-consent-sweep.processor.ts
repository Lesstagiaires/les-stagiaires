import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Signalement puis suspension automatique d'un compte mineur resté plus de 30 jours sans
// validation parentale (CLAUDE.md §5, FR-AUTH-004c).
@Processor('parental-consent-sweep')
export class ParentalConsentSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ParentalConsentSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const flagAfterDays = Number(
      this.config.get<string>('PARENTAL_CONSENT_FLAG_AFTER_DAYS', '30'),
    );
    const cutoff = new Date(Date.now() - flagAfterDays * 24 * 60 * 60 * 1000);

    const overdueLinks = await this.prisma.parentalLink.findMany({
      where: {
        status: ParentalLinkStatus.PENDING,
        createdAt: { lte: cutoff },
        flaggedAt: null,
      },
    });

    for (const link of overdueLinks) {
      await this.prisma.parentalLink.update({
        where: { id: link.id },
        data: { status: ParentalLinkStatus.EXPIRED, flaggedAt: new Date() },
      });
      await this.audit.record(
        'PARENTAL_CONSENT_OVERDUE_FLAGGED',
        link.childId,
        { linkId: link.id },
      );

      const child = await this.prisma.user.findUnique({
        where: { id: link.childId },
      });
      if (child && child.status !== AccountStatus.DEACTIVATED) {
        await this.prisma.user.update({
          where: { id: child.id },
          data: {
            status: AccountStatus.DEACTIVATED,
            deactivatedAt: new Date(),
          },
        });
        await this.audit.record(
          'MINOR_ACCOUNT_SUSPENDED_NO_PARENTAL_CONSENT',
          child.id,
          { linkId: link.id },
        );
      }
    }

    if (overdueLinks.length > 0) {
      this.logger.warn(
        `${overdueLinks.length} compte(s) mineur(s) signalé(s) et suspendu(s) après ${flagAfterDays} jours sans consentement parental.`,
      );
    }
  }
}
