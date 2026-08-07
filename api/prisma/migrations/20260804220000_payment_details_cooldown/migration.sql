-- ============================================================================
-- COORDONNÉES DE VERSEMENT ET DÉLAI DE REFROIDISSEMENT
-- Arbitrage 13 du promoteur, 2026-08-02, phase 1 item 7.
--
-- « Je valide la mise en place d'un délai de refroidissement après toute
-- modification des coordonnées de paiement. Pendant cette période : aucune
-- nouvelle demande de retrait ne doit pouvoir être exécutée ; l'ambassadeur est
-- informé par e-mail et notification interne ; une alerte de sécurité peut être
-- envoyée par SMS lorsque le risque le justifie ; l'ancienne et la nouvelle
-- destination sont journalisées sous forme masquée ; l'utilisateur peut signaler
-- immédiatement une modification non autorisée. Je propose un délai par défaut
-- de 72 heures, configurable par pays ou par moyen de paiement. »
--
-- LE PRÉALABLE QUI MANQUAIT. Jusqu'ici l'ambassadeur saisissait sa destination À
-- CHAQUE DEMANDE de versement. « Modifier ses coordonnées » n'était donc pas un
-- acte identifiable, et poser un délai de refroidissement n'aurait rien protégé :
-- il aurait suffi de taper un autre numéro dans la demande suivante. Des
-- coordonnées ENREGISTRÉES sont la condition pour que le délai existe.
--
-- Conséquence sur l'API : `POST /ambassadors/me/payouts` ne reçoit plus ni
-- `method` ni `destinationLabel`. La demande utilise les coordonnées enregistrées.
-- ============================================================================

ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_PAYMENT_DETAILS_CHANGED';

-- --- 1. Le délai, par pays ---------------------------------------------------
-- 72 heures par défaut. Zéro le désactive : ce doit rester une décision
-- explicite d'un pays, jamais le résultat d'une colonne oubliée.
ALTER TABLE "AmbassadorPolicy"
  ADD COLUMN "paymentDetailsCooldownHours" INTEGER NOT NULL DEFAULT 72;

ALTER TABLE "AmbassadorPolicy" ADD CONSTRAINT "AmbassadorPolicy_cooldown_not_negative"
  CHECK ("paymentDetailsCooldownHours" >= 0);

-- --- 2. Les coordonnées en vigueur -------------------------------------------
CREATE TABLE "AmbassadorPaymentDetail" (
  "id"               TEXT NOT NULL,
  "ambassadorId"     TEXT NOT NULL,
  "method"           TEXT NOT NULL,
  "destinationLabel" TEXT NOT NULL,
  "changedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cooldownUntil"    TIMESTAMP(3) NOT NULL,
  "reportedAt"       TIMESTAMP(3),
  "reportedReason"   TEXT,
  "clearedAt"        TIMESTAMP(3),
  "clearedById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AmbassadorPaymentDetail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmbassadorPaymentDetail_ambassadorId_key"
  ON "AmbassadorPaymentDetail"("ambassadorId");

ALTER TABLE "AmbassadorPaymentDetail" ADD CONSTRAINT "AmbassadorPaymentDetail_ambassadorId_fkey"
  FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- --- 3. Le journal des changements, masqué et en ajout seul ------------------
CREATE TABLE "AmbassadorPaymentDetailEvent" (
  "id"             TEXT NOT NULL,
  "ambassadorId"   TEXT,
  "type"           TEXT NOT NULL,
  "actorId"        TEXT,
  "method"         TEXT NOT NULL,
  -- DÉJÀ MASQUÉES à l'écriture. Le numéro complet ne descend jamais jusqu'ici :
  -- ce qui n'entre pas en base ne peut fuiter par aucun export ultérieur.
  "previousMasked" TEXT,
  "newMasked"      TEXT NOT NULL,
  "cooldownUntil"  TIMESTAMP(3),
  "reason"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AmbassadorPaymentDetailEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AmbassadorPaymentDetailEvent_ambassadorId_createdAt_idx"
  ON "AmbassadorPaymentDetailEvent"("ambassadorId", "createdAt");

-- Aucune clé étrangère vers l'ambassadeur : ce journal doit survivre à
-- l'effacement du dossier qu'il documente. Un historique de détournement qui
-- disparaît avec le compte détourné ne documente rien.
--
-- Même contrat d'ajout seul que les autres journaux, avec la même fonction
-- générique. `ambassadorId` et `actorId` restent anonymisables (RGPD) : le
-- journal perd l'auteur, jamais le fait.
CREATE TRIGGER "AmbassadorPaymentDetailEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AmbassadorPaymentDetailEvent"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'ambassadorId', 'actorId');

-- --- 4. La demande de versement n'emporte plus sa destination ---------------
-- Les colonnes restent sur les demandes DÉJÀ passées : elles font partie du
-- constat de ce qui a été payé, et un constat ne se réécrit pas. Seules les
-- demandes futures les recevront des coordonnées enregistrées.
--
-- Rien à modifier en base ici : le changement est dans le service et dans le DTO.
