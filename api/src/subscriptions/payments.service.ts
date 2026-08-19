import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentStatus,
  SubscriptionBillingCycle,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { CommissionsService } from '../ambassadors/commissions.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderPaymentWebhookDto } from './dto/provider-webhook.dto';

// Seul point d'entrée qui peut faire passer un abonnement à ACTIVE — jamais un endpoint
// appelé par l'utilisateur final déclarant lui-même avoir payé (CLAUDE.md §6, non
// négociable). Authentifié par un secret partagé propre à chaque provider, pas par un
// jeton JWT utilisateur : ce n'est pas l'utilisateur qui confirme, c'est le prestataire.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly commissions: CommissionsService,
  ) {}

  async handleProviderCallback(
    providerName: string,
    webhookSecret: string | undefined,
    dto: ProviderPaymentWebhookDto,
  ) {
    const expectedSecret = this.config.get<string>(
      `PAYMENT_WEBHOOK_SECRET_${providerName.toUpperCase()}`,
    );
    if (!expectedSecret || webhookSecret !== expectedSecret) {
      throw new UnauthorizedException('Signature de webhook invalide.');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: dto.providerReference },
      include: { subscription: true },
    });
    if (!payment) {
      throw new NotFoundException(
        'Aucun paiement ne correspond à cette référence.',
      );
    }

    // Idempotence : un prestataire peut renvoyer le même évènement plusieurs fois — ne
    // jamais réappliquer une transition déjà effectuée.
    if (payment.status !== PaymentStatus.INITIATED) {
      return { id: payment.id, status: payment.status };
    }

    // L'abonnement est-il encore couvert au moment où le prestataire répond ?
    // Lu AVANT toute écriture : c'est ce qui distingue une première souscription
    // qui échoue — rien à protéger — d'un renouvellement qui échoue alors que la
    // période en cours court toujours.
    // `== null` et non `=== null` : il attrape aussi `undefined`. La nuance n'est
    // pas cosmétique — une période absente doit être traitée comme « aucune
    // couverture », jamais provoquer une lecture de `.getTime()` sur un vide.
    const finDePeriode = payment.subscription.currentPeriodEnd;
    const couvertureEncoreValide =
      finDePeriode != null && finDePeriode.getTime() > Date.now();

    if (dto.status === 'CONFIRMED') {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.CONFIRMED,
            providerConfirmedAt: new Date(),
          },
        }),
        this.prisma.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            // `startedAt` marque le début de la RELATION, pas de la période en
            // cours. Un renouvellement ne le réécrit donc pas : sans ce garde-fou
            // l'ancienneté d'un abonné se serait remise à zéro à chaque
            // reconduction, et avec elle toute lecture d'historique.
            startedAt: payment.subscription.startedAt ?? new Date(),
            currentPeriodEnd: this.computePeriodEnd(
              payment.subscription.billingCycle,
              payment.subscription.currentPeriodEnd,
            ),
          },
        }),
      ]);
      await this.audit.record(
        'SUBSCRIPTION_PAYMENT_CONFIRMED',
        payment.subscription.beneficiaryUserId,
        { subscriptionId: payment.subscriptionId, paymentId: payment.id },
      );

      // SEUL déclencheur d'une commission d'ambassadeur sur toute la plateforme.
      // Placé ici et nulle part ailleurs, après que le paiement est réellement passé
      // à CONFIRMED : « pas d'achat = pas de commission » (décision du promoteur du
      // 2026-07-31). Le service ne remonte jamais d'exception — un problème de
      // commission ne doit pas faire échouer la confirmation d'un encaissement.
      await this.commissions.onPaymentConfirmed(payment.id);
    } else {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failedAt: new Date() },
        }),
        this.prisma.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            // UN RENOUVELLEMENT QUI ÉCHOUE NE RETIRE RIEN (P1-2).
            // Rétrograder en PAYMENT_FAILED un abonnement encore couvert
            // reviendrait à confisquer des jours DÉJÀ PAYÉS parce qu'une
            // reconduction n'a pas abouti. Tant que la période court, le statut
            // reste celui qu'il était ; l'échéance fera le reste le moment venu.
            status: couvertureEncoreValide
              ? payment.subscription.status
              : SubscriptionStatus.PAYMENT_FAILED,
          },
        }),
      ]);
      await this.audit.record(
        'SUBSCRIPTION_PAYMENT_FAILED',
        payment.subscription.beneficiaryUserId,
        { subscriptionId: payment.subscriptionId, paymentId: payment.id },
      );
    }

    return { id: payment.id, status: dto.status };
  }

  // ANCRAGE DE LA NOUVELLE PÉRIODE — arbitrage D-3 du promoteur, 2026-08-18.
  //
  // L'ancre est le PLUS TARDIF entre la fin de période en cours et maintenant.
  // Une seule formule couvre les quatre cas, et c'est ce qui la rend sûre :
  //
  //   première souscription   → `periodeEnCours` est nul, l'ancre est maintenant
  //                             (comportement identique à celui d'avant P1-2) ;
  //   reconduction anticipée  → l'ancre est currentPeriodEnd : les jours restants
  //                             sont INTÉGRALEMENT conservés et la nouvelle
  //                             période s'ajoute à l'ancienne ;
  //   reconduction à échéance → continuité exacte, sans trou ;
  //   reconduction tardive    → l'ancre est maintenant : on ne crédite pas
  //                             rétroactivement une période déjà écoulée.
  //
  // Aucun jour payé n'est perdu, aucun trou de couverture n'est créé.
  private computePeriodEnd(
    cycle: SubscriptionBillingCycle,
    periodeEnCours: Date | null = null,
  ): Date | null {
    const maintenant = Date.now();
    const ancre = new Date(
      Math.max(periodeEnCours?.getTime() ?? maintenant, maintenant),
    );
    if (cycle === SubscriptionBillingCycle.QUARTERLY) {
      return new Date(ancre.setMonth(ancre.getMonth() + 3));
    }
    if (cycle === SubscriptionBillingCycle.ANNUAL) {
      return new Date(ancre.setFullYear(ancre.getFullYear() + 1));
    }
    // ONE_TIME : prestation à l'acte, pas de période récurrente à faire expirer.
    return null;
  }
}
