import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';

// Suppression définitive des documents de profil dont le délai de conservation est
// écoulé — jamais de suppression physique immédiate (CLAUDE.md §4).
@Processor('document-cleanup')
export class DocumentCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    super();
  }

  async process(): Promise<void> {
    const dueDocuments = await this.prisma.profileDocument.findMany({
      where: {
        deletedAt: { not: null },
        deletionScheduledAt: { lte: new Date() },
      },
      include: { profile: true },
    });

    for (const document of dueDocuments) {
      await this.storage.delete(document.storageKey);
      await this.audit.record(
        'DOCUMENT_HARD_DELETED',
        document.profile.userId,
        { documentId: document.id },
      );
      await this.prisma.profileDocument.delete({ where: { id: document.id } });
    }

    if (dueDocuments.length > 0) {
      this.logger.log(
        `${dueDocuments.length} document(s) de profil supprimé(s) définitivement.`,
      );
    }
  }
}
