import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'crypto';
import { DocumentCategory, ProfileSection } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MALWARE_SCANNER } from '../storage/malware-scanner.interface';
import type { MalwareScanner } from '../storage/malware-scanner.interface';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { VisibilityService } from './visibility.service';

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

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
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  private getEncryptionKey(): Buffer {
    const hex = this.config.getOrThrow<string>('DOCUMENT_ENCRYPTION_KEY');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) {
      throw new Error(
        'DOCUMENT_ENCRYPTION_KEY doit faire 32 octets (64 caractères hexadécimaux).',
      );
    }
    return key;
  }

  private encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  private decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, IV_LENGTH);
    const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      iv,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async upload(userId: string, category: DocumentCategory, file: UploadedFile) {
    const maxSizeBytes =
      Number(this.config.get<string>('DOCUMENT_MAX_SIZE_MB', '10')) *
      1024 *
      1024;
    if (file.buffer.length > maxSizeBytes) {
      throw new BadRequestException('Fichier trop volumineux.');
    }

    const allowedTypes = this.config
      .get<string>('DOCUMENT_ALLOWED_MIME_TYPES', '')
      .split(',')
      .map((type) => type.trim());
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Format non autorisé : ${file.mimetype}`);
    }

    // Analyse anti-malware avant tout enregistrement (CLAUDE.md §4). En dev, le scanner
    // configuré est un stub permissif — voir DevMalwareScanner pour la limite assumée.
    const scanResult = await this.scanner.scan(file.buffer);
    if (!scanResult.clean) {
      await this.audit.record('DOCUMENT_UPLOAD_REJECTED_MALWARE', userId, {
        reason: scanResult.reason,
      });
      throw new BadRequestException(
        'Fichier rejeté par le contrôle de sécurité.',
      );
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `profiles/${profile.id}/${randomUUID()}`;
    await this.storage.put(storageKey, this.encrypt(file.buffer));

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
    const plaintext = this.decrypt(encrypted);

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
