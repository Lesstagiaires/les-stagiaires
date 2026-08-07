-- ============================================================================
-- PLAFONDS DE COMMISSION ET STATUT DE CONTRÔLE
-- Arbitrage 15 du promoteur, 2026-08-02, phase 1 item 5.
--
-- « Je valide la création de plafonds configurables. Merci de prévoir au
-- minimum : un plafond par transaction ; un plafond journalier ; un plafond
-- mensuel ; éventuellement un plafond par campagne ou produit. Le dépassement
-- ne doit pas entraîner une réduction silencieuse. La commission doit être
-- placée dans un statut de contrôle, par exemple REVIEW_REQUIRED.
-- L'administration doit alors valider ou corriger la commission, avec
-- journalisation complète. »
--
-- LE POINT CENTRAL : un plafond ne rogne rien. La commission naît pour son
-- montant COMPLET, en REVIEW_REQUIRED, et rien n'est crédité au portefeuille.
-- Rogner en silence donnerait à l'ambassadeur un montant inférieur à ce que le
-- barème lui promettait, sans explication et sans que personne n'ait décidé.
--
-- UNE SEULE TABLE de plafonds plutôt que six colonnes sur la politique pays :
-- la portée (ambassadeur / campagne / produit) et la fenêtre (transaction /
-- jour / mois / total) sont deux axes indépendants. Les exprimer en données
-- rend un septième plafond possible sans migration.
-- ============================================================================

-- --- 1. Le statut de contrôle ------------------------------------------------
-- PostgreSQL interdit d'utiliser une valeur d'énumération dans la même
-- transaction que son ajout. Cette migration ne s'en sert pas — elle ne fait
-- que déclarer — donc rien à découper ici.
ALTER TYPE "CommissionStatus" ADD VALUE 'REVIEW_REQUIRED' AFTER 'PENDING';

ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_COMMISSION_REVIEW_REQUIRED';

CREATE TYPE "CommissionCapScope" AS ENUM ('AMBASSADOR', 'CAMPAIGN', 'PRODUCT');
CREATE TYPE "CommissionCapWindow" AS ENUM ('TRANSACTION', 'DAY', 'MONTH', 'LIFETIME');
CREATE TYPE "CommissionReviewReason" AS ENUM ('CAP_EXCEEDED');

-- --- 2. Les plafonds ---------------------------------------------------------
CREATE TABLE "CommissionCap" (
  "id"          TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "scope"       "CommissionCapScope" NOT NULL,
  "scopeKey"    TEXT,
  "countryCode" TEXT,
  "window"      "CommissionCapWindow" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency"    TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommissionCap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionCap_isActive_scope_idx" ON "CommissionCap"("isActive", "scope");
CREATE INDEX "CommissionCap_scope_scopeKey_idx" ON "CommissionCap"("scope", "scopeKey");

-- Un plafond à zéro ou négatif n'est pas un plafond : c'est une interdiction
-- déguisée, qui mettrait TOUTE commission en contrôle sans que personne ne l'ait
-- voulu. Si l'on veut suspendre les commissions d'un pays, la politique pays a
-- déjà `commissionsEnabled` pour le dire clairement.
ALTER TABLE "CommissionCap" ADD CONSTRAINT "CommissionCap_amount_positive"
  CHECK ("amountMinor" > 0);

-- La clé de portée accompagne obligatoirement une campagne ou un produit, et n'a
-- aucun sens pour un plafond par ambassadeur. Sans cette contrainte, un plafond
-- de campagne sans clé s'appliquerait silencieusement à TOUTES les campagnes.
ALTER TABLE "CommissionCap" ADD CONSTRAINT "CommissionCap_scope_key_coherent"
  CHECK (
    ("scope" = 'AMBASSADOR' AND "scopeKey" IS NULL)
    OR
    ("scope" <> 'AMBASSADOR' AND "scopeKey" IS NOT NULL)
  );

-- --- 3. Ce que la commission garde du contrôle -------------------------------
ALTER TABLE "Commission"
  ADD COLUMN "appliedCampaignKey"  TEXT,
  ADD COLUMN "capTrace"            JSONB,
  ADD COLUMN "reviewReason"        "CommissionReviewReason",
  ADD COLUMN "reviewedById"        TEXT,
  ADD COLUMN "reviewedAt"          TIMESTAMP(3),
  ADD COLUMN "originalAmountMinor" INTEGER;

-- Rétro-remplissage de la clé de campagne depuis les barèmes encore présents.
-- Les commissions dont la règle a disparu restent sans clé : c'est exact, et
-- préférable à une clé devinée.
UPDATE "Commission" c
   SET "appliedCampaignKey" = r."campaignKey"
  FROM "CommissionRule" r
 WHERE r.id = c."appliedRuleId" AND r."campaignKey" IS NOT NULL;

CREATE INDEX "Commission_appliedCampaignKey_idx" ON "Commission"("appliedCampaignKey");
CREATE INDEX "Commission_productKey_createdAt_idx" ON "Commission"("productKey", "createdAt");

-- LE GARDE-FOU QUI COMPTE. Une correction administrative ne peut aller QUE vers
-- le bas. Le contrôle d'un dépassement de plafond ne doit pas devenir le chemin
-- par lequel un administrateur s'accorde — ou accorde — davantage que ce que le
-- barème prévoyait. En base, parce qu'un contrôle de service se contourne par un
-- UPDATE direct.
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_correction_never_upward"
  CHECK ("originalAmountMinor" IS NULL OR "amountMinor" <= "originalAmountMinor");

-- Une correction à zéro n'est pas une correction, c'est une annulation — et
-- l'annulation a son propre statut, avec son propre motif.
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_amount_positive"
  CHECK ("amountMinor" > 0);
