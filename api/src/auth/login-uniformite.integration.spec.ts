import 'dotenv/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AccountStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { AuthService } from './auth.service';
import {
  condensatFactice,
  reinitialiserCondensatFacticePourTests,
} from './condensat-factice';
import { MemoryLoginThrottle } from './login-throttle/memory-login-throttle';
import { TokenService } from './token.service';

// ============================================================================
// S-06 PASSE 1 — LA CONNEXION NE DIT PLUS QUI EXISTE
//
// Deux oracles fermés ensemble, parce qu'ils avaient la même cause : l'ordre
// des opérations.
//
// S-06-A. Le verrouillage et le statut étaient examinés avant le mot de passe.
// Un compte désactivé répondait 403 à qui ne connaissait rien de lui.
//
// S-06-B. Argon2 n'était atteint que si le compte existait. Mesuré le
// 2026-08-12 : 2,26 ms de médiane pour un numéro inconnu, 71,46 ms pour un
// numéro réel, plages disjointes. Une requête suffisait.
//
// CE QUE CES TESTS SURVEILLENT. Pas « ça rejette », mais « ça rejette
// PAREIL ». L'égalité stricte des réponses est la seule formulation qui
// résiste : un test qui vérifierait seulement le statut laisserait passer une
// différence de message, et un message est un oracle aussi bavard qu'un code.
//
// Base PostgreSQL réelle, vrai Argon2, vrai service.
// ============================================================================

const BASE = 'stagiaires_it_login_uniformite';
const MOT_DE_PASSE = 'MotDePasseCorrect1';
const MAUVAIS = 'MotDePasseFaux1';

interface Reponse {
  type: string;
  statut: number;
  message: string;
}

// Les paramètres d'un condensat Argon2 vivent dans son en-tête :
// `$argon2id$v=19$m=65536,t=3,p=4$sel$empreinte`. Comparer les quatre premiers
// segments compare l'algorithme, la version, la mémoire, le temps et le
// parallélisme — tout ce qui détermine le COÛT, donc le temps de réponse.
function parametres(condensat: string): string {
  return condensat.split('$').slice(0, 4).join('$');
}

describe('S-06 passe 1 — uniformité des réponses de /auth/login', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let auth: AuthService;

  // Seul le compte actif a besoin d'être manipulé par identifiant (remise à
  // zéro du compteur entre deux mesures). Les autres ne sont désignés que par
  // leur numéro, comme le ferait un attaquant.
  let actif = '';
  // Le limiteur de connexion (S-06-C). En mémoire ici : ce spec porte sur
  // l'uniformité des réponses, pas sur le partage d'état entre instances.
  const limiteur = new MemoryLoginThrottle();

  const INEXISTANT = '+237600000098';

  const otp = {
    generateAndSend: jest.fn().mockResolvedValue(undefined),
    verify: jest.fn(),
    // Aucun code encore émis : le délai de garde du SMS 2FA ne se déclenche
    // pas, et ces tests observent donc le comportement nominal — celui qu'ils
    // vérifiaient avant que ce garde-fou n'existe.
    secondesDepuisDernierEnvoi: jest.fn().mockResolvedValue(null),
  };

  const creer = async (
    phone: string,
    statut: AccountStatus,
    verifie: boolean,
    deuxFacteurs = false,
  ) => {
    const u = await prisma.user.create({
      data: {
        phone,
        password: await argon2.hash(MOT_DE_PASSE),
        firstName: 'T',
        status: statut,
        phoneVerifiedAt: verifie ? new Date() : null,
        twoFactorEnabled: deuxFacteurs,
        countryOfResidence: 'CM',
      },
    });
    return u.id;
  };

  // Ramène une réponse à ce qu'un attaquant peut observer, et rien d'autre.
  const observer = async (
    identifiant: string,
    motDePasse: string,
  ): Promise<Reponse> => {
    try {
      await auth.login(
        { identifier: identifiant, password: motDePasse },
        undefined,
        undefined,
      );
      return { type: 'SUCCES', statut: 200, message: '' };
    } catch (e) {
      const erreur = e as {
        constructor: { name: string };
        status?: number;
        message?: string;
      };
      return {
        type: erreur.constructor.name,
        statut: erreur.status ?? 500,
        message: erreur.message ?? '',
      };
    }
  };

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE);
    prisma = database.prisma;

    const config = new ConfigService({
      LOCKOUT_MAX_ATTEMPTS: '5',
      LOCKOUT_DURATION_MINUTES: '15',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
    });
    const audit = new AuditService(prisma);
    const tokens = new TokenService(new JwtService({}), config, prisma);
    // Les dépendances que `login` n'atteint jamais dans ces scénarios.
    const absent = new Proxy(
      {},
      { get: () => () => Promise.resolve(undefined) },
    ) as never;

    auth = new AuthService(
      prisma,
      config,
      otp as never,
      tokens,
      audit,
      absent,
      absent,
      absent,
      absent,
      limiteur,
    );
    await auth.onModuleInit();

    actif = await creer('+237600000040', AccountStatus.ACTIVE, true);
    await creer('+237600000041', AccountStatus.DEACTIVATED, true);
    await creer('+237600000042', AccountStatus.ACTIVE, false);
    await creer('+237600000043', AccountStatus.ACTIVE, true, true);
  }, 240_000);

  afterAll(async () => {
    await database?.close();
  }, 60_000);

  // Depuis S-06-C, chaque tentative consomme un budget. Sans cette remise à
  // zéro, les tests se gêneraient l'un l'autre : le sixième appel d'un fichier
  // qui en fait des dizaines partirait en 429, et l'on croirait à une
  // régression de l'uniformité là où il n'y aurait qu'un compteur plein.
  beforeEach(() => {
    limiteur.vider();
  });

  // --- S-06-A : l'égalité stricte ------------------------------------------
  describe("aucune réponse ne distingue un compte qui existe d'un compte qui n'existe pas", () => {
    it('identifiant inexistant et mauvais mot de passe donnent la MÊME réponse', async () => {
      const inconnu = await observer(INEXISTANT, MAUVAIS);
      const mauvais = await observer('+237600000040', MAUVAIS);
      expect(inconnu).toEqual(mauvais);
      expect(inconnu.type).toBe(UnauthorizedException.name);
      expect(inconnu.message).toBe('Identifiants invalides.');
    });

    it('un compte DÉSACTIVÉ donne aussi la même réponse, sans le mot de passe', async () => {
      const desactiveMauvais = await observer('+237600000041', MAUVAIS);
      const inconnu = await observer(INEXISTANT, MAUVAIS);
      expect(desactiveMauvais).toEqual(inconnu);
    });

    it('un compte NON VÉRIFIÉ ne se signale pas non plus', async () => {
      const nonVerifieMauvais = await observer('+237600000042', MAUVAIS);
      const inconnu = await observer(INEXISTANT, MAUVAIS);
      expect(nonVerifieMauvais).toEqual(inconnu);
    });

    it('un compte VERROUILLÉ ne se signale pas non plus', async () => {
      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: new Date(Date.now() + 900_000) },
      });

      const verrouille = await observer('+237600000040', MAUVAIS);
      const inconnu = await observer(INEXISTANT, MAUVAIS);
      expect(verrouille).toEqual(inconnu);

      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
      });
    });
  });

  // --- Le titulaire, lui, reste informé -------------------------------------
  describe('la preuve du mot de passe rouvre l’information légitime', () => {
    it('compte désactivé + BON mot de passe → 403 explicite', async () => {
      const r = await observer('+237600000041', MOT_DE_PASSE);
      expect(r.type).toBe(ForbiddenException.name);
      expect(r.message).toBe('Ce compte est désactivé.');
    });

    it('compte non vérifié + BON mot de passe → 403 sur l’OTP', async () => {
      const r = await observer('+237600000042', MOT_DE_PASSE);
      expect(r.type).toBe(ForbiddenException.name);
      expect(r.message).toContain('vérifié par OTP');
    });

    it('compte verrouillé + BON mot de passe → 403 sur le verrouillage', async () => {
      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: new Date(Date.now() + 900_000) },
      });

      const r = await observer('+237600000040', MOT_DE_PASSE);
      expect(r.type).toBe(ForbiddenException.name);
      expect(r.message).toContain('temporairement bloqué');

      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
      });
    });

    it('compte actif + BON mot de passe → connexion normale', async () => {
      const r = await auth.login(
        { identifier: '+237600000040', password: MOT_DE_PASSE },
        undefined,
        undefined,
      );
      expect(r.requiresTwoFactor).toBe(false);
      expect(r).toHaveProperty('accessToken');
    });

    it('la 2FA reste inchangée, et seulement après le mot de passe', async () => {
      const mauvais = await observer('+237600000043', MAUVAIS);
      expect(mauvais.message).toBe('Identifiants invalides.');

      const r = await auth.login(
        { identifier: '+237600000043', password: MOT_DE_PASSE },
        undefined,
        undefined,
      );
      expect(r.requiresTwoFactor).toBe(true);
      expect(r).toHaveProperty('challengeToken');
      expect(r).not.toHaveProperty('accessToken');
    });
  });

  // --- S-06-B : le condensat factice ----------------------------------------
  describe('le condensat factice', () => {
    it('est calculé une seule fois, quel que soit le nombre d’appels', async () => {
      const a = await condensatFactice();
      const b = await condensatFactice();
      expect(a).toBe(b);
    });

    it('utilise EXACTEMENT les paramètres Argon2 des condensats réels', async () => {
      // La garantie du temps plat tient entièrement à cette égalité. Un
      // condensat factice moins coûteux recréerait l'écart, silencieusement.
      const reel = await prisma.user.findUniqueOrThrow({
        where: { id: actif },
        select: { password: true },
      });
      expect(parametres(await condensatFactice())).toBe(
        parametres(reel.password),
      );
    });

    it("n'est la préimage d'aucun mot de passe utilisable", async () => {
      expect(await argon2.verify(await condensatFactice(), MOT_DE_PASSE)).toBe(
        false,
      );
      expect(await argon2.verify(await condensatFactice(), '')).toBe(false);
    });

    it('est régénéré après réinitialisation — la mémoïsation est bien la cause', async () => {
      const avant = await condensatFactice();
      reinitialiserCondensatFacticePourTests();
      const apres = await condensatFactice();
      expect(apres).not.toBe(avant);
      expect(parametres(apres)).toBe(parametres(avant));
    });
  });

  // --- S-06-B : la preuve par le temps --------------------------------------
  describe('le temps de réponse ne trahit plus l’existence du compte', () => {
    // POURQUOI CE SEUIL, ET PAS UN AUTRE. Mesuré le 2026-08-12 : avant
    // correction, un compte inconnu répondait 31,65 fois plus vite qu'un compte
    // réel, plages disjointes. La passe 1 a ramené le rapport à ×1,38–1,40 — le
    // résidu venant de l'écriture du compteur de tentatives sur la ligne de la
    // victime, le seul travail que le chemin « compte inconnu » n'avait pas à
    // faire.
    //
    // La passe 2 (S-06-C) a retiré cette écriture : le compteur a quitté `User`.
    // Remesuré le 2026-08-14, trois séries de 20 essais : 0,993 / 1,010 / 0,993,
    // pour des médianes de ~74 ms des deux côtés. Il ne reste que la
    // vérification Argon2, la même pour un compte réel et pour le condensat
    // factice — c'était le but.
    //
    // Le seuil est fixé à 3. C'est presque trois fois la valeur réelle, et dix
    // fois moins que le défaut : assez large pour survivre à une machine
    // d'intégration continue chargée, assez serré pour qu'un retour en arrière
    // ne passe pas. Un test temporel reste le plus fragile de la suite ; celui-ci
    // dispose d'un ordre de grandeur de marge de chaque côté. S'il devenait
    // capricieux, il faudrait le désactiver — jamais l'assouplir jusqu'à
    // l'inutilité.
    const N = 20;
    const SEUIL = 3;

    const mediane = (v: number[]) => {
      const t = [...v].sort((a, b) => a - b);
      return t.length % 2
        ? t[(t.length - 1) / 2]
        : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
    };

    // Le budget est rendu AVANT le chronomètre, jamais pendant : sans cela, la
    // sixième mesure partirait en 429 — instantané — et écraserait la médiane.
    // C'est Argon2 qu'on mesure ici, pas le limiteur.
    const chronometrer = async (identifiant: string) => {
      limiteur.vider();
      const t0 = process.hrtime.bigint();
      await observer(identifiant, MAUVAIS);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };

    it(`répond dans le même ordre de grandeur, connu ou inconnu (rapport < ${SEUIL})`, async () => {
      await prisma.user.update({
        where: { id: actif },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      // Rodage : les toutes premières mesures portent le coût du JIT et de
      // l'ouverture des connexions, pas celui d'Argon2.
      for (let i = 0; i < 3; i++) {
        await chronometrer(INEXISTANT);
        await chronometrer('+237600000040');
        await prisma.user.update({
          where: { id: actif },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }

      const inconnus: number[] = [];
      const connus: number[] = [];
      for (let i = 0; i < N; i++) {
        inconnus.push(await chronometrer(INEXISTANT));
        connus.push(await chronometrer('+237600000040'));
        await prisma.user.update({
          where: { id: actif },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      }

      const rapport = mediane(connus) / mediane(inconnus);
      expect(rapport).toBeLessThan(SEUIL);
      expect(1 / rapport).toBeLessThan(SEUIL);
    }, 120_000);
  });

  // --- Effets de bord --------------------------------------------------------
  describe('ce qui est écrit, et ce qui ne l’est pas', () => {
    it('un identifiant inexistant n’écrit RIEN sur User', async () => {
      const avant = await prisma.user.findMany({
        select: { id: true, failedLoginAttempts: true, lockedUntil: true },
        orderBy: { id: 'asc' },
      });

      await observer(INEXISTANT, MAUVAIS);
      await observer(INEXISTANT, MOT_DE_PASSE);

      const apres = await prisma.user.findMany({
        select: { id: true, failedLoginAttempts: true, lockedUntil: true },
        orderBy: { id: 'asc' },
      });
      expect(apres).toEqual(avant);
      expect(await prisma.user.count({ where: { phone: INEXISTANT } })).toBe(0);
    });

    it("un mauvais mot de passe sur un compte réel n'écrit plus RIEN — S-06-C fermé", async () => {
      // CE TEST FIGEAIT UN DÉFAUT, IL FIGE MAINTENANT SA CORRECTION.
      //
      // Jusqu'à la passe 2, cette même assertion vérifiait que le compteur
      // montait à 1 — parce qu'il vivait sur le compte de la victime, et que
      // c'était précisément le vecteur du verrouillage par un tiers. La
      // réécriture est donc délibérée, pas une adaptation de confort.
      await prisma.user.update({
        where: { id: actif },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      const avant = await prisma.user.findUniqueOrThrow({
        where: { id: actif },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });

      await observer('+237600000040', MAUVAIS);

      const apres = await prisma.user.findUniqueOrThrow({
        where: { id: actif },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      expect(apres).toEqual(avant);
      expect(apres.failedLoginAttempts).toBe(0);
      expect(apres.lockedUntil).toBeNull();
    });

    it("un ancien verrou EXPIRÉ n'empêche plus la connexion", async () => {
      // Les colonnes restent en base sans migration : un verrou posé AVANT ce
      // déploiement continue d'être lu, et doit s'éteindre de lui-même.
      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: new Date(Date.now() - 1_000) },
      });

      const r = await auth.login(
        { identifier: '+237600000040', password: MOT_DE_PASSE },
        undefined,
        undefined,
      );
      expect(r.requiresTwoFactor).toBe(false);

      await prisma.user.update({
        where: { id: actif },
        data: { lockedUntil: null },
      });
    });
  });
});
