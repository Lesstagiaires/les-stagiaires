# Rapport de sécurité — Chantier Authentification et consentement parental

**Date** : 8 août 2026
**Périmètre** : inscription, connexion, OTP, mots de passe, sessions, rôles,
quatre paliers d'âge, consentement parental (demande, confirmation, refus,
expiration), écran de décision du parent.
**Référence métier** : `LES_STAGIAIRES_SKILL_authentification_mineurs.md`,
arbitrage du promoteur du 2026-08-07.
**Base de vérification** : 994 tests / 64 suites verts, lint et typage propres
sur `api` et `mobile`, `prisma migrate diff` vide.

Ce rapport suit la directive permanente **SKILL — SECURITY FIRST**. Il ne
remplace pas l'audit indépendant exigé par `CLAUDE.md` §7.

---

## 1. Ce qui a été vérifié

Chaque ligne ci-dessous a été lue dans le code, pas déduite d'une intention.

| Point | Constat |
|---|---|
| Mots de passe | `argon2.hash` / `argon2.verify`. Aucun stockage en clair. |
| Codes OTP | Hachés en SHA-256, jamais journalisés. Vérifié par recherche : aucune trace du code dans un `logger` ou un `audit.record`. |
| Comparaison des codes | `timingSafeEqual` — confirmation ET refus du consentement. |
| Limitation de débit | Toutes les routes sensibles en portent une : inscription 5/min, OTP 10/min, connexion 10/min, 2FA 10/min, mot de passe oublié 5/min, demande de consentement 5/min, confirmation 10/min, **refus 10/min**. |
| Révocation de session | `JwtStrategy` revérifie `isSessionValid(sessionId)` à chaque requête — un jeton non expiré ne survit pas à une déconnexion. |
| 2FA administrateur | `RolesGuard` refuse toute action `ADMIN` si `twoFactorEnabled` est faux, et revérifie le rôle **actif en base** à chaque requête plutôt que de croire le jeton. |
| Jeton de défi 2FA | Signé avec un secret dérivé, distinct du secret d'accès : un jeton de défi ne peut pas servir de jeton de session. |
| Notification de nouvel appareil | Présente, avec un libellé dérivé de l'agent utilisateur. Pas de notification au premier appareil (volontaire). |
| Mineur = son propre parent | Refusé à la demande (`parentPhone === child.phone`) **et** à la confirmation (un compte mineur ne peut pas donner de consentement). Deux mineurs ne peuvent pas s'auto-valider mutuellement. |
| Abonnement d'un mineur | Passe par `assertActionAllowed(SUBSCRIPTION_ORG_SPONSORED)` — pas de comparaison directe à un booléen. |
| Quatre paliers | Aucun seuil dans le code, ni serveur ni client. Contraintes `CHECK` en base sur l'ordre et la plausibilité des seuils. |
| SMS parental | Trois tests épinglent le contenu : lien de décision présent, code présent, destinataire correct. |
| Numéros de téléphone | Masqués partout où ils entrent dans un journal (fournisseur SMS, journal d'audit du changement de parent, réponse publique au parent). |
| Route publique des seuils | Construite par liste blanche ; `gatedActions` ne peut pas fuiter. Vérifié sur serveur démarré : 200 sans jeton, et `/admin/country-policies` toujours 401. |
| Routes publiques de consentement | Vérifiées sur serveur démarré : demande inconnue → 404, refus sans code → 400 par validation. |

---

## 2. Écarts identifiés

### 2.1 — `User.isMinor` est un booléen gelé, jamais recalculé (MOYEN — non corrigé)

**Constat.** `isMinor` est écrit à l'inscription et **aucune écriture ne le met
jamais à jour** — vérifié par recherche sur tout le code. Un jeune inscrit à
17 ans reste `isMinor = true` indéfiniment, y compris à 25 ans.

Le module d'authentification énonce pourtant la règle, dans
`auth.module.ts` : « jamais une comparaison directe à `User.isMinor` hors de ce
module ». **Deux fichiers la violent :**

- `applications/applications.service.ts:185` — exige `hasFamilyInDestination`
  pour une offre à relocalisation. Un majeur continuera de se voir réclamer ce
  champ.
- `applications/internship-start-sweep.processor.ts:114` — envoie un SMS au
  « représentant légal » au début du stage. **Un majeur de 25 ans verrait un SMS
  partir vers le numéro déclaré comme parental à ses 16 ans.**

Le second cas est le plus gênant : ce n'est pas une gêne fonctionnelle mais une
**divulgation** — une information sur la situation professionnelle d'un adulte
envoyée à un tiers qui n'a plus aucun titre à la recevoir.

**Pourquoi ça n'a pas été vu plus tôt.** Le moteur de paliers, lui, recalcule
correctement : `classify()` part de la date de naissance à chaque appel. Le
système est donc juste là où on l'a regardé, et faux là où un raccourci a
survécu.

**Correctif proposé, non appliqué** (hors périmètre de cet audit) : remplacer
les deux usages par `minorPolicy.classify()`, et ajouter un test de source
interdisant `isMinor` hors du module d'authentification — le même procédé que
celui qui interdit les champs de sponsoring.

### 2.2 — `verifyRegistrationOtp` révèle l'existence d'un compte (FAIBLE — non corrigé)

`auth.service.ts:186` rend `404 « Compte introuvable »` pour un numéro inconnu.
La connexion, elle, rend correctement `« Identifiants invalides »` dans les deux
cas. Cette route permet donc de savoir si un numéro est inscrit.

Atténué par la limitation à 10 requêtes/minute, mais l'oracle existe. Pour une
plateforme qui traite des mineurs, savoir qu'un numéro donné est inscrit n'est
pas anodin.

**Correctif proposé, non appliqué** : réponse indifférenciée, comme à la
connexion.

### 2.3 — Aucune exigence de robustesse sur les secrets JWT (FAIBLE — non corrigé)

`JWT_ACCESS_SECRET` est lu par `getOrThrow` : absent, l'application échoue à la
première émission de jeton — bruyamment, donc acceptable. Le garde-fou de
démarrage attrape aussi une valeur d'exemple (`change-me`), parce que le nom
contient `SECRET`.

En revanche **aucune longueur minimale n'est vérifiée**. Un secret de trois
caractères passerait tous les contrôles et rendrait les jetons forgeables.

---

## 3. Corrections déjà réalisées

Toutes livrées et couvertes par des tests dont j'ai vérifié qu'ils **échouent
sans le correctif** (correctifs neutralisés exprès, trois assertions tombées,
toutes repassées après restauration).

### 3.1 — Le balayage suspendait des comptes devenus majeurs (GRAVE)

Il ne sélectionnait que sur la date du lien. Un jeune inscrit à 17 ans, majeur
au cinquième jour, dont le parent n'a jamais répondu, était désactivé au
trentième — pour une obligation éteinte. Et comme `isActionGated()` recalcule
l'âge, il pouvait candidater le lundi et se retrouver désactivé le mardi par un
travail de fond, sans avertissement.

Corrigé : l'âge est recalculé via la politique du pays avant toute suspension.
Le lien devient caduc, le **compte reste intact**. Sans date de naissance ni
pays, la protection est maintenue — sens sûr de l'erreur.

### 3.2 — Changer de parent ne révoquait rien (GRAVE)

Demander le consentement d'un nouveau numéro créait un lien `PENDING` mais
laissait l'ancien `ACTIVE`. Le contrôle d'accès cherche
`findFirst({ status: ACTIVE })` : il trouvait l'ancien et laissait tout passer.

Un mineur pouvait donc se faire valider par un adulte complaisant, puis
« changer de parent » sans aucune conséquence — le nouveau numéro ne recevait
qu'un code sans portée. C'est la « modification silencieuse » que le cahier des
charges interdit.

Corrigé : les liens actifs vers d'autres numéros sont révoqués et le compte
retombe en attente. Le numéro révoqué n'est pas journalisé.

### 3.3 — Le consentement était donné par l'enfant, pas par le parent (GRAVE)

Le SMS disait « communiquez-lui ce code ». Le parent dictait un code, l'enfant
le tapait. Le cahier des charges exige « une action positive et traçable de sa
part » — pas une délégation. Et un parent qui ne peut que transmettre un code ne
peut pas **refuser** : la route de refus n'avait aucune surface.

Corrigé : le SMS porte un lien vers un écran de décision et le code. Le lien dit
de quelle demande il s'agit, le code prouve la possession du téléphone.

### 3.4 — L'application n'appelait aucune route de consentement (GRAVE)

Vérifié : `requestConsent`, `confirmConsent` et le refus n'étaient appelés par
aucun écran. Un mineur s'inscrivait, son parent recevait le SMS, et le compte
restait restreint **pour toujours** faute de moyen de finir la validation.

Corrigé : écran public de décision, avec accord et refus.

### 3.5 — Le refus n'existait pas comme état (MOYEN)

Silence et refus se confondaient : trente jours d'attente dans les deux cas.
`DECLINED` bloque immédiatement. Le code est consommé — un refus ne se rejoue
pas et ne se retransforme pas en acceptation.

### 3.6 — Le numéro du parent était facultatif pour tous (MOYEN)

Un jeune de 15 ans pouvait s'inscrire sans qu'aucun parent ne soit jamais
sollicité, et sans comprendre pourquoi son compte restait restreint. Exigé
désormais au palier de consentement.

### 3.7 — Le seuil de 18 ans était codé en dur côté application (MOYEN)

L'écran d'inscription portait un `âge < 18` littéral. Il lit désormais les
seuils du serveur. La date de naissance ne traverse pas le réseau pour autant :
on reçoit des seuils, pas un verdict.

### 3.8 — Deux paliers se confondaient (MOYEN)

Un booléen mineur/majeur ne distingue pas 14-17 de 18-20. Quatre paliers
explicites, bornés par un `parentalInfoMaxAge` configurable. La borne du
consentement est `minParentRequiredAge`, non `minInternshipAge` — un pays
ouvrant le stage à 15 ans en n'exigeant le parent qu'à 16 aurait une bande de
mineurs sans obligation, et découper sur le mauvais seuil leur imposerait un
consentement contre leur propre législation.

---

## 4. Risques résiduels

**R1 — Le numéro du parent est déclaratif.** Rien n'empêche un mineur de saisir
le numéro d'un complice. C'est la limite assumée du MVP (`CLAUDE.md` §5), pas un
oubli. Les correctifs 3.2 et 3.3 la réduisent — changer de tuteur reconfirme, et
c'est le parent qui agit — mais ne la suppriment pas.

**R2 — Le lien de consentement dans un SMS est un porteur.** Quiconque lit le
SMS du parent détient le lien et le code. C'est le modèle de sécurité retenu :
la possession du téléphone vaut identité. Un membre de la famille ayant accès au
téléphone peut donc consentir à la place du parent.

**R3 — `isMinor` gelé** (§2.1). Non corrigé, deux usages hors module.

**R4 — Oracle d'énumération sur la vérification OTP** (§2.2).

**R5 — Pas de longueur minimale sur les secrets JWT** (§2.3).

**R6 — Un refus ne se révoque pas depuis l'application.** `DECLINED` bloque le
compte et seule une intervention administrative peut le rouvrir. C'est conforme
à l'exigence, mais aucun écran ADMIN ne le permet aujourd'hui : le parcours de
recours n'existe pas.

**R7 — Le parcours mineur n'a pas de surface.** L'enfant ne voit ni l'état de sa
demande, ni un moyen de la relancer si le code a expiré ou si le parent n'a rien
reçu. C'est le point 2 de l'ordre de travail validé.

**R8 — `session_replication_role`** doit être restreint en production, sans quoi
les journaux en ajout seul sont falsifiables par un administrateur de base.

---

## 5. Ce qui reste à tester

**Aucun parcours n'a été joué de bout en bout sur des données réelles.** Les
garanties de ce rapport reposent sur la lecture du code, les tests automatisés,
des sondes de routes sur serveur démarré, et des contraintes éprouvées sur une
copie de base restaurée. Concrètement, jamais exercé :

1. Inscription d'un mineur → SMS réel au parent → ouverture du lien → accord →
   déblocage des actions engageantes.
2. Le même parcours, terminé par un **refus** → blocage immédiat.
3. Le passage 17 → 18 ans sur un compte réel, avec un lien en attente.
4. Le changement de parent après validation → reblocage effectif.
5. Le balayage à 30 jours sur des données réelles.
6. Le comportement en cas d'échec d'envoi du SMS pendant l'inscription :
   **non audité**. Que voit l'utilisateur si l'opérateur refuse le message ?
   L'inscription est-elle annulée, ou le compte reste-t-il sans consentement
   possible ? À vérifier avant la recette.

La recette réelle exige d'abord une `APP_PUBLIC_URL` valide : sans elle, le lien
du SMS ne mène nulle part et la recette ne prouverait rien.

---

## 6. Recommandations avant passage en production

Par ordre de priorité.

1. **Corriger `isMinor`** (§2.1). C'est le seul écart de ce rapport qui peut
   envoyer une information sur un adulte à un tiers. Correctif simple, et un
   test de source empêchera la récidive.
2. **Construire le parcours mineur** (R7) : état de la demande, relance,
   messages explicites. Sans lui, un compte bloqué reste inexpliqué pour son
   titulaire — et c'est un mineur.
3. **Auditer l'échec d'envoi du SMS à l'inscription** (§5.6). Un cas d'erreur
   non regardé sur le chemin le plus sensible de la plateforme.
4. **Réponse indifférenciée sur la vérification OTP** (§2.2).
5. **Longueur minimale des secrets JWT** dans le garde-fou de démarrage (§2.3).
6. **Un écran ADMIN de recours** sur un refus parental (R6) — un refus par erreur
   ne doit pas condamner un compte sans voie de retour.
7. **Restreindre `session_replication_role`** (R8).
8. **Recette réelle complète** (§5), une fois `APP_PUBLIC_URL` fournie.
9. **Test d'intrusion indépendant et revue humaine** du module
   d'authentification (`CLAUDE.md` §7). Rien de ce rapport ne s'y substitue.

---

## 7. Ce que ce rapport ne couvre pas

- Les connexions sociales (Google, Facebook, Apple), écartées par le promoteur
  comme chantier séparé. Rappel du cahier des charges : **Apple devient
  obligatoire sur iOS** dès que Google ou Facebook est proposé, et un compte créé
  par ces canaux doit rester en statut incomplet jusqu'à vérification d'un
  numéro de téléphone.
- La tenue en charge des routes d'authentification.
- La sécurité de l'infrastructure d'hébergement.
- La conformité juridique des seuils d'âge retenus pour le Cameroun : ils
  reprennent le document du promoteur, ils n'ont pas été validés par un juriste.
