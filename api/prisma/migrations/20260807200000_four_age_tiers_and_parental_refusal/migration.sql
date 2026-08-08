-- ============================================================================
-- QUATRE PALIERS D'AGE, ET LE REFUS EXPLICITE DU PARENT
--
-- Arbitrage du promoteur du 2026-08-07, sur le document
-- « Authentification, connexion et consentement parental » :
--
--   « Je confirme le choix du moteur CountryPolicy configurable. Nous ne
--     devons pas figer les valeurs dans le code. Le Cameroun sera configuré
--     avec les seuils prevus par le document : 14 ans obligation de
--     consentement parental ; 18 ans fin de l'obligation ; 21 ans fin de
--     l'affichage des informations parentales. »
--
-- ---------------------------------------------------------------------------
-- 1. UN QUATRIEME SEUIL
--
-- Le moteur n'en connaissait que trois : age minimum, age d'obligation
-- parentale, majorite civile. Le document en decrit un quatrieme, entre la
-- majorite et l'oubli complet du sujet : de 18 a 20 ans, un contact parental
-- peut etre propose PAR COURTOISIE, sans aucun effet fonctionnel. Au-dela,
-- plus aucun champ n'est affiche.
--
-- Sans ce seuil, les deux derniers paliers du document se confondent, et un
-- utilisateur de trente ans se verrait proposer d'indiquer son parent.
--
-- ---------------------------------------------------------------------------
-- 2. LE PARENT PEUT DESORMAIS REFUSER
--
-- Jusqu'ici il ne pouvait qu'ignorer : le compte restait ouvert en mode
-- restreint pendant trente jours, puis se faisait suspendre par le balayage.
-- Un parent qui refuse activement voulait dire quelque chose de plus fort, et
-- le systeme n'avait pas de mot pour l'entendre.
--
-- DECLINED bloque IMMEDIATEMENT, sans attendre l'expiration. C'est le sens de
-- l'exigence : « le compte reste alors bloque au-dela du delai de 30 jours,
-- sans attendre l'expiration automatique ».
--
-- Un refus n'est pas definitif au sens ou l'enfant pourrait s'adresser a un
-- autre tuteur legitime — mais il ne se recycle pas en silence : reprendre un
-- lien DECLINED demande une nouvelle demande explicite, tracee.
-- ============================================================================

-- --- 1. Le quatrieme seuil ---------------------------------------------------
--
-- DEFAUT PROVISOIRE POUR LE BACKFILL. Les lignes existantes recoivent 21, qui
-- est la valeur du document ; le defaut est ensuite retire pour qu'aucune
-- politique future ne se cree avec une valeur implicite que personne n'a
-- decidee.
ALTER TABLE "CountryPolicy" ADD COLUMN "parentalInfoMaxAge" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "CountryPolicy" ALTER COLUMN "parentalInfoMaxAge" DROP DEFAULT;

-- Les seuils doivent rester ordonnes. Une politique ou la majorite civile
-- serait inferieure a l'age d'obligation parentale creerait un palier vide, et
-- un utilisateur tomberait dans aucun cas — ou dans deux.
ALTER TABLE "CountryPolicy" ADD CONSTRAINT "CountryPolicy_age_thresholds_ordered"
  CHECK (
    "minInternshipAge" <= "minParentRequiredAge"
    AND "minParentRequiredAge" < "civilMajorityAge"
    AND "civilMajorityAge" <= "parentalInfoMaxAge"
  );

-- Bornes de bon sens. Elles n'encadrent pas une politique legale, elles
-- attrapent la faute de frappe : un 1 au lieu de 14, un 180 au lieu de 18.
ALTER TABLE "CountryPolicy" ADD CONSTRAINT "CountryPolicy_age_thresholds_plausible"
  CHECK (
    "minInternshipAge" >= 10 AND "parentalInfoMaxAge" <= 30
  );

-- --- 2. Le refus explicite ---------------------------------------------------
ALTER TYPE "ParentalLinkStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

ALTER TABLE "ParentalLink" ADD COLUMN "declinedAt" TIMESTAMP(3);

-- --- 3. La politique du Cameroun ---------------------------------------------
--
-- Aucune CountryPolicy n'existait en base : le repli code en dur s'appliquait,
-- avec un age minimum de 16 ans. Un jeune de 14 ans etait donc refuse, contre
-- la regle du document. On la cree ici pour que le marche de lancement ne
-- depende pas d'un repli que personne n'a arbitre.
--
-- Les actions soumises a l'accord parental reprennent la liste complete : une
-- politique creee sans elles laisserait la protection silencieusement absente
-- (regression deja constatee sur SUBSCRIPTION_ORG_SPONSORED).
INSERT INTO "CountryPolicy" (
  "id", "countryCode",
  "minInternshipAge", "minParentRequiredAge", "civilMajorityAge", "parentalInfoMaxAge",
  "gatedActions", "updatedAt"
)
VALUES (
  'cpol_cm_2026', 'CM',
  14, 14, 18, 21,
  ARRAY[
    'REGISTRATION',
    'APPLICATION_SUBMIT',
    'ACCEPT_OFFER',
    'SIGN_CONVENTION',
    'MOBILITY',
    'DIGITAL_SAFE_SHARE',
    'SUBSCRIPTION_ORG_SPONSORED'
  ]::"MinorGatedAction"[],
  now()
)
ON CONFLICT ("countryCode") DO NOTHING;
