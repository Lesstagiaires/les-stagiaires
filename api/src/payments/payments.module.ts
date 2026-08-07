import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_GATEWAY_PROVIDER } from './payment-gateway-provider.interface';
import { SimulatedPaymentGatewayProvider } from './simulated-payment-gateway.provider';

@Module({
  providers: [
    SimulatedPaymentGatewayProvider,
    {
      // "simulated" par défaut. Pour connecter une passerelle officielle par pays :
      // ajouter la classe (ex. OrangeMoneyCmProvider implements PaymentGatewayProvider),
      // l'ajouter aux providers ci-dessus et à ce useFactory — SubscriptionsService et le
      // contrôleur de webhook restent inchangés (architecture "provider-swap", comme
      // STORAGE_PROVIDER/SMS_PROVIDER/MALWARE_SCANNER_PROVIDER).
      provide: PAYMENT_GATEWAY_PROVIDER,
      useFactory: (
        config: ConfigService,
        simulated: SimulatedPaymentGatewayProvider,
      ) => {
        const provider = config.get<string>(
          'PAYMENT_GATEWAY_PROVIDER',
          'simulated',
        );
        if (provider !== 'simulated') {
          throw new Error(
            `PAYMENT_GATEWAY_PROVIDER="${provider}" n'est pas encore implémenté — seul "simulated" est disponible dans cette version.`,
          );
        }
        return simulated;
      },
      inject: [ConfigService, SimulatedPaymentGatewayProvider],
    },
  ],
  exports: [PAYMENT_GATEWAY_PROVIDER],
})
export class PaymentsModule {}
