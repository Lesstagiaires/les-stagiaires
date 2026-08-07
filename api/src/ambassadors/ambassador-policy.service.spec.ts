import type { PrismaService } from '../prisma/prisma.service';
import {
  addMonths,
  AmbassadorPolicyService,
} from './ambassador-policy.service';
import {
  generateAmbassadorCode,
  normalizeAmbassadorCode,
} from './ambassador-code';

describe('AmbassadorPolicyService', () => {
  let prisma: { ambassadorPolicy: { findMany: jest.Mock } };
  let service: AmbassadorPolicyService;

  beforeEach(() => {
    prisma = {
      ambassadorPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AmbassadorPolicyService(prisma as unknown as PrismaService);
  });

  // --------------------------------------------------------------------------
  // Politique de repli. Le sens des deux défauts n'est pas symétrique, et c'est
  // délibéré : une commission non versée se verse plus tard, un virement indu ne
  // se reprend pas.
  // --------------------------------------------------------------------------
  describe('politique de repli', () => {
    it('autorise les commissions mais jamais les versements dans un pays non configuré', async () => {
      const policy = await service.resolve('ZZ');

      expect(policy.commissionsEnabled).toBe(true);
      expect(policy.payoutsEnabled).toBe(false);
    });

    it('reprend les seuils arbitrés : douze mois, alertes à neuf et onze', async () => {
      const policy = await service.resolve('ZZ');

      expect(policy.portfolioExpiryMonths).toBe(12);
      expect(policy.portfolioWarnMonths).toEqual([9, 11]);
    });
  });

  it('fait primer la politique du pays sur la politique par défaut', async () => {
    prisma.ambassadorPolicy.findMany.mockResolvedValue([
      {
        countryCode: '*',
        portfolioExpiryMonths: 12,
        portfolioWarnMonths: [9, 11],
        securityPeriodDays: 30,
        minPayoutAmountMinor: 500000,
        currency: 'XAF',
        commissionsEnabled: true,
        payoutsEnabled: false,
      },
      {
        countryCode: 'CI',
        portfolioExpiryMonths: 18,
        portfolioWarnMonths: [12, 16],
        securityPeriodDays: 45,
        minPayoutAmountMinor: 300000,
        currency: 'XOF',
        commissionsEnabled: true,
        payoutsEnabled: true,
      },
    ]);

    const policy = await service.resolve('CI');

    expect(policy.portfolioExpiryMonths).toBe(18);
    expect(policy.currency).toBe('XOF');
    expect(policy.payoutsEnabled).toBe(true);
  });
});

// ============================================================================
// Un décalage de quelques jours sur une échéance de portefeuille est minuscule —
// et impossible à expliquer à l'ambassadeur qui perd une entreprise ce jour-là.
// `setMonth` seul déborde silencieusement sur les mois courts.
// ============================================================================
describe('addMonths', () => {
  it('ne déborde jamais sur un mois plus court', () => {
    // 31 janvier + 1 mois = 28 février, jamais le 3 mars.
    expect(
      addMonths(new Date('2026-01-31'), 1).toISOString().slice(0, 10),
    ).toBe('2026-02-28');
  });

  it('gère le 29 février des années bissextiles', () => {
    expect(
      addMonths(new Date('2028-01-31'), 1).toISOString().slice(0, 10),
    ).toBe('2028-02-29');
  });

  it('ajoute douze mois sans dériver', () => {
    expect(
      addMonths(new Date('2026-07-31'), 12).toISOString().slice(0, 10),
    ).toBe('2027-07-31');
  });

  it("traverse correctement une fin d'année", () => {
    expect(
      addMonths(new Date('2026-11-15'), 3).toISOString().slice(0, 10),
    ).toBe('2027-02-15');
  });
});

// ============================================================================
// Un code d'affiliation se dicte au téléphone et se recopie depuis une affiche.
// Une confusion de caractère fait rater une attribution, donc perdre une
// commission.
// ============================================================================
describe("code d'affiliation", () => {
  it("n'utilise jamais de caractère ambigu", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateAmbassadorCode()).not.toMatch(/[IOSU0125]/);
    }
  });

  it('produit un code de six caractères', () => {
    expect(generateAmbassadorCode()).toHaveLength(6);
  });

  it("tolère ce qu'un humain tape réellement", () => {
    expect(normalizeAmbassadorCode('ls-ab3 4cd')).toBe('AB34CD');
    expect(normalizeAmbassadorCode('  AB34CD  ')).toBe('AB34CD');
    expect(normalizeAmbassadorCode('LS-AB34CD')).toBe('AB34CD');
  });
});
