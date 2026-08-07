export const PAYMENT_GATEWAY_PROVIDER = 'PAYMENT_GATEWAY_PROVIDER';

export interface PaymentInitiationRequest {
  paymentId: string;
  amountMinor: number;
  currency: string;
  countryCode: string;
}

export interface PaymentInitiationResult {
  // Référence opaque émise par le prestataire, utilisée pour rapprocher son webhook de
  // confirmation au paiement (Payment.providerReference) — jamais un identifiant de
  // moyen de paiement ni un PIN (CLAUDE.md §6).
  providerReference: string;
  // Instructions affichées au payeur (ex. code USSD officiel, lien Mobile Money
  // officiel) — jamais un champ de saisie de PIN dans l'application elle-même.
  instructions?: string;
}

// Chaque implémentation (simulée aujourd'hui, une par pays/prestataire demain — Orange
// Money, MTN MoMo...) initie la demande de paiement mais ne confirme jamais elle-même le
// résultat : la confirmation n'arrive que via le canal officiel du prestataire (webhook
// signé, cf. PaymentsService.handleProviderCallback) — jamais sur la seule déclaration de
// l'utilisateur (CLAUDE.md §6, non négociable).
export interface PaymentGatewayProvider {
  initiate(request: PaymentInitiationRequest): Promise<PaymentInitiationResult>;
}
