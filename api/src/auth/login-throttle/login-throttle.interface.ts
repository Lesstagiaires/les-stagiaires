import type { ConfigService } from '@nestjs/config';

// ============================================================================
// LE LIMITEUR DE CONNEXION — S-06-C
//
// CE QU'IL REMPLACE. Le compteur d'échecs vivait sur la ligne `User` de la
// victime : cinq requêtes d'un inconnu suffisaient à l'exclure de son compte
// quinze minutes, et vingt requêtes par heure l'en excluaient indéfiniment.
// Mesuré le 2026-08-12 ; le journal imputait le verrouillage à la victime.
//
// LE PRINCIPE. Le compteur appartient à l'ORIGINE de la tentative, pas à sa
// cible. Un tiers ne peut plus écrire dans l'état du compte d'autrui.
//
// ----------------------------------------------------------------------------
// RÉSERVATION PUIS REMBOURSEMENT — pourquoi ce détour
//
// Une première version comptait TOUTES les tentatives par origine, y compris
// les connexions réussies, et ne rendait jamais ce compteur. Mesuré : la 51e
// connexion RÉUSSIE depuis une même adresse était rejetée. Derrière un NAT
// d'opérateur — la règle en Afrique centrale, pas l'exception — cela revenait
// à exclure des abonnés qui n'avaient rien fait. On avait remplacé un déni de
// service ciblé par un déni de service collatéral.
//
// LA CORRECTION ÉVIDENTE — « ne compter que les échecs » — EST UN PIÈGE si on
// la prend au pied de la lettre. Un échec ne se connaît qu'APRÈS `argon2`, or
// la décision doit être prise AVANT toute lecture de la base. On aurait donc
// lu avant et écrit après : mille requêtes simultanées liraient toutes un
// compteur à zéro et passeraient toutes. Un budget de cinq deviendrait « autant
// que le serveur accepte de connexions parallèles ».
//
// D'OÙ LA RÉSERVATION. On incrémente atomiquement AVANT — la course est fermée
// — et l'on REMBOURSE dès que le mot de passe est prouvé. Le compteur ne mesure
// donc pas « les tentatives » mais LES ÉCHECS, PLUS LES VÉRIFICATIONS EN COURS.
// En régime normal sa valeur au repos est nulle, quel que soit le nombre
// d'utilisateurs derrière l'adresse.
//
// AUCUNE DÉCISION N'A ÉTÉ DÉPLACÉE, seulement une écriture. `consommer` reste
// avant `findFirst` ; `preuveDuMotDePasse` n'autorise ni ne refuse rien.
// ----------------------------------------------------------------------------
//
// TROIS COMPTEURS, ET DEUX FAÇONS DE RÉPONDRE
//
//   (origine, identifiant)   bloque             — clé PRIVÉE à un identifiant
//   (origine) vigilance      second facteur     — clé PARTAGÉE
//   (origine) plafond dur    bloque             — clé PARTAGÉE, survie serveur
//   (identifiant)            second facteur     — clé PARTAGÉE
//
// LA RÈGLE QUI ORDONNE TOUT CELA : aucun compteur PARTAGÉ entre utilisateurs ne
// doit pouvoir refuser un utilisateur légitime. Le compteur (origine,
// identifiant) a le droit de bloquer parce qu'il n'est partagé avec personne.
// Le compteur par origine, lui, est partagé par tout un NAT : sa conséquence
// normale est une ÉLÉVATION D'EXIGENCE, pas un refus. Le plafond dur n'est pas
// une mesure de sécurité mais une mesure de survie — il protège le processus de
// l'épuisement CPU d'Argon2 et se situe assez haut pour qu'aucun trafic
// légitime ne l'atteigne.
//
// AUCUN SMS NE PART SUR UN BUDGET ÉPUISÉ. `secondFacteurRequis` n'est lu
// qu'APRÈS une vérification de mot de passe réussie. Sans cette règle, épuiser
// le budget d'un numéro enverrait cent SMS par heure à sa titulaire : on aurait
// remplacé un déni de service par un harcèlement facturé.
//
// LE BUDGET SE CONSOMME AVANT DE SAVOIR SI LE COMPTE EXISTE. `consommer` est
// appelé avant toute lecture de la base, sur l'identifiant tel qu'il a été
// reçu. Un numéro inventé consomme donc autant qu'un numéro réel — et ce n'est
// pas une commodité, c'est une nécessité : si seuls les comptes réels
// comptaient, soixante tentatives sur un identifiant suffiraient à savoir s'il
// existe (429 ⇒ oui, 401 jusqu'au bout ⇒ non). On rouvrirait S-06-B sur un
// autre code de retour.
// ============================================================================

export const LOGIN_THROTTLE = Symbol('LOGIN_THROTTLE');

export interface DecisionLimiteur {
  /** Faux ⇒ la tentative est refusée sans même consulter la base. */
  autorise: boolean;
  /**
   * Vrai ⇒ si le mot de passe s'avère correct, exiger un second facteur.
   * N'a AUCUN effet tant que le mot de passe n'a pas été prouvé.
   */
  secondFacteurRequis: boolean;
  /** Vrai ⇒ Redis est indisponible, on fonctionne sur le repli mémoire. */
  degrade: boolean;
}

export interface LoginThrottle {
  /**
   * RÉSERVE une unité des trois budgets et rend la décision. Appelé AVANT toute
   * lecture du compte. `identifiant` est la chaîne reçue, existante ou non — le
   * limiteur n'a aucun moyen de savoir si elle correspond à un compte, et c'est
   * une propriété de sécurité, pas un effet de bord.
   */
  consommer(
    ip: string | undefined,
    identifiant: string,
  ): Promise<DecisionLimiteur>;

  /**
   * LE MOT DE PASSE VIENT D'ÊTRE PROUVÉ — on rembourse la réservation.
   *
   * Le nom dit QUAND appeler, pas ce que cela produit : à l'instant précis où
   * `argon2.verify` a répondu vrai, et AVANT les contrôles d'état du compte
   * (verrou, statut, OTP). Un titulaire légitime dont le compte est ensuite
   * refusé pour une raison parfaitement valable a tout de même prouvé qu'il
   * n'est pas un attaquant : il n'a aucune raison de continuer à peser sur le
   * budget partagé de son voisin de NAT.
   *
   * CE N'EST PAS UNE DÉCISION DE SÉCURITÉ. Cette méthode n'autorise rien, ne
   * refuse rien et ne rend rien. La déplacer plus loin dans le flux dégrade
   * l'équité, jamais la sécurité — mais c'est déjà une raison suffisante.
   */
  preuveDuMotDePasse(
    ip: string | undefined,
    identifiant: string,
  ): Promise<void>;
}

export interface Budget {
  max: number;
  fenetreSecondes: number;
}

/**
 * Le compteur par origine a DEUX seuils, parce qu'il a deux rôles distincts
 * qu'il serait faux de confondre :
 *   `maxVigilance` — au-delà, on exige le second facteur. Non bloquant.
 *   `maxDur`       — au-delà, on refuse. Protection du CPU, pas de la sécurité.
 */
export interface BudgetOrigine {
  maxVigilance: number;
  maxDur: number;
  fenetreSecondes: number;
}

export interface Budgets {
  parOrigineEtIdentifiant: Budget;
  parOrigine: BudgetOrigine;
  parIdentifiant: Budget;
}

// ============================================================================
// VALEURS PROVISOIRES — À RECALIBRER SUR DU TRAFIC RÉEL
//
// Ces nombres sont des ordres de grandeur raisonnés, PAS des valeurs mesurées.
// Nous ne savons pas encore combien d'abonnés partagent une adresse chez les
// opérateurs camerounais, ni quel est le taux réel de faute de frappe. Le
// raisonnement qui a conduit à ces valeurs :
//
//   parOrigine.maxDur = 500 échecs / 15 min
//     Une vérification Argon2 coûte ~74 ms (mesuré). Le pool libuv en traite
//     quatre de front, soit ~54/s par instance. 500 échecs par quart d'heure
//     restent très en deçà, et aucun NAT légitime ne produit ce volume
//     d'ÉCHECS — les succès, eux, ne comptent pas.
//
//   parOrigine.maxVigilance = 50 échecs / 15 min
//     Un NAT de mille abonnés avec 5 % de fautes de frappe atteindrait ce seuil.
//     Conséquence : un SMS de plus, jamais un refus. C'est précisément pour
//     cela que ce seuil n'est pas bloquant.
//
// AUCUN TEST NE DOIT DÉPENDRE DE CES NOMBRES. Les tests injectent leurs propres
// budgets et vérifient le COMPORTEMENT — « le coup au-delà du seuil est
// refusé », « le succès rembourse » — jamais la valeur 5, 50, 500 ou 100. On
// peut donc recalibrer sans faire tomber une seule assertion.
// ============================================================================
export const BUDGETS_PAR_DEFAUT: Budgets = {
  parOrigineEtIdentifiant: { max: 5, fenetreSecondes: 15 * 60 },
  parOrigine: { maxVigilance: 50, maxDur: 500, fenetreSecondes: 15 * 60 },
  parIdentifiant: { max: 100, fenetreSecondes: 60 * 60 },
};

// ============================================================================
// LES BORNES — A3
//
// UNE VALEUR ABSENTE N'EST PAS UNE VALEUR FAUSSE. L'absence signifie « je m'en
// remets au défaut » et reste parfaitement légitime. Une valeur PRÉSENTE mais
// inexploitable est autre chose : quelqu'un a écrit quelque chose, et le
// silence l'aurait trahi.
//
// LA PREMIÈRE VERSION CORRIGEAIT EN SILENCE. `LOGIN_THROTTLE_ORIGINE_DUR=abc`
// ou `=0` retombait sur le défaut sans un mot. L'opérateur croyait avoir
// désactivé ou réglé un compteur ; il n'en était rien, et rien ne le lui
// disait. C'est exactement la classe de défaut que `production-readiness.ts`
// existe pour rendre impossible : une configuration qui FONCTIONNE en faisant
// le contraire de ce qu'on croit.
//
// LE ZÉRO EST REFUSÉ, PAS RÉINTERPRÉTÉ. Il n'existe aucun moyen de désactiver
// un compteur par la configuration — et c'est voulu. Qui voudrait le faire
// doit changer le code, donc passer par une relecture.
// ============================================================================
export const BORNES_BUDGETS = {
  maxMin: 1,
  maxMax: 100_000,
  fenetreMinSecondes: 1,
  fenetreMaxSecondes: 24 * 60 * 60,
} as const;

const CLES_MAX = [
  'LOGIN_THROTTLE_OI_MAX',
  'LOGIN_THROTTLE_ORIGINE_VIGILANCE',
  'LOGIN_THROTTLE_ORIGINE_DUR',
  'LOGIN_THROTTLE_IDENTIFIANT_MAX',
] as const;

const CLES_FENETRE = [
  'LOGIN_THROTTLE_OI_FENETRE_S',
  'LOGIN_THROTTLE_ORIGINE_FENETRE_S',
  'LOGIN_THROTTLE_IDENTIFIANT_FENETRE_S',
] as const;

/**
 * Le repli de chaque variable : la valeur que le limiteur utiliserait
 * réellement si elle était absente. Les contrôles de bornes et de cohérence
 * s'appuient dessus, pour ne jamais raisonner sur une valeur fictive.
 */
const DEFAUT_PAR_CLE: Record<string, number> = {
  LOGIN_THROTTLE_OI_MAX: BUDGETS_PAR_DEFAUT.parOrigineEtIdentifiant.max,
  LOGIN_THROTTLE_ORIGINE_VIGILANCE: BUDGETS_PAR_DEFAUT.parOrigine.maxVigilance,
  LOGIN_THROTTLE_ORIGINE_DUR: BUDGETS_PAR_DEFAUT.parOrigine.maxDur,
  LOGIN_THROTTLE_IDENTIFIANT_MAX: BUDGETS_PAR_DEFAUT.parIdentifiant.max,
  LOGIN_THROTTLE_OI_FENETRE_S:
    BUDGETS_PAR_DEFAUT.parOrigineEtIdentifiant.fenetreSecondes,
  LOGIN_THROTTLE_ORIGINE_FENETRE_S:
    BUDGETS_PAR_DEFAUT.parOrigine.fenetreSecondes,
  LOGIN_THROTTLE_IDENTIFIANT_FENETRE_S:
    BUDGETS_PAR_DEFAUT.parIdentifiant.fenetreSecondes,
};

/** Une lecture de configuration, quelle qu'en soit la source. */
export type LecteurConfig = (cle: string) => string | undefined;

/**
 * Les défauts d'une configuration de budgets, en clair. Tableau vide ⇒ saine.
 *
 * Fonction pure et partagée : `budgetsDepuis` s'en sert pour refuser de
 * construire des budgets incohérents, et `production-readiness.ts` pour les
 * énumérer dans le rapport de démarrage. Une seule règle, deux lecteurs — sinon
 * les deux finiraient par diverger.
 */
export function defautsDeBudgets(lire: LecteurConfig): string[] {
  const defauts: string[] = [];

  // CHAQUE CLÉ N'EST LUE — DONC SIGNALÉE — QU'UNE SEULE FOIS. `lireEntier` a un
  // effet de bord : il empile un défaut quand la valeur est illisible. Relire
  // la même clé pour le contrôle de cohérence dupliquait donc son message, et
  // l'opérateur voyait deux fois le même reproche. Le mémo ci-dessous supprime
  // la cause plutôt que le symptôme.
  //
  // LE REPLI EST LE VRAI DÉFAUT DE LA CLÉ, pas une borne. Une version
  // antérieure repliait sur `BORNES_BUDGETS.maxMin` : une variable absente
  // valait alors 1, et les relations de cohérence se vérifiaient contre une
  // valeur que le limiteur n'utiliserait jamais.
  const cache = new Map<string, number>();
  const lireEntier = (cle: string): number => {
    const memo = cache.get(cle);
    if (memo !== undefined) return memo;

    const defaut = DEFAUT_PAR_CLE[cle];
    const brut = lire(cle);
    let valeur = defaut;

    if (brut !== undefined && brut.trim() !== '') {
      const n = Number(brut);
      if (Number.isInteger(n)) valeur = n;
      else defauts.push(`${cle} = « ${brut} » n'est pas un entier.`);
    }

    cache.set(cle, valeur);
    return valeur;
  };

  for (const cle of CLES_MAX) {
    const v = lireEntier(cle);
    if (v < BORNES_BUDGETS.maxMin || v > BORNES_BUDGETS.maxMax) {
      defauts.push(
        `${cle} = ${v} hors bornes [${BORNES_BUDGETS.maxMin}, ${BORNES_BUDGETS.maxMax}].`,
      );
    }
  }

  for (const cle of CLES_FENETRE) {
    const v = lireEntier(cle);
    if (
      v < BORNES_BUDGETS.fenetreMinSecondes ||
      v > BORNES_BUDGETS.fenetreMaxSecondes
    ) {
      defauts.push(
        `${cle} = ${v} hors bornes [${BORNES_BUDGETS.fenetreMinSecondes}, ${BORNES_BUDGETS.fenetreMaxSecondes}] secondes.`,
      );
    }
  }

  // LA COHÉRENCE DES DEUX SEUILS D'ORIGINE. Inversés, le plafond dur se
  // déclenche AVANT le seuil de vigilance : le palier non bloquant devient
  // inatteignable et l'on retombe sur le refus pur — précisément le déni de
  // service collatéral que cette architecture existe pour supprimer. Rien ne
  // casse, rien n'alerte : le mécanisme fait le contraire de ce qu'on croit.
  const vigilance = lireEntier('LOGIN_THROTTLE_ORIGINE_VIGILANCE');
  const dur = lireEntier('LOGIN_THROTTLE_ORIGINE_DUR');
  if (vigilance >= dur) {
    defauts.push(
      `LOGIN_THROTTLE_ORIGINE_VIGILANCE (${vigilance}) doit être STRICTEMENT ` +
        `inférieur à LOGIN_THROTTLE_ORIGINE_DUR (${dur}) : sinon le palier de ` +
        `vigilance, qui n'est pas bloquant, devient inatteignable et le ` +
        `compteur par origine redevient un refus pur.`,
    );
  }

  // ==========================================================================
  // LE BUDGET PRIVÉ DOIT TRANCHER AVANT LES BUDGETS PARTAGÉS — C1
  //
  // TOUTE L'ARCHITECTURE REPOSE SUR UNE SEULE PHRASE : aucun compteur partagé
  // entre utilisateurs ne doit pouvoir refuser un utilisateur légitime. Le
  // compteur (origine, identifiant) a le droit de bloquer parce qu'il n'est
  // partagé avec personne ; ceux par origine et par identifiant ne l'ont pas.
  //
  // OR CETTE PHRASE N'ÉTAIT GARANTIE QUE PAR DE BONNES VALEURS PAR DÉFAUT.
  // Mesuré le 2026-08-14 sur le code réel, avec `oiMax = 20` et `maxDur = 10` :
  // l'attaquant est refusé au onzième coup PAR LE COMPTEUR PARTAGÉ, et un
  // voisin légitime de la même origine se voit refuser à son tour. Le déni de
  // service collatéral que tout ce chantier a fermé se rouvrait par une seule
  // variable d'environnement — sans que rien ne le signale.
  //
  // POURQUOI « + 2 » ET NON UNE INÉGALITÉ STRICTE. `consommer` incrémente les
  // trois compteurs AVANT de décider : au coup qui le bloque, l'attaquant a
  // déjà porté le compteur d'origine à `oiMax + 1`. La tentative du voisin
  // l'incrémente une fois de plus, à `oiMax + 2`. Mesuré : avec
  // `oiMax = 49, maxDur = 50`, le voisin est DÉJÀ bloqué. La marge de deux
  // n'est donc pas une précaution, c'est le minimum arithmétique.
  //
  // LA TROISIÈME RELATION EST REDONDANTE, ET ON LA GARDE QUAND MÊME.
  // `oiMax + 2 <= vigilance` et `vigilance < dur` impliquent
  // `oiMax + 2 < dur` : elle ne peut donc jamais être la seule violée. Elle est
  // conservée parce qu'elle nomme explicitement le risque le plus grave — le
  // refus collatéral — et qu'elle continuerait de protéger si la relation entre
  // les deux seuils d'origine venait à être assouplie un jour.
  // ==========================================================================
  const oiMax = lireEntier('LOGIN_THROTTLE_OI_MAX');
  const idMax = lireEntier('LOGIN_THROTTLE_IDENTIFIANT_MAX');

  if (oiMax + 2 > vigilance) {
    defauts.push(
      `LOGIN_THROTTLE_OI_MAX (${oiMax}) + 2 doit être ≤ ` +
        `LOGIN_THROTTLE_ORIGINE_VIGILANCE (${vigilance}) : sinon un attaquant ` +
        `seul, sur un SEUL identifiant, franchit le palier de vigilance et ` +
        `force le second facteur — donc un SMS — à tous les utilisateurs ` +
        `légitimes partageant son adresse.`,
    );
  }

  if (oiMax + 2 > dur) {
    defauts.push(
      `LOGIN_THROTTLE_OI_MAX (${oiMax}) + 2 doit être ≤ ` +
        `LOGIN_THROTTLE_ORIGINE_DUR (${dur}) : sinon c'est le compteur PARTAGÉ ` +
        `par origine qui tranche avant le compteur privé, et un attaquant seul ` +
        `bloque tous les utilisateurs légitimes derrière la même adresse — le ` +
        `déni de service collatéral que S-06-C a précisément fermé.`,
    );
  }

  if (oiMax > idMax) {
    defauts.push(
      `LOGIN_THROTTLE_OI_MAX (${oiMax}) doit être ≤ ` +
        `LOGIN_THROTTLE_IDENTIFIANT_MAX (${idMax}) : sinon les échecs d'une ` +
        `origine unique suffisent à exiger le second facteur sur le compte ` +
        `visé, alors que ce compteur existe pour détecter un bourrage ` +
        `DISTRIBUÉ, venu de nombreuses origines.`,
    );
  }

  return defauts;
}

/**
 * Les budgets tels que l'environnement les définit, avec les valeurs
 * provisoires ci-dessus en repli pour les variables ABSENTES.
 *
 * LÈVE si une variable présente est inexploitable ou si les seuils sont
 * incohérents. C'est délibérément plus strict que `production-readiness.ts`,
 * qui ne refuse qu'en production : une configuration fausse doit être bruyante
 * partout, y compris sur le poste de celui qui vient de la saisir.
 */
export function budgetsDepuis(config: ConfigService): Budgets {
  const lire: LecteurConfig = (cle) => config.get<string>(cle);
  const defauts = defautsDeBudgets(lire);
  if (defauts.length > 0) {
    throw new Error(
      `Budgets du limiteur de connexion invalides :\n  — ` +
        defauts.join('\n  — '),
    );
  }

  const nombre = (cle: string, defaut: number): number => {
    const brut = config.get<string>(cle);
    // `defautsDeBudgets` vient de garantir que toute valeur présente est un
    // entier dans les bornes : il ne reste ici qu'à distinguer présent d'absent.
    return brut === undefined || brut.trim() === '' ? defaut : Number(brut);
  };

  const d = BUDGETS_PAR_DEFAUT;
  return {
    parOrigineEtIdentifiant: {
      max: nombre('LOGIN_THROTTLE_OI_MAX', d.parOrigineEtIdentifiant.max),
      fenetreSecondes: nombre(
        'LOGIN_THROTTLE_OI_FENETRE_S',
        d.parOrigineEtIdentifiant.fenetreSecondes,
      ),
    },
    parOrigine: {
      maxVigilance: nombre(
        'LOGIN_THROTTLE_ORIGINE_VIGILANCE',
        d.parOrigine.maxVigilance,
      ),
      maxDur: nombre('LOGIN_THROTTLE_ORIGINE_DUR', d.parOrigine.maxDur),
      fenetreSecondes: nombre(
        'LOGIN_THROTTLE_ORIGINE_FENETRE_S',
        d.parOrigine.fenetreSecondes,
      ),
    },
    parIdentifiant: {
      max: nombre('LOGIN_THROTTLE_IDENTIFIANT_MAX', d.parIdentifiant.max),
      fenetreSecondes: nombre(
        'LOGIN_THROTTLE_IDENTIFIANT_FENETRE_S',
        d.parIdentifiant.fenetreSecondes,
      ),
    },
  };
}

/**
 * La décision, à partir des trois compteurs. Isolée pour que les deux
 * implémentations — Redis et mémoire — ne puissent pas diverger sur la règle,
 * seulement sur la façon de compter.
 */
export function decider(
  compteurs: {
    origineEtIdentifiant: number;
    origine: number;
    identifiant: number;
  },
  budgets: Budgets,
  degrade: boolean,
): DecisionLimiteur {
  return {
    autorise:
      compteurs.origineEtIdentifiant <= budgets.parOrigineEtIdentifiant.max &&
      // Le PLAFOND DUR, jamais le seuil de vigilance : celui-ci ne bloque pas.
      compteurs.origine <= budgets.parOrigine.maxDur,
    // Jamais bloquant — voir l'en-tête de ce fichier.
    secondFacteurRequis:
      compteurs.identifiant > budgets.parIdentifiant.max ||
      compteurs.origine > budgets.parOrigine.maxVigilance,
    degrade,
  };
}
