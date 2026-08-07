// ============================================================================
// POURQUOI ON LIT DES COORDONNÉES DE PAIEMENT
//
// Exigence du promoteur du 2026-08-04 : « Personne ne lit les coordonnées de
// paiement sans raison métier explicite. »
//
// Cette énumération EST cette exigence, rendue impossible à contourner : la
// méthode de déchiffrement l'exige en paramètre. On ne peut donc pas déchiffrer
// « en passant » — il faut nommer la raison, et cette raison part au journal
// d'audit avec l'auteur et l'horodatage.
//
// La liste est volontairement COURTE. Chaque valeur ajoutée ici est une raison
// de plus de lire un numéro de compte : elle doit se défendre.
// ============================================================================
export enum PaymentDetailAccessPurpose {
  // Recopie de la destination sur une demande de versement, au moment où
  // l'ambassadeur la dépose. Automatique, sans intervention humaine.
  PAYOUT_REQUEST_SNAPSHOT = 'PAYOUT_REQUEST_SNAPSHOT',

  // Un administrateur prépare le virement hors application et a besoin du
  // numéro complet. C'est LA raison pour laquelle ces données existent.
  PAYOUT_EXECUTION = 'PAYOUT_EXECUTION',

  // Instruction d'un signalement ou d'un soupçon de détournement. Rare, et
  // c'est pour cela qu'elle est distincte : un pic sur ce motif dans le journal
  // d'audit est en soi un signal.
  COMPLIANCE_INVESTIGATION = 'COMPLIANCE_INVESTIGATION',

  // Réécriture lors d'une rotation de clé. Aucun humain ne lit la valeur : elle
  // est déchiffrée puis immédiatement rechiffrée.
  KEY_ROTATION = 'KEY_ROTATION',
}

// Les motifs qu'un administrateur peut invoquer depuis le back-office. Les deux
// autres sont techniques et ne s'exposent pas : personne ne doit pouvoir
// demander une lecture en se réclamant d'une rotation de clé.
export const HUMAN_ACCESS_PURPOSES = [
  PaymentDetailAccessPurpose.PAYOUT_EXECUTION,
  PaymentDetailAccessPurpose.COMPLIANCE_INVESTIGATION,
] as const;
