-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('ENTREPRISE', 'ETABLISSEMENT');

-- CreateEnum
CREATE TYPE "LearnerStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "InternshipCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InternshipReportStatus" AS ENUM ('SUBMITTED', 'NEEDS_REVISION', 'VALIDATED');

-- AlterEnum
ALTER TYPE "DigitalSafeDocumentCategory" ADD VALUE 'INTERNSHIP_REPORT';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "type" "OrganizationType" NOT NULL DEFAULT 'ENTREPRISE';

-- CreateTable
CREATE TABLE "EstablishmentLearner" (
    "id" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LearnerStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EstablishmentLearner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternshipCampaign" (
    "id" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "InternshipCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternshipCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternshipReport" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "digitalSafeDocumentId" TEXT NOT NULL,
    "status" "InternshipReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternshipReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstablishmentLearner_establishmentId_idx" ON "EstablishmentLearner"("establishmentId");

-- CreateIndex
CREATE INDEX "EstablishmentLearner_userId_idx" ON "EstablishmentLearner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EstablishmentLearner_establishmentId_userId_key" ON "EstablishmentLearner"("establishmentId", "userId");

-- CreateIndex
CREATE INDEX "InternshipCampaign_establishmentId_idx" ON "InternshipCampaign"("establishmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InternshipReport_applicationId_key" ON "InternshipReport"("applicationId");

-- AddForeignKey
ALTER TABLE "EstablishmentLearner" ADD CONSTRAINT "EstablishmentLearner_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentLearner" ADD CONSTRAINT "EstablishmentLearner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternshipCampaign" ADD CONSTRAINT "InternshipCampaign_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternshipReport" ADD CONSTRAINT "InternshipReport_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternshipReport" ADD CONSTRAINT "InternshipReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
