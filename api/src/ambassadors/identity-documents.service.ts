import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmbassadorEventType,
  AmbassadorIdentityDocumentStatus,
  DigitalSafeDocumentCategory,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttachIdentityDocumentDto } from './dto/attach-identity-document.dto';
import { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import { isTerminal } from './ambassador-status-groups';

// ============================================================================
// PIÈCES D'IDENTITÉ DU DOSSIER AMBASSADEUR
//
// Niveau « TRÈS SENSIBLE » (CLAUDE.md §1) : accès exceptionnel et limité,
// authentification renforcée, contrôle strict.
//
// CE SERVICE NE TOUCHE JAMAIS À UN FICHIER, et c'est délibéré.
//
// Le CLAUDE.md §6 interdit de stocker une pièce d'identité hors du Coffre-fort
// chiffré. Le fichier y est donc déposé par le module Coffre-fort — qui le
// chiffre, l'analyse contre les logiciels malveillants, en calcule l'empreinte,
// le versionne et journalise chaque consultation. Ce service-ci ne fait que
// RATTACHER un document du Coffre-fort à un dossier d'ambassadeur, et instruire
// ce rattachement.
//
// Le partage des rôles est ce qui rend la garantie vraie : il n'existe ici
// aucun chemin par lequel un octet de pièce d'identité pourrait sortir du
// périmètre chiffré, parce qu'aucune méthode ne lit le contenu d'un fichier.
//
// DEUX VÉRIFICATIONS À L'ATTACHEMENT, et elles comptent toutes les deux :
//   1. le document appartient bien à la personne qui l'attache — sans quoi
//      n'importe qui pourrait rattacher la pièce d'un autre à son dossier ;
//   2. il est bien de catégorie IDENTITY — un relevé de notes rattaché comme
//      pièce d'identité passerait la vérification d'un administrateur pressé.
// ============================================================================
@Injectable()
export class IdentityDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Le candidat rattache à son dossier une pièce DÉJÀ déposée au Coffre-fort.
  async attach(userId: string, dto: AttachIdentityDocumentDto) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true, status: true, applicationCycle: true },
    });
    if (!ambassador) {
      throw new NotFoundException('Aucune candidature à votre nom.');
    }
    if (isTerminal(ambassador.status)) {
      throw new ConflictException(
        'Votre dossier est clos : aucune pièce ne peut plus y être rattachée.',
      );
    }

    // --- VÉRIFICATION 1 — la propriété --------------------------------------
    // Le document doit appartenir à CELUI QUI L'ATTACHE. Sans ce contrôle, il
    // suffirait de connaître l'identifiant d'un document pour rattacher la
    // pièce d'identité de quelqu'un d'autre à son propre dossier — c'est
    // l'usurpation, servie par une faille d'autorisation (IDOR).
    const document = await this.prisma.digitalSafeDocument.findUnique({
      where: { id: dto.documentId },
      select: { id: true, userId: true, category: true, deletedAt: true },
    });

    if (!document || document.userId !== userId || document.deletedAt) {
      // MÊME RÉPONSE dans les trois cas : document inexistant, appartenant à un
      // autre, ou supprimé. Distinguer les réponses permettrait d'énumérer les
      // documents existants — on ne renseigne pas un attaquant sur ce qu'il a
      // trouvé.
      await this.audit.record('AMBASSADOR_IDENTITY_ATTACH_DENIED', userId, {
        ambassadorId: ambassador.id,
        documentId: dto.documentId,
        motif: 'DOCUMENT_INACCESSIBLE',
      });
      throw new NotFoundException(
        'Document introuvable dans votre coffre-fort.',
      );
    }

    // --- VÉRIFICATION 2 — la catégorie --------------------------------------
    if (document.category !== DigitalSafeDocumentCategory.IDENTITY) {
      throw new ConflictException(
        'Ce document n’est pas classé comme pièce d’identité dans votre coffre-fort.',
      );
    }

    const existing = await this.prisma.ambassadorIdentityDocument.findUnique({
      where: {
        ambassadorId_documentId: {
          ambassadorId: ambassador.id,
          documentId: dto.documentId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'Cette pièce est déjà rattachée à votre dossier.',
      );
    }

    const attached = await this.prisma.ambassadorIdentityDocument.create({
      data: {
        ambassadorId: ambassador.id,
        documentId: dto.documentId,
        type: dto.type,
        // Le cycle EN COURS : une pièce fournie au cycle 2 ne doit pas valider
        // un dossier qui repartirait au cycle 3 six mois plus tard.
        applicationCycle: ambassador.applicationCycle,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await this.audit.record('AMBASSADOR_IDENTITY_ATTACHED', userId, {
      ambassadorId: ambassador.id,
      identityDocumentId: attached.id,
      type: dto.type,
      applicationCycle: ambassador.applicationCycle,
      // L'identifiant du document, pas son contenu ni son titre : le titre est
      // saisi par l'utilisateur et peut contenir un numéro de pièce.
      documentId: dto.documentId,
    });

    return this.presentable(attached);
  }

  // Ce que le candidat voit de ses propres pièces. Ni titre, ni contenu : la
  // consultation du fichier passe par le Coffre-fort, qui la journalise.
  async listMine(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ambassador) return [];

    const documents = await this.prisma.ambassadorIdentityDocument.findMany({
      where: { ambassadorId: ambassador.id },
      orderBy: { uploadedAt: 'desc' },
    });
    return documents.map((document) => this.presentable(document));
  }

  // Ce que l'administration voit d'un dossier. Même contenu : instruire une
  // pièce, c'est la consulter DANS le Coffre-fort, où l'accès est tracé.
  async listForAmbassador(ambassadorId: string) {
    const documents = await this.prisma.ambassadorIdentityDocument.findMany({
      where: { ambassadorId },
      orderBy: { uploadedAt: 'desc' },
    });
    return documents.map((document) => this.presentable(document));
  }

  // --- Instruction ----------------------------------------------------------

  async verify(adminUserId: string, identityDocumentId: string) {
    const document = await this.getPending(identityDocumentId);

    const verified = await this.prisma.ambassadorIdentityDocument.update({
      where: { id: identityDocumentId },
      data: {
        status: AmbassadorIdentityDocumentStatus.VERIFIED,
        verifiedAt: new Date(),
        verifiedById: adminUserId,
        rejectionReasonCode: null,
      },
    });

    await this.journal(document.ambassadorId, {
      type: 'IDENTITY_DOCUMENT_VERIFIED',
      actorId: adminUserId,
      metadata: {
        identityDocumentId,
        documentType: document.type,
      },
    });
    await this.audit.record('AMBASSADOR_IDENTITY_VERIFIED', adminUserId, {
      ambassadorId: document.ambassadorId,
      identityDocumentId,
      type: document.type,
    });

    return this.presentable(verified);
  }

  // Le rejet exige les trois niveaux de motif, comme toute décision qui touche
  // une personne : la note reste interne, le code part en notification.
  async reject(
    adminUserId: string,
    identityDocumentId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const document = await this.getPending(identityDocumentId);

    const rejected = await this.prisma.ambassadorIdentityDocument.update({
      where: { id: identityDocumentId },
      data: {
        status: AmbassadorIdentityDocumentStatus.REJECTED,
        rejectionReasonCode: dto.reasonCode,
        verifiedAt: null,
        verifiedById: null,
      },
    });

    await this.journal(document.ambassadorId, {
      type: 'IDENTITY_DOCUMENT_REJECTED',
      actorId: adminUserId,
      metadata: {
        identityDocumentId,
        reasonCode: dto.reasonCode,
        internalNote: dto.internalNote,
      },
    });
    await this.audit.record('AMBASSADOR_IDENTITY_REJECTED', adminUserId, {
      ambassadorId: document.ambassadorId,
      identityDocumentId,
      reasonCode: dto.reasonCode,
      internalNote: dto.internalNote,
    });

    return this.presentable(rejected);
  }

  // LE VERROU D'ACTIVATION. Appelé avant de faire passer un dossier à ACTIVE :
  // rend la liste de ce qui s'y oppose, vide quand la voie est libre.
  //
  // Une pièce VÉRIFIÉE, non expirée, ET DU CYCLE EN COURS. Les trois conditions
  // comptent : activer sur la foi d'une pièce vérifiée il y a deux ans, pour un
  // dossier refusé puis redéposé entre-temps, reviendrait à ne pas vérifier.
  async blockingReasons(
    ambassadorId: string,
    now = new Date(),
  ): Promise<string[]> {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
      select: { applicationCycle: true },
    });
    if (!ambassador) return ['Dossier introuvable.'];

    const verified = await this.prisma.ambassadorIdentityDocument.findMany({
      where: {
        ambassadorId,
        status: AmbassadorIdentityDocumentStatus.VERIFIED,
        applicationCycle: ambassador.applicationCycle,
      },
      select: { expiresAt: true },
    });

    if (verified.length === 0) {
      return ['Aucune pièce d’identité vérifiée pour le cycle en cours.'];
    }

    const valide = verified.some(
      (document) => !document.expiresAt || document.expiresAt > now,
    );
    if (!valide) {
      return ['Les pièces d’identité vérifiées sont toutes expirées.'];
    }

    return [];
  }

  // Balayage : marque EXPIRED les pièces dont la date est passée. Distinct d'un
  // rejet — rien n'est reproché au candidat, il faut simplement une pièce à jour.
  async expireOutdated(now = new Date()): Promise<number> {
    const { count } = await this.prisma.ambassadorIdentityDocument.updateMany({
      where: {
        status: AmbassadorIdentityDocumentStatus.VERIFIED,
        expiresAt: { lt: now },
      },
      data: { status: AmbassadorIdentityDocumentStatus.EXPIRED },
    });

    if (count > 0) {
      await this.audit.record('AMBASSADOR_IDENTITY_EXPIRED', null, { count });
    }
    return count;
  }

  private async getPending(identityDocumentId: string) {
    const document = await this.prisma.ambassadorIdentityDocument.findUnique({
      where: { id: identityDocumentId },
    });
    if (!document) throw new NotFoundException('Pièce introuvable.');

    // Une pièce déjà instruite ne se réinstruit pas en silence : la décision
    // précédente a un auteur et une date, et l'écraser les effacerait.
    if (document.status !== AmbassadorIdentityDocumentStatus.PENDING) {
      throw new ConflictException(
        `Cette pièce a déjà été instruite (${document.status}).`,
      );
    }
    return document;
  }

  // Ce qui sort de ce service. AUCUN contenu, aucun titre, aucun numéro : le
  // fichier se consulte dans le Coffre-fort, qui trace chaque accès. Ici on ne
  // dit que l'état de l'instruction.
  private presentable(document: {
    id: string;
    type: string;
    status: AmbassadorIdentityDocumentStatus;
    applicationCycle: number;
    expiresAt: Date | null;
    verifiedAt: Date | null;
    rejectionReasonCode: string | null;
    uploadedAt: Date;
  }) {
    return {
      id: document.id,
      type: document.type,
      status: document.status,
      applicationCycle: document.applicationCycle,
      expiresAt: document.expiresAt,
      verifiedAt: document.verifiedAt,
      rejectionReasonCode: document.rejectionReasonCode,
      uploadedAt: document.uploadedAt,
    };
  }

  private async journal(
    ambassadorId: string,
    entry: {
      type: string;
      actorId: string;
      metadata: Record<string, unknown>;
    },
  ) {
    await this.prisma.ambassadorEvent.create({
      data: {
        ambassadorId,
        // Le type d'évènement le plus proche de ce qui se joue : une décision
        // sur l'identité. Le `kind` en métadonnée distingue la vérification du
        // rejet — ajouter deux valeurs à l'énumération pour cela obligerait à
        // reprendre toutes les correspondances exhaustives qui la parcourent.
        type: AmbassadorEventType.IDENTITY_VERIFIED,
        actorId: entry.actorId,
        metadata: { kind: entry.type, ...entry.metadata },
      },
    });
  }
}
