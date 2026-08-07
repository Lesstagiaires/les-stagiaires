import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DigitalSafeModule } from '../digital-safe/digital-safe.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsModule } from '../sms/sms.module';
import { ApplicationShareRenewalProcessor } from './application-share-renewal.processor';
import { ApplicationShareRenewalScheduler } from './application-share-renewal.scheduler';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { InternshipStartSweepProcessor } from './internship-start-sweep.processor';
import { InternshipStartSweepScheduler } from './internship-start-sweep.scheduler';
import { TravelConsentSweepProcessor } from './travel-consent-sweep.processor';
import { TravelConsentSweepScheduler } from './travel-consent-sweep.scheduler';

@Module({
  imports: [
    AuthModule,
    ProfilesModule,
    DigitalSafeModule,
    OpportunitiesModule,
    // SmsModule reste : le consentement parental d'un mineur passe encore par SMS.
    SmsModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'travel-consent-sweep' }),
    BullModule.registerQueue({ name: 'internship-start-sweep' }),
    BullModule.registerQueue({ name: 'application-share-renewal-sweep' }),
  ],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    TravelConsentSweepProcessor,
    InternshipStartSweepProcessor,
    InternshipStartSweepScheduler,
    TravelConsentSweepScheduler,
    ApplicationShareRenewalProcessor,
    ApplicationShareRenewalScheduler,
  ],
})
export class ApplicationsModule {}
