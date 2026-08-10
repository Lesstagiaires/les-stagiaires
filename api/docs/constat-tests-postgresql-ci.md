# Constat — `npm test` dépend désormais de PostgreSQL

**Date** : 2026-08-09
**Statut** : constat. Aucune modification de la chaîne d'intégration continue n'a été faite.
**Origine** : ajout de `src/auth/guardian-change.integration.spec.ts`, test d'intégration
sur base réelle exigé pour fermer la jonction entre le changement de tuteur et le
consentement parental.

---

## Ce qui a changé

Jusqu'ici, la totalité des tests tournait sur des doubles et un monde en mémoire :
aucune base n'était nécessaire. `npm test` fonctionnait sur une machine nue.

Le test d'intégration du changement de tuteur ne peut pas fonctionner ainsi. Le défaut
qu'il ferme est précisément un défaut de **couture** : `decide()` écrivant dans une
colonne que `requestConsent()` ne lit pas. Un double le masquerait par construction,
puisque c'est le double qui définirait les deux côtés.

Il lui faut donc PostgreSQL, les vraies migrations et le vrai client Prisma.

## Ce que le test fait de la base

Il **ne touche jamais** la base de développement. Dans son `beforeAll`, il :

1. lit `DATABASE_URL` pour en déduire l'adresse du serveur ;
2. crée une base jetable `stagiaires_it_guardian_change` ;
3. y applique `prisma migrate deploy` ;
4. bascule `DATABASE_URL` sur cette base avant de construire `PrismaService` ;
5. la supprime dans `afterAll`.

C'est aussi, incidemment, un contrôle de reproductibilité des migrations : si l'une
d'elles cesse de s'appliquer sur une base vierge, le test échoue avant le premier
scénario.

## Deux contraintes techniques rencontrées

**Le drapeau `--experimental-vm-modules`.** Le moteur d'exécution de Prisma fait un
import dynamique que la VM CommonJS de Jest refuse. Les scripts `test`, `test:watch` et
`test:cov` de `package.json` passent donc par :

```
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

Écrit ainsi plutôt qu'avec `cross-env`, pour rester portable Windows/POSIX sans
dépendance supplémentaire.

**Le chargement de `.env`.** Jest ne le fait pas — les autres tests n'en avaient jamais
eu besoin. Le fichier importe donc `dotenv/config`, et échoue avec un message explicite
si `DATABASE_URL` reste absente, plutôt qu'avec une « Invalid URL » que personne ne
relie à une variable manquante.

---

## Ce qu'il faudra prévoir dans la chaîne d'intégration continue

### 1. Un PostgreSQL de test

Un service PostgreSQL joignable pendant l'exécution des tests. Version alignée sur celle
du `docker-compose.yml` de développement.

**Le compte utilisé doit pouvoir créer et supprimer des bases** (`CREATEDB`), puisque le
test en fabrique une puis la détruit. Un compte restreint à une seule base fera échouer
le `CREATE DATABASE` — et l'erreur, à la lecture, ressemblera à un problème de mot de
passe.

Rappel valable ici comme en développement : viser `127.0.0.1` et non `localhost`. La
résolution IPv6 de la boucle locale produit des `ECONNRESET` en rafale dans les
conteneurs.

### 2. `DATABASE_URL`

Renseignée pour l'étape de test, pointant sur ce serveur de test, **jamais** sur une base
de recette ou de production. Le test crée et supprime des bases sur le serveur qu'il
trouve : l'adresse est la seule chose qui l'en empêche.

### 3. Les migrations

Aucune étape préalable n'est nécessaire pour ce test-là : il applique lui-même
`prisma migrate deploy` sur sa base jetable. Il faut en revanche que le **client Prisma
soit généré** (`prisma generate`) avant l'exécution, comme aujourd'hui.

### 4. L'exécution

`npm test` couvre désormais unitaires et intégration en une seule commande. Deux
possibilités si l'on veut les séparer plus tard :

- garder une exécution unique, plus simple, au prix d'un PostgreSQL requis partout ;
- ou séparer par motif (`--testPathIgnorePatterns=integration`) pour une passe rapide
  sans base, et une passe complète avec base.

**Recommandation** : garder l'exécution unique. Un test d'intégration qu'on peut oublier
de lancer finit toujours par ne plus être lancé — et celui-ci garde une protection de
mineurs.

### 5. Le temps d'exécution

Environ 8 secondes pour ce fichier, dont l'essentiel en `prisma migrate deploy`. À
compter dans le budget de la chaîne, sans plus.

---

## Ce qui n'est PAS demandé ici

Ce constat ne prescrit ni fournisseur, ni fichier de configuration, ni image de
conteneur. La décision d'architecture de la chaîne d'intégration continue reste à
prendre, et ce document n'a pour objet que d'en énoncer les contraintes.
