import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms-provider.interface';
import { CRITICAL_SMS_TYPES } from './critical-sms-types';
import type {
  NotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';
import { renderCriticalSms } from './sms-templates';

// Canal SMS. Il ne décide de rien : il applique CRITICAL_SMS_TYPES, et se tait
// pour tout le reste. Les modules métier appellent `notifyUser` sans savoir qu'un
// SMS existe — c'est ce qui garde la politique du promoteur en UN seul endroit
// vérifiable, au lieu de la disperser dans chaque appelant où elle se perdrait au
// premier ajout de fonctionnalité.
@Injectable()
export class SmsNotificationChannel implements NotificationChannel {
  private readonly logger = new Logger(SmsNotificationChannel.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async send(userId: string, payload: NotificationPayload): Promise<void> {
    if (!CRITICAL_SMS_TYPES.has(payload.type)) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, language: true },
    });
    if (!user?.phone) return;

    const message = renderCriticalSms(payload, user.language);
    if (!message) return;

    try {
      await this.sms.send(user.phone, message);
    } catch (error) {
      // Un SMS qui ne part pas ne doit jamais faire échouer l'opération métier qui
      // l'a déclenché : la notification interne, elle, est déjà écrite en base et
      // reste consultable. On journalise et on continue.
      this.logger.warn(
        `Envoi SMS impossible pour ${payload.type} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
