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
import { MinorPolicyService } from '../auth/minor-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShareSectionDto } from './dto/share-section.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';

@Injectable()
export class VisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly minorPolicy: MinorPolicyService,
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
    //
    // L'ÂGE EST RECALCULÉ, jamais lu dans `User.isMinor`. Ce champ est écrit à
    // l'inscription et ne bouge plus : un jeune inscrit à 17 ans n'aurait
    // JAMAIS pu rendre une rubrique publique, même à trente ans — et sans
    // jamais comprendre pourquoi, puisque le message parle d'un « compte
    // mineur » qu'il n'est plus.
    //
    // L'erreur allait dans le sens protecteur, contrairement au balayage de
    // début de stage qui écrivait au parent d'un adulte. Elle n'en était pas
    // moins une restriction définitive imposée à un majeur sur son propre
    // profil.
    const encoreMineur = await this.minorPolicy.requiresParentalConsent(user);
    if (encoreMineur && dto.visibility === SectionVisibility.PUBLIC) {
      throw new ForbiddenException(
        'Un compte mineur ne peut pas rendre une rubrique publique — visibilité maximale : réseau.',
      );
    }

    // ========================================================================
    // LES DOCUMENTS NE PEUVENT JAMAIS ÊTRE PUBLICS — défaut S-02
    //
    // Corrigé le 2026-08-10. Cette restriction ne visait que les mineurs : un
    // majeur pouvait basculer sa rubrique DOCUMENTS en PUBLIC, et ses fichiers
    // devenaient alors téléchargeables DÉCHIFFRÉS par un anonyme connaissant
    // un identifiant de document.
    //
    // UN INTERRUPTEUR NE DÉCLASSE PAS UNE DONNÉE. CLAUDE.md §1 range diplômes
    // et attestations en CONFIDENTIEL — « titulaire et destinataires
    // autorisés ». Aucune case à cocher ne devrait pouvoir en faire du Public,
    // et surtout pas une case dont l'utilisateur ne mesure pas la portée : sur
    // les autres rubriques, « public » expose un texte ; sur celle-ci, il
    // expose des fichiers.
    //
    // LE BESOIN LÉGITIME RESTE COUVERT. `SHARED` partage nominativement,
    // `NETWORK` ouvre aux comptes identifiés. Ce qui disparaît, c'est
    // l'anonymat — et lui seul.
    //
    // La règle vaut pour TOUS, mineurs comme majeurs, et ne dépend d'aucun âge
    // recalculé : c'est la nature de la donnée qui la fixe, pas celle de son
    // titulaire.
    // ========================================================================
    if (
      section === ProfileSection.DOCUMENTS &&
      dto.visibility === SectionVisibility.PUBLIC
    ) {
      throw new ForbiddenException(
        'Les documents ne peuvent pas être rendus publics — visibilité maximale : réseau. ' +
          'Pour les transmettre à une personne précise, utilisez le partage.',
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
