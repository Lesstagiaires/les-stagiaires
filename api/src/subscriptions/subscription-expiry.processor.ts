import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { SubscriptionStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// Transition automatique ACTIVE → EXPIRED une fois currentPeriodEnd dépassé — un
// abonnement ONE_TIME (currentPeriodEnd = null) n'a pas de période récurrente à expirer.
@Processor('subscription-expiry')
export class SubscriptionExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionExpiryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const expired = await this.prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { not: null, lte: new Date() },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    if (expired.count > 0) {
      await this.audit.record('SUBSCRIPTION_EXPIRY_SWEEP', null, {
        expiredCount: expired.count,
      });
      this.logger.log(`${expired.count} abonnement(s) expiré(s).`);
    }
  }
}
