import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SearchCriterion } from '../../generated/prisma/enums';
import { AuditService, diffOf } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_COUNTRIES } from './relevance-scoring.service';
// La normalisation est celle de la RECHERCHE : le back-office doit écrire les
// synonymes exactement sous la forme que la requête ira chercher. Une fonction
// séparée ici et là, c'est la garantie qu'un jour elles divergeront.
import { normalizeTerm } from './query-expansion';
import {
  CreateOccupationDto,
  CreateSkillDto,
  CreateSynonymDto,
  UpdateRankingRuleDto,
} from './dto/search-admin.dto';

// Réexportée : elle se décide dans `query-expansion`, mais c'est ici qu'on la
// lit naturellement en cherchant comment un synonyme est enregistré.
export { normalizeTerm };

// ============================================================================
// BACK-OFFICE DE LA RECHERCHE
//
// Arbitrage du promoteur, 2026-08-07 : « un administrateur peut modifier le
// poids de la fraîcheur de 5 à 3 sans redéployer l'application. Chaque
// modification est historisée. »
//
// TROIS RESPONSABILITÉS, et une règle qui les traverse toutes :
//
//   — les RÉFÉRENTIELS (compétences, métiers) : on désactive, on ne supprime
//     jamais. Une compétence citée par mille profils ne peut pas disparaître
//     sans les rendre incohérents — `onDelete: Restrict` l'interdit d'ailleurs
//     en base.
//   — les SYNONYMES : normalisés à l'écriture, pour que « R.H. » et « rh »
//     soient reconnus comme la même chose.
//   — les PONDÉRATIONS : modifiables, et chaque modification écrit son
//     ancienne et sa nouvelle valeur au journal d'audit.
//
// POURQUOI L'AUDIT COMPTE ICI PLUS QU'AILLEURS. Le classement est ce que la
// plateforme promet de ne pas manipuler. Le jour où quelqu'un affirmera qu'une
// pondération a été changée pour favoriser un annonceur, la seule réponse
// acceptable sera l'historique : qui, quand, de combien à combien, et pourquoi.
// ============================================================================
@Injectable()
export class SearchAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Pondérations ---------------------------------------------------------

  listRankingRules() {
    return this.prisma.searchRankingRule.findMany({
      orderBy: [{ countryCode: 'asc' }, { weight: 'desc' }],
    });
  }

  // Le poids d'un critère. La modification la plus sensible du module.
  async updateRankingRule(
    adminUserId: string,
    criterion: SearchCriterion,
    dto: UpdateRankingRuleDto,
  ) {
    // Pas de pays = le barème global. Une valeur réelle ('*'), pas un NULL :
    // Prisma refuse un NULL dans une clef unique composée, et l'index unique
    // de PostgreSQL ne mord pas dessus. Le back-office aurait donc créé un
    // doublon global à chaque modification, au lieu de mettre à jour.
    const countryCode = dto.countryCode ?? ALL_COUNTRIES;

    const courant = await this.prisma.searchRankingRule.findUnique({
      where: { criterion_countryCode: { criterion, countryCode } },
    });

    const rule = courant
      ? await this.prisma.searchRankingRule.update({
          where: { id: courant.id },
          data: {
            weight: dto.weight,
            isActive: dto.isActive ?? courant.isActive,
            updatedById: adminUserId,
          },
        })
      : await this.prisma.searchRankingRule.create({
          data: {
            criterion,
            countryCode,
            weight: dto.weight,
            isActive: dto.isActive ?? true,
            updatedById: adminUserId,
          },
        });

    // L'HISTORISATION. Ancienne valeur, nouvelle valeur, auteur, date — et la
    // justification, obligatoire : une pondération qui change sans raison écrite
    // est exactement ce qu'on ne saura pas défendre.
    await this.audit.recordChange('SEARCH_RANKING_RULE_UPDATED', adminUserId, {
      entityType: 'SearchRankingRule',
      entityId: rule.id,
      changes: diffOf(
        {
          weight: courant?.weight ?? null,
          isActive: courant?.isActive ?? null,
        },
        { weight: rule.weight, isActive: rule.isActive },
      ),
      metadata: {
        criterion,
        countryCode,
        reason: dto.reason,
        // Le total APRÈS modification : c'est le chiffre qu'on voudra relire
        // pour comprendre pourquoi les scores d'un pays ont bougé.
        totalApres: await this.totalWeight(countryCode),
      },
    });

    return rule;
  }

  private async totalWeight(countryCode: string): Promise<number> {
    const rules = await this.prisma.searchRankingRule.findMany({
      where: { isActive: true, countryCode },
    });
    return rules.reduce((somme, rule) => somme + rule.weight, 0);
  }

  // --- Compétences ----------------------------------------------------------

  listSkills(includeInactive = false) {
    return this.prisma.skill.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ category: 'asc' }, { labelFr: 'asc' }],
    });
  }

  async createSkill(adminUserId: string, dto: CreateSkillDto) {
    const existant = await this.prisma.skill.findUnique({
      where: { code: dto.code },
    });
    if (existant) {
      throw new ConflictException(
        `Une compétence porte déjà le code « ${dto.code} ». Ajoutez plutôt un synonyme si c'est une variante.`,
      );
    }

    const skill = await this.prisma.skill.create({
      data: { ...dto, createdById: adminUserId },
    });

    await this.audit.recordChange('SEARCH_SKILL_CREATED', adminUserId, {
      entityType: 'Skill',
      entityId: skill.id,
      metadata: { code: skill.code, category: skill.category },
    });

    return skill;
  }

  // On DÉSACTIVE, on ne supprime jamais : une compétence citée par mille
  // profils ne peut pas disparaître sans les rendre incohérents.
  async deactivateSkill(adminUserId: string, skillId: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { id: skillId },
    });
    if (!skill) throw new NotFoundException('Compétence introuvable.');

    const updated = await this.prisma.skill.update({
      where: { id: skillId },
      data: { isActive: false },
    });

    await this.audit.recordChange('SEARCH_SKILL_DEACTIVATED', adminUserId, {
      entityType: 'Skill',
      entityId: skillId,
      changes: diffOf({ isActive: true }, { isActive: false }),
      metadata: { code: skill.code },
    });

    return updated;
  }

  // --- Métiers --------------------------------------------------------------

  listOccupations(includeInactive = false) {
    return this.prisma.occupation.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ parentId: 'asc' }, { labelFr: 'asc' }],
    });
  }

  async createOccupation(adminUserId: string, dto: CreateOccupationDto) {
    const existant = await this.prisma.occupation.findUnique({
      where: { code: dto.code },
    });
    if (existant) {
      throw new ConflictException(
        `Un métier porte déjà le code « ${dto.code} ».`,
      );
    }

    if (dto.parentCode) {
      const parent = await this.prisma.occupation.findUnique({
        where: { code: dto.parentCode },
      });
      if (!parent) {
        throw new NotFoundException(
          `Le métier parent « ${dto.parentCode} » n'existe pas.`,
        );
      }
      // Un arbre à deux niveaux suffit et se comprend : famille, puis métier.
      // Une hiérarchie profonde rendrait la correspondance « même famille »
      // arbitraire — à quelle profondeur s'arrête-t-on ?
      if (parent.parentId) {
        throw new ConflictException(
          'La hiérarchie des métiers compte deux niveaux : une famille et ses métiers.',
        );
      }
    }

    const parent = dto.parentCode
      ? await this.prisma.occupation.findUnique({
          where: { code: dto.parentCode },
        })
      : null;

    const occupation = await this.prisma.occupation.create({
      data: {
        code: dto.code,
        labelFr: dto.labelFr,
        labelEn: dto.labelEn,
        labelEs: dto.labelEs,
        labelAr: dto.labelAr,
        labelPt: dto.labelPt,
        parentId: parent?.id ?? null,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('SEARCH_OCCUPATION_CREATED', adminUserId, {
      entityType: 'Occupation',
      entityId: occupation.id,
      metadata: { code: occupation.code, parentCode: dto.parentCode ?? null },
    });

    return occupation;
  }

  // --- Synonymes ------------------------------------------------------------

  listSynonyms(includeInactive = false) {
    return this.prisma.searchSynonym.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { termNormalized: 'asc' },
    });
  }

  async createSynonym(adminUserId: string, dto: CreateSynonymDto) {
    const termNormalized = normalizeTerm(dto.term);
    if (!termNormalized) {
      throw new ConflictException(
        'Ce terme ne contient aucun caractère comparable.',
      );
    }

    const existant = await this.prisma.searchSynonym.findUnique({
      where: { termNormalized },
    });
    if (existant) {
      throw new ConflictException(
        `« ${dto.term} » est déjà enregistré (il se normalise en « ${termNormalized} », comme une variante existante).`,
      );
    }

    const synonym = await this.prisma.searchSynonym.create({
      data: {
        termNormalized,
        canonical: dto.canonical,
        skillId: dto.skillId ?? null,
        occupationId: dto.occupationId ?? null,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('SEARCH_SYNONYM_CREATED', adminUserId, {
      entityType: 'SearchSynonym',
      entityId: synonym.id,
      metadata: { termNormalized, canonical: dto.canonical },
    });

    return synonym;
  }

  async deactivateSynonym(adminUserId: string, synonymId: string) {
    const synonym = await this.prisma.searchSynonym.findUnique({
      where: { id: synonymId },
    });
    if (!synonym) throw new NotFoundException('Synonyme introuvable.');

    const updated = await this.prisma.searchSynonym.update({
      where: { id: synonymId },
      data: { isActive: false },
    });

    await this.audit.record('SEARCH_SYNONYM_DEACTIVATED', adminUserId, {
      synonymId,
      termNormalized: synonym.termNormalized,
    });

    return updated;
  }
}
