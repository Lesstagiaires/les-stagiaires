import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ErrorText } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type LearnerApplicationSummary } from '../../../lib/api';
import { useApplicationStatusLabels, APPLICATION_STATUS_TONE } from '../../../lib/application-labels';
import { useAuth } from '../../../lib/auth-context';

export default function LearnerApplicationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const { t } = useTranslation();
  const applicationStatusLabels = useApplicationStatusLabels();
  const [applications, setApplications] = useState<LearnerApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setApplications(await api.listLearnerApplications(accessToken, id));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.learnerApplications.loadError'));
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{t('recruiter.learnerApplications.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.learnerApplications.title')}</Text>
        <Text style={typography.caption}>{t('recruiter.learnerApplications.subtitle')}</Text>

        {applications === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : applications.length === 0 ? (
          <Text style={styles.emptyText}>{t('recruiter.learnerApplications.empty')}</Text>
        ) : (
          <View style={styles.list}>
            {applications.map((application) => (
              <Card key={application.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={typography.bodyBold}>{application.candidate.lsId ?? application.candidateId}</Text>
                  <Badge
                    label={applicationStatusLabels[application.status]}
                    tone={APPLICATION_STATUS_TONE[application.status]}
                  />
                </View>
                <Text style={typography.body}>
                  {application.opportunity?.title ?? t('applications.list.spontaneous')}
                </Text>
                <Text style={typography.caption}>{application.organization.name}</Text>
                {application.establishmentParticipationRequested && (
                  <Text style={typography.caption}>
                    {application.establishmentSignedAt
                      ? t('recruiter.learnerApplications.signedBy', {
                          name: application.establishmentSignedName,
                        })
                      : t('recruiter.learnerApplications.participationRequested')}
                  </Text>
                )}
              </Card>
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
