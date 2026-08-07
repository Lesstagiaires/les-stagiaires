-- CreateEnum
CREATE TYPE "ThreadContextType" AS ENUM ('APPLICATION', 'ORGANIZATION', 'AMBASSADOR', 'PARTNERSHIP', 'ESTABLISHMENT', 'SUPPORT');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "linkPath" TEXT,
ADD COLUMN     "starredAt" TIMESTAMP(3),
ADD COLUMN     "threadId" TEXT;

-- CreateTable
CREATE TABLE "NotificationThread" (
    "id" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "contextType" "ThreadContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "subject" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttachment" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "digitalSafeDocumentId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationThread_contextType_contextId_idx" ON "NotificationThread"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "NotificationThread_lastActivityAt_idx" ON "NotificationThread"("lastActivityAt");

-- CreateIndex
CREATE INDEX "NotificationAttachment_notificationId_idx" ON "NotificationAttachment"("notificationId");

-- CreateIndex
CREATE INDEX "Notification_userId_archivedAt_createdAt_idx" ON "Notification"("userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_category_createdAt_idx" ON "Notification"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_threadId_idx" ON "Notification"("threadId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "NotificationThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttachment" ADD CONSTRAINT "NotificationAttachment_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttachment" ADD CONSTRAINT "NotificationAttachment_digitalSafeDocumentId_fkey" FOREIGN KEY ("digitalSafeDocumentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- RATTRAPAGE DES NOTIFICATIONS DÉJÀ EN BASE
--
-- La colonne "category" a un DÉFAUT (SYSTEM), et un défaut ne protège que les
-- lignes FUTURES. Sans ce rattrapage, toutes les notifications déjà reçues
-- atterriraient dans « Système » — leur propriétaire ne les retrouverait plus
-- dans la rubrique où il les attend.
--
-- La leçon vient de CountryPolicy, où l'ajout d'une action soumise à accord
-- parental avait laissé sans protection tous les pays déjà paramétrés : leur
-- ligne existait, la nouvelle colonne y valait « vide », et le repli n'était
-- jamais consulté.
--
-- Cette correspondance est GÉNÉRÉE depuis src/notifications/notification-categories.ts,
-- jamais recopiée à la main.
-- ============================================================================
UPDATE "Notification" SET "category" = (CASE "type"::text
    WHEN 'PARTNERSHIP_REQUEST_NEW' THEN 'ADMINISTRATION'
    WHEN 'PARTNERSHIP_APPLIED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_APPROVED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_REFUSED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_SUSPENDED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_REINSTATED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_TERMINATION_REQUESTED' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN' THEN 'PARTNERSHIPS'
    WHEN 'PARTNERSHIP_TERMINATED' THEN 'PARTNERSHIPS'
    WHEN 'AMBASSADOR_APPROVED' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_SUSPENDED' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_REINSTATED' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_TERMINATED' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_PORTFOLIO_WARNING_9M' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_PORTFOLIO_WARNING_11M' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_PORTFOLIO_EXPIRED' THEN 'AMBASSADORS'
    WHEN 'AMBASSADOR_COMMISSION_EARNED' THEN 'PAYMENTS'
    WHEN 'AMBASSADOR_COMMISSION_PAYABLE' THEN 'PAYMENTS'
    WHEN 'AMBASSADOR_PAYOUT_VALIDATED' THEN 'PAYMENTS'
    WHEN 'AMBASSADOR_PAYOUT_EXECUTED' THEN 'PAYMENTS'
    WHEN 'AMBASSADOR_PAYOUT_REJECTED' THEN 'PAYMENTS'
    WHEN 'APPLICATION_SUBMITTED' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_DOCUMENT_REQUESTED' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_REJECTED' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_ADMISSION_LETTER_ISSUED' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_RECEIVED_ORG' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_DOCUMENT_SUBMITTED_ORG' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_ADMISSION_ACCEPTED_ORG' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_WITHDRAWN_ORG' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_RECOMMENDATION_RECEIVED' THEN 'APPLICATIONS'
    WHEN 'APPLICATION_INTERVIEW_PROPOSED' THEN 'INTERVIEWS'
    WHEN 'APPLICATION_INTERVIEW_CONFIRMED_ORG' THEN 'INTERVIEWS'
    WHEN 'APPLICATION_ACCEPTED_PENDING_TRAVEL_CONSENT' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_TRAVEL_CONSENT_CONFIRMED' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_TRAVEL_CONSENT_CONFIRMED_ORG' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_TRAVEL_CONSENT_EXPIRED' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_AGREEMENT_FULLY_SIGNED' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_AGREEMENT_FULLY_SIGNED_ORG' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_ESTABLISHMENT_SIGNED' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_ESTABLISHMENT_SIGNED_ORG' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_ESTABLISHMENT_ASSOCIATION_REQUESTED' THEN 'AGREEMENTS'
    WHEN 'APPLICATION_INTERNSHIP_STARTING_SOON' THEN 'INTERNSHIPS'
    WHEN 'APPLICATION_CLOSED' THEN 'INTERNSHIPS'
    WHEN 'INTERNSHIP_REPORT_REVIEWED' THEN 'INTERNSHIPS'
    WHEN 'LEARNER_INVITED' THEN 'INTERNSHIPS'
    WHEN 'LEARNER_VERIFIED' THEN 'INTERNSHIPS'
    WHEN 'ORGANIZATION_INVITATION_RECEIVED' THEN 'ORGANIZATIONS'
    WHEN 'ORGANIZATION_ACCESS_REVOKED' THEN 'ORGANIZATIONS'
    WHEN 'NEED_REQUEST_ANSWERED' THEN 'ORGANIZATIONS'
    ELSE 'SYSTEM'
  END)::"NotificationCategory";
