# Registre de dette de sécurité

**Tenu depuis le 2026-08-10.**

Règle posée par le promoteur : *« un élément non corrigé doit rester explicitement
dans le registre jusqu'à sa clôture. Nous ne déclarons pas une fonctionnalité
terminée simplement parce que ses tests fonctionnels sont verts. »*

Tout risque classé 🔴 est un **bloqueur de production** : aucun déploiement tant
qu'il est ouvert.

---

## Entrées ouvertes

| # | Sujet | Niveau | Correction immédiate ? |
|---|---|---|---|
| S-03 | Révélateur d'existence de compte (200/404) | 🟡 | non |
| S-04 | `OTP_TTL_MINUTES = 5` | 🟡 | non — arbitrage produit |
| S-05 | `Alert.alert` sur deux écrans (dette connue) | 🟠 | non — hors périmètre |

## Entrées closes

| # | Sujet | Clos le |
|---|---|---|
| S-00a | Refus parental injouable sur le web | 2026-08-09 |
| S-00b | Compte définitivement bloqué si l'OTP expire | 2026-08-10 |
| S-00c | Un refus parental « vérifiait » le téléphone | 2026-08-10 |
| S-00d | Deux codes vivants sous concurrence | 2026-08-10 |
| S-00e | `destinationLabel` en clair sur base neuve | 2026-08-10 |
| **S-02** | **Documents confidentiels téléchargeables anonymement** | **2026-08-10** |
| **S-01** | **`lsId` exposé à un visiteur anonyme** | **2026-08-12** |

> **S-01** — corrigé par le commit `92d37a85dd1e99b6877a983ab17cd48e44d04f56`,
> **21 tests passés** sur base PostgreSQL réelle, **poussé sur `main`** le
> 12 août 2026.

---

# S-01 — CLOS le 2026-08-12

**Statut : CORRIGÉ.** Commit `92d37a85dd1e99b6877a983ab17cd48e44d04f56`, poussé
sur `main` le 12 août 2026.

**Ce qui a été fait.** Les trois champs qui sortaient hors du moteur de
visibilité y sont rentrés, et rien d'autre n'a changé.

1. `lsId` et `activeRole` sont soumis à la rubrique `SUMMARY`, dans
   `getCvVivant` comme dans `getCarteProfessionnelle`. Quatre lignes.
2. `documentsInDigitalSafe` est soumis à la rubrique `DOCUMENTS` — celle-là même
   qui régit les fichiers qu'il dénombre. Depuis S-02 cette rubrique ne peut plus
   être `PUBLIC` : le compte ne sortira donc jamais à un anonyme, quelle que soit
   la configuration du titulaire. Les deux corrections se tiennent. `null` et non
   `0` : zéro serait une réponse, et une réponse fausse.
3. `VisibilityService` est exporté par `ProfilesModule` pour que le Passeport
   partage le moteur au lieu d'en réinventer un, et de diverger.

**Ce qui n'a pas changé.** Le défaut de `canView` reste `PRIVATE`. Les routes
restent publiques avec garde optionnel : c'est le contenu qu'on filtre, pas la
porte. Aucun schéma modifié, aucune migration, aucune donnée touchée — la fuite
était dans une projection en mémoire.

**La défense en profondeur, et pourquoi elle compte plus que le correctif.** Les
trois champs d'aujourd'hui étaient le petit problème ; le grand est le quatrième,
celui qu'on ajoutera dans six mois sans y penser. Le test structurel de
`identite-publique.integration.spec.ts` ne connaît aucun nom de champ : il
parcourt toutes les clés de la réponse et exige qu'un anonyme n'en reçoive aucune
renseignée.

**Vérification.** 21 tests sur PostgreSQL réel, tous passés — anonyme sur profil
privé, titulaire, `NETWORK`, `PRIVATE`, `SHARED` accordé puis révoqué, compte
mineur, IDOR, et les trois tests structurels. Suite complète : 76 suites,
1140 tests, verts.

**Quatre sabotages, tous rouges.** Retirer la barrière `SUMMARY` : 13 échecs.
Retirer le filtre `DOCUMENTS` : 3 échecs. Basculer le défaut de `canView` sur
`PUBLIC` : 9 échecs. Ajouter un champ non filtré (`countryOfResidence`) :
2 échecs — les deux tests structurels, et eux seuls, qui l'ont nommé dans leur
message alors qu'aucun test ne le surveillait.

**Reste ouvert, hors périmètre de cette correction.** La question produit du
Passeport : FR-M3-002 le décrivait comme mettant en avant le LS-ID ; un visiteur
anonyme reçoit désormais un passeport vide. À arbitrer.

---

## Le constat d'origine, conservé pour mémoire

## S-01 — `lsId` exposé à un visiteur anonyme

**Cause.** `CvService.getCvVivant` et `getCarteProfessionnelle` renvoient `lsId` et
`activeRole` **hors du moteur de visibilité** ; `PassportService` y ajoute
`documentsInDigitalSafe`. Ces trois champs sortent quelle que soit la
configuration du titulaire.

**Scénario d'exploitation.** Qui détient l'identifiant technique d'un compte
appelle `GET /profiles/:userId/cv` sans authentification et obtient le LS-ID,
même si toutes les rubriques sont privées et même si le titulaire est mineur.
Vérifié en exécution le 2026-08-09 : toutes les rubriques à `null`, `lsId`
renvoyé.

**Données exposées.** LS-ID (identifiant pérenne de la personne sur la
plateforme), casquette active, nombre de documents au Coffre-fort.

**Criticité — 🟠 moyenne.** L'identifiant de compte est un `cuid` de 25
caractères : il ne s'énumère pas. Il faut donc l'avoir obtenu par ailleurs — un
lien partagé, un journal, une capture d'écran. Mais le LS-ID est destiné à
identifier durablement une personne, et le rendre à un anonyme sur un profil
entièrement privé contredit la protection renforcée par défaut des mineurs
(CLAUDE.md §5).

**Correction recommandée.** Soumettre `lsId` et `activeRole` à la rubrique
`SUMMARY`, et `documentsInDigitalSafe` à la rubrique `DOCUMENTS`. Trois lignes,
mais **modification du périmètre fonctionnel** : un client qui affiche
aujourd'hui le LS-ID sur un profil public cesserait de l'avoir. À arbitrer.

**Immédiate ?** Non. Avant production.

---

# S-02 — CLOS le 2026-08-10

**Ce qui a été fait.** Trois verrous, à trois niveaux différents — parce qu'un
seul se contourne.

1. **La cause** : `setVisibility` refuse `PUBLIC` sur la rubrique `DOCUMENTS`,
   pour tous, mineurs comme majeurs. Ce n'est pas l'âge du titulaire qui fixe la
   règle, c'est la nature de la donnée.
2. **Les données déjà écrites** : migration `20260810180000` — tout `PUBLIC`
   subsistant est rétrogradé en `NETWORK`, et une contrainte `CHECK` interdit
   désormais cet état en base. Un script d'administration ou un futur service
   qui écrirait cette table sans passer par le service échoue au lieu de rouvrir
   la brèche.
3. **La défense en profondeur** : la route de téléchargement n'est plus publique,
   et `download` exige un demandeur identifié **par sa signature**. Retirer le
   décorateur ne suffirait pas — il faudrait aussi élargir le type, ce qu'un
   sabotage surveille.

**Ce qui n'a pas changé.** Le partage nominatif, l'accès réseau et le CV public
fonctionnent comme avant. Seul l'anonymat disparaît, et lui seul.

**Vérification** : 14 tests sur base réelle, 6 sabotages tous rouges.

---

## Le constat d'origine, conservé pour mémoire

## S-02 — La rubrique `DOCUMENTS` pouvait être rendue publique

**Cause.** `VisibilityService.setVisibility` interdit `PUBLIC` aux mineurs, mais
l'autorise aux majeurs **pour toutes les rubriques, y compris `DOCUMENTS`**.
`DocumentsService.download` s'appuie ensuite sur `canView(..., DOCUMENTS, ...)` :
si la rubrique est publique, le fichier **déchiffré** est servi à un anonyme.

**Scénario d'exploitation.** Un majeur bascule `DOCUMENTS` en `PUBLIC` — par
curiosité, ou sans mesurer la portée du mot « public ». Tout identifiant de
document en circulation devient alors un lien de téléchargement ouvert. Aucune
autre condition n'est requise.

**Données exposées.** Le **contenu** des documents de profil. `ProfileDocument`
ne connaît que trois catégories — `PHOTO`, `PORTFOLIO`, `OTHER` — et elles sont
**déclaratives** : rien ne contraint ce qu'un titulaire dépose sous `OTHER`,
qu'il s'agisse d'un justificatif, d'un diplôme numérisé ou d'une pièce
d'identité. CLAUDE.md §1 classe ces fichiers en **Confidentiel**, voire **Très
sensible** dès qu'une pièce d'identité s'y trouve.

> *Rectification du 2026-08-11.* La formulation initiale — « diplômes,
> attestations, pièces d'identité » — laissait croire à des catégories dédiées
> dans `ProfileDocument`. Ces pièces-là relèvent du Coffre-fort numérique. La
> portée juridique et sécuritaire du constat est inchangée : la classification
> Confidentiel s'applique au contenu déposé, pas au nom de sa catégorie.

**Criticité — 🔴 haute.** Un seul interrupteur fait passer une donnée
Confidentielle en Publique. C'est une contradiction directe avec la
classification, et elle ne dépend que d'un geste d'utilisateur mal compris.
L'accès est journalisé et l'intégrité vérifiée, ce qui aide après coup — pas
avant.

**Correction recommandée.** Refuser `PUBLIC` sur la rubrique `DOCUMENTS`, quel
que soit l'âge : plafond à `NETWORK` ou `SHARED`. Le partage nominatif existe
déjà et couvre le besoin légitime. **Modification du périmètre fonctionnel** :
un profil ayant déjà mis ses documents en public verrait la visibilité
rétrogradée, ce qui suppose une migration de données et un message aux
titulaires concernés.

**Immédiate ?** **Oui, avant production.** Aucun document réel n'existe
aujourd'hui — c'est le bon moment.

---

# S-03 — Révélateur d'existence de compte

**Cause.** `CvService` lève `NotFoundException` quand le profil n'existe pas, et
répond `200` sinon. Un anonyme distingue donc un identifiant réel d'un
identifiant inventé.

**Scénario d'exploitation.** Confirmer qu'un identifiant obtenu ailleurs
correspond bien à un compte actif. Sans énumération possible, la portée reste
étroite.

**Données exposées.** L'existence d'un compte, rien d'autre.

**Criticité — 🟡 faible.** Les `cuid` ne s'énumèrent pas. Le cumul avec S-01, qui
donnait une correspondance identifiant → LS-ID à qui possédait déjà un
identifiant, n'existe plus : S-01 est clos depuis le 2026-08-12. Reste la portée
propre de S-03, énoncée ci-dessus.

**Correction recommandée.** Rendre une réponse vide plutôt qu'une erreur, comme
le fait déjà `/auth/resend-otp`. Attention : cela empêcherait un client de
distinguer « profil inexistant » de « profil entièrement privé », ce qui peut
dégrader des messages d'interface.

**Immédiate ?** Non. S-01 étant clos, S-03 ne se traite plus par ricochet : il
s'apprécie selon sa surface propre, celle décrite ci-dessus.

---

# S-04 — `OTP_TTL_MINUTES = 5`

**Nature.** Décision produit et sécurité à arbitrer, pas un défaut.

**Ce que la valeur signifie.** Le code d'inscription expire cinq minutes après
son envoi. C'est un délai pensé pour un réseau où le SMS arrive en quelques
secondes.

**Conséquences pour les utilisateurs visés.** Sur les réseaux d'Afrique
centrale et de l'Ouest, un SMS met couramment plus longtemps — congestion,
itinérance, couverture instable, téléphone éteint le temps d'un trajet. Un jeune
qui s'inscrit dans un cybercafé et sort vérifier son téléphone peut dépasser les
cinq minutes sans rien faire d'anormal.

**Ce qui a changé le 2026-08-10.** L'expiration ne condamne plus le compte : la
route `POST /auth/resend-otp` permet d'obtenir un nouveau code, avec un délai de
garde de soixante secondes et une réponse qui ne révèle pas l'existence du
compte. L'impasse est fermée ; la friction demeure.

**Ce qu'il faut peser.**

| Allonger le TTL | Le garder à 5 minutes |
|---|---|
| moins d'abandons à l'inscription | fenêtre d'exploitation d'un SMS intercepté plus courte |
| moins de SMS de renvoi facturés | code volé périmé plus vite |
| moins de sollicitations du support | cohérent avec les usages bancaires |

**Recommandation, si un arbitrage est demandé.** Dix à quinze minutes, avec
mesure du taux de renvoi une fois en production. Le renvoi étant désormais
disponible, la donnée manquante est le comportement réel des utilisateurs — et
elle ne s'obtient pas par raisonnement.

**Ne pas modifier sans cette analyse.** Consigne du promoteur du 2026-08-10.

---

# S-05 — `Alert.alert` sur deux écrans

**Cause.** Sur `react-native-web`, `Alert.alert` est une fonction vide. Deux
écrans confient encore une action destructrice à ce dialogue :

- `mobile/app/(app)/applications/[id].tsx` — retrait d'une candidature ;
- `mobile/app/(app)/digital-safe/[id].tsx` — suppression d'un document.

**Scénario.** L'utilisateur clique, rien ne se passe, aucun message. Le même
défaut que celui qui rendait le refus parental impossible — corrigé le
2026-08-09 sur l'écran du tuteur.

**Criticité — 🟠 moyenne.** Ces deux écrans sont derrière authentification et
visent des utilisateurs disposant de l'application native, où `Alert.alert`
fonctionne. Le défaut ne se manifeste que sur le web.

**Correction recommandée.** La même que pour le consentement parental : une
confirmation rendue par l'écran, dans son propre état.

**Immédiate ?** Non — maintenue hors périmètre sur décision du promoteur. Le
test `alert-inutilisable-sur-le-web.spec.ts` les inscrit dans une liste
`DETTE_CONNUE` : tout **nouvel** écran fautif fait échouer la suite, et corriger
l'un des deux obligera à retirer sa ligne.
