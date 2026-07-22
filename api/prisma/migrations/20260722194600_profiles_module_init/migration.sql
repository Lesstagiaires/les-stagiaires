-- CreateEnum
CREATE TYPE "ProfileSection" AS ENUM ('SUMMARY', 'EDUCATION', 'EXPERIENCE', 'SKILLS', 'LANGUAGES', 'DOCUMENTS', 'RECOMMENDATIONS');

-- CreateEnum
CREATE TYPE "SectionVisibility" AS ENUM ('PRIVATE', 'SHARED', 'NETWORK', 'PUBLIC');

-- CreateEnum
CREATE TYPE "LanguageLevel" AS ENUM ('BASIQUE', 'INTERMEDIAIRE', 'AVANCE', 'COURANT', 'NATIF');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('PHOTO', 'PORTFOLIO', 'OTHER');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "summary" TEXT,
    "activeRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT,
    "fieldOfStudy" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileLanguage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "level" "LanguageLevel" NOT NULL,

    CONSTRAINT "ProfileLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSectionVisibility" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "section" "ProfileSection" NOT NULL,
    "visibility" "SectionVisibility" NOT NULL DEFAULT 'PRIVATE',

    CONSTRAINT "ProfileSectionVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileShare" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "section" "ProfileSection" NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileDocument" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletionScheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Education_profileId_idx" ON "Education"("profileId");

-- CreateIndex
CREATE INDEX "Experience_profileId_idx" ON "Experience"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileLanguage_profileId_language_key" ON "ProfileLanguage"("profileId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSectionVisibility_profileId_section_key" ON "ProfileSectionVisibility"("profileId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileShare_profileId_section_sharedWithUserId_key" ON "ProfileShare"("profileId", "section", "sharedWithUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileDocument_storageKey_key" ON "ProfileDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ProfileDocument_profileId_idx" ON "ProfileDocument"("profileId");

-- CreateIndex
CREATE INDEX "Recommendation_receiverId_idx" ON "Recommendation"("receiverId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_activeRoleId_fkey" FOREIGN KEY ("activeRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileLanguage" ADD CONSTRAINT "ProfileLanguage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSectionVisibility" ADD CONSTRAINT "ProfileSectionVisibility_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileShare" ADD CONSTRAINT "ProfileShare_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileShare" ADD CONSTRAINT "ProfileShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDocument" ADD CONSTRAINT "ProfileDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
