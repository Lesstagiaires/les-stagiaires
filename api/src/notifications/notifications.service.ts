import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { NotificationType } from '../../generated/prisma/enums';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from './notification-channel.interface';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: NotificationChannel[],
  ) {}

  // Diffuse un évènement à tout compte ADMIN actif, sur chaque canal actif — appelé par les
  // modules métier (ex. PartnershipRequestsService) sans qu'ils aient à savoir combien de
  // canaux existent ni lesquels sont actifs.
  async notifyAdmins(type: NotificationType, metadata?: Prisma.InputJsonValue) {
    const adminIds = await this.prisma.userRole
      .findMany({
        where: { isActive: true, role: { name: 'ADMIN' } },
        select: { userId: true },
      })
      .then((rows) => rows.map((row) => row.userId));

    await Promise.all(
      adminIds.flatMap((userId) =>
        this.channels.map((channel) => channel.send(userId, { type, metadata })),
      ),
    );
  }

  async listMine(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    // 404 plutôt que 403 sur une notification appartenant à un autre utilisateur — ne pas
    // confirmer qu'un identifiant de notification existe à quelqu'un qui n'y a pas droit.
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification introuvable.');
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
