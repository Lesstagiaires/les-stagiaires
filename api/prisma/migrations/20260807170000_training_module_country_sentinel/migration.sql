-- ============================================================================
-- MEME DEFAUT QUE LE BAREME DE PERTINENCE, UNE TABLE PLUS LOIN
--
-- Trouve le 2026-08-07 en cherchant si l'erreur corrigee sur
-- "SearchRankingRule" se repetait ailleurs. Elle se repetait ici.
--
-- L'index unique (code, version, "countryCode") ne mord pas quand
-- "countryCode" vaut NULL — c'est-a-dire pour les modules GLOBAUX, qui sont
-- ceux du tronc commun. Verifie sur une copie : deux modules DEONTOLOGIE
-- version 1, actifs, s'inserent sans erreur.
--
-- CE QUE CA CASSE. createModule() se protege par un findFirst applicatif :
-- une verification puis une ecriture, donc deux appels simultanes passent
-- tous les deux. L'index etait le filet, et le filet etait troue.
-- Consequences en cascade :
--   — le candidat voit le module en double dans son parcours ;
--   — supersedeModule() ne retire qu'un des deux : le contenu cense etre
--     remplace continue d'etre servi ;
--   — la formation est la porte qui garde l'activation d'un ambassadeur.
--     Une porte dont on ne sait pas dire quel battant fait foi.
--
-- Meme correction que pour le bareme : le joker devient '*', une valeur reelle
-- qu'aucun code ISO 3166-1 alpha-2 ne peut porter.
--
-- SI ELLE ECHOUE, C'EST QU'ELLE A TROUVE LE PROBLEME. L'UPDATE ci-dessous fait
-- entrer les modules globaux dans l'index unique : s'il existe deja des
-- doublons, PostgreSQL les refuse et la migration s'arrete. C'est voulu — la
-- machine ne peut pas deviner lequel des deux contenus fait foi. Verifier
-- avant de deployer :
--
--   SELECT code, version, count(*) FROM "TrainingModule"
--   WHERE "countryCode" IS NULL GROUP BY code, version HAVING count(*) > 1;
--
-- Verifie sur la base de developpement le 2026-08-07 : 0 doublon, 0 module.
-- ============================================================================

UPDATE "TrainingModule" SET "countryCode" = '*' WHERE "countryCode" IS NULL;

ALTER TABLE "TrainingModule" ALTER COLUMN "countryCode" SET DEFAULT '*';
ALTER TABLE "TrainingModule" ALTER COLUMN "countryCode" SET NOT NULL;

ALTER TABLE "TrainingModule" ADD CONSTRAINT "TrainingModule_country_is_iso_or_wildcard"
  CHECK ("countryCode" = '*' OR "countryCode" ~ '^[A-Z]{2}$');
