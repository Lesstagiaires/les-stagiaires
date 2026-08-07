-- ============================================================================
-- LA DATE DE DEBUT DU POSTE
--
-- Le critere DISPONIBILITE (5 points sur 100, arrete par le promoteur le
-- 2026-08-07) compare la date a laquelle le candidat se declare disponible a
-- la date a laquelle le poste commence.
--
-- Sauf que la seconde n'existait pas. `ScorableOpportunity.startsAt` etait
-- declare optionnel et n'etait jamais renseigne : availabilityMatch() rendait
-- donc 1 pour toutes les offres, et les 5 points etaient distribues
-- uniformement. Un critere qui donne la meme note a tout le monde ne classe
-- rien — le bareme affichait 100 alors qu'il n'en pesait que 95.
--
-- Le champ reste FACULTATIF. Beaucoup de recrutements n'ont pas de date ferme,
-- et exiger une date inventee vaudrait moins que pas de date du tout. Quand
-- elle est absente, le critere continue de rendre 1 : l'hypothese la plus
-- favorable au candidat, comme partout ailleurs dans le moteur.
--
-- Le diagnostic de qualite signale l'absence a l'entreprise, sans l'imposer.
-- ============================================================================

ALTER TABLE "Opportunity" ADD COLUMN "startsAt" TIMESTAMP(3);

-- Une offre ne peut pas commencer apres avoir expire : la contrainte attrape
-- l'inversion de saisie, qui est l'erreur la plus courante sur deux dates
-- voisines dans un meme formulaire.
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_starts_before_expiry"
  CHECK ("startsAt" IS NULL OR "expiresAt" IS NULL OR "startsAt" <= "expiresAt");
