import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentCategory } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/token.service';
import { DocumentsService } from './documents.service';
import { RenameDocumentDto } from './dto/rename-document.dto';

@Controller('profiles')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // Plafond dur indépendant de DOCUMENT_MAX_SIZE_MB — multer bufferise tout le fichier en
  // mémoire avant que le contrôle de taille applicatif (documents.service.ts) ne s'exécute ;
  // sans cette limite au niveau de l'intercepteur, un fichier énorme épuiserait la mémoire
  // du serveur avant même d'être rejeté (déni de service).
  @Post('me/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  upload(
    @CurrentUser() user: AccessTokenPayload,
    @Body('category', new ParseEnumPipe(DocumentCategory))
    category: DocumentCategory,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.documents.upload(user.sub, category, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }

  @Get('me/documents')
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.documents.list(user.sub);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('documents/:id')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    const { buffer, mimeType, fileName } = await this.documents.download(
      viewer?.sub,
      id,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    res.send(buffer);
  }

  @Patch('me/documents/:id')
  rename(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RenameDocumentDto,
  ) {
    return this.documents.rename(user.sub, id, dto.fileName);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('me/documents/:id')
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.documents.remove(user.sub, id);
  }
}
