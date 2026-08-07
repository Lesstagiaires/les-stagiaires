import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailDeliveryStatus,
  Language,
  NotificationChannelKind,
  NotificationType,
} from '../../generated/prisma/enums';
import {
  categoryOf,
  UNDISABLEABLE_CATEGORIES,
} from '../notifications/notification-categories';
import {
  mayEmail,
  respectsPreferences,
} from '../notifications/notification-delivery';
import { PrismaService } from '../prisma/prisma.service';
import { renderEmailHtml, renderEmailText } from './email-layout';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.interface';
import { renderEmailContent, type TemplateVars } from './email-templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  // Envoie l'e-mail correspondant à une notification, si et seulement si :
  //   — un gabarit existe pour ce type ;
  //   — le destinataire a une adresse ;
  //   — il n'a pas coupé cette catégorie.
  //
  // Chacun de ces trois refus est JOURNALISÉ avec son motif, et distingué d'une
  // panne technique. C'est ce qui permet de répondre à « je n'ai rien reçu » :
  // sans cette trace, on ne saurait pas dire si l'e-mail a échoué, s'il n'a
  // jamais été tenté, ou si l'utilisateur l'avait lui-même désactivé.
  async sendForNotification(
    userId: string,
    type: NotificationType,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const category = categoryOf(type);

    // PREMIER FILTRE, avant toute lecture en base : le comportement de diffusion
    // décidé pour ce type (notification-delivery.ts). IN_APP_ONLY et
    // ADMINISTRATIVE ne produisent jamais d'e-mail — inutile d'aller chercher
    // l'utilisateur, ses préférences ou un gabarit.
    if (!mayEmail(type)) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, language: true },
    });

    if (!user?.email) {
      // Pas d'adresse : rien à journaliser côté e-mail, il n'y a pas de
      // destinataire. La notification interne, elle, est déjà écrite.
      return;
    }

    const language = user.language ?? Language.FR;
    const content = renderEmailContent(
      type,
      (metadata ?? {}) as TemplateVars,
      language,
    );

    if (!content) {
      // Le type devrait donner lieu à un e-mail, mais aucun gabarit n'existe.
      // C'est un TROU, pas une décision — et il doit se voir. Journalisé en
      // SKIPPED avec un motif distinct, pour qu'un rapport d'exploitation puisse
      // le remonter sans qu'on ait à relire la table à la main.
      await this.log({
        userId,
        recipient: user.email,
        category,
        templateKey: type,
        language,
        subject: `[gabarit manquant] ${type}`,
        status: EmailDeliveryStatus.SKIPPED,
        reason: 'GABARIT_ABSENT',
      });
      return;
    }

    // SECOND FILTRE : les préférences de l'utilisateur, qui ne s'appliquent
    // qu'aux évènements EMAIL_OPTIONAL. Un EMAIL_REQUIRED porte une échéance, un
    // engagement ou de l'argent : il part quoi qu'il arrive.
    const allowed =
      !respectsPreferences(type) ||
      (await this.isCategoryAllowed(userId, type));
    if (!allowed) {
      await this.log({
        userId,
        recipient: user.email,
        category,
        templateKey: type,
        language,
        subject: content.subject,
        status: EmailDeliveryStatus.SKIPPED,
        reason: 'CATEGORIE_DESACTIVEE_PAR_UTILISATEUR',
      });
      return;
    }

    const baseUrl =
      this.config.get<string>('APP_PUBLIC_URL') ?? 'https://lesstagiaires.app';

    try {
      const result = await this.provider.send({
        to: user.email,
        subject: content.subject,
        html: renderEmailHtml(content, language, baseUrl),
        text: renderEmailText(content, language, baseUrl),
      });
      await this.log({
        userId,
        recipient: user.email,
        category,
        templateKey: type,
        language,
        subject: content.subject,
        status: EmailDeliveryStatus.SENT,
        providerMessageId: result.providerMessageId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Un e-mail qui ne part pas ne fait JAMAIS échouer l'opération métier qui
      // l'a déclenché : la notification interne est déjà en base et reste
      // consultable. On journalise, et l'incident reste rejouable.
      this.logger.warn(`Envoi e-mail impossible (${type}) : ${message}`);
      await this.log({
        userId,
        recipient: user.email,
        category,
        templateKey: type,
        language,
        subject: content.subject,
        status: EmailDeliveryStatus.FAILED,
        reason: message.slice(0, 500),
      });
    }
  }

  // Une catégorie protégée ne se coupe pas, même si une ligne de préférence
  // existe : le contrôle se fait ici ET à l'écriture de la préférence, parce
  // qu'une ligne peut avoir été écrite avant que la catégorie ne devienne
  // protégée.
  async isCategoryAllowed(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const category = categoryOf(type);
    if (UNDISABLEABLE_CATEGORIES.has(category)) return true;

    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_category_channel: {
          userId,
          category,
          channel: NotificationChannelKind.EMAIL,
        },
      },
      select: { enabled: true },
    });

    // Absence de ligne = activé. Le défaut est « je reçois », un refus doit être
    // explicite.
    return preference?.enabled ?? true;
  }

  private async log(entry: {
    userId: string;
    recipient: string;
    category: ReturnType<typeof categoryOf>;
    templateKey: string;
    language: Language;
    subject: string;
    status: EmailDeliveryStatus;
    reason?: string;
    providerMessageId?: string;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.emailLog.create({
      data: {
        userId: entry.userId,
        recipient: entry.recipient,
        category: entry.category,
        templateKey: entry.templateKey,
        language: entry.language,
        subject: entry.subject,
        providerName: this.provider.name,
        providerMessageId: entry.providerMessageId,
        status: entry.status,
        reason: entry.reason,
        sentAt: entry.status === EmailDeliveryStatus.SENT ? now : null,
        failedAt: entry.status === EmailDeliveryStatus.FAILED ? now : null,
      },
    });
  }
}
