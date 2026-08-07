# Sécurité — journal des décisions

Ce fichier enregistre les décisions de sécurité prises et **leur justification**, y
compris les vulnérabilités volontairement non corrigées. Une vulnérabilité laissée en
l'état sans trace écrite se transforme en négligence six mois plus tard ; documentée,
elle reste une décision qu'on peut réexaminer.

## 2026-07-29 — Vague 1 de durcissement

### Contexte

Audit de dépendances mené avant l'implémentation du module Programme de Partenariat.
Constat initial : 29 vulnérabilités côté `api/`, 14 côté `mobile/`.

Le chiffre brut est trompeur. Le tri qui compte est : **qu'est-ce qui est réellement
déployé en production ?** Une vulnérabilité dans un outil en ligne de commande utilisé
seulement sur le poste du développeur n'a pas la même portée qu'une faille dans le code
servi aux utilisateurs.

### `api/` — corrigé

| | Avant | Après |
|---|---|---|
| Production (`--omit=dev`) | 4 (1 modérée, 3 élevées) | **0** |
| Total (dev inclus) | 29 | 25 |

Correction par `npm audit fix` (sans `--force`). **`package.json` inchangé** — seul
`package-lock.json` a bougé : aucune version déclarée n'a été modifiée, donc aucun
changement d'API attendu.

Vérifié après correction : `tsc --noEmit` passe, et la suite de tests passe
intégralement (16 suites, 149 tests).

Les 25 restantes vivent toutes dans le CLI Prisma (`prisma`, `@prisma/dev`,
`find-my-way`, `valibot`), déclaré en `devDependencies` et **jamais déployé**. Elles
seront résorbées par les montées de version normales de Prisma.

### `mobile/` — partiellement corrigé, volontairement

| | Avant | Après |
|---|---|---|
| Total | 14 (13 modérées, 1 élevée) | **13 modérées** |

`brace-expansion` (élevée, déni de service) corrigée par `npm audit fix`.
`package.json` inchangé. `tsc --noEmit` passe.

#### Décision : `uuid` (13 modérées) reste en l'état

**Vulnérabilité** : absence de contrôle de bornes de tampon dans `uuid` v3/v5/v6,
*uniquement lorsqu'un tampon explicite est passé en argument* (GHSA-w5hq-g745-h8pq).

**Pourquoi on ne corrige pas** :

1. `uuid` n'est **jamais appelé par notre code** — vérifié par recherche sur `app/`,
   `lib/` et `components/` : aucun import, aucun appel. C'est une dépendance transitive
   d'Expo.
2. La condition de déclenchement (appeler v3/v5/v6 avec un tampon fourni) n'est donc
   atteignable par aucun chemin de notre application.
3. La correction exige `npm audit fix --force`, qui impose une montée de version en
   rupture sur une dépendance transitive d'Expo SDK 57 — au risque de casser la
   compilation pour une faille que nous ne pouvons pas déclencher.

**À réexaminer** si : nous commençons à utiliser `uuid` directement, ou lors de la
prochaine montée de version majeure d'Expo — laquelle emportera probablement la
correction sans effort.

### Reste à faire — bloquants avant toute mise en production

Repris du CLAUDE.md §7 et du dossier de conception du 2026-07-29 :

- Chaîne d'intégration continue : audit de dépendances, analyse statique et détection de
  secrets à chaque modification. **Sans automatisation, l'audit ci-dessus se périme en
  quelques semaines.**
- Politique de sécurité de contenu (CSP) pour la version web.
- Gestionnaire de secrets réel et rotation des clés. Les clés de développement présentes
  dans `api/.env` (JWT, chiffrement des documents) doivent être **considérées comme
  compromises** et régénérées avant production.
- Sauvegardes chiffrées avec restauration **testée pour de vrai**.
- Test d'intrusion par un tiers qualifié (CLAUDE.md §7), portant en priorité sur
  l'authentification, les paiements et le Digital Safe.
