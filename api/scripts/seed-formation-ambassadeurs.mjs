#!/usr/bin/env node
// ============================================================================
// CHARGEMENT DE LA FORMATION DES AMBASSADEURS
//
// Sans modules ni questions, `TrainingModule` et `QuizQuestion` sont vides, et
// aucun ambassadeur ne peut être activé : le code refuse correctement, mais le
// parcours entier est inutilisable. C'est du contenu manquant, pas un défaut de
// code — et c'est ce que ce script comble.
//
// IDEMPOTENT. Un module dont le code existe déjà, dans sa version active, est
// laissé TEL QUEL. Relancer ce script ne réécrase jamais un contenu corrigé
// depuis le back-office. Pour faire évoluer un module existant, passer par
// `supersedeModule()` : c'est ce qui préserve l'historique et rend caduques les
// progressions de l'ancienne version.
//
// TROIS REFUS AVANT ÉCRITURE. Le quiz est la porte qui garde l'activation ; un
// quiz mal formé la laisserait ouverte sans que rien ne le signale :
//   — moins de trois questions par module : le seuil de 80 % deviendrait
//     absurde (deux questions sur trois font 66 %, trois sur trois font 100 %) ;
//   — toutes les bonnes réponses au même rang : on passe sans lire ;
//   — un `correctIndex` hors des choix proposés : question impossible à réussir.
//
// USAGE
//   node scripts/seed-formation-ambassadeurs.mjs           # constate
//   node scripts/seed-formation-ambassadeurs.mjs --apply   # crée ce qui manque
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MODULES, QUESTIONS } from './formation-ambassadeurs-donnees.mjs';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url =
  process.env.DATABASE_URL ?? /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];

const appliquer = process.argv.includes('--apply');

// --- Contrôles avant toute écriture ------------------------------------------
const anomalies = [];

for (const module of MODULES) {
  const questions = QUESTIONS.filter((q) => q.module === module.code);
  if (questions.length < 3) {
    anomalies.push(
      `${module.code} : ${questions.length} question(s). Le seuil de 80 % n'a pas de sens en dessous de trois.`,
    );
  }
  for (const question of questions) {
    if (
      !Array.isArray(question.choices) ||
      question.choices.length < 2 ||
      question.correctIndex < 0 ||
      question.correctIndex >= question.choices.length
    ) {
      anomalies.push(
        `${module.code} : « ${question.prompt.slice(0, 50)}… » a un correctIndex hors des choix.`,
      );
    }
  }
}

// Le rang des bonnes réponses doit être réparti. Si toutes tombaient au même
// endroit, le quiz se réussirait en cochant toujours la même colonne — la porte
// serait ouverte sans que rien ne le signale.
const parRang = new Map();
for (const question of QUESTIONS) {
  parRang.set(question.correctIndex, (parRang.get(question.correctIndex) ?? 0) + 1);
}
const rangDominant = Math.max(...parRang.values());
if (rangDominant > QUESTIONS.length * 0.5) {
  anomalies.push(
    `${rangDominant} bonnes réponses sur ${QUESTIONS.length} au même rang : le quiz se réussirait sans lire.`,
  );
}

if (anomalies.length > 0) {
  console.error('');
  console.error('Contenu refusé — le quiz garde l’activation d’un ambassadeur :');
  for (const anomalie of anomalies) console.error(`  — ${anomalie}`);
  console.error('');
  process.exit(1);
}

// --- Écriture ------------------------------------------------------------------
const client = new pg.Client({ connectionString: url });
await client.connect();

const idParCode = new Map();
let modulesCrees = 0;
let questionsCreees = 0;

for (const module of MODULES) {
  const existant = await client.query(
    'SELECT id FROM "TrainingModule" WHERE code = $1 AND "isActive" = true',
    [module.code],
  );
  if (existant.rowCount > 0) {
    idParCode.set(module.code, existant.rows[0].id);
    continue;
  }

  const id = randomUUID();
  if (appliquer) {
    await client.query(
      `INSERT INTO "TrainingModule" (id, code, title, body, "sortOrder", "updatedAt")
       VALUES ($1,$2,$3,$4,$5, now())`,
      [id, module.code, module.title, module.body, module.sortOrder],
    );
  }
  idParCode.set(module.code, id);
  modulesCrees++;
}

for (const question of QUESTIONS) {
  const moduleId = idParCode.get(question.module);
  if (!moduleId) {
    console.error(`Module « ${question.module} » introuvable — question ignorée.`);
    continue;
  }

  const existante = await client.query(
    'SELECT id FROM "QuizQuestion" WHERE "moduleId" = $1 AND prompt = $2',
    [moduleId, question.prompt],
  );
  if (existante.rowCount > 0) continue;

  if (appliquer) {
    await client.query(
      `INSERT INTO "QuizQuestion" (id, "moduleId", prompt, choices, "correctIndex", "updatedAt")
       VALUES ($1,$2,$3,$4,$5, now())`,
      [randomUUID(), moduleId, question.prompt, question.choices, question.correctIndex],
    );
  }
  questionsCreees++;
}

console.log('');
console.log(`  Modules de formation : ${modulesCrees}`);
console.log(`  Questions de quiz    : ${questionsCreees}`);
console.log('');
console.log(
  `  Répartition des bonnes réponses : ${[...parRang.entries()]
    .sort()
    .map(([rang, n]) => `rang ${rang} → ${n}`)
    .join(', ')}`,
);
console.log('');
console.log(
  appliquer
    ? 'Écrit en base. Pour faire évoluer un module, utiliser le back-office (supersedeModule) — jamais ce script.'
    : 'Constat seul, rien n’a été écrit. Relancer avec --apply.',
);

await client.end();
