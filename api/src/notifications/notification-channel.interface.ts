import type { Prisma } from '../../generated/prisma/client';
import type { NotificationType } from '../../generated/prisma/enums';

export const NOTIFICATION_CHANNELS = 'NOTIFICATION_CHANNELS';

export interface NotificationPayload {
  type: NotificationType;
  metadata?: Prisma.InputJsonValue;
}

// Chaque canal (in-app aujourd'hui, SMS envisagé plus tard) reçoit le même évènement et
// décide lui-même comment le restituer — écriture en base pour l'in-app, composition d'un
// message + SmsProvider.send() pour un futur canal SMS. Pour ajouter le SMS :
//   1. Créer une classe SmsNotificationChannel implements NotificationChannel qui injecte
//      SMS_PROVIDER (SmsModule) et PrismaService pour résoudre le téléphone du destinataire.
//   2. L'ajouter au tableau retourné par la factory NOTIFICATION_CHANNELS
//      (notifications.module.ts), au besoin piloté par une variable d'environnement comme
//      NOTIFICATIONS_SMS_ENABLED (même schéma que MALWARE_SCANNER_PROVIDER).
// NotificationsService et tous ses appelants restent inchangés.
export interface NotificationChannel {
  send(userId: string, payload: NotificationPayload): Promise<void>;
}
