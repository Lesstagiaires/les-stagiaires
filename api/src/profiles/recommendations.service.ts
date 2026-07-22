import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfileSection } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecommendationDto } from './dto/create-recommendation.dto';
import { VisibilityService } from './visibility.service';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly visibility: VisibilityService,
  ) {}

  async create(
    giverId: string,
    receiverId: string,
    dto: CreateRecommendationDto,
  ) {
    if (giverId === receiverId) {
      throw new BadRequestException('Impossible de se recommander soi-même.');
    }
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
    });
    if (!receiver) throw new NotFoundException('Utilisateur introuvable.');

    const recommendation = await this.prisma.recommendation.create({
      data: { giverId, receiverId, message: dto.message },
    });
    await this.audit.record('RECOMMENDATION_CREATED', giverId, {
      receiverId,
      recommendationId: recommendation.id,
    });
    return recommendation;
  }

  // FR-PRO-011 : affichage des recommandations reçues, filtré par la visibilité de la
  // rubrique RECOMMENDATIONS pour le visiteur courant.
  async listReceived(ownerUserId: string, viewerUserId: string | undefined) {
    const canView =
      ownerUserId === viewerUserId ||
      (await this.visibility.canView(
        ownerUserId,
        ProfileSection.RECOMMENDATIONS,
        viewerUserId,
      ));
    if (!canView) return [];

    const onlyVisible = ownerUserId !== viewerUserId;
    return this.prisma.recommendation.findMany({
      where: {
        receiverId: ownerUserId,
        ...(onlyVisible ? { visible: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setVisible(
    ownerUserId: string,
    recommendationId: string,
    visible: boolean,
  ) {
    const recommendation = await this.prisma.recommendation.findUnique({
      where: { id: recommendationId },
    });
    if (!recommendation || recommendation.receiverId !== ownerUserId) {
      throw new ForbiddenException(
        'Cette recommandation ne concerne pas ce compte.',
      );
    }
    const updated = await this.prisma.recommendation.update({
      where: { id: recommendationId },
      data: { visible },
    });
    await this.audit.record(
      visible ? 'RECOMMENDATION_SHOWN' : 'RECOMMENDATION_HIDDEN',
      ownerUserId,
      {
        recommendationId,
      },
    );
    return updated;
  }
}
