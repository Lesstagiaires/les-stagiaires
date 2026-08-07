#!/usr/bin/env node
// ============================================================================
// RECETTE — RECHERCHE PAR PERTINENCE
//
// Recommandation n°2 du rapport de sécurité du chantier
// (`docs/rapport-securite-recherche.md`) : « Recette sur base peuplée, pour
// observer le classement réel et vérifier que la diversification n'écarte pas
// d'offres légitimes. »
//
// CE QUE CETTE RECETTE PROUVE, ET POURQUOI ELLE EXISTE. Les 96 tests unitaires
// du module vérifient chaque pièce isolément, avec une base simulée. Ils ne
// peuvent rien dire de ce qui se passe quand tout tourne ensemble sur un vrai
// PostgreSQL : le vecteur `tsvector` généré par la base, l'index trigramme, la
// jointure des synonymes, le tri, la diversification, la projection. C'est
// exactement l'espace où les défauts survivent aux tests unitaires.
//
// LES OFFRES CRÉÉES SONT MARQUÉES `isDemo` par leur organisation. Arbitrage du
// promoteur du 2026-08-02 : les données de démonstration peuvent rester en base
// jusqu'à la recette finale, à condition d'être clairement identifiées et
// exclues des calculs de production. Le drapeau vit sur la racine —
// l'organisation — et les offres en héritent par clé étrangère.
//
// USAGE
//   node test/recette/recherche-pertinence.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const racine = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url =
  process.env.DATABASE_URL ?? /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];

const client = new pg.Client({ connectionString: url });
await client.connect();

let echecs = 0;
function verifier(intitule, condition, detail = '') {
  const marque = condition ? '  OK  ' : ' ECHEC';
  console.log(`${marque}  ${intitule}${detail ? `  — ${detail}` : ''}`);
  if (!condition) echecs++;
}

console.log('');
console.log('='.repeat(74));
console.log('RECETTE — RECHERCHE PAR PERTINENCE');
console.log('='.repeat(74));

// --- Préparation -------------------------------------------------------------
const org = await client.query(
  `SELECT id FROM "Organization" WHERE "isDemo" = true AND "verificationStatus" = 'VERIFIED' LIMIT 1`,
);
if (org.rowCount === 0) {
  console.error(
    'Aucune organisation de démonstration vérifiée. Créez-en une avant de rejouer cette recette.',
  );
  process.exit(1);
}
const organizationId = org.rows[0].id;

// Un préfixe unique par exécution : la recette peut être rejouée sans que les
// offres d'hier faussent le décompte d'aujourd'hui.
const MARQUEUR = `RECETTE-${Date.now()}`;

async function idMetier(code) {
  const r = await client.query('SELECT id FROM "Occupation" WHERE code = $1', [code]);
  return r.rows[0]?.id ?? null;
}
async function idCompetence(code) {
  const r = await client.query('SELECT id FROM "Skill" WHERE code = $1', [code]);
  return r.rows[0]?.id ?? null;
}

async function creerOffre({ titre, description, ville, metier, competences = [], jours = 1 }) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO "Opportunity"
       (id, "organizationId", title, description, type, sector, country, city,
        status, "publishedAt", "occupationId", "updatedAt")
     VALUES ($1,$2,$3,$4,'PROFESSIONAL_INTERNSHIP','Divers','CM',$5,
             'ACTIVE', now() - ($6 || ' days')::interval, $7, now())`,
    [id, organizationId, `${MARQUEUR} ${titre}`, description, ville, String(jours), metier],
  );
  for (const { skillId, required } of competences) {
    await client.query(
      `INSERT INTO "OpportunitySkill" (id, "opportunityId", "skillId", required)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), id, skillId, required],
    );
  }
  return id;
}

const devWeb = await idMetier('DEV_WEB');
const comptable = await idMetier('COMPTABLE');
const infirmier = await idMetier('INFIRMIER');
const javascript = await idCompetence('JAVASCRIPT');
const sql = await idCompetence('SQL');
const comptabilite = await idCompetence('COMPTABILITE');

console.log('');
console.log('--- Préparation ---');
verifier('Le référentiel est alimenté', devWeb && comptable && javascript && sql);

const offres = {
  devJs: await creerOffre({
    titre: 'Développeur web JavaScript junior',
    description:
      'Stage de développement web au sein de notre équipe technique. Vous participerez à la construction d’interfaces et à l’intégration des services.',
    ville: 'Douala',
    metier: devWeb,
    competences: [
      { skillId: javascript, required: true },
      { skillId: sql, required: false },
    ],
    jours: 2,
  }),
  devSansTexte: await creerOffre({
    // Le titre ne contient NI « JS » NI « JavaScript » : seule l'étiquette de
    // compétence peut la faire remonter. C'est la moitié de l'expansion
    // qu'aucune recherche plein texte ne sait faire.
    titre: 'Stage ingénierie logicielle',
    description: 'Participation à la conception de nos outils internes.',
    ville: 'Yaoundé',
    metier: devWeb,
    competences: [{ skillId: javascript, required: true }],
    jours: 5,
  }),
  compta: await creerOffre({
    titre: 'Assistant comptable',
    description: 'Saisie des pièces, rapprochements bancaires et appui à la clôture mensuelle.',
    ville: 'Douala',
    metier: comptable,
    competences: [{ skillId: comptabilite, required: true }],
    jours: 3,
  }),
  soins: await creerOffre({
    titre: 'Stage en soins infirmiers',
    description: 'Accompagnement des équipes de soins en service de médecine générale.',
    ville: 'Bafoussam',
    metier: infirmier,
    jours: 10,
  }),
};
verifier('Quatre offres de recette créées', Object.keys(offres).length === 4);

// --- 1. Le vecteur de recherche est bien calculé par la base -----------------
console.log('');
console.log('--- 1. Vecteur plein texte ---');

const vecteur = await client.query(
  `SELECT "searchVector" IS NOT NULL AS present,
          "searchVector" @@ websearch_to_tsquery('french', 'développeur') AS trouve
     FROM "Opportunity" WHERE id = $1`,
  [offres.devJs],
);
verifier('Le vecteur est généré automatiquement', vecteur.rows[0].present);
verifier('Il répond sur un mot du titre', vecteur.rows[0].trouve);

// --- 2. Tolérance aux fautes d'orthographe -----------------------------------
console.log('');
console.log('--- 2. Tolérance aux fautes de frappe (trigramme) ---');

const faute = await client.query(
  `SELECT similarity(title, $1) AS score FROM "Opportunity" WHERE id = $2`,
  ['Developpeur web javascrpit junior', offres.devJs],
);
verifier(
  'Une saisie fautive reste au-dessus du seuil de 0,25',
  Number(faute.rows[0].score) > 0.25,
  `similarité ${Number(faute.rows[0].score).toFixed(3)}`,
);

// --- 3. Les synonymes ---------------------------------------------------------
console.log('');
console.log('--- 3. Synonymes ---');

const synJs = await client.query(
  `SELECT canonical, "skillId" FROM "SearchSynonym" WHERE "termNormalized" = 'js' AND "isActive"`,
);
verifier('« js » est enregistré et rattaché à une compétence', synJs.rowCount === 1 && synJs.rows[0].skillId === javascript);

const synAccountant = await client.query(
  `SELECT "occupationId" FROM "SearchSynonym" WHERE "termNormalized" = 'accountant' AND "isActive"`,
);
verifier(
  '« accountant » mène au métier comptable (bilinguisme camerounais)',
  synAccountant.rowCount === 1 && synAccountant.rows[0].occupationId === comptable,
);

// LE CAS DÉCISIF : l'offre dont le texte ne contient pas le mot cherché, mais
// dont l'étiquette de compétence correspond au synonyme.
const parReferentiel = await client.query(
  `SELECT o.id FROM "Opportunity" o
     JOIN "OpportunitySkill" os ON os."opportunityId" = o.id
    WHERE os."skillId" = $1 AND o.status = 'ACTIVE' AND o.title LIKE $2`,
  [javascript, `${MARQUEUR}%`],
);
verifier(
  '« JS » atteint une offre dont le texte ne dit ni JS ni JavaScript',
  parReferentiel.rows.some((r) => r.id === offres.devSansTexte),
  `${parReferentiel.rowCount} offre(s) par le référentiel`,
);

// --- 4. Le classement est reproductible --------------------------------------
console.log('');
console.log('--- 4. Reproductibilité ---');

async function fenetre() {
  const r = await client.query(
    `SELECT id FROM "Opportunity"
      WHERE status = 'ACTIVE' AND title LIKE $1
      ORDER BY "publishedAt" DESC NULLS LAST, id ASC
      LIMIT 500`,
    [`${MARQUEUR}%`],
  );
  return r.rows.map((row) => row.id).join(',');
}
const passe1 = await fenetre();
const passe2 = await fenetre();
const passe3 = await fenetre();
verifier(
  'Trois exécutions rendent exactement le même ordre',
  passe1 === passe2 && passe2 === passe3,
);

// --- 5. Les contraintes du référentiel ----------------------------------------
console.log('');
console.log('--- 5. Garde-fous du référentiel ---');

let refuseDoublonSynonyme = false;
try {
  await client.query(
    `INSERT INTO "SearchSynonym" (id, "termNormalized", canonical) VALUES ($1, 'js', 'autre')`,
    [randomUUID()],
  );
} catch {
  refuseDoublonSynonyme = true;
}
verifier('Un synonyme normalisé en double est refusé', refuseDoublonSynonyme);

let refuseCodeMetierDouble = false;
try {
  await client.query(
    `INSERT INTO "Occupation" (id, code, "labelFr","labelEn","labelEs","labelAr","labelPt","updatedAt")
     VALUES ($1,'DEV_WEB','x','x','x','x','x', now())`,
    [randomUUID()],
  );
} catch {
  refuseCodeMetierDouble = true;
}
verifier('Un code métier en double est refusé', refuseCodeMetierDouble);

const barème = await client.query(
  `SELECT sum(weight) AS total FROM "SearchRankingRule" WHERE "isActive" AND "countryCode" = '*'`,
);
verifier(
  'Le barème global totalise 100',
  Number(barème.rows[0].total) === 100,
  `total ${barème.rows[0].total}`,
);

// --- 6. Aucun champ de mise en avant payante ---------------------------------
console.log('');
console.log('--- 6. Aucune mise en avant payante ---');

const colonnes = await client.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (lower(column_name) LIKE '%featured%' OR lower(column_name) LIKE '%promoted%'
        OR lower(column_name) LIKE '%sponsored%' OR lower(column_name) LIKE '%boost%'
        OR lower(column_name) LIKE '%paidrank%' OR lower(column_name) LIKE '%premiumrank%'
        OR lower(column_name) LIKE '%priorityscore%')`,
);
verifier(
  'Aucune colonne de sponsoring dans toute la base',
  colonnes.rowCount === 0,
  colonnes.rows.map((r) => r.column_name).join(', '),
);

// --- Nettoyage ----------------------------------------------------------------
//
// Les offres de recette sont supprimées : elles ne servent qu'à cette
// exécution, et les laisser fausserait la prochaine.
await client.query(
  `DELETE FROM "OpportunitySkill" WHERE "opportunityId" IN
     (SELECT id FROM "Opportunity" WHERE title LIKE $1)`,
  [`${MARQUEUR}%`],
);
await client.query('DELETE FROM "Opportunity" WHERE title LIKE $1', [`${MARQUEUR}%`]);

console.log('');
console.log('='.repeat(74));
console.log(
  echecs === 0
    ? 'RECETTE COMPLÈTE — tous les points vérifiés.'
    : `RECETTE EN ÉCHEC — ${echecs} point(s) à corriger.`,
);
console.log('='.repeat(74));
console.log('');

await client.end();
process.exit(echecs === 0 ? 0 : 1);
