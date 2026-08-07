import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../components/badge';
import { ChipSelect } from '../../../../components/chip-select';
import { PressableCard } from '../../../../components/card';
import { ErrorText } from '../../../../components/form';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Application, type ApplicationStatus } from '../../../../lib/api';
import { useApplicationStatusLabels, APPLICATION_STATUS_TONE } from '../../../../lib/application-labels';
import { useAuth } from '../../../../lib/auth-context';
import { EmptyState } from '../../../../components/empty-state';

export default function ReceivedApplicationsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const applicationStatusLabels = useApplicationStatusLabels();
  const statusFilterOptions: { value: string; label: string }[] = [
    { value: '__all__', label: t('recruiter.receivedApplications.allFilter') },
    ...(Object.keys(applicationStatusLabels) as ApplicationStatus[]).map((status) => ({
      value: status,
      label: applicationStatusLabels[status],
    })),
  ];
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const status = statusFilter === '__all__' ? undefined : (statusFilter as ApplicationStatus);
      setApplications(await api.listReceivedApplications(accessToken, { status }));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.receivedApplications.loadError'));
    }
  }, [accessToken, logout, statusFilter, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.layout.receivedApplications')}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect options={statusFilterOptions} value={statusFilter} onChange={setStatusFilter} />
        </ScrollView>

        {applications === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : applications.length === 0 ? (
          <EmptyState message={t('recruiter.receivedApplications.empty')} />
        ) : (
          <View style={styles.list}>
            {applications.map((application) => (
              <PressableCard
                key={application.id}
                style={styles.card}
                onPress={() => router.push(`/recruiter/applications/${application.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Badge
                    label={applicationStatusLabels[application.status]}
                    tone={APPLICATION_STATUS_TONE[application.status]}
                  />
                  <Text style={typography.caption}>{application.reference}</Text>
                </View>
                <Text style={styles.opportunityTitle} numberOfLines={1}>
                  {application.opportunity?.title ?? t('applications.list.spontaneous')}
                </Text>
                <Text style={typography.caption}>
                  {t('recruiter.receivedApplications.candidateLabel', {
                    lsId: application.candidate?.lsId ?? '—',
                  })}
                </Text>
              </PressableCard>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
  list: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  opportunityTitle: {
    ...typography.h3,
    marginTop: spacing.xs,
  },
});
