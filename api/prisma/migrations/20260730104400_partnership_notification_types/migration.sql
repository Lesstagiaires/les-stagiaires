-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_APPLIED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_REFUSED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_REINSTATED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_TERMINATION_NOTICED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_TERMINATION_WITHDRAWN';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_RENEWED';
