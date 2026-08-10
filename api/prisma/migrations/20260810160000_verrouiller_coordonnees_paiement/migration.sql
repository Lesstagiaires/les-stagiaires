-- ============================================================================
-- VERROUILLAGE DES COORDONNEES DE PAIEMENT — la chaine de migration rejoint
-- enfin l'etat que l'application attend.
--
-- DERIVE CONSTATEE le 2026-08-09, confirmee le 2026-08-10 :
--
--   schema.prisma          destinationLabel ABSENT, colonnes chiffrees NOT NULL
--   base de developpement  conforme  (le script y avait ete execute)
--   base creee depuis les MIGRATIONS SEULES :
--                          destinationLabel PRESENT en clair,
--                          colonnes chiffrees NULLABLES
--
-- Autrement dit, `prisma migrate deploy` sur une base de production neuve
-- laissait la coordonnee de paiement EN CLAIR, et les colonnes chiffrees
-- facultatives — alors que le client Prisma genere depuis schema.prisma les
-- attend obligatoires. La derive n'etait pas dans une base : elle etait dans la
-- SOURCE, entre les migrations et le schema.
--
-- POURQUOI ELLE EXISTAIT. La migration 20260805090000 cree volontairement les
-- colonnes chiffrees nullables : PostgreSQL n'a pas le trousseau, et lui donner
-- la clef reviendrait a ranger la clef avec la serrure. Le chiffrement des
-- lignes existantes est donc fait par l'application
-- (`scripts/encrypt-payment-destinations.mjs`). Mais le VERROUILLAGE final —
-- rendre les colonnes obligatoires et supprimer la colonne en clair — n'existait
-- QUE dans ce script, hors du dossier de migrations. Une base neuve ne le
-- voyait jamais.
--
-- CE QUE FAIT CETTE MIGRATION. Elle deplace le verrouillage dans la chaine, en
-- restant sure dans les deux situations :
--
--   BASE NEUVE (production, integration continue) : aucune ligne a chiffrer,
--   le verrouillage s'applique immediatement et l'etat final est atteint.
--
--   BASE EXISTANTE PORTANT DES LIGNES EN CLAIR : la migration ECHOUE, avec un
--   message qui dit quoi faire. C'est voulu. Verrouiller en silence exigerait
--   soit de perdre des donnees, soit de chiffrer sans trousseau — les deux sont
--   pires qu'un arret.
--
--   BASE DEJA VERROUILLEE (developpement) : tout est conditionnel et
--   idempotent, la migration ne fait rien.
-- ============================================================================

DO $$
DECLARE
  t TEXT;
  en_clair INTEGER;
BEGIN
  FOREACH t IN ARRAY ARRAY['AmbassadorPaymentDetail', 'PayoutRequest'] LOOP

    -- --- 1. Refuser de verrouiller sur des lignes non chiffrees -------------
    --
    -- On ne regarde QUE les lignes reellement presentes. Sur une base neuve, ce
    -- compte vaut zero et la migration passe sans rien dire.
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE "destinationEncrypted" IS NULL OR "destinationMasked" IS NULL',
      t
    ) INTO en_clair;

    IF en_clair > 0 THEN
      RAISE EXCEPTION
        'Migration interrompue : % ligne(s) de "%" ne sont pas chiffrees. '
        'Executez d''abord "node scripts/encrypt-payment-destinations.mjs --apply", '
        'qui chiffre les lignes existantes avec le trousseau de l''application, '
        'puis relancez migrate deploy. Aucune donnee n''a ete modifiee.',
        en_clair, t;
    END IF;

    -- --- 2. Les colonnes chiffrees deviennent obligatoires -------------------
    --
    -- Idempotent : PostgreSQL accepte SET NOT NULL sur une colonne qui l'est
    -- deja. La base de developpement, ou le script est passe, traverse donc
    -- cette migration sans effet.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN "destinationEncrypted" SET NOT NULL, ALTER COLUMN "destinationMasked" SET NOT NULL',
      t
    );

    -- --- 3. LA COLONNE EN CLAIR DISPARAIT ------------------------------------
    --
    -- C'est l'etape qui compte. Tant que le clair subsiste quelque part, le
    -- chiffrement n'est qu'une couche de peinture : un vidage de base vole, une
    -- sauvegarde ancienne ou une requete d'administration le rendraient
    -- lisible. CLAUDE.md §1 classe ces coordonnees en « Confidentiel ».
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS "destinationLabel"', t);

    RAISE NOTICE 'Coordonnees de paiement verrouillees sur "%".', t;
  END LOOP;
END $$;
