import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AccountStatus, OtpPurpose } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { generateLsIdCandidate } from '../common/ls-id/ls-id.util';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LinkParentDto } from './dto/link-parent.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
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
    const isMinor = this.computeIsMinor(dateOfBirth);
    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        email: dto.email,
        password: passwordHash,
        language: dto.language,
        dateOfBirth,
        isMinor,
        status: AccountStatus.PENDING_VERIFICATION,
      },
    });

    await this.otp.generateAndSend(user.id, dto.phone, OtpPurpose.REGISTRATION);
    await this.audit.record('ACCOUNT_REGISTERED', user.id, { isMinor });

    return {
      userId: user.id,
      isMinor,
      message: 'Code de vérification envoyé par SMS.',
    };
  }

  async verifyRegistrationOtp(dto: VerifyOtpDto) {
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
    const newStatus = user.isMinor
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

    const { accessToken, refreshToken } = await this.issueTokens(user.id);

    return {
      lsId,
      status: newStatus,
      accessToken,
      refreshToken,
      requiresParentalLink: user.isMinor,
    };
  }

  private computeIsMinor(dateOfBirth: Date): boolean {
    const now = new Date();
    let age = now.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = now.getMonth() - dateOfBirth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())
    ) {
      age--;
    }
    return age < 18;
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

  async login(dto: LoginDto) {
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

    return this.issueTokens(user.id);
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

  private async issueTokens(userId: string) {
    const roles = await this.getActiveRoleNames(userId);
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      roles,
    });
    const refreshToken = await this.tokens.issueRefreshToken(userId);
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

  // --- FR-AUTH-004 : mineurs et rattachement parental -------------------------------------

  async linkParent(childUserId: string, dto: LinkParentDto) {
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: childUserId },
    });
    if (!child.isMinor) {
      throw new BadRequestException(
        'Le rattachement parental ne concerne que les comptes mineurs.',
      );
    }

    const parent = await this.prisma.user.findUnique({
      where: { phone: dto.parentPhone },
    });
    if (!parent) {
      throw new NotFoundException(
        "Aucun compte trouvé pour ce numéro. Le parent doit d'abord créer son propre compte.",
      );
    }
    if (parent.isMinor) {
      throw new BadRequestException(
        'Le compte désigné comme parent est lui-même un compte mineur.',
      );
    }

    const existing = await this.prisma.parentalLink.findUnique({
      where: { childId_parentId: { childId: child.id, parentId: parent.id } },
    });
    if (existing) {
      throw new ConflictException(
        'Une demande de rattachement existe déjà pour ce parent.',
      );
    }

    const link = await this.prisma.parentalLink.create({
      data: { childId: child.id, parentId: parent.id },
    });

    await this.audit.record('PARENTAL_LINK_REQUESTED', child.id, {
      linkId: link.id,
      parentId: parent.id,
    });
    return { linkId: link.id, status: link.status };
  }

  async confirmParentLink(parentUserId: string, linkId: string) {
    const link = await this.prisma.parentalLink.findUnique({
      where: { id: linkId },
    });
    if (!link || link.parentId !== parentUserId) {
      throw new NotFoundException('Demande de rattachement introuvable.');
    }
    if (link.status !== 'PENDING') {
      throw new BadRequestException('Cette demande a déjà été traitée.');
    }

    await this.prisma.parentalLink.update({
      where: { id: link.id },
      data: { status: 'ACTIVE', confirmedAt: new Date() },
    });

    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: link.childId },
    });
    if (child.status === AccountStatus.AWAITING_PARENTAL_CONSENT) {
      await this.prisma.user.update({
        where: { id: child.id },
        data: { status: AccountStatus.ACTIVE },
      });
    }

    await this.audit.record('PARENTAL_LINK_CONFIRMED', parentUserId, {
      linkId: link.id,
      childId: link.childId,
    });
    return { message: 'Rattachement confirmé.' };
  }

  async listParentalLinks(userId: string) {
    const [asChild, asParent] = await Promise.all([
      this.prisma.parentalLink.findMany({ where: { childId: userId } }),
      this.prisma.parentalLink.findMany({ where: { parentId: userId } }),
    ]);
    return { asChild, asParent };
  }

  // --- FR-AUTH-005 / 007 : rôles multiples et historique ----------------------------------

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
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        parentLinksAsChild: true,
        parentLinksAsParent: true,
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
