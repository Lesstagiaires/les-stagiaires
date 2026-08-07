# Rapport de sécurité — Chantier « Recherche par pertinence »

**Date** : 7 août 2026
**Périmètre** : moteur de pertinence, expansion par synonymes, diversification,
back-office ADMIN des référentiels et pondérations, diagnostic de qualité des
offres, écrans mobiles associés.
**Base de vérification** : 922 tests / 59 suites verts, lint et typage propres
sur `api` et `mobile`, `prisma migrate diff` vide.

Ce rapport suit la directive permanente **SKILL — SECURITY FIRST** (§18 :
vulnérabilités, correctifs, risques résiduels, dette technique,
recommandations). Il ne remplace pas l'audit indépendant exigé par
`CLAUDE.md` §7 avant tout lancement avec de vrais utilisateurs.

---

## 1. Classification des données manipulées

| Donnée | Niveau (`CLAUDE.md` §1) | Traitement retenu |
|---|---|---|
| Offre publiée (titre, description, ville, métier) | Public | Rendue telle quelle ; contrôle d'intégrité par la base |
| Profil du candidat (compétences, niveau, ville, disponibilité) | **Confidentiel** | Entre dans le calcul du classement, **ne ressort jamais** |
| Score de pertinence et détail par critère | **Interne** | Ne franchit aucune frontière réseau |
| Diagnostic de qualité d'une offre | **Interne** à l'organisation | Réservé aux membres de l'organisation qui publie |
| Pondérations du classement | Interne | Lecture ADMIN, modification ADMIN + 2FA, historisée |
| Référentiels (compétences, métiers, synonymes) | Public | Lecture large, écriture ADMIN + 2FA |

La règle structurante du chantier : **le profil entre dans le classement et n'en
sort pas**. `CandidateContext` est volontairement réduit à ce qui sert au calcul
— ni nom, ni téléphone, ni identifiant de compte. Un moteur de classement n'a
pas besoin de savoir *qui* il classe.

---

## 2. Vulnérabilités trouvées et corrigées

### 2.1 — Le barème global n'était pas unique (grave)

**Constat, vérifié sur la base.** PostgreSQL considère deux `NULL` comme
distincts. L'index unique `(criterion, countryCode)` de `SearchRankingRule` ne
contraignait donc rien sur les règles globales, identifiées par `countryCode
IS NULL`. L'insertion d'une seconde règle `SKILL_MATCH` globale et active a
été acceptée sans erreur.

**Conséquence.** Deux règles actives pour le même critère : `weightsFor()` en
retenait une selon l'ordre de lecture, non spécifié. Le classement devenait
irreproductible, et **aucune ligne d'audit ne montrait de modification** — la
manipulation ne se lisait nulle part. Le cas non protégé était précisément
celui qui sert au lancement : le barème global est le seul qui existe
aujourd'hui.

S'y ajoutait que Prisma refuse un `NULL` dans une clef unique composée : le
back-office ne pouvait pas relire le barème global qu'il venait d'écrire, et
en aurait créé un doublon à chaque modification au lieu de le mettre à jour.

**Correctif.** Le joker devient `'*'`, valeur réelle qu'aucun code ISO 3166-1
alpha-2 ne peut porter, plus une contrainte `CHECK` (`'*'` ou deux majuscules).
Migration `20260807160000_ranking_rule_country_sentinel`, testée sur une copie
restaurée : doublon refusé, `'cm'` refusé, `'SN'` accepté.

### 2.2 — Le même défaut sur les modules de formation (grave)

Trouvé en cherchant si l'erreur se répétait ailleurs. `TrainingModule` portait
le même trou sur `(code, version, countryCode)` : deux modules « Déontologie »
version 1, actifs, s'inséraient sans erreur.

**Conséquence.** `createModule()` se protégeait par une vérification
applicative — deux appels simultanés passaient donc tous les deux. Le candidat
voyait le module en double ; `supersedeModule()` n'en retirait qu'un, et le
contenu censé être remplacé continuait d'être servi. La formation est la porte
qui garde l'activation d'un ambassadeur.

**Correctif.** Même sentinelle, migration
`20260807170000_training_module_country_sentinel`. La migration **s'arrête** si
des doublons préexistent : la machine ne peut pas décider lequel des deux
contenus fait foi. Vérifié sur la base de développement avant application :
0 doublon.

La constante et sa justification vivent dans `src/common/country-scope.ts`,
pour que la troisième occurrence ne se produise pas.

### 2.3 — Le classement cessait d'être reproductible au-delà de 500 résultats (moyen)

**Constat.** `matchKeywords()` bornait ses deux passes à 500 lignes **sans
`ORDER BY`**. PostgreSQL ne promet aucun ordre en l'absence de tri : deux
exécutions de la même recherche pouvaient rendre des ensembles différents,
selon le plan retenu ou la parallélisation.

**Conséquence.** Au-delà de 500 correspondances, ce n'était plus le classement
qui décidait de ce qu'on voit, mais le hasard du plan d'exécution. Échec
invisible : un résultat manquant ne se remarque pas.

**Correctif.** `ORDER BY "publishedAt" DESC NULLS LAST, id ASC` sur la requête
brute, `orderBy` équivalent sur la passe par référentiel. Départage par
identifiant : une date seule laisse des ex æquo, et un ex æquo non départagé
réintroduit le problème.

Ce tri **n'est pas un classement** — il choisit quelles offres seront notées,
pas dans quel ordre elles seront rendues. Trier par pertinence textuelle aurait
ajouté un second critère de classement invisible, hors du barème configurable.

**Prévention.** `search-reproducibility.spec.ts` échoue si un `LIMIT` ou un
`take` apparaît sans tri. Le défaut avait été commis **deux fois dans le même
fichier**, à quinze lignes d'écart, alors que la fenêtre de 200 juste au-dessus
portait le garde-fou et son commentaire : ce n'est pas une inattention isolée,
c'est le geste naturel quand on écrit une borne. La vérification du test a été
faite en cassant le code exprès — il échoue sans les garde-fous, passe avec.

### 2.4 — Le critère Disponibilité ne discriminait rien (moyen, fonctionnel)

`ScorableOpportunity.startsAt` était déclaré et jamais renseigné : `Opportunity`
n'avait pas la colonne. `availabilityMatch()` rendait donc 1 pour toutes les
offres. Le barème affichait 100 alors qu'il n'en pesait que 95.

**Correctif.** Colonne `startsAt` ajoutée, facultative, avec une contrainte
`startsAt <= expiresAt` qui attrape l'inversion de saisie. Migration
`20260807180000_opportunity_starts_at`, testée sur copie : dates inversées
refusées, dates cohérentes acceptées, absence de date acceptée.

### 2.5 — Les entrées du moteur n'étaient pas saisissables (moyen, fonctionnel)

`occupationId`, `minEducationLevel` et les compétences existaient au schéma sans
qu'aucune route ne permette de les remplir. **60 des 100 points du barème
étaient inatteignables.** Le diagnostic de qualité aurait réclamé à l'entreprise
des champs qu'elle n'avait aucun moyen de saisir.

**Correctif.** Les quatre champs entrent dans `CreateOpportunityDto`, tous
facultatifs. La mise à jour **remplace** la liste de compétences au lieu d'y
ajouter — sans quoi une compétence saisie par erreur serait indélébile, et
l'offre deviendrait de plus en plus exigeante à chaque modification.
`update()` ne recopie plus le DTO entier vers Prisma : un champ ajouté demain
au DTO ne sera plus écrit sans qu'on l'ait décidé.

### 2.6 — Une compétence désactivée restait rattachable (mineur)

La clef étrangère attrape l'identifiant inexistant, pas le **désactivé**. Une
compétence retirée du référentiel serait restée sélectionnable, et l'offre
aurait porté une exigence que plus aucun candidat ne peut déclarer — jamais
satisfaite, sans que personne comprenne pourquoi.

**Correctif.** `assertReferentialsExist()` vérifie l'existence **et** l'activité
avant toute écriture.

---

## 3. Garanties structurelles mises en place

Ces propriétés ne reposent pas sur la discipline de celui qui écrira le
prochain commit : elles sont dans la forme du code ou dans la base.

**Aucune mise en avant payante.** Il n'existe aucun champ `featured`,
`promoted`, `sponsored`, `boost`, `priorityScore`, `paidRank` ni `premiumRank` —
ni au schéma, ni dans le code du module. `no-sponsored-ranking.spec.ts` échoue
si l'un apparaît, et épingle l'énumération `SearchCriterion`. Il ne protège pas
d'une intention déterminée, rien ne le peut ; il protège de la **dérive**, qui
est le vrai risque : personne ne décide un matin de trahir la promesse, on
l'érode un champ à la fois.

**Le score ne sort pas.** `search()` construit sa réponse par **liste blanche**
— on décide ce qui sort, plutôt que de retirer ce qui ne doit pas sortir. Un
champ ajouté demain au modèle ne fuit donc pas par défaut. Seul `matchReasons`
franchit la frontière, sous forme de codes que l'application traduit.

**Le diagnostic ne peut pas parler du classement.** `OfferQualityService` n'a
pas `RelevanceScoringService` en dépendance, ne lit aucune autre offre, ne
compte pas les candidatures. Il ne peut pas répondre à « où est-ce que je me
situe ? » parce qu'il n'en sait rien. Un test sérialise sa réponse et échoue s'il
y trouve **le moindre nombre** ; un autre scanne le code source.

Ce n'est pas une limite mais un choix : un diagnostic qui dirait « votre offre
est 7e » deviendrait un plateau de jeu — le sponsoring par un autre chemin, sans
qu'un euro change de main.

**Aucune phrase construite côté serveur.** Motifs de correspondance,
recommandations et niveaux sont des **codes**. L'application existe en cinq
langues ; une phrase française dans une réponse d'API est une régression
d'internationalisation qui ne se voit qu'en production.

**Toute modification de pondération est historisée** avec ancienne valeur,
nouvelle valeur, auteur, total après modification — et une **justification
obligatoire** (`reason`, 10 à 600 caractères). Le jour où quelqu'un affirmera
qu'un poids a été changé pour favoriser un annonceur, l'historique est la seule
réponse acceptable. Le journal `AuditLog` est en ajout seul, garanti par
déclencheur PostgreSQL.

**Un barème incohérent est signalé, jamais normalisé en silence.** Si le total
ne fait pas 100, le moteur l'écrit au journal et continue. Corriger derrière le
dos de celui qui a saisi lui cacherait sa propre erreur, et rendrait les scores
incomparables d'un pays à l'autre sans qu'il le sache.

**On désactive, on ne supprime jamais.** Une compétence citée par mille profils
ne peut pas disparaître sans les rendre incohérents.

---

## 4. Injection SQL

La recherche par mots-clés est **le seul endroit du projet où du texte
utilisateur atteint du SQL brut**. Trois précautions :

1. `websearch_to_tsquery` accepte une saisie humaine telle quelle — guillemets,
   `OR`, tirets — sans jamais l'interpréter comme de la syntaxe SQL. C'est la
   fonction faite pour ça.
2. Le terme et le terme élargi passent en **paramètres** du gabarit `$queryRaw`,
   jamais par concaténation. `query-expansion.ts` ne produit que des chaînes
   normalisées ; il ne fabrique aucun fragment de requête.
3. La saisie est tronquée à 120 caractères avant tout traitement.

Tout le reste du filtrage (pays, ville, secteur, type, statut) reste en Prisma,
donc paramétré par construction.

---

## 5. Contrôle d'accès

| Route | Protection |
|---|---|
| `GET /opportunities` | Publique, profil pris en compte s'il y en a un |
| `GET /opportunities/:id/quality` | Membre de l'organisation qui publie, y compris `VIEWER` |
| `GET/PUT/POST /search-admin/*` | `ADMIN` **et** double authentification active |

Le diagnostic est ouvert au `VIEWER` : c'est une lecture, et interdire au
consultant de voir ce qui manque à une offre qu'il peut déjà lire n'ajouterait
aucune protection.

`SearchAdminController` est un contrôleur **séparé**, préfixe `/search-admin`.
Greffer ces routes sur `OpportunitiesController` — dont la plupart des routes
sont publiques — aurait créé le voisinage où une erreur de décorateur ne se voit
pas.

Le garde de rôles revérifie l'état actif en base à chaque requête plutôt que de
faire confiance au jeton, et refuse tout compte `ADMIN` dont la 2FA n'est pas
active (`CLAUDE.md` §2 et §3).

---

## 6. Protection contre l'administrateur malveillant

C'est la partie la plus faible du chantier, et il faut le dire.

**Ce qui tient.** Un ADMIN ne peut pas modifier une pondération sans laisser
trace : l'écriture d'audit est dans le même service que la modification, le
journal est en ajout seul par déclencheur PostgreSQL, et la justification est
obligatoire. Il ne peut pas créer un doublon de règle pour dévier le classement
en silence : la contrainte d'unicité le refuse désormais (§2.1).

**Ce qui ne tient pas.** Un ADMIN peut mettre le poids d'un critère à 0 ou à
100 avec une justification mensongère. Aucune borne métier n'encadre les valeurs
au-delà de `0..100`, et rien n'exige un second regard. C'est un **risque
résiduel assumé** (§7, R2).

`session_replication_role = replica` désactive les déclencheurs en ajout seul.
Un administrateur de base de données — pas un ADMIN applicatif — peut donc
falsifier un journal. Limite déjà documentée en phase 1 des ambassadeurs (R3),
elle vaut ici aussi : la parade est la restriction du privilège en production,
pas le code.

---

## 7. Risques résiduels

**R1 — Le total des résultats est plafonné dès qu'il y a des mots-clés.**
Quand `q` est fourni, `total` compte les offres retenues par `matchKeywords()`,
qui rend l'union de deux passes bornées chacune à 500 — soit **1 000 au plus**.
Une recherche très large annoncera donc au maximum « 1 000 résultats » quel
qu'en soit le nombre réel. Sans mots-clés, le total est exact. Pas de
conséquence de sécurité ; l'utilisateur voit un nombre faux. À traiter avant que
le volume d'offres ne dépasse cet ordre de grandeur.

**R2 — Aucun second regard sur une pondération.** Voir §6. Le versement d'argent
exige une séparation des pouvoirs (validateur ≠ exécutant) ; le classement, non.
Défendable au lancement, à revoir dès qu'une équipe compte plusieurs
administrateurs. Le correctif naturel est le mécanisme déjà écrit pour les
versements.

**R3 — Les référentiels sont vides.** Compté sur la base de développement le
7 août 2026 : **0 compétence, 0 métier, 0 synonyme, 0 offre**. Le moteur
fonctionne et rend un classement, mais les 60 points de compétence et de métier
valent zéro pour toutes les offres tant que le référentiel n'est pas alimenté.
**Ce n'est pas un défaut de code, c'est un prérequis d'exploitation** — et il
conditionne l'intérêt réel de tout le chantier.

Corollaire à ne pas perdre de vue : aucune des vérifications de ce rapport n'a
été menée sur des données réelles, puisqu'il n'y en a aucune. Les garanties
énoncées reposent sur la lecture du code, les tests automatisés, et les
contraintes éprouvées sur une copie de base — pas sur l'observation du système
en fonctionnement.

**R4 — Le barème n'a pas été éprouvé sur des données réelles.** Les six poids
(35/25/15/10/5/10) sont un arbitrage de conception, pas un résultat de mesure.
Ils sont configurables sans redéploiement, ce qui était l'objectif ; reste à les
ajuster une fois observé le comportement réel des candidats.

**R5 — La diversification n'a pas de test sur données volumineuses.** Son
comportement est vérifié unitairement sur de petits ensembles. Le réglage
(organisation 8, métier 5, ville 2, horizon 40) est un choix a priori.

---

## 8. Dette technique

- **Le `total` plafonné** (R1) : demandera une requête de comptage distincte,
  sans la borne.
- **`api/docs/` n'a pas de rapport de recette pour ce chantier.** Les scripts
  `test/recette/` couvrent les ambassadeurs et le partenariat, pas la recherche.
  `scripts/recette-synonymes.mjs` existe mais reste partiel.
- **Le diagnostic de qualité n'est pas historisé.** On ne peut pas dire « cette
  offre était incomplète pendant trois semaines ». Utile pour l'accompagnement
  des entreprises, non nécessaire à la sécurité.
- **Aucun test d'intégration bout en bout** de la recherche contre une base
  peuplée. Les 96 tests du module sont unitaires ou structurels.

---

## 9. Recommandations, par ordre de priorité

1. **Alimenter les référentiels** (R3) avant toute démonstration. Sans
   compétences ni métiers, la recherche par pertinence ne se distingue pas d'un
   tri par date — et c'est la seule chose que verra celui à qui on la montre.
2. **Recette sur base peuplée** : au moins cinquante offres et dix profils, pour
   observer le classement réel et vérifier que la diversification n'écarte pas
   d'offres légitimes.
3. **Corriger le `total` plafonné** (R1) avant l'ouverture publique.
4. **Ajouter la séparation des pouvoirs sur les pondérations** (R2) dès qu'un
   deuxième administrateur existe.
5. **Restreindre `session_replication_role` en production** — vaut pour tous les
   journaux en ajout seul du projet, pas seulement ce chantier.
6. **Faire relire ce module par un tiers.** `CLAUDE.md` §7 l'exige avant
   lancement. Le classement est ce que la plateforme promet de ne pas manipuler :
   c'est exactement le genre d'engagement qu'un regard extérieur doit vérifier.

---

## 10. Ce que ce rapport ne couvre pas

- Le test d'intrusion indépendant (`CLAUDE.md` §7).
- La tenue en charge : aucun test de performance n'a été mené sur la recherche
  plein texte avec index GIN, ni sur les recherches trigramme, qui sont les plus
  coûteuses.
- La qualité linguistique de la configuration `french` de PostgreSQL appliquée à
  des offres rédigées en anglais, espagnol, arabe ou portugais. **Le vecteur de
  recherche est construit avec `to_tsvector('french', …)` pour toutes les
  offres**, quelle que soit leur langue. C'est une limite réelle pour une
  plateforme panafricaine multilingue, et elle mérite d'être traitée avant
  l'ouverture hors zone francophone.
