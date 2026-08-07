# Module Ambassadeurs — Phase 2 : parcours de candidature

*Documentation de gel, 2026-08-07. Même niveau d'exigence que
`module-partenariats.md`.*

La phase 1 avait durci le volet financier. La phase 2 construit ce qui vient
avant : comment quelqu'un devient ambassadeur, et ce qui l'en empêche.

Toute évolution du module se reporte dans ce document.

---

## 1. Ce que la phase 2 ajoute

| Pièce | Fichiers |
|---|---|
| Groupes de statuts nommés | `ambassador-status-groups.ts` |
| Candidature publique | `ambassadors.service.ts#apply`, `dto/apply-ambassador.dto.ts` |
| Pièces d'identité | `identity-documents.service.ts` |
| Formation et quiz | `training.service.ts` |
| Back-office de la formation | `training-admin.service.ts` |
| Kit d'affiliation et lien public | `attribution-kit.service.ts`, `attribution-link.controller.ts` |

Trois migrations, toutes essayées sur copie avant application :
`20260805160000_public_application`,
`20260805180000_ambassador_identity_documents`,
`20260805200000_training_and_quiz`.

---

## 2. Le cycle de vie, et ce qui le verrouille

```
SUBMITTED → UNDER_REVIEW → [ADDITIONAL_INFORMATION_REQUIRED] → VERIFIED
  → APPROVED → CONTRACT_PENDING → TRAINING_PENDING → ACTIVE
```

**Un candidat ne devient JAMAIS ambassadeur automatiquement.** `activate()`
rassemble les motifs d'empêchement et refuse tant qu'il en reste un :

| Verrou | Source | Ce qu'il atteste |
|---|---|---|
| `identityVerifiedAt` | décision ADMIN | qu'une vérification a eu lieu |
| **pièce d'identité** | `IdentityDocumentsService` | qu'une pièce vérifiée, non expirée, **du cycle en cours**, existe |
| `approvedAt` | décision ADMIN | que la candidature est retenue |
| `contractSignedAt` | fait daté | que le Contrat d'Apporteur d'Affaires est signé |
| `charterSignedAt` | fait daté | que la charte est signée |
| `trainingCompletedAt` | décision ADMIN | qu'une formation a été constatée |
| **formation et quiz** | `TrainingService` | que tous les modules sont achevés **à leur version courante**, et le quiz réussi |

Les deux verrous en gras ont été ajoutés en phase 2. Ils ne doublent pas les
dates administratives : celles-ci attestent d'une **décision**, ceux-là des
**faits sur lesquels elle portait**. Sans eux, un dossier refusé puis redéposé
six mois plus tard s'activerait sur la foi de pièces et d'une formation du cycle
précédent.

### Groupes de statuts

Cinq groupes nommés, dans `ambassador-status-groups.ts`. Un test parcourt
l'énumération complète : **un statut ajouté sans être classé casse la
compilation**.

- `APPLICATION_STATUSES` — sept statuts d'instruction, aucun droit
- `OPERATIONAL_STATUSES` — `ACTIVE`, `SUSPENDED`
- `TERMINAL_STATUSES` — `TERMINATED`, `REJECTED`
- `PAYMENT_ELIGIBLE_STATUSES` — **`ACTIVE` seul**
- `ATTRIBUTION_ELIGIBLE_STATUSES` — **`ACTIVE` seul**

Un suspendu ne perçoit plus et ne reçoit plus d'attribution ; ses commissions
acquises lui restent dues. C'est le versement qui s'arrête, pas la créance.

---

## 3. La candidature publique

`POST /ambassadors/apply` — authentifiée, sans rôle particulier.

**Trois verrous, dans cet ordre :**

1. **La majorité.** L'âge est **lu sur le compte**, jamais déclaré : se fier à
   une date ressaisie reviendrait à laisser le candidat décider s'il est majeur.
   Seuil configurable par pays, 18 ans par défaut, **plancher à 16 en base**.
   Échec fermé : sans date de naissance, on refuse.
2. **Le blocage définitif** — fraude, falsification, usurpation. Le motif n'est
   **pas** renvoyé au candidat : il porte une qualification qu'on n'annonce pas
   dans une réponse d'API.
3. **Le délai de redépôt** — six mois par défaut, configurable, zéro l'ouvre
   immédiatement.

### Le redépôt

Une personne refusée peut redéposer. Sa nouvelle demande incrémente
`applicationCycle` **sur la même ligne** : `Ambassador.userId` reste unique.

> Deux dossiers vivants pour une même personne, ce serait deux codes
> d'affiliation, deux portefeuilles, et la même commission comptée deux fois.

L'exigence « la candidature précédente et son historique restent conservés » est
tenue par `AmbassadorEvent`, en ajout seul, qui porte en outre les décisions,
leurs auteurs et leurs motifs.

`lastRejectedAt` n'est **jamais** effacé au redépôt — sans quoi le délai ne
mordrait qu'au premier refus.

**Ce qui n'est PAS demandé** : aucun diplôme (arbitrage explicite), aucune pièce
d'identité à ce stade (elle relève du « Très sensible » et se dépose plus tard),
aucun champ « au cas où ».

---

## 4. Les pièces d'identité — niveau « Très sensible »

**Ce module ne stocke aucun fichier.** Le CLAUDE.md §6 l'interdit : jamais de
pièce d'identité hors du Coffre-fort chiffré. `AmbassadorIdentityDocument` ne
porte qu'un **rattachement** à un `DigitalSafeDocument`, et son instruction.

Le Coffre-fort apporte ce qu'une pièce d'identité exige, et qu'il aurait fallu
réécrire : chiffrement AES-256-GCM, analyse anti-malware, empreinte
d'intégrité, versionnage, **journal d'accès**, suppression logique puis
définitive.

`onDelete: Restrict` : on ne supprime pas du Coffre-fort une pièce sur laquelle
une activation s'est appuyée.

### Deux vérifications à l'attachement

1. **La propriété.** Sans elle, connaître l'identifiant d'un document suffirait à
   rattacher la pièce d'un autre à son dossier — l'usurpation servie par une
   faille d'autorisation. La réponse est **aveugle** : document inexistant,
   appartenant à un autre, ou supprimé donnent le même message. Chaque tentative
   est journalisée.
2. **La catégorie.** Un relevé de notes rattaché comme pièce d'identité passerait
   la vérification d'un administrateur pressé.

**Trois contraintes CHECK** : une pièce vérifiée porte son auteur et sa date, un
rejet porte son motif structuré, le cycle commence à 1.

---

## 5. Formation et quiz

### La règle qui gouverne le module

> **`QuizQuestion.correctIndex` ne quitte jamais le serveur.**

Envoyer les bonnes réponses au client — même dans un champ que l'interface
n'affiche pas — revient à les publier : il suffit d'ouvrir l'onglet réseau.

Trois conséquences :

- `questionsFor()` **projette** les champs servis un par un. Elle ne retranche
  pas `correctIndex` d'un objet complet : on construit ce qui sort. Un champ
  ajouté demain au modèle ne fuitera donc pas par omission.
- La correction est **entièrement côté serveur**. Le DTO n'accepte ni score, ni
  décompte, ni indicateur de réussite.
- Le résultat d'une tentative **ne contient pas le corrigé**. Le donner à chaque
  échec permettrait de le reconstituer en trois essais.
- La bonne réponse **n'entre pas au journal d'audit** — un journal s'exporte.

### La version

`TrainingProgress` **photographie la version suivie**. Sans elle, quelqu'un ayant
suivi la formation de janvier serait réputé connaître le contenu de septembre —
et une refonte décidée pour raison de sécurité n'atteindrait jamais ceux qui sont
déjà passés.

Un module publié **ne se modifie pas, il se remplace** (`supersede`). Le journal
de remplacement porte `effet: PROGRESSIONS_PRECEDENTES_CADUQUES` : celui qui
décide lit la conséquence au moment où il décide.

Changer le `code` d'une version à l'autre est refusé — le code fait la lignée.

### Le quiz

- Seuil **80 % par défaut**, configurable par pays, **photographié sur chaque
  tentative** : l'abaisser demain ne rend pas reçu qui avait échoué.
- **Trois tentatives** par défaut, comptées **en base**, **par cycle** — un
  compteur transmis par le client serait un compteur remis à zéro par le client.
- Une question sans réponse compte comme fausse.
- **Dérogation** possible, jamais silencieuse : auteur, date et motif structuré,
  exigés par une contrainte CHECK.

**Six contraintes CHECK** : seuil hors de [1, 100], zéro tentative, dérogation
sans auteur, indice hors des propositions, question à une seule proposition,
score incohérent.

---

## 6. Le kit d'affiliation et le lien public

### Le kit — `GET /ambassadors/me/kit`

Code, lien personnel, QR. **N'existe qu'au statut `ACTIVE`.** Un suspendu garde
son code en base — pour qu'une réintégration ne casse pas les liens distribués —
mais ne le reçoit plus.

**Le QR est calculé à l'affichage, jamais stocké.** Un fichier stocké survivrait
à une suspension : il resterait consultable et partageable, et rien ne
garantirait qu'on pense à le supprimer. Aucun cache non plus — un cache est un
stockage qui ne dit pas son nom.

Le lien ne porte **que le code** : un lien se colle dans un groupe WhatsApp, ce
qu'il porte devient public.

### Le lien public — `GET /r/:code`

Les quatre conditions du promoteur sont tenues :

| Condition | Comment |
|---|---|
| comportement extérieur identique | réponse rigoureusement constante : mêmes clés, même `next`, toujours 200 |
| aucune énumération possible | **aucune lecture en base** — une réponse identique ne suffit pas si le temps diffère ; un code existant se résoudrait mesurablement plus vite |
| validité communiquée au bon moment | le code est transmis au parcours d'inscription ; `attributeUser()` tranche **après** création du compte |
| un code invalide ne bloque jamais | l'inscription se fait, sans parrain |

La visite est journalisée avec un **préfixe de trois caractères** : assez pour
repérer un balayage dans le volume, pas assez pour reconstituer une liste depuis
le journal. Débit limité à 20 requêtes par minute.

---

## 7. Configuration par pays

`AmbassadorPolicy` porte désormais, en plus des champs de phase 1 :

| Champ | Défaut | Plancher en base |
|---|---|---|
| `minAmbassadorAge` | 18 | ≥ 16 |
| `reapplicationDelayMonths` | 6 | ≥ 0 |
| `quizPassScorePercent` | 80 | ]0, 100] |
| `quizMaxAttempts` | 3 | ≥ 1 |

Politique de repli pour tout pays non configuré : les valeurs les plus
protectrices.

---

## 8. Recette

`test/recette/parcours-ambassadeur.mjs` — **31 contrôles, 0 échec** contre l'API
réelle, avec inscription authentique et 2FA.

Ce qu'elle établit et que les tests unitaires ne peuvent pas voir : l'ordre de
résolution des routes, les gardes de rôle, la constance réelle de `/r/:code`
(temps de réponse compris), l'absence de `correctIndex` dans la charge utile
HTTP.

---

## 9. Limites connues

1. **`APP_PUBLIC_URL` doit être renseignée** avant tout usage réel — le lien
   servi porte sinon `http://localhost:3000`.
2. **Aucun module ni question n'est configuré** en base. Le back-office existe
   désormais ; il faut s'en servir avant qu'une activation soit possible. Le
   comportement est fermé : sans quiz réussi, pas d'activation.
3. Le **fournisseur SMS** reste `console` (tâche #102).
4. Les six risques résiduels de la phase 1 restent ouverts — voir
   `rapport-securite-phase1-ambassadeurs.md`.
