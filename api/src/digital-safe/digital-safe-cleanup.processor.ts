import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';

// Suppression définitive des documents du Digital Safe (et de toutes leurs versions)
// dont le délai de conservation est écoulé — jamais de suppression physique immédiate
// (CLAUDE.md §4).
@Processor('digital-safe-cleanup')
export class DigitalSafeCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(DigitalSafeCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    super();
  }

  async process(): Promise<void> {
    const dueDocuments = await this.prisma.digitalSafeDocument.findMany({
      where: {
        deletedAt: { not: null },
        deletionScheduledAt: { lte: new Date() },
      },
      include: { versions: true },
    });

    for (const document of dueDocuments) {
      for (const version of document.versions) {
        await this.storage.delete(version.storageKey);
      }
      await this.audit.record(
        'DIGITAL_SAFE_DOCUMENT_HARD_DELETED',
        document.userId,
        {
          documentId: document.id,
          versionCount: document.versions.length,
        },
      );
      await this.prisma.digitalSafeDocument.delete({
        where: { id: document.id },
      });
    }

    if (dueDocuments.length > 0) {
      this.logger.log(
        `${dueDocuments.length} document(s) du Digital Safe supprimé(s) définitivement.`,
      );
    }
  }
}
