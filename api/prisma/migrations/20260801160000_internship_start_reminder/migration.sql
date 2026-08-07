-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "internshipEndDate" TIMESTAMP(3),
ADD COLUMN     "internshipStartDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InternshipStartReminder" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "parentNotified" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternshipStartReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternshipStartReminder_applicationId_idx" ON "InternshipStartReminder"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "InternshipStartReminder_applicationId_offsetDays_key" ON "InternshipStartReminder"("applicationId", "offsetDays");

-- CreateIndex
CREATE INDEX "Application_status_internshipStartDate_idx" ON "Application"("status", "internshipStartDate");

-- AddForeignKey
ALTER TABLE "InternshipStartReminder" ADD CONSTRAINT "InternshipStartReminder_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
