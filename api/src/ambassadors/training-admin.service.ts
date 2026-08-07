import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService, diffOf } from '../audit/audit.service';
import { ALL_COUNTRIES } from '../common/country-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateQuizQuestionDto,
  CreateTrainingModuleDto,
} from './dto/training-admin.dto';

// ============================================================================
// BACK-OFFICE DE LA FORMATION
//
// Ce qui manquait pour que le module serve : de quoi CRÉER les modules et les
// questions. Sans lui, le quiz n'ayant aucune question, aucun ambassadeur ne
// pouvait être activé — comportement fermé, donc sûr, mais inutilisable.
//
// DEUX PRINCIPES REPRIS DES BARÈMES DE COMMISSION, pour la même raison :
//
//   1. UN MODULE PUBLIÉ NE SE MODIFIE PAS, il se REMPLACE par une version
//      suivante. Corriger un contenu en place réécrirait l'histoire : « qu'est-ce
//      que cette personne a réellement lu en mars ? » deviendrait sans réponse,
//      et le verrou de version deviendrait décoratif.
//
//   2. RIEN NE SE SUPPRIME. Un module se désactive ; les progressions qui le
//      citent restent lisibles. `onDelete: Restrict` sur `TrainingProgress` le
//      garantit de toute façon en base.
//
// SUR LES QUESTIONS DE QUIZ. `correctIndex` est visible ici, et ne peut pas ne
// pas l'être : quelqu'un doit bien écrire les réponses. Ce niveau relève de
// l'« Interne » (CLAUDE.md §1) — accès par rôle, ADMIN avec double
// authentification. La garantie qui compte reste celle du service candidat :
// ce champ ne franchit jamais la frontière vers un non-administrateur.
// ============================================================================
@Injectable()
export class TrainingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Modules --------------------------------------------------------------

  listModules(includeInactive = false) {
    return this.prisma.trainingModule.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });
  }

  // Crée une NOUVELLE lignée de module. Pour faire évoluer un module existant,
  // utiliser `supersedeModule()` : c'est ce qui préserve l'historique.
  async createModule(adminUserId: string, dto: CreateTrainingModuleDto) {
    const existant = await this.prisma.trainingModule.findFirst({
      where: {
        code: dto.code,
        countryCode: dto.countryCode ?? ALL_COUNTRIES,
        isActive: true,
      },
    });
    if (existant) {
      throw new ConflictException(
        `Un module actif porte déjà le code « ${dto.code} » pour ce périmètre. Remplacez-le par une nouvelle version.`,
      );
    }

    const module = await this.prisma.trainingModule.create({
      data: {
        code: dto.code,
        title: dto.title,
        body: dto.body,
        sortOrder: dto.sortOrder ?? 0,
        countryCode: dto.countryCode ?? ALL_COUNTRIES,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('TRAINING_MODULE_CREATED', adminUserId, {
      entityType: 'TrainingModule',
      entityId: module.id,
      metadata: {
        code: module.code,
        version: module.version,
        countryCode: module.countryCode,
      },
    });

    return module;
  }

  // REMPLACE un module par une version suivante.
  //
  // C'est la seule façon de faire évoluer un contenu déjà suivi. L'ancienne
  // version est DÉSACTIVÉE, jamais supprimée : les progressions qui la citent
  // doivent rester lisibles, et c'est la comparaison entre la version suivie et
  // la version courante qui dira ensuite « qui doit refaire quoi ».
  async supersedeModule(
    adminUserId: string,
    moduleId: string,
    dto: CreateTrainingModuleDto,
  ) {
    const courant = await this.prisma.trainingModule.findUnique({
      where: { id: moduleId },
    });
    if (!courant) throw new NotFoundException('Module introuvable.');
    if (!courant.isActive) {
      throw new ConflictException(
        'Ce module est déjà retiré. Remplacez sa version active.',
      );
    }
    if (dto.code !== courant.code) {
      // Changer le code romprait la lignée : les progressions passées ne se
      // rattacheraient plus à rien, et chacun serait réputé n'avoir rien suivi.
      throw new ConflictException(
        'Le code d’un module ne change pas d’une version à l’autre. Créez un nouveau module.',
      );
    }

    const [retire, suivant] = await this.prisma.$transaction([
      this.prisma.trainingModule.update({
        where: { id: moduleId },
        data: { isActive: false },
      }),
      this.prisma.trainingModule.create({
        data: {
          code: courant.code,
          title: dto.title,
          body: dto.body,
          version: courant.version + 1,
          sortOrder: dto.sortOrder ?? courant.sortOrder,
          countryCode: courant.countryCode,
          createdById: adminUserId,
        },
      }),
    ]);

    await this.audit.recordChange('TRAINING_MODULE_SUPERSEDED', adminUserId, {
      entityType: 'TrainingModule',
      entityId: suivant.id,
      changes: diffOf(
        { title: retire.title, body: retire.body },
        { title: suivant.title, body: suivant.body },
      ),
      metadata: {
        code: courant.code,
        fromVersion: retire.version,
        toVersion: suivant.version,
        // CE QUE CETTE DÉCISION DÉCLENCHE, dit explicitement : tous ceux qui
        // avaient achevé l'ancienne version devront refaire celle-ci avant
        // toute activation.
        effet: 'PROGRESSIONS_PRECEDENTES_CADUQUES',
      },
    });

    return { retire, suivant };
  }

  async deactivateModule(adminUserId: string, moduleId: string) {
    const module = await this.prisma.trainingModule.findUnique({
      where: { id: moduleId },
    });
    if (!module) throw new NotFoundException('Module introuvable.');

    const updated = await this.prisma.trainingModule.update({
      where: { id: moduleId },
      data: { isActive: false },
    });

    await this.audit.recordChange('TRAINING_MODULE_DEACTIVATED', adminUserId, {
      entityType: 'TrainingModule',
      entityId: moduleId,
      changes: diffOf({ isActive: true }, { isActive: false }),
      metadata: { code: module.code, version: module.version },
    });

    return updated;
  }

  // --- Questions ------------------------------------------------------------

  // La liste COMPLÈTE, réponses comprises. Réservée aux ADMIN, qui doivent bien
  // pouvoir relire ce qu'ils ont écrit.
  listQuestions(includeInactive = false) {
    return this.prisma.quizQuestion.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createQuestion(adminUserId: string, dto: CreateQuizQuestionDto) {
    // La base le refuse aussi (CHECK `QuizQuestion_correct_index_in_range`) ;
    // ce contrôle-ci ne fait qu'offrir un message clair avant d'y arriver.
    if (dto.correctIndex >= dto.choices.length) {
      throw new ConflictException(
        `La bonne réponse désigne la proposition ${dto.correctIndex + 1}, mais il n’y en a que ${dto.choices.length}.`,
      );
    }

    const question = await this.prisma.quizQuestion.create({
      data: {
        moduleId: dto.moduleId ?? null,
        prompt: dto.prompt,
        choices: dto.choices,
        correctIndex: dto.correctIndex,
        createdById: adminUserId,
      },
    });

    await this.audit.recordChange('QUIZ_QUESTION_CREATED', adminUserId, {
      entityType: 'QuizQuestion',
      entityId: question.id,
      metadata: {
        moduleId: question.moduleId,
        choiceCount: question.choices.length,
        // LA BONNE RÉPONSE N'EST PAS JOURNALISÉE. Un journal d'audit se
        // consulte, s'exporte, se transmet à un prestataire : y recopier le
        // corrigé reviendrait à le sortir du seul endroit qui le protège.
      },
    });

    return question;
  }

  async deactivateQuestion(adminUserId: string, questionId: string) {
    const question = await this.prisma.quizQuestion.findUnique({
      where: { id: questionId },
    });
    if (!question) throw new NotFoundException('Question introuvable.');

    const updated = await this.prisma.quizQuestion.update({
      where: { id: questionId },
      data: { isActive: false },
    });

    // Retirer une question change le barème de fait : le score se calcule sur
    // les questions actives. Les tentatives passées gardent leur score et leur
    // seuil photographiés — elles ne sont pas recalculées.
    await this.audit.recordChange('QUIZ_QUESTION_DEACTIVATED', adminUserId, {
      entityType: 'QuizQuestion',
      entityId: questionId,
      changes: diffOf({ isActive: true }, { isActive: false }),
    });

    return updated;
  }
}
