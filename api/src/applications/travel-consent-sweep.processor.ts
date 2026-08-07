import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  NotificationType,
  TravelConsentStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

// Signalement d'un accord parental de déplacement resté sans réponse au-delà du délai
// (par défaut 7 jours, TRAVEL_CONSENT_TTL_DAYS aligné sur consentExpiresAt). Ne clôture
// jamais automatiquement la candidature — candidat et organisation restent libres de la
// retirer ou de la rejeter via les actions existantes.
@Processor('travel-consent-sweep')
export class TravelConsentSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(TravelConsentSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const overdue = await this.prisma.travelConsent.findMany({
      where: {
        status: TravelConsentStatus.PENDING,
        consentExpiresAt: { lte: new Date() },
        flaggedAt: null,
      },
      include: {
        application: {
          select: { id: true, reference: true, candidateId: true },
        },
      },
    });

    for (const consent of overdue) {
      await this.prisma.travelConsent.update({
        where: { id: consent.id },
        data: { status: TravelConsentStatus.EXPIRED, flaggedAt: new Date() },
      });
      await this.audit.record(
        'APPLICATION_TRAVEL_CONSENT_OVERDUE_FLAGGED',
        consent.application.candidateId,
        { applicationId: consent.applicationId },
      );

      // Le CANDIDAT est prévenu par notification interne : il possède un compte.
      // Le parent, lui, a déjà reçu son SMS porteur du code au moment de la demande —
      // c'était là le canal irremplaçable, pas ici.
      await this.notifications.notifyUser(
        consent.application.candidateId,
        NotificationType.APPLICATION_TRAVEL_CONSENT_EXPIRED,
        {
          applicationId: consent.applicationId,
          reference: consent.application.reference,
        },
      );
    }

    if (overdue.length > 0) {
      this.logger.warn(
        `${overdue.length} accord(s) parental(aux) de déplacement signalé(s) après expiration.`,
      );
    }
  }
}
