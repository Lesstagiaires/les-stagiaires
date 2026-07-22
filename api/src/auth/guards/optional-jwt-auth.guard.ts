import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Laisse toujours passer la requête, mais peuple request.user si un token valide est
// fourni — utilisé sur les endpoints publics dont le contenu varie selon que le
// visiteur est authentifié ou non (ex : visibilité NETWORK d'un profil).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context) as Promise<boolean>;
  }

  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
