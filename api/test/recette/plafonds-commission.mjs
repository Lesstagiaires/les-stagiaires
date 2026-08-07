// ============================================================================
// RECETTE FONCTIONNELLE DES PLAFONDS DE COMMISSION — contre l'API REELLE.
//
// Arbitrage 15 du promoteur, 2026-08-02 : « Le depassement ne doit pas entrainer
// une reduction silencieuse. La commission doit etre placee dans un statut de
// controle. L'administration doit alors valider ou corriger la commission, avec
// journalisation complete. »
//
// Aucun mock : jetons authentiques (2FA comprise), gardes de role actives, base
// de donnees reelle. Les tests unitaires ne voient jamais le cablage des routes.
// Ici, deux risques precis sont couverts qu'ils ne peuvent pas voir :
//   - `commission-caps` est un segment UNIQUE, et serait avale par `@Get(':id')`
//     s'il etait declare apres lui ;
//   - les contraintes CHECK de la base mordent-elles vraiment sur le chemin
//     applicatif, et pas seulement en SQL direct.
//
// USAGE
//   1. demarrer l'API :        npm run start
//   2. lancer la recette :     node test/recette/plafonds-commission.mjs
//
// IDEMPOTENT : chaque execution cree ses propres plafonds, portant un suffixe
// unique, et les desactive en sortie. Aucune commission n'est fabriquee — elles
// ne naissent que d'un paiement confirme, et cette regle n'admet pas d'exception
// pour les besoins d'une recette.
// ============================================================================
import fs from 'node:fs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';

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

async function login(identifier, password) {
  const first = await call('POST', '/auth/login', null, {
    identifier,
    password,
  });
  if (!first.body.requiresTwoFactor) return first.body.accessToken;

  await new Promise((r) => setTimeout(r, 400));
  if (!fs.existsSync(LOG)) {
    throw new Error(
      `Journal de l'API introuvable : ${LOG}\n` +
        `La double authentification est active sur ce compte, et son code s'y lit.\n` +
        `  API_LOG=/chemin/vers/api.log node test/recette/plafonds-commission.mjs`,
    );
  }
  const log = fs.readFileSync(LOG, 'utf8');
  const codes = [...log.matchAll(/code de vérification est (\d{6})/g)];
  if (codes.length === 0) {
    throw new Error(`Aucun code de vérification dans ${LOG} (SMS_PROVIDER=console ?).`);
  }
  const second = await call('POST', '/auth/2fa/verify-login', null, {
    challengeToken: first.body.challengeToken,
    code: codes[codes.length - 1][1],
  });
  return second.body.accessToken;
}

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const SUFFIXE = Date.now().toString(36).toUpperCase();
const cree = [];

const admin = await login('+237690000001', 'Recette2026!');
const org = await login('+237671234567', 'Recette2026!');
say(`Jetons obtenus — ADMIN: ${admin ? 'oui' : 'NON'} / ORGANISATION: ${org ? 'oui' : 'NON'}`);

// --- 1. Le routage ----------------------------------------------------------
step(1, 'Les routes de plafonds ne sont pas avalees par /ambassadors/:id');

const liste = await call('GET', '/ambassadors/commission-caps', admin);
say(`   HTTP ${liste.status}`);
// Si `@Get(':id')` gagnait, la reponse serait un 404 « ambassadeur introuvable »
// et non une liste. C'est exactement l'inversion qui avait deja failli passer sur
// le module Partenariat.
check('GET /commission-caps rend une liste', liste.status === 200 && Array.isArray(liste.body));

const revue = await call('GET', '/ambassadors/commissions/review', admin);
check('GET /commissions/review rend une liste', revue.status === 200 && Array.isArray(revue.body));

// --- 2. Les gardes de role --------------------------------------------------
step(2, 'Un compte non-ADMIN ne voit ni ne cree de plafond');

const interdit = await call('GET', '/ambassadors/commission-caps', org);
check('lecture refusee a une organisation', interdit.status === 403, `(HTTP ${interdit.status})`);

const interditCreation = await call('POST', '/ambassadors/commission-caps', org, {
  label: 'Tentative',
  scope: 'AMBASSADOR',
  window: 'DAY',
  amountMinor: 1000,
  currency: 'XAF',
});
check('creation refusee a une organisation', interditCreation.status === 403);

const anonyme = await call('GET', '/ambassadors/commission-caps', null);
check('lecture refusee sans jeton', anonyme.status === 401);

// --- 3. Les refus de creation -----------------------------------------------
step(3, 'Ce qui n_est pas un plafond est refuse');

const zero = await call('POST', '/ambassadors/commission-caps', admin, {
  label: `Zero ${SUFFIXE}`,
  scope: 'AMBASSADOR',
  window: 'DAY',
  amountMinor: 0,
  currency: 'XAF',
});
check('plafond a zero refuse', zero.status === 400, `(HTTP ${zero.status})`);

const campagneSansCle = await call('POST', '/ambassadors/commission-caps', admin, {
  label: `Campagne anonyme ${SUFFIXE}`,
  scope: 'CAMPAIGN',
  window: 'LIFETIME',
  amountMinor: 100000,
  currency: 'XAF',
});
check(
  'plafond de campagne sans cle refuse',
  campagneSansCle.status === 400,
  `(HTTP ${campagneSansCle.status})`,
);

const cleDeTrop = await call('POST', '/ambassadors/commission-caps', admin, {
  label: `Cle de trop ${SUFFIXE}`,
  scope: 'AMBASSADOR',
  scopeKey: 'RENTREE',
  window: 'DAY',
  amountMinor: 100000,
  currency: 'XAF',
});
check('cle de portee sur un plafond par ambassadeur refusee', cleDeTrop.status === 400);

const deviseInvalide = await call('POST', '/ambassadors/commission-caps', admin, {
  label: `Devise floue ${SUFFIXE}`,
  scope: 'AMBASSADOR',
  window: 'DAY',
  amountMinor: 100000,
  currency: 'francs',
});
check('devise hors ISO 4217 refusee', deviseInvalide.status === 400);

// --- 4. Les creations legitimes ---------------------------------------------
step(4, 'Les quatre plafonds demandes par le promoteur');

const demandes = [
  { label: `Transaction ${SUFFIXE}`, scope: 'AMBASSADOR', window: 'TRANSACTION', amountMinor: 20000000, currency: 'XAF' },
  { label: `Journalier ${SUFFIXE}`, scope: 'AMBASSADOR', window: 'DAY', amountMinor: 50000000, currency: 'XAF' },
  { label: `Mensuel ${SUFFIXE}`, scope: 'AMBASSADOR', window: 'MONTH', amountMinor: 300000000, currency: 'XAF' },
  { label: `Enveloppe campagne ${SUFFIXE}`, scope: 'CAMPAIGN', scopeKey: `RENTREE-${SUFFIXE}`, window: 'LIFETIME', amountMinor: 500000000, currency: 'XAF' },
  { label: `Enveloppe produit ${SUFFIXE}`, scope: 'PRODUCT', scopeKey: 'CARRIERE_PLUS', window: 'MONTH', amountMinor: 800000000, currency: 'XAF' },
];

for (const demande of demandes) {
  const res = await call('POST', '/ambassadors/commission-caps', admin, demande);
  if (res.status === 201) cree.push(res.body.id);
  check(
    `${demande.window.padEnd(11)} / ${demande.scope.padEnd(10)} cree`,
    res.status === 201 && res.body.amountMinor === demande.amountMinor,
    `(HTTP ${res.status})`,
  );
}

check('les cinq plafonds ont ete crees', cree.length === 5, `(${cree.length}/5)`);

// --- 5. La tracabilite ------------------------------------------------------
step(5, 'Le plafond porte son auteur et reste actif');

const apres = await call('GET', '/ambassadors/commission-caps?active=true', admin);
const miens = apres.body.filter((c) => c.label.endsWith(SUFFIXE));
check('les cinq plafonds sont dans la liste des actifs', miens.length === 5, `(${miens.length}/5)`);
check('chaque plafond porte l_identifiant de son createur', miens.every((c) => c.createdById));

// --- 6. La desactivation ----------------------------------------------------
step(6, 'Un plafond se desactive, il ne se supprime pas');

const desactive = await call('POST', `/ambassadors/commission-caps/${cree[0]}/deactivate`, admin);
check('desactivation acceptee', desactive.status === 201 && desactive.body.isActive === false);

const toujoursLa = await call('GET', '/ambassadors/commission-caps', admin);
check(
  'le plafond desactive reste consultable — les controles passes restent explicables',
  toujoursLa.body.some((c) => c.id === cree[0]),
);
check(
  'il ne figure plus parmi les actifs',
  !(await call('GET', '/ambassadors/commission-caps?active=true', admin)).body.some(
    (c) => c.id === cree[0],
  ),
);

const inexistant = await call('POST', '/ambassadors/commission-caps/cap-inexistant/deactivate', admin);
check('desactiver un plafond inexistant rend 404', inexistant.status === 404);

// --- 7. L_arbitrage sur une commission qui n_est pas en controle -------------
step(7, 'Aucune commission arbitrable hors du statut de controle');

const enAttente = await call('GET', '/ambassadors/commissions/review', admin);
say(`   ${enAttente.body.length} commission(s) en attente d_arbitrage`);

const fantome = await call('POST', '/ambassadors/commissions/com-inexistante/review/release', admin, {
  internalNote: 'Recette automatisee : verification du refus sur dossier inexistant.',
});
check('arbitrer une commission inexistante rend 404', fantome.status === 404, `(HTTP ${fantome.status})`);

const sansNote = await call('POST', '/ambassadors/commissions/com-inexistante/review/release', admin, {});
// La validation du corps passe AVANT la recherche en base : une decision sans
// justification ecrite ne doit pas meme atteindre le service.
check('valider sans note interne est refuse a la frontiere', sansNote.status === 400);

const noteTropCourte = await call('POST', '/ambassadors/commissions/x/review/correct', admin, {
  internalNote: 'ok',
  reasonCode: 'COMPLIANCE_REVIEW',
  amountMinor: 1000,
});
check('une note interne de deux caracteres est refusee', noteTropCourte.status === 400);

const motifLibre = await call('POST', '/ambassadors/commissions/x/review/correct', admin, {
  internalNote: 'Recette automatisee : le motif communicable doit etre un code.',
  reasonCode: 'Le montant depassait le plafond',
  amountMinor: 1000,
});
// LA GARANTIE STRUCTURELLE : le champ qui part en notification n_accepte qu_une
// valeur de la liste controlee. Une note d_administration ne peut pas y entrer.
check('un motif communicable en texte libre est refuse', motifLibre.status === 400);

const balisage = await call('POST', '/ambassadors/commissions/x/review/correct', admin, {
  internalNote: 'Recette automatisee : le message public refuse le balisage.',
  reasonCode: 'COMPLIANCE_REVIEW',
  publicMessage: 'Bonjour <script>alert(1)</script> voici votre commission ajustee.',
  amountMinor: 1000,
});
check('le balisage est refuse a la frontiere dans le message public', balisage.status === 400);

// --- Menage -----------------------------------------------------------------
step(8, 'Menage — les plafonds de recette sont desactives');
for (const id of cree.slice(1)) {
  await call('POST', `/ambassadors/commission-caps/${id}/deactivate`, admin);
}
const restants = (await call('GET', '/ambassadors/commission-caps?active=true', admin)).body.filter(
  (c) => c.label.endsWith(SUFFIXE),
);
check('aucun plafond de recette ne reste actif', restants.length === 0, `(${restants.length})`);

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
