import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AmbassadorPolicyService } from './ambassador-policy.service';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import { PaymentDetailsService } from './payment-details.service';

// ============================================================================
// COORDONNÉES DE VERSEMENT ET DÉLAI DE REFROIDISSEMENT
// Arbitrage 13 du promoteur, 2026-08-02.
//
// LE SCÉNARIO CONTRE LEQUEL TOUT CECI EXISTE : quelqu'un prend la main sur le
// compte d'un ambassadeur, remplace le numéro Mobile Money par le sien, et
// demande un versement. Le délai lui retire la seule chose dont il a besoin —
// la vitesse ; l'alerte donne au titulaire la seule chose dont il a besoin —
// savoir.
// ============================================================================
describe('Coordonnées de versement', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock };
    ambassadorPaymentDetail: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    ambassadorPaymentDetailEvent: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock; notifyAdmins: jest.Mock };
  let policy: { resolve: jest.Mock };
  let encryption: {
    encrypt: jest.Mock;
    decrypt: jest.Mock;
    keyIdOf: jest.Mock;
  };
  let service: PaymentDetailsService;

  const AMBASSADEUR = {
    id: 'amb-1',
    userId: 'user-amb',
    status: 'ACTIVE',
    countryCode: 'CM',
  };

  const COORDONNEES = {
    id: 'pd-1',
    ambassadorId: 'amb-1',
    method: 'MOBILE_MONEY',
    // Le CHIFFRÉ et le MASQUÉ côte à côte, comme en base. Le chiffrement simulé
    // conserve le clair après un préfixe : les tests peuvent ainsi vérifier ce
    // qui est réellement écrit, sans mimer AES.
    destinationEncrypted: 'v1.chiffre.MTN MoMo — Titulaire A 677123456',
    destinationMasked: 'MTN MoMo — Titulaire A ••••3456',
    changedAt: new Date('2026-08-01T10:00:00Z'),
    cooldownUntil: new Date('2026-08-01T10:00:00Z'), // déjà écoulé
    reportedAt: null,
    reportedReason: null,
    clearedAt: null,
    clearedById: null,
  };

  const NOUVELLES = {
    method: 'MOBILE_MONEY',
    destinationLabel: 'Orange Money — 699887766',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-04T12:00:00Z'));

    prisma = {
      ambassador: { findUnique: jest.fn().mockResolvedValue(AMBASSADEUR) },
      ambassadorPaymentDetail: {
        findUnique: jest.fn().mockResolvedValue(COORDONNEES),
        upsert: jest.fn((args: { create: object; update: object }) =>
          Promise.resolve({ ...COORDONNEES, ...args.create, ...args.update }),
        ),
        update: jest.fn((args: { data: object }) =>
          Promise.resolve({ ...COORDONNEES, ...args.data }),
        ),
      },
      ambassadorPaymentDetailEvent: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn(), notifyAdmins: jest.fn() };
    encryption = {
      encrypt: jest.fn((clair: string) => 'v1.chiffre.' + clair),
      decrypt: jest.fn((chiffre: string) => chiffre.replace('v1.chiffre.', '')),
      keyIdOf: jest.fn(() => 'v1'),
    };
    policy = {
      resolve: jest.fn().mockResolvedValue({
        countryCode: 'CM',
        paymentDetailsCooldownHours: 72,
      }),
    };

    service = new PaymentDetailsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      policy as unknown as AmbassadorPolicyService,
      encryption as unknown as FieldEncryptionService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const journalise = () =>
    (
      (
        prisma.ambassadorPaymentDetailEvent.create.mock.calls as unknown[][]
      )[0][0] as { data: Record<string, unknown> }
    ).data;

  // --- LE DÉLAI --------------------------------------------------------------
  describe('délai de refroidissement', () => {
    it('toute modification ouvre un délai de 72 heures', async () => {
      const resultat = await service.update('user-amb', NOUVELLES);

      // 2026-08-04T12:00 + 72 h = 2026-08-07T12:00.
      expect(resultat.cooldownUntil.toISOString()).toBe(
        '2026-08-07T12:00:00.000Z',
      );
      expect(resultat.cooldownActive).toBe(true);
    });

    it('le délai suit la politique du pays', async () => {
      policy.resolve.mockResolvedValue({
        countryCode: 'SN',
        paymentDetailsCooldownHours: 24,
      });

      const resultat = await service.update('user-amb', NOUVELLES);
      expect(resultat.cooldownUntil.toISOString()).toBe(
        '2026-08-05T12:00:00.000Z',
      );
    });

    it('une saisie IDENTIQUE ne rouvre pas le délai', async () => {
      // Sans cela, enregistrer deux fois les mêmes coordonnées repousserait
      // indéfiniment le versement de quelqu'un d'hésitant.
      const resultat = await service.update('user-amb', {
        method: COORDONNEES.method,
        destinationLabel: 'MTN MoMo — Titulaire A 677123456',
      });

      expect(prisma.ambassadorPaymentDetail.upsert).not.toHaveBeenCalled();
      expect(resultat.cooldownUntil).toEqual(COORDONNEES.cooldownUntil);
    });

    it('bloque les versements pendant le délai', async () => {
      prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue({
        ...COORDONNEES,
        cooldownUntil: new Date('2026-08-07T12:00:00Z'),
      });

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages).toHaveLength(1);
      expect(blocages[0]).toContain('délai de sécurité');
    });

    it('laisse passer une fois le délai écoulé', async () => {
      expect(await service.blockingReasons('amb-1')).toEqual([]);
    });

    it('bloque aussi quand aucune coordonnée n’est enregistrée', async () => {
      prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue(null);
      expect(await service.blockingReasons('amb-1')).toEqual([
        'Aucune coordonnée de versement enregistrée.',
      ]);
    });
  });

  // --- LE MASQUAGE, GARANTI À L'ÉCRITURE ------------------------------------
  describe('le numéro complet ne sort jamais', () => {
    it('le journal ne porte que des formes masquées', async () => {
      await service.update('user-amb', NOUVELLES);

      const evenement = journalise();
      expect(evenement.previousMasked).toBe('MTN MoMo — Titulaire A ••••3456');
      expect(evenement.newMasked).toBe('Orange Money — ••••7766');
      expect(JSON.stringify(evenement)).not.toContain('677123456');
      expect(JSON.stringify(evenement)).not.toContain('699887766');
    });

    it('l’audit lui-même est masqué', async () => {
      await service.update('user-amb', NOUVELLES);

      const contexte = (audit.recordChange.mock.calls as unknown[][])[0][2] as {
        changes: { oldValue: unknown; newValue: unknown }[];
      };
      // Un journal d'administration se consulte, se filtre, s'exporte.
      expect(JSON.stringify(contexte)).not.toContain('699887766');
      expect(contexte.changes[0].newValue).toBe('Orange Money — ••••7766');
    });

    it('la réponse rendue à l’ambassadeur est masquée', async () => {
      const resultat = await service.update('user-amb', NOUVELLES);
      expect(resultat.destinationMasked).toBe('Orange Money — ••••7766');
      expect(JSON.stringify(resultat)).not.toContain('699887766');
    });

    it('seule la porte de déchiffrement rend le libellé complet', async () => {
      // Elle est nommée pour qu'on ne l'appelle pas par distraction, et elle
      // EXIGE un motif : on ne déchiffre pas en passant.
      const destination = await service.resolveForPayout('amb-1', 'user-amb');
      expect(destination.destinationLabel).toBe(
        'MTN MoMo — Titulaire A 677123456',
      );
    });

    it('CHAQUE déchiffrement est journalisé, avec son motif', async () => {
      await service.resolveForPayout('amb-1', 'user-amb');

      const trace = (audit.record.mock.calls as unknown[][]).find(
        ([action]) => action === 'AMBASSADOR_PAYMENT_DETAILS_DECRYPTED',
      ) as [string, string, Record<string, unknown>];

      expect(trace).toBeDefined();
      expect(trace[1]).toBe('user-amb');
      expect(trace[2].purpose).toBe('PAYOUT_REQUEST_SNAPSHOT');
      // La trace dit QUI a lu, POURQUOI et sur QUEL dossier — jamais la valeur
      // lue. Un journal qui recopierait ce qu'il protège n'aurait aucun sens.
      expect(JSON.stringify(trace[2])).not.toContain('677123456');
    });

    it('un déchiffrement impossible est journalisé comme un accès refusé', async () => {
      encryption.decrypt.mockImplementation(() => {
        throw new Error('Clé absente du trousseau.');
      });

      await expect(
        service.resolveForPayout('amb-1', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);

      // Se taire ici laisserait l'incident se découvrir par la plainte d'un
      // ambassadeur non payé. Une valeur altérée en base donne le même échec :
      // AES-GCM est authentifié, il refuse au lieu de rendre autre chose.
      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_PAYMENT_DETAILS_ACCESS_DENIED',
        'admin-1',
        expect.objectContaining({ motif: 'DECHIFFREMENT_IMPOSSIBLE' }),
      );
    });
  });

  // --- L'ALERTE --------------------------------------------------------------
  describe('alerte de sécurité', () => {
    it('prévient l’ambassadeur à chaque modification', async () => {
      await service.update('user-amb', NOUVELLES);

      const [userId, type, metadata] = (
        notifications.notifyUser.mock.calls as unknown[][]
      )[0] as [string, string, Record<string, unknown>];
      expect(userId).toBe('user-amb');
      expect(type).toBe('AMBASSADOR_PAYMENT_DETAILS_CHANGED');
      expect(metadata.cooldownHours).toBe(72);
    });

    it('l’alerte ne porte que la destination masquée', async () => {
      await service.update('user-amb', NOUVELLES);

      const metadata = (
        notifications.notifyUser.mock.calls as unknown[][]
      )[0][2];
      expect(JSON.stringify(metadata)).not.toContain('699887766');
      expect(JSON.stringify(metadata)).toContain('••••7766');
    });
  });

  // --- LE FREIN D'URGENCE ---------------------------------------------------
  describe('signalement d’une modification non autorisée', () => {
    it('gèle les versements sans condition', async () => {
      prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue({
        ...COORDONNEES,
        reportedAt: new Date('2026-08-04T11:00:00Z'),
        // Le délai est écoulé, et pourtant rien ne doit partir.
      });

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages[0]).toContain('signalement');
    });

    it('prévient l’administration', async () => {
      await service.report('user-amb', {
        reason: 'Je n’ai jamais demandé ce changement de numéro.',
      });

      expect(notifications.notifyAdmins).toHaveBeenCalledWith(
        'AMBASSADOR_PAYMENT_DETAILS_CHANGED',
        expect.objectContaining({ reported: true }),
      );
    });

    it('interdit de modifier les coordonnées pendant l’instruction', async () => {
      prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue({
        ...COORDONNEES,
        reportedAt: new Date('2026-08-04T11:00:00Z'),
      });

      // Laisser modifier pendant qu'un détournement est instruit reviendrait à
      // donner un second essai à celui qui l'a provoqué.
      await expect(service.update('user-amb', NOUVELLES)).rejects.toThrow(
        ConflictException,
      );
    });

    it('la levée par l’administration débloque, et se journalise', async () => {
      prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue({
        ...COORDONNEES,
        reportedAt: new Date('2026-08-04T11:00:00Z'),
      });

      await service.clear('admin-1', 'amb-1', 'Confirmé par téléphone.');

      expect(journalise().type).toBe('CLEARED');
      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_PAYMENT_DETAILS_CLEARED',
        'admin-1',
        expect.anything(),
      );
    });

    it('refuse de lever un signalement inexistant', async () => {
      await expect(
        service.clear('admin-1', 'amb-1', 'Rien à lever.'),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('un ambassadeur non actif n’enregistre pas de coordonnées', async () => {
    prisma.ambassador.findUnique.mockResolvedValue({
      ...AMBASSADEUR,
      status: 'SUSPENDED',
    });

    await expect(service.update('user-amb', NOUVELLES)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('une demande de versement sans coordonnées est refusée', async () => {
    prisma.ambassadorPaymentDetail.findUnique.mockResolvedValue(null);
    await expect(service.resolveForPayout('amb-1', 'user-amb')).rejects.toThrow(
      ConflictException,
    );
  });
});
