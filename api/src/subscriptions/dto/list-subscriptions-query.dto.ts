import { IsEnum, IsOptional } from 'class-validator';
import {
  SubscriptionPlan,
  SubscriptionStatus,
} from '../../../generated/prisma/enums';

export class ListSubscriptionsQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan;
}
