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
            startedAt: new Date(),
            currentPeriodEnd: this.computePeriodEnd(
              payment.subscription.billingCycle,
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
          data: { status: SubscriptionStatus.PAYMENT_FAILED },
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

  private computePeriodEnd(cycle: SubscriptionBillingCycle): Date | null {
    const now = new Date();
    if (cycle === SubscriptionBillingCycle.QUARTERLY) {
      return new Date(now.setMonth(now.getMonth() + 3));
    }
    if (cycle === SubscriptionBillingCycle.ANNUAL) {
      return new Date(now.setFullYear(now.getFullYear() + 1));
    }
    // ONE_TIME : prestation à l'acte, pas de période récurrente à faire expirer.
    return null;
  }
}
