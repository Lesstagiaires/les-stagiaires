import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import Redis from 'ioredis';
import { AuditService } from '../../audit/audit.service';
import { BUDGETS_PAR_DEFAUT, decider } from './login-throttle.interface';
import type {
  Budgets,
  DecisionLimiteur,
  LoginThrottle,
} from './login-throttle.interface';
import { MemoryLoginThrottle } from './memory-login-throttle';
import { prefixeIp } from './prefixe-ip';

// ============================================================================
// LE LIMITEUR SUR REDIS — S-06-C
//
// UNE CONNEXION DÉDIÉE, JAMAIS CELLE DE BullMQ. La tentation était réelle :
// `ioredis` est déjà là, BullMQ ouvre déjà des connexions. Mais les siennes
// sont réglées pour des commandes BLOQUANTES (`BRPOPLPUSH` et compagnie) et
// portent `maxRetriesPerRequest: null` — une commande peut y attendre
// indéfiniment. Emprunter ce réglage sur le chemin d'authentification ferait
// pendre une connexion entière au premier hoquet réseau. Ici, tout est borné :
// trois secondes pour se connecter, deux pour répondre, une seule tentative.
//
// LES CLÉS SONT DES HMAC. Sans cela, `KEYS *` sur Redis rendrait l'annuaire
// des numéros de téléphone qui tentent de se connecter — c'est-à-dire, sur
// cette plateforme, l'annuaire de jeunes gens. Un condensat simple ne
// suffirait pas : l'espace des numéros camerounais tient dans une table
// arc-en-ciel calculée en quelques minutes. Le HMAC exige un secret, et ce
// secret est obligatoire en production.
//
// UN SEUL ALLER-RETOUR. Les trois compteurs sont incrémentés par un script Lua
// atomique. Trois `INCR` séparés ajouteraient trois latences réseau au chemin
// de connexion, et laisseraient une fenêtre où les compteurs divergent.
//
// LE `EXPIRE` N'EST POSÉ QU'À LA PREMIÈRE INCRÉMENTATION. Le reposer à chaque
// coup ferait glisser la fenêtre sans fin : un attaquant régulier maintiendrait
// son compteur éternellement vivant, et le budget ne se libérerait jamais.
//
// LE DISJONCTEUR. Trois erreurs consécutives et l'on cesse d'appeler Redis
// pendant trente secondes. Sans lui, chaque connexion paierait le délai
// d'expiration : un Redis en panne ralentirait toute l'authentification au lieu
// de simplement la dégrader.
//
// FAIL-OPEN, ET CE CHOIX SE JUSTIFIE. Redis absent, on retombe sur le compteur
// mémoire et l'on continue. Fail-closed transformerait une panne de cache en
// panne totale d'authentification, pour un mécanisme qui est un limiteur de
// débit et non une autorisation. Surtout : LA PASSE 1 NE DÉPEND PAS DE REDIS.
// L'uniformité des réponses et le condensat factice sont du code synchrone —
// une panne Redis dégrade la protection contre le bourrage, elle ne rouvre
// jamais l'oracle d'énumération.
// ============================================================================

const SCRIPT_INCREMENTER = `
local r = {}
for i = 1, 3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i]))
  end
  r[i] = n
end
return r
`;

// ============================================================================
// LE REMBOURSEMENT — atomique, et défensif sur quatre points
//
//   KEYS[1] (origine, identifiant) : DEL. Clé privée à un identifiant ; pour
//     l'effacer il faut avoir prouvé son mot de passe.
//   KEYS[2] (origine) et KEYS[3] (identifiant) : DECR. Clés PARTAGÉES — un DEL
//     y serait un contournement : se connecter à son propre compte effacerait
//     le compteur d'échecs de tous les voisins de NAT.
//
// `EXISTS` AVANT `DECR` : sans cette garde, `DECR` sur une clé absente la CRÉE
// à −1 — et SANS TTL. On ressusciterait un compteur que le temps avait effacé,
// avec une valeur négative (donc du budget offert) et une fuite mémoire
// permanente dans Redis. Trois défauts d'une seule ligne manquante.
//
// `INCR` DE RATTRAPAGE PLUTÔT QUE `SET 0` : remettre à zéro par `SET`
// effacerait le TTL, sauf à employer `KEEPTTL` — disponible seulement depuis
// Redis 6.0. `INCR` annule exactement le `DECR` de trop et ne touche jamais à
// l'expiration, quelle que soit la version.
//
// AUCUNE COMMANDE ICI NE MODIFIE UN TTL. C'est voulu : rembourser ne doit pas
// faire glisser la fenêtre, sinon un attaquant régulier maintiendrait la
// sienne en vie indéfiniment.
// ============================================================================
const SCRIPT_REMBOURSER = `
redis.call('DEL', KEYS[1])
for i = 2, 3 do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    if redis.call('DECR', KEYS[i]) < 0 then
      redis.call('INCR', KEYS[i])
    end
  end
end
return 1
`;

const ERREURS_AVANT_OUVERTURE = 3;
const DUREE_OUVERTURE_MS = 30_000;

@Injectable()
export class RedisLoginThrottle implements LoginThrottle, OnModuleDestroy {
  private readonly journal = new Logger(RedisLoginThrottle.name);
  private readonly redis: Redis;
  private readonly secret: string;
  private readonly budgets: Budgets;
  // LE REPLI PARTAGE LES MÊMES BUDGETS. Le laisser sur ses valeurs par défaut
  // aurait produit un mode dégradé aux limites différentes de celles
  // configurées — une panne Redis aurait alors changé la politique de sécurité
  // en même temps que le support de comptage.
  private readonly repli: MemoryLoginThrottle;
  /**
   * La connexion est ouverte au plus tôt, mais l'ouverture est ASYNCHRONE.
   * Sans attendre ici, la toute première commande partirait sur une connexion
   * non établie — avec `enableOfflineQueue: false`, elle échouerait aussitôt et
   * le limiteur se croirait dégradé alors que Redis se porte bien. Observé en
   * test : zéro clé écrite, tout le comptage en mémoire, sans le moindre
   * signal. On attend donc une fois, au premier appel.
   */
  private readonly prete: Promise<void>;

  private erreursConsecutives = 0;
  private ouvertJusqua = 0;
  /** Empêche d'inonder le journal d'audit : un événement par bascule. */
  private degradationSignalee = false;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    budgets: Budgets = BUDGETS_PAR_DEFAUT,
  ) {
    this.budgets = budgets;
    this.repli = new MemoryLoginThrottle(budgets);
    this.secret = this.config.get<string>('LOGIN_THROTTLE_HMAC_SECRET', '');

    this.redis = new Redis(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      {
        connectTimeout: 3_000,
        commandTimeout: 2_000,
        maxRetriesPerRequest: 1,
        // Délai de grâce à la fermeture, avant destruction forcée de la prise.
        // La valeur par défaut d'ioredis est de deux secondes — et ce minuteur
        // court jusqu'au bout quand la connexion n'a jamais été établie, car
        // aucun `close` ne vient l'annuler. Il retardait d'autant l'arrêt du
        // processus : diagnostiqué par `--detectOpenHandles`, qui le désignait
        // nommément. Un demi-seconde suffit largement à fermer une prise TCP.
        disconnectTimeout: 500,
        enableOfflineQueue: false,
        lazyConnect: true,
        // Le limiteur ne doit jamais faire tomber le démarrage : s'il n'y
        // arrive pas, il dégrade. D'où l'absence de `retryStrategy` agressive.
        retryStrategy: (tentatives) => Math.min(tentatives * 500, 5_000),
      },
    );
    // Une connexion Redis en erreur émet `error` ; sans écouteur, Node arrête
    // le processus. On note et on laisse le disjoncteur décider.
    this.redis.on('error', (e) => this.journal.debug(`Redis: ${e.message}`));
    this.prete = this.redis
      .connect()
      .then(() => undefined)
      .catch(() => undefined);
  }

  // `quit()` attend que Redis acquitte la fermeture — c'est la sortie propre.
  // Mais sur une connexion jamais établie, ou vers un serveur tombé, elle
  // rejette : il reste alors une prise ouverte que Node compte comme un
  // descripteur actif, et le processus ne se termine plus. `disconnect()`
  // ferme sans négocier. Les deux ensemble garantissent qu'aucune connexion
  // ne survit à l'arrêt du module — ni en production, ni entre deux tests.
  // ==========================================================================
  // FERMER POUR DE BON — un Redis absent retente sans fin
  //
  // Trois gestes, et les trois sont nécessaires :
  //
  //   `retryStrategy = null` d'abord. Tant qu'elle rend un délai, ioredis
  //     replanifie une reconnexion — y compris APRÈS une demande de fermeture,
  //     si une tentative était déjà en vol. C'est ce minuteur qui maintenait le
  //     processus de test en vie, alors qu'aucune connexion ne survivait :
  //     observé par isolation, seul le bloc « Redis indisponible » retenait la
  //     main.
  //   `quit()` ensuite, et seulement si la connexion est établie : c'est la
  //     sortie négociée, celle qui laisse Redis libérer sa prise proprement.
  //     Sur un client en reconnexion, elle ne ferait rien d'utile.
  //   `disconnect(false)` enfin, dans tous les cas — `false` disant
  //     explicitement « et ne te reconnecte pas ».
  // ==========================================================================
  async onModuleDestroy(): Promise<void> {
    this.redis.options.retryStrategy = () => null;
    try {
      if (this.redis.status === 'ready') await this.redis.quit();
    } finally {
      this.redis.disconnect(false);
      this.redis.removeAllListeners();
    }
  }

  /**
   * La clé telle qu'elle existe dans Redis. Ni le numéro ni l'origine n'y
   * apparaissent : seul leur HMAC, tronqué à 32 caractères — largement assez
   * pour qu'une collision soit hors de portée, assez court pour rester lisible
   * dans `redis-cli`.
   */
  private cle(prefixe: string, valeur: string): string {
    const empreinte = createHmac('sha256', this.secret)
      .update(valeur)
      .digest('base64url')
      .slice(0, 32);
    return `lt:${prefixe}:${empreinte}`;
  }

  private disjoncteurOuvert(): boolean {
    return Date.now() < this.ouvertJusqua;
  }

  private async signalerDegradation(raison: string): Promise<void> {
    if (this.degradationSignalee) return;
    this.degradationSignalee = true;
    this.journal.warn(`Limiteur de connexion dégradé : ${raison}`);
    await this.audit
      .record('LOGIN_THROTTLE_DEGRADED', null, { raison })
      .catch(() => undefined);
  }

  private surErreur(e: unknown): void {
    this.erreursConsecutives += 1;
    if (this.erreursConsecutives >= ERREURS_AVANT_OUVERTURE) {
      this.ouvertJusqua = Date.now() + DUREE_OUVERTURE_MS;
      void this.signalerDegradation(
        e instanceof Error ? e.message : 'erreur Redis',
      );
    }
  }

  private surSucces(): void {
    this.erreursConsecutives = 0;
    // On ne remet PAS `degradationSignalee` à faux ici : le rétablissement
    // n'est pas l'événement qu'on surveille, et le repasser à faux ferait
    // réémettre un événement à chaque oscillation.
  }

  async consommer(
    ip: string | undefined,
    identifiant: string,
  ): Promise<DecisionLimiteur> {
    const origine = prefixeIp(ip);

    await this.prete;

    if (this.disjoncteurOuvert()) {
      const decision = await this.repli.consommer(ip, identifiant);
      return { ...decision, degrade: true };
    }

    try {
      const valeurs = (await this.redis.eval(
        SCRIPT_INCREMENTER,
        3,
        this.cle('oi', `${origine}|${identifiant}`),
        this.cle('o', origine),
        this.cle('i', identifiant),
        String(this.budgets.parOrigineEtIdentifiant.fenetreSecondes),
        String(this.budgets.parOrigine.fenetreSecondes),
        String(this.budgets.parIdentifiant.fenetreSecondes),
      )) as number[];

      this.surSucces();
      return decider(
        {
          origineEtIdentifiant: Number(valeurs[0]),
          origine: Number(valeurs[1]),
          identifiant: Number(valeurs[2]),
        },
        this.budgets,
        false,
      );
    } catch (e) {
      this.surErreur(e);
      const decision = await this.repli.consommer(ip, identifiant);
      return { ...decision, degrade: true };
    }
  }

  async preuveDuMotDePasse(
    ip: string | undefined,
    identifiant: string,
  ): Promise<void> {
    await this.prete;
    const origine = prefixeIp(ip);

    // Le repli est tenu à jour même quand Redis répond : sans cela, une bascule
    // en mode dégradé hériterait de compteurs jamais remboursés, et le repli
    // serait plus sévère que le nominal au pire moment.
    await this.repli.preuveDuMotDePasse(ip, identifiant);

    if (this.disjoncteurOuvert()) return;
    try {
      await this.redis.eval(
        SCRIPT_REMBOURSER,
        3,
        this.cle('oi', `${origine}|${identifiant}`),
        this.cle('o', origine),
        this.cle('i', identifiant),
      );
      this.surSucces();
    } catch (e) {
      // ÉCHOUER ICI NE REND JAMAIS LE SYSTÈME PLUS PERMISSIF : le compteur
      // reste au niveau où la réservation l'avait laissé. On dégrade du bon
      // côté — plus strict, jamais plus laxiste — et le disjoncteur s'en
      // occupe comme de n'importe quelle erreur Redis.
      this.surErreur(e);
    }
  }

  /** Réservé aux tests : observer l'état du disjoncteur. */
  estDegrade(): boolean {
    return this.disjoncteurOuvert();
  }
}
