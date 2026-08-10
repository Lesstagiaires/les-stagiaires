import 'dotenv/config';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { execSync } from 'child_process';
import { Client } from 'pg';
import { AccountStatus, OtpPurpose } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { CountryPolicyService } from './country-policy.service';
import { MinorPolicyService } from './minor-policy.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { TokenService } from './token.service';

// ============================================================================
// RECETTE DE BOUT EN BOUT — la preuve du téléphone et le renvoi du code
//
// Sur PostgreSQL réel, migrations réelles, services réels. Seul l'envoi de SMS
// est simulé — et c'est ce qui permet de LIRE le code, exactement comme un
// utilisateur le lirait sur son téléphone. Aucun code n'est deviné ni fabriqué.
//
// Deux bloqueurs de production y sont éprouvés :
//
//   A. un refus parental effaçait la preuve de possession du téléphone,
//      rendant connectable un compte jamais vérifié ;
//   B. un code expiré condamnait le compte, faute de tout moyen d'en obtenir
//      un autre.
//
// Ces deux défauts ont été trouvés en recette réelle les 2026-08-09 et 10, et
// aucun test unitaire ne pouvait les voir : ils ne vivent que dans
// l'enchaînement.
// ============================================================================

const BASE = 'stagiaires_it_preuve_telephone';

const MINEUR = '+237699001122';
const TUTEUR = '+237699003344';
const VICTIME = '+237699005566';
const ATTAQUANT = '+237699007788';

function urlDe(base: string): string {
  const u = new URL(process.env.DATABASE_URL_ORIGINE!);
  u.pathname = '/' + base;
  return u.href;
}

async function sqlAdmin(requete: string): Promise<void> {
  const c = new Client({ connectionString: urlDe('postgres') });
  await c.connect();
  try {
    await c.query(requete);
  } finally {
    await c.end();
  }
}

describe('Preuve du téléphone et renvoi du code (base réelle)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let otp: OtpService;
  const sms: { to: string; body: string }[] = [];

  // Le code tel que l'utilisateur le lit. Ancré sur le libellé : le message
  // contient aussi des numéros de téléphone, dont un `\d{6}` naïf capturerait
  // les premiers chiffres.
  const codeInscription = () => {
    const dernier = [...sms]
      .reverse()
      .find((m) => /code de vérification/.test(m.body));
    return /est (\d{6})/.exec(dernier!.body)![1];
  };
  const codeConsentement = () => {
    const dernier = [...sms].reverse().find((m) => /votre code/.test(m.body));
    return /votre code\s*:\s*(\d{6})/.exec(dernier!.body)![1];
  };

  // TTL du code piloté par le test : c'est ce qui permet d'éprouver
  // l'expiration sans attendre cinq minutes.
  let ttlMinutes = '5';
  // Le délai de garde du renvoi, piloté par le test : à 60 secondes, il
  // bloquerait le renvoi qui suit immédiatement une inscription — ce qui est
  // le bon comportement en production, mais empêche d'éprouver la suite.
  // Chaque scénario règle donc explicitement ce qu'il veut mesurer.
  let cooldownRenvoi = '60';

  function construire() {
    const config = new ConfigService({
      get OTP_TTL_MINUTES() {
        return ttlMinutes;
      },
      OTP_MAX_ATTEMPTS: '5',
      get OTP_RESEND_COOLDOWN_SECONDS() {
        return cooldownRenvoi;
      },
      PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES: '0',
      JWT_ACCESS_SECRET: 'secret-de-test-access-suffisamment-long-0123456789',
      JWT_REFRESH_SECRET: 'secret-de-test-refresh-suffisamment-long-0123456789',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
      LOCKOUT_MAX_ATTEMPTS: '5',
      LOCKOUT_DURATION_MINUTES: '15',
      LS_ID_COUNTRY_CODE: 'CM',
      PARENTAL_CONSENT_TTL_HOURS: '72',
      APP_PUBLIC_URL: 'https://recette.exemple.org',
    });

    const faux = {
      send: (to: string, body: string) => {
        sms.push({ to, body });
        return Promise.resolve();
      },
    };
    const audit = new AuditService(prisma);
    otp = new OtpService(prisma, config, faux);
    const pays = new CountryPolicyService(prisma, audit);
    const minor = new MinorPolicyService(prisma, pays);
    const consent = new ParentalConsentService(
      prisma,
      config,
      faux,
      audit,
      minor,
      pays,
    );
    // L'ordre compte : (jwt, config, prisma). Inversé, `this.prisma` recevait
    // le service JWT et la création de session échouait sur un `undefined`.
    const tokens = new TokenService(new JwtService(), config, prisma);

    auth = new AuthService(
      prisma,
      config,
      otp,
      tokens,
      audit,
      consent,
      // Le parrainage n'intervient pas ici : aucun code n'est fourni à
      // l'inscription, donc `attributeUser` n'est jamais appelée.
      { attributeUser: () => Promise.resolve(null) } as never,
      minor,
      faux,
    );
  }

  const inscrire = (phone: string, parentPhone: string) => {
    const quinzeAns = new Date();
    quinzeAns.setFullYear(quinzeAns.getFullYear() - 15);
    return auth.register({
      firstName: 'Test',
      lastName: 'Recette',
      sex: 'FEMALE',
      phone,
      cityOfResidence: 'Douala',
      countryOfResidence: 'CM',
      password: 'RecetteMotDePasse1',
      language: 'FR',
      dateOfBirth: quinzeAns.toISOString().slice(0, 10),
      parentPhone,
    } as never);
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL absente : ce test d'intégration a besoin d'un PostgreSQL joignable.",
      );
    }
    process.env.DATABASE_URL_ORIGINE = process.env.DATABASE_URL;

    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE}"`);
    await sqlAdmin(`CREATE DATABASE "${BASE}"`);
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: urlDe(BASE) },
      stdio: 'pipe',
    });

    process.env.DATABASE_URL = urlDe(BASE);
    prisma = new PrismaService();
    construire();

    const politique = {
      minInternshipAge: 14,
      minParentRequiredAge: 14,
      civilMajorityAge: 18,
      parentalInfoMaxAge: 21,
      refusalDelay1Days: 7,
      refusalDelay2Days: 30,
      refusalDelayFinalDays: 182,
      gatedActions: ['REGISTRATION', 'APPLICATION_SUBMIT'] as never,
    };
    await prisma.countryPolicy.upsert({
      where: { countryCode: 'CM' },
      update: politique,
      create: { countryCode: 'CM', ...politique },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    process.env.DATABASE_URL = process.env.DATABASE_URL_ORIGINE;
    await sqlAdmin(`DROP DATABASE IF EXISTS "${BASE}"`);
  }, 60_000);

  // ==========================================================================
  // BLOQUEUR A — les huit étapes exigées
  // ==========================================================================
  it('A. la preuve survit à un refus parental, et c’est elle qui autorise la connexion', async () => {
    // --- 1. création du compte ----------------------------------------------
    await inscrire(MINEUR, TUTEUR);
    const apresInscription = await prisma.user.findUniqueOrThrow({
      where: { phone: MINEUR },
    });
    expect(apresInscription.status).toBe(AccountStatus.PENDING_VERIFICATION);
    expect(apresInscription.phoneVerifiedAt).toBeNull();

    // --- 2. vérification EFFECTIVE du téléphone ------------------------------
    await auth.verifyRegistrationOtp(
      { phone: MINEUR, code: codeInscription() },
      undefined,
      undefined,
    );
    const verifie = await prisma.user.findUniqueOrThrow({
      where: { phone: MINEUR },
    });
    expect(verifie.phoneVerifiedAt).not.toBeNull();
    expect(verifie.lsId).not.toBeNull();
    // `expect(...).not.toBeNull()` ci-dessus ne restreint pas le type pour le
    // compilateur : on le lui dit ici, une fois, plutôt que par une assertion
    // à chaque usage.
    if (!verifie.phoneVerifiedAt) throw new Error('preuve absente');
    const preuveInitiale = verifie.phoneVerifiedAt.toISOString();

    // --- 3. la demande de consentement est partie à l'inscription -----------
    const lien = await prisma.parentalLink.findFirstOrThrow({
      where: { childId: verifie.id },
    });

    // --- 4. le tuteur refuse -------------------------------------------------
    await auth['parentalConsent'].declineConsent(lien.id, codeConsentement());

    // --- 5. LA PREUVE EST INTACTE -------------------------------------------
    const apresRefus = await prisma.user.findUniqueOrThrow({
      where: { phone: MINEUR },
    });
    expect(apresRefus.phoneVerifiedAt?.toISOString()).toBe(preuveInitiale);
    expect(apresRefus.parentalRefusalCount).toBe(1);
    expect(apresRefus.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);

    const journal = await prisma.auditLog.findMany({
      where: { userId: verifie.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(journal.map((a) => a.action)).toContain('ACCOUNT_PHONE_VERIFIED');

    // --- 6 et 7. la connexion passe, ET c'est bien la preuve qui l'autorise --
    const session = await auth.login(
      { identifier: MINEUR, password: 'RecetteMotDePasse1' },
      undefined,
      undefined,
    );
    expect(session).toHaveProperty('accessToken');

    // LA DÉMONSTRATION DE CAUSALITÉ. On retire la preuve — et seulement elle,
    // le statut restant `AWAITING_PARENTAL_CONSENT`. Si la connexion continuait
    // de passer, c'est qu'elle s'appuierait encore sur autre chose.
    await prisma.user.update({
      where: { id: verifie.id },
      data: { phoneVerifiedAt: null },
    });
    await expect(
      auth.login(
        { identifier: MINEUR, password: 'RecetteMotDePasse1' },
        undefined,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // On la remet, et la connexion repasse : la preuve est bien la cause.
    await prisma.user.update({
      where: { id: verifie.id },
      data: { phoneVerifiedAt: new Date(preuveInitiale) },
    });
    await expect(
      auth.login(
        { identifier: MINEUR, password: 'RecetteMotDePasse1' },
        undefined,
        undefined,
      ),
    ).resolves.toHaveProperty('accessToken');
  }, 120_000);

  // ==========================================================================
  // LE TEST DE SÉCURITÉ — usurpation du numéro d'un tiers
  // ==========================================================================
  it('A-bis. connaître le numéro d’une victime ne rend pas son compte connectable', async () => {
    // L'attaquant s'inscrit avec le numéro de la VICTIME, et se déclare
    // lui-même comme tuteur. Il maîtrise donc le téléphone du « tuteur », mais
    // pas celui du compte.
    await inscrire(VICTIME, ATTAQUANT);
    const compte = await prisma.user.findUniqueOrThrow({
      where: { phone: VICTIME },
    });

    // Il refuse depuis SON téléphone — le SMS d'accord lui est bien parvenu.
    const lien = await prisma.parentalLink.findFirstOrThrow({
      where: { childId: compte.id },
    });
    expect(lien.parentPhoneNormalized).toBe(ATTAQUANT);
    await auth['parentalConsent'].declineConsent(lien.id, codeConsentement());

    // Avant correction, le compte sortait de PENDING_VERIFICATION et devenait
    // connectable. Désormais :
    const apres = await prisma.user.findUniqueOrThrow({
      where: { phone: VICTIME },
    });
    expect(apres.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);
    expect(apres.phoneVerifiedAt).toBeNull();

    await expect(
      auth.login(
        { identifier: VICTIME, password: 'RecetteMotDePasse1' },
        undefined,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 120_000);

  // ==========================================================================
  // BLOQUEUR B — le cycle complet du code d'inscription
  // ==========================================================================
  it('B. un code expiré ne condamne plus le compte', async () => {
    const TARDIF = '+237699009900';

    // Un code qui naît déjà expiré : c'est l'équivalent d'un SMS arrivé six
    // minutes trop tard, sans attendre six minutes.
    ttlMinutes = '0';
    construire();
    await inscrire(TARDIF, TUTEUR);

    const compte = await prisma.user.findUniqueOrThrow({
      where: { phone: TARDIF },
    });
    const codeExpire = codeInscription();

    // --- l'ancien code ne passe pas -----------------------------------------
    await expect(
      auth.verifyRegistrationOtp(
        { phone: TARDIF, code: codeExpire },
        undefined,
        undefined,
      ),
    ).rejects.toThrow();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { phone: TARDIF } }))
        .phoneVerifiedAt,
    ).toBeNull();

    // --- le renvoi produit un code utilisable -------------------------------
    // Délai de garde neutralisé POUR CETTE MESURE : on éprouve ici le renvoi
    // lui-même, pas sa limitation, qui a son propre scénario (B-ter).
    ttlMinutes = '5';
    cooldownRenvoi = '0';
    construire();
    const reponse = await auth.resendRegistrationOtp(TARDIF);
    expect(reponse.message).toMatch(/nouveau code/);

    const nouveauCode = codeInscription();
    expect(nouveauCode).not.toBe(codeExpire);

    // --- l'ancien code est bien invalidé ------------------------------------
    await expect(
      auth.verifyRegistrationOtp(
        { phone: TARDIF, code: codeExpire },
        undefined,
        undefined,
      ),
    ).rejects.toThrow();

    // Le refus ci-dessus ne prouve rien à lui seul : `verify` ne retient que le
    // code le plus récent, donc l'ancien serait ignoré même sans invalidation.
    // Vérifié le 2026-08-10 en retirant l'invalidation — le test restait vert.
    //
    // On mesure donc la GARANTIE elle-même : après un renvoi, plus aucun code
    // antérieur ne reste consommable. La différence compte, parce que
    // « ignoré par un orderBy » se perd au premier refactoring.
    const anciensVivants = await prisma.otpCode.count({
      where: {
        userId: compte.id,
        purpose: OtpPurpose.REGISTRATION,
        consumedAt: null,
        createdAt: { lt: new Date() },
      },
    });
    expect(anciensVivants).toBe(1); // uniquement celui qui vient d'être envoyé

    // --- le nouveau code fonctionne : le compte est sauvé -------------------
    await auth.verifyRegistrationOtp(
      { phone: TARDIF, code: nouveauCode },
      undefined,
      undefined,
    );
    const sauve = await prisma.user.findUniqueOrThrow({
      where: { phone: TARDIF },
    });
    expect(sauve.phoneVerifiedAt).not.toBeNull();
    expect(sauve.lsId).not.toBeNull();
    expect(sauve.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);

    // --- le délai de garde tient ---------------------------------------------
    const avant = sms.length;
    const compteOtp = await prisma.otpCode.count({
      where: { userId: compte.id, purpose: OtpPurpose.REGISTRATION },
    });
    await auth.resendRegistrationOtp(TARDIF);
    // Compte déjà vérifié : aucun envoi, et la même phrase en réponse.
    expect(sms.length).toBe(avant);
    expect(
      await prisma.otpCode.count({
        where: { userId: compte.id, purpose: OtpPurpose.REGISTRATION },
      }),
    ).toBe(compteOtp);
  }, 120_000);

  it('B-bis. le renvoi ne révèle jamais si un compte existe', async () => {
    // LA COMPARAISON DOIT TRAVERSER DEUX BRANCHES DIFFÉRENTES.
    //
    // Une première version comparait un numéro inconnu à un compte déjà
    // vérifié : les deux passent par la MÊME branche de sortie, donc un
    // message distinctif les changeait tous les deux à l'identique et le test
    // restait vert. Trou constaté le 2026-08-10.
    //
    // On compare donc le cas qui ENVOIE réellement un SMS au cas qui ne fait
    // rien. Ce sont ces deux-là qu'un attaquant chercherait à distinguer.
    const ATTENTE = '+237699004400';
    const INCONNU = '+237699001199';

    ttlMinutes = '5';
    cooldownRenvoi = '0';
    construire();
    await inscrire(ATTENTE, TUTEUR);

    const avantEnvoi = sms.length;
    const pourCompteEnAttente = await auth.resendRegistrationOtp(ATTENTE);
    expect(sms.length).toBe(avantEnvoi + 1); // un SMS est bien parti

    const avantInconnu = sms.length;
    const pourInconnu = await auth.resendRegistrationOtp(INCONNU);
    expect(sms.length).toBe(avantInconnu); // aucun SMS

    // Mot pour mot la même réponse, alors que le comportement diffère. Sans
    // cela, la route deviendrait un annuaire des inscrits de la plateforme —
    // c'est-à-dire, ici, un annuaire de mineurs.
    expect(pourInconnu).toEqual(pourCompteEnAttente);

    // Et un compte déjà vérifié répond pareil, sans rien envoyer non plus.
    const avantVerifie = sms.length;
    expect(await auth.resendRegistrationOtp(MINEUR)).toEqual(pourInconnu);
    expect(sms.length).toBe(avantVerifie);
  }, 60_000);

  // ==========================================================================
  // NON-DIVULGATION — cinq situations, un seul comportement observable
  //
  // La route est publique et prend un numéro de téléphone. Toute différence
  // observable entre ces cas en ferait un annuaire des inscrits — c'est-à-dire,
  // sur cette plateforme, un annuaire de mineurs.
  //
  // On compare TOUT ce qu'un appelant peut voir : la structure de la réponse,
  // son contenu mot pour mot, et l'ordre de grandeur du temps de réponse.
  // ==========================================================================
  it('B-quater. les cinq situations sont indiscernables de l’extérieur', async () => {
    const INEXISTANT = '+237699112233';
    const NON_VERIFIE = '+237699112244';
    const DESACTIVE = '+237699112255';

    ttlMinutes = '5';
    cooldownRenvoi = '0';
    construire();

    await inscrire(NON_VERIFIE, TUTEUR);
    await inscrire(DESACTIVE, TUTEUR);
    await prisma.user.update({
      where: { phone: DESACTIVE },
      data: { status: AccountStatus.PENDING_DELETION },
    });

    const mesurer = async (phone: string) => {
      const debut = process.hrtime.bigint();
      const reponse = await auth.resendRegistrationOtp(phone);
      const ms = Number(process.hrtime.bigint() - debut) / 1e6;
      return { reponse, ms };
    };

    const cas = {
      'numéro inexistant': await mesurer(INEXISTANT),
      'existant, non vérifié': await mesurer(NON_VERIFIE),
      'existant, déjà vérifié': await mesurer(MINEUR),
      'compte bloqué': await mesurer(DESACTIVE),
      // Cinquième situation : le même numéro, redemandé aussitôt. On rétablit
      // le délai de garde pour l'éprouver.
    };
    cooldownRenvoi = '60';
    construire();
    const tropFrequent = await mesurer(NON_VERIFIE);

    const toutes = [...Object.values(cas), tropFrequent];
    const reference = JSON.stringify(toutes[0].reponse);

    // 1. Structure et contenu, mot pour mot.
    for (const [nom, x] of [
      ...Object.entries(cas),
      ['trop fréquent', tropFrequent] as const,
    ]) {
      expect([nom, JSON.stringify(x.reponse)]).toEqual([nom, reference]);
      expect(Object.keys(x.reponse)).toEqual(['message']);
    }

    // 2. Le temps de réponse ne doit pas trahir la branche empruntée.
    //
    // On ne vise pas l'égalité parfaite — impossible avec une base de données
    // dans la boucle. On refuse l'ÉCART FLAGRANT : un cas dix fois plus lent
    // que les autres signalerait qu'il fait quelque chose de plus, et
    // suffirait à distinguer un compte existant d'un numéro inconnu.
    const temps = toutes.map((x) => x.ms);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    // Garde-fou volontairement large : ce test doit signaler un défaut de
    // conception, pas la variabilité d'une machine de développement.
    expect(max).toBeLessThan(Math.max(min * 50, 500));
  }, 120_000);

  it('B-ter. le délai de garde empêche de harceler un numéro', async () => {
    const PRESSE = '+237699002200';
    ttlMinutes = '5';
    // Délai de garde RÉEL cette fois : c'est lui qu'on mesure.
    cooldownRenvoi = '60';
    construire();
    await inscrire(PRESSE, TUTEUR);

    // L'inscription vient d'envoyer un code. Tout renvoi immédiat doit être
    // absorbé : sans cela, un bouton « renvoyer » devient un outil de
    // harcèlement du numéro visé, et chaque envoi est facturé.
    const avant = sms.length;
    await auth.resendRegistrationOtp(PRESSE);
    await auth.resendRegistrationOtp(PRESSE);
    await auth.resendRegistrationOtp(PRESSE);
    expect(sms.length).toBe(avant);

    // Et la tentative est tracée, sans que la réponse la trahisse.
    const compte = await prisma.user.findUniqueOrThrow({
      where: { phone: PRESSE },
    });
    const freine = await prisma.auditLog.count({
      where: {
        userId: compte.id,
        action: 'REGISTRATION_OTP_RESEND_THROTTLED',
      },
    });
    expect(freine).toBe(3);
  }, 60_000);
});
