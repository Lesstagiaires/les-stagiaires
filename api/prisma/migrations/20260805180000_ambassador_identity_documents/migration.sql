-- ============================================================================
-- PIECES D IDENTITE DU DOSSIER AMBASSADEUR
-- Phase 2, deuxieme piece.
--
-- NIVEAU « TRES SENSIBLE » au sens du CLAUDE.md §1 : acces exceptionnel et
-- limite, authentification renforcee, controle strict.
--
-- AUCUN FICHIER N EST STOCKE ICI, et c est tout l interet de cette table.
--
-- Le CLAUDE.md §6 l interdit en toutes lettres : « ne jamais stocker de document
-- utilisateur (piece d identite, diplome, convention) hors du Digital Safe
-- chiffre ». Le fichier vit donc dans le Coffre-fort, qui apporte deja tout ce
-- qu une piece d identite exige et qu il aurait fallu reecrire ici :
--
--   — chiffrement au repos (AES-256-GCM) ;
--   — analyse anti-malware avant enregistrement ;
--   — empreinte de verification d integrite ;
--   — versionnage ;
--   — JOURNAL D ACCES : chaque consultation tracee ;
--   — suppression logique puis definitive, jamais de destruction immediate.
--
-- Cette table ne porte que le RATTACHEMENT et son instruction. Recopier le
-- fichier aurait cree une seconde copie hors du perimetre chiffre — c est-a-dire
-- une fuite, avec le temps.
-- ============================================================================

-- CreateEnum
CREATE TYPE "AmbassadorIdentityDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'RESIDENCE_PERMIT', 'DRIVING_LICENCE', 'OTHER_OFFICIAL_ID');

-- CreateEnum
CREATE TYPE "AmbassadorIdentityDocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AmbassadorIdentityDocument" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" "AmbassadorIdentityDocumentType" NOT NULL,
    "applicationCycle" INTEGER NOT NULL DEFAULT 1,
    "status" "AmbassadorIdentityDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "rejectionReasonCode" "AmbassadorDecisionReason",
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorIdentityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmbassadorIdentityDocument_ambassadorId_status_idx" ON "AmbassadorIdentityDocument"("ambassadorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorIdentityDocument_ambassadorId_documentId_key" ON "AmbassadorIdentityDocument"("ambassadorId", "documentId");

-- AddForeignKey
ALTER TABLE "AmbassadorIdentityDocument" ADD CONSTRAINT "AmbassadorIdentityDocument_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorIdentityDocument" ADD CONSTRAINT "AmbassadorIdentityDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- LES GARDE-FOUS ----------------------------------------------------------
-- RESTRICT sur le document : on ne supprime pas du Coffre-fort une piece sur
-- laquelle une decision d activation s est appuyee. Prisma le pose deja depuis
-- le schema ; ce commentaire dit pourquoi il ne faut pas l assouplir.

-- Une piece VERIFIEE porte toujours qui l a verifiee et quand. « Qui a valide
-- posera le premier controle serieux.
ALTER TABLE "AmbassadorIdentityDocument"
  ADD CONSTRAINT "AmbassadorIdentityDocument_verified_is_attributed"
  CHECK (
    "status" <> 'VERIFIED'
    OR ("verifiedAt" IS NOT NULL AND "verifiedById" IS NOT NULL)
  );

-- Un rejet porte TOUJOURS son motif structure. Refuser une piece d identite
-- sans dire pourquoi laisserait le candidat sans recours et l administration
-- sans memoire.
ALTER TABLE "AmbassadorIdentityDocument"
  ADD CONSTRAINT "AmbassadorIdentityDocument_rejection_is_motivated"
  CHECK ("status" <> 'REJECTED' OR "rejectionReasonCode" IS NOT NULL);

-- Le cycle commence a 1, comme celui de la candidature qu il accompagne.
ALTER TABLE "AmbassadorIdentityDocument"
  ADD CONSTRAINT "AmbassadorIdentityDocument_cycle_positive"
  CHECK ("applicationCycle" >= 1);
