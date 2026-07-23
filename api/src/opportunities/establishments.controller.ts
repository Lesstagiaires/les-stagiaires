import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { InviteLearnerDto } from './dto/invite-learner.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateCampaignStatusDto } from './dto/update-campaign-status.dto';
import { EstablishmentsService } from './establishments.service';

@Controller()
export class EstablishmentsController {
  constructor(private readonly establishments: EstablishmentsService) {}

  // --- EDU-FR-004 : rattachement et vérification des apprenants ---------------------------

  @Get('establishments/enrollments')
  listMyEnrollments(@CurrentUser() user: AccessTokenPayload) {
    return this.establishments.listMyEnrollments(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Post('establishments/enrollments/:learnerId/accept')
  acceptLearner(
    @CurrentUser() user: AccessTokenPayload,
    @Param('learnerId') learnerId: string,
  ) {
    return this.establishments.acceptLearner(user.sub, learnerId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('establishments/enrollments/:learnerId/decline')
  declineLearner(
    @CurrentUser() user: AccessTokenPayload,
    @Param('learnerId') learnerId: string,
  ) {
    return this.establishments.declineLearner(user.sub, learnerId);
  }

  @Get('organizations/:id/learners')
  listLearners(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.establishments.listLearners(user.sub, id);
  }

  @Post('organizations/:id/learners')
  inviteLearner(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: InviteLearnerDto,
  ) {
    return this.establishments.inviteLearner(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/learners/:learnerId/verify')
  verifyLearner(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('learnerId') learnerId: string,
  ) {
    return this.establishments.verifyLearner(user.sub, id, learnerId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/learners/:learnerId/revoke')
  revokeLearner(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('learnerId') learnerId: string,
  ) {
    return this.establishments.revokeLearner(user.sub, id, learnerId);
  }

  // --- EDU-FR-005 : campagnes de stage ------------------------------------------------------

  @Get('organizations/:id/campaigns')
  listCampaigns(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.establishments.listCampaigns(user.sub, id);
  }

  @Post('organizations/:id/campaigns')
  createCampaign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.establishments.createCampaign(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/campaigns/:campaignId/status')
  updateCampaignStatus(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('campaignId') campaignId: string,
    @Body() dto: UpdateCampaignStatusDto,
  ) {
    return this.establishments.updateCampaignStatus(
      user.sub,
      id,
      campaignId,
      dto,
    );
  }

  // --- EDU-FR-006 : suivi des conventions des apprenants ------------------------------------

  @Get('organizations/:id/learner-applications')
  listLearnerApplications(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.establishments.listLearnerApplications(user.sub, id);
  }

  // --- EDU-FR-007 : rapports de stage --------------------------------------------------------

  @Get('organizations/:id/reports')
  listReports(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.establishments.listReports(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('organizations/:id/reports/:applicationId/review')
  reviewReport(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.establishments.reviewReport(user.sub, id, applicationId, dto);
  }

  // --- EDU-FR-008 : tableau de bord d'insertion ----------------------------------------------

  @Get('organizations/:id/dashboard')
  dashboard(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.establishments.dashboard(user.sub, id);
  }

  // --- EDU-FR-009 : répertoire des entreprises partenaires ------------------------------------

  @Get('organizations/:id/partner-companies')
  partnerCompanies(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.establishments.partnerCompanies(user.sub, id);
  }
}
