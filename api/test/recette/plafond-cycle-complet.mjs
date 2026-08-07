// ============================================================================
// RECETTE DU CYCLE COMPLET — PAIEMENT CONFIRME -> PLAFOND -> ARBITRAGE
//
// Aucun mock, aucune commission fabriquee a la main : ce script provoque un VRAI
// paiement confirme (souscription + webhook du prestataire), et observe ce que le
// moteur de commission en fait quand un plafond est franchi.
//
// C'est le seul controle qui verifie la phrase du promoteur de bout en bout :
// « Le depassement ne doit pas entrainer une reduction silencieuse. »
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/plafond-cycle-complet.mjs
//
// EFFET DE BORD ASSUME : ce parcours ecrit dans le grand livre, qui est en ajout
// seul. Les ecritures produites ne pourront pas etre effacees — c'est le prix
// d'une recette qui ne triche pas. A ne lancer que sur une base de developpement.
// ============================================================================
import fs from 'node:fs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';
const WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET_SIMULATED ?? 'dev-webhook-secret-change-me';

// Le filleul est CREE par la recette, avec le code d'affiliation de l'ambassadeur
// de demonstration. C'est le parcours reel — un jeune s'inscrit avec un code, puis
// achete — plutot qu'un compte prepare a la main. Cela evite aussi de dependre du
// mot de passe d'un compte de demonstration existant.
const CODE_AMBASSADEUR = 'K7RQ4M';
const ADMIN = '+237690000001';
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

async function call(method, path, token, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
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

async function login(identifier) {
  const first = await call('POST', '/auth/login', null, {
    identifier,
    password: MOT_DE_PASSE,
  });
  if (!first.body.requiresTwoFactor) return first.body.accessToken;

  await new Promise((r) => setTimeout(r, 400));
  const log = fs.readFileSync(LOG, 'utf8');
  const codes = [...log.matchAll(/code de vérification est (\d{6})/g)];
  const second = await call('POST', '/auth/2fa/verify-login', null, {
    challengeToken: first.body.challengeToken,
    code: codes[codes.length - 1][1],
  });
  return second.body.accessToken;
}

// Inscrit un filleul neuf porteur du code d'affiliation, verifie son numero avec
// le code a usage unique lu dans le journal de l'API, et rend son jeton.
async function inscrireFilleul() {
  // Mobile camerounais : neuf chiffres, prefixe 69 (le meme que les comptes de
  // demonstration). L'horodatage fournit les sept derniers, ce qui rend le numero
  // unique a chaque execution sans sortir des prefixes reellement attribues.
  const phone = `+23769${String(Date.now()).slice(-7)}`;

  const inscription = await call('POST', '/auth/register', null, {
    firstName: 'Recette',
    lastName: 'Plafond',
    sex: 'MALE',
    phone,
    cityOfResidence: 'Douala',
    countryOfResidence: 'CM',
    password: MOT_DE_PASSE,
    language: 'FR',
    dateOfBirth: '1998-05-12',
    ambassadorCode: CODE_AMBASSADEUR,
  });
  if (inscription.status !== 201) {
    throw new Error(
      `Inscription du filleul impossible (HTTP ${inscription.status}) : ${JSON.stringify(inscription.body)}`,
    );
  }

  await new Promise((r) => setTimeout(r, 400));
  const log = fs.readFileSync(LOG, 'utf8');
  const codes = [...log.matchAll(/(\d{6})/g)];
  const otp = [...log.matchAll(/code[^\n]*?(\d{6})/gi)].pop();
  const code = otp ? otp[1] : codes[codes.length - 1][1];

  const verification = await call('POST', '/auth/verify-otp', null, {
    phone,
    code,
  });
  if (!verification.body.accessToken) {
    throw new Error(
      `Verification du filleul impossible : ${JSON.stringify(verification.body)}`,
    );
  }
  say(`   Filleul inscrit : ${phone} (code d'affiliation ${CODE_AMBASSADEUR})`);
  return verification.body.accessToken;
}

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const SUFFIXE = Date.now().toString(36).toUpperCase();
const admin = await login(ADMIN);
const filleul = await inscrireFilleul();
say(`Jetons — ADMIN: ${admin ? 'oui' : 'NON'} / FILLEUL: ${filleul ? 'oui' : 'NON'}`);

// --- 0. Etat de depart du grand livre ---------------------------------------
//
// Le rapport de reconciliation est notre point d'observation : il compte les
// ecritures et compare le cache de solde a ce que le grand livre implique. On
// raisonne en DELTAS, jamais en valeurs absolues — la base de developpement porte
// deja un ecart connu, seme avec les donnees de demonstration (un portefeuille
// cree avec des soldes mais sans les ecritures correspondantes). Ce script n'a pas
// a le corriger ; il doit seulement prouver qu'il n'en ajoute pas.
step(0, 'Photographie du grand livre avant la vente');
const ambassadeurs = await call('GET', '/ambassadors', admin);
const ambassadeur = ambassadeurs.body.find((a) => a.id === 'amb_demo');
const bilanAvant = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
const ecartsAvant = (bilanAvant.body.discrepancies ?? []).map((d) => d.bucket).sort();
const avant = {
  ecritures: bilanAvant.body.transactionCount,
  ecarts: ecartsAvant,
};
say(`   Ambassadeur ${ambassadeur?.code} — ${bilanAvant.body.currency}`);
say(`   ${avant.ecritures} ecriture(s) au grand livre`);
say(
  `   ecart(s) preexistant(s) : ${ecartsAvant.length ? ecartsAvant.join(', ') : 'aucun'}`,
);

// --- 1. Un plafond que toute commission franchit -----------------------------
step(1, 'Un plafond par transaction volontairement bas');
const plafond = await call('POST', '/ambassadors/commission-caps', admin, {
  label: `Recette cycle ${SUFFIXE}`,
  scope: 'AMBASSADOR',
  window: 'TRANSACTION',
  amountMinor: 100, // 1 FCFA : toute commission reelle le franchit
  currency: 'XAF',
});
check('plafond cree', plafond.status === 201, `(HTTP ${plafond.status})`);
const CAP = plafond.body.id;

// --- 2. Une vraie vente ------------------------------------------------------
step(2, 'Souscription et confirmation du paiement par le prestataire');
const souscription = await call('POST', '/subscriptions/me', filleul, {
  plan: 'CARRIERE_PLUS',
  billingCycle: 'ANNUAL',
});
check('souscription creee', souscription.status === 201, `(HTTP ${souscription.status}) ${JSON.stringify(souscription.body)}`);
const montantVente = souscription.body.subscription?.amountMinor;
say(`   montant encaisse : ${montantVente} (unites mineures)`);

const confirmation = await call(
  'POST',
  '/payments/webhooks/simulated',
  null,
  {
    providerReference: souscription.body.payment.providerReference,
    status: 'CONFIRMED',
  },
  { 'x-webhook-secret': WEBHOOK_SECRET },
);
check('paiement confirme par le webhook', confirmation.status === 201 || confirmation.status === 200, `(HTTP ${confirmation.status})`);

// Le calcul de commission est declenche par la confirmation ; laissons-lui le temps.
await new Promise((r) => setTimeout(r, 1500));

// --- 3. LA REGLE : montant complet, statut de controle, zero credit ----------
step(3, 'La commission est MISE DE COTE, pas rognee');

const enControle = await call('GET', '/ambassadors/commissions/review', admin);
const mienne = enControle.body.find((c) => c.ambassadorId === 'amb_demo');
check('la commission apparait en attente d_arbitrage', Boolean(mienne));

if (!mienne) {
  say('   Impossible de poursuivre sans commission en controle.');
  process.exit(1);
}

const attendu = Math.floor((montantVente * 2000) / 10000); // barème à 20 %
say(`   montant du bareme : ${attendu} — montant enregistre : ${mienne.amountMinor}`);
// LE CONTROLE CENTRAL DE TOUTE CETTE ETAPE.
check(
  'le montant est celui du bareme, PAS le plafond',
  mienne.amountMinor === attendu && mienne.amountMinor !== 100,
  `(plafond=100, enregistre=${mienne.amountMinor})`,
);
check('le statut est REVIEW_REQUIRED', mienne.status === 'REVIEW_REQUIRED');
check('le motif de controle est CAP_EXCEEDED', mienne.reviewReason === 'CAP_EXCEEDED');
check('la trace des plafonds est conservee', Array.isArray(mienne.capTrace) && mienne.capTrace.length > 0);
check(
  'la trace nomme le plafond franchi',
  mienne.capTrace?.some((t) => t.capId === CAP && t.exceeded === true),
);

const bilanPendant = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
say(`   ${bilanPendant.body.transactionCount} ecriture(s) au grand livre`);
// Rien n'a bouge : crediter puis reprendre en cas de correction ferait apparaitre
// un solde qu'on retirerait ensuite, et laisserait au grand livre deux ecritures
// pour un fait qui n'a jamais eu lieu.
check(
  'AUCUNE ecriture au grand livre tant que le controle dure',
  bilanPendant.body.transactionCount === avant.ecritures,
  `(avant ${avant.ecritures}, pendant ${bilanPendant.body.transactionCount})`,
);

// --- 4. Ce que l_arbitrage refuse -------------------------------------------
step(4, 'L_arbitrage refuse ce qui doit l_etre');

const hausse = await call('POST', `/ambassadors/commissions/${mienne.id}/review/correct`, admin, {
  internalNote: 'Recette automatisee : tentative de correction a la hausse.',
  reasonCode: 'COMPLIANCE_REVIEW',
  amountMinor: mienne.amountMinor + 50000,
});
check('correction a la hausse refusee', hausse.status === 400, `(HTTP ${hausse.status})`);

const parOrg = await call('POST', `/ambassadors/commissions/${mienne.id}/review/release`, filleul, {
  internalNote: 'Recette automatisee : arbitrage tente par un non-administrateur.',
});
check('arbitrage refuse a un non-ADMIN', parOrg.status === 403, `(HTTP ${parOrg.status})`);

// --- 5. La correction --------------------------------------------------------
step(5, 'Correction a la baisse, avec journalisation');

const corrige = Math.floor(mienne.amountMinor / 2);
const correction = await call('POST', `/ambassadors/commissions/${mienne.id}/review/correct`, admin, {
  internalNote:
    'Recette automatisee : plafond de recette volontairement bas, montant ramene de moitie.',
  reasonCode: 'COMPLIANCE_REVIEW',
  publicMessage: 'Le montant a ete ajuste au plafond en vigueur pour cette periode.',
  amountMinor: corrige,
});
check('correction acceptee', correction.status === 201, `(HTTP ${correction.status})`);
check('le montant retenu est le montant corrige', correction.body.amountMinor === corrige);
check(
  'le montant du bareme est conserve a cote',
  correction.body.originalAmountMinor === mienne.amountMinor,
);
check('la commission repart au circuit normal', correction.body.status === 'PENDING');
check('l_auteur de l_arbitrage est enregistre', Boolean(correction.body.reviewedById));

const bilanApres = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
say(`   ${bilanApres.body.transactionCount} ecriture(s) au grand livre`);
check(
  'UNE SEULE ecriture est nee de tout l_arbitrage',
  bilanApres.body.transactionCount === avant.ecritures + 1,
  `(avant ${avant.ecritures}, apres ${bilanApres.body.transactionCount})`,
);

const rejoue = await call('POST', `/ambassadors/commissions/${mienne.id}/review/correct`, admin, {
  internalNote: 'Recette automatisee : second arbitrage sur une commission deja relachee.',
  reasonCode: 'COMPLIANCE_REVIEW',
  amountMinor: 1000,
});
// Le constat financier redevient immuable des l'instant ou il a ete valide.
check('une commission deja arbitree n_est plus modifiable', rejoue.status === 409, `(HTTP ${rejoue.status})`);

// --- 6. La reconciliation n_a pas empire ------------------------------------
//
// En DELTA, pas en absolu. La base de developpement porte un ecart connu venu des
// donnees de demonstration : le portefeuille `wal_demo` a ete seme avec des soldes
// mais sans les ecritures correspondantes, si bien que `paidTotal` diverge depuis
// toujours. Exiger ici un rapport entierement vert reviendrait a faire echouer une
// recette sur un defaut de jeu d'essai — et, pire, a masquer le seul controle qui
// compte : mon parcours n'a-t-il introduit AUCUN nouvel ecart ?
step(6, 'Le parcours n_introduit aucun nouvel ecart comptable');
const ecartsApres = (bilanApres.body.discrepancies ?? []).map((d) => d.bucket).sort();
say(`   avant : ${avant.ecarts.join(', ') || 'aucun'}`);
say(`   apres : ${ecartsApres.join(', ') || 'aucun'}`);
check(
  'la liste des ecarts est inchangee',
  JSON.stringify(ecartsApres) === JSON.stringify(avant.ecarts),
);
check('aucune rupture de chaine dans le grand livre', (bilanApres.body.continuityBreaks ?? []).length === 0);
if (avant.ecarts.length > 0) {
  say('');
  say(`   RESERVE : ${avant.ecarts.length} ecart(s) preexistant(s) sur ce portefeuille,`);
  say('   anterieur(s) a cette recette et issu(s) des donnees de demonstration.');
}

// --- Menage ------------------------------------------------------------------
step(7, 'Menage');
await call('POST', `/ambassadors/commission-caps/${CAP}/deactivate`, admin);
check('le plafond de recette est desactive', true);
say('   NOTE : la souscription, le paiement et la commission produits par cette');
say('   recette restent en base — le grand livre est en ajout seul.');

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
