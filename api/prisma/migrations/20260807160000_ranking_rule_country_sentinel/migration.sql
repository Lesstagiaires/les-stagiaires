-- ============================================================================
-- LE BAREME GLOBAL N'ETAIT PAS UNIQUE
--
-- Constat du 2026-08-07, verifie sur la base : l'index unique
-- ("criterion", "countryCode") ne mord pas quand "countryCode" vaut NULL —
-- PostgreSQL considere deux NULL comme distincts. Deux regles SKILL_MATCH
-- globales, actives, ont donc pu etre inserees cote a cote. weightsFor() en
-- retient une selon l'ordre de lecture, non specifie : le classement cesse
-- d'etre reproductible, et un doublon discret suffirait a le deplacer sans
-- qu'aucune ligne d'audit ne montre de modification.
--
-- Le cas non protege etait precisement celui qui sert au lancement : le bareme
-- global est le seul qui existe aujourd'hui.
--
-- CORRECTION : plus de NULL. Le joker devient une valeur reelle, '*'. Un
-- caractere qu'aucun code ISO 3166-1 alpha-2 ne peut porter, donc sans
-- ambiguite possible avec un vrai pays. L'index unique existant se met alors
-- a mordre sur le bareme global comme sur les autres.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+) aurait corrige l'unicite seule. La
-- sentinelle corrige en plus le fait que Prisma refuse un NULL dans une clef
-- unique composee : le back-office ne pouvait pas relire la regle globale
-- qu'il venait d'ecrire, et aurait cree un doublon a chaque modification.
-- ============================================================================

UPDATE "SearchRankingRule" SET "countryCode" = '*' WHERE "countryCode" IS NULL;

ALTER TABLE "SearchRankingRule" ALTER COLUMN "countryCode" SET DEFAULT '*';
ALTER TABLE "SearchRankingRule" ALTER COLUMN "countryCode" SET NOT NULL;

-- Soit le joker, soit un code pays ISO 3166-1 alpha-2. Interdit '', 'cm',
-- 'CMR' et tout ce qui creerait un deuxieme bareme fantome que personne ne
-- lirait jamais.
ALTER TABLE "SearchRankingRule" ADD CONSTRAINT "SearchRankingRule_country_is_iso_or_wildcard"
  CHECK ("countryCode" = '*' OR "countryCode" ~ '^[A-Z]{2}$');
