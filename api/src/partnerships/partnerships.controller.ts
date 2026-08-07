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
import { PartnershipParty } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { ApprovePartnershipDto } from './dto/approve-partnership.dto';
import { ListPartnershipsQueryDto } from './dto/list-partnerships-query.dto';
import { PartnershipDecisionDto } from './dto/partnership-decision.dto';
import {
  CreatePartnershipTypeDto,
  UpdatePartnershipTypeDto,
} from './dto/partnership-type.dto';
import {
  ProvideAdditionalInformationDto,
  RequestAdditionalInformationDto,
} from './dto/request-additional-information.dto';
import { PartnershipReasonDto } from './dto/partnership-reason.dto';
import { RequestPartnershipDto } from './dto/request-partnership.dto';
import { PartnershipTypesService } from './partnership-types.service';
import { PartnershipsService } from './partnerships.service';

@Controller('partnerships')
export class PartnershipsController {
  constructor(
    private readonly partnerships: PartnershipsService,
    private readonly partnershipTypes: PartnershipTypesService,
  ) {}

  // --- Côté organisation -----------------------------------------------------------
  // Ces routes sont déclarées AVANT celles en `:id` : Express résout dans l'ordre
  // d'enregistrement, et `organizations/xxx` doit gagner sur le paramètre générique,
  // sinon une organisation serait renvoyée vers une route réservée aux ADMIN.

  @HttpCode(HttpStatus.CREATED)
  @Post('organizations/:organizationId')
  request(
    @CurrentUser() user: AccessTokenPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: RequestPartnershipDto,
  ) {
    return this.partnerships.request(user.sub, organizationId, dto);
  }

  @Get('organizations/:organizationId')
  getForOrganization(
    @CurrentUser() user: AccessTokenPayload,
    @Param('organizationId') organizationId: string,
  ) {
    return this.partnerships.getForOrganization(user.sub, organizationId);
  }

  // Catalogue proposable, pour alimenter le sélecteur de type au dépôt d'une
  // candidature. Ouvert à tout compte authentifié : c'est une liste de libellés.
  @Get('types')
  listTypes() {
    return this.partnershipTypes.listActive();
  }

  // L'organisation complète son dossier — le dossier revient en examen sans qu'une
  // nouvelle demande soit créée.
  @Post(':id/additional-information')
  provideAdditionalInformation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ProvideAdditionalInformationDto,
  ) {
    return this.partnerships.provideAdditionalInformation(user.sub, id, dto);
  }

  // L'organisation demande la résiliation. Cela n'éteint pas le partenariat : un ADMIN
  // doit ensuite la prononcer. Le préavis éventuel relève du contrat signé.
  @Post(':id/termination-request')
  requestTerminationAsOrganization(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PartnershipReasonDto,
  ) {
    return this.partnerships.requestTermination(
      user.sub,
      id,
      PartnershipParty.ORGANIZATION,
      dto,
    );
  }

  @Post(':id/termination-request/withdraw')
  withdrawTerminationRequestAsOrganization(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.partnerships.withdrawTerminationRequest(
      user.sub,
      id,
      PartnershipParty.ORGANIZATION,
    );
  }

  // --- Back-office ADMIN ------------------------------------------------------------
  // RolesGuard exige aussi la double authentification active sur le compte
  // (CLAUDE.md §2/§3).

  @Roles('ADMIN')
  @Get()
  listAll(@Query() query: ListPartnershipsQueryDto) {
    return this.partnerships.listAll(query);
  }

  @Roles('ADMIN')
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.partnerships.getById(id);
  }

  @Roles('ADMIN')
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ApprovePartnershipDto,
  ) {
    return this.partnerships.approve(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/refuse')
  refuse(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PartnershipDecisionDto,
  ) {
    return this.partnerships.refuse(user.sub, id, dto);
  }

  // Suspension : gel réversible, sanction d'un manquement.
  @Roles('ADMIN')
  @Post(':id/suspend')
  suspend(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PartnershipDecisionDto,
  ) {
    return this.partnerships.suspend(user.sub, id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/reinstate')
  reinstate(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.partnerships.reinstate(user.sub, id);
  }

  // Résiliation : fin de la relation, prononcée par l'administration.
  @Roles('ADMIN')
  @Post(':id/terminate')
  terminate(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PartnershipDecisionDto,
  ) {
    return this.partnerships.terminate(user.sub, id, dto);
  }

  // La plateforme peut elle aussi annoncer son intention de résilier avant de la
  // prononcer, pour laisser place à la discussion prévue au contrat.
  @Roles('ADMIN')
  @Post(':id/platform-termination-request')
  requestTerminationAsPlatform(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: PartnershipDecisionDto,
  ) {
    return this.partnerships.requestTermination(
      user.sub,
      id,
      PartnershipParty.PLATFORM,
      dto,
    );
  }

  // Historique COMPLET d'un dossier, notes internes comprises. Réservé aux ADMIN :
  // l'organisation dispose de sa propre vue, filtrée, dans `getForOrganization`.
  @Roles('ADMIN')
  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.partnerships.getHistory(id);
  }

  // Demande de complément : la demande RESTE OUVERTE, ce n'est pas un refus.
  @Roles('ADMIN')
  @Post(':id/request-additional-information')
  requestAdditionalInformation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RequestAdditionalInformationDto,
  ) {
    return this.partnerships.requestAdditionalInformation(user.sub, id, dto);
  }

  // --- Catalogue des types (back-office) ---------------------------------------------
  // Ajouter un type est une opération de DONNÉES, pas une livraison de code.

  @Roles('ADMIN')
  @Get('admin/types')
  listAllTypes() {
    return this.partnershipTypes.listAll();
  }

  @HttpCode(HttpStatus.CREATED)
  @Roles('ADMIN')
  @Post('admin/types')
  createType(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreatePartnershipTypeDto,
  ) {
    return this.partnershipTypes.create(user.sub, dto);
  }

  @Roles('ADMIN')
  @Post('admin/types/:typeId')
  updateType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('typeId') typeId: string,
    @Body() dto: UpdatePartnershipTypeDto,
  ) {
    return this.partnershipTypes.update(user.sub, typeId, dto);
  }

  // Désactiver, jamais supprimer : les partenariats rattachés doivent rester lisibles.
  @Roles('ADMIN')
  @Post('admin/types/:typeId/disable')
  disableType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('typeId') typeId: string,
  ) {
    return this.partnershipTypes.setActive(user.sub, typeId, false);
  }

  @Roles('ADMIN')
  @Post('admin/types/:typeId/enable')
  enableType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('typeId') typeId: string,
  ) {
    return this.partnershipTypes.setActive(user.sub, typeId, true);
  }

  @Roles('ADMIN')
  @Post(':id/platform-termination-request/withdraw')
  withdrawTerminationRequestAsPlatform(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.partnerships.withdrawTerminationRequest(
      user.sub,
      id,
      PartnershipParty.PLATFORM,
    );
  }
}
