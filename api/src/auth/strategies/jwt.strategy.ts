import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TokenService, AccessTokenPayload } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly tokens: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Revoquer un appareil (Session) doit couper son accès immédiatement, pas seulement
  // après expiration du jeton d'accès (15 min) — CLAUDE.md §2. Coût d'une requête par
  // appel authentifié, jugé acceptable pour cette garantie (même arbitrage que RolesGuard
  // pour la fraîcheur des rôles).
  async validate(payload: AccessTokenPayload): Promise<AccessTokenPayload> {
    if (payload.sessionId) {
      const valid = await this.tokens.isSessionValid(payload.sessionId);
      if (!valid) {
        throw new UnauthorizedException('Session révoquée.');
      }
    }
    return {
      ...payload,
      countryCode: payload.countryCode?.toUpperCase(),
    };
  }
}
