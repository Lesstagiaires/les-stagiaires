# Constat — un refus parental « vérifie » le téléphone du mineur

**Date** : 2026-08-10
**Découvert** : recette réelle du cycle de refus parental, base `stagiaires_recette`.
**Statut** : constat. **Aucune correction appliquée**, sur consigne du promoteur.
**Gravité** : **BLOQUANT POUR LA PRODUCTION**. Non bloquant pour la recette.

---

## Le fait, observé en base

Le compte `+237690445566` :

- n'a **jamais** été vérifié par code à usage unique — zéro événement
  `ACCOUNT_PHONE_VERIFIED` à son journal ;
- n'a **aucun LS-ID**, puisque celui-ci n'est attribué qu'à la vérification ;
- a pourtant produit un **`LOGIN_SUCCESS`** à 07:42:48.

Ce qui s'est passé entre les deux : le tuteur a refusé, à 07:41:14.

## Cause technique

Deux décisions correctes prises séparément, qui composent mal.

`parental-consent.service.ts`, dans `declineConsent()` — le statut est écrit
**sans condition** :

```ts
await this.prisma.user.update({
  where: { id: child.id },
  data: {
    status: AccountStatus.AWAITING_PARENTAL_CONSENT,
    parentalRefusalCount: refusalCount,
    // …
  },
});
```

`auth.service.ts`, dans `login()` — la vérification du téléphone se déduit du
**statut**, et de rien d'autre :

```ts
if (user.status === AccountStatus.PENDING_VERIFICATION) {
  throw new ForbiddenException("Ce compte n'a pas encore été vérifié par OTP.");
}
```

Un compte non vérifié est donc `PENDING_VERIFICATION`. Le refus l'écrase en
`AWAITING_PARENTAL_CONSENT`. Le garde-fou de connexion, qui ne regarde que le
statut, ne voit plus rien à bloquer.

Le refus parental **efface la preuve de possession du téléphone**.

## Ce que cela ouvre

L'inscription ne vérifie pas que le numéro déclaré appartient à celui qui
s'inscrit — c'est justement le rôle du code à usage unique. Le contournement
tient en quatre gestes :

1. s'inscrire avec le numéro de quelqu'un d'autre ;
2. déclarer **son propre** numéro comme celui du tuteur (rien ne l'interdit :
   seul le numéro du mineur lui-même est refusé) ;
3. recevoir le SMS d'accord parental sur son propre téléphone, et **refuser** ;
4. se connecter au compte, désormais sorti de `PENDING_VERIFICATION`.

Le compte reste en mode restreint — candidature, convention et partage demeurent
bloqués, ce que la recette a vérifié. Mais :

- le numéro de la victime est **définitivement pris** par la contrainte
  d'unicité, elle ne pourra jamais s'inscrire ;
- l'attaquant dispose d'un compte relié à ce numéro, peut constituer un profil,
  et apparaît dans le système comme mineur à protéger ;
- le tuteur légitime de la victime, s'il existe, n'a jamais été sollicité.

## Ce qui atténue, et ce qui n'atténue pas

**Atténue** : le compte reste restreint ; aucun LS-ID n'est délivré ; l'acte est
journalisé.

**N'atténue pas** : rien ne signale l'anomalie, aucun balayage ne récupère ces
comptes, et l'utilisateur légitime du numéro n'a aucun recours automatique.

## Pistes de correction — rien n'est engagé

1. **Ne plus déduire la vérification du statut.** Un champ dédié — un
   `phoneVerifiedAt` — dit un fait qui ne dépend d'aucune transition métier.
   C'est la correction structurelle : elle survit à tout futur code qui écrirait
   le statut sans y penser.
2. **Rendre l'écriture conditionnelle** dans `declineConsent` : ne passer en
   `AWAITING_PARENTAL_CONSENT` que si le compte n'était pas
   `PENDING_VERIFICATION`. Plus petit, mais fragile — le prochain service qui
   écrira le statut refera l'erreur.
3. Les deux. La piste 1 corrige la cause, la piste 2 corrige l'appelant.

La piste 1 est recommandée. Elle relève du même principe que le remplacement de
`User.isMinor` par un recalcul : **ne jamais déduire un fait d'un état qui bouge
pour d'autres raisons.**

## Tests à ajouter avec la correction

- **Un refus parental ne rend pas un compte non vérifié connectable.** Formulé
  ainsi, le test porte sur la garantie, pas sur l'implémentation.
- **La confirmation non plus** : `confirmConsent` écrit lui aussi le statut, sous
  condition aujourd'hui — à couvrir pour que la symétrie soit tenue.
- **Aucun service hors du parcours de vérification n'écrit
  `phoneVerifiedAt`**, sur le modèle du test qui confine `User.isMinor` au
  module d'authentification.

## Ce qui n'a pas été fait

Aucun code modifié, aucune écriture directe en base. Le compte
`+237690445566` est laissé dans l'état exact où la recette l'a mis : il
constitue la preuve reproductible.
