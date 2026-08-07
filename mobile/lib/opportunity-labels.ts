import { useTranslation } from 'react-i18next';
import type {
  MatchReason,
  OpportunityType,
  QualityCheck,
  QualityLevel,
  WorkMode,
} from './api';

// POURQUOI une offre est proposée au candidat.
//
// Des motifs GÉNÉRIQUES, volontairement : « votre lieu » et non « Douala »,
// « votre niveau » et non « Bac+2 ». Le profil est une donnée Confidentielle
// (CLAUDE.md §1) — il entre dans le classement, il n'en ressort pas. Un motif
// qui citerait le contenu du profil le réapprendrait à qui lit l'écran
// par-dessus l'épaule.
export function useMatchReasonLabels(): Record<MatchReason, string> {
  const { t } = useTranslation();
  return {
    SKILLS: t('labels.matchReason.SKILLS'),
    OCCUPATION: t('labels.matchReason.OCCUPATION'),
    LOCATION: t('labels.matchReason.LOCATION'),
    EDUCATION: t('labels.matchReason.EDUCATION'),
    AVAILABILITY: t('labels.matchReason.AVAILABILITY'),
  };
}

// Ce que le diagnostic examine, côté entreprise.
export function useQualityCheckLabels(): Record<QualityCheck, string> {
  const { t } = useTranslation();
  return {
    SKILLS_DECLARED: t('labels.qualityCheck.SKILLS_DECLARED'),
    OCCUPATION_LINKED: t('labels.qualityCheck.OCCUPATION_LINKED'),
    DESCRIPTION_SUBSTANTIAL: t('labels.qualityCheck.DESCRIPTION_SUBSTANTIAL'),
    TITLE_INFORMATIVE: t('labels.qualityCheck.TITLE_INFORMATIVE'),
    START_DATE_SET: t('labels.qualityCheck.START_DATE_SET'),
    STILL_FRESH: t('labels.qualityCheck.STILL_FRESH'),
    EDUCATION_STATED: t('labels.qualityCheck.EDUCATION_STATED'),
    LOCATION_USABLE: t('labels.qualityCheck.LOCATION_USABLE'),
  };
}

// Le conseil attaché à un point à corriger. Une clef par point : le serveur
// n'envoie qu'un code, la phrase se décide ici, dans la langue du lecteur.
export function useQualityAdviceLabels(): Record<QualityCheck, string> {
  const { t } = useTranslation();
  return {
    SKILLS_DECLARED: t('labels.qualityAdvice.SKILLS_DECLARED'),
    OCCUPATION_LINKED: t('labels.qualityAdvice.OCCUPATION_LINKED'),
    DESCRIPTION_SUBSTANTIAL: t('labels.qualityAdvice.DESCRIPTION_SUBSTANTIAL'),
    TITLE_INFORMATIVE: t('labels.qualityAdvice.TITLE_INFORMATIVE'),
    START_DATE_SET: t('labels.qualityAdvice.START_DATE_SET'),
    STILL_FRESH: t('labels.qualityAdvice.STILL_FRESH'),
    EDUCATION_STATED: t('labels.qualityAdvice.EDUCATION_STATED'),
    LOCATION_USABLE: t('labels.qualityAdvice.LOCATION_USABLE'),
  };
}

export function useQualityLevelLabels(): Record<QualityLevel, string> {
  const { t } = useTranslation();
  return {
    INCOMPLETE: t('labels.qualityLevel.INCOMPLETE'),
    PERFECTIBLE: t('labels.qualityLevel.PERFECTIBLE'),
    COMPLETE: t('labels.qualityLevel.COMPLETE'),
  };
}

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
