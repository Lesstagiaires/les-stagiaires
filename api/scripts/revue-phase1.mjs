#!/usr/bin/env node
// ============================================================================
// REVUE DE LA PHASE 1 — DURCISSEMENT FINANCIER DU MODULE AMBASSADEURS
//
// Demandée par le promoteur le 2026-08-04 : « vérifier que les dix objectifs
// fixés ont bien été atteints et qu'aucune régression n'a été introduite ».
//
// CE SCRIPT NE RELIT PAS LE CODE, IL INTERROGE LA BASE. Une revue qui se
// contenterait de relire ce qu'on a écrit soi-même ne vérifie rien : elle
// confirme l'intention, pas le résultat. Ici, chaque objectif est traduit en une
// question que PostgreSQL sait trancher — le déclencheur existe-t-il, la
// contrainte est-elle posée, la colonne en clair a-t-elle disparu.
//
// USAGE
//   node scripts/revue-phase1.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url =
  process.env.DATABASE_URL ?? /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];

const client = new pg.Client({ connectionString: url });
await client.connect();

let ok = 0;
let ko = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    ok++;
    console.log(`   OK   ${label}`);
  } else {
    ko++;
    console.log(`   ECHEC ${label} ${detail}`);
  }
};

const objectif = (n, titre) => {
  console.log('');
  console.log('='.repeat(74));
  console.log(`OBJECTIF ${n} — ${titre}`);
  console.log('='.repeat(74));
};

const un = async (requete, params = []) =>
  (await client.query(requete, params)).rows[0]?.v;

const tous = async (requete, params = []) =>
  (await client.query(requete, params)).rows.map((r) => r.v);

// ---------------------------------------------------------------------------
objectif(1, 'Les journaux financiers sont en AJOUT SEUL');

const JOURNAUX = [
  'WalletTransaction',
  'AmbassadorEvent',
  'CommissionEvent',
  'PortfolioEvent',
  'PayoutEvent',
  'AmbassadorPaymentDetailEvent',
];

for (const table of JOURNAUX) {
  const declencheur = await un(
    `SELECT count(*)::int AS v FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = $1 AND NOT t.tgisinternal AND t.tgname LIKE '%append_only%'`,
    [table],
  );
  check(`${table} porte son déclencheur d'ajout seul`, declencheur > 0);
}

const auditTrigger = await un(
  `SELECT count(*)::int AS v FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('AuditLog','PartnershipEvent') AND NOT t.tgisinternal`,
);
check('AuditLog et PartnershipEvent restent protégés', auditTrigger >= 2);

// ---------------------------------------------------------------------------
objectif(2, 'L’historique financier survit à la disparition d’un compte');

// LA CHAÎNE DEPUIS User EST COUPÉE. C'est le scénario qui se produit réellement :
// suppression ou anonymisation d'un compte. Le défaut avait été démontré sur
// copie le 2026-08-02 — un DELETE détruisait deux écritures comptables.
const depuisUtilisateur = await un(
  `SELECT count(*)::int AS v FROM pg_constraint
    WHERE contype='f' AND confdeltype='c'
      AND conrelid='"Ambassador"'::regclass AND confrelid='"User"'::regclass`,
);
check(
  'supprimer un COMPTE ne détruit plus le dossier d’ambassadeur',
  depuisUtilisateur === 0,
);

const journauxProteges = await tous(
  `SELECT conrelid::regclass::text AS v FROM pg_constraint
    WHERE contype='f' AND confdeltype='c'
      AND conrelid::regclass::text IN (
        '"WalletTransaction"','"CommissionEvent"','"PortfolioEvent"',
        '"AmbassadorEvent"','"PayoutEvent"')`,
);
check(
  'aucune cascade n’atteint un journal en ajout seul',
  journauxProteges.length === 0,
  journauxProteges.join(', '),
);

// LA DETTE MAÎTRISÉE, énoncée exactement. Plusieurs clés étrangères cascadent
// encore DEPUIS Ambassador — dont deux financières, Commission et
// AmbassadorWallet. Ma note du 2026-08-02 n'en citait que deux
// (AmbassadorReferral, AmbassadorPortfolioEntry) : elle sous-estimait la portée.
//
// Elles ne sont atteignables que par une suppression PHYSIQUE d'un dossier
// d'ambassadeur — que le code métier ne fait jamais, et qu'un test interdit.
const cascadesDepuisAmbassadeur = await tous(
  `SELECT conrelid::regclass::text AS v FROM pg_constraint
    WHERE contype='f' AND confdeltype='c' AND confrelid='"Ambassador"'::regclass
    ORDER BY 1`,
);
console.log(
  `   dette connue : ${cascadesDepuisAmbassadeur.length} cascade(s) depuis Ambassador`,
);
console.log(`   ${cascadesDepuisAmbassadeur.join(', ')}`);
check(
  'le test qui interdit la suppression physique est en place',
  fs.existsSync(
    path.join(racine, 'src/ambassadors/no-physical-deletion.spec.ts'),
  ),
);

const denormalisees = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE (table_name='WalletTransaction' AND column_name='ambassadorId')
       OR (table_name='AmbassadorPortfolioEntry' AND column_name='organizationName')`,
);
check('les faits identifiants sont dénormalisés', denormalisees === 2);

// ---------------------------------------------------------------------------
objectif(3, 'L’audit porte l’ancienne et la nouvelle valeur');

const colonnesAudit = await tous(
  `SELECT column_name AS v FROM information_schema.columns WHERE table_name='AuditLog'`,
);
for (const colonne of ['changes', 'entityType', 'entityId', 'ipAddress', 'userAgent']) {
  check(`AuditLog.${colonne} existe`, colonnesAudit.includes(colonne));
}

// ---------------------------------------------------------------------------
objectif(4, 'Motifs communicables : trois niveaux, pas de texte libre en e-mail');

const motifs = await un(
  `SELECT count(*)::int AS v FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AmbassadorDecisionReason'`,
);
check(`l'énumération des motifs existe (${motifs} codes)`, motifs >= 17);

const sansMotifPublic = await un(
  `SELECT count(*)::int AS v FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname='AmbassadorDecisionReason'
      AND e.enumlabel IN ('NO_PUBLIC_REASON','NOT_DISCLOSED')`,
);
check('les deux façons de ne pas donner de motif sont distinctes', sansMotifPublic === 2);

// ---------------------------------------------------------------------------
objectif(5, 'Barèmes de commission versionnés');

const versionnage = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE table_name='CommissionRule'
      AND column_name IN ('lineageKey','version','supersedesId','fixedAmountMinor','currency')`,
);
check('la chaîne de versions et le montant fixe sont en place', versionnage === 5);

const contraintesBareme = await tous(
  `SELECT conname AS v FROM pg_constraint
    WHERE conrelid='"CommissionRule"'::regclass AND contype='c'`,
);
check(
  'un seul mode de calcul est imposé en base',
  contraintesBareme.includes('CommissionRule_one_calculation_mode'),
);
check(
  'un montant fixe exige une devise',
  contraintesBareme.includes('CommissionRule_fixed_needs_currency'),
);

const photographie = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE table_name='Commission'
      AND column_name IN ('appliedRuleLabel','appliedRuleVersion','appliedFixedAmountMinor')`,
);
check('la commission photographie la règle appliquée', photographie === 3);

// ---------------------------------------------------------------------------
objectif(6, 'Plafonds et statut de contrôle');

const statutControle = await un(
  `SELECT count(*)::int AS v FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='CommissionStatus' AND e.enumlabel='REVIEW_REQUIRED'`,
);
check('le statut REVIEW_REQUIRED existe', statutControle === 1);

const contraintesCommission = await tous(
  `SELECT conname AS v FROM pg_constraint
    WHERE conrelid='"Commission"'::regclass AND contype='c'`,
);
check(
  'une correction ne peut aller QUE vers le bas',
  contraintesCommission.includes('Commission_correction_never_upward'),
);

const portees = await un(
  `SELECT count(*)::int AS v FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='CommissionCapWindow'`,
);
check(`les quatre fenêtres de plafond existent (${portees})`, portees === 4);

// ---------------------------------------------------------------------------
objectif(7, 'Versements : séparation des pouvoirs et cycle en six étapes');

const etats = await tous(
  `SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='PayoutRequestStatus' ORDER BY e.enumsortorder`,
);
for (const etat of ['UNDER_REVIEW', 'AWAITING_SECOND_APPROVAL', 'EXECUTING', 'FAILED']) {
  check(`l'état ${etat} existe`, etats.includes(etat));
}

const separation = await tous(
  `SELECT conname AS v FROM pg_constraint
    WHERE conrelid='"PayoutRequest"'::regclass AND contype='c'`,
);
check(
  'le validateur ne peut pas exécuter',
  separation.includes('PayoutRequest_validator_is_not_executor'),
);
check(
  'le double contrôle exige deux personnes distinctes',
  separation.includes('PayoutRequest_two_distinct_approvers'),
);

const seuil = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE table_name='AmbassadorPolicy' AND column_name='doubleApprovalThresholdMinor'`,
);
check('le seuil de double contrôle est configurable par pays', seuil === 1);

// ---------------------------------------------------------------------------
objectif(8, 'Délai de refroidissement sur les coordonnées de versement');

const refroidissement = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE table_name='AmbassadorPolicy' AND column_name='paymentDetailsCooldownHours'`,
);
check('le délai est configurable par pays', refroidissement === 1);

const defaut = await un(
  `SELECT column_default AS v FROM information_schema.columns
    WHERE table_name='AmbassadorPolicy' AND column_name='paymentDetailsCooldownHours'`,
);
check('sa valeur par défaut est 72 heures', String(defaut).includes('72'), `(${defaut})`);

const signalement = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE table_name='AmbassadorPaymentDetail'
      AND column_name IN ('reportedAt','reportedReason','clearedAt','clearedById')`,
);
check('le frein d’urgence est modélisé', signalement === 4);

// ---------------------------------------------------------------------------
objectif(9, 'Coordonnées de paiement chiffrées au repos');

const enClair = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE column_name='destinationLabel'`,
);
// Tant qu'une colonne en clair subsiste, le chiffrement n'est qu'une peinture.
check('AUCUNE colonne destinationLabel en clair ne subsiste', enClair === 0);

const chiffrees = await un(
  `SELECT count(*)::int AS v FROM information_schema.columns
    WHERE column_name='destinationEncrypted'`,
);
check('les deux tables portent la colonne chiffrée', chiffrees === 2);

const nonChiffrees = await un(
  `SELECT count(*)::int AS v FROM "AmbassadorPaymentDetail"
    WHERE "destinationEncrypted" NOT LIKE 'v%.%.%.%'`,
);
check('toutes les coordonnées enregistrées sont chiffrées', nonChiffrees === 0);

const demandesNonChiffrees = await un(
  `SELECT count(*)::int AS v FROM "PayoutRequest"
    WHERE "destinationEncrypted" NOT LIKE 'v%.%.%.%'`,
);
check('toutes les demandes de versement aussi', demandesNonChiffrees === 0);

// ---------------------------------------------------------------------------
objectif(10, 'Alertes antifraude — détecter sans jamais sanctionner');

const regles = await un(`SELECT count(*)::int AS v FROM "FraudRule" WHERE "isActive"`);
check(`des règles actives existent (${regles})`, regles >= 4);

const signaux = await un(
  `SELECT count(DISTINCT signal)::int AS v FROM "FraudRule" WHERE "isActive"`,
);
check('les quatre signaux sont couverts', signaux === 4);

const contraintesRegle = await tous(
  `SELECT conname AS v FROM pg_constraint
    WHERE conrelid='"FraudRule"'::regclass AND contype='c'`,
);
check('un seuil nul est refusé', contraintesRegle.includes('FraudRule_threshold_positive'));

const contraintesAlerte = await tous(
  `SELECT conname AS v FROM pg_constraint
    WHERE conrelid='"FraudAlert"'::regclass AND contype='c'`,
);
check(
  'une alerte instruite porte forcément son auteur',
  contraintesAlerte.includes('FraudAlert_reviewed_is_attributed'),
);

// L'alerte ne doit contenir AUCUN champ capable de sanctionner.
const champsAlerte = await tous(
  `SELECT column_name AS v FROM information_schema.columns WHERE table_name='FraudAlert'`,
);
const suspects = champsAlerte.filter((c) =>
  /suspend|block|reject|sanction|freeze/i.test(c),
);
check('aucun champ de sanction sur une alerte', suspects.length === 0, suspects.join(', '));

// ---------------------------------------------------------------------------
console.log('');
console.log('='.repeat(74));
console.log('NON-RÉGRESSION');
console.log('='.repeat(74));

const migrations = await un(
  `SELECT count(*)::int AS v FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
);
const echouees = await un(
  `SELECT count(*)::int AS v FROM _prisma_migrations WHERE finished_at IS NULL`,
);
check(`${migrations} migration(s) appliquées`, migrations > 0);
check('aucune migration en échec', echouees === 0);

const demoAudit = await un(
  `SELECT count(*)::int AS v FROM "AuditLog" WHERE action = 'TEST_APPEND_ONLY'`,
);
check(
  'l’entrée de démonstration TEST_APPEND_ONLY est toujours là',
  demoAudit >= 1,
);

console.log('');
console.log('='.repeat(74));
console.log(`RESULTAT : ${ok} contrôle(s) réussi(s), ${ko} échec(s).`);
console.log('='.repeat(74));
await client.end();
process.exit(ko === 0 ? 0 : 1);
