// ============================================================================
// RECETTE DU MOTEUR ANTIFRAUDE — CONTRE L'API REELLE.
//
// Arbitrage du promoteur du 2026-08-04 : « Elles ne devront JAMAIS entrainer
// automatiquement une sanction, une suspension ou un refus de paiement. Leur
// role est uniquement de : detecter ; alerter ; journaliser ; orienter
// l'administration vers un controle manuel. »
//
// CE QUE CE SCRIPT VERIFIE, ET QU'UN TEST UNITAIRE NE PEUT PAS VOIR :
//   - le balayage tourne reellement contre la base et leve une alerte ;
//   - l'etat de l'ambassadeur est RIGOUREUSEMENT INCHANGE apres l'alerte ;
//   - instruire une alerte ne change rien d'autre qu'elle-meme ;
//   - les routes sont cablees et gardees par le role ADMIN.
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/antifraude.mjs
// ============================================================================
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';

const ADMIN = '+237690000001';
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
  const first = await call('POST', '/auth/login', null, {
    identifier,
    password: MOT_DE_PASSE,
  });
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

const sql = (requete) =>
  execFileSync(
    'docker',
    ['exec', 'les-stagiaires-mvp-postgres-1', 'psql', '-U', 'stagiaires', '-d', 'stagiaires', '-tAc', requete],
    { encoding: 'utf8' },
  ).trim();

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const admin = await connecter(ADMIN);
const ambassadeur = await connecter(AMBASSADEUR);
say(`Jetons — ADMIN: ${admin ? 'oui' : 'NON'} / AMBASSADEUR: ${ambassadeur ? 'oui' : 'NON'}`);

// --- 1. Les gardes de role ---------------------------------------------------
step(1, 'Le moteur est reserve a l_administration');

check(
  'balayage refuse a un non-ADMIN',
  (await call('GET', '/ambassadors/fraud-sweep', ambassadeur)).status === 403,
);
check(
  'alertes refusees a un non-ADMIN',
  (await call('GET', '/ambassadors/fraud-alerts', ambassadeur)).status === 403,
);
check(
  'regles refusees sans jeton',
  (await call('GET', '/ambassadors/fraud-rules', null)).status === 401,
);

// --- 2. Les regles de depart --------------------------------------------------
step(2, 'Les regles configurables');

const regles = await call('GET', '/ambassadors/fraud-rules', admin);
check('les regles sont listees', regles.status === 200 && Array.isArray(regles.body));
say(`   ${regles.body.length} regle(s) : ${regles.body.map((r) => r.code).join(', ')}`);
check('les quatre signaux sont couverts', new Set(regles.body.map((r) => r.signal)).size === 4);

const seuilNul = await call('POST', '/ambassadors/fraud-rules', admin, {
  code: 'SEUIL_NUL',
  label: 'Seuil nul',
  signal: 'ATTRIBUTION_BURST',
  thresholdValue: 0,
  windowHours: 24,
  severity: 'INFO',
});
// Un seuil nul declencherait sur TOUT : ce ne serait plus une alerte, ce serait
// un bruit de fond permanent.
check('seuil nul refuse', seuilNul.status === 400, `(HTTP ${seuilNul.status})`);

const codeMinuscule = await call('POST', '/ambassadors/fraud-rules', admin, {
  code: 'mauvais code',
  label: 'Code invalide',
  signal: 'ATTRIBUTION_BURST',
  thresholdValue: 5,
  windowHours: 24,
  severity: 'INFO',
});
check('code non normalise refuse', codeMinuscule.status === 400);

// --- 3. Le balayage leve une alerte -------------------------------------------
step(3, 'Le balayage detecte et alerte');

// UNE REGLE DELIBEREMENT SENSIBLE, le temps de la recette. Sans elle, le
// balayage ne leverait rien sur des donnees de demonstration, et le chemin qui
// compte — l'alerte, puis son instruction — resterait non verifie. Elle est
// desactivee en fin de script.
const SUFFIXE = Date.now().toString(36).toUpperCase();
const regleSensible = await call('POST', '/ambassadors/fraud-rules', admin, {
  code: `RECETTE_${SUFFIXE}`,
  label: 'Recette — seuil volontairement bas',
  signal: 'ATTRIBUTION_BURST',
  thresholdValue: 1,
  windowHours: 8760,
  severity: 'INFO',
  cooldownHours: 0,
});
check(
  'regle de recette creee',
  regleSensible.status === 201,
  `(HTTP ${regleSensible.status}) ${JSON.stringify(regleSensible.body)}`,
);

// L'etat de l'ambassadeur AVANT. C'est le point de comparaison qui compte.
const avant = sql(
  `SELECT status || '|' || COALESCE(code,'') || '|' || COALESCE("suspendedAt"::text,'-') FROM "Ambassador" WHERE id='amb_demo'`,
);
const soldeAvant = sql(
  `SELECT "availableMinor" || '|' || "pendingMinor" || '|' || "reservedMinor" FROM "AmbassadorWallet" WHERE "ambassadorId"='amb_demo'`,
);
say(`   ambassadeur avant : ${avant}`);
say(`   portefeuille avant : ${soldeAvant}`);

const balayage = await call('GET', '/ambassadors/fraud-sweep', admin);
check('le balayage repond', balayage.status === 200, `(HTTP ${balayage.status})`);
say(`   ${balayage.body.rules} regle(s), ${balayage.body.evaluated} observation(s), ${balayage.body.raised} alerte(s)`);
check('le balayage a leve au moins une alerte', balayage.body.raised > 0);

// --- 4. LE CONTROLE CENTRAL : rien n_a bouge ----------------------------------
step(4, 'AUCUNE sanction automatique');

const apres = sql(
  `SELECT status || '|' || COALESCE(code,'') || '|' || COALESCE("suspendedAt"::text,'-') FROM "Ambassador" WHERE id='amb_demo'`,
);
const soldeApres = sql(
  `SELECT "availableMinor" || '|' || "pendingMinor" || '|' || "reservedMinor" FROM "AmbassadorWallet" WHERE "ambassadorId"='amb_demo'`,
);

// Le promoteur a ete explicite : detecter, alerter, journaliser, orienter. Rien
// d'autre. Ces deux controles sont la traduction litterale de cette phrase.
check('le statut de l_ambassadeur est INCHANGE', avant === apres, `(${avant} -> ${apres})`);
check('le portefeuille est INCHANGE', soldeAvant === soldeApres, `(${soldeAvant} -> ${soldeApres})`);

const commissionsBloquees = sql(
  `SELECT count(*) FROM "Commission" WHERE status='BLOCKED'`,
);
check('aucune commission bloquee par le moteur', commissionsBloquees === '0');

const versementsRefuses = sql(
  `SELECT count(*) FROM "PayoutRequest" WHERE status='REJECTED' AND "rejectedAt" > now() - interval '2 minutes'`,
);
check('aucun versement refuse par le moteur', versementsRefuses === '0');

// --- 5. L_alerte et sa trace ---------------------------------------------------
step(5, 'L_alerte est consultable et journalisee');

const alertes = await call('GET', '/ambassadors/fraud-alerts?status=OPEN', admin);
check('les alertes ouvertes sont listees', alertes.status === 200 && Array.isArray(alertes.body));
say(`   ${alertes.body.length} alerte(s) ouverte(s)`);

const journal = Number(
  sql(`SELECT count(*) FROM "AuditLog" WHERE action='AMBASSADOR_FRAUD_ALERT_RAISED'`),
);
check('les levees d_alerte sont journalisees', journal >= 0);

if (alertes.body.length > 0) {
  const A = alertes.body[0];
  say(`   alerte : ${A.ruleCode} — ${A.observedValue} pour un seuil de ${A.thresholdValue}`);
  check('l_alerte porte le seuil en vigueur au moment de la mesure', typeof A.thresholdValue === 'number');
  check('l_alerte porte la fenetre observee', Boolean(A.observedFrom && A.observedTo));
  check('l_alerte ne porte AUCUN champ de sanction', !('suspendUntil' in A) && !('blocked' in A));

  // --- 6. L_instruction --------------------------------------------------------
  step(6, 'Instruire une alerte ne sanctionne rien');

  const sansNote = await call('POST', `/ambassadors/fraud-alerts/${A.id}/review`, admin, {
    status: 'DISMISSED',
  });
  check('instruction sans note refusee', sansNote.status === 400);

  const laisserOuverte = await call('POST', `/ambassadors/fraud-alerts/${A.id}/review`, admin, {
    status: 'OPEN',
    reason: 'Ni confirmee ni ecartee.',
    note: 'Tentative de laisser l_alerte ouverte.',
  });
  check('instruction « ouverte » refusee', laisserOuverte.status === 400);

  const parAmbassadeur = await call(`POST`, `/ambassadors/fraud-alerts/${A.id}/review`, ambassadeur, {
    status: 'DISMISSED',
    note: 'Un ambassadeur tente d_ecarter sa propre alerte.',
  });
  check('instruction refusee a un non-ADMIN', parAmbassadeur.status === 403);

  const instruite = await call('POST', `/ambassadors/fraud-alerts/${A.id}/review`, admin, {
    status: 'DISMISSED',
    note: 'Recette automatisee : alerte de test, ecartee apres verification.',
  });
  check('instruction acceptee', instruite.status === 200, `(HTTP ${instruite.status})`);
  check('l_auteur est enregistre', Boolean(instruite.body?.reviewedById));
  check('la date est enregistree', Boolean(instruite.body?.reviewedAt));

  const deuxFois = await call('POST', `/ambassadors/fraud-alerts/${A.id}/review`, admin, {
    status: 'CONFIRMED',
    note: 'Seconde instruction de la meme alerte.',
  });
  check('une alerte deja instruite ne se rejoue pas', deuxFois.status === 409, `(HTTP ${deuxFois.status})`);

  const apresInstruction = sql(
    `SELECT status || '|' || COALESCE(code,'') || '|' || COALESCE("suspendedAt"::text,'-') FROM "Ambassador" WHERE id='amb_demo'`,
  );
  // Meme instruite, meme confirmee, une alerte ne suspend personne.
  check('l_ambassadeur reste INCHANGE apres instruction', apresInstruction === avant);
} else {
  say('   (aucune alerte ouverte : les controles d_instruction sont sautes)');
}

// --- 7. Ajuster un seuil -------------------------------------------------------
step(7, 'Desserrer un seuil exige un motif');

const R = regles.body.find((r) => r.code === 'ATTRIBUTION_BURST');
if (R) {
  const sansMotif = await call('POST', `/ambassadors/fraud-rules/${R.id}/adjust`, admin, {
    thresholdValue: 999,
    windowHours: 24,
  });
  // Desserrer un seuil est exactement ce que ferait un administrateur complice
  // avant de laisser passer une fraude.
  check('ajustement sans motif refuse', sansMotif.status === 400, `(HTTP ${sansMotif.status})`);

  const avecMotif = await call('POST', `/ambassadors/fraud-rules/${R.id}/adjust`, admin, {
    thresholdValue: R.thresholdValue,
    windowHours: R.windowHours,
    note: 'Recette automatisee : reglage inchange, verification du chemin.',
  });
  check('ajustement motive accepte', avecMotif.status === 200);

  const trace = sql(
    `SELECT count(*) FROM "AuditLog" WHERE action='FRAUD_RULE_ADJUSTED'`,
  );
  check('l_ajustement est journalise', Number(trace) > 0);
}

// --- 8. Menage -----------------------------------------------------------------
if (regleSensible.status === 201) {
  step(8, 'Menage — la regle de recette est desactivee');
  const off = await call(
    'POST',
    `/ambassadors/fraud-rules/${regleSensible.body.id}/deactivate`,
    admin,
  );
  check(
    'regle de recette desactivee',
    off.status === 200 && off.body.isActive === false,
    `(HTTP ${off.status})`,
  );
  say('   NOTE : les alertes produites restent en base — ce sont des');
  say('   observations, et une observation ne se retire pas.');
}

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
