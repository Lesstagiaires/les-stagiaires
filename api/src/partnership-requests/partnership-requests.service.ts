import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type {
  PartnershipRequestCategory,
  PartnershipRequestReason,
  PartnershipRequestStatus,
} from '../../generated/prisma/enums';
import { CreatePartnershipRequestDto } from './dto/create-partnership-request.dto';

const CONTACT_SELECT = {
  id: true,
  lsId: true,
  firstName: true,
  lastName: true,
} as const;

// CRM de prospection/partenariats — distinct du signalement (module modération) et du
// support technique candidat : entreprises, ONG, administrations, universités, écoles,
// centres de formation et autres partenaires qui sollicitent LES STAGIAIRES.
@Injectable()
export class PartnershipRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreatePartnershipRequestDto) {
    const category = dto.category ?? 'GENERAL';
    const status = category === 'NEED_QUOTE' ? 'QUOTE_PENDING' : 'NEW';
    const request = await this.prisma.partnershipRequest.create({
      data: { ...dto, category, status },
    });

    await this.audit.record('PARTNERSHIP_REQUEST_SUBMITTED', null, {
      requestId: request.id,
      reason: request.reason,
      category: request.category,
      organizationName: request.organizationName,
    });

    // Notification interne à chaque compte ADMIN actif — canal in-app aujourd'hui, un canal
    // SMS pourra s'ajouter plus tard sans toucher cet appel (voir NotificationsModule).
    await this.notifications.notifyAdmins('PARTNERSHIP_REQUEST_NEW', {
      requestId: request.id,
      organizationName: request.organizationName,
      reason: request.reason,
      category: request.category,
    });

    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
    };
  }

  async listAll(filters: {
    status?: PartnershipRequestStatus;
    reason?: PartnershipRequestReason;
    assignedToId?: string;
    q?: string;
    category?: PartnershipRequestCategory;
  }) {
    return this.prisma.partnershipRequest.findMany({
      where: {
        status: filters.status,
        reason: filters.reason,
        category: filters.category,
        assignedToId: filters.assignedToId,
        organizationName: filters.q
          ? { contains: filters.q, mode: 'insensitive' }
          : undefined,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { assignedTo: { select: CONTACT_SELECT } },
    });
  }

  async getById(id: string) {
    const request = await this.prisma.partnershipRequest.findUnique({
      where: { id },
      include: {
        assignedTo: { select: CONTACT_SELECT },
        notes: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: CONTACT_SELECT } },
        },
      },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    return request;
  }

  async updateStatus(
    adminId: string,
    id: string,
    status: PartnershipRequestStatus,
  ) {
    const request = await this.mustFind(id);
    if (request.status === status) return this.getById(id);
    this.assertStatusTransition(request.category, request.status, status);

    await this.prisma.$transaction([
      this.prisma.partnershipRequest.update({
        where: { id },
        data: { status },
      }),
      this.prisma.partnershipRequestNote.create({
        data: {
          requestId: id,
          authorId: adminId,
          type: 'STATUS_CHANGE',
          metadata: { previousStatus: request.status, newStatus: status },
        },
      }),
    ]);

    await this.audit.record('PARTNERSHIP_REQUEST_STATUS_CHANGED', adminId, {
      requestId: id,
      previousStatus: request.status,
      newStatus: status,
    });

    return this.getById(id);
  }

  private assertStatusTransition(
    category: PartnershipRequestCategory,
    current: PartnershipRequestStatus,
    next: PartnershipRequestStatus,
  ): void {
    if (category !== 'NEED_QUOTE') return;
    const transitions: Record<
      PartnershipRequestStatus,
      PartnershipRequestStatus[]
    > = {
      QUOTE_PENDING: ['IN_PROGRESS'],
      IN_PROGRESS: ['QUOTE_SENT'],
      QUOTE_SENT: ['PROCESSED'],
      PROCESSED: ['CLOSED'],
      NEW: [],
      CLOSED: [],
    };
    if (!transitions[current]?.includes(next)) {
      throw new BadRequestException(
        `Transition de demande de devis interdite: ${current} -> ${next}.`,
      );
    }
  }

  async assign(adminId: string, id: string, assigneeId?: string | null) {
    await this.mustFind(id);
    const nextAssigneeId = assigneeId ?? null;

    // Team members eligible for assignment are ADMIN accounts (the only internal-staff
    // role in this system) — resolved and revalidated here rather than trusted from the
    // client, both to reject a stale/incorrect id and to snapshot the display name into
    // the note (immune to the user later being renamed or losing the role).
    let metadata: Prisma.InputJsonValue = { assigneeId: null };
    if (nextAssigneeId) {
      const activeAdminRole = await this.prisma.userRole.findFirst({
        where: {
          userId: nextAssigneeId,
          isActive: true,
          role: { name: 'ADMIN' },
        },
        include: { user: { select: { id: true, lsId: true } } },
      });
      if (!activeAdminRole) {
        throw new NotFoundException('Membre introuvable ou non habilité.');
      }
      metadata = {
        assigneeId: activeAdminRole.user.id,
        assigneeLsId: activeAdminRole.user.lsId,
      };
    }

    await this.prisma.$transaction([
      this.prisma.partnershipRequest.update({
        where: { id },
        data: { assignedToId: nextAssigneeId },
      }),
      this.prisma.partnershipRequestNote.create({
        data: {
          requestId: id,
          authorId: adminId,
          type: 'ASSIGNMENT',
          metadata,
        },
      }),
    ]);

    await this.audit.record('PARTNERSHIP_REQUEST_ASSIGNED', adminId, {
      requestId: id,
      assigneeId: nextAssigneeId,
    });

    return this.getById(id);
  }

  async addNote(adminId: string, id: string, content: string) {
    await this.mustFind(id);

    await this.prisma.partnershipRequestNote.create({
      data: { requestId: id, authorId: adminId, type: 'NOTE', content },
    });

    await this.audit.record('PARTNERSHIP_REQUEST_NOTE_ADDED', adminId, {
      requestId: id,
    });

    return this.getById(id);
  }

  async listAssignableUsers() {
    const rows = await this.prisma.userRole.findMany({
      where: { isActive: true, role: { name: 'ADMIN' } },
      include: { user: { select: CONTACT_SELECT } },
    });
    return rows.map((row) => row.user);
  }

  private async mustFind(id: string) {
    const request = await this.prisma.partnershipRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    return request;
  }
}
