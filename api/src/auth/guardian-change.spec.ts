import { BadRequestException, ConflictException } from '@nestjs/common';
import { GuardianChangeStatus } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { GuardianChangeService } from './guardian-change.service';
import type { MinorPolicyService } from './minor-policy.service';

// ============================================================================
// LA PORTE DE SORTIE DU CYCLE DE REFUS
//
// Cette procédure existe parce que les vrais changements de tuteur existent :
// décès, séparation, placement, déménagement. Elle est dangereuse pour la même
// raison qu'elle est nécessaire — c'est le contournement le plus évident du
// délai de refus.
//
// Ces tests gardent le point d'équilibre : la demande est possible, elle est
// vue par un humain, et elle N'EFFACE JAMAIS l'historique des refus.
// ============================================================================

type MockPrisma = {
  user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  parentalLink: { findMany: jest.Mock };
  guardianChangeRequest: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

// `jest.Mock` non paramétré rend `mock.calls` en `any[][]`, que le lint refuse.
// On type l'accès une fois plutôt que de désactiver la règle.
function appels<T extends unknown[]>(mock: jest.Mock): T[] {
  return mock.mock.calls as T[];
}

const MOTIF =
  'Mon père est décédé en mars et je vis désormais chez ma tante, qui est ma tutrice.';

describe('Changement de représentant légal', () => {
  let prisma: MockPrisma;
  let audit: { record: jest.Mock };
  let service: GuardianChangeService;

  function creerPrisma(): MockPrisma {
    const p: MockPrisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'mineur_1',
          phone: '+237690009999',
          parentalRefusalCount: 2,
        }),
        update: jest.fn(),
      },
      parentalLink: { findMany: jest.fn().mockResolvedValue([]) },
      guardianChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'dem_1', status: 'SUBMITTED' }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    // ========================================================================
    // LE DOUBLE DE TRANSACTION REND LES MÊMES MOCKS
    //
    // Sans cela, tout ce que le service écrit dans `$transaction` tombe dans un
    // objet que le test n'inspecte pas : les assertions portent alors sur des
    // mocks jamais appelés, et le test passe au vert quoi qu'il arrive.
    //
    // Défaut constaté dans la première version de ce fichier même.
    // ========================================================================
    p.$transaction.mockImplementation(
      async (fn: (t: MockPrisma) => Promise<void>) => {
        await fn(p);
      },
    );

    return p;
  }

  beforeEach(() => {
    prisma = creerPrisma();
    audit = { record: jest.fn() };
    service = new GuardianChangeService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {
        requiresParentalConsent: jest.fn().mockResolvedValue(true),
      } as unknown as MinorPolicyService,
    );
  });

  describe('dépôt de la demande', () => {
    it('fige le compteur de refus au moment de la demande', async () => {
      await service.request('mineur_1', '+237690001111', MOTIF);

      const [[ecrit]] = appels<[{ data: { refusalCountAtRequest: number } }]>(
        prisma.guardianChangeRequest.create,
      );
      // C'est l'information qui permet à l'administrateur de distinguer un cas
      // de vie d'un contournement. Elle doit être figée ICI : le compteur
      // continuera de bouger après.
      expect(ecrit.data.refusalCountAtRequest).toBe(2);
    });

    it('refuse le numéro du tuteur actuel, même réécrit autrement', async () => {
      prisma.parentalLink.findMany.mockResolvedValue([
        { parentPhoneNormalized: '+237690001111' },
      ]);

      // SANS LA COMPARAISON CANONIQUE, cette saisie serait acceptée comme un
      // « changement de tuteur » et passerait devant un administrateur qui n'a
      // aucun moyen de voir qu'il s'agit du même téléphone.
      await expect(
        service.request('mineur_1', '+237 690 00 11 11', MOTIF),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse le propre numéro du mineur', async () => {
      await expect(
        service.request('mineur_1', '+237 690 00 99 99', MOTIF),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('n’accepte qu’une seule demande en cours', async () => {
      prisma.guardianChangeRequest.findFirst.mockResolvedValue({
        id: 'deja_la',
      });
      await expect(
        service.request('mineur_1', '+237690001111', MOTIF),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ne concerne pas un compte devenu majeur', async () => {
      service = new GuardianChangeService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
        {
          requiresParentalConsent: jest.fn().mockResolvedValue(false),
        } as unknown as MinorPolicyService,
      );
      // Un majeur n'a pas à justifier ses relations familiales auprès d'un
      // administrateur pour utiliser la plateforme.
      await expect(
        service.request('mineur_1', '+237690001111', MOTIF),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ne recopie ni le numéro demandé ni la justification au journal', async () => {
      await service.request('mineur_1', '+237690001111', MOTIF);

      const trace = JSON.stringify(audit.record.mock.calls);
      // Données personnelles : le journal dit QUE la demande a eu lieu, la
      // table dit QUOI. L'identifiant suffit à faire le lien.
      expect(trace).not.toContain('690001111');
      expect(trace).not.toContain('tante');
    });
  });

  describe('décision', () => {
    beforeEach(() => {
      prisma.guardianChangeRequest.findUnique.mockResolvedValue({
        id: 'dem_1',
        childId: 'mineur_1',
        status: GuardianChangeStatus.SUBMITTED,
        refusalCountAtRequest: 2,
      });
    });

    // --- LE POINT LE PLUS FACILE À CASSER PAR MÉGARDE ----------------------
    //
    // RÈGLE RÉVISÉE LE 2026-08-09. Cette assertion exigeait auparavant que
    // l'approbation écrive `parentalRequestBlockedUntil: null`. C'était
    // précisément la faille : le délai était levé pour N'IMPORTE QUEL numéro,
    // y compris celui du tuteur qui venait de refuser.
    //
    // L'approbation ne touche plus au compte du tout. Elle crée une exception
    // NOMINATIVE, portée par la ligne APPROVED non consommée, que
    // `requestConsent` recherche sur la forme canonique du numéro.
    it('ne touche jamais au compte du mineur, ni au blocage ni au compteur', async () => {
      await service.decide('admin_1', 'dem_1', true, 'Acte de décès fourni.');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('périme les approbations antérieures non consommées', async () => {
      await service.decide('admin_1', 'dem_1', true, 'Acte de décès fourni.');

      const [[peremption]] = appels<
        [{ where: Record<string, unknown>; data: { consumedAt: Date } }]
      >(prisma.guardianChangeRequest.updateMany);

      // Sans cela elles s'accumuleraient : trois approbations obtenues sur six
      // mois, aucune utilisée, donneraient trois exceptions simultanées à faire
      // valoir plus tard. La dernière décision est celle qui compte.
      expect(peremption.where).toMatchObject({
        childId: 'mineur_1',
        status: GuardianChangeStatus.APPROVED,
        consumedAt: null,
        id: { not: 'dem_1' },
      });
      expect(peremption.data.consumedAt).toBeInstanceOf(Date);
    });

    it('ne touche pas au compte quand la demande est rejetée', async () => {
      await service.decide('admin_1', 'dem_1', false, 'Aucun élément fourni.');
      // Un rejet laisse la situation exactement où elle était : le délai en
      // cours continue de courir, il n'est ni levé ni rallongé, et aucune
      // exception n'est créée.
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.guardianChangeRequest.updateMany).not.toHaveBeenCalled();
    });

    it('journalise l’approbation et le rejet sous deux actions distinctes', async () => {
      await service.decide('admin_1', 'dem_1', true, 'Acte de décès fourni.');
      expect(appels<[string]>(audit.record)[0][0]).toBe(
        'GUARDIAN_CHANGE_APPROVED',
      );

      audit.record.mockClear();
      prisma.guardianChangeRequest.findUnique.mockResolvedValue({
        id: 'dem_2',
        childId: 'mineur_1',
        status: GuardianChangeStatus.SUBMITTED,
        refusalCountAtRequest: 2,
      });
      await service.decide('admin_1', 'dem_2', false, 'Aucun élément fourni.');
      // Un filtre sur `action` doit pouvoir les séparer : six mois plus tard,
      // une approbation et un rejet ne se relisent pas de la même façon.
      expect(appels<[string]>(audit.record)[0][0]).toBe(
        'GUARDIAN_CHANGE_REJECTED',
      );
    });

    it('refuse de trancher deux fois la même demande', async () => {
      prisma.guardianChangeRequest.findUnique.mockResolvedValue({
        id: 'dem_1',
        childId: 'mineur_1',
        status: GuardianChangeStatus.APPROVED,
        refusalCountAtRequest: 2,
      });
      await expect(
        service.decide('admin_1', 'dem_1', false, 'Changement d’avis.'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
