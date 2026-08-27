import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { SubscriptionStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionNoticesService } from './subscription-notices.service';

// Transition automatique ACTIVE/CANCELLED → EXPIRED une fois currentPeriodEnd
// dépassé — un abonnement ONE_TIME (currentPeriodEnd = null) n'a pas de période
// récurrente à expirer. Une annulation conserve ainsi les jours déjà payés.
@Processor('subscription-expiry')
export class SubscriptionExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionExpiryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notices: SubscriptionNoticesService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const echeance = new Date();

    // V6-5 — QUI VA EXPIRER, lu juste avant la transition.
    //
    // `updateMany` ne rend qu'un compte, jamais des identifiants : sans cette
    // lecture, on saurait que trois abonnements ont expiré sans pouvoir dire
    // lesquels, donc sans pouvoir prévenir qui que ce soit.
    //
    // ELLE NE MODIFIE PAS LA TRANSITION, qui reste le `updateMany` ci-dessous,
    // mot pour mot. Si une exécution concurrente expire les mêmes lignes entre
    // les deux, les deux tenteront de prévenir — et l'index unique n'en laissera
    // passer qu'un seul avis.
    const aExpirer = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
        },
        currentPeriodEnd: { not: null, lte: echeance },
      },
      select: { id: true },
    });

    const expired = await this.prisma.subscription.updateMany({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
        },
        currentPeriodEnd: { not: null, lte: echeance },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    if (expired.count > 0) {
      await this.audit.record('SUBSCRIPTION_EXPIRY_SWEEP', null, {
        expiredCount: expired.count,
      });
      this.logger.log(`${expired.count} abonnement(s) expiré(s).`);
    }

    // V6-5 — LE SIGNAL, APRÈS LA TRANSITION ET SANS ACTION SUR ELLE.
    //
    // D'abord les fins de couverture, ensuite les échéances qui approchent :
    // les premières concernent des abonnements que le balayage vient de faire
    // basculer, les secondes ceux qui courent encore. Aucun abonnement ne peut
    // relever des deux au même instant.
    //
    // Une erreur d'avis ne doit pas laisser des abonnements expirés sans l'être
    // au prochain passage : la transition est déjà écrite et confirmée.
    try {
      await this.notices.signalerFinDeCouverture(aExpirer.map((s) => s.id));
      const anticipes = await this.notices.balayerEcheances(echeance);
      if (anticipes > 0) {
        this.logger.log(`${anticipes} avis d'échéance émis.`);
      }
    } catch (error) {
      this.logger.error(
        "Émission des avis d'abonnement impossible.",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
