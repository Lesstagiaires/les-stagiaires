import { Module } from '@nestjs/common';
import { InAppNotificationChannel } from './in-app-notification.channel';
import { NOTIFICATION_CHANNELS } from './notification-channel.interface';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  providers: [
    InAppNotificationChannel,
    {
      // Un seul canal actif pour l'instant. Pour ajouter le SMS : instancier le nouveau
      // canal ici (l'ajouter aux `providers` si c'est une classe injectable) et l'inclure
      // dans le tableau retourné — voir notification-channel.interface.ts pour le détail.
      provide: NOTIFICATION_CHANNELS,
      useFactory: (inApp: InAppNotificationChannel) => [inApp],
      inject: [InAppNotificationChannel],
    },
    NotificationsService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
