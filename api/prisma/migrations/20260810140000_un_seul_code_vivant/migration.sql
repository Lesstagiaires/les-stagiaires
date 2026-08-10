-- ============================================================================
-- UN SEUL CODE VIVANT A LA FOIS, GARANTI PAR LA BASE
--
-- DEFAUT TROUVE PAR LA REVUE DE SECURITE DU 2026-08-10, dans le correctif
-- ecrit le jour meme.
--
-- `generateAndSend` consommait les codes precedents puis en creait un nouveau,
-- en DEUX temps :
--
--     updateMany({ consumedAt: null } -> consumedAt = now)
--     create({ ... })
--
-- Sous concurrence, trois appels simultanes s'entrelacent et laissent PLUSIEURS
-- codes non consommes. Mesure sur base reelle : 2 codes vivants apres trois
-- envois simultanes.
--
-- CE N'ETAIT PAS EXPLOITABLE EN L'ETAT : `verify` ne retient que le plus recent
-- code encore valide, donc les autres restaient inertes. Mais « inerte parce
-- que la requete l'ignore » n'est pas « invalide » — la garantie tenait a
-- l'ordre d'un `orderBy`, que le prochain remaniement peut changer sans y
-- penser. C'est precisement le raisonnement ecarte en ecrivant ce correctif.
--
-- L'index ci-dessous rend l'etat impossible, au lieu de le rendre improbable.
-- ============================================================================

-- --- Reprise : ne garder que le plus recent code vivant par (compte, usage) --
--
-- L'index refuserait de se creer si des doublons preexistent. On consomme donc
-- les anciens, en conservant le dernier — celui que `verify` aurait de toute
-- facon ete le seul a accepter. Aucun utilisateur ne perd un code utilisable.
UPDATE "OtpCode" o
   SET "consumedAt" = now()
 WHERE o."consumedAt" IS NULL
   AND EXISTS (
     SELECT 1 FROM "OtpCode" plus_recent
      WHERE plus_recent."userId" = o."userId"
        AND plus_recent.purpose = o.purpose
        AND plus_recent."consumedAt" IS NULL
        AND (plus_recent."createdAt" > o."createdAt"
             OR (plus_recent."createdAt" = o."createdAt" AND plus_recent.id > o.id))
   );

-- --- La garantie ------------------------------------------------------------
--
-- PARTIEL : la contrainte ne porte que sur les codes NON consommes. L'historique
-- reste intact — plusieurs codes consommes coexistent evidemment pour un meme
-- compte, et c'est ce qui permet de reconstituer un parcours.
CREATE UNIQUE INDEX "OtpCode_un_seul_vivant"
  ON "OtpCode"("userId", "purpose")
  WHERE "consumedAt" IS NULL;
