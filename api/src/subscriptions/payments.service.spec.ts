import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CommissionsService } from '../ambassadors/commissions.service';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    subscriptionId: 'sub-1',
    status: 'INITIATED',
    subscription: {
      id: 'sub-1',
      billingCycle: 'QUARTERLY',
      beneficiaryUserId: 'user-1',
    },
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let prisma: {
    payment: { findUnique: jest.Mock; update: jest.Mock };
    subscription: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock };
  let commissions: { onPaymentConfirmed: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    prisma = {
      payment: { findUnique: jest.fn(), update: jest.fn() },
      subscription: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    config = { get: jest.fn().mockReturnValue('correct-secret') };
    audit = { record: jest.fn() };
    commissions = { onPaymentConfirmed: jest.fn() };
    service = new PaymentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      commissions as unknown as CommissionsService,
    );
  });

  // Le webhook est le SEUL déclencheur de commission de toute la plateforme
  // (décision du promoteur du 2026-07-31 : « pas d'achat = pas de commission »).
  // Ces deux tests échouent si quelqu'un déplace un jour l'appel ailleurs, ou le
  // laisse se produire sur un paiement qui a échoué.
  it('déclenche le calcul de commission sur un paiement confirmé', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());

    await service.handleProviderCallback('simulated', 'correct-secret', {
      providerReference: 'ref-1',
      status: 'CONFIRMED',
    });

    expect(commissions.onPaymentConfirmed).toHaveBeenCalledWith('pay-1');
  });

  it('ne déclenche aucune commission quand le paiement échoue', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());

    await service.handleProviderCallback('simulated', 'correct-secret', {
      providerReference: 'ref-1',
      status: 'FAILED',
    });

    expect(commissions.onPaymentConfirmed).not.toHaveBeenCalled();
  });

  // CLAUDE.md §6 : jamais un endpoint que l'utilisateur final appelle lui-même pour
  // déclarer son propre paiement — seul un secret propre au prestataire authentifie
  // cet appel, pas un jeton utilisateur.
  it('rejects a webhook call with a missing or incorrect secret', async () => {
    await expect(
      service.handleProviderCallback('simulated', 'wrong-secret', {
        providerReference: 'SIM-1',
        status: 'CONFIRMED',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when no webhook secret is configured for the provider at all', async () => {
    config.get.mockReturnValue(undefined);

    await expect(
      service.handleProviderCallback('unknown-provider', 'anything', {
        providerReference: 'SIM-1',
        status: 'CONFIRMED',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws NotFoundException when no payment matches the provider reference', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(
      service.handleProviderCallback('simulated', 'correct-secret', {
        providerReference: 'SIM-missing',
        status: 'CONFIRMED',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('activates the subscription and confirms the payment on a CONFIRMED callback', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());

    const result = await service.handleProviderCallback(
      'simulated',
      'correct-secret',
      {
        providerReference: 'SIM-1',
        status: 'CONFIRMED',
      },
    );

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: {
        status: 'CONFIRMED',
        providerConfirmedAt: expect.any(Date) as Date,
      },
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
      data: expect.objectContaining({
        status: 'ACTIVE',
        startedAt: expect.any(Date) as Date,
        currentPeriodEnd: expect.any(Date) as Date,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      'SUBSCRIPTION_PAYMENT_CONFIRMED',
      'user-1',
      { subscriptionId: 'sub-1', paymentId: 'pay-1' },
    );
    expect(result).toEqual({ id: 'pay-1', status: 'CONFIRMED' });
  });

  it('marks the subscription PAYMENT_FAILED on a FAILED callback, without activating it', async () => {
    prisma.payment.findUnique.mockResolvedValue(makePayment());

    await service.handleProviderCallback('simulated', 'correct-secret', {
      providerReference: 'SIM-1',
      status: 'FAILED',
    });

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'FAILED', failedAt: expect.any(Date) as Date },
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'PAYMENT_FAILED' },
    });
  });

  // Un prestataire peut renvoyer le même évènement plusieurs fois — la transition ne doit
  // jamais être réappliquée.
  it('is idempotent: a webhook for an already-processed payment does not re-apply the transition', async () => {
    prisma.payment.findUnique.mockResolvedValue(
      makePayment({ status: 'CONFIRMED' }),
    );

    const result = await service.handleProviderCallback(
      'simulated',
      'correct-secret',
      { providerReference: 'SIM-1', status: 'CONFIRMED' },
    );

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'pay-1', status: 'CONFIRMED' });
  });

  it('never sets currentPeriodEnd for a ONE_TIME billing cycle', async () => {
    prisma.payment.findUnique.mockResolvedValue(
      makePayment({
        subscription: {
          id: 'sub-1',
          billingCycle: 'ONE_TIME',
          beneficiaryUserId: 'user-1',
        },
      }),
    );

    await service.handleProviderCallback('simulated', 'correct-secret', {
      providerReference: 'SIM-1',
      status: 'CONFIRMED',
    });

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
      data: expect.objectContaining({ currentPeriodEnd: null }),
    });
  });
});
