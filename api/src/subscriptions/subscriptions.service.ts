import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { MinorPolicyService } from '../auth/minor-policy.service';
import {
  MinorGatedAction,
  OrganizationType,
  SubscriptionBillingCycle,
  SubscriptionOriginType,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../generated/prisma/enums';
import { OrganizationAccessService } from '../opportunities/organization-access.service';
import {
  PAYMENT_GATEWAY_PROVIDER,
  type PaymentGatewayProvider,
} from '../payments/payment-gateway-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { SponsorSubscriptionDto } from './dto/sponsor-subscription.dto';
import { SubscribeOrganizationDto } from './dto/subscribe-organization.dto';
import { SubscribeSelfDto } from './dto/subscribe-self.dto';
import { INDIVIDUAL_PLANS } from './individual-plans';
import { SubscriptionPricingService } from './subscription-pricing.service';

// --- P1-1 : UN SEUL ABONNEMENT INDIVIDUEL À LA FOIS -------------------------
// Les statuts qui OCCUPENT LA PLACE pour un même bénéficiaire.
//
// ACTIVE va de soi. PENDING_PAYMENT beaucoup moins — et c'est pourtant lui qui
// ferme réellement la porte. Sans lui, n appels successifs à POST
// /subscriptions/me créeraient n abonnements en attente et n Payment, dont
// chacun pourrait être confirmé plus tard par le webhook : la règle « un seul
// abonnement individuel actif » serait contournée SANS QUE DEUX ACTIVE
// COEXISTENT JAMAIS au moment du contrôle (arbitrage du promoteur, 2026-08-18).
//
// PAYMENT_FAILED, EXPIRED et CANCELLED n'occupent rien, à dessein : un paiement
// échoué doit pouvoir être retenté, et un abonnement expiré doit pouvoir être
// renouvelé — les bloquer rendrait le renouvellement (P1-2) impossible à
// construire.
export const STATUTS_OCCUPANT_LA_PLACE = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PENDING_PAYMENT,
] as const;

// Message unique : la garde applicative et la course perdue contre l'index
// doivent être indiscernables pour l'appelant. Deux formulations différentes
// révéleraient laquelle des deux a mordu, sans lui être d'aucune utilité.
const DEJA_UN_ABONNEMENT_INDIVIDUEL =
  'Un abonnement individuel est déjà en cours sur ce compte.';

function estFormuleIndividuelle(plan: SubscriptionPlan): boolean {
  return (INDIVIDUAL_PLANS as readonly SubscriptionPlan[]).includes(plan);
}

// Même forme que dans `ambassadors.service.ts`, où un index unique ferme déjà la
// course à l'attribution d'un filleul. Volontairement recopiée plutôt
// qu'exportée : P1-1 ne doit toucher aucun fichier du module Ambassadeurs.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

interface CreateSubscriptionParams {
  plan: SubscriptionPlan;
  billingCycle: SubscriptionBillingCycle;
  countryCode: string;
  beneficiaryUserId?: string;
  beneficiaryOrganizationId?: string;
  originType: SubscriptionOriginType;
  initiatingOrganizationId?: string;
  parentRedirectRequested?: boolean;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly minorPolicy: MinorPolicyService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly pricing: SubscriptionPricingService,
    @Inject(PAYMENT_GATEWAY_PROVIDER)
    private readonly gateway: PaymentGatewayProvider,
  ) {}

  // Auto-souscription individuelle PROTECT/PRO — jamais de contrôle mineur : un compte
  // mineur peut initier lui-même cette souscription, la redirection vers le parent/tuteur
  // reste une option qu'il choisit, jamais une condition bloquante (CLAUDE.md §6).
  async subscribeSelf(userId: string, dto: SubscribeSelfDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    return this.createSubscription({
      plan: dto.plan,
      billingCycle: dto.billingCycle,
      countryCode: user.countryOfResidence ?? 'CM',
      beneficiaryUserId: userId,
      originType: SubscriptionOriginType.SELF,
      parentRedirectRequested: dto.parentRedirectRequested ?? false,
    });
  }

  // Une organisation souscrit pour elle-même — BUSINESS pour une entreprise, INSTITUTION
  // pour un établissement, jamais choisi par le client (dérivé de Organization.type).
  async subscribeOrganization(
    actorUserId: string,
    organizationId: string,
    dto: SubscribeOrganizationDto,
  ) {
    await this.orgAccess.assertCanManageBilling(organizationId, actorUserId);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const plan =
      organization.type === OrganizationType.ETABLISSEMENT
        ? SubscriptionPlan.INSTITUTION
        : SubscriptionPlan.BUSINESS;

    return this.createSubscription({
      plan,
      billingCycle: dto.billingCycle,
      countryCode: organization.country,
      beneficiaryOrganizationId: organizationId,
      originType: SubscriptionOriginType.SELF,
    });
  }

  // Un établissement ou une entreprise souscrit PROTECT/PRO pour le compte d'un
  // bénéficiaire individuel (ex. un apprenant). Si ce bénéficiaire est mineur, l'accord
  // parental actif est toujours requis — jamais court-circuité, contrairement à
  // subscribeSelf (CLAUDE.md §6).
  async subscribeOrgSponsored(
    actorUserId: string,
    organizationId: string,
    beneficiaryUserId: string,
    dto: SponsorSubscriptionDto,
  ) {
    await this.orgAccess.assertCanManageBilling(organizationId, actorUserId);
    const beneficiary = await this.prisma.user.findUniqueOrThrow({
      where: { id: beneficiaryUserId },
    });

    await this.minorPolicy.assertActionAllowed(
      beneficiary,
      MinorGatedAction.SUBSCRIPTION_ORG_SPONSORED,
    );

    return this.createSubscription({
      plan: dto.plan,
      billingCycle: dto.billingCycle,
      countryCode: beneficiary.countryOfResidence ?? 'CM',
      beneficiaryUserId,
      originType: SubscriptionOriginType.ORGANIZATION,
      initiatingOrganizationId: organizationId,
    });
  }

  async listMine(userId: string) {
    return this.prisma.subscription.findMany({
      where: { beneficiaryUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAll(filters: ListSubscriptionsQueryDto) {
    return this.prisma.subscription.findMany({
      where: { status: filters.status, plan: filters.plan },
      orderBy: { createdAt: 'desc' },
      include: {
        beneficiaryUser: {
          select: { id: true, lsId: true, firstName: true, lastName: true },
        },
        beneficiaryOrganization: { select: { id: true, name: true } },
      },
    });
  }

  async getById(actorUserId: string, subscriptionId: string) {
    const subscription = await this.mustFind(subscriptionId);
    await this.assertCanAccess(actorUserId, subscription);
    return subscription;
  }

  async cancel(actorUserId: string, subscriptionId: string) {
    const subscription = await this.mustFind(subscriptionId);
    await this.assertCanAccess(actorUserId, subscription);
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      return subscription;
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.audit.record('SUBSCRIPTION_CANCELLED', actorUserId, {
      subscriptionId,
    });
    return updated;
  }

  // P1-1 — la garde vit ICI, dans le point de passage unique, et non dans
  // `subscribeSelf()`. `subscribeOrgSponsored()` crée lui aussi un abonnement
  // INDIVIDUEL rattaché à un bénéficiaire : ne garder que l'auto-souscription
  // laisserait un parrainage organisationnel contourner la règle.
  private async assertPlaceLibrePourFormuleIndividuelle(
    params: CreateSubscriptionParams,
  ): Promise<void> {
    if (!params.beneficiaryUserId) return;
    if (!estFormuleIndividuelle(params.plan)) return;

    const occupant = await this.prisma.subscription.findFirst({
      where: {
        beneficiaryUserId: params.beneficiaryUserId,
        plan: { in: [...INDIVIDUAL_PLANS] },
        status: { in: [...STATUTS_OCCUPANT_LA_PLACE] },
      },
      select: { id: true },
    });

    if (occupant) throw new ConflictException(DEJA_UN_ABONNEMENT_INDIVIDUEL);
  }

  // LA GARANTIE, ET POURQUOI ELLE EST SÉPARÉE DE LA GARDE
  //
  // La garde ci-dessus lit puis écrit : deux requêtes simultanées la franchissent
  // ensemble, chacune ne voyant rien. Seule la base tranche, par l'index unique
  // partiel `Subscription_beneficiaire_individuel_actif_key` (migration
  // 20260818090000). Le perdant de la course reçoit EXACTEMENT la même erreur
  // métier que s'il avait été refusé par la garde — jamais une 500, et rien qui
  // lui révèle qu'il a perdu une course.
  //
  // Mesuré : `subscriptions-unicite.integration.spec.ts` montre que deux appels
  // concurrents se sérialisent en pratique et que c'est la garde qui refuse le
  // second. L'index n'en est pas moins nécessaire — il couvre les écritures qui
  // ne passent pas par ce service, et c'est ce que le test structurel éprouve.
  private async ecrireAbonnement(
    params: CreateSubscriptionParams,
    amountMinor: number,
    currency: string,
  ) {
    try {
      return await this.prisma.subscription.create({
        data: {
          plan: params.plan,
          billingCycle: params.billingCycle,
          countryCode: params.countryCode,
          amountMinor,
          currency,
          beneficiaryUserId: params.beneficiaryUserId,
          beneficiaryOrganizationId: params.beneficiaryOrganizationId,
          originType: params.originType,
          initiatingOrganizationId: params.initiatingOrganizationId,
          parentRedirectRequested: params.parentRedirectRequested ?? false,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(DEJA_UN_ABONNEMENT_INDIVIDUEL);
      }
      throw error;
    }
  }

  private async createSubscription(params: CreateSubscriptionParams) {
    // Refus AVANT toute écriture : ni Subscription, ni Payment, ni appel à la
    // passerelle. C'est ce qui garantit qu'un doublon ne peut pas produire de
    // paiement, donc pas de confirmation, donc pas de commission.
    await this.assertPlaceLibrePourFormuleIndividuelle(params);

    const { amountMinor, currency } = this.pricing.resolve(
      params.plan,
      params.billingCycle,
      params.countryCode,
    );
    const providerName = this.config.get<string>(
      'PAYMENT_GATEWAY_PROVIDER',
      'simulated',
    );

    const subscription = await this.ecrireAbonnement(
      params,
      amountMinor,
      currency,
    );

    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amountMinor,
        currency,
        countryCode: params.countryCode,
        providerName,
      },
    });

    // Le montant n'est jamais confirmé à ce stade — seule l'initiation est faite ici,
    // l'activation attend le webhook du prestataire (voir PaymentsService).
    const initiation = await this.gateway.initiate({
      paymentId: payment.id,
      amountMinor,
      currency,
      countryCode: params.countryCode,
    });
    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerReference: initiation.providerReference },
    });

    await this.audit.record(
      'SUBSCRIPTION_CREATED',
      params.beneficiaryUserId ?? null,
      {
        subscriptionId: subscription.id,
        plan: params.plan,
        originType: params.originType,
      },
    );

    return {
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        amountMinor,
        currency,
      },
      payment: {
        id: updatedPayment.id,
        providerReference: updatedPayment.providerReference,
        instructions: initiation.instructions,
      },
    };
  }

  private async mustFind(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) throw new NotFoundException('Abonnement introuvable.');
    return subscription;
  }

  private async assertCanAccess(
    userId: string,
    subscription: {
      beneficiaryUserId: string | null;
      beneficiaryOrganizationId: string | null;
    },
  ) {
    if (subscription.beneficiaryUserId === userId) return;
    if (subscription.beneficiaryOrganizationId) {
      await this.orgAccess.assertCanManage(
        subscription.beneficiaryOrganizationId,
        userId,
      );
      return;
    }
    throw new ForbiddenException('Cet abonnement ne concerne pas ce compte.');
  }
}
