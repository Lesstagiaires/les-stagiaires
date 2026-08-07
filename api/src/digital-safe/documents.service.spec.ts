import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DocumentEncryptionService } from '../storage/document-encryption.service';
import type { FileValidationService } from '../storage/file-validation.service';
import type { AccessLogService } from './access-log.service';
import { DigitalSafeDocumentsService } from './documents.service';

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    userId: 'owner-1',
    category: 'IDENTITY',
    title: 'Carte nationale d’identité',
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  const fileName = 'id.pdf';
  const mimeType = 'application/pdf';
  const plaintext = Buffer.from('contenu du document');
  const checksum = createHash('sha256').update(plaintext).digest('hex');
  return {
    id: 'ver-1',
    documentId: 'doc-1',
    versionNumber: 1,
    fileName,
    mimeType,
    storageKey: 'digital-safe/doc-1/abc',
    checksum,
    sizeBytes: plaintext.length,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('DigitalSafeDocumentsService', () => {
  let prisma: {
    digitalSafeDocument: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    digitalSafeDocumentVersion: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    digitalSafeShare: { findFirst: jest.Mock };
  };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock };
  let accessLog: { record: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let validation: { validate: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let service: DigitalSafeDocumentsService;

  const plaintext = Buffer.from('contenu du document');

  beforeEach(() => {
    prisma = {
      digitalSafeDocument: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      digitalSafeDocumentVersion: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      digitalSafeShare: { findFirst: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('10') };
    audit = { record: jest.fn() };
    accessLog = { record: jest.fn() };
    encryption = {
      encrypt: jest.fn().mockReturnValue(Buffer.from('encrypted')),
      decrypt: jest.fn().mockReturnValue(plaintext),
    };
    validation = { validate: jest.fn().mockResolvedValue(undefined) };
    storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(Buffer.from('encrypted')),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DigitalSafeDocumentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      accessLog as unknown as AccessLogService,
      encryption as unknown as DocumentEncryptionService,
      validation as unknown as FileValidationService,
      storage,
    );
  });

  describe('create', () => {
    it('rejects and audits a file that fails validation, without ever storing it', async () => {
      validation.validate.mockRejectedValue(
        new BadRequestException('bad file'),
      );

      await expect(
        service.create('owner-1', 'IDENTITY', 'Title', {
          buffer: Buffer.from('x'),
          mimetype: 'application/pdf',
          originalname: 'x.pdf',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        'DIGITAL_SAFE_UPLOAD_REJECTED',
        'owner-1',
        expect.any(Object),
      );
    });

    it('encrypts the file before handing it to storage — plaintext never reaches the provider', async () => {
      prisma.digitalSafeDocument.create.mockResolvedValue(makeDocument());
      prisma.digitalSafeDocumentVersion.create.mockResolvedValue(makeVersion());

      await service.create('owner-1', 'IDENTITY', 'Title', {
        buffer: plaintext,
        mimetype: 'application/pdf',
        originalname: 'id.pdf',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith(plaintext);
      expect(storage.put).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('encrypted'),
      );
    });
  });

  describe('downloadLatest', () => {
    it('allows the owner to download without needing a share', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());
      prisma.digitalSafeDocumentVersion.findFirst.mockResolvedValue(
        makeVersion(),
      );

      const result = await service.downloadLatest('owner-1', 'doc-1');

      expect(prisma.digitalSafeShare.findFirst).not.toHaveBeenCalled();
      expect(result.buffer).toEqual(plaintext);
      expect(accessLog.record).toHaveBeenCalledWith(
        'doc-1',
        'DOWNLOADED',
        'owner-1',
      );
    });

    it('rejects a non-owner with no active share', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());
      prisma.digitalSafeShare.findFirst.mockResolvedValue(null);

      await expect(
        service.downloadLatest('stranger-1', 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a non-owner holding a valid, unexpired USER share', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());
      prisma.digitalSafeShare.findFirst.mockResolvedValue({ id: 'share-1' });
      prisma.digitalSafeDocumentVersion.findFirst.mockResolvedValue(
        makeVersion(),
      );

      await expect(
        service.downloadLatest('trusted-1', 'doc-1'),
      ).resolves.toMatchObject({ buffer: plaintext });
    });

    it('rejects an anonymous caller (no requestingUserId) on a document they do not own', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());

      await expect(
        service.downloadLatest(undefined, 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.digitalSafeShare.findFirst).not.toHaveBeenCalled();
    });

    // CLAUDE.md §4 : un document altéré (au repos ou en transit) ne doit jamais être
    // restitué silencieusement.
    it('refuses to return content whose checksum no longer matches (integrity compromised)', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());
      prisma.digitalSafeDocumentVersion.findFirst.mockResolvedValue(
        makeVersion({ checksum: 'deadbeef' }),
      );

      await expect(
        service.downloadLatest('owner-1', 'doc-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for a document that was logically deleted', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(
        makeDocument({ deletedAt: new Date() }),
      );

      await expect(
        service.downloadLatest('owner-1', 'doc-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('schedules a future deletion instead of deleting immediately (logical delete)', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(makeDocument());

      await service.remove('owner-1', 'doc-1');

      expect(prisma.digitalSafeDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          deletedAt: expect.any(Date) as Date,
          deletionScheduledAt: expect.any(Date) as Date,
        },
      });
    });

    it('rejects removal by a user who does not own the document', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(
        makeDocument({ userId: 'owner-1' }),
      );

      await expect(
        service.remove('stranger-1', 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.digitalSafeDocument.update).not.toHaveBeenCalled();
    });
  });

  describe('readVersionForShare', () => {
    it('throws NotFoundException once the underlying document has been deleted, even with a live share link', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(
        makeDocument({ deletedAt: new Date() }),
      );

      await expect(service.readVersionForShare('doc-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
