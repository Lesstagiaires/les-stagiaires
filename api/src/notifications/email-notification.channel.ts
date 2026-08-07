import { Injectable } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import type {
  NotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';

// Canal e-mail. Comme le canal SMS, il ne décide de rien : il délègue à
// EmailService, qui applique les préférences, choisit la langue du destinataire
// et journalise. Les modules métier continuent d'ignorer qu'un e-mail existe.
@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  constructor(private readonly email: EmailService) {}

  async send(userId: string, payload: NotificationPayload): Promise<void> {
    await this.email.sendForNotification(
      userId,
      payload.type,
      payload.metadata as Record<string, unknown> | undefined,
    );
  }
}
