ALTER TYPE "PartnershipRequestReason" ADD VALUE IF NOT EXISTS 'MARKETING_PROJECT';
ALTER TYPE "PartnershipRequestReason" ADD VALUE IF NOT EXISTS 'INTERN_RECRUITMENT_REQUEST';
ALTER TYPE "PartnershipRequestReason" ADD VALUE IF NOT EXISTS 'OTHER_ORGANIZATION_NEED';

CREATE TYPE "PartnershipRequestCategory" AS ENUM ('GENERAL', 'NEED_QUOTE');
ALTER TYPE "PartnershipRequestStatus" ADD VALUE IF NOT EXISTS 'QUOTE_PENDING';
ALTER TYPE "PartnershipRequestStatus" ADD VALUE IF NOT EXISTS 'QUOTE_SENT';

ALTER TABLE "PartnershipRequest"
  ADD COLUMN "category" "PartnershipRequestCategory" NOT NULL DEFAULT 'GENERAL';

CREATE INDEX "PartnershipRequest_category_idx"
  ON "PartnershipRequest" ("category");