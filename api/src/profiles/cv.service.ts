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

    // ========================================================================
    // AUCUN CHAMP NE SORT HORS DU MOTEUR DE VISIBILITÉ — défaut S-01
    //
    // Corrigé le 2026-08-12. `lsId` et `activeRole` étaient écrits ICI, avant
    // toute condition : un anonyme muni d'un identifiant technique obtenait le
    // LS-ID d'un profil ENTIÈREMENT PRIVÉ, mineur compris. Les cinq autres
    // champs, eux, passaient bien la barrière — le moteur n'avait pas échoué,
    // on ne l'avait simplement pas consulté pour ces deux-là.
    //
    // POURQUOI LE LS-ID N'EST PAS UN DÉTAIL. Il n'ouvre aucune porte : on ne
    // s'authentifie pas avec, on ne cherche pas avec. Mais c'est l'identité
    // pseudonyme DURABLE de la personne sur la plateforme — celle qu'affichent
    // la modération, le recrutement, les partenariats et le journal du
    // Coffre-fort pour désigner quelqu'un. Le rendre à un anonyme sur un profil
    // fermé, c'est offrir la clé de rapprochement entre deux fuites.
    //
    // CLAUDE.md §5 exige une confidentialité renforcée par défaut pour les
    // mineurs, SANS ACTION DE LEUR PART. `setVisibility` empêche bien un mineur
    // de rendre une rubrique publique — mais cette protection ne servait à rien
    // ici, puisque le champ ne passait pas par là.
    //
    // LE VRAI RISQUE N'EST PAS CES DEUX CHAMPS, C'EST LE TROISIÈME : celui
    // qu'on ajoutera dans six mois en oubliant la barrière. C'est pourquoi
    // `identite-publique.integration.spec.ts` parcourt TOUTES les clés de cette
    // réponse et exige qu'elles soient nulles ou vides pour un anonyme. Un
    // champ ajouté hors rubrique fait échouer la suite le jour même.
    // ========================================================================
    return {
      lsId: canSeeSummary ? user.lsId : null,
      activeRole: canSeeSummary ? (profile.activeRole?.name ?? null) : null,
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

    // La Carte Professionnelle est un CV Vivant réduit à trois champs. La règle
    // y est la même, et pour la même raison — défaut S-01, corrigé le
    // 2026-08-12. Deux méthodes, une seule règle : c'est la rubrique SUMMARY
    // qui décide de l'identité, ici comme là-haut.
    return {
      lsId: canSeeSummary ? user.lsId : null,
      activeRole: canSeeSummary ? (profile.activeRole?.name ?? null) : null,
      headline: canSeeSummary ? profile.headline : null,
    };
  }
}
