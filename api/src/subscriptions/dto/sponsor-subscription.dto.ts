import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { SubscriptionBillingCycle } from '../../../generated/prisma/enums';
import { INDIVIDUAL_PLANS, type IndividualPlan } from '../individual-plans';

export class SponsorSubscriptionDto {
  @IsIn(INDIVIDUAL_PLANS)
  plan: IndividualPlan;

  @IsEnum(SubscriptionBillingCycle)
  billingCycle: SubscriptionBillingCycle;

  @IsOptional()
  @IsString()
  paymentMethodCode?: string;

  @IsOptional()
  @IsIn(['XAF', 'EUR', 'USD'])
  paymentCurrency?: string;
}
