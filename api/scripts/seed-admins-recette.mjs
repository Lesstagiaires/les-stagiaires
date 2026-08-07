#!/usr/bin/env node
// ============================================================================
// DEUX ADMINISTRATEURS DE DÉMONSTRATION SUPPLÉMENTAIRES
//
// POURQUOI CE SCRIPT EXISTE. Depuis l'arbitrage 12 du promoteur (2026-08-02),
// « une même personne ne doit pas pouvoir, seule, approuver puis exécuter le
// même paiement ». La conséquence est opérationnelle et doit être dite :
//
//   LA PLATEFORME EXIGE DÉSORMAIS AU MOINS DEUX ADMINISTRATEURS POUR VERSER
//   QUOI QUE CE SOIT — TROIS au-delà du seuil de double contrôle.
//
// Un déploiement mono-administrateur ne peut payer personne. Ce n'est pas un
// défaut : c'est la règle qui fonctionne. Mais elle doit être connue AVANT le
// lancement, pas découverte le jour du premier versement.
//
// La base de développement ne comptait qu'un seul compte ADMIN, ce qui rendait
// le parcours nominal impossible à jouer en recette. Ce script crée les deux
// manquants.
//
// COMPTES DE DÉMONSTRATION, marqués `isDemo` : le script de préparation à la
// production les supprime. Ils ne doivent JAMAIS survivre en production — un
// compte d'administration créé par un script d'amorçage est exactement le genre
// d'accès dont personne ne se souvient et que personne ne révoque.
//
//   node scripts/seed-admins-recette.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url = /DATABASE_URL="?([^"\n]+)"?/.exec(env)?.[1];
if (!url) {
  console.error('DATABASE_URL introuvable dans .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// Compte ADMIN de démonstration déjà présent. Son empreinte de mot de passe est
// recopiée telle quelle : argon2 porte son propre sel, la recopier ne révèle
// rien et évite d'écrire un mot de passe en clair dans ce fichier.
const MODELE = '+237690000001';

const NOUVEAUX = ['+237690000002', '+237690000003'];

const { rows: modeles } = await client.query(
  'SELECT id, password, status, language, "isDemo" FROM "User" WHERE phone = $1',
  [MODELE],
);
const modele = modeles[0];

if (!modele) {
  console.error(
    `Compte modèle ${MODELE} introuvable. Amorcer d'abord les données de démonstration.`,
  );
  process.exit(1);
}
// Garde-fou : si le compte modèle n'est pas de démonstration, on est sur une base
// qui n'en est pas une. Un script qui crée des administrateurs ne doit pas se
// tromper de base.
if (!modele.isDemo) {
  console.error(
    `Le compte modèle ${MODELE} n'est pas marqué isDemo : cette base n'est pas une base de démonstration. Abandon.`,
  );
  process.exit(1);
}

const { rows: roles } = await client.query(
  `SELECT id FROM "Role" WHERE name = 'ADMIN'`,
);
if (roles.length === 0) {
  console.error('Rôle ADMIN introuvable.');
  process.exit(1);
}
const roleAdminId = roles[0].id;

for (const phone of NOUVEAUX) {
  const { rows: existants } = await client.query(
    'SELECT id FROM "User" WHERE phone = $1',
    [phone],
  );
  if (existants.length > 0) {
    console.log(`déjà présent : ${phone}`);
    continue;
  }

  const id = `admin_recette_${phone.slice(-4)}`;
  await client.query(
    `INSERT INTO "User" (id, phone, password, status, language, "isDemo", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, true, now())`,
    [id, phone, modele.password, modele.status, modele.language],
  );
  await client.query(
    `INSERT INTO "UserRole" (id, "userId", "roleId") VALUES ($1, $2, $3)`,
    [`ur_${id}`, id, roleAdminId],
  );

  console.log(`créé : ${phone} (${id}) — ADMIN, isDemo`);
}

const { rows: totaux } = await client.query(
  `SELECT count(*)::int AS n FROM "UserRole" WHERE "roleId" = $1`,
  [roleAdminId],
);

console.log('');
console.log(`${totaux[0].n} compte(s) ADMIN au total.`);
console.log('Rappel : DEUX au minimum sont nécessaires pour exécuter un versement,');
console.log('et TROIS au-delà du seuil de double contrôle.');

await client.end();
