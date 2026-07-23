import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrganizationMemberStatus,
  OrganizationVerificationStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { generateOrgIdCandidate } from '../common/org-id/org-id.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationPageDto } from './dto/update-organization-page.dto';
import { OrganizationAccessService } from './organization-access.service';

const ORG_ROLE_NAMES = ['ENTREPRISE', 'ETABLISSEMENT'];

const PUBLIC_ORGANIZATION_SELECT = {
  id: true,
  orgId: true,
  name: true,
  sector: true,
  country: true,
  city: true,
  logoUrl: true,
  description: true,
  website: true,
  verificationStatus: true,
  partnershipSignedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  // FR-M4-001 : seule une "organisation autorisée" peut publier — matérialisé ici par la
  // détention active du rôle ENTREPRISE ou ETABLISSEMENT (module 1).
  async create(userId: string, dto: CreateOrganizationDto) {
    const heldOrgRole = await this.prisma.userRole.findFirst({
      where: { userId, isActive: true, role: { name: { in: ORG_ROLE_NAMES } } },
    });
    if (!heldOrgRole) {
      throw new ForbiddenException(
        'Un rôle ENTREPRISE ou ETABLISSEMENT actif est requis pour créer une organisation.',
      );
    }

    const orgId = await this.generateUniqueOrgId();
    const organization = await this.prisma.organization.create({
      data: {
        orgId,
        ownerId: userId,
        name: dto.name,
        sector: dto.sector,
        country: dto.country,
        city: dto.city,
      },
    });
    await this.audit.record('ORGANIZATION_CREATED', userId, {
      organizationId: organization.id,
      orgId,
    });
    return organization;
  }

  private async generateUniqueOrgId(): Promise<string> {
    const countryCode = this.config.get<string>('LS_ID_COUNTRY_CODE', 'CM');
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateOrgIdCandidate(countryCode);
      const exists = await this.prisma.organization.findUnique({
        where: { orgId: candidate },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      'Impossible de générer un ORG-ID unique, réessayez.',
    );
  }

  // FR-ORG-002 : inclut les organisations détenues ET celles où l'appelant est membre actif.
  async listMine(userId: string) {
    return this.prisma.organization.findMany({
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
      orderBy: { createdAt: 'desc' },
    });
  }

  // Usage interne (autorisation) — inclut ownerId, jamais renvoyé tel quel à un client.
  async getById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable.');
    return organization;
  }

  // FR-ORG-003 : consultation publique — select explicite, ownerId (identifiant User du
  // propriétaire) n'a aucune raison d'être exposé publiquement (CLAUDE.md §6).
  async getPublicById(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      select: PUBLIC_ORGANIZATION_SELECT,
    });
    if (!organization) throw new NotFoundException('Organisation introuvable.');
    return organization;
  }

  // Utilisé par le module Opportunités avant de créer une offre au nom d'une organisation —
  // délègue à OrganizationAccessService (FR-ORG-002 : propriétaire ou équipe autorisée,
  // pas seulement le propriétaire).
  async assertOwnsVerifiedOrganization(userId: string, organizationId: string) {
    const organization = await this.getById(organizationId);
    await this.access.assertCanManage(organizationId, userId);
    return organization;
  }

  // FR-ORG-003 : page publique et marque employeur.
  async updatePublicPage(
    userId: string,
    organizationId: string,
    dto: UpdateOrganizationPageDto,
  ) {
    await this.getById(organizationId);
    await this.access.assertCanManage(organizationId, userId);
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        logoUrl: dto.logoUrl,
        description: dto.description,
        website: dto.website,
      },
    });
    await this.audit.record('ORGANIZATION_PAGE_UPDATED', userId, {
      organizationId,
    });
    return updated;
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

  // FR-ORG-013 : signature d'une convention de partenariat — distincte de la simple
  // vérification, réservée à un compte ADMIN. Une organisation vérifiée n'apparaît dans
  // la vitrine publique que si elle a en plus signé ce partenariat.
  async signPartnership(adminUserId: string, organizationId: string) {
    const organization = await this.getById(organizationId);
    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        'Seule une organisation vérifiée peut signer une convention de partenariat.',
      );
    }
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { partnershipSignedAt: new Date() },
    });
    await this.audit.record('ORGANIZATION_PARTNERSHIP_SIGNED', adminUserId, {
      organizationId,
    });
    return updated;
  }

  // FR-ORG-013 : vitrine publique des partenaires signés.
  async listPartners() {
    return this.prisma.organization.findMany({
      where: { partnershipSignedAt: { not: null } },
      orderBy: { partnershipSignedAt: 'desc' },
      select: PUBLIC_ORGANIZATION_SELECT,
    });
  }
}
