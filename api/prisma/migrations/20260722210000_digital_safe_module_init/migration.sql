-- CreateEnum
CREATE TYPE "DigitalSafeDocumentCategory" AS ENUM ('IDENTITY', 'DIPLOMA', 'CONVENTION', 'CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ShareTargetType" AS ENUM ('USER', 'LINK');

-- CreateEnum
CREATE TYPE "DigitalSafeAccessAction" AS ENUM ('VIEWED', 'DOWNLOADED', 'SHARE_CREATED', 'SHARE_REVOKED');

-- CreateTable
CREATE TABLE "DigitalSafeDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "DigitalSafeDocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletionScheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalSafeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalSafeDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalSafeDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalSafeShare" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetType" "ShareTargetType" NOT NULL,
    "sharedWithUserId" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalSafeShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalSafeAccessLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "shareId" TEXT,
    "actorUserId" TEXT,
    "action" "DigitalSafeAccessAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalSafeAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigitalSafeDocument_userId_idx" ON "DigitalSafeDocument"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalSafeDocumentVersion_storageKey_key" ON "DigitalSafeDocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalSafeDocumentVersion_documentId_versionNumber_key" ON "DigitalSafeDocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalSafeShare_tokenHash_key" ON "DigitalSafeShare"("tokenHash");

-- CreateIndex
CREATE INDEX "DigitalSafeShare_documentId_idx" ON "DigitalSafeShare"("documentId");

-- CreateIndex
CREATE INDEX "DigitalSafeAccessLog_documentId_idx" ON "DigitalSafeAccessLog"("documentId");

-- AddForeignKey
ALTER TABLE "DigitalSafeDocument" ADD CONSTRAINT "DigitalSafeDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeDocumentVersion" ADD CONSTRAINT "DigitalSafeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeShare" ADD CONSTRAINT "DigitalSafeShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeShare" ADD CONSTRAINT "DigitalSafeShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeAccessLog" ADD CONSTRAINT "DigitalSafeAccessLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeAccessLog" ADD CONSTRAINT "DigitalSafeAccessLog_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "DigitalSafeShare"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSafeAccessLog" ADD CONSTRAINT "DigitalSafeAccessLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
