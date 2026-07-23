import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export type OrganizationAccess = 'OWNER' | OrganizationMemberRole;

// FR-ORG-002 : point unique d'autorisation pour toute action au nom d'une organisation —
// remplace les vérifications ad hoc `organization.ownerId === userId` disséminées dans
// Opportunités et Candidatures (CLAUDE.md §3 : modéliser les permissions dans le schéma,
// pas contrôleur par contrôleur). Le propriétaire garde des droits pleins et permanents,
// jamais représenté comme une ligne OrganizationMember révocable.
@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccess(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationAccess | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });
    if (!organization) return null;
    if (organization.ownerId === userId) return 'OWNER';

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (member?.status === OrganizationMemberStatus.ACTIVE) return member.role;
    return null;
  }

  // Gestion courante (offres, candidatures) — VIEWER exclu (lecture seule).
  async assertCanManage(organizationId: string, userId: string): Promise<void> {
    const access = await this.getAccess(organizationId, userId);
    if (!access || access === OrganizationMemberRole.VIEWER) {
      throw new ForbiddenException(
        'Cette organisation ne concerne pas ce compte.',
      );
    }
  }

  // Équipe — réservée au propriétaire et aux administrateurs.
  async assertCanManageTeam(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const access = await this.getAccess(organizationId, userId);
    if (access !== 'OWNER' && access !== OrganizationMemberRole.ADMIN) {
      throw new ForbiddenException(
        "Seuls le propriétaire et les administrateurs gèrent l'équipe de cette organisation.",
      );
    }
  }

  // Signature de convention — n'engage jamais un simple RECRUITER (CLAUDE.md §3).
  async assertCanSign(organizationId: string, userId: string): Promise<void> {
    const access = await this.getAccess(organizationId, userId);
    if (access !== 'OWNER' && access !== OrganizationMemberRole.ADMIN) {
      throw new ForbiddenException(
        'Seuls le propriétaire et les administrateurs peuvent signer une convention au nom de cette organisation.',
      );
    }
  }

  async isParticipant(
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    return (await this.getAccess(organizationId, userId)) !== null;
  }
}
