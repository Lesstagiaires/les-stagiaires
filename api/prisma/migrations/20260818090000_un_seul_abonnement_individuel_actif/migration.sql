-- P1-1 — UN SEUL ABONNEMENT INDIVIDUEL À LA FOIS
--
-- POURQUOI CET INDEX EXISTE
-- L'audit de conformité à la Gouvernance maître V5 (contradiction C-3) a établi
-- que `createSubscription()` créait un abonnement et un paiement SANS vérifier
-- qu'un abonnement individuel occupait déjà la place. Un même compte pouvait
-- donc être facturé deux fois — et le doublon, classé RENEWAL par
-- `determineNature()`, produisait en plus une commission d'ambassadeur.
--
-- POURQUOI EN SQL ÉCRIT À LA MAIN, ET NON DANS schema.prisma
-- Prisma ne sait pas exprimer un index PARTIEL : `@@unique` n'accepte pas de
-- clause WHERE. Or c'est précisément la clause WHERE qui rend cet index juste —
-- sans elle, l'unicité porterait sur tous les abonnements d'un bénéficiaire et
-- interdirait le renouvellement d'un abonnement expiré, c'est-à-dire le chantier
-- P1-2 tout entier.
--
-- CONSÉQUENCE ASSUMÉE : cet index n'apparaît pas dans schema.prisma. Prisma ne
-- le gère pas et pourrait vouloir le supprimer lors d'un futur `migrate dev`.
-- C'est pour cela que `subscriptions-unicite.integration.spec.ts` vérifie sa
-- PRÉSENCE ET SA DÉFINITION EXACTE sur une base réelle : sa disparition ou sa
-- modification involontaire fait échouer la chaîne de tests, jamais silence.
--
-- POURQUOI UNE GARANTIE DE BASE ET NON UNE SEULE VÉRIFICATION APPLICATIVE
-- La garde de `SubscriptionsService` lit puis écrit. Deux requêtes simultanées
-- la franchissent ensemble sans rien voir. Seule la base peut trancher — charte
-- de qualité §9.1 : « préférer une garantie structurelle à une discipline de
-- code ». Le même choix a déjà été fait pour l'attribution d'un filleul
-- (`AmbassadorReferral.referredUserId`), dont la course est fermée par un index
-- unique et une violation P2002 rattrapée par le service.
--
-- PÉRIMÈTRE DU PRÉDICAT — chaque terme est nécessaire
--   beneficiaryUserId IS NOT NULL : ne concerne QUE les abonnements
--     individuels rattachés à une personne. Les abonnements d'organisation
--     (BUSINESS / INSTITUTION), qui portent beneficiaryOrganizationId et laissent
--     beneficiaryUserId nul, ne sont jamais touchés.
--   plan IN (...) : les deux formules individuelles, cf. `individual-plans.ts`.
--     Les identifiants techniques CARRIERE_SECURISEE et CARRIERE_PLUS restent
--     ceux du schéma — la V5 interdit de les renommer, les noms commerciaux
--     PARCOURS et PARCOURS PRO vivant uniquement dans l'i18n.
--   status IN ('ACTIVE', 'PENDING_PAYMENT') : les deux seuls statuts qui
--     occupent la place. PENDING_PAYMENT est inclus à dessein — sans lui, n
--     souscriptions successives créeraient n paiements en attente, chacun
--     confirmable plus tard, et la règle serait contournée sans que deux ACTIVE
--     coexistent jamais. PAYMENT_FAILED, EXPIRED et CANCELLED restent libres :
--     un paiement échoué doit pouvoir être retenté, un abonnement expiré
--     renouvelé.
--
-- EFFET SUR LES DONNÉES EXISTANTES : aucun ajout, aucune modification, aucune
-- suppression de ligne. La création échouerait si une violation existait déjà —
-- ce serait alors un doublon réel à instruire, pas un défaut de cette migration.

CREATE UNIQUE INDEX "Subscription_beneficiaire_individuel_actif_key"
  ON "Subscription" ("beneficiaryUserId")
  WHERE "beneficiaryUserId" IS NOT NULL
    AND "plan" IN ('CARRIERE_SECURISEE', 'CARRIERE_PLUS')
    AND "status" IN ('ACTIVE', 'PENDING_PAYMENT');
