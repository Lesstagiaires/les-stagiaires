-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_REINSTATED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_TERMINATED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_COMMISSION_EARNED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_COMMISSION_PAYABLE';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PAYOUT_VALIDATED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PAYOUT_EXECUTED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PAYOUT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PORTFOLIO_WARNING_9M';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PORTFOLIO_WARNING_11M';
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PORTFOLIO_EXPIRED';
