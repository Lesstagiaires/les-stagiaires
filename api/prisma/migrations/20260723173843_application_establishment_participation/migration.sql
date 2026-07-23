-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "establishmentParticipationRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "establishmentSignedAt" TIMESTAMP(3),
ADD COLUMN     "establishmentSignedName" TEXT;
