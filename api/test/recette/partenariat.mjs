// ============================================================================
// RECETTE FONCTIONNELLE DU MODULE PARTENARIAT — contre l'API REELLE.
//
// Aucun mock : jetons authentiques (2FA comprise), gardes de role actives, base
// de donnees reelle. Complementaire aux tests unitaires, qui ne voient jamais le
// cablage des routes ni les gardes — c'est exactement ce genre de parcours qui
// avait revele, le 2026-08-01, qu'une route pointait encore vers une methode
// obsolete alors que 28 tests unitaires etaient au vert.
//
// USAGE
//   1. demarrer l'API :        npm run start
//   2. lancer la recette :     node test/recette/partenariat.mjs
//
// Le script est IDEMPOTENT : il peut tourner plusieurs fois de suite. Il choisit
// un type de partenariat libre a chaque execution et raisonne en deltas sur le
// journal, plutot qu'en valeurs absolues.
//
// PREREQUIS : deux comptes de demonstration dont le mot de passe est connu, et
// une organisation VERIFIED. Voir les constantes ci-dessous.
// ============================================================================
import fs from 'node:fs';

const API = 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log'; // journal de l'API, pour lire l'OTP de la 2FA en développement
const ORG = 'cms5njqmc000928v932d8qyau'; // Institut Test Douala (VERIFIED)

const out = [];
const say = (s = '') => {
  out.push(s);
  console.log(s);
};

let ok = 0;
let ko = 0;
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

  // Le code de la double authentification est lu dans le journal de l'API, que le
  // fournisseur SMS `console` y écrit en développement. Un chemin absent doit le
  // dire franchement : sans ce garde-fou, le script échouait sans un mot, et on
  // croyait à une panne de l'API.
  if (!fs.existsSync(LOG)) {
    throw new Error(
      `Journal de l'API introuvable : ${LOG}\n` +
        `La double authentification est active sur ce compte, et son code s'y lit.\n` +
        `Démarrer l'API en redirigeant sa sortie, puis :\n` +
        `  API_LOG=/chemin/vers/api.log node test/recette/partenariat.mjs`,
    );
  }

  const log = fs.readFileSync(LOG, 'utf8');
  const codes = [...log.matchAll(/code de vérification est (\d{6})/g)];
  if (codes.length === 0) {
    throw new Error(
      `Aucun code de vérification dans ${LOG}. Vérifier que SMS_PROVIDER=console.`,
    );
  }
  const code = codes[codes.length - 1][1];
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

const admin = await login('+237690000001', 'Recette2026!');
const org = await login('+237671234567', 'Recette2026!');
say(`Jetons obtenus — ADMIN: ${admin ? 'oui' : 'NON'} / ORGANISATION: ${org ? 'oui' : 'NON'}`);

// --- 0. Catalogue -----------------------------------------------------------
step(0, 'Catalogue des types de partenariat');
const types = await call('GET', '/partnerships/types', org);
say(`   ${types.body.length} types proposables : ${types.body.map((t) => t.code).join(', ')}`);
check('les 11 types initiaux sont proposables', types.body.length === 11);
check(
  'les libellés sont servis dans les cinq langues',
  types.body[0].labelFr && types.body[0].labelAr && types.body[0].labelPt,
);

// --- 1. Depot ---------------------------------------------------------------
step(1, 'Dépôt de la candidature (organisation)');
const created = await call('POST', `/partnerships/organizations/${ORG}`, org, {
  typeCode: 'ACADEMIC',
  motivation:
    'Notre institut souhaite formaliser un partenariat académique avec LES STAGIAIRES pour ses filières techniques.',
});
say(`   HTTP ${created.status} — statut ${created.body.status}`);
const P = created.body.id;

// Point de depart du journal : le dossier peut deja porter les cycles precedents.
const historyBefore = await call('GET', `/partnerships/${P}/history`, admin);
const eventsBefore = historyBefore.body.events.length - 1; // -1 : le REQUESTED qu'on vient d'ecrire
say(`   Journal du dossier avant ce cycle : ${eventsBefore} décision(s)`);
check('la candidature est créée en PENDING', created.body.status === 'PENDING');
check('elle porte le type demandé', created.body.typeId === 'ptype_academic');

// Second type pour la meme organisation : la nouvelle cardinalite.
// Un type LIBRE est choisi a chaque execution, sinon un rejeu bute sur son propre
// passage precedent — une recette doit pouvoir tourner deux fois de suite.
const before = await call('GET', `/partnerships/organizations/${ORG}`, org);
const busy = new Set(before.body.map((p) => p.typeId));
const freeType = types.body.find(
  (t) => !busy.has(t.id) && t.code !== 'ACADEMIC',
);
const second = await call('POST', `/partnerships/organizations/${ORG}`, org, {
  typeCode: freeType.code,
  motivation:
    'Nous souhaitons également un second partenariat afin de couvrir un autre volet de notre coopération.',
});
check(
  `la même organisation peut candidater à un SECOND type (${freeType.code})`,
  second.status === 201,
  `(HTTP ${second.status})`,
);

const duplicate = await call('POST', `/partnerships/organizations/${ORG}`, org, {
  typeCode: 'ACADEMIC',
  motivation:
    'Tentative de doublon sur un type déjà en cours afin de vérifier le garde-fou de cardinalité.',
});
check(
  'un doublon sur le MÊME type est refusé',
  duplicate.status === 409,
  `(HTTP ${duplicate.status})`,
);

// --- 2. Complement requis ---------------------------------------------------
step(2, 'Demande de complément (administration)');
const info = await call('POST', `/partnerships/${P}/request-additional-information`, admin, {
  requestedItems: [
    'Récépissé de déclaration',
    'Attestation fiscale de moins de trois mois',
  ],
  internalNote:
    'Dossier prometteur mais incomplet — dirigeant à rappeler, ne pas écrire ceci au partenaire.',
  publicMessage: 'Les copies simples suffisent à ce stade.',
  actionDeadline: '2026-09-01T00:00:00.000Z',
});
say(`   HTTP ${info.status} — statut ${info.body.status}`);
check(
  'le dossier passe en ADDITIONAL_INFORMATION_REQUIRED',
  info.body.status === 'ADDITIONAL_INFORMATION_REQUIRED',
);
check("il n'est PAS passé en REFUSED", info.body.status !== 'REFUSED');
check("l'échéance d'action est posée", Boolean(info.body.actionDeadline));

const blocked = await call('POST', `/partnerships/organizations/${ORG}`, org, {
  typeCode: 'ACADEMIC',
  motivation:
    'Nouvelle demande alors quun complément est attendu, pour vérifier que la plateforme oriente vers la complétion.',
});
check(
  'déposer une NOUVELLE demande est refusé — il faut compléter',
  blocked.status === 409,
  `(HTTP ${blocked.status})`,
);
if (blocked.status === 409) say(`   → « ${blocked.body.message} »`);

// --- 3. Ce que l'organisation voit ------------------------------------------
step(3, 'Ce que l’organisation voit de son dossier');
const orgView = await call('GET', `/partnerships/organizations/${ORG}`, org);
const dossier = orgView.body.find((p) => p.id === P);
const serialized = JSON.stringify(orgView.body);
check('la lecture renvoie une LISTE', Array.isArray(orgView.body));
// Le partenariat de demonstration restaure compte aussi : au moins deux.
check(
  'tous les partenariats de l organisation sont visibles',
  orgView.body.length >= 2,
  `(${orgView.body.length} trouvés)`,
);
check(
  'AUCUNE note interne ne fuite',
  !serialized.includes('dirigeant à rappeler') &&
    !serialized.includes('ne pas écrire ceci'),
);
check(
  'le message validé, lui, est bien transmis',
  serialized.includes('Les copies simples suffisent'),
);
check(
  'les pièces attendues sont listées',
  serialized.includes('Récépissé de déclaration'),
);
say(`   Événements visibles par l'organisation : ${dossier.events.length}`);
say(`   Champs d'un événement : ${Object.keys(dossier.events[0]).join(', ')}`);

// --- 4. Reponse de l'organisation -------------------------------------------
step(4, 'L’organisation complète son dossier');
const provided = await call('POST', `/partnerships/${P}/additional-information`, org, {
  response:
    'Veuillez trouver le récépissé de déclaration ainsi que l attestation fiscale du mois en cours.',
});
say(`   HTTP ${provided.status} — statut ${provided.body.status}`);
check('le dossier revient en PENDING', provided.body.status === 'PENDING');
check(
  "l'échéance d'action est levée",
  provided.body.actionDeadline === null,
);

const orgAfter = await call('GET', `/partnerships/organizations/${ORG}`, org);
const dossierAfter = orgAfter.body.find((p) => p.id === P);
check(
  'la candidature initiale est CONSERVÉE',
  dossierAfter.motivation.startsWith('Notre institut souhaite formaliser'),
);
check(
  'la demande de complément est close, réponse attachée',
  dossierAfter.informationRequests[0].resolvedAt !== null &&
    dossierAfter.informationRequests[0].response.includes('récépissé'),
);

// --- 5. Cycle de vie complet ------------------------------------------------
step(5, 'Acceptation, suspension, réactivation, résiliation');
const approved = await call('POST', `/partnerships/${P}/approve`, admin, {});
check('acceptation → ACTIVE', approved.body.status === 'ACTIVE');

const suspended = await call('POST', `/partnerships/${P}/suspend`, admin, {
  internalNote: 'Vérification de conformité déclenchée par un signalement anonyme.',
  reasonCode: 'COMPLIANCE_REVIEW',
  publicMessage: 'Une vérification est en cours sur votre dossier.',
});
check('suspension → SUSPENDED', suspended.body.status === 'SUSPENDED');

const reinstated = await call('POST', `/partnerships/${P}/reinstate`, admin, {});
check('réactivation → ACTIVE', reinstated.body.status === 'ACTIVE');
check(
  'les trois niveaux de motif de suspension sont effacés',
  reinstated.body.suspensionReason === null &&
    reinstated.body.suspensionReasonCode === null &&
    reinstated.body.suspensionPublicMessage === null,
);

const termReq = await call('POST', `/partnerships/${P}/termination-request`, org, {
  reason: 'Réorientation de notre politique de partenariats pour l année à venir.',
});
check(
  'demande de résiliation enregistrée sans changer le statut',
  termReq.status === 201 && termReq.body.status === 'ACTIVE',
  `(HTTP ${termReq.status}, statut ${termReq.body.status})`,
);

const terminated = await call('POST', `/partnerships/${P}/terminate`, admin, {
  internalNote: 'Résiliation prononcée à la demande de l organisation, dossier sans incident.',
  reasonCode: 'ORGANIZATION_REQUEST',
});
check('résiliation → TERMINATED', terminated.body.status === 'TERMINATED');

// --- 6. Le journal ----------------------------------------------------------
step(6, 'Historique complet (administration)');
const history = await call('GET', `/partnerships/${P}/history`, admin);
const hist = history.body.events;
const orphans = history.body.orphanedEvents;
say(`   ${hist.length} décisions sur CE dossier :`);
for (const e of [...hist].reverse()) {
  const to =
    e.toStatus && e.toStatus !== e.fromStatus
      ? ` ${e.fromStatus} → ${e.toStatus}`
      : '';
  say(
    `   · ${e.type.padEnd(34)}${to.padEnd(48)} notifs=${e.notifiedTypes.length} dest=${e.notifiedCount}`,
  );
}
say(`   ${orphans.length} décisions orphelines d'un dossier antérieur, servies à part`);

// Le dossier ACADEMIC est recandidate a chaque execution : son journal cumule les
// cycles successifs, ce qui est le comportement voulu. On verifie donc le DELTA.
check(
  'les 8 décisions de CE cycle sont journalisées',
  hist.length - eventsBefore === 8,
  `(${hist.length - eventsBefore} nouvelles, ${hist.length} au total sur le dossier)`,
);
check(
  'les décisions d’un dossier ANTÉRIEUR ne polluent pas celui-ci',
  hist.every((e) => e.partnershipId === P),
);
check(
  'les orphelines restent accessibles, sans être mélangées',
  Array.isArray(orphans) && orphans.every((e) => e.partnershipId === null),
);
check(
  'chaque événement porte organisation et référence',
  hist.every((e) => e.organizationId && e.reference),
);
check(
  'les notes internes SONT dans la vue administration',
  hist.some((e) => e.internalNote?.includes('signalement anonyme')),
);
check(
  'chaque décision du dossier a notifié au moins un destinataire',
  hist.every((e) => e.notifiedCount > 0),
);

// --- 7. Gardes de role ------------------------------------------------------
step(7, 'Gardes de rôle');
const forbidden = await call('GET', `/partnerships/${P}/history`, org);
check(
  "l'organisation ne peut PAS lire l'historique d'administration",
  forbidden.status === 403,
  `(HTTP ${forbidden.status})`,
);
const forbidden2 = await call('POST', `/partnerships/${P}/suspend`, org, {
  internalNote: 'Tentative de suspension par une organisation, doit être refusée.',
  reasonCode: 'COMPLIANCE_REVIEW',
});
check(
  'une organisation ne peut pas suspendre son propre partenariat',
  forbidden2.status === 403,
  `(HTTP ${forbidden2.status})`,
);
const anonymous = await call('GET', '/partnerships', null);
check(
  'la file d’administration est fermée aux anonymes',
  anonymous.status === 401,
  `(HTTP ${anonymous.status})`,
);

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} vérifications passées, ${ko} en échec`);
say('='.repeat(72));

fs.writeFileSync(
  process.env.RECETTE_OUT ?? 'recette-resultat.txt',
  out.join('\n'),
  'utf8',
);
process.exit(ko === 0 ? 0 : 1);
