import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SearchCriterion } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import {
  CreateOccupationDto,
  CreateSkillDto,
  CreateSynonymDto,
  UpdateRankingRuleDto,
} from './dto/search-admin.dto';
import { SearchAdminService } from './search-admin.service';

// ============================================================================
// BACK-OFFICE DE LA RECHERCHE — ADMIN + double authentification
//
// UN CONTRÔLEUR À PART, et non des routes ajoutées à `OpportunitiesController`.
// Celui-ci sert des OFFRES au public ; celui-là règle le moteur qui les classe.
// Les mélanger aurait mis des routes de configuration derrière un contrôleur
// dont la plupart des routes sont publiques — la sorte de voisinage où une
// erreur de décorateur ne se voit pas.
//
// Le préfixe `search-admin` est distinct de `opportunities` : aucun risque
// qu'un paramètre générique `:id` avale l'une de ces routes.
// ============================================================================
@Roles('ADMIN')
@Controller('search-admin')
export class SearchAdminController {
  constructor(private readonly admin: SearchAdminService) {}

  // --- Pondérations ---------------------------------------------------------
  //
  // « Un administrateur peut modifier le poids de la fraîcheur de 5 à 3 sans
  // redéployer l'application. »

  @Get('ranking-rules')
  listRankingRules() {
    return this.admin.listRankingRules();
  }

  @HttpCode(HttpStatus.OK)
  @Put('ranking-rules/:criterion')
  updateRankingRule(
    @CurrentUser() user: AccessTokenPayload,
    @Param('criterion') criterion: SearchCriterion,
    @Body() dto: UpdateRankingRuleDto,
  ) {
    return this.admin.updateRankingRule(user.sub, criterion, dto);
  }

  // --- Compétences ----------------------------------------------------------

  @Get('skills')
  listSkills(@Query('all') all?: string) {
    return this.admin.listSkills(all === 'true');
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('skills')
  createSkill(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateSkillDto,
  ) {
    return this.admin.createSkill(user.sub, dto);
  }

  // On désactive, on ne supprime jamais : une compétence citée par mille
  // profils ne peut pas disparaître sans les rendre incohérents.
  @Post('skills/:id/deactivate')
  deactivateSkill(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.admin.deactivateSkill(user.sub, id);
  }

  // --- Métiers --------------------------------------------------------------

  @Get('occupations')
  listOccupations(@Query('all') all?: string) {
    return this.admin.listOccupations(all === 'true');
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('occupations')
  createOccupation(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateOccupationDto,
  ) {
    return this.admin.createOccupation(user.sub, dto);
  }

  // --- Synonymes ------------------------------------------------------------

  @Get('synonyms')
  listSynonyms(@Query('all') all?: string) {
    return this.admin.listSynonyms(all === 'true');
  }

  @HttpCode(HttpStatus.CREATED)
  @Post('synonyms')
  createSynonym(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateSynonymDto,
  ) {
    return this.admin.createSynonym(user.sub, dto);
  }

  @Post('synonyms/:id/deactivate')
  deactivateSynonym(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.admin.deactivateSynonym(user.sub, id);
  }
}
