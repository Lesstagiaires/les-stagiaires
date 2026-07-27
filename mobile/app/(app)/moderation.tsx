import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ChipSelect } from '../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../components/form';
import { colors, spacing, typography } from '../../components/theme';
import { api, ApiError, type ModerationReport, type ReportStatus } from '../../lib/api';
import {
  MODERATION_STATUS_TONE,
  useModerationStatusLabels,
  useReportCategoryLabels,
} from '../../lib/report-labels';
import { useAuth } from '../../lib/auth-context';

type StatusFilter = ReportStatus | '__all__';

export default function ModerationScreen() {
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const moderationStatusLabels = useModerationStatusLabels();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusFilterOptions: { value: StatusFilter; label: string }[] = [
    { value: '__all__', label: t('moderation.filterAll') },
    ...(Object.keys(moderationStatusLabels) as ReportStatus[]).map((status) => ({
      value: status,
      label: moderationStatusLabels[status],
    })),
  ];

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const status = statusFilter === '__all__' ? undefined : statusFilter;
      setReports(await api.listAllReports(accessToken, status));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        setError(t('moderation.unavailable'));
        return;
      }
      setError(err instanceof ApiError ? err.message : t('moderation.loadError'));
    }
  }, [accessToken, logout, statusFilter, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('moderation.title')}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
          />
        </ScrollView>

        {reports === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : reports.length === 0 ? (
          <Text style={styles.emptyText}>{t('moderation.empty')}</Text>
        ) : (
          <View style={styles.list}>
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                accessToken={accessToken}
                report={report}
                onChanged={reload}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportCard({
  accessToken,
  report,
  onChanged,
}: {
  accessToken: string;
  report: ModerationReport;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const reportCategoryLabels = useReportCategoryLabels();
  const moderationStatusLabels = useModerationStatusLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busyStatus, setBusyStatus] = useState<ReportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reporterLabel = report.reporter.lsId ?? report.reporter.id;

  async function handleResolve(status: ReportStatus) {
    setError(null);
    setBusyStatus(status);
    try {
      await api.resolveReport(accessToken, report.id, {
        status,
        note: note.trim() || undefined,
      });
      setIsOpen(false);
      setNote('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('moderation.resolveError'));
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <Card style={styles.reportCard}>
      <View style={styles.reportHeader}>
        <Badge label={moderationStatusLabels[report.status]} tone={MODERATION_STATUS_TONE[report.status]} />
        <Text style={typography.caption}>{reportCategoryLabels[report.category]}</Text>
      </View>
      <Text style={typography.body}>{report.description}</Text>
      <Text style={typography.caption}>{t('moderation.reporterLabel', { lsId: reporterLabel })}</Text>
      {!!report.targetOpportunity && (
        <Text style={typography.caption}>
          {t('moderation.targetLabel', { title: report.targetOpportunity.title })}
        </Text>
      )}
      <Text style={typography.caption}>
        {new Date(report.createdAt).toLocaleString(i18n.language)}
      </Text>

      {!!report.resolvedAt && !!report.resolvedBy && (
        <Text style={typography.caption}>
          {t('moderation.resolvedByLabel', {
            lsId: report.resolvedBy.lsId ?? report.resolvedBy.id,
            date: new Date(report.resolvedAt).toLocaleString(i18n.language),
          })}
        </Text>
      )}
      {!!report.resolutionNote && (
        <Text style={typography.caption}>
          {t('moderation.resolutionNoteLabel', { note: report.resolutionNote })}
        </Text>
      )}

      {report.status !== 'CLOSED' &&
        (isOpen ? (
          <View style={styles.resolveForm}>
            <FormInput
              placeholder={t('moderation.notePlaceholder')}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
            <ErrorText>{error}</ErrorText>
            <View style={styles.resolveActions}>
              <View style={styles.resolveButton}>
                <SecondaryButton
                  title={t('moderation.markReviewed')}
                  onPress={() => handleResolve('REVIEWED')}
                  loading={busyStatus === 'REVIEWED'}
                  disabled={busyStatus !== null && busyStatus !== 'REVIEWED'}
                />
              </View>
              <View style={styles.resolveButton}>
                <PrimaryButton
                  title={t('moderation.close')}
                  onPress={() => handleResolve('CLOSED')}
                  loading={busyStatus === 'CLOSED'}
                  disabled={busyStatus !== null && busyStatus !== 'CLOSED'}
                />
              </View>
            </View>
            <Text style={styles.cancelText} onPress={() => setIsOpen(false)}>
              {t('common.cancel')}
            </Text>
          </View>
        ) : (
          <SecondaryButton title={t('moderation.resolveAction')} onPress={() => setIsOpen(true)} />
        ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  list: {
    gap: spacing.sm,
  },
  reportCard: {
    gap: spacing.xs,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  resolveForm: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  resolveActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  resolveButton: {
    flex: 1,
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
