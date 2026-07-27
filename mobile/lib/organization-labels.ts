import { useTranslation } from 'react-i18next';
import type {
  NeedRequestStatus,
  NeedRequestType,
  OpportunityStatus,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationVerificationStatus,
} from './api';
import type { StatusTone } from './application-labels';

export function useOrganizationVerificationLabels(): Record<OrganizationVerificationStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.organizationVerification.PENDING'),
    VERIFIED: t('labels.organizationVerification.VERIFIED'),
    REJECTED: t('labels.organizationVerification.REJECTED'),
  };
}

export const ORGANIZATION_VERIFICATION_TONE: Record<OrganizationVerificationStatus, StatusTone> = {
  PENDING: 'accent',
  VERIFIED: 'success',
  REJECTED: 'error',
};

export function useOpportunityStatusLabels(): Record<OpportunityStatus, string> {
  const { t } = useTranslation();
  return {
    DRAFT: t('labels.opportunityStatus.DRAFT'),
    PENDING_REVIEW: t('labels.opportunityStatus.PENDING_REVIEW'),
    ACTIVE: t('labels.opportunityStatus.ACTIVE'),
    PAUSED: t('labels.opportunityStatus.PAUSED'),
    FILLED: t('labels.opportunityStatus.FILLED'),
    EXPIRED: t('labels.opportunityStatus.EXPIRED'),
    CANCELLED: t('labels.opportunityStatus.CANCELLED'),
    REPORTED: t('labels.opportunityStatus.REPORTED'),
    SUSPENDED: t('labels.opportunityStatus.SUSPENDED'),
    ARCHIVED: t('labels.opportunityStatus.ARCHIVED'),
  };
}

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

export function useMemberRoleLabels(): Record<OrganizationMemberRole, string> {
  const { t } = useTranslation();
  return {
    ADMIN: t('labels.memberRole.ADMIN'),
    RECRUITER: t('labels.memberRole.RECRUITER'),
    VIEWER: t('labels.memberRole.VIEWER'),
  };
}

export function useMemberRoleOptions(): { value: OrganizationMemberRole; label: string }[] {
  const labels = useMemberRoleLabels();
  return (Object.entries(labels) as [OrganizationMemberRole, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

export function useMemberStatusLabels(): Record<OrganizationMemberStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.memberStatus.PENDING'),
    ACTIVE: t('labels.memberStatus.ACTIVE'),
    REVOKED: t('labels.memberStatus.REVOKED'),
  };
}

export const MEMBER_STATUS_TONE: Record<OrganizationMemberStatus, StatusTone> = {
  PENDING: 'accent',
  ACTIVE: 'primary',
  REVOKED: 'error',
};

export function useNeedRequestTypeLabels(): Record<NeedRequestType, string> {
  const { t } = useTranslation();
  return {
    SEASONAL: t('labels.needRequestType.SEASONAL'),
    VOLUNTEER: t('labels.needRequestType.VOLUNTEER'),
    TEMPORARY: t('labels.needRequestType.TEMPORARY'),
  };
}

export function useNeedRequestTypeOptions(): { value: NeedRequestType; label: string }[] {
  const labels = useNeedRequestTypeLabels();
  return (Object.entries(labels) as [NeedRequestType, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

export function useNeedRequestStatusLabels(): Record<NeedRequestStatus, string> {
  const { t } = useTranslation();
  return {
    PENDING: t('labels.needRequestStatus.PENDING'),
    APPROVED: t('labels.needRequestStatus.APPROVED'),
    REJECTED: t('labels.needRequestStatus.REJECTED'),
  };
}

export const NEED_REQUEST_STATUS_TONE: Record<NeedRequestStatus, StatusTone> = {
  PENDING: 'accent',
  APPROVED: 'success',
  REJECTED: 'error',
};
