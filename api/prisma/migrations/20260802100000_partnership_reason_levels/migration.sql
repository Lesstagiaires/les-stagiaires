-- CreateEnum
CREATE TYPE "PartnershipDecisionReason" AS ENUM ('INCOMPLETE_FILE', 'DOCUMENTS_NOT_VERIFIED', 'INELIGIBLE_ACTIVITY', 'DUPLICATE_REQUEST', 'CONDITIONS_NOT_MET', 'COMPLIANCE_REVIEW', 'REPORTED_CONTENT', 'INACTIVITY', 'ORGANIZATION_REQUEST', 'MUTUAL_AGREEMENT', 'NOT_DISCLOSED');

-- AlterTable
ALTER TABLE "Partnership" ADD COLUMN     "decisionPublicMessage" TEXT,
ADD COLUMN     "decisionReasonCode" "PartnershipDecisionReason",
ADD COLUMN     "suspensionPublicMessage" TEXT,
ADD COLUMN     "suspensionReasonCode" "PartnershipDecisionReason",
ADD COLUMN     "terminationPublicMessage" TEXT,
ADD COLUMN     "terminationReasonCode" "PartnershipDecisionReason";
