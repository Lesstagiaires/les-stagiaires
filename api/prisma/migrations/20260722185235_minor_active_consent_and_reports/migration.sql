-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('HARASSMENT', 'ABUSE', 'DANGER', 'FRAUD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'CLOSED');

-- AlterEnum
ALTER TYPE "ParentalLinkStatus" ADD VALUE 'EXPIRED';

-- DropForeignKey
ALTER TABLE "ParentalLink" DROP CONSTRAINT "ParentalLink_parentId_fkey";

-- DropIndex
DROP INDEX "ParentalLink_childId_parentId_key";

-- AlterTable
ALTER TABLE "ParentalLink" ADD COLUMN     "consentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consentCodeHash" TEXT,
ADD COLUMN     "consentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "maxConsentAttempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "parentPhone" TEXT NOT NULL,
ALTER COLUMN "parentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "ParentalLink_status_createdAt_idx" ON "ParentalLink"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentalLink_childId_parentPhone_key" ON "ParentalLink"("childId", "parentPhone");

-- AddForeignKey
ALTER TABLE "ParentalLink" ADD CONSTRAINT "ParentalLink_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

