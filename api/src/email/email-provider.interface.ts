export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export interface OutboundEmail {
  to: string;
  subject: string;
  // Les deux corps sont TOUJOURS fournis. Un e-mail sans version texte est
  // pénalisé par les filtres anti-spam et illisible pour les clients de
  // messagerie en texte seul, encore courants sur les téléphones d'entrée de
  // gamme — une part réelle de nos utilisateurs.
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailSendResult {
  // Identifiant rendu par le fournisseur, conservé dans EmailLog pour pouvoir
  // rapprocher une plainte « je n'ai rien reçu » d'un envoi réel.
  providerMessageId?: string;
}

// ============================================================================
// ARCHITECTURE « PROVIDER-SWAP » — LE FOURNISSEUR N'EST JAMAIS CODÉ EN DUR
//
// Même patron que SMS_PROVIDER, STORAGE_PROVIDER, PAYMENT_GATEWAY_PROVIDER et
// MALWARE_SCANNER_PROVIDER : une interface, plusieurs implémentations, une
// seule sélectionnée par la variable d'environnement EMAIL_PROVIDER.
//
// Pour brancher SMTP, SendGrid, Amazon SES, Mailgun ou Resend :
//   1. Créer une classe `implements EmailProvider` dans ce dossier ;
//   2. L'ajouter aux `providers` de EmailModule et à sa factory ;
//   3. Renseigner EMAIL_PROVIDER dans l'environnement.
//
// Aucun appelant ne change : ni EmailService, ni les gabarits, ni les modules
// métier — qui, eux, ne savent même pas qu'un e-mail existe. C'est précisément
// ce qui permettra de changer de fournisseur le jour où le coût, la
// délivrabilité ou la localisation des données l'imposeront.
//
// `name` est journalisé à chaque envoi : une bascule de fournisseur reste ainsi
// traçable a posteriori, sans migration de schéma.
// ============================================================================
export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailSendResult>;
}
