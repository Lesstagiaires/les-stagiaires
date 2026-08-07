import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  addMonths,
  type AmbassadorPolicyService,
} from './ambassador-policy.service';
import { PortfolioService } from './portfolio.service';

const POLICY = {
  countryCode: 'CM',
  portfolioExpiryMonths: 12,
  portfolioWarnMonths: [9, 11],
  securityPeriodDays: 30,
  minPayoutAmountMinor: 500000,
  currency: 'XAF',
  commissionsEnabled: true,
  payoutsEnabled: false,
};

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    ambassadorId: 'amb-1',
    organizationId: 'org-1',
    attributedAt: new Date('2026-01-01'),
    lastConfirmedPurchaseAt: null,
    expiresAt: new Date('2027-01-01'),
    warnedAt9m: null,
    warnedAt11m: null,
    ambassador: { userId: 'user-amb' },
    organization: { name: 'Test Corp SARL', country: 'CM' },
    ...overrides,
  };
}

describe('PortfolioService', () => {
  let prisma: {
    ambassadorPortfolioEntry: { findMany: jest.Mock; update: jest.Mock };
    portfolioEvent: { create: jest.Mock };
    ambassador: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let policy: { resolve: jest.Mock };
  let service: PortfolioService;

  const notifiedTypes = () =>
    (notifications.notifyUser.mock.calls as [string, string, unknown][]).map(
      ([, type]) => type,
    );

  beforeEach(() => {
    prisma = {
      ambassadorPortfolioEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      portfolioEvent: { create: jest.fn() },
      ambassador: { findUnique: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn() };
    policy = { resolve: jest.fn().mockResolvedValue(POLICY) };

    service = new PortfolioService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      policy as unknown as AmbassadorPolicyService,
    );
  });

  // --------------------------------------------------------------------------
  // GARANTIE ANTI-FRAUDE DU DISPOSITIF (point 7 des arbitrages).
  //
  // « Aucune note. Aucun commentaire. Aucun appel déclaré. Aucun suivi manuel.
  //   Seul un achat confirmé remet le compteur à zéro. »
  //
  // Ce test échoue si quelqu'un ajoute un jour une méthode permettant à un
  // ambassadeur de repousser lui-même l'échéance de son portefeuille — ce qui
  // rouvrirait exactement la faille que cette règle ferme : entretenir une rente
  // sur un portefeuille devenu inactif.
  // --------------------------------------------------------------------------
  it("n'expose aucun moyen de prolonger un rattachement sans achat", () => {
    const surface = [
      ...Object.getOwnPropertyNames(PortfolioService.prototype),
      ...Object.keys(service),
    ];
    const suspicious = surface.filter((name) =>
      /(extend|prolong|renew|touch|refresh|note|followUp|contact)/i.test(name),
    );
    expect(suspicious).toEqual([]);
  });

  describe('libération à échéance', () => {
    it("libère un rattachement échu, le journalise et prévient l'ambassadeur", async () => {
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([
          makeEntry({ expiresAt: new Date('2026-07-01') }),
        ])
        .mockResolvedValueOnce([]);

      const result = await service.runDailySweep(new Date('2026-07-31'));

      expect(result.expired).toBe(1);
      // La perte d'un portefeuille a un effet financier direct : jamais muette.
      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_PORTFOLIO_EXPIRED',
        null,
        expect.objectContaining({
          entryId: 'entry-1',
          organizationId: 'org-1',
        }),
      );
      expect(notifiedTypes()).toContain('AMBASSADOR_PORTFOLIO_EXPIRED');
    });

    it("ne touche pas un rattachement dont l'échéance est future", async () => {
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.runDailySweep(new Date('2026-07-31'));

      expect(result.expired).toBe(0);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('alertes du compte à rebours', () => {
    it("envoie l'alerte à neuf mois sans achat", async () => {
      const attributedAt = new Date('2026-01-01');
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeEntry({ attributedAt })]);

      // Neuf mois plus tard, pas encore onze.
      await service.runDailySweep(addMonths(attributedAt, 9));

      expect(notifiedTypes()).toEqual(['AMBASSADOR_PORTFOLIO_WARNING_9M']);
    });

    // Si un balayage n'a pas tourné pendant deux mois, on annonce « il reste un
    // mois », pas « il reste trois mois » suivi de « il reste un mois » dans la
    // même nuit. Deux alertes contradictoires le même jour détruiraient la
    // confiance dans le dispositif.
    it("n'envoie que l'alerte la plus tardive atteinte", async () => {
      const attributedAt = new Date('2026-01-01');
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeEntry({ attributedAt })]);

      await service.runDailySweep(addMonths(attributedAt, 11));

      expect(notifiedTypes()).toEqual(['AMBASSADOR_PORTFOLIO_WARNING_11M']);
    });

    it('ne réémet jamais une alerte déjà envoyée', async () => {
      const attributedAt = new Date('2026-01-01');
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          makeEntry({
            attributedAt,
            warnedAt9m: new Date('2026-10-01'),
            warnedAt11m: new Date('2026-12-01'),
          }),
        ]);

      const result = await service.runDailySweep(addMonths(attributedAt, 11));

      expect(result.warned).toBe(0);
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    // L'ancrage est le dernier ACHAT confirmé, pas la date de rattachement : une
    // entreprise qui achète repart pour douze mois pleins.
    it('compte depuis le dernier achat confirmé quand il existe', async () => {
      prisma.ambassadorPortfolioEntry.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          makeEntry({
            attributedAt: new Date('2025-01-01'),
            lastConfirmedPurchaseAt: new Date('2026-06-01'),
          }),
        ]);

      // Dix-neuf mois après le rattachement, mais deux mois seulement après
      // l'achat : aucune alerte n'est due.
      const result = await service.runDailySweep(new Date('2026-08-01'));

      expect(result.warned).toBe(0);
    });
  });
});
