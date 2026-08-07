import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AmbassadorEventType } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { ALL_COUNTRIES } from '../common/country-scope';
import { PrismaService } from '../prisma/prisma.service';
import { AmbassadorPolicyService } from './ambassador-policy.service';
import { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { isTerminal } from './ambassador-status-groups';

// ============================================================================
// FORMATION ET QUIZ BLOQUANT
//
// Arbitrages 8 et 9 du promoteur, 2026-08-02.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ LA RÈGLE QUI GOUVERNE TOUT CE FICHIER :                                   │
// │ `correctIndex` NE SORT JAMAIS DE CE SERVICE.                              │
// └──────────────────────────────────────────────────────────────────────────┘
//
// « Tout le code exécuté dans le navigateur est public » (SKILL SECURITY FIRST
// §5). Envoyer les bonnes réponses au client — même dans un champ que
// l'interface n'affiche pas — revient à les publier : il suffit d'ouvrir
// l'onglet réseau. Un quiz dont les réponses circulent n'est plus un quiz, c'est
// une formalité.
//
// D'où la découpe :
//   — `questionsFor()` PROJETTE explicitement les champs servis. Elle ne fait
//     pas `delete question.correctIndex` sur un objet complet : on construit ce
//     qui sort, on ne retranche pas de ce qui existe. Un champ ajouté demain au
//     modèle ne fuitera donc pas par omission.
//   — `submit()` corrige côté serveur. Le client envoie des indices choisis,
//     jamais un score.
//
// LE NOMBRE DE TENTATIVES EST COMPTÉ EN BASE, pas transmis par le client : un
// compteur envoyé par l'appelant serait un compteur remis à zéro par l'appelant.
// ============================================================================
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: AmbassadorPolicyService,
  ) {}

  // --- Les modules ----------------------------------------------------------

  // Le parcours du candidat : les modules actifs de son pays, et ce qu'il a déjà
  // achevé au cycle en cours.
  async myPath(userId: string) {
    const ambassador = await this.mustFindAmbassador(userId);

    const modules = await this.prisma.trainingModule.findMany({
      where: {
        isActive: true,
        OR: [
          { countryCode: ALL_COUNTRIES },
          { countryCode: ambassador.countryCode },
        ],
      },
      orderBy: { sortOrder: 'asc' },
    });

    const done = await this.prisma.trainingProgress.findMany({
      where: {
        ambassadorId: ambassador.id,
        applicationCycle: ambassador.applicationCycle,
      },
      select: { moduleId: true, moduleVersion: true, completedAt: true },
    });
    const doneById = new Map(done.map((entry) => [entry.moduleId, entry]));

    return modules.map((module) => {
      const progress = doneById.get(module.id);
      return {
        id: module.id,
        code: module.code,
        title: module.title,
        body: module.body,
        version: module.version,
        sortOrder: module.sortOrder,
        completedAt: progress?.completedAt ?? null,
        // Le module a-t-il changé DEPUIS que la personne l'a suivi ? Sans cette
        // comparaison, une refonte passerait inaperçue et quelqu'un serait
        // réputé connaître un contenu qu'il n'a jamais lu.
        outdated: progress ? progress.moduleVersion !== module.version : false,
      };
    });
  }

  // Le candidat déclare avoir achevé un module.
  async completeModule(userId: string, moduleId: string) {
    const ambassador = await this.mustFindAmbassador(userId);

    const module = await this.prisma.trainingModule.findUnique({
      where: { id: moduleId },
    });
    if (!module || !module.isActive) {
      throw new NotFoundException('Module de formation introuvable.');
    }

    // Réachever un module après une refonte est légitime : la version recopiée
    // sera la nouvelle. C'est pourquoi on met à jour plutôt que de refuser.
    const progress = await this.prisma.trainingProgress.upsert({
      where: {
        ambassadorId_moduleId_applicationCycle: {
          ambassadorId: ambassador.id,
          moduleId,
          applicationCycle: ambassador.applicationCycle,
        },
      },
      create: {
        ambassadorId: ambassador.id,
        moduleId,
        moduleCode: module.code,
        moduleVersion: module.version,
        applicationCycle: ambassador.applicationCycle,
      },
      update: {
        moduleVersion: module.version,
        completedAt: new Date(),
      },
    });

    return {
      moduleId: progress.moduleId,
      moduleVersion: progress.moduleVersion,
      completedAt: progress.completedAt,
    };
  }

  // --- Le quiz --------------------------------------------------------------

  // LES QUESTIONS SERVIES AU CANDIDAT, SANS LES RÉPONSES.
  //
  // La projection est EXPLICITE : on construit l'objet servi champ par champ.
  // Retrancher `correctIndex` d'un objet complet marcherait aujourd'hui et
  // laisserait fuiter le champ que quelqu'un ajoutera demain.
  async questionsFor(userId: string) {
    const ambassador = await this.mustFindAmbassador(userId);
    const remaining = await this.remainingAttempts(ambassador);

    if (remaining <= 0) {
      throw new ForbiddenException(
        'Vous avez épuisé vos tentatives. Contactez l’administration.',
      );
    }

    const questions = await this.prisma.quizQuestion.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      remainingAttempts: remaining,
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        choices: question.choices,
        // PAS de `correctIndex`, PAS de `...question`. La liste ci-dessus est
        // exhaustive, et c'est ce qui rend la garantie durable.
      })),
    };
  }

  // Soumission d'une tentative. LA CORRECTION EST ENTIÈREMENT CÔTÉ SERVEUR : le
  // client envoie les indices qu'il a choisis, jamais un score.
  async submit(userId: string, dto: SubmitQuizDto) {
    const ambassador = await this.mustFindAmbassador(userId);
    const resolvedPolicy = await this.policy.resolve(ambassador.countryCode);

    const remaining = await this.remainingAttempts(ambassador);
    if (remaining <= 0) {
      await this.audit.record('AMBASSADOR_QUIZ_ATTEMPT_REFUSED', userId, {
        ambassadorId: ambassador.id,
        motif: 'TENTATIVES_EPUISEES',
      });
      throw new ForbiddenException(
        'Vous avez épuisé vos tentatives. Contactez l’administration.',
      );
    }

    const questions = await this.prisma.quizQuestion.findMany({
      where: { isActive: true },
      select: { id: true, correctIndex: true },
    });
    if (questions.length === 0) {
      throw new ConflictException('Aucun quiz n’est configuré à ce jour.');
    }

    // La correction. Une question sans réponse fournie compte comme fausse :
    // ne pas répondre n'est pas une façon de ne pas se tromper.
    const parIdentifiant = new Map(
      dto.answers.map((answer) => [answer.questionId, answer.choiceIndex]),
    );
    const correctCount = questions.filter(
      (question) => parIdentifiant.get(question.id) === question.correctIndex,
    ).length;

    const scorePercent = Math.floor((correctCount / questions.length) * 100);
    const passed = scorePercent >= resolvedPolicy.quizPassScorePercent;

    const attemptNumber =
      (await this.countAttempts(ambassador.id, ambassador.applicationCycle)) +
      1;

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        ambassadorId: ambassador.id,
        applicationCycle: ambassador.applicationCycle,
        attemptNumber,
        scorePercent,
        // Le seuil EN VIGUEUR ce jour-là, photographié : l'abaisser demain ne
        // doit pas rendre reçu quelqu'un qui avait échoué.
        passScorePercent: resolvedPolicy.quizPassScorePercent,
        passed,
        questionCount: questions.length,
        correctCount,
        // CE QUE LA PERSONNE A RÉPONDU, pour instruire une contestation. Ni les
        // bonnes réponses, ni la correction question par question : le corrigé
        // ne se stocke pas à côté des copies.
        answers: dto.answers as never,
      },
    });

    await this.audit.record('AMBASSADOR_QUIZ_SUBMITTED', userId, {
      ambassadorId: ambassador.id,
      attemptNumber,
      scorePercent,
      passScorePercent: resolvedPolicy.quizPassScorePercent,
      passed,
    });

    if (passed) {
      await this.prisma.ambassador.update({
        where: { id: ambassador.id },
        data: { quizScore: scorePercent },
      });
    }

    return {
      attemptNumber: attempt.attemptNumber,
      scorePercent,
      passScorePercent: resolvedPolicy.quizPassScorePercent,
      passed,
      // Ni le corrigé, ni le détail question par question. Le donner à chaque
      // échec permettrait de reconstituer toutes les réponses en trois
      // tentatives — ce qui viderait le quiz de son sens.
      remainingAttempts: Math.max(0, remaining - 1),
    };
  }

  // --- La dérogation --------------------------------------------------------
  //
  // « Une dérogation est possible sur décision motivée, mais devra être
  // journalisée. » Elle porte son auteur, sa date et son motif structuré — la
  // base l'exige par contrainte CHECK, pas seulement ce code.
  async waiveQuiz(
    adminUserId: string,
    ambassadorId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
    });
    if (!ambassador) throw new NotFoundException('Dossier introuvable.');
    if (ambassador.quizWaivedAt) {
      throw new ConflictException('Une dérogation est déjà en place.');
    }

    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        quizWaivedAt: new Date(),
        quizWaivedById: adminUserId,
        quizWaivedReasonCode: dto.reasonCode,
      },
    });

    await this.prisma.ambassadorEvent.create({
      data: {
        ambassadorId,
        type: AmbassadorEventType.TRAINING_COMPLETED,
        actorId: adminUserId,
        metadata: {
          kind: 'QUIZ_WAIVED',
          reasonCode: dto.reasonCode,
          internalNote: dto.internalNote,
        },
      },
    });
    await this.audit.record('AMBASSADOR_QUIZ_WAIVED', adminUserId, {
      ambassadorId,
      reasonCode: dto.reasonCode,
      internalNote: dto.internalNote,
    });

    return { quizWaivedAt: updated.quizWaivedAt };
  }

  // --- LE VERROU D'ACTIVATION ----------------------------------------------
  //
  // Rend la liste de ce qui s'oppose à l'activation — vide quand la voie est
  // libre. Trois conditions, toutes rapportées au CYCLE EN COURS.
  async blockingReasons(ambassadorId: string): Promise<string[]> {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
      select: {
        id: true,
        countryCode: true,
        applicationCycle: true,
        quizWaivedAt: true,
      },
    });
    if (!ambassador) return ['Dossier introuvable.'];

    const findings: string[] = [];

    // 1. Tous les modules obligatoires, à leur version courante.
    const modules = await this.prisma.trainingModule.findMany({
      where: {
        isActive: true,
        OR: [
          { countryCode: ALL_COUNTRIES },
          { countryCode: ambassador.countryCode },
        ],
      },
      select: { id: true, code: true, version: true },
    });

    if (modules.length > 0) {
      const done = await this.prisma.trainingProgress.findMany({
        where: {
          ambassadorId,
          applicationCycle: ambassador.applicationCycle,
        },
        select: { moduleId: true, moduleVersion: true },
      });
      const doneById = new Map(done.map((e) => [e.moduleId, e.moduleVersion]));

      const manquants = modules.filter(
        // Achevé À LA BONNE VERSION. Un module refondu depuis rend la
        // progression caduque : sinon une refonte de sécurité n'atteindrait
        // jamais ceux qui sont déjà passés.
        (module) => doneById.get(module.id) !== module.version,
      );
      if (manquants.length > 0) {
        findings.push(
          `formation incomplète (${manquants.map((m) => m.code).join(', ')})`,
        );
      }
    }

    // 2. Le quiz, sauf dérogation.
    if (!ambassador.quizWaivedAt) {
      const reussi = await this.prisma.quizAttempt.findFirst({
        where: {
          ambassadorId,
          applicationCycle: ambassador.applicationCycle,
          passed: true,
        },
        select: { id: true },
      });
      if (!reussi) findings.push('quiz non réussi');
    }

    return findings;
  }

  private async remainingAttempts(ambassador: {
    id: string;
    countryCode: string;
    applicationCycle: number;
  }): Promise<number> {
    const resolvedPolicy = await this.policy.resolve(ambassador.countryCode);
    const used = await this.countAttempts(
      ambassador.id,
      ambassador.applicationCycle,
    );
    return Math.max(0, resolvedPolicy.quizMaxAttempts - used);
  }

  // COMPTÉ EN BASE. Un compteur transmis par le client serait un compteur remis
  // à zéro par le client.
  private countAttempts(ambassadorId: string, applicationCycle: number) {
    return this.prisma.quizAttempt.count({
      where: { ambassadorId, applicationCycle },
    });
  }

  private async mustFindAmbassador(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        countryCode: true,
        applicationCycle: true,
      },
    });
    if (!ambassador) {
      throw new NotFoundException('Aucune candidature à votre nom.');
    }
    if (isTerminal(ambassador.status)) {
      throw new ConflictException('Votre dossier est clos.');
    }
    return ambassador;
  }
}
