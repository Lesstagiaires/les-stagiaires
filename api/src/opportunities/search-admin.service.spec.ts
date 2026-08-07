import { ConflictException, NotFoundException } from '@nestjs/common';
import { SearchCriterion } from '../../generated/prisma/enums';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ALL_COUNTRIES } from './relevance-scoring.service';
import { SearchAdminService, normalizeTerm } from './search-admin.service';

// ============================================================================
// BACK-OFFICE DE LA RECHERCHE
//
// Ce qui est réellement en jeu ici : le classement est ce que la plateforme
// promet de ne pas manipuler. Les tests qui suivent portent donc moins sur le
// bon fonctionnement du CRUD que sur trois garanties :
//
//   1. UNE MODIFICATION DE PONDÉRATION MET À JOUR, elle ne duplique pas. Deux
//      règles actives pour le même critère rendraient le classement dépendant
//      de l'ordre de lecture — irreproductible, et invisible à l'audit.
//   2. CHAQUE MODIFICATION LAISSE UNE TRACE complète : ancienne valeur,
//      nouvelle valeur, auteur, justification.
//   3. LES RÉFÉRENTIELS NE SE SUPPRIMENT PAS. On désactive.
// ============================================================================
describe('Back-office de la recherche', () => {
  let prisma: {
    searchRankingRule: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    skill: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    occupation: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    searchSynonym: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let audit: { record: jest.Mock; recordChange: jest.Mock };
  let service: SearchAdminService;

  const ADMIN = 'user_admin_1';

  // Ce que le journal a réellement reçu, typé — plutôt qu'un `objectContaining`
  // qui se contente de « il y a au moins ça dedans ». Sur une écriture d'audit,
  // la question posée est justement : qu'est-ce qui a été écrit, exactement ?
  interface EcritureAudit {
    entityType?: string;
    entityId?: string;
    changes?: { field: string; oldValue: unknown; newValue: unknown }[];
    metadata: Record<string, unknown>;
  }

  // Le premier argument passé à un mock, typé par l'appelant.
  function premierArgument<T>(mock: jest.Mock): T {
    const appels = mock.mock.calls as unknown[][];
    expect(appels.length).toBeGreaterThan(0);
    return appels[0][0] as T;
  }

  function derniereEcritureAudit(): [string, string, EcritureAudit] {
    const appels = audit.recordChange.mock.calls as unknown[][];
    expect(appels.length).toBeGreaterThan(0);
    const dernier = appels[appels.length - 1];
    return [
      dernier[0] as string,
      dernier[1] as string,
      dernier[2] as EcritureAudit,
    ];
  }

  const REGLE_EXISTANTE = {
    id: 'srr_freshness',
    criterion: SearchCriterion.FRESHNESS,
    weight: 10,
    countryCode: ALL_COUNTRIES,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      searchRankingRule: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
      },
      skill: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      occupation: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      searchSynonym: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    audit = { record: jest.fn(), recordChange: jest.fn() };
    service = new SearchAdminService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  // --------------------------------------------------------------------------
  // 1. LES PONDÉRATIONS
  // --------------------------------------------------------------------------
  describe('Pondérations', () => {
    // LE TEST QUI COMPTE LE PLUS DE CE FICHIER.
    //
    // Sans pays, le barème visé est le barème GLOBAL. Il doit être retrouvé —
    // donc mis à jour. Le bogue corrigé le 2026-08-07 était exactement là : le
    // barème global était identifié par NULL, PostgreSQL ne l'indexait pas, et
    // Prisma refusait de le relire. Chaque « modification » créait une règle de
    // plus. Deux SKILL_MATCH actifs, et le classement change selon l'ordre de
    // lecture — sans qu'aucune ligne d'audit ne montre de modification.
    it('modifie la règle globale au lieu d’en créer une deuxième', async () => {
      prisma.searchRankingRule.findUnique.mockResolvedValue(REGLE_EXISTANTE);
      prisma.searchRankingRule.update.mockResolvedValue({
        ...REGLE_EXISTANTE,
        weight: 3,
      });

      await service.updateRankingRule(ADMIN, SearchCriterion.FRESHNESS, {
        weight: 3,
        reason: 'Les offres restent pertinentes plus longtemps qu’estimé.',
      });

      // Le joker est une valeur réelle, jamais NULL : c'est ce qui permet à
      // l'index unique de PostgreSQL de mordre.
      expect(prisma.searchRankingRule.findUnique).toHaveBeenCalledWith({
        where: {
          criterion_countryCode: {
            criterion: SearchCriterion.FRESHNESS,
            countryCode: ALL_COUNTRIES,
          },
        },
      });
      expect(prisma.searchRankingRule.update).toHaveBeenCalled();
      expect(prisma.searchRankingRule.create).not.toHaveBeenCalled();
    });

    // « Un administrateur peut modifier le poids de la fraîcheur de 5 à 3 sans
    // redéployer l'application. » Le service écrit en base — il ne touche à
    // aucune constante du code.
    it('écrit le nouveau poids en base', async () => {
      prisma.searchRankingRule.findUnique.mockResolvedValue(REGLE_EXISTANTE);
      prisma.searchRankingRule.update.mockResolvedValue({
        ...REGLE_EXISTANTE,
        weight: 3,
      });

      await service.updateRankingRule(ADMIN, SearchCriterion.FRESHNESS, {
        weight: 3,
        reason: 'Ajustement après trois mois d’observation du marché.',
      });

      expect(prisma.searchRankingRule.update).toHaveBeenCalledWith({
        where: { id: 'srr_freshness' },
        data: { weight: 3, isActive: true, updatedById: ADMIN },
      });
    });

    it('crée la règle propre à un pays sans toucher au barème global', async () => {
      prisma.searchRankingRule.findUnique.mockResolvedValue(null);
      prisma.searchRankingRule.create.mockResolvedValue({
        id: 'srr_sn_fresh',
        criterion: SearchCriterion.FRESHNESS,
        weight: 20,
        countryCode: 'SN',
        isActive: true,
      });

      await service.updateRankingRule(ADMIN, SearchCriterion.FRESHNESS, {
        weight: 20,
        countryCode: 'SN',
        reason: 'Le marché sénégalais renouvelle ses offres plus vite.',
      });

      expect(prisma.searchRankingRule.create).toHaveBeenCalledWith({
        data: {
          criterion: SearchCriterion.FRESHNESS,
          countryCode: 'SN',
          weight: 20,
          isActive: true,
          updatedById: ADMIN,
        },
      });
      expect(prisma.searchRankingRule.update).not.toHaveBeenCalled();
    });

    // L'HISTORISATION. C'est la seule réponse possible le jour où quelqu'un
    // affirmera qu'un poids a été changé pour favoriser un annonceur.
    it('journalise l’ancienne valeur, la nouvelle et la justification', async () => {
      prisma.searchRankingRule.findUnique.mockResolvedValue(REGLE_EXISTANTE);
      prisma.searchRankingRule.update.mockResolvedValue({
        ...REGLE_EXISTANTE,
        weight: 3,
      });

      await service.updateRankingRule(ADMIN, SearchCriterion.FRESHNESS, {
        weight: 3,
        reason: 'Décision du comité produit du 7 août 2026.',
      });

      const [action, auteur, contexte] = derniereEcritureAudit();
      expect(action).toBe('SEARCH_RANKING_RULE_UPDATED');
      expect(auteur).toBe(ADMIN);
      expect(contexte.entityType).toBe('SearchRankingRule');
      expect(contexte.entityId).toBe('srr_freshness');
      expect(contexte.changes).toContainEqual({
        field: 'weight',
        oldValue: 10,
        newValue: 3,
      });
      expect(contexte.metadata.reason).toBe(
        'Décision du comité produit du 7 août 2026.',
      );
    });

    // Le total après coup est le chiffre qu'on voudra relire pour comprendre
    // pourquoi les scores d'un pays ont bougé — y compris quand le total ne
    // fait plus 100, ce que le moteur signale sans jamais le corriger.
    it('consigne le total du barème après modification', async () => {
      prisma.searchRankingRule.findUnique.mockResolvedValue(REGLE_EXISTANTE);
      prisma.searchRankingRule.update.mockResolvedValue({
        ...REGLE_EXISTANTE,
        weight: 3,
      });
      prisma.searchRankingRule.findMany.mockResolvedValue([
        { weight: 35 },
        { weight: 25 },
        { weight: 15 },
        { weight: 10 },
        { weight: 5 },
        { weight: 3 },
      ]);

      await service.updateRankingRule(ADMIN, SearchCriterion.FRESHNESS, {
        weight: 3,
        reason: 'Ajustement de la fraîcheur.',
      });

      const [, , contexte] = derniereEcritureAudit();
      expect(contexte.metadata.totalApres).toBe(93);
    });
  });

  // --------------------------------------------------------------------------
  // 2. LES COMPÉTENCES
  // --------------------------------------------------------------------------
  describe('Compétences', () => {
    const NOUVELLE = {
      code: 'JAVASCRIPT',
      labelFr: 'JavaScript',
      labelEn: 'JavaScript',
      labelEs: 'JavaScript',
      labelAr: 'جافاسكريبت',
      labelPt: 'JavaScript',
    };

    it('refuse un code déjà pris', async () => {
      prisma.skill.findUnique.mockResolvedValue({
        id: 'sk_1',
        code: 'JAVASCRIPT',
      });

      await expect(service.createSkill(ADMIN, NOUVELLE)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.skill.create).not.toHaveBeenCalled();
    });

    // On DÉSACTIVE, on ne supprime pas : une compétence citée par mille profils
    // ne peut pas disparaître sans les rendre incohérents.
    it('désactive au lieu de supprimer', async () => {
      prisma.skill.findUnique.mockResolvedValue({
        id: 'sk_1',
        code: 'JAVASCRIPT',
        isActive: true,
      });
      prisma.skill.update.mockResolvedValue({ id: 'sk_1', isActive: false });

      await service.deactivateSkill(ADMIN, 'sk_1');

      expect(prisma.skill.update).toHaveBeenCalledWith({
        where: { id: 'sk_1' },
        data: { isActive: false },
      });
      expect(
        (prisma.skill as unknown as { delete?: unknown }).delete,
      ).toBeUndefined();
    });

    it('n’expose que les compétences actives par défaut', () => {
      void service.listSkills();
      expect(prisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. LES MÉTIERS
  // --------------------------------------------------------------------------
  describe('Métiers', () => {
    const METIER = {
      code: 'DEV_WEB',
      labelFr: 'Développeur web',
      labelEn: 'Web developer',
      labelEs: 'Desarrollador web',
      labelAr: 'مطور ويب',
      labelPt: 'Desenvolvedor web',
    };

    it('rattache un métier à sa famille', async () => {
      prisma.occupation.findUnique
        .mockResolvedValueOnce(null) // le code est libre
        .mockResolvedValue({
          id: 'occ_num',
          code: 'NUMERIQUE',
          parentId: null,
        });
      prisma.occupation.create.mockResolvedValue({ id: 'occ_dev', ...METIER });

      await service.createOccupation(ADMIN, {
        ...METIER,
        parentCode: 'NUMERIQUE',
      });

      const { data } = premierArgument<{ data: { parentId: string | null } }>(
        prisma.occupation.create,
      );
      expect(data.parentId).toBe('occ_num');
    });

    // Deux niveaux, pas trois. Une hiérarchie profonde rendrait la
    // correspondance « même famille » arbitraire : à quelle profondeur
    // s'arrête-t-on ?
    it('refuse un troisième niveau de hiérarchie', async () => {
      prisma.occupation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'occ_dev',
          code: 'DEV_WEB',
          parentId: 'occ_num',
        });

      await expect(
        service.createOccupation(ADMIN, {
          ...METIER,
          code: 'DEV_FRONT',
          parentCode: 'DEV_WEB',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.occupation.create).not.toHaveBeenCalled();
    });

    it('refuse un parent inexistant', async () => {
      prisma.occupation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(null);

      await expect(
        service.createOccupation(ADMIN, { ...METIER, parentCode: 'FANTOME' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // 4. LES SYNONYMES
  // --------------------------------------------------------------------------
  describe('Synonymes', () => {
    it('normalise le terme avant de l’écrire', async () => {
      prisma.searchSynonym.create.mockResolvedValue({ id: 'syn_1' });

      await service.createSynonym(ADMIN, {
        term: 'R.H.',
        canonical: 'Ressources humaines',
      });

      const { data } = premierArgument<{ data: { termNormalized: string } }>(
        prisma.searchSynonym.create,
      );
      expect(data.termNormalized).toBe('r h');
    });

    // Deux écritures d'une même chose ne doivent pas devenir deux entrées : la
    // recherche n'en reconnaîtrait qu'une, celle que l'utilisateur n'a pas tapée.
    it('refuse une variante qui se normalise comme une entrée existante', async () => {
      prisma.searchSynonym.findUnique.mockResolvedValue({
        id: 'syn_1',
        termNormalized: 'rh',
      });

      await expect(
        service.createSynonym(ADMIN, {
          term: 'RH',
          canonical: 'Ressources humaines',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.searchSynonym.create).not.toHaveBeenCalled();
    });

    it('refuse un terme sans aucun caractère comparable', async () => {
      await expect(
        service.createSynonym(ADMIN, { term: '!!! ???', canonical: 'Stage' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  // 5. LA NORMALISATION, isolément
  // --------------------------------------------------------------------------
  describe('normalizeTerm', () => {
    it.each([
      ['Développeur', 'developpeur'],
      ['DEVELOPPEUR', 'developpeur'],
      ['R.H.', 'r h'],
      ['  Ressources   Humaines  ', 'ressources humaines'],
      ['Économie', 'economie'],
      ['!!!', ''],
    ])('« %s » → « %s »', (entree, attendu) => {
      expect(normalizeTerm(entree)).toBe(attendu);
    });
  });
});
