import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MinorPolicyService } from './minor-policy.service';
import { ParentalConsentService } from './parental-consent.service';
import { ParentalConsentSweepProcessor } from './parental-consent-sweep.processor';

// ============================================================================
// DURCISSEMENT DU PARCOURS MINEUR / PARENT
//
// Trois garanties, chacune correspondant à un écart relevé entre le code et le
// cahier des charges du 2026-08-07. Toutes portent sur des situations où le
// système FONCTIONNAIT sans rien signaler — c'est ce qui les rendait
// dangereuses.
//
//   1. Un jeune devenu majeur n'est pas suspendu pour une obligation éteinte.
//   2. Changer de parent REBLOQUE le compte — pas de modification silencieuse.
//   3. Un refus explicite du parent bloque immédiatement, sans attendre 30 jours.
// ============================================================================

// Le champ `data` réellement passé à Prisma, typé. Préféré à
// `expect.objectContaining`, qui rend `any` et fait perdre au test la
// vérification que TypeScript est censé lui apporter.
function donneesEcrites(mock: jest.Mock): Record<string, unknown> {
  const appels = mock.mock.calls as unknown[][];
  expect(appels.length).toBeGreaterThan(0);
  return (appels[0][0] as { data: Record<string, unknown> }).data;
}

describe('Durcissement du consentement parental', () => {
  // --------------------------------------------------------------------------
  // 1. LE BALAYAGE NE SUSPEND PLUS UN MAJEUR
  // --------------------------------------------------------------------------
  describe('Balayage des consentements en retard', () => {
    let prisma: {
      parentalLink: { findMany: jest.Mock; update: jest.Mock };
      user: { findUnique: jest.Mock; update: jest.Mock };
    };
    let audit: { record: jest.Mock };
    let minorPolicy: { classify: jest.Mock };
    let processor: ParentalConsentSweepProcessor;

    const LIEN_EN_RETARD = {
      id: 'lien_1',
      childId: 'enfant_1',
      status: ParentalLinkStatus.PENDING,
    };

    beforeEach(() => {
      prisma = {
        parentalLink: {
          findMany: jest.fn().mockResolvedValue([LIEN_EN_RETARD]),
          update: jest.fn(),
        },
        user: { findUnique: jest.fn(), update: jest.fn() },
      };
      audit = { record: jest.fn() };
      minorPolicy = { classify: jest.fn() };

      processor = new ParentalConsentSweepProcessor(
        prisma as unknown as PrismaService,
        new ConfigService({ PARENTAL_CONSENT_FLAG_AFTER_DAYS: '30' }),
        audit as unknown as AuditService,
        minorPolicy as unknown as MinorPolicyService,
      );
    });

    // LE BOGUE CORRIGÉ. Ce balayage ne sélectionnait que sur la DATE du lien.
    // Un jeune inscrit à 17 ans, majeur au cinquième jour, dont le parent n'a
    // jamais répondu, se faisait désactiver au trentième — pour une obligation
    // qui n'existait plus.
    //
    // Il pouvait candidater le lundi (isActionGated recalcule l'âge) et se
    // retrouver désactivé le mardi par un travail de fond, sans avertissement.
    it('ne suspend pas un compte devenu majeur entre-temps', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        dateOfBirth: new Date('2008-01-01'),
        countryOfResidence: 'CM',
      });
      minorPolicy.classify.mockResolvedValue({
        tier: 'PARENTAL_INFO_OPTIONAL',
      });

      await processor.process();

      // Le lien devient caduc…
      expect(donneesEcrites(prisma.parentalLink.update).status).toBe(
        ParentalLinkStatus.EXPIRED,
      );
      // …mais le COMPTE reste intact. Une obligation qui s'éteint ne laisse pas
      // de sanction derrière elle.
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        'PARENTAL_CONSENT_OBSOLETE_MAJORITY_REACHED',
        'enfant_1',
        expect.anything(),
      );
    });

    it('suspend toujours un compte encore mineur après le délai', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        dateOfBirth: new Date('2012-01-01'),
        countryOfResidence: 'CM',
      });
      minorPolicy.classify.mockResolvedValue({
        tier: 'PARENTAL_CONSENT_REQUIRED',
      });

      await processor.process();

      expect(donneesEcrites(prisma.user.update).status).toBe(
        AccountStatus.DEACTIVATED,
      );
      expect(audit.record).toHaveBeenCalledWith(
        'MINOR_ACCOUNT_SUSPENDED_NO_PARENTAL_CONSENT',
        'enfant_1',
        expect.anything(),
      );
    });

    // Sans date de naissance ni pays, on ne peut PAS prouver que l'obligation
    // est éteinte. On maintient donc la protection : c'est le sens sûr de
    // l'erreur pour un compte créé comme mineur.
    it('maintient la protection quand l’âge ne peut pas être établi', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        dateOfBirth: null,
        countryOfResidence: null,
      });

      await processor.process();

      expect(minorPolicy.classify).not.toHaveBeenCalled();
      expect(donneesEcrites(prisma.user.update).status).toBe(
        AccountStatus.DEACTIVATED,
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. CHANGER DE PARENT REBLOQUE — 3. LE REFUS EXPLICITE
  // --------------------------------------------------------------------------
  describe('Service de consentement', () => {
    let prisma: {
      user: {
        findUnique: jest.Mock;
        findUniqueOrThrow: jest.Mock;
        update: jest.Mock;
      };
      parentalLink: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        update: jest.Mock;
        upsert: jest.Mock;
        create: jest.Mock;
      };
    };
    let audit: { record: jest.Mock };
    let sms: { send: jest.Mock };
    let service: ParentalConsentService;

    beforeEach(() => {
      prisma = {
        user: {
          findUnique: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        parentalLink: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
          upsert: jest.fn().mockResolvedValue({ id: 'lien_neuf' }),
          create: jest.fn().mockResolvedValue({ id: 'lien_neuf' }),
        },
      };
      audit = { record: jest.fn() };
      sms = { send: jest.fn() };

      service = new ParentalConsentService(
        prisma as unknown as PrismaService,
        new ConfigService({ PARENTAL_CONSENT_TTL_HOURS: '72' }),
        sms,
        audit as unknown as AuditService,
      );
    });

    // LE SECOND BOGUE. Demander le consentement d'un NOUVEAU numéro créait bien
    // un lien PENDING, mais laissait l'ancien ACTIVE. Le contrôle d'accès
    // cherche `findFirst({ status: ACTIVE })` : il trouvait l'ancien et laissait
    // tout passer.
    //
    // Un mineur pouvait donc faire valider son compte par un adulte
    // complaisant, puis « changer de parent » sans aucune conséquence.
    it('révoque l’ancien lien actif et rebloque le compte', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.parentalLink.findMany.mockResolvedValue([
        { id: 'ancien_lien', parentPhone: '+237690009999' },
      ]);

      await service.requestConsent('enfant_1', '+237690001111');

      expect(prisma.parentalLink.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ancien_lien' },
          data: { status: ParentalLinkStatus.REVOKED },
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AccountStatus.AWAITING_PARENTAL_CONSENT },
        }),
      );
    });

    // Le numéro du parent est une donnée personnelle : l'identifiant du lien
    // suffit à retrouver la ligne.
    it('ne journalise jamais le numéro du parent révoqué', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.parentalLink.findMany.mockResolvedValue([
        { id: 'ancien_lien', parentPhone: '+237690009999' },
      ]);

      await service.requestConsent('enfant_1', '+237690001111');

      const journal = JSON.stringify(audit.record.mock.calls);
      expect(journal).not.toContain('+237690009999');
      expect(journal).toContain('PARENTAL_LINK_REVOKED_ON_CHANGE');
    });

    it('ne rebloque rien quand il n’y avait aucun lien actif', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'enfant_1',
        isMinor: true,
        phone: '+237690000001',
      });
      prisma.parentalLink.findMany.mockResolvedValue([]);

      await service.requestConsent('enfant_1', '+237690001111');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------------
    // 3. LE REFUS EXPLICITE
    // ------------------------------------------------------------------------
    describe('Refus explicite du parent', () => {
      const CODE = '123456';

      function lienEnAttente(surcharges: Record<string, unknown> = {}) {
        return {
          id: 'lien_1',
          childId: 'enfant_1',
          status: ParentalLinkStatus.PENDING,
          consentCodeHash: createHash('sha256').update(CODE).digest('hex'),
          consentExpiresAt: new Date(Date.now() + 3_600_000),
          consentAttempts: 0,
          maxConsentAttempts: 5,
          ...surcharges,
        };
      }

      // « Le compte reste alors bloqué au-delà du délai de 30 jours, sans
      // attendre l'expiration automatique. » Toute la différence entre un refus
      // et un silence tient dans cette immédiateté.
      it('bloque le compte immédiatement, sans attendre les 30 jours', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(lienEnAttente());
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'enfant_1',
          status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        });

        await service.declineConsent('lien_1', CODE);

        expect(donneesEcrites(prisma.parentalLink.update).status).toBe(
          ParentalLinkStatus.DECLINED,
        );
        expect(donneesEcrites(prisma.user.update).status).toBe(
          AccountStatus.DEACTIVATED,
        );
        expect(audit.record).toHaveBeenCalledWith(
          'PARENTAL_CONSENT_DECLINED',
          'enfant_1',
          expect.anything(),
        );
      });

      // Refuser exige de prouver qu'on détient le téléphone, exactement comme
      // accepter — sinon n'importe qui bloquerait le compte d'un mineur en
      // connaissant son identifiant de lien.
      it('refuse un mauvais code et compte la tentative', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(lienEnAttente());

        await expect(
          service.declineConsent('lien_1', '000000'),
        ).rejects.toThrow(/Code invalide/);

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(donneesEcrites(prisma.parentalLink.update)).toEqual({
          consentAttempts: { increment: 1 },
        });
      });

      it('refuse un code expiré', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(
          lienEnAttente({ consentExpiresAt: new Date(Date.now() - 1000) }),
        );

        await expect(service.declineConsent('lien_1', CODE)).rejects.toThrow(
          /Code invalide/,
        );
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('refuse au-delà du nombre maximal de tentatives', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(
          lienEnAttente({ consentAttempts: 5, maxConsentAttempts: 5 }),
        );

        await expect(service.declineConsent('lien_1', CODE)).rejects.toThrow(
          /tentatives/,
        );
      });

      // Le code est consommé : un refus ne se rejoue pas et ne se retransforme
      // pas en acceptation avec le même secret.
      it('consomme le code au refus', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(lienEnAttente());
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'enfant_1',
          status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        });

        await service.declineConsent('lien_1', CODE);

        const appels = prisma.parentalLink.update.mock.calls as unknown[][];
        const ecriture = appels[0][0] as {
          data: { consentCodeHash: string | null };
        };
        expect(ecriture.data.consentCodeHash).toBeNull();
      });

      it('refuse un second refus sur le même lien', async () => {
        prisma.parentalLink.findUnique.mockResolvedValue(
          lienEnAttente({ status: ParentalLinkStatus.DECLINED }),
        );

        await expect(service.declineConsent('lien_1', CODE)).rejects.toThrow(
          /déjà été refusé/,
        );
      });
    });
  });
});
