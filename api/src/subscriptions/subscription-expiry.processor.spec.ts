import { SubscriptionStatus } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionNoticesService } from './subscription-notices.service';
import { SubscriptionExpiryProcessor } from './subscription-expiry.processor';

describe('SubscriptionExpiryProcessor', () => {
  it('expires cancelled subscriptions once their paid period ends', async () => {
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sub-cancelled' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notices = {
      signalerFinDeCouverture: jest.fn().mockResolvedValue(undefined),
      balayerEcheances: jest.fn().mockResolvedValue(0),
    };
    const processor = new SubscriptionExpiryProcessor(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notices as unknown as SubscriptionNoticesService,
    );

    await processor.process();

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
        },
        currentPeriodEnd: { not: null, lte: expect.any(Date) as Date },
      },
      select: { id: true },
    });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
        },
        currentPeriodEnd: { not: null, lte: expect.any(Date) as Date },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    expect(notices.signalerFinDeCouverture).toHaveBeenCalledWith([
      'sub-cancelled',
    ]);
  });

  it('does not expire a cancelled subscription before its paid period ends', async () => {
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notices = {
      signalerFinDeCouverture: jest.fn().mockResolvedValue(undefined),
      balayerEcheances: jest.fn().mockResolvedValue(0),
    };
    const processor = new SubscriptionExpiryProcessor(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notices as unknown as SubscriptionNoticesService,
    );

    await processor.process();

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: SubscriptionStatus.EXPIRED } }),
    );
    expect(notices.signalerFinDeCouverture).toHaveBeenCalledWith([]);
  });
});
