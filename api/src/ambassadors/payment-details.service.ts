import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmbassadorStatus,
  NotificationType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import { AmbassadorPolicyService } from './ambassador-policy.service';
import { PaymentDetailAccessPurpose } from './payment-detail-access';
import { PaymentDetailsDto } from './dto/payment-details.dto';
import { ReportPaymentDetailsDto } from './dto/report-payment-details.dto';
import { maskPayoutDestination } from './payout-journal';
import { notifyAmbassador } from './notify-ambassador';

// ============================================================================
// COORDONNÉES DE VERSEMENT ET DÉLAI DE REFROIDISSEMENT
//
// Arbitrage 13 du promoteur, 2026-08-02 :
//
//   « Pendant cette période : aucune nouvelle demande de retrait ne doit pouvoir
//     être exécutée ; l'ambassadeur est informé par e-mail et notification
//     interne ; une alerte de sécurité peut être envoyée par SMS lorsque le
//     risque le justifie ; l'ancienne et la nouvelle destination sont
//     journalisées sous forme masquée ; l'utilisateur peut signaler
//     immédiatement une modification non autorisée. »
//
// LE SCÉNARIO CONTRE LEQUEL TOUT CECI EXISTE : quelqu'un prend la main sur le
// compte d'un ambassadeur, remplace le numéro Mobile Money par le sien, et
// demande un versement. Le délai de refroidissement lui retire la seule chose
// dont il a besoin — la vitesse ; l'alerte donne au titulaire la seule chose
// dont il a besoin — savoir.
//
// LE DÉLAI NE BLOQUE PAS LA DEMANDE, IL BLOQUE L'EXÉCUTION. Refuser la demande
// elle-même effacerait la tentative ; la laisser naître puis refuser le virement
// laisse une trace exploitable, et c'est cette trace qui alimentera la détection
// de fraude.
// ============================================================================
@Injectable()
export class PaymentDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policy: AmbassadorPolicyService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  async getMine(userId: string) {
    const ambassador = await this.mustFindAmbassador(userId);
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId: ambassador.id },
    });
    if (!detail) return null;

    return this.presentable(detail);
  }

  // Enregistre ou remplace les coordonnées. TOUT changement rouvre le délai.
  async update(userId: string, dto: PaymentDetailsDto) {
    const ambassador = await this.mustFindAmbassador(userId);

    if (ambassador.status !== AmbassadorStatus.ACTIVE) {
      throw new ForbiddenException(
        'Seul un ambassadeur actif peut enregistrer des coordonnées de versement.',
      );
    }

    const previous = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId: ambassador.id },
    });

    // Un signalement non levé gèle tout : laisser modifier les coordonnées
    // pendant qu'un détournement est en cours d'instruction reviendrait à
    // donner un second essai à celui qui l'a provoqué.
    if (previous?.reportedAt && !previous.clearedAt) {
      throw new ConflictException(
        'Un signalement est en cours sur vos coordonnées de versement. Contactez l’assistance : elles ne peuvent pas être modifiées tant qu’il n’est pas levé.',
      );
    }

    const resolvedPolicy = await this.policy.resolve(ambassador.countryCode);
    const cooldownUntil = new Date(
      Date.now() + resolvedPolicy.paymentDetailsCooldownHours * 3600 * 1000,
    );

    // Une saisie strictement identique n'est pas un changement : elle ne doit
    // pas rouvrir le délai. Sans cela, enregistrer deux fois les mêmes
    // coordonnées repousserait indéfiniment le versement de quelqu'un
    // d'hésitant.
    //
    // La comparaison porte sur la forme MASQUÉE, et non sur le chiffré : deux
    // chiffrements de la même valeur donnent des résultats différents — c'est le
    // propre d'un chiffrement correct, qui tire un vecteur d'initialisation neuf
    // à chaque fois. Comparer les chiffrés ne détecterait donc jamais l'égalité.
    const nouveauMasque = maskPayoutDestination(dto.destinationLabel);
    const unchanged =
      previous?.method === dto.method &&
      previous?.destinationMasked === nouveauMasque;
    if (unchanged && previous) return this.presentable(previous);

    const detail = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.ambassadorPaymentDetail.upsert({
        where: { ambassadorId: ambassador.id },
        create: {
          ambassadorId: ambassador.id,
          method: dto.method,
          destinationEncrypted: this.encryption.encrypt(dto.destinationLabel),
          destinationMasked: nouveauMasque,
          cooldownUntil,
        },
        update: {
          method: dto.method,
          destinationEncrypted: this.encryption.encrypt(dto.destinationLabel),
          destinationMasked: nouveauMasque,
          changedAt: new Date(),
          cooldownUntil,
          // Un changement légitime referme un signalement déjà levé : le
          // dossier repart propre, avec un nouveau délai.
          reportedAt: null,
          reportedReason: null,
          clearedAt: null,
          clearedById: null,
        },
      });

      await this.journal(tx, ambassador.id, {
        type: previous ? 'CHANGED' : 'REGISTERED',
        actorId: userId,
        method: dto.method,
        // La forme masquée de l'ANCIENNE valeur est déjà stockée en clair : le
        // journal se tient donc à jour sans jamais déchiffrer quoi que ce soit.
        previousMasked: previous?.destinationMasked ?? null,
        newMasked: nouveauMasque,
        cooldownUntil,
      });

      return saved;
    });

    await this.audit.recordChange(
      'AMBASSADOR_PAYMENT_DETAILS_CHANGED',
      userId,
      {
        entityType: 'AmbassadorPaymentDetail',
        entityId: detail.id,
        // MASQUÉ jusque dans l'audit. Un journal d'administration se consulte, se
        // filtre, s'exporte : le numéro complet n'y a pas plus sa place
        // qu'ailleurs.
        changes: [
          {
            field: 'destination',
            oldValue: previous?.destinationMasked ?? null,
            newValue: nouveauMasque,
          },
        ],
        metadata: {
          ambassadorId: ambassador.id,
          method: dto.method,
          cooldownUntil: cooldownUntil.toISOString(),
          cooldownHours: resolvedPolicy.paymentDetailsCooldownHours,
        },
      },
    );

    // L'ALERTE. E-mail obligatoire ET SMS : c'est la notification par laquelle
    // quelqu'un dont le compte a été détourné peut s'en apercevoir. La
    // destination y figure masquée — assez pour reconnaître son propre compte,
    // pas assez pour en apprendre un autre.
    await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED,
      {
        method: dto.method,
        destinationMasked: nouveauMasque,
        cooldownUntil: cooldownUntil.toISOString(),
        cooldownHours: resolvedPolicy.paymentDetailsCooldownHours,
      },
    );

    return this.presentable(detail);
  }

  // « L'utilisateur peut signaler immédiatement une modification non
  // autorisée. » Immédiatement, et sans condition : ce signalement est un frein
  // d'urgence. Il gèle les versements et prévient l'administration.
  async report(userId: string, dto: ReportPaymentDetailsDto) {
    const ambassador = await this.mustFindAmbassador(userId);
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId: ambassador.id },
    });
    if (!detail) {
      throw new NotFoundException(
        'Aucune coordonnée de versement enregistrée.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.ambassadorPaymentDetail.update({
        where: { id: detail.id },
        data: {
          reportedAt: new Date(),
          reportedReason: dto.reason,
          clearedAt: null,
          clearedById: null,
        },
      });

      await this.journal(tx, ambassador.id, {
        type: 'REPORTED',
        actorId: userId,
        method: detail.method,
        previousMasked: null,
        newMasked: detail.destinationMasked,
        reason: dto.reason,
      });

      return saved;
    });

    await this.audit.record('AMBASSADOR_PAYMENT_DETAILS_REPORTED', userId, {
      ambassadorId: ambassador.id,
      destinationMasked: detail.destinationMasked,
      reason: dto.reason,
    });

    await this.notifications.notifyAdmins(
      NotificationType.AMBASSADOR_PAYMENT_DETAILS_CHANGED,
      {
        ambassadorId: ambassador.id,
        reported: true,
        destinationMasked: detail.destinationMasked,
      },
    );

    return this.presentable(updated);
  }

  // Levée du signalement par l'administration, après instruction.
  async clear(adminUserId: string, ambassadorId: string, note: string) {
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId },
    });
    if (!detail) {
      throw new NotFoundException(
        'Aucune coordonnée de versement enregistrée.',
      );
    }
    if (!detail.reportedAt) {
      throw new ConflictException('Aucun signalement en cours sur ce dossier.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.ambassadorPaymentDetail.update({
        where: { id: detail.id },
        data: { clearedAt: new Date(), clearedById: adminUserId },
      });

      await this.journal(tx, ambassadorId, {
        type: 'CLEARED',
        actorId: adminUserId,
        method: detail.method,
        previousMasked: null,
        newMasked: detail.destinationMasked,
        reason: note,
      });

      return saved;
    });

    await this.audit.record('AMBASSADOR_PAYMENT_DETAILS_CLEARED', adminUserId, {
      ambassadorId,
      note,
    });

    return this.presentable(updated);
  }

  // L'HISTORIQUE, déjà masqué — il l'a été à l'écriture, pas à la lecture.
  history(ambassadorId: string) {
    return this.prisma.ambassadorPaymentDetailEvent.findMany({
      where: { ambassadorId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // LE VERROU, appelé par le service de versement avant d'ordonner un virement.
  // Rend la liste de ce qui s'y oppose — vide quand la voie est libre.
  async blockingReasons(
    ambassadorId: string,
    now = new Date(),
  ): Promise<string[]> {
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId },
    });

    if (!detail) {
      return ['Aucune coordonnée de versement enregistrée.'];
    }
    if (detail.reportedAt && !detail.clearedAt) {
      return [
        'Un signalement de modification non autorisée est en cours d’instruction.',
      ];
    }
    if (detail.cooldownUntil > now) {
      return [
        `Coordonnées de versement modifiées récemment : délai de sécurité jusqu’au ${detail.cooldownUntil.toISOString()}.`,
      ];
    }
    return [];
  }

  // ==========================================================================
  // LA PORTE UNIQUE DE DÉCHIFFREMENT
  //
  // « Personne ne lit les coordonnées de paiement sans raison métier
  // explicite. » — exigence du promoteur du 2026-08-04.
  //
  // Le motif n'est pas un commentaire, c'est un PARAMÈTRE OBLIGATOIRE : on ne
  // peut pas déchiffrer en passant, il faut nommer pourquoi. Et ce pourquoi
  // part au journal d'audit avec l'auteur, l'horodatage et le dossier concerné.
  //
  // TOUT passe par ici. Aucun autre endroit du code n'appelle `decrypt` sur ces
  // colonnes — c'est ce qui rend la traçabilité vraie plutôt que déclarative.
  // ==========================================================================
  async revealDestination(
    ambassadorId: string,
    purpose: PaymentDetailAccessPurpose,
    actorId: string | null,
    context: { reason?: string; payoutRequestId?: string } = {},
  ): Promise<{ method: string; destinationLabel: string }> {
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId },
    });

    if (!detail) {
      // Une demande de lecture sur un dossier sans coordonnées est en soi une
      // anomalie : elle est journalisée comme un accès refusé, pas ignorée.
      await this.audit.record(
        'AMBASSADOR_PAYMENT_DETAILS_ACCESS_DENIED',
        actorId,
        { ambassadorId, purpose, motif: 'AUCUNE_COORDONNEE' },
      );
      throw new ConflictException(
        'Aucune coordonnée de versement enregistrée pour ce dossier.',
      );
    }

    let destinationLabel: string;
    try {
      destinationLabel = this.encryption.decrypt(detail.destinationEncrypted);
    } catch (error) {
      // Échec de déchiffrement = valeur altérée, ou clé absente du trousseau.
      // Les deux méritent une trace : la première est une atteinte à
      // l'intégrité, la seconde une erreur d'exploitation qui bloque des
      // versements. Se taire ici reviendrait à laisser l'incident se découvrir
      // par la plainte d'un ambassadeur non payé.
      await this.audit.record(
        'AMBASSADOR_PAYMENT_DETAILS_ACCESS_DENIED',
        actorId,
        {
          ambassadorId,
          purpose,
          motif: 'DECHIFFREMENT_IMPOSSIBLE',
          keyId: this.encryption.keyIdOf(detail.destinationEncrypted),
          message: error instanceof Error ? error.message : String(error),
        },
      );
      throw new ForbiddenException(
        'Les coordonnées de versement de ce dossier ne peuvent pas être déchiffrées. Incident journalisé.',
      );
    }

    // LA TRACE. Elle porte le motif, l'auteur et le dossier — jamais la valeur
    // lue : un journal qui recopierait ce qu'il protège n'aurait aucun sens.
    await this.audit.record('AMBASSADOR_PAYMENT_DETAILS_DECRYPTED', actorId, {
      ambassadorId,
      purpose,
      destinationMasked: detail.destinationMasked,
      ...(context.reason ? { reason: context.reason } : {}),
      ...(context.payoutRequestId
        ? { payoutRequestId: context.payoutRequestId }
        : {}),
    });

    return { method: detail.method, destinationLabel };
  }

  // Recopie de la destination sur une demande de versement. Enveloppe nommée
  // autour de la porte ci-dessus : l'appelant n'a pas à choisir un motif, celui
  // de ce chemin-là est le seul possible.
  async resolveForPayout(ambassadorId: string, actorId: string | null) {
    const detail = await this.prisma.ambassadorPaymentDetail.findUnique({
      where: { ambassadorId },
      select: { id: true },
    });
    if (!detail) {
      throw new ConflictException(
        'Enregistrez vos coordonnées de versement avant de demander un retrait.',
      );
    }

    return this.revealDestination(
      ambassadorId,
      PaymentDetailAccessPurpose.PAYOUT_REQUEST_SNAPSHOT,
      actorId,
    );
  }

  // Ce que l'ambassadeur et l'administration voient : jamais le numéro complet.
  // La forme masquée est LUE EN BASE, où elle est stockée en clair — aucune
  // opération de déchiffrement n'a lieu pour un affichage.
  private presentable(detail: {
    id: string;
    method: string;
    destinationMasked: string;
    changedAt: Date;
    cooldownUntil: Date;
    reportedAt: Date | null;
    reportedReason: string | null;
    clearedAt: Date | null;
  }) {
    return {
      id: detail.id,
      method: detail.method,
      destinationMasked: detail.destinationMasked,
      changedAt: detail.changedAt,
      cooldownUntil: detail.cooldownUntil,
      cooldownActive: detail.cooldownUntil > new Date(),
      reportedAt: detail.reportedAt,
      reportedReason: detail.reportedReason,
      clearedAt: detail.clearedAt,
    };
  }

  // UNE SEULE PORTE D'ÉCRITURE AU JOURNAL, et elle masque. L'appelant lui passe
  // les libellés complets ; elle n'écrit que leur forme masquée. Le masquage ne
  // peut donc pas être oublié à un appel — même principe que le journal des
  // versements.
  private async journal(
    tx: {
      ambassadorPaymentDetailEvent: {
        create: (args: { data: Record<string, unknown> }) => unknown;
      };
    },
    ambassadorId: string,
    entry: {
      type: string;
      actorId: string;
      method: string;
      // DÉJÀ MASQUÉES par l'appelant, qui les lit telles quelles en base. Le
      // journal ne déchiffre donc jamais rien : c'est ce qui permet de
      // consulter l'historique complet d'un dossier sans qu'une seule lecture
      // de coordonnées n'ait lieu.
      previousMasked: string | null;
      newMasked: string;
      cooldownUntil?: Date;
      reason?: string;
    },
  ) {
    await tx.ambassadorPaymentDetailEvent.create({
      data: {
        ambassadorId,
        type: entry.type,
        actorId: entry.actorId,
        method: entry.method,
        previousMasked: entry.previousMasked,
        newMasked: entry.newMasked,
        cooldownUntil: entry.cooldownUntil ?? null,
        reason: entry.reason ?? null,
      },
    });
  }

  private async mustFindAmbassador(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        status: true,
        countryCode: true,
      },
    });
    if (!ambassador) {
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");
    }
    return ambassador;
  }
}
