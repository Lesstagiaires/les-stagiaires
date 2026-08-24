-- V6-3 — CATÉGORIE PRÉCISE DES ORGANISATIONS
--
-- DEUX AXES, JAMAIS UN SEUL
-- `Organization.type` reste la FAMILLE (ENTREPRISE / ETABLISSEMENT). Elle n'est
-- ni renommée, ni élargie, et elle continue de commander seule les trois
-- comportements historiques : droit aux apprenants, préfixe de `orgId`,
-- dérivation BUSINESS/INSTITUTION.
--
-- `Organization.category` décrit la NATURE de l'organisation. Elle est
-- DESCRIPTIVE et rien d'autre : aucune décision de tarification, d'entitlement,
-- d'autorisation, de RBAC ou de commission ne doit la lire.
--
-- POURQUOI PAS UN ENUM ÉLARGI. Ajouter les sept catégories à
-- `OrganizationType` aurait fait porter deux niveaux au même champ — famille
-- pour les lignes anciennes, nature précise pour les nouvelles. C'est la faute
-- de PENDING_VERIFICATION, et PostgreSQL ne sait pas retirer une valeur d'enum :
-- l'erreur aurait été irréversible.
--
-- EFFET SUR LES DONNÉES EXISTANTES : AUCUN. Pas un seul UPDATE. Les
-- organisations antérieures conservent `category` nul, ce qui se lit
-- « catégorie non déclarée » — jamais « devinable ». Rien n'est déduit du type,
-- du nom, du secteur ni de `orgId`.
--
-- ============================================================================
-- L'OBLIGATION POUR LES NOUVELLES ORGANISATIONS — ET POURQUOI PAS UNE DATE
--
-- La règle est : toute organisation créée à partir de maintenant a une
-- catégorie ; les anciennes peuvent ne pas en avoir.
--
-- La première idée était une contrainte CHECK comparant `createdAt` à l'instant
-- de la migration. ELLE A ÉTÉ MESURÉE ET ÉCARTÉE, sur deux défaillances :
--
--   1. Avec un instant LITTÉRAL, la contrainte refuse de s'installer dès qu'une
--      ligne a été créée entre la rédaction de la migration et son application —
--      ce qui est le cas normal en recette et en production. Mesuré : 23514,
--      « violated by some row ».
--   2. Avec `now()`, PostgreSQL accepte la contrainte, mais un `createdAt`
--      fourni UNE MILLISECONDE plus tôt la traverse. Mesuré : accepté. La
--      garantie aurait alors reposé sur le fait que Prisma omet la colonne pour
--      laisser jouer le défaut serveur — un détail d'implémentation de
--      bibliothèque, pas une propriété du schéma.
--
-- Un déclencheur BEFORE INSERT n'a besoin d'aucune date : il ne s'exécute que
-- sur les lignes NOUVELLES. Les anciennes ne sont jamais visitées, donc jamais
-- mises en défaut. Et il s'applique quel que soit le chemin d'écriture —
-- service, script d'exploitation, Prisma ou SQL direct.
--
-- Patron repris des quatre déclencheurs déjà en place dans ce dépôt
-- (`auditLogAppendOnly`, `financialLedgerAppendOnly`...) : fonction nommée en
-- camelCase, déclencheur nommé « Table_objet », message d'erreur en français.
-- ============================================================================

CREATE TYPE "OrganizationCategory" AS ENUM (
  'COMPANY',
  'STARTUP',
  'NGO',
  'INSTITUTION',
  'SCHOOL',
  'UNIVERSITY',
  'TRAINING_CENTER'
);

ALTER TABLE "Organization" ADD COLUMN "category" "OrganizationCategory";

CREATE OR REPLACE FUNCTION "organizationCategoryRequired"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Une nouvelle organisation doit déclarer sa catégorie : COMPANY, STARTUP, NGO, INSTITUTION, SCHOOL, UNIVERSITY ou TRAINING_CENTER (organisation "%").',
    NEW.name;
END;
$$ LANGUAGE plpgsql;

-- La clause WHEN porte la règle DANS LE SCHÉMA : un `\d "Organization"` la
-- montre sans qu'il faille lire la fonction. La fonction n'est appelée que
-- lorsqu'il y a effectivement faute.
CREATE TRIGGER "Organization_category_required"
  BEFORE INSERT ON "Organization"
  FOR EACH ROW
  WHEN (NEW."category" IS NULL)
  EXECUTE FUNCTION "organizationCategoryRequired"();
