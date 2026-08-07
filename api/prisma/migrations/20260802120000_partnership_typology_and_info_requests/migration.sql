-- ============================================================================
-- TYPOLOGIE DES PARTENARIATS, STATUT « COMPLÉMENT REQUIS », HISTORIQUE DES
-- DEMANDES DE COMPLÉMENT — arbitrages du promoteur du 2026-08-02.
--
-- L'ORDRE DES OPÉRATIONS EST LA SUBSTANCE DE CE FICHIER. Le script généré
-- automatiquement ajoutait « typeId TEXT NOT NULL » à une table déjà peuplée, ce
-- qui échoue sur toute base contenant au moins un partenariat. Une migration doit
-- fonctionner sur N'IMPORTE QUELLE base, pas seulement sur celle qu'on a sous les
-- yeux : le catalogue est donc créé et rempli AVANT que la colonne n'existe, la
-- colonne naît nullable, elle est rétro-remplie, et seulement ensuite contrainte.
-- ============================================================================

-- --- 1. Nouvelles valeurs d'énumération -------------------------------------
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED';

-- Les deux façons de ne pas donner de motif, désormais distinctes.
ALTER TYPE "PartnershipDecisionReason" ADD VALUE 'NO_PUBLIC_REASON';

ALTER TYPE "PartnershipEventType" ADD VALUE 'ADDITIONAL_INFORMATION_REQUESTED';
ALTER TYPE "PartnershipEventType" ADD VALUE 'ADDITIONAL_INFORMATION_PROVIDED';

-- Un dossier incomplet n'est plus un refus.
ALTER TYPE "PartnershipStatus" ADD VALUE 'ADDITIONAL_INFORMATION_REQUIRED';

-- --- 2. Catalogue des types -------------------------------------------------
CREATE TABLE "PartnershipType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelPt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnershipType_code_key" ON "PartnershipType"("code");
CREATE INDEX "PartnershipType_isActive_sortOrder_idx" ON "PartnershipType"("isActive", "sortOrder");

-- Liste initiale arretee par le promoteur. Elle s'etend ensuite depuis le
-- back-office, SANS migration : c'etait la raison d'en faire une table.
-- Identifiants lisibles et deterministes, pour qu'un rejeu sur un autre
-- environnement produise exactement les memes cles.
INSERT INTO "PartnershipType" ("id", "code", "labelFr", "labelEn", "labelEs", "labelAr", "labelPt", "sortOrder", "updatedAt") VALUES
  ('ptype_academic', 'ACADEMIC', 'Partenariat académique', 'Academic partnership', 'Asociación académica', 'شراكة أكاديمية', 'Parceria académica', 10, CURRENT_TIMESTAMP),
  ('ptype_internship', 'INTERNSHIP', 'Partenariat de stage', 'Internship partnership', 'Asociación de prácticas', 'شراكة تدريب', 'Parceria de estágio', 20, CURRENT_TIMESTAMP),
  ('ptype_recruitment', 'RECRUITMENT', 'Partenariat de recrutement', 'Recruitment partnership', 'Asociación de contratación', 'شراكة توظيف', 'Parceria de recrutamento', 30, CURRENT_TIMESTAMP),
  ('ptype_training', 'TRAINING', 'Partenariat de formation', 'Training partnership', 'Asociación de formación', 'شراكة تكوين', 'Parceria de formação', 40, CURRENT_TIMESTAMP),
  ('ptype_institutional', 'INSTITUTIONAL', 'Partenariat institutionnel', 'Institutional partnership', 'Asociación institucional', 'شراكة مؤسساتية', 'Parceria institucional', 50, CURRENT_TIMESTAMP),
  ('ptype_technological', 'TECHNOLOGICAL', 'Partenariat technologique', 'Technology partnership', 'Asociación tecnológica', 'شراكة تكنولوجية', 'Parceria tecnológica', 60, CURRENT_TIMESTAMP),
  ('ptype_commercial', 'COMMERCIAL', 'Partenariat commercial', 'Commercial partnership', 'Asociación comercial', 'شراكة تجارية', 'Parceria comercial', 70, CURRENT_TIMESTAMP),
  ('ptype_event', 'EVENT', 'Partenariat événementiel', 'Event partnership', 'Asociación de eventos', 'شراكة فعاليات', 'Parceria de eventos', 80, CURRENT_TIMESTAMP),
  ('ptype_media', 'MEDIA', 'Partenariat média', 'Media partnership', 'Asociación de medios', 'شراكة إعلامية', 'Parceria de media', 90, CURRENT_TIMESTAMP),
  ('ptype_legal_support', 'LEGAL_SUPPORT', 'Partenariat d''appui juridique', 'Legal support partnership', 'Asociación de apoyo jurídico', 'شراكة دعم قانوني', 'Parceria de apoio jurídico', 100, CURRENT_TIMESTAMP),
  ('ptype_other', 'OTHER', 'Autre partenariat', 'Other partnership', 'Otra asociación', 'شراكة أخرى', 'Outra parceria', 999, CURRENT_TIMESTAMP);

-- --- 3. Historique des demandes de complément -------------------------------
CREATE TABLE "PartnershipInformationRequest" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedItems" TEXT[],
    "internalNote" TEXT NOT NULL,
    "publicMessage" TEXT,
    "actionDeadline" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "response" TEXT,

    CONSTRAINT "PartnershipInformationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnershipInformationRequest_partnershipId_requestedAt_idx" ON "PartnershipInformationRequest"("partnershipId", "requestedAt");

ALTER TABLE "PartnershipInformationRequest" ADD CONSTRAINT "PartnershipInformationRequest_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnershipInformationRequest" ADD CONSTRAINT "PartnershipInformationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 4. Rattachement des partenariats à un type -----------------------------
-- Échéance d'une ACTION, jamais du partenariat.
ALTER TABLE "Partnership" ADD COLUMN "actionDeadline" TIMESTAMP(3);

-- Nullable d'abord : la contrainte ne peut pas précéder la donnée.
ALTER TABLE "Partnership" ADD COLUMN "typeId" TEXT;

-- Les partenariats antérieurs à la typologie sont rattachés à OTHER. Ce n'est pas
-- une hypothèse sur leur nature, c'est le refus d'en faire une : l'administration
-- les reclassera, et un type faux serait plus nuisible qu'un type explicitement
-- indéterminé.
UPDATE "Partnership"
   SET "typeId" = 'ptype_other'
 WHERE "typeId" IS NULL;

ALTER TABLE "Partnership" ALTER COLUMN "typeId" SET NOT NULL;

ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "PartnershipType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- 5. L'unicité passe de l'organisation au couple (organisation, type) -----
-- Une école peut être partenaire académique ET partenaire de stage.
DROP INDEX "Partnership_organizationId_key";
CREATE UNIQUE INDEX "Partnership_organizationId_typeId_key" ON "Partnership"("organizationId", "typeId");
