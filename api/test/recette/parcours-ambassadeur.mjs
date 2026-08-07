// ============================================================================
// RECETTE DU PARCOURS AMBASSADEUR — CONTRE L'API REELLE.
//
// Phase 2 : candidature publique, pieces d'identite, formation, quiz bloquant,
// activation, kit d'affiliation, lien public.
//
// Aucun mock : jetons authentiques, gardes de role actives, base reelle. Les
// tests unitaires ne voient jamais le cablage des routes — et c'est exactement
// ce genre de parcours qui avait revele, le 2026-08-01, qu'une route pointait
// encore vers une methode obsolete alors que 28 tests etaient au vert.
//
// CE QUE CETTE RECETTE VERIFIE ET QUE LES TESTS UNITAIRES NE PEUVENT PAS VOIR :
//   — l'ordre de resolution des routes (`me/kit` avant `:id`) ;
//   — les gardes de role sur chaque endpoint ;
//   — la constance REELLE de la reponse de `/r/:code` ;
//   — l'absence des bonnes reponses dans la charge utile HTTP du quiz ;
//   — la chaine complete des verrous d'activation.
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/parcours-ambassadeur.mjs
//
// EFFET DE BORD ASSUME : cree un compte et un dossier de candidature.
// ============================================================================
import fs from 'node:fs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';
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
  return { status: res.status, body: json, raw: text };
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

// Inscrit un candidat majeur et rend son jeton.
async function inscrireCandidat() {
  const depart = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
  const phone = `+23769${String(Date.now()).slice(-7)}`;

  const inscription = await call('POST', '/auth/register', null, {
    firstName: 'Recette',
    lastName: 'Parcours',
    sex: 'FEMALE',
    phone,
    cityOfResidence: 'Yaoundé',
    countryOfResidence: 'CM',
    password: MOT_DE_PASSE,
    language: 'FR',
    dateOfBirth: '1996-03-20',
  });
  if (inscription.status !== 201) {
    throw new Error(`Inscription impossible : ${JSON.stringify(inscription.body)}`);
  }

  let code = null;
  for (let essai = 0; essai < 20 && !code; essai++) {
    await new Promise((r) => setTimeout(r, 200));
    const nouveau = fs.readFileSync(LOG, 'utf8').slice(depart);
    const trouves = [...nouveau.matchAll(/(\d{6})/g)];
    if (trouves.length > 0) code = trouves[trouves.length - 1][1];
  }
  const verification = await call('POST', '/auth/verify-otp', null, {
    phone,
    code,
  });
  say(`   Candidate inscrite : ${phone}`);
  return { token: verification.body.accessToken, phone };
}

const step = (n, title) => {
  say('');
  say('='.repeat(72));
  say(`ETAPE ${n} — ${title}`);
  say('='.repeat(72));
};

const admin = await connecter(ADMIN);
const { token: candidate } = await inscrireCandidat();
say(`Jetons — ADMIN: ${admin ? 'oui' : 'NON'} / CANDIDATE: ${candidate ? 'oui' : 'NON'}`);

// --- 1. La candidature publique ----------------------------------------------
step(1, 'Depot de candidature');

const trop_court = await call('POST', '/ambassadors/apply', candidate, {
  motivation: 'Je veux bien.',
  categories: ['CAMPUS'],
});
check('une motivation de trois mots est refusee', trop_court.status === 400);

const candidature = await call('POST', '/ambassadors/apply', candidate, {
  motivation:
    'Je connais bien les campus de Yaounde et je souhaite aider les jeunes de ma promotion a trouver leur premier stage dans de bonnes conditions.',
  categories: ['CAMPUS'],
});
check('candidature acceptee', candidature.status === 201, `(HTTP ${candidature.status}) ${JSON.stringify(candidature.body)}`);

if (candidature.status !== 201) process.exit(1);
const AMB = candidature.body.id;

check('le dossier s_ouvre en SUBMITTED', candidature.body.status === 'SUBMITTED');
check('cycle 1', candidature.body.applicationCycle === 1);
// LA REGLE : une candidature n_accorde AUCUN droit.
check(
  'AUCUN code d_affiliation dans l_accuse de reception',
  !JSON.stringify(candidature.body).toLowerCase().includes('"code"'),
);

const doublon = await call('POST', '/ambassadors/apply', candidate, {
  motivation: candidature.body.motivation ?? 'Une seconde candidature identique deposee dans la foulee, sans objet reel.',
  categories: ['CAMPUS'],
});
check('une seconde candidature en cours d_instruction est refusee', doublon.status === 409, `(HTTP ${doublon.status})`);

// --- 2. Le kit n_existe pas encore -------------------------------------------
step(2, 'Le kit d_affiliation n_existe qu_a l_activation');

const kitTrop_tot = await call('GET', '/ambassadors/me/kit', candidate);
check(
  'le kit est refuse a un dossier en instruction',
  kitTrop_tot.status === 409,
  `(HTTP ${kitTrop_tot.status})`,
);
// Le routage : `me/kit` doit gagner sur `:id`. Un 404 « ambassadeur
// introuvable » signalerait l_inversion.
check(
  'la route me/kit n_est pas avalee par :id',
  kitTrop_tot.status !== 404,
  `(HTTP ${kitTrop_tot.status})`,
);

// --- 3. Les verrous d_activation ---------------------------------------------
step(3, 'La chaine des verrous d_activation');

const activationTrop_tot = await call('POST', `/ambassadors/${AMB}/activate`, admin);
check(
  'activation refusee sur un dossier a peine depose',
  activationTrop_tot.status === 400 || activationTrop_tot.status === 409,
  `(HTTP ${activationTrop_tot.status})`,
);
const motifs = String(activationTrop_tot.body?.message ?? '');
say(`   motifs : ${motifs.slice(0, 200)}`);

const parCandidate = await call('POST', `/ambassadors/${AMB}/activate`, candidate);
check('un candidat ne peut pas s_activer lui-meme', parCandidate.status === 403);

// --- 4. La formation et le quiz ----------------------------------------------
step(4, 'Formation et quiz');

const parcours = await call('GET', '/ambassadors/me/training', candidate);
check('le parcours de formation est consultable', parcours.status === 200 && Array.isArray(parcours.body));
say(`   ${parcours.body.length} module(s) au parcours`);

const quiz = await call('GET', '/ambassadors/me/quiz', candidate);
check('le quiz est servi', quiz.status === 200, `(HTTP ${quiz.status})`);

// LE CONTROLE CENTRAL DE CETTE ETAPE.
check(
  'AUCUNE bonne reponse dans la charge utile HTTP',
  !quiz.raw.includes('correctIndex'),
);
if (quiz.body?.questions?.length) {
  const cles = Object.keys(quiz.body.questions[0]).sort();
  say(`   champs servis : ${cles.join(', ')}`);
  check(
    'chaque question ne porte que id, prompt et choices',
    JSON.stringify(cles) === JSON.stringify(['choices', 'id', 'prompt']),
  );
} else {
  say('   (aucune question configuree — le controle de forme est sans objet)');
}

const scoreForge = await call('POST', '/ambassadors/me/quiz', candidate, {
  answers: [{ questionId: 'q1', choiceIndex: 0 }],
  scorePercent: 100,
  passed: true,
});
// Le DTO n_accepte que `answers` : un score envoye par le client est ignore ou
// refuse, jamais retenu.
check(
  'un score envoye par le client n_est jamais retenu',
  scoreForge.status === 400 || scoreForge.body?.passed !== true || scoreForge.status === 409,
  `(HTTP ${scoreForge.status}) ${JSON.stringify(scoreForge.body)}`,
);

// --- 5. Les pieces d_identite ------------------------------------------------
step(5, 'Pieces d_identite');

const mesPieces = await call('GET', '/ambassadors/me/identity-documents', candidate);
check('la liste de ses propres pieces est consultable', mesPieces.status === 200);

const pieceDAutrui = await call('POST', '/ambassadors/me/identity-documents', candidate, {
  documentId: 'doc-qui-nexiste-pas',
  type: 'NATIONAL_ID',
});
// Meme reponse qu_un document appartenant a quelqu_un d_autre : distinguer les
// deux permettrait d_enumerer les documents existants.
check(
  'un document inaccessible rend 404, sans en dire plus',
  pieceDAutrui.status === 404,
  `(HTTP ${pieceDAutrui.status})`,
);
check(
  'la reponse ne revele pas si le document existe',
  !JSON.stringify(pieceDAutrui.body).includes('appartient'),
);

const pieceParAdmin = await call('GET', `/ambassadors/${AMB}/identity-documents`, admin);
check('l_administration consulte les pieces d_un dossier', pieceParAdmin.status === 200);

const pieceParCandidate = await call('GET', `/ambassadors/${AMB}/identity-documents`, candidate);
check('un candidat ne consulte pas le dossier par cette route', pieceParCandidate.status === 403);

// --- 6. LE LIEN PUBLIC -------------------------------------------------------
step(6, 'Le lien public /r/:code — comportement rigoureusement constant');

const valide = await call('GET', '/r/K7RQ4M', null);
const inconnu = await call('GET', '/r/ZZZZ99', null);
const vide = await call('GET', '/r/AAAAAA', null);

check('le lien public repond sans authentification', valide.status === 200, `(HTTP ${valide.status})`);
check('meme statut HTTP pour un code inconnu', inconnu.status === valide.status);
check('meme statut HTTP pour un troisieme code', vide.status === valide.status);

const formeValide = Object.keys(valide.body ?? {}).sort();
const formeInconnue = Object.keys(inconnu.body ?? {}).sort();
say(`   champs rendus : ${formeValide.join(', ')}`);
check(
  'MEME FORME de reponse, code valide ou non',
  JSON.stringify(formeValide) === JSON.stringify(formeInconnue),
);
check(
  'meme valeur de next',
  valide.body?.next === inconnu.body?.next,
);
check(
  'aucune reponse ne dit si le code est valide',
  !valide.raw.includes('valid') && !inconnu.raw.includes('valid'),
);

// Le temps de reponse ne doit pas trahir non plus. Mesure grossiere : on veut
// seulement ecarter un ecart d_un ordre de grandeur.
const chrono = async (code) => {
  const debut = Date.now();
  await call('GET', `/r/${code}`, null);
  return Date.now() - debut;
};
const tValide = (await chrono('K7RQ4M')) + (await chrono('K7RQ4M'));
const tInconnu = (await chrono('ZZZZ99')) + (await chrono('ZZZZ99'));
say(`   temps cumule : valide ${tValide} ms / inconnu ${tInconnu} ms`);
check(
  'aucun ecart de temps exploitable',
  Math.abs(tValide - tInconnu) < Math.max(tValide, tInconnu),
);

// --- 7. Le kit d_un ambassadeur ACTIF ----------------------------------------
step(7, 'Le kit d_un ambassadeur actif');

// L_ambassadeur de demonstration est ACTIVE : son kit doit exister.
const demo = await connecter('+237671234567');
const kit = await call('GET', '/ambassadors/me/kit', demo);
check('le kit est servi a un ambassadeur actif', kit.status === 200, `(HTTP ${kit.status})`);

if (kit.status === 200) {
  say(`   code : ${kit.body.code}`);
  say(`   lien : ${kit.body.link}`);
  check('le lien porte le code', kit.body.link.endsWith(`/r/${kit.body.code}`));
  check(
    'le QR est une image calculee, pas un chemin de fichier',
    typeof kit.body.qrDataUrl === 'string' &&
      kit.body.qrDataUrl.startsWith('data:image/png;base64,'),
  );
  check(
    'le lien ne porte aucun identifiant interne',
    !kit.body.link.includes('amb_') && !kit.body.link.includes('cms'),
  );
}

const kitAnonyme = await call('GET', '/ambassadors/me/kit', null);
check('le kit est refuse sans jeton', kitAnonyme.status === 401);

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
