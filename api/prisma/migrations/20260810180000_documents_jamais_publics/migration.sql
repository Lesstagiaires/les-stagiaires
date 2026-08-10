-- ============================================================================
-- LA RUBRIQUE DOCUMENTS NE PEUT PLUS ETRE PUBLIQUE — defaut S-02
--
-- Corrige le 2026-08-10. `setVisibility` n'interdisait `PUBLIC` qu'aux mineurs.
-- Un majeur pouvait donc basculer sa rubrique DOCUMENTS en PUBLIC, et
-- `canView` renvoyait alors `true` SANS REGARDER LE VISITEUR : le fichier
-- etait servi DECHIFFRE a un anonyme presentant un identifiant de document.
--
-- CLAUDE.md §1 classe diplomes et attestations en CONFIDENTIEL — « titulaire
-- et destinataires autorises ». Un interrupteur d'interface ne devrait jamais
-- pouvoir declasser une donnee.
--
-- LE CODE SEUL NE SUFFIT PAS. Interdire l'ecriture protege les reglages a
-- venir ; il reste ceux DEJA POSES. Un `PUBLIC` inscrit avant cette correction
-- continuerait d'ouvrir l'acces, et personne ne le verrait — c'est exactement
-- la situation qu'on vient de fermer.
--
-- CE QUE FAIT CETTE MIGRATION. Elle retrograde en NETWORK toute rubrique
-- DOCUMENTS restee PUBLIC. NETWORK, et non PRIVATE : on corrige un risque de
-- securite, on ne decide pas a la place des titulaires de rendre leurs
-- documents invisibles a leur reseau. Le pas est le plus petit qui ferme
-- l'anonymat.
--
-- Releve avant ecriture : aucune ligne concernee dans les bases de
-- developpement et de recette. La migration est donc sans effet aujourd'hui —
-- elle existe pour les bases qui ne sont pas sous nos yeux.
-- ============================================================================

UPDATE "ProfileSectionVisibility"
   SET visibility = 'NETWORK'
 WHERE section = 'DOCUMENTS'
   AND visibility = 'PUBLIC';

-- ============================================================================
-- ET LA GARANTIE, EN BASE
--
-- La contrainte dit a PostgreSQL ce que le service dit deja au code. Les deux
-- ne se remplacent pas : un script d'administration, une reprise de donnees ou
-- un futur service qui ecrirait cette table sans passer par `setVisibility`
-- echouerait ici — au lieu de rouvrir la breche en silence.
--
-- C'est la meme discipline que pour les journaux en ajout seul : la regle vit
-- la ou la donnee vit.
-- ============================================================================
ALTER TABLE "ProfileSectionVisibility"
  ADD CONSTRAINT "ProfileSectionVisibility_documents_jamais_publics"
  CHECK (section <> 'DOCUMENTS' OR visibility <> 'PUBLIC');
