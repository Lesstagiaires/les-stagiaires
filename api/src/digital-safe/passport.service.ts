import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CvService } from '../profiles/cv.service';

// FR-M3-002 : compilation automatique des rubriques autorisées du profil — réutilise la
// résolution de visibilité déjà construite pour le CV Vivant (module 2) plutôt que de la
// dupliquer, et y ajoute la mise en avant du LS-ID et un résumé du Digital Safe.
@Injectable()
export class PassportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cv: CvService,
  ) {}

  async getPassport(ownerUserId: string, viewerUserId: string | undefined) {
    const cvData = await this.cv.getCvVivant(ownerUserId, viewerUserId);

    // Un simple compte, jamais le contenu ni la liste des documents — le Passeport
    // affiche que le titulaire a un Digital Safe actif, pas ce qu'il contient.
    const documentsInDigitalSafe = await this.prisma.digitalSafeDocument.count({
      where: { userId: ownerUserId, deletedAt: null },
    });

    return { ...cvData, documentsInDigitalSafe };
  }
}
