import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { NotificationChannel, NotificationPayload } from './notification-channel.interface';

@Injectable()
export class InAppNotificationChannel implements NotificationChannel {
  constructor(private readonly prisma: PrismaService) {}

  async send(userId: string, payload: NotificationPayload): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type: payload.type, metadata: payload.metadata },
    });
  }
}
