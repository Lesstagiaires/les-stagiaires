#!/usr/bin/env node
// ============================================================================
// ESSAI RÉEL D'ENVOI DE SMS
//
// Les tests automatisés prouvent que l'adaptateur se comporte correctement face
// à chaque réponse possible — mais ils simulent l'API. Ils ne peuvent pas dire
// si VOS identifiants fonctionnent, ni si Africa's Talking dessert le numéro
// que vous visez. Cet essai-là ne se remplace pas.
//
// USAGE
//   node scripts/essai-sms.mjs +237690000000
//
// Renseignez d'abord dans .env :
//   SMS_PROVIDER="africastalking"
//   AFRICASTALKING_USERNAME="sandbox"     (ou votre nom d'application)
//   AFRICASTALKING_API_KEY="..."
//
// AU BAC À SABLE, LE SMS N'ARRIVE SUR AUCUN TÉLÉPHONE. Il s'affiche dans le
// simulateur : https://simulator.africastalking.com:1517/ — connectez-y le même
// numéro que celui passé en argument, sinon vous ne verrez rien et vous
// conclurez à tort à un échec.
//
// AUCUN CODE OTP RÉEL N'EST ENVOYÉ ICI : le message est un texte d'essai fixe.
// Un script de diagnostic n'a pas à fabriquer de secret.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(racine, '.env'), 'utf8')
    .split('\n')
    .map((ligne) => /^([A-Z_]+)="?([^"\n]*)"?/.exec(ligne))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const destinataire = process.argv[2];
if (!destinataire || !/^\+[1-9]\d{6,14}$/.test(destinataire)) {
  console.error(
    'Usage : node scripts/essai-sms.mjs +237690000000\n' +
      'Le numéro doit être au format E.164 — indicatif pays compris, avec le +.',
  );
  process.exit(1);
}

const username = process.env.AFRICASTALKING_USERNAME ?? env.AFRICASTALKING_USERNAME;
const apiKey = process.env.AFRICASTALKING_API_KEY ?? env.AFRICASTALKING_API_KEY;
const senderId = process.env.AFRICASTALKING_SENDER_ID ?? env.AFRICASTALKING_SENDER_ID;

if (!username || !apiKey) {
  console.error(
    'AFRICASTALKING_USERNAME et AFRICASTALKING_API_KEY doivent être renseignés dans .env.',
  );
  process.exit(1);
}

// Même déduction que l'adaptateur : le bac à sable impose le nom `sandbox`.
const bacASable = username === 'sandbox';
const endpoint = bacASable
  ? 'https://api.sandbox.africastalking.com/version1/messaging'
  : 'https://api.africastalking.com/version1/messaging';

const masque = destinataire.slice(0, -4).replace(/./g, '*') + destinataire.slice(-4);

console.log('');
console.log(`  Environnement : ${bacASable ? 'BAC À SABLE' : 'PRODUCTION — SMS RÉEL, FACTURÉ'}`);
console.log(`  Adresse       : ${endpoint}`);
console.log(`  Destinataire  : ${masque}`);
console.log(`  Expéditeur    : ${senderId ?? '(numéro court par défaut)'}`);
console.log('');

const reponse = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apiKey,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
  body: new URLSearchParams({
    username,
    to: destinataire,
    message: 'LES STAGIAIRES — essai de configuration. Aucune action requise.',
    ...(senderId ? { from: senderId } : {}),
  }).toString(),
  signal: AbortSignal.timeout(15_000),
}).catch((cause) => {
  console.error(`  ÉCHEC — opérateur injoignable : ${cause.name}`);
  process.exit(1);
});

if (!reponse.ok) {
  console.error(`  ÉCHEC — HTTP ${reponse.status}.`);
  console.error(
    reponse.status === 401
      ? '  Identifiants refusés. Vérifiez que la clé correspond bien à ce nom d’utilisateur,\n' +
          '  et que vous n’utilisez pas une clé de production avec le nom « sandbox ».'
      : '  Consultez le tableau de bord Africa’s Talking.',
  );
  process.exit(1);
}

const corps = await reponse.json();
const destinataires = corps?.SMSMessageData?.Recipients ?? [];

// LE VERDICT EST ICI, PAS DANS LE CODE HTTP. C'est tout l'intérêt de cet essai :
// reproduire le contrôle que fait l'adaptateur, pour que ce que vous voyez ici
// soit exactement ce que verra l'application.
const SUCCES = new Set([100, 101, 102]);
if (destinataires.length === 0) {
  console.error('  ÉCHEC — aucun destinataire retenu. Numéro probablement hors format.');
  process.exit(1);
}

let toutBon = true;
for (const d of destinataires) {
  const ok = SUCCES.has(d.statusCode);
  if (!ok) toutBon = false;
  console.log(`  ${ok ? 'OK  ' : 'ÉCHEC'} statut ${d.statusCode} — ${d.status}`);
}

console.log('');
if (toutBon && bacASable) {
  console.log('  Message accepté. Ouvrez le simulateur pour le voir :');
  console.log('  https://simulator.africastalking.com:1517/');
  console.log(`  (connectez-y le numéro ${destinataire})`);
} else if (toutBon) {
  console.log('  Message accepté et remis à l’opérateur.');
} else {
  console.log('  Le message N’EST PAS parti. Le code HTTP était pourtant un succès —');
  console.log('  c’est exactement le piège que l’adaptateur intercepte.');
  process.exit(1);
}
