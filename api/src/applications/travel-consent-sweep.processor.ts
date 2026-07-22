import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { TravelConsentStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';

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
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
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

      const candidate = await this.prisma.user.findUnique({
        where: { id: consent.application.candidateId },
      });
      if (candidate?.phone) {
        await this.sms.send(
          candidate.phone,
          `LES STAGIAIRES — votre candidature ${consent.application.reference} reste bloquée : l'accord de vos parents pour le déplacement n'a pas été confirmé à temps. Vous pouvez retirer la candidature ou redemander le consentement.`,
        );
      }
    }

    if (overdue.length > 0) {
      this.logger.warn(
        `${overdue.length} accord(s) parental(aux) de déplacement signalé(s) après expiration.`,
      );
    }
  }
}
