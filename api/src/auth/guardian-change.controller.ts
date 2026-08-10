import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import {
  DecideGuardianChangeDto,
  RequestGuardianChangeDto,
} from './dto/guardian-change.dto';
import { GuardianChangeService } from './guardian-change.service';
import type { AccessTokenPayload } from './token.service';

// ============================================================================
// CÔTÉ MINEUR — déposer et suivre sa demande
//
// Pas de route publique ici, contrairement au consentement lui-même : le
// demandeur est le titulaire du compte, il est authentifié, et rien dans cette
// procédure n'a besoin d'être atteignable sans jeton.
// ============================================================================
@Controller('auth/minors/guardian-change')
export class GuardianChangeController {
  constructor(private readonly guardianChange: GuardianChangeService) {}

  // Débit volontairement bas. Une demande de changement de tuteur mobilise un
  // humain : dix par minute noieraient l'administration sous le bruit, et c'est
  // précisément le moyen le plus simple de rendre la procédure inopérante.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post()
  request(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: RequestGuardianChangeDto,
  ) {
    return this.guardianChange.request(
      user.sub,
      dto.requestedParentPhone,
      dto.reason,
    );
  }

  @Get()
  mine(@CurrentUser() user: AccessTokenPayload) {
    return this.guardianChange.mine(user.sub);
  }
}

// ============================================================================
// CÔTÉ ADMINISTRATION — la file d'attente et la décision
//
// Contrôleur SÉPARÉ, et pas deux routes de plus dans le précédent. Le décorateur
// de rôle porte alors sur la classe entière : une route ajoutée demain dans ce
// fichier est protégée par construction, alors qu'une route ajoutée dans un
// contrôleur mixte l'est seulement si on y pense.
// ============================================================================
@Roles('ADMIN')
@Controller('admin/guardian-changes')
export class AdminGuardianChangeController {
  constructor(private readonly guardianChange: GuardianChangeService) {}

  @Get()
  listPending() {
    return this.guardianChange.listPending();
  }

  @Post('decide')
  decide(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: DecideGuardianChangeDto,
  ) {
    return this.guardianChange.decide(
      user.sub,
      dto.requestId,
      dto.approve,
      dto.decisionReason,
    );
  }
}
