import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannelKind,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UNDISABLEABLE_CATEGORIES } from './notification-categories';

export interface PreferenceRow {
  category: NotificationCategory;
  channel: NotificationChannelKind;
  enabled: boolean;
  // Vrai pour les catégories qui protègent ou qui engagent : l'interface les
  // affiche verrouillées plutôt que de laisser l'utilisateur découvrir le refus
  // au moment où il tente de les couper.
  locked: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Renvoie la grille COMPLÈTE catégorie × canal, pas seulement les lignes
  // enregistrées. L'utilisateur doit voir tout ce qu'il peut régler, y compris
  // ce qu'il n'a jamais touché — une liste vide au premier affichage laisserait
  // croire qu'il ne reçoit rien.
  async listMine(userId: string): Promise<PreferenceRow[]> {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byKey = new Map(
      stored.map((row) => [`${row.category}:${row.channel}`, row.enabled]),
    );

    return Object.values(NotificationCategory).flatMap((category) =>
      Object.values(NotificationChannelKind).map((channel) => ({
        category,
        channel,
        // Absence de ligne = activé.
        enabled: byKey.get(`${category}:${channel}`) ?? true,
        locked: UNDISABLEABLE_CATEGORIES.has(category),
      })),
    );
  }

  async update(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannelKind,
    enabled: boolean,
  ) {
    // Refus explicite plutôt que silencieux : couper une catégorie protégée
    // renverrait « c'est fait » alors que rien n'aurait changé, et l'utilisateur
    // croirait ne plus être alerté d'une opération de sécurité — exactement
    // l'inverse de ce qu'on veut lui laisser croire.
    if (!enabled && UNDISABLEABLE_CATEGORIES.has(category)) {
      throw new BadRequestException(
        'Cette catégorie ne peut pas être désactivée : elle porte des informations de sécurité, financières ou contractuelles.',
      );
    }

    // Le canal in-app ne se coupe jamais : il constitue l'historique du Centre de
    // Notifications. Le couper laisserait des trous dans le parcours de
    // l'utilisateur, qu'aucun autre canal ne rattraperait.
    if (!enabled && channel === NotificationChannelKind.IN_APP) {
      throw new BadRequestException(
        "Les notifications internes ne peuvent pas être désactivées : elles constituent l'historique de votre parcours.",
      );
    }

    const preference = await this.prisma.notificationPreference.upsert({
      where: { userId_category_channel: { userId, category, channel } },
      create: { userId, category, channel, enabled },
      update: { enabled },
    });

    await this.audit.record('NOTIFICATION_PREFERENCE_UPDATED', userId, {
      category,
      channel,
      enabled,
    });

    return preference;
  }
}
