# Constat — `destinationLabel` survit sur une base de production neuve

**Trouvé** : 2026-08-09, en revue ciblée du cycle de refus parental.
**Statut** : constat isolé, **non corrigé**. À traiter dans un chantier
sécurité/données distinct, sur décision du promoteur.
**Sans rapport** avec le cycle de refus parental — trouvé en vérifiant que ses
migrations étaient reproductibles.

---

## Le risque

Sur une base de données **neuve** — c'est-à-dire toute future base de
production — `prisma migrate deploy` seul laisse :

- la colonne **`destinationLabel` présente**, qui contient la coordonnée de
  paiement **en clair** ;
- `destinationEncrypted` et `destinationMasked` **nullables**, alors que
  `schema.prisma` les déclare obligatoires.

Sur les deux tables concernées : `AmbassadorPaymentDetail` et `PayoutRequest`.

C'est exactement ce que le chiffrement au repos des coordonnées de paiement
devait supprimer. Un vidage de base volé rendrait de nouveau lisibles les
numéros Mobile Money des ambassadeurs — y compris depuis une sauvegarde.

L'application, générée depuis `schema.prisma`, n'écrira plus jamais
`destinationLabel` : la colonne resterait donc silencieuse, vide sur les
nouvelles lignes, et **personne ne la verrait**. C'est ce qui rend le défaut
durable plutôt que bruyant.

## Pourquoi la base de développement ne le montre pas

C'est le point qui a rendu le défaut invisible jusqu'ici.

| Contrôle | Résultat |
|---|---|
| `migrate diff` contre la base de **développement** | *No difference detected.* |
| `migrate diff` contre une base **reconstruite depuis les migrations** | **écart** sur les deux tables |

La base de développement a reçu l'étape complémentaire ; le dossier de
migrations, non. Comparer le schéma à la base de développement ne prouve donc
rien sur ce qu'obtiendra un déploiement neuf — et c'est pourtant le contrôle
qu'on fait spontanément.

## Ce qui est en cause

**Migration** :
`prisma/migrations/20260805090000_encrypt_payment_destinations/migration.sql`

Elle crée les deux colonnes **nullables**, et le dit explicitement :

> « LE CHIFFREMENT DES LIGNES EXISTANTES ne se fait PAS ici : PostgreSQL n'a pas
> le trousseau, et lui donner la clé reviendrait exactement à ranger la clé avec
> la serrure. »

Le raisonnement est juste : une migration SQL ne peut pas chiffrer, faute de
clés. Ce n'est pas une erreur de conception, c'est une étape en deux temps dont
le second temps ne vit pas dans les migrations.

**Script complémentaire** :
`scripts/encrypt-payment-destinations.mjs`

C'est lui qui, depuis l'application et avec le trousseau :

1. lit `destinationLabel`, chiffre, écrit `destinationEncrypted` et
   `destinationMasked` ;
2. passe les deux colonnes en `SET NOT NULL` (lignes 226–228) ;
3. supprime `destinationLabel` (ligne 231).

## Procédure de déploiement correcte

Sur toute base neuve, et dans cet ordre :

```bash
npx prisma migrate deploy
```

```bash
node scripts/encrypt-payment-destinations.mjs
```

Le second n'est **pas** facultatif : sans lui, la base ne correspond pas au
schéma dont l'application est générée.

Contrôle d'acceptation, à passer après les deux étapes :

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Sortie attendue : `No difference detected.`, code de sortie `0`. Toute autre
sortie signifie que le déploiement est incomplet.

## Pistes pour le chantier dédié

Trois directions, à arbitrer — aucune n'est engagée ici :

1. **Un garde-fou au démarrage.** `production-readiness.ts` refuse déjà de
   démarrer sur une configuration de développement en production. Il pourrait
   refuser de la même façon une base où `destinationLabel` existe encore. C'est
   la piste la plus sûre : elle rend l'oubli impossible plutôt qu'improbable.
2. **Une migration de finalisation**, à écrire une fois la reprise faite
   partout, qui porte le `SET NOT NULL` et le `DROP COLUMN`. Elle rendrait le
   dossier de migrations à nouveau autosuffisant — mais elle échouerait sur une
   base dont les lignes n'ont pas été chiffrées, ce qui est peut-être
   souhaitable.
3. **Un contrôle en intégration continue** qui rejoue les migrations sur une
   base vierge et exige un `migrate diff` vide. Il aurait signalé ce défaut le
   jour de son introduction, et attraperait les suivants.
