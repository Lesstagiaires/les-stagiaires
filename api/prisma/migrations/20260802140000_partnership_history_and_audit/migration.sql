-- ============================================================================
-- HISTORIQUE COMPLET, GESTION DOCUMENTAIRE ET AUDIT RENFORCÉ
-- Arbitrages du promoteur du 2026-08-02.
--
-- Trois garanties sont posées ici, et deux d'entre elles vivent dans la BASE et
-- non dans le code applicatif — un contrôle applicatif ne protège que du code qui
-- passe par l'application :
--
--   1. le journal d'un partenariat lui SURVIT (clé étrangère en SET NULL et faits
--      recopiés sur la ligne) ;
--   2. les journaux sont en AJOUT SEUL (déclencheurs ci-dessous) ;
--   3. l'audit conserve l'ancienne et la nouvelle valeur de ce qui a changé.
-- ============================================================================

-- --- 1. Visibilité et typologie documentaire --------------------------------
CREATE TYPE "PartnershipEventVisibility" AS ENUM ('ADMIN_ONLY', 'ORGANIZATION');

CREATE TYPE "PartnershipDocumentType" AS ENUM (
  'CONTRACT', 'AMENDMENT', 'AGREEMENT', 'ANNEX',
  'MINUTES', 'LETTER', 'CERTIFICATE', 'REPORT', 'OTHER'
);

-- --- 2. Le journal des décisions devient autonome ---------------------------
ALTER TABLE "PartnershipEvent"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "visibility" "PartnershipEventVisibility" NOT NULL DEFAULT 'ADMIN_ONLY',
  ADD COLUMN "reasonCode" "PartnershipDecisionReason",
  ADD COLUMN "publicMessage" TEXT,
  ADD COLUMN "internalNote" TEXT,
  ADD COLUMN "fromStatus" "PartnershipStatus",
  ADD COLUMN "toStatus" "PartnershipStatus",
  ADD COLUMN "informationRequestId" TEXT,
  ADD COLUMN "documentIds" TEXT[],
  ADD COLUMN "notifiedTypes" "NotificationType"[],
  ADD COLUMN "notifiedCount" INTEGER NOT NULL DEFAULT 0;

-- Rétro-remplissage depuis le partenariat rattaché. La référence est dérivée
-- exactement comme partnershipReference() en TypeScript : PART- + 8 derniers
-- caractères en majuscules. Toute divergence ici rendrait des dossiers
-- introuvables au support.
UPDATE "PartnershipEvent" e
   SET "organizationId" = p."organizationId",
       "reference" = 'PART-' || upper(right(p.id, 8))
  FROM "Partnership" p
 WHERE p.id = e."partnershipId";

-- Filet pour d'éventuelles lignes déjà orphelines : on préfère un journal lisible
-- avec une mention explicite qu'une migration qui échoue au déploiement.
UPDATE "PartnershipEvent"
   SET "organizationId" = COALESCE("organizationId", 'ORGANISATION_INCONNUE'),
       "reference" = COALESCE("reference", 'PART-INCONNUE')
 WHERE "organizationId" IS NULL OR "reference" IS NULL;

ALTER TABLE "PartnershipEvent"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "reference" SET NOT NULL;

-- Les événements déjà en base étaient tous visibles de l'organisation : la rendre
-- soudain aveugle sur son propre passé serait une régression. Le DÉFAUT reste
-- ADMIN_ONLY — fermé — pour tout ce qui viendra ensuite.
UPDATE "PartnershipEvent" SET "visibility" = 'ORGANIZATION';

-- La clé étrangère passe de CASCADE à SET NULL : supprimer un partenariat ne doit
-- plus emporter son journal.
ALTER TABLE "PartnershipEvent" DROP CONSTRAINT "PartnershipEvent_partnershipId_fkey";
ALTER TABLE "PartnershipEvent" ALTER COLUMN "partnershipId" DROP NOT NULL;
ALTER TABLE "PartnershipEvent"
  ADD CONSTRAINT "PartnershipEvent_partnershipId_fkey"
  FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PartnershipEvent_organizationId_createdAt_idx"
  ON "PartnershipEvent"("organizationId", "createdAt");

-- --- 3. Rattachement documentaire (modèle seul, sans service) ---------------
CREATE TABLE "PartnershipDocument" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" "PartnershipDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "visibility" "PartnershipEventVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnershipDocument_partnershipId_documentId_key"
  ON "PartnershipDocument"("partnershipId", "documentId");
CREATE INDEX "PartnershipDocument_partnershipId_type_idx"
  ON "PartnershipDocument"("partnershipId", "type");

ALTER TABLE "PartnershipDocument" ADD CONSTRAINT "PartnershipDocument_partnershipId_fkey"
  FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT : un document rattaché à un partenariat ne se supprime pas du coffre
-- sans détacher d'abord la pièce.
ALTER TABLE "PartnershipDocument" ADD CONSTRAINT "PartnershipDocument_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "DigitalSafeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnershipDocument" ADD CONSTRAINT "PartnershipDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 4. Audit renforcé ------------------------------------------------------
ALTER TABLE "AuditLog"
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "entityId" TEXT,
  ADD COLUMN "changes" JSONB,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx"
  ON "AuditLog"("entityType", "entityId", "createdAt");

-- --- 5. AJOUT SEUL — la garantie, en base ------------------------------------
-- « Je souhaite que ces journaux soient inaltérables par les utilisateurs
-- ordinaires. » Un déclencheur refuse toute suppression et toute modification.
--
-- UNE SEULE EXCEPTION est tolérée : l'anonymisation d'une clé étrangère lorsqu'un
-- compte est supprimé définitivement (ON DELETE SET NULL). Sans elle, la
-- suppression RGPD d'un compte échouerait — deux exigences légitimes qui se
-- heurtent, et c'est l'anonymisation qui doit gagner : le journal perd l'AUTEUR,
-- jamais le FAIT.
--
-- La comparaison porte sur la ligne entière convertie en JSON, privée des colonnes
-- anonymisables. Tout le reste doit être rigoureusement identique.
CREATE OR REPLACE FUNCTION "auditLogAppendOnly"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AuditLog est en ajout seul : suppression interdite (ligne %).', OLD.id;
  END IF;

  IF NEW."userId" IS NULL
     AND (to_jsonb(NEW) - 'userId') = (to_jsonb(OLD) - 'userId') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AuditLog est en ajout seul : modification interdite (ligne %).', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "auditLogAppendOnly"();

CREATE OR REPLACE FUNCTION "partnershipEventAppendOnly"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PartnershipEvent est en ajout seul : suppression interdite (ligne %).', OLD.id;
  END IF;

  -- Seules `partnershipId` et `actorId` peuvent devenir NULL, et rien d'autre ne
  -- doit bouger.
  IF (to_jsonb(NEW) - 'partnershipId' - 'actorId')
     = (to_jsonb(OLD) - 'partnershipId' - 'actorId')
     AND (NEW."partnershipId" IS NULL OR NEW."partnershipId" = OLD."partnershipId")
     AND (NEW."actorId" IS NULL OR NEW."actorId" = OLD."actorId") THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'PartnershipEvent est en ajout seul : modification interdite (ligne %).', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PartnershipEvent_append_only"
  BEFORE UPDATE OR DELETE ON "PartnershipEvent"
  FOR EACH ROW EXECUTE FUNCTION "partnershipEventAppendOnly"();
