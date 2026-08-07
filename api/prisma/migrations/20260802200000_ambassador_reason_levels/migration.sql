-- CreateEnum
CREATE TYPE "AmbassadorDecisionReason" AS ENUM ('INCOMPLETE_FILE', 'IDENTITY_NOT_VERIFIED', 'DOCUMENTS_EXPIRED', 'INELIGIBLE_PROFILE', 'DUPLICATE_APPLICATION', 'CONTRACT_BREACH', 'CONDUCT_REVIEW', 'COMPLIANCE_REVIEW', 'INACTIVITY', 'AMBASSADOR_REQUEST', 'MUTUAL_AGREEMENT', 'PAYMENT_DETAILS_INVALID', 'PAYMENT_DETAILS_RECENTLY_CHANGED', 'INSUFFICIENT_BALANCE', 'VERIFICATION_PENDING', 'NO_PUBLIC_REASON', 'NOT_DISCLOSED');

-- CreateEnum
CREATE TYPE "AmbassadorEventVisibility" AS ENUM ('ADMIN_ONLY', 'AMBASSADOR');

-- AlterTable
ALTER TABLE "Ambassador" ADD COLUMN     "informationRequestedPublicMessage" TEXT,
ADD COLUMN     "informationRequestedReasonCode" "AmbassadorDecisionReason",
ADD COLUMN     "rejectionPublicMessage" TEXT,
ADD COLUMN     "rejectionReasonCode" "AmbassadorDecisionReason",
ADD COLUMN     "suspensionPublicMessage" TEXT,
ADD COLUMN     "suspensionReasonCode" "AmbassadorDecisionReason",
ADD COLUMN     "terminationPublicMessage" TEXT,
ADD COLUMN     "terminationReasonCode" "AmbassadorDecisionReason";

-- AlterTable
ALTER TABLE "AmbassadorEvent" ADD COLUMN     "fromStatus" "AmbassadorStatus",
ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "notifiedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notifiedTypes" "NotificationType"[],
ADD COLUMN     "publicMessage" TEXT,
ADD COLUMN     "reasonCode" "AmbassadorDecisionReason",
ADD COLUMN     "toStatus" "AmbassadorStatus",
ADD COLUMN     "visibility" "AmbassadorEventVisibility" NOT NULL DEFAULT 'ADMIN_ONLY';

-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN     "rejectionPublicMessage" TEXT,
ADD COLUMN     "rejectionReasonCode" "AmbassadorDecisionReason";
