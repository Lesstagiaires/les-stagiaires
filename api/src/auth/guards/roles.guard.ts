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
    return !!activeRole;
  }
}
