import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import type { CommissionCapsService } from './commission-caps.service';
import type { CommissionRulesService } from './commission-rules.service';
import { CommissionsService } from './commissions.service';
import type { WalletService } from './wallet.service';

// ============================================================================
// Ces tests visent les chemins de SÉCURITÉ, pas le cas nominal. Chacun d'eux
// correspond à une règle arrêtée par le promoteur qu'un défaut de code pourrait
// contourner en silence, et dont la violation coûterait de l'argent.
// ============================================================================
describe('CommissionsService', () => {
  let prisma: {
    payment: { findUnique: jest.Mock; findMany: jest.Mock };
    commission: { findUnique: jest.Mock; create: jest.Mock };
    commissionEvent: { create: jest.Mock };
    ambassadorPortfolioEntry: { findFirst: jest.Mock; update: jest.Mock };
    ambassadorReferral: { findUnique: jest.Mock };
    portfolioEvent: { create: jest.Mock };
    organization: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock; notifyAdmins: jest.Mock };
  let rules: { resolve: jest.Mock; computeAmountMinor: jest.Mock };
  let wallet: { accrue: jest.Mock };
  let policy: { resolve: jest.Mock };
  let caps: { evaluate: jest.Mock };
  let service: CommissionsService;

  const CONFIRMED_PAYMENT = {
    id: 'pay-1',
    status: 'CONFIRMED',
    amountMinor: 200000,
    currency: 'XAF',
    countryCode: 'CM',
    providerConfirmedAt: new Date('2026-07-31T10:00:00Z'),
    subscription: {
      id: 'sub-1',
      plan: 'CARRIERE_SECURISEE',
      beneficiaryUserId: 'user-buyer',
      beneficiaryOrganizationId: null,
      initiatingOrganizationId: null,
    },
  };

  const ACTIVE_AMBASSADOR = {
    id: 'amb-1',
    userId: 'user-ambassador',
    status: 'ACTIVE',
    tier: 'STANDARD',
  };

  const auditReasons = () =>
    (audit.record.mock.calls as [string, unknown, Record<string, unknown>][])
      .map(([action, , metadata]) => metadata?.reason ?? action)
      .filter(Boolean);

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(CONFIRMED_PAYMENT),
        findMany: jest.fn().mockResolvedValue([]),
      },
      commission: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'com-1' }),
      },
      commissionEvent: { create: jest.fn() },
      ambassadorPortfolioEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      ambassadorReferral: { findUnique: jest.fn().mockResolvedValue(null) },
      portfolioEvent: { create: jest.fn() },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
          callback(prisma),
        ),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn(), notifyAdmins: jest.fn() };
    rules = {
      resolve: jest.fn().mockResolvedValue({
        rule: { id: 'rule-1' },
        rateBasisPoints: 2000,
        trace: {},
      }),
      computeAmountMinor: jest.fn().mockReturnValue(40000),
    };
    wallet = { accrue: jest.fn() };
    // Aucun plafond configuré : le verdict par défaut ne retient rien. Les tests
    // de plafond vivent dans commission-caps.service.spec.ts.
    caps = {
      evaluate: jest.fn().mockResolvedValue({ exceeded: false, trace: [] }),
    };
    policy = {
      resolve: jest.fn().mockResolvedValue({
        countryCode: 'CM',
        portfolioExpiryMonths: 12,
        portfolioWarnMonths: [9, 11],
        securityPeriodDays: 30,
        minPayoutAmountMinor: 500000,
        currency: 'XAF',
        commissionsEnabled: true,
        payoutsEnabled: false,
      }),
    };

    service = new CommissionsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      rules as unknown as CommissionRulesService,
      wallet as unknown as WalletService,
      policy as unknown as AmbassadorPolicyService,
      caps as unknown as CommissionCapsService,
    );
  });

  // --------------------------------------------------------------------------
  // « Pas d'achat = pas de commission » — la règle fondatrice.
  // --------------------------------------------------------------------------
  describe('aucune commission sans paiement confirmé', () => {
    it("ne crée rien si le paiement n'est pas au statut CONFIRMED", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...CONFIRMED_PAYMENT,
        status: 'INITIATED',
      });

      await service.onPaymentConfirmed('pay-1');

      expect(prisma.commission.create).not.toHaveBeenCalled();
    });

    it("ne crée rien si le paiement n'existe pas", async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await service.onPaymentConfirmed('inconnu');
      expect(prisma.commission.create).not.toHaveBeenCalled();
    });

    // Un prestataire de paiement peut rejouer son webhook. La contrainte d'unicité
    // sur paymentId protège en base ; ce test protège en amont.
    it('reste idempotent si une commission existe déjà pour ce paiement', async () => {
      prisma.commission.findUnique.mockResolvedValue({ id: 'com-existante' });
      await service.onPaymentConfirmed('pay-1');
      expect(prisma.commission.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Attribution : seul un fait enregistré ouvre droit.
  // --------------------------------------------------------------------------
  describe('aucune commission sans attribution valide', () => {
    it("ne crée rien quand aucun parrainage ni rattachement n'existe", async () => {
      await service.onPaymentConfirmed('pay-1');
      expect(prisma.commission.create).not.toHaveBeenCalled();
    });

    // GARDE-FOU DU POINT 9 : la réponse à « Comment avez-vous connu LES
    // STAGIAIRES ? » ne doit JAMAIS déclencher de commission. Ce test échoue si
    // quelqu'un branche un jour acquisitionSource sur le calcul.
    it('ne consulte jamais acquisitionSource pour attribuer une commission', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...CONFIRMED_PAYMENT,
        subscription: {
          ...CONFIRMED_PAYMENT.subscription,
          beneficiaryUserId: null,
          beneficiaryOrganizationId: 'org-1',
        },
      });
      // L'organisation déclare avoir connu la plateforme par un ambassadeur...
      prisma.organization.findUnique.mockResolvedValue({
        ownerId: 'user-autre',
        acquisitionSource: 'AMBASSADOR',
      });
      // ... mais aucun rattachement réel n'existe.
      prisma.ambassadorPortfolioEntry.findFirst.mockResolvedValue(null);

      await service.onPaymentConfirmed('pay-1');

      expect(prisma.commission.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Auto-parrainage : sans ce contrôle, le barème de 20 % deviendrait une remise
  // de 20 % que n'importe qui pourrait s'accorder en devenant ambassadeur.
  // --------------------------------------------------------------------------
  describe("interdiction de l'auto-parrainage", () => {
    it('bloque la commission sur son propre abonnement', async () => {
      prisma.ambassadorReferral.findUnique.mockResolvedValue({
        id: 'ref-1',
        ambassador: ACTIVE_AMBASSADOR,
      });
      prisma.payment.findUnique.mockResolvedValue({
        ...CONFIRMED_PAYMENT,
        subscription: {
          ...CONFIRMED_PAYMENT.subscription,
          // Le bénéficiaire EST l'ambassadeur.
          beneficiaryUserId: ACTIVE_AMBASSADOR.userId,
        },
      });

      await service.onPaymentConfirmed('pay-1');

      expect(prisma.commission.create).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_SELF_REFERRAL_BLOCKED',
        null,
        expect.anything(),
      );
    });

    it("bloque la commission sur une organisation dont l'ambassadeur est propriétaire", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...CONFIRMED_PAYMENT,
        subscription: {
          ...CONFIRMED_PAYMENT.subscription,
          beneficiaryUserId: null,
          beneficiaryOrganizationId: 'org-1',
        },
      });
      prisma.ambassadorPortfolioEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
        ambassador: ACTIVE_AMBASSADOR,
      });
      prisma.organization.findUnique.mockResolvedValue({
        ownerId: ACTIVE_AMBASSADOR.userId,
      });

      await service.onPaymentConfirmed('pay-1');

      expect(prisma.commission.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Le compteur du portefeuille suit l'ACHAT, jamais la commission.
  //
  // C'est le point le plus facile à casser par mégarde : placer la remise à zéro
  // après les contrôles ferait perdre une entreprise à un ambassadeur pour une
  // raison sans rapport avec son activité commerciale.
  // --------------------------------------------------------------------------
  describe('remise à zéro du compte à rebours de portefeuille', () => {
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue({
        ...CONFIRMED_PAYMENT,
        subscription: {
          ...CONFIRMED_PAYMENT.subscription,
          beneficiaryUserId: null,
          beneficiaryOrganizationId: 'org-1',
        },
      });
      prisma.organization.findUnique.mockResolvedValue({
        ownerId: 'user-autre',
      });
    });

    it("repousse l'échéance même quand l'ambassadeur est suspendu", async () => {
      prisma.ambassadorPortfolioEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
        ambassador: { ...ACTIVE_AMBASSADOR, status: 'SUSPENDED' },
      });

      await service.onPaymentConfirmed('pay-1');

      // Aucune commission — mais le rattachement, lui, est préservé.
      expect(prisma.commission.create).not.toHaveBeenCalled();

      const [[reset]] = prisma.ambassadorPortfolioEntry.update.mock.calls as [
        [{ where: { id: string }; data: Record<string, unknown> }],
      ];
      expect(reset.where.id).toBe('entry-1');
      expect(reset.data.lastConfirmedPurchaseAt).toBeInstanceOf(Date);
      // Les alertes déjà envoyées sont effacées : un nouveau cycle doit pouvoir
      // en émettre de nouvelles.
      expect(reset.data.warnedAt9m).toBeNull();
      expect(reset.data.warnedAt11m).toBeNull();
    });

    it("repousse l'échéance même quand aucun barème ne s'applique", async () => {
      prisma.ambassadorPortfolioEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
        ambassador: ACTIVE_AMBASSADOR,
      });
      rules.resolve.mockResolvedValue({
        rule: null,
        rateBasisPoints: null,
        trace: {},
      });

      await service.onPaymentConfirmed('pay-1');

      expect(prisma.commission.create).not.toHaveBeenCalled();
      expect(prisma.ambassadorPortfolioEntry.update).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Sur de l'argent, l'absence de barème est une question à poser, pas un trou à
  // combler par une valeur plausible.
  // --------------------------------------------------------------------------
  it("n'invente jamais de taux quand aucune règle ne s'applique", async () => {
    prisma.ambassadorReferral.findUnique.mockResolvedValue({
      id: 'ref-1',
      ambassador: ACTIVE_AMBASSADOR,
    });
    rules.resolve.mockResolvedValue({
      rule: null,
      rateBasisPoints: null,
      trace: {},
    });

    await service.onPaymentConfirmed('pay-1');

    expect(prisma.commission.create).not.toHaveBeenCalled();
    expect(auditReasons()).toContain('AMBASSADOR_COMMISSION_NO_RULE');
  });

  it('respecte la coupure des commissions par pays', async () => {
    prisma.ambassadorReferral.findUnique.mockResolvedValue({
      id: 'ref-1',
      ambassador: ACTIVE_AMBASSADOR,
    });
    policy.resolve.mockResolvedValue({
      countryCode: 'CM',
      portfolioExpiryMonths: 12,
      portfolioWarnMonths: [9, 11],
      securityPeriodDays: 30,
      minPayoutAmountMinor: 500000,
      currency: 'XAF',
      commissionsEnabled: false,
      payoutsEnabled: false,
    });

    await service.onPaymentConfirmed('pay-1');

    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Cas nominal, et surtout : ce qui est FIGÉ dans la ligne créée.
  // --------------------------------------------------------------------------
  it('fige le taux et les montants au moment du calcul', async () => {
    prisma.ambassadorReferral.findUnique.mockResolvedValue({
      id: 'ref-1',
      ambassador: ACTIVE_AMBASSADOR,
    });

    await service.onPaymentConfirmed('pay-1');

    const [[call]] = prisma.commission.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(call.data).toMatchObject({
      ambassadorId: 'amb-1',
      paymentId: 'pay-1',
      status: 'PENDING',
      referralId: 'ref-1',
      portfolioEntryId: null,
      basisAmountMinor: 200000,
      rateBasisPoints: 2000,
      amountMinor: 40000,
      currency: 'XAF',
    });
    // La commission naît EN ATTENTE, jamais directement disponible.
    expect(call.data.securityPeriodEndsAt).toBeInstanceOf(Date);
    expect(wallet.accrue).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // La nature se déduit de l'historique : personne ne peut requalifier un
  // renouvellement à 5 % en acquisition à 15 %.
  // --------------------------------------------------------------------------
  describe('nature de la vente déduite, jamais déclarée', () => {
    beforeEach(() => {
      prisma.ambassadorReferral.findUnique.mockResolvedValue({
        id: 'ref-1',
        ambassador: ACTIVE_AMBASSADOR,
      });
    });

    it('classe un premier achat en ACQUISITION', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.onPaymentConfirmed('pay-1');
      expect(rules.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ nature: 'ACQUISITION' }),
      );
    });

    it('classe un rachat du même produit en RENEWAL', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { subscription: { plan: 'CARRIERE_SECURISEE' } },
      ]);
      await service.onPaymentConfirmed('pay-1');
      expect(rules.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ nature: 'RENEWAL' }),
      );
    });

    it("classe l'achat d'un autre produit en NEW_SERVICE", async () => {
      prisma.payment.findMany.mockResolvedValue([
        { subscription: { plan: 'CARRIERE_PLUS' } },
      ]);
      await service.onPaymentConfirmed('pay-1');
      expect(rules.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ nature: 'NEW_SERVICE' }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // PLAFONDS — arbitrage 15 du promoteur : « le dépassement ne doit pas
  // entraîner une réduction silencieuse ».
  // --------------------------------------------------------------------------
  describe('plafond franchi', () => {
    beforeEach(() => {
      prisma.ambassadorReferral.findUnique.mockResolvedValue({
        id: 'ref-1',
        ambassador: ACTIVE_AMBASSADOR,
      });
      caps.evaluate.mockResolvedValue({
        exceeded: true,
        trace: [
          {
            capId: 'cap-1',
            label: 'Journalier',
            window: 'DAY',
            limitMinor: 30000,
            consumedMinor: 0,
            candidateMinor: 40000,
            totalMinor: 40000,
            exceeded: true,
          },
        ],
      });
    });

    const createdData = () => {
      const calls = prisma.commission.create.mock.calls as unknown[][];
      return (calls[0][0] as { data: Record<string, unknown> }).data;
    };

    it('crée la commission POUR SON MONTANT COMPLET, en contrôle', async () => {
      await service.onPaymentConfirmed('pay-1');

      // 40 000 face à un plafond de 30 000. Le montant n'est pas ramené à
      // 30 000 : c'est très exactement ce que le promoteur a interdit.
      expect(createdData().amountMinor).toBe(40000);
      expect(createdData().status).toBe('REVIEW_REQUIRED');
      expect(createdData().reviewReason).toBe('CAP_EXCEEDED');
    });

    it('ne crédite RIEN au portefeuille', async () => {
      await service.onPaymentConfirmed('pay-1');

      // Créditer puis reprendre en cas de correction ferait apparaître un solde
      // qu'on retirerait ensuite, et laisserait deux écritures au grand livre
      // pour un fait qui n'a jamais eu lieu.
      expect(wallet.accrue).not.toHaveBeenCalled();
    });

    it('conserve la trace d’évaluation des plafonds', async () => {
      await service.onPaymentConfirmed('pay-1');

      const trace = createdData().capTrace as { capId: string }[];
      expect(trace[0].capId).toBe('cap-1');
    });

    it('prévient l’administration, pas l’ambassadeur', async () => {
      await service.onPaymentConfirmed('pay-1');

      // Lui annoncer une commission qui peut encore être corrigée ou annulée,
      // ce serait promettre une somme que personne n'a validée.
      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        'AMBASSADOR_COMMISSION_REVIEW_REQUIRED',
        expect.objectContaining({ commissionId: 'com-1' }),
      );
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('inscrit l’évènement REVIEW_REQUIRED au journal de la commission', async () => {
      await service.onPaymentConfirmed('pay-1');

      const types = (
        prisma.commissionEvent.create.mock.calls as [
          { data: { type: string } },
        ][]
      ).map(([args]) => args.data.type);
      expect(types).toEqual(['CREATED', 'REVIEW_REQUIRED']);
    });
  });

  describe('aucun plafond franchi', () => {
    it('la commission suit le circuit normal et le portefeuille est crédité', async () => {
      prisma.ambassadorReferral.findUnique.mockResolvedValue({
        id: 'ref-1',
        ambassador: ACTIVE_AMBASSADOR,
      });

      await service.onPaymentConfirmed('pay-1');

      const calls = prisma.commission.create.mock.calls as unknown[][];
      const data = (calls[0][0] as { data: Record<string, unknown> }).data;
      expect(data.status).toBe('PENDING');
      expect(data.reviewReason).toBeNull();
      expect(wallet.accrue).toHaveBeenCalled();
      expect(notifications.notifyUser).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Un incident de commission ne doit jamais faire échouer un encaissement.
  // --------------------------------------------------------------------------
  it("n'échoue jamais bruyamment et journalise l'incident", async () => {
    prisma.payment.findUnique.mockRejectedValue(new Error('base indisponible'));

    await expect(service.onPaymentConfirmed('pay-1')).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      'AMBASSADOR_COMMISSION_FAILED',
      null,
      expect.objectContaining({ paymentId: 'pay-1' }),
    );
  });
});
