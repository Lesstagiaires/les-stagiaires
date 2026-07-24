import type {
  NeedRequestStatus,
  NeedRequestType,
  OpportunityStatus,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationVerificationStatus,
} from './api';
import type { StatusTone } from './application-labels';

export const ORGANIZATION_VERIFICATION_LABELS: Record<OrganizationVerificationStatus, string> = {
  PENDING: 'Vérification en attente',
  VERIFIED: 'Vérifiée',
  REJECTED: 'Vérification refusée',
};

export const ORGANIZATION_VERIFICATION_TONE: Record<OrganizationVerificationStatus, StatusTone> = {
  PENDING: 'accent',
  VERIFIED: 'success',
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
  FILLED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'error',
  REPORTED: 'error',
  SUSPENDED: 'error',
  ARCHIVED: 'neutral',
};

export const MEMBER_ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  ADMIN: 'Administrateur',
  RECRUITER: 'Recruteur',
  VIEWER: 'Lecture seule',
};

export const MEMBER_ROLE_OPTIONS: { value: OrganizationMemberRole; label: string }[] =
  Object.entries(MEMBER_ROLE_LABELS).map(([value, label]) => ({
    value: value as OrganizationMemberRole,
    label,
  }));

export const MEMBER_STATUS_LABELS: Record<OrganizationMemberStatus, string> = {
  PENDING: 'Invitation en attente',
  ACTIVE: 'Actif',
  REVOKED: 'Révoqué',
};

export const MEMBER_STATUS_TONE: Record<OrganizationMemberStatus, StatusTone> = {
  PENDING: 'accent',
  ACTIVE: 'primary',
  REVOKED: 'error',
};

export const NEED_REQUEST_TYPE_LABELS: Record<NeedRequestType, string> = {
  SEASONAL: 'Saisonnier',
  VOLUNTEER: 'Bénévolat',
  TEMPORARY: 'Temporaire',
};

export const NEED_REQUEST_TYPE_OPTIONS: { value: NeedRequestType; label: string }[] =
  Object.entries(NEED_REQUEST_TYPE_LABELS).map(([value, label]) => ({
    value: value as NeedRequestType,
    label,
  }));

export const NEED_REQUEST_STATUS_LABELS: Record<NeedRequestStatus, string> = {
  PENDING: 'En attente',
  APPROVED: 'Approuvé',
  REJECTED: 'Refusé',
};

export const NEED_REQUEST_STATUS_TONE: Record<NeedRequestStatus, StatusTone> = {
  PENDING: 'accent',
  APPROVED: 'success',
  REJECTED: 'error',
};
