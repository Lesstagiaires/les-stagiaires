import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CountryPolicyService } from './country-policy.service';
import type { MinorPolicyService } from './minor-policy.service';
import { ParentalConsentService } from './parental-consent.service';
import { ParentalConsentSweepProcessor } from './parental-consent-sweep.processor';
import { isSameParentPhone, normalizeParentPhone } from './parental-phone';

// ============================================================================
// LE CYCLE DE REFUS PARENTAL
//
// Modèle métier arbitré par le promoteur le 2026-08-08 : « Le droit du parent
// ou du tuteur de refuser doit être respecté, mais nous devons également
// permettre au mineur de comprendre le refus, de présenter à nouveau les
// avantages et les garanties de la plateforme à son représentant légal et, le
// cas échéant, de solliciter une nouvelle décision. »
//
// Un refus n'est donc jamais définitif — mais il coûte de plus en plus cher :
// 7 jours, puis 30, puis 6 mois réarmés à chaque refus supplémentaire.
// ============================================================================

// Lecture typée des écritures Prisma. `expect.objectContaining` retourne `any`,
// ce que la configuration de lint refuse à juste titre : un test qui compare des
// `any` ne prouve pas grand-chose.
// `jest.Mock` sans paramètre de type rend `mock.calls` en `any[][]`, que la
// configuration de lint refuse — à juste titre : un test qui compare des `any`
// ne prouve rien. On type l'accès une fois, ici.
function appels<T extends unknown[]>(mock: jest.Mock): T[] {
  return mock.mock.calls as T[];
}

function donneesEcrites<T>(mock: jest.Mock, appel = 0): T {
  return appels<[{ data: T }]>(mock)[appel][0].data;
}

function evenementsJournalises(audit: { record: jest.Mock }): string[] {
  return appels<[string]>(audit.record).map((c) => c[0]);
}

describe('Cycle de refus parental', () => {
  // --------------------------------------------------------------------------
  // LA NORMALISATION — sans elle, tout le reste tombe
  // --------------------------------------------------------------------------
  describe('forme canonique du numéro de tuteur', () => {
    // CE QUI A ÉTÉ CONSTATÉ le 2026-08-08 : `@IsPhoneNumber` valide sans
    // transformer, donc ces trois chaînes passaient toutes la validation comme
    // des valeurs DISTINCTES. Le délai de garde, le compteur de refus et la
    // détection d'un changement de tuteur s'indexent tous sur la clef
    // (enfant, numéro) — une variation d'espacement les contournait d'un coup.
    it.each([
      '+237690001111',
      '+237 690 00 11 11',
      '+237-690-001-111',
      '+237 690-00-11-11',
    ])('ramène %s à une seule et même clef', (saisie) => {
      expect(normalizeParentPhone(saisie)).toBe('+237690001111');
    });

    it('refuse un numéro illisible plutôt que de l’écrire tel quel', () => {
      // FAIL-CLOSED. Écrire « au cas où » créerait précisément la clef
      // divergente que la normalisation existe pour empêcher.
      expect(() => normalizeParentPhone('06 12 34')).toThrow();
    });

    it('ne dit jamais que deux numéros absents sont le même', () => {
      // `User.phone` est nullable. Si `null === null` valait « même personne »,
      // tout compte sans téléphone se verrait refuser son propre tuteur.
      expect(isSameParentPhone(null, null)).toBe(false);
      expect(isSameParentPhone('+237690001111', null)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // LE COMPTEUR ET LES DÉLAIS
  // --------------------------------------------------------------------------
  describe('déclinaison d’un consentement', () => {
    let prisma: {
      parentalLink: { findUnique: jest.Mock; update: jest.Mock };
      user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
      guardianChangeRequest: { findFirst: jest.Mock; update: jest.Mock };
    };
    let audit: { record: jest.Mock };
    let countryPolicies: { resolve: jest.Mock };
    let service: ParentalConsentService;

    // Doit refléter `ParentalConsentService.hashCode` à l'identique, sinon
    // chaque test échouerait sur « code invalide » avant d'atteindre ce qu'il
    // prétend vérifier.
    const hachage = (code: string) =>
      createHash('sha256').update(code).digest('hex');

    function armer(refusalCount: number) {
      const code = '123456';
      prisma.parentalLink.findUnique.mockResolvedValue({
        id: 'lien_1',
        childId: 'mineur_1',
        status: ParentalLinkStatus.PENDING,
        consentCodeHash: hachage(code),
        consentExpiresAt: new Date(Date.now() + 3_600_000),
        consentAttempts: 0,
        maxConsentAttempts: 5,
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'mineur_1',
        countryOfResidence: 'CM',
        parentalRefusalCount: refusalCount,
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
      });
      return code;
    }

    beforeEach(() => {
      prisma = {
        parentalLink: { findUnique: jest.fn(), update: jest.fn() },
        user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
        // Aucune autorisation de changement de tuteur dans ces cas : ce fichier
        // teste le cycle nominal. Le parcours avec autorisation est joué dans
        // `parental-refusal-scenarios.spec.ts`, sur un monde qui garde son état.
        guardianChangeRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };
      audit = { record: jest.fn() };
      countryPolicies = {
        resolve: jest.fn().mockResolvedValue({
          refusalDelay1Days: 7,
          refusalDelay2Days: 30,
          refusalDelayFinalDays: 182,
        }),
      };
      service = new ParentalConsentService(
        prisma as unknown as PrismaService,
        new ConfigService({}),
        { send: jest.fn() },
        audit as unknown as AuditService,
        {
          requiresParentalConsent: jest.fn().mockResolvedValue(true),
        } as unknown as MinorPolicyService,
        countryPolicies as unknown as CountryPolicyService,
      );
    });

    // --- LE POINT LE PLUS IMPORTANT DU CHANTIER ----------------------------
    //
    // Le refus mettait le compte en DEACTIVATED, ce qui INTERDIT LA CONNEXION.
    // Or le mineur doit pouvoir consulter, pendant tout le blocage, la
    // présentation pédagogique destinée à son tuteur. Les deux règles se
    // contredisaient : le modèle validé le 2026-08-08 tranche pour la
    // restriction, pas la désactivation.
    it('laisse le compte accessible en mode restreint, sans le désactiver', async () => {
      const code = armer(0);
      await service.declineConsent('lien_1', code);

      const ecrit = donneesEcrites<{
        status: AccountStatus;
        deactivatedAt?: Date;
      }>(prisma.user.update);
      expect(ecrit.status).toBe(AccountStatus.AWAITING_PARENTAL_CONSENT);
      expect(ecrit.status).not.toBe(AccountStatus.DEACTIVATED);
      expect(ecrit.deactivatedAt).toBeUndefined();
    });

    it.each([
      [0, 7],
      [1, 30],
      [2, 182],
      // Au-delà du troisième, le dernier délai est RÉARMÉ à chaque refus : rien
      // n'est jamais définitif, mais rien ne s'use non plus.
      [9, 182],
    ])(
      'après %i refus antérieurs, bloque %i jours',
      async (anterieurs, joursAttendus) => {
        const code = armer(anterieurs);
        const avant = Date.now();
        await service.declineConsent('lien_1', code);

        const ecrit = donneesEcrites<{
          parentalRefusalCount: number;
          parentalRequestBlockedUntil: Date;
        }>(prisma.user.update);

        expect(ecrit.parentalRefusalCount).toBe(anterieurs + 1);
        const joursReels =
          (ecrit.parentalRequestBlockedUntil.getTime() - avant) /
          (24 * 60 * 60 * 1000);
        expect(joursReels).toBeCloseTo(joursAttendus, 1);
      },
    );

    it('journalise le compteur et le délai, pas seulement le fait du refus', async () => {
      const code = armer(1);
      await service.declineConsent('lien_1', code);

      const refus = appels<[string, string, Record<string, unknown>]>(
        audit.record,
      ).find((c) => c[0] === 'PARENTAL_CONSENT_DECLINED');
      // Le journal est en ajout seul et fait foi : la dénormalisation portée par
      // `User` doit rester reconstructible depuis lui seul.
      expect(refus?.[2]).toMatchObject({ refusalCount: 2, delaiJours: 30 });
    });

    it('lit les délais dans la politique du pays, jamais dans le code', async () => {
      countryPolicies.resolve.mockResolvedValue({
        refusalDelay1Days: 3,
        refusalDelay2Days: 3,
        refusalDelayFinalDays: 3,
      });
      const code = armer(0);
      const avant = Date.now();
      await service.declineConsent('lien_1', code);

      const ecrit = donneesEcrites<{ parentalRequestBlockedUntil: Date }>(
        prisma.user.update,
      );
      const jours =
        (ecrit.parentalRequestBlockedUntil.getTime() - avant) /
        (24 * 60 * 60 * 1000);
      expect(jours).toBeCloseTo(3, 1);
      expect(countryPolicies.resolve).toHaveBeenCalledWith('CM');
    });
  });

  // --------------------------------------------------------------------------
  // LE BLOCAGE, VU DEPUIS LA NOUVELLE DEMANDE
  // --------------------------------------------------------------------------
  describe('nouvelle demande pendant le blocage', () => {
    it('refuse, et journalise la tentative', async () => {
      const prisma = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'mineur_1',
            phone: '+237690009999',
            parentalRefusalCount: 1,
            parentalRequestBlockedUntil: new Date(Date.now() + 86_400_000),
          }),
          update: jest.fn(),
        },
        parentalLink: { findUnique: jest.fn(), findMany: jest.fn() },
        // Aucune autorisation vivante : le blocage doit donc mordre.
        guardianChangeRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };
      const audit = { record: jest.fn() };
      const sms = { send: jest.fn() };
      const service = new ParentalConsentService(
        prisma as unknown as PrismaService,
        new ConfigService({}),
        sms,
        audit as unknown as AuditService,
        {
          requiresParentalConsent: jest.fn().mockResolvedValue(true),
        } as unknown as MinorPolicyService,
        { resolve: jest.fn() } as unknown as CountryPolicyService,
      );

      await expect(
        service.requestConsent('mineur_1', '+237690001111'),
      ).rejects.toBeInstanceOf(ConflictException);

      // AUCUN SMS. C'est tout l'objet du dispositif : le parent qui a refusé ne
      // doit pas être resollicité pendant le délai.
      expect(sms.send).not.toHaveBeenCalled();
      // La TENTATIVE est tracée, pas seulement le refus. Trois demandes en six
      // mois et quarante en une semaine ne décrivent pas la même situation.
      expect(evenementsJournalises(audit)).toContain(
        'PARENTAL_CONSENT_REQUEST_BLOCKED',
      );
    });

    it('n’est pas contournable en réécrivant le même numéro autrement', async () => {
      const prisma = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'mineur_1',
            phone: '+237690009999',
            parentalRefusalCount: 1,
            parentalRequestBlockedUntil: new Date(Date.now() + 86_400_000),
          }),
          update: jest.fn(),
        },
        parentalLink: { findUnique: jest.fn(), findMany: jest.fn() },
        // Aucune autorisation vivante : le blocage doit donc mordre.
        guardianChangeRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      };
      const sms = { send: jest.fn() };
      const service = new ParentalConsentService(
        prisma as unknown as PrismaService,
        new ConfigService({}),
        sms,
        { record: jest.fn() } as unknown as AuditService,
        {
          requiresParentalConsent: jest.fn().mockResolvedValue(true),
        } as unknown as MinorPolicyService,
        { resolve: jest.fn() } as unknown as CountryPolicyService,
      );

      // Le blocage porte sur le COMPTE, pas sur le numéro : changer d'écriture
      // — ou même de tuteur — ne le lève pas.
      await expect(
        service.requestConsent('mineur_1', '+237 690 00 11 11'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sms.send).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // LE TEST DE NON-RÉGRESSION EXIGÉ EXPLICITEMENT
  //
  // Verbatim de l'arbitrage du 2026-08-08 : « Il faut ajouter un test de
  // non-régression qui vérifie qu'un compte ayant fait l'objet d'un refus
  // parental n'est pas désactivé par le sweep des 30 jours. »
  //
  // POURQUOI CE TEST EXISTE. Le balayage des trente jours traite le SILENCE :
  // personne n'a répondu, on suspend. Un refus est le contraire du silence —
  // quelqu'un a répondu, explicitement. Les confondre reviendrait à punir le
  // mineur DEUX FOIS pour un seul refus, et à transformer en désactivation
  // définitive une décision que le promoteur a explicitement voulue réversible.
  // --------------------------------------------------------------------------
  describe('balayage des 30 jours', () => {
    function processeur(liens: unknown[]) {
      const prisma = {
        parentalLink: {
          findMany: jest.fn().mockResolvedValue(liens),
          update: jest.fn(),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'mineur_1',
            status: AccountStatus.AWAITING_PARENTAL_CONSENT,
            dateOfBirth: new Date('2012-01-01'),
            countryOfResidence: 'CM',
          }),
          update: jest.fn(),
        },
      };
      const audit = { record: jest.fn() };
      const proc = new ParentalConsentSweepProcessor(
        prisma as unknown as PrismaService,
        new ConfigService({}),
        audit as unknown as AuditService,
        {
          classify: jest
            .fn()
            .mockResolvedValue({ tier: 'PARENTAL_CONSENT_REQUIRED' }),
        } as unknown as MinorPolicyService,
      );
      return { proc, prisma, audit };
    }

    it('ne désactive pas un compte dont le tuteur a refusé', async () => {
      // Le balayage ne sélectionne que les liens PENDING. Un lien refusé est
      // DECLINED : il ne remonte donc jamais dans la requête.
      const { proc, prisma } = processeur([]);
      await proc.process();

      // La garantie est STRUCTURELLE, pas comportementale : ce n'est pas que le
      // balayage décide de ne pas suspendre, c'est qu'il ne voit pas ce lien.
      const [[filtre]] = appels<[{ where: { status: ParentalLinkStatus } }]>(
        prisma.parentalLink.findMany,
      );
      expect(filtre.where.status).toBe(ParentalLinkStatus.PENDING);
      expect(filtre.where.status).not.toBe(ParentalLinkStatus.DECLINED);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('désactive toujours un compte resté SILENCIEUX — la règle n’a pas été affaiblie', async () => {
      // Le pendant du test précédent. Assouplir le refus ne doit pas assouplir
      // le silence : sans ce test, on pourrait « corriger » le premier en
      // désarmant le balayage tout entier, et personne ne le verrait.
      const { proc, prisma, audit } = processeur([
        {
          id: 'lien_1',
          childId: 'mineur_1',
          status: ParentalLinkStatus.PENDING,
          createdAt: new Date('2020-01-01'),
        },
      ]);
      await proc.process();

      const ecrit = donneesEcrites<{ status: AccountStatus }>(
        prisma.user.update,
      );
      expect(ecrit.status).toBe(AccountStatus.DEACTIVATED);
      expect(evenementsJournalises(audit)).toContain(
        'MINOR_ACCOUNT_SUSPENDED_NO_PARENTAL_CONSENT',
      );
    });
  });
});
