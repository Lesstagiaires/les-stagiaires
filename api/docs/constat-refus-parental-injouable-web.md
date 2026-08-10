# Constat — le parent ne peut PAS refuser depuis le web

**Date** : 2026-08-09
**Découvert** : recette réelle du cycle de refus parental, environnement exposé par
tunnel Cloudflare, page ouverte dans un navigateur — c'est-à-dire dans les conditions
exactes d'un vrai tuteur.
**Statut** : constat. **Aucune correction appliquée**, sur consigne du promoteur.
**Gravité** : **BLOQUANT POUR LA RECETTE** et **BLOQUANT POUR LA PRODUCTION**.

---

## Le fait

Sur la page `/consent/:linkId` ouverte dans un navigateur, le bouton **« Je refuse »
ne produit aucun effet**. Ni dialogue, ni appel réseau, ni message d'erreur. Le clic
tombe dans le vide.

Le tuteur n'a donc, en pratique, qu'une seule action possible : **accepter**.

## Reproduction exacte

1. Un mineur s'inscrit avec le numéro d'un tuteur.
2. Le tuteur reçoit le SMS et ouvre le lien **depuis son téléphone** — donc dans un
   navigateur, puisqu'il n'a pas l'application.
3. Il saisit son code à six chiffres.
4. Il clique sur **« Je refuse »**.
5. **Rien ne se passe.** Aucune trace, ni à l'écran, ni au journal, ni en base.
6. Ne comprenant pas, il finit par cliquer sur « Je donne mon accord » — le seul
   bouton qui réagit.

Observé deux fois de suite pendant la recette, sur deux comptes distincts. Le journal
d'audit ne porte que `PARENTAL_CONSENT_CONFIRMED` ; aucun `PARENTAL_CONSENT_DECLINED`
n'a jamais pu être produit depuis le navigateur.

## Cause technique

`mobile/app/(auth)/consent/[linkId].tsx` protège le refus par une confirmation :

```ts
function demanderRefus() {
  Alert.alert(titre, avertissement, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Confirmer', style: 'destructive', onPress: () => void refuser() },
  ]);
}
```

L'intention est bonne : un refus bloque le compte de l'enfant, « un doigt qui glisse
ne doit pas suffire ».

Mais `Alert` vient de `react-native`, et sur `react-native-web` son implémentation
est — littéralement — vide :

```js
// node_modules/react-native-web/dist/exports/Alert/index.js
class Alert {
  static alert() {}
}
```

`Alert.alert()` ne fait rien, ne lève rien, ne rend rien. Le rappel `onPress` qui
porte l'appel à `refuser()` n'est donc **jamais atteint**, et `declineParentalConsent`
n'est jamais appelée.

Le chemin d'acceptation, lui, n'a pas de dialogue : `PrimaryButton` appelle
directement `confirmer()`. D'où l'asymétrie — un bouton marche, l'autre pas.

## Pourquoi personne ne l'avait vu

- **Les tests unitaires ne le voient pas** : ils portent sur le service serveur, qui
  fonctionne parfaitement. `declineConsent` est correct, testé, et ses sabotages ont
  été prouvés mordants.
- **Le test d'intégration ne le voit pas** : il appelle les services directement,
  sans passer par l'écran.
- **Sur mobile natif, le code fonctionne** : `Alert.alert` y est bien implémenté. Un
  essai sur simulateur iOS ou Android n'aurait rien montré.
- Le défaut ne vit que sur **le web**, qui est précisément le seul canal dont dispose
  un tuteur : il reçoit un lien par SMS et l'ouvre dans son navigateur. Il n'a pas de
  compte, donc pas d'application.

## Impact

Tout le chantier du cycle de refus — compteur, délais configurables par pays,
autorisation nominative de changement de tuteur, journal en ajout seul — est
**inatteignable par la personne pour qui il a été construit**.

Plus grave que l'aspect fonctionnel : le cahier des charges exige « une action
positive et traçable » du parent, et le modèle validé le 2026-08-08 pose que « le
droit du parent ou du tuteur de refuser doit être respecté ». En l'état, le produit
présente au tuteur deux boutons dont un seul fonctionne, et enregistre son accord
alors qu'il cherchait à refuser. Un consentement obtenu ainsi n'est pas un
consentement.

## Pistes de correction — rien n'est engagé

1. **Une confirmation rendue par l'application elle-même** (un composant modal, ou un
   second état du bouton : « Je refuse » → « Confirmer le refus »). C'est la seule
   piste qui se comporte identiquement sur les deux plateformes, et qui ne dépend
   d'aucune implémentation tierce.
2. `Platform.select` avec `window.confirm` sur le web. Fonctionne, mais laisse deux
   chemins distincts à maintenir, et `window.confirm` est bloqué par certains
   navigateurs mobiles.
3. Supprimer la confirmation. À écarter : le garde-fou existe pour une bonne raison.

La piste 1 est recommandée.

## Tests à ajouter avec la correction

- **Un test qui rend l'écran et déclenche le refus**, jusqu'à vérifier que
  `declineParentalConsent` a bien été appelée. C'est ce test qui manquait.
- **Un test de parité des deux décisions** : accepter et refuser doivent être
  atteignables par le même nombre d'interactions, sur chaque plateforme cible.
- **Une interdiction d'`Alert.alert` dans tout écran atteignable depuis le web**,
  sur le modèle du test qui interdit déjà `User.isMinor` hors du module
  d'authentification. Le défaut est structurel : il se reproduira ailleurs.

## Ce qui n'a pas été fait

Aucun code modifié, aucune écriture en base pour simuler un refus, aucun contournement.
Les deux comptes de recette restent dans l'état où la recette les a laissés — ils
constituent la preuve reproductible.
