import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmbassadorStatus,
  NotificationType,
  PayoutRequestStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AmbassadorPolicyService } from './ambassador-policy.service';
import { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import { ExecutePayoutDto } from './dto/execute-payout.dto';
import { PayoutStepDto } from './dto/payout-step.dto';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import { PaymentDetailsService } from './payment-details.service';
import { RejectPayoutDto } from './dto/reject-payout.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { journalPayout, maskPayoutDestination } from './payout-journal';
import { WalletService } from './wallet.service';
import { notifyAmbassador } from './notify-ambassador';

// ============================================================================
// VERSEMENTS — CYCLE EN SIX ÉTAPES ET SÉPARATION DES POUVOIRS
//
// Aucun virement automatique, jamais (décision du promoteur). Trois verrous
// indépendants s'interposent entre une commission acquise et de l'argent qui part :
//
//   1. Le CONTRAT D'APPORTEUR D'AFFAIRES doit être signé par l'ambassadeur. Tant
//      que cette date est nulle, aucune demande n'est même recevable. Verrou porté
//      par un fait vérifiable (date + référence de contrat), pas par une case à
//      cocher.
//   2. Les VERSEMENTS DOIVENT ÊTRE OUVERTS pour le pays. Le défaut est « fermés » :
//      ouvrir un nouveau pays est une décision explicite, jamais un effet de bord
//      du déploiement.
//   3. LA SÉPARATION DES POUVOIRS (arbitrage 12 du promoteur, 2026-08-02) :
//      « une même personne ne doit pas pouvoir, seule, approuver puis exécuter le
//      même paiement ».
//
// LE CYCLE, en six étapes :
//
//   1. demande            REQUESTED                — le montant est immobilisé
//   2. contrôle           UNDER_REVIEW             — l'éligibilité est revérifiée
//   3. validation         VALIDATED                — une approbation, ou deux
//                         (AWAITING_SECOND_APPROVAL au-delà du seuil)
//   4. exécution          EXECUTING                — le virement est ordonné
//   5. confirmation       EXECUTED / FAILED        — et SEULEMENT là, le grand livre
//   6. réconciliation                              — ReconciliationService, en continu
//
// LE DÉPLACEMENT QUI COMPTE : l'écriture de sortie au grand livre est passée de
// l'étape 4 à l'étape 5. Un virement ordonné n'est pas un virement arrivé ; entre
// les deux il y a un opérateur, et il tombe en panne. Tant que la confirmation
// n'est pas là, le montant reste IMMOBILISÉ — ni disponible pour une seconde
// demande, ni sorti du patrimoine de l'ambassadeur.
//
// Aucun de ces verrous n'est contournable « pour tester ». Ils sont la raison pour
// laquelle une erreur de calcul ne peut pas se transformer en argent perdu.
// ============================================================================
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly policy: AmbassadorPolicyService,
    private readonly paymentDetails: PaymentDetailsService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  // --- ÉTAPE 1 — la demande --------------------------------------------------
  async request(userId: string, dto: RequestPayoutDto) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      include: { wallet: true },
    });
    if (!ambassador)
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");

    if (ambassador.status !== AmbassadorStatus.ACTIVE) {
      throw new ForbiddenException(
        'Seul un ambassadeur actif peut demander un versement.',
      );
    }

    // VERROU 1 — le contrat.
    if (!ambassador.contractSignedAt) {
      throw new ForbiddenException(
        "Aucun versement n'est possible avant la signature du Contrat d'Apporteur d'Affaires.",
      );
    }

    const resolvedPolicy = await this.policy.resolve(ambassador.countryCode);

    // VERROU 2 — l'ouverture du pays.
    if (!resolvedPolicy.payoutsEnabled) {
      throw new ForbiddenException(
        "Les versements ne sont pas encore ouverts dans ce pays. Vos commissions restent acquises et seront versées dès l'ouverture.",
      );
    }

    if (dto.amountMinor < resolvedPolicy.minPayoutAmountMinor) {
      throw new BadRequestException(
        `Le montant minimum d'un versement est de ${resolvedPolicy.minPayoutAmountMinor / 100} ${resolvedPolicy.currency}.`,
      );
    }

    if (!ambassador.wallet) {
      throw new BadRequestException('Aucun solde disponible.');
    }

    // LA DESTINATION VIENT DES COORDONNÉES ENREGISTRÉES, jamais de la demande.
    //
    // C'est la condition pour que le délai de refroidissement existe : tant que
    // l'ambassadeur saisissait un numéro à chaque demande, « modifier ses
    // coordonnées » n'était pas un acte datable, et il aurait suffi d'en taper un
    // autre pour contourner n'importe quel délai.
    const destination = await this.paymentDetails.resolveForPayout(
      ambassador.id,
      userId,
    );

    // Le besoin d'un double contrôle est FIGÉ ici, d'après le seuil en vigueur ce
    // jour-là. Le relire à l'approbation ferait qu'abaisser le seuil demain
    // rendrait soudain insuffisantes des approbations déjà données — et qu'en le
    // relevant, on s'affranchirait d'un double contrôle déjà requis.
    const requiresSecondApproval = this.needsSecondApproval(
      dto.amountMinor,
      resolvedPolicy.doubleApprovalThresholdMinor,
    );

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.payoutRequest.create({
        data: {
          ambassadorId: ambassador.id,
          amountMinor: dto.amountMinor,
          currency: ambassador.wallet!.currency,
          countryCode: ambassador.countryCode,
          method: destination.method,
          // Photographie CHIFFRÉE, et sa forme masquée à côté. La demande porte
          // les coordonnées telles qu'elles étaient ce jour-là, sans que rien de
          // lisible ne dorme en base.
          destinationEncrypted: this.encryption.encrypt(
            destination.destinationLabel,
          ),
          destinationMasked: maskPayoutDestination(
            destination.destinationLabel,
          ),
          requiresSecondApproval,
        },
      });

      // Immobilise immédiatement le montant : sans cela, deux demandes successives
      // pourraient chacune porter sur la totalité du solde.
      await this.wallet.reserveForPayout(
        tx,
        ambassador.wallet!.id,
        dto.amountMinor,
        created.id,
      );

      await journalPayout(tx, created.id, {
        type: 'REQUESTED',
        status: PayoutRequestStatus.REQUESTED,
        actorId: userId,
        amountMinor: created.amountMinor,
        currency: created.currency,
        destinationMasked: created.destinationMasked,
      });

      await this.audit.record('AMBASSADOR_PAYOUT_REQUESTED', userId, {
        payoutRequestId: created.id,
        amountMinor: dto.amountMinor,
        requiresSecondApproval,
      });

      return created;
    });
  }

  // --- ÉTAPE 2 — le contrôle -------------------------------------------------
  //
  // Une étape à part entière, et non un simple passage de statut. Les conditions
  // d'éligibilité sont REVÉRIFIÉES au moment du contrôle, parce que la situation
  // a pu changer depuis la demande : l'ambassadeur a pu être suspendu, le pays
  // refermé, le solde bouger. Leur résultat est consigné.
  //
  // C'est ici que se brancheront le délai de refroidissement sur changement de
  // coordonnées et les signaux antifraude.
  async review(
    adminUserId: string,
    payoutRequestId: string,
    dto: PayoutStepDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.REQUESTED,
    ]);

    const findings = await this.runEligibilityChecks(request);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.UNDER_REVIEW,
          reviewedAt: new Date(),
          reviewedById: adminUserId,
        },
      });

      await journalPayout(tx, payoutRequestId, {
        type: 'REVIEWED',
        status: PayoutRequestStatus.UNDER_REVIEW,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        // Le constat du contrôle rejoint la note de l'administrateur : ce qui a
        // été vérifié, et ce qui a été trouvé.
        internalNote: [dto.internalNote, ...findings].join(' | '),
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_REVIEWED', adminUserId, {
      payoutRequestId,
      amountMinor: request.amountMinor,
      findings,
    });

    // Le contrôle ne BLOQUE pas : il constate et laisse trace. C'est
    // l'administration qui décide, en connaissance de cause, de valider ou de
    // rejeter. Un blocage automatique ici ferait disparaître la décision — et
    // avec elle le nom de celui qui l'a prise.
    return { ...updated, findings };
  }

  // --- ÉTAPE 3 — la validation, une signature ou deux ------------------------
  async validate(
    adminUserId: string,
    payoutRequestId: string,
    dto: PayoutStepDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.UNDER_REVIEW,
    ]);

    const nextStatus = request.requiresSecondApproval
      ? PayoutRequestStatus.AWAITING_SECOND_APPROVAL
      : PayoutRequestStatus.VALIDATED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: nextStatus,
          validatedAt: new Date(),
          validatedById: adminUserId,
        },
      });

      await journalPayout(tx, payoutRequestId, {
        type: 'APPROVED',
        status: nextStatus,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        internalNote: dto.internalNote,
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_VALIDATED', adminUserId, {
      payoutRequestId,
      amountMinor: request.amountMinor,
      requiresSecondApproval: request.requiresSecondApproval,
      status: nextStatus,
    });

    // L'ambassadeur n'est prévenu qu'une fois la validation COMPLÈTE. Lui
    // annoncer une approbation qui attend encore une contresignature serait lui
    // promettre un virement que personne n'a fini d'autoriser.
    if (nextStatus === PayoutRequestStatus.VALIDATED) {
      await this.notifyValidated(request);
    }

    return updated;
  }

  // La contresignature. Refusée à celui qui a déjà approuvé — sans quoi le
  // « double contrôle » ne serait que la même signature apposée deux fois.
  async secondApproval(
    adminUserId: string,
    payoutRequestId: string,
    dto: PayoutStepDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.AWAITING_SECOND_APPROVAL,
    ]);

    if (request.validatedById === adminUserId) {
      throw new ForbiddenException(
        'Le double contrôle exige une seconde personne : vous avez déjà approuvé ce versement.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.VALIDATED,
          secondApprovalAt: new Date(),
          secondApprovalById: adminUserId,
        },
      });

      await journalPayout(tx, payoutRequestId, {
        type: 'SECOND_APPROVAL',
        status: PayoutRequestStatus.VALIDATED,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        internalNote: dto.internalNote,
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_SECOND_APPROVED', adminUserId, {
      payoutRequestId,
      amountMinor: request.amountMinor,
      firstApproverId: request.validatedById,
    });

    await this.notifyValidated(request);
    return updated;
  }

  // --- ÉTAPE 4 — l'exécution -------------------------------------------------
  //
  // L'administration ORDONNE un virement hors application et en saisit la
  // référence. La plateforme ne détient aucun moyen de paiement et n'en détiendra
  // pas (CLAUDE.md §6).
  //
  // AUCUNE ÉCRITURE AU GRAND LIVRE ICI. Le montant reste immobilisé jusqu'à la
  // confirmation : c'est ce qui permet à un échec de le rendre au disponible sans
  // avoir à écrire puis contre-écrire une sortie qui n'a jamais eu lieu.
  async execute(
    adminUserId: string,
    payoutRequestId: string,
    dto: ExecutePayoutDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.VALIDATED,
    ]);

    // LA SÉPARATION DES POUVOIRS. La base la garantit aussi, par contrainte
    // CHECK ; ce contrôle-ci n'est là que pour dire pourquoi, avant d'y arriver.
    if (
      adminUserId === request.validatedById ||
      adminUserId === request.secondApprovalById
    ) {
      throw new ForbiddenException(
        'Celui qui approuve un versement ne peut pas l’exécuter. Un autre administrateur doit ordonner le virement.',
      );
    }

    // LE DÉLAI DE REFROIDISSEMENT (arbitrage 13). « Aucune nouvelle demande de
    // retrait ne doit pouvoir être exécutée » pendant la période. Le verrou est
    // ici, au dernier instant utile : c'est le moment où l'argent partirait, et
    // c'est celui où l'état des coordonnées est le plus à jour. Le placer à la
    // demande aurait effacé la tentative au lieu de la consigner.
    const blocages = await this.paymentDetails.blockingReasons(
      request.ambassadorId,
    );
    if (blocages.length > 0) {
      await this.audit.record(
        'AMBASSADOR_PAYOUT_EXECUTION_BLOCKED',
        adminUserId,
        {
          payoutRequestId,
          ambassadorId: request.ambassadorId,
          amountMinor: request.amountMinor,
          reasons: blocages,
        },
      );
      throw new ForbiddenException(blocages.join(' '));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.EXECUTING,
          executedAt: new Date(),
          executedById: adminUserId,
          executionReference: dto.executionReference,
        },
      });

      await journalPayout(tx, payoutRequestId, {
        type: 'EXECUTION_ORDERED',
        status: PayoutRequestStatus.EXECUTING,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        reference: dto.executionReference,
      });

      return result;
    });

    await this.audit.record(
      'AMBASSADOR_PAYOUT_EXECUTION_ORDERED',
      adminUserId,
      {
        payoutRequestId,
        amountMinor: request.amountMinor,
        executionReference: dto.executionReference,
        approvedById: request.validatedById,
        secondApprovalById: request.secondApprovalById,
      },
    );

    return updated;
  }

  // --- ÉTAPE 5a — la confirmation --------------------------------------------
  //
  // Le virement est arrivé. C'est SEULEMENT MAINTENANT que l'argent sort du grand
  // livre. La confirmation peut être portée par celui qui a ordonné le virement :
  // il constate un fait extérieur, il ne s'accorde rien.
  async confirm(
    adminUserId: string,
    payoutRequestId: string,
    dto: PayoutStepDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.EXECUTING,
    ]);

    const wallet = await this.prisma.ambassadorWallet.findUniqueOrThrow({
      where: { ambassadorId: request.ambassadorId },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.EXECUTED,
          confirmedAt: new Date(),
          confirmedById: adminUserId,
        },
      });

      await this.wallet.executePayout(
        tx,
        wallet.id,
        request.amountMinor,
        payoutRequestId,
        adminUserId,
      );

      await journalPayout(tx, payoutRequestId, {
        type: 'CONFIRMED',
        status: PayoutRequestStatus.EXECUTED,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        reference: request.executionReference,
        internalNote: dto.internalNote,
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_EXECUTED', adminUserId, {
      payoutRequestId,
      amountMinor: request.amountMinor,
      executionReference: request.executionReference,
    });
    await notifyAmbassador(
      this.notifications,
      request.ambassador.userId,
      NotificationType.AMBASSADOR_PAYOUT_EXECUTED,
      {
        payoutRequestId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        // Référence saisie par l'administration : c'est elle qui permet à
        // l'ambassadeur de retrouver le virement auprès de son opérateur.
        executionReference: request.executionReference,
        // La forme MASQUÉE, lue telle quelle en base. Le numéro complet ne
        // quitte jamais la couche chiffrée — y compris pour un e-mail, qui se
        // transfère et se retrouve dans des boîtes qu'on ne maîtrise pas.
        destinationLabel: request.destinationMasked,
      },
    );

    return updated;
  }

  // --- ÉTAPE 5b — l'échec ----------------------------------------------------
  //
  // Le virement n'est jamais arrivé. Le montant immobilisé retourne au
  // disponible : l'argent reste dû, et l'ambassadeur doit pouvoir en redemander
  // le versement sans attendre une intervention.
  async fail(
    adminUserId: string,
    payoutRequestId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.EXECUTING,
    ]);

    const wallet = await this.prisma.ambassadorWallet.findUniqueOrThrow({
      where: { ambassadorId: request.ambassadorId },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.FAILED,
          failedAt: new Date(),
          failedById: adminUserId,
          // Un CODE, jamais la note interne : c'est ce motif-là qui part en
          // notification.
          failureReasonCode: dto.reasonCode,
        },
      });

      await this.wallet.releaseReservation(
        tx,
        wallet.id,
        request.amountMinor,
        payoutRequestId,
        dto.reasonCode,
      );

      await journalPayout(tx, payoutRequestId, {
        type: 'FAILED',
        status: PayoutRequestStatus.FAILED,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        reference: request.executionReference,
        reasonCode: dto.reasonCode,
        internalNote: dto.internalNote,
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_FAILED', adminUserId, {
      payoutRequestId,
      amountMinor: request.amountMinor,
      reasonCode: dto.reasonCode,
      internalNote: dto.internalNote,
      executionReference: request.executionReference,
    });
    await notifyAmbassador(
      this.notifications,
      request.ambassador.userId,
      NotificationType.AMBASSADOR_PAYOUT_FAILED,
      {
        payoutRequestId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        reasonCode: dto.reasonCode,
        ...(dto.publicMessage ? { publicMessage: dto.publicMessage } : {}),
      },
    );

    return updated;
  }

  // --- Le rejet --------------------------------------------------------------
  // Possible tant que le virement n'a pas été ordonné. Une fois à EXECUTING, la
  // seule sortie est la confirmation ou l'échec : on ne « rejette » pas un
  // virement déjà parti, on constate ce qu'il est devenu.
  async reject(
    adminUserId: string,
    payoutRequestId: string,
    dto: RejectPayoutDto,
  ) {
    const request = await this.getAtStatus(payoutRequestId, [
      PayoutRequestStatus.REQUESTED,
      PayoutRequestStatus.UNDER_REVIEW,
      PayoutRequestStatus.AWAITING_SECOND_APPROVAL,
      PayoutRequestStatus.VALIDATED,
    ]);

    const wallet = await this.prisma.ambassadorWallet.findUniqueOrThrow({
      where: { ambassadorId: request.ambassadorId },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: {
          status: PayoutRequestStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: dto.reason,
        },
      });

      // Le montant immobilisé retourne au disponible : un rejet n'est pas une
      // sanction financière, l'argent reste dû.
      await this.wallet.releaseReservation(
        tx,
        wallet.id,
        request.amountMinor,
        payoutRequestId,
        dto.reason,
      );

      await journalPayout(tx, payoutRequestId, {
        type: 'REJECTED',
        status: PayoutRequestStatus.REJECTED,
        actorId: adminUserId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        destinationMasked: request.destinationMasked,
        internalNote: dto.reason,
      });

      return result;
    });

    await this.audit.record('AMBASSADOR_PAYOUT_REJECTED', adminUserId, {
      payoutRequestId,
      reason: dto.reason,
    });
    await notifyAmbassador(
      this.notifications,
      request.ambassador.userId,
      NotificationType.AMBASSADOR_PAYOUT_REJECTED,
      { payoutRequestId, reason: dto.reason },
    );

    return updated;
  }

  async listMine(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ambassador)
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");

    return this.prisma.payoutRequest.findMany({
      where: { ambassadorId: ambassador.id },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async listAll(status?: PayoutRequestStatus) {
    return this.prisma.payoutRequest.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
    });
  }

  // La piste complète d'un versement, dans l'ordre où elle s'est écrite. La
  // destination y est déjà masquée : elle l'a été à l'écriture, pas à la lecture.
  async history(payoutRequestId: string) {
    const request = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
    });
    if (!request)
      throw new NotFoundException('Demande de versement introuvable.');

    const events = await this.prisma.payoutEvent.findMany({
      where: { payoutRequestId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      request: {
        ...request,
        // Même une lecture de back-office n'a pas besoin du numéro complet —
        // et depuis le chiffrement, elle ne l'obtiendrait pas : la valeur en
        // base est illisible sans passer par la porte journalisée.
        destinationEncrypted: undefined,
      },
      events,
    };
  }

  // Au-delà du seuil, une seule approbation ne suffit plus. Un seuil absent
  // signifie « pas de double contrôle dans ce pays » — c'est une décision, pas
  // un oubli, et elle se prend en renseignant la politique du pays.
  private needsSecondApproval(
    amountMinor: number,
    thresholdMinor: number | null,
  ): boolean {
    if (thresholdMinor === null) return false;
    return amountMinor > thresholdMinor;
  }

  // Ce que le contrôle vérifie. Rend la liste de ce qui CLOCHE — vide quand tout
  // va bien. Ces constats sont consignés, jamais bloquants : c'est
  // l'administration qui tranche, et une décision doit porter un nom.
  private async runEligibilityChecks(request: {
    ambassadorId: string;
    amountMinor: number;
    countryCode: string;
  }): Promise<string[]> {
    const findings: string[] = [];

    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: request.ambassadorId },
      include: { wallet: true },
    });

    if (!ambassador) {
      return ['Dossier d’ambassadeur introuvable.'];
    }
    if (ambassador.status !== AmbassadorStatus.ACTIVE) {
      findings.push(`Ambassadeur non actif (${ambassador.status}).`);
    }
    if (!ambassador.contractSignedAt) {
      findings.push('Contrat d’Apporteur d’Affaires non signé.');
    }

    const resolvedPolicy = await this.policy.resolve(request.countryCode);
    if (!resolvedPolicy.payoutsEnabled) {
      findings.push(`Versements fermés pour le pays ${request.countryCode}.`);
    }

    // Le montant est immobilisé depuis la demande : il doit se retrouver dans
    // `reservedMinor`. S'il n'y est plus, quelque chose a bougé entre-temps.
    if (!ambassador.wallet) {
      findings.push('Aucun portefeuille rattaché à ce dossier.');
    } else if (ambassador.wallet.reservedMinor < request.amountMinor) {
      findings.push(
        `Montant immobilisé insuffisant (${ambassador.wallet.reservedMinor} pour ${request.amountMinor}).`,
      );
    }

    // Le délai de refroidissement et un éventuel signalement sont RAPPORTÉS ici,
    // pour que l'administration le sache avant d'engager deux approbations sur un
    // versement qui ne pourra pas partir. Le verrou dur, lui, est à l'exécution.
    findings.push(
      ...(await this.paymentDetails.blockingReasons(request.ambassadorId)),
    );

    return findings;
  }

  private async getAtStatus(
    payoutRequestId: string,
    allowed: PayoutRequestStatus[],
  ) {
    const request = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
      include: { ambassador: { select: { userId: true } } },
    });
    if (!request)
      throw new NotFoundException('Demande de versement introuvable.');

    if (!allowed.includes(request.status)) {
      throw new ConflictException(
        `Cette action n’est pas possible sur une demande au statut ${request.status}.`,
      );
    }
    return request;
  }

  private async notifyValidated(request: {
    id: string;
    amountMinor: number;
    currency: string;
    ambassador: { userId: string | null };
  }) {
    await notifyAmbassador(
      this.notifications,
      request.ambassador.userId,
      NotificationType.AMBASSADOR_PAYOUT_VALIDATED,
      {
        payoutRequestId: request.id,
        amountMinor: request.amountMinor,
        currency: request.currency,
      },
    );
  }
}
