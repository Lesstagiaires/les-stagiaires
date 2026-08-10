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
  let otp: { generateAndSend: jest.Mock; verify: jest.Mock };
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
    otp = { generateAndSend: jest.fn(), verify: jest.fn() };
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

    it('gives the same error for a nonexistent account as for a wrong password (no account enumeration)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto, undefined, undefined)).rejects.toThrow(
        'Identifiants invalides.',
      );
    });

    it('rejects while the account is locked out', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a deactivated account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ status: AccountStatus.DEACTIVATED }),
      );

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('registers a failed attempt and rejects on a wrong password, without locking below the threshold', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      prisma.user.update.mockResolvedValue(
        makeUser({ failedLoginAttempts: 2 }),
      );

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      // Under the lockout threshold: only the increment call, no lockedUntil write.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('locks the account once the failed-attempt threshold is reached', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      (argon2.verify as jest.Mock).mockResolvedValue(false);
      prisma.user.update.mockResolvedValue(
        makeUser({ failedLoginAttempts: 5 }),
      );

      await expect(
        service.login(dto, undefined, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
      expect(prisma.user.update).toHaveBeenLastCalledWith({
        where: { id: 'u1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(Date) is untyped by design
        data: { lockedUntil: expect.any(Date), failedLoginAttempts: 0 },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'ACCOUNT_LOCKED',
        'u1',
        expect.objectContaining({ reason: 'too_many_failed_attempts' }),
      );
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
