-- Décision du promoteur du 2026-07-31 : un partenariat n'a PAS de durée dans la
-- plateforme. Le module gère des statuts (actif, suspendu, résilié) et rien d'autre.
-- Aucune date de fin n'est calculée, aucune tâche planifiée ne fait changer un
-- partenariat d'état. La durée, le renouvellement et les conditions de résiliation
-- relèvent du contrat de partenariat signé, jamais de la logique applicative.
--
-- Cette migration défait la règle « un an ferme + reconduction tacite + préavis de
-- 30 jours » introduite la veille (20260729215245_partnership_program_init).
--
-- Migration écrite à la main plutôt que générée : les valeurs d'énumération sont
-- RENOMMÉES là où une correspondance existe, ce qui préserve les lignes d'historique.
-- Une régénération automatique aurait recréé les types et perdu ces données.

-- ============================================================================
-- 1. Énumérations — renommages qui préservent les lignes existantes
-- ============================================================================

-- « ENDED » (fin subie, par échéance) devient « TERMINATED » (résiliation décidée).
ALTER TYPE "PartnershipStatus" RENAME VALUE 'ENDED' TO 'TERMINATED';

-- Un préavis armait un compte à rebours ; une demande de résiliation informe l'autre
-- partie et attend une décision administrative. Le vocabulaire suit le changement.
ALTER TYPE "PartnershipEventType" RENAME VALUE 'TERMINATION_NOTICED' TO 'TERMINATION_REQUESTED';
ALTER TYPE "PartnershipEventType" RENAME VALUE 'TERMINATION_WITHDRAWN' TO 'TERMINATION_REQUEST_WITHDRAWN';
ALTER TYPE "PartnershipEventType" RENAME VALUE 'ENDED' TO 'TERMINATED';

ALTER TYPE "NotificationType" RENAME VALUE 'PARTNERSHIP_TERMINATION_NOTICED' TO 'PARTNERSHIP_TERMINATION_REQUESTED';
ALTER TYPE "NotificationType" RENAME VALUE 'PARTNERSHIP_TERMINATION_WITHDRAWN' TO 'PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN';
ALTER TYPE "NotificationType" RENAME VALUE 'PARTNERSHIP_ENDED' TO 'PARTNERSHIP_TERMINATED';

-- ============================================================================
-- 2. Suppression de la reconduction — aucune correspondance possible
-- ============================================================================
-- « RENEWED » désignait une reconduction tacite automatique. Ce mécanisme n'existe
-- plus et ne peut plus se produire : la valeur n'a pas d'équivalent dans le nouveau
-- vocabulaire. Les lignes correspondantes sont supprimées ; elles ne peuvent provenir
-- que de la recette du 2026-07-30, la fonctionnalité n'ayant jamais été mise en
-- service. PostgreSQL n'autorisant pas la suppression d'une valeur d'énumération, les
-- types sont recréés sans elle.

DELETE FROM "PartnershipEvent" WHERE "type" = 'RENEWED';
DELETE FROM "Notification" WHERE "type" = 'PARTNERSHIP_RENEWED';

ALTER TYPE "PartnershipEventType" RENAME TO "PartnershipEventType_old";
CREATE TYPE "PartnershipEventType" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REFUSED',
  'TERMINATION_REQUESTED',
  'TERMINATION_REQUEST_WITHDRAWN',
  'TERMINATED',
  'SUSPENDED',
  'REINSTATED'
);
ALTER TABLE "PartnershipEvent"
  ALTER COLUMN "type" TYPE "PartnershipEventType"
  USING ("type"::text::"PartnershipEventType");
DROP TYPE "PartnershipEventType_old";

ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'PARTNERSHIP_REQUEST_NEW',
  'PARTNERSHIP_APPLIED',
  'PARTNERSHIP_APPROVED',
  'PARTNERSHIP_REFUSED',
  'PARTNERSHIP_SUSPENDED',
  'PARTNERSHIP_REINSTATED',
  'PARTNERSHIP_TERMINATION_REQUESTED',
  'PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN',
  'PARTNERSHIP_TERMINATED'
);
ALTER TABLE "Notification"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";

-- ============================================================================
-- 3. Colonnes — renommages, suppressions, ajouts
-- ============================================================================

-- Les index posés pour le balayage planifié n'ont plus d'objet : plus aucune requête
-- ne cherche les partenariats « dont l'échéance est dépassée ».
DROP INDEX IF EXISTS "Partnership_termEndsAt_idx";
DROP INDEX IF EXISTS "Partnership_terminationEffectiveAt_idx";

-- La date de début devient la date de SIGNATURE du contrat, purement informative.
ALTER TABLE "Partnership" RENAME COLUMN "startsAt" TO "signedAt";

-- Le préavis devient une demande de résiliation : son motif est renommé pour libérer
-- « terminationReason » au profit du motif de la résiliation effective.
ALTER TABLE "Partnership" RENAME COLUMN "terminationNoticedAt" TO "terminationRequestedAt";
ALTER TABLE "Partnership" RENAME COLUMN "terminationNoticedBy" TO "terminationRequestedBy";
ALTER TABLE "Partnership" RENAME COLUMN "terminationReason" TO "terminationRequestedReason";
ALTER TABLE "Partnership" RENAME COLUMN "endedAt" TO "terminatedAt";

-- Plus aucune échéance : ni terme, ni date d'effet différée.
ALTER TABLE "Partnership" DROP COLUMN "termEndsAt";
ALTER TABLE "Partnership" DROP COLUMN "terminationEffectiveAt";

-- Motif et auteur de la résiliation effective — une fin de partenariat est toujours
-- une décision humaine attribuable.
ALTER TABLE "Partnership" ADD COLUMN "terminationReason" TEXT;
ALTER TABLE "Partnership" ADD COLUMN "terminatedById" TEXT;

ALTER TABLE "Partnership"
  ADD CONSTRAINT "Partnership_terminatedById_fkey"
  FOREIGN KEY ("terminatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
