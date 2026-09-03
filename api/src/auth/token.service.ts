import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  roles: string[];
  countryCode?: string;
  // Absent pour les jetons émis avant l'introduction du modèle Session (rétrocompatible) —
  // quand présent, JwtStrategy revérifie sa validité à chaque requête (CLAUDE.md §2).
  sessionId?: string;
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.parseDurationSeconds(
        this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      ),
    });
  }

  // Secret dérivé, distinct de JWT_ACCESS_SECRET : un jeton de défi 2FA ne doit jamais
  // pouvoir être présenté comme un jeton d'accès normal sur une route authentifiée
  // quelconque (CLAUDE.md §2) — il n'a pas de claim `roles` et JwtStrategy ne revérifierait
  // aucune session en son absence, donc un secret partagé le laisserait passer partout.
  private getChallengeSecret(): string {
    return createHash('sha256')
      .update(
        `${this.config.getOrThrow<string>('JWT_ACCESS_SECRET')}:2fa-challenge`,
      )
      .digest('hex');
  }

  // Jeton de courte durée liant l'étape "mot de passe validé" à l'étape "code 2FA validé"
  // (CLAUDE.md §2) — jamais de tokens d'accès/rafraîchissement émis avant la vérification
  // du second facteur quand twoFactorEnabled est actif.
  async signTwoFactorChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: 'login_2fa' },
      {
        secret: this.getChallengeSecret(),
        expiresIn: 5 * 60,
      },
    );
  }

  verifyTwoFactorChallenge(token: string): string {
    const payload = this.jwt.verify<{ sub: string; purpose: string }>(token, {
      secret: this.getChallengeSecret(),
    });
    if (payload.purpose !== 'login_2fa') {
      throw new Error('INVALID_CHALLENGE_PURPOSE');
    }
    return payload.sub;
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueRefreshToken(userId: string, sessionId?: string): Promise<string> {
    const rawToken = randomBytes(64).toString('hex');
    const expiresInSeconds = this.parseDurationSeconds(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
    );
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
        sessionId,
      },
    });

    return rawToken;
  }

  async rotateRefreshToken(rawToken: string): Promise<{
    userId: string;
    sessionId: string | null;
    newToken: string;
  } | null> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      return null;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    if (existing.sessionId) {
      await this.prisma.session.updateMany({
        where: { id: existing.sessionId, revokedAt: null },
        data: { lastUsedAt: new Date() },
      });
    }

    const newToken = await this.issueRefreshToken(
      existing.userId,
      existing.sessionId ?? undefined,
    );
    return { userId: existing.userId, sessionId: existing.sessionId, newToken };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!existing) return;

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Une déconnexion explicite met aussi fin à l'appareil dans la liste des sessions —
    // le laisser "connecté" après un logout serait trompeur (CLAUDE.md §2).
    if (existing.sessionId) {
      await this.prisma.session.updateMany({
        where: { id: existing.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- Sessions / appareils connectés (CLAUDE.md §2) --------------------------------------

  async createSession(
    userId: string,
    deviceLabel: string,
    userAgent: string | undefined,
    ipAddress: string | undefined,
  ) {
    return this.prisma.session.create({
      data: { userId, deviceLabel, userAgent, ipAddress },
    });
  }

  // Un appareil déjà vu (même étiquette dérivée du User-Agent) ne redéclenche pas
  // l'alerte "nouvel appareil" à chaque connexion — seule la toute première rencontre
  // de cet appareil pour ce compte compte comme nouvelle.
  async hasSeenDevice(userId: string, deviceLabel: string): Promise<boolean> {
    const existing = await this.prisma.session.findFirst({
      where: { userId, deviceLabel },
    });
    return !!existing;
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId || session.revokedAt) {
      return false;
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  }

  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    return !!session && !session.revokedAt;
  }

  private parseDurationSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) return 15 * 60;
    return Number(match[1]) * DURATION_UNIT_SECONDS[match[2]];
  }
}
