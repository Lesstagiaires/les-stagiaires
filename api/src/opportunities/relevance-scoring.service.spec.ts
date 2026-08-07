import { EducationLevel, SearchCriterion } from '../../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ALL_COUNTRIES,
  RelevanceScoringService,
  type CandidateContext,
  type ScorableOpportunity,
} from './relevance-scoring.service';

// ============================================================================
// MOTEUR DE PERTINENCE
//
// Arbitrage du promoteur, 2026-08-07.
//
// Trois familles de tests, par ordre d'importance :
//
//   1. LES PONDÉRATIONS VIENNENT DE LA BASE. « Un administrateur peut modifier
//      le poids de la fraîcheur de 5 à 3 sans redéployer. » Si ce test tombe,
//      c'est qu'une constante s'est glissée dans le calcul.
//   2. LE CLASSEMENT EST REPRODUCTIBLE. Un ordre qui varie est indéfendable.
//   3. LES SIX CRITÈRES font ce qu'ils annoncent — un par un, isolément.
// ============================================================================
describe('Moteur de pertinence', () => {
  let prisma: { searchRankingRule: { findMany: jest.Mock } };
  let service: RelevanceScoringService;

  const BAREME_VALIDE = [
    {
      criterion: SearchCriterion.SKILL_MATCH,
      weight: 35,
      countryCode: ALL_COUNTRIES,
    },
    {
      criterion: SearchCriterion.OCCUPATION_MATCH,
      weight: 25,
      countryCode: ALL_COUNTRIES,
    },
    {
      criterion: SearchCriterion.LOCATION_MATCH,
      weight: 15,
      countryCode: ALL_COUNTRIES,
    },
    {
      criterion: SearchCriterion.EDUCATION_MATCH,
      weight: 10,
      countryCode: ALL_COUNTRIES,
    },
    {
      criterion: SearchCriterion.AVAILABILITY_MATCH,
      weight: 5,
      countryCode: ALL_COUNTRIES,
    },
    {
      criterion: SearchCriterion.FRESHNESS,
      weight: 10,
      countryCode: ALL_COUNTRIES,
    },
  ];

  const MAINTENANT = new Date('2026-08-07T12:00:00Z');

  const offre = (
    over: Partial<ScorableOpportunity> = {},
  ): ScorableOpportunity => ({
    id: 'op-1',
    city: 'Douala',
    country: 'CM',
    workMode: 'ON_SITE',
    sector: 'Numérique',
    publishedAt: MAINTENANT,
    occupationId: 'dev',
    occupationFamilyId: 'informatique',
    minEducationLevel: null,
    skills: [],
    ...over,
  });

  const candidat = (
    over: Partial<CandidateContext> = {},
  ): CandidateContext => ({
    skillIds: [],
    targetOccupationId: 'dev',
    occupationFamilyId: 'informatique',
    city: 'Douala',
    country: 'CM',
    educationLevel: EducationLevel.BAC_PLUS_3,
    availableFrom: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      searchRankingRule: {
        findMany: jest.fn().mockResolvedValue(BAREME_VALIDE),
      },
    };
    service = new RelevanceScoringService(prisma as unknown as PrismaService);
  });

  // --- 1. LES PONDÉRATIONS VIENNENT DE LA BASE -------------------------------
  describe('pondérations configurables', () => {
    it('lit le barème EN BASE, pas une constante', async () => {
      const poids = await service.weightsFor('CM');
      expect(prisma.searchRankingRule.findMany).toHaveBeenCalled();
      expect(poids[SearchCriterion.SKILL_MATCH]).toBe(35);
    });

    it('un poids modifié en base change le classement — sans redéploiement', async () => {
      // Le cas exact du promoteur : passer la fraîcheur de 10 à 3.
      prisma.searchRankingRule.findMany.mockResolvedValue([
        ...BAREME_VALIDE.filter(
          (r) => r.criterion !== SearchCriterion.FRESHNESS,
        ),
        {
          criterion: SearchCriterion.FRESHNESS,
          weight: 3,
          countryCode: ALL_COUNTRIES,
        },
      ]);

      const poids = await service.weightsFor('CM');
      const fraiche = service.score(offre(), candidat(), poids, MAINTENANT);
      const fraicheur = fraiche.breakdown.find(
        (b) => b.criterion === SearchCriterion.FRESHNESS,
      )!;

      expect(fraicheur.weight).toBe(3);
      expect(fraicheur.points).toBe(3);
    });

    it('le pays précis l’emporte sur le joker', async () => {
      prisma.searchRankingRule.findMany.mockResolvedValue([
        ...BAREME_VALIDE,
        { criterion: SearchCriterion.FRESHNESS, weight: 40, countryCode: 'SN' },
      ]);

      const poids = await service.weightsFor('SN');
      expect(poids[SearchCriterion.FRESHNESS]).toBe(40);
    });

    it('signale un barème qui ne fait pas 100, sans le normaliser en silence', async () => {
      const avertir = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      prisma.searchRankingRule.findMany.mockResolvedValue([
        {
          criterion: SearchCriterion.SKILL_MATCH,
          weight: 50,
          countryCode: ALL_COUNTRIES,
        },
      ]);
      const poids = await service.weightsFor('CM');

      // On NE corrige PAS : corriger en silence cacherait son erreur à celui
      // qui l'a saisie.
      expect(poids[SearchCriterion.SKILL_MATCH]).toBe(50);
      expect(avertir).toHaveBeenCalled();
    });

    it('avertit quand la table est vide et que le secours s’applique', async () => {
      const avertir = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      prisma.searchRankingRule.findMany.mockResolvedValue([]);
      await service.weightsFor('CM');

      // Un classement qui tourne sur un barème fantôme doit se voir.
      expect(avertir).toHaveBeenCalled();
    });
  });

  // --- 2. REPRODUCTIBILITÉ ---------------------------------------------------
  it('rend EXACTEMENT le même score pour les mêmes entrées', async () => {
    const poids = await service.weightsFor('CM');
    const premier = service.score(offre(), candidat(), poids, MAINTENANT);

    for (let i = 0; i < 5; i++) {
      const suivant = service.score(offre(), candidat(), poids, MAINTENANT);
      expect(suivant.score).toBe(premier.score);
      expect(suivant.breakdown).toEqual(premier.breakdown);
    }
  });

  // --- 3. LES SIX CRITÈRES ---------------------------------------------------
  describe('compétences (35)', () => {
    it('une compétence EXIGÉE pèse le double d’une compétence appréciée', async () => {
      const poids = await service.weightsFor('CM');

      // L'offre demande une compétence exigée et une appréciée ; le candidat
      // n'a que l'appréciée. Poids : 1 obtenu sur 3 (2 pour l'exigée).
      const partiel = service.score(
        offre({
          skills: [
            { skillId: 'java', required: true },
            { skillId: 'git', required: false },
          ],
        }),
        candidat({ skillIds: ['git'] }),
        poids,
        MAINTENANT,
      );

      const critere = partiel.breakdown.find(
        (b) => b.criterion === SearchCriterion.SKILL_MATCH,
      )!;
      expect(critere.raw).toBeCloseTo(1 / 3, 3);
    });

    it('vaut zéro sans profil — un visiteur anonyme n’est pas pénalisé, il est neutre', async () => {
      const poids = await service.weightsFor('CM');
      const anonyme = service.score(
        offre({ skills: [{ skillId: 'java', required: true }] }),
        null,
        poids,
        MAINTENANT,
      );

      expect(
        anonyme.breakdown.find(
          (b) => b.criterion === SearchCriterion.SKILL_MATCH,
        )!.points,
      ).toBe(0);
      // Et il obtient quand même un score, par la fraîcheur.
      expect(anonyme.score).toBeGreaterThan(0);
    });
  });

  describe('métier (25)', () => {
    it('correspondance exacte : plein', async () => {
      const poids = await service.weightsFor('CM');
      const exact = service.score(offre(), candidat(), poids, MAINTENANT);
      expect(
        exact.breakdown.find(
          (b) => b.criterion === SearchCriterion.OCCUPATION_MATCH,
        )!.points,
      ).toBe(25);
    });

    it('même FAMILLE : correspondance partielle', async () => {
      const poids = await service.weightsFor('CM');
      // C'est ce qui évitera qu'un développeur mobile ne voie que du mobile.
      const voisin = service.score(
        offre({ occupationId: 'devops' }),
        candidat(),
        poids,
        MAINTENANT,
      );
      const critere = voisin.breakdown.find(
        (b) => b.criterion === SearchCriterion.OCCUPATION_MATCH,
      )!;
      expect(critere.raw).toBe(0.6);
      expect(critere.points).toBe(15);
    });
  });

  describe('localisation (15)', () => {
    it('même ville : plein', async () => {
      const poids = await service.weightsFor('CM');
      const ici = service.score(offre(), candidat(), poids, MAINTENANT);
      expect(
        ici.breakdown.find(
          (b) => b.criterion === SearchCriterion.LOCATION_MATCH,
        )!.points,
      ).toBe(15);
    });

    it('une offre À DISTANCE n’est pas pénalisée par la géographie', async () => {
      const poids = await service.weightsFor('CM');
      const distant = service.score(
        offre({ workMode: 'REMOTE', city: 'Dakar', country: 'SN' }),
        candidat(),
        poids,
        MAINTENANT,
      );
      expect(
        distant.breakdown.find(
          (b) => b.criterion === SearchCriterion.LOCATION_MATCH,
        )!.raw,
      ).toBe(0.8);
    });
  });

  describe('niveau d’études (10)', () => {
    it('une offre qui n’exige RIEN n’exclut personne', async () => {
      const poids = await service.weightsFor('CM');
      // Le contraire pénaliserait les entreprises qui ne remplissent pas le
      // champ, et avec elles les candidats qui postulent chez elles.
      const sansExigence = service.score(
        offre({ minEducationLevel: null }),
        candidat({ educationLevel: null }),
        poids,
        MAINTENANT,
      );
      expect(
        sansExigence.breakdown.find(
          (b) => b.criterion === SearchCriterion.EDUCATION_MATCH,
        )!.points,
      ).toBe(10);
    });

    it('au-dessus du niveau demandé : plein', async () => {
      const poids = await service.weightsFor('CM');
      const surqualifie = service.score(
        offre({ minEducationLevel: EducationLevel.BAC }),
        candidat({ educationLevel: EducationLevel.BAC_PLUS_5 }),
        poids,
        MAINTENANT,
      );
      expect(
        surqualifie.breakdown.find(
          (b) => b.criterion === SearchCriterion.EDUCATION_MATCH,
        )!.raw,
      ).toBe(1);
    });

    it('en dessous : décroissance douce, jamais exclusion', async () => {
      const poids = await service.weightsFor('CM');
      const enDessous = service.score(
        offre({ minEducationLevel: EducationLevel.BAC_PLUS_5 }),
        candidat({ educationLevel: EducationLevel.BAC_PLUS_3 }),
        poids,
        MAINTENANT,
      );
      const critere = enDessous.breakdown.find(
        (b) => b.criterion === SearchCriterion.EDUCATION_MATCH,
      )!;
      // Il manque un an d'études, pas une qualification.
      expect(critere.raw).toBeGreaterThan(0);
      expect(critere.raw).toBeLessThan(1);
    });
  });

  describe('disponibilité (5)', () => {
    it('sans date déclarée, on suppose disponible', async () => {
      const poids = await service.weightsFor('CM');
      // Le contraire punirait celui qui n'a pas rempli un champ facultatif.
      const sansDate = service.score(
        offre(),
        candidat({ availableFrom: null }),
        poids,
        MAINTENANT,
      );
      expect(
        sansDate.breakdown.find(
          (b) => b.criterion === SearchCriterion.AVAILABILITY_MATCH,
        )!.points,
      ).toBe(5);
    });
  });

  describe('fraîcheur (10)', () => {
    it('pleine valeur le jour même', async () => {
      const poids = await service.weightsFor('CM');
      const aujourdhui = service.score(offre(), candidat(), poids, MAINTENANT);
      expect(
        aujourdhui.breakdown.find(
          (b) => b.criterion === SearchCriterion.FRESHNESS,
        )!.points,
      ).toBe(10);
    });

    it('une offre de six mois ne concurrence plus une offre d’hier', async () => {
      const poids = await service.weightsFor('CM');
      const vieille = service.score(
        offre({ publishedAt: new Date('2026-02-07T12:00:00Z') }),
        candidat(),
        poids,
        MAINTENANT,
      );
      // Au-delà de l'horizon de 90 jours, la fraîcheur ne rapporte plus rien.
      expect(
        vieille.breakdown.find(
          (b) => b.criterion === SearchCriterion.FRESHNESS,
        )!.points,
      ).toBe(0);
    });

    it('ne porte AUCUNE raison de correspondance', async () => {
      const poids = await service.weightsFor('CM');
      const resultat = service.score(offre(), candidat(), poids, MAINTENANT);
      // « Cette offre vous correspond car elle est récente » n'est pas une
      // correspondance : c'est une propriété de l'offre.
      expect(
        resultat.breakdown.find(
          (b) => b.criterion === SearchCriterion.FRESHNESS,
        )!.reason,
      ).toBeUndefined();
    });
  });

  // --- LES RAISONS -----------------------------------------------------------
  describe('raisons de correspondance', () => {
    it('rend des CODES, jamais des phrases', async () => {
      const poids = await service.weightsFor('CM');
      const resultat = service.score(
        offre({ skills: [{ skillId: 'java', required: true }] }),
        candidat({ skillIds: ['java'] }),
        poids,
        MAINTENANT,
      );

      // L'application existe en cinq langues : une phrase construite ici
      // arriverait en français à un utilisateur arabophone.
      expect(resultat.matchReasons).toContain('SKILLS');
      expect(resultat.matchReasons).toContain('LOCATION');
      for (const raison of resultat.matchReasons) {
        expect(raison).toMatch(/^[A-Z_]+$/);
      }
    });

    it('n’annonce une raison que si la correspondance est réelle', async () => {
      const poids = await service.weightsFor('CM');
      const ailleurs = service.score(
        offre({ city: 'Dakar', country: 'SN' }),
        candidat(),
        poids,
        MAINTENANT,
      );
      // Dire « votre ville correspond » quand elle ne correspond pas ruinerait
      // la confiance dans toutes les autres raisons.
      expect(ailleurs.matchReasons).not.toContain('LOCATION');
    });
  });

  it('le score total ne dépasse jamais 100', async () => {
    const poids = await service.weightsFor('CM');
    const parfait = service.score(
      offre({
        skills: [{ skillId: 'java', required: true }],
        minEducationLevel: EducationLevel.BAC,
      }),
      candidat({ skillIds: ['java'] }),
      poids,
      MAINTENANT,
    );
    expect(parfait.score).toBeLessThanOrEqual(100);
    expect(parfait.score).toBe(100);
  });
});
