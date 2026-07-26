import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AccountStatus, MinorGatedAction, OtpPurpose } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { generateLsIdCandidate } from '../common/ls-id/ls-id.util';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { deriveDeviceLabel } from './device-label.util';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginTwoFactorDto } from './dto/verify-login-two-factor.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { MinorPolicyService } from './minor-policy.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { TokenService } from './token.service';

const RETENTION_DAYS_BEFORE_HARD_DELETE = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly parentalConsent: ParentalConsentService,
    private readonly minorPolicy: MinorPolicyService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  // --- FR-AUTH-001 / 002 / 003 : inscription, OTP, LS-ID ---------------------------------

  async register(dto: RegisterDto) {
    const existingPhone = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existingPhone) {
      throw new ConflictException(
        'Ce numéro de téléphone est déjà associé à un compte.',
      );
    }
    if (dto.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existingEmail) {
        throw new ConflictException(
          'Cette adresse email est déjà associée à un compte.',
        );
      }
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    const countryOfResidence = dto.countryOfResidence.toUpperCase();

    // Âge minimum du pays déclaré — avant toute autre vérification (moteur de règles
    // CountryPolicy, jamais un seuil fixe, cahier des charges).
    await this.minorPolicy.assertMeetsMinimumAge(dateOfBirth, countryOfResidence);

    const { isMinor } = await this.minorPolicy.classify(dateOfBirth, countryOfResidence);
    const registrationGated = await this.minorPolicy.isActionGated(
      { dateOfBirth, countryOfResidence },
      MinorGatedAction.REGISTRATION,
    );

    // Le téléphone d'un parent/tuteur n'est requis que si l'inscription fait partie des
    // actions encadrées pour ce pays et cette tranche d'âge — jamais un seuil fixe de
    // 18 ans (CLAUDE.md §5, moteur de règles CountryPolicy).
    if (registrationGated && !dto.parentPhone) {
      throw new BadRequestException(
        "Le numéro de téléphone d'un parent ou tuteur est requis pour un compte de cet âge, dans ce pays.",
      );
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        sex: dto.sex,
        phone: dto.phone,
        email: dto.email,
        cityOfResidence: dto.cityOfResidence,
        countryOfResidence,
        password: passwordHash,
        language: dto.language,
        dateOfBirth,
        isMinor,
        status: AccountStatus.PENDING_VERIFICATION,
      },
    });
    // Profil préreempli avec le nom déclaré à l'inscription — modifiable ensuite,
    // notamment pour les documents générés nommément (lettre d'admission, convention).
    await this.prisma.profile.create({
      data: { userId: user.id, fullName: `${dto.firstName} ${dto.lastName}` },
    });

    await this.otp.generateAndSend(user.id, dto.phone, OtpPurpose.REGISTRATION);
    await this.audit.record('ACCOUNT_REGISTERED', user.id, { isMinor, countryOfResidence });

    // Envoyé dès la saisie, en parallèle de l'OTP — jamais après coup
    // (FR-AUTH-004a : ne jamais bloquer l'inscription en attendant la validation).
    if (registrationGated && dto.parentPhone) {
      await this.parentalConsent.requestConsent(user.id, dto.parentPhone);
    }

    return {
      userId: user.id,
      isMinor,
      message: isMinor
        ? 'Code de vérification envoyé par SMS. Un SMS de consentement a également été envoyé au parent/tuteur déclaré.'
        : 'Code de vérification envoyé par SMS.',
    };
  }

  async verifyRegistrationOtp(
    dto: VerifyOtpDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.status !== AccountStatus.PENDING_VERIFICATION) {
      throw new BadRequestException('Ce compte est déjà vérifié.');
    }

    const isValid = await this.otp.verify(
      user.id,
      dto.code,
      OtpPurpose.REGISTRATION,
    );
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    const lsId = await this.generateUniqueLsId();
    const registrationGated =
      user.dateOfBirth && user.countryOfResidence
        ? await this.minorPolicy.isActionGated(user, MinorGatedAction.REGISTRATION)
        : false;
    const newStatus = registrationGated
      ? AccountStatus.AWAITING_PARENTAL_CONSENT
      : AccountStatus.ACTIVE;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lsId, status: newStatus },
    });

    await this.audit.record('ACCOUNT_PHONE_VERIFIED', user.id, {
      lsId,
      newStatus,
    });

    // Premier appareil du compte — jamais de notification "nouvel appareil" ici, le
    // parcours d'inscription vient déjà de faire ses preuves via l'OTP.
    const { accessToken, refreshToken } = await this.createSessionAndIssueTokens(
      user.id,
      userAgent,
      ip,
    );

    return {
      lsId,
      status: newStatus,
      accessToken,
      refreshToken,
      requiresParentalLink: registrationGated,
    };
  }

  private async generateUniqueLsId(): Promise<string> {
    const countryCode = this.config.get<string>('LS_ID_COUNTRY_CODE', 'CM');
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateLsIdCandidate(countryCode);
      const exists = await this.prisma.user.findUnique({
        where: { lsId: candidate },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      'Impossible de générer un LS-ID unique, réessayez.',
    );
  }

  // --- FR-AUTH login / session ------------------------------------------------------------

  async login(
    dto: LoginDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.identifier }, { email: dto.identifier }] },
    });

    // Réponse volontairement identique que le compte existe ou non (pas d'énumération de comptes)
    if (!user) throw new UnauthorizedException('Identifiants invalides.');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        'Compte temporairement bloqué suite à plusieurs tentatives infructueuses. Réessayez plus tard.',
      );
    }

    const blockedStatuses: AccountStatus[] = [
      AccountStatus.DEACTIVATED,
      AccountStatus.PENDING_DELETION,
      AccountStatus.DELETED,
    ];
    if (blockedStatuses.includes(user.status)) {
      throw new ForbiddenException('Ce compte est désactivé.');
    }

    const passwordOk = await argon2.verify(user.password, dto.password);
    if (!passwordOk) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    if (user.status === AccountStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException(
        "Ce compte n'a pas encore été vérifié par OTP.",
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.audit.record('LOGIN_SUCCESS', user.id);

    // CLAUDE.md §2 : double authentification — le mot de passe seul ne suffit pas à
    // ouvrir la session tant que le second facteur n'est pas vérifié. Aucun jeton
    // d'accès/rafraîchissement n'est émis à ce stade.
    if (user.twoFactorEnabled) {
      if (!user.phone) {
        throw new InternalServerErrorException(
          'Double authentification activée sans numéro de téléphone associé.',
        );
      }
      await this.otp.generateAndSend(user.id, user.phone, OtpPurpose.LOGIN_2FA);
      const challengeToken = await this.tokens.signTwoFactorChallenge(user.id);
      await this.audit.record('LOGIN_2FA_CHALLENGE_SENT', user.id);
      return { requiresTwoFactor: true as const, challengeToken };
    }

    return {
      requiresTwoFactor: false as const,
      ...(await this.createSessionAndIssueTokens(user.id, userAgent, ip)),
    };
  }

  // --- Double authentification par SMS (CLAUDE.md §2) --------------------------------------

  async verifyLoginTwoFactor(
    dto: VerifyLoginTwoFactorDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    let userId: string;
    try {
      userId = this.tokens.verifyTwoFactorChallenge(dto.challengeToken);
    } catch {
      throw new UnauthorizedException('Jeton de vérification invalide ou expiré.');
    }

    const isValid = await this.otp.verify(userId, dto.code, OtpPurpose.LOGIN_2FA);
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    await this.audit.record('LOGIN_2FA_VERIFIED', userId);
    return this.createSessionAndIssueTokens(userId, userAgent, ip);
  }

  // Contact d'urgence facultatif — pertinent en pratique pour un compte majeur (un
  // mineur a déjà un parent/tuteur rattaché via ParentalLink, cf. cahier des charges).
  async updateEmergencyContact(userId: string, dto: UpdateEmergencyContactDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emergencyContactName: dto.name,
        emergencyContactPhone: dto.phone,
      },
      select: { emergencyContactName: true, emergencyContactPhone: true },
    });
    await this.audit.record('EMERGENCY_CONTACT_UPDATED', userId);
    return updated;
  }

  async getTwoFactorStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return { enabled: user.twoFactorEnabled };
  }

  async enableTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phone) {
      throw new BadRequestException(
        'Un numéro de téléphone est requis pour activer la double authentification.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    await this.audit.record('TWO_FACTOR_ENABLED', userId);
    return { message: 'Double authentification activée.' };
  }

  async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const passwordOk = await argon2.verify(user.password, dto.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });
    await this.audit.record('TWO_FACTOR_DISABLED', userId);
    return { message: 'Double authentification désactivée.' };
  }

  // --- Appareils connectés (CLAUDE.md §2) ---------------------------------------------------

  async listSessions(userId: string) {
    return this.tokens.listSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string) {
    const revoked = await this.tokens.revokeSession(userId, sessionId);
    if (!revoked) {
      throw new NotFoundException('Session introuvable pour ce compte.');
    }
    await this.audit.record('SESSION_REVOKED', userId, { sessionId });
    return { message: 'Appareil déconnecté.' };
  }

  private async createSessionAndIssueTokens(
    userId: string,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const deviceLabel = deriveDeviceLabel(userAgent);

    const hasAnySession = await this.prisma.session.findFirst({
      where: { userId },
    });
    const isNewDevice =
      !!hasAnySession && !(await this.tokens.hasSeenDevice(userId, deviceLabel));

    const session = await this.tokens.createSession(userId, deviceLabel, userAgent, ip);

    if (isNewDevice) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.phone) {
        await this.sms.send(
          user.phone,
          `LES STAGIAIRES — nouvelle connexion depuis un appareil non reconnu (${deviceLabel}). Si ce n'est pas vous, changez votre mot de passe et révoquez cet appareil dans vos paramètres.`,
        );
      }
      await this.audit.record('NEW_DEVICE_LOGIN', userId, { deviceLabel });
    }

    return this.issueTokens(userId, session.id);
  }

  private async registerFailedAttempt(userId: string): Promise<void> {
    const maxAttempts = Number(
      this.config.get<string>('LOCKOUT_MAX_ATTEMPTS', '5'),
    );
    const lockoutMinutes = Number(
      this.config.get<string>('LOCKOUT_DURATION_MINUTES', '15'),
    );

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (updated.failedLoginAttempts >= maxAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + lockoutMinutes * 60 * 1000),
          failedLoginAttempts: 0,
        },
      });
      await this.audit.record('ACCOUNT_LOCKED', userId, {
        reason: 'too_many_failed_attempts',
      });
    }
  }

  private async issueTokens(userId: string, sessionId: string) {
    const roles = await this.getActiveRoleNames(userId);
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      roles,
      sessionId,
    });
    const refreshToken = await this.tokens.issueRefreshToken(userId, sessionId);
    return { accessToken, refreshToken };
  }

  private async getActiveRoleNames(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, isActive: true },
      include: { role: true },
    });
    return userRoles.map((userRole) => userRole.role.name);
  }

  async refresh(dto: RefreshTokenDto) {
    const rotated = await this.tokens.rotateRefreshToken(dto.refreshToken);
    if (!rotated)
      throw new UnauthorizedException('Refresh token invalide ou expiré.');

    const roles = await this.getActiveRoleNames(rotated.userId);
    const accessToken = await this.tokens.signAccessToken({
      sub: rotated.userId,
      roles,
      sessionId: rotated.sessionId ?? undefined,
    });
    return { accessToken, refreshToken: rotated.newToken };
  }

  async logout(dto: RefreshTokenDto) {
    await this.tokens.revokeRefreshToken(dto.refreshToken);
    return { message: 'Déconnecté.' };
  }

  // --- FR-AUTH-006 : récupération de mot de passe -----------------------------------------

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    // Message identique que le compte existe ou non, pour ne pas révéler son existence
    if (user) {
      await this.otp.generateAndSend(
        user.id,
        dto.phone,
        OtpPurpose.PASSWORD_RESET,
      );
      await this.audit.record('PASSWORD_RESET_REQUESTED', user.id);
    }
    return {
      message:
        'Si ce numéro est associé à un compte, un code de réinitialisation a été envoyé par SMS.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) throw new UnauthorizedException('Code invalide ou expiré.');

    const isValid = await this.otp.verify(
      user.id,
      dto.code,
      OtpPurpose.PASSWORD_RESET,
    );
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllRefreshTokensForUser(user.id);
    await this.audit.record('PASSWORD_RESET_COMPLETED', user.id);

    return {
      message:
        'Mot de passe réinitialisé. Toutes les sessions actives ont été déconnectées.',
    };
  }

  // --- FR-AUTH-005 / 007 : rôles multiples et historique ----------------------------------

  // Catalogue public des rôles auto-attribuables — seul moyen pour un client de
  // connaître les roleId à passer à assignRole()/switchActiveRole(), sans jamais
  // exposer les rôles non auto-attribuables (ex. ADMIN) ni leurs identifiants
  // (CLAUDE.md §3 : moindre privilège, même pour de simples identifiants techniques).
  async listSelfAssignableRoles() {
    return this.prisma.role.findMany({
      where: { selfAssignable: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  async assignRole(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rôle introuvable.');
    if (!role.selfAssignable) {
      throw new ForbiddenException('Ce rôle ne peut pas être auto-attribué.');
    }

    const existing = await this.prisma.userRole.findFirst({
      where: { userId, roleId },
    });

    if (existing?.isActive) {
      throw new ConflictException('Ce rôle est déjà actif sur ce compte.');
    }

    const userRole = existing
      ? await this.prisma.userRole.update({
          where: { id: existing.id },
          data: { isActive: true, assignedAt: new Date(), revokedAt: null },
        })
      : await this.prisma.userRole.create({ data: { userId, roleId } });

    await this.audit.record(
      existing ? 'ROLE_REACTIVATED' : 'ROLE_ASSIGNED',
      userId,
      { roleId },
    );
    return userRole;
  }

  async revokeRole(userId: string, userRoleId: string) {
    const userRole = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
    });
    if (!userRole || userRole.userId !== userId) {
      throw new NotFoundException('Rôle introuvable pour ce compte.');
    }
    if (!userRole.isActive) {
      throw new BadRequestException('Ce rôle est déjà inactif.');
    }

    const updated = await this.prisma.userRole.update({
      where: { id: userRole.id },
      data: { isActive: false, revokedAt: new Date() },
    });

    await this.audit.record('ROLE_REVOKED', userId, {
      roleId: userRole.roleId,
    });
    return updated;
  }

  async getRoleHistory(userId: string) {
    return this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  // --- FR-AUTH-009 / 010 : export et suppression du compte --------------------------------

  async exportUserData(userId: string) {
    // consentCodeHash n'est jamais inclus, même dans l'export du titulaire du compte —
    // c'est un secret de vérification, pas une donnée personnelle (CLAUDE.md §6).
    const parentalLinkSelect = {
      id: true,
      childId: true,
      parentPhone: true,
      parentId: true,
      status: true,
      flaggedAt: true,
      createdAt: true,
      confirmedAt: true,
    } as const;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        parentLinksAsChild: { select: parentalLinkSelect },
        parentLinksAsParent: { select: parentalLinkSelect },
      },
    });

    // Le hash du mot de passe ne fait jamais partie d'un export, même vers son propre titulaire
    const { password: _password, ...exportableData } = user;
    void _password;

    await this.audit.record('DATA_EXPORT_REQUESTED', userId);
    return exportableData;
  }

  async deactivateAccount(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.DEACTIVATED, deactivatedAt: new Date() },
    });
    await this.tokens.revokeAllRefreshTokensForUser(userId);
    await this.audit.record('ACCOUNT_DEACTIVATED', userId);

    return {
      message:
        'Compte désactivé. Contactez le support pour le réactiver avant la suppression définitive.',
    };
  }

  async requestDeletion(userId: string) {
    const deletionScheduledAt = new Date(
      Date.now() + RETENTION_DAYS_BEFORE_HARD_DELETE * 24 * 60 * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: AccountStatus.PENDING_DELETION,
        deactivatedAt: new Date(),
        deletionScheduledAt,
      },
    });
    await this.tokens.revokeAllRefreshTokensForUser(userId);
    await this.audit.record('ACCOUNT_DELETION_REQUESTED', userId, {
      deletionScheduledAt,
    });

    return {
      message: `Suppression programmée pour le ${deletionScheduledAt.toISOString()}. Contactez le support avant cette date pour annuler.`,
      deletionScheduledAt,
    };
  }
}
