import { useTranslation } from 'react-i18next';
import type { InternshipCampaignStatus, InternshipReportStatus, LearnerStatus } from './api';
import type { StatusTone } from './application-labels';

export function useLearnerStatusLabels(): Record<LearnerStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.learnerStatus.PENDING'),
    ACTIVE: t('labels.learnerStatus.ACTIVE'),
    REVOKED: t('labels.learnerStatus.REVOKED'),
  };
}

export const LEARNER_STATUS_TONE: Record<LearnerStatus, StatusTone> = {
  PENDING: 'accent',
  ACTIVE: 'primary',
  REVOKED: 'error',
};

export function useCampaignStatusLabels(): Record<InternshipCampaignStatus, string> {
  const { t } = useTranslation();
  return {
    DRAFT: t('labels.campaignStatus.DRAFT'),
    ACTIVE: t('labels.campaignStatus.ACTIVE'),
    CLOSED: t('labels.campaignStatus.CLOSED'),
  };
}

export const CAMPAIGN_STATUS_TONE: Record<InternshipCampaignStatus, StatusTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'primary',
  CLOSED: 'neutral',
};

export function useReportStatusLabels(): Record<InternshipReportStatus, string> {
  const { t } = useTranslation();
  return {
    SUBMITTED: t('labels.reportStatus.SUBMITTED'),
    NEEDS_REVISION: t('labels.reportStatus.NEEDS_REVISION'),
    VALIDATED: t('labels.reportStatus.VALIDATED'),
  };
}

export const REPORT_STATUS_TONE: Record<InternshipReportStatus, StatusTone> = {
  SUBMITTED: 'accent',
  NEEDS_REVISION: 'error',
  VALIDATED: 'success',
};
