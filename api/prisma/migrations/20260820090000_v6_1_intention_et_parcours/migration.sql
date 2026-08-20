-- V6-1 — INTENTION INITIALE ET PARCOURS PROFESSIONNEL
--
-- POURQUOI CES DEUX COLONNES
-- Le système savait qualifier une OFFRE — Opportunity.type distingue stage
-- académique et stage professionnel — mais rien ne situait une PERSONNE. Cette
-- asymétrie empêchait le compte unique d'accompagner une progression
-- académique → professionnel → emploi sans créer un compte par étape.
--
-- POURQUOI PAS UN RÔLE
-- Le RBAC porte l'habilitation, jamais l'étape de vie. Créer
-- STAGIAIRE_ACADEMIQUE ou STAGIAIRE_PROFESSIONNEL aurait multiplié les rôles et
-- les bascules pour une seule et même personne, alors que UserRole[] +
-- Profile.activeRoleId permettent déjà à un compte de porter plusieurs
-- casquettes. Le parcours est une dimension MÉTIER, indépendante du RBAC.
--
-- POURQUOI DEUX COLONNES ET NON UNE
-- `initialIntent` est une photographie : pourquoi la personne est venue. Elle
-- est écrite au plus une fois et n'est jamais réécrite — sa valeur ne tient
-- qu'à son immuabilité. `currentPath` est une situation : où elle en est
-- aujourd'hui. Les fusionner aurait fait porter deux sens à un même champ,
-- exactement la faute qui a produit la vulnérabilité PENDING_VERIFICATION.
--
-- POURQUOI SIX VALEURS D'INTENTION ET NON HUIT
-- L'écran d'accueil propose huit choix, mais « proposer un partenariat » et
-- « autre demande » passent par un formulaire public qui ne crée AUCUN compte
-- (PartnershipRequest). Deux valeurs supplémentaires auraient donc été
-- inatteignables. Ces entonnoirs sont déjà mesurés par
-- PartnershipRequest.organizationType et .reason.
--
-- EFFET SUR LES DONNÉES EXISTANTES : AUCUN. Les deux colonnes sont NULLABLES et
-- restent nulles pour toutes les lignes déjà écrites. Rien n'est déduit du rôle,
-- du niveau d'études, des candidatures passées, d'une expérience ni d'un
-- abonnement : « non déclaré » n'est pas « devinable ». Seule une déclaration
-- volontaire du titulaire les renseignera.
--
-- RÉVERSIBILITÉ : DROP COLUMN puis DROP TYPE, sans perte pour le reste du
-- schéma — aucune contrainte, aucun index, aucune clé étrangère n'en dépend.

CREATE TYPE "UserIntent" AS ENUM (
  'ACADEMIC_INTERNSHIP_SEARCH',
  'PROFESSIONAL_INTERNSHIP_SEARCH',
  'ORGANIZATION',
  'ESTABLISHMENT',
  'GUARDIAN',
  'AMBASSADOR'
);

CREATE TYPE "UserPath" AS ENUM (
  'ACADEMIC',
  'PROFESSIONAL',
  'EMPLOYMENT'
);

ALTER TABLE "User" ADD COLUMN "initialIntent" "UserIntent";
ALTER TABLE "User" ADD COLUMN "currentPath" "UserPath";
