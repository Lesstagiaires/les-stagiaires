import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DigitalSafeModule } from '../digital-safe/digital-safe.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SmsModule } from '../sms/sms.module';
import { StorageModule } from '../storage/storage.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { TravelConsentSweepProcessor } from './travel-consent-sweep.processor';
import { TravelConsentSweepScheduler } from './travel-consent-sweep.scheduler';

@Module({
  imports: [
    StorageModule,
    ProfilesModule,
    DigitalSafeModule,
    SmsModule,
    BullModule.registerQueue({ name: 'travel-consent-sweep' }),
  ],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    TravelConsentSweepProcessor,
    TravelConsentSweepScheduler,
  ],
})
export class ApplicationsModule {}
