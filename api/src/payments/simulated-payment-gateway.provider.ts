import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  PaymentGatewayProvider,
  PaymentInitiationRequest,
  PaymentInitiationResult,
} from './payment-gateway-provider.interface';

// Implémentation de développement — ne collecte jamais de PIN Mobile Money/Orange Money
// (CLAUDE.md §6) et ne confirme jamais elle-même le paiement : la confirmation n'arrive
// que via PaymentsService.handleProviderCallback(), déclenché par le webhook
// POST /payments/webhooks/simulated — jamais directement par cette classe. À remplacer par
// une implémentation par pays (Orange Money, MTN MoMo...) sans modifier
// SubscriptionsService ni le contrat PaymentGatewayProvider.
@Injectable()
export class SimulatedPaymentGatewayProvider implements PaymentGatewayProvider {
  private readonly logger = new Logger(SimulatedPaymentGatewayProvider.name);

  async initiate(
    request: PaymentInitiationRequest,
  ): Promise<PaymentInitiationResult> {
    const providerReference = `SIM-${randomUUID()}`;
    this.logger.warn(
      `[SIMULÉ] Paiement ${request.amountMinor} ${request.currency} initié pour ${request.paymentId} ` +
        `(réf. prestataire ${providerReference}) — confirmez via ` +
        `POST /payments/webhooks/simulated avec ce providerReference.`,
    );
    return Promise.resolve({
      providerReference,
      instructions:
        'Paiement simulé : aucune collecte réelle de moyen de paiement. En attente de la confirmation officielle du prestataire.',
    });
  }
}
