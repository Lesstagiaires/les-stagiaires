import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationVerificationStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

const ORG_ROLE_NAMES = ['ENTREPRISE', 'ETABLISSEMENT'];

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // FR-M4-001 : seule une "organisation autorisée" peut publier — matérialisé ici par la
  // détention active du rôle ENTREPRISE ou ETABLISSEMENT (module 1). Le module 6 enrichira
  // ce compte (ORG-ID d'affichage, équipe) sans changer cette condition d'accès.
  async create(userId: string, dto: CreateOrganizationDto) {
    const heldOrgRole = await this.prisma.userRole.findFirst({
      where: { userId, isActive: true, role: { name: { in: ORG_ROLE_NAMES } } },
    });
    if (!heldOrgRole) {
      throw new ForbiddenException(
        'Un rôle ENTREPRISE ou ETABLISSEMENT actif est requis pour créer une organisation.',
      );
    }

    const organization = await this.prisma.organization.create({
      data: {
        ownerId: userId,
        name: dto.name,
        sector: dto.sector,
        country: dto.country,
        city: dto.city,
      },
    });
    await this.audit.record('ORGANIZATION_CREATED', userId, {
      organizationId: organization.id,
    });
    return organization;
  }

  async listMine(userId: string) {
    return this.prisma.organization.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable.');
    return organization;
  }

  async assertOwnsVerifiedOrganization(userId: string, organizationId: string) {
    const organization = await this.getById(organizationId);
    if (organization.ownerId !== userId) {
      throw new ForbiddenException(
        'Cette organisation ne concerne pas ce compte.',
      );
    }
    return organization;
  }

  // Réservé à un compte ADMIN — jamais d'auto-vérification par l'organisation elle-même
  // (CLAUDE.md §3). Aucun rôle ADMIN n'est attribué par défaut ; à accorder manuellement
  // pour l'exploitant de la plateforme.
  async verify(adminUserId: string, organizationId: string) {
    const organization = await this.getById(organizationId);
    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: {
        verificationStatus: OrganizationVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
    await this.audit.record('ORGANIZATION_VERIFIED', adminUserId, {
      organizationId,
    });
    return updated;
  }

  async reject(adminUserId: string, organizationId: string) {
    const organization = await this.getById(organizationId);
    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: {
        verificationStatus: OrganizationVerificationStatus.REJECTED,
        verifiedAt: null,
      },
    });
    await this.audit.record('ORGANIZATION_REJECTED', adminUserId, {
      organizationId,
    });
    return updated;
  }
}
