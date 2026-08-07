-- ============================================================================
-- MARQUEUR DE DONNÉES DE DÉMONSTRATION
-- Arbitrages du promoteur des 2026-08-01 et 2026-08-02.
--
-- « Les données de démonstration peuvent rester en base jusqu'à la recette
-- finale, mais elles devront être clairement identifiées comme données de test et
-- exclues de tous les calculs financiers, statistiques et tableaux de bord de
-- production. »
--
-- Le drapeau vit sur les deux RACINES — le compte et l'organisation. Tout le reste
-- (partenariats, offres, candidatures, paiements, abonnements) en dépend par clé
-- étrangère : marquer la racine suffit, et évite d'avoir à maintenir un drapeau
-- sur vingt tables qui divergeraient à la première distraction.
--
-- Le défaut est FALSE. Un compte n'est de démonstration que si on l'a déclaré tel :
-- un oubli produit un compte traité comme réel, ce qui est le sens sûr de l'erreur.
-- ============================================================================

ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Les calculs de production filtrent sur ce drapeau : sans index, chaque tableau
-- de bord paierait un balayage complet.
CREATE INDEX "User_isDemo_idx" ON "User"("isDemo");
CREATE INDEX "Organization_isDemo_idx" ON "Organization"("isDemo");

-- --- Marquage des comptes de recette existants -------------------------------
-- Ces numéros sont ceux qui ont servi aux vérifications de bout en bout du
-- 2026-08-02. Ils sont nommés explicitement plutôt que devinés par un motif : un
-- motif du genre « tout numéro en 69000... » attraperait un jour un vrai
-- utilisateur camerounais, et supprimerait son compte.
UPDATE "User"
   SET "isDemo" = true
 WHERE phone IN (
   '+237690000001',  -- administrateur de recette
   '+237671234567',  -- établissement de recette (Institut Test Douala)
   '+237690001111',
   '+237690002222',
   '+237690003333'
 );

-- Les organisations détenues par un compte de démonstration le sont aussi.
UPDATE "Organization" o
   SET "isDemo" = true
  FROM "User" u
 WHERE u.id = o."ownerId" AND u."isDemo" = true;
