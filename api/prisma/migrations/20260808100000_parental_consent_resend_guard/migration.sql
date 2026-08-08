-- ============================================================================
-- LA RELANCE A BESOIN D'UN DELAI DE GARDE
--
-- Le parcours cote mineur, valide par le promoteur le 2026-08-08, demande une
-- « possibilite de relance » quand le parent n'a rien recu ou que le code a
-- expire. C'est indispensable : sans elle, un compte reste bloque pour toujours
-- des que le premier SMS se perd.
--
-- MAIS UNE RELANCE SANS GARDE-FOU EST UNE ARME. Trois raisons, dans l'ordre de
-- gravite :
--
--   1. LE PARENT. Un adolescent contrarie qui appuie vingt fois transforme la
--      plateforme en outil de harcelement du numero qu'il a lui-meme declare.
--      C'est le pire des trois, et c'est celui qu'on n'imagine pas en ecrivant
--      un bouton « renvoyer ».
--   2. L'ARGENT. Chaque envoi est facture par l'operateur.
--   3. LE CODE. Relancer invalide le code precedent. Un parent qui lit le SMS
--      pendant que son enfant en demande un autre saisit un code deja mort, et
--      conclut que la plateforme ne fonctionne pas.
--
-- On enregistre donc QUAND le dernier SMS est parti. La limitation de debit HTTP
-- ne suffit pas : elle est par adresse IP et par minute, alors que la regle
-- porte sur un lien parental et se compte en minutes.
--
-- Colonne NULLABLE : les liens existants n'ont pas cette date, et un NULL se lit
-- « on ne sait pas quand » — donc relance autorisee. Refuser par defaut
-- bloquerait les comptes deja en attente, ce qui serait exactement le contraire
-- du but.
-- ============================================================================

ALTER TABLE "ParentalLink" ADD COLUMN "lastConsentSentAt" TIMESTAMP(3);

-- Les liens existants en attente ont bien recu un SMS a leur creation : on
-- retient cette date, faute de mieux. Sans ce report, tous se croiraient
-- « jamais envoyes » et autoriseraient une relance immediate.
UPDATE "ParentalLink"
   SET "lastConsentSentAt" = "createdAt"
 WHERE "status" = 'PENDING';
