import 'dotenv/config';
import type { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AccountStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { AuthService } from './auth.service';
import type { Budgets } from './login-throttle/login-throttle.interface';
import { MemoryLoginThrottle } from './login-throttle/memory-login-throttle';
import { RedisLoginThrottle } from './login-throttle/redis-login-throttle';
import { TokenService } from './token.service';

// ============================================================================
// S-06-C — UN TIERS NE PEUT PLUS VERROUILLER LE COMPTE D'AUTRUI
//
// LE DÉFAUT, MESURÉ LE 2026-08-12. Le compteur d'échecs vivait sur la ligne
// `User` de la cible. Cinq requêtes d'un inconnu excluaient son titulaire
// quinze minutes ; vingt requêtes par heure l'en excluaient indéfiniment ; six
// comptes tombaient en trente requêtes depuis une seule origine ; et le journal
// imputait le verrouillage à la victime, sans jamais nommer l'attaquant.
//
// CE QUE CES TESTS EXIGENT. Pas « le limiteur fonctionne », mais deux choses
// qu'un tiers ne doit plus pouvoir faire : empêcher quelqu'un de se connecter,
// et provoquer l'envoi d'un SMS sur son téléphone.
//
// Redis réel, PostgreSQL réel, vrai service. Les budgets sont réduits dans
// certains blocs — c'est le COMPORTEMENT qu'on vérifie, pas le nombre 5.
// ============================================================================

const BASE = 'stagiaires_it_login_throttle';
const BON = 'MotDePasseDeLaVictime1';
const MAUVAIS = 'DevinetteRatee1';
const VICTIME = '+237600000110';
const AUTRE = '+237600000111';
const INEXISTANT = '+237600000199';
const DESACTIVE = '+237600000112';
const VERROUILLE = '+237600000113';
const SECRET_HMAC = 'secret-de-test-hmac-suffisamment-long-0123456789';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
// Un port fermé sur localhost simule précisément une panne Redis sans dépendre
// d'un service externe ni d'une fuite de l'authentification en mode dégradé.
const REDIS_MORT = 'redis://127.0.0.1:1';

function configPour(url = REDIS_URL): ConfigService {
  return new ConfigService({
    REDIS_URL: url,
    LOGIN_THROTTLE_HMAC_SECRET: SECRET_HMAC,
    // Fenêtre courte : le test doit pouvoir observer les DEUX côtés du délai
    // de garde — la suppression du second SMS, puis sa reprise après échéance.
    OTP_RESEND_COOLDOWN_SECONDS: '2',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '30d',
  });
}

describe('S-06-C — le verrouillage ne dépend plus du compte visé', () => {
  let prisma: PrismaService;
  let audit: AuditService;
  let tokens: TokenService;
  let redisNu: Redis;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let victime = '';

  // LE MOCK OTP REPRODUIT LE DÉLAI DE GARDE RÉEL. `secondesDepuisDernierEnvoi`
  // interroge en vrai la table `OtpCode` ; ici on tient la même horloge en
  // mémoire. Sans cela, le test du plafond de SMS mesurerait le mock et non la
  // règle — et resterait vert quel que soit le code.
  const dernierEnvoi = new Map<string, number>();
  const otp = {
    generateAndSend: jest.fn((userId: string) => {
      dernierEnvoi.set(userId, Date.now());
      return Promise.resolve();
    }),
    verify: jest.fn(),
    secondesDepuisDernierEnvoi: jest.fn((userId: string) => {
      const t = dernierEnvoi.get(userId);
      return Promise.resolve(t === undefined ? null : (Date.now() - t) / 1000);
    }),
  };
  const absent = new Proxy(
    {},
    { get: () => () => Promise.resolve(undefined) },
  ) as never;

  // CHAQUE LIMITEUR REDIS OUVRE UNE CONNEXION. Sans ce registre et sa
  // fermeture en `afterAll`, Jest resterait suspendu sur des descripteurs
  // actifs à la fin de la suite — un `--forceExit` masquerait le symptôme sans
  // rien régler, et laisserait la même fuite en production.
  const limiteurs: RedisLoginThrottle[] = [];
  const limiteurRedis = (
    cfg: ConfigService = configPour(),
    budgets?: Budgets,
  ): RedisLoginThrottle => {
    const l = new RedisLoginThrottle(cfg, audit, budgets);
    limiteurs.push(l);
    return l;
  };

  const limiteurRedisIndisponible = (budgets?: Budgets): RedisLoginThrottle => {
    const client = new Redis({ lazyConnect: true });
    client.connect = jest
      .fn()
      .mockRejectedValue(new Error('Redis indisponible')) as typeof client.connect;
    client.eval = jest
      .fn()
      .mockRejectedValue(new Error('Redis indisponible')) as typeof client.eval;
    client.disconnect = jest.fn() as typeof client.disconnect;
    client.removeAllListeners = jest.fn() as typeof client.removeAllListeners;
    const l = new RedisLoginThrottle(
      configPour(REDIS_MORT),
      audit,
      budgets,
      client,
    );
    limiteurs.push(l);
    return l;
  };

  const monter = (limiteur: unknown) =>
    new AuthService(
      prisma,
      configPour(),
      otp as never,
      tokens,
      audit,
      absent,
      absent,
      absent,
      absent,
      limiteur as never,
    );

  const creerAvec = async (
    phone: string,
    surcharges: Record<string, unknown> = {},
  ) =>
    (
      await prisma.user.create({
        data: {
          phone,
          password: await argon2.hash(BON),
          firstName: 'V',
          status: AccountStatus.ACTIVE,
          phoneVerifiedAt: new Date(),
          countryOfResidence: 'CM',
          ...surcharges,
        },
      })
    ).id;

  const creer = async (phone: string) =>
    (
      await prisma.user.create({
        data: {
          phone,
          password: await argon2.hash(BON),
          firstName: 'V',
          status: AccountStatus.ACTIVE,
          phoneVerifiedAt: new Date(),
          countryOfResidence: 'CM',
        },
      })
    ).id;

  const tenter = async (
    auth: AuthService,
    identifiant: string,
    mdp: string,
    ip?: string,
  ) => {
    try {
      const r = (await auth.login(
        { identifier: identifiant, password: mdp },
        'agent-de-test',
        ip,
      )) as { requiresTwoFactor: boolean };
      return { statut: 200, message: '', deuxFacteurs: r.requiresTwoFactor };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      return {
        statut: err.status ?? 500,
        message: err.message ?? '',
        deuxFacteurs: false,
      };
    }
  };

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE);
    prisma = database.prisma;
    audit = new AuditService(prisma);
    tokens = new TokenService(new JwtService({}), configPour(), prisma);

    redisNu = new Redis(REDIS_URL);
    victime = await creer(VICTIME);
    await creer(AUTRE);
    await creerAvec(DESACTIVE, { status: AccountStatus.DEACTIVATED });
    await creerAvec(VERROUILLE, {
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
  }, 240_000);

  afterAll(async () => {
    try {
      // Toutes les connexions du limiteur, refermees avant de rendre la main.
      await Promise.all(limiteurs.map((l) => l.onModuleDestroy()));
      await redisNu?.quit().catch(() => undefined);
    } finally {
      await database?.close();
    }
  }, 60_000);

  beforeEach(async () => {
    // `mockClear` et non `mockReset` : l'implémentation de ce mock EST le délai
    // de garde simulé ; la réinitialiser la supprimerait, et le test du plafond
    // de SMS deviendrait vert sans rien démontrer.
    otp.generateAndSend.mockClear();
    dernierEnvoi.clear();
    const cles = await redisNu.keys('lt:*');
    if (cles.length) await redisNu.del(...cles);
    await prisma.user.update({
      where: { id: victime },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  // ==========================================================================
  // LA PREUVE ATTENDUE
  // ==========================================================================
  describe("un tiers ne peut plus exclure quelqu'un de son compte", () => {
    it('5 tentatives depuis une autre origine, puis la victime se connecte', async () => {
      const auth = monter(limiteurRedis());

      for (let i = 0; i < 5; i++) {
        await tenter(auth, VICTIME, MAUVAIS, '203.0.113.9');
      }

      const compte = await prisma.user.findUniqueOrThrow({
        where: { id: victime },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      expect(compte.failedLoginAttempts).toBe(0);
      expect(compte.lockedUntil).toBeNull();

      // LA VICTIME, DEPUIS CHEZ ELLE, AVEC SON MOT DE PASSE.
      const r = await tenter(auth, VICTIME, BON, '198.51.100.4');
      expect(r.statut).toBe(200);
    });

    it('5, 10 puis 20 tentatives d’un tiers : la victime se connecte toujours', async () => {
      // LE SCÉNARIO CENTRAL DE S-06-C, POUSSÉ. L'ancien mécanisme cédait dès la
      // cinquième tentative ; à vingt, la victime était exclue pour un quart
      // d'heure, et en répétant l'opération, indéfiniment. On vérifie donc les
      // trois paliers, et l'on regarde l'état du compte à chacun d'eux.
      const auth = monter(limiteurRedis());
      let faites = 0;

      for (const palier of [5, 10, 20]) {
        // L'attaquant change d'origine à mesure — c'est ce que ferait un
        // botnet, et c'est ce qui rend le budget par origine insuffisant à lui
        // seul pour protéger la victime.
        for (; faites < palier; faites++) {
          await tenter(auth, VICTIME, MAUVAIS, `198.51.100.${100 + faites}`);
        }

        const compte = await prisma.user.findUniqueOrThrow({
          where: { id: victime },
          select: { failedLoginAttempts: true, lockedUntil: true },
        });
        // Aucune écriture sur la ligne de la victime, à aucun palier.
        expect({ palier, ...compte }).toEqual({
          palier,
          failedLoginAttempts: 0,
          lockedUntil: null,
        });

        // Et elle se connecte, depuis chez elle, à chaque fois.
        const r = await tenter(auth, VICTIME, BON, '203.0.113.250');
        expect({ palier, statut: r.statut }).toEqual({ palier, statut: 200 });
      }
    }, 180_000);

    it('même acharnement sur dix comptes : aucun n’est verrouillé', async () => {
      const auth = monter(limiteurRedis());
      const cibles: string[] = [];
      for (let i = 0; i < 10; i++) {
        cibles.push(await creer(`+2376000002${String(i).padStart(2, '0')}`));
      }

      for (const [i] of cibles.entries()) {
        for (let k = 0; k < 5; k++) {
          await tenter(
            auth,
            `+2376000002${String(i).padStart(2, '0')}`,
            MAUVAIS,
            `203.0.113.${i + 20}`,
          );
        }
      }

      const verrouilles = await prisma.user.count({
        where: { id: { in: cibles }, NOT: { lockedUntil: null } },
      });
      expect(verrouilles).toBe(0);
      // Cinquante vérifications Argon2 réelles, plus dix créations de comptes :
      // le délai par défaut de Jest (5 s) ne suffit pas. L'allonger vaut mieux
      // que d'alléger le scénario.
    }, 120_000);

    it("l'attaquant, lui, est bien freiné sur cet identifiant", async () => {
      const auth = monter(limiteurRedis());
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        codes.push(
          (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.77')).statut,
        );
      }
      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes.slice(5)).toEqual([429, 429]);
    });
  });

  // ==========================================================================
  // AUCUN SMS DÉCLENCHÉ PAR QUI IGNORE LE MOT DE PASSE
  // ==========================================================================
  describe('le second facteur ne peut pas être provoqué par un tiers', () => {
    const budgetsCourts: Budgets = {
      parOrigineEtIdentifiant: { max: 100, fenetreSecondes: 60 },
      parOrigine: { maxVigilance: 1000, maxDur: 1000, fenetreSecondes: 60 },
      // Volontairement bas : on veut franchir le seuil sans faire mille appels.
      parIdentifiant: { max: 3, fenetreSecondes: 60 },
    };

    it('épuiser le budget avec de MAUVAIS mots de passe n’envoie aucun SMS', async () => {
      const auth = monter(new MemoryLoginThrottle(budgetsCourts));

      for (let i = 0; i < 20; i++) {
        const r = await tenter(auth, VICTIME, MAUVAIS, `203.0.113.${i + 1}`);
        expect(r.statut).toBe(401);
      }

      // C'EST LA GARANTIE : cent tentatives ratées ne coûtent pas un SMS à la
      // victime. Le drapeau n'est lu qu'après la preuve du mot de passe.
      expect(otp.generateAndSend).not.toHaveBeenCalled();
    });

    it('le BON mot de passe au-delà du budget exige le second facteur', async () => {
      const auth = monter(new MemoryLoginThrottle(budgetsCourts));

      for (let i = 0; i < 5; i++) {
        await tenter(auth, VICTIME, MAUVAIS, `203.0.113.${i + 40}`);
      }
      expect(otp.generateAndSend).not.toHaveBeenCalled();

      const r = await tenter(auth, VICTIME, BON, '203.0.113.99');
      expect(r.statut).toBe(200);
      expect(r.deuxFacteurs).toBe(true);
      expect(otp.generateAndSend).toHaveBeenCalledTimes(1);
    });

    it('sous le budget, la connexion reste directe', async () => {
      const auth = monter(new MemoryLoginThrottle(budgetsCourts));
      const r = await tenter(auth, VICTIME, BON, '198.51.100.4');
      expect(r.statut).toBe(200);
      expect(r.deuxFacteurs).toBe(false);
      expect(otp.generateAndSend).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // LE LIMITEUR NE DIT PAS QUI EXISTE
  // ==========================================================================
  describe("le limiteur ne devient pas à son tour un révélateur d'existence", () => {
    it('un identifiant inexistant consomme exactement le même budget', async () => {
      const auth = monter(limiteurRedis());

      const reel: number[] = [];
      const faux: number[] = [];
      for (let i = 0; i < 7; i++) {
        reel.push(
          (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.55')).statut,
        );
      }
      for (let i = 0; i < 7; i++) {
        faux.push(
          (await tenter(auth, INEXISTANT, MAUVAIS, '203.0.113.56')).statut,
        );
      }
      expect(faux).toEqual(reel);
    });

    it('le message du 429 est rigoureusement le même', async () => {
      const auth = monter(limiteurRedis());
      for (let i = 0; i < 6; i++)
        await tenter(auth, VICTIME, MAUVAIS, '203.0.113.60');
      for (let i = 0; i < 6; i++)
        await tenter(auth, INEXISTANT, MAUVAIS, '203.0.113.61');

      const a = await tenter(auth, VICTIME, MAUVAIS, '203.0.113.60');
      const b = await tenter(auth, INEXISTANT, MAUVAIS, '203.0.113.61');
      expect(a).toEqual(b);
      expect(a.statut).toBe(429);
    });
  });

  // ==========================================================================
  // LE 429 NE DOIT RIEN APPRENDRE — NI SUR LE COMPTE, NI SUR LE MOT DE PASSE
  //
  // Si un budget épuisé rendait 429 pour un mauvais mot de passe mais 200 pour
  // le bon, l'attaquant tiendrait un oracle PARFAIT : il lui suffirait
  // d'épuiser le budget, puis de lire le code de retour pour savoir s'il vient
  // de deviner juste. Le limiteur, censé le freiner, lui répondrait.
  //
  // C'est pourquoi la décision du limiteur précède TOUT : la recherche du
  // compte comme la vérification Argon2.
  // ==========================================================================
  describe('un budget épuisé répond 429 même au BON mot de passe', () => {
    it('bon et mauvais mot de passe donnent la même réponse, au bit près', async () => {
      const auth = monter(limiteurRedis());
      const IP = '203.0.113.130';

      // On épuise le budget (5 par défaut sur ce couple origine+identifiant).
      for (let i = 0; i < 5; i++) await tenter(auth, VICTIME, MAUVAIS, IP);

      const avecMauvais = await tenter(auth, VICTIME, MAUVAIS, IP);
      const avecBon = await tenter(auth, VICTIME, BON, IP);

      expect(avecMauvais.statut).toBe(429);
      // LE POINT CENTRAL : le BON mot de passe n'ouvre rien de plus.
      expect(avecBon.statut).toBe(429);
      expect(avecBon).toEqual(avecMauvais);
    }, 30_000);

    it('et le budget épuisé n’émet aucun SMS, même avec le bon mot de passe', async () => {
      const auth = monter(limiteurRedis());
      const IP = '203.0.113.131';
      for (let i = 0; i < 5; i++) await tenter(auth, VICTIME, MAUVAIS, IP);
      otp.generateAndSend.mockClear();

      await tenter(auth, VICTIME, BON, IP);
      expect(otp.generateAndSend).not.toHaveBeenCalled();
    }, 30_000);

    it('un ÉCHEC ne libère aucun budget — seule la réussite le fait', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 3, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const auth = monter(limiteurRedis(configPour(), courts));
      const IP = '203.0.113.132';

      // Trois échecs consomment les trois unités : le budget ne se recharge pas
      // en cours de route. Si un échec libérait quoi que ce soit, la quatrième
      // tentative passerait encore.
      expect((await tenter(auth, VICTIME, MAUVAIS, IP)).statut).toBe(401);
      expect((await tenter(auth, VICTIME, MAUVAIS, IP)).statut).toBe(401);
      expect((await tenter(auth, VICTIME, MAUVAIS, IP)).statut).toBe(401);
      expect((await tenter(auth, VICTIME, MAUVAIS, IP)).statut).toBe(429);
    }, 30_000);
  });

  // ==========================================================================
  // LE MODE DÉGRADÉ NE SE VOIT PAS DE L'EXTÉRIEUR
  //
  // Savoir que Redis est tombé vaut de l'or pour un attaquant : le repli est
  // par processus, donc les budgets réels sont multipliés par le nombre
  // d'instances. Une réponse qui trahirait la panne indiquerait quand frapper.
  // ==========================================================================
  describe('aucune réponse ne révèle le mode dégradé', () => {
    const courts: Budgets = {
      parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 60 },
      parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
      parIdentifiant: { max: 100, fenetreSecondes: 60 },
    };

    /** La réponse entière — corps compris — et non le seul code de retour. */
    const corpsDe = async (auth: AuthService, mdp: string, ip: string) => {
      try {
        return {
          statut: 200,
          corps: (await auth.login(
            { identifier: VICTIME, password: mdp },
            'agent-de-test',
            ip,
          )) as unknown,
        };
      } catch (e) {
        const err = e as HttpException;
        return { statut: err.getStatus(), corps: err.getResponse() };
      }
    };

    it('le 429 dégradé est INDISCERNABLE du 429 nominal', async () => {
      const sain = monter(limiteurRedis(configPour(), courts));
      const casse = monter(limiteurRedisIndisponible(courts));

      for (let i = 0; i < 2; i++)
        await tenter(sain, VICTIME, MAUVAIS, '203.0.113.140');
      for (let i = 0; i < 2; i++)
        await tenter(casse, VICTIME, MAUVAIS, '203.0.113.141');

      const a = await corpsDe(sain, MAUVAIS, '203.0.113.140');
      const b = await corpsDe(casse, MAUVAIS, '203.0.113.141');

      expect(a.statut).toBe(429);
      expect(b.statut).toBe(429);
      expect(b.corps).toEqual(a.corps);
    }, 40_000);

    it('aucun champ de la réponse ne nomme le limiteur, Redis ou la dégradation', async () => {
      // TEST STRUCTUREL : il n'énumère aucun nom de champ attendu, il inspecte
      // la sérialisation entière. Un champ de diagnostic ajouté demain par
      // mégarde tomberait ici, même si personne n'a pensé à l'y chercher.
      const casse = monter(limiteurRedisIndisponible(courts));
      for (let i = 0; i < 2; i++)
        await tenter(casse, VICTIME, MAUVAIS, '203.0.113.142');
      const r = await corpsDe(casse, MAUVAIS, '203.0.113.142');

      const texte = JSON.stringify(r.corps).toLowerCase();
      for (const mot of [
        'degrade',
        'degraded',
        'redis',
        'fallback',
        'throttle',
        'budget',
        'memoire',
        'memory',
      ]) {
        expect(texte).not.toContain(mot);
      }
    }, 40_000);
  });

  // ==========================================================================
  // LES CLÉS REDIS
  // ==========================================================================
  describe('Redis ne conserve aucun numéro en clair', () => {
    it("aucune clé ne contient l'identifiant ni l'IP", async () => {
      const auth = monter(limiteurRedis());
      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.42');

      const cles = await redisNu.keys('lt:*');
      expect(cles.length).toBeGreaterThan(0);
      for (const cle of cles) {
        expect(cle).not.toContain(VICTIME);
        expect(cle).not.toContain('600000110');
        expect(cle).not.toContain('203.0.113.42');
      }
    });

    it('un secret différent produit des clés différentes — c’est bien un HMAC', async () => {
      const autreSecret = new ConfigService({
        REDIS_URL,
        LOGIN_THROTTLE_HMAC_SECRET: 'un-tout-autre-secret-de-test-0123456789',
      });
      const a = monter(limiteurRedis());
      await tenter(a, VICTIME, MAUVAIS, '203.0.113.43');
      const clesA = (await redisNu.keys('lt:*')).sort();

      const b = monter(limiteurRedis(autreSecret));
      await tenter(b, VICTIME, MAUVAIS, '203.0.113.43');
      const toutes = (await redisNu.keys('lt:*')).sort();

      expect(toutes.length).toBeGreaterThan(clesA.length);
    });
  });

  // ==========================================================================
  // TTL, MULTI-INSTANCE, NAT, COMPTEUR SECONDAIRE
  // ==========================================================================
  describe('le comptage lui-même', () => {
    it('le budget est rendu à expiration du TTL', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 1 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 1 },
        parIdentifiant: { max: 100, fenetreSecondes: 1 },
      };
      const auth = monter(limiteurRedis(configPour(), courts));

      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.70')).statut,
      ).toBe(401);
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.70')).statut,
      ).toBe(401);
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.70')).statut,
      ).toBe(429);

      await new Promise((r) => setTimeout(r, 1_300));

      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.70')).statut,
      ).toBe(401);
    }, 30_000);

    it('DEUX INSTANCES partagent le même état', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const instanceA = monter(limiteurRedis(configPour(), courts));
      const instanceB = monter(limiteurRedis(configPour(), courts));

      expect(
        (await tenter(instanceA, VICTIME, MAUVAIS, '203.0.113.80')).statut,
      ).toBe(401);
      expect(
        (await tenter(instanceB, VICTIME, MAUVAIS, '203.0.113.80')).statut,
      ).toBe(401);
      // La troisième dépasse le budget — quelle que soit l'instance qui la reçoit.
      expect(
        (await tenter(instanceB, VICTIME, MAUVAIS, '203.0.113.80')).statut,
      ).toBe(429);
    }, 30_000);

    it('le compteur par ORIGINE freine un balayage de nombreux identifiants', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 100, fenetreSecondes: 60 },
        // Seul le PLAFOND DUR est abaissé : on isole ainsi le blocage du
        // seuil de vigilance, qui lui ne bloque jamais.
        parOrigine: { maxVigilance: 1000, maxDur: 5, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const auth = monter(limiteurRedis(configPour(), courts));

      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        codes.push(
          (await tenter(auth, `+23760000030${i}`, MAUVAIS, '203.0.113.90'))
            .statut,
        );
      }
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    }, 30_000);

    it('deux abonnés derrière le même NAT ne se bloquent pas mutuellement', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const auth = monter(limiteurRedis(configPour(), courts));
      const NAT = '203.0.113.200';

      // Le premier épuise SON budget sur SON identifiant.
      await tenter(auth, VICTIME, MAUVAIS, NAT);
      await tenter(auth, VICTIME, MAUVAIS, NAT);
      expect((await tenter(auth, VICTIME, MAUVAIS, NAT)).statut).toBe(429);

      // Le second, derrière la même IP, n'est pas concerné.
      expect((await tenter(auth, AUTRE, BON, NAT)).statut).toBe(200);
    }, 30_000);

    it('une connexion réussie rend le budget de cette origine', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 3, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const auth = monter(limiteurRedis(configPour(), courts));

      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.210');
      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.210');
      expect((await tenter(auth, VICTIME, BON, '203.0.113.210')).statut).toBe(
        200,
      );

      // Le compteur est reparti de zéro : trois nouvelles tentatives passent.
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.210')).statut,
      ).toBe(401);
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.210')).statut,
      ).toBe(401);
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.210')).statut,
      ).toBe(401);
    }, 30_000);
  });

  // ==========================================================================
  // REDIS INDISPONIBLE
  // ==========================================================================
  describe('Redis indisponible', () => {
    // La panne est simulée par un client qui échoue immédiatement, sans socket.
    it("FAIL-OPEN : l'authentification reste possible", async () => {
      const limiteur = limiteurRedisIndisponible();
      const auth = monter(limiteur);

      // FAIL-CLOSED rendrait ici un 500 ou un 429 : une panne de cache
      // deviendrait une panne d'authentification.
      const r = await tenter(auth, VICTIME, BON, '203.0.113.150');
      expect(r.statut).toBe(200);
    }, 30_000);

    it('le repli mémoire continue de limiter', async () => {
      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const auth = monter(limiteurRedisIndisponible(courts));

      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.160');
      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.160');
      expect(
        (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.160')).statut,
      ).toBe(429);
    }, 30_000);

    it('MESURE : Redis vivant écrit trois compteurs, Redis mort n’en écrit aucun', async () => {
      // « Le repli mémoire fonctionne » ne se déduit pas de l'absence d'erreur.
      // On regarde donc DANS Redis. C'est exactement ce contrôle qui avait
      // révélé, pendant cette passe, que le limiteur comptait en mémoire alors
      // que Redis se portait bien : zéro clé écrite, aucune alerte, la
      // protection divisée par le nombre d'instances sans que rien ne le dise.
      const vivant = monter(limiteurRedis());
      await tenter(vivant, VICTIME, MAUVAIS, '203.0.113.230');
      const avecRedis = await redisNu.keys('lt:*');
      // Trois compteurs par tentative : (origine+identifiant), origine,
      // identifiant.
      expect(avecRedis).toHaveLength(3);

      const cles = await redisNu.keys('lt:*');
      if (cles.length) await redisNu.del(...cles);

      const courts: Budgets = {
        parOrigineEtIdentifiant: { max: 2, fenetreSecondes: 60 },
        parOrigine: { maxVigilance: 100, maxDur: 100, fenetreSecondes: 60 },
        parIdentifiant: { max: 100, fenetreSecondes: 60 },
      };
      const casse = monter(limiteurRedisIndisponible(courts));
      await tenter(casse, VICTIME, MAUVAIS, '203.0.113.231');
      await tenter(casse, VICTIME, MAUVAIS, '203.0.113.231');
      const bloque = await tenter(casse, VICTIME, MAUVAIS, '203.0.113.231');

      // La limite tient…
      expect(bloque.statut).toBe(429);
      // …et pourtant rien n'est passé par Redis. C'est bien la mémoire.
      expect(await redisNu.keys('lt:*')).toHaveLength(0);
    }, 40_000);

    it('LOGIN_THROTTLE_DEGRADED est émis UNE SEULE FOIS', async () => {
      // ON COMPTE UN DELTA, ON NE VIDE PAS. `AuditLog` est en ajout seul,
      // garanti par un déclencheur PostgreSQL : un `deleteMany` y échoue — et
      // c'est très bien ainsi. La garantie visée est « une bascule, un
      // événement », pour UNE instance : d'autres tests de ce fichier en ont
      // déjà produit, ils ne regardent pas la même bascule.
      const avant = await prisma.auditLog.count({
        where: { action: 'LOGIN_THROTTLE_DEGRADED' },
      });
      const limiteur = limiteurRedisIndisponible();
      const auth = monter(limiteur);

      for (let i = 0; i < 12; i++) {
        await tenter(auth, VICTIME, MAUVAIS, `203.0.113.${170 + i}`);
      }

      const apres = await prisma.auditLog.count({
        where: { action: 'LOGIN_THROTTLE_DEGRADED' },
      });
      expect(apres - avant).toBe(1);
    }, 40_000);
  });

  // ==========================================================================
  // LE DISJONCTEUR
  //
  // Sans lui, chaque connexion paierait le délai d'expiration d'une commande
  // Redis avant de se rabattre sur la mémoire : un Redis en panne ne dégraderait
  // pas l'authentification, il la RALENTIRAIT — pour tout le monde, et à chaque
  // requête. Ce qui est vérifié ici n'est donc pas « il finit par s'ouvrir »,
  // mais les trois moments qui comptent : il tient sous le seuil, il cesse
  // d'appeler Redis une fois ouvert, et il se referme quand Redis revient.
  //
  // LA PANNE EST INJECTÉE SUR UN REDIS VIVANT. Un port mort ouvrirait bien le
  // disjoncteur, mais ne permettrait jamais d'observer le rétablissement.
  // ==========================================================================
  describe('le disjoncteur', () => {
    it('tient sous le seuil, coupe au-delà, puis se referme', async () => {
      const limiteur = limiteurRedis();
      // La connexion est privée : ce test observe délibérément l'intérieur,
      // parce que c'est le seul endroit d'où une panne Redis peut être simulée
      // sans casser le Redis que partagent les autres tests.
      const interne = limiteur as unknown as { redis: Redis };
      const espion = jest
        .spyOn(interne.redis, 'eval')
        .mockRejectedValue(new Error('panne simulée'));

      // Deux erreurs : on dégrade la réponse, mais on continue d'appeler Redis.
      for (let i = 0; i < 2; i++) {
        const d = await limiteur.consommer('203.0.113.120', VICTIME);
        expect(d.degrade).toBe(true);
      }
      expect(limiteur.estDegrade()).toBe(false);

      // La troisième ouvre le disjoncteur.
      await limiteur.consommer('203.0.113.120', VICTIME);
      expect(limiteur.estDegrade()).toBe(true);

      // Et dès lors, PLUS AUCUN appel à Redis : c'est tout l'intérêt.
      espion.mockClear();
      await limiteur.consommer('203.0.113.120', VICTIME);
      expect(espion).not.toHaveBeenCalled();

      // Redis revient, et l'on avance au-delà des trente secondes d'ouverture.
      espion.mockRestore();
      const maintenant = Date.now();
      const horloge = jest
        .spyOn(Date, 'now')
        .mockImplementation(() => maintenant + 31_000);
      try {
        const d = await limiteur.consommer('203.0.113.121', VICTIME);
        // `degrade: false` prouve que le compteur Redis a bien repris la main —
        // un repli mémoire silencieux aurait rendu `true`.
        expect(d.degrade).toBe(false);
        expect(limiteur.estDegrade()).toBe(false);
      } finally {
        horloge.mockRestore();
      }
    }, 30_000);
  });

  // ==========================================================================
  // LE REMBOURSEMENT — CE QUE LA PASSE 2 BIS CORRIGE
  //
  // Le compteur par origine comptait TOUTES les tentatives, succès compris, et
  // ne les rendait jamais. Mesuré : la 51e connexion RÉUSSIE depuis une même
  // adresse était rejetée. Derrière un NAT d'opérateur, on excluait des abonnés
  // qui n'avaient rien fait — un déni de service collatéral à la place d'un
  // déni de service ciblé.
  //
  // Ces tests portent sur la propriété, pas sur les nombres : ils injectent
  // tous leurs propres budgets.
  // ==========================================================================
  describe('un utilisateur légitime ne pèse pas sur ses voisins d’IP', () => {
    // Volontairement PLUS PETIT que le nombre de connexions réussies du test
    // suivant : si les succès pesaient, le seuil serait franchi largement.
    const budgetsEtroits: Budgets = {
      parOrigineEtIdentifiant: { max: 5, fenetreSecondes: 900 },
      parOrigine: { maxVigilance: 40, maxDur: 60, fenetreSecondes: 900 },
      parIdentifiant: { max: 1000, fenetreSecondes: 3600 },
    };

    it('100 connexions RÉUSSIES depuis une seule IP : aucun 429', async () => {
      const auth = monter(limiteurRedis(configPour(), budgetsEtroits));
      const NAT = '203.0.113.60';

      const codes: number[] = [];
      for (let i = 0; i < 100; i++) {
        codes.push((await tenter(auth, VICTIME, BON, NAT)).statut);
      }

      // Le plafond dur vaut 60, très en dessous de 100 : sans remboursement,
      // la soixante-et-unième aurait été refusée.
      expect(codes.filter((c) => c !== 200)).toEqual([]);
    }, 300_000);

    it('trois utilisateurs derrière la même IP ne se gênent pas', async () => {
      const auth = monter(limiteurRedis(configPour(), budgetsEtroits));
      const NAT = '203.0.113.61';

      // 35 tours × 2 utilisateurs = 70 connexions, VOLONTAIREMENT au-dessus du
      // plafond dur de 60 : si les succès pesaient, le blocage surviendrait.
      for (let tour = 0; tour < 35; tour++) {
        for (const qui of [VICTIME, AUTRE]) {
          expect({
            tour,
            qui,
            statut: (await tenter(auth, qui, BON, NAT)).statut,
          }).toEqual({ tour, qui, statut: 200 });
        }
      }
    }, 300_000);

    it('les ÉCHECS, eux, comptent bien : le sixième est refusé', async () => {
      const auth = monter(limiteurRedis(configPour(), budgetsEtroits));
      const IP = '203.0.113.62';
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        codes.push((await tenter(auth, VICTIME, MAUVAIS, IP)).statut);
      }
      // Cinq passent, le sixième bute sur le budget (origine, identifiant).
      expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    }, 60_000);

    it('un succès APRÈS des échecs rend le budget de ce couple', async () => {
      const auth = monter(limiteurRedis(configPour(), budgetsEtroits));
      const IP = '203.0.113.63';
      for (let i = 0; i < 4; i++) await tenter(auth, VICTIME, MAUVAIS, IP);
      expect((await tenter(auth, VICTIME, BON, IP)).statut).toBe(200);

      // Remise à zéro : cinq nouveaux essais sont de nouveau disponibles.
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await tenter(auth, VICTIME, MAUVAIS, IP)).statut);
      }
      expect(codes).toEqual([401, 401, 401, 401, 401]);
    }, 120_000);

    it('le remboursement a lieu MÊME si le compte est ensuite refusé', async () => {
      // Cas (e) et (g) : le titulaire a prouvé son mot de passe, son compte lui
      // est refusé pour une raison légitime — il n'est pas pour autant un
      // attaquant, et n'a pas à peser sur le budget commun de son NAT.
      const auth = monter(limiteurRedis(configPour(), budgetsEtroits));

      for (const [qui, attendu] of [
        [DESACTIVE, 403],
        [VERROUILLE, 403],
      ] as const) {
        const IP = '203.0.113.64';
        const cles = await redisNu.keys('lt:*');
        if (cles.length) await redisNu.del(...cles);

        expect((await tenter(auth, qui, BON, IP)).statut).toBe(attendu);

        // Le compteur (origine, identifiant) a été supprimé, les deux autres
        // ramenés à zéro : il ne reste aucune clé de valeur non nulle.
        const restantes = await redisNu.keys('lt:*');
        const valeurs = await Promise.all(restantes.map((c) => redisNu.get(c)));
        expect({ qui, valeurs: valeurs.filter((v) => v !== '0') }).toEqual({
          qui,
          valeurs: [],
        });
      }
    }, 120_000);
  });

  // ==========================================================================
  // LE REMBOURSEMENT VU DE REDIS — les quatre pièges du script Lua
  //
  // Ces tests parlent au limiteur DIRECTEMENT, sans passer par `login` : ce
  // qu'on vérifie ici n'est pas un comportement d'authentification mais la
  // mécanique du compteur, et un `DECR` mal écrit ne se voit que là.
  // ==========================================================================
  describe('la mécanique du remboursement', () => {
    const b: Budgets = {
      parOrigineEtIdentifiant: { max: 50, fenetreSecondes: 900 },
      parOrigine: { maxVigilance: 500, maxDur: 900, fenetreSecondes: 900 },
      parIdentifiant: { max: 500, fenetreSecondes: 3600 },
    };
    const IP = '203.0.113.70';
    const ID = '+237600000777';

    const valeurs = async () => {
      const cles = (await redisNu.keys('lt:*')).sort();
      const v = await Promise.all(cles.map((c) => redisNu.get(c)));
      return v.map(Number).sort((x, y) => x - y);
    };

    it('DEL sur (origine, identifiant), DÉCRÉMENT sur les deux partagés', async () => {
      const l = limiteurRedis(configPour(), b);
      for (let i = 0; i < 3; i++) await l.consommer(IP, ID);
      expect(await valeurs()).toEqual([3, 3, 3]);

      await l.preuveDuMotDePasse(IP, ID);

      // Une clé a disparu (DEL), les deux autres sont descendues de un.
      expect(await valeurs()).toEqual([2, 2]);
    }, 30_000);

    it('JAMAIS de valeur négative, même en remboursant plus que réservé', async () => {
      // Un compteur négatif serait du budget offert : deux remboursements de
      // trop donneraient un crédit permanent à l'attaquant.
      const l = limiteurRedis(configPour(), b);
      await l.consommer(IP, ID);
      for (let i = 0; i < 5; i++) await l.preuveDuMotDePasse(IP, ID);

      const v = await valeurs();
      expect(v.every((n) => n >= 0)).toBe(true);
      expect(v).toEqual([0, 0]);
    }, 30_000);

    it('ne RESSUSCITE jamais une clé absente', async () => {
      // `DECR` sur une clé inexistante la crée à −1 et SANS TTL : compteur
      // négatif ET fuite mémoire permanente. La garde `EXISTS` l'empêche.
      const l = limiteurRedis(configPour(), b);
      await l.preuveDuMotDePasse('198.51.100.200', '+237600000888');
      expect(await redisNu.keys('lt:*')).toHaveLength(0);
    }, 30_000);

    it('ne réarme PAS le TTL — la fenêtre ne glisse pas', async () => {
      // Reposer l'expiration à chaque remboursement permettrait à un attaquant
      // régulier de maintenir sa fenêtre en vie indéfiniment.
      const l = limiteurRedis(configPour(), b);
      await l.consommer(IP, ID);
      await l.consommer(IP, ID);

      // CHAQUE CLÉ EST COMPARÉE À ELLE-MÊME. Les trois compteurs n'ont pas la
      // même fenêtre — 900 s pour deux, 3 600 s pour le troisième — et
      // confondre leurs TTL dans un min/max global ne compare rien.
      const releve = async (): Promise<Map<string, number>> => {
        const cles = (await redisNu.keys('lt:*')).sort();
        const ttls = await Promise.all(cles.map((c) => redisNu.pttl(c)));
        return new Map(cles.map((c, i) => [c, ttls[i]]));
      };

      const avant = await releve();
      await new Promise((r) => setTimeout(r, 1_200));
      await l.preuveDuMotDePasse(IP, ID);
      const apres = await releve();

      // Le couple (origine, identifiant) a disparu ; les deux clés partagées
      // survivent, et leur TTL a CONTINUÉ de courir au lieu d'être reposé.
      expect(apres.size).toBe(2);
      for (const [cle, restant] of apres) {
        const initial = avant.get(cle);
        expect({ cle, connue: initial !== undefined }).toEqual({
          cle,
          connue: true,
        });
        expect(restant).toBeGreaterThan(0);
        expect(restant).toBeLessThanOrEqual(initial! - 1_000);
      }
    }, 30_000);

    it('aucune clé orpheline : tout `lt:*` porte une expiration', async () => {
      const l = limiteurRedis(configPour(), b);
      for (let i = 0; i < 4; i++) await l.consommer(IP, ID);
      await l.preuveDuMotDePasse(IP, ID);
      await l.consommer(IP, ID);
      await l.preuveDuMotDePasse(IP, ID);

      const cles = await redisNu.keys('lt:*');
      const ttls = await Promise.all(cles.map((c) => redisNu.ttl(c)));
      // −1 signifierait « pas d'expiration », −2 « clé absente ».
      expect(ttls.every((t) => t > 0)).toBe(true);
    }, 30_000);
  });

  // ==========================================================================
  // REDIS ET MÉMOIRE DOIVENT RÉPONDRE LA MÊME CHOSE
  //
  // Les deux partagent `decider()`, donc la RÈGLE — mais pas la façon de
  // compter ni de rembourser. C'est exactement là qu'une divergence
  // s'installerait sans bruit, pour ne se révéler qu'un jour de panne Redis,
  // c'est-à-dire au pire moment. Le même scénario est donc rejoué contre les
  // deux, et les suites de décisions comparées.
  // ==========================================================================
  describe('équivalence Redis ↔ mémoire', () => {
    const b: Budgets = {
      parOrigineEtIdentifiant: { max: 3, fenetreSecondes: 900 },
      // Vigilance BASSE et proche du plancher : c'est ce qui rend le scénario
      // sensible à une divergence sur le plancher. Voir ci-dessous.
      parOrigine: { maxVigilance: 2, maxDur: 6, fenetreSecondes: 900 },
      parIdentifiant: { max: 5, fenetreSecondes: 3600 },
    };

    const IP = '203.0.113.80';

    // ------------------------------------------------------------------------
    // UN SCÉNARIO QUI DOIT DIVERGER SI LES DEUX CÔTÉS DIVERGENT
    //
    // Première version de ce test : elle ne détectait PAS l'absence de plancher
    // côté mémoire. Le compteur passait bien à −3 au lieu de 0, mais aucune
    // décision ultérieure ne changeait pour autant — on comparait deux suites
    // de « ok ». Un test d'équivalence qui ne peut pas diverger ne prouve rien.
    //
    // La suite ci-dessous rembourse DÉLIBÉRÉMENT plus qu'elle n'a réservé, puis
    // reconsomme jusqu'à frôler le seuil de vigilance. Avec plancher, le seuil
    // est franchi ; sans plancher, le crédit négatif l'absorbe et il ne l'est
    // pas. La divergence devient alors visible dans la trace.
    // ------------------------------------------------------------------------
    const scenario: Array<['consommer' | 'preuve', string, string]> = [
      ['consommer', IP, 'a'],
      ['consommer', IP, 'a'],
      ['consommer', IP, 'a'], // franchit la vigilance d'origine
      ['consommer', IP, 'a'], // dépasse (origine, identifiant) → refus
      ['preuve', IP, 'a'], // remise à zéro du couple, décrément des partagés
      ['consommer', IP, 'a'],
      // HUIT remboursements alors que le compteur d'origine ne vaut que 4.
      // Le nombre compte : avec quatre, il tombe à zéro des deux côtés et rien
      // ne diverge — c'est l'erreur qu'a commise la première version de ce
      // test. Il en faut STRICTEMENT PLUS que la valeur courante pour que
      // l'absence de plancher produise un crédit négatif, donc des tentatives
      // gratuites offertes à tout le NAT.
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      ['preuve', IP, 'a'],
      // On remonte : avec plancher, la troisième franchit la vigilance.
      ['consommer', IP, 'b'],
      ['consommer', IP, 'b'],
      ['consommer', IP, 'b'],
      ['consommer', '198.51.100.80', 'a'], // autre origine, même identifiant
    ];

    const rejouer = async (l: {
      consommer: (ip: string, id: string) => Promise<unknown>;
      preuveDuMotDePasse: (ip: string, id: string) => Promise<void>;
    }) => {
      const trace: string[] = [];
      for (const [action, ip, id] of scenario) {
        if (action === 'preuve') {
          await l.preuveDuMotDePasse(ip, id);
          trace.push('preuve');
        } else {
          const d = (await l.consommer(ip, id)) as {
            autorise: boolean;
            secondFacteurRequis: boolean;
          };
          trace.push(
            `${d.autorise ? 'ok' : 'STOP'}/${d.secondFacteurRequis ? '2FA' : '-'}`,
          );
        }
      }
      return trace;
    };

    it('rendent EXACTEMENT la même suite de décisions', async () => {
      const parRedis = await rejouer(limiteurRedis(configPour(), b));
      const parMemoire = await rejouer(new MemoryLoginThrottle(b));

      expect(parMemoire).toEqual(parRedis);
      // Et la trace n'est pas triviale : elle contient bien des refus et des
      // exigences de second facteur, sinon on comparerait deux suites de « ok ».
      expect(parRedis.some((e) => e.startsWith('STOP'))).toBe(true);
      expect(parRedis.some((e) => e.endsWith('2FA'))).toBe(true);
    }, 60_000);
  });

  // ==========================================================================
  // L'EXPIRATION CÔTÉ MÉMOIRE — A4
  //
  // POURQUOI CES TESTS EXISTENT. L'audit de la passe précédente a constaté que
  // RIEN ne vérifiait le comportement du repli mémoire autour de l'expiration :
  // le scénario d'équivalence ne traversait aucune fenêtre. Trois fautes y
  // seraient donc passées inaperçues — ressusciter une entrée expirée en la
  // remboursant, descendre sous zéro, ou réarmer la fenêtre à chaque
  // remboursement. Les deux premières offrent du budget gratuit ; la troisième
  // rend la fenêtre glissante, donc éternelle pour un attaquant régulier.
  //
  // CHAQUE TEST EST CONSTRUIT POUR DISTINGUER. Une assertion qui reste vraie
  // que le code soit sain ou saboté ne prouve rien — c'est exactement le piège
  // dans lequel deux tests de la passe précédente étaient tombés. Les
  // commentaires ci-dessous disent, pour chacun, ce que rendrait le code cassé.
  // ==========================================================================
  describe('MemoryLoginThrottle — la fenêtre', () => {
    // ========================================================================
    // C'EST LE COMPTEUR PARTAGÉ QU'IL FAUT FAIRE TRANCHER
    //
    // `preuveDuMotDePasse` SUPPRIME la clé (origine, identifiant) et DÉCRÉMENTE
    // les deux clés partagées. Une première version de tout ce bloc bornait
    // chaque scénario par le budget (origine, identifiant) : les assertions
    // n'observaient donc que la suppression, jamais le décrément — et trois
    // sabotages du décrément passaient au vert. Ces budgets rendent le compteur
    // PAR ORIGINE seul décisionnaire ; les deux autres sont mis hors de portée.
    // ========================================================================
    const origineTranche = (
      maxDur: number,
      fenetreSecondes: number,
    ): Budgets => ({
      parOrigineEtIdentifiant: { max: 10_000, fenetreSecondes },
      parOrigine: {
        maxVigilance: Math.max(1, maxDur - 1),
        maxDur,
        fenetreSecondes,
      },
      parIdentifiant: { max: 10_000, fenetreSecondes },
    });

    const attendre = (ms: number) =>
      new Promise((r) => {
        setTimeout(r, ms);
      });

    const IP = '203.0.113.180';
    const ID = '+237600000900';
    const autorise = async (l: MemoryLoginThrottle, ip = IP, id = ID) =>
      (await l.consommer(ip, id)).autorise;

    it('le compteur expire réellement et rend le budget', async () => {
      const l = new MemoryLoginThrottle(origineTranche(2, 1));
      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(false);

      await attendre(1_200);

      // Sans expiration, on resterait bloqué ici indéfiniment.
      expect(await autorise(l)).toBe(true);
    }, 20_000);

    it('rembourser une clé JAMAIS VUE ne crée rien', async () => {
      // La purge étant PARESSEUSE, une entrée expirée reste dans la table : un
      // remboursement tardif la trouve donc toujours. Le seul cas où la
      // création peut être observée est celui d'une clé jamais rencontrée.
      const l = new MemoryLoginThrottle(origineTranche(2, 60));
      const ipNeuve = '198.51.100.240';
      const idNeuf = '+237600000901';

      await l.preuveDuMotDePasse(ipNeuve, idNeuf);

      // SAIN : rien n'a été créé — 1, 2 passent, 3 bloque.
      // CRÉÉE À −1 : 0, 1, 2 passeraient, soit une tentative offerte.
      expect(await autorise(l, ipNeuve, idNeuf)).toBe(true);
      expect(await autorise(l, ipNeuve, idNeuf)).toBe(true);
      expect(await autorise(l, ipNeuve, idNeuf)).toBe(false);
    }, 20_000);

    it('rembourser plus que réservé ne crée pas de crédit', async () => {
      const l = new MemoryLoginThrottle(origineTranche(2, 60));
      await l.consommer(IP, ID);
      for (let i = 0; i < 5; i++) await l.preuveDuMotDePasse(IP, ID);

      // SAIN : plancher à zéro — 1, 2 passent, 3 bloque.
      // SANS PLANCHER : le compteur vaudrait −4 et rien ne bloquerait ici.
      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(false);
    }, 20_000);

    it('après expiration le budget est ENTIER, même si un remboursement a eu lieu', async () => {
      const l = new MemoryLoginThrottle(origineTranche(2, 1));
      await l.consommer(IP, ID);
      await l.consommer(IP, ID);
      await attendre(1_300);
      await l.preuveDuMotDePasse(IP, ID);

      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(true);
      expect(await autorise(l)).toBe(false);
    }, 20_000);

    it('le remboursement ne réarme PAS la fenêtre', async () => {
      // LE TEST LE PLUS DÉLICAT À RENDRE DISCRIMINANT — et celui qui s'est
      // trompé deux fois. Il faut d'une part que ce soit le compteur PARTAGÉ
      // qui tranche, d'autre part que le remboursement tombe franchement DANS
      // la fenêtre : avec une marge trop courte, l'échéance était parfois déjà
      // passée, `rendre()` sortait par sa garde et la ligne sabotée n'était
      // jamais exécutée. Le test restait vert sans rien prouver.
      const l = new MemoryLoginThrottle(origineTranche(2, 2));
      await l.consommer(IP, ID); // valeur 1, fenêtre expirant à t≈2,0 s
      await l.consommer(IP, ID); // valeur 2
      await attendre(500); // t≈0,5 s — très largement DANS la fenêtre
      await l.preuveDuMotDePasse(IP, ID); // valeur 1
      await attendre(1_900); // t≈2,4 s — la fenêtre INITIALE est échue

      const suite = [await autorise(l), await autorise(l), await autorise(l)];

      // SAIN : l'entrée était morte, tout repart — 1, 2 passent, 3 bloque.
      // FENÊTRE RÉARMÉE : l'entrée vaut encore 1, donc 2 passe et 3 bloque
      //   dès le DEUXIÈME coup. C'est le RANG du refus qui sépare les deux.
      expect(suite).toEqual([true, true, false]);
    }, 20_000);

    it('Redis et mémoire décident pareil DE PART ET D’AUTRE d’une expiration', async () => {
      // L'équivalence n'avait jamais été éprouvée à cheval sur une fenêtre.
      const budgets = origineTranche(2, 1);
      const rejouer = async (l: {
        consommer: (ip: string, id: string) => Promise<{ autorise: boolean }>;
        preuveDuMotDePasse: (ip: string, id: string) => Promise<void>;
      }) => {
        const trace: boolean[] = [];
        trace.push((await l.consommer(IP, ID)).autorise);
        trace.push((await l.consommer(IP, ID)).autorise);
        trace.push((await l.consommer(IP, ID)).autorise); // refusé
        await l.preuveDuMotDePasse(IP, ID);
        trace.push((await l.consommer(IP, ID)).autorise);
        await attendre(1_300); // franchissement de la fenêtre
        trace.push((await l.consommer(IP, ID)).autorise);
        await l.preuveDuMotDePasse(IP, ID);
        await l.preuveDuMotDePasse(IP, ID); // un de trop → plancher
        trace.push((await l.consommer(IP, ID)).autorise);
        trace.push((await l.consommer(IP, ID)).autorise);
        trace.push((await l.consommer(IP, ID)).autorise);
        return trace;
      };

      const parRedis = await rejouer(limiteurRedis(configPour(), budgets));
      const cles = await redisNu.keys('lt:*');
      if (cles.length) await redisNu.del(...cles);
      const parMemoire = await rejouer(new MemoryLoginThrottle(budgets));

      expect(parMemoire).toEqual(parRedis);
      // La trace doit contenir au moins un refus, sinon on comparerait deux
      // suites de « true » et le test ne prouverait rien.
      expect(parRedis).toContain(false);
    }, 40_000);
  });
  // ==========================================================================
  // LE PALIER DE VIGILANCE PAR ORIGINE
  // ==========================================================================
  describe('le palier de vigilance exige le second facteur, sans bloquer', () => {
    const b: Budgets = {
      parOrigineEtIdentifiant: { max: 100, fenetreSecondes: 900 },
      parOrigine: { maxVigilance: 3, maxDur: 1000, fenetreSecondes: 900 },
      parIdentifiant: { max: 1000, fenetreSecondes: 3600 },
    };

    it('AUCUN SMS tant que le mot de passe est faux, si nombreux que soient les échecs', async () => {
      const auth = monter(limiteurRedis(configPour(), b));
      for (let i = 0; i < 15; i++) {
        expect(
          (await tenter(auth, VICTIME, MAUVAIS, '203.0.113.90')).statut,
        ).toBe(401);
      }
      // Le palier est franchi depuis longtemps — et pas un SMS n'est parti.
      expect(otp.generateAndSend).not.toHaveBeenCalled();
    }, 120_000);

    // ========================================================================
    // LE PLAFOND DE SMS — A1
    //
    // LE DÉFAUT QUE CE TEST FERME. Sans délai de garde, un attaquant maintenant
    // le palier de vigilance franchi — quelques requêtes ratées par minute —
    // faisait partir un SMS à CHAQUE connexion légitime derrière ce NAT. Sans
    // borne, aux frais de la plateforme, et sur le téléphone d'utilisateurs qui
    // n'avaient rien demandé.
    //
    // CE QUI EST EXIGÉ ICI EST UN PLAFOND, PAS UN REFUS : la victime doit
    // continuer à se connecter. C'est la différence entre borner un coût et
    // offrir un déni de service à l'attaquant.
    // ========================================================================
    it('un tiers ne peut pas provoquer plus d’UN SMS par fenêtre sur un compte', async () => {
      const auth = monter(limiteurRedis(configPour(), b));
      const NAT = '203.0.113.95';

      // L'attaquant franchit le palier sans connaître aucun mot de passe.
      for (let i = 0; i < 6; i++) {
        await tenter(auth, INEXISTANT, MAUVAIS, NAT);
      }
      expect(otp.generateAndSend).not.toHaveBeenCalled();

      // La victime se connecte DIX fois, correctement, depuis le même NAT.
      for (let i = 0; i < 10; i++) {
        const r = await tenter(auth, VICTIME, BON, NAT);
        // Jamais bloquée — le palier de vigilance n'est pas un refus.
        expect({ i, statut: r.statut, deuxFacteurs: r.deuxFacteurs }).toEqual({
          i,
          statut: 200,
          deuxFacteurs: true,
        });
      }

      // UN SEUL message pour dix connexions : les neuf suivantes réutilisent le
      // code encore vivant. Sans le délai de garde, ce nombre vaudrait dix.
      expect(otp.generateAndSend).toHaveBeenCalledTimes(1);
    }, 120_000);

    it('la fenêtre écoulée, un nouveau SMS redevient possible', async () => {
      // Le plafond ne doit pas devenir une privation : passé le délai, le
      // service reprend. Sans quoi un attaquant obtiendrait, en une rafale, un
      // silence permanent sur le second facteur de sa victime.
      const auth = monter(limiteurRedis(configPour(), b));
      const NAT = '203.0.113.96';
      for (let i = 0; i < 6; i++) await tenter(auth, INEXISTANT, MAUVAIS, NAT);

      await tenter(auth, VICTIME, BON, NAT);
      await tenter(auth, VICTIME, BON, NAT);
      expect(otp.generateAndSend).toHaveBeenCalledTimes(1);

      await new Promise((r) => {
        setTimeout(r, 2_300);
      });

      await tenter(auth, VICTIME, BON, NAT);
      expect(otp.generateAndSend).toHaveBeenCalledTimes(2);
    }, 120_000);

    it('le BON mot de passe au-delà du palier passe par le second facteur', async () => {
      const auth = monter(limiteurRedis(configPour(), b));
      for (let i = 0; i < 5; i++) {
        await tenter(auth, INEXISTANT, MAUVAIS, '203.0.113.91');
      }
      expect(otp.generateAndSend).not.toHaveBeenCalled();

      const r = await tenter(auth, VICTIME, BON, '203.0.113.91');
      // Non bloqué — c'est tout l'intérêt d'un palier non bloquant.
      expect(r.statut).toBe(200);
      expect(r.deuxFacteurs).toBe(true);
      expect(otp.generateAndSend).toHaveBeenCalledTimes(1);
    }, 60_000);
  });

  // ==========================================================================
  // LE JOURNAL SAIT ENFIN D'OÙ VIENT L'ATTAQUE
  // ==========================================================================
  describe("le journal d'audit identifie l'origine", () => {
    it('un échec est consigné avec son IP, compte existant ou non', async () => {
      const auth = monter(limiteurRedis());
      await tenter(auth, VICTIME, MAUVAIS, '203.0.113.240');
      await tenter(auth, INEXISTANT, MAUVAIS, '203.0.113.240');

      const echecs = await prisma.auditLog.findMany({
        where: { action: 'LOGIN_FAILED', ipAddress: '203.0.113.240' },
        select: { userId: true, ipAddress: true, userAgent: true },
      });
      expect(echecs).toHaveLength(2);
      expect(echecs.every((e) => e.ipAddress === '203.0.113.240')).toBe(true);
      expect(echecs.every((e) => e.userAgent === 'agent-de-test')).toBe(true);
      // L'un porte l'utilisateur, l'autre non — mais LES DEUX sont écrits :
      // c'est ce qui évite de recréer un écart de temps entre les deux chemins.
      expect(echecs.filter((e) => e.userId === null)).toHaveLength(1);
    });

    it('une connexion réussie est consignée avec son origine', async () => {
      const auth = monter(limiteurRedis());
      await tenter(auth, VICTIME, BON, '198.51.100.44');

      const succes = await prisma.auditLog.findFirst({
        where: { action: 'LOGIN_SUCCESS', ipAddress: '198.51.100.44' },
      });
      expect(succes).not.toBeNull();
    });
  });
});
