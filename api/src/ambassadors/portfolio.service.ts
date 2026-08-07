import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  PortfolioEventType,
  PortfolioReleaseReason,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AmbassadorPolicyService,
  addMonths,
} from './ambassador-policy.service';
import { notifyAmbassador } from './notify-ambassador';

// Fenêtre de pré-sélection du balayage. Toute alerte configurable se situe
// nécessairement à moins de six mois de l'échéance (9 et 11 mois sur une fenêtre de
// douze, soit trois mois et un mois avant). Cette borne évite de relire tout le
// portefeuille de la plateforme chaque nuit, tout en gardant de la marge si un pays
// configure des alertes plus précoces.
const WARNING_LOOKAHEAD_MONTHS = 6;

// ============================================================================
// COMPTE À REBOURS DU PORTEFEUILLE
//
// Règle du promoteur (point 7 des arbitrages du 2026-07-31), et rien d'autre :
//
//   Douze mois sans AUCUN paiement confirmé libèrent l'entreprise.
//   Seul un achat confirmé remet le compteur à zéro.
//   Aucune note, aucun commentaire, aucun appel déclaré, aucun suivi manuel.
//
// Ce dernier point n'est pas un détail d'implémentation, c'est la garantie
// anti-fraude du dispositif : puisque l'ambassadeur ne peut RIEN saisir qui
// repousse l'échéance, il ne peut pas entretenir une rente sur un portefeuille
// devenu inactif. La seule façon de conserver une entreprise est qu'elle achète.
//
// Ce service n'expose donc volontairement aucune méthode « prolonger », et le
// modèle ne comporte aucun champ de suivi commercial saisissable.
// ============================================================================
@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policy: AmbassadorPolicyService,
  ) {}

  async listForAmbassador(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ambassador)
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");

    return this.prisma.ambassadorPortfolioEntry.findMany({
      where: { ambassadorId: ambassador.id, releasedAt: null },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            sector: true,
            city: true,
            country: true,
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  // Balayage quotidien. Idempotent : les horodatages warnedAt9m / warnedAt11m
  // empêchent qu'une alerte parte deux fois, et une entrée déjà libérée sort
  // définitivement du périmètre.
  async runDailySweep(now = new Date()) {
    const expired = await this.releaseExpired(now);
    const warned = await this.sendWarnings(now);

    this.logger.log(
      `Balayage portefeuille : ${expired} rattachement(s) libéré(s), ${warned} alerte(s) envoyée(s).`,
    );
    return { expired, warned };
  }

  private async releaseExpired(now: Date): Promise<number> {
    const due = await this.prisma.ambassadorPortfolioEntry.findMany({
      where: { releasedAt: null, expiresAt: { lte: now } },
      include: {
        ambassador: { select: { userId: true } },
        organization: { select: { name: true } },
      },
    });

    for (const entry of due) {
      await this.prisma.$transaction([
        this.prisma.ambassadorPortfolioEntry.update({
          where: { id: entry.id },
          data: {
            releasedAt: now,
            releaseReason: PortfolioReleaseReason.INACTIVITY,
          },
        }),
        this.prisma.portfolioEvent.create({
          data: {
            entryId: entry.id,
            type: PortfolioEventType.EXPIRED,
            metadata: {
              lastConfirmedPurchaseAt:
                entry.lastConfirmedPurchaseAt?.toISOString() ?? null,
              attributedAt: entry.attributedAt.toISOString(),
            },
          },
        }),
      ]);

      // Journalisée systématiquement : la perte d'un portefeuille a un effet
      // financier direct, elle ne doit jamais être un évènement muet dont personne
      // ne retrouve la trace six mois plus tard.
      await this.audit.record('AMBASSADOR_PORTFOLIO_EXPIRED', null, {
        entryId: entry.id,
        ambassadorId: entry.ambassadorId,
        organizationId: entry.organizationId,
      });

      await notifyAmbassador(
        this.notifications,
        entry.ambassador.userId,
        NotificationType.AMBASSADOR_PORTFOLIO_EXPIRED,
        {
          entryId: entry.id,
          organizationId: entry.organizationId,
          organizationName: entry.organizationName,
        },
      );
    }

    return due.length;
  }

  private async sendWarnings(now: Date): Promise<number> {
    const candidates = await this.prisma.ambassadorPortfolioEntry.findMany({
      where: {
        releasedAt: null,
        expiresAt: { gt: now, lte: addMonths(now, WARNING_LOOKAHEAD_MONTHS) },
        OR: [{ warnedAt9m: null }, { warnedAt11m: null }],
      },
      include: {
        ambassador: { select: { userId: true } },
        organization: { select: { name: true, country: true } },
      },
    });

    let sent = 0;

    for (const entry of candidates) {
      const resolvedPolicy = await this.policy.resolve(
        entry.organization?.country ?? null,
      );
      // L'ancrage est le dernier achat confirmé — ou, si l'entreprise n'a jamais
      // acheté, la date de rattachement.
      const anchor = entry.lastConfirmedPurchaseAt ?? entry.attributedAt;

      // Les seuils sont triés par ordre décroissant pour n'envoyer que l'alerte la
      // plus tardive atteinte : si un balayage n'a pas tourné pendant deux mois, on
      // avertit « il reste un mois », pas « il reste trois mois » suivi de
      // « il reste un mois » dans la même nuit.
      const thresholds = [...resolvedPolicy.portfolioWarnMonths].sort(
        (a, b) => b - a,
      );

      for (const months of thresholds) {
        const field = months >= 11 ? 'warnedAt11m' : 'warnedAt9m';
        if (entry[field] !== null) continue;
        if (now < addMonths(anchor, months)) continue;

        await this.prisma.$transaction([
          this.prisma.ambassadorPortfolioEntry.update({
            where: { id: entry.id },
            data: { [field]: now },
          }),
          this.prisma.portfolioEvent.create({
            data: {
              entryId: entry.id,
              type:
                field === 'warnedAt11m'
                  ? PortfolioEventType.WARNED_11M
                  : PortfolioEventType.WARNED_9M,
              metadata: { monthsWithoutPurchase: months },
            },
          }),
        ]);

        await notifyAmbassador(
          this.notifications,
          entry.ambassador.userId,
          field === 'warnedAt11m'
            ? NotificationType.AMBASSADOR_PORTFOLIO_WARNING_11M
            : NotificationType.AMBASSADOR_PORTFOLIO_WARNING_9M,
          {
            entryId: entry.id,
            organizationId: entry.organizationId,
            organizationName: entry.organizationName,
            expiresAt: entry.expiresAt.toISOString(),
            monthsWithoutPurchase: months,
          },
        );

        sent += 1;
        break;
      }
    }

    return sent;
  }
}
