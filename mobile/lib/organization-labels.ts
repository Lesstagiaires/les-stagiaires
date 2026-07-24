import type { OpportunityStatus, OrganizationVerificationStatus } from './api';
import type { StatusTone } from './application-labels';

export const ORGANIZATION_VERIFICATION_LABELS: Record<OrganizationVerificationStatus, string> = {
  PENDING: 'Vérification en attente',
  VERIFIED: 'Vérifiée',
  REJECTED: 'Vérification refusée',
};

export const ORGANIZATION_VERIFICATION_TONE: Record<OrganizationVerificationStatus, StatusTone> = {
  PENDING: 'accent',
  VERIFIED: 'primary',
  REJECTED: 'error',
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  DRAFT: 'Brouillon',
  PENDING_REVIEW: 'En attente de vérification',
  ACTIVE: 'Publiée',
  PAUSED: 'En pause',
  FILLED: 'Pourvue',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
  REPORTED: 'Signalée',
  SUSPENDED: 'Suspendue',
  ARCHIVED: 'Archivée',
};

export const OPPORTUNITY_STATUS_TONE: Record<OpportunityStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'accent',
  ACTIVE: 'primary',
  PAUSED: 'accent',
  FILLED: 'primary',
  EXPIRED: 'neutral',
  CANCELLED: 'error',
  REPORTED: 'error',
  SUSPENDED: 'error',
  ARCHIVED: 'neutral',
};
