import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  Body,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { AccessLogService } from './access-log.service';
import { CreateShareDto } from './dto/create-share.dto';
import {
  DigitalSafeAccessAction,
  ShareTargetType,
} from '../../generated/prisma/enums';
import { DigitalSafeDocumentsService } from './documents.service';
import { QrCodeService } from './qrcode.service';
import { SharesService } from './shares.service';

@Controller('digital-safe')
export class SharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly qrCode: QrCodeService,
    private readonly documents: DigitalSafeDocumentsService,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post('documents/:id/shares')
  async createShare(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') documentId: string,
    @Body() dto: CreateShareDto,
  ) {
    const share = await this.shares.create(user.sub, documentId, dto);
    if (share.targetType === ShareTargetType.LINK && share.token) {
      const token = share.token;
      const qrCodeDataUrl = await this.qrCode.generateDataUrl(token);
      return {
        ...share,
        shareUrl: this.qrCode.buildShareUrl(token),
        qrCodeDataUrl,
      };
    }
    return share;
  }

  @Get('documents/:id/shares')
  listShares(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') documentId: string,
  ) {
    return this.shares.list(user.sub, documentId);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('documents/:id/shares/:shareId')
  revokeShare(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') documentId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.shares.revoke(user.sub, documentId, shareId);
  }

  // Accès public par jeton — matérialise le QR Code (FR-M3-008). Aucune authentification
  // requise : la connaissance du jeton fait foi, comme pour un lien de partage classique.
  @Public()
  @Get('share/:token/download')
  async downloadViaToken(@Param('token') token: string, @Res() res: Response) {
    const share = await this.shares.resolveToken(token);
    const { buffer, mimeType, fileName } =
      await this.documents.readVersionForShare(share.documentId);
    await this.accessLog.record(
      share.documentId,
      DigitalSafeAccessAction.DOWNLOADED,
      undefined,
      share.id,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    res.send(buffer);
  }
}
