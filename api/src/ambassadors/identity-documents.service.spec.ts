import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { IdentityDocumentsService } from './identity-documents.service';

// ============================================================================
// PIÈCES D'IDENTITÉ — niveau « TRÈS SENSIBLE » (CLAUDE.md §1)
//
// Deux familles de tests, et la première est la plus importante :
//
//   1. L'AUTORISATION. Rattacher la pièce de quelqu'un d'autre à son propre
//      dossier, c'est l'usurpation d'identité servie par une faille (IDOR). Le
//      contrôle de propriété est le seul rempart, et il doit être aveugle :
//      même réponse qu'un document inexistant, sans quoi on renseignerait un
//      attaquant sur ce qu'il a trouvé.
//
//   2. LE CLOISONNEMENT. Aucun octet de fichier ne transite par ce service. Ce
//      qu'il rend ne contient ni titre, ni contenu, ni numéro.
// ============================================================================
describe('Pièces d’identité du dossier ambassadeur', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock };
    digitalSafeDocument: { findUnique: jest.Mock };
    ambassadorIdentityDocument: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    ambassadorEvent: { create: jest.Mock };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: IdentityDocumentsService;

  const DOSSIER = {
    id: 'amb-1',
    status: 'UNDER_REVIEW',
    applicationCycle: 2,
  };

  const PIECE_AU_COFFRE = {
    id: 'doc-1',
    userId: 'user-1',
    category: 'IDENTITY',
    deletedAt: null,
  };

  const RATTACHEMENT = {
    documentId: 'doc-1',
    type: 'NATIONAL_ID' as never,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-05T12:00:00Z'));

    prisma = {
      ambassador: { findUnique: jest.fn().mockResolvedValue(DOSSIER) },
      digitalSafeDocument: {
        findUnique: jest.fn().mockResolvedValue(PIECE_AU_COFFRE),
      },
      ambassadorIdentityDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'pid-1',
            status: 'PENDING',
            uploadedAt: new Date(),
            verifiedAt: null,
            rejectionReasonCode: null,
            expiresAt: null,
            ...args.data,
          }),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'pid-1',
            type: 'NATIONAL_ID',
            applicationCycle: 2,
            uploadedAt: new Date(),
            expiresAt: null,
            verifiedAt: null,
            rejectionReasonCode: null,
            ...args.data,
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ambassadorEvent: { create: jest.fn() },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };

    service = new IdentityDocumentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  afterEach(() => jest.useRealTimers());

  const creePar = () =>
    (
      (
        prisma.ambassadorIdentityDocument.create.mock.calls as unknown[][]
      )[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  // --- L'AUTORISATION -------------------------------------------------------
  describe('propriété du document', () => {
    it('refuse la pièce de QUELQU’UN D’AUTRE', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue({
        ...PIECE_AU_COFFRE,
        userId: 'user-2',
      });

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.ambassadorIdentityDocument.create).not.toHaveBeenCalled();
    });

    it('journalise la tentative comme un accès refusé', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue({
        ...PIECE_AU_COFFRE,
        userId: 'user-2',
      });

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow();
      expect(audit.record).toHaveBeenCalledWith(
        'AMBASSADOR_IDENTITY_ATTACH_DENIED',
        'user-1',
        expect.objectContaining({ motif: 'DOCUMENT_INACCESSIBLE' }),
      );
    });

    it('répond LA MÊME CHOSE pour un document inexistant', async () => {
      // Distinguer les réponses permettrait d'énumérer les documents existants.
      prisma.digitalSafeDocument.findUnique.mockResolvedValue(null);

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow(
        'Document introuvable dans votre coffre-fort.',
      );
    });

    it('refuse un document supprimé', async () => {
      prisma.digitalSafeDocument.findUnique.mockResolvedValue({
        ...PIECE_AU_COFFRE,
        deletedAt: new Date(),
      });

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse un document qui n’est pas classé comme pièce d’identité', async () => {
      // Un relevé de notes rattaché comme pièce d'identité passerait la
      // vérification d'un administrateur pressé.
      prisma.digitalSafeDocument.findUnique.mockResolvedValue({
        ...PIECE_AU_COFFRE,
        category: 'DIPLOMA',
      });

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // --- LE CLOISONNEMENT -----------------------------------------------------
  describe('aucun fichier ne transite', () => {
    it('la réponse ne porte ni titre ni contenu', async () => {
      const recu = await service.attach('user-1', RATTACHEMENT);

      expect(Object.keys(recu).sort()).toEqual([
        'applicationCycle',
        'expiresAt',
        'id',
        'rejectionReasonCode',
        'status',
        'type',
        'uploadedAt',
        'verifiedAt',
      ]);
    });

    it('l’audit ne porte que l’identifiant du document', async () => {
      await service.attach('user-1', RATTACHEMENT);

      const trace = (audit.record.mock.calls as unknown[][]).find(
        ([action]) => action === 'AMBASSADOR_IDENTITY_ATTACHED',
      ) as [string, string, Record<string, unknown>];
      // Le TITRE est saisi par l'utilisateur et peut contenir un numéro de
      // pièce : il n'a pas sa place dans un journal qui s'exporte.
      expect(trace[2].title).toBeUndefined();
      expect(trace[2].documentId).toBe('doc-1');
    });
  });

  // --- LE CYCLE -------------------------------------------------------------
  describe('rattachement au cycle en cours', () => {
    it('enregistre le cycle du dossier, pas 1 par défaut', async () => {
      await service.attach('user-1', RATTACHEMENT);
      expect(creePar().applicationCycle).toBe(2);
    });

    it('refuse un dossier clos', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...DOSSIER,
        status: 'REJECTED',
      });

      await expect(service.attach('user-1', RATTACHEMENT)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // --- LE VERROU D'ACTIVATION -----------------------------------------------
  describe('verrou d’activation', () => {
    it('bloque sans aucune pièce vérifiée', async () => {
      const blocages = await service.blockingReasons('amb-1');
      expect(blocages).toHaveLength(1);
      expect(blocages[0]).toContain('Aucune pièce');
    });

    it('ne compte QUE les pièces du cycle en cours', async () => {
      await service.blockingReasons('amb-1');

      const where = (
        (
          prisma.ambassadorIdentityDocument.findMany.mock.calls as unknown[][]
        )[0][0] as { where: Record<string, unknown> }
      ).where;
      // Activer sur la foi d'une pièce du cycle précédent reviendrait à ne pas
      // vérifier du tout.
      expect(where.applicationCycle).toBe(2);
      expect(where.status).toBe('VERIFIED');
    });

    it('laisse passer avec une pièce vérifiée sans date d’expiration', async () => {
      prisma.ambassadorIdentityDocument.findMany.mockResolvedValue([
        { expiresAt: null },
      ]);
      expect(await service.blockingReasons('amb-1')).toEqual([]);
    });

    it('bloque quand toutes les pièces vérifiées sont expirées', async () => {
      prisma.ambassadorIdentityDocument.findMany.mockResolvedValue([
        { expiresAt: new Date('2026-01-01') },
      ]);

      const blocages = await service.blockingReasons('amb-1');
      expect(blocages[0]).toContain('expirées');
    });

    it('laisse passer si UNE des pièces est encore valable', async () => {
      prisma.ambassadorIdentityDocument.findMany.mockResolvedValue([
        { expiresAt: new Date('2026-01-01') },
        { expiresAt: new Date('2030-01-01') },
      ]);
      expect(await service.blockingReasons('amb-1')).toEqual([]);
    });
  });

  // --- L'INSTRUCTION --------------------------------------------------------
  describe('instruction', () => {
    beforeEach(() => {
      prisma.ambassadorIdentityDocument.findUnique.mockResolvedValue({
        id: 'pid-1',
        ambassadorId: 'amb-1',
        type: 'NATIONAL_ID',
        status: 'PENDING',
      });
    });

    it('la vérification enregistre son auteur', async () => {
      await service.verify('admin-1', 'pid-1');

      const data = (
        (
          prisma.ambassadorIdentityDocument.update.mock.calls as unknown[][]
        )[0][0] as { data: Record<string, unknown> }
      ).data;
      expect(data.status).toBe('VERIFIED');
      expect(data.verifiedById).toBe('admin-1');
      expect(data.verifiedAt).toBeInstanceOf(Date);
    });

    it('le rejet inscrit un CODE, et la note reste interne', async () => {
      await service.reject('admin-1', 'pid-1', {
        internalNote:
          'Photo illisible et date de validité masquée par un doigt.',
        reasonCode: 'DOCUMENTS_EXPIRED',
      });

      const data = (
        (
          prisma.ambassadorIdentityDocument.update.mock.calls as unknown[][]
        )[0][0] as { data: Record<string, unknown> }
      ).data;
      expect(data.rejectionReasonCode).toBe('DOCUMENTS_EXPIRED');
      // La note libre ne descend pas sur la ligne : elle vit au journal.
      expect(JSON.stringify(data)).not.toContain('illisible');
    });

    it('refuse de réinstruire une pièce déjà instruite', async () => {
      prisma.ambassadorIdentityDocument.findUnique.mockResolvedValue({
        id: 'pid-1',
        ambassadorId: 'amb-1',
        status: 'VERIFIED',
      });

      // La décision précédente a un auteur et une date : l'écraser les
      // effacerait.
      await expect(service.verify('admin-2', 'pid-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
