import { useTranslation } from 'react-i18next';
import type { OpportunityType, WorkMode } from './api';

export function useOpportunityTypeLabels(): Record<OpportunityType, string> {
  const { t } = useTranslation();
  return {
    ACADEMIC_INTERNSHIP: t('labels.opportunityType.ACADEMIC_INTERNSHIP'),
    PROFESSIONAL_INTERNSHIP: t('labels.opportunityType.PROFESSIONAL_INTERNSHIP'),
    SEASONAL: t('labels.opportunityType.SEASONAL'),
    WORK_STUDY: t('labels.opportunityType.WORK_STUDY'),
    VOLUNTEER: t('labels.opportunityType.VOLUNTEER'),
    TEMPORARY: t('labels.opportunityType.TEMPORARY'),
  };
}

export function useWorkModeLabels(): Record<WorkMode, string> {
  const { t } = useTranslation();
  return {
    ON_SITE: t('labels.workMode.ON_SITE'),
    REMOTE: t('labels.workMode.REMOTE'),
    HYBRID: t('labels.workMode.HYBRID'),
  };
}

export function useOpportunityTypeOptions(): { value: OpportunityType; label: string }[] {
  const labels = useOpportunityTypeLabels();
  return (Object.entries(labels) as [OpportunityType, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}

export function useWorkModeOptions(): { value: WorkMode; label: string }[] {
  const labels = useWorkModeLabels();
  return (Object.entries(labels) as [WorkMode, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}
