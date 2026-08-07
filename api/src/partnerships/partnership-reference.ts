// Référence lisible d'un dossier de partenariat.
//
// Règle du promoteur : « aucun type ne doit afficher un identifiant brut ». Un cuid
// (`clx7f9k2a0001qw3v8h2n4p6r`) dans un e-mail institutionnel est illisible, et
// donne à voir la mécanique interne sans rien apporter au lecteur.
//
// La référence est DÉRIVÉE, non stockée : pas de colonne à remplir, pas de
// séquence à gérer, pas de rattrapage sur les lignes existantes — et elle reste
// stable pour un dossier donné puisque l'identifiant ne change jamais.
//
// Côté support, une référence reçue par téléphone se retrouve par un suffixe :
//   SELECT * FROM "Partnership" WHERE upper(right(id, 8)) = 'XY12AB34';
export function partnershipReference(partnershipId: string): string {
  return `PART-${partnershipId.slice(-8).toUpperCase()}`;
}
