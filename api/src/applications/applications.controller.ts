import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApplicationArtifactKind } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { ApplicationsService } from './applications.service';
import { ConfirmTravelConsentDto } from './dto/confirm-travel-consent.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { CreateDocumentRequestDto } from './dto/create-document-request.dto';
import { DecideApplicationDto } from './dto/decide-application.dto';
import { FulfillDocumentRequestDto } from './dto/fulfill-document-request.dto';
import { ListReceivedDto } from './dto/list-received.dto';
import { ProposeInterviewDto } from './dto/propose-interview.dto';
import { SignApplicationDto } from './dto/sign-application.dto';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  // --- FR-M5-002 : aperçu avant envoi -------------------------------------------------------

  @Get('preview')
  preview(@CurrentUser() user: AccessTokenPayload) {
    return this.applications.preview(user.sub);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.applications.listMine(user.sub);
  }

  @Get('received')
  listReceived(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListReceivedDto,
  ) {
    return this.applications.listReceived(user.sub, query);
  }

  @Get(':id')
  getById(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.applications.getById(user.sub, id);
  }

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applications.create(user.sub, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/review')
  markUnderReview(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.applications.markUnderReview(user.sub, id);
  }

  // --- FR-M5-006 : complément ----------------------------------------------------------------

  @Post(':id/document-requests')
  requestDocument(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateDocumentRequestDto,
  ) {
    return this.applications.requestDocument(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/document-requests/:requestId/fulfill')
  fulfillDocumentRequest(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: FulfillDocumentRequestDto,
  ) {
    return this.applications.fulfillDocumentRequest(
      user.sub,
      id,
      requestId,
      dto,
    );
  }

  // --- FR-M5-007 : entretien -------------------------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/interview')
  proposeInterview(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ProposeInterviewDto,
  ) {
    return this.applications.proposeInterview(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/interview/confirm')
  confirmInterview(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.applications.confirmInterview(user.sub, id);
  }

  // --- FR-M5-008 : décision --------------------------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/decision')
  decide(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: DecideApplicationDto,
  ) {
    return this.applications.decide(user.sub, id, dto);
  }

  // --- Acceptation de la lettre d'admission par le candidat -------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/admission-letter/accept')
  acceptAdmissionLetter(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.applications.acceptAdmissionLetter(user.sub, id);
  }

  // --- Signature légère déclarative de la convention ---------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/sign')
  sign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SignApplicationDto,
    @Req() req: Request,
  ) {
    return this.applications.sign(user.sub, id, dto.name, req.ip);
  }

  // --- Accord parental de déplacement (candidat mineur, offre à relocalisation) -----------

  // Public : comme pour le consentement d'inscription, le parent/tuteur n'a pas
  // forcément de compte — seule la connaissance du code envoyé par SMS fait foi.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('travel-consent/:travelConsentId/confirm')
  confirmTravelConsent(
    @Param('travelConsentId') travelConsentId: string,
    @Body() dto: ConfirmTravelConsentDto,
  ) {
    return this.applications.confirmTravelConsent(travelConsentId, dto.code);
  }

  // --- Clôture -------------------------------------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/complete')
  complete(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.applications.complete(user.sub, id);
  }

  // --- FR-M5-009 : retrait ---------------------------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.applications.withdraw(user.sub, id);
  }

  // --- Téléchargement des artefacts ------------------------------------------------------------

  @Get(':id/artifacts/:kind')
  async downloadArtifact(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('kind') kind: ApplicationArtifactKind,
    @Res() res: Response,
  ) {
    const { buffer, mimeType, fileName } =
      await this.applications.downloadArtifact(user.sub, id, kind);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    res.send(buffer);
  }
}
