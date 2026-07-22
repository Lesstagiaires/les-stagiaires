import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProfileSection,
  SectionVisibility,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShareSectionDto } from './dto/share-section.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';

@Injectable()
export class VisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async setVisibility(
    userId: string,
    section: ProfileSection,
    dto: SetVisibilityDto,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    // Visibilité publique limitée automatiquement pour les mineurs, sans possibilité de
    // contournement par l'utilisateur lui-même (CLAUDE.md §5).
    if (user.isMinor && dto.visibility === SectionVisibility.PUBLIC) {
      throw new ForbiddenException(
        'Un compte mineur ne peut pas rendre une rubrique publique — visibilité maximale : réseau.',
      );
    }

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const updated = await this.prisma.profileSectionVisibility.upsert({
      where: { profileId_section: { profileId: profile.id, section } },
      update: { visibility: dto.visibility },
      create: { profileId: profile.id, section, visibility: dto.visibility },
    });

    await this.audit.record('PROFILE_VISIBILITY_CHANGED', userId, {
      section,
      visibility: dto.visibility,
    });
    return updated;
  }

  async listVisibility(userId: string) {
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return this.prisma.profileSectionVisibility.findMany({
      where: { profileId: profile.id },
    });
  }

  async shareSection(
    userId: string,
    section: ProfileSection,
    dto: ShareSectionDto,
  ) {
    if (dto.userId === userId) {
      throw new ForbiddenException(
        'Impossible de partager une rubrique avec soi-même.',
      );
    }
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser)
      throw new NotFoundException('Utilisateur destinataire introuvable.');

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const share = await this.prisma.profileShare.upsert({
      where: {
        profileId_section_sharedWithUserId: {
          profileId: profile.id,
          section,
          sharedWithUserId: dto.userId,
        },
      },
      update: {},
      create: { profileId: profile.id, section, sharedWithUserId: dto.userId },
    });

    await this.audit.record('PROFILE_SECTION_SHARED', userId, {
      section,
      sharedWithUserId: dto.userId,
    });
    return share;
  }

  async unshareSection(
    userId: string,
    section: ProfileSection,
    targetUserId: string,
  ) {
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    await this.prisma.profileShare.deleteMany({
      where: { profileId: profile.id, section, sharedWithUserId: targetUserId },
    });
    await this.audit.record('PROFILE_SECTION_UNSHARED', userId, {
      section,
      sharedWithUserId: targetUserId,
    });
  }

  // Résolution centrale de la visibilité — utilisée par la vue de profil public et
  // l'assemblage du CV Vivant. Fail-closed : toute rubrique sans règle explicite reste
  // privée (CLAUDE.md §1).
  async canView(
    ownerUserId: string,
    section: ProfileSection,
    viewerUserId: string | undefined,
  ): Promise<boolean> {
    if (viewerUserId === ownerUserId) return true;

    const profile = await this.prisma.profile.findUnique({
      where: { userId: ownerUserId },
    });
    if (!profile) return false;

    const rule = await this.prisma.profileSectionVisibility.findUnique({
      where: { profileId_section: { profileId: profile.id, section } },
    });
    const visibility = rule?.visibility ?? SectionVisibility.PRIVATE;

    switch (visibility) {
      case SectionVisibility.PUBLIC:
        return true;
      case SectionVisibility.NETWORK:
        return !!viewerUserId;
      case SectionVisibility.SHARED:
        if (!viewerUserId) return false;
        return !!(await this.prisma.profileShare.findUnique({
          where: {
            profileId_section_sharedWithUserId: {
              profileId: profile.id,
              section,
              sharedWithUserId: viewerUserId,
            },
          },
        }));
      case SectionVisibility.PRIVATE:
      default:
        return false;
    }
  }
}
