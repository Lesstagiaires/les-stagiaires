import { useTranslation } from 'react-i18next';
import type {
  PartnershipRequestOrgType,
  PartnershipRequestReason,
  PartnershipRequestStatus,
} from './api';
import type { StatusTone } from './application-labels';

export function usePartnershipReasonLabels(): Record<PartnershipRequestReason, string> {
  const { t } = useTranslation();
  return {
    BECOME_PARTNER: t('labels.partnershipReason.BECOME_PARTNER'),
    PUBLISH_OPPORTUNITIES: t('labels.partnershipReason.PUBLISH_OPPORTUNITIES'),
    RECRUITMENT_CAMPAIGN: t('labels.partnershipReason.RECRUITMENT_CAMPAIGN'),
    MASS_RECRUITMENT: t('labels.partnershipReason.MASS_RECRUITMENT'),
    PARTNERSHIP_AGREEMENT: t('labels.partnershipReason.PARTNERSHIP_AGREEMENT'),
    PLATFORM_DEMO: t('labels.partnershipReason.PLATFORM_DEMO'),
    TRAINING_SUPPORT: t('labels.partnershipReason.TRAINING_SUPPORT'),
    COMMERCIAL_INFO: t('labels.partnershipReason.COMMERCIAL_INFO'),
    TECHNICAL_SUPPORT: t('labels.partnershipReason.TECHNICAL_SUPPORT'),
    OTHER: t('labels.partnershipReason.OTHER'),
  };
}

export function usePartnershipReasonOptions(): { value: PartnershipRequestReason; label: string }[] {
  const labels = usePartnershipReasonLabels();
  return (Object.entries(labels) as [PartnershipRequestReason, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

export function usePartnershipOrgTypeLabels(): Record<PartnershipRequestOrgType, string> {
  const { t } = useTranslation();
  return {
    COMPANY: t('labels.partnershipOrgType.COMPANY'),
    NGO: t('labels.partnershipOrgType.NGO'),
    PUBLIC_ADMINISTRATION: t('labels.partnershipOrgType.PUBLIC_ADMINISTRATION'),
    INTERNATIONAL_ORGANIZATION: t('labels.partnershipOrgType.INTERNATIONAL_ORGANIZATION'),
    UNIVERSITY: t('labels.partnershipOrgType.UNIVERSITY'),
    SCHOOL: t('labels.partnershipOrgType.SCHOOL'),
    TRAINING_CENTER: t('labels.partnershipOrgType.TRAINING_CENTER'),
    CONSULTING_FIRM: t('labels.partnershipOrgType.CONSULTING_FIRM'),
    STARTUP: t('labels.partnershipOrgType.STARTUP'),
    OTHER: t('labels.partnershipOrgType.OTHER'),
  };
}

export function usePartnershipOrgTypeOptions(): { value: PartnershipRequestOrgType; label: string }[] {
  const labels = usePartnershipOrgTypeLabels();
  return (Object.entries(labels) as [PartnershipRequestOrgType, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

export function usePartnershipStatusLabels(): Record<PartnershipRequestStatus, string> {
  const { t } = useTranslation();
  return {
    NEW: t('labels.partnershipStatus.NEW'),
    IN_PROGRESS: t('labels.partnershipStatus.IN_PROGRESS'),
    PROCESSED: t('labels.partnershipStatus.PROCESSED'),
    CLOSED: t('labels.partnershipStatus.CLOSED'),
  };
}

export const PARTNERSHIP_STATUS_TONE: Record<PartnershipRequestStatus, StatusTone> = {
  NEW: 'accent',
  IN_PROGRESS: 'primary',
  PROCESSED: 'success',
  CLOSED: 'neutral',
};
