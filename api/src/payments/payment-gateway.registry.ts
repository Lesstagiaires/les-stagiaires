import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentGatewayProvider } from './payment-gateway-provider.interface';
import {
  PAYMENT_METHOD_CATALOGUE,
  type PaymentMethodCode,
  type PaymentProviderCode,
} from './payment-provider-catalogue';

@Injectable()
export class PaymentGatewayRegistry {
  private readonly providers = new Map<PaymentProviderCode, PaymentGatewayProvider>();

  register(code: PaymentProviderCode, provider: PaymentGatewayProvider): void {
    this.providers.set(code, provider);
  }

  resolve(
    countryCode: string,
    paymentMethodCode: PaymentMethodCode,
    currency: string,
  ): { providerCode: PaymentProviderCode; provider: PaymentGatewayProvider } {
    const method = PAYMENT_METHOD_CATALOGUE.find(
      (item) =>
        item.code === paymentMethodCode &&
        item.countries.includes(countryCode) &&
        item.currencies.includes(currency),
    );
    if (!method) {
      throw new BadRequestException(
        'Ce moyen de paiement n’est pas disponible pour ce pays et cette devise.',
      );
    }
    const provider = this.providers.get(method.providerCode);
    if (!provider) {
      throw new BadRequestException(
        'Ce moyen de paiement sera disponible prochainement.',
      );
    }
    return { providerCode: method.providerCode, provider };
  }

  available(countryCode: string) {
    return PAYMENT_METHOD_CATALOGUE.filter((method) =>
      method.countries.includes(countryCode) &&
      this.providers.has(method.providerCode),
    ).map(({ code, currencies }) => ({ code, currencies }));
  }
}