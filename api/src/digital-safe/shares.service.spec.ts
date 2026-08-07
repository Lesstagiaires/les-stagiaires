import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { AuditService } from '../audit/audit.service';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AccessLogService } from './access-log.service';
import type { DigitalSafeDocumentsService } from './documents.service';
import { SharesService } from './shares.service';

describe('SharesService', () => {
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock };
    digitalSafeShare: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock };
  let accessLog: { record: jest.Mock };
  let documents: { assertOwnsDocument: jest.Mock };
  let minorPolicy: { assertActionAllowed: jest.Mock };
  let service: SharesService;

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      digitalSafeShare: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    config = { get: jest.fn().mockReturnValue('30') };
    audit = { record: jest.fn() };
    accessLog = { record: jest.fn() };
    documents = { assertOwnsDocument: jest.fn().mockResolvedValue(undefined) };
    minorPolicy = {
      assertActionAllowed: jest.fn().mockResolvedValue(undefined),
    };
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'owner-1' });
    service = new SharesService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      accessLog as unknown as AccessLogService,
      documents as unknown as DigitalSafeDocumentsService,
      minorPolicy as unknown as MinorPolicyService,
    );
  });

  describe('create', () => {
    // CLAUDE.md §5 : le partage Digital Safe est une action soumise au moteur de règles
    // mineurs — jamais court-circuitée, contrairement à la constitution du coffre elle-même.
    it('always runs the document sharing action through the minor-protection engine', async () => {
      minorPolicy.assertActionAllowed.mockRejectedValue(
        new ForbiddenException('Consentement parental requis.'),
      );

      await expect(
        service.create('owner-1', 'doc-1', {
          targetType: 'USER',
          sharedWithUserId: 'target-1',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.digitalSafeShare.create).not.toHaveBeenCalled();
    });

    it('rejects a USER share missing the target id', async () => {
      await expect(
        service.create('owner-1', 'doc-1', {
          targetType: 'USER',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects sharing a document with oneself', async () => {
      await expect(
        service.create('owner-1', 'doc-1', {
          targetType: 'USER',
          sharedWithUserId: 'owner-1',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a USER share targeting a non-existent recipient', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'owner-1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      (prisma.user as unknown as { findUnique: jest.Mock }).findUnique =
        findUnique;

      await expect(
        service.create('owner-1', 'doc-1', {
          targetType: 'USER',
          sharedWithUserId: 'missing-user',
        } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a USER share and caps the requested expiry at the configured maximum', async () => {
      (prisma.user as unknown as { findUnique: jest.Mock }).findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'target-1' });
      prisma.digitalSafeShare.create.mockResolvedValue({
        id: 'share-1',
        targetType: 'USER',
        expiresAt: new Date('2099-01-01'),
      });

      const farFuture = new Date('2099-01-01').toISOString();
      await service.create('owner-1', 'doc-1', {
        targetType: 'USER',
        sharedWithUserId: 'target-1',
        expiresAt: farFuture,
      } as never);

      const [[createCall]] = prisma.digitalSafeShare.create.mock.calls as [
        [{ data: { expiresAt: Date } }],
      ];
      const maxExpected = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(createCall.data.expiresAt.getTime()).toBeLessThanOrEqual(
        maxExpected.getTime() + 1000,
      );
      expect(accessLog.record).toHaveBeenCalledWith(
        'doc-1',
        'SHARE_CREATED',
        'owner-1',
        'share-1',
      );
    });

    // CLAUDE.md §2/§6 : seul le hash du jeton est conservé, jamais le jeton en clair.
    it('never persists the raw LINK token, only its hash — and returns the raw token exactly once', async () => {
      prisma.digitalSafeShare.create.mockResolvedValue({
        id: 'share-2',
        targetType: 'LINK',
        expiresAt: new Date('2026-02-01'),
      });

      const result = await service.create('owner-1', 'doc-1', {
        targetType: 'LINK',
      } as never);

      const [[createCall]] = prisma.digitalSafeShare.create.mock.calls as [
        [{ data: { tokenHash: string } }],
      ];
      expect(createCall.data.tokenHash).not.toBe(result.token);
      expect(createCall.data.tokenHash).toBe(
        createHash('sha256')
          .update(result.token as string)
          .digest('hex'),
      );
      expect(result.token).toBeDefined();
    });
  });

  describe('revoke', () => {
    it('throws NotFoundException for a share belonging to a different document', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        id: 'share-1',
        documentId: 'other-doc',
      });

      await expect(
        service.revoke('owner-1', 'doc-1', 'share-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects revoking a share that is already revoked', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        id: 'share-1',
        documentId: 'doc-1',
        revokedAt: new Date(),
      });

      await expect(
        service.revoke('owner-1', 'doc-1', 'share-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('revokes an active share and logs it', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        id: 'share-1',
        documentId: 'doc-1',
        revokedAt: null,
      });

      await service.revoke('owner-1', 'doc-1', 'share-1');

      expect(prisma.digitalSafeShare.update).toHaveBeenCalledWith({
        where: { id: 'share-1' },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'DIGITAL_SAFE_SHARE_REVOKED',
        'owner-1',
        { documentId: 'doc-1', shareId: 'share-1' },
      );
    });
  });

  describe('resolveToken', () => {
    it('throws NotFoundException for an unknown token', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue(null);

      await expect(service.resolveToken('bad-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a token belonging to a USER (not LINK) share', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        targetType: 'USER',
      });

      await expect(service.resolveToken('some-token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a revoked link', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        targetType: 'LINK',
        revokedAt: new Date(),
        expiresAt: null,
      });

      await expect(service.resolveToken('some-token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects an expired link', async () => {
      prisma.digitalSafeShare.findUnique.mockResolvedValue({
        targetType: 'LINK',
        revokedAt: null,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(service.resolveToken('some-token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('accepts a valid, unexpired, unrevoked link', async () => {
      const share = {
        targetType: 'LINK',
        revokedAt: null,
        expiresAt: new Date('2099-01-01'),
      };
      prisma.digitalSafeShare.findUnique.mockResolvedValue(share);

      await expect(service.resolveToken('some-token')).resolves.toBe(share);
    });
  });
});
