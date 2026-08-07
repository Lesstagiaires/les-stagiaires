-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AmbassadorEventType" ADD VALUE 'REVIEW_STARTED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'INFORMATION_REQUESTED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'IDENTITY_VERIFIED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'REJECTED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'CHARTER_SIGNED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'TRAINING_COMPLETED';
ALTER TYPE "AmbassadorEventType" ADD VALUE 'ACTIVATED';

-- AlterEnum
BEGIN;
CREATE TYPE "AmbassadorStatus_new" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'VERIFIED', 'APPROVED', 'CONTRACT_PENDING', 'TRAINING_PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'REJECTED');
ALTER TABLE "public"."Ambassador" ALTER COLUMN "status" DROP DEFAULT;
-- Remappage EXPLICITE de l'ancien statut unique d'entrée.
--
-- La clause générée par défaut (status::text::nouveau_type) échouerait sur toute
-- ligne encore en PENDING, valeur qui n'existe plus dans le cycle en onze
-- statuts. La base de développement n'en contient pas aujourd'hui — mais une
-- migration doit fonctionner sur N'IMPORTE QUELLE base, pas seulement sur celle
-- qu'on a sous les yeux.
ALTER TABLE "Ambassador" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ambassador" ALTER COLUMN "status" TYPE "AmbassadorStatus_new"
  USING (CASE "status"::text
    WHEN 'PENDING' THEN 'SUBMITTED'
    ELSE "status"::text
  END)::"AmbassadorStatus_new";
ALTER TYPE "AmbassadorStatus" RENAME TO "AmbassadorStatus_old";
ALTER TYPE "AmbassadorStatus_new" RENAME TO "AmbassadorStatus";
DROP TYPE "public"."AmbassadorStatus_old";
ALTER TABLE "Ambassador" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
ALTER TABLE "Ambassador" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
COMMIT;

-- AlterTable
ALTER TABLE "Ambassador" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activatedById" TEXT,
ADD COLUMN     "charterSignedAt" TIMESTAMP(3),
ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "identityVerifiedById" TEXT,
ADD COLUMN     "informationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "informationRequestedReason" TEXT,
ADD COLUMN     "quizScore" INTEGER,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "trainingCompletedAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'SUBMITTED',
ALTER COLUMN "code" DROP NOT NULL;
