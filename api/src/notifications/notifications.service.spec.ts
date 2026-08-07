import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let prisma: {
    userRole: { findMany: jest.Mock };
    notification: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let channelA: { send: jest.Mock };
  let channelB: { send: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      userRole: { findMany: jest.fn() },
      notification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    channelA = { send: jest.fn().mockResolvedValue(undefined) };
    channelB = { send: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(prisma as unknown as PrismaService, [
      channelA,
      channelB,
    ]);
  });

  describe('notifyAdmins', () => {
    it('fans out to every active admin, across every registered channel', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { userId: 'admin-1' },
        { userId: 'admin-2' },
      ]);

      await service.notifyAdmins('PARTNERSHIP_REQUEST_NEW', {
        requestId: 'req-1',
      });

      expect(prisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, role: { name: 'ADMIN' } },
        }),
      );
      const expectedPayload = {
        type: 'PARTNERSHIP_REQUEST_NEW',
        metadata: { requestId: 'req-1' },
      };
      expect(channelA.send).toHaveBeenCalledWith('admin-1', expectedPayload);
      expect(channelA.send).toHaveBeenCalledWith('admin-2', expectedPayload);
      expect(channelB.send).toHaveBeenCalledWith('admin-1', expectedPayload);
      expect(channelB.send).toHaveBeenCalledWith('admin-2', expectedPayload);
      expect(channelA.send).toHaveBeenCalledTimes(2);
      expect(channelB.send).toHaveBeenCalledTimes(2);
    });

    it('does nothing when there are no active admins, without touching any channel', async () => {
      prisma.userRole.findMany.mockResolvedValue([]);

      await service.notifyAdmins('PARTNERSHIP_REQUEST_NEW');

      expect(channelA.send).not.toHaveBeenCalled();
      expect(channelB.send).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    const lastWhere = () => {
      const calls = prisma.notification.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      return calls[calls.length - 1][0].where;
    };

    it('ne renvoie que les notifications de l’appelant, les plus récentes d’abord', async () => {
      const rows = [{ id: 'n1' }, { id: 'n2' }];
      prisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.listMine('user-1');

      expect(lastWhere()).toMatchObject({ userId: 'user-1' });
      expect(result.items).toEqual(rows);
      expect(result.nextCursor).toBeNull();
    });

    it('masque les notifications archivées par défaut', async () => {
      // L'archivage doit retirer de la liste courante SANS supprimer : c'est
      // l'inverse d'une suppression, et l'historique complet en dépend.
      prisma.notification.findMany.mockResolvedValue([]);

      await service.listMine('user-1');

      expect(lastWhere()).toMatchObject({ archivedAt: null });
    });

    it('inclut les archivées quand on le demande explicitement', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.listMine('user-1', { includeArchived: true });

      expect(lastWhere().archivedAt).toBeUndefined();
    });

    it('rend un curseur quand une page suivante existe', async () => {
      // Le service demande limit+1 lignes pour savoir s'il en reste, puis
      // n'en renvoie que limit. Sans cela, il faudrait un COUNT séparé.
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n1' },
        { id: 'n2' },
        { id: 'n3' },
      ]);

      const result = await service.listMine('user-1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('n2');
    });

    it('ignore une recherche trop courte plutôt que de tout filtrer', async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.listMine('user-1', { search: 'a' });

      expect(lastWhere().OR).toBeUndefined();
    });

    it('plafonne la taille de page demandée', async () => {
      // Sans plafond, un client pourrait réclamer cent mille lignes d'un coup.
      prisma.notification.findMany.mockResolvedValue([]);

      await service.listMine('user-1', { limit: 100000 });

      const calls = prisma.notification.findMany.mock.calls as [
        { take: number },
      ][];
      expect(calls[calls.length - 1][0].take).toBe(101);
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException when the notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(
        service.markRead('user-1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    // Ne jamais confirmer l'existence d'une notification appartenant à quelqu'un d'autre :
    // 404, pas 403.
    it('throws NotFoundException (not Forbidden) when the notification belongs to someone else', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'n1',
        userId: 'someone-else',
      });

      await expect(service.markRead('user-1', 'n1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('marks the caller own notification as read', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'n1',
        userId: 'user-1',
      });
      const updated = { id: 'n1', userId: 'user-1', readAt: new Date() };
      prisma.notification.update.mockResolvedValue(updated);

      const result = await service.markRead('user-1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt: expect.any(Date) as Date },
      });
      expect(result).toBe(updated);
    });
  });
});
