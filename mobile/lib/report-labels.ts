import { useTranslation } from 'react-i18next';
import type { ReportCategory, ReportStatus } from './api';
import type { StatusTone } from './application-labels';

export function useReportCategoryLabels(): Record<ReportCategory, string> {
  const { t } = useTranslation();
  return {
    HARASSMENT: t('labels.reportCategory.HARASSMENT'),
    ABUSE: t('labels.reportCategory.ABUSE'),
    DANGER: t('labels.reportCategory.DANGER'),
    FRAUD: t('labels.reportCategory.FRAUD'),
    OTHER: t('labels.reportCategory.OTHER'),
  };
}

// Nommé "moderationStatus" (et non "reportStatus") pour ne pas entrer en collision avec
// labels.reportStatus, qui désigne le statut des rapports de stage (InternshipReportStatus,
// establishment-labels.ts) — un concept sans rapport avec les signalements de modération.
export function useModerationStatusLabels(): Record<ReportStatus, string> {
  const { t } = useTranslation();
  return {
    OPEN: t('labels.moderationStatus.OPEN'),
    REVIEWED: t('labels.moderationStatus.REVIEWED'),
    CLOSED: t('labels.moderationStatus.CLOSED'),
  };
}

export const MODERATION_STATUS_TONE: Record<ReportStatus, StatusTone> = {
  OPEN: 'accent',
  REVIEWED: 'primary',
  CLOSED: 'success',
};
