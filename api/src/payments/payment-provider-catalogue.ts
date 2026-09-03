export type PaymentProviderCode = 'simulated' | 'orange-money-cm' | 'mtn-momo-cm' | 'stripe';
export type PaymentMethodCode = 'simulated' | 'orange-money' | 'mtn-momo' | 'stripe-card';

export interface PaymentMethodDefinition {
  code: PaymentMethodCode;
  providerCode: PaymentProviderCode;
  countries: readonly string[];
  currencies: readonly string[];
}

// Le catalogue décrit les capacités commerciales, pas les secrets ni les adaptateurs
// installés. Les providers futurs peuvent être annoncés ici avant leur implémentation.
export const PAYMENT_METHOD_CATALOGUE: readonly PaymentMethodDefinition[] = [
  { code: 'simulated', providerCode: 'simulated', countries: ['CM'], currencies: ['XAF'] },
  { code: 'orange-money', providerCode: 'orange-money-cm', countries: ['CM'], currencies: ['XAF'] },
  { code: 'mtn-momo', providerCode: 'mtn-momo-cm', countries: ['CM'], currencies: ['XAF'] },
  { code: 'stripe-card', providerCode: 'stripe', countries: ['CM'], currencies: ['EUR', 'USD'] },
];