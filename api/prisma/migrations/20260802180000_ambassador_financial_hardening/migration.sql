-- ============================================================================
-- DURCISSEMENT DU SOCLE FINANCIER DU MODULE AMBASSADEURS
-- Arbitrages du promoteur du 2026-08-02, phase 1.
--
-- « Un compte utilisateur peut être anonymisé ou désactivé, mais son historique
-- comptable ne doit jamais disparaître. »
--
-- LE PROBLÈME, DÉMONTRÉ SUR COPIE AVANT ÉCRITURE :
--
--   User --CASCADE--> Ambassador --CASCADE--> AmbassadorWallet --CASCADE--> WalletTransaction
--
-- Supprimer UN compte effaçait la totalité du grand livre de cet ambassadeur.
-- Vérifié sur une restauration de la sauvegarde du 2026-08-02 : deux écritures et
-- un portefeuille détruits par un unique DELETE sur "User".
--
-- LA CORRECTION, en deux principes :
--
--   1. LE DOSSIER SURVIT AU COMPTE. `Ambassador.userId` devient nullable et passe
--      en SET NULL. Supprimer un compte anonymise le dossier ; il ne le détruit
--      plus. Tout ce qui pend sous `Ambassador` — portefeuille, commissions,
--      versements, écritures — reste donc intact, sans avoir à dénormaliser six
--      tables.
--
--      C'est le même arbitrage que pour les partenariats : LE JOURNAL PERD
--      L'AUTEUR, JAMAIS LE FAIT. Aucun nom n'est recopié sur les lignes
--      comptables — ce serait conserver une donnée personnelle que le RGPD
--      impose d'effacer. Le grand livre garde `ambassadorId` et le code, qui sont
--      des identifiants pseudonymes.
--
--   2. LES JOURNAUX SONT EN AJOUT SEUL, garanti par déclencheur PostgreSQL. Un
--      grand livre modifiable n'est pas un grand livre.
--
-- Ce qui N'EST PAS mis en ajout seul, et pourquoi : `Commission` et
-- `PayoutRequest` sont des entités à cycle de vie — une commission passe de
-- PENDING à AVAILABLE puis à PAID. Leur historique vit dans leurs tables
-- d'évènements, qui, elles, sont verrouillées.
-- ============================================================================

-- --- 1. Le dossier d'ambassadeur survit à la suppression du compte -----------
ALTER TABLE "Ambassador" DROP CONSTRAINT "Ambassador_userId_fkey";
ALTER TABLE "Ambassador" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Ambassador"
  ADD CONSTRAINT "Ambassador_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 2. Le parrainage survit à la suppression du filleul ---------------------
-- Un filleul supprimé ne doit pas effacer l'attribution : c'est elle qui justifie
-- une commission déjà versée. Sans cela, un remboursement contesté deviendrait
-- indéfendable.
ALTER TABLE "AmbassadorReferral" DROP CONSTRAINT "AmbassadorReferral_referredUserId_fkey";
ALTER TABLE "AmbassadorReferral" ALTER COLUMN "referredUserId" DROP NOT NULL;
ALTER TABLE "AmbassadorReferral"
  ADD CONSTRAINT "AmbassadorReferral_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 3. Le portefeuille survit à la suppression d'une organisation -----------
-- Le nom de l'organisation est recopié : contrairement à une personne physique,
-- une raison sociale n'est pas une donnée personnelle, et sans elle une entrée
-- orpheline serait illisible.
ALTER TABLE "AmbassadorPortfolioEntry" ADD COLUMN "organizationName" TEXT;

UPDATE "AmbassadorPortfolioEntry" e
   SET "organizationName" = o.name
  FROM "Organization" o
 WHERE o.id = e."organizationId";

UPDATE "AmbassadorPortfolioEntry"
   SET "organizationName" = COALESCE("organizationName", 'ORGANISATION SUPPRIMÉE')
 WHERE "organizationName" IS NULL;

ALTER TABLE "AmbassadorPortfolioEntry" ALTER COLUMN "organizationName" SET NOT NULL;

ALTER TABLE "AmbassadorPortfolioEntry" DROP CONSTRAINT "AmbassadorPortfolioEntry_organizationId_fkey";
ALTER TABLE "AmbassadorPortfolioEntry" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "AmbassadorPortfolioEntry"
  ADD CONSTRAINT "AmbassadorPortfolioEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 4. Le grand livre ne dépend plus de la survie du portefeuille -----------
-- `AmbassadorWallet` est un CACHE DE LECTURE ; `WalletTransaction` est la vérité.
-- Que le cache disparaisse ne doit pas emporter la vérité. L'identifiant de
-- l'ambassadeur est recopié pour que l'écriture reste rattachable.
ALTER TABLE "WalletTransaction" ADD COLUMN "ambassadorId" TEXT;

UPDATE "WalletTransaction" t
   SET "ambassadorId" = w."ambassadorId"
  FROM "AmbassadorWallet" w
 WHERE w.id = t."walletId";

UPDATE "WalletTransaction"
   SET "ambassadorId" = COALESCE("ambassadorId", 'AMBASSADEUR_INCONNU')
 WHERE "ambassadorId" IS NULL;

ALTER TABLE "WalletTransaction" ALTER COLUMN "ambassadorId" SET NOT NULL;

ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_walletId_fkey";
ALTER TABLE "WalletTransaction" ALTER COLUMN "walletId" DROP NOT NULL;
ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "AmbassadorWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WalletTransaction_ambassadorId_createdAt_idx"
  ON "WalletTransaction"("ambassadorId", "createdAt");

-- --- 5. Les journaux d'évènements survivent à leur objet ---------------------
ALTER TABLE "CommissionEvent" DROP CONSTRAINT "CommissionEvent_commissionId_fkey";
ALTER TABLE "CommissionEvent" ALTER COLUMN "commissionId" DROP NOT NULL;
ALTER TABLE "CommissionEvent"
  ADD CONSTRAINT "CommissionEvent_commissionId_fkey"
  FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioEvent" DROP CONSTRAINT "PortfolioEvent_entryId_fkey";
ALTER TABLE "PortfolioEvent" ALTER COLUMN "entryId" DROP NOT NULL;
ALTER TABLE "PortfolioEvent"
  ADD CONSTRAINT "PortfolioEvent_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "AmbassadorPortfolioEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AmbassadorEvent" DROP CONSTRAINT "AmbassadorEvent_ambassadorId_fkey";
ALTER TABLE "AmbassadorEvent" ALTER COLUMN "ambassadorId" DROP NOT NULL;
ALTER TABLE "AmbassadorEvent"
  ADD CONSTRAINT "AmbassadorEvent_ambassadorId_fkey"
  FOREIGN KEY ("ambassadorId") REFERENCES "Ambassador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 6. AJOUT SEUL — la garantie, en base ------------------------------------
-- Même contrat que pour AuditLog et PartnershipEvent : ni modification, ni
-- suppression. Seule l'anonymisation d'une clé étrangère qui passe à NULL est
-- tolérée, tout le reste de la ligne devant être rigoureusement identique.
--
-- La fonction est GÉNÉRIQUE : les colonnes anonymisables lui sont passées en
-- arguments du déclencheur. Écrire quatre fois la même fonction garantirait
-- qu'un jour l'une des quatre diverge.
CREATE OR REPLACE FUNCTION "financialLedgerAppendOnly"() RETURNS trigger AS $$
DECLARE
  nullable_columns TEXT[] := TG_ARGV;
  old_row JSONB;
  new_row JSONB;
  col TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% est en ajout seul : suppression interdite (ligne %).',
      TG_TABLE_NAME, OLD.id;
  END IF;

  old_row := to_jsonb(OLD);
  new_row := to_jsonb(NEW);

  -- Chaque colonne anonymisable est retirée de la comparaison, mais seulement si
  -- sa nouvelle valeur est NULL : une clé étrangère ne peut être qu'effacée,
  -- jamais réaffectée à un autre objet.
  FOREACH col IN ARRAY nullable_columns LOOP
    IF new_row -> col = 'null'::jsonb OR new_row -> col IS NULL THEN
      old_row := old_row - col;
      new_row := new_row - col;
    END IF;
  END LOOP;

  IF old_row = new_row THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% est en ajout seul : modification interdite (ligne %).',
    TG_TABLE_NAME, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WalletTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "WalletTransaction"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'walletId', 'commissionId', 'payoutRequestId', 'actorId');

CREATE TRIGGER "AmbassadorEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AmbassadorEvent"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'ambassadorId', 'actorId');

CREATE TRIGGER "CommissionEvent_append_only"
  BEFORE UPDATE OR DELETE ON "CommissionEvent"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'commissionId', 'actorId');

CREATE TRIGGER "PortfolioEvent_append_only"
  BEFORE UPDATE OR DELETE ON "PortfolioEvent"
  FOR EACH ROW EXECUTE FUNCTION "financialLedgerAppendOnly"(
    'entryId', 'actorId');
