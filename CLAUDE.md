# LES STAGIAIRES — Instructions de sécurité pour le développement du MVP

Document à fournir à Claude Code (ou à toute équipe technique) avant le début du développement. À placer à la racine du projet, par exemple sous `SECURITY.md` ou dans `CLAUDE.md`. Fondé sur le module Sécurité, Cybersécurité et Protection des Données du BRD et sur l'architecture Security by Design déjà validés pour LES STAGIAIRES.

## Contexte à respecter en permanence

LES STAGIAIRES traite des données de mineurs, des pièces d'identité, des diplômes et des documents professionnels sensibles dans le Digital Safe. Aucune fonctionnalité ne doit être livrée sans que les règles ci-dessous soient appliquées — la vitesse de développement ne justifie jamais une exception de sécurité.

## 1. Classification des données — à appliquer dès la première ligne de code

Chaque donnée ou document manipulé par le système doit être rattaché à l'un de ces quatre niveaux, et le code doit appliquer la protection correspondante avant d'écrire ou d'exposer la donnée :

| Niveau | Exemples | Accès | Protection minimale exigée |
|---|---|---|---|
| Public | Profil public, offres publiées | Tout utilisateur | Contrôle d'intégrité |
| Interne | Statistiques internes, documents de travail | Équipes habilitées | Accès par rôle |
| Confidentiel | CV, diplômes, conventions, candidatures | Titulaire et destinataires autorisés | Chiffrement et journalisation |
| Très sensible | Pièces d'identité, dossiers juridiques, projets entrepreneuriaux | Accès exceptionnel et limité | Authentification renforcée et contrôle strict |

**Règle pour Claude Code** : avant d'implémenter un endpoint ou un écran qui lit ou écrit une donnée, identifier son niveau dans ce tableau et vérifier que la protection associée est bien en place (chiffrement, journalisation, contrôle d'accès) — pas après coup.

## 2. Authentification et comptes

- Connexion par téléphone ou adresse électronique, avec vérification par code à usage unique (OTP).
- Politique de mot de passe adaptée au niveau de risque ; aucun mot de passe ou code de vérification stocké en clair, en base ou en log.
- Double authentification disponible pour tous les utilisateurs, **obligatoire** pour tout compte administrateur ayant accès à des données confidentielles ou très sensibles.
- Notification automatique lors d'une connexion depuis un nouvel appareil ; blocage temporaire après plusieurs tentatives infructueuses.
- Chaque utilisateur doit pouvoir consulter la liste de ses appareils connectés et révoquer un accès immédiatement.

## 3. Rôles, habilitations et principe du moindre privilège

- Aucun rôle ne doit recevoir d'accès global « par facilité ». Chaque compte (y compris les comptes internes de l'équipe technique) ne reçoit que les droits strictement nécessaires à sa fonction.
- Les droits élevés (support, administration, accès aux documents très sensibles) sont limités dans le temps et doivent pouvoir être révisés périodiquement.
- Tout accès d'urgence hors du fonctionnement normal doit être exceptionnel, justifié, et journalisé — jamais silencieux.
- Un départ ou changement de fonction dans l'équipe doit entraîner la révocation immédiate des accès concernés.

**Règle pour Claude Code** : ne jamais implémenter un rôle « admin » fourre-tout qui voit tout. Modéliser les permissions dès le schéma de données (table de rôles/permissions), pas en ajoutant des vérifications ad hoc dans chaque contrôleur.

## 4. Digital Safe et documents — chiffrement et intégrité

- Chiffrement des fichiers **au repos et en transit**, sans exception, dès le MVP — ce n'est pas une fonctionnalité différable.
- Historique complet d'ajout, modification, partage et consultation de chaque document (journal d'accès).
- Contrôle des formats et tailles de fichiers autorisés à l'upload ; analyse anti-malware avant enregistrement de tout fichier déposé par un utilisateur.
- Un identifiant unique et une empreinte (hash) doivent permettre de vérifier qu'un document partagé n'a pas été altéré depuis son dépôt.
- Suppression logique puis suppression définitive selon un délai de conservation défini — jamais de suppression physique immédiate sans étape intermédiaire réversible.

## 5. Protection des mineurs — non négociable

- Un mineur peut créer un profil et explorer l'application **immédiatement**, en mode restreint, dès la saisie du numéro de téléphone d'un parent ou tuteur — ne jamais bloquer l'inscription en attendant la validation, sous peine de perdre l'utilisateur avant même de le protéger.
- Le parent/tuteur reçoit un SMS de **consentement actif** (lien ou code à valider) expliquant LES STAGIAIRES et ce que le mineur a renseigné — une simple notification d'information ne suffit pas, il faut une action positive et traçable de sa part.
- Tant que la validation parentale n'est pas confirmée, le compte reste en mode restreint : candidater réellement à une offre, signer une convention de stage et partager un document du Digital Safe restent bloqués. La navigation, la constitution du profil et la sauvegarde de brouillons restent, elles, accessibles.
- Un compte mineur resté plus de 30 jours sans validation parentale doit être signalé automatiquement, puis suspendu si aucune réponse n'intervient.
- **Limite assumée du MVP** : le numéro de téléphone du parent est déclaratif, non vérifié par pièce d'identité. C'est un risque documenté et accepté pour la Couche 1, pas un oubli — un contrôle renforcé (pièce d'identité du parent) est prévu pour la Couche 2, une fois le volume atteint.
- Paramètres de confidentialité renforcés par défaut pour tout compte identifié comme mineur, sans action requise de l'utilisateur.
- Visibilité publique du profil limitée automatiquement.
- Accès parental strictement cadré aux droits prévus dans le BRD (module Parents/Représentants légaux) — jamais un accès total non justifié.
- Collecte de données strictement limitée à ce qui est nécessaire ; aucun champ optionnel « au cas où » sur un profil mineur.
- Un mécanisme de signalement (harcèlement, abus, danger) doit être accessible dès le MVP, même sous une forme simple.

**Règle pour Claude Code** : traiter le statut « mineur » comme un attribut qui modifie le comportement de plusieurs modules à la fois (profil, opportunités, communication) — pas comme une case à cocher isolée dans le formulaire d'inscription.

## 6. Interdictions explicites pendant le développement

- Ne jamais committer de secret, clé API, ou identifiant dans le code source — utiliser un gestionnaire de secrets dès le premier commit.
- Ne jamais désactiver une vérification de sécurité « temporairement pour tester » sans un ticket explicite de réactivation.
- Ne jamais exposer un champ de la catégorie « Confidentiel » ou « Très sensible » dans une réponse API sans vérification explicite du rôle de l'appelant.
- Ne jamais stocker de document utilisateur (pièce d'identité, diplôme, convention) hors du Digital Safe chiffré, y compris dans des fichiers de test ou de démonstration.

## 7. Ce que Claude Code ne remplace pas

Cette liste d'instructions guide le code, elle ne constitue pas un audit de sécurité. Avant tout lancement avec de vrais utilisateurs, en particulier des mineurs :

- Un audit de sécurité indépendant (test d'intrusion) doit être réalisé par un tiers qualifié.
- Le choix d'hébergement et d'architecture d'infrastructure doit être validé par une personne compétente en la matière, en tenant compte des contraintes africaines (connectivité, coût, localisation des données).
- Une revue humaine du code généré reste nécessaire avant chaque mise en production, en particulier sur les modules touchant l'authentification, les paiements et le Digital Safe.

## 8. Processus recommandé de mise en œuvre

1. Donner ce document à Claude Code comme instruction permanente du projet (fichier `CLAUDE.md` ou équivalent), avant tout autre développement.
2. Développer module par module en suivant l'ordre du cahier des charges technique du MVP.
3. Après chaque module sensible (Authentification, LS-ID/Digital Safe, Profils), demander explicitement une relecture de sécurité ciblée avant de passer au module suivant.
4. Avant le lancement public, faire réaliser l'audit de sécurité indépendant mentionné en section 7.
