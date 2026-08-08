import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinorPolicyService } from './minor-policy.service';

// Signalement puis suspension automatique d'un compte mineur resté plus de 30 jours sans
// validation parentale (CLAUDE.md §5, FR-AUTH-004c).
@Processor('parental-consent-sweep')
export class ParentalConsentSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ParentalConsentSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly minorPolicy: MinorPolicyService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const flagAfterDays = Number(
      this.config.get<string>('PARENTAL_CONSENT_FLAG_AFTER_DAYS', '30'),
    );
    const cutoff = new Date(Date.now() - flagAfterDays * 24 * 60 * 60 * 1000);

    const overdueLinks = await this.prisma.parentalLink.findMany({
      where: {
        status: ParentalLinkStatus.PENDING,
        createdAt: { lte: cutoff },
        flaggedAt: null,
      },
    });

    let devenusMajeurs = 0;

    for (const link of overdueLinks) {
      // ======================================================================
      // L'ÂGE SE RECALCULE AVANT DE SUSPENDRE
      //
      // Le défaut corrigé ici : ce balayage ne sélectionnait que sur la DATE du
      // lien. Un jeune inscrit à 17 ans, majeur au cinquième jour, dont le
      // parent n'a jamais répondu, se faisait désactiver au trentième — alors
      // qu'il n'avait plus besoin d'aucun consentement.
      //
      // Le reste du système gérait pourtant bien le passage à la majorité :
      // `isActionGated()` recalcule l'âge à chaque appel, donc ses actions se
      // débloquaient. Il pouvait candidater le lundi et se retrouver désactivé
      // le mardi — par un travail de fond, sans que rien ne l'en avertisse.
      //
      // Le lien devient caduc, le COMPTE reste intact. Une obligation qui
      // s'éteint ne laisse pas de sanction derrière elle.
      // ======================================================================
      const child = await this.prisma.user.findUnique({
        where: { id: link.childId },
        select: {
          id: true,
          status: true,
          dateOfBirth: true,
          countryOfResidence: true,
        },
      });

      const encoreMineur = child
        ? await this.stillRequiresParentalConsent(child)
        : // Enfant introuvable : on clôt le lien sans toucher à un compte qui
          // n'existe plus.
          false;

      if (!encoreMineur) {
        await this.prisma.parentalLink.update({
          where: { id: link.id },
          data: {
            status: ParentalLinkStatus.EXPIRED,
            flaggedAt: new Date(),
          },
        });
        if (child) {
          await this.audit.record(
            'PARENTAL_CONSENT_OBSOLETE_MAJORITY_REACHED',
            child.id,
            { linkId: link.id },
          );
          devenusMajeurs++;
        }
        continue;
      }

      await this.prisma.parentalLink.update({
        where: { id: link.id },
        data: { status: ParentalLinkStatus.EXPIRED, flaggedAt: new Date() },
      });
      await this.audit.record(
        'PARENTAL_CONSENT_OVERDUE_FLAGGED',
        link.childId,
        { linkId: link.id },
      );

      if (child && child.status !== AccountStatus.DEACTIVATED) {
        await this.prisma.user.update({
          where: { id: child.id },
          data: {
            status: AccountStatus.DEACTIVATED,
            deactivatedAt: new Date(),
          },
        });
        await this.audit.record(
          'MINOR_ACCOUNT_SUSPENDED_NO_PARENTAL_CONSENT',
          child.id,
          { linkId: link.id },
        );
      }
    }

    const suspendus = overdueLinks.length - devenusMajeurs;
    if (suspendus > 0) {
      this.logger.warn(
        `${suspendus} compte(s) mineur(s) signalé(s) et suspendu(s) après ${flagAfterDays} jours sans consentement parental.`,
      );
    }
    if (devenusMajeurs > 0) {
      this.logger.log(
        `${devenusMajeurs} lien(s) parental(aux) clos sans suspension : le titulaire a atteint la majorité entre-temps.`,
      );
    }
  }

  // L'obligation tient-elle ENCORE aujourd'hui, pour ce compte et son pays ?
  //
  // On interroge la politique du pays plutôt que de comparer à 18 : c'est le
  // moteur configurable qui décide, ici comme partout ailleurs.
  //
  // Sans date de naissance ni pays, on ne peut pas prouver que l'obligation est
  // éteinte — on maintient donc la protection. C'est le sens sûr de l'erreur
  // pour un compte qui a été créé comme mineur.
  private async stillRequiresParentalConsent(child: {
    dateOfBirth: Date | null;
    countryOfResidence: string | null;
  }): Promise<boolean> {
    if (!child.dateOfBirth || !child.countryOfResidence) return true;

    const classification = await this.minorPolicy.classify(
      child.dateOfBirth,
      child.countryOfResidence,
    );
    return classification.tier === 'PARENTAL_CONSENT_REQUIRED';
  }
}
