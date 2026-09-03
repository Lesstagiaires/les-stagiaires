import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { createTemporaryPostgres } from '../test-support/temporary-postgres';
import { OtpService } from './otp.service';

// ============================================================================
// REVUE DE SÉCURITÉ DU MÉCANISME DE CODE À USAGE UNIQUE
//
// Douze points, éprouvés sur PostgreSQL réel plutôt que lus dans le code. Le
// mécanisme vient d'être modifié (invalidation explicite, route de renvoi) :
// c'est exactement le moment où une garantie se perd sans qu'on s'en aperçoive.
//
// Chaque test porte sur une PROPRIÉTÉ, pas sur une ligne : il doit survivre à
// une réécriture du service.
// ============================================================================

const BASE = 'stagiaires_it_otp_securite';

describe('Sécurité du code à usage unique (base réelle)', () => {
  let prisma: PrismaService;
  let database: Awaited<ReturnType<typeof createTemporaryPostgres>>;
  let otp: OtpService;
  const sms: { to: string; body: string }[] = [];
  let alice = '';
  let bob = '';

  const dernierCode = () => /est (\d{6})/.exec(sms[sms.length - 1].body)![1];

  function service(ttl = '5', maxTentatives = '5') {
    return new OtpService(
      prisma,
      new ConfigService({
        OTP_TTL_MINUTES: ttl,
        OTP_MAX_ATTEMPTS: maxTentatives,
      }),
      {
        send: (to: string, body: string) => {
          sms.push({ to, body });
          return Promise.resolve();
        },
      },
    );
  }

  const creerCompte = async (phone: string) =>
    (
      await prisma.user.create({
        data: { phone, password: 'peu-importe', firstName: 'T' },
      })
    ).id;

  beforeAll(async () => {
    database = await createTemporaryPostgres(BASE);
    prisma = database.prisma;
    otp = service();

    alice = await creerCompte('+237698000001');
    bob = await creerCompte('+237698000002');
  }, 180_000);

  afterAll(async () => {
    try {
      // Prisma est la seule ressource spécifique de cette spec.
    } finally {
      await database?.close();
    }
  }, 60_000);

  // --- 1. Réutilisation d'un code déjà consommé ------------------------------
  it('1. un code consommé ne se rejoue pas', async () => {
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const code = dernierCode();

    expect(await otp.verify(alice, code, OtpPurpose.REGISTRATION)).toBe(true);
    // Le même code, une seconde fois : refusé.
    expect(await otp.verify(alice, code, OtpPurpose.REGISTRATION)).toBe(false);
  }, 60_000);

  // --- 2. Invalidation de l'ancien code lors d'un renvoi ---------------------
  it('2. un renvoi invalide l’ancien code', async () => {
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const ancien = dernierCode();
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const nouveau = dernierCode();

    expect(nouveau).not.toBe(ancien);
    expect(await otp.verify(alice, ancien, OtpPurpose.REGISTRATION)).toBe(
      false,
    );
    expect(await otp.verify(alice, nouveau, OtpPurpose.REGISTRATION)).toBe(
      true,
    );

    // La garantie, mesurée : plus aucun code antérieur ne reste consommable.
    const vivants = await prisma.otpCode.count({
      where: {
        userId: alice,
        purpose: OtpPurpose.REGISTRATION,
        consumedAt: null,
      },
    });
    expect(vivants).toBe(0); // celui qui vient de servir est consommé lui aussi
  }, 60_000);

  // --- 3. Concurrence de deux renvois ---------------------------------------
  it('3. deux renvois simultanés ne laissent qu’un seul code vivant', async () => {
    // Le vrai risque de la concurrence : deux codes valides en même temps,
    // dont l'un survit à l'invalidation de l'autre.
    await Promise.all([
      otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION),
      otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION),
      otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION),
    ]);

    const vivants = await prisma.otpCode.findMany({
      where: {
        userId: alice,
        purpose: OtpPurpose.REGISTRATION,
        consumedAt: null,
      },
    });
    // Au plus un code exploitable. Une exécution concurrente peut en laisser
    // deux transitoirement ; ce que le test interdit, c'est qu'il en reste
    // plusieurs APRÈS coup.
    expect(vivants.length).toBeLessThanOrEqual(1);
  }, 60_000);

  // --- 4. Force brute --------------------------------------------------------
  it('4. le nombre de tentatives est plafonné', async () => {
    const o = service('5', '3');
    await o.generateAndSend(bob, '+237698000002', OtpPurpose.REGISTRATION);
    const bon = dernierCode();
    const faux = bon === '000000' ? '111111' : '000000';

    expect(await o.verify(bob, faux, OtpPurpose.REGISTRATION)).toBe(false);
    expect(await o.verify(bob, faux, OtpPurpose.REGISTRATION)).toBe(false);
    expect(await o.verify(bob, faux, OtpPurpose.REGISTRATION)).toBe(false);

    // Plafond atteint : même le BON code ne passe plus. C'est le point qui
    // compte — sinon un attaquant épuiserait l'espace des six chiffres.
    expect(await o.verify(bob, bon, OtpPurpose.REGISTRATION)).toBe(false);
  }, 60_000);

  // --- 5. Cloisonnement entre comptes ---------------------------------------
  it('5. un code destiné à un compte ne vaut pas pour un autre', async () => {
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const codeAlice = dernierCode();

    // Bob présente le code d'Alice. Sans cloisonnement, connaître un code
    // suffirait à vérifier n'importe quel compte.
    expect(await otp.verify(bob, codeAlice, OtpPurpose.REGISTRATION)).toBe(
      false,
    );
    expect(await otp.verify(alice, codeAlice, OtpPurpose.REGISTRATION)).toBe(
      true,
    );
  }, 60_000);

  // --- 6. Cloisonnement entre usages ----------------------------------------
  it('6. un code d’inscription ne vaut pas pour une autre finalité', async () => {
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const code = dernierCode();

    // Un code de réinitialisation de mot de passe accepté à l'inscription — ou
    // l'inverse — permettrait de détourner un parcours par un autre.
    expect(await otp.verify(alice, code, OtpPurpose.PASSWORD_RESET)).toBe(
      false,
    );
  }, 60_000);

  // --- 7. Expiration ---------------------------------------------------------
  it('7. un code expiré ne passe pas, et un renvoi rétablit le parcours', async () => {
    const expirant = service('0');
    await expirant.generateAndSend(bob, '+237698000002', OtpPurpose.LOGIN_2FA);
    const perime = dernierCode();
    expect(await expirant.verify(bob, perime, OtpPurpose.LOGIN_2FA)).toBe(
      false,
    );

    const frais = service('5');
    await frais.generateAndSend(bob, '+237698000002', OtpPurpose.LOGIN_2FA);
    expect(await frais.verify(bob, dernierCode(), OtpPurpose.LOGIN_2FA)).toBe(
      true,
    );
  }, 60_000);

  // --- 8. Plusieurs renvois d'affilée ---------------------------------------
  it('8. après cinq renvois, seul le dernier code fonctionne', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      await otp.generateAndSend(bob, '+237698000002', OtpPurpose.REGISTRATION);
      codes.push(dernierCode());
    }
    for (const ancien of codes.slice(0, -1)) {
      expect(await otp.verify(bob, ancien, OtpPurpose.REGISTRATION)).toBe(
        false,
      );
    }
    expect(
      await otp.verify(bob, codes[codes.length - 1], OtpPurpose.REGISTRATION),
    ).toBe(true);
  }, 60_000);

  // --- 9. Le code n'est ni fixé ni prévisible --------------------------------
  it('9. le code n’est pas prévisible et ne se laisse pas imposer', async () => {
    const vus = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await otp.generateAndSend(
        alice,
        '+237698000001',
        OtpPurpose.REGISTRATION,
      );
      vus.add(dernierCode());
    }
    // Un générateur figé, ou dérivé de l'horodatage, produirait des collisions
    // massives. On n'exige pas la perfection statistique : on refuse
    // l'évidence.
    expect(vus.size).toBeGreaterThan(25);
    for (const c of vus) expect(c).toMatch(/^\d{6}$/);

    // Et l'appelant ne choisit pas le code : la signature ne le permet pas.
    expect(otp.generateAndSend.length).toBe(3); // userId, destination, purpose
  }, 120_000);

  // --- 10. Le code n'est jamais stocké en clair ------------------------------
  it('10. la base ne contient aucun code en clair', async () => {
    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const code = dernierCode();

    const lignes = await prisma.otpCode.findMany({
      where: { userId: alice },
      select: { codeHash: true, destination: true },
    });
    for (const l of lignes) {
      expect(l.codeHash).not.toBe(code);
      expect(l.codeHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256
    }
  }, 60_000);

  // --- 11. Le code ne sort jamais d'une réponse ------------------------------
  it('11. aucune méthode ne rend le code à l’appelant', async () => {
    const retour = await otp.generateAndSend(
      alice,
      '+237698000001',
      OtpPurpose.REGISTRATION,
    );
    // `generateAndSend` ne rend RIEN. Un jour où elle rendrait le code « pour
    // faciliter les tests », il se retrouverait dans une réponse d'API.
    expect(retour).toBeUndefined();

    const verdict = await otp.verify(
      alice,
      dernierCode(),
      OtpPurpose.REGISTRATION,
    );
    expect(typeof verdict).toBe('boolean');
  }, 60_000);

  // --- 12. Le code n'apparaît pas dans les journaux --------------------------
  it('12. ni le journal d’audit ni la sortie standard ne portent le code', async () => {
    const sorties: string[] = [];
    const espion = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        sorties.push(String(chunk));
        return true;
      });

    await otp.generateAndSend(alice, '+237698000001', OtpPurpose.REGISTRATION);
    const code = dernierCode();
    await otp.verify(alice, code, OtpPurpose.REGISTRATION);

    espion.mockRestore();

    for (const ligne of sorties) expect(ligne).not.toContain(code);

    const journal = await prisma.auditLog.findMany({
      where: { userId: alice },
    });
    for (const a of journal) {
      expect(JSON.stringify(a.metadata ?? {})).not.toContain(code);
    }
  }, 60_000);
});
