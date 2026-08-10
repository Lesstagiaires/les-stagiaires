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
| S-01 | `lsId` exposé à un visiteur anonyme | 🟠 | non — avant production |
| S-02 | Rubrique `DOCUMENTS` publiable par un majeur | 🔴 | **avant production** |
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

---

# S-01 — `lsId` exposé à un visiteur anonyme

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

# S-02 — La rubrique `DOCUMENTS` peut être rendue publique

**Cause.** `VisibilityService.setVisibility` interdit `PUBLIC` aux mineurs, mais
l'autorise aux majeurs **pour toutes les rubriques, y compris `DOCUMENTS`**.
`DocumentsService.download` s'appuie ensuite sur `canView(..., DOCUMENTS, ...)` :
si la rubrique est publique, le fichier **déchiffré** est servi à un anonyme.

**Scénario d'exploitation.** Un majeur bascule `DOCUMENTS` en `PUBLIC` — par
curiosité, ou sans mesurer la portée du mot « public ». Tout identifiant de
document en circulation devient alors un lien de téléchargement ouvert. Aucune
autre condition n'est requise.

**Données exposées.** Le **contenu** des documents de profil : diplômes,
attestations, pièces d'identité — que CLAUDE.md §1 classe en **Confidentiel**,
voire **Très sensible** pour les pièces d'identité.

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

**Criticité — 🟡 faible.** Les `cuid` ne s'énumèrent pas. Combiné à S-01, cela
donne une correspondance identifiant → LS-ID pour qui possède déjà un
identifiant.

**Correction recommandée.** Rendre une réponse vide plutôt qu'une erreur, comme
le fait déjà `/auth/resend-otp`. Attention : cela empêcherait un client de
distinguer « profil inexistant » de « profil entièrement privé », ce qui peut
dégrader des messages d'interface.

**Immédiate ?** Non. À traiter avec S-01, dont il partage la surface.

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
