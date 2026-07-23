import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  ApplicationStatus,
  ShareTargetType,
} from '../../generated/prisma/enums';
import { SharesService } from '../digital-safe/shares.service';
import { PrismaService } from '../prisma/prisma.service';

const TERMINAL_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.COMPLETED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
];

// Le partage Digital Safe standard expire au bout de 30 jours (pensé pour un partage
// volontaire ponctuel, cf. SharesService) — pour qu'une organisation garde accès à la
// lettre d'admission / convention / attestation pendant toute la durée d'une candidature
// active, ce sweep renouvelle tout partage sur le point d'expirer plutôt que de laisser
// l'accès se couper au milieu d'un stage en cours.
@Processor('application-share-renewal-sweep')
export class ApplicationShareRenewalProcessor extends WorkerHost {
  private readonly logger = new Logger(ApplicationShareRenewalProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shares: SharesService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const renewWithinDays = 3;
    const renewThreshold = new Date(
      Date.now() + renewWithinDays * 24 * 60 * 60 * 1000,
    );

    const activeApplications = await this.prisma.application.findMany({
      where: { status: { notIn: TERMINAL_STATUSES } },
      select: {
        id: true,
        candidateId: true,
        organization: { select: { ownerId: true } },
        artifacts: { select: { digitalSafeDocumentId: true } },
      },
    });

    let renewed = 0;
    for (const application of activeApplications) {
      for (const artifact of application.artifacts) {
        const activeShare = await this.prisma.digitalSafeShare.findFirst({
          where: {
            documentId: artifact.digitalSafeDocumentId,
            targetType: ShareTargetType.USER,
            sharedWithUserId: application.organization.ownerId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: renewThreshold } }],
          },
        });
        if (activeShare) continue;

        try {
          await this.shares.create(
            application.candidateId,
            artifact.digitalSafeDocumentId,
            {
              targetType: ShareTargetType.USER,
              sharedWithUserId: application.organization.ownerId,
            },
          );
          renewed++;
        } catch (error) {
          // Un échec isolé (ex. document supprimé entretemps) ne doit pas interrompre
          // le renouvellement des autres candidatures actives de ce passage.
          this.logger.warn(
            `Échec du renouvellement pour l'artefact ${artifact.digitalSafeDocumentId} (candidature ${application.id}) : ${error instanceof Error ? error.message : 'erreur inconnue'}`,
          );
        }
      }
    }

    if (renewed > 0) {
      this.logger.log(
        `${renewed} partage(s) de document de candidature renouvelé(s).`,
      );
    }
  }
}
