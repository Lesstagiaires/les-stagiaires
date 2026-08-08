import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SmsModule } from '../sms/sms.module';
import { AccountCleanupProcessor } from './account-cleanup.processor';
import { AccountCleanupScheduler } from './account-cleanup.scheduler';
import { AmbassadorsModule } from '../ambassadors/ambassadors.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AgeThresholdsController,
  CountryPolicyController,
} from './country-policy.controller';
import { CountryPolicyService } from './country-policy.service';
import { MinorPolicyService } from './minor-policy.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { ParentalConsentSweepProcessor } from './parental-consent-sweep.processor';
import { ParentalConsentSweepScheduler } from './parental-consent-sweep.scheduler';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AmbassadorsModule,
    PassportModule,
    JwtModule.register({}),
    SmsModule,
    BullModule.registerQueue(
      { name: 'account-cleanup' },
      { name: 'parental-consent-sweep' },
    ),
  ],
  controllers: [
    AuthController,
    // Route publique /auth/age-thresholds/:pays — l'écran d'inscription lit les
    // seuils du pays au lieu d'en coder un en dur.
    AgeThresholdsController,
    CountryPolicyController,
  ],
  providers: [
    AuthService,
    OtpService,
    ParentalConsentService,
    CountryPolicyService,
    MinorPolicyService,
    TokenService,
    JwtStrategy,
    AccountCleanupProcessor,
    AccountCleanupScheduler,
    ParentalConsentSweepProcessor,
    ParentalConsentSweepScheduler,
  ],
  // MinorPolicyService est réutilisé par les modules Candidatures et Digital Safe pour
  // les actions nécessitant l'accord parental (candidature, acceptation, signature,
  // mobilité, partage) — jamais une comparaison directe à User.isMinor hors de ce module.
  exports: [MinorPolicyService, CountryPolicyService],
})
export class AuthModule {}
