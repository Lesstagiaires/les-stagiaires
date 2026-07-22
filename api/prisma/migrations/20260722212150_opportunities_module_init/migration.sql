-- CreateEnum
CREATE TYPE "OrganizationVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('ACADEMIC_INTERNSHIP', 'PROFESSIONAL_INTERNSHIP', 'SEASONAL', 'WORK_STUDY');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'FILLED', 'EXPIRED', 'CANCELLED', 'REPORTED', 'SUSPENDED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "targetOpportunityId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "verificationStatus" "OrganizationVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "sector" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "workMode" "WorkMode" NOT NULL DEFAULT 'ON_SITE',
    "relocationRequired" BOOLEAN NOT NULL DEFAULT false,
    "accommodationProvided" BOOLEAN NOT NULL DEFAULT false,
    "mobilityBenefits" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "sector" TEXT,
    "type" "OpportunityType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_ownerId_idx" ON "Organization"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_idx" ON "Opportunity"("organizationId");

-- CreateIndex
CREATE INDEX "Opportunity_status_country_city_idx" ON "Opportunity"("status", "country", "city");

-- CreateIndex
CREATE INDEX "Opportunity_status_sector_idx" ON "Opportunity"("status", "sector");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityFavorite_userId_opportunityId_key" ON "OpportunityFavorite"("userId", "opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityAlert_userId_idx" ON "OpportunityAlert"("userId");

-- CreateIndex
CREATE INDEX "Report_targetOpportunityId_idx" ON "Report"("targetOpportunityId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetOpportunityId_fkey" FOREIGN KEY ("targetOpportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityFavorite" ADD CONSTRAINT "OpportunityFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityFavorite" ADD CONSTRAINT "OpportunityFavorite_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAlert" ADD CONSTRAINT "OpportunityAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
