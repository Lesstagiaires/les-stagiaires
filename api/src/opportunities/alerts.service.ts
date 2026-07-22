import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpportunityStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';

// FR-M4-010 : définition des critères d'alerte. La livraison effective (push/SMS) revient
// au service transversal de notifications du socle gratuit (FR-FREE-004), pas à ce module —
// on expose ici la définition et une recherche de correspondances à la demande.
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAlertDto) {
    return this.prisma.opportunityAlert.create({
      data: {
        userId,
        country: dto.country,
        city: dto.city,
        sector: dto.sector,
        type: dto.type,
      },
    });
  }

  async list(userId: string) {
    return this.prisma.opportunityAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, alertId: string) {
    const alert = await this.prisma.opportunityAlert.findUnique({
      where: { id: alertId },
    });
    if (!alert) throw new NotFoundException('Alerte introuvable.');
    if (alert.userId !== userId)
      throw new ForbiddenException('Cette alerte ne concerne pas ce compte.');
    await this.prisma.opportunityAlert.delete({ where: { id: alertId } });
  }

  async getMatches(userId: string, alertId: string) {
    const alert = await this.prisma.opportunityAlert.findUnique({
      where: { id: alertId },
    });
    if (!alert) throw new NotFoundException('Alerte introuvable.');
    if (alert.userId !== userId)
      throw new ForbiddenException('Cette alerte ne concerne pas ce compte.');

    return this.prisma.opportunity.findMany({
      where: {
        status: OpportunityStatus.ACTIVE,
        ...(alert.country && { country: alert.country }),
        ...(alert.city && { city: alert.city }),
        ...(alert.sector && { sector: alert.sector }),
        ...(alert.type && { type: alert.type }),
      },
      orderBy: { publishedAt: 'desc' },
      include: { organization: { select: { id: true, name: true } } },
    });
  }
}
