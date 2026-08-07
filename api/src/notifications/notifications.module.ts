import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { EmailNotificationChannel } from './email-notification.channel';
import { InAppNotificationChannel } from './in-app-notification.channel';
import { NOTIFICATION_CHANNELS } from './notification-channel.interface';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';
import { SmsNotificationChannel } from './sms-notification.channel';

@Module({
  imports: [SmsModule, EmailModule],
  providers: [
    InAppNotificationChannel,
    SmsNotificationChannel,
    EmailNotificationChannel,
    {
      // TROIS canaux actifs, et chacun décide seul de se taire :
      //   — l'in-app reçoit TOUT : c'est lui qui constitue l'historique du Centre
      //     de Notifications, et un historique à trous ne vaut rien ;
      //   — le SMS filtre sur CRITICAL_SMS_TYPES, parce qu'il coûte ;
      //   — l'e-mail filtre sur l'existence d'un gabarit et sur les préférences
      //     de l'utilisateur.
      //
      // Le filtrage est délibérément porté par les canaux, jamais par les
      // appelants : un module métier signale un fait, il n'a pas à savoir combien
      // de canaux existent ni lequel coûte de l'argent. C'est ce qui garde la
      // politique en un seul endroit vérifiable, au lieu de la disperser dans
      // quinze services où elle se perdrait au premier ajout de fonctionnalité.
      //
      // Le canal PUSH s'ajoutera ici, et nulle part ailleurs.
      provide: NOTIFICATION_CHANNELS,
      useFactory: (
        inApp: InAppNotificationChannel,
        sms: SmsNotificationChannel,
        email: EmailNotificationChannel,
      ) => [inApp, sms, email],
      inject: [
        InAppNotificationChannel,
        SmsNotificationChannel,
        EmailNotificationChannel,
      ],
    },
    NotificationsService,
    NotificationPreferencesService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
