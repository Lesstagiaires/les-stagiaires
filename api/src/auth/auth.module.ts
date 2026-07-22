import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SmsModule } from '../sms/sms.module';
import { AccountCleanupProcessor } from './account-cleanup.processor';
import { AccountCleanupScheduler } from './account-cleanup.scheduler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { ParentalConsentSweepProcessor } from './parental-consent-sweep.processor';
import { ParentalConsentSweepScheduler } from './parental-consent-sweep.scheduler';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    SmsModule,
    BullModule.registerQueue(
      { name: 'account-cleanup' },
      { name: 'parental-consent-sweep' },
    ),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    ParentalConsentService,
    TokenService,
    JwtStrategy,
    AccountCleanupProcessor,
    AccountCleanupScheduler,
    ParentalConsentSweepProcessor,
    ParentalConsentSweepScheduler,
  ],
})
export class AuthModule {}
