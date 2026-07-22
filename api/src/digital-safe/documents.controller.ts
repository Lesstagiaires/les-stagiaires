import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { AccessLogService } from './access-log.service';
import { CreateDigitalSafeDocumentDto } from './dto/create-document.dto';
import { RenameDigitalSafeDocumentDto } from './dto/rename-document.dto';
import { DigitalSafeDocumentsService } from './documents.service';

const UPLOAD_HARD_LIMIT_BYTES = 25 * 1024 * 1024;

@Controller('digital-safe/documents')
export class DigitalSafeDocumentsController {
  constructor(
    private readonly documents: DigitalSafeDocumentsService,
    private readonly accessLog: AccessLogService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES } }),
  )
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateDigitalSafeDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.documents.create(user.sub, dto.category, dto.title, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Post(':id/versions')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES } }),
  )
  addVersion(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.documents.addVersion(user.sub, id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.documents.list(user.sub);
  }

  @Get(':id/versions')
  listVersions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.documents.listVersions(user.sub, id);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType, fileName } = await this.documents.downloadLatest(
      user.sub,
      id,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    res.send(buffer);
  }

  @Get(':id/access-log')
  accessLogFor(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.accessLog.listForDocument(user.sub, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RenameDigitalSafeDocumentDto,
  ) {
    return this.documents.rename(user.sub, id, dto.title);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.documents.remove(user.sub, id);
  }
}
