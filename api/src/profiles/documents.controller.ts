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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentCategory } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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

  // ==========================================================================
  // PLUS AUCUN TÉLÉCHARGEMENT ANONYME — défaut S-02, corrigé le 2026-08-10
  //
  // Cette route portait `@Public()` et un garde facultatif. Un propriétaire
  // ayant basculé sa rubrique DOCUMENTS en PUBLIC voyait alors ses fichiers
  // servis DÉCHIFFRÉS à quiconque présentait un identifiant de document.
  //
  // CE QUI A ÉTÉ VÉRIFIÉ AVANT DE FERMER : aucun client n'appelle cette route.
  // Ni l'application mobile, ni la page publique de profil. L'ouverture ne
  // servait donc personne — elle exposait, sans rendre de service.
  //
  // Le contrôle vit dans le service, qui exige maintenant un demandeur
  // identifié par sa SIGNATURE. Retirer ce décorateur ne suffirait pas à
  // rouvrir la brèche : il faudrait aussi rendre le paramètre facultatif, ce
  // qu'un test de sabotage surveille.
  // ==========================================================================
  @Get('documents/:id')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() viewer: AccessTokenPayload,
  ) {
    const { buffer, mimeType, fileName } = await this.documents.download(
      viewer.sub,
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
