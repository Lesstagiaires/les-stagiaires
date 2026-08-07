-- ============================================================================
-- DÉTECTION DE FRAUDE — PREMIÈRES ALERTES
-- Arbitrage du promoteur du 2026-08-04, phase 1 item 8.
--
-- « Un moteur simple, évolutif et entièrement configurable. Pour la première
-- version, elles devront uniquement signaler des comportements inhabituels.
-- Elles ne devront JAMAIS entraîner automatiquement une sanction, une suspension
-- ou un refus de paiement. Leur rôle est uniquement de : détecter ; alerter ;
-- journaliser ; orienter l'administration vers un contrôle manuel. »
--
-- CE QUE CETTE INTERDICTION IMPOSE AU SCHÉMA. Aucune table créée ici ne porte de
-- champ capable de suspendre, bloquer ou refuser quoi que ce soit. Une alerte
-- est une OBSERVATION : une valeur mesurée, un seuil franchi, une fenêtre. Ce
-- qu'on en fait relève d'une décision humaine prise ailleurs, par des chemins qui
-- exigent tous un motif écrit.
--
-- Une règle mal réglée doit pouvoir produire du bruit sans jamais produire de
-- dégât. C'est la condition pour oser régler les seuils bas au lancement, quand
-- les comportements normaux ne sont pas encore connus.
-- ============================================================================

-- CreateEnum
CREATE TYPE "FraudSignal" AS ENUM ('ATTRIBUTION_BURST', 'COMMISSION_VOLUME', 'PAYOUT_AFTER_DETAILS_CHANGE', 'REPEATED_PAYOUT_FAILURE');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AMBASSADOR_FRAUD_ALERT';

-- CreateTable
CREATE TABLE "FraudRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "signal" "FraudSignal" NOT NULL,
    "countryCode" TEXT,
    "thresholdValue" INTEGER NOT NULL,
    "windowHours" INTEGER NOT NULL,
    "severity" "FraudSeverity" NOT NULL DEFAULT 'WARNING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleCode" TEXT NOT NULL,
    "signal" "FraudSignal" NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "ambassadorId" TEXT,
    "ambassadorCode" TEXT,
    "countryCode" TEXT,
    "observedValue" INTEGER NOT NULL,
    "thresholdValue" INTEGER NOT NULL,
    "windowHours" INTEGER NOT NULL,
    "observedFrom" TIMESTAMP(3) NOT NULL,
    "observedTo" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB,
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraudRule_code_key" ON "FraudRule"("code");

-- CreateIndex
CREATE INDEX "FraudRule_isActive_signal_idx" ON "FraudRule"("isActive", "signal");

-- CreateIndex
CREATE INDEX "FraudAlert_status_severity_createdAt_idx" ON "FraudAlert"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "FraudAlert_ambassadorId_ruleCode_createdAt_idx" ON "FraudAlert"("ambassadorId", "ruleCode", "createdAt");

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FraudRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- --- LES GARDE-FOUS, EN BASE -------------------------------------------------
-- Un seuil nul déclencherait sur TOUT : ce ne serait plus une alerte, ce serait
-- un bruit de fond permanent, et le premier réflexe serait de couper la règle.
ALTER TABLE "FraudRule" ADD CONSTRAINT "FraudRule_threshold_positive"
  CHECK ("thresholdValue" > 0);

-- Une fenêtre nulle ne mesure rien.
ALTER TABLE "FraudRule" ADD CONSTRAINT "FraudRule_window_positive"
  CHECK ("windowHours" > 0);

-- Un délai de re-signalement négatif n'a pas de sens ; zéro est permis et veut
-- dire « re-signaler à chaque passage », ce qui peut se vouloir sur une règle
-- critique.
ALTER TABLE "FraudRule" ADD CONSTRAINT "FraudRule_cooldown_not_negative"
  CHECK ("cooldownHours" >= 0);

-- La fenêtre observée doit se lire dans le bon sens.
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_window_ordered"
  CHECK ("observedFrom" <= "observedTo");

-- Une alerte instruite porte forcément la date et l'auteur de son instruction :
-- « qui a écarté cette alerte, et quand ? » ne doit jamais rester sans réponse.
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_reviewed_is_attributed"
  CHECK (
    "status" = 'OPEN'
    OR ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
  );
