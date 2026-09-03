import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { SubscriptionBillingCycle } from '../../../generated/prisma/enums';

export class SubscribeOrganizationDto {
  @IsEnum(SubscriptionBillingCycle)
  billingCycle: SubscriptionBillingCycle;

  @IsOptional()
  @IsString()
  paymentMethodCode?: string;

  @IsOptional()
  @IsIn(['XAF', 'EUR', 'USD'])
  paymentCurrency?: string;
}
