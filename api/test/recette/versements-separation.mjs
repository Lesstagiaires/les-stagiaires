// ============================================================================
// RECETTE DU CYCLE DE VERSEMENT — SEPARATION DES POUVOIRS, CONTRE L'API REELLE.
//
// Arbitrage 12 du promoteur, 2026-08-02 : « Une meme personne ne doit pas
// pouvoir, seule, approuver puis executer le meme paiement. Le cycle minimal
// sera : demande de retrait ; controle ; validation ; execution ; confirmation
// ou echec ; reconciliation. »
//
// CE SCRIPT JOUE LE PARCOURS ENTIER, avec TROIS administrateurs distincts :
// A controle et approuve, B contresigne, C ordonne le virement puis le confirme.
// Il verifie autant les REFUS (qui sont la garantie) que le chemin nominal.
//
// CONSEQUENCE OPERATIONNELLE, a porter a la connaissance du promoteur : la
// plateforme exige desormais AU MOINS DEUX administrateurs pour verser quoi que
// ce soit, et TROIS au-dela du seuil de double controle. Un deploiement
// mono-administrateur ne peut payer personne.
//
// PREREQUIS : trois comptes ADMIN. Sur une base de demonstration :
//   node scripts/seed-admins-recette.mjs
//
// USAGE
//   API_URL=http://127.0.0.1:3100 API_LOG=recette-api.log \
//     node test/recette/versements-separation.mjs
//
// PREREQUIS : une politique pays ouverte aux versements pour CM, avec un montant
// minimum atteignable par le solde de l'ambassadeur de demonstration. Le script
// le verifie et le dit franchement s'il manque.
//
// EFFET DE BORD ASSUME : ce parcours ecrit dans le grand livre, en ajout seul.
// A ne lancer que sur une base de developpement.
// ============================================================================
import fs from 'node:fs';

const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const LOG = process.env.API_LOG ?? '../api.log';

const ADMIN_A = '+237690000001'; // controle et approuve
const ADMIN_B = '+237690000002'; // contresigne
const ADMIN_C = '+237690000003'; // ordonne le virement, puis le confirme
const AMBASSADEUR = '+237671234567'; // titulaire du dossier amb_demo
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
  // Position du journal AVANT la demande : quatre connexions se suivent dans ce
  // script, et lire « le dernier code du fichier » attrapait celui d'un autre
  // compte. On ne lit que ce qui s'écrit APRÈS cette connexion-ci.
  const depart = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;

  // Le limiteur de débit protège /auth/login, et il a raison de le faire : ce
  // script enchaîne sept connexions là où un humain en fait une. On attend au
  // lieu de contourner — désactiver la protection pour une recette reviendrait à
  // ne plus la tester du tout.
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
  if (first.status === 429) {
    throw new Error(`Limiteur de débit toujours actif pour ${identifier}.`);
  }
  if (!first.body.requiresTwoFactor) return first.body.accessToken;

  // Le fournisseur SMS `console` écrit le code de façon asynchrone : on attend
  // qu'il apparaisse plutôt que de parier sur un délai fixe.
  let code = null;
  for (let essai = 0; essai < 20 && !code; essai++) {
    await new Promise((r) => setTimeout(r, 200));
    const nouveau = fs.readFileSync(LOG, 'utf8').slice(depart);
    const trouves = [...nouveau.matchAll(/code de vérification est (\d{6})/g)];
    if (trouves.length > 0) code = trouves[trouves.length - 1][1];
  }
  if (!code) {
    throw new Error(`Aucun code de vérification pour ${identifier} dans ${LOG}.`);
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

const NOTE = 'Recette automatisee du cycle de versement, controle des etapes.';

// La double authentification est EXIGÉE par le garde de rôle pour tout accès
// ADMIN (CLAUDE.md §2/§3). Un compte créé par script ne l'a pas : on l'active
// par l'API, jamais en base — c'est le service qui journalise l'activation.
// La double authentification est EXIGÉE par le garde de rôle pour tout accès
// ADMIN (CLAUDE.md §2/§3). Un compte créé par script ne l'a pas : on l'active
// PAR L'API et non en base, pour que le service la journalise comme il le fera
// en production. Réservé aux administrateurs — on ne touche pas au réglage de
// sécurité d'un ambassadeur au passage.
async function loginAdmin(identifier) {
  const jeton = await connecter(identifier);
  // Activation idempotente : le service pose le drapeau et ne fait rien de plus
  // s'il l'est déjà. On se reconnecte ensuite pour franchir réellement la
  // seconde étape, comme le fera un administrateur.
  const activation = await call('POST', '/auth/2fa/enable', jeton, {});
  if (activation.status === 200) return connecter(identifier);
  return jeton;
}

const admin = await loginAdmin(ADMIN_A);
const adminB = await loginAdmin(ADMIN_B);
const adminC = await loginAdmin(ADMIN_C);
const ambassadeur = await connecter(AMBASSADEUR);
say(
  `Jetons — A: ${admin ? 'oui' : 'NON'} / B: ${adminB ? 'oui' : 'NON'} / ` +
    `C: ${adminC ? 'oui' : 'NON'} / AMBASSADEUR: ${ambassadeur ? 'oui' : 'NON'}`,
);
if (!adminB || !adminC) {
  say('');
  say('   PREREQUIS MANQUANT : trois comptes ADMIN sont necessaires.');
  say('     node scripts/seed-admins-recette.mjs');
  process.exit(1);
}

// --- 1. La demande -----------------------------------------------------------
step(1, 'Demande de retrait par l_ambassadeur');

const portefeuille = await call('GET', '/ambassadors/me/wallet', ambassadeur);
const disponible =
  portefeuille.body?.wallet?.availableMinor ?? portefeuille.body?.availableMinor;
say(`   solde disponible : ${disponible}`);

const MONTANT = 10000; // 100 F — au-dessus du seuil de double controle pose ci-dessous
const demande = await call('POST', '/ambassadors/me/payouts', ambassadeur, {
  amountMinor: MONTANT,
  method: 'MOBILE_MONEY',
  destinationLabel: 'MTN MoMo — Recette 677998877',
});

if (demande.status !== 201) {
  say(`   HTTP ${demande.status} — ${JSON.stringify(demande.body)}`);
  say('');
  say('   PREREQUIS MANQUANT. Les versements doivent etre ouverts pour CM, avec');
  say('   un montant minimum inferieur ou egal a ' + MONTANT + ' et un solde suffisant.');
  say('   Exemple :');
  say('     INSERT INTO "AmbassadorPolicy" (id,"countryCode","payoutsEnabled",');
  say('       "minPayoutAmountMinor","doubleApprovalThresholdMinor","updatedAt")');
  say(`     VALUES ('pol-cm','CM',true,${MONTANT},5000,now());`);
  process.exit(1);
}

const P = demande.body.id;
check('demande creee au statut REQUESTED', demande.body.status === 'REQUESTED');
say(`   double controle exige : ${demande.body.requiresSecondApproval}`);

// --- 2. L_ordre des etapes ---------------------------------------------------
step(2, 'Aucune etape ne peut etre sautee');

const sautControle = await call('POST', `/ambassadors/payouts/${P}/validate`, admin, {
  internalNote: NOTE,
});
check(
  'valider sans avoir controle est refuse',
  sautControle.status === 409,
  `(HTTP ${sautControle.status})`,
);

const sautExecution = await call('POST', `/ambassadors/payouts/${P}/execute`, admin, {
  executionReference: 'VIR-RECETTE',
});
check(
  'executer une demande non validee est refuse',
  sautExecution.status === 409,
  `(HTTP ${sautExecution.status})`,
);

const sautConfirmation = await call('POST', `/ambassadors/payouts/${P}/confirm`, admin, {
  internalNote: NOTE,
});
check(
  'confirmer un virement non ordonne est refuse',
  sautConfirmation.status === 409,
  `(HTTP ${sautConfirmation.status})`,
);

// --- 3. Le controle ----------------------------------------------------------
step(3, 'Controle — il constate, il ne bloque pas');

const controle = await call('POST', `/ambassadors/payouts/${P}/review`, admin, {
  internalNote: NOTE,
});
check('controle accepte', controle.status === 201, `(HTTP ${controle.status})`);
check('la demande passe a UNDER_REVIEW', controle.body.status === 'UNDER_REVIEW');
check('les constats du controle sont rendus', Array.isArray(controle.body.findings));
say(`   constats : ${controle.body.findings?.length ? controle.body.findings.join(' | ') : 'aucun'}`);

const sansNote = await call('POST', `/ambassadors/payouts/${P}/review`, admin, {});
check('une etape sans note interne est refusee a la frontiere', sansNote.status === 400);

// --- 4. La validation --------------------------------------------------------
step(4, 'Validation, et double controle au-dela du seuil');

const validation = await call('POST', `/ambassadors/payouts/${P}/validate`, admin, {
  internalNote: NOTE,
});
check('validation acceptee', validation.status === 201, `(HTTP ${validation.status})`);

const doubleRequis = demande.body.requiresSecondApproval === true;
if (doubleRequis) {
  check(
    'au-dela du seuil, la demande attend une contresignature',
    validation.body.status === 'AWAITING_SECOND_APPROVAL',
    `(statut ${validation.body.status})`,
  );

  // LA REGLE DU DOUBLE CONTROLE : la meme signature apposee deux fois n'en est pas un.
  const memeSignataire = await call(
    `POST`,
    `/ambassadors/payouts/${P}/second-approval`,
    admin,
    { internalNote: NOTE },
  );
  check(
    'le meme administrateur ne peut pas contresigner sa propre approbation',
    memeSignataire.status === 403,
    `(HTTP ${memeSignataire.status})`,
  );

  const contresignature = await call(
    `POST`,
    `/ambassadors/payouts/${P}/second-approval`,
    adminB,
    { internalNote: NOTE },
  );
  check(
    'un SECOND administrateur, lui, peut contresigner',
    contresignature.status === 201,
    `(HTTP ${contresignature.status})`,
  );
  check(
    'la demande est alors pleinement VALIDATED',
    contresignature.body.status === 'VALIDATED',
  );

  // LA SEPARATION DES POUVOIRS, sur les DEUX approbateurs.
  const parA = await call('POST', `/ambassadors/payouts/${P}/execute`, admin, {
    executionReference: 'VIR-RECETTE',
  });
  check('celui qui a approuve ne peut pas executer', parA.status === 403, `(HTTP ${parA.status})`);

  const parB = await call('POST', `/ambassadors/payouts/${P}/execute`, adminB, {
    executionReference: 'VIR-RECETTE',
  });
  check('celui qui a contresigne ne peut pas executer non plus', parB.status === 403);
  say(`   message : ${parB.body?.message ?? ''}`);
} else {
  check('sans seuil, la demande est directement VALIDATED', validation.body.status === 'VALIDATED');

  // LA SEPARATION DES POUVOIRS.
  const memeAdmin = await call('POST', `/ambassadors/payouts/${P}/execute`, admin, {
    executionReference: 'VIR-RECETTE',
  });
  check(
    'celui qui a approuve ne peut pas executer',
    memeAdmin.status === 403,
    `(HTTP ${memeAdmin.status})`,
  );
  say(`   message : ${memeAdmin.body?.message ?? ''}`);
}

// --- 5. Le parcours nominal, jusqu_au grand livre ----------------------------
step(5, 'Execution par un TROISIEME administrateur, puis confirmation');

const bilanAvant = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
const ecrituresAvant = bilanAvant.body.transactionCount;

const execution = await call('POST', `/ambassadors/payouts/${P}/execute`, adminC, {
  executionReference: 'VIR-RECETTE-2026',
});
check('un troisieme administrateur peut ordonner le virement', execution.status === 201, `(HTTP ${execution.status})`);
check('la demande passe a EXECUTING', execution.body.status === 'EXECUTING');

// LE DEPLACEMENT QUI COMPTE : ordonner n_ecrit RIEN au grand livre.
const bilanPendant = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
check(
  'ordonner un virement n_ecrit RIEN au grand livre',
  bilanPendant.body.transactionCount === ecrituresAvant,
  `(avant ${ecrituresAvant}, apres ${bilanPendant.body.transactionCount})`,
);

const confirmation = await call('POST', `/ambassadors/payouts/${P}/confirm`, adminC, {
  internalNote: 'Virement confirme par l_operateur, recette automatisee.',
});
check('confirmation acceptee', confirmation.status === 201, `(HTTP ${confirmation.status})`);
check('la demande est EXECUTED', confirmation.body.status === 'EXECUTED');

const bilanApres = await call('GET', '/ambassadors/amb_demo/reconciliation', admin);
check(
  'la confirmation, elle, porte la sortie au grand livre',
  bilanApres.body.transactionCount === ecrituresAvant + 1,
  `(avant ${ecrituresAvant}, apres ${bilanApres.body.transactionCount})`,
);
check(
  'aucun ecart comptable n_est introduit par le versement',
  (bilanApres.body.discrepancies ?? []).length ===
    (bilanAvant.body.discrepancies ?? []).length,
);
check(
  'aucune rupture de chaine',
  (bilanApres.body.continuityBreaks ?? []).length === 0,
);

const apresCoup = await call('POST', `/ambassadors/payouts/${P}/confirm`, adminC, {
  internalNote: 'Seconde confirmation, qui ne doit pas passer.',
});
check('un versement deja confirme ne se reconfirme pas', apresCoup.status === 409);

// --- 6. Le journal -----------------------------------------------------------
step(6, 'Le journal — chaque etape, avec sa destination MASQUEE');

const piste = await call('GET', `/ambassadors/payouts/${P}/history`, admin);
check('la piste est consultable', piste.status === 200);
const types = (piste.body.events ?? []).map((e) => e.type);
say(`   etapes journalisees : ${types.join(' -> ')}`);
check('la demande est journalisee', types.includes('REQUESTED'));
check('le controle est journalise', types.includes('REVIEWED'));
check('l_approbation est journalisee', types.includes('APPROVED'));
check('la contresignature est journalisee', types.includes('SECOND_APPROVAL'));
check('l_ordre de virement est journalise', types.includes('EXECUTION_ORDERED'));
check('la confirmation est journalisee', types.includes('CONFIRMED'));
check(
  'la reference du virement figure au journal',
  (piste.body.events ?? []).some((e) => e.reference === 'VIR-RECETTE-2026'),
);
// Les cinq etapes ont ete portees par TROIS personnes differentes : c_est la
// separation des pouvoirs, lisible dans le journal.
const signataires = new Set((piste.body.events ?? []).map((e) => e.actorId));
check(
  'le journal montre au moins trois auteurs distincts',
  signataires.size >= 3,
  `(${signataires.size})`,
);

const journalComplet = JSON.stringify(piste.body);
// LE POINT DE SECURITE : le numero complet n'est jamais entre en base.
check(
  'le numero complet n_apparait NULLE PART, ni au journal ni sur la demande',
  !journalComplet.includes('677998877'),
);
check(
  'la destination est bien masquee',
  journalComplet.includes('••••8877'),
);

const chaqueEtape = (piste.body.events ?? []).every(
  (e) => e.actorId && e.createdAt && e.amountMinor && e.currency && e.destinationMasked && e.status,
);
check(
  'chaque etape porte auteur, date, montant, devise, destination masquee et statut',
  chaqueEtape,
);

// --- 7. Les gardes de role ---------------------------------------------------
step(7, 'Aucune etape n_est ouverte a un non-administrateur');

for (const etape of ['review', 'validate', 'second-approval', 'execute', 'confirm', 'fail']) {
  const tentative = await call(`POST`, `/ambassadors/payouts/${P}/${etape}`, ambassadeur, {
    internalNote: NOTE,
    reasonCode: 'PAYMENT_DETAILS_INVALID',
    executionReference: 'VIR-X',
  });
  check(`/${etape} refuse a l_ambassadeur`, tentative.status === 403, `(HTTP ${tentative.status})`);
}

const anonyme = await call('GET', `/ambassadors/payouts/${P}/history`, null);
check('la piste est refusee sans jeton', anonyme.status === 401);

// --- 8. Etat final -----------------------------------------------------------
step(8, 'Etat final — un versement parti ne se rejoue pas');

const tardif = await call('POST', `/ambassadors/payouts/${P}/reject`, admin, {
  reason: 'Rejet tardif sur un versement deja parti, qui doit etre refuse.',
});
check(
  'un versement deja execute ne se rejette plus',
  tardif.status === 409,
  `(HTTP ${tardif.status})`,
);

const apres = await call('GET', '/ambassadors/me/wallet', ambassadeur);
const disponibleApres =
  apres.body?.wallet?.availableMinor ?? apres.body?.availableMinor;
check(
  'le montant verse a bien quitte le solde disponible',
  disponibleApres === disponible - MONTANT,
  `(avant ${disponible}, apres ${disponibleApres}, verse ${MONTANT})`,
);

say('');
say(`   NOTE : un versement reel de ${MONTANT} unites mineures a ete execute et`);
say('   confirme sur la base de developpement. Le grand livre etant en ajout');
say('   seul, cette ecriture y reste.');

say('');
say('='.repeat(72));
say(`RESULTAT : ${ok} controle(s) reussi(s), ${ko} echec(s).`);
say('='.repeat(72));
process.exit(ko === 0 ? 0 : 1);
