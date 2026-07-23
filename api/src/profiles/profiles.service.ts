import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SwitchActiveRoleDto } from './dto/switch-active-role.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpsertEducationDto } from './dto/upsert-education.dto';
import { UpsertExperienceDto } from './dto/upsert-experience.dto';
import { UpsertLanguageDto } from './dto/upsert-language.dto';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Un profil est créé au premier accès — pas de cérémonie de création séparée
  // (FR-PRO-001 : "créer et mettre à jour les rubriques du profil").
  async getOrCreateOwnProfile(userId: string) {
    return this.prisma.profile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        educations: true,
        experiences: true,
        languages: true,
        activeRole: true,
      },
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.getOrCreateOwnProfile(userId);
    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        fullName: dto.fullName,
        headline: dto.headline,
        summary: dto.summary,
      },
    });
    await this.audit.record('PROFILE_UPDATED', userId, {
      fields: Object.keys(dto),
    });
    return updated;
  }

  // --- FR-PRO-002 : casquette active ------------------------------------------------------

  async switchActiveRole(userId: string, dto: SwitchActiveRoleDto) {
    const held = await this.prisma.userRole.findFirst({
      where: { userId, roleId: dto.roleId, isActive: true },
    });
    if (!held) {
      throw new ForbiddenException(
        "Ce rôle n'est pas actuellement détenu par ce compte.",
      );
    }

    const profile = await this.getOrCreateOwnProfile(userId);
    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: { activeRoleId: dto.roleId },
      include: { activeRole: true },
    });
    await this.audit.record('PROFILE_ACTIVE_ROLE_SWITCHED', userId, {
      roleId: dto.roleId,
    });
    return updated;
  }

  // --- FR-PRO-001 : formation et expérience -----------------------------------------------

  async addEducation(userId: string, dto: UpsertEducationDto) {
    const profile = await this.getOrCreateOwnProfile(userId);
    return this.prisma.education.create({
      data: {
        profileId: profile.id,
        institution: dto.institution,
        degree: dto.degree,
        fieldOfStudy: dto.fieldOfStudy,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
      },
    });
  }

  async updateEducation(
    userId: string,
    educationId: string,
    dto: UpsertEducationDto,
  ) {
    await this.assertOwnsEducation(userId, educationId);
    return this.prisma.education.update({
      where: { id: educationId },
      data: {
        institution: dto.institution,
        degree: dto.degree,
        fieldOfStudy: dto.fieldOfStudy,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
      },
    });
  }

  async removeEducation(userId: string, educationId: string) {
    await this.assertOwnsEducation(userId, educationId);
    await this.prisma.education.delete({ where: { id: educationId } });
  }

  private async assertOwnsEducation(
    userId: string,
    educationId: string,
  ): Promise<void> {
    const education = await this.prisma.education.findUnique({
      where: { id: educationId },
      include: { profile: true },
    });
    if (!education || education.profile.userId !== userId) {
      throw new NotFoundException('Formation introuvable pour ce profil.');
    }
  }

  async addExperience(userId: string, dto: UpsertExperienceDto) {
    const profile = await this.getOrCreateOwnProfile(userId);
    return this.prisma.experience.create({
      data: {
        profileId: profile.id,
        organization: dto.organization,
        title: dto.title,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
      },
    });
  }

  async updateExperience(
    userId: string,
    experienceId: string,
    dto: UpsertExperienceDto,
  ) {
    await this.assertOwnsExperience(userId, experienceId);
    return this.prisma.experience.update({
      where: { id: experienceId },
      data: {
        organization: dto.organization,
        title: dto.title,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        description: dto.description,
      },
    });
  }

  async removeExperience(userId: string, experienceId: string) {
    await this.assertOwnsExperience(userId, experienceId);
    await this.prisma.experience.delete({ where: { id: experienceId } });
  }

  private async assertOwnsExperience(
    userId: string,
    experienceId: string,
  ): Promise<void> {
    const experience = await this.prisma.experience.findUnique({
      where: { id: experienceId },
      include: { profile: true },
    });
    if (!experience || experience.profile.userId !== userId) {
      throw new NotFoundException('Expérience introuvable pour ce profil.');
    }
  }

  // --- FR-PRO-006 : langues ----------------------------------------------------------------

  async upsertLanguage(userId: string, dto: UpsertLanguageDto) {
    const profile = await this.getOrCreateOwnProfile(userId);
    return this.prisma.profileLanguage.upsert({
      where: {
        profileId_language: { profileId: profile.id, language: dto.language },
      },
      update: { level: dto.level },
      create: {
        profileId: profile.id,
        language: dto.language,
        level: dto.level,
      },
    });
  }

  async removeLanguage(userId: string, language: string) {
    const profile = await this.getOrCreateOwnProfile(userId);
    const existing = await this.prisma.profileLanguage.findUnique({
      where: { profileId_language: { profileId: profile.id, language } },
    });
    if (!existing) {
      throw new NotFoundException('Langue introuvable pour ce profil.');
    }
    await this.prisma.profileLanguage.delete({ where: { id: existing.id } });
  }

  async getProfileIdForUser(userId: string): Promise<string> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil introuvable.');
    return profile.id;
  }
}
