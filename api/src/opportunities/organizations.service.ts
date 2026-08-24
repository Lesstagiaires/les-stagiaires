import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmbassadorsService } from '../ambassadors/ambassadors.service';
import {
  OrganizationCategory,
  OrganizationMemberStatus,
  OrganizationType,
  OrganizationVerificationStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { generateOrgIdCandidate } from '../common/org-id/org-id.util';
import { FAMILLE_DE_LA_CATEGORIE } from './organization-families';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationPageDto } from './dto/update-organization-page.dto';
import { OrganizationAccessService } from './organization-access.service';

const ORG_ROLE_NAMES = ['ENTREPRISE', 'ETABLISSEMENT'];

const PUBLIC_ORGANIZATION_SELECT = {
  id: true,
  type: true,
  // V6-3 — publique, et nulle pour les organisations antérieures. Le client doit
  // la restituer telle quelle : « catégorie non déclarée », jamais une valeur de
  // repli qui inventerait ce qu'on ignore.
  category: true,
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
    private readonly ambassadors: AmbassadorsService,
  ) {}

  // FR-M4-001 / EDU-FR-001 : seule une "organisation autorisée" peut publier —
  // matérialisé ici par la détention active du rôle ENTREPRISE ou ETABLISSEMENT
  // (module 1), qui détermine aussi le type de l'organisation créée (EDU-ID vs ORG-ID).
  async create(userId: string, dto: CreateOrganizationDto) {
    const heldOrgRole = await this.prisma.userRole.findFirst({
      where: { userId, isActive: true, role: { name: { in: ORG_ROLE_NAMES } } },
      include: { role: true },
    });
    if (!heldOrgRole) {
      throw new ForbiddenException(
        'Un rôle ENTREPRISE ou ETABLISSEMENT actif est requis pour créer une organisation.',
      );
    }

    const type =
      heldOrgRole.role.name === 'ETABLISSEMENT'
        ? OrganizationType.ETABLISSEMENT
        : OrganizationType.ENTREPRISE;

    // V6-3 — LA CATÉGORIE DÉCLARÉE DOIT APPARTENIR À LA FAMILLE DU RÔLE.
    //
    // Sans ce contrôle, la catégorie deviendrait un levier tarifaire : un
    // titulaire du rôle ETABLISSEMENT déclarant COMPANY basculerait de la
    // formule INSTITUTION vers BUSINESS. La catégorie est descriptive, elle ne
    // doit jamais permettre de choisir sa famille — ni donc son prix.
    this.assertCategorieDansLaFamille(dto.category, type);

    const orgId = await this.generateUniqueOrgId(type);
    const organization = await this.prisma.organization.create({
      data: {
        type,
        category: dto.category,
        orgId,
        ownerId: userId,
        name: dto.name,
        sector: dto.sector,
        country: dto.country,
        city: dto.city,
        // Donnée marketing déclarative — jamais consultée par le moteur de
        // commission (point 9 des arbitrages du 2026-07-31).
        acquisitionSource: dto.acquisitionSource,
        acquisitionSourceNote: dto.acquisitionSourceNote,
      },
    });
    await this.audit.record('ORGANIZATION_CREATED', userId, {
      organizationId: organization.id,
      orgId,
      type,
      category: dto.category,
      acquisitionSource: dto.acquisitionSource,
    });

    // Attribution à un ambassadeur : mécanisme SÉPARÉ de la statistique
    // ci-dessus. Il n'agit que sur un code valide appartenant à un ambassadeur
    // actif ; sinon il ne fait rien, sans bruit. Un code mal recopié ne doit
    // jamais faire échouer la création d'une organisation — l'entreprise
    // perdrait son inscription pour une raison qui ne la concerne pas.
    if (dto.ambassadorCode) {
      await this.ambassadors.attributeOrganization(
        organization.id,
        dto.ambassadorCode,
      );
    }

    return organization;
  }

  // V6-3 — cohérence catégorie / famille, la garde commune à la création et au
  // changement. Isolée pour n'avoir qu'un seul endroit à saboter dans un test.
  private assertCategorieDansLaFamille(
    categorie: OrganizationCategory,
    famille: OrganizationType,
  ): void {
    if (FAMILLE_DE_LA_CATEGORIE[categorie] !== famille) {
      throw new BadRequestException(
        `La catégorie ${categorie} n'appartient pas à la famille de cette organisation.`,
      );
    }
  }

  // V6-3 — DÉCLARER OU CORRIGER LA CATÉGORIE.
  //
  // Route dédiée, et jamais `PATCH /:id/page` : cette dernière s'appuie sur
  // `assertCanManage`, qui n'exclut que VIEWER — un RECRUITER y passerait, alors
  // que déclarer ce qu'EST une organisation revient au propriétaire et aux
  // administrateurs seuls.
  //
  // LA FAMILLE EST IMMUABLE. On ne change que la précision à l'intérieur d'elle :
  // une école peut se dire université, jamais entreprise. `orgId` n'est donc
  // jamais recalculé — son préfixe dépend de la famille, qui ne bouge pas.
  async changeCategory(
    userId: string,
    organizationId: string,
    category: OrganizationCategory,
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, type: true, category: true },
    });
    if (!organization) {
      throw new NotFoundException('Organisation introuvable.');
    }

    await this.access.assertCanDeclareCategory(organizationId, userId);
    this.assertCategorieDansLaFamille(category, organization.type);

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      // `category` SEUL : ni `type`, ni `orgId` ne figurent ici, et c'est
      // délibéré — la famille et l'identifiant sont immuables.
      data: { category },
      select: PUBLIC_ORGANIZATION_SELECT,
    });

    await this.audit.record('ORGANIZATION_CATEGORY_DECLARED', userId, {
      organizationId,
      from: organization.category,
      to: category,
    });

    return updated;
  }

  private async generateUniqueOrgId(type: OrganizationType): Promise<string> {
    const countryCode = this.config.get<string>('LS_ID_COUNTRY_CODE', 'CM');
    const prefix = type === OrganizationType.ETABLISSEMENT ? 'EDU' : 'ORG';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateOrgIdCandidate(countryCode, prefix);
      const exists = await this.prisma.organization.findUnique({
        where: { orgId: candidate },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      "Impossible de générer un identifiant d'organisation unique, réessayez.",
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
