import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NeedRequestStatus,
  OpportunityStatus,
  OpportunityType,
  OrganizationMemberStatus,
  OrganizationVerificationStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { SearchOpportunitiesDto } from './dto/search-opportunities.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OrganizationAccessService } from './organization-access.service';
import { OrganizationsService } from './organizations.service';

const PUBLICLY_VISIBLE_STATUSES: OpportunityStatus[] = [
  OpportunityStatus.ACTIVE,
];

// Ces types exigent une validation administrative préalable du besoin (voir
// NeedRequestsService) avant toute publication — contrairement aux stages classiques.
const TYPES_REQUIRING_NEED_APPROVAL: OpportunityType[] = [
  OpportunityType.SEASONAL,
  OpportunityType.VOLUNTEER,
  OpportunityType.TEMPORARY,
];

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationsService,
    private readonly access: OrganizationAccessService,
  ) {}

  // --- FR-M4-001 : création (brouillon) ----------------------------------------------------

  async create(userId: string, dto: CreateOpportunityDto) {
    await this.organizations.assertOwnsVerifiedOrganization(
      userId,
      dto.organizationId,
    );

    const opportunity = await this.prisma.opportunity.create({
      data: {
        organizationId: dto.organizationId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        sector: dto.sector,
        country: dto.country,
        city: dto.city,
        workMode: dto.workMode,
        relocationRequired: dto.relocationRequired,
        accommodationProvided: dto.accommodationProvided,
        mobilityBenefits: dto.mobilityBenefits,
      },
    });
    await this.audit.record('OPPORTUNITY_CREATED', userId, {
      opportunityId: opportunity.id,
    });
    return opportunity;
  }

  async update(
    userId: string,
    opportunityId: string,
    dto: UpdateOpportunityDto,
  ) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    if (opportunity.status !== OpportunityStatus.DRAFT) {
      throw new BadRequestException(
        'Seule une offre en brouillon peut être modifiée.',
      );
    }

    return this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: dto,
    });
  }

  // --- FR-M4-002 / FR-M4-013 : publication et cycle de vie ---------------------------------

  async publish(userId: string, opportunityId: string) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, [OpportunityStatus.DRAFT]);

    const organization = await this.organizations.getById(
      opportunity.organizationId,
    );
    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        'Seule une organisation vérifiée peut publier une offre active — vérification en attente.',
      );
    }

    if (TYPES_REQUIRING_NEED_APPROVAL.includes(opportunity.type)) {
      const approvedNeed = await this.prisma.organizationNeedRequest.findFirst({
        where: {
          organizationId: opportunity.organizationId,
          type: opportunity.type,
          status: NeedRequestStatus.APPROVED,
        },
      });
      if (!approvedNeed) {
        throw new ForbiddenException(
          "Cette offre nécessite l'approbation préalable de l'administrateur (besoin saisonnier, bénévole ou temporaire) avant publication.",
        );
      }
    }

    // PENDING_REVIEW est traversé automatiquement pour le MVP — aucun workflow de
    // modération humaine n'existe encore (pas de module de gouvernance). L'état reste
    // journalisé pour anticiper une vraie file de revue plus tard.
    await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.PENDING_REVIEW },
    });
    await this.audit.record('OPPORTUNITY_PENDING_REVIEW', userId, {
      opportunityId,
    });

    const defaultDurationDays = Number(
      this.config.get<string>('OPPORTUNITY_DEFAULT_DURATION_DAYS', '60'),
    );
    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: OpportunityStatus.ACTIVE,
        publishedAt: new Date(),
        expiresAt:
          opportunity.expiresAt ??
          new Date(Date.now() + defaultDurationDays * 24 * 60 * 60 * 1000),
      },
    });
    await this.audit.record('OPPORTUNITY_PUBLISHED', userId, { opportunityId });
    return updated;
  }

  async pause(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [OpportunityStatus.ACTIVE],
      OpportunityStatus.PAUSED,
    );
  }

  async resume(userId: string, opportunityId: string) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, [OpportunityStatus.PAUSED]);

    const organization = await this.organizations.getById(
      opportunity.organizationId,
    );
    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        "Cette organisation n'est plus vérifiée — impossible de reprendre l'offre.",
      );
    }
    if (opportunity.expiresAt && opportunity.expiresAt < new Date()) {
      throw new BadRequestException(
        'Cette offre a expiré — la republier plutôt que de la reprendre.',
      );
    }

    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.ACTIVE },
    });
    await this.audit.record('OPPORTUNITY_RESUMED', userId, { opportunityId });
    return updated;
  }

  async markFilled(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED],
      OpportunityStatus.FILLED,
    );
  }

  async cancel(userId: string, opportunityId: string) {
    return this.transition(
      userId,
      opportunityId,
      [
        OpportunityStatus.DRAFT,
        OpportunityStatus.PENDING_REVIEW,
        OpportunityStatus.ACTIVE,
        OpportunityStatus.PAUSED,
      ],
      OpportunityStatus.CANCELLED,
    );
  }

  // Appelé par le module Reports lors d'un signalement — jamais depuis un endpoint direct.
  async markReported(opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    const terminal: OpportunityStatus[] = [
      OpportunityStatus.CANCELLED,
      OpportunityStatus.ARCHIVED,
      OpportunityStatus.SUSPENDED,
    ];
    if (terminal.includes(opportunity.status)) return opportunity;

    return this.prisma.opportunity.update({
      where: { id: opportunityId },
      data: { status: OpportunityStatus.REPORTED },
    });
  }

  // Suspension administrative — jamais exposée en self-service, réservée à un compte ADMIN.
  async suspend(adminUserId: string, opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: OpportunityStatus.SUSPENDED },
    });
    await this.audit.record('OPPORTUNITY_SUSPENDED', adminUserId, {
      opportunityId,
    });
    return updated;
  }

  private async transition(
    userId: string,
    opportunityId: string,
    fromStatuses: OpportunityStatus[],
    toStatus: OpportunityStatus,
  ) {
    const opportunity = await this.assertOwnsOpportunity(userId, opportunityId);
    this.assertTransition(opportunity.status, fromStatuses);

    const updated = await this.prisma.opportunity.update({
      where: { id: opportunity.id },
      data: { status: toStatus },
    });
    await this.audit.record(`OPPORTUNITY_${toStatus}`, userId, {
      opportunityId,
    });
    return updated;
  }

  private assertTransition(
    current: OpportunityStatus,
    allowed: OpportunityStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new BadRequestException(
        `Transition non autorisée depuis le statut ${current}.`,
      );
    }
  }

  // --- FR-M4-003 / FR-M4-004 : recherche et consultation -----------------------------------

  async search(query: SearchOpportunitiesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = {
      status: { in: PUBLICLY_VISIBLE_STATUSES },
      ...(query.country && { country: query.country }),
      ...(query.city && { city: query.city }),
      ...(query.sector && { sector: query.sector }),
      ...(query.type && { type: query.type }),
    };

    const [items, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, verificationStatus: true },
          },
        },
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(userId: string | undefined, opportunityId: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        organization: {
          select: { id: true, name: true, verificationStatus: true },
        },
      },
    });
    if (!opportunity) throw new NotFoundException('Offre introuvable.');

    const isPublic = PUBLICLY_VISIBLE_STATUSES.includes(opportunity.status);
    const isParticipant =
      userId &&
      opportunity.organization &&
      (await this.access.isParticipant(opportunity.organizationId, userId));
    if (!isPublic && !isParticipant) {
      throw new NotFoundException('Offre introuvable.');
    }
    return opportunity;
  }

  async listMine(userId: string) {
    const myOrganizations = await this.prisma.organization.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId, status: OrganizationMemberStatus.ACTIVE },
            },
          },
        ],
      },
      select: { id: true },
    });
    return this.prisma.opportunity.findMany({
      where: { organizationId: { in: myOrganizations.map((org) => org.id) } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdOr404(opportunityId: string) {
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: opportunityId },
    });
    if (!opportunity) throw new NotFoundException('Offre introuvable.');
    return opportunity;
  }

  // FR-ORG-002 : délègue à OrganizationAccessService — propriétaire ou membre d'équipe
  // autorisé (RECRUITER/ADMIN), pas seulement le propriétaire de l'organisation.
  async assertOwnsOpportunity(userId: string, opportunityId: string) {
    const opportunity = await this.getByIdOr404(opportunityId);
    await this.access.assertCanManage(opportunity.organizationId, userId);
    return opportunity;
  }
}
