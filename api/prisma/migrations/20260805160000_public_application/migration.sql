-- ============================================================================
-- FORMULAIRE PUBLIC DE CANDIDATURE
-- Arbitrages 4 et 11 du promoteur, 2026-08-02, phase 2.
--
-- « Un candidat ne devient JAMAIS ambassadeur automatiquement. » Le formulaire
-- ouvre un dossier ; il ne donne aucun droit, aucun code, aucune attribution.
--
-- REDEPOT APRES REFUS. « La candidature precedente et son historique restent
-- conserves ; la nouvelle demande constitue un nouveau cycle identifiable ;
-- l administration peut fixer un delai avant redepot ; ce delai doit etre
-- configurable ; certains motifs graves peuvent empecher automatiquement un
-- nouveau depot. »
--
-- UN COMPTEUR DE CYCLE, PAS UNE SECONDE LIGNE. `Ambassador.userId` reste unique :
-- deux dossiers vivants pour une meme personne, ce serait deux codes
-- d affiliation, deux portefeuilles, et la meme commission comptee deux fois.
-- L historique est conserve par `AmbassadorEvent`, en ajout seul, qui porte en
-- outre les decisions, leurs auteurs et leurs motifs — ce qu une ligne
-- dupliquee ne ferait pas.
--
-- AGE MINIMUM configurable par pays (CLAUDE.md §5 : jamais de seuil code en dur).
-- 18 ans par defaut, conformement a l arbitrage : seuls des majeurs peuvent
-- etre ambassadeurs.
-- ============================================================================

-- AlterTable
ALTER TABLE "Ambassador" ADD COLUMN     "applicationCycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastRejectedAt" TIMESTAMP(3),
ADD COLUMN     "motivation" TEXT,
ADD COLUMN     "reapplicationBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reapplicationBlockedReason" "AmbassadorDecisionReason";

-- AlterTable
ALTER TABLE "AmbassadorPolicy" ADD COLUMN     "minAmbassadorAge" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "reapplicationDelayMonths" INTEGER NOT NULL DEFAULT 6;

-- --- LES GARDE-FOUS ----------------------------------------------------------
-- Un cycle commence a 1. Zero ou negatif signifierait une candidature qui
-- n a jamais eu lieu.
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_cycle_positive"
  CHECK ("applicationCycle" >= 1);

-- Un blocage de redepot porte TOUJOURS son motif. Bloquer quelqu un sans dire
-- pourquoi serait indefendable devant une contestation — et c est exactement le
-- genre de champ qu on remplit a moitie un jour de hate.
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_block_is_motivated"
  CHECK (
    "reapplicationBlocked" = false
    OR "reapplicationBlockedReason" IS NOT NULL
  );

-- Un age minimum sous 16 ans ouvrirait le programme a des mineurs sur un flux
-- qui verse de l argent. Le plancher est en base, pas dans un formulaire.
ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_min_age_floor"
  CHECK ("minAmbassadorAge" >= 16);

ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_reapplication_not_negative"
  CHECK ("reapplicationDelayMonths" >= 0);
