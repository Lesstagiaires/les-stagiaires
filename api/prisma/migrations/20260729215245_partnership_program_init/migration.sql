-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED', 'REFUSED');

-- CreateEnum
CREATE TYPE "PartnershipParty" AS ENUM ('ORGANIZATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PartnershipEventType" AS ENUM ('REQUESTED', 'APPROVED', 'REFUSED', 'RENEWED', 'TERMINATION_NOTICED', 'TERMINATION_WITHDRAWN', 'ENDED', 'SUSPENDED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "CitizenLabelTier" AS ENUM ('NONE', 'BRONZE', 'ARGENT', 'OR');

-- CreateTable
CREATE TABLE "Partnership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'PENDING',
    "motivation" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "startsAt" TIMESTAMP(3),
    "termEndsAt" TIMESTAMP(3),
    "terminationNoticedAt" TIMESTAMP(3),
    "terminationNoticedBy" "PartnershipParty",
    "terminationReason" TEXT,
    "terminationEffectiveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipEvent" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "type" "PartnershipEventType" NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitizenScoreSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "CitizenLabelTier" NOT NULL,
    "breakdown" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitizenScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "documentId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partnership_organizationId_key" ON "Partnership"("organizationId");

-- CreateIndex
CREATE INDEX "Partnership_status_idx" ON "Partnership"("status");

-- CreateIndex
CREATE INDEX "Partnership_termEndsAt_idx" ON "Partnership"("termEndsAt");

-- CreateIndex
CREATE INDEX "Partnership_terminationEffectiveAt_idx" ON "Partnership"("terminationEffectiveAt");

-- CreateIndex
CREATE INDEX "PartnershipEvent_partnershipId_idx" ON "PartnershipEvent"("partnershipId");

-- CreateIndex
CREATE INDEX "CitizenScoreSnapshot_organizationId_computedAt_idx" ON "CitizenScoreSnapshot"("organizationId", "computedAt");

-- CreateIndex
CREATE INDEX "ImpactReport_organizationId_idx" ON "ImpactReport"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactReport_organizationId_year_key" ON "ImpactReport"("organizationId", "year");

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipEvent" ADD CONSTRAINT "PartnershipEvent_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipEvent" ADD CONSTRAINT "PartnershipEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitizenScoreSnapshot" ADD CONSTRAINT "CitizenScoreSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactReport" ADD CONSTRAINT "ImpactReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactReport" ADD CONSTRAINT "ImpactReport_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- REPRISE DE DONNÉES — ne jamais omettre.
--
-- Organization.partnershipSignedAt portait jusqu'ici le partenariat sous forme
-- d'un simple horodatage. Créer la table Partnership sans y reprendre ces lignes
-- laisserait des partenaires historiques invisibles du nouveau module : leur
-- badge disparaîtrait sans que personne ne s'en aperçoive.
--
-- Précédent sur ce projet : une régression de protection des mineurs est née
-- exactement de cet oubli (migration 20260728074326) — une valeur ajoutée au code
-- sans migration des lignes déjà en base.
--
-- partnershipSignedAt est CONSERVÉ pour l'instant : on ne supprime une colonne
-- source qu'après avoir vérifié la reprise en production. La dépréciation fera
-- l'objet d'une migration ultérieure.
--
-- Reconduction tacite d'un an : termEndsAt est calculé sur l'anniversaire à venir
-- de la signature, pas sur « signature + 1 an » qui pourrait tomber dans le passé
-- pour un partenariat ancien et déclencher une échéance à tort.
-- ============================================================================
INSERT INTO "Partnership" (
  "id", "organizationId", "status", "motivation",
  "requestedAt", "decidedAt", "startsAt", "termEndsAt",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  o."id",
  'ACTIVE'::"PartnershipStatus",
  'Partenariat repris automatiquement lors de la migration vers le module Programme de Partenariat (signé le ' || to_char(o."partnershipSignedAt", 'DD/MM/YYYY') || ').',
  o."partnershipSignedAt",
  o."partnershipSignedAt",
  o."partnershipSignedAt",
  -- Prochain anniversaire de la signature, strictement dans le futur.
  o."partnershipSignedAt" + (
    (GREATEST(0, date_part('year', age(CURRENT_TIMESTAMP, o."partnershipSignedAt")))::int + 1)
    * INTERVAL '1 year'
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
WHERE o."partnershipSignedAt" IS NOT NULL;

-- L'historique doit refléter la reprise : un partenariat sans aucun événement
-- serait indistinguable d'une incohérence de données.
INSERT INTO "PartnershipEvent" ("id", "partnershipId", "type", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  p."id",
  'APPROVED'::"PartnershipEventType",
  jsonb_build_object('migratedFrom', 'Organization.partnershipSignedAt'),
  p."startsAt"
FROM "Partnership" p;
