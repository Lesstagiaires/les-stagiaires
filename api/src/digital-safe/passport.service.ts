import { Injectable } from '@nestjs/common';
import { ProfileSection } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CvService } from '../profiles/cv.service';
import { VisibilityService } from '../profiles/visibility.service';

// FR-M3-002 : compilation automatique des rubriques autorisées du profil — réutilise la
// résolution de visibilité déjà construite pour le CV Vivant (module 2) plutôt que de la
// dupliquer, et y ajoute un résumé du Digital Safe.
@Injectable()
export class PassportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cv: CvService,
    private readonly visibility: VisibilityService,
  ) {}

  async getPassport(ownerUserId: string, viewerUserId: string | undefined) {
    const cvData = await this.cv.getCvVivant(ownerUserId, viewerUserId);

    // ========================================================================
    // LE COMPTE DE DOCUMENTS EST UNE DONNÉE DU COFFRE-FORT — défaut S-01
    //
    // Corrigé le 2026-08-12. Ce compte sortait sans condition. Le commentaire
    // d'origine disait vrai — « jamais le contenu ni la liste » — mais un
    // NOMBRE parle quand même : il dit qu'une personne dépose des documents, et
    // combien. Sur un profil fermé, et a fortiori sur celui d'un mineur, c'est
    // un signal de comportement offert à un anonyme.
    //
    // Il est désormais soumis à la rubrique DOCUMENTS, celle-là même qui régit
    // les fichiers qu'il dénombre. Depuis S-02 cette rubrique ne peut plus être
    // PUBLIC : le compte ne sortira donc jamais à un visiteur anonyme, quelle
    // que soit la configuration du titulaire. Les deux corrections se tiennent.
    //
    // `null` et non `0` : zéro serait une réponse, et une réponse fausse. On ne
    // dit pas « aucun document », on ne dit rien.
    // ========================================================================
    const peutVoirLesDocuments = await this.visibility.canView(
      ownerUserId,
      ProfileSection.DOCUMENTS,
      viewerUserId,
    );

    const documentsInDigitalSafe = peutVoirLesDocuments
      ? await this.prisma.digitalSafeDocument.count({
          where: { userId: ownerUserId, deletedAt: null },
        })
      : null;

    return { ...cvData, documentsInDigitalSafe };
  }
}
