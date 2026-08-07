import { useTranslation } from 'react-i18next';
import type { Tone } from '../components/badge';
import type {
  SubscriptionBillingCycle,
  SubscriptionPlan,
  SubscriptionStatus,
} from './api';

export function useSubscriptionStatusLabels(): Record<SubscriptionStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING_PAYMENT: t('labels.subscriptionStatus.PENDING_PAYMENT'),
    ACTIVE: t('labels.subscriptionStatus.ACTIVE'),
    PAYMENT_FAILED: t('labels.subscriptionStatus.PAYMENT_FAILED'),
    EXPIRED: t('labels.subscriptionStatus.EXPIRED'),
    CANCELLED: t('labels.subscriptionStatus.CANCELLED'),
  };
}

export const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  PENDING_PAYMENT: 'accent',
  ACTIVE: 'success',
  PAYMENT_FAILED: 'error',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

export function useSubscriptionPlanLabels(): Record<SubscriptionPlan, string> {
  const { t } = useTranslation();
  return {
    GRATUIT: t('labels.subscriptionPlan.GRATUIT'),
    CARRIERE_SECURISEE: t('labels.subscriptionPlan.CARRIERE_SECURISEE'),
    CARRIERE_PLUS: t('labels.subscriptionPlan.CARRIERE_PLUS'),
    BUSINESS: t('labels.subscriptionPlan.BUSINESS'),
    INSTITUTION: t('labels.subscriptionPlan.INSTITUTION'),
  };
}

export function useBillingCycleLabels(): Record<SubscriptionBillingCycle, string> {
  const { t } = useTranslation();
  return {
    ONE_TIME: t('labels.billingCycle.ONE_TIME'),
    QUARTERLY: t('labels.billingCycle.QUARTERLY'),
    ANNUAL: t('labels.billingCycle.ANNUAL'),
  };
}
