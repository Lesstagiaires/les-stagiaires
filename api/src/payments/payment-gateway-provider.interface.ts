export const PAYMENT_GATEWAY_PROVIDER = 'PAYMENT_GATEWAY_PROVIDER';
export const PAYMENT_GATEWAY_REGISTRY = 'PAYMENT_GATEWAY_REGISTRY';

export interface PaymentInitiationRequest {
  paymentId: string;
  amountMinor: number;
  currency: string;
  countryCode: string;
  paymentMethodCode: string;
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

// ÉCHEC CERTAIN — à ne lever QUE si le prestataire peut le PROUVER.
//
// Quand `initiate()` lève, l'appelant fait face à deux situations que rien ne
// distingue de l'extérieur :
//
//   a) la demande n'a JAMAIS quitté le processus — configuration absente,
//      connexion refusée, requête rejetée avant émission. Aucun débit ne peut
//      exister chez le prestataire.
//   b) la demande est partie et la réponse s'est perdue — délai dépassé, coupure
//      réseau. Le payeur PEUT avoir été débité, ou être sur le point de l'être.
//
// Traiter (b) comme (a) autoriserait une nouvelle tentative et donc un DOUBLE
// DÉBIT. C'est pourquoi cette erreur est réservée au cas (a), et que tout le
// reste est traité comme « résultat inconnu » : la sécurité financière du payeur
// passe avant la libération du verrou.
//
// Règle pour toute implémentation future (Orange Money, MTN MoMo...) : dans le
// doute, NE PAS lever cette erreur.
export class PaymentNotSentError extends Error {
  constructor(message = "La demande de paiement n'a pas été émise.") {
    super(message);
    this.name = 'PaymentNotSentError';
  }
}

// Chaque implémentation (simulée aujourd'hui, une par pays/prestataire demain — Orange
// Money, MTN MoMo...) initie la demande de paiement mais ne confirme jamais elle-même le
// résultat : la confirmation n'arrive que via le canal officiel du prestataire (webhook
// signé, cf. PaymentsService.handleProviderCallback) — jamais sur la seule déclaration de
// l'utilisateur (CLAUDE.md §6, non négociable).
export interface PaymentGatewayProvider {
  initiate(request: PaymentInitiationRequest): Promise<PaymentInitiationResult>;
}
