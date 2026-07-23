-- CreateEnum
CREATE TYPE "NeedRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OpportunityType" ADD VALUE 'VOLUNTEER';
ALTER TYPE "OpportunityType" ADD VALUE 'TEMPORARY';

-- CreateTable
CREATE TABLE "OrganizationNeedRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "status" "NeedRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationNeedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationNeedRequest_organizationId_idx" ON "OrganizationNeedRequest"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationNeedRequest_status_idx" ON "OrganizationNeedRequest"("status");

-- AddForeignKey
ALTER TABLE "OrganizationNeedRequest" ADD CONSTRAINT "OrganizationNeedRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationNeedRequest" ADD CONSTRAINT "OrganizationNeedRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
