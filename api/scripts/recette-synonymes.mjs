// ============================================================================
// RECETTE RÉELLE DE L'EXPANSION PAR SYNONYMES
//
// Contre la vraie base, avec un vrai jeu d'essai, nettoyé à la fin.
//
// POURQUOI PAS SEULEMENT DES TESTS UNITAIRES. Trois choses ne se voient qu'ici :
//   — le SQL s'exécute-t-il ? (`ANY($1)`, un paramètre NULL dans
//     websearch_to_tsquery : le typage TypeScript n'en dit rien) ;
//   — l'expansion trouve-t-elle réellement ce qu'elle prétend trouver ?
//   — une injection dans le terme de recherche fait-elle quelque chose ?
//
// Le SQL ci-dessous est celui de `matchKeywords()`, avec les mêmes paramètres
// positionnels dans le même ordre que ce que produit le gabarit Prisma.
// ============================================================================
import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const ORG = 'cms5njqmc000928v932d8qyau';
const PREFIXE = 'rec_syn_';
const STATUTS = ['ACTIVE'];

let echecs = 0;
function verifier(nom, condition, detail) {
  if (condition) {
    console.log(`  OK     ${nom}`);
  } else {
    echecs++;
    console.log(`  ECHEC  ${nom} — ${detail}`);
  }
}

async function nettoyer() {
  await client.query(`DELETE FROM "OpportunitySkill" WHERE id LIKE $1 OR "opportunityId" LIKE $1`, [`${PREFIXE}%`]);
  await client.query(`DELETE FROM "Opportunity" WHERE id LIKE $1`, [`${PREFIXE}%`]);
  await client.query(`DELETE FROM "SearchSynonym" WHERE id LIKE $1`, [`${PREFIXE}%`]);
  await client.query(`DELETE FROM "Skill" WHERE id LIKE $1`, [`${PREFIXE}%`]);
  await client.query(`DELETE FROM "Occupation" WHERE id LIKE $1`, [`${PREFIXE}%`]);
}

// --- Jeu d'essai ------------------------------------------------------------
await nettoyer();

await client.query(
  `INSERT INTO "Skill" (id, code, "labelFr","labelEn","labelEs","labelAr","labelPt","updatedAt")
   VALUES ($1,'REC_JAVASCRIPT','JavaScript','JavaScript','JavaScript','جافاسكريبت','JavaScript',now())`,
  [`${PREFIXE}js`],
);

const offres = [
  // Le mot « RH » n'apparaît nulle part : seul le synonyme peut la trouver.
  [`${PREFIXE}a`, 'Charge de ressources humaines', 'Gestion du personnel et paie.', 'ACTIVE'],
  // Ni « JS » ni « JavaScript » dans le texte : seul le RÉFÉRENTIEL peut la trouver.
  [`${PREFIXE}b`, 'Stage integration front', 'Interfaces et composants.', 'ACTIVE'],
  // Un brouillon, qui ne doit JAMAIS remonter.
  [`${PREFIXE}c`, 'Charge de ressources humaines (brouillon)', 'Non publiee.', 'DRAFT'],
];
for (const [id, titre, description, statut] of offres) {
  await client.query(
    `INSERT INTO "Opportunity" (id,"organizationId",title,description,type,sector,country,city,status,"publishedAt","updatedAt")
     VALUES ($1,$2,$3,$4,'ACADEMIC_INTERNSHIP','Services','CM','Douala',$5::"OpportunityStatus",now(),now())`,
    [id, ORG, titre, description, statut],
  );
}
await client.query(
  `INSERT INTO "OpportunitySkill" (id,"opportunityId","skillId",required) VALUES ($1,$2,$3,true)`,
  [`${PREFIXE}os1`, `${PREFIXE}b`, `${PREFIXE}js`],
);
await client.query(
  `INSERT INTO "SearchSynonym" (id,"termNormalized",canonical,"skillId")
   VALUES ($1,'js','JavaScript',$2)`,
  [`${PREFIXE}s1`, `${PREFIXE}js`],
);
await client.query(
  `INSERT INTO "SearchSynonym" (id,"termNormalized",canonical) VALUES ($1,'rh','ressources humaines')`,
  [`${PREFIXE}s2`],
);

// --- La requête, telle qu'elle est dans matchKeywords() ---------------------
const SQL = `
  SELECT id FROM "Opportunity"
   WHERE status::text = ANY($1)
     AND ("searchVector" @@ websearch_to_tsquery('french', $2)
       OR similarity("title", $2) > 0.25
       OR similarity("city", $2) > 0.35
       OR ($3::text IS NOT NULL
           AND "searchVector" @@ websearch_to_tsquery('french', $3)))
   LIMIT 500
`;
const texte = async (terme, elargi) =>
  (await client.query(SQL, [STATUTS, terme, elargi])).rows.map((r) => r.id);

const REFERENTIEL = `
  SELECT o.id FROM "Opportunity" o
   WHERE o.status::text = ANY($1)
     AND EXISTS (SELECT 1 FROM "OpportunitySkill" s
                  WHERE s."opportunityId" = o.id AND s."skillId" = ANY($2))
   LIMIT 500
`;
const parReferentiel = async (skillIds) =>
  (await client.query(REFERENTIEL, [STATUTS, skillIds])).rows.map((r) => r.id);

// --- Les vérifications ------------------------------------------------------
console.log('\n1. L’EXPANSION SERT-ELLE À QUELQUE CHOSE ?\n');

const sansExpansion = await texte('rh', null);
verifier(
  '« rh » seul ne trouve rien — c’est le problème qu’on corrige',
  sansExpansion.length === 0,
  `attendu 0, obtenu ${sansExpansion.length}`,
);

const avecExpansion = await texte('rh', 'ressources humaines');
verifier(
  '« rh » élargi en « ressources humaines » trouve l’offre',
  avecExpansion.includes(`${PREFIXE}a`),
  `obtenu [${avecExpansion.join(', ')}]`,
);

console.log('\n2. LE RÉFÉRENTIEL TROUVE-T-IL CE QUE LE TEXTE NE DIT PAS ?\n');

const parTexteJs = await texte('js', 'javascript');
verifier(
  '« js » ne trouve PAS l’offre par le texte (elle ne contient pas le mot)',
  !parTexteJs.includes(`${PREFIXE}b`),
  `obtenu [${parTexteJs.join(', ')}]`,
);

const parSkill = await parReferentiel([`${PREFIXE}js`]);
verifier(
  '« js » trouve l’offre par la COMPÉTENCE rattachée',
  parSkill.includes(`${PREFIXE}b`),
  `obtenu [${parSkill.join(', ')}]`,
);

console.log('\n3. LE BROUILLON RESTE-T-IL INVISIBLE ?\n');

verifier(
  'le brouillon ne remonte pas malgré un titre qui correspond',
  !avecExpansion.includes(`${PREFIXE}c`),
  `obtenu [${avecExpansion.join(', ')}]`,
);

console.log('\n4. L’EXPANSION PEUT-ELLE RÉDUIRE LES RÉSULTATS ?\n');

const large = await texte('ressources humaines', null);
const largeElargi = await texte('ressources humaines', 'personnel or paie');
verifier(
  'élargir ne retire jamais un résultat',
  large.every((id) => largeElargi.includes(id)),
  `sans [${large.join(', ')}] vs avec [${largeElargi.join(', ')}]`,
);

console.log('\n5. LE SQL RÉSISTE-T-IL À CE QU’ON LUI ENVOIE ?\n');

const hostiles = [
  ['terme vide', '', null],
  ['expansion vide', 'stage', ''],
  ["syntaxe websearch de l'utilisateur", '"stage web" -senior', null],
  ["injection dans le terme", `'; DROP TABLE "Opportunity"; --`, null],
  ["injection dans l'expansion", 'stage', `') OR 1=1 --`],
  ['terme de 120 caracteres', 'a'.repeat(120), null],
];
for (const [nom, terme, elargi] of hostiles) {
  try {
    await texte(terme, elargi);
    verifier(nom, true);
  } catch (erreur) {
    verifier(nom, false, erreur.message.split('\n')[0]);
  }
}

const { rows: intacte } = await client.query(
  `SELECT count(*)::int AS n FROM "Opportunity"`,
);
verifier(
  'la table "Opportunity" existe toujours après les injections',
  intacte[0].n === offres.length,
  `attendu ${offres.length}, obtenu ${intacte[0].n}`,
);

// --- Nettoyage --------------------------------------------------------------
await nettoyer();
const { rows: reste } = await client.query(
  `SELECT count(*)::int AS n FROM "Opportunity" WHERE id LIKE $1`,
  [`${PREFIXE}%`],
);
verifier('le jeu d’essai est retiré', reste[0].n === 0, `il reste ${reste[0].n}`);

console.log(
  echecs === 0 ? '\n  TOUT EST VERT\n' : `\n  ${echecs} ÉCHEC(S)\n`,
);
await client.end();
process.exit(echecs === 0 ? 0 : 1);
