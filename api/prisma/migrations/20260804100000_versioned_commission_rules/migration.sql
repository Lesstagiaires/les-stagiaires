-- ============================================================================
-- BARÈMES DE COMMISSION VERSIONNÉS
-- Arbitrage du promoteur du 2026-08-02, phase 1 item 4.
--
-- « Une transaction doit conserver la règle exacte appliquée au moment de son
-- calcul. Une modification future du barème ne doit jamais recalculer
-- rétroactivement une commission déjà acquise. »
--
-- CE QUI EXISTAIT DÉJÀ : validFrom / validUntil, produit, type de vente, pays,
-- niveau d'ambassadeur, clé de campagne, priorité. La résolution filtrait déjà
-- sur la date de l'opération. Le versionnage dans le temps était donc à moitié en
-- place — ce sont les trois manques ci-dessous qui sont comblés.
--
--   1. MONTANT FIXE. Le barème ne savait exprimer qu'un TAUX. Une prime
--      forfaitaire de 5 000 F par souscription ne s'exprime pas en points de base.
--
--   2. DEVISE. Un taux est sans dimension ; un montant fixe ne veut rien dire
--      sans devise.
--
--   3. CHAÎNE DE VERSIONS. Rien n'empêchait de corriger un taux EN PLACE — ce qui
--      réécrit l'histoire : « quel était le taux le 15 mars ? » devient sans
--      réponse. Un barème déjà appliqué se clôt et se remplace, il ne se modifie
--      pas.
--
-- Les contraintes d'exclusivité vivent en BASE et non dans le service : une
-- insertion SQL directe ne doit pas pouvoir créer un barème incalculable.
-- ============================================================================

-- --- 1. Photographie de la règle sur la commission --------------------------
-- `appliedRuleId` est en SET NULL : si le barème disparaît, le lien s'efface.
-- Ces trois champs, eux, restent. Une commission doit rester justifiable des
-- années plus tard sans dépendre de la survie d'une ligne de configuration.
ALTER TABLE "Commission"
  ADD COLUMN "appliedRuleLabel" TEXT,
  ADD COLUMN "appliedRuleVersion" INTEGER,
  ADD COLUMN "appliedFixedAmountMinor" INTEGER;

-- Rétro-remplissage depuis les barèmes encore présents. Les commissions dont la
-- règle a déjà disparu gardent leur `rateBasisPoints`, qui a toujours été
-- photographié sur la ligne : rien n'est perdu, seul le libellé manque.
UPDATE "Commission" c
   SET "appliedRuleLabel" = r.label,
       "appliedRuleVersion" = 1
  FROM "CommissionRule" r
 WHERE r.id = c."appliedRuleId";

-- --- 2. Taux OU montant fixe, et devise -------------------------------------
ALTER TABLE "CommissionRule"
  ADD COLUMN "fixedAmountMinor" INTEGER,
  ADD COLUMN "currency" TEXT,
  ALTER COLUMN "rateBasisPoints" DROP NOT NULL;

-- --- 3. Chaîne de versions ---------------------------------------------------
ALTER TABLE "CommissionRule"
  ADD COLUMN "lineageKey" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesId" TEXT;

-- Chaque barème existant ouvre sa propre lignée. Utiliser son identifiant comme
-- clé de lignée est stable et sans collision possible ; les versions suivantes
-- reprendront cette même clé.
UPDATE "CommissionRule" SET "lineageKey" = id WHERE "lineageKey" IS NULL;

ALTER TABLE "CommissionRule" ALTER COLUMN "lineageKey" SET NOT NULL;

CREATE UNIQUE INDEX "CommissionRule_supersedesId_key" ON "CommissionRule"("supersedesId");
CREATE INDEX "CommissionRule_lineageKey_version_idx" ON "CommissionRule"("lineageKey", "version");

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 4. LES GARDE-FOUS, EN BASE ----------------------------------------------
-- Exactement un mode de calcul. Ni zéro — un barème sans taux ni montant est
-- incalculable et paierait zéro en silence — ni deux, qui laisserait le code
-- choisir arbitrairement.
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_one_calculation_mode"
  CHECK (
    ("rateBasisPoints" IS NOT NULL AND "fixedAmountMinor" IS NULL)
    OR
    ("rateBasisPoints" IS NULL AND "fixedAmountMinor" IS NOT NULL)
  );

-- Un montant fixe EXIGE une devise. « 5 000 » sans devise n'est pas une somme.
-- Un taux, sans dimension, s'en passe.
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_fixed_needs_currency"
  CHECK ("fixedAmountMinor" IS NULL OR "currency" IS NOT NULL);

-- Les bornes du taux (0 à 10 000 points de base) sont DÉJÀ posées par une
-- migration antérieure — `CommissionRule_rate_within_bounds`. Elle n'est pas
-- reprise ici : en SQL, une contrainte CHECK qui s'évalue à NULL est considérée
-- comme satisfaite, la contrainte existante tolère donc naturellement le taux
-- absent d'un barème à montant fixe. Rien à modifier.

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_fixed_positive"
  CHECK ("fixedAmountMinor" IS NULL OR "fixedAmountMinor" > 0);

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_version_positive"
  CHECK ("version" >= 1);
