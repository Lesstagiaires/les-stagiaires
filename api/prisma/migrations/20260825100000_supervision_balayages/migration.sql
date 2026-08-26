-- SUPERVISION DES BALAYAGES — rendre observable l'arrêt d'un mécanisme périodique.
--
-- STRICTEMENT ADDITIVE. Aucune table existante n'est modifiée, aucune colonne
-- retirée, aucune donnée réécrite. Elle ne touche à aucun des dix balayages.

-- CreateEnum
CREATE TYPE "SweepIncidentKind" AS ENUM ('RETARD', 'ECHEC', 'REVEIL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SWEEP_JOB_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'SWEEP_DELAY_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SWEEP_SILENCE_ON_STARTUP';

-- CreateTable
CREATE TABLE "SweepIncident" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "kind" "SweepIncidentKind" NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,

    CONSTRAINT "SweepIncident_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- LA GARANTIE STRUCTURELLE
--
-- Un seul index, et il porte tout : deux superviseurs concurrents qui observent
-- la même panne calculent la même identité d'épisode — `next` et l'identifiant
-- de job sont des faits partagés dans Redis, non des horodatages locaux. Le
-- second INSERT reçoit une violation d'unicité et n'alerte pas.
--
-- Index ORDINAIRE et non partiel, contrairement à V6-5 : les trois colonnes sont
-- non nulles, `queueName` valant le sentinelle '*' pour un REVEIL. Prisma sait
-- donc l'exprimer et le gère — un futur `migrate dev` ne le perdra pas, là où
-- les index partiels de V6-5 exigent un test qui épingle leur définition.
-- ============================================================================
CREATE UNIQUE INDEX "SweepIncident_queueName_kind_episodeKey_key"
    ON "SweepIncident"("queueName", "kind", "episodeKey");
