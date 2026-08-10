-- ============================================================================
-- L'APPROBATION DEVIENT UNE AUTORISATION NOMINATIVE
--
-- Defaut trouve en revue le 2026-08-08, corrige ici. L'approbation d'un
-- changement de tuteur remettait "parentalRequestBlockedUntil" a NULL, sans
-- aucun lien avec le numero approuve. L'administrateur croyait autoriser un
-- changement de representant legal ; il levait en realite le delai de garde
-- pour N'IMPORTE QUEL numero — y compris celui du tuteur qui venait de refuser.
--
-- LE MODELE CORRIGE. Le blocage n'est plus jamais leve. L'approbation cree une
-- EXCEPTION NOMINATIVE a ce blocage : « ce numero-la, et lui seul, peut
-- recevoir une demande malgre le delai en cours ». La correspondance se fait
-- sur la forme canonique E.164, deja stockee dans
-- "requestedParentPhoneNormalized" — soumettre un autre numero ne trouve donc
-- aucune autorisation.
--
-- LA CONSOMMATION SE FAIT A LA DECISION, PAS A LA DEMANDE. C'est le point qui
-- n'est pas evident. Une autorisation consommee au premier envoi enfermerait le
-- mineur des qu'un SMS se perd : il ne pourrait plus relancer le tuteur que
-- l'administrateur vient pourtant d'autoriser. L'autorisation vaut donc « droit
-- d'obtenir une decision de ce tuteur », et s'eteint quand la decision arrive —
-- acceptation ou refus.
--
-- CONSEQUENCE VOULUE : si le nouveau tuteur refuse a son tour, le compteur
-- passe a n+1, un nouveau delai se pose, et il ne reste aucune autorisation
-- vivante. Il faut repasser devant un administrateur. Le changement de tuteur
-- ne s'use jamais en droit de contournement repetable.
-- ============================================================================

ALTER TABLE "GuardianChangeRequest" ADD COLUMN "consumedAt" TIMESTAMP(3);

-- Une autorisation ne se consomme que si elle existe. Consommer un rejet ou une
-- demande encore en instance n'aurait aucun sens, et signalerait un bogue
-- plutot qu'un etat legitime.
ALTER TABLE "GuardianChangeRequest" ADD CONSTRAINT "GuardianChangeRequest_consumed_only_if_approved"
  CHECK ("consumedAt" IS NULL OR "status" = 'APPROVED');

-- L'index qui sert la question posee a chaque demande de consentement :
-- « existe-t-il, pour cet enfant et ce numero, une autorisation vivante ? »
CREATE INDEX "GuardianChangeRequest_live_authorization_idx"
  ON "GuardianChangeRequest"("childId", "requestedParentPhoneNormalized")
  WHERE "status" = 'APPROVED' AND "consumedAt" IS NULL;

-- ============================================================================
-- REPRISE DES APPROBATIONS DEJA ACCORDEES
--
-- Elles ont ete rendues sous l'ancien modele, ou l'approbation levait le
-- blocage immediatement et definitivement. Les laisser « vivantes » leur
-- donnerait retroactivement un pouvoir qu'elles n'avaient pas : une exception
-- au delai, utilisable a n'importe quel moment futur.
--
-- On les marque donc CONSOMMEES. Leur effet d'origine a deja eu lieu ; ce qui
-- doit disparaitre, c'est leur effet FUTUR. Verifie avant d'ecrire cette
-- migration : la table est vide en developpement, donc cette reprise ne
-- concerne aujourd'hui aucune ligne.
-- ============================================================================
UPDATE "GuardianChangeRequest"
   SET "consumedAt" = "decidedAt"
 WHERE "status" = 'APPROVED'
   AND "consumedAt" IS NULL;
