import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import {
  AccountStatus,
  ApplicationArtifactKind,
  ApplicationDocumentRequestStatus,
  ApplicationStatus,
  DigitalSafeDocumentCategory,
  OpportunityStatus,
  OrganizationVerificationStatus,
  ParentalLinkStatus,
  ShareTargetType,
  TravelConsentStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { CvService } from '../profiles/cv.service';
import { ProfilesService } from '../profiles/profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { DigitalSafeDocumentsService } from '../digital-safe/documents.service';
import { SharesService } from '../digital-safe/shares.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { CreateApplicationDto } from './dto/create-application.dto';
import { CreateDocumentRequestDto } from './dto/create-document-request.dto';
import { FulfillDocumentRequestDto } from './dto/fulfill-document-request.dto';
import { ProposeInterviewDto } from './dto/propose-interview.dto';
import {
  ApplicationDecision,
  DecideApplicationDto,
} from './dto/decide-application.dto';
import { generateApplicationReference } from './reference.util';

const APPLICATION_INCLUDE = {
  organization: { select: { id: true, name: true, ownerId: true } },
  opportunity: {
    select: {
      id: true,
      title: true,
      relocationRequired: true,
      city: true,
      country: true,
    },
  },
} as const;

// select explicite plutôt qu'include-tout pour toute réponse renvoyée telle quelle au
// client : candidateSignedIp/organizationSignedIp sont journalisés pour la traçabilité
// de la signature mais n'ont aucune raison d'être exposés à l'autre partie (CLAUDE.md §6).
const APPLICATION_SAFE_SELECT = {
  id: true,
  reference: true,
  candidateId: true,
  organizationId: true,
  opportunityId: true,
  status: true,
  dossierSnapshot: true,
  willingToRelocate: true,
  hasFamilyInDestination: true,
  interviewProposedAt: true,
  interviewMode: true,
  interviewLocation: true,
  interviewConfirmedAt: true,
  decisionAt: true,
  decisionNote: true,
  candidateSignedAt: true,
  candidateSignedName: true,
  organizationSignedAt: true,
  organizationSignedName: true,
  startedAt: true,
  withdrawnAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  ...APPLICATION_INCLUDE,
} as const;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly cv: CvService,
    private readonly profiles: ProfilesService,
    private readonly digitalSafeDocuments: DigitalSafeDocumentsService,
    private readonly shares: SharesService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  // --- FR-M5-001 / 002 : dossier préreempli et aperçu -------------------------------------

  async preview(candidateId: string) {
    return this.buildDossierSnapshot(candidateId);
  }

  private async buildDossierSnapshot(candidateId: string) {
    // Garantit qu'un profil existe même pour un candidat qui n'a jamais rien renseigné —
    // un dossier vide reste un dossier valide, pas une erreur 404 (FR-M5-001).
    await this.profiles.getOrCreateOwnProfile(candidateId);
    return this.cv.getCvVivant(candidateId, candidateId);
  }

  // --- FR-M5-001 / 003 / 004 / 010 + FR-M4-005 / 006 / 011 : dépôt ------------------------

  async create(candidateId: string, dto: CreateApplicationDto) {
    if (!dto.opportunityId === !dto.organizationId) {
      throw new BadRequestException(
        'Fournir soit opportunityId, soit organizationId (candidature spontanée), jamais les deux ni aucun des deux.',
      );
    }

    const candidate = await this.prisma.user.findUniqueOrThrow({
      where: { id: candidateId },
    });
    // Mineur en mode restreint : la candidature réelle reste bloquée tant que le
    // consentement parental n'est pas confirmé — la constitution du profil reste
    // accessible, seule cette action transactionnelle est conditionnée (CLAUDE.md §5).
    if (candidate.status === AccountStatus.AWAITING_PARENTAL_CONSENT) {
      throw new ForbiddenException(
        "La candidature réelle est bloquée tant que le consentement parental n'est pas confirmé.",
      );
    }

    let organizationId: string;
    let opportunityId: string | null = null;
    let willingToRelocate: boolean | null = null;
    let hasFamilyInDestination: boolean | null = null;

    if (dto.opportunityId) {
      const opportunity = await this.prisma.opportunity.findUnique({
        where: { id: dto.opportunityId },
      });
      if (!opportunity || opportunity.status !== OpportunityStatus.ACTIVE) {
        throw new NotFoundException('Offre introuvable ou non active.');
      }

      // Un mineur peut candidater à toute offre, y compris à relocalisation — c'est
      // l'acceptation, pas le dépôt, qui déclenchera l'accord parental de déplacement
      // (voir decide()). Ne jamais bloquer la candidature elle-même ici.
      if (opportunity.relocationRequired) {
        if (dto.willingToRelocate === undefined) {
          throw new BadRequestException(
            'willingToRelocate est requis pour cette offre (FR-M4-005).',
          );
        }
        willingToRelocate = dto.willingToRelocate;

        if (candidate.isMinor) {
          if (dto.hasFamilyInDestination === undefined) {
            throw new BadRequestException(
              'hasFamilyInDestination est requis pour cette offre (compte mineur).',
            );
          }
          hasFamilyInDestination = dto.hasFamilyInDestination;
        }
      }

      const duplicate = await this.prisma.application.findFirst({
        where: {
          candidateId,
          opportunityId: opportunity.id,
          status: {
            notIn: [ApplicationStatus.WITHDRAWN, ApplicationStatus.REJECTED],
          },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'Une candidature active existe déjà pour cette offre.',
        );
      }

      organizationId = opportunity.organizationId;
      opportunityId = opportunity.id;
    } else {
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization)
        throw new NotFoundException('Organisation introuvable.');
      if (
        organization.verificationStatus !==
        OrganizationVerificationStatus.VERIFIED
      ) {
        throw new ForbiddenException(
          'Seule une organisation vérifiée peut recevoir une candidature spontanée.',
        );
      }

      const duplicate = await this.prisma.application.findFirst({
        where: {
          candidateId,
          organizationId: organization.id,
          opportunityId: null,
          status: {
            notIn: [ApplicationStatus.WITHDRAWN, ApplicationStatus.REJECTED],
          },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'Une candidature spontanée active existe déjà auprès de cette organisation.',
        );
      }

      organizationId = organization.id;
    }

    const dossierSnapshot = await this.buildDossierSnapshot(candidateId);
    const reference = await this.generateUniqueReference();

    const application = await this.prisma.application.create({
      data: {
        reference,
        candidateId,
        organizationId,
        opportunityId,
        dossierSnapshot,
        willingToRelocate,
        hasFamilyInDestination,
      },
      select: APPLICATION_SAFE_SELECT,
    });

    await this.recordEvent(
      application.id,
      null,
      ApplicationStatus.SUBMITTED,
      candidateId,
    );
    await this.audit.record('APPLICATION_SUBMITTED', candidateId, {
      applicationId: application.id,
      reference,
    });

    await this.notify(
      candidateId,
      `LES STAGIAIRES — candidature reçue, référence ${reference}. Vous serez notifié à chaque étape.`,
    );
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — nouvelle candidature reçue (réf. ${reference}).`,
    );

    return application;
  }

  private async generateUniqueReference(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateApplicationReference();
      const exists = await this.prisma.application.findUnique({
        where: { reference: candidate },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      'Impossible de générer une référence de candidature unique, réessayez.',
    );
  }

  // --- FR-M5-005 : suivi ------------------------------------------------------------------

  async listMine(candidateId: string) {
    return this.prisma.application.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
      select: APPLICATION_SAFE_SELECT,
    });
  }

  async listReceived(
    ownerId: string,
    filters: {
      organizationId?: string;
      opportunityId?: string;
      status?: ApplicationStatus;
    },
  ) {
    return this.prisma.application.findMany({
      where: {
        organization: { ownerId },
        ...(filters.organizationId && {
          organizationId: filters.organizationId,
        }),
        ...(filters.opportunityId && { opportunityId: filters.opportunityId }),
        ...(filters.status && { status: filters.status }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        ...APPLICATION_SAFE_SELECT,
        candidate: { select: { id: true, lsId: true } },
      },
    });
  }

  async getById(userId: string, id: string) {
    const application = await this.getApplicationOr404(id);
    if (!this.isParticipant(userId, application)) {
      // 404 plutôt que 403 : ne pas confirmer l'existence d'une candidature à un tiers.
      throw new NotFoundException('Candidature introuvable.');
    }
    return this.prisma.application.findUnique({
      where: { id },
      select: {
        ...APPLICATION_SAFE_SELECT,
        candidate: { select: { id: true, lsId: true } },
        history: { orderBy: { createdAt: 'asc' } },
        documentRequests: { orderBy: { createdAt: 'desc' } },
        artifacts: {
          select: { id: true, kind: true, createdAt: true },
        },
      },
    });
  }

  // --- Traitement (Périmètre MVP module 5) --------------------------------------------------

  async markUnderReview(ownerId: string, id: string) {
    const application = await this.assertOrganizationOwner(ownerId, id);
    this.assertTransition(application.status, [ApplicationStatus.SUBMITTED]);
    await this.transitionStatus(
      application,
      ApplicationStatus.UNDER_REVIEW,
      ownerId,
    );
  }

  // --- FR-M5-006 : complément --------------------------------------------------------------

  async requestDocument(
    ownerId: string,
    id: string,
    dto: CreateDocumentRequestDto,
  ) {
    const application = await this.assertOrganizationOwner(ownerId, id);
    this.assertTransition(application.status, [
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.INTERVIEW_PROPOSED,
      ApplicationStatus.INTERVIEW_CONFIRMED,
    ]);

    const request = await this.prisma.applicationDocumentRequest.create({
      data: {
        applicationId: id,
        requestedByUserId: ownerId,
        description: dto.description,
      },
    });

    await this.transitionStatus(
      application,
      ApplicationStatus.ADDITIONAL_DOCUMENT_REQUESTED,
      ownerId,
      dto.description,
    );
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — document complémentaire demandé pour votre candidature ${application.reference} : ${dto.description}`,
    );
    return request;
  }

  async fulfillDocumentRequest(
    candidateId: string,
    id: string,
    requestId: string,
    dto: FulfillDocumentRequestDto,
  ) {
    const application = await this.assertCandidate(candidateId, id);
    const request = await this.prisma.applicationDocumentRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.applicationId !== id) {
      throw new NotFoundException('Demande de document introuvable.');
    }
    if (request.status === ApplicationDocumentRequestStatus.FULFILLED) {
      throw new BadRequestException('Cette demande a déjà été satisfaite.');
    }

    // Vérifie que le candidat détient bien ce document, puis le partage avec
    // l'organisation — jamais de nouvel emplacement de stockage hors Digital Safe.
    await this.digitalSafeDocuments.assertOwnsDocument(
      candidateId,
      dto.digitalSafeDocumentId,
    );
    await this.shares.create(candidateId, dto.digitalSafeDocumentId, {
      targetType: ShareTargetType.USER,
      sharedWithUserId: application.organization.ownerId,
    });

    await this.prisma.applicationDocumentRequest.update({
      where: { id: requestId },
      data: {
        status: ApplicationDocumentRequestStatus.FULFILLED,
        fulfilledDigitalSafeDocumentId: dto.digitalSafeDocumentId,
        fulfilledAt: new Date(),
      },
    });

    if (
      application.status === ApplicationStatus.ADDITIONAL_DOCUMENT_REQUESTED
    ) {
      await this.transitionStatus(
        application,
        ApplicationStatus.UNDER_REVIEW,
        candidateId,
        'Document complémentaire fourni.',
      );
    }
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — document complémentaire reçu pour la candidature ${application.reference}.`,
    );
  }

  // --- FR-M5-007 : entretien ---------------------------------------------------------------

  async proposeInterview(
    ownerId: string,
    id: string,
    dto: ProposeInterviewDto,
  ) {
    const application = await this.assertOrganizationOwner(ownerId, id);
    this.assertTransition(application.status, [
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.INTERVIEW_PROPOSED,
      ApplicationStatus.INTERVIEW_CONFIRMED,
    ]);

    await this.prisma.application.update({
      where: { id },
      data: {
        interviewProposedAt: new Date(dto.proposedAt),
        interviewMode: dto.mode,
        // Toujours réécrit, même absent : une reprogrammation remplace entièrement la
        // proposition précédente plutôt que de laisser un lieu obsolète.
        interviewLocation: dto.location ?? null,
        interviewConfirmedAt: null,
      },
    });
    await this.transitionStatus(
      application,
      ApplicationStatus.INTERVIEW_PROPOSED,
      ownerId,
      `Entretien proposé le ${dto.proposedAt} (${dto.mode}).`,
    );
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — entretien proposé pour votre candidature ${application.reference} le ${dto.proposedAt}. Connectez-vous pour confirmer.`,
    );
  }

  async confirmInterview(candidateId: string, id: string) {
    const application = await this.assertCandidate(candidateId, id);
    this.assertTransition(application.status, [
      ApplicationStatus.INTERVIEW_PROPOSED,
    ]);

    await this.prisma.application.update({
      where: { id },
      data: { interviewConfirmedAt: new Date() },
    });
    await this.transitionStatus(
      application,
      ApplicationStatus.INTERVIEW_CONFIRMED,
      candidateId,
    );
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — entretien confirmé par le candidat pour la candidature ${application.reference}.`,
    );
  }

  // --- FR-M5-008 : décision + convention ---------------------------------------------------

  async decide(ownerId: string, id: string, dto: DecideApplicationDto) {
    const application = await this.assertOrganizationOwner(ownerId, id);
    const decisionAllowedFrom: ApplicationStatus[] = [
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.INTERVIEW_PROPOSED,
      ApplicationStatus.INTERVIEW_CONFIRMED,
    ];
    if (dto.decision === ApplicationDecision.REJECTED) {
      // Un rejet reste possible même en attente d'accord parental de déplacement —
      // par exemple si le parent refuse par un autre canal ou ne répond jamais.
      decisionAllowedFrom.push(ApplicationStatus.AWAITING_TRAVEL_CONSENT);
    }
    this.assertTransition(application.status, decisionAllowedFrom);

    await this.prisma.application.update({
      where: { id },
      data: { decisionAt: new Date(), decisionNote: dto.note },
    });

    if (dto.decision === ApplicationDecision.REJECTED) {
      await this.transitionStatus(
        application,
        ApplicationStatus.REJECTED,
        ownerId,
        dto.note,
      );
      await this.notify(
        application.candidateId,
        `LES STAGIAIRES — votre candidature ${application.reference} n'a pas été retenue.`,
      );
      return;
    }

    // Décision favorable : la plateforme génère la lettre d'admission et la notifie
    // au candidat — l'admission n'est confirmée qu'une fois ce dernier l'acceptée
    // explicitement (voir acceptAdmissionLetter()), pas dès la décision de l'organisation.
    await this.transitionStatus(
      application,
      ApplicationStatus.ADMISSION_LETTER_SENT,
      ownerId,
      dto.note,
    );
    await this.generateAdmissionLetter(application);
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — bonne nouvelle ! Vous avez reçu une lettre d'admission pour votre candidature ${application.reference}. Connectez-vous pour l'accepter.`,
    );
  }

  // --- Acceptation de la lettre d'admission par le candidat --------------------------------

  async acceptAdmissionLetter(candidateId: string, id: string) {
    const application = await this.assertCandidate(candidateId, id);
    this.assertTransition(application.status, [
      ApplicationStatus.ADMISSION_LETTER_SENT,
    ]);

    const candidate = await this.prisma.user.findUniqueOrThrow({
      where: { id: candidateId },
    });
    // Un mineur peut candidater à toute offre ; c'est ici, à l'acceptation d'une offre
    // à relocalisation, que l'accord actif du parent/tuteur pour CE déplacement précis
    // est requis — jamais à la candidature elle-même.
    if (candidate.isMinor && application.opportunity?.relocationRequired) {
      await this.transitionStatus(
        application,
        ApplicationStatus.AWAITING_TRAVEL_CONSENT,
        candidateId,
      );
      await this.requestTravelConsent(application);
      return;
    }

    await this.transitionStatus(
      application,
      ApplicationStatus.ACCEPTED,
      candidateId,
    );
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — le candidat a accepté la lettre d'admission pour la candidature ${application.reference}.`,
    );
    await this.generateConvention(application);
  }

  // --- Accord parental de déplacement (candidat mineur, offre à relocalisation) -----------

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private async requestTravelConsent(application: {
    id: string;
    reference: string;
    candidateId: string;
    opportunity: { city: string; country: string } | null;
  }) {
    // Garde contre un double appel concurrent (même logique que createArtifact) — la
    // contrainte @@unique(applicationId) sur TravelConsent l'empêcherait de toute façon.
    const existing = await this.prisma.travelConsent.findUnique({
      where: { applicationId: application.id },
    });
    if (existing) return;

    // Le parent/tuteur déjà actif pour ce compte (consentement d'inscription confirmé)
    // est sollicité pour ce déplacement précis — jamais un nouveau contact non vérifié.
    const parentLink = await this.prisma.parentalLink.findFirst({
      where: {
        childId: application.candidateId,
        status: ParentalLinkStatus.ACTIVE,
      },
    });
    if (!parentLink) {
      throw new InternalServerErrorException(
        "Aucun consentement parental actif pour ce candidat — impossible de solliciter l'accord de déplacement.",
      );
    }

    const ttlDays = Number(
      this.config.get<string>('TRAVEL_CONSENT_TTL_DAYS', '7'),
    );
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const consentExpiresAt = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    );

    const consent = await this.prisma.travelConsent.create({
      data: {
        applicationId: application.id,
        consentCodeHash: this.hashCode(code),
        consentExpiresAt,
      },
    });

    await this.sms.send(
      parentLink.parentPhone,
      `LES STAGIAIRES : la candidature de votre enfant (réf. ${application.reference}) est acceptée pour un stage à ${application.opportunity?.city ?? '—'}, nécessitant un déplacement. Pour donner votre accord, communiquez-lui ce code : ${code}. Sans réponse sous ${ttlDays} jours, le dossier reste bloqué.`,
    );
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — votre candidature ${application.reference} est acceptée sous réserve de l'accord de vos parents pour le déplacement. Un code leur a été envoyé.`,
    );
    await this.audit.record(
      'APPLICATION_TRAVEL_CONSENT_REQUESTED',
      application.candidateId,
      { applicationId: application.id, travelConsentId: consent.id },
    );
  }

  async confirmTravelConsent(travelConsentId: string, code: string) {
    const consent = await this.prisma.travelConsent.findUnique({
      where: { id: travelConsentId },
      include: { application: { include: APPLICATION_INCLUDE } },
    });
    if (!consent) {
      throw new NotFoundException(
        'Demande de consentement de déplacement introuvable.',
      );
    }
    if (consent.status === TravelConsentStatus.CONFIRMED) {
      throw new BadRequestException('Ce consentement a déjà été confirmé.');
    }
    if (
      !consent.consentCodeHash ||
      !consent.consentExpiresAt ||
      consent.consentExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }
    if (consent.consentAttempts >= consent.maxConsentAttempts) {
      throw new UnauthorizedException('Nombre maximal de tentatives atteint.');
    }

    // Comparaison en temps constant (CLAUDE.md §2).
    const isMatch = timingSafeEqual(
      Buffer.from(consent.consentCodeHash),
      Buffer.from(this.hashCode(code)),
    );
    if (!isMatch) {
      await this.prisma.travelConsent.update({
        where: { id: consent.id },
        data: { consentAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    await this.prisma.travelConsent.update({
      where: { id: consent.id },
      data: {
        status: TravelConsentStatus.CONFIRMED,
        confirmedAt: new Date(),
        consentCodeHash: null,
      },
    });

    const application = consent.application;
    await this.transitionStatus(
      application,
      ApplicationStatus.ACCEPTED,
      application.candidateId,
      'Accord parental de déplacement confirmé.',
    );
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — l'accord de vos parents pour le déplacement est confirmé. Votre candidature ${application.reference} est acceptée.`,
    );
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — l'accord parental de déplacement est confirmé pour la candidature ${application.reference}.`,
    );
    await this.generateConvention(application);
    await this.audit.record(
      'APPLICATION_TRAVEL_CONSENT_CONFIRMED',
      application.candidateId,
      { applicationId: application.id },
    );
    return { message: 'Consentement de déplacement confirmé.' };
  }

  private async generateAdmissionLetter(application: {
    id: string;
    reference: string;
    candidateId: string;
    organization: { ownerId: string; name: string };
    opportunity: { title: string } | null;
  }) {
    const name = await this.getCandidateDisplayName(application.candidateId);
    const title = `Lettre d'admission — ${application.reference}`;
    const content = [
      "LETTRE D'ADMISSION EN STAGE — LES STAGIAIRES",
      `Référence de candidature : ${application.reference}`,
      `À l'attention de : ${name}`,
      `Organisation : ${application.organization.name}`,
      application.opportunity
        ? `Offre : ${application.opportunity.title}`
        : 'Candidature spontanée',
      `Date : ${new Date().toISOString()}`,
      '',
      `Nous avons le plaisir de vous informer que votre candidature est retenue.`,
      'Cette lettre vaut notification formelle de votre admission en stage. La convention',
      'de stage sera générée automatiquement dès votre acceptation. Version simplifiée',
      'MVP, sans valeur de document officiel signé à ce stade.',
    ].join('\n');

    return this.createArtifact(
      application,
      ApplicationArtifactKind.ADMISSION_LETTER,
      DigitalSafeDocumentCategory.ADMISSION_LETTER,
      title,
      content,
    );
  }

  private async generateConvention(application: {
    id: string;
    reference: string;
    candidateId: string;
    organization: { ownerId: string; name: string };
    opportunity: { title: string } | null;
  }) {
    const name = await this.getCandidateDisplayName(application.candidateId);
    const title = `Convention de stage — ${application.reference}`;
    const content = [
      'CONVENTION DE STAGE NUMÉRIQUE — LES STAGIAIRES',
      `Référence de candidature : ${application.reference}`,
      `Stagiaire : ${name}`,
      `Organisation : ${application.organization.name}`,
      application.opportunity
        ? `Offre / missions : ${application.opportunity.title}`
        : 'Candidature spontanée',
      `Date de génération : ${new Date().toISOString()}`,
      '',
      'Établissement, période précise, horaires et encadreur : à compléter manuellement',
      'par les parties — non disponibles automatiquement en MVP.',
      '',
      'Ce document formalise le début de la relation de stage entre les deux parties.',
      "Signature légère déclarative disponible via l'action de signature de la",
      'candidature. Version simplifiée MVP — ne remplace pas une convention tripartite',
      'formelle avec établissement, à enrichir en Couche 2/3.',
    ].join('\n');

    return this.createArtifact(
      application,
      ApplicationArtifactKind.CONVENTION,
      DigitalSafeDocumentCategory.CONVENTION,
      title,
      content,
    );
  }

  // --- Signature légère déclarative ---------------------------------------------------------

  async sign(userId: string, id: string, name: string, ip: string | undefined) {
    const application = await this.getApplicationOr404(id);
    const isCandidate = application.candidateId === userId;
    const isOrganization = application.organization.ownerId === userId;
    if (!isCandidate && !isOrganization) {
      throw new ForbiddenException(
        'Cette candidature ne concerne pas ce compte.',
      );
    }
    this.assertTransition(application.status, [ApplicationStatus.ACCEPTED]);

    const data = isCandidate
      ? {
          candidateSignedAt: new Date(),
          candidateSignedName: name,
          candidateSignedIp: ip,
        }
      : {
          organizationSignedAt: new Date(),
          organizationSignedName: name,
          organizationSignedIp: ip,
        };
    const updated = await this.prisma.application.update({
      where: { id },
      data,
    });

    await this.audit.record('APPLICATION_SIGNED', userId, {
      applicationId: id,
      role: isCandidate ? 'CANDIDATE' : 'ORGANIZATION',
    });

    if (
      updated.candidateSignedAt &&
      updated.organizationSignedAt &&
      !updated.startedAt
    ) {
      await this.prisma.application.update({
        where: { id },
        data: { startedAt: new Date() },
      });
      await this.notify(
        application.candidateId,
        `LES STAGIAIRES — la convention de la candidature ${application.reference} est signée par les deux parties. Le stage démarre.`,
      );
      await this.notify(
        application.organization.ownerId,
        `LES STAGIAIRES — la convention de la candidature ${application.reference} est signée par les deux parties. Le stage démarre.`,
      );
      await this.audit.record('APPLICATION_STARTED', userId, {
        applicationId: id,
      });
    }
  }

  // --- Clôture et attestation --------------------------------------------------------------

  async complete(ownerId: string, id: string) {
    const application = await this.assertOrganizationOwner(ownerId, id);
    this.assertTransition(application.status, [ApplicationStatus.ACCEPTED]);

    const convention = await this.prisma.applicationArtifact.findUnique({
      where: {
        applicationId_kind: {
          applicationId: id,
          kind: ApplicationArtifactKind.CONVENTION,
        },
      },
    });
    if (!convention) {
      throw new BadRequestException(
        'Aucune convention générée pour cette candidature — impossible de clôturer.',
      );
    }

    const name = await this.getCandidateDisplayName(application.candidateId);
    const title = `Attestation de fin de stage — ${application.reference}`;
    const content = [
      'ATTESTATION DE FIN DE STAGE — LES STAGIAIRES',
      `Référence de candidature : ${application.reference}`,
      `Stagiaire : ${name}`,
      `Organisation : ${application.organization.name}`,
      application.opportunity
        ? `Offre : ${application.opportunity.title}`
        : 'Candidature spontanée',
      `Date de clôture : ${new Date().toISOString()}`,
      '',
      'Ce document atteste que le stage lié à la candidature ci-dessus est arrivé à son',
      "terme. Version simplifiée MVP — la recommandation et l'attestation enrichie relèvent",
      'du module Entreprises et organisations.',
    ].join('\n');
    await this.createArtifact(
      application,
      ApplicationArtifactKind.ATTESTATION,
      DigitalSafeDocumentCategory.CERTIFICATE,
      title,
      content,
    );

    await this.prisma.application.update({
      where: { id },
      data: { completedAt: new Date() },
    });
    await this.transitionStatus(
      application,
      ApplicationStatus.COMPLETED,
      ownerId,
    );
    await this.notify(
      application.candidateId,
      `LES STAGIAIRES — votre stage (candidature ${application.reference}) est clôturé. Attestation disponible.`,
    );
  }

  // --- FR-M5-009 : retrait ------------------------------------------------------------------

  async withdraw(candidateId: string, id: string) {
    const application = await this.assertCandidate(candidateId, id);
    this.assertTransition(application.status, [
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.ADDITIONAL_DOCUMENT_REQUESTED,
      ApplicationStatus.INTERVIEW_PROPOSED,
      ApplicationStatus.INTERVIEW_CONFIRMED,
      ApplicationStatus.ADMISSION_LETTER_SENT,
      ApplicationStatus.AWAITING_TRAVEL_CONSENT,
      ApplicationStatus.ACCEPTED,
    ]);

    await this.prisma.application.update({
      where: { id },
      data: { withdrawnAt: new Date() },
    });
    await this.transitionStatus(
      application,
      ApplicationStatus.WITHDRAWN,
      candidateId,
    );
    await this.notify(
      application.organization.ownerId,
      `LES STAGIAIRES — le candidat a retiré sa candidature ${application.reference}.`,
    );
  }

  // --- Téléchargement des artefacts ---------------------------------------------------------

  async downloadArtifact(
    userId: string,
    id: string,
    kind: ApplicationArtifactKind,
  ) {
    if (!Object.values(ApplicationArtifactKind).includes(kind)) {
      throw new NotFoundException('Document introuvable.');
    }
    const application = await this.getApplicationOr404(id);
    if (!this.isParticipant(userId, application)) {
      throw new NotFoundException('Candidature introuvable.');
    }
    const artifact = await this.prisma.applicationArtifact.findUnique({
      where: { applicationId_kind: { applicationId: id, kind } },
    });
    if (!artifact) throw new NotFoundException('Document introuvable.');

    // downloadLatest gère elle-même l'autorisation (titulaire ou partage valide) et
    // la vérification d'intégrité — réutilisation directe du mécanisme Digital Safe.
    return this.digitalSafeDocuments.downloadLatest(
      userId,
      artifact.digitalSafeDocumentId,
    );
  }

  private async getCandidateDisplayName(candidateId: string): Promise<string> {
    const [profile, user] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId: candidateId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: candidateId } }),
    ]);
    return profile?.fullName ?? user.lsId ?? candidateId;
  }

  private async createArtifact(
    application: {
      id: string;
      candidateId: string;
      organization: { ownerId: string };
    },
    kind: ApplicationArtifactKind,
    category: DigitalSafeDocumentCategory,
    title: string,
    content: string,
  ) {
    // Garde contre une double génération en cas d'appel concurrent (décision/clôture
    // déclenchées deux fois avant que la transition de statut ne se propage) — la
    // contrainte @@unique([applicationId, kind]) empêcherait un doublon de toute façon,
    // ce contrôle préalable évite juste l'erreur 500 associée.
    const existing = await this.prisma.applicationArtifact.findUnique({
      where: { applicationId_kind: { applicationId: application.id, kind } },
    });
    if (existing) return existing;

    // Le document vit dans le Digital Safe du candidat (archivage, chiffrement,
    // versionnage réutilisés tels quels) ; l'organisation y accède via un partage,
    // renouvelé automatiquement tant que la candidature reste active (cf.
    // ApplicationShareRenewalProcessor) pour dépasser le plafond de 30 jours pensé
    // pour un partage volontaire ponctuel, pas pour un document lié à un stage en cours.
    const buffer = Buffer.from(content, 'utf-8');
    const document = await this.digitalSafeDocuments.createSystemGenerated(
      application.candidateId,
      category,
      title,
      { buffer, mimetype: 'text/plain', originalname: `${title}.txt` },
    );
    await this.shares.create(application.candidateId, document.id, {
      targetType: ShareTargetType.USER,
      sharedWithUserId: application.organization.ownerId,
    });

    return this.prisma.applicationArtifact.create({
      data: {
        applicationId: application.id,
        kind,
        digitalSafeDocumentId: document.id,
      },
    });
  }

  // --- Aides internes ------------------------------------------------------------------------

  private assertTransition(
    current: ApplicationStatus,
    allowed: ApplicationStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new BadRequestException(
        `Transition non autorisée depuis le statut ${current}.`,
      );
    }
  }

  private async recordEvent(
    applicationId: string,
    fromStatus: ApplicationStatus | null,
    toStatus: ApplicationStatus,
    actorUserId: string | null,
    note?: string,
  ) {
    await this.prisma.applicationStatusEvent.create({
      data: { applicationId, fromStatus, toStatus, actorUserId, note },
    });
  }

  private async transitionStatus(
    application: { id: string; status: ApplicationStatus },
    toStatus: ApplicationStatus,
    actorUserId: string,
    note?: string,
  ) {
    await this.prisma.application.update({
      where: { id: application.id },
      data: { status: toStatus },
    });
    await this.recordEvent(
      application.id,
      application.status,
      toStatus,
      actorUserId,
      note,
    );
    await this.audit.record(`APPLICATION_${toStatus}`, actorUserId, {
      applicationId: application.id,
    });
  }

  private isParticipant(
    userId: string,
    application: { candidateId: string; organization: { ownerId: string } },
  ): boolean {
    return (
      application.candidateId === userId ||
      application.organization.ownerId === userId
    );
  }

  async getApplicationOr404(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException('Candidature introuvable.');
    return application;
  }

  private async assertCandidate(userId: string, id: string) {
    const application = await this.getApplicationOr404(id);
    if (application.candidateId !== userId) {
      throw new ForbiddenException(
        'Cette candidature ne concerne pas ce compte.',
      );
    }
    return application;
  }

  private async assertOrganizationOwner(userId: string, id: string) {
    const application = await this.getApplicationOr404(id);
    if (application.organization.ownerId !== userId) {
      throw new ForbiddenException(
        'Cette candidature ne concerne pas ce compte.',
      );
    }
    return application;
  }

  private async notify(userId: string, message: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone) return;
    await this.sms.send(user.phone, message);
  }
}
