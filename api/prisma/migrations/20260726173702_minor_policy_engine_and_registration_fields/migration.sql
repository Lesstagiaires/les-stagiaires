-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "MinorGatedAction" AS ENUM ('REGISTRATION', 'APPLICATION_SUBMIT', 'ACCEPT_OFFER', 'SIGN_CONVENTION', 'MOBILITY', 'DIGITAL_SAFE_SHARE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cityOfResidence" TEXT,
ADD COLUMN     "countryOfResidence" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "sex" "Sex";

-- CreateTable
CREATE TABLE "CountryPolicy" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "minInternshipAge" INTEGER NOT NULL,
    "minParentRequiredAge" INTEGER NOT NULL,
    "civilMajorityAge" INTEGER NOT NULL,
    "gatedActions" "MinorGatedAction"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CountryPolicy_countryCode_key" ON "CountryPolicy"("countryCode");
