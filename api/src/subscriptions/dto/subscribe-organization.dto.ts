import { IsEnum } from 'class-validator';
import { SubscriptionBillingCycle } from '../../../generated/prisma/enums';

export class SubscribeOrganizationDto {
  @IsEnum(SubscriptionBillingCycle)
  billingCycle: SubscriptionBillingCycle;
}
