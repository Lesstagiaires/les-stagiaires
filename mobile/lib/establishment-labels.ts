import type { InternshipCampaignStatus, InternshipReportStatus, LearnerStatus } from './api';
import type { StatusTone } from './application-labels';

export const LEARNER_STATUS_LABELS: Record<LearnerStatus, string> = {
  PENDING: 'Invitation en attente',
  ACTIVE: 'Rattaché',
  REVOKED: 'Révoqué',
};

export const LEARNER_STATUS_TONE: Record<LearnerStatus, StatusTone> = {
  PENDING: 'accent',
  ACTIVE: 'primary',
  REVOKED: 'error',
};

export const CAMPAIGN_STATUS_LABELS: Record<InternshipCampaignStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  CLOSED: 'Clôturée',
};

export const CAMPAIGN_STATUS_TONE: Record<InternshipCampaignStatus, StatusTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'primary',
  CLOSED: 'neutral',
};

export const REPORT_STATUS_LABELS: Record<InternshipReportStatus, string> = {
  SUBMITTED: 'Déposé',
  NEEDS_REVISION: 'Correction demandée',
  VALIDATED: 'Validé',
};

export const REPORT_STATUS_TONE: Record<InternshipReportStatus, StatusTone> = {
  SUBMITTED: 'accent',
  NEEDS_REVISION: 'error',
  VALIDATED: 'success',
};
