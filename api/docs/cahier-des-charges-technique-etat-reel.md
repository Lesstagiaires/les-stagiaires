# LES STAGIAIRES — Cahier des charges technique de l'état réel

**Date de relevé : 2026-08-15.** Document établi par lecture du code, non par
reprise du cahier des charges d'origine. Chaque chiffre qui y figure a été
compté dans le dépôt au moment du relevé.

> **Ce que ce document est.** Une description de ce qui existe. Là où
> l'implémentation s'écarte du cahier des charges initial, l'écart est signalé
> et motivé. Là où une décision technique a été prise sans qu'elle soit
> spécifiée, elle est énoncée — c'est même l'essentiel de ce que ce document
> apporte, car ces décisions ne se lisent nulle part ailleurs.

---

## 0. Vue d'ensemble mesurée

| Grandeur | Valeur relevée |
|---|---|
| Modèles Prisma | **85** |
| Énumérations Prisma | **78** |
| Migrations appliquées | **66** |
| Lignes de `schema.prisma` | 4 360 |
| Routes HTTP | **287**, réparties sur 26 contrôleurs |
| Code applicatif (hors tests) | ~32 900 lignes TypeScript |
| Tests | **81 fichiers, ~22 950 lignes, 1 268 cas** |
| Écrans mobiles | 60 fichiers `.tsx` |
| Langues d'interface | 5 — FR, EN, ES, AR (RTL), PT |
| Tâches planifiées (BullMQ) | 10 files |

### Socle technique

- **API** : NestJS, TypeScript strict, Prisma 7 (générateur `prisma-client`,
  adaptateur `@prisma/adapter-pg`), PostgreSQL.
- **Files** : BullMQ sur Redis.
- **Mobile** : Expo / React Native, routage par fichiers (`expo-router`).
- **Tests** : Jest ; les tests d'intégration créent une **base PostgreSQL
  éphémère** par suite, appliquent les migrations réelles, puis la détruisent.

### Le principe d'architecture le plus structurant : *provider-swap*

Toute dépendance externe est derrière une interface, avec au moins deux
implémentations choisies par variable d'environnement : SMS, e-mail, stockage,
antivirus, passerelle de paiement, limiteur de connexion. Ce n'était pas
spécifié. La raison : aucun de ces fournisseurs n'était arrêté au démarrage du
projet, et le code ne devait pas attendre ces décisions.

Le corollaire est un garde-fou de démarrage — `production-readiness.ts` — qui
**refuse de démarrer en production** si un fournisseur est resté sur sa valeur
de développement. Le raisonnement figure dans le fichier : toutes ces valeurs
*fonctionnent*, c'est ce qui les rend dangereuses. `SMS_PROVIDER=console` en
production signifie qu'aucun parent de mineur n'est jamais sollicité, et que la
plateforme croit l'avoir protégé.

---

## 1. Authentification

### Implémenté

Inscription (téléphone ou e-mail), OTP, connexion, rafraîchissement, sessions
multiples révocables, 2FA par SMS, mot de passe oublié, export RGPD,
désactivation et demande de suppression, rôles multiples avec historique,
contacts d'urgence. **27 routes** sur `/auth`, plus 5 sur
`/auth/age-thresholds` et 4 sur `/auth/minors/guardian-change`.

### Modèle de données

`User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `ParentalLink`,
`GuardianChangeRequest`, `CountryPolicy`, `OtpCode`, `RefreshToken`, `Session`,
`AuditLog`.

`AccountStatus` : `PENDING_VERIFICATION`, `AWAITING_PARENTAL_CONSENT`,
`ACTIVE`, `DEACTIVATED`, `PENDING_DELETION`, `DELETED`.

### Écarts avec le cahier des charges d'origine

**Le statut ne porte plus la preuve de possession du téléphone.** Un champ
distinct, `phoneVerifiedAt`, a été introduit. Motif : un défaut trouvé en
recette réelle le 2026-08-10. Neuf endroits écrivaient
`status = PENDING_VERIFICATION`, dont six sans rapport avec la vérification —
et `declineConsent` l'écrivait sans condition. Un compte jamais vérifié sortait
donc de ce statut dès qu'un tuteur refusait, et devenait connectable. Le
contournement ouvert : s'inscrire avec le numéro d'autrui, se déclarer tuteur,
refuser depuis son propre téléphone — le numéro de la victime, unique en base,
devenait inutilisable pour elle. **La connexion lit désormais un fait, plus un
statut.**

**Le mineur explore immédiatement.** Conformément à `CLAUDE.md` §5 mais contre
la lecture littérale du CDC initial, l'inscription d'un mineur n'est jamais
bloquée en attendant le parent. Seules les actions transactionnelles le sont.

**Les seuils d'âge sont des données, pas du code.** Un moteur `CountryPolicy`
porte, par pays : âge minimum, âge de consentement parental, majorité civile,
et la liste des actions verrouillées (`MinorGatedAction`). Une politique de
repli protectrice s'applique aux pays non configurés. Le CDC demandait la
configurabilité ; le choix d'un moteur en base plutôt que d'un fichier est une
décision technique.

**Le changement de tuteur est un module à part entière** (`GuardianChangeRequest`,
4 routes, écran d'administration dédié). Non spécifié à l'origine ; rendu
nécessaire par les situations réelles — tuteur injoignable, erreur de saisie,
changement de situation familiale.

### Décisions techniques non spécifiées

| Décision | Motif |
|---|---|
| Argon2id pour les mots de passe | Résistance mémoire-dure |
| Jetons de rafraîchissement **hachés** en base, rotation à chaque usage | Un vol de base ne donne pas de session |
| `OtpCode` : index unique **partiel** `(userId, purpose) WHERE consumedAt IS NULL` | Mesuré : trois envois simultanés laissaient deux codes vivants. L'index rend l'état impossible plutôt qu'improbable |
| Journal d'audit **en ajout seul**, garanti par déclencheur PostgreSQL | Un journal qu'on peut réécrire n'est pas un journal |
| Le serveur ne stocke **aucune phrase** de notification, uniquement des données structurées | Le client traduit en 5 langues |

### Sécurité — état après le chantier S-06

Quatre vulnérabilités ont été traitées, chacune mesurée avant et après.

**S-06-A — le verrou parlait avant le mot de passe.** Un compte désactivé
répondait 403 dès la première tentative, à qui ne connaissait rien de lui.
L'ordre a été inversé : le mot de passe d'abord, les décisions sur le compte
ensuite.

**S-06-B — oracle temporel.** Argon2 n'était atteint que si le compte existait.
Mesuré le 2026-08-12 : 2,26 ms de médiane pour un inconnu contre 71,46 ms pour
un compte réel, **plages disjointes**. Un condensat factice — produit par le
*même* appel `argon2.hash()`, pour que les paramètres ne puissent pas diverger —
égalise le travail. Remesuré le 2026-08-14 : rapport **1,001 / 0,993 / 1,022**
sur trois séries de vingt essais.

**S-06-C — un tiers pouvait verrouiller le compte d'autrui.** Le compteur
d'échecs vivait sur la ligne `User` de la cible : cinq requêtes d'un inconnu
excluaient son titulaire quinze minutes, vingt par heure l'en excluaient
indéfiniment, et le journal imputait le verrouillage à la victime. Le compteur
appartient désormais à l'**origine** de la tentative.

Le mécanisme retenu — architecture B′ — mérite d'être décrit, car il n'est pas
évident. « Ne compter que les échecs » est un piège pris au pied de la lettre :
un échec ne se connaît qu'après Argon2, or la décision doit précéder toute
lecture de la base. Lire avant et écrire après aurait laissé mille requêtes
simultanées passer sur un compteur à zéro. On **réserve** donc atomiquement
avant, et l'on **rembourse** dès que le mot de passe est prouvé. Le compteur ne
mesure pas les tentatives mais *les échecs, plus les vérifications en cours* :
au repos, sa valeur est nulle quel que soit le nombre d'utilisateurs derrière
l'adresse.

| Compteur | Budget | Conséquence | Remboursement |
|---|---|---|---|
| (origine, identifiant) | 5 / 15 min | 429 | `DEL` |
| (origine) — vigilance | 50 / 15 min | second facteur | `DECR` planchéré |
| (origine) — plafond dur | 500 / 15 min | 429 (survie CPU) | `DECR` planchéré |
| (identifiant) | 100 / heure | second facteur | `DECR` planchéré |

**La règle qui ordonne tout cela : aucun compteur partagé entre utilisateurs ne
doit pouvoir refuser un utilisateur légitime.** Quatre relations, vérifiées au
démarrage, la rendent inviolable depuis l'environnement. `budgetsDepuis()` lève
à la construction du module : une configuration incohérente n'atteint jamais le
limiteur.

Points d'implémentation notables : préfixage IPv4 `/32` et IPv6 **`/64`** — sans
quoi un attaquant changerait de suffixe à volonté ; clés Redis en **HMAC** —
sans quoi `KEYS lt:*` rendrait l'annuaire des numéros qui tentent de se
connecter, c'est-à-dire, sur cette plateforme, de jeunes gens ; disjoncteur à
trois erreurs ; repli mémoire aux mêmes budgets ; *fail-open* assumé, une panne
de cache ne devant pas devenir une panne d'authentification.

Le plafond HTTP `@Throttle` de `/auth/login` est passé de 10 à **300 par
minute**. À 10, le onzième abonné d'un NAT d'opérateur était rejeté avant même
d'atteindre le service — le déni de service existait aussi un étage plus haut.
300 est dérivé d'une mesure : ~74 ms par vérification Argon2, quatre fils
libuv, ~54/s par instance, dont au plus 10 % concédés à une adresse.

**Dette consignée** : S-06-A/B est traité **sur `/auth/login`** ;
`/auth/forgot-password` conserve un oracle préexistant — travail et SMS
conditionnés à l'existence du compte — et fait l'objet d'un chantier distinct.
Un attaquant partageant le NAT ou le `/64` de sa victime peut encore l'exclure
quinze minutes via le compteur privé.

---

## 2. Profils

### Implémenté

**21 routes** sur `/profiles`, plus 5 pour les documents. Profil, casquette
active, formations, expériences, langues, visibilité par rubrique, CV Vivant,
Carte Professionnelle Numérique, recommandations reçues.

### Modèle de données

`Profile`, `Education`, `Experience`, `ProfileLanguage`,
`ProfileSectionVisibility`, `ProfileShare`, `ProfileDocument`,
`Recommendation`, `ProfileSkill`.

### Écarts et décisions

**La visibilité est par rubrique, avec partage nominatif.** `SectionVisibility`
distingue public, restreint et privé ; `ProfileShare` autorise un utilisateur
nommément désigné. Les défauts d'un compte mineur sont resserrés sans action de
sa part.

**Correction de sécurité S-01.** Le `lsId` et la casquette active étaient
renvoyés à un visiteur anonyme sur `/profiles/:userId/cv` et `/card`, quelle
que soit la visibilité. Ils sont désormais conditionnés, et `cvVide()` /
`carteVide()` renvoient une forme complète mais neutre.

**Correction de sécurité S-03.** Ces mêmes endpoints levaient `NotFoundException`
quand le profil n'existait pas — ce qui en faisait un révélateur d'existence de
compte. Ils renvoient maintenant la forme vide.

Décision de test qui mérite d'être notée : les tests de ces endpoints
**énumèrent toutes les clés de la réponse** au lieu de vérifier les champs
attendus. C'est ce qui attrape le champ que personne n'a pensé à tester.

---

## 3. LS-ID et Digital Safe

### Implémenté

**13 routes** : documents (8), partages (4), passeport (1). Versionnage,
partage sélectif à expiration, révocation, QR code, journal d'accès consultable,
Passeport Professionnel Africain.

### Modèle de données

`DigitalSafeDocument`, `DigitalSafeDocumentVersion`, `DigitalSafeShare`,
`DigitalSafeAccessLog`.

### Le LS-ID

Format `LS-<PAYS>-<ANNÉE>-<6 caractères>`. L'alphabet exclut **O, 0, I et 1** :
l'identifiant est destiné à être lu à voix haute et recopié à la main.
Génération par `randomInt` cryptographique, avec vérification d'unicité en
boucle bornée.

L'identifiant d'organisation suit la même logique avec un préfixe **`ORG-`** ou
**`EDU-`** selon le type — ce qui rend le type lisible dans l'identifiant
lui-même.

### Décisions non spécifiées

| Décision | Motif |
|---|---|
| Empreinte SHA-256 par version | Vérifier qu'un document partagé n'a pas été altéré depuis son dépôt |
| Analyse antivirus **avant** enregistrement, provider-swap | `CLAUDE.md` §4 |
| Suppression logique puis purge différée (file `digital-safe-cleanup`) | Jamais de suppression physique immédiate |
| Chiffrement de champ applicatif — `FieldEncryptionService`, trousseau versionné `v1:…,v2:…` avec clé active | Rotation possible sans migration de données |
| Les artefacts de candidature (convention, attestation) **vivent dans le Digital Safe**, pas dans un stockage parallèle | Un seul endroit chiffré, un seul journal d'accès |

---

## 4. Opportunités

### Implémenté

**13 routes** sur `/opportunities`, plus favoris (3), alertes (4),
organisations (8), membres (6), besoins spéciaux (4), administration de la
recherche (10).

Cycle de vie complet : `DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `PAUSED`, `FILLED`,
`EXPIRED`, `CANCELLED`, `REPORTED`, `SUSPENDED`, `ARCHIVED`.

### Modèle de données

`Opportunity`, `OpportunityFavorite`, `OpportunityAlert`, `OpportunitySkill`,
`Skill`, `Occupation`, `SearchSynonym`, `SearchRankingRule`,
`OrganizationNeedRequest`.

### L'écart le plus important : le classement par pertinence seule

Décision du promoteur : **le classement n'est jamais fonction du paiement**. Le
score est calculé par `RelevanceScoringService` selon des critères pondérés —
correspondance de compétences, de métier, de localisation, de niveau d'études,
fraîcheur.

> **Correction du 2026-08-16.** Une première version de ce document écrivait
> « ni sponsoring, ni mise en avant payante ». La feuille de route officielle
> est plus nuancée : une mise en avant payante **est** prévue, financée par le
> catalogue de prestations commerciales, mais elle porte un badge
> « Annonce sponsorisée » visible et **ne peut jamais évincer une offre plus
> pertinente** pour le candidat. Ce qui est interdit, c'est que le paiement
> entre dans le score — pas la mise en avant elle-même, dès lors qu'elle est
> signalée et non substitutive. **Rien de tout cela n'est implémenté à ce
> jour** : ni badge, ni emplacement sponsorisé.

Trois choix d'implémentation en découlent :

1. **Aucune pondération codée en dur.** Les poids vivent dans
   `SearchRankingRule`, modifiables par l'administration sans redéploiement.
   Des valeurs de repli existent dans le code (35 / 25 / 15 / 10…) et ne servent
   que si la table est vide.
2. **Le score numérique n'est jamais exposé** au client. Le rendre visible
   inviterait à l'optimiser, donc à jouer le classement.
3. Un service distinct, `OfferQualityService`, note la complétude d'une offre —
   séparé du classement, pour que la qualité rédactionnelle ne devienne pas une
   monnaie d'échange.

**Les synonymes de recherche sont une table**, pas une liste en dur : un moteur
qui ignore « dev » pour « développeur » ne sert à rien dans un contexte où le
vocabulaire varie fortement.

---

## 5. Candidatures

### Implémenté

**22 routes**. C'est le service le plus volumineux du projet — 1 454 lignes.

### Modèle de données

`Application`, `ApplicationStatusEvent`, `ApplicationDocumentRequest`,
`ApplicationArtifact`, `TravelConsent`.

### L'écart majeur : lettre d'admission puis convention

Le CDC d'origine prévoyait qu'une décision favorable confirme le stage. Le
cycle a été refondu : la décision de l'organisation génère une **lettre
d'admission**, que le candidat doit **accepter explicitement**. La convention
n'est générée qu'ensuite.

Motif : la décision d'une organisation ne peut pas engager un candidat qui ne
s'est pas prononcé. Le statut `ADMISSION_LETTER_SENT` matérialise cet
entre-deux.

### Le second écart : le consentement de déplacement

Statut `AWAITING_TRAVEL_CONSENT`. Pour un **mineur** acceptant une offre à
relocalisation, l'accord actif du parent est requis **pour ce déplacement
précis**, enregistré dans `TravelConsent`, avant génération de la convention.

La nuance implémentée, et qui n'était pas dans le CDC : le mineur **peut
candidater à toute offre dès le dépôt**. C'est l'acceptation qui conditionne le
départ, pas la candidature. L'inverse aurait fermé des portes en amont, sans
protéger davantage.

Le parent reçoit un **SMS** porteur d'un code — c'est le seul canal qui
l'atteigne, puisqu'il n'a pas nécessairement de compte. Une file
`travel-consent-sweep` relance et expire.

### Signature

Signature **légère déclarative** : horodatage, identité, adresse IP,
acceptation explicite. Le CDC restait muet sur le mécanisme. Une signature
électronique qualifiée n'était ni proportionnée ni disponible dans le contexte.

Trois parties peuvent signer : candidat, organisation, et **établissement**
lorsque le stage s'inscrit dans un cursus.

### Renouvellement d'accès

File `application-share-renewal-sweep` : l'accès d'une organisation aux
documents du candidat est **renouvelé automatiquement** tant que la candidature
est vivante, et cesse ensuite. Le CDC prévoyait un partage ; la logique
d'expiration et de renouvellement est une décision technique.

---

## 6. Entreprises et organisations

### Implémenté

**8 routes** organisations, **6** membres d'équipe, **4** besoins spéciaux.
Création, vérification par l'administration, page publique et marque employeur,
équipe et invitations, suivi des stages et calendrier, recommandation à la
clôture, vitrine des partenaires.

### Modèle de données

`Organization`, `OrganizationMember`, `OrganizationNeedRequest`.
`OrganizationType` : `ENTREPRISE` ou `ETABLISSEMENT` — **un seul modèle pour
deux natures**, distinguées par un champ et par le préfixe de l'identifiant.

### Décisions non spécifiées

**Un service d'autorisation partagé** plutôt que des vérifications ad hoc dans
chaque contrôleur. `CLAUDE.md` §3 interdit le rôle « admin » fourre-tout ; la
conséquence pratique est qu'un même point de passage décide qui peut agir au
nom d'une organisation.

**Les besoins saisonniers, temporaires et bénévoles sont un modèle distinct**
(`OrganizationNeedRequest`) et non un type d'offre. Motif : ils suivent un
circuit d'approbation différent, et la publication reste bloquée tant que
l'administration n'a pas répondu.

---

## 7. Établissements

### Implémenté

**15 routes**. Rattachement et vérification des apprenants, campagnes de stage,
suivi des conventions, rapports de stage avec correction et validation, tableau
de bord d'insertion, répertoire des entreprises partenaires.

### Modèle de données

`EstablishmentLearner`, `InternshipCampaign`, `InternshipReport`.

### Décisions non spécifiées

**Le rattachement d'un apprenant est bilatéral.** L'établissement invite,
l'apprenant **accepte ou refuse** (`/establishments/enrollments/:learnerId/accept`
et `/decline`). Un établissement ne peut pas s'attribuer unilatéralement un
apprenant.

C'est la même logique que celle retenue pour les attestations : une attestation
émise par un établissement ne devient visible sur le profil qu'après un
consentement actif et distinct — celui du titulaire s'il est majeur, celui du
parent s'il est mineur.

---

## 8. Programme d'Ambassadeurs

Le module le plus étendu après les candidatures : **72 routes**, 8 services,
~5 000 lignes.

### Modèle de données

`Ambassador`, `AmbassadorEvent`, `AmbassadorReferral`,
`AmbassadorPortfolioEntry`, `PortfolioEvent`, `CommissionRule`, `Commission`,
`CommissionCap`, `CommissionEvent`, `AmbassadorWallet`, `WalletTransaction`,
`PayoutRequest`, `PayoutEvent`, `TrainingModule`, `TrainingProgress`,
`QuizQuestion`, `QuizAttempt`, `AmbassadorIdentityDocument`, `FraudRule`,
`FraudAlert`, `AmbassadorPaymentDetail`, `AmbassadorPaymentDetailEvent`,
`AmbassadorPolicy`.

### Cycle de vie en 11 statuts

`SUBMITTED` → `UNDER_REVIEW` → (`ADDITIONAL_INFORMATION_REQUIRED`) →
`VERIFIED` → `APPROVED` → `CONTRACT_PENDING` → `TRAINING_PENDING` →
**`ACTIVE`** → `SUSPENDED` / `TERMINATED` / `REJECTED`.

**Le code de parrainage n'est généré qu'après signature du contrat et formation
validée.** `ACTIVE` est le seul statut qui autorise le parrainage. Un code émis
plus tôt aurait circulé avant que son porteur soit formé et engagé.

### Décisions structurantes non spécifiées

| Décision | Motif |
|---|---|
| **Grand livre en ajout seul** (`WalletTransaction`), solde en cache reconstructible | Un solde qu'on peut écrire directement n'est pas un solde |
| Réconciliation périodique, divergence **notifiée à l'administration**, aucune correction automatique | Une correction silencieuse masque la cause |
| Coordonnées de versement **chiffrées et masquées côte à côte**, une seule porte de déchiffrement, journalisée | Se protéger aussi de l'administrateur malveillant |
| Changement de coordonnées → alerte **e-mail *et* SMS, non désactivable** | C'est par cette notification que quelqu'un dont le compte est détourné peut s'en apercevoir. Couper cette alerte reviendrait à offrir le silence au détourneur |
| Alertes de fraude adressées à l'administration, **jamais à l'intéressé** | Prévenir quelqu'un qu'il est surveillé lui apprend à ne plus l'être |
| Plafonds de commission → mise en revue **notifiée** | Sans cela, une commission plafonnée dormirait indéfiniment |
| Compte à rebours de portefeuille : alertes à 9, 11 et 12 mois, **sur liste blanche SMS** | Conséquence financière directe ; l'ambassadeur doit pouvoir réagir sans ouvrir l'application |
| Pièces d'identité classées **« Très sensible »**, double vérification à l'attachement | `CLAUDE.md` §1 |

### Motifs communicables à trois niveaux

Séparation **structurelle**, non disciplinaire : le motif interne d'une
décision, le motif communicable à l'intéressé, et la note libre
d'administration sont trois champs distincts. **Aucune note libre d'admin ne
peut se retrouver dans un e-mail.** Le code rend l'erreur impossible plutôt que
de compter sur la vigilance.

---

## 9. Formules d'abonnement

### Implémenté

**7 routes** + 1 webhook de paiement. Souscription individuelle, souscription
d'organisation, **parrainage** d'un bénéficiaire par une organisation,
consultation, annulation, back-office d'administration.

### Modèle de données

`Subscription`, `Payment`. `SubscriptionPlan` : `GRATUIT`,
`CARRIERE_SECURISEE`, `CARRIERE_PLUS`, `BUSINESS`, `INSTITUTION`.

### Écart de nommage

Les formules **PROTECT** et **PRO** du CDC d'origine ont été renommées
**CARRIÈRE SÉCURISÉE** et **CARRIÈRE PLUS** — décision du promoteur.

### Tarifs relevés

Convention maison : **100 unités mineures = 1 FCFA**, jamais de flottant.

| Formule | Unité mineure | Équivalent |
|---|---|---|
| `CARRIERE_SECURISEE:ANNUAL` | 200 000 | 2 000 FCFA |
| `CARRIERE_PLUS:ANNUAL` | 500 000 | 5 000 FCFA |
| `BUSINESS:ANNUAL` | 30 000 000 | 300 000 FCFA |
| `INSTITUTION:ANNUAL` | 30 000 000 | 300 000 FCFA |

BUSINESS et INSTITUTION portent la mention explicite « valeur d'attente : aucun
tarif n'a été arbitré pour elles ». Les tarifs sont **surchargeables par pays**
via `SUBSCRIPTION_PRICING_JSON` : l'expansion hors zone franc CFA passera par
là, sans toucher au code.

**Le montant est toujours résolu côté serveur**, jamais fourni par le client
(`CLAUDE.md` §6).

### Décisions non spécifiées

**Le webhook fait foi, jamais la déclaration de l'utilisateur.** Un abonnement
ne passe à `ACTIVE` que sur confirmation de la passerelle. `CLAUDE.md` §6
interdit par ailleurs que l'application reçoive un identifiant de paiement.

**Redirection parentale optionnelle, jamais bloquante.** Un mineur en
auto-souscription peut demander la redirection vers son tuteur
(`parentRedirectRequested`) ; le champ est purement informatif. En revanche, un
abonnement provenant d'un établissement ou d'une entreprise pour un mineur
exige l'accord parental.

Expiration automatique par la file `subscription-expiry`.

---

## 10. Modules transverses

### Centre de Notifications

**11 routes.** `NotificationType` compte une cinquantaine de valeurs, classées
en quatre comportements de diffusion. Canaux : `IN_APP`, `EMAIL`, `SMS`, `PUSH`.

**Politique SMS.** Le SMS est traité comme une ressource rare et coûteuse.
Quatre notifications qui partaient en SMS ont été migrées vers le canal interne.
Une **liste blanche** (`critical-sms-types.ts`) énumère les seuls types
autorisés à emprunter le SMS : ceux dont le destinataire n'a pas de compte
(consentement parental), ou dont l'enjeu ne se rattrape pas (rappel de début de
stage, alerte de changement de coordonnées bancaires, expiration de
portefeuille).

**Convention maison : le serveur ne stocke que des données structurées, jamais
une phrase.** La traduction est faite par le client, en cinq langues.

### Programme de Partenariat

**22 routes.** Module **GELÉ au 2026-08-02** ; `docs/module-partenariats.md`
fait foi et toute évolution doit s'y reporter.

Deux entonnoirs volontairement distincts, ce qui n'était pas dans le CDC :
`partnership-requests` traite les **prospects entrants** du formulaire public
(nom en texte libre, aucun compte) ; `partnerships` traite les organisations
**déjà vérifiées et titulaires d'un compte**.

Décisions notables : partenariat **gratuit** et **sans expiration** ; un dossier
incomplet reste `PENDING`, jamais `REFUSED` — traiter une pièce manquante comme
un refus fermerait une porte qui devait rester ouverte ; `PartnershipEvent` est
**en ajout seul**, comme `AuditLog`.

### Signalement et modération

`Report` (4 routes), mécanisme partagé entre profils, offres et candidatures.

---

## 11. Application mobile

60 écrans. Trois espaces : candidat, **recruteur** (`/recruiter`, 16 écrans),
**ambassadeur** (`/ambassador`, 5 écrans), plus les écrans d'administration.

Design system **KORA** : jetons, polices, composants de base, `EmptyState`
partagé.

Internationalisation **FR / EN / ES / AR / PT**, avec prise en charge RTL
complète pour l'arabe — ~840 clés.

**Dette connue (S-05)** : deux écrans utilisent encore `Alert.alert`, qui ne
fonctionne pas sur le web.

---

## 12. Traitements planifiés

Dix files BullMQ : `account-cleanup`, `parental-consent-sweep`,
`travel-consent-sweep`, `subscription-expiry`, `opportunity-lifecycle`,
`digital-safe-cleanup`, `document-cleanup`,
`application-share-renewal-sweep`, `internship-start-sweep`,
`ambassador-sweep`.

---

## 13. Ce qui reste ouvert

### Chantiers non démarrés

| Sujet | État |
|---|---|
| Fournisseur SMS réel (Africa's Talking) | Adaptateur écrit, **non configuré** |
| Assistant IA d'orientation | À cadrer |
| Espace publicitaire | À cadrer |
| Module Partenariat, suite | Étape 1 livrée, gelée |

### Dette de sécurité consignée

| Réf. | Sujet | Gravité |
|---|---|---|
| — | `/auth/forgot-password` : oracle temporel et d'existence, hors du limiteur | 🟠 |
| — | NAT ou `/64` partagé : un attaquant de la même origine peut exclure sa victime 15 min | 🟠 |
| — | Race du délai de garde SMS (exige de connaître le mot de passe) | 🟡 |
| — | *Fail-open* Redis → mémoire : budget remis à zéro à la bascule | 🟡 |
| — | Cliquet de `@nestjs/throttler` 6.5.0 : le déblocage d'une clé gèle la décroissance des autres (mesuré) | 🟡 |
| — | Tracker IPv6 brut de `@Throttle`, sans préfixe `/64` | 🟡 |
| S-04 | `OTP_TTL_MINUTES = 5` | 🟡 |
| S-05 | `Alert.alert` sur deux écrans | 🟠 |
| S-07 | Oracle d'existence via `POST /auth/register` | 🟡 |

### Écarts relevés avec la feuille de route officielle

Relevé le 2026-08-16 contre *Feuille de route stratégique et financière,
version 1.0, mise à jour du 15 août 2026*. **Aucun de ces écarts n'a été
corrigé** : chacun engage une décision métier ou tarifaire qui appartient au
promoteur (charte §9.4).

| # | Écart | Gravité |
|---|---|---|
| R-1 | **Tarif CARRIÈRE SÉCURISÉE.** Le code porte 200 000 unités mineures = **2 000 FCFA/an**. La feuille de route fixe **1 000 FCFA/an** et déclare le palier à 2 000 FCFA « définitivement supprimé ». Le code porte donc exactement le tarif abandonné. CARRIÈRE PLUS (5 000 FCFA) est conforme. | 🔴 |
| R-2 | **Restriction de candidature.** Un abonné CARRIÈRE SÉCURISÉE ne doit pas pouvoir candidater à une offre de **stage professionnel** durant l'année. Aucune règle de ce genre dans le code. `OpportunityType` distingue déjà `ACADEMIC_INTERNSHIP` et `PROFESSIONAL_INTERNSHIP` : **aucun nouveau modèle n'est nécessaire**. | 🔴 |
| R-3 | **Onboarding par intention** (Pays → Intention → Identité → Parcours dynamique → Profil central → Évolution). Non implémenté. La feuille de route demande explicitement, avant tout développement, **un rapport d'architecture en lecture seule** — sans modification ni commit. | 🔴 |
| R-4 | **Test de personnalité/orientation** réservé aux majeurs de niveau Licence à Master. Doit devenir une entrée de **`MinorGatedAction`** (charte §9.3), pas une vérification isolée. Absent. | 🟠 |
| R-5 | **Mobile Money.** Orange Money **et** MTN MoMo attendus dès le premier jour. Seule la passerelle `simulated` existe ; `PAYMENT_GATEWAY_PROVIDER` refuse `simulated` en production, donc le garde-fou tiendra — mais aucun adaptateur réel n'est écrit. | 🟠 |
| R-6 | **Socle gratuit « à ne jamais différer »** : assistant CV/lettre de motivation, notifications de base, FAQ/assistant de questions courantes. Les **notifications existent** ; l'assistant CV et le chatbot FAQ ne sont pas commencés. | 🟠 |
| R-7 | **Contrat d'Apporteur d'Affaires par PAYS.** Le code a bien `CONTRACT_PENDING` et `POST /ambassadors/:id/contract`, mais le verrou est **par ambassadeur**, pas **par pays**. La feuille de route exige que le premier versement dans un pays reste bloqué tant que le cadre local n'est pas couvert. | 🟠 |
| R-8 | **Taux de commission** : 20 % sur CARRIÈRE SÉCURISÉE/PLUS, 10 % sur les prestations, avec paliers de performance. Le modèle `CommissionRule` est bien configurable et non codé en dur — conforme à l'esprit — mais **les valeurs de la feuille de route ne sont pas chargées**. | 🟡 |
| R-9 | **Mise en avant sponsorisée** avec badge visible : prévue, non implémentée (voir §4). | 🟡 |

### Avant toute mise en production

`CLAUDE.md` §7 le pose et rien ici ne s'y substitue : **un audit de sécurité
indépendant** par un tiers qualifié, une **validation de l'architecture
d'hébergement** par une personne compétente, et une **revue humaine** du code
touchant l'authentification, les paiements et le Digital Safe.

---

## 14. Méthode de travail — ce qui a réellement gouverné les décisions

Ces principes ne figuraient pas au cahier des charges ; ils se sont imposés en
cours de route et expliquent la forme du code mieux que n'importe quelle
spécification.

**Ne jamais déduire un fait d'un état qui bouge pour d'autres raisons.** C'est
la leçon du statut `PENDING_VERIFICATION` qui servait à neuf choses ; elle a
produit `phoneVerifiedAt`, et la même vigilance ailleurs.

**Préférer une garantie structurelle à une discipline.** Contraintes CHECK,
index uniques partiels, déclencheurs d'ajout seul, types qui rendent un appel
fautif incompilable. Un index unique partiel rend deux codes OTP vivants
*impossibles* ; une relecture attentive les rend seulement *improbables*.

**Mesurer, ne pas supposer.** Les oracles temporels ont été chronométrés avant
et après ; le comportement de `trust proxy` a été mesuré sur HTTP réel ; le
défaut de décroissance de `@nestjs/throttler` a été reproduit sur la
bibliothèque installée. Aucun chiffre de ce document n'est estimé.

**Éprouver les tests par sabotage.** Chaque propriété de sécurité est vérifiée
en cassant volontairement le code et en exigeant que le test tombe. Cette
méthode a révélé, à plusieurs reprises, des tests **verts mais incapables de
détecter la faute qu'ils prétendaient couvrir** — bornés par le mauvais
compteur, ou avec des marges temporelles trop courtes. Ils ont été renforcés,
non acceptés.

**Le test dit pourquoi, pas seulement quoi.** Les commentaires portent le
raisonnement et la mesure qui l'a motivé, pour que la prochaine personne
comprenne l'intention avant de modifier la règle.
