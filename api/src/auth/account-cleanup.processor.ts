import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AccountStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Processor('account-cleanup')
export class AccountCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  // Suppression définitive des comptes dont le délai de conservation est écoulé
  // (suppression logique puis définitive, jamais immédiate — CLAUDE.md §4).
  async process(): Promise<void> {
    const dueAccounts = await this.prisma.user.findMany({
      where: {
        status: AccountStatus.PENDING_DELETION,
        deletionScheduledAt: { lte: new Date() },
      },
      select: { id: true },
    });

    for (const account of dueAccounts) {
      await this.audit.record('ACCOUNT_HARD_DELETED', null, {
        deletedUserId: account.id,
      });
      await this.prisma.user.delete({ where: { id: account.id } });
    }

    if (dueAccounts.length > 0) {
      this.logger.log(
        `${dueAccounts.length} compte(s) supprimé(s) définitivement après le délai de conservation.`,
      );
    }
  }
}
