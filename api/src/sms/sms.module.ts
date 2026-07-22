import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './sms-provider.interface';
import { ConsoleSmsProvider } from './console-sms.provider';
import { AfricasTalkingSmsProvider } from './africastalking-sms.provider';

@Module({
  providers: [
    ConsoleSmsProvider,
    AfricasTalkingSmsProvider,
    {
      provide: SMS_PROVIDER,
      useFactory: (
        config: ConfigService,
        console: ConsoleSmsProvider,
        africasTalking: AfricasTalkingSmsProvider,
      ) => {
        return config.get<string>('SMS_PROVIDER') === 'africastalking'
          ? africasTalking
          : console;
      },
      inject: [ConfigService, ConsoleSmsProvider, AfricasTalkingSmsProvider],
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
