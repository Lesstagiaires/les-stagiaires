import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type {
  NotificationCategory,
  NotificationType,
} from '../../generated/prisma/enums';
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
        this.channels.map((channel) =>
          channel.send(userId, { type, metadata }),
        ),
      ),
    );

    return adminIds.length;
  }

  // Diffuse à l'équipe dirigeante d'une organisation : le propriétaire et les membres
  // ADMIN actifs. Les rôles RECRUITER et VIEWER en sont exclus — une décision qui engage
  // l'organisation (partenariat accepté, suspendu, rompu) relève de sa direction, pas de
  // toute personne ayant accès aux offres (CLAUDE.md §3, moindre privilège).
  async notifyOrganizationLeadership(
    organizationId: string,
    type: NotificationType,
    metadata?: Prisma.InputJsonValue,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        ownerId: true,
        members: {
          where: { status: 'ACTIVE', role: 'ADMIN' },
          select: { userId: true },
        },
      },
    });
    // Zéro destinataire : l'organisation n'existe plus. Le retour chiffré permet à
    // l'appelant de le CONSIGNER, au lieu de croire la notification partie.
    if (!organization) return 0;

    // Le propriétaire peut aussi figurer parmi les membres : dédoublonner évite de lui
    // envoyer deux fois la même notification.
    const recipientIds = [
      ...new Set([
        organization.ownerId,
        ...organization.members.map((member) => member.userId),
      ]),
    ];

    await Promise.all(
      recipientIds.flatMap((userId) =>
        this.channels.map((channel) =>
          channel.send(userId, { type, metadata }),
        ),
      ),
    );

    return recipientIds.length;
  }

  // Diffuse à un destinataire nommé, sur chaque canal actif. Les modules métier ne
  // choisissent JAMAIS le canal eux-mêmes : c'est la politique de canaux
  // (notifications.module.ts, et pour le SMS l'allowlist CRITICAL_SMS_TYPES) qui décide
  // ce qui part par quel moyen. Sans cela, la règle « SMS réservés aux opérations
  // critiques » se retrouverait dispersée dans quinze appelants, et se perdrait au
  // premier ajout de fonctionnalité.
  async notifyUser(
    userId: string,
    type: NotificationType,
    metadata?: Prisma.InputJsonValue,
  ) {
    await Promise.all(
      this.channels.map((channel) => channel.send(userId, { type, metadata })),
    );
  }

  // --- Centre de Notifications ------------------------------------------------------

  // Liste filtrée et paginée.
  //
  // Pagination par CURSEUR et non par numéro de page : l'historique d'un
  // utilisateur actif grossit en permanence, et une pagination par offset décale
  // les résultats dès qu'une notification arrive pendant la lecture — on saute
  // alors une ligne sans le voir.
  async listMine(
    userId: string,
    filters: {
      category?: NotificationCategory;
      unreadOnly?: boolean;
      starredOnly?: boolean;
      includeArchived?: boolean;
      search?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.unreadOnly ? { readAt: null } : {}),
      ...(filters.starredOnly ? { NOT: { starredAt: null } } : {}),
      ...(filters.includeArchived ? {} : { archivedAt: null }),
      ...buildSearchFilter(filters.search),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      include: {
        attachments: {
          select: { id: true, digitalSafeDocumentId: true, label: true },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  // Compteurs par catégorie + total non lu, en UNE requête agrégée.
  //
  // Alimente à la fois la pastille de la navigation et les onglets du Centre.
  // Les compter côté client obligerait à charger tout l'historique pour afficher
  // un chiffre.
  async countsMine(userId: string) {
    const grouped = await this.prisma.notification.groupBy({
      by: ['category'],
      where: { userId, archivedAt: null, readAt: null },
      _count: { _all: true },
    });

    const byCategory = Object.fromEntries(
      grouped.map((row) => [row.category, row._count._all]),
    ) as Record<NotificationCategory, number>;

    return {
      unreadTotal: grouped.reduce((sum, row) => sum + row._count._all, 0),
      unreadByCategory: byCategory,
    };
  }

  async markRead(userId: string, id: string) {
    await this.assertOwned(userId, id);
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  // Remettre en non-lu : un utilisateur ouvre une notification en marchant, puis
  // veut la retrouver le soir. Sans cette action, elle disparaît dans la masse.
  async markUnread(userId: string, id: string) {
    await this.assertOwned(userId, id);
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: null },
    });
  }

  // Tout marquer comme lu, éventuellement dans une seule catégorie.
  async markAllRead(userId: string, category?: NotificationCategory) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        archivedAt: null,
        ...(category ? { category } : {}),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async setStarred(userId: string, id: string, starred: boolean) {
    await this.assertOwned(userId, id);
    return this.prisma.notification.update({
      where: { id },
      data: { starredAt: starred ? new Date() : null },
    });
  }

  // Archiver, jamais supprimer. Le promoteur exige un historique COMPLET : une
  // notification retirée de la liste courante doit rester retrouvable, sans quoi
  // le candidat perdrait des morceaux de son propre parcours.
  async setArchived(userId: string, id: string, archived: boolean) {
    await this.assertOwned(userId, id);
    return this.prisma.notification.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
  }

  // 404 plutôt que 403 sur une notification appartenant à quelqu'un d'autre : ne
  // pas confirmer qu'un identifiant existe à qui n'y a pas droit.
  private async assertOwned(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification introuvable.');
    }
  }
}

// Recherche plein texte pauvre mais honnête : elle porte sur le TYPE et sur les
// métadonnées sérialisées, parce que le texte affiché n'existe pas côté serveur —
// il est composé par le client, dans la langue de l'utilisateur. Chercher
// « Carrière Plus » ne peut donc pas fonctionner ici ; chercher une référence de
// candidature ou un nom d'organisation, si.
//
// La limite est assumée : une vraie recherche sur le libellé traduit demanderait
// soit d'indexer les cinq langues côté serveur, soit de filtrer côté client sur
// une page déjà chargée. À trancher quand le volume le justifiera.
function buildSearchFilter(search?: string): Prisma.NotificationWhereInput {
  const term = search?.trim();
  if (!term || term.length < 2) return {};
  return {
    OR: [
      { type: { equals: term.toUpperCase() as NotificationType } },
      { metadata: { string_contains: term } },
    ],
  };
}
