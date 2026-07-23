-- AlterEnum
ALTER TYPE "ApplicationArtifactKind" ADD VALUE 'ADMISSION_LETTER';

-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'ADMISSION_LETTER_SENT';

-- AlterEnum
ALTER TYPE "DigitalSafeDocumentCategory" ADD VALUE 'ADMISSION_LETTER';

-- DropIndex
DROP INDEX "ApplicationArtifact_storageKey_key";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "candidateSignedAt" TIMESTAMP(3),
ADD COLUMN     "candidateSignedIp" TEXT,
ADD COLUMN     "candidateSignedName" TEXT,
ADD COLUMN     "organizationSignedAt" TIMESTAMP(3),
ADD COLUMN     "organizationSignedIp" TEXT,
ADD COLUMN     "organizationSignedName" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApplicationArtifact" DROP COLUMN "checksum",
DROP COLUMN "mimeType",
DROP COLUMN "sizeBytes",
DROP COLUMN "storageKey",
DROP COLUMN "title",
ADD COLUMN     "digitalSafeDocumentId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "fullName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_digitalSafeDocumentId_key" ON "ApplicationArtifact"("digitalSafeDocumentId");
