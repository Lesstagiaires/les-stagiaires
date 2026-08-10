-- ============================================================================
-- LA PREUVE DE POSSESSION DU TELEPHONE DEVIENT UN FAIT, PAS UNE DEDUCTION
--
-- DEFAUT TROUVE EN RECETTE REELLE le 2026-08-10, et prouve sur donnees reelles.
--
-- Il n'existait AUCUNE donnee disant « ce telephone a ete prouve ». Le fait
-- etait deduit du statut du compte :
--
--     login()  ->  if (user.status === PENDING_VERIFICATION) refuser
--
-- Or NEUF endroits ecrivent `User.status`, dont SIX n'ont rien a voir avec la
-- verification. Le refus parental, en particulier, ecrit sans condition :
--
--     declineConsent()  ->  status = AWAITING_PARENTAL_CONSENT
--
-- Un compte jamais verifie sortait donc de PENDING_VERIFICATION par le simple
-- fait qu'un tuteur avait refuse — et devenait connectable. Observe en base :
-- le compte +237690445566 porte un LOGIN_SUCCESS sans aucun
-- ACCOUNT_PHONE_VERIFIED, et sans LS-ID.
--
-- CE QUE CELA OUVRAIT : s'inscrire avec le numero d'autrui, se declarer
-- soi-meme comme tuteur, refuser depuis son propre telephone — et disposer d'un
-- compte rattache a un numero qu'on ne controle pas. Le numero de la victime
-- etant unique, elle ne pouvait plus jamais s'inscrire.
--
-- MEME FAMILLE D'ERREUR QUE `User.isMinor` : deduire un fait d'un etat qui
-- bouge pour d'autres raisons.
-- ============================================================================

ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- ============================================================================
-- LA REPRISE NE SE FAIT PAS DEPUIS LE STATUT
--
-- C'est le point qui compte. Ecrire
--
--     UPDATE "User" SET "phoneVerifiedAt" = now()
--      WHERE status <> 'PENDING_VERIFICATION'
--
-- reproduirait EXACTEMENT le bogue, et le figerait dans les donnees : tout
-- compte sorti de PENDING_VERIFICATION par un refus parental serait declare
-- verifie pour toujours, sans que personne ne puisse plus le distinguer.
--
-- La preuve est reconstruite depuis "AuditLog", qui est EN AJOUT SEUL — des
-- declencheurs PostgreSQL y interdisent toute modification et toute
-- suppression. L'evenement ACCOUNT_PHONE_VERIFIED y est ecrit au moment exact
-- ou le code a ete valide, et nulle part ailleurs.
--
-- On prend la PREMIERE occurrence par compte : la verification est un fait qui
-- date, et le premier passage est celui qui fait foi.
-- ============================================================================
UPDATE "User" u
   SET "phoneVerifiedAt" = premiere."verifieLe"
  FROM (
    SELECT "userId", MIN("createdAt") AS "verifieLe"
      FROM "AuditLog"
     WHERE action = 'ACCOUNT_PHONE_VERIFIED'
       AND "userId" IS NOT NULL
     GROUP BY "userId"
  ) AS premiere
 WHERE u.id = premiere."userId";

-- ============================================================================
-- LES COMPTES ANTERIEURS AU JOURNAL
--
-- Si des comptes ont ete verifies avant que l'evenement ne soit journalise, ils
-- ressortent ici sans preuve. Le controle ci-dessous ne corrige rien : il
-- COMPTE, pour que la reprise soit verifiable apres coup plutot que supposee.
--
-- Releve du 2026-08-10 sur la base de recette : 2 comptes verifies retrouves,
-- et le compte +237690445566 correctement laisse SANS preuve — c'est la
-- demonstration que la reprise ne recopie pas le defaut.
--
-- Aucun compte n'est desactive ni modifie autrement. Un compte sans preuve
-- devra simplement repasser par la verification, ce que la route de renvoi
-- rend desormais possible.
-- ============================================================================
DO $$
DECLARE
  sans_preuve INTEGER;
  avec_preuve INTEGER;
BEGIN
  SELECT count(*) INTO avec_preuve FROM "User" WHERE "phoneVerifiedAt" IS NOT NULL;
  SELECT count(*) INTO sans_preuve
    FROM "User"
   WHERE "phoneVerifiedAt" IS NULL
     AND status NOT IN ('PENDING_VERIFICATION', 'DELETED', 'PENDING_DELETION');

  RAISE NOTICE 'Reprise phoneVerifiedAt : % compte(s) avec preuve, % compte(s) hors PENDING_VERIFICATION sans preuve.',
    avec_preuve, sans_preuve;
END $$;

-- Recherche du fait par compte, pour la connexion.
CREATE INDEX "User_phoneVerifiedAt_idx" ON "User"("phoneVerifiedAt");
