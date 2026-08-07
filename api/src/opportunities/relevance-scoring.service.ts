import { Injectable, Logger } from '@nestjs/common';
import { EducationLevel, SearchCriterion } from '../../generated/prisma/enums';
import { ALL_COUNTRIES } from '../common/country-scope';
import { PrismaService } from '../prisma/prisma.service';

// Réexporté : le périmètre « tous pays » se décide dans common/country-scope,
// mais les appelants du moteur le lisent naturellement ici.
export { ALL_COUNTRIES };

// ============================================================================
// MOTEUR DE PERTINENCE
//
// Arbitrage du promoteur, 2026-08-07 : « recherche par pertinence seule, sans
// sponsoring ni mise en avant payante », et « le score numérique ne doit être
// affiché ni aux candidats ni aux entreprises ».
//
// TROIS RÈGLES GOUVERNENT CE FICHIER.
//
// 1. AUCUNE PONDÉRATION CODÉE EN DUR. Les poids viennent de `SearchRankingRule`,
//    en base, modifiables sans redéploiement et historisés par l'audit. Le seul
//    nombre écrit ici est le barème de SECOURS, utilisé si la table est vide —
//    et il est signalé au journal, pas appliqué en silence.
//
// 2. LE SCORE NE SORT PAS. Ce service rend un ordre et des RAISONS ; le nombre
//    reste interne. « Le candidat finirait par vouloir jouer l'algorithme. »
//    C'est `search()` qui décide ce qui franchit la frontière, et il ne laisse
//    passer que `matchReasons`.
//
// 3. AUCUN CRITÈRE DE MISE EN AVANT. Il n'existe pas de champ `featured`,
//    `promoted`, `sponsored`, `boost`, `priorityScore`, `paidRank` ni
//    `premiumRank` — ni dans le schéma, ni ici. `no-sponsored-ranking.spec.ts`
//    le vérifie sur le schéma ET sur ce fichier.
//
// LE PROFIL EST « CONFIDENTIEL » (CLAUDE.md §1) : il entre dans le calcul, il
// ne ressort jamais. On rend un ordre, pas les raisons personnelles de cet ordre
// — sauf sous la forme de motifs génériques, qui ne réapprennent rien à celui
// qui les lit sur lui-même.
// ============================================================================

// Barème de SECOURS. N'est utilisé que si `SearchRankingRule` est vide — cas qui
// ne devrait pas se produire, la migration l'ayant semé. Il est journalisé en
// avertissement : un classement qui tourne sur un barème fantôme doit se voir.
const FALLBACK_WEIGHTS: Record<SearchCriterion, number> = {
  [SearchCriterion.SKILL_MATCH]: 35,
  [SearchCriterion.OCCUPATION_MATCH]: 25,
  [SearchCriterion.LOCATION_MATCH]: 15,
  [SearchCriterion.EDUCATION_MATCH]: 10,
  [SearchCriterion.AVAILABILITY_MATCH]: 5,
  [SearchCriterion.FRESHNESS]: 10,
};

// Échelle des niveaux d'études. Un ordre, pas des libellés : c'est ce qui permet
// de dire « ce candidat atteint le niveau demandé ».
const EDUCATION_RANK: Record<EducationLevel, number> = {
  [EducationLevel.NONE]: 0,
  [EducationLevel.SECONDARY]: 1,
  [EducationLevel.BAC]: 2,
  [EducationLevel.BAC_PLUS_2]: 3,
  [EducationLevel.BAC_PLUS_3]: 4,
  [EducationLevel.BAC_PLUS_5]: 5,
  [EducationLevel.DOCTORATE]: 6,
};

// Décroissance de la fraîcheur : pleine valeur le premier jour, nulle à 90
// jours. Linéaire, donc explicable — une exponentielle serait plus élégante et
// beaucoup moins facile à justifier devant quelqu'un qui conteste son rang.
const FRESHNESS_HORIZON_DAYS = 90;

@Injectable()
export class RelevanceScoringService {
  private readonly logger = new Logger(RelevanceScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Les poids EN VIGUEUR pour un pays. Lus à chaque recherche : un
  // administrateur qui ajuste la fraîcheur doit le voir à la requête suivante,
  // pas au prochain redémarrage.
  async weightsFor(
    countryCode?: string,
  ): Promise<Record<SearchCriterion, number>> {
    const rules = await this.prisma.searchRankingRule.findMany({
      where: {
        isActive: true,
        OR: [
          { countryCode: ALL_COUNTRIES },
          ...(countryCode ? [{ countryCode }] : []),
        ],
      },
    });

    if (rules.length === 0) {
      this.logger.warn(
        'Aucune règle de pondération active : le barème de secours s’applique. ' +
          'Le classement tourne sur des valeurs qui ne sont pas celles de la base.',
      );
      return { ...FALLBACK_WEIGHTS };
    }

    // Le pays précis l'emporte sur le joker, comme partout ailleurs.
    const weights = { ...FALLBACK_WEIGHTS };
    for (const rule of rules.filter((r) => r.countryCode === ALL_COUNTRIES)) {
      weights[rule.criterion] = rule.weight;
    }
    for (const rule of rules.filter((r) => r.countryCode === countryCode)) {
      weights[rule.criterion] = rule.weight;
    }

    // Un barème qui ne fait pas 100 est une ERREUR DE RÉGLAGE. On le signale,
    // on ne le normalise pas : corriger en silence derrière le dos de celui qui
    // l'a saisi lui cacherait sa propre erreur, et rendrait les scores
    // incomparables d'un pays à l'autre sans qu'il le sache.
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total !== 100) {
      this.logger.warn(
        `Le barème de pertinence totalise ${total} et non 100 (pays : ${countryCode ?? 'tous'}). ` +
          'Les scores restent calculables mais ne sont plus comparables entre pays.',
      );
    }

    return weights;
  }

  // ==========================================================================
  // LE CALCUL
  //
  // Chaque critère rend une valeur BRUTE entre 0 et 1, multipliée par son poids.
  // Cette séparation est ce qui rend le score explicable : « vous avez 20 points
  // sur 25 au critère métier » se comprend ; « votre score est 72,4 » ne se
  // comprend pas.
  // ==========================================================================
  score(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
    weights: Record<SearchCriterion, number>,
    now = new Date(),
  ): ScoreResult {
    const breakdown: CriterionScore[] = [];

    const add = (
      criterion: SearchCriterion,
      raw: number,
      why?: MatchReason,
    ) => {
      const bounded = Math.max(0, Math.min(1, raw));
      breakdown.push({
        criterion,
        raw: Number(bounded.toFixed(4)),
        weight: weights[criterion],
        points: Number((bounded * weights[criterion]).toFixed(2)),
        ...(why && bounded > 0 ? { reason: why } : {}),
      });
    };

    // --- Compétences (35) ---------------------------------------------------
    // Les compétences EXIGÉES pèsent le double des compétences appréciées : ne
    // pas avoir un « plus » n'est pas la même chose que manquer un prérequis.
    add(
      SearchCriterion.SKILL_MATCH,
      this.skillMatch(opportunity, candidate),
      'SKILLS',
    );

    // --- Métier (25) --------------------------------------------------------
    // Correspondance exacte, ou par la famille : quelqu'un qui vise le
    // développement mobile doit voir passer du développement web.
    add(
      SearchCriterion.OCCUPATION_MATCH,
      this.occupationMatch(opportunity, candidate),
      'OCCUPATION',
    );

    // --- Localisation (15) --------------------------------------------------
    add(
      SearchCriterion.LOCATION_MATCH,
      this.locationMatch(opportunity, candidate),
      'LOCATION',
    );

    // --- Niveau d'études (10) -----------------------------------------------
    add(
      SearchCriterion.EDUCATION_MATCH,
      this.educationMatch(opportunity, candidate),
      'EDUCATION',
    );

    // --- Disponibilité (5) --------------------------------------------------
    add(
      SearchCriterion.AVAILABILITY_MATCH,
      this.availabilityMatch(opportunity, candidate),
      'AVAILABILITY',
    );

    // --- Fraîcheur (10) -----------------------------------------------------
    // Ne porte AUCUNE raison : « cette offre vous correspond car elle est
    // récente » n'est pas une correspondance, c'est une propriété de l'offre.
    add(SearchCriterion.FRESHNESS, this.freshness(opportunity, now));

    const total = breakdown.reduce((sum, entry) => sum + entry.points, 0);

    return {
      score: Number(total.toFixed(2)),
      breakdown,
      // LES RAISONS, et elles seules, franchiront la frontière vers le candidat.
      matchReasons: breakdown
        .filter((entry) => entry.reason && entry.raw >= 0.5)
        .map((entry) => entry.reason!),
    };
  }

  // --- Les six critères -----------------------------------------------------

  private skillMatch(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
  ): number {
    if (!candidate || opportunity.skills.length === 0) return 0;

    const mine = new Set(candidate.skillIds);
    let obtenus = 0;
    let total = 0;

    for (const skill of opportunity.skills) {
      // Une compétence exigée compte double, à l'obtention comme au total :
      // manquer un prérequis coûte plus cher que manquer un « plus ».
      const poids = skill.required ? 2 : 1;
      total += poids;
      if (mine.has(skill.skillId)) obtenus += poids;
    }

    return total === 0 ? 0 : obtenus / total;
  }

  private occupationMatch(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
  ): number {
    if (!candidate?.targetOccupationId || !opportunity.occupationId) return 0;
    if (candidate.targetOccupationId === opportunity.occupationId) return 1;

    // Même famille : correspondance partielle. C'est ce qui empêchera un
    // étudiant en informatique de ne voir que du développement web, alors que
    // le DevOps, la cybersécurité ou la donnée pourraient l'intéresser.
    if (
      candidate.occupationFamilyId &&
      opportunity.occupationFamilyId &&
      candidate.occupationFamilyId === opportunity.occupationFamilyId
    ) {
      return 0.6;
    }
    return 0;
  }

  private locationMatch(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
  ): number {
    if (!candidate) return 0;

    const memeVille =
      candidate.city &&
      opportunity.city.toLowerCase() === candidate.city.toLowerCase();
    if (memeVille) return 1;

    const memePays =
      candidate.country &&
      opportunity.country.toLowerCase() === candidate.country.toLowerCase();
    if (memePays) return 0.5;

    // Une offre à distance est partout : la géographie ne devrait pas la
    // pénaliser.
    if (opportunity.workMode === 'REMOTE') return 0.8;

    return 0;
  }

  private educationMatch(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
  ): number {
    // Une offre qui n'exige rien n'exclut personne : pleine valeur. Le contraire
    // pénaliserait les entreprises qui ne remplissent pas le champ, et avec
    // elles les candidats qui postulent chez elles.
    if (!opportunity.minEducationLevel) return 1;
    if (!candidate?.educationLevel) return 0;

    const exige = EDUCATION_RANK[opportunity.minEducationLevel];
    const atteint = EDUCATION_RANK[candidate.educationLevel];

    if (atteint >= exige) return 1;
    // En dessous : décroissance douce plutôt qu'exclusion. Il manque un an
    // d'études, pas une qualification.
    return Math.max(0, 1 - (exige - atteint) * 0.34);
  }

  private availabilityMatch(
    opportunity: ScorableOpportunity,
    candidate: CandidateContext | null,
  ): number {
    // Sans date déclarée, on suppose disponible : l'hypothèse la plus favorable
    // au candidat, faute de mieux. Le contraire punirait celui qui n'a pas
    // rempli un champ facultatif.
    if (!candidate?.availableFrom) return 1;
    if (!opportunity.startsAt) return 1;
    return candidate.availableFrom <= opportunity.startsAt ? 1 : 0;
  }

  private freshness(opportunity: ScorableOpportunity, now: Date): number {
    if (!opportunity.publishedAt) return 0;
    const jours =
      (now.getTime() - opportunity.publishedAt.getTime()) / 86_400_000;
    if (jours <= 0) return 1;
    return Math.max(0, 1 - jours / FRESHNESS_HORIZON_DAYS);
  }
}

// --- Types ------------------------------------------------------------------

export interface ScorableOpportunity {
  id: string;
  city: string;
  country: string;
  workMode: string;
  sector: string;
  publishedAt: Date | null;
  startsAt?: Date | null;
  occupationId: string | null;
  occupationFamilyId?: string | null;
  minEducationLevel: EducationLevel | null;
  skills: { skillId: string; required: boolean }[];
}

// Ce que le moteur sait du candidat. Volontairement RÉDUIT à ce qui sert au
// calcul : ni nom, ni téléphone, ni identifiant de compte. Un moteur de
// classement n'a pas besoin de savoir QUI il classe.
export interface CandidateContext {
  skillIds: string[];
  targetOccupationId: string | null;
  occupationFamilyId: string | null;
  city: string | null;
  country: string | null;
  educationLevel: EducationLevel | null;
  availableFrom: Date | null;
}

// Motifs de correspondance — ce que le candidat verra, sous forme de CODES que
// l'application traduit dans sa langue. Jamais de phrase construite ici :
// l'application existe en cinq langues.
export type MatchReason =
  'SKILLS' | 'OCCUPATION' | 'LOCATION' | 'EDUCATION' | 'AVAILABILITY';

export interface CriterionScore {
  criterion: SearchCriterion;
  raw: number;
  weight: number;
  points: number;
  reason?: MatchReason;
}

export interface ScoreResult {
  score: number;
  breakdown: CriterionScore[];
  matchReasons: MatchReason[];
}
