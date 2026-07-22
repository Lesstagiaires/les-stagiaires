import { Module } from '@nestjs/common';
import { DigitalSafeModule } from '../digital-safe/digital-safe.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SmsModule } from '../sms/sms.module';
import { StorageModule } from '../storage/storage.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [StorageModule, ProfilesModule, DigitalSafeModule, SmsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
