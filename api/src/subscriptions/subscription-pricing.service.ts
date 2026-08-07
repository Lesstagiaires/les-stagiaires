import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SubscriptionBillingCycle,
  SubscriptionPlan,
} from '../../generated/prisma/enums';

export interface ResolvedPrice {
  amountMinor: number;
  currency: string;
}

// Tarifs des formules individuelles ARRÊTÉS par le promoteur le 2026-07-31 :
// Carrière Sécurisée 2 000 FCFA/an, Carrière Plus 5 000 FCFA/an. Ce ne sont plus des
// valeurs d'attente. Ils restent surchargeables par pays via SUBSCRIPTION_PRICING_JSON
// — l'expansion hors zone franc CFA passera par là, sans toucher au code.
//
// Montants en unité mineure, convention maison : 100 unités = 1 FCFA. Le point
// architectural reste inchangé — le montant est TOUJOURS résolu côté serveur, jamais
// fourni par le client (CLAUDE.md §6).
//
// BUSINESS et INSTITUTION conservent une valeur d'attente : aucun tarif n'a été
// arbitré pour elles.
const DEFAULT_PRICING: Record<string, ResolvedPrice> = {
  'CARRIERE_SECURISEE:ANNUAL': { amountMinor: 200000, currency: 'XAF' },
  'CARRIERE_PLUS:ANNUAL': { amountMinor: 500000, currency: 'XAF' },
  'BUSINESS:ANNUAL': { amountMinor: 30000000, currency: 'XAF' },
  'INSTITUTION:ANNUAL': { amountMinor: 30000000, currency: 'XAF' },
};

@Injectable()
export class SubscriptionPricingService {
  constructor(private readonly config: ConfigService) {}

  resolve(
    plan: SubscriptionPlan,
    billingCycle: SubscriptionBillingCycle,
    countryCode: string,
  ): ResolvedPrice {
    const key = `${plan}:${billingCycle}`;
    const overrides = this.parseOverrides();
    const price =
      overrides[`${key}:${countryCode}`] ??
      overrides[key] ??
      DEFAULT_PRICING[key];
    if (!price) {
      throw new BadRequestException(
        `Aucun tarif configuré pour le plan ${plan} en cycle ${billingCycle}.`,
      );
    }
    return price;
  }

  private parseOverrides(): Record<string, ResolvedPrice> {
    const raw = this.config.get<string>('SUBSCRIPTION_PRICING_JSON');
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, ResolvedPrice>;
    } catch {
      return {};
    }
  }
}
