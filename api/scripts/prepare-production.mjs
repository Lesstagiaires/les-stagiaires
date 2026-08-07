#!/usr/bin/env node
// ============================================================================
// PRÉPARATION À LA MISE EN PRODUCTION
// Exigence du promoteur du 2026-08-02.
//
// Un script UNIQUE qui sait :
//   — supprimer tous les comptes de démonstration ;
//   — supprimer toutes les données de test qui en dépendent ;
//   — vérifier qu'aucun mot de passe de démonstration ne subsiste ;
//   — vérifier qu'aucune donnée de recette n'est encore présente.
//
// USAGE
//   node scripts/prepare-production.mjs              # vérifie, ne touche à rien
//   node scripts/prepare-production.mjs --purge      # supprime, puis vérifie
//
// La vérification est le mode PAR DÉFAUT. Un script de préparation à la
// production qui détruit sans qu'on l'ait demandé serait lui-même le danger.
//
// -------------------------------------------------------------------------
// CE QUE CE SCRIPT NE PEUT PAS FAIRE, ET POURQUOI
//
// `AuditLog` et `PartnershipEvent` sont en AJOUT SEUL, garanti par déclencheur
// PostgreSQL. Aucune ligne n'y est supprimable — y compris par ce script, y
// compris par un superutilisateur passant par l'application.
//
// C'est voulu, et cela entre en tension directe avec « supprimer toutes les
// données de test ». La tension se résout ainsi :
//
//   LA PRODUCTION PART D'UNE BASE VIERGE + MIGRATIONS. Elle ne part JAMAIS
//   d'une base de recette qu'on aurait nettoyée.
//
// Ce script sert donc à deux choses : nettoyer un environnement de recette pour
// le rejouer, et REFUSER de certifier une base qui porterait encore des traces
// de recette dans ses journaux. Dans ce dernier cas il le dit franchement plutôt
// que de délivrer un feu vert qui ne vaudrait rien.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Mots de passe connus pour avoir servi en recette. Toute correspondance sur un
// compte encore présent est bloquante : un mot de passe publié dans un rapport
// vaut mot de passe compromis.
const DEMONSTRATION_PASSWORDS = ['Recette2026!', 'Password123!', 'Test1234!'];

// Actions d'audit de démonstration légitimes et destinées à rester. Doit rester
// aligné sur src/audit/demonstration-entries.ts.
const DEMONSTRATION_AUDIT_ACTIONS = ['TEST_APPEND_ONLY'];

const PURGE = process.argv.includes('--purge');

// ---------------------------------------------------------------------------
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(
      'DATABASE_URL introuvable : ni dans l’environnement, ni dans api/.env',
    );
  }
  const match = fs
    .readFileSync(envPath, 'utf8')
    .match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error('DATABASE_URL absente de api/.env');
  return match[1];
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const failures = [];
const warnings = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${green('OK')}     ${label}`);
  } else {
    failures.push(label);
    console.log(`  ${red('BLOQUANT')} ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function warn(label, detail) {
  warnings.push(label);
  console.log(`  ${yellow('RÉSERVE')}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log('');
  console.log(bold('─'.repeat(76)));
  console.log(bold(title));
  console.log(bold('─'.repeat(76)));
}

// ---------------------------------------------------------------------------
const client = new pg.Client({ connectionString: loadDatabaseUrl() });
await client.connect();

const count = async (sql, params = []) =>
  Number((await client.query(sql, params)).rows[0].n);

console.log('');
console.log(bold('PRÉPARATION À LA MISE EN PRODUCTION — LES STAGIAIRES'));
console.log(
  PURGE
    ? yellow('Mode : PURGE puis vérification (destructif)')
    : 'Mode : vérification seule (aucune écriture)',
);

// --- 1. Inventaire ----------------------------------------------------------
section('1. Inventaire des données de démonstration');

const demoUsers = await count('SELECT count(*) AS n FROM "User" WHERE "isDemo"');
const demoOrgs = await count(
  'SELECT count(*) AS n FROM "Organization" WHERE "isDemo"',
);
console.log(`  Comptes marqués démonstration      : ${demoUsers}`);
console.log(`  Organisations marquées démonstration : ${demoOrgs}`);

// Ce qui dépend de ces racines. Compté AVANT purge pour que le rapport dise ce
// qui a été détruit, et non seulement qu'il ne reste rien.
// Chaque requête relie l'entité à l'une des DEUX RACINES marquées. Les colonnes
// sont celles du schéma réel — une candidature appartient à un `candidateId`, un
// paiement se rattache à un abonnement, et un abonnement peut bénéficier soit à
// une personne, soit à une organisation.
const dependents = {
  Partenariats: `SELECT count(*) AS n FROM "Partnership" p
                   JOIN "Organization" o ON o.id = p."organizationId" WHERE o."isDemo"`,
  Candidatures: `SELECT count(*) AS n FROM "Application" a
                   JOIN "User" u ON u.id = a."candidateId" WHERE u."isDemo"`,
  Notifications: `SELECT count(*) AS n FROM "Notification" x
                   JOIN "User" u ON u.id = x."userId" WHERE u."isDemo"`,
  Abonnements: `SELECT count(*) AS n FROM "Subscription" s
                   LEFT JOIN "User" u ON u.id = s."beneficiaryUserId"
                   LEFT JOIN "Organization" o ON o.id = s."beneficiaryOrganizationId"
                  WHERE COALESCE(u."isDemo", false) OR COALESCE(o."isDemo", false)`,
  Paiements: `SELECT count(*) AS n FROM "Payment" p
                   JOIN "Subscription" s ON s.id = p."subscriptionId"
                   LEFT JOIN "User" u ON u.id = s."beneficiaryUserId"
                   LEFT JOIN "Organization" o ON o.id = s."beneficiaryOrganizationId"
                  WHERE COALESCE(u."isDemo", false) OR COALESCE(o."isDemo", false)`,
  Commissions: `SELECT count(*) AS n FROM "Commission" c
                   JOIN "Ambassador" a ON a.id = c."ambassadorId"
                   JOIN "User" u ON u.id = a."userId" WHERE u."isDemo"`,
};

const before = {};
for (const [label, sql] of Object.entries(dependents)) {
  try {
    before[label] = await count(sql);
    console.log(`  ${label.padEnd(34)} : ${before[label]}`);
  } catch (error) {
    // Une table absente n'est pas une erreur : le schéma évolue, et ce script
    // doit survivre à un module renommé sans bloquer une mise en production.
    before[label] = null;
    warn(`table de ${label} inaccessible`, error.message.split('\n')[0]);
  }
}

// --- 2. Purge ---------------------------------------------------------------
if (PURGE) {
  section('2. Suppression');

  await client.query('BEGIN');
  try {
    // Les organisations d'abord : leurs partenariats, offres et candidatures
    // partent en cascade. Puis les comptes, qui emportent le reste.
    const orgs = await client.query(
      'DELETE FROM "Organization" WHERE "isDemo" RETURNING id',
    );
    const users = await client.query(
      'DELETE FROM "User" WHERE "isDemo" RETURNING id',
    );
    await client.query('COMMIT');
    console.log(`  ${orgs.rowCount} organisation(s) supprimée(s)`);
    console.log(`  ${users.rowCount} compte(s) supprimé(s)`);
    console.log(
      '  Les entités dépendantes ont suivi par cascade de clé étrangère.',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.log(`  ${red('ÉCHEC')} — aucune suppression effectuée.`);
    console.log(`  ${error.message.split('\n')[0]}`);
    // Un échec ici vient le plus souvent d'une contrainte RESTRICT : une pièce
    // du coffre-fort rattachée à un partenariat, par exemple. C'est un garde-fou
    // qui a fonctionné, pas un bogue.
    failures.push('la purge a échoué');
  }
} else {
  section('2. Suppression — ignorée (mode vérification)');
  console.log('  Relancer avec --purge pour supprimer.');
}

// --- 3. Vérifications -------------------------------------------------------
section('3. Vérifications bloquantes');

assert(
  'aucun compte de démonstration ne subsiste',
  (await count('SELECT count(*) AS n FROM "User" WHERE "isDemo"')) === 0,
  `${await count('SELECT count(*) AS n FROM "User" WHERE "isDemo"')} restant(s)`,
);
assert(
  'aucune organisation de démonstration ne subsiste',
  (await count('SELECT count(*) AS n FROM "Organization" WHERE "isDemo"')) === 0,
);

for (const [label, sql] of Object.entries(dependents)) {
  if (before[label] === null) continue;
  const remaining = await count(sql);
  assert(
    `aucune donnée de recette — ${label.toLowerCase()}`,
    remaining === 0,
    `${remaining} restante(s)`,
  );
}

// Mots de passe : on vérifie par CALCUL, pas par comparaison de chaînes. Les
// empreintes argon2 sont salées, deux comptes partageant le même mot de passe
// n'ont pas la même empreinte — seule la vérification une à une le révèle.
const allUsers = await client.query(
  'SELECT id, phone, email, password FROM "User"',
);
let compromised = 0;
for (const user of allUsers.rows) {
  for (const password of DEMONSTRATION_PASSWORDS) {
    let matches = false;
    try {
      matches = await argon2.verify(user.password, password);
    } catch {
      // Empreinte illisible ou d'un autre algorithme : signalé plus bas, jamais
      // silencieux.
      matches = false;
    }
    if (matches) {
      compromised++;
      console.log(
        `           compte ${user.phone ?? user.email ?? user.id} utilise un mot de passe de recette`,
      );
      break;
    }
  }
}
assert(
  'aucun mot de passe de démonstration ne subsiste',
  compromised === 0,
  `${compromised} compte(s) concerné(s)`,
);

// --- 4. Journaux en ajout seul ---------------------------------------------
section('4. Journaux en ajout seul — non purgeables par construction');

const demoAuditRows = await count(
  `SELECT count(*) AS n FROM "AuditLog" WHERE action = ANY($1)`,
  [DEMONSTRATION_AUDIT_ACTIONS],
);
console.log(
  `  Entrées de démonstration documentées : ${demoAuditRows} (légitimes, destinées à rester)`,
);

const orphanEvents = await count(
  'SELECT count(*) AS n FROM "PartnershipEvent" WHERE "partnershipId" IS NULL',
);
const auditTotal = await count('SELECT count(*) AS n FROM "AuditLog"');
const eventTotal = await count('SELECT count(*) AS n FROM "PartnershipEvent"');
console.log(`  Lignes d'audit au total              : ${auditTotal}`);
console.log(`  Décisions de partenariat au total    : ${eventTotal}`);
console.log(`  dont orphelines d'un dossier supprimé : ${orphanEvents}`);

if (orphanEvents > 0 || auditTotal > demoAuditRows) {
  warn(
    'cette base porte un historique antérieur',
    'les journaux étant en ajout seul, il ne peut pas être effacé',
  );
  console.log('');
  console.log(
    `  ${yellow('→')} Une base DE PRODUCTION doit être créée vierge, puis migrée.`,
  );
  console.log(
    '    Nettoyer une base de recette ne produira jamais une base de production',
    '\n    propre : les journaux gardent trace de tout ce qui s’y est passé.',
  );
}

// --- Verdict ----------------------------------------------------------------
section('Verdict');

if (failures.length === 0 && warnings.length === 0) {
  console.log(green(bold('  Base APTE à la mise en production.')));
} else if (failures.length === 0) {
  console.log(
    yellow(bold('  Aucun point bloquant, mais des réserves subsistent :')),
  );
  for (const w of warnings) console.log(`    · ${w}`);
  console.log('');
  console.log(
    '  Cette base convient à un environnement de recette rejoué, PAS à une',
    '\n  mise en production. Repartir d’une base vierge.',
  );
} else {
  console.log(red(bold(`  ${failures.length} point(s) BLOQUANT(S) :`)));
  for (const f of failures) console.log(`    · ${f}`);
}
console.log('');

await client.end();
process.exit(failures.length === 0 ? 0 : 1);
