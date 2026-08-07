import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/token.service';
import { CreateReportDto } from '../reports/dto/create-report.dto';
import { ReportsService } from '../reports/reports.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { SearchOpportunitiesDto } from './dto/search-opportunities.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OfferQualityService } from './offer-quality.service';
import { OpportunitiesService } from './opportunities.service';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly reports: ReportsService,
    private readonly offerQuality: OfferQualityService,
  ) {}

  // --- FR-M4-003 / FR-M4-004 : recherche et consultation, sans restriction de ville/pays ---

  // PUBLIQUE, mais avec le profil quand il y en a un. Un visiteur non connecte
  // obtient un classement sans criteres de profil — le meme code, sans branche
  // particuliere : les criteres valent alors zero pour tout le monde.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  search(
    @Query() query: SearchOpportunitiesDto,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    return this.opportunities.search(query, viewer?.sub);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.opportunities.listMine(user.sub);
  }

  // DIAGNOSTIC DE QUALITÉ — pour l'organisation qui publie, jamais pour le
  // public. Déclarée AVANT `GET :id`, sans quoi la route générique l'avalerait.
  //
  // Elle ne rend ni score, ni rang, ni comparaison : le service qui la sert
  // n'a accès à aucune autre offre.
  @Get(':id/quality')
  quality(@Param('id') id: string, @CurrentUser() user: AccessTokenPayload) {
    return this.offerQuality.diagnose(id, user.sub);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() viewer?: AccessTokenPayload) {
    return this.opportunities.getById(viewer?.sub, id);
  }

  // --- FR-M4-001 : création (brouillon) -----------------------------------------------------

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.opportunities.create(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(user.sub, id, dto);
  }

  // --- FR-M4-002 / FR-M4-013 : cycle de vie --------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/publish')
  publish(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.publish(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/pause')
  pause(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.pause(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/resume')
  resume(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.resume(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/fill')
  markFilled(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.markFilled(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.cancel(user.sub, id);
  }

  // Suspension administrative — jamais en self-service (CLAUDE.md §3).
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/suspend')
  suspend(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.opportunities.suspend(admin.sub, id);
  }

  // Réutilise le mécanisme de signalement général (module 1) avec une cible OFFER, et fait
  // transiter l'offre vers REPORTED — orchestration propre à ce module, pas au module Reports.
  @HttpCode(HttpStatus.CREATED)
  @Post(':id/report')
  async report(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateReportDto,
  ) {
    await this.opportunities.getByIdOr404(id);
    const report = await this.reports.create(user.sub, dto, id);
    await this.opportunities.markReported(id);
    return report;
  }
}
