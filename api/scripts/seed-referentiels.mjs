#!/usr/bin/env node
// ============================================================================
// ALIMENTATION DU RÉFÉRENTIEL DE RECHERCHE
//
// Recommandation n°1 du rapport de sécurité du chantier recherche
// (`docs/rapport-securite-recherche.md`, R3) : sans compétences ni métiers,
// 60 des 100 points du barème valent zéro pour toutes les offres, et la
// recherche par pertinence ne se distingue pas d'un tri par date.
//
// IDEMPOTENT. Une entrée dont le code existe déjà est laissée TELLE QUELLE :
// relancer ce script ne réécrase jamais un libellé corrigé depuis le
// back-office. C'est ce qui permet de le rejouer après un ajout au fichier de
// données sans craindre d'effacer le travail de quelqu'un.
//
// CE SCRIPT NE SUPPRIME RIEN. Retirer une entrée du fichier de données ne la
// retire pas de la base — il faut la désactiver depuis le back-office. Une
// compétence citée par mille profils ne peut pas disparaître sans les rendre
// incohérents, et `onDelete: Restrict` l'interdit d'ailleurs en base.
//
// USAGE
//   node scripts/seed-referentiels.mjs           # constate, n'écrit rien
//   node scripts/seed-referentiels.mjs --apply   # crée ce qui manque
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { FAMILLES, METIERS, COMPETENCES, SYNONYMES } from './referentiel-donnees.mjs';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url =
  process.env.DATABASE_URL ?? /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];

const appliquer = process.argv.includes('--apply');

// La MÊME normalisation que `query-expansion.ts`. Si les deux divergent, un
// synonyme écrit ici ne sera jamais retrouvé par la recherche — panne
// silencieuse par excellence : la table est pleine, et rien ne remonte.
function normaliser(brut) {
  return brut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const compte = { familles: 0, metiers: 0, competences: 0, synonymes: 0 };
const ignores = [];

// --- 1. Les familles de métiers ---------------------------------------------
//
// D'abord, parce que les métiers s'y rattachent.
const idParCodeMetier = new Map();

for (const famille of [...FAMILLES, ...METIERS]) {
  const existant = await client.query(
    'SELECT id FROM "Occupation" WHERE code = $1',
    [famille.code],
  );
  if (existant.rowCount > 0) {
    idParCodeMetier.set(famille.code, existant.rows[0].id);
    continue;
  }

  // Un métier dont la famille est absente serait orphelin : on le signale
  // plutôt que de l'écrire à la racine, ce qui en ferait silencieusement une
  // quinzième famille.
  const parentId = famille.parent ? idParCodeMetier.get(famille.parent) : null;
  if (famille.parent && !parentId) {
    ignores.push(`${famille.code} : famille « ${famille.parent} » introuvable`);
    continue;
  }

  const id = randomUUID();
  if (appliquer) {
    await client.query(
      `INSERT INTO "Occupation"
         (id, code, "parentId", "labelFr", "labelEn", "labelEs", "labelAr", "labelPt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [
        id,
        famille.code,
        parentId,
        famille.labelFr,
        famille.labelEn,
        famille.labelEs,
        famille.labelAr,
        famille.labelPt,
      ],
    );
  }
  idParCodeMetier.set(famille.code, id);
  if (famille.parent) compte.metiers++;
  else compte.familles++;
}

// --- 2. Les compétences ------------------------------------------------------
const idParCodeCompetence = new Map();

for (const competence of COMPETENCES) {
  const existant = await client.query('SELECT id FROM "Skill" WHERE code = $1', [
    competence.code,
  ]);
  if (existant.rowCount > 0) {
    idParCodeCompetence.set(competence.code, existant.rows[0].id);
    continue;
  }

  const id = randomUUID();
  if (appliquer) {
    await client.query(
      `INSERT INTO "Skill"
         (id, code, "labelFr", "labelEn", "labelEs", "labelAr", "labelPt", category, "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [
        id,
        competence.code,
        competence.labelFr,
        competence.labelEn,
        competence.labelEs,
        competence.labelAr,
        competence.labelPt,
        competence.category ?? null,
      ],
    );
  }
  idParCodeCompetence.set(competence.code, id);
  compte.competences++;
}

// --- 3. Les synonymes --------------------------------------------------------
//
// En dernier : ils référencent les compétences et les métiers.
const dejaVus = new Set();

for (const synonyme of SYNONYMES) {
  const terme = normaliser(synonyme.terme);
  if (!terme) {
    ignores.push(`« ${synonyme.terme} » : ne contient aucun caractère comparable`);
    continue;
  }

  // Deux entrées du fichier peuvent se normaliser pareil (« RH » et « R.H. »).
  // La contrainte d'unicité les refuserait ; autant le dire ici, où l'on peut
  // nommer le doublon.
  if (dejaVus.has(terme)) {
    ignores.push(`« ${synonyme.terme} » : doublon de normalisation (« ${terme} »)`);
    continue;
  }
  dejaVus.add(terme);

  const existant = await client.query(
    'SELECT id FROM "SearchSynonym" WHERE "termNormalized" = $1',
    [terme],
  );
  if (existant.rowCount > 0) continue;

  const skillId = synonyme.skill ? idParCodeCompetence.get(synonyme.skill) : null;
  const occupationId = synonyme.occupation
    ? idParCodeMetier.get(synonyme.occupation)
    : null;

  // Un rattachement vers un code inexistant serait une clef étrangère morte.
  if (synonyme.skill && !skillId) {
    ignores.push(`« ${synonyme.terme} » : compétence « ${synonyme.skill} » introuvable`);
    continue;
  }
  if (synonyme.occupation && !occupationId) {
    ignores.push(`« ${synonyme.terme} » : métier « ${synonyme.occupation} » introuvable`);
    continue;
  }

  if (appliquer) {
    await client.query(
      `INSERT INTO "SearchSynonym"
         (id, "termNormalized", canonical, "skillId", "occupationId")
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), terme, synonyme.canonical, skillId, occupationId],
    );
  }
  compte.synonymes++;
}

// --- Compte rendu ------------------------------------------------------------
console.log('');
console.log(`  Familles de métiers  : ${compte.familles}`);
console.log(`  Métiers              : ${compte.metiers}`);
console.log(`  Compétences          : ${compte.competences}`);
console.log(`  Synonymes            : ${compte.synonymes}`);

if (ignores.length > 0) {
  console.log('');
  console.log(`  ${ignores.length} entrée(s) ignorée(s) :`);
  for (const raison of ignores) console.log(`    — ${raison}`);
}

console.log('');
console.log(
  appliquer
    ? 'Écrit en base. Tout est modifiable depuis le back-office ADMIN (/search-admin).'
    : 'Constat seul, rien n’a été écrit. Relancer avec --apply pour créer ce qui manque.',
);
await client.end();
