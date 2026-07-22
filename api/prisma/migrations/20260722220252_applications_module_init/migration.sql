-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_DOCUMENT_REQUESTED', 'INTERVIEW_PROPOSED', 'INTERVIEW_CONFIRMED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ApplicationDocumentRequestStatus" AS ENUM ('PENDING', 'FULFILLED');

-- CreateEnum
CREATE TYPE "ApplicationArtifactKind" AS ENUM ('CONVENTION', 'ATTESTATION');

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "dossierSnapshot" JSONB NOT NULL,
    "willingToRelocate" BOOLEAN,
    "interviewProposedAt" TIMESTAMP(3),
    "interviewMode" TEXT,
    "interviewLocation" TEXT,
    "interviewConfirmedAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationStatusEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDocumentRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ApplicationDocumentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "fulfilledDigitalSafeDocumentId" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationArtifact" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "ApplicationArtifactKind" NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_reference_key" ON "Application"("reference");

-- CreateIndex
CREATE INDEX "Application_candidateId_idx" ON "Application"("candidateId");

-- CreateIndex
CREATE INDEX "Application_organizationId_idx" ON "Application"("organizationId");

-- CreateIndex
CREATE INDEX "Application_opportunityId_idx" ON "Application"("opportunityId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "ApplicationStatusEvent_applicationId_idx" ON "ApplicationStatusEvent"("applicationId");

-- CreateIndex
CREATE INDEX "ApplicationDocumentRequest_applicationId_idx" ON "ApplicationDocumentRequest"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_storageKey_key" ON "ApplicationArtifact"("storageKey");

-- CreateIndex
CREATE INDEX "ApplicationArtifact_applicationId_idx" ON "ApplicationArtifact"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_applicationId_kind_key" ON "ApplicationArtifact"("applicationId", "kind");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationStatusEvent" ADD CONSTRAINT "ApplicationStatusEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDocumentRequest" ADD CONSTRAINT "ApplicationDocumentRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationArtifact" ADD CONSTRAINT "ApplicationArtifact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
