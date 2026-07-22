import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { StorageModule } from '../storage/storage.module';
import { AccessLogService } from './access-log.service';
import { DigitalSafeCleanupProcessor } from './digital-safe-cleanup.processor';
import { DigitalSafeCleanupScheduler } from './digital-safe-cleanup.scheduler';
import { DigitalSafeDocumentsController } from './documents.controller';
import { DigitalSafeDocumentsService } from './documents.service';
import { PassportController } from './passport.controller';
import { PassportService } from './passport.service';
import { QrCodeService } from './qrcode.service';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  imports: [
    StorageModule,
    ProfilesModule,
    BullModule.registerQueue({ name: 'digital-safe-cleanup' }),
  ],
  controllers: [
    DigitalSafeDocumentsController,
    SharesController,
    PassportController,
  ],
  providers: [
    DigitalSafeDocumentsService,
    AccessLogService,
    SharesService,
    QrCodeService,
    PassportService,
    DigitalSafeCleanupProcessor,
    DigitalSafeCleanupScheduler,
  ],
})
export class DigitalSafeModule {}
