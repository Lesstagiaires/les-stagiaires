// ============================================================================
// RECETTE DU CHIFFREMENT DES COORDONNEES DE PAIEMENT — CONTRE L'API REELLE.
//
// Exigence du promoteur du 2026-08-04 : « les coordonnees de paiement doivent
// beneficier exactement du meme niveau de protection que les documents sensibles
// du Coffre-fort numerique : chiffrees au repos ; les cles jamais stockees avec
// les donnees ; le dechiffrement possible seulement par les services qui en ont
// reellement besoin ; l'acces journalise ; toute consultation tracable ; toute
// tentative d'acces non autorisee journalisee. »
//
// CE QUE CE SCRIPT VERIFIE, ET QUE LES TESTS UNITAIRES NE PEUVENT PAS VOIR :
//   - la valeur en BASE est reellement illisible ;
//   - aucune reponse d'API ne rend le numero complet, sauf la porte prevue ;
//   - cette porte exige un motif de la liste controlee ;
//   - chaque lecture laisse une trace d'audit nominative ;
//   - un non-ADMIN ne peut pas l'ouvrir.
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/chiffrement-coordonnees.mjs
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

// Lecture DIRECTE en base, hors application : c'est le seul moyen de verifier ce
// qui y dort reellement. Un attaquant qui vole un vidage de base voit exactement
// ceci.
const sql = (requete) =>
  execFileSync(
    'docker',
    [
      'exec',
      'les-stagiaires-mvp-postgres-1',
      'psql',
      '-U',
      'stagiaires',
      '-d',
      'stagiaires',
      '-tAc',
      requete,
    ],
    { encoding: 'utf8' },
  ).trim();

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const NUMERO = `6774${String(Date.now()).slice(-5)}`;
const admin = await connecter(ADMIN);
const ambassadeur = await connecter(AMBASSADEUR);
say(`Jetons — ADMIN: ${admin ? 'oui' : 'NON'} / AMBASSADEUR: ${ambassadeur ? 'oui' : 'NON'}`);

// --- 1. Ce qui dort en base --------------------------------------------------
step(1, 'La valeur en base est illisible');

// Le signalement eventuel d'une execution precedente est leve pour permettre
// l'enregistrement.
sql(
  `UPDATE "AmbassadorPaymentDetail" SET "reportedAt"=NULL, "clearedAt"=NULL WHERE "ambassadorId"='amb_demo'`,
);

const enregistrement = await call('PUT', '/ambassadors/me/payment-details', ambassadeur, {
  method: 'MOBILE_MONEY',
  destinationLabel: `MTN MoMo — Recette chiffrement ${NUMERO}`,
});
check('coordonnees enregistrees', enregistrement.status === 200, `(HTTP ${enregistrement.status}) ${JSON.stringify(enregistrement.body)}`);
if (enregistrement.status !== 200) process.exit(1);

const enBase = sql(
  `SELECT "destinationEncrypted" FROM "AmbassadorPaymentDetail" WHERE "ambassadorId"='amb_demo'`,
);
const masqueEnBase = sql(
  `SELECT "destinationMasked" FROM "AmbassadorPaymentDetail" WHERE "ambassadorId"='amb_demo'`,
);
say(`   en base   : ${enBase.slice(0, 46)}…`);
say(`   masque    : ${masqueEnBase}`);

// LE CONTROLE CENTRAL. Un vidage de base vole ne doit rien apprendre.
check('AUCUN numero complet dans la colonne chiffree', !enBase.includes(NUMERO));
check('la valeur porte l_identifiant de sa cle (rotation possible)', enBase.startsWith('v1.'));
check('la forme masquee est stockee a cote', masqueEnBase.includes('••••'));
check('la forme masquee ne contient pas le numero complet', !masqueEnBase.includes(NUMERO));

const colonneClaire = sql(
  `SELECT count(*) FROM information_schema.columns WHERE table_name='AmbassadorPaymentDetail' AND column_name='destinationLabel'`,
);
// Tant que le clair subsiste quelque part, le chiffrement n'est qu'une couche de
// peinture.
check('la colonne en clair a DISPARU du schema', colonneClaire === '0');

const demandesEnClair = sql(
  `SELECT count(*) FROM information_schema.columns WHERE table_name='PayoutRequest' AND column_name='destinationLabel'`,
);
check('idem sur les demandes de versement', demandesEnClair === '0');

// --- 2. Aucune reponse d_API ne rend le clair --------------------------------
step(2, 'Aucune reponse d_API ne rend le numero complet');

const miennes = await call('GET', '/ambassadors/me/payment-details', ambassadeur);
check(
  'l_ambassadeur ne recoit que la forme masquee',
  miennes.status === 200 && !JSON.stringify(miennes.body).includes(NUMERO),
);

const listeVersements = await call('GET', '/ambassadors/payouts', admin);
check(
  'la liste des versements ne contient aucun numero complet',
  !JSON.stringify(listeVersements.body).includes(NUMERO),
);

const historiqueCoordonnees = await call(
  'GET',
  '/ambassadors/amb_demo/payment-details/history',
  admin,
);
check(
  'l_historique des coordonnees non plus',
  !JSON.stringify(historiqueCoordonnees.body).includes(NUMERO),
);

// --- 3. La porte, et ce qu_elle exige ----------------------------------------
step(3, 'La seule porte qui rend le clair exige un motif');

const sansMotif = await call('POST', '/ambassadors/amb_demo/payment-details/reveal', admin, {
  reason: 'Preparation du virement mensuel de l_ambassadeur.',
});
check('lecture refusee sans motif', sansMotif.status === 400, `(HTTP ${sansMotif.status})`);

const motifInvente = await call('POST', '/ambassadors/amb_demo/payment-details/reveal', admin, {
  purpose: 'PARCE_QUE',
  reason: 'Motif hors de la liste controlee.',
});
check('motif hors liste refuse', motifInvente.status === 400);

const motifTechnique = await call('POST', '/ambassadors/amb_demo/payment-details/reveal', admin, {
  purpose: 'KEY_ROTATION',
  reason: 'Tentative d_invoquer un motif technique depuis le back-office.',
});
// Personne ne doit pouvoir demander une lecture en se reclamant d'une rotation
// de cle : ce motif n'appartient qu'au script de rotation.
check('motif technique refuse depuis le back-office', motifTechnique.status === 400, `(HTTP ${motifTechnique.status})`);

const parAmbassadeur = await call(
  'POST',
  '/ambassadors/amb_demo/payment-details/reveal',
  ambassadeur,
  { purpose: 'PAYOUT_EXECUTION', reason: 'Un ambassadeur tente de lire en clair.' },
);
check('lecture refusee a un non-ADMIN', parAmbassadeur.status === 403, `(HTTP ${parAmbassadeur.status})`);

const anonyme = await call('POST', '/ambassadors/amb_demo/payment-details/reveal', null, {
  purpose: 'PAYOUT_EXECUTION',
  reason: 'Tentative sans jeton.',
});
check('lecture refusee sans jeton', anonyme.status === 401);

// --- 4. La lecture legitime, et sa trace -------------------------------------
step(4, 'Une lecture legitime rend le clair ET laisse une trace');

const avant = Number(
  sql(
    `SELECT count(*) FROM "AuditLog" WHERE action='AMBASSADOR_PAYMENT_DETAILS_DECRYPTED'`,
  ),
);

const lecture = await call('POST', '/ambassadors/amb_demo/payment-details/reveal', admin, {
  purpose: 'PAYOUT_EXECUTION',
  reason: 'Preparation du virement mensuel — recette automatisee.',
});
check('lecture acceptee avec un motif recevable', lecture.status === 200, `(HTTP ${lecture.status})`);
check(
  'et elle rend bien le numero complet',
  String(lecture.body?.destinationLabel ?? '').includes(NUMERO),
);

const apres = Number(
  sql(
    `SELECT count(*) FROM "AuditLog" WHERE action='AMBASSADOR_PAYMENT_DETAILS_DECRYPTED'`,
  ),
);
check('la lecture a produit UNE entree d_audit', apres === avant + 1, `(${avant} -> ${apres})`);

const derniere = sql(
  `SELECT metadata::text FROM "AuditLog" WHERE action='AMBASSADOR_PAYMENT_DETAILS_DECRYPTED' ORDER BY "createdAt" DESC LIMIT 1`,
);
check('la trace porte le motif invoque', derniere.includes('PAYOUT_EXECUTION'));
check('la trace porte le contexte ecrit', derniere.includes('recette automatisee'));
// Un journal qui recopierait ce qu'il protege n'aurait aucun sens.
check('la trace ne contient PAS la valeur lue', !derniere.includes(NUMERO));

const auteur = sql(
  `SELECT COALESCE("userId",'(nul)') FROM "AuditLog" WHERE action='AMBASSADOR_PAYMENT_DETAILS_DECRYPTED' ORDER BY "createdAt" DESC LIMIT 1`,
);
check('la trace est nominative', auteur !== '(nul)', `(auteur=${auteur})`);

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
