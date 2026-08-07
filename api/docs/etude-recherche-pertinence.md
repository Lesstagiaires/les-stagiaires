# Étude de conception — Recherche par pertinence

*2026-08-07. À valider avant toute ligne de code, comme pour les Ambassadeurs.*

---

## 1. L'état réel, vérifié

`OpportunitiesService.search()` fait aujourd'hui :

```ts
where:   { status, country?, city?, sector?, type? }   // filtres exacts
orderBy: { publishedAt: 'desc' }                       // ordre chronologique
```

Ce n'est pas une recherche : c'est une **liste filtrée**. Quatre conséquences
mesurables aujourd'hui :

1. **Aucune recherche textuelle.** Taper « développeur » ne trouve rien : il n'y
   a pas de champ de mots-clés dans le DTO. On ne peut chercher que par pays,
   ville, secteur et type — quatre listes déroulantes.
2. **Les filtres sont des égalités strictes.** `city: 'Douala'` ne remonte rien
   pour « douala » ni « Douala 5e ».
3. **L'ordre récompense la fraîcheur, rien d'autre.** Une offre pertinente
   publiée il y a trois jours passe derrière une offre hors sujet publiée hier.
4. **Le profil du jeune n'est jamais consulté.** Deux personnes aux parcours
   opposés voient exactement la même page.

### Ce que la base sait, et ne sait pas

| Disponible sur `Opportunity` | Disponible sur `Profile` |
|---|---|
| `title`, `description` (texte libre) | `headline`, `summary` (texte libre) |
| `sector`, `type`, `country`, `city` | `educations`, `experiences`, `languages` |
| `workMode`, `relocationRequired`, `accommodationProvided` | `activeRole` (la casquette active) |
| `publishedAt`, `expiresAt` | — |

**Il n'existe AUCUN modèle de compétences.** Ni `Skill`, ni `ProfileSkill`, ni
liste de compétences requises sur une offre. C'est le manque structurant : sans
vocabulaire partagé entre l'offre et le profil, toute « pertinence » se réduit à
de la comparaison de texte libre.

---

## 2. Ce que la décision du promoteur impose

> « Recherche par pertinence seule. » — modèle économique validé

Cette phrase est un **engagement de non-manipulation** : aucun classement payant,
aucune remontée achetée. Elle a trois conséquences de conception, et c'est le
cœur de cette étude.

**a. Le classement doit être EXPLICABLE.** Le jour où un annonceur demandera
« pourquoi mon offre est-elle en douzième position ? », il faudra une réponse
qui ne soit ni « c'est l'algorithme » ni « le plus récent d'abord ». Un score
doit pouvoir se décomposer en critères nommés.

**b. Le classement doit être AUDITABLE.** Si l'on promet qu'aucune place ne
s'achète, il faut pouvoir le prouver — donc que la pondération soit une donnée
consultable, versionnée, et non une constante enfouie dans le code.

**c. Aucun champ « boost » ne doit exister.** Pas même inutilisé, pas même
« pour plus tard ». Un champ de mise en avant présent dans le schéma est une
promesse qu'on finira par tenir un jour de tension commerciale. Ne pas le créer
est le seul engagement qui tienne.

---

## 3. Trois approches possibles

### A. Recherche plein texte PostgreSQL + pondération par critères

Index `tsvector` sur titre, description et secteur ; recherche par mots-clés ;
score combinant la correspondance textuelle et des critères métier
(proximité géographique, secteur du profil, fraîcheur, mobilité compatible).

- **Pour** : tout se fait dans PostgreSQL, aucune infrastructure nouvelle ;
  fonctionne hors ligne ; explicable critère par critère ; coût nul.
- **Contre** : pas de tolérance aux fautes de frappe sans extension
  (`pg_trgm` la fournit) ; pas de compréhension sémantique.

### B. Moteur de recherche dédié (Meilisearch, Typesense, Elasticsearch)

- **Pour** : tolérance aux fautes, synonymes, facettes, très rapide.
- **Contre** : **un service de plus à héberger, sauvegarder et sécuriser**. Sur
  une plateforme qui vise le Cameroun d'abord, avec les contraintes de coût et
  de connectivité que le CLAUDE.md §7 rappelle, c'est une dépendance lourde. Et
  une seconde copie des données à protéger.

### C. Recherche vectorielle / sémantique (embeddings)

- **Pour** : comprend « je veux travailler dans le web » ≈ « développeur ».
- **Contre** : coût par requête, dépendance à un fournisseur externe, et surtout
  **inexplicable** — ce qui contredit frontalement l'exigence (a).

### Recommandation : **A**, sans hésitation

C'est la seule qui satisfait l'engagement de non-manipulation, ne coûte rien à
héberger, et reste compréhensible par quelqu'un qui n'a pas écrit le code. B
reste possible plus tard sans réécrire le métier, si le volume l'exige — à
condition d'isoler la recherche derrière une interface dès maintenant
(**Provider Pattern**, SKILL SECURITY FIRST §13).

---

## 4. Le modèle de score proposé

Un score sur 100, **somme de critères nommés et pondérés**, chacun calculable et
affichable :

| Critère | Poids par défaut | Ce qu'il mesure |
|---|---|---|
| `TEXT_MATCH` | 35 | correspondance des mots-clés avec titre et description |
| `SECTOR_MATCH` | 20 | le secteur de l'offre correspond au parcours du profil |
| `LOCATION_MATCH` | 20 | même ville (20), même pays (10), sinon 0 |
| `MOBILITY_FIT` | 10 | l'offre n'exige pas une mobilité que le profil ne peut assumer |
| `LANGUAGE_MATCH` | 10 | langue de l'offre parmi celles maîtrisées |
| `FRESHNESS` | 5 | décroissance douce sur 30 jours |

**La fraîcheur ne pèse que 5.** Elle départage, elle ne classe pas. C'est
exactement l'inverse de la situation actuelle.

**Une recherche anonyme** (visiteur non connecté) n'a pas de profil : les
critères de profil valent alors 0 pour tout le monde, et le classement se fait
sur le texte, le lieu demandé et la fraîcheur. Le même code, sans branche
particulière.

### Où vivent les poids

Dans une table `SearchWeight`, **pas dans le code** :

```
code        TEXT_MATCH | SECTOR_MATCH | ...
weight      Int
countryCode String?   -- réglable par pays
isActive    Boolean
version     Int
```

Trois raisons : les régler ne demande pas de déploiement ; ils sont consultables
par qui veut vérifier la promesse ; et une modification laisse une trace
d'audit, comme un barème de commission.

### La trace d'explication

Chaque résultat porte, en option (`?explain=true`, réservé ADMIN) :

```json
{ "score": 72, "breakdown": [
    { "criterion": "TEXT_MATCH", "raw": 0.8, "weight": 35, "points": 28 },
    { "criterion": "LOCATION_MATCH", "raw": 1, "weight": 20, "points": 20 },
    ... ] }
```

C'est ce qui rend la réponse à l'annonceur possible.

---

## 5. Le manque à combler d'abord : les compétences

Sans vocabulaire partagé, `SECTOR_MATCH` reste grossier et `TEXT_MATCH` fait tout
le travail. Je propose un modèle minimal :

```
Skill              code, labelFr/En/Es/Ar/Pt, isActive   -- référentiel contrôlé
ProfileSkill       profileId, skillId, level?
OpportunitySkill   opportunityId, skillId, required(bool)
```

**Un référentiel contrôlé, pas du texte libre.** Le texte libre produit
« JavaScript », « javascript », « JS » et « Java script » — quatre compétences
qui ne se rencontrent jamais. Un référentiel se traduit aussi en cinq langues,
ce que du texte libre ne fait pas.

Cela ajoute un critère `SKILL_MATCH` (poids proposé : 25, en réduisant
`TEXT_MATCH` à 20).

**Question pour vous :** faut-il inclure les compétences dans ce chantier, ou le
livrer d'abord sans elles et les ajouter ensuite ? Sans elles, la recherche
s'améliore déjà nettement ; avec elles, elle devient réellement pertinente. Mais
elles touchent le module Profils, gelé depuis longtemps.

---

## 6. Sécurité (SKILL SECURITY FIRST)

**Classification.** Les offres publiées sont **Publiques**. Le profil consulté
pour scorer est **Confidentiel** : le score se calcule côté serveur et **le
profil n'apparaît jamais dans la réponse**. On rend un ordre, pas les raisons
personnelles de cet ordre.

**Injection.** La recherche plein texte passe par `to_tsquery`, qui est une
porte d'entrée classique. Les mots-clés seront **échappés et paramétrés** ; ni
concaténation, ni `$queryRawUnsafe`.

**Énumération.** La recherche ne doit pas devenir un moyen d'aspirer la base :
`limit` déjà plafonné à 50, débit à limiter sur la route publique.

**Fuite par le classement.** Un point subtil : si le score dépend du profil, deux
comptes comparant leurs résultats pourraient déduire des informations l'un sur
l'autre. Le risque est faible (les critères sont grossiers) mais réel — d'où
l'explication réservée aux ADMIN.

**Le point qui compte le plus.** Aucun champ de mise en avant, nulle part. Un
test parcourra le schéma pour vérifier qu'aucun champ nommé `boost`, `promoted`,
`sponsored` ou `featured` n'existe sur `Opportunity`. C'est la seule façon de
rendre votre engagement vérifiable par la machine plutôt que par la mémoire.

---

## 7. Ordre de développement proposé

1. **Le socle de score** — table `SearchWeight`, service de calcul, six critères
   sans les compétences, `?explain` ADMIN, tests.
2. **La recherche textuelle** — `tsvector`, `pg_trgm` pour les fautes de frappe,
   index, requête paramétrée.
3. **Les compétences** — référentiel, profil, offre, septième critère *(si vous
   le retenez)*.
4. **Les écrans mobiles** — champ de recherche, tri, affichage du score ou non.
5. **Recette réelle et rapport de sécurité.**

---

## 8. Ce que j'attends de vous

1. **L'approche A** vous convient-elle ?
2. **Les six critères et leurs poids** — à revoir ? Notamment : la fraîcheur à 5
   vous paraît-elle assez basse ?
3. **Les compétences** : dans ce chantier, ou après ?
4. **Le score doit-il être visible du jeune** (« correspond à 72 % à votre
   profil ») ou rester interne ? Le montrer aide à comprendre ; il expose aussi
   la logique à qui voudrait la jouer.
5. **Un employeur peut-il voir le score de son offre ?** Cela rend la promesse
   crédible, mais lui apprend aussi comment mieux se placer.
