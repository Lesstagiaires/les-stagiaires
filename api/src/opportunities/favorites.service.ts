import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpportunitiesService } from './opportunities.service';

// FR-M4-009 : favoris.
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async add(userId: string, opportunityId: string) {
    await this.opportunities.getById(userId, opportunityId);

    const existing = await this.prisma.opportunityFavorite.findUnique({
      where: { userId_opportunityId: { userId, opportunityId } },
    });
    if (existing)
      throw new ConflictException('Cette offre est déjà dans vos favoris.');

    return this.prisma.opportunityFavorite.create({
      data: { userId, opportunityId },
    });
  }

  async remove(userId: string, opportunityId: string) {
    const existing = await this.prisma.opportunityFavorite.findUnique({
      where: { userId_opportunityId: { userId, opportunityId } },
    });
    if (!existing)
      throw new NotFoundException(
        'Cette offre ne figure pas dans vos favoris.',
      );
    await this.prisma.opportunityFavorite.delete({
      where: { id: existing.id },
    });
  }

  async list(userId: string) {
    return this.prisma.opportunityFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        opportunity: {
          include: { organization: { select: { id: true, name: true } } },
        },
      },
    });
  }
}
