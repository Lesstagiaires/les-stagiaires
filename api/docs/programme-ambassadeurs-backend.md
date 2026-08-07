# Programme d'Ambassadeurs — étape 2 (backend)

Livré le 2026-07-31, sur autorisation explicite du promoteur (point 18 de ses arbitrages définitifs). Ce document décrit ce qui existe en code ; les décisions métier elles-mêmes sont dans `decisions-promoteur-2026-07-31.md` et `vision-produit-ambassadeurs.md`.

## Les trois règles fondatrices

Tout le module découle de trois phrases du promoteur. Chacune est protégée par au moins une garantie **structurelle** — une contrainte en base ou un test qui échoue — et pas seulement par du code qu'une relecture distraite laisserait passer.

| Règle | Garantie |
|---|---|
| **Pas d'achat = pas de commission** | Unique point d'appel : `PaymentsService.handleProviderCallback` après passage à `CONFIRMED`. Contrainte `UNIQUE(Commission.paymentId)` : un webhook rejoué ne peut pas créer une seconde commission. |
| **Attribution ≠ marketing** | `Organization.acquisitionSource` n'est jamais lu par `CommissionsService`. Contrainte CHECK `Commission_exactly_one_attribution` : toute commission porte exactement un `referralId` OU un `portfolioEntryId`. |
| **Taux jamais codés en dur** | Aucun taux dans le code. Tout sort de `CommissionRule`, résolu à l'exécution, trace de résolution conservée dans `Commission.resolutionTrace`. |

## Le compte à rebours du portefeuille

Douze mois sans **aucun paiement confirmé** libèrent l'entreprise. Alertes à 9 et 11 mois, expiration à 12.

Le point qui fait tenir le dispositif : **seul un achat confirmé remet le compteur à zéro**. Ni note, ni commentaire, ni appel déclaré. `PortfolioService` n'expose aucune méthode de prolongation, et un test parcourt sa surface publique pour qu'aucune n'apparaisse un jour — ce serait rouvrir la seule voie de fraude possible, celle qui permettrait d'entretenir une rente sur un portefeuille mort.

Subtilité facile à casser : la remise à zéro est déclenchée par l'**achat**, avant tout arbitrage de commission. Une entreprise qui achète reste rattachée à son ambassadeur même si aucune commission n'est due ce jour-là (ambassadeur suspendu, barème absent, pays coupé). Deux tests le verrouillent.

## Verrous sur l'argent

Trois verrous indépendants séparent une commission acquise d'un virement réel :

1. **Contrat d'Apporteur d'Affaires signé** — `Ambassador.contractSignedAt`, un fait daté et référencé, pas une case à cocher.
2. **Versements ouverts pour le pays** — `AmbassadorPolicy.payoutsEnabled`, **`false` par défaut**, y compris dans la politique de repli. Ouvrir un pays est une décision, jamais un effet de bord du déploiement.
3. **Validation puis exécution par un administrateur nommé** — deux étapes distinctes : valider, c'est autoriser ; exécuter, c'est constater qu'un virement est parti, avec sa référence.

## Invariants portés par la base

Écrits à la main dans la migration, parce que Prisma ne sait pas les exprimer :

- index unique **partiel** : une organisation n'a jamais deux rattachements actifs (`WHERE releasedAt IS NULL`), tout en gardant l'historique complet des cycles passés ;
- `Commission` : exactement une justification d'attribution ; taux entre 0 et 100 % ; montants jamais négatifs ;
- `AmbassadorWallet` : aucun solde négatif — un solde négatif signifierait qu'on a versé de l'argent qui n'existait pas ;
- `PayoutRequest` : montant strictement positif.

## Grand livre

Les soldes de `AmbassadorWallet` sont un **cache de lecture**. La vérité est `WalletTransaction`, en ajout seul, chaque écriture figeant les soldes obtenus. Aucun solde n'est jamais écrit en valeur absolue : tout passe par un `increment`/`decrement` atomique dont on relit le résultat, ce qui rend deux paiements simultanés inoffensifs.

## Ce qui est préparé mais volontairement inactif

Sur demande explicite du promoteur — architecture prête, activation différée, **sans refonte** le jour venu :

- **Niveaux Bronze → Diamant** : `AmbassadorTier` existe, et surtout `CommissionRule.ambassadorTier` existe **dès aujourd'hui**. C'est la seule décision qui devait être prise maintenant : ajouter cette dimension plus tard aurait imposé de retoucher le moteur de calcul d'un système en production, avec des commissions déjà versées.
- **Paliers de volume** : `CommissionRule.minMonthlySalesCount`. Une règle à palier est **écartée** tant que le volume du mois n'est pas fourni — l'appliquer sans le mesurer reviendrait à payer sur une supposition.
- **Statut `APPROVED`** : emplacement réservé à un futur contrôle anti-fraude manuel, qui s'intercalera entre `PENDING` et `PAYABLE` sans relire aucune commission déjà versée.
- **Module de satisfaction** : non implémenté, conformément au point 14.

## Politique SMS

`CRITICAL_SMS_TYPES` est une liste **blanche** — quatre types autorisés, tout le reste muet par défaut. Une liste noire aurait l'effet inverse : tout nouveau type partirait en SMS jusqu'à ce que quelqu'un pense à l'exclure, et la facture le dirait avant le code. Un test parcourt l'énumération complète des notifications pour le garantir.

Les quatre types retenus : les trois alertes de portefeuille (explicitement demandées au point 8 — perdre une entreprise a un effet financier direct, et c'est précisément parce que l'ambassadeur n'ouvre plus l'application que le compte à rebours court) et le constat d'un virement exécuté.

`sms-templates.ts` est le **seul fichier du backend** contenant des phrases rédigées, dans les quatre langues du produit. Exception assumée à la convention maison : un SMS n'a pas de client pour traduire. Toute phrase rédigée ailleurs dans le backend est une régression.

## Reste à faire

- **Canal e-mail** : le point 8 demande application + e-mail + SMS. Le canal e-mail n'existe pas encore ; il s'ajoutera dans `notifications.module.ts` sans qu'aucun appelant change.
- **Prestations entreprises** : le barème `SERVICE` est en place (15 % / 8 % / 5 %, `productKey` nul = toutes prestations), mais le catalogue de prestations relève de l'étape 4.
- **Tableau de bord marketing** : `Organization.acquisitionSource` est collecté et indexé ; l'agrégation reste à écrire.
- **Écrans mobiles** : étape 3.
- **BUSINESS / INSTITUTION** : aucun taux n'a été arbitré. En l'absence de règle, le moteur ne crée **aucune** commission et journalise le fait — préférable, sur de l'argent, à l'invention d'un taux plausible.
