import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  OrganizationVerificationStatus,
  PartnershipDecisionReason,
  PartnershipEventType,
  PartnershipEventVisibility,
  PartnershipParty,
  PartnershipStatus,
} from '../../generated/prisma/enums';
import type { AuditChange } from '../audit/audit.service';
import { AuditService, diffOf } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationAccessService } from '../opportunities/organization-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovePartnershipDto } from './dto/approve-partnership.dto';
import { ListPartnershipsQueryDto } from './dto/list-partnerships-query.dto';
import { PartnershipDecisionDto } from './dto/partnership-decision.dto';
import {
  ProvideAdditionalInformationDto,
  RequestAdditionalInformationDto,
} from './dto/request-additional-information.dto';
import { PartnershipReasonDto } from './dto/partnership-reason.dto';
import { RequestPartnershipDto } from './dto/request-partnership.dto';
import { partnershipReference } from './partnership-reference';

// ============================================================================
// Un partenariat n'a PAS de durée dans la plateforme (décision du promoteur du
// 2026-07-31). Le module gère des statuts — actif, suspendu, résilié — et rien
// d'autre. Aucune date de fin n'est calculée, aucun compte à rebours n'est armé,
// aucune tâche planifiée ne fait changer un partenariat d'état.
//
// La durée, le renouvellement et les conditions de résiliation figurent dans le
// CONTRAT DE PARTENARIAT SIGNÉ, pas ici. Faire expirer un partenariat par une règle
// applicative reviendrait à contredire un contrat que le code ne connaît pas.
//
// Toute fin de partenariat résulte donc d'une décision administrative explicite,
// tracée, motivée — jamais de l'écoulement du temps.
// ============================================================================

// Champs exposés d'une organisation dans une réponse partenariat. Volontairement
// restreint au niveau « Public » de CLAUDE.md §1 : ni téléphone, ni email de contact,
// même dans le back-office — un partenariat n'a pas besoin de ces données pour être
// décidé, et l'annuaire public consommera la même sélection.
const PARTNERSHIP_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  type: true,
  sector: true,
  country: true,
  city: true,
  logoUrl: true,
  orgId: true,
  verificationStatus: true,
} as const;

// Champs d'un événement servis À L'ORGANISATION. `internalNote` en est absent, et
// c'est la seule raison d'être de cette constante : une sélection explicite ne peut
// pas laisser passer un champ ajouté plus tard au modèle, là où un `include` nu
// l'exposerait automatiquement le jour de sa création.
const PARTNERSHIP_EVENT_ORGANIZATION_SELECT = {
  id: true,
  type: true,
  reference: true,
  reasonCode: true,
  publicMessage: true,
  fromStatus: true,
  toStatus: true,
  informationRequestId: true,
  documentIds: true,
  notifiedTypes: true,
  metadata: true,
  createdAt: true,
} as const;

// Une demande est « en cours d'examen » tant qu'elle est en attente OU qu'un
// complément a été demandé. Dans les deux cas elle peut être acceptée ou refusée :
// un dossier resté incomplet doit pouvoir être clos, et un complément reçu hors
// plateforme ne doit pas bloquer une acceptation.
const DECIDABLE_STATUSES: PartnershipStatus[] = [
  PartnershipStatus.PENDING,
  PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
];

@Injectable()
export class PartnershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly orgAccess: OrganizationAccessService,
  ) {}

  // --- Candidature -----------------------------------------------------------------

  // Une organisation DÉJÀ vérifiée candidate au programme. Réservé au propriétaire et
  // aux administrateurs de l'organisation : candidater l'engage durablement et publie
  // son badge, ce n'est pas une action de gestion courante des offres (CLAUDE.md §3).
  async request(
    userId: string,
    organizationId: string,
    dto: RequestPartnershipDto,
  ) {
    await this.orgAccess.assertCanManageTeam(organizationId, userId);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, verificationStatus: true },
    });
    if (!organization) throw new NotFoundException('Organisation introuvable.');

    // Le type est résolu contre le CATALOGUE, jamais contre une liste codée en dur :
    // c'est tout l'intérêt d'en avoir fait une table. Un type désactivé n'est plus
    // proposable, sans que les partenariats déjà rattachés en souffrent.
    const type = await this.prisma.partnershipType.findUnique({
      where: { code: dto.typeCode },
    });
    if (!type || !type.isActive) {
      throw new BadRequestException(
        "Ce type de partenariat n'existe pas ou n'est plus proposé.",
      );
    }

    if (
      organization.verificationStatus !==
      OrganizationVerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        'Seule une organisation vérifiée peut candidater au programme de partenariat.',
      );
    }

    // L'unicité porte sur le COUPLE (organisation, type) : la même organisation peut
    // candidater à un partenariat de stage alors qu'elle est déjà partenaire
    // académique.
    const existing = await this.prisma.partnership.findUnique({
      where: {
        organizationId_typeId: { organizationId, typeId: type.id },
      },
    });

    // Une candidature en cours d'examen ou un partenariat en vigueur interdit une
    // nouvelle demande DE CE TYPE. En revanche un partenariat refusé ou résilié peut
    // être recandidaté : la table n'en garde qu'une ligne par couple, réinitialisée,
    // et l'historique des événements conserve la trace des cycles précédents.
    //
    // ADDITIONAL_INFORMATION_REQUIRED figure dans cette liste : le dossier est encore
    // ouvert. L'organisation doit le COMPLÉTER, pas en déposer un nouveau — c'est
    // exactement ce que le promoteur a demandé de rendre possible.
    if (
      existing &&
      (existing.status === PartnershipStatus.PENDING ||
        existing.status === PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED ||
        existing.status === PartnershipStatus.ACTIVE ||
        existing.status === PartnershipStatus.SUSPENDED)
    ) {
      throw new ConflictException(
        existing.status === PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED
          ? 'Un complément est attendu sur votre demande en cours. Complétez-la depuis votre espace plutôt que d’en déposer une nouvelle.'
          : 'Cette organisation a déjà une demande en cours ou un partenariat en vigueur de ce type.',
      );
    }

    const partnership = existing
      ? await this.prisma.partnership.update({
          where: { id: existing.id },
          data: {
            status: PartnershipStatus.PENDING,
            motivation: dto.motivation,
            requestedAt: new Date(),
            // Repartir d'une ardoise propre : sans cela, le motif de refus ou la
            // date de résiliation du cycle précédent resteraient collés au dossier.
            decidedAt: null,
            decidedById: null,
            decisionReason: null,
            decisionReasonCode: null,
            decisionPublicMessage: null,
            signedAt: null,
            terminationRequestedAt: null,
            terminationRequestedBy: null,
            terminationRequestedReason: null,
            terminatedAt: null,
            terminatedById: null,
            terminationReason: null,
            terminationReasonCode: null,
            terminationPublicMessage: null,
            suspendedAt: null,
            suspensionReason: null,
            suspensionReasonCode: null,
            suspensionPublicMessage: null,
            actionDeadline: null,
          },
        })
      : await this.prisma.partnership.create({
          data: { organizationId, typeId: type.id, motivation: dto.motivation },
        });

    const notifiedCount = await this.notifications.notifyAdmins(
      NotificationType.PARTNERSHIP_APPLIED,
      {
        partnershipId: partnership.id,
        organizationId,
        organizationName: organization.name,
        partnershipType: type.code,
      },
    );
    await this.journal(
      { id: partnership.id, organizationId, status: PartnershipStatus.PENDING },
      {
        type: PartnershipEventType.REQUESTED,
        action: 'PARTNERSHIP_REQUESTED',
        actorId: userId,
        // L'organisation a déposé cette demande : elle a le droit de la retrouver.
        visibility: PartnershipEventVisibility.ORGANIZATION,
        toStatus: PartnershipStatus.PENDING,
        notified: {
          types: [NotificationType.PARTNERSHIP_APPLIED],
          count: notifiedCount,
        },
        metadata: { partnershipType: type.code },
      },
    );

    return partnership;
  }

  // --- Complément de dossier -------------------------------------------------------

  // Le dossier est incomplet : on demande, on n'écarte pas.
  //
  // Arbitrage du promoteur du 2026-08-02 : « Un dossier incomplet ne doit pas être
  // traité comme un refus. » La demande reste ouverte, la candidature initiale reste
  // intacte, et le dossier pourra être réexaminé sans qu'une nouvelle demande soit
  // créée — donc sans que l'organisation ait à tout ressaisir.
  async requestAdditionalInformation(
    adminUserId: string,
    partnershipId: string,
    dto: RequestAdditionalInformationDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    if (
      partnership.status !== PartnershipStatus.PENDING &&
      partnership.status !== PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED
    ) {
      throw new BadRequestException(
        'Un complément ne peut être demandé que sur une demande en cours d’examen.',
      );
    }

    const actionDeadline = dto.actionDeadline
      ? new Date(dto.actionDeadline)
      : null;

    const [updated, request] = await this.prisma.$transaction([
      this.prisma.partnership.update({
        where: { id: partnershipId },
        data: {
          status: PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
          actionDeadline,
        },
      }),
      // L'historique, exigé explicitement : au troisième aller-retour, savoir ce qui
      // a déjà été demandé évite de redemander la même pièce.
      this.prisma.partnershipInformationRequest.create({
        data: {
          partnershipId,
          requestedById: adminUserId,
          requestedItems: dto.requestedItems,
          internalNote: dto.internalNote,
          publicMessage: dto.publicMessage ?? null,
          actionDeadline,
        },
      }),
    ]);

    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED,
      {
        ...this.baseMetadata(partnership),
        // Les pièces attendues voyagent en LISTE STRUCTURÉE. Le gabarit en fait
        // des puces dans la langue du destinataire ; le serveur n'écrit pas de
        // phrase.
        requestedItems: dto.requestedItems,
        publicMessage: dto.publicMessage,
        actionDeadline: actionDeadline?.toISOString(),
      },
    );
    await this.journal(partnership, {
      type: PartnershipEventType.ADDITIONAL_INFORMATION_REQUESTED,
      action: 'PARTNERSHIP_ADDITIONAL_INFORMATION_REQUESTED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
      publicMessage: dto.publicMessage,
      // La note interne vit DANS le journal, jamais dans ce qui est servi à
      // l'organisation : la visibilité et la sélection de champs l'en excluent.
      internalNote: dto.internalNote,
      informationRequestId: request.id,
      notified: {
        types: [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_REQUIRED],
        count: notifiedCount,
      },
      changes: [
        ...this.statusChange(
          partnership.status,
          PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED,
        ),
        ...diffOf(
          { actionDeadline: partnership.actionDeadline },
          { actionDeadline },
        ),
      ],
      metadata: { requestedItems: dto.requestedItems },
    });

    return updated;
  }

  // L'organisation complète son dossier. Le dossier revient en examen sans qu'une
  // nouvelle demande soit créée.
  async provideAdditionalInformation(
    userId: string,
    partnershipId: string,
    dto: ProvideAdditionalInformationDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    await this.orgAccess.assertCanManageTeam(
      partnership.organizationId,
      userId,
    );

    if (
      partnership.status !== PartnershipStatus.ADDITIONAL_INFORMATION_REQUIRED
    ) {
      throw new BadRequestException(
        'Aucun complément n’est attendu sur cette demande.',
      );
    }

    // La demande de complément encore ouverte — celle à laquelle on répond.
    const pending = await this.prisma.partnershipInformationRequest.findFirst({
      where: { partnershipId, resolvedAt: null },
      orderBy: { requestedAt: 'desc' },
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.partnership.update({
        where: { id: partnershipId },
        data: {
          // Retour en examen. La candidature initiale (`motivation`) n'est PAS
          // écrasée : la réponse s'ajoute au dossier, elle ne le remplace pas.
          status: PartnershipStatus.PENDING,
          actionDeadline: null,
        },
      }),
      ...(pending
        ? [
            this.prisma.partnershipInformationRequest.update({
              where: { id: pending.id },
              data: { resolvedAt: new Date(), response: dto.response },
            }),
          ]
        : []),
    ]);

    const notifiedCount = await this.notifications.notifyAdmins(
      NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED,
      this.baseMetadata(partnership),
    );
    await this.journal(partnership, {
      type: PartnershipEventType.ADDITIONAL_INFORMATION_PROVIDED,
      action: 'PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED',
      actorId: userId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.PENDING,
      informationRequestId: pending?.id,
      notified: {
        types: [NotificationType.PARTNERSHIP_ADDITIONAL_INFORMATION_PROVIDED],
        count: notifiedCount,
      },
      changes: this.statusChange(partnership.status, PartnershipStatus.PENDING),
    });

    return updated;
  }

  // --- Décisions d'administration --------------------------------------------------

  async approve(
    adminUserId: string,
    partnershipId: string,
    dto: ApprovePartnershipDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    if (!DECIDABLE_STATUSES.includes(partnership.status)) {
      throw new BadRequestException(
        'Seule une demande en cours d’examen peut être acceptée.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        status: PartnershipStatus.ACTIVE,
        decidedAt: now,
        decidedById: adminUserId,
        decisionReason: null,
        // Date de signature du contrat — informative. Aucune échéance n'en découle.
        signedAt: dto.signedAt ? new Date(dto.signedAt) : now,
      },
    });

    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_APPROVED,
      {
        ...this.baseMetadata(partnership),
        decisionDate: now.toISOString(),
        // Date de prise d'effet lorsqu'elle est connue. Le gabarit ne présente
        // JAMAIS l'acceptation administrative comme la signature d'un contrat :
        // c'est une exigence explicite du promoteur, et la nuance est juridique.
        effectiveDate: updated.signedAt?.toISOString(),
      },
    );
    await this.journal(partnership, {
      type: PartnershipEventType.APPROVED,
      action: 'PARTNERSHIP_APPROVED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.ACTIVE,
      notified: {
        types: [NotificationType.PARTNERSHIP_APPROVED],
        count: notifiedCount,
      },
      changes: [
        ...this.statusChange(partnership.status, PartnershipStatus.ACTIVE),
        ...diffOf(
          { signedAt: partnership.signedAt },
          { signedAt: updated.signedAt },
        ),
      ],
    });

    return updated;
  }

  async refuse(
    adminUserId: string,
    partnershipId: string,
    dto: PartnershipDecisionDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    if (!DECIDABLE_STATUSES.includes(partnership.status)) {
      throw new BadRequestException(
        'Seule une demande en cours d’examen peut être refusée.',
      );
    }

    const decidedAt = new Date();
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        status: PartnershipStatus.REFUSED,
        decidedAt,
        decidedById: adminUserId,
        decisionReason: dto.internalNote,
        decisionReasonCode: dto.reasonCode,
        decisionPublicMessage: dto.publicMessage ?? null,
        // Une contestation peut avoir un délai ; le partenariat, non.
        actionDeadline: dto.actionDeadline
          ? new Date(dto.actionDeadline)
          : null,
      },
    });

    // Le motif est transmis à l'organisation : un refus muet empêche toute correction
    // et toute contestation. Mais c'est le CODE communicable qui part, pas la note
    // interne — un refus se motive, il ne se commente pas.
    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_REFUSED,
      {
        ...this.baseMetadata(partnership),
        decisionDate: decidedAt.toISOString(),
        actionDeadline: dto.actionDeadline,
        reasonCode: dto.reasonCode,
        publicMessage: dto.publicMessage,
      },
    );
    await this.journal(partnership, {
      type: PartnershipEventType.REFUSED,
      action: 'PARTNERSHIP_REFUSED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.REFUSED,
      reasonCode: dto.reasonCode,
      publicMessage: dto.publicMessage,
      internalNote: dto.internalNote,
      notified: {
        types: [NotificationType.PARTNERSHIP_REFUSED],
        count: notifiedCount,
      },
      changes: this.statusChange(partnership.status, PartnershipStatus.REFUSED),
    });

    return updated;
  }

  // Suspension pour manquement — effet immédiat, réversible, réservée à un ADMIN.
  // Le partenariat n'est pas rompu : il est gelé le temps d'une vérification.
  async suspend(
    adminUserId: string,
    partnershipId: string,
    dto: PartnershipDecisionDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    if (partnership.status !== PartnershipStatus.ACTIVE) {
      throw new BadRequestException(
        'Seul un partenariat actif peut être suspendu.',
      );
    }

    const suspendedAt = new Date();
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        status: PartnershipStatus.SUSPENDED,
        suspendedAt,
        suspensionReason: dto.internalNote,
        suspensionReasonCode: dto.reasonCode,
        suspensionPublicMessage: dto.publicMessage ?? null,
        // Délai de régularisation, s'il en a été fixé un.
        actionDeadline: dto.actionDeadline
          ? new Date(dto.actionDeadline)
          : null,
      },
    });

    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_SUSPENDED,
      {
        ...this.baseMetadata(partnership),
        effectiveDate: suspendedAt.toISOString(),
        actionDeadline: dto.actionDeadline,
        reasonCode: dto.reasonCode,
        publicMessage: dto.publicMessage,
      },
    );
    await this.journal(partnership, {
      type: PartnershipEventType.SUSPENDED,
      action: 'PARTNERSHIP_SUSPENDED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.SUSPENDED,
      reasonCode: dto.reasonCode,
      publicMessage: dto.publicMessage,
      internalNote: dto.internalNote,
      notified: {
        types: [NotificationType.PARTNERSHIP_SUSPENDED],
        count: notifiedCount,
      },
      changes: this.statusChange(
        partnership.status,
        PartnershipStatus.SUSPENDED,
      ),
    });

    return updated;
  }

  async reinstate(adminUserId: string, partnershipId: string) {
    const partnership = await this.getOrThrow(partnershipId);
    if (partnership.status !== PartnershipStatus.SUSPENDED) {
      throw new BadRequestException(
        'Seul un partenariat suspendu peut être réintégré.',
      );
    }

    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        status: PartnershipStatus.ACTIVE,
        // Les trois niveaux de motif s'effacent ensemble. En laisser un derrière
        // reviendrait à conserver la trace visible d'une suspension levée.
        suspendedAt: null,
        suspensionReason: null,
        suspensionReasonCode: null,
        suspensionPublicMessage: null,
      },
    });

    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_REINSTATED,
      this.baseMetadata(partnership),
    );
    await this.journal(partnership, {
      type: PartnershipEventType.REINSTATED,
      action: 'PARTNERSHIP_REINSTATED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.ACTIVE,
      notified: {
        types: [NotificationType.PARTNERSHIP_REINSTATED],
        count: notifiedCount,
      },
      changes: this.statusChange(partnership.status, PartnershipStatus.ACTIVE),
    });

    return updated;
  }

  // --- Résiliation -------------------------------------------------------------------

  // Résiliation effective : décision administrative, effet immédiat, motif obligatoire.
  // Elle peut faire suite à une demande de l'organisation ou être à l'initiative de la
  // plateforme. Dans les deux cas, c'est un ADMIN qui la prononce — le contrat signé
  // régit le préavis éventuel entre les parties, pas la plateforme.
  async terminate(
    adminUserId: string,
    partnershipId: string,
    dto: PartnershipDecisionDto,
  ) {
    const partnership = await this.getOrThrow(partnershipId);
    if (
      partnership.status !== PartnershipStatus.ACTIVE &&
      partnership.status !== PartnershipStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        'Seul un partenariat actif ou suspendu peut être résilié.',
      );
    }

    const terminatedAt = new Date();
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        status: PartnershipStatus.TERMINATED,
        terminatedAt,
        terminatedById: adminUserId,
        terminationReason: dto.internalNote,
        terminationReasonCode: dto.reasonCode,
        terminationPublicMessage: dto.publicMessage ?? null,
        actionDeadline: dto.actionDeadline
          ? new Date(dto.actionDeadline)
          : null,
      },
    });

    const notifiedCount = await this.notifications.notifyOrganizationLeadership(
      partnership.organizationId,
      NotificationType.PARTNERSHIP_TERMINATED,
      {
        ...this.baseMetadata(partnership),
        effectiveDate: terminatedAt.toISOString(),
        actionDeadline: dto.actionDeadline,
        reasonCode: dto.reasonCode,
        publicMessage: dto.publicMessage,
      },
    );
    await this.journal(partnership, {
      type: PartnershipEventType.TERMINATED,
      action: 'PARTNERSHIP_TERMINATED',
      actorId: adminUserId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      toStatus: PartnershipStatus.TERMINATED,
      reasonCode: dto.reasonCode,
      publicMessage: dto.publicMessage,
      internalNote: dto.internalNote,
      notified: {
        types: [NotificationType.PARTNERSHIP_TERMINATED],
        count: notifiedCount,
      },
      changes: this.statusChange(
        partnership.status,
        PartnershipStatus.TERMINATED,
      ),
      metadata: { requestedBy: partnership.terminationRequestedBy },
    });

    return updated;
  }

  // Demande de résiliation, ouverte aux deux parties. Elle NE CHANGE PAS le statut et
  // n'arme aucun compte à rebours : elle informe l'autre partie et ouvre la discussion
  // prévue au contrat. Seul `terminate` met fin au partenariat.
  //
  // Les deux parties ne soumettent pas la même chose, et c'est voulu : une
  // organisation écrit librement à la plateforme (ses mots lui appartiennent),
  // tandis que la plateforme, qui s'adresse à un partenaire, passe par la liste
  // contrôlée de motifs.
  async requestTermination(
    userId: string,
    partnershipId: string,
    by: PartnershipParty,
    dto: PartnershipReasonDto | PartnershipDecisionDto,
  ) {
    const internalNote = 'internalNote' in dto ? dto.internalNote : dto.reason;
    const reasonCode = 'reasonCode' in dto ? dto.reasonCode : undefined;
    const publicMessage =
      'publicMessage' in dto ? dto.publicMessage : undefined;
    // Le gabarit n'annonce un échange entre les parties que si celui-ci est
    // effectivement prévu par le contrat ou la procédure. Annoncer une phase
    // contradictoire inexistante créerait une attente que la plateforme ne pourrait
    // pas honorer — et qui pourrait lui être opposée.
    const contradictoryProcedure =
      'contradictoryProcedure' in dto ? dto.contradictoryProcedure : undefined;

    const partnership = await this.getOrThrow(partnershipId);

    // Une organisation ne demande la résiliation que de son propre partenariat ; la
    // plateforme (ADMIN) est autorisée par le garde de rôle du contrôleur.
    if (by === PartnershipParty.ORGANIZATION) {
      await this.orgAccess.assertCanManageTeam(
        partnership.organizationId,
        userId,
      );
    }

    if (
      partnership.status !== PartnershipStatus.ACTIVE &&
      partnership.status !== PartnershipStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        "Seul un partenariat en vigueur peut faire l'objet d'une demande de résiliation.",
      );
    }
    if (partnership.terminationRequestedAt) {
      throw new ConflictException(
        'Une demande de résiliation est déjà en cours.',
      );
    }

    const requestedAt = new Date();
    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        terminationRequestedAt: requestedAt,
        terminationRequestedBy: by,
        terminationRequestedReason: internalNote,
      },
    });

    const common = {
      ...this.baseMetadata(partnership),
      requestedBy: by,
      requestedAt: requestedAt.toISOString(),
    };

    let notifiedCount = 0;
    if (by === PartnershipParty.ORGANIZATION) {
      // Prévenir l'administration, qui doit instruire la demande. Le texte rédigé
      // par l'organisation lui est destiné : c'est le seul cas où un champ libre
      // circule, et il circule dans le bon sens — du partenaire vers la plateforme.
      notifiedCount += await this.notifications.notifyAdmins(
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        { ...common, recipient: 'ADMIN', publicMessage: internalNote },
      );
      // ET accuser réception auprès de l'organisation. Sans cela, une organisation
      // qui demande à se désengager n'obtient aucune trace de sa démarche et peut
      // légitimement croire son partenariat déjà rompu — alors qu'il court toujours.
      notifiedCount += await this.notifications.notifyOrganizationLeadership(
        partnership.organizationId,
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        { ...common, recipient: 'ORGANIZATION' },
      );
    } else {
      // La plateforme annonce son intention : l'organisation est prévenue avant que
      // la décision ne soit prononcée, avec le motif communicable.
      notifiedCount += await this.notifications.notifyOrganizationLeadership(
        partnership.organizationId,
        NotificationType.PARTNERSHIP_TERMINATION_REQUESTED,
        {
          ...common,
          recipient: 'ORGANIZATION',
          reasonCode,
          publicMessage,
          // Booléen transmis en clair : le gabarit décide d'annoncer, ou non, un
          // échange entre les parties.
          contradictoryProcedure: contradictoryProcedure ? 'true' : undefined,
        },
      );
    }

    // Une demande de résiliation NE CHANGE PAS le statut : `toStatus` est donc
    // volontairement absent, et le journal le montre — la transition enregistrée va
    // du statut courant vers lui-même.
    await this.journal(partnership, {
      type: PartnershipEventType.TERMINATION_REQUESTED,
      action: 'PARTNERSHIP_TERMINATION_REQUESTED',
      actorId: userId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      reasonCode,
      publicMessage,
      internalNote,
      notified: {
        types: [NotificationType.PARTNERSHIP_TERMINATION_REQUESTED],
        count: notifiedCount,
      },
      changes: diffOf(
        {
          terminationRequestedAt: partnership.terminationRequestedAt,
          terminationRequestedBy: partnership.terminationRequestedBy,
        },
        { terminationRequestedAt: requestedAt, terminationRequestedBy: by },
      ),
      metadata: { requestedBy: by, contradictoryProcedure },
    });

    return updated;
  }

  // Retrait de la demande — un désengagement décidé dans l'urgence ne doit pas être
  // irréversible tant que la résiliation n'a pas été prononcée.
  async withdrawTerminationRequest(
    userId: string,
    partnershipId: string,
    by: PartnershipParty,
  ) {
    const partnership = await this.getOrThrow(partnershipId);

    if (by === PartnershipParty.ORGANIZATION) {
      await this.orgAccess.assertCanManageTeam(
        partnership.organizationId,
        userId,
      );
    }

    if (!partnership.terminationRequestedAt) {
      throw new BadRequestException('Aucune demande de résiliation en cours.');
    }
    // Seule la partie à l'origine de la demande peut la retirer : laisser l'autre
    // l'annuler reviendrait à lui imposer la poursuite du partenariat.
    if (partnership.terminationRequestedBy !== by) {
      throw new ForbiddenException(
        "Seule la partie à l'origine de la demande peut la retirer.",
      );
    }

    const updated = await this.prisma.partnership.update({
      where: { id: partnershipId },
      data: {
        terminationRequestedAt: null,
        terminationRequestedBy: null,
        terminationRequestedReason: null,
      },
    });

    const notifiedCount =
      by === PartnershipParty.ORGANIZATION
        ? await this.notifications.notifyAdmins(
            NotificationType.PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN,
            this.baseMetadata(partnership),
          )
        : await this.notifications.notifyOrganizationLeadership(
            partnership.organizationId,
            NotificationType.PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN,
            this.baseMetadata(partnership),
          );

    await this.journal(partnership, {
      type: PartnershipEventType.TERMINATION_REQUEST_WITHDRAWN,
      action: 'PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN',
      actorId: userId,
      visibility: PartnershipEventVisibility.ORGANIZATION,
      notified: {
        types: [NotificationType.PARTNERSHIP_TERMINATION_REQUEST_WITHDRAWN],
        count: notifiedCount,
      },
      changes: diffOf(
        {
          terminationRequestedAt: partnership.terminationRequestedAt,
          terminationRequestedBy: partnership.terminationRequestedBy,
        },
        { terminationRequestedAt: null, terminationRequestedBy: null },
      ),
      metadata: { withdrawnBy: by },
    });

    return updated;
  }

  // --- Lecture ---------------------------------------------------------------------

  async getForOrganization(userId: string, organizationId: string) {
    await this.orgAccess.assertCanManage(organizationId, userId);

    // Une LISTE depuis le 2026-08-02 : une organisation peut être partenaire à
    // plusieurs titres. Une liste vide n'est pas une erreur — l'organisation n'a
    // simplement jamais candidaté, et l'écran doit pouvoir proposer la candidature.
    return this.prisma.partnership.findMany({
      where: { organizationId },
      orderBy: { requestedAt: 'desc' },
      include: {
        organization: { select: PARTNERSHIP_ORGANIZATION_SELECT },
        type: true,
        events: {
          // DEUX FILTRES, ET LES DEUX COMPTENT.
          //
          // La visibilité écarte les événements d'instruction interne ; la sélection
          // de champs écarte `internalNote` de tous les autres. Le second n'est pas
          // redondant : il suffirait qu'un événement soit un jour marqué ORGANIZATION
          // par erreur pour qu'une note d'administration parte chez le partenaire.
          // Ici, elle ne quitte jamais la base.
          where: { visibility: PartnershipEventVisibility.ORGANIZATION },
          orderBy: { createdAt: 'desc' },
          select: PARTNERSHIP_EVENT_ORGANIZATION_SELECT,
        },
        informationRequests: {
          orderBy: { requestedAt: 'desc' },
          // Même raison : `internalNote` est absent de cette sélection.
          select: {
            id: true,
            requestedItems: true,
            publicMessage: true,
            actionDeadline: true,
            requestedAt: true,
            resolvedAt: true,
            response: true,
          },
        },
      },
    });
  }

  // HISTORIQUE COMPLET, réservé à l'administration : celui-ci ne filtre rien, ni la
  // visibilité, ni les notes internes. C'est la vue d'instruction.
  //
  // DEUX LISTES SÉPARÉES, ET NON UNE SEULE. La recette du 2026-08-02 a montré que
  // les fondre dans un même tableau présente à l'administrateur, comme s'ils
  // appartenaient au dossier courant, des événements qui relèvent d'un dossier
  // ANTÉRIEUR de la même organisation — décisions parfois contradictoires, prises
  // sur un partenariat d'un autre type ou depuis supprimé. Un journal qui mélange
  // deux dossiers induit en erreur plus sûrement qu'un journal incomplet.
  //
  // Les deux listes sont néanmoins servies ensemble : c'est ce qui garantit qu'on
  // ne perd jamais l'historique, même orphelin.
  async getHistory(partnershipId: string) {
    const partnership = await this.prisma.partnership.findUnique({
      where: { id: partnershipId },
      select: { id: true, organizationId: true },
    });
    if (!partnership) throw new NotFoundException('Partenariat introuvable.');

    const include = { actor: { select: { id: true, lsId: true } } };

    const [events, orphanedEvents] = await Promise.all([
      this.prisma.partnershipEvent.findMany({
        where: { partnershipId },
        orderBy: { createdAt: 'desc' },
        include,
      }),
      // Décisions dont le partenariat a disparu — rattachables à l'organisation par
      // le seul champ recopié sur la ligne. Elles portent leur propre `reference`,
      // ce qui permet de distinguer les dossiers entre eux.
      this.prisma.partnershipEvent.findMany({
        where: {
          organizationId: partnership.organizationId,
          partnershipId: null,
        },
        orderBy: { createdAt: 'desc' },
        include,
      }),
    ]);

    return { partnershipId, events, orphanedEvents };
  }

  async listAll(query: ListPartnershipsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = {
      ...(query.status && { status: query.status }),
      ...(query.country && { organization: { country: query.country } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.partnership.findMany({
        where,
        // Les demandes en attente d'abord — la file d'attente sert à traiter, pas à
        // contempler l'historique.
        orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organization: { select: PARTNERSHIP_ORGANIZATION_SELECT },
          type: true,
        },
      }),
      this.prisma.partnership.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(partnershipId: string) {
    const partnership = await this.prisma.partnership.findUnique({
      where: { id: partnershipId },
      include: {
        organization: { select: PARTNERSHIP_ORGANIZATION_SELECT },
        type: true,
        events: { orderBy: { createdAt: 'desc' } },
        informationRequests: { orderBy: { requestedAt: 'desc' } },
      },
    });
    if (!partnership) throw new NotFoundException('Partenariat introuvable.');
    return partnership;
  }

  // --- Interne ---------------------------------------------------------------------

  private async getOrThrow(partnershipId: string) {
    const partnership = await this.prisma.partnership.findUnique({
      where: { id: partnershipId },
      // Le nom de l'organisation et le type de partenariat accompagnent toutes les
      // décisions : un e-mail institutionnel nomme son destinataire (« le
      // partenariat de [Organisation] »), il ne s'adresse pas à un identifiant.
      include: {
        organization: { select: { name: true } },
        type: { select: { code: true } },
      },
    });
    if (!partnership) throw new NotFoundException('Partenariat introuvable.');
    return partnership;
  }

  // Métadonnées communes à toutes les notifications de partenariat. Elles portent
  // des FAITS STRUCTURÉS — un code de motif, une date ISO, un nom — jamais une
  // phrase pré-rédigée : c'est ce qui permet au gabarit de composer le message dans
  // la langue du destinataire.
  //
  // Ce qui n'y figure PAS est aussi important : la note interne de l'administrateur
  // n'est jamais recopiée ici. Elle ne peut donc pas partir par e-mail, même par
  // accident, puisqu'elle n'entre jamais dans le circuit de diffusion.
  private baseMetadata(partnership: {
    id: string;
    organization: { name: string };
    type: { code: string };
  }) {
    return {
      partnershipId: partnership.id,
      reference: partnershipReference(partnership.id),
      organizationName: partnership.organization.name,
      // Le code du CATALOGUE — la vraie nature du partenariat, plus celle de
      // l'organisation. Le client le traduit ; le serveur n'envoie qu'un code.
      partnershipType: partnership.type.code,
    };
  }

  // JOURNAL DES DÉCISIONS — un seul appel écrit l'événement ET la trace d'audit.
  //
  // Les deux étaient auparavant deux appels distincts sur chacun des neuf points de
  // décision : rien n'empêchait d'en ajouter un dixième et d'oublier l'un des deux.
  // Les fusionner rend l'oubli impossible.
  //
  // ORDRE DÉLIBÉRÉ : les appelants notifient AVANT de journaliser, et transmettent
  // ici ce qui est réellement parti. Journaliser d'abord donnerait une trace qui
  // affirme qu'une notification a été envoyée alors qu'elle a pu échouer — dans un
  // journal, une affirmation fausse est pire qu'une absence. Si l'écriture du
  // journal échoue après l'envoi, la requête échoue, l'administrateur recommence, et
  // l'organisation reçoit un doublon : un doublon vaut mieux qu'un trou.
  private async journal(
    partnership: {
      id: string;
      organizationId: string;
      status: PartnershipStatus;
    },
    entry: {
      type: PartnershipEventType;
      action: string;
      actorId: string | null;
      visibility?: PartnershipEventVisibility;
      toStatus?: PartnershipStatus;
      reasonCode?: PartnershipDecisionReason;
      publicMessage?: string;
      internalNote?: string;
      informationRequestId?: string;
      documentIds?: string[];
      notified?: { types: NotificationType[]; count: number };
      changes?: AuditChange[];
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.prisma.partnershipEvent.create({
      data: {
        partnershipId: partnership.id,
        // Recopiés pour que l'événement reste lisible même si le partenariat
        // disparaît un jour — c'est ce qui rend l'historique impossible à perdre.
        organizationId: partnership.organizationId,
        reference: partnershipReference(partnership.id),
        type: entry.type,
        actorId: entry.actorId,
        // Défaut FERMÉ : un événement n'est visible de l'organisation que si on l'a
        // décidé explicitement.
        visibility: entry.visibility ?? PartnershipEventVisibility.ADMIN_ONLY,
        fromStatus: partnership.status,
        toStatus: entry.toStatus ?? partnership.status,
        reasonCode: entry.reasonCode ?? null,
        publicMessage: entry.publicMessage ?? null,
        internalNote: entry.internalNote ?? null,
        informationRequestId: entry.informationRequestId ?? null,
        documentIds: entry.documentIds ?? [],
        notifiedTypes: entry.notified?.types ?? [],
        notifiedCount: entry.notified?.count ?? 0,
        // Données structurées uniquement : le client mobile les traduit dans la langue
        // de l'utilisateur. Jamais de phrase pré-rédigée côté serveur.
        metadata: entry.metadata as never,
      },
    });

    await this.audit.recordChange(entry.action, entry.actorId, {
      entityType: 'Partnership',
      entityId: partnership.id,
      changes: entry.changes,
      metadata: {
        organizationId: partnership.organizationId,
        reference: partnershipReference(partnership.id),
        eventType: entry.type,
      },
    });
  }

  // Transition de statut, sous la forme attendue par le journal d'audit :
  // ancienne valeur, nouvelle valeur.
  private statusChange(
    from: PartnershipStatus,
    to: PartnershipStatus,
  ): AuditChange[] {
    return diffOf({ status: from }, { status: to });
  }
}
