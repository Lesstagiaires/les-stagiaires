-- ============================================================================
-- VERSEMENTS — SÉPARATION DES POUVOIRS ET CYCLE EN SIX ÉTAPES
-- Arbitrage 12 du promoteur, 2026-08-02, phase 1 item 6.
--
-- « Je valide la séparation entre validation et exécution d'un versement. Une
-- même personne ne doit pas pouvoir, seule, approuver puis exécuter le même
-- paiement. Le cycle minimal sera : demande de retrait ; contrôle ; validation ;
-- exécution ; confirmation ou échec ; réconciliation. Merci de prévoir une règle
-- de double contrôle, au minimum pour les montants supérieurs à un seuil
-- configurable. Chaque étape doit enregistrer : l'auteur ; la date ; le montant ;
-- la devise ; la destination masquée ; la référence ; le statut ; le motif
-- lorsqu'il y a refus ou échec. »
--
-- DEUX DÉPLACEMENTS DE FOND, au-delà de l'ajout de colonnes :
--
--   1. L'ÉCRITURE DE SORTIE AU GRAND LIVRE PASSE DE L'EXÉCUTION À LA
--      CONFIRMATION. Jusqu'ici, dire « j'ai ordonné le virement » suffisait à
--      sortir l'argent du grand livre. Un virement ordonné n'est pas un virement
--      arrivé : entre les deux il y a un opérateur, et il tombe en panne.
--
--   2. LA SÉPARATION EST GARANTIE EN BASE. Un contrôle de service se contourne
--      par un UPDATE direct ; une contrainte CHECK, non.
-- ============================================================================

-- --- 1. Les quatre nouveaux états -------------------------------------------
ALTER TYPE "PayoutRequestStatus" ADD VALUE 'UNDER_REVIEW' AFTER 'REQUESTED';
ALTER TYPE "PayoutRequestStatus" ADD VALUE 'AWAITING_SECOND_APPROVAL' AFTER 'UNDER_REVIEW';
ALTER TYPE "PayoutRequestStatus" ADD VALUE 'EXECUTING' AFTER 'VALIDATED';
ALTER TYPE "PayoutRequestStatus" ADD VALUE 'FAILED' AFTER 'EXECUTED';

ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PAYOUT_FAILED';

-- --- 2. Le seuil de double contrôle, par pays -------------------------------
-- NULL = pas de double contrôle. Volontairement pas de valeur par défaut : une
-- règle de contrôle interne se décide, elle ne s'hérite pas d'une migration.
ALTER TABLE "AmbassadorPolicy" ADD COLUMN "doubleApprovalThresholdMinor" INTEGER;

ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_double_approval_positive"
  CHECK ("doubleApprovalThresholdMinor" IS NULL OR "doubleApprovalThresholdMinor" > 0);

-- --- 3. Les étapes portées par la demande -----------------------------------
ALTER TABLE "PayoutRequest"
  ADD COLUMN "reviewedAt"             TIMESTAMP(3),
  ADD COLUMN "reviewedById"           TEXT,
  ADD COLUMN "requiresSecondApproval" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "secondApprovalAt"       TIMESTAMP(3),
  ADD COLUMN "secondApprovalById"     TEXT,
  ADD COLUMN "confirmedAt"            TIMESTAMP(3),
  ADD COLUMN "confirmedById"          TEXT,
  ADD COLUMN "failedAt"               TIMESTAMP(3),
  ADD COLUMN "failedById"             TEXT,
  ADD COLUMN "failureReasonCode"      "AmbassadorDecisionReason";

-- --- 4. LA SÉPARATION DES POUVOIRS, EN BASE ---------------------------------
-- Celui qui approuve n'exécute pas. Les deux contraintes sont écrites
-- séparément pour que le message d'erreur désigne la règle enfreinte.
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_validator_is_not_executor"
  CHECK (
    "validatedById" IS NULL
    OR "executedById" IS NULL
    OR "validatedById" <> "executedById"
  );

ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_second_approver_is_not_executor"
  CHECK (
    "secondApprovalById" IS NULL
    OR "executedById" IS NULL
    OR "secondApprovalById" <> "executedById"
  );

-- Un double contrôle assuré deux fois par la même personne n'est pas un double
-- contrôle : c'est la même signature apposée deux fois.
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_two_distinct_approvers"
  CHECK (
    "secondApprovalById" IS NULL
    OR "validatedById" IS NULL
    OR "secondApprovalById" <> "validatedById"
  );

-- --- 5. Le journal des versements -------------------------------------------
CREATE TABLE "PayoutEvent" (
  "id"                TEXT NOT NULL,
  "payoutRequestId"   TEXT,
  "type"              TEXT NOT NULL,
  "status"            "PayoutRequestStatus" NOT NULL,
  "actorId"           TEXT,
  "amountMinor"       INTEGER NOT NULL,
  "currency"          TEXT NOT NULL,
  -- Déjà masquée à l'écriture : le numéro complet ne descend jamais jusqu'ici.
  "destinationMasked" TEXT NOT NULL,
  "reference"         TEXT,
  "reasonCode"        "AmbassadorDecisionReason",
  "internalNote"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayoutEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayoutEvent_payoutRequestId_idx" ON "PayoutEvent"("payoutRequestId");
CREATE INDEX "PayoutEvent_status_createdAt_idx" ON "PayoutEvent"("status", "createdAt");

-- SetNull, pas Cascade : le journal survit à la disparition de la demande qu'il
-- documente. Montant, devise et destination y sont recopiés précisément pour
-- qu'il reste lisible ce jour-là.
ALTER TABLE "PayoutEvent" ADD CONSTRAINT "PayoutEvent_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Le même contrat d'ajout seul que les trois autres journaux financiers, avec la
-- même fonction générique : la réécrire ici garantirait qu'un jour l'une des
-- versions diverge.
CREATE TRIGGER "PayoutEvent_append_only"
  BEFORE UPDATE OR DELETE ON "PayoutEvent"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'payoutRequestId', 'actorId');
