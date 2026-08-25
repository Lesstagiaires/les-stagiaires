-- V6-5 — LE REGISTRE DES AVIS D'ABONNEMENT
--
-- STRICTEMENT ADDITIVE. Aucune table existante n'est modifiée, aucune colonne
-- n'est retirée, aucune donnée n'est réécrite. Elle ne dépend d'aucune des
-- migrations antérieures autrement que par la clé étrangère vers "Subscription",
-- créée en 20260727221856.

-- CreateEnum
CREATE TYPE "SubscriptionNoticeType" AS ENUM ('ACTIVATED', 'RENEWED', 'COVERAGE_ENDED', 'RENEWAL_WINDOW_OPEN', 'EXPIRING_SOON');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_COVERAGE_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL_WINDOW_OPEN';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRING_SOON';

-- CreateTable
CREATE TABLE "SubscriptionNotice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "SubscriptionNoticeType" NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionNotice_subscriptionId_idx" ON "SubscriptionNotice"("subscriptionId");

-- ============================================================================
-- LA GARANTIE STRUCTURELLE — DEUX INDEX UNIQUES PARTIELS
--
-- Prisma ne sait pas exprimer un index PARTIEL dans schema.prisma. Ils sont donc
-- créés ici, en SQL, exactement comme l'index d'unicité de P1-1
-- (20260818090000). Prisma ne les gère pas : `subscription-notices.integration.spec.ts`
-- vérifie leur DÉFINITION EXACTE, pour qu'une dérive soit une erreur bruyante
-- plutôt qu'un silence.
--
-- POURQUOI DEUX ET NON UN. PostgreSQL ne fait jamais entrer deux NULL en
-- collision. Un index unique ordinaire sur (subscriptionId, type, periodEnd)
-- laisserait donc passer autant d'avis qu'on veut pour un ONE_TIME, dont
-- `periodEnd` est nul. Chaque cas a donc sa clé :
--
--   — abonnement PÉRIODIQUE : un avis par période, la période étant identifiée
--     par sa date de fin. Une reconduction change cette date, donc la clé, donc
--     la nouvelle période retrouve ses avis sans aucune remise à zéro ;
--
--   — abonnement ONE_TIME : un avis par abonnement, tout court. Il n'a pas de
--     période, et `assertRenouvelable` lui refuse déjà toute reconduction.
--
-- C'est la base qui tranche, jamais le code : deux workers concurrents peuvent
-- lire le même « rien » et tenter tous deux l'insertion — le second reçoit une
-- violation d'unicité et n'envoie rien.
-- ============================================================================
CREATE UNIQUE INDEX "SubscriptionNotice_periode_key"
    ON "SubscriptionNotice" ("subscriptionId", "type", "periodEnd")
    WHERE "periodEnd" IS NOT NULL;

CREATE UNIQUE INDEX "SubscriptionNotice_sans_periode_key"
    ON "SubscriptionNotice" ("subscriptionId", "type")
    WHERE "periodEnd" IS NULL;

-- AddForeignKey
ALTER TABLE "SubscriptionNotice" ADD CONSTRAINT "SubscriptionNotice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
