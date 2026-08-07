import {
  AmbassadorDecisionReason,
  AmbassadorEventType,
  AmbassadorEventVisibility,
  AmbassadorStatus,
  Language,
  NotificationType,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import { renderEmailContent } from '../email/email-templates';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AmbassadorsService } from './ambassadors.service';

// ============================================================================
// TROIS NIVEAUX DE MOTIF ET AUDIT — arbitrages du promoteur du 2026-08-02.
//
// « Aucune note interne ne doit pouvoir être envoyée à l'ambassadeur, même
// accidentellement. »
//
// Le risque n'était pas théorique : avant ce chantier, `dto.reason` — un champ
// libre de 1 000 caractères rempli par un administrateur — partait tel quel dans
// la notification de suspension et de résiliation. Ces tests empêchent le retour
// en arrière.
// ============================================================================

// La note qu'un administrateur pourrait écrire, et qui ne doit JAMAIS sortir.
const NOTE_INTERNE =
  'Soupçon de fraude, comptes liés détectés, à surveiller avant tout versement';

describe('Ambassadeurs — les trois niveaux de motif', () => {
  let prisma: {
    ambassador: { findUnique: jest.Mock; update: jest.Mock };
    ambassadorEvent: { create: jest.Mock };
    ambassadorPortfolioEntry: { findMany: jest.Mock; updateMany: jest.Mock };
    portfolioEvent: { createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let service: AmbassadorsService;

  const dossier = (status: AmbassadorStatus) => ({
    id: 'amb-1',
    userId: 'user-1',
    status,
    code: status === AmbassadorStatus.ACTIVE ? 'LS-AMB-ABC123' : null,
    suspendedAt: null,
    terminatedAt: null,
  });

  beforeEach(() => {
    prisma = {
      ambassador: {
        findUnique: jest
          .fn()
          .mockResolvedValue(dossier(AmbassadorStatus.ACTIVE)),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'amb-1', ...args.data }),
        ),
      },
      ambassadorEvent: { create: jest.fn() },
      ambassadorPortfolioEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      portfolioEvent: { createMany: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
        typeof fn === 'function'
          ? fn({
              ambassador: prisma.ambassador,
              ambassadorPortfolioEntry: prisma.ambassadorPortfolioEntry,
              portfolioEvent: prisma.portfolioEvent,
            })
          : Promise.resolve([]),
      ),
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    notifications = { notifyUser: jest.fn() };

    service = new AmbassadorsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      // Ni la politique par pays ni le portefeuille-monnaie n'interviennent dans
      // une suspension : des doubles inertes suffisent et gardent le test lisible.
      { resolve: jest.fn() } as never,
      { credit: jest.fn(), debit: jest.fn() } as never,
      // Les pièces d'identité n'interviennent pas non plus dans une suspension.
      { blockingReasons: jest.fn().mockResolvedValue([]) } as never,
      { blockingReasons: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  const decision = {
    internalNote: NOTE_INTERNE,
    reasonCode: AmbassadorDecisionReason.COMPLIANCE_REVIEW,
    publicMessage: 'Une vérification est en cours sur votre dossier.',
  };

  const notifiedMetadata = (): Record<string, unknown> => {
    const calls = notifications.notifyUser.mock.calls as unknown[][];
    return calls[0][2] as Record<string, unknown>;
  };
  const eventData = (): Record<string, unknown> => {
    const calls = prisma.ambassadorEvent.create.mock.calls as unknown[][];
    return (calls[0][0] as { data: Record<string, unknown> }).data;
  };
  const updateData = (): Record<string, unknown> => {
    const calls = prisma.ambassador.update.mock.calls as unknown[][];
    return (calls[0][0] as { data: Record<string, unknown> }).data;
  };

  describe('suspension', () => {
    beforeEach(async () => {
      await service.suspend('admin-1', 'amb-1', decision);
    });

    it('la note interne ne part PAS dans la notification', () => {
      const metadata = JSON.stringify(notifiedMetadata());
      expect(metadata).not.toContain('Soupçon de fraude');
      expect(metadata).not.toContain('comptes liés');
    });

    it('le code communicable et le message relu partent, eux', () => {
      const metadata = notifiedMetadata();
      expect(metadata.reasonCode).toBe(
        AmbassadorDecisionReason.COMPLIANCE_REVIEW,
      );
      expect(metadata.publicMessage).toBe(
        'Une vérification est en cours sur votre dossier.',
      );
    });

    it('les trois niveaux sont écrits dans des colonnes DISTINCTES', () => {
      const data = updateData();
      expect(data.suspensionReason).toBe(NOTE_INTERNE);
      expect(data.suspensionReasonCode).toBe(
        AmbassadorDecisionReason.COMPLIANCE_REVIEW,
      );
      expect(data.suspensionPublicMessage).toBe(
        'Une vérification est en cours sur votre dossier.',
      );
    });

    it('la note interne vit dans le journal — c’est sa place', () => {
      expect(eventData().internalNote).toBe(NOTE_INTERNE);
      expect(eventData().visibility).toBe(AmbassadorEventVisibility.AMBASSADOR);
    });

    it('le journal enregistre la transition et ce qui a été notifié', () => {
      const data = eventData();
      expect(data.type).toBe(AmbassadorEventType.SUSPENDED);
      expect(data.fromStatus).toBe(AmbassadorStatus.ACTIVE);
      expect(data.toStatus).toBe(AmbassadorStatus.SUSPENDED);
      expect(data.notifiedTypes).toEqual([
        NotificationType.AMBASSADOR_SUSPENDED,
      ]);
      expect(data.notifiedCount).toBe(1);
    });

    it('l’audit conserve l’auteur, l’ancienne et la nouvelle valeur', () => {
      const calls = audit.recordChange.mock.calls as unknown[][];
      const [action, actorId, context] = calls[0] as [
        string,
        string,
        {
          entityType: string;
          entityId: string;
          changes: { field: string; oldValue: unknown; newValue: unknown }[];
        },
      ];

      expect(action).toBe('AMBASSADOR_SUSPENDED');
      expect(actorId).toBe('admin-1');
      expect(context.entityType).toBe('Ambassador');
      expect(context.entityId).toBe('amb-1');
      expect(context.changes).toContainEqual({
        field: 'status',
        oldValue: AmbassadorStatus.ACTIVE,
        newValue: AmbassadorStatus.SUSPENDED,
      });
    });

    it('l’audit ne recopie PAS la note interne', () => {
      const calls = audit.recordChange.mock.calls as unknown[][];
      // Dupliquer la note multiplierait les endroits d'où elle peut fuiter :
      // le journal d'évènements la porte déjà.
      expect(JSON.stringify(calls[0])).not.toContain('Soupçon de fraude');
    });
  });

  describe('un dossier anonymisé reste décidable', () => {
    it('la décision est prise et journalisée, sans destinataire', async () => {
      prisma.ambassador.findUnique.mockResolvedValue({
        ...dossier(AmbassadorStatus.ACTIVE),
        userId: null,
      });

      await service.suspend('admin-1', 'amb-1', decision);

      expect(notifications.notifyUser).not.toHaveBeenCalled();
      expect(prisma.ambassadorEvent.create).toHaveBeenCalledTimes(1);
      expect(eventData().notifiedCount).toBe(0);
    });
  });
});

describe('Ambassadeurs — rendu des motifs dans les e-mails', () => {
  const languages = Object.values(Language);

  const flatten = (
    type: NotificationType,
    vars: Record<string, unknown>,
    language: Language = Language.FR,
  ) => {
    const content = renderEmailContent(type, vars as never, language)!;
    return [
      content.subject,
      content.heading,
      ...content.paragraphs,
      content.footnote ?? '',
    ].join(' ');
  };

  it.each(languages)(
    'aucune note interne ne peut apparaître — %s',
    (language) => {
      for (const type of [
        NotificationType.AMBASSADOR_SUSPENDED,
        NotificationType.AMBASSADOR_TERMINATED,
      ]) {
        const rendered = flatten(
          type,
          {
            reasonCode: AmbassadorDecisionReason.COMPLIANCE_REVIEW,
            // Fournie sous les deux noms sous lesquels elle pourrait fuiter.
            internalNote: NOTE_INTERNE,
            reason: NOTE_INTERNE,
          },
          language,
        );
        expect(rendered).not.toContain('Soupçon de fraude');
        expect(rendered).not.toContain('comptes liés');
      }
    },
  );

  it('affiche le libellé traduit du code communicable', () => {
    const rendered = flatten(NotificationType.AMBASSADOR_SUSPENDED, {
      reasonCode: AmbassadorDecisionReason.COMPLIANCE_REVIEW,
    });
    expect(rendered).toContain('vérification de conformité en cours');
    // Et la phrase qui rassure sur l'essentiel demeure.
    expect(rendered).toMatch(/commissions déjà acquises restent dues/i);
  });

  it('NO_PUBLIC_REASON n’affiche AUCUNE ligne de motif', () => {
    const rendered = flatten(NotificationType.AMBASSADOR_SUSPENDED, {
      reasonCode: AmbassadorDecisionReason.NO_PUBLIC_REASON,
    });
    expect(rendered).not.toMatch(/motif communiqué/i);
  });

  it('NOT_DISCLOSED le dit explicitement', () => {
    const rendered = flatten(NotificationType.AMBASSADOR_TERMINATED, {
      reasonCode: AmbassadorDecisionReason.NOT_DISCLOSED,
    });
    expect(rendered).toMatch(/n’est pas communiqué/i);
  });

  it('un code inconnu est ignoré, jamais affiché brut', () => {
    const rendered = flatten(NotificationType.AMBASSADOR_SUSPENDED, {
      reasonCode: 'CODE_AJOUTE_SANS_TRADUCTION',
    });
    expect(rendered).not.toContain('CODE_AJOUTE_SANS_TRADUCTION');
  });

  it('le message relu, lui, est bien transmis', () => {
    const rendered = flatten(NotificationType.AMBASSADOR_SUSPENDED, {
      reasonCode: AmbassadorDecisionReason.COMPLIANCE_REVIEW,
      publicMessage: 'Nos équipes reviendront vers vous sous huit jours.',
    });
    expect(rendered).toContain(
      'Nos équipes reviendront vers vous sous huit jours.',
    );
  });
});
