-- ============================================================================
-- RECHERCHE PAR PERTINENCE
-- Arbitrage du promoteur, 2026-08-07.
--
-- « Recherche par pertinence seule, sans sponsoring ni mise en avant payante.
--   Les ponderations ne doivent pas etre codees en dur ; elles doivent etre
--   configurables depuis la base, historisees et auditables. Le referentiel des
--   competences est indispensable et doit etre realise dans ce chantier. »
--
-- L'ENGAGEMENT QUI GOUVERNE TOUT : aucune place ne s'achete. Il n'existe donc
-- AUCUN champ de mise en avant dans cette migration — ni featured, ni promoted,
-- ni sponsored, ni boost, ni priorityScore, ni paidRank, ni premiumRank. Pas
-- meme inutilise « pour plus tard » : un tel champ est une promesse qu'on
-- finirait par tenir un jour de tension commerciale. Un test automatise parcourt
-- le schema et echoue si l'un d'eux apparait.
--
-- DEUX EXTENSIONS POSTGRESQL :
--   — pg_trgm  : similarite par trigrammes. C'est elle qui rattrapera « Doula »
--                pour « Douala » et « comptablite » pour « comptabilite ».
--   — unaccent : comparaison sans accent, pour que « developpeur » trouve
--                « developpeur ».
-- Les deux sont des extensions DE CONFIANCE depuis PostgreSQL 13 : le
-- proprietaire de la base peut les creer sans etre superutilisateur. C'est ce
-- qui permet de ne pas elargir les privileges du compte applicatif
-- (CLAUDE.md §3, moindre privilege).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('NONE', 'SECONDARY', 'BAC', 'BAC_PLUS_2', 'BAC_PLUS_3', 'BAC_PLUS_5', 'DOCTORATE');

-- CreateEnum
CREATE TYPE "SearchCriterion" AS ENUM ('SKILL_MATCH', 'OCCUPATION_MATCH', 'LOCATION_MATCH', 'EDUCATION_MATCH', 'AVAILABILITY_MATCH', 'FRESHNESS');

-- AlterTable
ALTER TABLE "Education" ADD COLUMN     "level" "EducationLevel";

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "minEducationLevel" "EducationLevel",
ADD COLUMN     "occupationId" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "targetOccupationId" TEXT;

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelPt" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occupation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelPt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occupation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSynonym" (
    "id" TEXT NOT NULL,
    "termNormalized" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "skillId" TEXT,
    "occupationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSkill" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySkill" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunitySkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRankingRule" (
    "id" TEXT NOT NULL,
    "criterion" "SearchCriterion" NOT NULL,
    "weight" INTEGER NOT NULL,
    "countryCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchRankingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");

-- CreateIndex
CREATE INDEX "Skill_isActive_category_idx" ON "Skill"("isActive", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Occupation_code_key" ON "Occupation"("code");

-- CreateIndex
CREATE INDEX "Occupation_isActive_parentId_idx" ON "Occupation"("isActive", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSynonym_termNormalized_key" ON "SearchSynonym"("termNormalized");

-- CreateIndex
CREATE INDEX "SearchSynonym_isActive_idx" ON "SearchSynonym"("isActive");

-- CreateIndex
CREATE INDEX "ProfileSkill_skillId_idx" ON "ProfileSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSkill_profileId_skillId_key" ON "ProfileSkill"("profileId", "skillId");

-- CreateIndex
CREATE INDEX "OpportunitySkill_skillId_idx" ON "OpportunitySkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySkill_opportunityId_skillId_key" ON "OpportunitySkill"("opportunityId", "skillId");

-- CreateIndex
CREATE INDEX "SearchRankingRule_isActive_idx" ON "SearchRankingRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SearchRankingRule_criterion_countryCode_key" ON "SearchRankingRule"("criterion", "countryCode");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_targetOccupationId_fkey" FOREIGN KEY ("targetOccupationId") REFERENCES "Occupation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occupation" ADD CONSTRAINT "Occupation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Occupation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSynonym" ADD CONSTRAINT "SearchSynonym_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSynonym" ADD CONSTRAINT "SearchSynonym_occupationId_fkey" FOREIGN KEY ("occupationId") REFERENCES "Occupation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSkill" ADD CONSTRAINT "ProfileSkill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSkill" ADD CONSTRAINT "ProfileSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySkill" ADD CONSTRAINT "OpportunitySkill_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySkill" ADD CONSTRAINT "OpportunitySkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_occupationId_fkey" FOREIGN KEY ("occupationId") REFERENCES "Occupation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- INDEX DE RECHERCHE
-- ============================================================================

-- COLONNE GENEREE. Le vecteur se recalcule tout seul a chaque ecriture : il ne
-- peut pas se desynchroniser du texte, ce qu'un declencheur applicatif ou un
-- travail de fond finiraient par laisser arriver.
--
-- Le titre pese TROIS FOIS plus que la description (poids A contre C) : une
-- offre intitulee « Developpeur » parle de developpement ; une offre qui cite
-- le mot au detour d'un paragraphe, beaucoup moins.
--
-- `to_tsvector` avec configuration EXPLICITE : sans elle la fonction depend du
-- reglage de session, donc non immuable, donc refusee dans une colonne generee.
ALTER TABLE "Opportunity" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('french', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('french', coalesce("sector", '')), 'B') ||
    setweight(to_tsvector('french', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX "Opportunity_searchVector_idx" ON "Opportunity" USING GIN ("searchVector");

-- TOLERANCE AUX FAUTES. Les index trigrammes rattrapent « Doula » pour
-- « Douala » et « comptablite » pour « comptabilite » — ce que la recherche
-- plein texte, qui travaille sur des mots entiers, ne sait pas faire.
CREATE INDEX "Opportunity_title_trgm_idx" ON "Opportunity" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Opportunity_city_trgm_idx"  ON "Opportunity" USING GIN ("city" gin_trgm_ops);
CREATE INDEX "Skill_labelFr_trgm_idx"     ON "Skill" USING GIN ("labelFr" gin_trgm_ops);
CREATE INDEX "Occupation_labelFr_trgm_idx" ON "Occupation" USING GIN ("labelFr" gin_trgm_ops);

-- ============================================================================
-- LES GARDE-FOUS
-- ============================================================================

-- Un poids negatif ferait DESCENDRE une offre parce qu'elle correspond mieux.
-- Au-dela de 100, un seul critere ecraserait tous les autres.
ALTER TABLE "SearchRankingRule" ADD CONSTRAINT "SearchRankingRule_weight_is_percent"
  CHECK ("weight" >= 0 AND "weight" <= 100);

-- Un synonyme normalise ne peut pas etre vide : il se comparerait a tout.
ALTER TABLE "SearchSynonym" ADD CONSTRAINT "SearchSynonym_term_not_blank"
  CHECK (length(btrim("termNormalized")) > 0);

-- Un metier ne peut pas etre son propre parent : la remontee vers la famille
-- boucherait indefiniment.
ALTER TABLE "Occupation" ADD CONSTRAINT "Occupation_not_own_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- ============================================================================
-- LE BAREME DE DEPART
--
-- Les six criteres arretes par le promoteur, somme = 100. Ecrits ici pour que
-- la recherche fonctionne des la premiere requete : un bareme vide rendrait
-- toutes les offres a egalite, et le classement retomberait sur la fraicheur —
-- c'est-a-dire sur ce qu'on vient de remplacer.
--
-- Ils sont MODIFIABLES sans redeploiement, par le back-office ADMIN.
-- ============================================================================
INSERT INTO "SearchRankingRule" ("id", "criterion", "weight", "updatedAt") VALUES
  ('srr_skill',        'SKILL_MATCH',        35, now()),
  ('srr_occupation',   'OCCUPATION_MATCH',   25, now()),
  ('srr_location',     'LOCATION_MATCH',     15, now()),
  ('srr_education',    'EDUCATION_MATCH',    10, now()),
  ('srr_availability', 'AVAILABILITY_MATCH',  5, now()),
  -- 10 et non 5 : « une offre vieille de six mois ne devrait pas concurrencer
  -- une offre publiee hier si elles sont equivalentes ».
  ('srr_freshness',    'FRESHNESS',          10, now());
