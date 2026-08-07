-- ============================================================================
-- CHIFFREMENT AU REPOS DES COORDONNÉES DE PAIEMENT
-- Exigence du promoteur du 2026-08-04.
--
-- « Je souhaite que les coordonnées de paiement bénéficient exactement du même
-- niveau de protection que les documents sensibles du Coffre-fort numérique :
-- chiffrées au repos ; les clés jamais stockées avec les données ; le
-- déchiffrement possible seulement par les services qui en ont réellement
-- besoin ; l'accès journalisé ; toute consultation traçable ; toute tentative
-- d'accès non autorisée journalisée. Personne ne lit les coordonnées de paiement
-- sans raison métier explicite. »
--
-- DEUX COLONNES PLUTÔT QU'UNE, et c'est le choix qui porte tout le reste :
--
--   `destinationEncrypted`  le numéro complet, chiffré (AES-256-GCM)
--   `destinationMasked`     sa forme masquée, en clair
--
-- La forme masquée suffit aux écrans, aux journaux, aux e-mails et aux listes,
-- c'est-à-dire à la quasi-totalité des lectures. Le déchiffrement devient donc
-- l'EXCEPTION — réservée à qui prépare réellement un virement — au lieu d'être
-- le passage obligé de toute consultation. Un secret qu'on déchiffre cent fois
-- par jour finit par traîner dans une trace d'exécution ; celui-ci ne sera
-- déchiffré que sur intention explicite, et chaque fois journalisé.
--
-- LES CLÉS VIVENT DANS LA CONFIGURATION D'EXÉCUTION, jamais en base. C'est ce
-- qui fait qu'un vidage de base volé ne rend rien de lisible — y compris une
-- sauvegarde ancienne, y compris celles de `api/backups/`.
--
-- LE CHIFFREMENT DES LIGNES EXISTANTES ne se fait PAS ici : PostgreSQL n'a pas
-- le trousseau, et lui donner la clé reviendrait exactement à ranger la clé avec
-- la serrure. Les colonnes naissent donc nullables ; le script
-- `scripts/encrypt-payment-destinations.mjs` les remplit depuis l'application,
-- puis les rend obligatoires. Voir sa documentation.
-- ============================================================================

ALTER TABLE "AmbassadorPaymentDetail"
  ADD COLUMN "destinationEncrypted" TEXT,
  ADD COLUMN "destinationMasked"    TEXT;

ALTER TABLE "PayoutRequest"
  ADD COLUMN "destinationEncrypted" TEXT,
  ADD COLUMN "destinationMasked"    TEXT;
