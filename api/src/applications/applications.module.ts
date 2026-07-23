import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DigitalSafeModule } from '../digital-safe/digital-safe.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SmsModule } from '../sms/sms.module';
import { ApplicationShareRenewalProcessor } from './application-share-renewal.processor';
import { ApplicationShareRenewalScheduler } from './application-share-renewal.scheduler';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { TravelConsentSweepProcessor } from './travel-consent-sweep.processor';
import { TravelConsentSweepScheduler } from './travel-consent-sweep.scheduler';

@Module({
  imports: [
    ProfilesModule,
    DigitalSafeModule,
    SmsModule,
    BullModule.registerQueue({ name: 'travel-consent-sweep' }),
    BullModule.registerQueue({ name: 'application-share-renewal-sweep' }),
  ],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    TravelConsentSweepProcessor,
    TravelConsentSweepScheduler,
    ApplicationShareRenewalProcessor,
    ApplicationShareRenewalScheduler,
  ],
})
export class ApplicationsModule {}
