import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { SubscriptionBillingCycle } from '../../../generated/prisma/enums';
import { INDIVIDUAL_PLANS, type IndividualPlan } from '../individual-plans';

export class SubscribeSelfDto {
  // Depuis le renommage du 2026-07-31 il existe deux formules individuelles : le
  // client doit donc dire laquelle. `IsIn` plutôt que `IsEnum` à dessein — il ferme
  // la porte à BUSINESS et INSTITUTION, qui se déduisent du type d'organisation et ne
  // doivent jamais pouvoir être réclamées depuis un appareil.
  @IsIn(INDIVIDUAL_PLANS)
  plan: IndividualPlan;

  @IsEnum(SubscriptionBillingCycle)
  billingCycle: SubscriptionBillingCycle;

  // Un mineur en auto-souscription peut demander la redirection vers son parent/tuteur —
  // purement informatif, ne bloque jamais l'activation (CLAUDE.md §6).
  @IsOptional()
  @IsBoolean()
  parentRedirectRequested?: boolean;

  @IsOptional()
  @IsString()
  paymentMethodCode?: string;

  @IsOptional()
  @IsIn(['XAF', 'EUR', 'USD'])
  paymentCurrency?: string;
}
