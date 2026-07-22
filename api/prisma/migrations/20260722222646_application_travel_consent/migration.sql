-- CreateEnum
CREATE TYPE "TravelConsentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'AWAITING_TRAVEL_CONSENT';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "hasFamilyInDestination" BOOLEAN;

-- CreateTable
CREATE TABLE "TravelConsent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "TravelConsentStatus" NOT NULL DEFAULT 'PENDING',
    "consentCodeHash" TEXT,
    "consentExpiresAt" TIMESTAMP(3),
    "consentAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxConsentAttempts" INTEGER NOT NULL DEFAULT 5,
    "flaggedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelConsent_applicationId_key" ON "TravelConsent"("applicationId");

-- AddForeignKey
ALTER TABLE "TravelConsent" ADD CONSTRAINT "TravelConsent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
