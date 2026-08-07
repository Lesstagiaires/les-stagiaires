import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleEmailProvider } from './console-email.provider';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { EmailService } from './email.service';

// Même patron que SmsModule : une factory choisit l'implémentation d'après
// l'environnement. Brancher SMTP, SendGrid, SES, Mailgun ou Resend consiste à
// ajouter une classe ici et une valeur à EMAIL_PROVIDER — rien d'autre ne bouge.
//
// Le repli est volontairement la console : un environnement mal configuré
// n'envoie rien plutôt que d'échouer, et surtout n'expédie jamais de vrais
// e-mails à de vraies personnes depuis une machine de développement.
@Module({
  providers: [
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (
        config: ConfigService,
        consoleProvider: ConsoleEmailProvider,
      ) => {
        switch (config.get<string>('EMAIL_PROVIDER')) {
          // case 'smtp': return smtpProvider;
          // case 'sendgrid': return sendgridProvider;
          default:
            return consoleProvider;
        }
      },
      inject: [ConfigService, ConsoleEmailProvider],
    },
    EmailService,
  ],
  exports: [EmailService, EMAIL_PROVIDER],
})
export class EmailModule {}
