import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { ConfigService } from '@nestjs/config';
import { AccountStatus, OtpPurpose } from '../../generated/prisma/enums';
import type { AmbassadorsService } from '../ambassadors/ambassadors.service';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { MinorPolicyService } from './minor-policy.service';
import type { OtpService } from './otp.service';
import type { ParentalConsentService } from './parental-consent.service';
import { MemoryLoginThrottle } from './login-throttle/memory-login-throttle';
import type { TokenService } from './token.service';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
}));

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    phone: '+237670000000',
    email: null,
    password: 'hashed',
    status: AccountStatus.ACTIVE,
    // LA PREUVE DE POSSESSION DU TÉLÉPHONE, désormais distincte du statut.
    //
    // Le compte de référence est un compte ordinaire : vérifié. Les scénarios
    // qui portent sur un compte NON vérifié la remettent explicitement à
    // `null` — ce qui se lit, alors qu'auparavant tout se jouait dans un
    // statut dont ce n'était pas le rôle.
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    twoFactorEnabled: false,
    lockedUntil: null,
    failedLoginAttempts: 0,
    dateOfBirth: new Date('1990-01-01'),
    countryOfResidence: 'CM',
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    profile: { create: jest.Mock };
    userRole: { findMany: jest.Mock };
    session: { findFirst: jest.Mock };
  };
  let config: { get: jest.Mock };
  let otp: {
    generateAndSend: jest.Mock;
    verify: jest.Mock;
    secondesDepuisDernierEnvoi: jest.Mock;
  };
  let tokens: {
    signTwoFactorChallenge: jest.Mock;
    verifyTwoFactorChallenge: jest.Mock;
    createSession: jest.Mock;
    hasSeenDevice: jest.Mock;
    signAccessToken: jest.Mock;
    issueRefreshToken: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let parentalConsent: { requestConsent: jest.Mock };
  let minorPolicy: {
    assertMeetsMinimumAge: jest.Mock;
    classify: jest.Mock;
    isActionGated: jest.Mock;
  };
  let sms: { send: jest.Mock };
  let ambassadors: { attributeUser: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      profile: { create: jest.fn() },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      session: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          LOCKOUT_MAX_ATTEMPTS: '5',
          LOCKOUT_DURATION_MINUTES: '15',
          LS_ID_COUNTRY_CODE: 'CM',
        };
        return values[key] ?? fallback;
      }),
    };
    otp = {
      generateAndSend: jest.fn(),
      verify: jest.fn(),
      // Aucun code emis par defaut : le delai de garde ne se declenche pas,
      // ce qui preserve le comportement attendu par les tests anterieurs.
      secondesDepuisDernierEnvoi: jest.fn().mockResolvedValue(null),
    };
    tokens = {
      signTwoFactorChallenge: jest.fn().mockResolvedValue('challenge-token'),
      verifyTwoFactorChallenge: jest.fn(),
      createSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
      hasSeenDevice: jest.fn().mockResolvedValue(true),
      signAccessToken: jest.fn().mockResolvedValue('access-token'),
      issueRefreshToken: jest.fn().mockResolvedValue('refresh-token'),
    };
    audit = { record: jest.fn() };
    parentalConsent = { requestConsent: jest.fn() };
    minorPolicy = {
      assertMeetsMinimumAge: jest.fn().mockResolvedValue(undefined),
      classify: jest.fn().mockResolvedValue({ isMinor: false }),
      isActionGated: jest.fn().mockResolvedValue(false),
    };
    sms = { send: jest.fn() };
    ambassadors = { attributeUser: jest.fn() };

    service = new AuthService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      otp as unknown as OtpService,
      tokens as unknown as TokenService,
      audit as unknown as AuditService,
      parentalConsent as unknown as ParentalConsentService,
      ambassadors as unknown as AmbassadorsService,
      minorPolicy as unknown as MinorPolicyService,
      sms,
      new MemoryLoginThrottle(),
    );
  });

  describe('register', () => {
    const dto = {
      firstName: 'Awa',
      lastName: 'Ndiaye',
      sex: 'FEMALE' as const,
      phone: '+237670000000',
      email: undefined,
      cityOfResidence: 'Douala',
      countryOfResidence: 'cm',
      password: 'StrongPass1!',
      language: 'FR' as const,
      dateOfBirth: '1990-01-01',
      parentPhone: undefined,
    };

    it('rejects a phone number already tied to an account', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects an email already tied to an account', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // phone check
        .mockResolvedValueOnce(makeUser()); // email check

      await expect(
        service.register({ ...dto, email: 'taken@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates the minimum-age rejection from the CountryPolicy engine', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      minorPolicy.assertMeetsMinimumAge.mockRejectedValue(
        new BadRequestException('too young'),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('requires a parent phone when registration is gated for this age/country and none was given', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      minorPolicy.classify.mockResolvedValue({ isMinor: true });
      minorPolicy.isActionGated.mockResolvedValue(true);

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates the account, sends the OTP, and requests parental consent when gated with a parent phone', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user' });
      minorPolicy.classify.mockResolvedValue({ isMinor: true });
      minorPolicy.isActionGated.mockResolvedValue(true);

      const result = await service.register({
        ...dto,
        parentPhone: '+237699999999',
      });

      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.profile.create).toHaveBeenCalledWith({
        data: { userId: 'new-user', fullName: 'Awa Ndiaye' },
      });
      expect(otp.generateAndSend).toHaveBeenCalledWith(
        'new-user',
        dto.phone,
        OtpPurpose.REGISTRATION,
      );
      expect(parentalConsent.requestConsent).toHaveBeenCalledWith(
        'new-user',
        '+237699999999',
      );
      expect(result.isMinor).toBe(true);
    });

    it('never blocks account creation while awaiting parental consent — profile and OTP always happen first', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-user' });
      minorPolicy.classify.mockResolvedValue({ isMinor: true });
      minorPolicy.isActionGated.mockResolvedValue(true);

      await service.register({ ...dto, parentPhone: '+237699999999' });

      const otpCallOrder = otp.generateAndSend.mock.invocationCallOrder[0];
      const consentCallOrder =
        parentalConsent.requestConsent.mock.invocationCallOrder[0];
      expect(otpCallOrder).toBeLessThan(consentCallOrder);
    });
  });

  describe('verifyRegistrationOtp', () => {
    it('throws when the account does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyRegistrationOtp(
          { phone: '+237670000000', code: '123456' },
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a second verification attempt on an already-verified account', async () => {
      // Ce qui fait qu'un compte est « déjà vérifié », c'est la PREUVE — pas
      // son statut. Un compte dont le statut a bougé pour une autre raison,
      // un refus parental par exemple, doit rester vérifiable.
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          status: AccountStatus.AWAITING_PARENTAL_CONSENT,
          phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      await expect(
        service.verifyRegistrationOtp(
          { phone: '+237670000000', code: '123456' },
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid or expired OTP code', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          status: AccountStatus.PENDING_VERIFICATION,
          phoneVerifiedAt: null,
        }),
      );
      otp.verify.mockResolvedValue(false);

      await expect(
        service.verifyRegistrationOtp(
          { phone: '+237670000000', code: '000000' },
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('activates a non-gated account and issues session tokens', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({
            status: AccountStatus.PENDING_VERIFICATION,
            phoneVerifiedAt: null,
          }),
        )
        .mockResolvedValueOnce(makeUser()); // used inside createSessionAndIssueTokens for phone lookup
      otp.verify.mockResolvedValue(true);
      minorPolicy.isActionGated.mockResolvedValue(false);

      const result = await service.verifyRegistrationOtp(
        { phone: '+237670000000', code: '123456' },
        undefined,
        undefined,
      );

      expect(result.status).toBe(AccountStatus.ACTIVE);
      expect(result.requiresParentalLink).toBe(false);
      expect(result.accessToken).toBe('access-token');
    });

    it('leaves a gated account AWAITING_PARENTAL_CONSENT rather than activating it', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(
          makeUser({
            status: AccountStatus.PENDING_VERIFICATION,
            phoneVerifiedAt: null,
          }),
        )
        .mockResolvedValueOnce(makeUser());
      otp.verify.mockResolvedValue(true);
      minorPolicy.isActionGated.mockResolvedValue(true);

      const result = await service.verifyRegistrationOtp(
        { phone: '+237670000000', code: '123456' },
        undefined,
        undefined,
      );

      expect(result.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);
      expect(result.requiresParentalLink).toBe(true);
    });
  });

  describe('login', () => {
    const dto = { identifier: '+237670000000', password: 'StrongPass1!' };

    // ========================================================================
    // L'ORDRE EST LA GARANTIE — S-06-C
    //
    // Le contrat n'est pas « le limiteur s'applique aussi aux comptes
    // inexistants », c'est « le limiteur DÉCIDE AVANT que quiconque ait
    // regardé si le compte existe ». La nuance n'est pas théorique :
    //
    //   `consommer()` appelé APRÈS `findFirst()` — même inconditionnellement —
    //   ferait payer au chemin « compte réel » une lecture de base que le
    //   chemin « compte inconnu » ne paie pas, sur la réponse 429. L'oracle
    //   temporel refermé par la passe 1 se rouvrirait sur un autre code de
    //   retour, et aucun test de comportement ne le verrait.
    //
    // D'où ces deux tests, qui observent la MÉCANIQUE et non le résultat.
    // ========================================================================
    describe('le limiteur décide avant toute lecture de la base', () => {
      it('un budget épuisé ne déclenche AUCUNE recherche de compte', async () => {
        const bloquant = {
          consommer: jest.fn().mockResolvedValue({
            autorise: false,
            secondFacteurRequis: false,
            degrade: false,
          }),
          preuveDuMotDePasse: jest.fn(),
        };
        const s = new AuthService(
          prisma as unknown as PrismaService,
          config as unknown as ConfigService,
          otp as unknown as OtpService,
          tokens as unknown as TokenService,
          audit as unknown as AuditService,
          parentalConsent as unknown as ParentalConsentService,
          ambassadors as unknown as AmbassadorsService,
          minorPolicy as unknown as MinorPolicyService,
          sms,
          bloquant,
        );

        await expect(s.login(dto, undefined, undefined)).rejects.toMatchObject({
          status: 429,
        });

        expect(bloquant.consommer).toHaveBeenCalledTimes(1);
        // LE POINT : la base n'a pas été touchée. Rien, dans la réponse 429, ne
        // peut donc dépendre de l'existence du compte — ni son contenu, ni son
        // temps de réponse.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        // Et aucun SMS, évidemment.
        expect(otp.generateAndSend).not.toHaveBeenCalled();
      });

      it('le budget est consommé AVANT la recherche, pas après', async () => {
        const ordre: string[] = [];
        const observateur = {
          consommer: jest.fn().mockImplementation(() => {
            ordre.push('consommer');
            return Promise.resolve({
              autorise: true,
              secondFacteurRequis: false,
              degrade: false,
            });
          }),
          preuveDuMotDePasse: jest.fn(),
        };
        prisma.user.findFirst.mockImplementation(() => {
          ordre.push('findFirst');
          return Promise.resolve(null);
        });

        const s = new AuthService(
          prisma as unknown as PrismaService,
          config as unknown as ConfigService,
          otp as unknown as OtpService,
          tokens as unknown as TokenService,
          audit as unknown as AuditService,
          parentalConsent as unknown as ParentalConsentService,
          ambassadors as unknown as AmbassadorsService,
          minorPolicy as unknown as MinorPolicyService,
          sms,
          observateur,
        );

        (argon2.verify as jest.Mock).mockResolvedValue(false);
        await expect(s.login(dto, undefined, undefined)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );

        expect(ordre).toEqual(['consommer', 'findFirst']);
      });
    });

    // ========================================================================
    // LE REMBOURSEMENT EST RENDU DÈS LA PREUVE DU MOT DE PASSE
    //
    // Il serait tentant de ne rembourser qu'une connexion pleinement réussie.
    // Ce serait une erreur d'équité : le titulaire d'un compte désactivé ou
    // portant un vieux verrou a PROUVÉ son mot de passe — il n'est pas un
    // attaquant, et le compteur par origine qu'il continuerait d'occuper est
    // partagé avec tous ses voisins de NAT.
    //
    // Ces tests observent le MOMENT de l'appel, ce qu'aucun test de
    // comportement ne peut voir : le code de retour est 403 dans les deux cas.
    // ========================================================================
    describe('le remboursement précède les contrôles d’état du compte', () => {
      const limiteurEspion = () => ({
        consommer: jest.fn().mockResolvedValue({
          autorise: true,
          secondFacteurRequis: false,
          degrade: false,
        }),
        preuveDuMotDePasse: jest.fn().mockResolvedValue(undefined),
      });

      const monterAvec = (limiteur: {
        consommer: jest.Mock;
        preuveDuMotDePasse: jest.Mock;
      }) =>
        new AuthService(
          prisma as unknown as PrismaService,
          config as unknown as ConfigService,
          otp as unknown as OtpService,
          tokens as unknown as TokenService,
          audit as unknown as AuditService,
          parentalConsent as unknown as ParentalConsentService,
          ambassadors as unknown as AmbassadorsService,
          minorPolicy as unknown as MinorPolicyService,
          sms,
          limiteur,
        );

      it.each([
        [
          'un compte portant un ancien verrou',
          { lockedUntil: new Date(Date.now() + 60_000) },
        ],
        ['un compte désactivé', { status: AccountStatus.DEACTIVATED }],
        ['un compte non vérifié par OTP', { phoneVerifiedAt: null }],
      ])(
        'rembourse pour %s, bien que la connexion soit refusée',
        async (_nom, surcharges) => {
          const limiteur = limiteurEspion();
          const s = monterAvec(limiteur);
          prisma.user.findFirst.mockResolvedValue(makeUser(surcharges));
          (argon2.verify as jest.Mock).mockResolvedValue(true);

          await expect(
            s.login(dto, undefined, undefined),
          ).rejects.toBeInstanceOf(ForbiddenException);

          expect(limiteur.preuveDuMotDePasse).toHaveBeenCalledTimes(1);
        },
      );

      it('ne rembourse JAMAIS sur un mot de passe faux', async () => {
        const limiteur = limiteurEspion();
        const s = monterAvec(limiteur);
        prisma.user.findFirst.mockResolvedValue(makeUser());
        (argon2.verify as jest.Mock).mockResolvedValue(false);

        await expect(s.login(dto, undefined, undefined)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );

        // C'est toute la différence entre « compter les tentatives » et
        // « compter les échecs » : l'échec garde sa réservation.
        expect(limiteur.preuveDuMotDePasse).not.toHaveBeenCalled();
      });

      // ======================================================================
      // LE DÉLAI DE GARDE DU SMS 2FA — A1
      //
      // Ces tests observent l'ENVOI, pas la réponse : le corps rendu est
      // rigoureusement le même que le message parte ou non, et c'est justement
      // ce qu'il faut vérifier. Un test de comportement ne verrait rien.
      // ======================================================================
      it('n’envoie PAS de second SMS pendant le délai de garde', async () => {
        otp.secondesDepuisDernierEnvoi.mockResolvedValue(5); // < 60 s
        prisma.user.findFirst.mockResolvedValue(
          makeUser({ twoFactorEnabled: true }),
        );
        (argon2.verify as jest.Mock).mockResolvedValue(true);

        const r = (await service.login(dto, undefined, undefined)) as {
          requiresTwoFactor: boolean;
          challengeToken: string;
        };

        expect(otp.generateAndSend).not.toHaveBeenCalled();
        // MAIS la connexion suit son cours : le défi est émis, et le code
        // précédent — encore vivant — reste saisissable. Refuser ici aurait
        // offert un déni de service en échange du SMS économisé.
        expect(r.requiresTwoFactor).toBe(true);
        expect(r.challengeToken).toBe('challenge-token');
      });

      it('envoie le SMS une fois le délai écoulé', async () => {
        otp.secondesDepuisDernierEnvoi.mockResolvedValue(120); // > 60 s
        prisma.user.findFirst.mockResolvedValue(
          makeUser({ twoFactorEnabled: true }),
        );
        (argon2.verify as jest.Mock).mockResolvedValue(true);

        await service.login(dto, undefined, undefined);
        expect(otp.generateAndSend).toHaveBeenCalledTimes(1);
      });

      it('envoie le SMS quand aucun code n’a jamais été émis', async () => {
        otp.secondesDepuisDernierEnvoi.mockResolvedValue(null);
        prisma.user.findFirst.mockResolvedValue(
          makeUser({ twoFactorEnabled: true }),
        );
        (argon2.verify as jest.Mock).mockResolvedValue(true);

        await service.login(dto, undefined, undefined);
        expect(otp.generateAndSend).toHaveBeenCalledTimes(1);
      });

      it('la réponse est IDENTIQUE que le SMS parte ou non', async () => {
        // C'est la garantie qui empêche le délai de garde de devenir un canal
        // d'information : rien, dans ce que voit l'appelant, ne dit si un
        // message a été émis.
        prisma.user.findFirst.mockResolvedValue(
          makeUser({ twoFactorEnabled: true }),
        );
        (argon2.verify as jest.Mock).mockResolvedValue(true);

        otp.secondesDepuisDernierEnvoi.mockResolvedValue(5);
        const avecGarde = await service.login(dto, undefined, undefined);

        otp.secondesDepuisDernierEnvoi.mockResolvedValue(120);
        const sansGarde = await service.login(dto, undefined, undefined);

        expect(avecGarde).toEqual(sansGarde);
      });

      it('ne rembourse pas davantage pour un identifiant inexistant', async () => {
        const limiteur = limiteurEspion();
        const s = monterAvec(limiteur);
        prisma.user.findFirst.mockResolvedValue(null);
        (argon2.verify as jest.Mock).mockResolvedValue(false);

        await expect(s.login(dto, undefined, undefined)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(limiteur.consommer).toHaveBeenCalledTimes(1);
        expect(limiteur.preuveDuMotDePasse).not.toHaveBeenCalled();
      });
    });

    it('gives the same error for a nonexistent account as for a wrong password (no account enumeration)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto, undefined, undefined)).rejects.toThrow(
        'Identifiants invalides.',
      );
    });

    // S-06-A. Ces deux cas testaient un rejet ; ils testent désormais QUAND il
    // survient. Un compte verrouillé ou désactivé ne se signale plus à qui
    // ignore le mot de passe — il répondait auparavant 403 dès la première
    // tentative, ce qui suffisait à savoir qu'il existait.
    it('a locked-out account is indistinguishable until the password is proven', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );
      // Depuis S-06-C, un mauvais mot de passe n'écrit plus rien sur le compte :
      // le compteur a quitté `User` pour le limiteur, clé sur l'origine.
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a deactivated account is indistinguishable until the password is proven', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ status: AccountStatus.DEACTIVATED }),
      );
      prisma.user.update.mockResolvedValue(
        makeUser({ failedLoginAttempts: 1 }),
      );

      (argon2.verify as jest.Mock).mockResolvedValue(false);
      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // S-06-B. Le chemin « compte inexistant » doit faire le MÊME travail
    // cryptographique que le chemin « mauvais mot de passe » : sans quoi le
    // temps de réponse dit ce que le message tait.
    it('verifies a password even when the account does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      (argon2.verify as jest.Mock).mockClear();

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(argon2.verify).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // S-06-C. Ces deux cas vérifiaient que le compteur montait sur la ligne
    // `User` de la cible, puis qu'un verrou s'y posait au cinquième échec.
    // C'était le vecteur : un tiers ne connaissant qu'un numéro excluait son
    // titulaire. Ils vérifient désormais l'inverse — que RIEN n'est écrit.
    it('a wrong password writes nothing on the target account', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('no number of failed attempts can lock the victim out', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      for (let i = 0; i < 10; i++) {
        await expect(
          service.login(dto, undefined, undefined),
        ).rejects.toBeDefined();
      }

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalledWith(
        'ACCOUNT_LOCKED',
        expect.anything(),
        expect.anything(),
      );
    });

    it('records the failed attempt with its origin, existing account or not', async () => {
      // Une écriture DES DEUX CÔTÉS : sinon le chemin « compte existant »
      // serait mesurablement plus lent, et l'on rouvrirait S-06-B.
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      prisma.user.findFirst.mockResolvedValue(makeUser());
      await expect(
        service.login(dto, 'Mozilla/5.0', '203.0.113.9'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.login(dto, 'Mozilla/5.0', '203.0.113.9'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Les appels du mock sont `any[]` : on les retype sur la signature réelle
      // pour que les index ci-dessous soient vérifiés par le compilateur. Un
      // paramètre inséré dans `record()` casserait ici, pas silencieusement.
      type AppelAudit = Parameters<AuditService['record']>;
      const echecs = (audit.record.mock.calls as AppelAudit[]).filter(
        (c) => c[0] === 'LOGIN_FAILED',
      );
      expect(echecs).toHaveLength(2);
      expect(echecs[0][1]).toBe('u1');
      expect(echecs[1][1]).toBeNull();
      for (const appel of echecs) {
        expect(appel[3]).toEqual({
          ipAddress: '203.0.113.9',
          userAgent: 'Mozilla/5.0',
        });
        // L'identifiant tenté n'est JAMAIS consigné : le journal deviendrait
        // sinon une liste de numéros de téléphone.
        expect(JSON.stringify(appel[2] ?? {})).not.toContain(dto.identifier);
      }
    });

    it('rejects a login before the phone/OTP verification step has completed', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({
          status: AccountStatus.PENDING_VERIFICATION,
          phoneVerifiedAt: null,
        }),
      );
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('issues session tokens directly when 2FA is not enabled', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.login(dto, undefined, undefined);

      expect(result.requiresTwoFactor).toBe(false);
      expect(result).toHaveProperty('accessToken', 'access-token');
    });

    // CLAUDE.md §2 : le mot de passe seul ne suffit jamais à ouvrir la session si la 2FA
    // est active — aucun jeton ne doit être émis à cette étape.
    it('never issues session tokens on password success alone when 2FA is enabled — only a challenge', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ twoFactorEnabled: true }),
      );
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto, undefined, undefined);

      expect(result).toEqual({
        requiresTwoFactor: true,
        challengeToken: 'challenge-token',
      });
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
      expect(otp.generateAndSend).toHaveBeenCalledWith(
        'u1',
        '+237670000000',
        OtpPurpose.LOGIN_2FA,
      );
    });
  });

  describe('verifyLoginTwoFactor', () => {
    it('rejects an invalid or expired challenge token', async () => {
      tokens.verifyTwoFactorChallenge.mockImplementation(() => {
        throw new Error('bad token');
      });

      await expect(
        service.verifyLoginTwoFactor(
          { challengeToken: 'bad', code: '123456' },
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an invalid OTP code even with a valid challenge token', async () => {
      tokens.verifyTwoFactorChallenge.mockReturnValue('u1');
      otp.verify.mockResolvedValue(false);

      await expect(
        service.verifyLoginTwoFactor(
          { challengeToken: 'good', code: '000000' },
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues session tokens once both the challenge token and OTP are valid', async () => {
      tokens.verifyTwoFactorChallenge.mockReturnValue('u1');
      otp.verify.mockResolvedValue(true);
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const result = await service.verifyLoginTwoFactor(
        { challengeToken: 'good', code: '123456' },
        undefined,
        undefined,
      );

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(audit.record).toHaveBeenCalledWith('LOGIN_2FA_VERIFIED', 'u1');
    });
  });

  describe('enableTwoFactor / disableTwoFactor', () => {
    it('refuses to enable 2FA on an account with no phone number', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(
        makeUser({ phone: null }),
      );

      await expect(service.enableTwoFactor('u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('enables 2FA on an account that has a phone number', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

      await service.enableTwoFactor('u1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { twoFactorEnabled: true },
      });
    });

    it('refuses to disable 2FA without the correct password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.disableTwoFactor('u1', { password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
