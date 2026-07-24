import type { OpportunityType, WorkMode } from './api';

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  ACADEMIC_INTERNSHIP: 'Stage académique',
  PROFESSIONAL_INTERNSHIP: 'Stage professionnel',
  SEASONAL: 'Saisonnier',
  WORK_STUDY: 'Alternance',
  VOLUNTEER: 'Bénévolat',
  TEMPORARY: 'Temporaire',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  ON_SITE: 'Présentiel',
  REMOTE: 'Télétravail',
  HYBRID: 'Hybride',
};

export const OPPORTUNITY_TYPE_OPTIONS: { value: OpportunityType; label: string }[] =
  Object.entries(OPPORTUNITY_TYPE_LABELS).map(([value, label]) => ({
    value: value as OpportunityType,
    label,
  }));
