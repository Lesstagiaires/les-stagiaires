import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import {
  AmbassadorAttributionSource,
  AmbassadorDecisionReason,
  AmbassadorEventType,
  AmbassadorEventVisibility,
  AmbassadorStatus,
  NotificationType,
  PortfolioEventType,
  PortfolioReleaseReason,
} from '../../generated/prisma/enums';
import type { AuditChange } from '../audit/audit.service';
import { AuditService, diffOf } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateAmbassadorCode,
  normalizeAmbassadorCode,
} from './ambassador-code';
import {
  AmbassadorPolicyService,
  addMonths,
  yearsBetween,
} from './ambassador-policy.service';
import type { AmbassadorCategory } from '../../generated/prisma/enums';
import { ApplyAmbassadorDto } from './dto/apply-ambassador.dto';
import { CreateAmbassadorDto } from './dto/create-ambassador.dto';
import { isApplicationStage, isTerminal } from './ambassador-status-groups';
import { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import { SignContractDto } from './dto/sign-contract.dto';
import { IdentityDocumentsService } from './identity-documents.service';
import { TrainingService } from './training.service';
import { WalletService } from './wallet.service';
import { notifyAmbassador } from './notify-ambassador';

// Issue d'une tentative de rattachement. Un STATUT structuré, jamais une phrase :
// l'application existe en français, anglais, espagnol et arabe, et une phrase
// rédigée ici arriverait en français à un utilisateur arabophone. Le serveur dit ce
// qui s'est passé, le client le formule dans la langue de l'utilisateur.
export type AttributionOutcome =
  | { status: 'ATTRIBUTED'; referralId: string }
  // Code inconnu, mal saisi, ou appartenant à un ambassadeur qui ne recrute plus.
  | { status: 'CODE_NOT_RECOGNIZED' }
  | { status: 'SELF_REFERRAL_BLOCKED' }
  // L'utilisateur avait déjà un parrain : le premier reste le bon.
  | { status: 'ALREADY_ATTRIBUTED' };

// Champs d'ambassadeur exposables à un tiers (ex. une organisation qui vérifie un
// code avant de l'utiliser). Volontairement réduit au niveau « Public » de
// CLAUDE.md §1 : ni téléphone, ni e-mail, ni solde. Savoir qu'un code est valide
// ne donne pas le droit de connaître la personne derrière.
const AMBASSADOR_PUBLIC_SELECT = {
  id: true,
  code: true,
  status: true,
  countryCode: true,
} as const;

@Injectable()
export class AmbassadorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policy: AmbassadorPolicyService,
    private readonly wallet: WalletService,
    private readonly identityDocuments: IdentityDocumentsService,
    private readonly training: TrainingService,
  ) {}

  // --- Cycle de vie -----------------------------------------------------------------

  // ==========================================================================
  // CYCLE DE VIE (arbitrage du promoteur du 2026-08-01)
  //
  //   SUBMITTED → UNDER_REVIEW → [ADDITIONAL_INFORMATION_REQUIRED] → VERIFIED
  //     → APPROVED → CONTRACT_PENDING → TRAINING_PENDING → ACTIVE
  //
  // Une candidature peut être REJECTED à toute étape d'instruction ; un
  // ambassadeur activé peut être SUSPENDED puis réintégré, ou TERMINATED.
  //
  // LE CODE D'AFFILIATION N'EST GÉNÉRÉ QU'À L'ACTIVATION. Tant qu'il n'existe
  // pas, il ne peut ni fuiter, ni être distribué, ni être accepté par le moteur
  // d'attribution — trois risques qu'une simple garde applicative laisserait
  // ouverts si le code, lui, existait déjà.
  // ==========================================================================

  // Dépôt de candidature. Le statut initial est SUBMITTED : la personne est un
  // CANDIDAT ambassadeur, sans code, et ne peut parrainer personne.
  async create(adminUserId: string, dto: CreateAmbassadorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const existing = await this.prisma.ambassador.findUnique({
      where: { userId: dto.userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ce compte est déjà ambassadeur.');
    }

    const ambassador = await this.prisma.ambassador.create({
      data: {
        userId: dto.userId,
        // Pas de code ici, à dessein : voir le bloc de cycle de vie ci-dessus.
        categories: dto.categories,
        countryCode: dto.countryCode,
      },
    });

    await this.journal(ambassador, {
      type: AmbassadorEventType.CREATED,
      action: 'AMBASSADOR_CREATED',
      actorId: adminUserId,
    });
    await this.audit.record('AMBASSADOR_CREATED_DETAILS', adminUserId, {
      ambassadorId: ambassador.id,
      userId: dto.userId,
    });

    return ambassador;
  }

  // ==========================================================================
  // CANDIDATURE PUBLIQUE
  //
  // « Un candidat ne devient JAMAIS ambassadeur automatiquement. » Cette méthode
  // OUVRE UN DOSSIER en SUBMITTED : aucun code, aucune attribution, aucun droit.
  // Tout le reste est instruit par l'administration, étape par étape.
  //
  // TROIS VERROUS, dans cet ordre :
  //   1. la majorité — seuls des majeurs peuvent être ambassadeurs, le seuil
  //      étant configurable par pays (CLAUDE.md §5) ;
  //   2. le blocage définitif — fraude avérée, falsification, usurpation ;
  //   3. le délai de redépôt après refus.
  //
  // Le premier est une règle de protection ; les deux autres sont des décisions
  // administratives déjà prises, qu'on se contente d'appliquer.
  // ==========================================================================
  async apply(userId: string, dto: ApplyAmbassadorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, dateOfBirth: true, countryOfResidence: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const resolvedPolicy = await this.policy.resolve(user.countryOfResidence);

    // --- VERROU 1 — la majorité ---------------------------------------------
    // L'âge est LU SUR LE COMPTE, jamais déclaré dans le formulaire : se fier à
    // une date ressaisie reviendrait à laisser le candidat décider s'il est
    // majeur. Le programme verse de l'argent — c'est précisément le genre de
    // flux dont un mineur doit rester à l'écart.
    //
    // ÉCHEC FERMÉ : sans date de naissance, on ne peut pas établir la majorité,
    // donc on refuse. L'inverse — laisser passer faute de savoir — ferait de
    // l'absence de donnée le moyen le plus simple de contourner le contrôle.
    // Le pays porte la politique applicable ET figure sur le dossier. Sans lui,
    // on ne saurait ni quel seuil appliquer, ni quel pays inscrire : on refuse
    // plutot que d'inventer.
    if (!user.countryOfResidence) {
      throw new ForbiddenException(
        'Votre pays de residence doit figurer sur votre profil avant de candidater.',
      );
    }

    if (!user.dateOfBirth) {
      await this.audit.record('AMBASSADOR_APPLICATION_REFUSED', userId, {
        reason: 'DATE_DE_NAISSANCE_ABSENTE',
      });
      throw new ForbiddenException(
        'Votre date de naissance doit figurer sur votre profil avant de candidater.',
      );
    }

    const age = yearsBetween(user.dateOfBirth, new Date());
    if (age < resolvedPolicy.minAmbassadorAge) {
      await this.audit.record('AMBASSADOR_APPLICATION_REFUSED', userId, {
        reason: 'AGE_INSUFFISANT',
        // L'âge exact n'est pas journalisé : le fait qu'il soit insuffisant
        // suffit, et c'est une donnée personnelle de plus qu'on ne recopie pas.
        requiredAge: resolvedPolicy.minAmbassadorAge,
        countryCode: user.countryOfResidence,
      });
      throw new ForbiddenException(
        `Le programme Ambassadeurs est réservé aux personnes de ${resolvedPolicy.minAmbassadorAge} ans et plus.`,
      );
    }

    const existing = await this.prisma.ambassador.findUnique({
      where: { userId },
    });

    // --- Premier dépôt ------------------------------------------------------
    if (!existing) {
      const created = await this.prisma.ambassador.create({
        data: {
          userId,
          categories: dto.categories,
          countryCode: user.countryOfResidence,
          motivation: dto.motivation,
          // Pas de code, à dessein : il naît à l'activation, et nulle part
          // ailleurs.
        },
      });

      await this.journal(created, {
        type: AmbassadorEventType.CREATED,
        action: 'AMBASSADOR_APPLIED',
        actorId: userId,
        metadata: { cycle: 1, categories: dto.categories },
      });

      return this.presentableApplication(created);
    }

    // --- VERROU 2 — le blocage définitif ------------------------------------
    if (existing.reapplicationBlocked) {
      await this.audit.record('AMBASSADOR_APPLICATION_REFUSED', userId, {
        ambassadorId: existing.id,
        reason: 'REDEPOT_BLOQUE',
        reasonCode: existing.reapplicationBlockedReason,
      });
      // Le motif structuré n'est PAS renvoyé au candidat : il porte souvent une
      // qualification (fraude, falsification) qu'on n'annonce pas dans une
      // réponse d'API. Il est dans le dossier, et l'assistance le tient.
      throw new ForbiddenException(
        'Votre dossier ne permet pas le dépôt d’une nouvelle candidature. Contactez l’assistance.',
      );
    }

    // Un dossier vivant n'est pas un dossier à redéposer.
    if (!isTerminal(existing.status)) {
      throw new ConflictException(
        isApplicationStage(existing.status)
          ? 'Votre candidature est déjà en cours d’instruction.'
          : 'Vous êtes déjà ambassadeur.',
      );
    }

    // Une résiliation n'est pas un refus : elle clôt une relation qui a existé,
    // et son retour se décide, il ne se demande pas par formulaire.
    if (existing.status === AmbassadorStatus.TERMINATED) {
      throw new ConflictException(
        'Votre participation au programme a pris fin. Contactez l’assistance pour envisager un retour.',
      );
    }

    // --- VERROU 3 — le délai de redépôt -------------------------------------
    const refusedAt = existing.lastRejectedAt ?? existing.rejectedAt;
    if (refusedAt && resolvedPolicy.reapplicationDelayMonths > 0) {
      const ouvertureAt = addMonths(
        refusedAt,
        resolvedPolicy.reapplicationDelayMonths,
      );
      if (ouvertureAt > new Date()) {
        await this.audit.record('AMBASSADOR_APPLICATION_REFUSED', userId, {
          ambassadorId: existing.id,
          reason: 'DELAI_DE_REDEPOT',
          reopensAt: ouvertureAt.toISOString(),
        });
        throw new ForbiddenException(
          `Une nouvelle candidature sera possible à partir du ${ouvertureAt.toISOString().slice(0, 10)}.`,
        );
      }
    }

    // --- Nouveau cycle ------------------------------------------------------
    // Le dossier repart à SUBMITTED, avec un cycle incrémenté. Les traces du
    // cycle précédent sont effacées de la LIGNE — elles vivent dans le journal,
    // en ajout seul, avec leurs auteurs et leurs motifs.
    const relaunched = await this.prisma.ambassador.update({
      where: { id: existing.id },
      data: {
        status: AmbassadorStatus.SUBMITTED,
        applicationCycle: existing.applicationCycle + 1,
        categories: dto.categories,
        countryCode: user.countryOfResidence,
        motivation: dto.motivation,
        rejectedAt: null,
        rejectionReason: null,
        rejectionReasonCode: null,
        rejectionPublicMessage: null,
        // `lastRejectedAt` n'est PAS effacé : c'est lui qui portera le délai si
        // ce nouveau cycle se solde lui aussi par un refus, et l'effacer
        // reviendrait à offrir une remise à zéro à chaque tentative.
      },
    });

    await this.journal(relaunched, {
      type: AmbassadorEventType.CREATED,
      action: 'AMBASSADOR_REAPPLIED',
      actorId: userId,
      metadata: {
        cycle: relaunched.applicationCycle,
        previousRejectionAt: refusedAt?.toISOString() ?? null,
        categories: dto.categories,
      },
    });

    return this.presentableApplication(relaunched);
  }

  // Ce que le candidat reçoit en retour. Ni code, ni identifiant interne
  // d'administration : l'accusé de réception dit que le dossier existe et où il
  // en est, rien de plus.
  private presentableApplication(ambassador: {
    id: string;
    status: AmbassadorStatus;
    applicationCycle: number;
    categories: AmbassadorCategory[];
    createdAt: Date;
  }) {
    return {
      id: ambassador.id,
      status: ambassador.status,
      applicationCycle: ambassador.applicationCycle,
      categories: ambassador.categories,
      submittedAt: ambassador.createdAt,
    };
  }

  // --- Instruction du dossier -----------------------------------------------

  async startReview(adminUserId: string, ambassadorId: string) {
    return this.transition(adminUserId, ambassadorId, {
      from: [
        AmbassadorStatus.SUBMITTED,
        AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
      ],
      to: AmbassadorStatus.UNDER_REVIEW,
      event: AmbassadorEventType.REVIEW_STARTED,
      auditAction: 'AMBASSADOR_REVIEW_STARTED',
    });
  }

  // Complément demandé au candidat. Le motif est OBLIGATOIRE : renvoyer un
  // dossier sans dire ce qui manque fait perdre du temps aux deux parties.
  async requestInformation(
    adminUserId: string,
    ambassadorId: string,
    dto: AmbassadorDecisionDto,
  ) {
    return this.transition(adminUserId, ambassadorId, {
      from: [AmbassadorStatus.SUBMITTED, AmbassadorStatus.UNDER_REVIEW],
      to: AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
      event: AmbassadorEventType.INFORMATION_REQUESTED,
      auditAction: 'AMBASSADOR_INFORMATION_REQUESTED',
      data: {
        informationRequestedAt: new Date(),
        // Note interne, code communicable, message relu : trois champs distincts.
        informationRequestedReason: dto.internalNote,
        informationRequestedReasonCode: dto.reasonCode,
        informationRequestedPublicMessage: dto.publicMessage ?? null,
      },
      decision: dto,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      audited: ['informationRequestedAt'],
    });
  }

  // Identité et pièces justificatives contrôlées. La pièce elle-même vit dans le
  // coffre-fort chiffré (CLAUDE.md §1, niveau « Très sensible ») — seule la date
  // de vérification et son auteur sont enregistrés ici.
  async verifyIdentity(adminUserId: string, ambassadorId: string) {
    return this.transition(adminUserId, ambassadorId, {
      from: [
        AmbassadorStatus.UNDER_REVIEW,
        AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
      ],
      to: AmbassadorStatus.VERIFIED,
      event: AmbassadorEventType.IDENTITY_VERIFIED,
      auditAction: 'AMBASSADOR_IDENTITY_VERIFIED',
      data: {
        identityVerifiedAt: new Date(),
        identityVerifiedById: adminUserId,
      },
    });
  }

  // Candidature acceptée. Le passage suivant est CONTRACT_PENDING : accepter
  // n'active pas — c'est précisément la confusion que le promoteur a fait
  // corriger.
  async approve(adminUserId: string, ambassadorId: string) {
    const updated = await this.transition(adminUserId, ambassadorId, {
      from: [AmbassadorStatus.VERIFIED],
      to: AmbassadorStatus.CONTRACT_PENDING,
      event: AmbassadorEventType.APPROVED,
      auditAction: 'AMBASSADOR_APPROVED',
      data: { approvedAt: new Date(), approvedById: adminUserId },
      notify: NotificationType.AMBASSADOR_APPROVED,
    });
    return updated;
  }

  async reject(
    adminUserId: string,
    ambassadorId: string,
    dto: AmbassadorDecisionDto,
  ) {
    return this.transition(adminUserId, ambassadorId, {
      from: [
        AmbassadorStatus.SUBMITTED,
        AmbassadorStatus.UNDER_REVIEW,
        AmbassadorStatus.ADDITIONAL_INFORMATION_REQUIRED,
        AmbassadorStatus.VERIFIED,
      ],
      to: AmbassadorStatus.REJECTED,
      event: AmbassadorEventType.REJECTED,
      auditAction: 'AMBASSADOR_REJECTED',
      data: {
        rejectedAt: new Date(),
        // La MÊME date, portée par un champ que le redépôt n'efface jamais.
        // `rejectedAt` est remis à null au cycle suivant ; sans ce doublon, le
        // délai de six mois ne s'appliquerait qu'au premier refus, et un
        // candidat obstiné pourrait redéposer indéfiniment.
        lastRejectedAt: new Date(),
        rejectionReason: dto.internalNote,
        rejectionReasonCode: dto.reasonCode,
        rejectionPublicMessage: dto.publicMessage ?? null,
      },
      decision: dto,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      audited: ['rejectedAt'],
    });
  }

  // --- Formalités préalables à l'activation ---------------------------------

  // Contrat d'Apporteur d'Affaires ET Charte des Ambassadeurs : deux documents
  // distincts, tous deux exigés. Le statut ne bascule vers TRAINING_PENDING que
  // lorsque les DEUX sont signés.
  async signContract(
    adminUserId: string,
    ambassadorId: string,
    dto: SignContractDto,
  ) {
    const ambassador = await this.getOrThrow(ambassadorId);
    this.assertStatus(ambassador.status, [
      AmbassadorStatus.CONTRACT_PENDING,
      AmbassadorStatus.TRAINING_PENDING,
    ]);

    const signedAt = dto.signedAt ? new Date(dto.signedAt) : new Date();
    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        contractSignedAt: signedAt,
        contractReference: dto.contractReference,
        status: ambassador.charterSignedAt
          ? AmbassadorStatus.TRAINING_PENDING
          : AmbassadorStatus.CONTRACT_PENDING,
      },
    });

    await this.journal(ambassador, {
      type: AmbassadorEventType.CONTRACT_SIGNED,
      action: 'AMBASSADOR_CONTRACT_SIGNED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      toStatus: AmbassadorStatus.TRAINING_PENDING,
      metadata: { contractReference: dto.contractReference },
    });
    await this.audit.record('AMBASSADOR_CONTRACT_SIGNED_DETAILS', adminUserId, {
      ambassadorId,
    });
    return updated;
  }

  async signCharter(adminUserId: string, ambassadorId: string) {
    const ambassador = await this.getOrThrow(ambassadorId);
    this.assertStatus(ambassador.status, [
      AmbassadorStatus.CONTRACT_PENDING,
      AmbassadorStatus.TRAINING_PENDING,
    ]);

    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        charterSignedAt: new Date(),
        status: ambassador.contractSignedAt
          ? AmbassadorStatus.TRAINING_PENDING
          : AmbassadorStatus.CONTRACT_PENDING,
      },
    });

    await this.journal(ambassador, {
      type: AmbassadorEventType.CHARTER_SIGNED,
      action: 'AMBASSADOR_CHARTER_SIGNED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
    });
    return updated;
  }

  // Formation obligatoire achevée. Le score du quiz est conservé : il permet de
  // retrouver, des mois plus tard, sur quelle base une personne a été activée.
  async completeTraining(
    adminUserId: string,
    ambassadorId: string,
    quizScore?: number,
  ) {
    return this.transition(adminUserId, ambassadorId, {
      from: [AmbassadorStatus.TRAINING_PENDING],
      to: AmbassadorStatus.TRAINING_PENDING,
      event: AmbassadorEventType.TRAINING_COMPLETED,
      auditAction: 'AMBASSADOR_TRAINING_COMPLETED',
      data: { trainingCompletedAt: new Date(), quizScore: quizScore ?? null },
      metadata: { quizScore: quizScore ?? null },
    });
  }

  // --- Activation : le seul moment où un code naît --------------------------
  //
  // Toutes les conditions sont revérifiées ICI, même si le cycle de statuts les
  // a déjà imposées une à une. Un statut peut être atteint par un chemin qu'on
  // n'a pas prévu — une correction manuelle en base, une reprise de données, un
  // futur endpoint. Sur un code qui ouvre droit à commission, on ne fait pas
  // confiance à l'historique : on vérifie les faits.
  async activate(adminUserId: string, ambassadorId: string) {
    const ambassador = await this.getOrThrow(ambassadorId);
    this.assertStatus(ambassador.status, [AmbassadorStatus.TRAINING_PENDING]);

    const missing: string[] = [];
    if (!ambassador.identityVerifiedAt) missing.push('identité non vérifiée');
    if (!ambassador.approvedAt) missing.push('candidature non approuvée');
    if (!ambassador.contractSignedAt) missing.push('contrat non signé');
    if (!ambassador.charterSignedAt) missing.push('charte non signée');
    if (!ambassador.trainingCompletedAt) missing.push('formation non achevée');

    // LA PIÈCE D'IDENTITÉ, vérifiée, non expirée, ET DU CYCLE EN COURS.
    //
    // `identityVerifiedAt` ci-dessus est une date posée à la main par un
    // administrateur ; elle dit qu'une vérification a eu lieu, pas qu'une pièce
    // valable existe encore au dossier. Les deux contrôles se complètent : le
    // premier atteste d'une décision, le second de la matière sur laquelle elle
    // portait. Sans lui, un dossier refusé puis redéposé six mois plus tard
    // s'activerait sur la foi d'une pièce du cycle précédent.
    missing.push(
      ...(await this.identityDocuments.blockingReasons(ambassadorId)),
    );

    // LA FORMATION ET LE QUIZ, rapportés au CYCLE EN COURS et à la VERSION
    // courante des modules. `trainingCompletedAt` ci-dessus atteste d'une
    // décision administrative ; ceci atteste des faits sur lesquels elle
    // portait. Sans ce contrôle, une refonte de module décidée pour raison de
    // sécurité n'atteindrait jamais ceux qui sont déjà passés.
    missing.push(...(await this.training.blockingReasons(ambassadorId)));

    if (missing.length > 0) {
      throw new BadRequestException(
        `Activation impossible : ${missing.join(', ')}.`,
      );
    }

    // Le code peut déjà exister si l'ambassadeur a été réactivé après une
    // résiliation : on ne le régénère pas, sans quoi tous les liens et QR codes
    // déjà distribués deviendraient muets.
    const code = ambassador.code ?? (await this.allocateUniqueCode());

    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        status: AmbassadorStatus.ACTIVE,
        code,
        activatedAt: new Date(),
        activatedById: adminUserId,
      },
    });

    // Le portefeuille naît avec l'activation, avant toute commission : un
    // ambassadeur doit pouvoir consulter un solde à zéro plutôt qu'un écran vide
    // qui laisse croire à une panne.
    const resolvedPolicy = await this.policy.resolve(ambassador.countryCode);
    await this.wallet.ensureWallet(
      this.prisma,
      ambassadorId,
      resolvedPolicy.currency,
    );

    await this.journal(ambassador, {
      type: AmbassadorEventType.ACTIVATED,
      action: 'AMBASSADOR_ACTIVATED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      toStatus: AmbassadorStatus.ACTIVE,
      changes: diffOf(
        { status: ambassador.status, code: ambassador.code },
        { status: AmbassadorStatus.ACTIVE, code },
      ),
      metadata: { codeGenerated: ambassador.code === null },
    });
    await this.audit.record('AMBASSADOR_ACTIVATED_DETAILS', adminUserId, {
      ambassadorId,
      codeGenerated: ambassador.code === null,
    });
    await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_APPROVED,
      { ambassadorId, code },
    );

    return updated;
  }

  // Transition générique : contrôle du statut de départ, écriture, évènement,
  // audit, notification éventuelle. Écrite une fois plutôt que recopiée neuf
  // fois — c'est ce qui garantit qu'aucune étape n'oublie sa trace.
  private async transition(
    adminUserId: string,
    ambassadorId: string,
    spec: {
      from: AmbassadorStatus[];
      to: AmbassadorStatus;
      event: AmbassadorEventType;
      auditAction: string;
      // Unchecked : accepte les clés étrangères scalaires (approvedById,
      // identityVerifiedById) sans passer par une relation imbriquée.
      data?: Prisma.AmbassadorUncheckedUpdateInput;
      metadata?: Prisma.InputJsonValue;
      notify?: NotificationType;
      // Les trois niveaux de motif, lorsque la décision en comporte un.
      decision?: {
        internalNote: string;
        reasonCode: AmbassadorDecisionReason;
        publicMessage?: string;
      };
      // Défaut FERMÉ : l'ambassadeur ne voit un évènement que si on l'a décidé.
      visibility?: AmbassadorEventVisibility;
      // Champs dont l'ancienne et la nouvelle valeur doivent figurer à l'audit,
      // au-delà du statut qui y est toujours.
      audited?: string[];
    },
  ) {
    const ambassador = await this.getOrThrow(ambassadorId);
    this.assertStatus(ambassador.status, spec.from);

    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: { status: spec.to, ...spec.data },
    });

    // ORDRE DÉLIBÉRÉ : notifier d'abord, journaliser ensuite ce qui est
    // RÉELLEMENT parti. Journaliser d'abord donnerait une trace affirmant qu'une
    // notification a été envoyée alors qu'elle a pu échouer — dans un journal,
    // une affirmation fausse est pire qu'une absence.
    let notifiedCount = 0;
    if (spec.notify) {
      // Zéro destinataire sur un dossier anonymisé : la décision reste prise et
      // journalisée, seule la notification n'a plus personne à qui parler.
      notifiedCount = await notifyAmbassador(
        this.notifications,
        ambassador.userId,
        spec.notify,
        {
          ambassadorId,
          // Le CODE communicable part, jamais la note interne.
          reasonCode: spec.decision?.reasonCode,
          publicMessage: spec.decision?.publicMessage,
        },
      );
    }

    await this.journal(ambassador, {
      type: spec.event,
      action: spec.auditAction,
      actorId: adminUserId,
      visibility: spec.visibility,
      toStatus: spec.to,
      decision: spec.decision,
      notified: spec.notify
        ? { types: [spec.notify], count: notifiedCount }
        : undefined,
      changes: [
        ...diffOf({ status: ambassador.status }, { status: spec.to }),
        ...diffOf(
          pick(ambassador, spec.audited ?? []),
          pick(updated, spec.audited ?? []),
        ),
      ],
      metadata: spec.metadata,
    });

    return updated;
  }

  private assertStatus(current: AmbassadorStatus, allowed: AmbassadorStatus[]) {
    if (!allowed.includes(current)) {
      throw new BadRequestException(
        `Cette action n'est pas possible depuis le statut ${current}.`,
      );
    }
  }

  async suspend(
    adminUserId: string,
    ambassadorId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const ambassador = await this.getOrThrow(ambassadorId);
    if (ambassador.status !== AmbassadorStatus.ACTIVE) {
      throw new BadRequestException(
        'Seul un ambassadeur actif peut être suspendu.',
      );
    }

    const suspendedAt = new Date();
    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        status: AmbassadorStatus.SUSPENDED,
        suspendedAt,
        // Les trois niveaux : la note reste interne, le code et le message relu
        // sont les seuls à pouvoir partir.
        suspensionReason: dto.internalNote,
        suspensionReasonCode: dto.reasonCode,
        suspensionPublicMessage: dto.publicMessage ?? null,
      },
    });

    // Ce qui part : le CODE communicable, jamais la note. Auparavant
    // `dto.reason` — un champ libre d'administrateur — était transmis tel quel
    // dans cette notification.
    const notifiedCount = await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_SUSPENDED,
      {
        ambassadorId,
        reasonCode: dto.reasonCode,
        publicMessage: dto.publicMessage,
      },
    );

    await this.journal(ambassador, {
      type: AmbassadorEventType.SUSPENDED,
      action: 'AMBASSADOR_SUSPENDED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      toStatus: AmbassadorStatus.SUSPENDED,
      decision: dto,
      notified: {
        types: [NotificationType.AMBASSADOR_SUSPENDED],
        count: notifiedCount,
      },
      changes: diffOf(
        { status: ambassador.status, suspendedAt: ambassador.suspendedAt },
        { status: AmbassadorStatus.SUSPENDED, suspendedAt },
      ),
    });

    return updated;
  }

  async reinstate(adminUserId: string, ambassadorId: string) {
    const ambassador = await this.getOrThrow(ambassadorId);
    if (ambassador.status !== AmbassadorStatus.SUSPENDED) {
      throw new BadRequestException(
        'Seul un ambassadeur suspendu peut être réintégré.',
      );
    }

    const updated = await this.prisma.ambassador.update({
      where: { id: ambassadorId },
      data: {
        status: AmbassadorStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      },
    });

    await this.journal(ambassador, {
      type: AmbassadorEventType.REINSTATED,
      action: 'AMBASSADOR_REINSTATED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      toStatus: AmbassadorStatus.ACTIVE,
      changes: diffOf(
        { status: ambassador.status },
        { status: AmbassadorStatus.ACTIVE },
      ),
    });
    await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_REINSTATED,
      { ambassadorId },
    );

    return updated;
  }

  // Sortie du programme. Les entreprises du portefeuille sont libérées — elles
  // redeviennent démarchables — mais les commissions DÉJÀ ACQUISES sont conservées
  // et restent dues : quitter le programme n'efface pas ce qui a été gagné.
  async terminate(
    adminUserId: string,
    ambassadorId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const ambassador = await this.getOrThrow(ambassadorId);
    if (ambassador.status === AmbassadorStatus.TERMINATED) {
      throw new BadRequestException(
        'Cet ambassadeur est déjà sorti du programme.',
      );
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ambassador.update({
        where: { id: ambassadorId },
        data: {
          status: AmbassadorStatus.TERMINATED,
          terminatedAt: now,
          terminationReason: dto.internalNote,
          terminationReasonCode: dto.reasonCode,
          terminationPublicMessage: dto.publicMessage ?? null,
        },
      });

      const openEntries = await tx.ambassadorPortfolioEntry.findMany({
        where: { ambassadorId, releasedAt: null },
        select: { id: true },
      });

      await tx.ambassadorPortfolioEntry.updateMany({
        where: { ambassadorId, releasedAt: null },
        data: {
          releasedAt: now,
          releaseReason: PortfolioReleaseReason.AMBASSADOR_TERMINATED,
          releasedById: adminUserId,
        },
      });

      if (openEntries.length > 0) {
        await tx.portfolioEvent.createMany({
          data: openEntries.map((entry) => ({
            entryId: entry.id,
            type: PortfolioEventType.RELEASED,
            actorId: adminUserId,
            metadata: { reason: 'AMBASSADOR_TERMINATED' },
          })),
        });
      }

      return result;
    });

    await this.journal(ambassador, {
      type: AmbassadorEventType.TERMINATED,
      action: 'AMBASSADOR_TERMINATED',
      actorId: adminUserId,
      visibility: AmbassadorEventVisibility.AMBASSADOR,
      toStatus: AmbassadorStatus.TERMINATED,
      decision: dto,
      notified: {
        types: [NotificationType.AMBASSADOR_TERMINATED],
        count: ambassador.userId ? 1 : 0,
      },
      changes: diffOf(
        { status: ambassador.status },
        { status: AmbassadorStatus.TERMINATED },
      ),
    });
    await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_TERMINATED,
      {
        ambassadorId,
        // Le CODE communicable, jamais la note interne de l'administrateur.
        reasonCode: dto.reasonCode,
        publicMessage: dto.publicMessage,
        // Date d'effet : une résiliation formelle doit dire à partir de quand
        // elle produit ses effets, pas seulement qu'elle a eu lieu.
        effectiveAt: updated.terminatedAt?.toISOString(),
      },
    );

    return updated;
  }

  // --- Attribution ------------------------------------------------------------------

  // Vérifie qu'un code existe et appartient à un ambassadeur actif, sans rien révéler
  // de son titulaire. Sert à valider la saisie d'un code au moment de l'inscription.
  async lookupByCode(rawCode: string) {
    const code = normalizeAmbassadorCode(rawCode);
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { code },
      select: AMBASSADOR_PUBLIC_SELECT,
    });

    if (!ambassador || ambassador.status !== AmbassadorStatus.ACTIVE) {
      return { valid: false as const };
    }
    return { valid: true as const, code: ambassador.code };
  }

  // Rattache un JEUNE. Définitif : un utilisateur n'a qu'un parrain. La contrainte
  // d'unicité en base fait foi ; on la laisse parler plutôt que de vérifier d'abord,
  // ce qui laisserait une fenêtre entre le contrôle et l'écriture.
  //
  // Renvoie un RÉSULTAT et jamais `null` en cas d'échec (décision du promoteur du
  // 2026-08-01) : un code non reconnu ne doit pas être avalé en silence. L'appelant
  // doit pouvoir dire à l'utilisateur que son code n'a pas été retenu, faute de quoi
  // celui-ci croira son rattachement effectué — et ne comprendra pas, des mois plus
  // tard, pourquoi son ambassadeur ne touche rien.
  async attributeUser(
    referredUserId: string,
    rawCode: string,
    source: AmbassadorAttributionSource = AmbassadorAttributionSource.CODE,
  ): Promise<AttributionOutcome> {
    const normalizedCode = normalizeAmbassadorCode(rawCode);
    const ambassador = await this.resolveActiveAmbassadorByCode(rawCode);

    if (!ambassador) {
      // Journalisé AVEC le code saisi : c'est cette trace qui permettra de
      // distinguer une faute de frappe répandue (une affiche mal imprimée), un code
      // devenu obsolète après une suspension, et un balayage automatisé qui essaie
      // des codes au hasard.
      //
      // À noter, et c'est délibéré : le code d'un ambassadeur SUSPENDU tombe ici
      // aussi. L'utilisateur lit « non reconnu » alors que le code existe. Nommer la
      // suspension révélerait à un tiers une décision administrative concernant
      // quelqu'un d'autre — la trace d'audit, elle, garde la distinction.
      await this.audit.record('AMBASSADOR_CODE_REJECTED', referredUserId, {
        attemptedCode: normalizedCode,
        source,
        reason: 'INCONNU_OU_INACTIF',
      });
      return { status: 'CODE_NOT_RECOGNIZED' as const };
    }

    // Un ambassadeur ne se parraine pas lui-même.
    if (ambassador.userId === referredUserId) {
      await this.audit.record('AMBASSADOR_SELF_REFERRAL_BLOCKED', null, {
        ambassadorId: ambassador.id,
        referredUserId,
      });
      return { status: 'SELF_REFERRAL_BLOCKED' as const };
    }

    try {
      const referral = await this.prisma.ambassadorReferral.create({
        data: { ambassadorId: ambassador.id, referredUserId, source },
      });
      await this.audit.record('AMBASSADOR_REFERRAL_CREATED', null, {
        ambassadorId: ambassador.id,
        referredUserId,
        source,
      });
      return { status: 'ATTRIBUTED' as const, referralId: referral.id };
    } catch (error) {
      // P2002 : l'utilisateur avait déjà un parrain. Le premier reste le bon —
      // sans cette règle, il suffirait de ressaisir un code pour voler un filleul.
      if (isUniqueViolation(error)) {
        await this.audit.record('AMBASSADOR_CODE_REJECTED', referredUserId, {
          attemptedCode: normalizedCode,
          source,
          reason: 'DEJA_PARRAINE',
        });
        return { status: 'ALREADY_ATTRIBUTED' as const };
      }
      throw error;
    }
  }

  // Rattache une ENTREPRISE. Contrairement au parrainage d'un jeune, ce lien est
  // révocable par l'inactivité : douze mois sans achat confirmé le font expirer, et
  // l'entreprise redevient alors démarchable par n'importe quel ambassadeur.
  async attributeOrganization(
    organizationId: string,
    rawCode: string,
    source: AmbassadorAttributionSource = AmbassadorAttributionSource.CODE,
  ) {
    const ambassador = await this.resolveActiveAmbassadorByCode(rawCode);
    if (!ambassador) return null;

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true, country: true, name: true },
    });
    if (!organization) return null;

    if (organization.ownerId === ambassador.userId) {
      await this.audit.record('AMBASSADOR_SELF_REFERRAL_BLOCKED', null, {
        ambassadorId: ambassador.id,
        organizationId,
      });
      return null;
    }

    const resolvedPolicy = await this.policy.resolve(organization.country);
    const now = new Date();

    try {
      const entry = await this.prisma.ambassadorPortfolioEntry.create({
        data: {
          ambassadorId: ambassador.id,
          organizationId,
          // Recopié : l'entrée doit rester lisible si l'organisation disparaît.
          organizationName: organization.name,
          source,
          attributedAt: now,
          expiresAt: addMonths(now, resolvedPolicy.portfolioExpiryMonths),
        },
      });

      await this.prisma.portfolioEvent.create({
        data: {
          entryId: entry.id,
          type: PortfolioEventType.ATTRIBUTED,
          metadata: { source, expiresAt: entry.expiresAt.toISOString() },
        },
      });
      await this.audit.record('AMBASSADOR_PORTFOLIO_ATTRIBUTED', null, {
        ambassadorId: ambassador.id,
        organizationId,
        source,
      });

      return entry;
    } catch (error) {
      // L'index unique partiel a parlé : cette entreprise est déjà rattachée à
      // quelqu'un. Le premier arrivé garde la main tant que le lien n'a pas expiré.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  // --- Consultation -----------------------------------------------------------------

  async getMine(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!ambassador)
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");

    const [referralCount, portfolioCount] = await Promise.all([
      this.prisma.ambassadorReferral.count({
        where: { ambassadorId: ambassador.id },
      }),
      this.prisma.ambassadorPortfolioEntry.count({
        where: { ambassadorId: ambassador.id, releasedAt: null },
      }),
    ]);

    return { ...ambassador, referralCount, portfolioCount };
  }

  async getById(ambassadorId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
      include: { wallet: true, events: { orderBy: { createdAt: 'desc' } } },
    });
    if (!ambassador) throw new NotFoundException('Ambassadeur introuvable.');
    return ambassador;
  }

  async listAll(status?: AmbassadorStatus) {
    return this.prisma.ambassador.findMany({
      where: status ? { status } : {},
      include: { wallet: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- Interne ----------------------------------------------------------------------

  private async resolveActiveAmbassadorByCode(rawCode: string) {
    const code = normalizeAmbassadorCode(rawCode);
    if (!code) return null;

    const ambassador = await this.prisma.ambassador.findUnique({
      where: { code },
      select: { id: true, userId: true, status: true },
    });
    // SECONDE COUCHE DE PROTECTION.
    //
    // La première est que le code N'EXISTE PAS avant l'activation : une
    // candidature en cours d'instruction n'a rien à distribuer. Celle-ci couvre
    // ce que la première ne peut pas — un ambassadeur SUSPENDED ou TERMINATED
    // conserve son code, et le laisser recruter pendant un contrôle viderait la
    // suspension de son sens.
    //
    // Les deux ensemble : aucun statut hors ACTIVE n'ouvre droit au parrainage,
    // quelle que soit la façon dont ce statut a été atteint.
    if (!ambassador || ambassador.status !== AmbassadorStatus.ACTIVE)
      return null;
    return ambassador;
  }

  // Tire un code jusqu'à en trouver un libre. Sur 28^6 combinaisons, une collision
  // reste rarissime, mais l'unicité du code est ce qui garantit qu'une commission
  // atterrit chez la bonne personne : on ne la laisse pas au hasard.
  private async allocateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateAmbassadorCode();
      const taken = await this.prisma.ambassador.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new ConflictException(
      "Impossible d'allouer un code d'affiliation libre.",
    );
  }

  private async getOrThrow(ambassadorId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
    });
    if (!ambassador) throw new NotFoundException('Ambassadeur introuvable.');
    return ambassador;
  }

  // JOURNAL DES DÉCISIONS — un seul appel écrit l'évènement ET la trace d'audit.
  //
  // Les deux étaient auparavant deux appels distincts : rien n'empêchait d'en
  // ajouter un troisième point de décision et d'oublier l'un des deux. Les fusionner
  // rend l'oubli impossible.
  //
  // La note interne est écrite DANS le journal — c'est sa place — mais la sélection
  // de champs servie à l'ambassadeur l'exclut, et la visibilité par défaut est
  // ADMIN_ONLY. Deux verrous, comme pour les partenariats.
  private async journal(
    ambassador: { id: string; status: AmbassadorStatus },
    entry: {
      type: AmbassadorEventType;
      action: string;
      actorId: string | null;
      visibility?: AmbassadorEventVisibility;
      toStatus?: AmbassadorStatus;
      decision?: {
        internalNote: string;
        reasonCode: AmbassadorDecisionReason;
        publicMessage?: string;
      };
      notified?: { types: NotificationType[]; count: number };
      changes?: AuditChange[];
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    await this.prisma.ambassadorEvent.create({
      data: {
        ambassadorId: ambassador.id,
        type: entry.type,
        actorId: entry.actorId,
        visibility: entry.visibility ?? AmbassadorEventVisibility.ADMIN_ONLY,
        fromStatus: ambassador.status,
        toStatus: entry.toStatus ?? ambassador.status,
        reasonCode: entry.decision?.reasonCode ?? null,
        publicMessage: entry.decision?.publicMessage ?? null,
        internalNote: entry.decision?.internalNote ?? null,
        notifiedTypes: entry.notified?.types ?? [],
        notifiedCount: entry.notified?.count ?? 0,
        metadata: entry.metadata,
      },
    });

    await this.audit.recordChange(entry.action, entry.actorId, {
      entityType: 'Ambassador',
      entityId: ambassador.id,
      changes: entry.changes,
      // La note interne n'est PAS recopiée ici : le journal d'évènements la porte
      // déjà, et la dupliquer multiplierait les endroits d'où elle peut fuiter.
      metadata: { eventType: entry.type },
    });
  }
}

// Extrait d'un objet les seules clés demandées, pour ne comparer que ce qui
// compte. Comparer l'objet entier noierait le changement réel dans trente champs
// identiques.
function pick(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
