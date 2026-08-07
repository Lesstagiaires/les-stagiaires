-- Corrige une régression de protection silencieuse (CLAUDE.md §5 : "jamais d'absence de
-- protection par défaut") : SUBSCRIPTION_ORG_SPONSORED a été ajouté à l'enum
-- MinorGatedAction et à la politique de repli (FALLBACK_POLICY) après la création de ce
-- pays, mais toute CountryPolicy déjà configurée en base garde son ancienne liste
-- gatedActions figée au moment de sa création/dernière mise à jour — la politique de repli
-- ne s'applique jamais tant qu'une ligne existe pour ce pays. Sans ce correctif, un
-- établissement/entreprise pouvait souscrire PROTECT/PRO au nom d'un mineur sans accord
-- parental actif dans tout pays déjà configuré avant cette migration.
UPDATE "CountryPolicy"
SET "gatedActions" = array_append("gatedActions", 'SUBSCRIPTION_ORG_SPONSORED'::"MinorGatedAction")
WHERE NOT ('SUBSCRIPTION_ORG_SPONSORED'::"MinorGatedAction" = ANY("gatedActions"));