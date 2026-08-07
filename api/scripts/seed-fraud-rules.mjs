#!/usr/bin/env node
// ============================================================================
// RÈGLES ANTIFRAUDE DE DÉPART
//
// Quatre règles, une par signal, avec des seuils VOLONTAIREMENT PRUDENTS.
//
// Le réglage est le point délicat de tout dispositif de détection : trop serré,
// il noie l'administration sous des alertes qu'elle cesse de lire ; trop lâche,
// il ne voit rien. Comme les comportements normaux ne sont pas encore connus au
// lancement, ces valeurs sont un POINT DE DÉPART à réviser après les premières
// semaines — et c'est précisément pourquoi elles sont en base et non dans le
// code, ajustables par `POST /ambassadors/fraud-rules/:id/adjust`.
//
// Aucune de ces règles ne sanctionne. Une règle mal réglée produit du bruit,
// jamais de dégât : c'est ce qui permet de commencer prudemment sans risque.
//
// IDEMPOTENT : une règle dont le code existe déjà est laissée telle quelle —
// relancer ce script ne réécrase pas un seuil ajusté à la main.
//
// USAGE
//   node scripts/seed-fraud-rules.mjs           # constate
//   node scripts/seed-fraud-rules.mjs --apply   # crée les manquantes
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = fs.readFileSync(path.join(racine, '.env'), 'utf8');
const url =
  process.env.DATABASE_URL ??
  /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];

const REGLES = [
  {
    code: 'ATTRIBUTION_BURST',
    label: 'Rafale d’attributions',
    signal: 'ATTRIBUTION_BURST',
    // Un ambassadeur réellement actif apporte plusieurs filleuls par semaine.
    // Quinze en vingt-quatre heures n'est plus de la performance : c'est le
    // rythme d'une machine ou d'un carnet d'adresses acheté.
    thresholdValue: 15,
    windowHours: 24,
    severity: 'WARNING',
    cooldownHours: 24,
  },
  {
    code: 'COMMISSION_VOLUME_DAY',
    label: 'Volume de commissions sur 24 h',
    signal: 'COMMISSION_VOLUME',
    // 500 000 F en unités mineures. Un montant élevé n'est pas une fraude —
    // c'est une somme qui mérite qu'on regarde d'où elle vient.
    thresholdValue: 50_000_000,
    windowHours: 24,
    severity: 'WARNING',
    cooldownHours: 24,
  },
  {
    code: 'PAYOUT_AFTER_DETAILS_CHANGE',
    label: 'Retrait demandé après changement de coordonnées',
    signal: 'PAYOUT_AFTER_DETAILS_CHANGE',
    // UNE SEULE occurrence suffit, et le niveau est CRITIQUE : le délai de
    // refroidissement empêche déjà le virement de partir, mais la séquence
    // « je change le numéro, je demande le retrait » est le geste même du
    // détournement de compte. Ce qu'on veut ici, c'est le REMARQUER.
    thresholdValue: 1,
    windowHours: 72,
    severity: 'CRITICAL',
    cooldownHours: 12,
  },
  {
    code: 'REPEATED_PAYOUT_FAILURE',
    label: 'Échecs de virement répétés',
    signal: 'REPEATED_PAYOUT_FAILURE',
    // Trois échecs en une semaine : souvent des coordonnées erronées, parfois
    // un essai de destination qui n'appartient pas au titulaire.
    thresholdValue: 3,
    windowHours: 168,
    severity: 'WARNING',
    cooldownHours: 48,
  },
];

const appliquer = process.argv.includes('--apply');
const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows: existantes } = await client.query(
  'SELECT code FROM "FraudRule"',
);
const connues = new Set(existantes.map((r) => r.code));

let creees = 0;
for (const regle of REGLES) {
  if (connues.has(regle.code)) {
    console.log(`  déjà présente : ${regle.code}`);
    continue;
  }
  console.log(
    `  ${appliquer ? 'création' : 'à créer'} : ${regle.code} — plus de ${regle.thresholdValue} en ${regle.windowHours} h (${regle.severity})`,
  );
  if (!appliquer) continue;

  await client.query(
    `INSERT INTO "FraudRule"
       (id, code, label, signal, "thresholdValue", "windowHours", severity, "cooldownHours", "updatedAt")
     VALUES ($1,$2,$3,$4::"FraudSignal",$5,$6,$7::"FraudSeverity",$8, now())`,
    [
      randomUUID(),
      regle.code,
      regle.label,
      regle.signal,
      regle.thresholdValue,
      regle.windowHours,
      regle.severity,
      regle.cooldownHours,
    ],
  );
  creees++;
}

console.log('');
console.log(
  appliquer
    ? `${creees} règle(s) créée(s).`
    : 'Constat seul. Relancer avec --apply pour créer les règles manquantes.',
);
console.log(
  'Ces seuils sont un POINT DE DÉPART : à réviser après les premières semaines,',
);
console.log('depuis le back-office, avec un motif écrit.');
await client.end();
