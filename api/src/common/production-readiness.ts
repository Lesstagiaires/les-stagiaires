import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { defautsDeBudgets } from '../auth/login-throttle/login-throttle.interface';

// ============================================================================
// L'API REFUSE DE DÉMARRER EN PRODUCTION AVEC UNE VALEUR DE DÉVELOPPEMENT
//
// LE PROBLÈME QU'ON CHERCHE À RENDRE IMPOSSIBLE. Toutes les valeurs contrôlées
// ici ont un défaut de développement qui FONCTIONNE. Rien ne casse, aucune
// exception n'est levée, les journaux restent verts — et le système fait
// silencieusement le contraire de ce qu'on croit :
//
//   — `SMS_PROVIDER=console` : les codes à usage unique et les demandes de
//     consentement parental ne partent nulle part. Personne ne peut s'inscrire,
//     et surtout AUCUN parent n'est sollicité pour un mineur. C'est le plus
//     grave de la liste (CLAUDE.md §5).
//   — `APP_PUBLIC_URL=http://localhost:3000` : les liens de parrainage et les
//     QR codes pointent vers la machine du développeur. Un QR code imprimé sur
//     un flyer avec cette valeur est irrattrapable — on ne rappelle pas mille
//     affiches.
//   — `PAYMENT_GATEWAY_PROVIDER=simulated` : la passerelle simulée confirme
//     tout. Les abonnements deviennent gratuits sans que personne le remarque.
//   — `STORAGE_PROVIDER=local` : les pièces d'identité et les diplômes du
//     Coffre-fort restent sur le disque du serveur applicatif, hors du stockage
//     chiffré prévu (CLAUDE.md §4 et §6).
//   — `MALWARE_SCANNER_PROVIDER` désactivé : plus aucune analyse antivirus des
//     fichiers déposés par les utilisateurs (CLAUDE.md §4).
//
// POURQUOI UN REFUS DE DÉMARRER, ET PAS UN AVERTISSEMENT. Un avertissement se
// noie dans les journaux d'un déploiement. Le seul moment où l'on est certain
// que quelqu'un regarde, c'est quand le service ne démarre pas. La panne est
// bruyante, immédiate, et arrive AVANT le premier utilisateur — pas après le
// premier mineur inscrit sans que son parent ait rien reçu.
//
// CE CONTRÔLE NE S'APPLIQUE QU'EN PRODUCTION. En développement et en recette,
// ces valeurs sont exactement ce qu'il faut : personne ne veut envoyer de vrais
// SMS en écrivant du code.
// ============================================================================

export interface ConfigurationDefect {
  key: string;
  found: string;
  why: string;
}

// Ce qui doit avoir changé avant la production. Chaque entrée dit ce qui se
// passe si on l'oublie — c'est ce qui rend le message d'erreur utile à celui
// qui le lira à trois heures du matin.
const DEV_ONLY_VALUES: {
  key: string;
  rejected: (value: string | undefined) => boolean;
  why: string;
}[] = [
  {
    key: 'SMS_PROVIDER',
    rejected: (v) => !v || v === 'console',
    why: 'Les codes OTP et les consentements parentaux ne partiraient nulle part. Aucun parent ne serait sollicité pour un mineur (CLAUDE.md §5).',
  },
  {
    key: 'EMAIL_PROVIDER',
    rejected: (v) => !v || v === 'console',
    why: 'Aucun e-mail ne partirait — ni notification, ni décision de partenariat.',
  },
  {
    key: 'APP_PUBLIC_URL',
    rejected: (v) =>
      !v ||
      v.includes('localhost') ||
      v.includes('127.0.0.1') ||
      v.startsWith('http://'),
    why: 'Les liens de parrainage et les QR codes pointeraient vers une adresse locale ou non chiffrée. Un QR code imprimé est irrattrapable.',
  },
  {
    key: 'PAYMENT_GATEWAY_PROVIDER',
    rejected: (v) => !v || v === 'simulated',
    why: 'La passerelle simulée confirme tout paiement : les abonnements deviendraient gratuits.',
  },
  {
    key: 'STORAGE_PROVIDER',
    rejected: (v) => !v || v === 'local',
    why: 'Les pièces d’identité et diplômes du Coffre-fort numérique resteraient sur le disque du serveur applicatif, hors du stockage chiffré (CLAUDE.md §4).',
  },
  {
    key: 'MALWARE_SCANNER_PROVIDER',
    rejected: (v) => !v || v === 'none' || v === 'noop' || v === 'disabled',
    why: 'Aucune analyse antivirus des fichiers déposés par les utilisateurs (CLAUDE.md §4).',
  },
  {
    key: 'FIELD_ENCRYPTION_KEYS',
    rejected: (v) => !v,
    why: 'Sans trousseau, les coordonnées de paiement ne peuvent être ni chiffrées ni relues.',
  },
  {
    key: 'FIELD_ENCRYPTION_ACTIVE_KEY',
    rejected: (v) => !v,
    why: 'Aucune clé active désignée : le chiffrement des coordonnées de paiement ne démarrerait pas.',
  },
  {
    key: 'LOGIN_THROTTLE_PROVIDER',
    rejected: (v) => v !== 'redis',
    why: 'Le limiteur de connexion compterait en mémoire, par processus : avec plusieurs instances, les budgets seraient multipliés par leur nombre et le bourrage passerait (S-06-C).',
  },
  {
    key: 'LOGIN_THROTTLE_HMAC_SECRET',
    rejected: (v) => !v || v.length < 32,
    why: "Sans secret, les clés Redis du limiteur seraient l'annuaire des numéros de téléphone qui tentent de se connecter — l'espace camerounais se retrouve en quelques minutes par table arc-en-ciel.",
  },
  {
    // ======================================================================
    // TRUST_PROXY — ON EXIGE UNE DÉCLARATION, PAS UNE VALEUR
    //
    // Mesuré le 2026-08-12 sur une application Express réelle, requête portant
    // `X-Forwarded-For: 203.0.113.9` émise depuis 127.0.0.1 :
    //   trust proxy = false -> req.ip = 127.0.0.1
    //   trust proxy = 1     -> req.ip = 203.0.113.9
    //
    // AUCUNE DES DEUX VALEURS N'EST SÛRE DANS L'ABSOLU, et c'est pourquoi ce
    // contrôle n'en impose pas une :
    //   "false" derrière un CDN  -> tout le trafic partage une seule clé. Le
    //     limiteur par IP devient une limite GLOBALE : il punit les
    //     utilisateurs légitimes et laisse l'attaquant avec son budget entier.
    //   "true" sans proxy devant -> n'importe quel client forge son en-tête et
    //     s'octroie un budget neuf à chaque requête.
    //
    // Seul le déploiement sait laquelle est juste. On refuse donc l'absence de
    // choix — c'est-à-dire le silence, qui vaudrait aujourd'hui "false" par
    // défaut sans que personne ne l'ait décidé.
    // ======================================================================
    key: 'TRUST_PROXY',
    rejected: (v) => v !== 'true' && v !== 'false',
    why: 'Valeur non déclarée : le limiteur par IP serait soit contournable (en-tête forgée), soit transformé en limite globale. Déclarer explicitement "true" derrière un proxy en façade, "false" si l\'API est exposée directement.',
  },
];

// Un secret laissé à sa valeur d'exemple est un secret public. On les cherche
// par MOTIF plutôt que par liste de noms : une variable de secret ajoutée
// demain sera couverte sans que personne pense à l'inscrire ici.
const PLACEHOLDER_SECRETS = [
  'change-me',
  'changeme',
  'secret',
  'password',
  'test',
  'example',
  'votre-cle',
  'your-key',
];

function looksLikeSecretKey(key: string): boolean {
  return /SECRET|TOKEN|PASSWORD|_KEY$|_KEYS$|API_KEY/.test(key);
}

export function findConfigurationDefects(
  config: ConfigService,
  env: NodeJS.ProcessEnv = process.env,
): ConfigurationDefect[] {
  const defects: ConfigurationDefect[] = [];

  for (const { key, rejected, why } of DEV_ONLY_VALUES) {
    const value = config.get<string>(key);
    if (rejected(value)) {
      defects.push({ key, found: value ?? '(absente)', why });
    }
  }

  // ==========================================================================
  // LES BUDGETS DU LIMITEUR DE CONNEXION — A3
  //
  // Ces défauts ne suivent pas le schéma « une clé, une valeur interdite » :
  // l'un d'eux porte sur la RELATION entre deux variables. Un seuil de
  // vigilance supérieur au plafond dur ne rend aucune valeur invalide prise
  // isolément, mais rend le palier non bloquant inatteignable — le compteur par
  // origine redevient alors un refus pur, c'est-à-dire le déni de service
  // collatéral que toute cette architecture existe pour supprimer.
  //
  // ORDRE D'EXÉCUTION, ET POURQUOI CE CONTRÔLE RESTE UTILE. `budgetsDepuis`
  // lève dès la construction du module, donc AVANT ce garde-fou appelé depuis
  // `main.ts`. En pratique une configuration invalide échoue donc plus tôt, et
  // c'est très bien. Ce contrôle reste néanmoins le lieu où la règle est
  // ÉNONCÉE pour l'opérateur, et il couvrirait le jour où le limiteur cesserait
  // d'être construit par ce module.
  // ==========================================================================
  for (const probleme of defautsDeBudgets((cle) => config.get<string>(cle))) {
    defects.push({
      key: 'LOGIN_THROTTLE (budgets)',
      found: '(configuration incohérente)',
      why: probleme,
    });
  }

  for (const [key, value] of Object.entries(env)) {
    if (!looksLikeSecretKey(key) || !value) continue;
    const normalized = value.trim().toLowerCase();
    if (
      PLACEHOLDER_SECRETS.some(
        (motif) => normalized === motif || normalized.includes(motif),
      )
    ) {
      defects.push({
        key,
        // JAMAIS la valeur : ce message part dans les journaux de démarrage,
        // qui sont souvent les moins protégés de la chaîne. Dire qu'un secret
        // est resté à sa valeur d'exemple suffit à le corriger.
        found: '(valeur d’exemple)',
        why: 'Un secret laissé à sa valeur d’exemple est un secret public.',
      });
    }
  }

  return defects;
}

// Appelé au démarrage. Lève en production, se contente d'informer ailleurs.
export function assertProductionReadiness(
  config: ConfigService,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const logger = new Logger('ProductionReadiness');
  const defects = findConfigurationDefects(config, env);

  if (env.NODE_ENV !== 'production') {
    if (defects.length > 0) {
      logger.log(
        `${defects.length} valeur(s) de développement en place — normal hors production : ` +
          defects.map((d) => d.key).join(', '),
      );
    }
    return;
  }

  if (defects.length === 0) return;

  const detail = defects
    .map((d) => `  — ${d.key} = ${d.found}\n      ${d.why}`)
    .join('\n');

  throw new Error(
    `Démarrage refusé : ${defects.length} valeur(s) de développement en production.\n\n` +
      `${detail}\n\n` +
      'Chacune de ces valeurs FONCTIONNE sans rien casser — c’est pourquoi le ' +
      'démarrage est refusé plutôt qu’un avertissement écrit dans les journaux.',
  );
}
