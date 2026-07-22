import { Injectable, NotFoundException } from '@nestjs/common';
import { ProfileSection } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { VisibilityService } from './visibility.service';

// Assemblage structuré (JSON) — pas de génération PDF côté serveur pour le MVP,
// le rendu visuel est laissé au client (mobile/web), cohérent avec l'exigence de
// légèreté sur connexion lente (FR-PRO-007/008).
@Injectable()
export class CvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: VisibilityService,
  ) {}

  async getCvVivant(ownerUserId: string, viewerUserId: string | undefined) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: ownerUserId },
      include: {
        educations: true,
        experiences: true,
        languages: true,
        activeRole: true,
      },
    });
    if (!profile) throw new NotFoundException('Profil introuvable.');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
    });

    const [
      canSeeSummary,
      canSeeEducation,
      canSeeExperience,
      canSeeLanguages,
      canSeeRecommendations,
    ] = await Promise.all([
      this.visibility.canView(
        ownerUserId,
        ProfileSection.SUMMARY,
        viewerUserId,
      ),
      this.visibility.canView(
        ownerUserId,
        ProfileSection.EDUCATION,
        viewerUserId,
      ),
      this.visibility.canView(
        ownerUserId,
        ProfileSection.EXPERIENCE,
        viewerUserId,
      ),
      this.visibility.canView(
        ownerUserId,
        ProfileSection.LANGUAGES,
        viewerUserId,
      ),
      this.visibility.canView(
        ownerUserId,
        ProfileSection.RECOMMENDATIONS,
        viewerUserId,
      ),
    ]);

    const recommendations = canSeeRecommendations
      ? await this.prisma.recommendation.findMany({
          where: { receiverId: ownerUserId, visible: true },
          orderBy: { createdAt: 'desc' },
          select: { id: true, message: true, createdAt: true, giverId: true },
        })
      : [];

    return {
      lsId: user.lsId,
      activeRole: profile.activeRole?.name ?? null,
      headline: canSeeSummary ? profile.headline : null,
      summary: canSeeSummary ? profile.summary : null,
      education: canSeeEducation ? profile.educations : [],
      experience: canSeeExperience ? profile.experiences : [],
      languages: canSeeLanguages ? profile.languages : [],
      recommendations,
    };
  }

  async getCarteProfessionnelle(
    ownerUserId: string,
    viewerUserId: string | undefined,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: ownerUserId },
      include: { activeRole: true },
    });
    if (!profile) throw new NotFoundException('Profil introuvable.');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
    });
    const canSeeSummary = await this.visibility.canView(
      ownerUserId,
      ProfileSection.SUMMARY,
      viewerUserId,
    );

    return {
      lsId: user.lsId,
      activeRole: profile.activeRole?.name ?? null,
      headline: canSeeSummary ? profile.headline : null,
    };
  }
}
