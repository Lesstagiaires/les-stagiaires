import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NeedRequestStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import {
  NeedRequestDecision,
  RespondNeedRequestDto,
} from './dto/respond-need-request.dto';
import { SubmitNeedRequestDto } from './dto/submit-need-request.dto';
import { OrganizationAccessService } from './organization-access.service';

// Une organisation qui souhaite des stagiaires saisonniers, des bénévoles ou du
// personnel temporaire soumet son besoin à l'administrateur de la plateforme et
// attend une réponse sur les modalités avant toute mise en relation avec des profils —
// contrairement aux stages classiques, publiables directement (FR-M4-002).
@Injectable()
export class NeedRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async submit(
    userId: string,
    organizationId: string,
    dto: SubmitNeedRequestDto,
  ) {
    await this.access.assertCanManage(organizationId, userId);
    await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const request = await this.prisma.organizationNeedRequest.create({
      data: {
        organizationId,
        type: dto.type,
        quantity: dto.quantity,
        description: dto.description,
      },
    });
    await this.audit.record('NEED_REQUEST_SUBMITTED', userId, {
      organizationId,
      requestId: request.id,
      type: dto.type,
    });
    return request;
  }

  async listMine(userId: string, organizationId: string) {
    const isParticipant = await this.access.isParticipant(
      organizationId,
      userId,
    );
    if (!isParticipant) {
      throw new NotFoundException('Organisation introuvable.');
    }
    return this.prisma.organizationNeedRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Réservé à un compte ADMIN (@Roles('ADMIN') côté contrôleur).
  async listPending() {
    return this.prisma.organizationNeedRequest.findMany({
      where: { status: NeedRequestStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        organization: {
          select: { id: true, orgId: true, name: true, ownerId: true },
        },
      },
    });
  }

  async respond(
    adminUserId: string,
    requestId: string,
    dto: RespondNeedRequestDto,
  ) {
    const request = await this.prisma.organizationNeedRequest.findUnique({
      where: { id: requestId },
      include: {
        organization: { select: { id: true, name: true, ownerId: true } },
      },
    });
    if (!request) throw new NotFoundException('Demande introuvable.');
    if (request.status !== NeedRequestStatus.PENDING) {
      throw new BadRequestException('Cette demande a déjà reçu une réponse.');
    }

    const status =
      dto.decision === NeedRequestDecision.APPROVED
        ? NeedRequestStatus.APPROVED
        : NeedRequestStatus.REJECTED;
    const updated = await this.prisma.organizationNeedRequest.update({
      where: { id: requestId },
      data: {
        status,
        adminNote: dto.note,
        respondedAt: new Date(),
        respondedById: adminUserId,
      },
    });

    await this.audit.record('NEED_REQUEST_RESPONDED', adminUserId, {
      requestId,
      status,
    });

    const owner = await this.prisma.user.findUnique({
      where: { id: request.organization.ownerId },
    });
    if (owner?.phone) {
      const message =
        status === NeedRequestStatus.APPROVED
          ? `LES STAGIAIRES — la direction a approuvé votre besoin (${request.type}, ${request.quantity}). Vous pouvez désormais publier vos offres.${dto.note ? ` Modalités : ${dto.note}` : ''}`
          : `LES STAGIAIRES — la direction n'a pas approuvé votre besoin (${request.type}).${dto.note ? ` Motif : ${dto.note}` : ''}`;
      await this.sms.send(owner.phone, message);
    }

    return updated;
  }
}
