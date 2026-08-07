import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AmbassadorCategory,
  AmbassadorStatus,
  CommissionNature,
  CommissionReviewReason,
  CommissionStatus,
  NotificationType,
  PaymentStatus,
  PortfolioEventType,
  ProductType,
} from '../../generated/prisma/enums';
import { AuditService, diffOf } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AmbassadorPolicyService,
  addMonths,
} from './ambassador-policy.service';
import {
  CommissionCapsService,
  capTraceAsJson,
} from './commission-caps.service';
import { CommissionRulesService } from './commission-rules.service';
import type { AmbassadorDecisionDto } from './dto/ambassador-decision.dto';
import type { CorrectCommissionDto } from './dto/correct-commission.dto';
import type { ReleaseCommissionDto } from './dto/release-commission.dto';
import { WalletService } from './wallet.service';
import { notifyAmbassador } from './notify-ambassador';

// ============================================================================
// MOTEUR DE COMMISSION
//
// Point d'entrée UNIQUE : un paiement passé à CONFIRMED, c'est-à-dire une
// confirmation officielle reçue du prestataire de paiement. Rien d'autre ne crée
// de commission — ni une inscription, ni une déclaration d'un ambassadeur, ni
// l'écoulement du temps, ni une réponse envoyée par l'application mobile.
//
// « Pas d'achat = pas de commission » (décision du promoteur du 2026-07-31). Ce
// service n'expose donc volontairement AUCUNE méthode publique permettant de
// créer une commission à la main.
// ============================================================================
@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly rules: CommissionRulesService,
    private readonly wallet: WalletService,
    private readonly policy: AmbassadorPolicyService,
    private readonly caps: CommissionCapsService,
  ) {}

  // Appelé après la confirmation d'un paiement. Ne remonte JAMAIS d'exception à
  // l'appelant : l'encaissement du client ne doit pas échouer parce que le calcul
  // d'une commission a rencontré un problème. L'incident est journalisé et reste
  // rejouable — la contrainte d'unicité sur paymentId rend le rejeu inoffensif.
  async onPaymentConfirmed(paymentId: string): Promise<void> {
    try {
      await this.process(paymentId);
    } catch (error) {
      this.logger.error(
        `Calcul de commission impossible pour le paiement ${paymentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.audit.record('AMBASSADOR_COMMISSION_FAILED', null, {
        paymentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async process(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { subscription: true },
    });

    // Ceinture et bretelles : ce service ne travaille QUE sur un paiement confirmé.
    // Si un appelant se trompe un jour de moment, rien ne se passe.
    if (!payment || payment.status !== PaymentStatus.CONFIRMED) return;

    const existing = await this.prisma.commission.findUnique({
      where: { paymentId },
      select: { id: true },
    });
    if (existing) return;

    const { subscription } = payment;
    const organizationId =
      subscription.beneficiaryOrganizationId ??
      subscription.initiatingOrganizationId;

    // --- Recherche de l'attribution --------------------------------------------
    // Deux chemins seulement, tous deux fondés sur un fait enregistré : le
    // parrainage d'un jeune, ou le rattachement d'une entreprise. La réponse à
    // « Comment avez-vous connu LES STAGIAIRES ? » n'est jamais consultée ici, et
    // ne doit jamais l'être : c'est une statistique marketing, pas un titre à
    // percevoir (point 9 des arbitrages).
    const portfolioEntry = organizationId
      ? await this.prisma.ambassadorPortfolioEntry.findFirst({
          where: { organizationId, releasedAt: null },
          include: { ambassador: true },
        })
      : null;

    const referral =
      !portfolioEntry && subscription.beneficiaryUserId
        ? await this.prisma.ambassadorReferral.findUnique({
            where: { referredUserId: subscription.beneficiaryUserId },
            include: { ambassador: true },
          })
        : null;

    // --- Le compteur du portefeuille se remet à zéro AVANT tout arbitrage ------
    // Volontairement placé ici, et non plus bas après les contrôles : la règle du
    // promoteur porte sur l'ACHAT, pas sur la commission. Une entreprise qui achète
    // reste rattachée à son ambassadeur même si aucune commission n'est due ce
    // jour-là — ambassadeur suspendu, barème absent, pays coupé. Confondre les deux
    // ferait perdre un portefeuille à cause d'une décision administrative sans
    // rapport avec l'activité commerciale réelle.
    if (portfolioEntry) {
      await this.resetPortfolioCountdown(
        portfolioEntry.id,
        payment.countryCode,
      );
    }

    const attribution = portfolioEntry ?? referral;
    if (!attribution) return;

    const { ambassador } = attribution;

    if (ambassador.status !== AmbassadorStatus.ACTIVE) {
      await this.audit.record('AMBASSADOR_COMMISSION_SKIPPED', null, {
        paymentId,
        ambassadorId: ambassador.id,
        reason: 'AMBASSADEUR_NON_ACTIF',
      });
      return;
    }

    // --- Interdiction de l'auto-parrainage --------------------------------------
    // Un ambassadeur ne touche jamais sur son propre abonnement, ni sur une
    // organisation qu'il possède. Sans ce contrôle, le barème de 20 % deviendrait
    // une remise de 20 % que n'importe qui pourrait s'accorder en devenant
    // ambassadeur avant de souscrire.
    // Un dossier anonymisé n'a plus de compte : la comparaison est alors sans
    // objet, et `detectSelfDealing` le traite comme « aucune correspondance ».
    const isSelfDealing = await this.detectSelfDealing(
      ambassador.userId ?? null,
      subscription.beneficiaryUserId,
      organizationId,
    );
    if (isSelfDealing) {
      await this.audit.record('AMBASSADOR_SELF_REFERRAL_BLOCKED', null, {
        paymentId,
        ambassadorId: ambassador.id,
        beneficiaryUserId: subscription.beneficiaryUserId,
        organizationId,
      });
      return;
    }

    const resolvedPolicy = await this.policy.resolve(payment.countryCode);
    if (!resolvedPolicy.commissionsEnabled) {
      await this.audit.record('AMBASSADOR_COMMISSION_SKIPPED', null, {
        paymentId,
        ambassadorId: ambassador.id,
        reason: 'COMMISSIONS_DESACTIVEES_PAYS',
        countryCode: payment.countryCode,
      });
      return;
    }

    const nature = await this.determineNature({
      productKey: subscription.plan,
      beneficiaryUserId: subscription.beneficiaryUserId,
      organizationId,
      excludePaymentId: payment.id,
    });

    const resolution = await this.rules.resolve({
      productType: ProductType.SUBSCRIPTION,
      productKey: subscription.plan,
      nature,
      ambassadorCategory: portfolioEntry
        ? AmbassadorCategory.BUSINESS
        : AmbassadorCategory.CAMPUS,
      ambassadorTier: ambassador.tier,
      countryCode: payment.countryCode,
      at: payment.providerConfirmedAt ?? new Date(),
    });

    // Un barème peut exprimer un TAUX ou un MONTANT FIXE. N'avoir ni l'un ni
    // l'autre, c'est n'avoir aucun barème applicable.
    //  et non  : il attrape AUSSI . La nuance
    // n'est pas cosmétique — une résolution qui ne renseigne pas le champ aurait
    // sinon franchi ce garde-fou et produit une commission à taux zéro, c'est-à-dire
    // un ambassadeur payé zéro sans que personne ne s'en aperçoive.
    if (
      resolution.rateBasisPoints == null &&
      resolution.fixedAmountMinor == null
    ) {
      // Aucun barème : on ne devine pas. L'administration doit trancher, et cette
      // trace d'audit est ce qui le lui fera savoir.
      await this.audit.record('AMBASSADOR_COMMISSION_NO_RULE', null, {
        paymentId,
        ambassadorId: ambassador.id,
        productKey: subscription.plan,
        nature,
        countryCode: payment.countryCode,
      });
      return;
    }

    const amountMinor = this.rules.computeAmountMinor(
      payment.amountMinor,
      resolution.rateBasisPoints,
      resolution.fixedAmountMinor,
    );

    const securityPeriodEndsAt = new Date(
      (payment.providerConfirmedAt ?? new Date()).getTime() +
        resolvedPolicy.securityPeriodDays * 24 * 60 * 60 * 1000,
    );

    // --- PLAFONDS -------------------------------------------------------------
    // Le montant qui suit est celui du barème, et il ne sera pas retouché ici.
    // Si un plafond est franchi, la commission naît COMPLÈTE et se met en
    // attente d'arbitrage ; elle ne rétrécit pas. Le promoteur a été explicite :
    // « le dépassement ne doit pas entraîner une réduction silencieuse ».
    const capVerdict = await this.caps.evaluate({
      ambassadorId: ambassador.id,
      amountMinor,
      currency: payment.currency,
      countryCode: payment.countryCode,
      productKey: subscription.plan,
      campaignKey: resolution.rule?.campaignKey ?? null,
      at: payment.providerConfirmedAt ?? new Date(),
    });

    const commission = await this.prisma.$transaction(async (tx) => {
      const created = await tx.commission.create({
        data: {
          ambassadorId: ambassador.id,
          paymentId: payment.id,
          status: capVerdict.exceeded
            ? CommissionStatus.REVIEW_REQUIRED
            : CommissionStatus.PENDING,
          nature,
          referralId: referral?.id ?? null,
          portfolioEntryId: portfolioEntry?.id ?? null,
          productType: ProductType.SUBSCRIPTION,
          productKey: subscription.plan,
          basisAmountMinor: payment.amountMinor,
          // Zéro quand la commission relève d'une prime forfaitaire : le taux
          // n'a alors pas de sens, et `appliedFixedAmountMinor` porte le montant.
          rateBasisPoints: resolution.rateBasisPoints ?? 0,
          amountMinor,
          currency: payment.currency,
          countryCode: payment.countryCode,
          appliedRuleId: resolution.rule?.id ?? null,
          // PHOTOGRAPHIE DE LA RÈGLE. `appliedRuleId` est en SetNull : si le
          // barème disparaît un jour, le lien s'efface. Ces trois champs restent —
          // une commission doit rester justifiable sans dépendre de la survie
          // d'une ligne de configuration.
          appliedRuleLabel: resolution.rule?.label ?? null,
          appliedRuleVersion: resolution.rule?.version ?? null,
          appliedFixedAmountMinor: resolution.fixedAmountMinor ?? null,
          appliedCampaignKey: resolution.rule?.campaignKey ?? null,
          resolutionTrace: resolution.trace,
          capTrace: capTraceAsJson(capVerdict.trace),
          reviewReason: capVerdict.exceeded
            ? CommissionReviewReason.CAP_EXCEEDED
            : null,
          securityPeriodEndsAt,
        },
      });

      await tx.commissionEvent.create({
        data: {
          commissionId: created.id,
          type: 'CREATED',
          metadata: { paymentId: payment.id, nature },
        },
      });

      if (capVerdict.exceeded) {
        await tx.commissionEvent.create({
          data: {
            commissionId: created.id,
            type: 'REVIEW_REQUIRED',
            metadata: {
              reason: CommissionReviewReason.CAP_EXCEEDED,
              // Seuls les plafonds qui ont MORDU, pour que l'évènement se lise
              // sans avoir à déplier toute la trace.
              exceededCaps: capVerdict.trace
                .filter((t) => t.exceeded)
                .map((t) => ({
                  capId: t.capId,
                  label: t.label,
                  window: t.window,
                  limitMinor: t.limitMinor,
                  totalMinor: t.totalMinor,
                })),
            },
          },
        });
      } else {
        // AUCUN CRÉDIT AU PORTEFEUILLE tant qu'une commission est en contrôle.
        // Créditer puis débiter en cas de correction ferait apparaître à
        // l'ambassadeur un solde qu'on lui reprendrait ensuite — et laisserait
        // dans le grand livre deux écritures pour un fait qui n'a jamais eu lieu.
        await this.wallet.accrue(
          tx,
          ambassador.id,
          payment.currency,
          amountMinor,
          created.id,
        );
      }

      return created;
    });

    await this.audit.record('AMBASSADOR_COMMISSION_CREATED', null, {
      commissionId: commission.id,
      ambassadorId: ambassador.id,
      paymentId: payment.id,
      amountMinor,
      rateBasisPoints: resolution.rateBasisPoints,
      nature,
      status: commission.status,
    });

    if (capVerdict.exceeded) {
      // L'ADMINISTRATION est prévenue, pas l'ambassadeur. Lui annoncer une
      // commission qui peut encore être corrigée ou annulée, ce serait promettre
      // une somme que personne n'a validée. Il sera informé au dénouement, avec
      // le montant réellement retenu.
      await this.audit.record('AMBASSADOR_COMMISSION_REVIEW_REQUIRED', null, {
        commissionId: commission.id,
        ambassadorId: ambassador.id,
        amountMinor,
        currency: payment.currency,
        exceededCaps: capTraceAsJson(
          capVerdict.trace.filter((t) => t.exceeded),
        ),
      });

      await this.notifications.notifyAdmins(
        NotificationType.AMBASSADOR_COMMISSION_REVIEW_REQUIRED,
        {
          commissionId: commission.id,
          ambassadorId: ambassador.id,
          amountMinor,
          currency: payment.currency,
          capCount: capVerdict.trace.filter((t) => t.exceeded).length,
        },
      );
      return;
    }

    await notifyAmbassador(
      this.notifications,
      ambassador.userId,
      NotificationType.AMBASSADOR_COMMISSION_EARNED,
      {
        commissionId: commission.id,
        amountMinor,
        currency: payment.currency,
        nature,
        availableAt: securityPeriodEndsAt.toISOString(),
      },
    );
  }

  // ==========================================================================
  // ARBITRAGE D'UNE COMMISSION EN CONTRÔLE
  //
  // « L'administration doit alors valider ou corriger la commission, avec
  // journalisation complète. » Trois issues, et trois seulement : on valide en
  // l'état, on corrige à la baisse, ou on annule.
  //
  // Les trois passent par `takeReviewed()`, qui impose la même règle : la
  // commission DOIT être en REVIEW_REQUIRED. Une commission déjà relâchée — a
  // fortiori exigible ou payée — n'est plus corrigeable. Le constat financier
  // redevient immuable dès l'instant où il a été validé.
  // ==========================================================================

  listAwaitingReview() {
    return this.prisma.commission.findMany({
      where: { status: CommissionStatus.REVIEW_REQUIRED },
      orderBy: { createdAt: 'asc' },
      include: {
        ambassador: {
          select: { id: true, code: true, tier: true, userId: true },
        },
      },
    });
  }

  // Validation en l'état : le plafond était franchi, l'administration estime la
  // commission justifiée. Le montant du barème est servi tel quel.
  async releaseReviewed(
    adminUserId: string,
    commissionId: string,
    dto: ReleaseCommissionDto,
  ) {
    const commission = await this.takeReviewed(commissionId);

    const released = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commission.update({
        where: { id: commission.id },
        data: {
          status: CommissionStatus.PENDING,
          reviewedById: adminUserId,
          reviewedAt: new Date(),
        },
      });

      await tx.commissionEvent.create({
        data: {
          commissionId: commission.id,
          type: 'REVIEW_RELEASED',
          actorId: adminUserId,
          metadata: { internalNote: dto.internalNote },
        },
      });

      // Le crédit n'a lieu QUE MAINTENANT — c'est ce report qui garantit qu'un
      // montant en contrôle n'a jamais figuré dans le solde de personne.
      await this.wallet.accrue(
        tx,
        commission.ambassadorId,
        commission.currency,
        commission.amountMinor,
        commission.id,
      );

      return updated;
    });

    await this.audit.recordChange(
      'AMBASSADOR_COMMISSION_REVIEW_RELEASED',
      adminUserId,
      {
        entityType: 'Commission',
        entityId: commission.id,
        changes: diffOf(
          { status: CommissionStatus.REVIEW_REQUIRED },
          { status: CommissionStatus.PENDING },
        ),
        // La note interne va DANS L'AUDIT, jamais dans une notification. Elle
        // n'a qu'un lecteur : celui qui instruira une contestation.
        metadata: {
          internalNote: dto.internalNote,
          amountMinor: commission.amountMinor,
          reviewReason: commission.reviewReason,
        },
      },
    );

    await this.notifyOutcome(commission.ambassadorId, released.amountMinor, {
      commissionId: commission.id,
      currency: commission.currency,
      securityPeriodEndsAt: commission.securityPeriodEndsAt,
    });

    return released;
  }

  // Correction à la baisse. Jamais à la hausse : le contrôle d'un dépassement ne
  // doit pas devenir le chemin par lequel on s'accorde plus que le barème. La
  // base l'interdit aussi, par contrainte CHECK — ce garde-fou-ci ne fait
  // qu'offrir un message clair avant d'y arriver.
  async correctReviewed(
    adminUserId: string,
    commissionId: string,
    dto: CorrectCommissionDto,
  ) {
    const commission = await this.takeReviewed(commissionId);

    if (dto.amountMinor >= commission.amountMinor) {
      throw new BadRequestException(
        'Une correction ne peut aller que vers le bas. Pour servir le montant du barème, validez la commission en l’état.',
      );
    }
    if (dto.amountMinor <= 0) {
      throw new BadRequestException(
        'Une correction à zéro n’est pas une correction : annulez la commission, avec son motif.',
      );
    }

    const corrected = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commission.update({
        where: { id: commission.id },
        data: {
          status: CommissionStatus.PENDING,
          amountMinor: dto.amountMinor,
          // Le montant du barème est CONSERVÉ. Sans lui, la commission
          // ressemblerait rétrospectivement à un calcul normal, et la décision
          // humaine aurait disparu du dossier.
          originalAmountMinor: commission.amountMinor,
          reviewedById: adminUserId,
          reviewedAt: new Date(),
        },
      });

      await tx.commissionEvent.create({
        data: {
          commissionId: commission.id,
          type: 'REVIEW_CORRECTED',
          actorId: adminUserId,
          metadata: {
            fromAmountMinor: commission.amountMinor,
            toAmountMinor: dto.amountMinor,
            reasonCode: dto.reasonCode,
            internalNote: dto.internalNote,
          },
        },
      });

      await this.wallet.accrue(
        tx,
        commission.ambassadorId,
        commission.currency,
        dto.amountMinor,
        commission.id,
      );

      return updated;
    });

    await this.audit.recordChange(
      'AMBASSADOR_COMMISSION_REVIEW_CORRECTED',
      adminUserId,
      {
        entityType: 'Commission',
        entityId: commission.id,
        changes: diffOf(
          {
            status: CommissionStatus.REVIEW_REQUIRED,
            amountMinor: commission.amountMinor,
          },
          {
            status: CommissionStatus.PENDING,
            amountMinor: dto.amountMinor,
          },
        ),
        metadata: {
          internalNote: dto.internalNote,
          reasonCode: dto.reasonCode,
          reviewReason: commission.reviewReason,
        },
      },
    );

    await this.notifyOutcome(commission.ambassadorId, dto.amountMinor, {
      commissionId: commission.id,
      currency: commission.currency,
      securityPeriodEndsAt: commission.securityPeriodEndsAt,
      reasonCode: dto.reasonCode,
      publicMessage: dto.publicMessage,
    });

    return corrected;
  }

  // Annulation. Aucune écriture de portefeuille à défaire : rien n'a jamais été
  // crédité. Et aucune notification à l'ambassadeur — on ne lui a jamais annoncé
  // cette commission, l'informer de l'annulation d'une somme qu'il ignorait
  // n'apporterait qu'une inquiétude sans objet. Le fait, lui, est journalisé.
  async cancelReviewed(
    adminUserId: string,
    commissionId: string,
    dto: AmbassadorDecisionDto,
  ) {
    const commission = await this.takeReviewed(commissionId);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.commission.update({
        where: { id: commission.id },
        data: {
          status: CommissionStatus.CANCELLED,
          // Un CODE, pas la note interne. `cancelReason` a beau être un champ
          // texte hérité, seul un motif structuré y entre désormais : c'est ce
          // qui rend impossible qu'une note d'administration ressorte un jour
          // par un export ou un écran.
          cancelReason: dto.reasonCode,
          reviewedById: adminUserId,
          reviewedAt: new Date(),
        },
      });

      await tx.commissionEvent.create({
        data: {
          commissionId: commission.id,
          type: 'REVIEW_CANCELLED',
          actorId: adminUserId,
          metadata: {
            reasonCode: dto.reasonCode,
            internalNote: dto.internalNote,
            amountMinor: commission.amountMinor,
          },
        },
      });

      return updated;
    });

    await this.audit.recordChange(
      'AMBASSADOR_COMMISSION_REVIEW_CANCELLED',
      adminUserId,
      {
        entityType: 'Commission',
        entityId: commission.id,
        changes: diffOf(
          { status: CommissionStatus.REVIEW_REQUIRED },
          { status: CommissionStatus.CANCELLED },
        ),
        metadata: {
          internalNote: dto.internalNote,
          reasonCode: dto.reasonCode,
          amountMinor: commission.amountMinor,
        },
      },
    );

    return cancelled;
  }

  private async takeReviewed(commissionId: string) {
    const commission = await this.prisma.commission.findUnique({
      where: { id: commissionId },
    });
    if (!commission) throw new NotFoundException('Commission introuvable.');

    if (commission.status !== CommissionStatus.REVIEW_REQUIRED) {
      throw new ConflictException(
        'Cette commission n’est pas en contrôle : son montant n’est plus modifiable.',
      );
    }
    return commission;
  }

  // Le dénouement d'un contrôle se dit avec le MONTANT RETENU, jamais avec celui
  // du barème. `notifyAmbassador` absorbe le cas du dossier anonymisé.
  private async notifyOutcome(
    ambassadorId: string,
    amountMinor: number,
    context: {
      commissionId: string;
      currency: string;
      securityPeriodEndsAt: Date;
      reasonCode?: string;
      publicMessage?: string;
    },
  ) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { id: ambassadorId },
      select: { userId: true },
    });

    await notifyAmbassador(
      this.notifications,
      ambassador?.userId ?? null,
      NotificationType.AMBASSADOR_COMMISSION_EARNED,
      {
        commissionId: context.commissionId,
        amountMinor,
        currency: context.currency,
        availableAt: context.securityPeriodEndsAt.toISOString(),
        ...(context.reasonCode ? { reasonCode: context.reasonCode } : {}),
        ...(context.publicMessage
          ? { publicMessage: context.publicMessage }
          : {}),
      },
    );
  }

  // --- Maturation de la période de sécurité -----------------------------------------
  //
  // Balayage quotidien : une commission dont la période de sécurité est écoulée
  // devient exigible. C'est le seul endroit où le temps agit sur une commission — et
  // il ne la CRÉE pas, il la rend seulement disponible. La distinction compte : la
  // règle « le temps ne génère jamais de commission » reste entière.
  //
  // Le statut APPROVED n'est volontairement pas traversé ici. Il est réservé à une
  // future étape de contrôle anti-fraude manuel : le jour où elle existera, elle
  // s'intercalera entre PENDING et PAYABLE sans qu'aucune commission déjà versée
  // n'ait à être relue.
  async matureSecurityPeriods(now = new Date()) {
    const due = await this.prisma.commission.findMany({
      where: {
        status: CommissionStatus.PENDING,
        securityPeriodEndsAt: { lte: now },
      },
      include: { ambassador: { select: { userId: true } } },
    });

    for (const commission of due) {
      const wallet = await this.prisma.ambassadorWallet.findUnique({
        where: { ambassadorId: commission.ambassadorId },
      });
      if (!wallet) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.commission.update({
          where: { id: commission.id },
          data: { status: CommissionStatus.PAYABLE, payableAt: now },
        });
        await tx.commissionEvent.create({
          data: { commissionId: commission.id, type: 'PAYABLE' },
        });
        await this.wallet.makeAvailable(
          tx,
          wallet.id,
          commission.amountMinor,
          commission.id,
        );
      });

      await notifyAmbassador(
        this.notifications,
        commission.ambassador.userId,
        NotificationType.AMBASSADOR_COMMISSION_PAYABLE,
        {
          commissionId: commission.id,
          amountMinor: commission.amountMinor,
          currency: commission.currency,
        },
      );
    }

    if (due.length > 0) {
      await this.audit.record('AMBASSADOR_COMMISSION_MATURED', null, {
        count: due.length,
      });
    }
    return due.length;
  }

  async listForAmbassador(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!ambassador) return [];

    return this.prisma.commission.findMany({
      where: { ambassadorId: ambassador.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // Remet à zéro le compte à rebours des douze mois et efface les alertes déjà
  // envoyées, pour qu'un nouveau cycle puisse en émettre de nouvelles.
  private async resetPortfolioCountdown(entryId: string, countryCode: string) {
    const resolvedPolicy = await this.policy.resolve(countryCode);
    const now = new Date();

    await this.prisma.ambassadorPortfolioEntry.update({
      where: { id: entryId },
      data: {
        lastConfirmedPurchaseAt: now,
        expiresAt: addMonths(now, resolvedPolicy.portfolioExpiryMonths),
        warnedAt9m: null,
        warnedAt11m: null,
      },
    });

    await this.prisma.portfolioEvent.create({
      data: {
        entryId,
        type: PortfolioEventType.PURCHASE_CONFIRMED,
        metadata: { at: now.toISOString() },
      },
    });
  }

  // Un ambassadeur ne perçoit rien sur lui-même, ni sur une organisation dont il est
  // propriétaire. Le contrôle porte sur la PROPRIÉTÉ de l'organisation et non sur la
  // simple appartenance à l'équipe : un ambassadeur peut légitimement être salarié
  // d'une entreprise qu'un autre a apportée.
  private async detectSelfDealing(
    // Nullable depuis le durcissement du 2026-08-02 : un dossier anonymisé n'a
    // plus de compte rattaché. Aucun identifiant ne pouvant égaler `null`, la
    // détection rend alors `false` — ce qui est le bon comportement : on ne peut
    // pas s'auto-attribuer une commission avec un compte qui n'existe plus.
    ambassadorUserId: string | null,
    beneficiaryUserId: string | null,
    organizationId: string | null,
  ): Promise<boolean> {
    if (beneficiaryUserId && beneficiaryUserId === ambassadorUserId)
      return true;
    if (!organizationId) return false;

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });
    return organization?.ownerId === ambassadorUserId;
  }

  // Acquisition, nouvelle prestation ou renouvellement : la nature se DÉDUIT de
  // l'historique des paiements confirmés, jamais d'une saisie. Personne ne peut donc
  // requalifier un renouvellement à 5 % en acquisition à 15 %.
  private async determineNature(input: {
    productKey: string;
    beneficiaryUserId: string | null;
    organizationId: string | null;
    excludePaymentId: string;
  }): Promise<CommissionNature> {
    const subscriptionFilter = input.organizationId
      ? {
          OR: [
            { beneficiaryOrganizationId: input.organizationId },
            { initiatingOrganizationId: input.organizationId },
          ],
        }
      : { beneficiaryUserId: input.beneficiaryUserId };

    const priorPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.CONFIRMED,
        id: { not: input.excludePaymentId },
        subscription: subscriptionFilter,
      },
      select: { subscription: { select: { plan: true } } },
    });

    if (priorPayments.length === 0) return CommissionNature.ACQUISITION;

    const alreadyBoughtThisProduct = priorPayments.some(
      (prior) => prior.subscription.plan === input.productKey,
    );
    return alreadyBoughtThisProduct
      ? CommissionNature.RENEWAL
      : CommissionNature.NEW_SERVICE;
  }
}
