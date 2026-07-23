import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CvService } from './cv.service';
import { DocumentCleanupProcessor } from './document-cleanup.processor';
import { DocumentCleanupScheduler } from './document-cleanup.scheduler';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { RecommendationsService } from './recommendations.service';
import { VisibilityService } from './visibility.service';

@Module({
  imports: [
    StorageModule,
    BullModule.registerQueue({ name: 'document-cleanup' }),
  ],
  controllers: [ProfilesController, DocumentsController],
  providers: [
    ProfilesService,
    VisibilityService,
    DocumentsService,
    CvService,
    RecommendationsService,
    DocumentCleanupProcessor,
    DocumentCleanupScheduler,
  ],
  // ProfilesService est réutilisé par le module Candidatures pour garantir qu'un profil
  // existe avant de préremplir un dossier (FR-M5-001), même pour un candidat qui n'a
  // encore jamais ouvert son profil. RecommendationsService est réutilisé par le module
  // Entreprises pour la recommandation à la clôture d'un stage (FR-ORG-006).
  exports: [CvService, ProfilesService, RecommendationsService],
})
export class ProfilesModule {}
