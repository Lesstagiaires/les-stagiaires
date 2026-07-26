import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AccessTokenPayload } from '../token.service';

interface RequestWithUser {
  user?: AccessTokenPayload;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return false;

    // CLAUDE.md §3 : un rôle élevé doit rester révocable immédiatement. Le rôle porté
    // par le token JWT peut être obsolète jusqu'à JWT_ACCESS_EXPIRES_IN après une
    // révocation (revokeRole) — on revérifie donc l'état actif en base à chaque
    // requête plutôt que de faire confiance au seul jeton, pour les routes protégées
    // par @Roles(). Coût négligeable : ces routes (ADMIN) sont hors chemin critique.
    const activeRole = await this.prisma.userRole.findFirst({
      where: {
        userId: user.sub,
        isActive: true,
        role: { name: { in: requiredRoles } },
      },
    });
    if (!activeRole) return false;

    // CLAUDE.md §2 : double authentification obligatoire pour tout compte admin ayant
    // accès à des données confidentielles/très sensibles — appliqué ici plutôt qu'au
    // login pour éviter un blocage sans issue (aucune interface admin dédiée n'existe
    // encore pour activer la 2FA avant de se connecter). Un compte ADMIN peut donc se
    // connecter normalement, mais ne peut exercer aucune action réservée à ce rôle tant
    // que la 2FA n'est pas active sur son compte.
    if (requiredRoles.includes('ADMIN')) {
      const account = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { twoFactorEnabled: true },
      });
      if (!account?.twoFactorEnabled) return false;
    }

    return true;
  }
}
