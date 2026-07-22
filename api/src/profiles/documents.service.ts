import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { DocumentCategory, ProfileSection } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentEncryptionService } from '../storage/document-encryption.service';
import { FileValidationService } from '../storage/file-validation.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { VisibilityService } from './visibility.service';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

// checksum et storageKey ne sont jamais renvoyés au client — ce sont des détails
// d'implémentation du stockage chiffré, pas des données consultables (CLAUDE.md §6).
const SAFE_DOCUMENT_SELECT = {
  id: true,
  profileId: true,
  category: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly visibility: VisibilityService,
    private readonly encryption: DocumentEncryptionService,
    private readonly validation: FileValidationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async upload(userId: string, category: DocumentCategory, file: UploadedFile) {
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
      await this.audit.record('DOCUMENT_UPLOAD_REJECTED', userId, {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw error;
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `profiles/${profile.id}/${randomUUID()}`;
    await this.storage.put(storageKey, this.encryption.encrypt(file.buffer));

    const document = await this.prisma.profileDocument.create({
      data: {
        profileId: profile.id,
        category,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.buffer.length,
        checksum,
      },
      select: SAFE_DOCUMENT_SELECT,
    });

    await this.audit.record('DOCUMENT_UPLOADED', userId, {
      documentId: document.id,
      category,
    });
    return document;
  }

  async list(userId: string) {
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return this.prisma.profileDocument.findMany({
      where: { profileId: profile.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: SAFE_DOCUMENT_SELECT,
    });
  }

  async download(requestingUserId: string | undefined, documentId: string) {
    const document = await this.prisma.profileDocument.findUnique({
      where: { id: documentId },
      include: { profile: true },
    });
    if (!document || document.deletedAt) {
      throw new NotFoundException('Document introuvable.');
    }

    const canView =
      document.profile.userId === requestingUserId ||
      (await this.visibility.canView(
        document.profile.userId,
        ProfileSection.DOCUMENTS,
        requestingUserId,
      ));
    if (!canView) {
      throw new ForbiddenException('Accès non autorisé à ce document.');
    }

    const encrypted = await this.storage.get(document.storageKey);
    const plaintext = this.encryption.decrypt(encrypted);

    const checksum = createHash('sha256').update(plaintext).digest('hex');
    if (checksum !== document.checksum) {
      // Intégrité compromise — ne jamais renvoyer un contenu altéré (CLAUDE.md §4).
      throw new BadRequestException(
        "L'intégrité du document n'a pas pu être vérifiée.",
      );
    }

    await this.audit.record('DOCUMENT_ACCESSED', requestingUserId ?? null, {
      documentId,
      ownerId: document.profile.userId,
    });

    return {
      buffer: plaintext,
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  }

  async rename(userId: string, documentId: string, fileName: string) {
    const document = await this.assertOwnsDocument(userId, documentId);
    const updated = await this.prisma.profileDocument.update({
      where: { id: document.id },
      data: { fileName },
      select: SAFE_DOCUMENT_SELECT,
    });
    await this.audit.record('DOCUMENT_RENAMED', userId, { documentId });
    return updated;
  }

  async remove(userId: string, documentId: string) {
    const document = await this.assertOwnsDocument(userId, documentId);
    const retentionDays = Number(
      this.config.get<string>('DOCUMENT_RETENTION_DAYS', '7'),
    );
    await this.prisma.profileDocument.update({
      where: { id: document.id },
      data: {
        deletedAt: new Date(),
        deletionScheduledAt: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
    await this.audit.record('DOCUMENT_DELETION_REQUESTED', userId, {
      documentId,
    });
  }

  private async assertOwnsDocument(userId: string, documentId: string) {
    const document = await this.prisma.profileDocument.findUnique({
      where: { id: documentId },
      include: { profile: true },
    });
    if (!document || document.profile.userId !== userId || document.deletedAt) {
      throw new NotFoundException('Document introuvable pour ce profil.');
    }
    return document;
  }
}
