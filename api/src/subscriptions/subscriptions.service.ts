import {
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
import { SubscriptionPricingService } from './subscription-pricing.service';

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

  private async createSubscription(params: CreateSubscriptionParams) {
    const { amountMinor, currency } = this.pricing.resolve(
      params.plan,
      params.billingCycle,
      params.countryCode,
    );
    const providerName = this.config.get<string>(
      'PAYMENT_GATEWAY_PROVIDER',
      'simulated',
    );

    const subscription = await this.prisma.subscription.create({
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
