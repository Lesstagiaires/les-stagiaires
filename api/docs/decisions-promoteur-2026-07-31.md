# Décisions du promoteur — 2026-07-31

Arbitrages transmis en accompagnement du document `vision-produit-ambassadeurs.md`.
En cas de divergence, **ces décisions priment** sur les documents antérieurs.

## 1. Périmètre et calendrier

Le Programme d'Ambassadeurs et d'Affiliation **entre dans le périmètre de lancement**,
il n'est pas différé. Déploiement en 5 étapes : Conception → Backend minimal →
Interface → Entreprises et services → Automatisation.

## 2. Partenariat entreprise — statut sans expiration

> **Cette décision annule la règle du 2026-07-30** (« un an ferme puis reconduction
> tacite, rupture avec 30 jours de préavis »). Le code écrit ce jour-là sur cette base
> doit être retiré.

- Gratuit à l'inscription et à la publication d'offres.
- **Aucune date d'expiration calculée par le système.**
- Gérer un **statut** (actif, suspendu, résilié), **jamais une durée**.
- La date de signature est conservée **à titre informatif uniquement**.
- Toute fin de partenariat résulte d'une **décision administrative explicite**, jamais
  d'un mécanisme automatique lié au temps.
- Durée, renouvellement et conditions de résiliation relèvent **exclusivement du contrat
  de partenariat signé**, pas de la logique applicative.

Conséquence directe sur le code existant : suppression de `termEndsAt`,
`terminationEffectiveAt`, de la reconduction tacite et de la bascule automatique vers
`ENDED` (processeur `PartnershipLifecycleProcessor`).

## 3. Classement des offres — jamais à vendre

Classement candidat fondé sur la **pertinence** (correspondance profil/offre, fraîcheur),
jamais sur le paiement. Toute mise en avant payante porte un badge
**« Annonce sponsorisée »** clairement visible, **sans évincer une offre plus pertinente**.

## 4. Formules d'abonnement — noms et tarifs validés

| Formule | Tarif | Statut |
|---|---|---|
| GRATUIT | — | Actif |
| **CARRIÈRE SÉCURISÉE** (remplace PROTECT) | 1 000 FCFA/an | Validé |
| **CARRIÈRE PLUS** (remplace PRO) | 5 000 FCFA/an | **Sous réserve de validation du modèle financier avant activation commerciale** |
| BUSINESS | Abonnement professionnel distinct | Le partenariat de base reste gratuit |

Prestations commerciales (campagnes marketing, recrutement, publicité, mise en avant
sponsorisée, recherche de talents, accompagnement RH/juridique, événements, formations) :
**devis spécifique par prestation**, jamais un tarif unique figé. Catalogue configurable
depuis l'administration (droits, quotas, prix, promotions, pays, langues).

## 5. Programme d'Ambassadeurs — document validé, un ajout

Toutes les règles du document sont validées telles quelles : commission **uniquement sur
revenu réellement encaissé**, deux catégories cumulables (Campus, Business), taux
configurables non codés en dur (20 % Carrière Sécurisée, 20 % Carrière Plus, 10-15 %
prestations entreprises), paliers configurables, cycle de vie complet des commissions
avec période de sécurité, portefeuille interne à paiement manuel validé par un
administrateur en première version, antifraude complète, intégration **par événement
backend confirmé uniquement — jamais depuis une réponse frontend**.

**Ajout du promoteur, à respecter strictement :** le **premier paiement réel de
commission dans un pays donné** n'intervient qu'après signature, par l'ambassadeur
concerné, du **Contrat d'Apporteur d'Affaires LES STAGIAIRES**, rédigé par le promoteur.
L'architecture du portefeuille et des paiements peut être construite dès maintenant ;
le déclenchement du tout premier virement réel est **bloqué administrativement** tant que
ce contrat n'est pas signé pour le pays concerné.

## 6. Présentation attendue avant toute migration

Le promoteur attend, **avant l'implémentation complète** : choix structurants, migrations
envisagées, règles d'attribution, **assiette de calcul des commissions recommandée**
(à proposer, non imposée), durée de la période de sécurité, risques de fraude identifiés,
et décisions nécessitant encore sa validation.

## 7. Vulnérabilités de production

Feu vert donné pour la tâche #113 — **déjà exécutée le 2026-07-30** : 4 vulnérabilités de
production corrigées (0 restante), faille élevée du mobile corrigée, 179 tests verts.
