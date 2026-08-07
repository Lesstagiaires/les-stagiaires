import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import type { PaymentDetailsService } from './payment-details.service';
import { PayoutsService } from './payouts.service';
import type { WalletService } from './wallet.service';

const OPEN_POLICY = {
  countryCode: 'CM',
  portfolioExpiryMonths: 12,
  portfolioWarnMonths: [9, 11],
  securityPeriodDays: 30,
  minPayoutAmountMinor: 500000,
  doubleApprovalThresholdMinor: null,
  currency: 'XAF',
  commissionsEnabled: true,
  payoutsEnabled: true,
};

const READY_AMBASSADOR = {
  id: 'amb-1',
  userId: 'user-amb',
  status: 'ACTIVE',
  countryCode: 'CM',
  contractSignedAt: new Date('2026-06-01'),
  wallet: {
    id: 'wallet-1',
    currency: 'XAF',
    availableMinor: 2000000,
    reservedMinor: 1000000,
  },
};

// La demande ne porte plus que le montant : la destination est lue sur les
// coordonnées enregistrées (arbitrage 13).
const VALID_REQUEST = { amountMinor: 1000000 };

// Une demande telle qu'elle se lit en base, à l'étape voulue.
const demande = (over: Record<string, unknown> = {}) => ({
  id: 'payout-1',
  status: 'REQUESTED',
  amountMinor: 1000000,
  currency: 'XAF',
  countryCode: 'CM',
  destinationLabel: 'MTN MoMo — Titulaire A 677123456',
  requiresSecondApproval: false,
  validatedById: null,
  secondApprovalById: null,
  executionReference: null,
  ambassadorId: 'amb-1',
  ambassador: { userId: 'user-amb' },
  ...over,
});

const NOTE = 'Contrôle effectué, pièces vérifiées auprès du service comptable.';

describe('PayoutsService', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock };
    payoutRequest: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    payoutEvent: { create: jest.Mock; findMany: jest.Mock };
    ambassadorWallet: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let wallet: {
    reserveForPayout: jest.Mock;
    executePayout: jest.Mock;
    releaseReservation: jest.Mock;
  };
  let policy: { resolve: jest.Mock };
  let paymentDetails: {
    resolveForPayout: jest.Mock;
    blockingReasons: jest.Mock;
  };
  // Chiffrement simulé : un préfixe suffit à distinguer le chiffré du clair, et
  // les tests peuvent ainsi vérifier que la BONNE forme est écrite où il faut.
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let service: PayoutsService;

  beforeEach(() => {
    prisma = {
      ambassador: { findUnique: jest.fn().mockResolvedValue(READY_AMBASSADOR) },
      payoutRequest: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'payout-1', ...args.data }),
        ),
        findUnique: jest.fn(),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'payout-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payoutEvent: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ambassadorWallet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
          callback(prisma),
        ),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn() };
    wallet = {
      reserveForPayout: jest.fn(),
      executePayout: jest.fn(),
      releaseReservation: jest.fn(),
    };
    policy = { resolve: jest.fn().mockResolvedValue(OPEN_POLICY) };
    // La destination vient des coordonnées ENREGISTRÉES, jamais de la demande.
    paymentDetails = {
      resolveForPayout: jest.fn().mockResolvedValue({
        method: 'MOBILE_MONEY',
        destinationLabel: 'MTN MoMo — Titulaire A 677123456',
      }),
      // Aucun blocage par défaut : délai écoulé, aucun signalement.
      blockingReasons: jest.fn().mockResolvedValue([]),
    };
    encryption = {
      encrypt: jest.fn((clair: string) => 'v1.chiffre.' + clair),
      decrypt: jest.fn((chiffre: string) => chiffre.replace('v1.chiffre.', '')),
    };

    service = new PayoutsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      wallet as unknown as WalletService,
      policy as unknown as AmbassadorPolicyService,
      paymentDetails as unknown as PaymentDetailsService,
      encryption as unknown as FieldEncryptionService,
    );
  });

  const eventsOf = () =>
    (prisma.payoutEvent.create.mock.calls as unknown[][]).map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );

  const updateData = () =>
    (
      (prisma.payoutRequest.update.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --------------------------------------------------------------------------
  // VERROU 1 — le Contrat d'Apporteur d'Affaires.
  //
  // « Le premier paiement réel de commission dans un pays donné n'intervient
  //   qu'après signature, par l'ambassadeur concerné, du Contrat d'Apporteur
  //   d'Affaires. » Le verrou est porté par un fait vérifiable (une date de
  //   signature), jamais par une case à cocher.
  // --------------------------------------------------------------------------
  it("refuse toute demande tant que le contrat d'apporteur d'affaires n'est pas signé", async () => {
    prisma.ambassador.findUnique.mockResolvedValue({
      ...READY_AMBASSADOR,
      contractSignedAt: null,
    });

    await expect(service.request('user-amb', VALID_REQUEST)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.payoutRequest.create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // VERROU 2 — l'ouverture du pays. Défaut : fermé.
  // --------------------------------------------------------------------------
  it('refuse toute demande tant que les versements ne sont pas ouverts dans le pays', async () => {
    policy.resolve.mockResolvedValue({ ...OPEN_POLICY, payoutsEnabled: false });

    await expect(service.request('user-amb', VALID_REQUEST)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.payoutRequest.create).not.toHaveBeenCalled();
  });

  it('refuse un ambassadeur suspendu', async () => {
    prisma.ambassador.findUnique.mockResolvedValue({
      ...READY_AMBASSADOR,
      status: 'SUSPENDED',
    });

    await expect(service.request('user-amb', VALID_REQUEST)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuse un montant inférieur au minimum configuré', async () => {
    await expect(
      service.request('user-amb', { ...VALID_REQUEST, amountMinor: 1000 }),
    ).rejects.toThrow(BadRequestException);
  });

  // Sans immobilisation, deux demandes successives pourraient chacune porter sur
  // la totalité du solde, et être payées toutes les deux.
  it('immobilise immédiatement le montant demandé', async () => {
    await service.request('user-amb', VALID_REQUEST);

    expect(wallet.reserveForPayout).toHaveBeenCalledWith(
      expect.anything(),
      'wallet-1',
      1000000,
      'payout-1',
    );
  });

  // --------------------------------------------------------------------------
  // LE SEUIL DE DOUBLE CONTRÔLE — figé à la demande.
  // --------------------------------------------------------------------------
  describe('seuil de double contrôle', () => {
    it('aucun seuil configuré : une seule approbation suffit', async () => {
      const created = await service.request('user-amb', VALID_REQUEST);
      expect(created.requiresSecondApproval).toBe(false);
    });

    it('au-dessus du seuil : deux approbations exigées', async () => {
      policy.resolve.mockResolvedValue({
        ...OPEN_POLICY,
        doubleApprovalThresholdMinor: 500000,
      });

      const created = await service.request('user-amb', VALID_REQUEST); // 1 000 000
      expect(created.requiresSecondApproval).toBe(true);
    });

    it('à hauteur du seuil exactement : une seule suffit', async () => {
      policy.resolve.mockResolvedValue({
        ...OPEN_POLICY,
        doubleApprovalThresholdMinor: 1000000,
      });

      const created = await service.request('user-amb', VALID_REQUEST);
      // Un seuil de 1 000 000 autorise 1 000 000. Le contrôle renforcé se
      // déclenche au-delà, pas à hauteur.
      expect(created.requiresSecondApproval).toBe(false);
    });

    // Le besoin est FIGÉ à la demande : relire le seuil à l'approbation ferait
    // qu'en le relevant demain on s'affranchirait d'un double contrôle déjà requis.
    it('le besoin figé à la demande fait foi, pas le seuil du jour', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'UNDER_REVIEW', requiresSecondApproval: true }),
      );
      policy.resolve.mockResolvedValue({
        ...OPEN_POLICY,
        doubleApprovalThresholdMinor: 999999999,
      });

      const updated = await service.validate('admin-1', 'payout-1', {
        internalNote: NOTE,
      });
      expect(updated.status).toBe('AWAITING_SECOND_APPROVAL');
    });
  });

  // --------------------------------------------------------------------------
  // LE CYCLE EN SIX ÉTAPES — chaque étape n'accepte que l'état qui la précède.
  // --------------------------------------------------------------------------
  describe('ordre des étapes', () => {
    it('le contrôle n’accepte qu’une demande fraîche', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'VALIDATED' }),
      );
      await expect(
        service.review('admin-1', 'payout-1', { internalNote: NOTE }),
      ).rejects.toThrow(ConflictException);
    });

    it('la validation exige que le contrôle ait eu lieu', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());
      await expect(
        service.validate('admin-1', 'payout-1', { internalNote: NOTE }),
      ).rejects.toThrow(ConflictException);
    });

    it("l'exécution exige une demande validée", async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'UNDER_REVIEW' }),
      );
      await expect(
        service.execute('admin-2', 'payout-1', {
          executionReference: 'VIR-42',
        }),
      ).rejects.toThrow(ConflictException);
      expect(wallet.executePayout).not.toHaveBeenCalled();
    });

    it('la confirmation exige un virement déjà ordonné', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'VALIDATED' }),
      );
      await expect(
        service.confirm('admin-2', 'payout-1', { internalNote: NOTE }),
      ).rejects.toThrow(ConflictException);
      expect(wallet.executePayout).not.toHaveBeenCalled();
    });

    it('un virement déjà ordonné ne se rejette plus — il se confirme ou il échoue', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'EXECUTING' }),
      );
      await expect(
        service.reject('admin-1', 'payout-1', {
          reason: 'Décision tardive de l’administration.',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  // LA SÉPARATION DES POUVOIRS
  //
  // « Une même personne ne doit pas pouvoir, seule, approuver puis exécuter le
  //   même paiement. » — arbitrage 12 du promoteur, 2026-08-02.
  // --------------------------------------------------------------------------
  describe('séparation des pouvoirs', () => {
    it('celui qui a approuvé ne peut pas exécuter', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'VALIDATED', validatedById: 'admin-1' }),
      );

      await expect(
        service.execute('admin-1', 'payout-1', {
          executionReference: 'VIR-42',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(wallet.executePayout).not.toHaveBeenCalled();
    });

    it('celui qui a contresigné ne peut pas exécuter non plus', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({
          status: 'VALIDATED',
          validatedById: 'admin-1',
          secondApprovalById: 'admin-2',
        }),
      );

      await expect(
        service.execute('admin-2', 'payout-1', {
          executionReference: 'VIR-42',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('un troisième administrateur, lui, peut exécuter', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({
          status: 'VALIDATED',
          validatedById: 'admin-1',
          secondApprovalById: 'admin-2',
        }),
      );

      const updated = await service.execute('admin-3', 'payout-1', {
        executionReference: 'VIR-42',
      });
      expect(updated.status).toBe('EXECUTING');
      expect(updated.executedById).toBe('admin-3');
    });

    it('le double contrôle exige une SECONDE personne', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({
          status: 'AWAITING_SECOND_APPROVAL',
          requiresSecondApproval: true,
          validatedById: 'admin-1',
        }),
      );

      // La même signature apposée deux fois n'est pas un double contrôle.
      await expect(
        service.secondApproval('admin-1', 'payout-1', { internalNote: NOTE }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // --------------------------------------------------------------------------
  // LE DÉPLACEMENT QUI COMPTE : l'écriture au grand livre passe de l'exécution à
  // la confirmation. Un virement ordonné n'est pas un virement arrivé.
  // --------------------------------------------------------------------------
  describe('le grand livre n’enregistre qu’une sortie confirmée', () => {
    it('ordonner un virement n’écrit RIEN au grand livre', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'VALIDATED', validatedById: 'admin-1' }),
      );

      await service.execute('admin-2', 'payout-1', {
        executionReference: 'VIR-42',
      });

      // Le montant reste immobilisé : ni sorti, ni redevenu disponible.
      expect(wallet.executePayout).not.toHaveBeenCalled();
      expect(wallet.releaseReservation).not.toHaveBeenCalled();
    });

    it('la confirmation, elle, porte la sortie au grand livre', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({
          status: 'EXECUTING',
          validatedById: 'admin-1',
          executionReference: 'VIR-42',
        }),
      );

      await service.confirm('admin-2', 'payout-1', { internalNote: NOTE });

      expect(wallet.executePayout).toHaveBeenCalledWith(
        expect.anything(),
        'wallet-1',
        1000000,
        'payout-1',
        'admin-2',
      );
    });

    it('un échec rend le montant au disponible — l’argent reste dû', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'EXECUTING', executionReference: 'VIR-42' }),
      );

      await service.fail('admin-2', 'payout-1', {
        internalNote:
          'Compte destinataire clos chez l’opérateur, virement rejeté.',
        reasonCode: 'PAYMENT_DETAILS_INVALID',
      });

      expect(wallet.releaseReservation).toHaveBeenCalledWith(
        expect.anything(),
        'wallet-1',
        1000000,
        'payout-1',
        'PAYMENT_DETAILS_INVALID',
      );
      // Aucune sortie à contre-passer : rien n'était jamais sorti.
      expect(wallet.executePayout).not.toHaveBeenCalled();
    });

    // Un rejet n'est pas une sanction financière : l'argent reste dû.
    it('rend le montant immobilisé au disponible en cas de rejet', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());

      await service.reject('admin-1', 'payout-1', {
        reason: 'Coordonnées de versement incomplètes',
      });

      expect(wallet.releaseReservation).toHaveBeenCalledWith(
        expect.anything(),
        'wallet-1',
        1000000,
        'payout-1',
        'Coordonnées de versement incomplètes',
      );
    });
  });

  // --------------------------------------------------------------------------
  // LE JOURNAL — « chaque étape doit enregistrer : l'auteur ; la date ; le
  // montant ; la devise ; la destination masquée ; la référence ; le statut ; le
  // motif lorsqu'il y a refus ou échec ».
  // --------------------------------------------------------------------------
  describe('journal des versements', () => {
    it('la demande est journalisée avec son auteur et son montant', async () => {
      await service.request('user-amb', VALID_REQUEST);

      const [event] = eventsOf();
      expect(event.type).toBe('REQUESTED');
      expect(event.status).toBe('REQUESTED');
      expect(event.actorId).toBe('user-amb');
      expect(event.amountMinor).toBe(1000000);
      expect(event.currency).toBe('XAF');
    });

    // LA GARANTIE STRUCTURELLE : le masquage est appliqué à l'ÉCRITURE, par la
    // seule porte d'accès au journal. Il ne peut pas être oublié à un appel.
    it('le numéro complet n’entre JAMAIS au journal', async () => {
      await service.request('user-amb', VALID_REQUEST);

      const [event] = eventsOf();
      expect(event.destinationMasked).toBe('MTN MoMo — Titulaire A ••••3456');
      expect(JSON.stringify(event)).not.toContain('677123456');
    });

    it('la référence du virement est journalisée à l’exécution', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'VALIDATED', validatedById: 'admin-1' }),
      );

      await service.execute('admin-2', 'payout-1', {
        executionReference: 'VIR-42',
      });

      const [event] = eventsOf();
      expect(event.type).toBe('EXECUTION_ORDERED');
      expect(event.reference).toBe('VIR-42');
      expect(event.actorId).toBe('admin-2');
    });

    it('un échec journalise son CODE de motif et sa note interne', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'EXECUTING', executionReference: 'VIR-42' }),
      );

      await service.fail('admin-2', 'payout-1', {
        internalNote: 'Compte destinataire clos, à vérifier avec l’intéressé.',
        reasonCode: 'PAYMENT_DETAILS_INVALID',
      });

      const [event] = eventsOf();
      expect(event.reasonCode).toBe('PAYMENT_DETAILS_INVALID');
      expect(event.internalNote).toBe(
        'Compte destinataire clos, à vérifier avec l’intéressé.',
      );
    });

    it('la notification d’échec porte le CODE, jamais la note interne', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'EXECUTING' }),
      );

      await service.fail('admin-2', 'payout-1', {
        internalNote: 'Soupçon de compte prête-nom, dossier signalé.',
        reasonCode: 'PAYMENT_DETAILS_INVALID',
      });

      const [, , metadata] = (
        notifications.notifyUser.mock.calls as unknown[][]
      )[0] as [string, string, Record<string, unknown>];
      expect(metadata.reasonCode).toBe('PAYMENT_DETAILS_INVALID');
      expect(JSON.stringify(metadata)).not.toContain('prête-nom');
    });
  });

  // --------------------------------------------------------------------------
  // LE CONTRÔLE (étape 2) — il constate, il ne bloque pas.
  // --------------------------------------------------------------------------
  describe('contrôle', () => {
    it('ne relève rien quand tout est en ordre', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());

      const result = await service.review('admin-1', 'payout-1', {
        internalNote: NOTE,
      });
      expect(result.findings).toEqual([]);
      expect(updateData().status).toBe('UNDER_REVIEW');
    });

    it('relève un ambassadeur devenu inactif depuis la demande', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());
      prisma.ambassador.findUnique.mockResolvedValue({
        ...READY_AMBASSADOR,
        status: 'SUSPENDED',
      });

      const result = await service.review('admin-1', 'payout-1', {
        internalNote: NOTE,
      });
      expect(result.findings).toContainEqual(
        expect.stringContaining('non actif'),
      );
      // Il CONSTATE et laisse passer : bloquer ici ferait disparaître la
      // décision — et avec elle le nom de celui qui l'a prise.
      expect(updateData().status).toBe('UNDER_REVIEW');
    });

    it('relève un pays refermé depuis la demande', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());
      policy.resolve.mockResolvedValue({
        ...OPEN_POLICY,
        payoutsEnabled: false,
      });

      const result = await service.review('admin-1', 'payout-1', {
        internalNote: NOTE,
      });
      expect(result.findings).toContainEqual(
        expect.stringContaining('Versements fermés'),
      );
    });

    it('relève un montant qui n’est plus immobilisé', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(demande());
      prisma.ambassador.findUnique.mockResolvedValue({
        ...READY_AMBASSADOR,
        wallet: { ...READY_AMBASSADOR.wallet, reservedMinor: 0 },
      });

      const result = await service.review('admin-1', 'payout-1', {
        internalNote: NOTE,
      });
      expect(result.findings).toContainEqual(
        expect.stringContaining('immobilisé insuffisant'),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Ce que l'ambassadeur apprend, et quand.
  // --------------------------------------------------------------------------
  describe('notifications', () => {
    it('une approbation en attente de contresignature ne lui est PAS annoncée', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'UNDER_REVIEW', requiresSecondApproval: true }),
      );

      await service.validate('admin-1', 'payout-1', { internalNote: NOTE });

      // Lui promettre un virement que personne n'a fini d'autoriser serait une
      // promesse en l'air.
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it('la contresignature, elle, déclenche l’annonce', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({
          status: 'AWAITING_SECOND_APPROVAL',
          requiresSecondApproval: true,
          validatedById: 'admin-1',
        }),
      );

      await service.secondApproval('admin-2', 'payout-1', {
        internalNote: NOTE,
      });

      const [, type] = (
        notifications.notifyUser.mock.calls as unknown[][]
      )[0] as [string, string];
      expect(type).toBe('AMBASSADOR_PAYOUT_VALIDATED');
    });

    it('sans double contrôle, une seule approbation suffit à l’annoncer', async () => {
      prisma.payoutRequest.findUnique.mockResolvedValue(
        demande({ status: 'UNDER_REVIEW' }),
      );

      await service.validate('admin-1', 'payout-1', { internalNote: NOTE });
      expect(notifications.notifyUser).toHaveBeenCalled();
    });
  });
});
