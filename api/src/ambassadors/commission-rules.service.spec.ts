import type { PrismaService } from '../prisma/prisma.service';
import { CommissionRulesService } from './commission-rules.service';

type RuleOverrides = Partial<{
  id: string;
  productKey: string | null;
  ambassadorCategory: string | null;
  ambassadorTier: string | null;
  countryCode: string | null;
  campaignKey: string | null;
  minMonthlySalesCount: number | null;
  rateBasisPoints: number;
  priority: number;
  validFrom: Date;
}>;

function makeRule(overrides: RuleOverrides = {}) {
  return {
    id: 'rule',
    productKey: null,
    ambassadorCategory: null,
    ambassadorTier: null,
    countryCode: null,
    campaignKey: null,
    minMonthlySalesCount: null,
    rateBasisPoints: 1000,
    priority: 0,
    validFrom: new Date('2026-01-01'),
    ...overrides,
  };
}

const QUERY = {
  productType: 'SUBSCRIPTION' as const,
  productKey: 'CARRIERE_PLUS',
  nature: 'ACQUISITION' as const,
  ambassadorCategory: 'CAMPUS' as const,
  ambassadorTier: 'STANDARD' as const,
  countryCode: 'CM',
  at: new Date('2026-07-31'),
};

describe('CommissionRulesService', () => {
  let prisma: { commissionRule: { findMany: jest.Mock } };
  let service: CommissionRulesService;

  beforeEach(() => {
    prisma = { commissionRule: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new CommissionRulesService(
      prisma as unknown as PrismaService,
      // Le service journalise désormais les créations et remplacements de barème.
      { record: jest.fn(), recordChange: jest.fn() } as never,
    );
  });

  // --------------------------------------------------------------------------
  // Sur de l'argent, l'absence de barème doit se voir, pas se combler.
  // --------------------------------------------------------------------------
  it("ne retourne aucun taux quand aucune règle ne s'applique", async () => {
    const result = await service.resolve(QUERY);

    expect(result.rateBasisPoints).toBeNull();
    expect(result.rule).toBeNull();
    expect(result.trace.reason).toBe('AUCUNE_REGLE_APPLICABLE');
  });

  // --------------------------------------------------------------------------
  // Départage. C'est ce qui permettra d'ajouter les niveaux Bronze→Diamant ou un
  // taux par pays sans toucher au moteur : il suffira de créer une règle plus
  // spécifique, qui l'emportera d'elle-même.
  // --------------------------------------------------------------------------
  it('préfère la règle la plus spécifique à priorité égale', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      makeRule({ id: 'generique', rateBasisPoints: 1000 }),
      makeRule({
        id: 'specifique',
        productKey: 'CARRIERE_PLUS',
        countryCode: 'CM',
        rateBasisPoints: 2000,
      }),
    ]);

    const result = await service.resolve(QUERY);

    expect(result.rule?.id).toBe('specifique');
    expect(result.rateBasisPoints).toBe(2000);
  });

  it("laisse priority l'emporter sur la spécificité — c'est le levier explicite de l'administration", async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      makeRule({
        id: 'specifique-mais-basse',
        productKey: 'CARRIERE_PLUS',
        countryCode: 'CM',
        campaignKey: null,
        priority: 0,
      }),
      makeRule({ id: 'generique-prioritaire', priority: 500 }),
    ]);

    const result = await service.resolve(QUERY);

    expect(result.rule?.id).toBe('generique-prioritaire');
  });

  it('départage deux règles identiques par la plus récemment entrée en vigueur', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      makeRule({ id: 'ancienne', validFrom: new Date('2026-01-01') }),
      makeRule({ id: 'recente', validFrom: new Date('2026-06-01') }),
    ]);

    const result = await service.resolve(QUERY);

    expect(result.rule?.id).toBe('recente');
  });

  // --------------------------------------------------------------------------
  // PALIERS : construits, désactivés au lancement (décision du promoteur).
  // Les appliquer sans mesurer le volume reviendrait à payer sur une supposition.
  // --------------------------------------------------------------------------
  describe('paliers de volume', () => {
    it("écarte une règle à palier tant que le volume du mois n'est pas fourni", async () => {
      prisma.commissionRule.findMany.mockResolvedValue([
        makeRule({ id: 'palier', minMonthlySalesCount: 10 }),
      ]);

      const result = await service.resolve(QUERY);

      expect(result.rateBasisPoints).toBeNull();
      expect(result.trace.skippedTieredIds).toEqual(['palier']);
    });

    it('applique une règle à palier une fois le volume atteint', async () => {
      prisma.commissionRule.findMany.mockResolvedValue([
        makeRule({
          id: 'palier',
          minMonthlySalesCount: 10,
          rateBasisPoints: 2500,
        }),
      ]);

      const result = await service.resolve({ ...QUERY, monthlySalesCount: 12 });

      expect(result.rateBasisPoints).toBe(2500);
    });

    it('écarte une règle à palier quand le volume est insuffisant', async () => {
      prisma.commissionRule.findMany.mockResolvedValue([
        makeRule({ id: 'palier', minMonthlySalesCount: 10 }),
      ]);

      const result = await service.resolve({ ...QUERY, monthlySalesCount: 3 });

      expect(result.rateBasisPoints).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Arrondi. À l'inférieur, systématiquement : à grande échelle, l'arrondi
  // supérieur crée un passif que personne n'a décidé.
  // --------------------------------------------------------------------------
  describe('calcul du montant', () => {
    it('applique le taux en points de base', () => {
      // 2 000 FCFA (200 000 unités mineures) à 20 % = 400 FCFA.
      expect(service.computeAmountMinor(200000, 2000)).toBe(40000);
    });

    it("arrondit toujours à l'inférieur", () => {
      // 333 unités à 5 % = 16,65 → 16, jamais 17.
      expect(service.computeAmountMinor(333, 500)).toBe(16);
    });

    it('ne produit jamais de nombre à virgule', () => {
      const amount = service.computeAmountMinor(199999, 1500);
      expect(Number.isInteger(amount)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // La trace est ce qui rend un litige de commission instruisable deux ans plus
  // tard. Sans elle, « pourquoi 8 % et non 15 % ? » reste sans réponse.
  // --------------------------------------------------------------------------
  it('conserve la trace des règles candidates et du motif de choix', async () => {
    prisma.commissionRule.findMany.mockResolvedValue([
      makeRule({ id: 'a' }),
      makeRule({ id: 'b', priority: 10 }),
    ]);

    const result = await service.resolve(QUERY);

    expect(result.trace.candidateIds).toEqual(['a', 'b']);
    expect(result.trace.chosenId).toBe('b');
    expect(result.trace.reason).toContain('DEPARTAGE');
  });
});
