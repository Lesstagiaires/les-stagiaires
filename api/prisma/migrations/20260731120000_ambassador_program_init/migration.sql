-- CreateEnum
CREATE TYPE "AmbassadorStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AmbassadorCategory" AS ENUM ('CAMPUS', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AmbassadorTier" AS ENUM ('STANDARD', 'BRONZE', 'ARGENT', 'OR', 'PLATINE', 'DIAMANT');

-- CreateEnum
CREATE TYPE "AmbassadorAttributionSource" AS ENUM ('CODE', 'LINK', 'QR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AmbassadorEventType" AS ENUM ('CREATED', 'APPROVED', 'SUSPENDED', 'REINSTATED', 'TERMINATED', 'CONTRACT_SIGNED', 'TIER_CHANGED', 'PORTFOLIO_TRANSFERRED');

-- CreateEnum
CREATE TYPE "PortfolioReleaseReason" AS ENUM ('INACTIVITY', 'ADMIN_TRANSFER', 'ADMIN_RELEASE', 'AMBASSADOR_TERMINATED');

-- CreateEnum
CREATE TYPE "PortfolioEventType" AS ENUM ('ATTRIBUTED', 'PURCHASE_CONFIRMED', 'WARNED_9M', 'WARNED_11M', 'EXPIRED', 'RELEASED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SUBSCRIPTION', 'SERVICE');

-- CreateEnum
CREATE TYPE "CommissionNature" AS ENUM ('ACQUISITION', 'NEW_SERVICE', 'RENEWAL', 'BONUS');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAYABLE', 'PAID', 'CANCELLED', 'REVERSED', 'DISPUTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('COMMISSION_ACCRUED', 'COMMISSION_AVAILABLE', 'COMMISSION_CANCELLED', 'COMMISSION_REVERSED', 'PAYOUT_RESERVED', 'PAYOUT_RELEASED', 'PAYOUT_EXECUTED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutRequestStatus" AS ENUM ('REQUESTED', 'VALIDATED', 'EXECUTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrganizationAcquisitionSource" AS ENUM ('AMBASSADOR', 'INTERNET', 'SOCIAL_MEDIA', 'UNIVERSITY', 'SCHOOL', 'TRAINING_CENTER', 'PARTNER_COMPANY', 'TRADE_SHOW', 'ADVERTISING', 'RECOMMENDATION', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionPlan_new" AS ENUM ('GRATUIT', 'CARRIERE_SECURISEE', 'CARRIERE_PLUS', 'BUSINESS', 'INSTITUTION');
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE "SubscriptionPlan_new" USING ("plan"::text::"SubscriptionPlan_new");
ALTER TYPE "SubscriptionPlan" RENAME TO "SubscriptionPlan_old";
ALTER TYPE "SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
DROP TYPE "public"."SubscriptionPlan_old";
COMMIT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "acquisitionSource" "OrganizationAcquisitionSource",
ADD COLUMN     "acquisitionSourceNote" TEXT;

-- CreateTable
CREATE TABLE "Ambassador" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AmbassadorStatus" NOT NULL DEFAULT 'PENDING',
    "code" TEXT NOT NULL,
    "categories" "AmbassadorCategory"[],
    "tier" "AmbassadorTier" NOT NULL DEFAULT 'STANDARD',
    "countryCode" TEXT NOT NULL,
    "contractSignedAt" TIMESTAMP(3),
    "contractReference" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ambassador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorEvent" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "type" "AmbassadorEventType" NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorReferral" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "source" "AmbassadorAttributionSource" NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminReason" TEXT,
    "attributedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmbassadorReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorPortfolioEntry" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "AmbassadorAttributionSource" NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminReason" TEXT,
    "attributedById" TEXT,
    "lastConfirmedPurchaseAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "warnedAt9m" TIMESTAMP(3),
    "warnedAt11m" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" "PortfolioReleaseReason",
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorPortfolioEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioEvent" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "type" "PortfolioEventType" NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "productKey" TEXT,
    "nature" "CommissionNature" NOT NULL,
    "ambassadorCategory" "AmbassadorCategory",
    "ambassadorTier" "AmbassadorTier",
    "countryCode" TEXT,
    "campaignKey" TEXT,
    "rateBasisPoints" INTEGER NOT NULL,
    "minAmountMinor" INTEGER,
    "maxAmountMinor" INTEGER,
    "minMonthlySalesCount" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "nature" "CommissionNature" NOT NULL,
    "referralId" TEXT,
    "portfolioEntryId" TEXT,
    "productType" "ProductType" NOT NULL,
    "productKey" TEXT NOT NULL,
    "basisAmountMinor" INTEGER NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "appliedRuleId" TEXT,
    "resolutionTrace" JSONB,
    "securityPeriodEndsAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "payableAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEvent" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorWallet" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "pendingMinor" INTEGER NOT NULL DEFAULT 0,
    "availableMinor" INTEGER NOT NULL DEFAULT 0,
    "reservedMinor" INTEGER NOT NULL DEFAULT 0,
    "paidTotalMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "availableAfterMinor" INTEGER NOT NULL,
    "pendingAfterMinor" INTEGER NOT NULL,
    "commissionId" TEXT,
    "payoutRequestId" TEXT,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "status" "PayoutRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "executedById" TEXT,
    "executionReference" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorPolicy" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "portfolioExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "portfolioWarnMonths" INTEGER[] DEFAULT ARRAY[9, 11]::INTEGER[],
    "securityPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "minPayoutAmountMinor" INTEGER NOT NULL DEFAULT 500000,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "commissionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_userId_key" ON "Ambassador"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Ambassador_code_key" ON "Ambassador"("code");

-- CreateIndex
CREATE INDEX "Ambassador_status_idx" ON "Ambassador"("status");

-- CreateIndex
CREATE INDEX "Ambassador_countryCode_idx" ON "Ambassador"("countryCode");

-- CreateIndex
CREATE INDEX "AmbassadorEvent_ambassadorId_idx" ON "AmbassadorEvent"("ambassadorId");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorReferral_referredUserId_key" ON "AmbassadorReferral"("referredUserId");

-- CreateIndex
CREATE INDEX "AmbassadorReferral_ambassadorId_idx" ON "AmbassadorReferral"("ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorPortfolioEntry_ambassadorId_idx" ON "AmbassadorPortfolioEntry"("ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorPortfolioEntry_organizationId_idx" ON "AmbassadorPortfolioEntry"("organizationId");

-- CreateIndex
CREATE INDEX "AmbassadorPortfolioEntry_releasedAt_expiresAt_idx" ON "AmbassadorPortfolioEntry"("releasedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "PortfolioEvent_entryId_idx" ON "PortfolioEvent"("entryId");

-- CreateIndex
CREATE INDEX "CommissionRule_productType_nature_isActive_idx" ON "CommissionRule"("productType", "nature", "isActive");

-- CreateIndex
CREATE INDEX "CommissionRule_countryCode_idx" ON "CommissionRule"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_paymentId_key" ON "Commission"("paymentId");

-- CreateIndex
CREATE INDEX "Commission_ambassadorId_status_idx" ON "Commission"("ambassadorId", "status");

-- CreateIndex
CREATE INDEX "Commission_status_securityPeriodEndsAt_idx" ON "Commission"("status", "securityPeriodEndsAt");

-- CreateIndex
CREATE INDEX "CommissionEvent_commissionId_idx" ON "CommissionEvent"("commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorWallet_ambassadorId_key" ON "AmbassadorWallet"("ambassadorId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutRequest_ambassadorId_status_idx" ON "PayoutRequest"("ambassadorId", "status");

-- CreateIndex
CREATE INDEX "PayoutRequest_status_idx" ON "PayoutRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorPolicy_countryCode_key" ON "AmbassadorPolicy"("countryCode");

-- CreateIndex
CREATE INDEX "Organization_acquisitionSource_idx" ON "Organization"("acquisitionSource");

-- AddForeignKey
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ambassador" ADD CONSTRAINT "Ambassador_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorEvent" ADD CONSTRAINT "AmbassadorEvent_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorEvent" ADD CONSTRAINT "AmbassadorEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorReferral" ADD CONSTRAINT "AmbassadorReferral_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorReferral" ADD CONSTRAINT "AmbassadorReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorPortfolioEntry" ADD CONSTRAINT "AmbassadorPortfolioEntry_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorPortfolioEntry" ADD CONSTRAINT "AmbassadorPortfolioEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioEvent" ADD CONSTRAINT "PortfolioEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AmbassadorPortfolioEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "AmbassadorReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_portfolioEntryId_fkey" FOREIGN KEY ("portfolioEntryId") REFERENCES "AmbassadorPortfolioEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_appliedRuleId_fkey" FOREIGN KEY ("appliedRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEvent" ADD CONSTRAINT "CommissionEvent_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorWallet" ADD CONSTRAINT "AmbassadorWallet_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AmbassadorWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Garanties structurelles que le schéma Prisma ne sait pas exprimer.
-- Écrites à la main, volontairement : ce sont les invariants sur lesquels
-- repose l'argent. Les faire tenir par la base plutôt que par du code, c'est
-- s'assurer qu'aucun chemin d'appel oublié ne puisse les violer.
-- ============================================================================

-- INVARIANT 1 — Une organisation n'a jamais deux rattachements ACTIFS à la fois.
-- Index unique PARTIEL : la contrainte ne porte que sur les lignes vivantes
-- (releasedAt IS NULL). Les cycles passés s'empilent librement, ce qui permet de
-- garder l'historique complet d'un portefeuille — « qui détenait cette entreprise
-- en 2027 ? » doit rester répondable — sans jamais autoriser deux ambassadeurs à
-- se disputer la même commission.
CREATE UNIQUE INDEX "AmbassadorPortfolioEntry_active_org_unique"
  ON "AmbassadorPortfolioEntry" ("organizationId")
  WHERE "releasedAt" IS NULL;

-- INVARIANT 2 — Une commission repose toujours sur une attribution réelle.
-- Exactement une justification : un parrainage de jeune OU un rattachement
-- d'entreprise, jamais les deux, jamais aucune. C'est la traduction en base de la
-- règle « la commission ne peut être générée que lorsqu'il existe une attribution
-- valide » : sans cette contrainte, un défaut de code pourrait faire naître une
-- commission sans bénéficiaire justifié.
ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_exactly_one_attribution"
  CHECK (
    ("referralId" IS NOT NULL AND "portfolioEntryId" IS NULL)
    OR
    ("referralId" IS NULL AND "portfolioEntryId" IS NOT NULL)
  );

-- INVARIANT 3 — Aucun taux aberrant ne peut être enregistré.
-- Bornes larges à dessein (0 à 100 %) : elles n'arbitrent pas la politique
-- commerciale, elles empêchent seulement qu'une saisie à 20000 points de base
-- (200 %) passe en production.
ALTER TABLE "CommissionRule"
  ADD CONSTRAINT "CommissionRule_rate_within_bounds"
  CHECK ("rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000);

ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_rate_within_bounds"
  CHECK ("rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000);

-- INVARIANT 4 — Pas de commission négative, pas d'assiette négative.
ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_amounts_non_negative"
  CHECK ("amountMinor" >= 0 AND "basisAmountMinor" >= 0);

-- INVARIANT 5 — Un solde de portefeuille ne descend jamais sous zéro.
-- Un solde négatif signifierait qu'on a versé de l'argent qui n'existait pas.
ALTER TABLE "AmbassadorWallet"
  ADD CONSTRAINT "AmbassadorWallet_balances_non_negative"
  CHECK (
    "pendingMinor" >= 0 AND "availableMinor" >= 0
    AND "reservedMinor" >= 0 AND "paidTotalMinor" >= 0
  );

-- INVARIANT 6 — Une demande de retrait porte toujours un montant strictement positif.
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_amount_positive"
  CHECK ("amountMinor" > 0);

-- ============================================================================
-- Politique de repli du programme.
--
-- Même précaution que pour CountryPolicy : une ligne "*" est créée dès la
-- migration pour qu'aucun pays non encore paramétré ne se retrouve sans règle.
-- Les valeurs reprennent les arbitrages du promoteur du 2026-07-31 — douze mois
-- d'inactivité, alertes à neuf et onze mois.
--
-- payoutsEnabled = false À DESSEIN : le tout premier virement d'un pays reste
-- verrouillé tant qu'un administrateur ne l'ouvre pas explicitement, après
-- signature du Contrat d'Apporteur d'Affaires. Ce défaut protecteur ne doit
-- jamais être inversé « pour simplifier les tests ».
-- ============================================================================
INSERT INTO "AmbassadorPolicy" (
  "id", "countryCode", "portfolioExpiryMonths", "portfolioWarnMonths",
  "securityPeriodDays", "minPayoutAmountMinor", "currency",
  "commissionsEnabled", "payoutsEnabled", "createdAt", "updatedAt"
) VALUES (
  'ambpolicy_default', '*', 12, ARRAY[9, 11],
  30, 500000, 'XAF',
  true, false, NOW(), NOW()
) ON CONFLICT ("countryCode") DO NOTHING;

-- ============================================================================
-- Barème de lancement.
--
-- Ces lignes ne sont PAS des valeurs codées en dur : elles sont modifiables
-- depuis l'administration, datables, désactivables. Les inscrire ici garantit
-- seulement que le moteur dispose d'un barème dès le premier jour.
--
-- productKey NULL = « toutes les offres de ce type ». C'est ce qui permet aux
-- prestations entreprises d'être commissionnées dès leur création au catalogue,
-- sans qu'il faille penser à ajouter une règle à chaque nouvelle prestation.
--
-- Rien n'est prévu ici pour BUSINESS ni INSTITUTION, DÉLIBÉRÉMENT : le promoteur
-- n'a arbitré aucun taux pour ces formules. En l'absence de règle applicable, le
-- moteur ne crée AUCUNE commission et journalise le fait — préférable, sur de
-- l'argent, à l'invention d'un taux plausible.
-- ============================================================================

-- Jeunes : 20 % sur les deux formules individuelles, à la souscription comme au
-- renouvellement (point 4 des arbitrages, qui ne distingue pas les deux cas).
INSERT INTO "CommissionRule" (
  "id", "label", "productType", "productKey", "nature",
  "ambassadorCategory", "rateBasisPoints", "priority", "isActive",
  "validFrom", "createdAt", "updatedAt"
) VALUES
  ('cmrule_cs_acq',  'Carrière Sécurisée — souscription',   'SUBSCRIPTION', 'CARRIERE_SECURISEE', 'ACQUISITION', 'CAMPUS', 2000, 100, true, NOW(), NOW(), NOW()),
  ('cmrule_cs_ren',  'Carrière Sécurisée — renouvellement', 'SUBSCRIPTION', 'CARRIERE_SECURISEE', 'RENEWAL',     'CAMPUS', 2000, 100, true, NOW(), NOW(), NOW()),
  ('cmrule_cp_acq',  'Carrière Plus — souscription',        'SUBSCRIPTION', 'CARRIERE_PLUS',      'ACQUISITION', 'CAMPUS', 2000, 100, true, NOW(), NOW(), NOW()),
  ('cmrule_cp_ren',  'Carrière Plus — renouvellement',      'SUBSCRIPTION', 'CARRIERE_PLUS',      'RENEWAL',     'CAMPUS', 2000, 100, true, NOW(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Entreprises : barème d'acquisition puis de fidélisation (point 5).
-- 15 % en haut de la fourchette 10-15 % annoncée : le taux se règle prestation
-- par prestation depuis l'administration, en ajoutant une règle plus spécifique
-- (productKey renseigné) qui l'emporte sur celle-ci.
INSERT INTO "CommissionRule" (
  "id", "label", "productType", "productKey", "nature",
  "ambassadorCategory", "rateBasisPoints", "priority", "isActive",
  "validFrom", "createdAt", "updatedAt"
) VALUES
  ('cmrule_srv_acq', 'Prestation entreprise — première vente',       'SERVICE', NULL, 'ACQUISITION', 'BUSINESS', 1500, 50, true, NOW(), NOW(), NOW()),
  ('cmrule_srv_new', 'Prestation entreprise — nouvelle prestation',  'SERVICE', NULL, 'NEW_SERVICE', 'BUSINESS',  800, 50, true, NOW(), NOW(), NOW()),
  ('cmrule_srv_ren', 'Prestation entreprise — renouvellement',       'SERVICE', NULL, 'RENEWAL',     'BUSINESS',  500, 50, true, NOW(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
