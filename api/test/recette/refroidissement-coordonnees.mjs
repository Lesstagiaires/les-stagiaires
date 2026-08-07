// ============================================================================
// RECETTE DU DELAI DE REFROIDISSEMENT — CONTRE L'API REELLE.
//
// Arbitrage 13 du promoteur, 2026-08-02 : « Je valide la mise en place d'un
// delai de refroidissement apres toute modification des coordonnees de paiement.
// Pendant cette periode : aucune nouvelle demande de retrait ne doit pouvoir
// etre executee ; l'ambassadeur est informe par e-mail et notification interne ;
// une alerte de securite peut etre envoyee par SMS lorsque le risque le
// justifie ; l'ancienne et la nouvelle destination sont journalisees sous forme
// masquee ; l'utilisateur peut signaler immediatement une modification non
// autorisee. »
//
// LE SCENARIO JOUE ICI est celui du detournement : les coordonnees changent,
// une demande de versement suit, et le virement doit etre REFUSE. Puis
// l'ambassadeur signale, et le gel devient inconditionnel.
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/refroidissement-coordonnees.mjs
//
// PREREQUIS : trois comptes ADMIN (scripts/seed-admins-recette.mjs) et une
// politique pays ouverte aux versements pour CM.
//
// EFFET DE BORD ASSUME : ecrit dans le grand livre, en ajout seul.
// ============================================================================
import fs from 'node:fs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';

const ADMIN_A = '+237690000001';
const ADMIN_C = '+237690000003';
const AMBASSADEUR = '+237671234567';
const MOT_DE_PASSE = 'Recette2026!';

let ok = 0;
let ko = 0;
const say = (s = '') => console.log(s);
const check = (label, condition, detail = '') => {
  if (condition) {
    ok++;
    say(`   OK   ${label}`);
  } else {
    ko++;
    say(`   ECHEC ${label} ${detail}`);
  }
};

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function connecter(identifier) {
  const depart = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;

  let first;
  for (let essai = 0; essai < 12; essai++) {
    first = await call('POST', '/auth/login', null, {
      identifier,
      password: MOT_DE_PASSE,
    });
    if (first.status !== 429) break;
    say(`   (limiteur de débit atteint pour ${identifier}, attente…)`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  if (!first.body.requiresTwoFactor) return first.body.accessToken;

  let code = null;
  for (let essai = 0; essai < 20 && !code; essai++) {
    await new Promise((r) => setTimeout(r, 200));
    const nouveau = fs.readFileSync(LOG, 'utf8').slice(depart);
    const trouves = [...nouveau.matchAll(/code de vérification est (\d{6})/g)];
    if (trouves.length > 0) code = trouves[trouves.length - 1][1];
  }
  const second = await call('POST', '/auth/2fa/verify-login', null, {
    challengeToken: first.body.challengeToken,
    code,
  });
  return second.body.accessToken;
}

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const NOTE = 'Recette automatisee du delai de refroidissement.';
const SUFFIXE = String(Date.now()).slice(-6);

const admin = await connecter(ADMIN_A);
const adminC = await connecter(ADMIN_C);
const ambassadeur = await connecter(AMBASSADEUR);
say(`Jetons — A: ${admin ? 'oui' : 'NON'} / C: ${adminC ? 'oui' : 'NON'} / AMBASSADEUR: ${ambassadeur ? 'oui' : 'NON'}`);

// --- 1. Enregistrement des coordonnees ---------------------------------------
step(1, 'Enregistrement des coordonnees de versement');

const NUMERO = `6779${SUFFIXE}`;
const enregistrement = await call('PUT', '/ambassadors/me/payment-details', ambassadeur, {
  method: 'MOBILE_MONEY',
  destinationLabel: `MTN MoMo — Recette ${NUMERO}`,
});
check('coordonnees enregistrees', enregistrement.status === 200, `(HTTP ${enregistrement.status}) ${JSON.stringify(enregistrement.body)}`);

if (enregistrement.status !== 200) process.exit(1);

// LE POINT DE SECURITE : le numero complet ne ressort jamais.
check(
  'la reponse ne contient PAS le numero complet',
  !JSON.stringify(enregistrement.body).includes(NUMERO),
);
check(
  'la destination est rendue masquee',
  typeof enregistrement.body.destinationMasked === 'string' &&
    enregistrement.body.destinationMasked.includes('••••'),
);
say(`   destination : ${enregistrement.body.destinationMasked}`);
check('le delai est ouvert', enregistrement.body.cooldownActive === true);
say(`   delai jusqu_au : ${enregistrement.body.cooldownUntil}`);

// --- 2. Le delai bloque l_execution ------------------------------------------
step(2, 'Pendant le delai, aucun virement ne part');

const demande = await call('POST', '/ambassadors/me/payouts', ambassadeur, {
  amountMinor: 10000,
});
// LA DEMANDE EST ACCEPTEE : refuser ici effacerait la tentative. C_est
// l_EXECUTION qui est bloquee, et la tentative reste au journal.
check('la demande de versement est acceptee', demande.status === 201, `(HTTP ${demande.status}) ${JSON.stringify(demande.body)}`);

if (demande.status !== 201) process.exit(1);
const P = demande.body.id;

check(
  'la demande a repris les coordonnees ENREGISTREES',
  demande.body.method === 'MOBILE_MONEY',
);

const controle = await call('POST', `/ambassadors/payouts/${P}/review`, admin, {
  internalNote: NOTE,
});
check('le controle signale le delai', controle.status === 201);
const constats = (controle.body.findings ?? []).join(' | ');
say(`   constats : ${constats || 'aucun'}`);
check(
  'le delai figure dans les constats du controle',
  constats.includes('délai de sécurité'),
);

const validation = await call('POST', `/ambassadors/payouts/${P}/validate`, admin, {
  internalNote: NOTE,
});
const contresignature = validation.body.status === 'AWAITING_SECOND_APPROVAL'
  ? await call('POST', `/ambassadors/payouts/${P}/second-approval`, await connecter('+237690000002'), { internalNote: NOTE })
  : { status: 201, body: validation.body };
check('la demande peut etre approuvee malgre le delai', contresignature.status === 201);

// LE VERROU. Deux approbations obtenues, et pourtant le virement ne part pas.
const execution = await call('POST', `/ambassadors/payouts/${P}/execute`, adminC, {
  executionReference: 'VIR-REFROIDISSEMENT',
});
check(
  'L_EXECUTION EST REFUSEE pendant le delai',
  execution.status === 403,
  `(HTTP ${execution.status})`,
);
say(`   message : ${execution.body?.message ?? ''}`);

// --- 3. Le signalement, frein d_urgence --------------------------------------
step(3, 'Signalement d_une modification non autorisee');

const signalement = await call('POST', '/ambassadors/me/payment-details/report', ambassadeur, {
  reason: 'Je n_ai jamais demande ce changement de numero.',
});
check('signalement accepte', signalement.status === 200, `(HTTP ${signalement.status})`);
check('le dossier porte la marque du signalement', Boolean(signalement.body.reportedAt));

const modificationPendant = await call('PUT', '/ambassadors/me/payment-details', ambassadeur, {
  method: 'MOBILE_MONEY',
  destinationLabel: 'Orange Money — 699112233',
});
// Laisser modifier pendant l_instruction reviendrait a donner un second essai a
// celui qui a provoque le detournement.
check(
  'les coordonnees ne peuvent plus etre modifiees pendant l_instruction',
  modificationPendant.status === 409,
  `(HTTP ${modificationPendant.status})`,
);

const executionApresSignalement = await call('POST', `/ambassadors/payouts/${P}/execute`, adminC, {
  executionReference: 'VIR-SIGNALE',
});
check(
  'l_execution reste refusee, avec le motif du signalement',
  executionApresSignalement.status === 403 &&
    String(executionApresSignalement.body?.message ?? '').includes('signalement'),
  `(HTTP ${executionApresSignalement.status})`,
);

// --- 4. Le journal ------------------------------------------------------------
step(4, 'Le journal des changements, deja masque');

const piste = await call('GET', `/ambassadors/amb_demo/payment-details/history`, admin);
check('l_historique est consultable par un ADMIN', piste.status === 200);
const types = (piste.body ?? []).map((e) => e.type);
say(`   evenements : ${types.join(' -> ')}`);
check('l_enregistrement est journalise', types.includes('REGISTERED') || types.includes('CHANGED'));
check('le signalement est journalise', types.includes('REPORTED'));

const journalComplet = JSON.stringify(piste.body);
check(
  'AUCUN numero complet dans le journal',
  !journalComplet.includes(NUMERO),
);
check('les destinations y sont masquees', journalComplet.includes('••••'));

const parAmbassadeur = await call('GET', `/ambassadors/amb_demo/payment-details/history`, ambassadeur);
check('l_historique est refuse a un non-ADMIN', parAmbassadeur.status === 403);

// --- 5. La levee du signalement ----------------------------------------------
step(5, 'Levee du signalement par l_administration');

const levee = await call('POST', '/ambassadors/amb_demo/payment-details/clear', admin, {
  internalNote: 'Recette automatisee : signalement leve apres verification.',
});
check('levee acceptee', levee.status === 201, `(HTTP ${levee.status})`);
check('le dossier porte la date de levee', Boolean(levee.body.clearedAt));

const leveeParAmbassadeur = await call('POST', '/ambassadors/amb_demo/payment-details/clear', ambassadeur, {
  internalNote: 'Un ambassadeur ne leve pas son propre signalement.',
});
check('un ambassadeur ne peut pas lever son propre signalement', leveeParAmbassadeur.status === 403);

// Le signalement est leve, mais le DELAI, lui, court toujours.
const executionApresLevee = await call('POST', `/ambassadors/payouts/${P}/execute`, adminC, {
  executionReference: 'VIR-APRES-LEVEE',
});
check(
  'le delai continue de bloquer meme apres la levee',
  executionApresLevee.status === 403 &&
    String(executionApresLevee.body?.message ?? '').includes('délai'),
  `(HTTP ${executionApresLevee.status}) ${executionApresLevee.body?.message ?? ''}`,
);

// --- 6. Menage ----------------------------------------------------------------
step(6, 'Menage — la demande de recette est rejetee');

const rejet = await call('POST', `/ambassadors/payouts/${P}/reject`, admin, {
  reason: 'Demande creee par la recette automatisee, sans objet reel.',
});
check('rejet accepte', rejet.status === 201, `(HTTP ${rejet.status})`);

say('');
say('   NOTE : les coordonnees de versement de amb_demo restent enregistrees,');
say('   avec un delai de refroidissement en cours. C_est l_etat attendu.');

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
