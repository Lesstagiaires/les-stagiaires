-- CreateEnum
CREATE TYPE "PartnershipRequestOrgType" AS ENUM ('COMPANY', 'NGO', 'PUBLIC_ADMINISTRATION', 'INTERNATIONAL_ORGANIZATION', 'UNIVERSITY', 'SCHOOL', 'TRAINING_CENTER', 'CONSULTING_FIRM', 'STARTUP', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnershipRequestReason" AS ENUM ('BECOME_PARTNER', 'PUBLISH_OPPORTUNITIES', 'RECRUITMENT_CAMPAIGN', 'MASS_RECRUITMENT', 'PARTNERSHIP_AGREEMENT', 'PLATFORM_DEMO', 'TRAINING_SUPPORT', 'COMMERCIAL_INFO', 'TECHNICAL_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnershipRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'PROCESSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PartnershipRequestNoteType" AS ENUM ('NOTE', 'STATUS_CHANGE', 'ASSIGNMENT');

-- CreateTable
CREATE TABLE "PartnershipRequest" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationType" "PartnershipRequestOrgType" NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactTitle" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "reason" "PartnershipRequestReason" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PartnershipRequestStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipRequestNote" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "PartnershipRequestNoteType" NOT NULL DEFAULT 'NOTE',
    "content" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipRequestNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnershipRequest_status_idx" ON "PartnershipRequest"("status");

-- CreateIndex
CREATE INDEX "PartnershipRequest_reason_idx" ON "PartnershipRequest"("reason");

-- CreateIndex
CREATE INDEX "PartnershipRequest_assignedToId_idx" ON "PartnershipRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "PartnershipRequestNote_requestId_idx" ON "PartnershipRequestNote"("requestId");

-- AddForeignKey
ALTER TABLE "PartnershipRequest" ADD CONSTRAINT "PartnershipRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipRequestNote" ADD CONSTRAINT "PartnershipRequestNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PartnershipRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnershipRequestNote" ADD CONSTRAINT "PartnershipRequestNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
