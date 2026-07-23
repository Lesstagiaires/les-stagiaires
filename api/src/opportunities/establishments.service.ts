import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  InternshipCampaignStatus,
  InternshipReportStatus,
  LearnerStatus,
  OrganizationType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { InviteLearnerDto } from './dto/invite-learner.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateCampaignStatusDto } from './dto/update-campaign-status.dto';
import { OrganizationAccessService } from './organization-access.service';

const TERMINAL_APPLICATION_STATUSES_FOR_PARTNERS: ApplicationStatus[] = [
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.COMPLETED,
];

const CAMPAIGN_ALLOWED_TRANSITIONS: Record<
  InternshipCampaignStatus,
  InternshipCampaignStatus[]
> = {
  [InternshipCampaignStatus.DRAFT]: [InternshipCampaignStatus.ACTIVE],
  [InternshipCampaignStatus.ACTIVE]: [InternshipCampaignStatus.CLOSED],
  [InternshipCampaignStatus.CLOSED]: [],
};

// Module 7 — rattachement des apprenants (EDU-FR-004), campagnes (EDU-FR-005), suivi des
// conventions (EDU-FR-006), rapports de stage (EDU-FR-007), tableau de bord d'insertion
// (EDU-FR-008) et répertoire des entreprises partenaires (EDU-FR-009). Réutilise
// OrganizationAccessService (module 6) pour l'autorisation — mêmes rôles d'équipe
// (ADMIN/RECRUITER/VIEWER) qu'une entreprise, sans concept séparé pour un établissement.
@Injectable()
export class EstablishmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private async assertIsEstablishment(establishmentId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: establishmentId },
    });
    if (!organization) {
      throw new NotFoundException('Établissement introuvable.');
    }
    if (organization.type !== OrganizationType.ETABLISSEMENT) {
      throw new BadRequestException(
        'Cette fonctionnalité est réservée aux organisations de type établissement.',
      );
    }
    return organization;
  }

  // --- EDU-FR-004 : rattachement et vérification des apprenants ---------------------------

  async inviteLearner(
    actorId: string,
    establishmentId: string,
    dto: InviteLearnerDto,
  ) {
    await this.assertIsEstablishment(establishmentId);
    await this.access.assertCanManage(establishmentId, actorId);

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) {
      throw new NotFoundException(
        "Aucun compte LES STAGIAIRES n'est associé à ce numéro.",
      );
    }

    const existing = await this.prisma.establishmentLearner.findUnique({
      where: { establishmentId_userId: { establishmentId, userId: user.id } },
    });
    if (existing?.status === LearnerStatus.ACTIVE) {
      throw new ConflictException(
        'Cet apprenant est déjà rattaché à cet établissement.',
      );
    }
    if (existing?.status === LearnerStatus.PENDING) {
      throw new ConflictException(
        'Une invitation est déjà en attente pour ce compte.',
      );
    }

    const learner = existing
      ? await this.prisma.establishmentLearner.update({
          where: { id: existing.id },
          data: {
            status: LearnerStatus.PENDING,
            invitedAt: new Date(),
            joinedAt: null,
            verifiedAt: null,
            revokedAt: null,
          },
        })
      : await this.prisma.establishmentLearner.create({
          data: { establishmentId, userId: user.id },
        });

    await this.notify(
      user.id,
      'LES STAGIAIRES — un établissement souhaite vous rattacher à son compte. Connectez-vous pour accepter ou refuser.',
    );
    await this.audit.record('LEARNER_INVITED', actorId, {
      establishmentId,
      learnerId: learner.id,
    });
    return learner;
  }

  async listMyEnrollments(userId: string) {
    return this.prisma.establishmentLearner.findMany({
      where: { userId },
      orderBy: { invitedAt: 'desc' },
      include: {
        establishment: { select: { id: true, name: true, orgId: true } },
      },
    });
  }

  async acceptLearner(userId: string, learnerId: string) {
    const learner = await this.assertOwnLearnerRecord(userId, learnerId);
    if (learner.status !== LearnerStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus en attente.");
    }
    const updated = await this.prisma.establishmentLearner.update({
      where: { id: learnerId },
      data: { status: LearnerStatus.ACTIVE, joinedAt: new Date() },
    });
    await this.audit.record('LEARNER_JOINED', userId, { learnerId });
    return updated;
  }

  async declineLearner(userId: string, learnerId: string) {
    const learner = await this.assertOwnLearnerRecord(userId, learnerId);
    if (learner.status !== LearnerStatus.PENDING) {
      throw new BadRequestException("Cette invitation n'est plus en attente.");
    }
    await this.prisma.establishmentLearner.update({
      where: { id: learnerId },
      data: { status: LearnerStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.record('LEARNER_DECLINED', userId, { learnerId });
  }

  // Distincte de l'acceptation : confirme que l'établissement a vérifié la réalité de
  // l'inscription de l'apprenant (EDU-FR-004), jamais automatique.
  async verifyLearner(
    actorId: string,
    establishmentId: string,
    learnerId: string,
  ) {
    await this.access.assertCanManage(establishmentId, actorId);
    const learner = await this.getLearnerOr404(establishmentId, learnerId);
    if (learner.status !== LearnerStatus.ACTIVE) {
      throw new BadRequestException(
        'Seul un apprenant ayant accepté le rattachement peut être vérifié.',
      );
    }
    const updated = await this.prisma.establishmentLearner.update({
      where: { id: learnerId },
      data: { verifiedAt: new Date() },
    });
    await this.audit.record('LEARNER_VERIFIED', actorId, {
      establishmentId,
      learnerId,
    });
    await this.notify(
      learner.userId,
      'LES STAGIAIRES — votre rattachement à votre établissement est vérifié.',
    );
    return updated;
  }

  async revokeLearner(
    actorId: string,
    establishmentId: string,
    learnerId: string,
  ) {
    await this.access.assertCanManage(establishmentId, actorId);
    const learner = await this.getLearnerOr404(establishmentId, learnerId);
    if (learner.status === LearnerStatus.REVOKED) {
      throw new BadRequestException('Cet apprenant est déjà révoqué.');
    }
    const updated = await this.prisma.establishmentLearner.update({
      where: { id: learnerId },
      data: {
        status: LearnerStatus.REVOKED,
        revokedAt: new Date(),
        verifiedAt: null,
      },
    });
    await this.audit.record('LEARNER_REVOKED', actorId, {
      establishmentId,
      learnerId,
    });
    return updated;
  }

  async listLearners(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    return this.prisma.establishmentLearner.findMany({
      where: { establishmentId },
      orderBy: { invitedAt: 'desc' },
      include: { user: { select: { id: true, lsId: true } } },
    });
  }

  private async getLearnerOr404(establishmentId: string, learnerId: string) {
    const learner = await this.prisma.establishmentLearner.findUnique({
      where: { id: learnerId },
    });
    if (!learner || learner.establishmentId !== establishmentId) {
      throw new NotFoundException(
        'Apprenant introuvable pour cet établissement.',
      );
    }
    return learner;
  }

  private async assertOwnLearnerRecord(userId: string, learnerId: string) {
    const learner = await this.prisma.establishmentLearner.findUnique({
      where: { id: learnerId },
    });
    if (!learner || learner.userId !== userId) {
      throw new NotFoundException('Invitation introuvable pour ce compte.');
    }
    return learner;
  }

  // --- EDU-FR-005 : campagnes de stage ------------------------------------------------------

  async createCampaign(
    actorId: string,
    establishmentId: string,
    dto: CreateCampaignDto,
  ) {
    await this.assertIsEstablishment(establishmentId);
    await this.access.assertCanManage(establishmentId, actorId);
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException(
        'La date de fin doit être postérieure à la date de début.',
      );
    }
    const campaign = await this.prisma.internshipCampaign.create({
      data: {
        establishmentId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    await this.audit.record('CAMPAIGN_CREATED', actorId, {
      establishmentId,
      campaignId: campaign.id,
    });
    return campaign;
  }

  async updateCampaignStatus(
    actorId: string,
    establishmentId: string,
    campaignId: string,
    dto: UpdateCampaignStatusDto,
  ) {
    await this.access.assertCanManage(establishmentId, actorId);
    const campaign = await this.prisma.internshipCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.establishmentId !== establishmentId) {
      throw new NotFoundException(
        'Campagne introuvable pour cet établissement.',
      );
    }
    if (!CAMPAIGN_ALLOWED_TRANSITIONS[campaign.status].includes(dto.status)) {
      throw new BadRequestException(
        `Transition non autorisée depuis le statut ${campaign.status}.`,
      );
    }
    const updated = await this.prisma.internshipCampaign.update({
      where: { id: campaignId },
      data: { status: dto.status },
    });
    await this.audit.record('CAMPAIGN_STATUS_UPDATED', actorId, {
      establishmentId,
      campaignId,
      status: dto.status,
    });
    return updated;
  }

  async listCampaigns(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    return this.prisma.internshipCampaign.findMany({
      where: { establishmentId },
      orderBy: { startDate: 'desc' },
    });
  }

  // --- EDU-FR-006 : suivi des conventions des apprenants ------------------------------------

  async listLearnerApplications(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    const verifiedLearnerIds =
      await this.getVerifiedLearnerUserIds(establishmentId);
    if (verifiedLearnerIds.length === 0) return [];

    return this.prisma.application.findMany({
      where: { candidateId: { in: verifiedLearnerIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        status: true,
        candidateId: true,
        candidate: { select: { id: true, lsId: true } },
        organization: { select: { id: true, name: true } },
        opportunity: { select: { id: true, title: true } },
        createdAt: true,
        startedAt: true,
        completedAt: true,
        establishmentParticipationRequested: true,
        establishmentSignedAt: true,
        establishmentSignedName: true,
      },
    });
  }

  // --- EDU-FR-007 : rapports de stage --------------------------------------------------------

  async listReports(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    const verifiedLearnerIds =
      await this.getVerifiedLearnerUserIds(establishmentId);
    if (verifiedLearnerIds.length === 0) return [];

    return this.prisma.internshipReport.findMany({
      where: { application: { candidateId: { in: verifiedLearnerIds } } },
      orderBy: { createdAt: 'desc' },
      include: {
        application: {
          select: {
            id: true,
            reference: true,
            candidateId: true,
            candidate: { select: { id: true, lsId: true } },
          },
        },
      },
    });
  }

  // La "soutenance" (Couche 2/3, cf. cahier des charges module 5) n'est pas dans ce
  // périmètre — seuls le dépôt, la correction et la validation du document le sont.
  async reviewReport(
    actorId: string,
    establishmentId: string,
    applicationId: string,
    dto: ReviewReportDto,
  ) {
    await this.access.assertCanManage(establishmentId, actorId);
    const report = await this.prisma.internshipReport.findUnique({
      where: { applicationId },
      include: {
        application: { select: { candidateId: true, reference: true } },
      },
    });
    if (!report)
      throw new NotFoundException(
        'Rapport introuvable pour cette candidature.',
      );

    const isVerifiedLearner = await this.prisma.establishmentLearner.findFirst({
      where: {
        establishmentId,
        userId: report.application.candidateId,
        status: LearnerStatus.ACTIVE,
        verifiedAt: { not: null },
      },
    });
    if (!isVerifiedLearner) {
      throw new ForbiddenException(
        'Ce rapport ne concerne pas un apprenant vérifié de cet établissement.',
      );
    }

    const updated = await this.prisma.internshipReport.update({
      where: { applicationId },
      data: {
        status: dto.status,
        reviewNote: dto.note,
        reviewedAt: new Date(),
        reviewedById: actorId,
      },
    });
    await this.audit.record('INTERNSHIP_REPORT_REVIEWED', actorId, {
      applicationId,
      status: dto.status,
    });
    await this.notify(
      report.application.candidateId,
      dto.status === InternshipReportStatus.VALIDATED
        ? `LES STAGIAIRES — votre rapport de stage (candidature ${report.application.reference}) est validé.`
        : `LES STAGIAIRES — votre rapport de stage (candidature ${report.application.reference}) nécessite une correction.${dto.note ? ` Note : ${dto.note}` : ''}`,
    );
    return updated;
  }

  // --- EDU-FR-008 : tableau de bord d'insertion ----------------------------------------------

  async dashboard(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    const verifiedLearnerIds =
      await this.getVerifiedLearnerUserIds(establishmentId);

    const [totalLearners, verifiedLearners, applications] = await Promise.all([
      this.prisma.establishmentLearner.count({
        where: { establishmentId, status: { not: LearnerStatus.REVOKED } },
      }),
      this.prisma.establishmentLearner.count({
        where: {
          establishmentId,
          status: LearnerStatus.ACTIVE,
          verifiedAt: { not: null },
        },
      }),
      verifiedLearnerIds.length > 0
        ? this.prisma.application.findMany({
            where: { candidateId: { in: verifiedLearnerIds } },
            select: { status: true, candidateId: true },
          })
        : Promise.resolve(
            [] as { status: ApplicationStatus; candidateId: string }[],
          ),
    ]);

    // Distincts par apprenant, pas par candidature : un même apprenant avec plusieurs
    // candidatures acceptées ne doit compter qu'une fois dans le taux d'insertion,
    // sous peine de dépasser 100 % (bug relevé en test manuel).
    const withInternship = new Set(
      applications
        .filter((application) =>
          TERMINAL_APPLICATION_STATUSES_FOR_PARTNERS.includes(
            application.status,
          ),
        )
        .map((application) => application.candidateId),
    ).size;
    const completed = new Set(
      applications
        .filter(
          (application) => application.status === ApplicationStatus.COMPLETED,
        )
        .map((application) => application.candidateId),
    ).size;

    return {
      totalLearners,
      verifiedLearners,
      totalApplications: applications.length,
      learnersWithInternship: withInternship,
      completedInternships: completed,
      insertionRate:
        verifiedLearners > 0
          ? Math.round((withInternship / verifiedLearners) * 100)
          : 0,
    };
  }

  // --- EDU-FR-009 : répertoire des entreprises partenaires ------------------------------------

  // Dérivé des candidatures abouties des apprenants vérifiés — pas de liste distincte à
  // gérer manuellement en plus (pas de modèle redondant avec ce que module 5 sait déjà).
  async partnerCompanies(actorId: string, establishmentId: string) {
    await this.access.assertCanManage(establishmentId, actorId);
    const verifiedLearnerIds =
      await this.getVerifiedLearnerUserIds(establishmentId);
    if (verifiedLearnerIds.length === 0) return [];

    const applications = await this.prisma.application.findMany({
      where: {
        candidateId: { in: verifiedLearnerIds },
        status: { in: TERMINAL_APPLICATION_STATUSES_FOR_PARTNERS },
      },
      select: {
        organization: {
          select: {
            id: true,
            orgId: true,
            name: true,
            sector: true,
            logoUrl: true,
          },
        },
      },
      distinct: ['organizationId'],
    });
    return applications.map((application) => application.organization);
  }

  private async getVerifiedLearnerUserIds(
    establishmentId: string,
  ): Promise<string[]> {
    const learners = await this.prisma.establishmentLearner.findMany({
      where: {
        establishmentId,
        status: LearnerStatus.ACTIVE,
        verifiedAt: { not: null },
      },
      select: { userId: true },
    });
    return learners.map((learner) => learner.userId);
  }

  private async notify(userId: string, message: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone) return;
    await this.sms.send(user.phone, message);
  }
}
