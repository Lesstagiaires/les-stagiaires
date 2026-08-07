import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { categoryOf } from './notification-categories';
import type {
  NotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';
import { resolveLinkPath } from './notification-links';

// Canal interne. Contrairement au SMS et à l'e-mail, il ne filtre RIEN et ne
// consulte aucune préférence : c'est lui qui constitue l'historique du Centre de
// Notifications, et un historique à trous ne vaut rien. L'utilisateur peut
// choisir de ne pas être dérangé ; il ne peut pas choisir d'effacer son parcours.
@Injectable()
export class InAppNotificationChannel implements NotificationChannel {
  constructor(private readonly prisma: PrismaService) {}

  async send(userId: string, payload: NotificationPayload): Promise<void> {
    const metadata = payload.metadata as Record<string, unknown> | undefined;
    await this.prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        metadata: payload.metadata,
        // Catégorie et lien figés à la création : ils décrivent la situation au
        // moment du fait, et ne doivent pas bouger si les règles changent.
        category: categoryOf(payload.type),
        linkPath: resolveLinkPath(payload.type, metadata),
      },
    });
  }
}
