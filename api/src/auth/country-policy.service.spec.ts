import { NotFoundException } from '@nestjs/common';
import { MinorGatedAction } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CountryPolicyService } from './country-policy.service';

describe('CountryPolicyService', () => {
  let prisma: {
    countryPolicy: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
      delete: jest.Mock;
    };
  };
  let audit: { record: jest.Mock };
  let service: CountryPolicyService;

  beforeEach(() => {
    prisma = {
      countryPolicy: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new CountryPolicyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('resolve', () => {
    it('returns the configured policy for a country that has one', async () => {
      prisma.countryPolicy.findUnique.mockResolvedValue({
        countryCode: 'CM',
        minInternshipAge: 15,
        minParentRequiredAge: 15,
        civilMajorityAge: 21,
        gatedActions: [MinorGatedAction.APPLICATION_SUBMIT],
      });

      const result = await service.resolve('CM');

      expect(result).toEqual({
        countryCode: 'CM',
        minInternshipAge: 15,
        minParentRequiredAge: 15,
        civilMajorityAge: 21,
        gatedActions: [MinorGatedAction.APPLICATION_SUBMIT],
        isFallback: false,
      });
    });

    // CLAUDE.md §5 : jamais d'absence de protection par défaut pour un pays non configuré.
    it('falls back to the protective default policy for an unconfigured country', async () => {
      prisma.countryPolicy.findUnique.mockResolvedValue(null);

      const result = await service.resolve('ZZ');

      expect(result.isFallback).toBe(true);
      expect(result.civilMajorityAge).toBe(18);
      expect(result.gatedActions).toEqual(
        expect.arrayContaining([
          MinorGatedAction.REGISTRATION,
          MinorGatedAction.APPLICATION_SUBMIT,
          MinorGatedAction.ACCEPT_OFFER,
          MinorGatedAction.SIGN_CONVENTION,
          MinorGatedAction.MOBILITY,
          MinorGatedAction.DIGITAL_SAFE_SHARE,
        ]),
      );
    });
  });

  describe('upsert', () => {
    it('persists the policy and audits the change with the acting admin', async () => {
      prisma.countryPolicy.upsert.mockResolvedValue({ countryCode: 'SN' });

      await service.upsert('admin-1', 'SN', {
        minInternshipAge: 16,
        minParentRequiredAge: 16,
        civilMajorityAge: 18,
        parentalInfoMaxAge: 21,
        gatedActions: [MinorGatedAction.APPLICATION_SUBMIT],
      });

      expect(prisma.countryPolicy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { countryCode: 'SN' } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        'COUNTRY_POLICY_UPSERTED',
        'admin-1',
        { countryCode: 'SN' },
      );
    });
  });

  describe('remove', () => {
    it('throws when no policy exists for the country', async () => {
      prisma.countryPolicy.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-1', 'ZZ')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.countryPolicy.delete).not.toHaveBeenCalled();
    });

    it('deletes the policy and audits the removal, leaving the fallback in effect', async () => {
      prisma.countryPolicy.findUnique.mockResolvedValue({ countryCode: 'SN' });

      await service.remove('admin-1', 'SN');

      expect(prisma.countryPolicy.delete).toHaveBeenCalledWith({
        where: { countryCode: 'SN' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        'COUNTRY_POLICY_REMOVED',
        'admin-1',
        { countryCode: 'SN' },
      );
    });
  });
});
