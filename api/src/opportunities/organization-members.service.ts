import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationMemberStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { InviteMemberDto } from './dto/invite-member.dto';
import { OrganizationAccessService } from './organization-access.service';

// FR-ORG-002 : équipe et permissions. Un collaborateur invité doit déjà détenir un
// compte LES STAGIAIRES — pas de cérémonie de code par SMS comme pour le consentement
// parental, les deux parties sont déjà authentifiées sur la plateforme.
@Injectable()
export class OrganizationMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async invite(
    inviterId: string,
    organizationId: string,
    dto: InviteMemberDto,
  ) {
    await this.access.assertCanManageTeam(organizationId, inviterId);

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const invitee = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!invitee) {
      throw new NotFoundException(
        "Aucun compte LES STAGIAIRES n'est associé à ce numéro.",
      );
    }
    if (invitee.id === organization.ownerId) {
      throw new BadRequestException(
        'Le propriétaire fait déjà partie de cette organisation.',
      );
    }

    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: invitee.id },
      },
    });
    if (existing?.status === OrganizationMemberStatus.ACTIVE) {
      throw new ConflictException("Ce compte fait déjà partie de l'équipe.");
    }
    if (existing?.status === OrganizationMemberStatus.PENDING) {
      throw new ConflictException(
        'Une invitation est déjà en attente pour ce compte.',
      );
    }

    const member = existing
      ? await this.prisma.organizationMember.update({
          where: { id: existing.id },
          data: {
            role: dto.role,
            status: OrganizationMemberStatus.PENDING,
            invitedAt: new Date(),
            joinedAt: null,
            revokedAt: null,
          },
        })
      : await this.prisma.organizationMember.create({
          data: {
            organizationId,
            userId: invitee.id,
            role: dto.role,
          },
        });

    await this.notify(
      invitee.id,
      `LES STAGIAIRES — vous êtes invité(e) à rejoindre l'organisation ${organization.name} (rôle : ${dto.role}). Connectez-vous pour accepter ou refuser.`,
    );
    await this.audit.record('ORGANIZATION_MEMBER_INVITED', inviterId, {
      organizationId,
      memberId: member.id,
      role: dto.role,
    });
    return member;
  }

  async listTeam(userId: string, organizationId: string) {
    const isParticipant = await this.access.isParticipant(
      organizationId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException(
        'Cette organisation ne concerne pas ce compte.',
      );
    }
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { invitedAt: 'desc' },
      include: { user: { select: { id: true, lsId: true } } },
    });
  }

  async listMyInvitations(userId: string) {
    return this.prisma.organizationMember.findMany({
      where: { userId, status: OrganizationMemberStatus.PENDING },
      orderBy: { invitedAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true, orgId: true } },
      },
    });
  }

  async accept(userId: string, memberId: string) {
    const member = await this.assertOwnMembership(userId, memberId);
    if (member.status !== OrganizationMemberStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus en attente.");
    }
    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { status: OrganizationMemberStatus.ACTIVE, joinedAt: new Date() },
    });
    await this.audit.record('ORGANIZATION_MEMBER_JOINED', userId, {
      organizationId: member.organizationId,
      memberId,
    });
    return updated;
  }

  async decline(userId: string, memberId: string) {
    const member = await this.assertOwnMembership(userId, memberId);
    if (member.status !== OrganizationMemberStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus en attente.");
    }
    await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { status: OrganizationMemberStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.record('ORGANIZATION_MEMBER_DECLINED', userId, {
      organizationId: member.organizationId,
      memberId,
    });
  }

  async revoke(actorId: string, organizationId: string, memberId: string) {
    await this.access.assertCanManageTeam(organizationId, actorId);
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.organizationId !== organizationId) {
      throw new NotFoundException(
        'Membre introuvable pour cette organisation.',
      );
    }
    if (member.status === OrganizationMemberStatus.REVOKED) {
      throw new BadRequestException('Ce membre est déjà révoqué.');
    }
    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { status: OrganizationMemberStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.record('ORGANIZATION_MEMBER_REVOKED', actorId, {
      organizationId,
      memberId,
    });
    await this.notify(
      member.userId,
      "LES STAGIAIRES — votre accès à l'organisation a été révoqué.",
    );
    return updated;
  }

  private async assertOwnMembership(userId: string, memberId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.userId !== userId) {
      throw new NotFoundException('Invitation introuvable pour ce compte.');
    }
    return member;
  }

  private async notify(userId: string, message: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone) return;
    await this.sms.send(user.phone, message);
  }
}
