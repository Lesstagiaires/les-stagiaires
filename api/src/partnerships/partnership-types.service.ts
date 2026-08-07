import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreatePartnershipTypeDto,
  UpdatePartnershipTypeDto,
} from './dto/partnership-type.dto';

// ============================================================================
// CATALOGUE DES TYPES DE PARTENARIAT
//
// « Cette liste doit être extensible sans migration à chaque ajout » (promoteur,
// 2026-08-02). D'où ce service : ajouter un type est une opération de données,
// faite depuis le back-office, pas une livraison de code.
//
// Deux règles structurent tout le reste :
//   — un code ne se modifie JAMAIS après création. Il est la clé de rattachement
//     des partenariats existants ; le renommer les orphelinerait silencieusement.
//     Les libellés, eux, se corrigent librement.
//   — un type ne se supprime pas, il se DÉSACTIVE. La contrainte `onDelete:
//     Restrict` en base refuse d'ailleurs la suppression d'un type utilisé — la
//     base dit non même si le code oubliait de le dire.
// ============================================================================
@Injectable()
export class PartnershipTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Catalogue proposable à une organisation : uniquement les types actifs.
  async listActive() {
    return this.prisma.partnershipType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  // Vue d'administration : tout, y compris les types retirés du catalogue, avec le
  // nombre de partenariats rattachés — on ne désactive pas à l'aveugle.
  async listAll() {
    return this.prisma.partnershipType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { partnerships: true } } },
    });
  }

  async create(adminUserId: string, dto: CreatePartnershipTypeDto) {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.prisma.partnershipType.findUnique({
      where: { code },
    });
    if (existing) {
      throw new ConflictException(
        'Ce code de type de partenariat existe déjà.',
      );
    }

    const type = await this.prisma.partnershipType.create({
      data: {
        code,
        labelFr: dto.labelFr,
        labelEn: dto.labelEn,
        labelEs: dto.labelEs,
        labelAr: dto.labelAr,
        labelPt: dto.labelPt,
        sortOrder: dto.sortOrder ?? 500,
      },
    });

    await this.audit.record('PARTNERSHIP_TYPE_CREATED', adminUserId, {
      partnershipTypeId: type.id,
      code,
    });

    return type;
  }

  // Les libellés et l'ordre se corrigent ; le code, non — voir l'en-tête.
  async update(
    adminUserId: string,
    typeId: string,
    dto: UpdatePartnershipTypeDto,
  ) {
    await this.getOrThrow(typeId);

    const type = await this.prisma.partnershipType.update({
      where: { id: typeId },
      data: {
        ...(dto.labelFr !== undefined && { labelFr: dto.labelFr }),
        ...(dto.labelEn !== undefined && { labelEn: dto.labelEn }),
        ...(dto.labelEs !== undefined && { labelEs: dto.labelEs }),
        ...(dto.labelAr !== undefined && { labelAr: dto.labelAr }),
        ...(dto.labelPt !== undefined && { labelPt: dto.labelPt }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });

    await this.audit.record('PARTNERSHIP_TYPE_UPDATED', adminUserId, {
      partnershipTypeId: typeId,
    });

    return type;
  }

  // Retirer du catalogue — ou l'y remettre. Jamais de suppression : les
  // partenariats déjà rattachés doivent rester lisibles.
  async setActive(adminUserId: string, typeId: string, isActive: boolean) {
    const existing = await this.getOrThrow(typeId);

    if (!isActive) {
      // Un catalogue vide rendrait toute candidature impossible. Le cas est
      // improbable, la conséquence ne l'est pas.
      const remaining = await this.prisma.partnershipType.count({
        where: { isActive: true, id: { not: typeId } },
      });
      if (existing.isActive && remaining === 0) {
        throw new BadRequestException(
          'Au moins un type de partenariat doit rester proposable.',
        );
      }
    }

    const type = await this.prisma.partnershipType.update({
      where: { id: typeId },
      data: { isActive },
    });

    await this.audit.record(
      isActive ? 'PARTNERSHIP_TYPE_ENABLED' : 'PARTNERSHIP_TYPE_DISABLED',
      adminUserId,
      { partnershipTypeId: typeId, code: existing.code },
    );

    return type;
  }

  private async getOrThrow(typeId: string) {
    const type = await this.prisma.partnershipType.findUnique({
      where: { id: typeId },
    });
    if (!type) throw new NotFoundException('Type de partenariat introuvable.');
    return type;
  }
}
