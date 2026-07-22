import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class ParentalConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  // Le parent/tuteur n'a pas besoin d'un compte existant : le téléphone déclaré par le
  // mineur est la seule source de vérité de la demande (CLAUDE.md §5).
  async requestConsent(childId: string, parentPhone: string) {
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: childId },
    });
    if (!child.isMinor) {
      throw new BadRequestException(
        'Le consentement parental ne concerne que les comptes mineurs.',
      );
    }

    const ttlHours = Number(
      this.config.get<string>('PARENTAL_CONSENT_TTL_HOURS', '72'),
    );
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const consentExpiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const existing = await this.prisma.parentalLink.findUnique({
      where: { childId_parentPhone: { childId, parentPhone } },
    });

    if (existing?.status === ParentalLinkStatus.ACTIVE) {
      throw new ConflictException(
        'Ce parent/tuteur a déjà confirmé le rattachement.',
      );
    }

    const link = existing
      ? await this.prisma.parentalLink.update({
          where: { id: existing.id },
          data: {
            status: ParentalLinkStatus.PENDING,
            consentCodeHash: this.hashCode(code),
            consentExpiresAt,
            consentAttempts: 0,
            flaggedAt: null,
          },
        })
      : await this.prisma.parentalLink.create({
          data: {
            childId,
            parentPhone,
            consentCodeHash: this.hashCode(code),
            consentExpiresAt,
          },
        });

    await this.sms.send(
      parentPhone,
      `LES STAGIAIRES : votre enfant (${child.phone}) a créé un profil sur notre plateforme de stages et vous a désigné comme parent/tuteur. Pour donner votre consentement actif, communiquez-lui ce code : ${code}. Sans réponse, son compte reste en mode restreint (candidature, convention et partage de documents bloqués).`,
    );

    await this.audit.record('PARENTAL_CONSENT_REQUESTED', childId, {
      linkId: link.id,
    });
    return { linkId: link.id, status: link.status };
  }

  async confirmConsent(linkId: string, code: string) {
    const link = await this.prisma.parentalLink.findUnique({
      where: { id: linkId },
    });
    if (!link)
      throw new NotFoundException('Demande de consentement introuvable.');
    if (link.status === ParentalLinkStatus.ACTIVE) {
      throw new BadRequestException('Ce consentement a déjà été confirmé.');
    }
    if (
      !link.consentCodeHash ||
      !link.consentExpiresAt ||
      link.consentExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }
    if (link.consentAttempts >= link.maxConsentAttempts) {
      throw new UnauthorizedException('Nombre maximal de tentatives atteint.');
    }

    if (link.consentCodeHash !== this.hashCode(code)) {
      await this.prisma.parentalLink.update({
        where: { id: link.id },
        data: { consentAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    // Rattachement au compte du parent seulement s'il en a déjà un — jamais requis
    // pour que le consentement soit valide (CLAUDE.md §5 : limite assumée du MVP).
    const matchingParent = await this.prisma.user.findUnique({
      where: { phone: link.parentPhone },
    });

    await this.prisma.parentalLink.update({
      where: { id: link.id },
      data: {
        status: ParentalLinkStatus.ACTIVE,
        confirmedAt: new Date(),
        parentId: matchingParent?.id,
        consentCodeHash: null,
      },
    });

    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: link.childId },
    });
    if (child.status === AccountStatus.AWAITING_PARENTAL_CONSENT) {
      await this.prisma.user.update({
        where: { id: child.id },
        data: { status: AccountStatus.ACTIVE },
      });
    }

    await this.audit.record('PARENTAL_CONSENT_CONFIRMED', link.childId, {
      linkId: link.id,
    });
    return { message: 'Consentement confirmé.' };
  }

  async listForChild(childId: string) {
    // Ne jamais exposer consentCodeHash — c'est un secret de vérification, pas une
    // donnée consultable, même par le titulaire du compte (CLAUDE.md §6).
    return this.prisma.parentalLink.findMany({
      where: { childId },
      select: {
        id: true,
        childId: true,
        parentPhone: true,
        parentId: true,
        status: true,
        consentAttempts: true,
        maxConsentAttempts: true,
        flaggedAt: true,
        createdAt: true,
        confirmedAt: true,
      },
    });
  }
}
