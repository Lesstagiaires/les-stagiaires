import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ProfileSection } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/token.service';
import { CvService } from './cv.service';
import { CreateRecommendationDto } from './dto/create-recommendation.dto';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { ShareSectionDto } from './dto/share-section.dto';
import { SwitchActiveRoleDto } from './dto/switch-active-role.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpsertEducationDto } from './dto/upsert-education.dto';
import { UpsertExperienceDto } from './dto/upsert-experience.dto';
import { UpsertLanguageDto } from './dto/upsert-language.dto';
import { ProfilesService } from './profiles.service';
import { RecommendationsService } from './recommendations.service';
import { VisibilityService } from './visibility.service';

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly visibility: VisibilityService,
    private readonly cv: CvService,
    private readonly recommendations: RecommendationsService,
  ) {}

  // --- Profil propre (FR-PRO-001) ---------------------------------------------------------

  @Get('me')
  getOwnProfile(@CurrentUser() user: AccessTokenPayload) {
    return this.profiles.getOrCreateOwnProfile(user.sub);
  }

  @Patch('me')
  updateOwnProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profiles.updateProfile(user.sub, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('me/active-role')
  switchActiveRole(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SwitchActiveRoleDto,
  ) {
    return this.profiles.switchActiveRole(user.sub, dto);
  }

  // --- Formation et expérience -------------------------------------------------------------

  @Post('me/education')
  addEducation(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpsertEducationDto,
  ) {
    return this.profiles.addEducation(user.sub, dto);
  }

  @Patch('me/education/:id')
  updateEducation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpsertEducationDto,
  ) {
    return this.profiles.updateEducation(user.sub, id, dto);
  }

  @Delete('me/education/:id')
  removeEducation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.profiles.removeEducation(user.sub, id);
  }

  @Post('me/experience')
  addExperience(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpsertExperienceDto,
  ) {
    return this.profiles.addExperience(user.sub, dto);
  }

  @Patch('me/experience/:id')
  updateExperience(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpsertExperienceDto,
  ) {
    return this.profiles.updateExperience(user.sub, id, dto);
  }

  @Delete('me/experience/:id')
  removeExperience(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.profiles.removeExperience(user.sub, id);
  }

  // --- Langues (FR-PRO-006) ----------------------------------------------------------------

  @Put('me/languages')
  upsertLanguage(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpsertLanguageDto,
  ) {
    return this.profiles.upsertLanguage(user.sub, dto);
  }

  @Delete('me/languages/:language')
  removeLanguage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('language') language: string,
  ) {
    return this.profiles.removeLanguage(user.sub, language);
  }

  // --- Visibilité par rubrique (FR-PRO-003) ------------------------------------------------

  @Get('me/visibility')
  listVisibility(@CurrentUser() user: AccessTokenPayload) {
    return this.visibility.listVisibility(user.sub);
  }

  @Put('me/visibility/:section')
  setVisibility(
    @CurrentUser() user: AccessTokenPayload,
    @Param('section', new ParseEnumPipe(ProfileSection))
    section: ProfileSection,
    @Body() dto: SetVisibilityDto,
  ) {
    return this.visibility.setVisibility(user.sub, section, dto);
  }

  @Post('me/visibility/:section/share')
  shareSection(
    @CurrentUser() user: AccessTokenPayload,
    @Param('section', new ParseEnumPipe(ProfileSection))
    section: ProfileSection,
    @Body() dto: ShareSectionDto,
  ) {
    return this.visibility.shareSection(user.sub, section, dto);
  }

  @Delete('me/visibility/:section/share/:targetUserId')
  unshareSection(
    @CurrentUser() user: AccessTokenPayload,
    @Param('section', new ParseEnumPipe(ProfileSection))
    section: ProfileSection,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.visibility.unshareSection(user.sub, section, targetUserId);
  }

  // --- CV Vivant et Carte Professionnelle Numérique (FR-PRO-007/008) ----------------------

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':userId/cv')
  getCv(
    @Param('userId') userId: string,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    return this.cv.getCvVivant(userId, viewer?.sub);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':userId/card')
  getCard(
    @Param('userId') userId: string,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    return this.cv.getCarteProfessionnelle(userId, viewer?.sub);
  }

  // --- Recommandations (FR-PRO-011) --------------------------------------------------------

  @Post(':userId/recommendations')
  createRecommendation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId') receiverId: string,
    @Body() dto: CreateRecommendationDto,
  ) {
    return this.recommendations.create(user.sub, receiverId, dto);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':userId/recommendations')
  listRecommendations(
    @Param('userId') userId: string,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    return this.recommendations.listReceived(userId, viewer?.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('me/recommendations/:id/hide')
  hideRecommendation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.recommendations.setVisible(user.sub, id, false);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('me/recommendations/:id/show')
  showRecommendation(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.recommendations.setVisible(user.sub, id, true);
  }
}
