import { useTranslation } from 'react-i18next';
import type { Tone } from '../components/badge';
import type {
  AmbassadorStatus,
  CommissionNature,
  CommissionStatus,
  PayoutRequestStatus,
} from './api';

export function useAmbassadorStatusLabels(): Record<AmbassadorStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.ambassadorStatus.PENDING'),
    ACTIVE: t('labels.ambassadorStatus.ACTIVE'),
    SUSPENDED: t('labels.ambassadorStatus.SUSPENDED'),
    TERMINATED: t('labels.ambassadorStatus.TERMINATED'),
  };
}

export const AMBASSADOR_STATUS_TONE: Record<AmbassadorStatus, Tone> = {
  PENDING: 'accent',
  ACTIVE: 'success',
  SUSPENDED: 'error',
  TERMINATED: 'neutral',
};

export function useCommissionStatusLabels(): Record<CommissionStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.commissionStatus.PENDING'),
    APPROVED: t('labels.commissionStatus.APPROVED'),
    PAYABLE: t('labels.commissionStatus.PAYABLE'),
    PAID: t('labels.commissionStatus.PAID'),
    CANCELLED: t('labels.commissionStatus.CANCELLED'),
    REVERSED: t('labels.commissionStatus.REVERSED'),
    DISPUTED: t('labels.commissionStatus.DISPUTED'),
    BLOCKED: t('labels.commissionStatus.BLOCKED'),
  };
}

export const COMMISSION_STATUS_TONE: Record<CommissionStatus, Tone> = {
  PENDING: 'accent',
  APPROVED: 'accent',
  PAYABLE: 'success',
  PAID: 'success',
  CANCELLED: 'neutral',
  REVERSED: 'error',
  DISPUTED: 'error',
  BLOCKED: 'error',
};

export function useCommissionNatureLabels(): Record<CommissionNature, string> {
  const { t } = useTranslation();
  return {
    ACQUISITION: t('labels.commissionNature.ACQUISITION'),
    NEW_SERVICE: t('labels.commissionNature.NEW_SERVICE'),
    RENEWAL: t('labels.commissionNature.RENEWAL'),
    BONUS: t('labels.commissionNature.BONUS'),
  };
}

export function usePayoutStatusLabels(): Record<PayoutRequestStatus, string> {
  const { t } = useTranslation();
  return {
    REQUESTED: t('labels.payoutStatus.REQUESTED'),
    VALIDATED: t('labels.payoutStatus.VALIDATED'),
    EXECUTED: t('labels.payoutStatus.EXECUTED'),
    REJECTED: t('labels.payoutStatus.REJECTED'),
    CANCELLED: t('labels.payoutStatus.CANCELLED'),
  };
}

export const PAYOUT_STATUS_TONE: Record<PayoutRequestStatus, Tone> = {
  REQUESTED: 'accent',
  VALIDATED: 'accent',
  EXECUTED: 'success',
  REJECTED: 'error',
  CANCELLED: 'neutral',
};

// Nombre de jours entiers restants avant l'échéance d'un rattachement, jamais négatif.
//
// Sert à colorer l'urgence dans le portefeuille. Le calcul reste PUREMENT indicatif :
// l'échéance qui fait foi est `expiresAt`, calculée par le serveur, et seul un achat
// confirmé la repousse. Le client ne la recalcule jamais lui-même.
export function daysUntil(isoDate: string, now = new Date()): number {
  const target = new Date(isoDate).getTime();
  const diff = target - now.getTime();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

// Trois paliers d'urgence, alignés sur les alertes serveur (9 et 11 mois sur une
// fenêtre de douze) : plus de trois mois, entre un et trois mois, moins d'un mois.
export function portfolioUrgencyTone(daysLeft: number): Tone {
  if (daysLeft <= 31) return 'error';
  if (daysLeft <= 93) return 'accent';
  return 'success';
}
