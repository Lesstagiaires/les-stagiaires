import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './sms-provider.interface';
import { ConsoleSmsProvider } from './console-sms.provider';
import { AfricasTalkingSmsProvider } from './africastalking-sms.provider';
import { resolveSmsProviderName } from './sms-provider-selection';

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
        // ====================================================================
        // LA SÉLECTION LÈVE, ELLE NE REPLIE PAS
        //
        // Cette fabrique est appelée pendant l'assemblage du conteneur, donc
        // AVANT que le serveur écoute quoi que ce soit. Une configuration
        // invalide arrête l'application avant qu'un seul code à usage unique
        // ait pu être fabriqué, et donc avant qu'un seul ait pu être écrit
        // quelque part.
        //
        // C'est le point qui compte : l'échec précède la première occasion de
        // fuite, il ne la suit pas.
        // ====================================================================
        const nom = resolveSmsProviderName({
          SMS_PROVIDER: config.get<string>('SMS_PROVIDER'),
          REQUIRE_REAL_SMS: config.get<string>('REQUIRE_REAL_SMS'),
        });

        // Le nom seulement, jamais la clef ni un message.
        new Logger('SmsModule').log(`Fournisseur SMS retenu : ${nom}`);

        return nom === 'africastalking' ? africasTalking : console;
      },
      inject: [ConfigService, ConsoleSmsProvider, AfricasTalkingSmsProvider],
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
