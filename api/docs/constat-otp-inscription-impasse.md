# Constat — un compte mineur peut rester définitivement bloqué après l'inscription

**Date** : 2026-08-09
**Découvert** : pendant la recette réelle du cycle de refus parental, environnement
exposé par tunnel Cloudflare, base `stagiaires_recette`, SMS en bac à sable Africa's
Talking.
**Statut** : constat. **Aucune correction appliquée**, sur consigne du promoteur.
**Gravité** : **BLOQUANT POUR LA PRODUCTION** — non bloquant pour la recette en cours.

---

## Reproduction exacte

1. `POST /auth/register` avec un numéro camerounais, une date de naissance dans la
   tranche 14–18 ans et le numéro d'un tuteur. → `201`, compte créé en
   `PENDING_VERIFICATION`, deux SMS partent : le code d'inscription au mineur, la
   demande d'accord au tuteur.
2. **Attendre plus de cinq minutes** — le temps qu'un SMS mette à arriver sur un
   réseau lent, ou simplement le temps que le jeune repose son téléphone.
3. Saisir le code d'inscription sur `/verify-otp` → refusé, le code a expiré.
4. Tenter de se reconnecter : `POST /auth/login` →
   **`403 — « Ce compte n'a pas encore été vérifié par OTP. »`**
5. Chercher à faire renvoyer le code : **aucune route ne le permet.**
6. Se réinscrire avec le même numéro : refusé, contrainte d'unicité sur `User.phone`.

Le compte est perdu. Le titulaire ne peut plus rien en faire, et rien ne le lui dit.

## Parcours utilisateur concerné

L'inscription d'un mineur — le tout premier écran du produit, celui dont le cahier
des charges dit qu'il ne faut « jamais bloquer l'inscription en attendant la
validation, sous peine de perdre l'utilisateur avant même de le protéger »
(CLAUDE.md §5).

Le défaut produit exactement ce que cette phrase cherche à éviter, par un autre
chemin.

## Cause technique

Une boucle fermée entre cinq décisions, chacune raisonnable isolément :

| # | Décision | Où |
|---|---|---|
| 1 | Le code d'inscription expire en **5 minutes** | `OTP_TTL_MINUTES=5` |
| 2 | Aucune route ne régénère un code d'inscription | `generateAndSend` n'est appelé qu'à l'inscription, à la 2FA et à la réinitialisation de mot de passe |
| 3 | L'écran mobile n'offre aucun bouton « renvoyer le code » | `app/(auth)/verify-otp.tsx` |
| 4 | La connexion exige un compte déjà vérifié | `auth.service.ts` — `403` |
| 5 | Relancer le tuteur exige d'être connecté | `POST /auth/minors/request-consent` porte `@CurrentUser()` |

Aucune de ces cinq décisions n'est fautive prise seule. C'est leur composition qui
ferme la porte, et cette composition n'apparaît que dans un parcours réel — aucun
test unitaire ne la voit, puisque chaque moitié se comporte correctement.

## Impact

- **Perte sèche d'utilisateur** dès que le SMS met plus de cinq minutes à arriver.
  Sur les réseaux visés — Cameroun d'abord, puis le reste du continent — ce n'est pas
  un cas limite.
- **Numéro brûlé** : la contrainte d'unicité empêche toute réinscription. Le jeune
  devrait changer de numéro de téléphone pour accéder à la plateforme.
- **Aucun message d'explication.** L'utilisateur voit « code invalide ou expiré »,
  puis « compte non vérifié ». Rien ne lui indique qu'il n'y a pas d'issue.
- **Le tuteur a déjà été sollicité.** Un parent a reçu un SMS lui demandant de se
  prononcer sur un compte qui ne pourra jamais servir. S'il accepte, son accord porte
  sur un compte mort.
- **Effet de bord sur le support** : ces comptes s'accumulent en
  `PENDING_VERIFICATION` sans qu'aucun balayage ne les traite — celui des trente
  jours ne regarde que les liens parentaux `PENDING`, pas les comptes non vérifiés.

## Pistes de correction — à arbitrer, rien n'est engagé

Par ordre de préférence, la première étant la plus structurelle :

1. **Une route de renvoi du code d'inscription**, publique, protégée par sa propre
   limitation de débit et par un délai de garde comparable à celui des relances
   parentales (trois minutes). C'est la vraie réponse : elle traite la cause, et pas
   seulement la fenêtre.
2. **Allonger `OTP_TTL_MINUTES`** — quinze ou trente minutes. Corrige le cas le plus
   fréquent, ne ferme pas le cas général : un SMS perdu reste un compte perdu.
3. **Autoriser la connexion en `PENDING_VERIFICATION`** en mode très restreint, ce
   qui rouvrirait au moins la relance parentale. Attention : cela déplace une
   frontière de sécurité, et mérite son propre examen.
4. **Un bouton « renvoyer le code »** sur l'écran de vérification — nécessaire, mais
   inutile sans la piste 1, puisqu'il n'y a aucune route à appeler.

La piste 2 seule serait un pansement : elle rendrait le défaut plus rare sans le
supprimer, ce qui est la pire des situations pour un défaut que personne ne sait
reproduire.

## Tests à ajouter avec la correction

- **Test de bout en bout du renvoi** : inscription, expiration du code, renvoi,
  vérification réussie. Sans lui, la route pourrait exister et ne pas fonctionner.
- **Test de non-régression sur l'impasse** : un compte `PENDING_VERIFICATION` dont le
  code a expiré doit disposer d'au moins un chemin de sortie. Formulé ainsi, le test
  survit à un changement d'implémentation.
- **Délai de garde du renvoi** : deux demandes rapprochées, la seconde refusée — le
  même raisonnement que pour les relances parentales, où le risque est de transformer
  la plateforme en outil de harcèlement d'un numéro.
- **Limitation de débit** : la route étant publique et prenant un numéro en entrée,
  elle permettrait sinon d'énumérer les comptes et de facturer des SMS à volonté.
- **Le tuteur n'est pas resollicité** par un renvoi de code d'inscription : les deux
  mécanismes doivent rester distincts.

## Ce qui n'a pas été fait

Ni le délai de cinq minutes, ni la base, ni le parcours d'inscription n'ont été
modifiés. Le compte de recette — désigné ici `+237600000001`, **numéro fictif**
substitué au numéro réellement utilisé — reste bloqué en `PENDING_VERIFICATION`
et sert de preuve reproductible.

> Aucun numéro réel n'est reproduit dans ce dépôt. Les numéros en `+23760…`
> n'existent pas : le préfixe `60` n'est attribué à aucun opérateur camerounais
> (les mobiles y commencent par `62`, `65`, `66`, `67`, `68` ou `69`).

Le cycle de refus parental, lui, ne dépend pas de la vérification du compte : la
recette s'est poursuivie sans contourner quoi que ce soit.
