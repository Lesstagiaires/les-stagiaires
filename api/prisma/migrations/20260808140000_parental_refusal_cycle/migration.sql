-- ============================================================================
-- CYCLE DE REFUS PARENTAL — machine a etats validee par le promoteur le
-- 2026-08-08.
--
-- Le principe arrete : « Le droit du parent ou du tuteur de refuser doit etre
-- respecte, mais nous devons egalement permettre au mineur de comprendre le
-- refus, de presenter a nouveau les avantages et les garanties de la
-- plateforme a son representant legal et, le cas echeant, de solliciter une
-- nouvelle decision. »
--
-- Un refus n'est donc jamais definitif — mais il coute de plus en plus cher :
-- 7 jours, puis 30, puis 6 mois reamorces a chaque refus supplementaire.
-- ============================================================================

-- --- 1. LE COMPTEUR VIT SUR LE MINEUR --------------------------------------
--
-- ET PAS SUR LE LIEN PARENTAL. C'est le point central du modele. Un compteur
-- porte par "ParentalLink" se remettrait a zero a la premiere nouvelle demande,
-- puisque la meme ligne est reutilisee (clef unique enfant + numero). Il
-- s'effacerait aussi a chaque changement de tuteur — c'est-a-dire exactement
-- dans le cas ou il sert le plus.
--
-- Ces trois colonnes ne sont ecrites QUE lors d'un refus. Ni une nouvelle
-- demande, ni une decision d'administrateur, ni l'arrivee a la majorite ne les
-- touchent.
ALTER TABLE "User" ADD COLUMN "parentalRefusalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastParentalRefusalAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "parentalRequestBlockedUntil" TIMESTAMP(3);

-- Le compteur ne se decremente jamais. La contrainte le dit a la base, pas
-- seulement au code : une remise a zero par erreur de requete serait refusee.
ALTER TABLE "User" ADD CONSTRAINT "User_parental_refusal_count_positive"
  CHECK ("parentalRefusalCount" >= 0);

-- --- 2. LES DELAIS, CONFIGURABLES PAR PAYS ----------------------------------
--
-- Comme tous les seuils de protection des mineurs : la culture de l'autorite
-- parentale n'est pas la meme d'un pays a l'autre, et le cahier des charges
-- interdit de figer ces valeurs dans le code.
--
-- Defaut provisoire pour la reprise, puis retire : aucune politique future ne
-- doit se creer avec des delais que personne n'a arbitres.
ALTER TABLE "CountryPolicy" ADD COLUMN "refusalDelay1Days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "CountryPolicy" ADD COLUMN "refusalDelay2Days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "CountryPolicy" ADD COLUMN "refusalDelayFinalDays" INTEGER NOT NULL DEFAULT 182;

ALTER TABLE "CountryPolicy" ALTER COLUMN "refusalDelay1Days" DROP DEFAULT;
ALTER TABLE "CountryPolicy" ALTER COLUMN "refusalDelay2Days" DROP DEFAULT;
ALTER TABLE "CountryPolicy" ALTER COLUMN "refusalDelayFinalDays" DROP DEFAULT;

-- Les delais doivent CROITRE. Un deuxieme refus moins couteux que le premier
-- inverserait le sens du dispositif, et personne ne le verrait avant qu'un
-- mineur ne relance son parent tous les jours.
ALTER TABLE "CountryPolicy" ADD CONSTRAINT "CountryPolicy_refusal_delays_increasing"
  CHECK (
    "refusalDelay1Days" >= 1
    AND "refusalDelay1Days" <= "refusalDelay2Days"
    AND "refusalDelay2Days" <= "refusalDelayFinalDays"
    AND "refusalDelayFinalDays" <= 730
  );

-- --- 3. LE NUMERO NORMALISE -------------------------------------------------
--
-- SANS CETTE COLONNE, TOUT LE RESTE TOMBE. Verifie le 2026-08-08 :
-- `@IsPhoneNumber` valide sans transformer, et « +237690001111 »,
-- « +237 690 00 11 11 » et « +237-690-001-111 » passent tous les trois comme
-- des chaines DISTINCTES designant le meme telephone.
--
-- Le delai de garde, le compteur de refus et la detection d'un vrai changement
-- de tuteur reposent tous sur la clef (enfant, numero). Sur la forme brute,
-- une simple variation d'espacement les contourne tous les trois d'un coup.
ALTER TABLE "ParentalLink" ADD COLUMN "parentPhoneNormalized" TEXT;

-- Reprise des lignes existantes : on retire tout ce qui n'est ni chiffre ni
-- « + » de tete. Approximation volontaire — la vraie normalisation E.164 est
-- faite par l'application (libphonenumber-js), qui connait les plans de
-- numerotation. Verifie avant d'ecrire cette migration : la table est vide en
-- developpement, donc cette reprise ne concerne aujourd'hui aucune ligne.
UPDATE "ParentalLink"
   SET "parentPhoneNormalized" =
       CASE WHEN "parentPhone" LIKE '+%'
            THEN '+' || regexp_replace("parentPhone", '[^0-9]', '', 'g')
            ELSE regexp_replace("parentPhone", '[^0-9]', '', 'g')
       END
 WHERE "parentPhoneNormalized" IS NULL;

ALTER TABLE "ParentalLink" ALTER COLUMN "parentPhoneNormalized" SET NOT NULL;

-- L'UNICITE PORTE DESORMAIS SUR LA FORME NORMALISEE.
-- L'ancienne contrainte, sur la forme brute, laissait coexister trois lignes
-- pour un seul telephone.
ALTER TABLE "ParentalLink" DROP CONSTRAINT IF EXISTS "ParentalLink_childId_parentPhone_key";
DROP INDEX IF EXISTS "ParentalLink_childId_parentPhone_key";

CREATE UNIQUE INDEX "ParentalLink_childId_parentPhoneNormalized_key"
  ON "ParentalLink"("childId", "parentPhoneNormalized");

-- --- 4. CHANGEMENT REEL DE REPRESENTANT LEGAL -------------------------------
--
-- Des qu'un refus a ete enregistre, changer de tuteur devient la porte de
-- sortie evidente pour le contourner. La demande passe donc par un
-- administrateur.
--
-- C'est volontairement lourd. Un demenagement, un deces, une separation, un
-- placement : ces situations existent et meritent d'etre traitees. Elles
-- meritent aussi un regard humain, parce qu'aucune regle automatique ne
-- distingue un vrai changement de tuteur d'un adolescent qui a trouve un
-- adulte plus complaisant.
CREATE TYPE "GuardianChangeStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "GuardianChangeRequest" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,

    -- Le numero demande, sous ses deux formes : brute pour l'afficher tel que
    -- le mineur l'a saisi, normalisee pour comparer.
    "requestedParentPhone" TEXT NOT NULL,
    "requestedParentPhoneNormalized" TEXT NOT NULL,

    -- La justification du mineur. OBLIGATOIRE : c'est ce que l'administrateur
    -- lira pour decider, et une demande sans motif ne se decide pas.
    "reason" TEXT NOT NULL,

    "status" "GuardianChangeStatus" NOT NULL DEFAULT 'SUBMITTED',

    -- Le motif de la decision, cote administration. Obligatoire lui aussi des
    -- qu'une decision est prise : « refuse » sans raison n'est pas une reponse
    -- qu'on peut opposer a quelqu'un.
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    -- Photographie du compteur AU MOMENT DE LA DEMANDE. L'administrateur doit
    -- voir combien de refus precedent cette demande — c'est l'information qui
    -- distingue un cas de vie d'un contournement.
    "refusalCountAtRequest" INTEGER NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianChangeRequest_pkey" PRIMARY KEY ("id")
);

-- Une decision porte toujours un motif et un auteur, ou aucun des trois.
-- Un etat decide sans decideur serait un changement anonyme sur un compte de
-- mineur : exactement ce qu'un journal doit rendre impossible.
ALTER TABLE "GuardianChangeRequest" ADD CONSTRAINT "GuardianChangeRequest_decision_is_complete"
  CHECK (
    ("status" = 'SUBMITTED' AND "decidedById" IS NULL AND "decidedAt" IS NULL AND "decisionReason" IS NULL)
    OR ("status" <> 'SUBMITTED' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decisionReason" IS NOT NULL)
  );

-- Une seule demande en cours par mineur : sinon dix demandes simultanees
-- noieraient l'administration et rendraient l'ordre des decisions arbitraire.
CREATE UNIQUE INDEX "GuardianChangeRequest_one_pending_per_child"
  ON "GuardianChangeRequest"("childId")
  WHERE "status" = 'SUBMITTED';

CREATE INDEX "GuardianChangeRequest_status_createdAt_idx"
  ON "GuardianChangeRequest"("status", "createdAt");

ALTER TABLE "GuardianChangeRequest" ADD CONSTRAINT "GuardianChangeRequest_childId_fkey"
  FOREIGN KEY ("childId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- L'administrateur qui decide n'est PAS supprime en cascade : son depart de la
-- plateforme ne doit pas effacer la trace de sa decision.
ALTER TABLE "GuardianChangeRequest" ADD CONSTRAINT "GuardianChangeRequest_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- 5. LES DELAIS DU CAMEROUN ----------------------------------------------
UPDATE "CountryPolicy"
   SET "refusalDelay1Days" = 7,
       "refusalDelay2Days" = 30,
       "refusalDelayFinalDays" = 182
 WHERE "countryCode" = 'CM';
