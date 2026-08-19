import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { SponsorSubscriptionDto } from './dto/sponsor-subscription.dto';
import { SubscribeOrganizationDto } from './dto/subscribe-organization.dto';
import { SubscribeSelfDto } from './dto/subscribe-self.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // Auto-souscription à une formule individuelle — accessible à tout compte, y compris
  // mineur (CLAUDE.md §6 : jamais bloquée en attendant un parent). Le chemin ne nomme
  // plus la formule : elle est dans le corps de la requête, et le renommage du
  // 2026-07-31 a montré qu'une URL qui porte un nom commercial vieillit mal.
  @HttpCode(HttpStatus.CREATED)
  @Post('me')
  subscribeSelf(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SubscribeSelfDto,
  ) {
    return this.subscriptions.subscribeSelf(user.sub, dto);
  }

  // Une organisation souscrit pour elle-même (BUSINESS/INSTITUTION selon son type).
  @HttpCode(HttpStatus.CREATED)
  @Post('organizations/:organizationId')
  subscribeOrganization(
    @CurrentUser() user: AccessTokenPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: SubscribeOrganizationDto,
  ) {
    return this.subscriptions.subscribeOrganization(
      user.sub,
      organizationId,
      dto,
    );
  }

  // Un établissement/entreprise souscrit une formule individuelle pour un bénéficiaire —
  // soumis à l'accord parental actif si ce dernier est mineur (CLAUDE.md §6).
  @HttpCode(HttpStatus.CREATED)
  @Post('organizations/:organizationId/sponsor/:beneficiaryUserId')
  subscribeOrgSponsored(
    @CurrentUser() user: AccessTokenPayload,
    @Param('organizationId') organizationId: string,
    @Param('beneficiaryUserId') beneficiaryUserId: string,
    @Body() dto: SponsorSubscriptionDto,
  ) {
    return this.subscriptions.subscribeOrgSponsored(
      user.sub,
      organizationId,
      beneficiaryUserId,
      dto,
    );
  }

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.subscriptions.listMine(user.sub);
  }

  // Back-office — réservé ADMIN (RolesGuard exige aussi la 2FA active, CLAUDE.md §2/§3).
  @Roles('ADMIN')
  @Get()
  listAll(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptions.listAll(query);
  }

  @Get(':id')
  getById(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.subscriptions.getById(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.subscriptions.cancel(user.sub, id);
  }

  // Route DISTINCTE de `POST /me`, à dessein : celle-ci signifie « première
  // souscription » et passe par la garde d'unicité P1-1 ; celle-là prolonge un
  // abonnement existant sans jamais en créer un second. Les confondre aurait
  // rendu impossible de dire, en lisant un journal, laquelle des deux
  // opérations l'utilisateur a réellement demandée.
  //
  // Aucun corps de requête : la formule, le cycle et le pays sont ceux de
  // l'abonnement, et le montant reste résolu côté serveur.
  @HttpCode(HttpStatus.OK)
  @Post(':id/renew')
  renew(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.subscriptions.renew(user.sub, id);
  }
}
