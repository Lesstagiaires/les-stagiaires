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
})
export class ProfilesModule {}
