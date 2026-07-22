import { ForbiddenException, Injectable } from '@nestjs/common';
import { DigitalSafeAccessAction } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

// Journal d'accès dédié (FR-M3-009) — table interrogeable par le titulaire, distincte
// du journal d'audit système générique.
@Injectable()
export class AccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    documentId: string,
    action: DigitalSafeAccessAction,
    actorUserId?: string,
    shareId?: string,
  ) {
    await this.prisma.digitalSafeAccessLog.create({
      data: { documentId, action, actorUserId, shareId },
    });
  }

  async listForDocument(userId: string, documentId: string) {
    const document = await this.prisma.digitalSafeDocument.findUnique({
      where: { id: documentId },
    });
    if (!document || document.userId !== userId) {
      throw new ForbiddenException('Ce document ne concerne pas ce compte.');
    }
    return this.prisma.digitalSafeAccessLog.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, lsId: true } } },
    });
  }
}
