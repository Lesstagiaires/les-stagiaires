#!/usr/bin/env node
// ============================================================================
// CHIFFREMENT DES COORDONNÉES DE PAIEMENT EXISTANTES
//
// Accompagne la migration `20260805090000_encrypt_payment_destinations`.
//
// POURQUOI CE TRAVAIL N'EST PAS DANS LA MIGRATION SQL. PostgreSQL n'a pas le
// trousseau de clés, et le lui donner reviendrait exactement à ranger la clé
// avec la serrure — c'est-à-dire à défaire ce que le chiffrement apporte. Le
// chiffrement se fait donc DEPUIS L'APPLICATION, seule détentrice du trousseau.
//
// USAGE
//   node scripts/encrypt-payment-destinations.mjs            # constate, ne touche à rien
//   node scripts/encrypt-payment-destinations.mjs --apply    # chiffre, puis verrouille
//
// Le mode CONSTAT est le défaut. Un script qui réécrit des coordonnées de
// paiement sans qu'on l'ait demandé serait lui-même le danger.
//
// IDEMPOTENT : une ligne déjà chiffrée est laissée telle quelle. Le script peut
// donc être relancé sans risque, y compris après une interruption.
//
// ROTATION DE CLÉ — le jour venu, ce même script sert :
//   1. ajouter la nouvelle clé au trousseau, SANS retirer l'ancienne ;
//   2. passer FIELD_ENCRYPTION_ACTIVE_KEY à la nouvelle ;
//   3. relancer avec --rotate : les valeurs encore chiffrées par l'ancienne clé
//      sont déchiffrées puis rechiffrées avec la nouvelle ;
//   4. SEULEMENT ALORS retirer l'ancienne clé.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import pg from 'pg';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const lire = (nom) => {
  const trouve = new RegExp(`^${nom}="?([^"\\n]+)"?`, 'm').exec(env);
  return trouve?.[1];
};

// L'environnement l'emporte sur le fichier : c'est ce qui permet d'essayer le
// script sur une COPIE de la base avant de le lancer sur la vraie, comme le
// promoteur l'a exigé pour toute opération touchant aux données financières.
const url = process.env.DATABASE_URL ?? lire('DATABASE_URL');
const trousseauBrut = lire('FIELD_ENCRYPTION_KEYS');
const cleActive = lire('FIELD_ENCRYPTION_ACTIVE_KEY');

if (!url || !trousseauBrut || !cleActive) {
  console.error(
    'DATABASE_URL, FIELD_ENCRYPTION_KEYS et FIELD_ENCRYPTION_ACTIVE_KEY sont requis dans .env',
  );
  process.exit(1);
}

// Le trousseau, sous la même forme que FieldEncryptionService — délibérément
// réimplémenté ici plutôt qu'importé : le service est en TypeScript et vit dans
// le processus Nest. Les deux implémentations partagent un FORMAT, pas du code,
// et le format est figé par les tests.
const trousseau = new Map();
for (const entree of trousseauBrut.split(',')) {
  const separateur = entree.indexOf(':');
  trousseau.set(
    entree.slice(0, separateur).trim(),
    Buffer.from(entree.slice(separateur + 1).trim(), 'hex'),
  );
}

const chiffrer = (clair) => {
  const cle = trousseau.get(cleActive);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cle, iv);
  const chiffre = Buffer.concat([cipher.update(clair, 'utf8'), cipher.final()]);
  return [
    cleActive,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    chiffre.toString('base64url'),
  ].join('.');
};

const dechiffrer = (valeur) => {
  const [id, iv, sceau, chiffre] = valeur.split('.');
  const cle = trousseau.get(id);
  if (!cle) throw new Error(`Clé « ${id} » absente du trousseau.`);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    cle,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(sceau, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(chiffre, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

const estChiffre = (valeur) => {
  const parts = String(valeur ?? '').split('.');
  return parts.length === 4 && trousseau.has(parts[0]);
};

// Même masque que `payout-journal.ts` : quatre derniers chiffres de toute suite
// longue, libellé lisible intact.
const masquer = (valeur) =>
  !valeur
    ? '—'
    : valeur.replace(/\d{5,}/g, (chiffres) => `••••${chiffres.slice(-4)}`);

const mode = process.argv.includes('--rotate')
  ? 'rotate'
  : process.argv.includes('--apply')
    ? 'apply'
    : 'constat';

const client = new pg.Client({ connectionString: url });
await client.connect();

const TABLES = [
  { table: 'AmbassadorPaymentDetail', source: 'destinationLabel' },
  { table: 'PayoutRequest', source: 'destinationLabel' },
];

console.log(`Trousseau : ${[...trousseau.keys()].join(', ')} — active « ${cleActive} »`);
console.log(`Mode : ${mode}`);
console.log('');

let aTraiter = 0;

for (const { table, source } of TABLES) {
  // La colonne source existe-t-elle encore ? Après le verrouillage final elle
  // aura disparu, et le script doit le dire plutôt que d'échouer.
  const { rows: colonnes } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [table, source],
  );
  const sourceExiste = colonnes.length > 0;

  const { rows } = await client.query(
    `SELECT id, ${sourceExiste ? `"${source}",` : ''} "destinationEncrypted", "destinationMasked"
       FROM "${table}"`,
  );

  let chiffrees = 0;
  let rotees = 0;
  let intactes = 0;

  for (const ligne of rows) {
    const dejaChiffre = estChiffre(ligne.destinationEncrypted);

    if (mode === 'rotate') {
      if (!dejaChiffre) continue;
      const [id] = ligne.destinationEncrypted.split('.');
      if (id === cleActive) {
        intactes++;
        continue;
      }
      const clair = dechiffrer(ligne.destinationEncrypted);
      await client.query(
        `UPDATE "${table}" SET "destinationEncrypted" = $1 WHERE id = $2`,
        [chiffrer(clair), ligne.id],
      );
      rotees++;
      continue;
    }

    if (dejaChiffre) {
      intactes++;
      continue;
    }

    if (!sourceExiste) {
      console.error(
        `  ${table}/${ligne.id} : ni valeur chiffrée ni colonne source. Ligne ignorée.`,
      );
      continue;
    }

    const clair = ligne[source];
    aTraiter++;
    if (mode === 'constat') continue;

    await client.query(
      `UPDATE "${table}"
          SET "destinationEncrypted" = $1, "destinationMasked" = $2
        WHERE id = $3`,
      [chiffrer(clair), masquer(clair), ligne.id],
    );
    chiffrees++;
  }

  console.log(
    `${table} : ${rows.length} ligne(s) — ${chiffrees} chiffrée(s), ${rotees} réécrite(s), ${intactes} déjà à jour`,
  );
}

if (mode === 'constat') {
  console.log('');
  console.log(`${aTraiter} ligne(s) à chiffrer. Relancer avec --apply pour le faire.`);
  await client.end();
  process.exit(0);
}

if (mode === 'apply') {
  // VERROUILLAGE. Les colonnes deviennent obligatoires, et la colonne en clair
  // disparaît. Cette dernière étape est celle qui compte : tant que le clair
  // subsiste quelque part, le chiffrement n'est qu'une couche de peinture.
  console.log('');
  console.log('Verrouillage : colonnes obligatoires, colonne en clair supprimée…');

  for (const { table, source } of TABLES) {
    const { rows: manquantes } = await client.query(
      `SELECT count(*)::int AS n FROM "${table}"
        WHERE "destinationEncrypted" IS NULL OR "destinationMasked" IS NULL`,
    );
    if (manquantes[0].n > 0) {
      console.error(
        `  ABANDON : ${manquantes[0].n} ligne(s) de ${table} sans valeur chiffrée. Rien n'est verrouillé.`,
      );
      await client.end();
      process.exit(1);
    }

    await client.query(
      `ALTER TABLE "${table}"
         ALTER COLUMN "destinationEncrypted" SET NOT NULL,
         ALTER COLUMN "destinationMasked"    SET NOT NULL`,
    );
    await client.query(
      `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${source}"`,
    );
    console.log(`  ${table} : verrouillée, colonne en clair supprimée.`);
  }
}

console.log('');
console.log('Terminé.');
await client.end();
