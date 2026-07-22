import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  AccountStatus,
  DigitalSafeAccessAction,
  ShareTargetType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessLogService } from './access-log.service';
import { CreateShareDto } from './dto/create-share.dto';
import { DigitalSafeDocumentsService } from './documents.service';

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly accessLog: AccessLogService,
    private readonly documents: DigitalSafeDocumentsService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // Un partage de document "Très sensible" n'est jamais permanent par défaut, et sa
  // durée est plafonnée même si le titulaire demande plus long (CLAUDE.md §1 : "accès
  // exceptionnel et limité" pour cette catégorie de données).
  private resolveExpiresAt(requested: string | undefined): Date {
    const maxDays = Number(
      this.config.get<string>('DIGITAL_SAFE_SHARE_MAX_DAYS', '30'),
    );
    const maxExpiresAt = new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000);
    if (!requested) return maxExpiresAt;
    const requestedDate = new Date(requested);
    return requestedDate > maxExpiresAt ? maxExpiresAt : requestedDate;
  }

  // FR-M3-005 : partage sélectif — vers un utilisateur précis ou via un lien à jeton.
  // FR-M3-006 : expiration automatique via expiresAt (vérifié à chaque résolution).
  async create(userId: string, documentId: string, dto: CreateShareDto) {
    await this.documents.assertOwnsDocument(userId, documentId);

    // Mineur en mode restreint : le partage d'un document du Digital Safe reste bloqué
    // tant que le consentement parental n'est pas confirmé — la constitution du Digital
    // Safe (upload) reste accessible, seul le partage est une action transactionnelle
    // conditionnée (CLAUDE.md §5).
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (owner.status === AccountStatus.AWAITING_PARENTAL_CONSENT) {
      throw new ForbiddenException(
        "Le partage de documents du Digital Safe est bloqué tant que le consentement parental n'est pas confirmé.",
      );
    }

    if (dto.targetType === ShareTargetType.USER) {
      if (!dto.sharedWithUserId) {
        throw new BadRequestException(
          'sharedWithUserId est requis pour un partage vers un utilisateur.',
        );
      }
      if (dto.sharedWithUserId === userId) {
        throw new BadRequestException(
          'Impossible de partager un document avec soi-même.',
        );
      }
      const target = await this.prisma.user.findUnique({
        where: { id: dto.sharedWithUserId },
      });
      if (!target)
        throw new NotFoundException('Utilisateur destinataire introuvable.');

      const share = await this.prisma.digitalSafeShare.create({
        data: {
          documentId,
          targetType: ShareTargetType.USER,
          sharedWithUserId: dto.sharedWithUserId,
          expiresAt: this.resolveExpiresAt(dto.expiresAt),
        },
      });
      await this.accessLog.record(
        documentId,
        DigitalSafeAccessAction.SHARE_CREATED,
        userId,
        share.id,
      );
      await this.audit.record('DIGITAL_SAFE_SHARE_CREATED', userId, {
        documentId,
        shareId: share.id,
        targetType: 'USER',
      });
      return {
        id: share.id,
        targetType: share.targetType,
        expiresAt: share.expiresAt,
      };
    }

    // targetType === LINK : le jeton brut n'est révélé qu'une fois, ici — seul son hash
    // est conservé (CLAUDE.md §2/§6).
    const rawToken = randomBytes(32).toString('hex');
    const share = await this.prisma.digitalSafeShare.create({
      data: {
        documentId,
        targetType: ShareTargetType.LINK,
        tokenHash: this.hashToken(rawToken),
        expiresAt: this.resolveExpiresAt(dto.expiresAt),
      },
    });
    await this.accessLog.record(
      documentId,
      DigitalSafeAccessAction.SHARE_CREATED,
      userId,
      share.id,
    );
    await this.audit.record('DIGITAL_SAFE_SHARE_CREATED', userId, {
      documentId,
      shareId: share.id,
      targetType: 'LINK',
    });
    return {
      id: share.id,
      targetType: share.targetType,
      expiresAt: share.expiresAt,
      token: rawToken,
    };
  }

  async list(userId: string, documentId: string) {
    await this.documents.assertOwnsDocument(userId, documentId);
    return this.prisma.digitalSafeShare.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        targetType: true,
        sharedWithUserId: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  // FR-M3-007 : révocation manuelle d'un partage en cours.
  async revoke(userId: string, documentId: string, shareId: string) {
    await this.documents.assertOwnsDocument(userId, documentId);
    const share = await this.prisma.digitalSafeShare.findUnique({
      where: { id: shareId },
    });
    if (!share || share.documentId !== documentId) {
      throw new NotFoundException('Partage introuvable pour ce document.');
    }
    if (share.revokedAt) {
      throw new BadRequestException('Ce partage est déjà révoqué.');
    }

    await this.prisma.digitalSafeShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });
    await this.accessLog.record(
      documentId,
      DigitalSafeAccessAction.SHARE_REVOKED,
      userId,
      shareId,
    );
    await this.audit.record('DIGITAL_SAFE_SHARE_REVOKED', userId, {
      documentId,
      shareId,
    });
  }

  // Résolution d'un jeton de lien de partage — utilisée par l'endpoint public de
  // téléchargement. Rejette explicitement un partage expiré ou révoqué (FR-M3-006/007).
  async resolveToken(rawToken: string) {
    const share = await this.prisma.digitalSafeShare.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!share || share.targetType !== ShareTargetType.LINK) {
      throw new NotFoundException('Lien de partage invalide.');
    }
    if (share.revokedAt) {
      throw new ForbiddenException('Ce lien de partage a été révoqué.');
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new ForbiddenException('Ce lien de partage a expiré.');
    }
    return share;
  }
}
