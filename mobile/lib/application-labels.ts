import { useTranslation } from 'react-i18next';
import type { ApplicationStatus } from './api';

export function useApplicationStatusLabels(): Record<ApplicationStatus, string> {
  const { t } = useTranslation();
  return {
    SUBMITTED: t('labels.applicationStatus.SUBMITTED'),
    UNDER_REVIEW: t('labels.applicationStatus.UNDER_REVIEW'),
    ADDITIONAL_DOCUMENT_REQUESTED: t('labels.applicationStatus.ADDITIONAL_DOCUMENT_REQUESTED'),
    INTERVIEW_PROPOSED: t('labels.applicationStatus.INTERVIEW_PROPOSED'),
    INTERVIEW_CONFIRMED: t('labels.applicationStatus.INTERVIEW_CONFIRMED'),
    ADMISSION_LETTER_SENT: t('labels.applicationStatus.ADMISSION_LETTER_SENT'),
    ACCEPTED: t('labels.applicationStatus.ACCEPTED'),
    AWAITING_TRAVEL_CONSENT: t('labels.applicationStatus.AWAITING_TRAVEL_CONSENT'),
    REJECTED: t('labels.applicationStatus.REJECTED'),
    WITHDRAWN: t('labels.applicationStatus.WITHDRAWN'),
    COMPLETED: t('labels.applicationStatus.COMPLETED'),
  };
}

export type StatusTone = 'primary' | 'accent' | 'neutral' | 'success' | 'error';

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  SUBMITTED: 'neutral',
  UNDER_REVIEW: 'neutral',
  ADDITIONAL_DOCUMENT_REQUESTED: 'accent',
  INTERVIEW_PROPOSED: 'accent',
  INTERVIEW_CONFIRMED: 'accent',
  ADMISSION_LETTER_SENT: 'accent',
  ACCEPTED: 'success',
  AWAITING_TRAVEL_CONSENT: 'accent',
  REJECTED: 'error',
  WITHDRAWN: 'error',
  COMPLETED: 'success',
};

export function useArtifactKindLabels(): Record<'ADMISSION_LETTER' | 'CONVENTION' | 'ATTESTATION', string> {
  const { t } = useTranslation();
  return {
    ADMISSION_LETTER: t('labels.artifactKind.ADMISSION_LETTER'),
    CONVENTION: t('labels.artifactKind.CONVENTION'),
    ATTESTATION: t('labels.artifactKind.ATTESTATION'),
  };
}
