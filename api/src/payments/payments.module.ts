import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_GATEWAY_PROVIDER,
  PAYMENT_GATEWAY_REGISTRY,
} from './payment-gateway-provider.interface';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { SimulatedPaymentGatewayProvider } from './simulated-payment-gateway.provider';

@Module({
  providers: [
    SimulatedPaymentGatewayProvider,
    PaymentGatewayRegistry,
    {
      provide: PAYMENT_GATEWAY_REGISTRY,
      useFactory: (
        registry: PaymentGatewayRegistry,
        simulated: SimulatedPaymentGatewayProvider,
      ) => {
        registry.register('simulated', simulated);
        return registry;
      },
      inject: [PaymentGatewayRegistry, SimulatedPaymentGatewayProvider],
    },
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
        const environment = config.get<string>('NODE_ENV', 'development');
        if (provider !== 'simulated' && environment === 'production') {
          throw new Error(
            `PAYMENT_GATEWAY_PROVIDER="${provider}" n'est pas implémenté en production. ` +
              'Configurez "simulated" uniquement pour un environnement de test, ' +
              'ou branchez un provider officiel avant le démarrage.',
          );
        }
        return simulated;
      },
      inject: [ConfigService, SimulatedPaymentGatewayProvider],
    },
  ],
  exports: [PAYMENT_GATEWAY_PROVIDER, PAYMENT_GATEWAY_REGISTRY],
})
export class PaymentsModule {}
