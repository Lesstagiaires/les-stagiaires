import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import {
  DigitalSafeAccessAction,
  DigitalSafeDocumentCategory,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentEncryptionService } from '../storage/document-encryption.service';
import { FileValidationService } from '../storage/file-validation.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { AccessLogService } from './access-log.service';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// checksum et storageKey ne sont jamais renvoyés au client (CLAUDE.md §6).
const SAFE_VERSION_SELECT = {
  id: true,
  documentId: true,
  versionNumber: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

const SAFE_DOCUMENT_SELECT = {
  id: true,
  userId: true,
  category: true,
  title: true,
  createdAt: true,
} as const;

@Injectable()
export class DigitalSafeDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly accessLog: AccessLogService,
    private readonly encryption: DocumentEncryptionService,
    private readonly validation: FileValidationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async validateFile(
    userId: string,
    file: UploadedFile,
  ): Promise<void> {
    const maxSizeBytes =
      Number(this.config.get<string>('DOCUMENT_MAX_SIZE_MB', '10')) *
      1024 *
      1024;
    const allowedTypes = this.config
      .get<string>('DOCUMENT_ALLOWED_MIME_TYPES', '')
      .split(',')
      .map((type) => type.trim());

    try {
      await this.validation.validate(file, maxSizeBytes, allowedTypes);
    } catch (error) {
      await this.audit.record('DIGITAL_SAFE_UPLOAD_REJECTED', userId, {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw error;
    }
  }

  // FR-M3-003 : création d'un nouveau document avec sa première version.
  async create(
    userId: string,
    category: DigitalSafeDocumentCategory,
    title: string,
    file: UploadedFile,
  ) {
    await this.validateFile(userId, file);

    const document = await this.prisma.digitalSafeDocument.create({
      data: { userId, category, title },
      select: SAFE_DOCUMENT_SELECT,
    });

    const version = await this.storeVersion(document.id, file, 1);
    await this.audit.record('DIGITAL_SAFE_DOCUMENT_CREATED', userId, {
      documentId: document.id,
      category,
    });
    return { ...document, latestVersion: version };
  }

  // FR-M3-004 : nouvelle version d'un document existant — les précédentes restent
  // consultables, jamais écrasées.
  async addVersion(userId: string, documentId: string, file: UploadedFile) {
    const document = await this.assertOwnsDocument(userId, documentId);
    await this.validateFile(userId, file);

    const lastVersion = await this.prisma.digitalSafeDocumentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
    });
    const nextVersionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const version = await this.storeVersion(
      document.id,
      file,
      nextVersionNumber,
    );
    await this.audit.record('DIGITAL_SAFE_VERSION_ADDED', userId, {
      documentId,
      versionNumber: nextVersionNumber,
    });
    return version;
  }

  private async storeVersion(
    documentId: string,
    file: UploadedFile,
    versionNumber: number,
  ) {
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `digital-safe/${documentId}/${randomUUID()}`;
    await this.storage.put(storageKey, this.encryption.encrypt(file.buffer));

    return this.prisma.digitalSafeDocumentVersion.create({
      data: {
        documentId,
        versionNumber,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        checksum,
      },
      select: SAFE_VERSION_SELECT,
    });
  }

  async list(userId: string) {
    const documents = await this.prisma.digitalSafeDocument.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        ...SAFE_DOCUMENT_SELECT,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: SAFE_VERSION_SELECT,
        },
      },
    });
    return documents.map(({ versions, ...doc }) => ({
      ...doc,
      latestVersion: versions[0] ?? null,
    }));
  }

  async listVersions(userId: string, documentId: string) {
    await this.assertOwnsDocument(userId, documentId);
    return this.prisma.digitalSafeDocumentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: SAFE_VERSION_SELECT,
    });
  }

  // Accès direct par le titulaire ou un tiers ayant un partage USER valide — le partage
  // par lien (LINK) passe par SharesService.resolveToken, pas par cette méthode.
  async downloadLatest(
    requestingUserId: string | undefined,
    documentId: string,
  ) {
    const document = await this.getDocumentOr404(documentId);
    const isOwner = document.userId === requestingUserId;

    if (!isOwner) {
      const validShare = requestingUserId
        ? await this.prisma.digitalSafeShare.findFirst({
            where: {
              documentId,
              targetType: 'USER',
              sharedWithUserId: requestingUserId,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          })
        : null;
      if (!validShare) {
        throw new ForbiddenException('Accès non autorisé à ce document.');
      }
    }

    const version = await this.prisma.digitalSafeDocumentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version)
      throw new NotFoundException(
        'Aucune version disponible pour ce document.',
      );

    const result = await this.readAndVerify(version);
    await this.accessLog.record(
      documentId,
      DigitalSafeAccessAction.DOWNLOADED,
      requestingUserId,
    );
    return result;
  }

  async readVersionForShare(documentId: string, versionId?: string) {
    // Un document supprimé (même en attente de purge définitive) ne doit plus être
    // accessible via un lien de partage déjà émis — sinon "supprimer" ne supprime rien
    // du point de vue de qui détient le lien (CLAUDE.md §4).
    await this.getDocumentOr404(documentId);

    const version = versionId
      ? await this.prisma.digitalSafeDocumentVersion.findUnique({
          where: { id: versionId },
        })
      : await this.prisma.digitalSafeDocumentVersion.findFirst({
          where: { documentId },
          orderBy: { versionNumber: 'desc' },
        });
    if (!version || version.documentId !== documentId) {
      throw new NotFoundException('Version introuvable.');
    }
    return this.readAndVerify(version);
  }

  private async readAndVerify(version: {
    storageKey: string;
    checksum: string;
    mimeType: string;
    fileName: string;
  }) {
    const encrypted = await this.storage.get(version.storageKey);
    const plaintext = this.encryption.decrypt(encrypted);

    const checksum = createHash('sha256').update(plaintext).digest('hex');
    if (checksum !== version.checksum) {
      // Intégrité compromise — ne jamais renvoyer un contenu altéré (CLAUDE.md §4).
      throw new BadRequestException(
        "L'intégrité du document n'a pas pu être vérifiée.",
      );
    }

    return {
      buffer: plaintext,
      mimeType: version.mimeType,
      fileName: version.fileName,
    };
  }

  async rename(userId: string, documentId: string, title: string) {
    await this.assertOwnsDocument(userId, documentId);
    const updated = await this.prisma.digitalSafeDocument.update({
      where: { id: documentId },
      data: { title },
      select: SAFE_DOCUMENT_SELECT,
    });
    await this.audit.record('DIGITAL_SAFE_DOCUMENT_RENAMED', userId, {
      documentId,
    });
    return updated;
  }

  // Suppression logique puis définitive après le délai de conservation — jamais de
  // suppression physique immédiate (CLAUDE.md §4).
  async remove(userId: string, documentId: string) {
    await this.assertOwnsDocument(userId, documentId);
    const retentionDays = Number(
      this.config.get<string>('DOCUMENT_RETENTION_DAYS', '7'),
    );
    await this.prisma.digitalSafeDocument.update({
      where: { id: documentId },
      data: {
        deletedAt: new Date(),
        deletionScheduledAt: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
    await this.audit.record(
      'DIGITAL_SAFE_DOCUMENT_DELETION_REQUESTED',
      userId,
      { documentId },
    );
  }

  async getDocumentOr404(documentId: string) {
    const document = await this.prisma.digitalSafeDocument.findUnique({
      where: { id: documentId },
    });
    if (!document || document.deletedAt) {
      throw new NotFoundException('Document introuvable.');
    }
    return document;
  }

  async assertOwnsDocument(userId: string, documentId: string) {
    const document = await this.getDocumentOr404(documentId);
    if (document.userId !== userId) {
      throw new ForbiddenException('Ce document ne concerne pas ce compte.');
    }
    return document;
  }
}
