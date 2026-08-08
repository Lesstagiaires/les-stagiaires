import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  ApplicationStatus,
  NotificationType,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinorPolicyService } from '../auth/minor-policy.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms-provider.interface';

// ============================================================================
// RAPPEL DE DÉBUT DE STAGE
//
// Paliers arrêtés par le promoteur le 2026-08-01 : J-7, J-1, et le matin même.
// Ils sont CONFIGURABLES par INTERNSHIP_REMINDER_OFFSETS_DAYS — en ajouter un à
// J-30 ne demandera ni migration ni déploiement de code.
//
// DEUX DESTINATAIRES, DEUX CANAUX :
//   — le candidat reçoit la notification interne, l'e-mail, et un SMS (le type
//     figure sur la liste blanche : manquer son premier jour ne se rattrape pas) ;
//   — si le candidat est MINEUR, son représentant légal reçoit en plus un SMS
//     direct. Il n'a ni compte ni adresse électronique — la protection parentale
//     l'identifie par son seul numéro (CLAUDE.md §5). C'est le second des deux
//     seuls SMS que ce module envoie hors du canal de notification.
//
// L'idempotence n'est PAS gérée ici : elle est portée par la contrainte
// d'unicité (applicationId, offsetDays) en base. Un travail rejoué se heurte à
// la base, pas à une vérification que ce code pourrait rater.
// ============================================================================
const DEFAULT_OFFSETS = [7, 1, 0];

@Processor('internship-start-sweep')
export class InternshipStartSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(InternshipStartSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly minorPolicy: MinorPolicyService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const offsets = this.resolveOffsets();
    let sent = 0;

    for (const offsetDays of offsets) {
      const { from, to } = dayWindow(offsetDays);

      const due = await this.prisma.application.findMany({
        where: {
          // Seuls les stages réellement confirmés : une candidature acceptée mais
          // dont la convention n'est pas signée n'a pas de premier jour à rappeler.
          status: ApplicationStatus.ACCEPTED,
          internshipStartDate: { gte: from, lt: to },
          // Le rappel de ce palier n'a pas encore été envoyé.
          startReminders: { none: { offsetDays } },
        },
        select: {
          id: true,
          reference: true,
          candidateId: true,
          internshipStartDate: true,
          // Ce qu'il faut pour RECALCULER l'âge, et non le booléen gelé
          // `isMinor` : il est écrit à l'inscription et ne bouge plus.
          candidate: {
            select: {
              dateOfBirth: true,
              countryOfResidence: true,
              status: true,
            },
          },
        },
      });

      for (const application of due) {
        sent += await this.remind(application, offsetDays);
      }
    }

    if (sent > 0) {
      this.logger.log(`Rappels de début de stage envoyés : ${sent}.`);
    }
  }

  private async remind(
    application: {
      id: string;
      reference: string;
      candidateId: string;
      internshipStartDate: Date | null;
      candidate: {
        dateOfBirth: Date | null;
        countryOfResidence: string | null;
        status: AccountStatus;
      };
    },
    offsetDays: number,
  ): Promise<number> {
    // La trace est écrite AVANT l'envoi, et sa contrainte d'unicité fait office de
    // verrou : si deux instances balaient en même temps, la seconde échoue ici et
    // n'envoie rien. L'inverse — envoyer puis tracer — enverrait deux fois.
    try {
      await this.prisma.internshipStartReminder.create({
        data: { applicationId: application.id, offsetDays },
      });
    } catch {
      return 0;
    }

    await this.notifications.notifyUser(
      application.candidateId,
      NotificationType.APPLICATION_INTERNSHIP_STARTING_SOON,
      {
        applicationId: application.id,
        reference: application.reference,
        offsetDays,
        startDate: application.internshipStartDate?.toISOString(),
      },
    );

    // LE DÉFAUT CORRIGÉ ICI. Ce balayage lisait `isMinor`, jamais recalculé :
    // un majeur de vingt-cinq ans voyait donc un SMS partir vers le numéro
    // déclaré comme parental à ses seize ans. Ce n'est pas une gêne
    // fonctionnelle, c'est une information sur sa situation professionnelle
    // envoyée à un tiers sans titre pour la recevoir.
    if (await this.minorPolicy.requiresParentalConsent(application.candidate)) {
      await this.notifyLegalGuardian(application.id, application.reference);
    }
    return 1;
  }

  // SMS direct au représentant légal d'un mineur.
  //
  // Exception structurelle à la politique SMS, et la seule qui vaille : le parent
  // est identifié par son numéro de téléphone, sans compte ni adresse
  // électronique. Aucune notification interne ne peut l'atteindre. Le retirer
  // reviendrait à laisser un mineur partir en stage sans que son responsable en
  // ait jamais été prévenu.
  private async notifyLegalGuardian(
    applicationId: string,
    reference: string,
  ): Promise<void> {
    const link = await this.prisma.parentalLink.findFirst({
      where: {
        child: { applications: { some: { id: applicationId } } },
        // ACTIVE = consentement parental donné et toujours valide. PENDING
        // signifie que le parent n'a jamais répondu : lui écrire ici serait le
        // premier contact, ce qui n'est pas le rôle d'un rappel.
        status: ParentalLinkStatus.ACTIVE,
      },
      select: { parentPhone: true },
    });
    if (!link?.parentPhone) return;

    try {
      await this.sms.send(
        link.parentPhone,
        `LES STAGIAIRES : le stage de votre enfant (réf. ${reference}) commence bientôt. Les modalités sont disponibles dans l'application.`,
      );
      await this.prisma.internshipStartReminder.updateMany({
        where: { applicationId },
        data: { parentNotified: true },
      });
    } catch (error) {
      // Un SMS qui ne part pas ne doit pas faire échouer le balayage ni empêcher
      // les rappels suivants. `parentNotified` reste faux : l'écart est visible.
      this.logger.warn(
        `SMS au représentant légal impossible (${reference}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Paliers configurables. Une valeur illisible retombe sur le défaut plutôt que
  // de faire taire les rappels : mieux vaut prévenir trop tôt que pas du tout.
  private resolveOffsets(): number[] {
    const raw = this.config.get<string>('INTERNSHIP_REMINDER_OFFSETS_DAYS');
    if (!raw) return DEFAULT_OFFSETS;

    const parsed = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value >= 0);

    return parsed.length > 0 ? parsed : DEFAULT_OFFSETS;
  }
}

// Fenêtre d'un jour civil situé à `offsetDays` du jour courant.
//
// On compare des JOURS et non des instants : un stage qui commence le 8 doit être
// rappelé le 1er, quelle que soit l'heure à laquelle le balayage tourne. Comparer
// des horodatages ferait manquer la fenêtre d'une poignée d'heures.
function dayWindow(offsetDays: number): { from: Date; to: Date } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + offsetDays);

  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 1);

  return { from, to };
}
