import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { MinorPolicyService } from '../auth/minor-policy.service';
import type { OrganizationAccessService } from '../opportunities/organization-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionPricingService } from './subscription-pricing.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock };
    organization: { findUniqueOrThrow: jest.Mock };
    subscription: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    payment: { create: jest.Mock; update: jest.Mock };
  };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock };
  let minorPolicy: { assertActionAllowed: jest.Mock };
  let orgAccess: {
    assertCanManageBilling: jest.Mock;
    assertCanManage: jest.Mock;
  };
  let pricing: { resolve: jest.Mock };
  let gateway: { initiate: jest.Mock };
  let service: SubscriptionsService;

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      subscription: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: { create: jest.fn(), update: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('simulated') };
    audit = { record: jest.fn() };
    minorPolicy = {
      assertActionAllowed: jest.fn().mockResolvedValue(undefined),
    };
    orgAccess = {
      assertCanManageBilling: jest.fn().mockResolvedValue(undefined),
      assertCanManage: jest.fn().mockResolvedValue(undefined),
    };
    pricing = {
      resolve: jest
        .fn()
        .mockReturnValue({ amountMinor: 500000, currency: 'XAF' }),
    };
    gateway = {
      initiate: jest.fn().mockResolvedValue({
        providerReference: 'SIM-123',
        instructions: 'Pay now.',
      }),
    };
    // P1-1 : par défaut la place est libre. Tout test qui veut la voir occupée
    // le dit explicitement — aucun test existant ne doit changer de sens du
    // seul fait qu'une garde soit apparue.
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.create.mockResolvedValue({
      id: 'sub-1',
      plan: 'CARRIERE_SECURISEE',
      status: 'PENDING_PAYMENT',
    });
    prisma.payment.create.mockResolvedValue({ id: 'pay-1' });
    prisma.payment.update.mockResolvedValue({
      id: 'pay-1',
      providerReference: 'SIM-123',
    });

    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      minorPolicy as unknown as MinorPolicyService,
      orgAccess as unknown as OrganizationAccessService,
      pricing as unknown as SubscriptionPricingService,
      gateway,
    );
  });

  describe('subscribeSelf', () => {
    it('never runs the minor-protection gate — a minor can self-subscribe directly', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'minor-1',
        countryOfResidence: 'CM',
        isMinor: true,
      });

      await service.subscribeSelf('minor-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(minorPolicy.assertActionAllowed).not.toHaveBeenCalled();
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          data: expect.objectContaining({
            plan: 'CARRIERE_SECURISEE',
            beneficiaryUserId: 'minor-1',
            originType: 'SELF',
          }),
        }),
      );
    });

    it('resolves the price server-side and initiates payment through the gateway', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        countryOfResidence: 'CM',
      });

      const result = await service.subscribeSelf('user-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(pricing.resolve).toHaveBeenCalledWith(
        'CARRIERE_SECURISEE',
        'ANNUAL',
        'CM',
      );
      expect(gateway.initiate).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 500000, currency: 'XAF' }),
      );
      expect(result.payment.providerReference).toBe('SIM-123');
      expect(result.payment.instructions).toBe('Pay now.');
    });

    it('falls back to CM when the account has no declared country of residence', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        countryOfResidence: null,
      });

      await service.subscribeSelf('user-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(pricing.resolve).toHaveBeenCalledWith(
        'CARRIERE_SECURISEE',
        'ANNUAL',
        'CM',
      );
    });
  });

  describe('subscribeOrganization', () => {
    it('rejects a caller who cannot manage billing for the organization', async () => {
      orgAccess.assertCanManageBilling.mockRejectedValue(
        new ForbiddenException('not allowed'),
      );

      await expect(
        service.subscribeOrganization('user-1', 'org-1', {
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('derives BUSINESS from an ENTREPRISE organization — never trusts a client-supplied plan', async () => {
      prisma.organization.findUniqueOrThrow.mockResolvedValue({
        id: 'org-1',
        type: 'ENTREPRISE',
        country: 'CM',
      });

      await service.subscribeOrganization('user-1', 'org-1', {
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          data: expect.objectContaining({
            plan: 'BUSINESS',
            beneficiaryOrganizationId: 'org-1',
            originType: 'SELF',
          }),
        }),
      );
    });

    it('derives INSTITUTION from an ETABLISSEMENT organization', async () => {
      prisma.organization.findUniqueOrThrow.mockResolvedValue({
        id: 'org-2',
        type: 'ETABLISSEMENT',
        country: 'CM',
      });

      await service.subscribeOrganization('user-1', 'org-2', {
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          data: expect.objectContaining({ plan: 'INSTITUTION' }),
        }),
      );
    });
  });

  describe('subscribeOrgSponsored', () => {
    it('rejects a caller who cannot manage billing for the sponsoring organization', async () => {
      orgAccess.assertCanManageBilling.mockRejectedValue(
        new ForbiddenException('not allowed'),
      );

      await expect(
        service.subscribeOrgSponsored('user-1', 'org-1', 'beneficiary-1', {
          plan: 'CARRIERE_SECURISEE',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(minorPolicy.assertActionAllowed).not.toHaveBeenCalled();
    });

    // CLAUDE.md §6 : contrairement à subscribeSelf, un abonnement porté par un
    // établissement/entreprise pour un bénéficiaire mineur reste toujours soumis à
    // l'accord parental actif.
    it('always runs the minor-protection gate for the beneficiary', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'minor-1',
        countryOfResidence: 'CM',
        isMinor: true,
      });
      minorPolicy.assertActionAllowed.mockRejectedValue(
        new ForbiddenException('Consentement parental requis.'),
      );

      await expect(
        service.subscribeOrgSponsored('user-1', 'org-1', 'minor-1', {
          plan: 'CARRIERE_SECURISEE',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(minorPolicy.assertActionAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'minor-1' }),
        'SUBSCRIPTION_ORG_SPONSORED',
      );
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('creates an ORGANIZATION-origin individual-plan subscription once the gate passes', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'beneficiary-1',
        countryOfResidence: 'CI',
      });

      await service.subscribeOrgSponsored('user-1', 'org-1', 'beneficiary-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          data: expect.objectContaining({
            plan: 'CARRIERE_SECURISEE',
            beneficiaryUserId: 'beneficiary-1',
            originType: 'ORGANIZATION',
            initiatingOrganizationId: 'org-1',
          }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException for a missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('user-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a caller who is neither the beneficiary user nor authorized on the beneficiary organization', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        beneficiaryUserId: 'someone-else',
        beneficiaryOrganizationId: null,
        status: 'ACTIVE',
      });

      await expect(service.cancel('user-1', 'sub-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('is a no-op for an already-cancelled subscription', async () => {
      const subscription = {
        id: 'sub-1',
        beneficiaryUserId: 'user-1',
        beneficiaryOrganizationId: null,
        status: 'CANCELLED',
      };
      prisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.cancel('user-1', 'sub-1');

      expect(result).toBe(subscription);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('cancels an active subscription owned by the caller', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        beneficiaryUserId: 'user-1',
        beneficiaryOrganizationId: null,
        status: 'ACTIVE',
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-1',
        status: 'CANCELLED',
      });

      await service.cancel('user-1', 'sub-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) as Date },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'SUBSCRIPTION_CANCELLED',
        'user-1',
        {
          subscriptionId: 'sub-1',
        },
      );
    });

    it('allows an organization billing manager to cancel an org-beneficiary subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-2',
        beneficiaryUserId: null,
        beneficiaryOrganizationId: 'org-1',
        status: 'ACTIVE',
      });
      prisma.subscription.update.mockResolvedValue({
        id: 'sub-2',
        status: 'CANCELLED',
      });

      await service.cancel('org-admin-1', 'sub-2');

      expect(orgAccess.assertCanManage).toHaveBeenCalledWith(
        'org-1',
        'org-admin-1',
      );
      expect(prisma.subscription.update).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('throws NotFoundException for a missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.getById('user-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listAll', () => {
    it('passes the status/plan filters through to Prisma', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listAll({ status: 'ACTIVE', plan: undefined });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', plan: undefined },
        }),
      );
    });
  });

  // ==========================================================================
  // P1-1 — UN SEUL ABONNEMENT INDIVIDUEL ACTIF
  //
  // Ces tests couvrent la GARDE APPLICATIVE, celle qui produit l'erreur métier.
  // Ils ne peuvent rien dire de la course entre deux requêtes simultanées :
  // `prisma` est ici un double, il n'y a pas de base. C'est
  // `subscriptions-unicite.integration.spec.ts` qui éprouve l'index partiel sur
  // un PostgreSQL réel — la séparation est volontaire, pas une commodité.
  // ==========================================================================
  describe('P1-1 : un seul abonnement individuel actif', () => {
    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'user-1',
        countryOfResidence: 'CM',
      });
    });

    it('laisse passer la première souscription quand la place est libre', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.subscribeSelf('user-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it('refuse un second abonnement quand un ACTIVE occupe la place, sans créer ni Subscription ni Payment', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-active' });

      await expect(
        service.subscribeSelf('user-1', {
          plan: 'CARRIERE_PLUS',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Le cœur de P1-1 : aucune écriture, donc aucun paiement, donc aucune
      // confirmation possible, donc aucune commission (contradiction C-3).
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.initiate).not.toHaveBeenCalled();
    });

    it('refuse aussi quand un PENDING_PAYMENT occupe la place', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-pending' });

      await expect(
        service.subscribeSelf('user-1', {
          plan: 'CARRIERE_SECURISEE',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    // PAYMENT_FAILED, EXPIRED et CANCELLED : ce test épingle le PRÉDICAT plutôt
    // que de simuler chaque cas. Simuler « findFirst rend null » pour un statut
    // non bloquant serait tautologique — c'est le double qui déciderait, pas le
    // code. Ici on vérifie ce que le service DEMANDE réellement à la base.
    it('ne consulte que les statuts qui occupent la place, et que les formules individuelles', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.subscribeSelf('user-1', {
        plan: 'CARRIERE_SECURISEE',
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- nested expect.objectContaining is untyped by design
          where: expect.objectContaining({
            beneficiaryUserId: 'user-1',
            status: { in: ['ACTIVE', 'PENDING_PAYMENT'] },
            plan: { in: ['CARRIERE_SECURISEE', 'CARRIERE_PLUS'] },
          }),
        }),
      );

      const [[appel]] = prisma.subscription.findFirst.mock.calls as [
        [{ where: { status: { in: string[] } } }],
      ];
      for (const libre of ['PAYMENT_FAILED', 'EXPIRED', 'CANCELLED']) {
        expect(appel.where.status.in).not.toContain(libre);
      }
    });

    it('empêche un parrainage organisationnel de contourner la garde', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-active' });

      await expect(
        service.subscribeOrgSponsored('admin-1', 'org-1', 'user-1', {
          plan: 'CARRIERE_PLUS',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("ne s'applique jamais à un abonnement d'organisation", async () => {
      prisma.organization.findUniqueOrThrow.mockResolvedValue({
        id: 'org-1',
        type: 'ENTREPRISE',
        country: 'CM',
      });

      await service.subscribeOrganization('admin-1', 'org-1', {
        billingCycle: 'ANNUAL',
      });

      // La garde sort avant toute lecture : un abonnement BUSINESS ne porte pas
      // de beneficiaryUserId, il n'occupe donc aucune place individuelle.
      expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
      expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    });

    it('traduit une violation de l’index en conflit métier, jamais en erreur serveur', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      // Ce que Prisma remonte quand l'index partiel tranche une course que la
      // garde applicative a laissé passer : deux requêtes ont lu « place libre »
      // en même temps.
      prisma.subscription.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        service.subscribeSelf('user-1', {
          plan: 'CARRIERE_SECURISEE',
          billingCycle: 'ANNUAL',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
