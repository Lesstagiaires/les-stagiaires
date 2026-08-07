import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AccountStatus,
  MinorGatedAction,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { CountryPolicyService } from './country-policy.service';
import { MinorPolicyService } from './minor-policy.service';

const DEFAULT_POLICY = {
  countryCode: 'CM',
  minInternshipAge: 16,
  minParentRequiredAge: 16,
  civilMajorityAge: 18,
  gatedActions: [
    MinorGatedAction.APPLICATION_SUBMIT,
    MinorGatedAction.SIGN_CONVENTION,
  ],
  isFallback: false,
};

describe('MinorPolicyService', () => {
  let prisma: { parentalLink: { findFirst: jest.Mock } };
  let countryPolicies: { resolve: jest.Mock };
  let service: MinorPolicyService;

  beforeEach(() => {
    prisma = { parentalLink: { findFirst: jest.fn() } };
    countryPolicies = { resolve: jest.fn().mockResolvedValue(DEFAULT_POLICY) };
    service = new MinorPolicyService(
      prisma as unknown as PrismaService,
      countryPolicies as unknown as CountryPolicyService,
    );
  });

  describe('computeAge', () => {
    it('computes a straightforward age', () => {
      const age = service.computeAge(
        new Date('2000-06-15'),
        new Date('2026-06-16'),
      );
      expect(age).toBe(26);
    });

    it('has not yet turned the new age on the exact eve of the birthday', () => {
      const age = service.computeAge(
        new Date('2000-06-15'),
        new Date('2026-06-14'),
      );
      expect(age).toBe(25);
    });

    it('turns the new age precisely on the birthday itself', () => {
      const age = service.computeAge(
        new Date('2000-06-15'),
        new Date('2026-06-15'),
      );
      expect(age).toBe(26);
    });

    it('handles a leap-day birthday on a non-leap year reference date', () => {
      const age = service.computeAge(
        new Date('2004-02-29'),
        new Date('2026-03-01'),
      );
      expect(age).toBe(22);
    });
  });

  describe('classify', () => {
    it('flags an account below civil majority as a minor', async () => {
      const result = await service.classify(new Date('2010-01-01'), 'CM');
      expect(result.isMinor).toBe(true);
    });

    it('flags an account at or above civil majority as not a minor', async () => {
      const result = await service.classify(new Date('2000-01-01'), 'CM');
      expect(result.isMinor).toBe(false);
    });

    it('is in the parent-required range strictly between minParentRequiredAge and civilMajorityAge', async () => {
      const result = await service.classify(new Date('2010-01-01'), 'CM'); // age 16
      expect(result.inParentRequiredRange).toBe(true);
    });

    it('is not in the parent-required range once civil majority is reached', async () => {
      const result = await service.classify(new Date('2008-01-01'), 'CM'); // age 18
      expect(result.inParentRequiredRange).toBe(false);
    });
  });

  describe('assertMeetsMinimumAge', () => {
    it('rejects registration below the country minimum internship age', async () => {
      await expect(
        service.assertMeetsMinimumAge(new Date('2015-01-01'), 'CM'), // age 11
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows registration exactly at the country minimum internship age', async () => {
      await expect(
        service.assertMeetsMinimumAge(new Date('2010-01-01'), 'CM'), // age 16
      ).resolves.toBeUndefined();
    });
  });

  describe('isActionGated', () => {
    it('is never gated when the account predates the country-policy engine (no countryOfResidence)', async () => {
      const gated = await service.isActionGated(
        { dateOfBirth: new Date('2010-01-01'), countryOfResidence: null },
        MinorGatedAction.APPLICATION_SUBMIT,
      );
      expect(gated).toBe(false);
    });

    it('is gated for a minor in the parent-required range on an action listed in the policy', async () => {
      const gated = await service.isActionGated(
        { dateOfBirth: new Date('2010-01-01'), countryOfResidence: 'CM' },
        MinorGatedAction.APPLICATION_SUBMIT,
      );
      expect(gated).toBe(true);
    });

    it('is not gated for an action the country policy does not list', async () => {
      const gated = await service.isActionGated(
        { dateOfBirth: new Date('2010-01-01'), countryOfResidence: 'CM' },
        MinorGatedAction.MOBILITY,
      );
      expect(gated).toBe(false);
    });

    it('is not gated for an adult even on a listed action', async () => {
      const gated = await service.isActionGated(
        { dateOfBirth: new Date('2000-01-01'), countryOfResidence: 'CM' },
        MinorGatedAction.APPLICATION_SUBMIT,
      );
      expect(gated).toBe(false);
    });
  });

  describe('assertActionAllowed', () => {
    it('passes through untouched for an adult', async () => {
      await expect(
        service.assertActionAllowed(
          {
            id: 'u1',
            dateOfBirth: new Date('2000-01-01'),
            countryOfResidence: 'CM',
          },
          MinorGatedAction.APPLICATION_SUBMIT,
        ),
      ).resolves.toBeUndefined();
      expect(prisma.parentalLink.findFirst).not.toHaveBeenCalled();
    });

    it('blocks a gated action for a minor with no active parental link', async () => {
      prisma.parentalLink.findFirst.mockResolvedValue(null);

      await expect(
        service.assertActionAllowed(
          {
            id: 'u1',
            dateOfBirth: new Date('2010-01-01'),
            countryOfResidence: 'CM',
          },
          MinorGatedAction.APPLICATION_SUBMIT,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a gated action for a minor once an active parental link exists', async () => {
      prisma.parentalLink.findFirst.mockResolvedValue({
        id: 'pl1',
        status: ParentalLinkStatus.ACTIVE,
      });

      await expect(
        service.assertActionAllowed(
          {
            id: 'u1',
            dateOfBirth: new Date('2010-01-01'),
            countryOfResidence: 'CM',
          },
          MinorGatedAction.APPLICATION_SUBMIT,
        ),
      ).resolves.toBeUndefined();
    });

    // Comptes créés avant le moteur de règles par pays : le statut de compte porte encore
    // le signal, ne doit jamais être silencieusement perdu (CLAUDE.md §5).
    it('preserves the legacy account-status gate for pre-engine accounts awaiting consent', async () => {
      await expect(
        service.assertActionAllowed(
          {
            id: 'u1',
            dateOfBirth: null,
            countryOfResidence: null,
            status: AccountStatus.AWAITING_PARENTAL_CONSENT,
          },
          MinorGatedAction.APPLICATION_SUBMIT,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not gate a legacy account whose status is already ACTIVE', async () => {
      await expect(
        service.assertActionAllowed(
          {
            id: 'u1',
            dateOfBirth: null,
            countryOfResidence: null,
            status: AccountStatus.ACTIVE,
          },
          MinorGatedAction.APPLICATION_SUBMIT,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
