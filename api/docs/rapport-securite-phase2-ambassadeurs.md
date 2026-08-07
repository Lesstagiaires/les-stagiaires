# Rapport de sécurité — Phase 2, parcours de candidature du module Ambassadeurs

*Produit le 2026-08-07, au format imposé par le SKILL SECURITY FIRST §17.*

Périmètre : candidature publique, pièces d'identité, formation, quiz bloquant,
activation, kit d'affiliation, lien public de parrainage.

Vérifié par 824 tests automatisés (52 suites), une recette fonctionnelle de
31 contrôles contre l'API réelle, et l'essai sur copie des trois migrations.

---

## 1. Classification préalable des données (§1)

| Donnée | Niveau | Protection appliquée |
|---|---|---|
| Motivation de candidature | Confidentiel | accès titulaire + ADMIN, balisage refusé à la frontière |
| Date de naissance, pays | Confidentiel | lus, jamais recopiés dans un journal |
| **Pièce d'identité** | **Très sensible** | jamais stockée hors du Coffre-fort chiffré ; contrôle de propriété ; journal d'accès du Coffre-fort |
| Contenu des modules | Public | balisage refusé |
| **Bonnes réponses du quiz** | **Très sensible** | ne quittent jamais le serveur, n'entrent pas au journal d'audit |
| Code d'affiliation | Public une fois distribué | n'existe qu'au statut `ACTIVE` |

---

## 2. Vulnérabilités détectées et prévenues

Ces défauts n'ont pas été introduits puis corrigés : ils ont été **écartés à la
conception**, parce que la classification a été faite avant d'écrire le code. Ils
figurent ici parce qu'ils étaient les issues naturelles de chaque pièce.

| # | Défaut évité | Criticité | Ce qu'il aurait coûté |
|---|---|---|---|
| P1 | **Fuite du corrigé du quiz.** L'écriture naturelle — servir la question complète, ou retrancher `correctIndex` d'un objet — l'aurait publié. | **Critique** | Le quiz bloquant serait devenu une formalité, et la formation obligatoire un affichage. Il suffit d'ouvrir l'onglet réseau. |
| P2 | **Énumération des codes actifs par le temps de réponse.** Une réponse constante ne suffit pas : consulter la base rendrait un code existant mesurablement plus rapide. | **Élevée** | Constitution d'une liste de codes actifs, donc d'ambassadeurs — première étape d'un détournement d'attribution. |
| P3 | **Rattachement de la pièce d'identité d'autrui** (IDOR). Sans contrôle de propriété, l'identifiant d'un document suffisait. | **Élevée** | Usurpation d'identité sur un programme qui verse de l'argent. |
| P4 | **Réponses distinctes selon la cause du refus** sur ce même rattachement. | Moyenne | Énumération des documents existants d'autres utilisateurs. |
| P5 | **Second dossier vivant pour une même personne** au redépôt. | Élevée | Deux codes, deux portefeuilles, la même commission comptée deux fois. |
| P6 | **Contournement du seuil d'âge par absence de donnée.** Laisser passer faute de date de naissance aurait fait de l'omission le chemin le plus simple. | Élevée | Un mineur dans un flux qui verse de l'argent. |
| P7 | **Activation sur des pièces et une formation du cycle précédent** après un refus puis redépôt. | Moyenne | Activation sans vérification réelle. |
| P8 | **Refonte de module sans effet** sur ceux déjà passés. | Moyenne | Une correction décidée pour raison de sécurité n'aurait atteint personne. |
| P9 | **Score de quiz calculé côté client.** | Élevée | Chacun s'attribuant sa note. |
| P10 | **QR stocké comme fichier.** | Moyenne | Un QR survivant à une suspension, consultable et partageable. |

---

## 3. Correctifs appliqués

**P1, P9 — le quiz.** `questionsFor()` projette les champs servis un par un ; le
DTO de soumission n'accepte que des indices choisis ; le résultat ne porte pas le
corrigé ; l'audit du back-office ne le porte pas non plus. Quatre tests
l'épinglent, dont un qui sérialise la réponse entière.

**P2 — le lien public.** `resolvePublicLink()` **ne consulte pas la base**.
Réponse rigoureusement constante, 200 systématique, débit limité à 20/min,
journalisation d'un préfixe de trois caractères. La recette mesure les temps :
18 ms contre 33 ms, aucun écart exploitable.

**P3, P4 — les pièces d'identité.** Contrôle de propriété, réponse aveugle
identique dans les trois cas d'échec, tentative journalisée comme accès refusé.

**P5 — le redépôt.** `userId` reste unique ; un compteur de cycle remplace la
seconde ligne ; l'historique vit dans `AmbassadorEvent`, en ajout seul.

**P6 — l'âge.** Lu sur le compte, jamais déclaré. Échec fermé sans date de
naissance. Plancher à 16 ans en base, au-delà du seuil configurable.

**P7 — le cycle.** Pièces et progressions portent `applicationCycle` ; les deux
verrous d'activation ne comptent que le cycle en cours.

**P8 — la version.** `TrainingProgress` photographie la version suivie ; le
verrou compare à la version courante ; un module se remplace, ne se modifie pas.

**P10 — le QR.** Calculé à l'affichage, aucun fichier, aucun cache.

**Quatorze contraintes CHECK** posées en base et **vérifiées sur copie** avant
application — parce qu'un contrôle de service se contourne par un `UPDATE`
direct.

---

## 4. Risques résiduels

| # | Risque | Criticité | Statut |
|---|---|---|---|
| R7 | **`APP_PUBLIC_URL` non renseignée.** Les liens servis portent `http://localhost:3000`. | Moyenne | **Configuration à faire.** Bloquant pour tout usage réel. |
| R8 | **Aucun module ni question configuré.** Le back-office existe, la base est vide. | Faible | Comportement fermé : sans quiz réussi, pas d'activation. À alimenter avant ouverture. |
| R9 | **Un compte ADMIN compromis voit tous les corrigés.** Inhérent : quelqu'un doit écrire les réponses. | Moyenne | Atténué par la 2FA obligatoire (CLAUDE.md §2) et l'audit de création. Une rotation périodique des questions le limiterait. |
| R10 | **La déclaration d'achèvement d'un module est purement déclarative.** Rien ne prouve que la personne a lu. | Faible | Assumé : c'est le quiz qui évalue, pas la progression. |
| R11 | **La date d'expiration d'une pièce est déclarative**, saisie au rattachement. | Moyenne | L'administration la vérifie à l'instruction. Un contrôle automatisé supposerait de lire la pièce — donc de la déchiffrer. |
| R12 | **Le journal du lien public ne distingue pas un balayage lent.** Trois caractères de préfixe et un débit de 20/min freinent, sans détecter une attaque étalée. | Faible | À couvrir par une règle antifraude sur le volume d'`AMBASSADOR_LINK_VISITED`. |

Les six risques résiduels de la **phase 1** restent ouverts et inchangés — voir
`rapport-securite-phase1-ambassadeurs.md`, en particulier **R1** (cascades depuis
`Ambassador`) et **R2** (absence de rotation de clés au Coffre-fort).

---

## 5. Dette technique

- Aucune interface mobile pour ce parcours : tout est côté API.
- La recette de parcours ne va pas jusqu'à l'activation réelle — elle s'arrête
  aux verrous, faute de modules et de questions configurés. À compléter une fois
  la formation alimentée.
- `TrainingProgress` n'est pas en ajout seul. Une progression se met à jour
  quand un module est refait — c'est voulu — mais l'historique des passages
  successifs n'est donc pas conservé. À revoir si une contestation l'exige.

---

## 6. Recommandations

1. **Renseigner `APP_PUBLIC_URL`** avant toute distribution de lien. C'est la
   seule action bloquante de ce rapport.
2. **Alimenter la formation** — au minimum un module de déontologie et une
   dizaine de questions — avant d'ouvrir les candidatures.
3. **Ajouter une règle antifraude** sur le volume d'`AMBASSADOR_LINK_VISITED`
   par plage horaire : le moteur de la phase 1 l'accepte sans modification, il
   suffit d'un signal supplémentaire (R12).
4. **Prévoir une rotation des questions de quiz** — un corrigé finit toujours par
   circuler entre candidats, indépendamment de toute faille technique (R9).
5. **Traiter R2 de la phase 1** avant la mise en production : les pièces
   d'identité reposent sur le chiffrement du Coffre-fort, qui n'a pas de
   rotation de clés. C'est aujourd'hui le maillon le plus faible de la chaîne
   qui protège les données « Très sensibles ».
