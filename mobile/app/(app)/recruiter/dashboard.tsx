import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../../../components/card';
import { ErrorText } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type EstablishmentDashboard } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

export default function DashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const { t } = useTranslation();
  const [dashboard, setDashboard] = useState<EstablishmentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setDashboard(await api.getEstablishmentDashboard(accessToken, id));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.dashboard.loadError'));
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
          <ErrorText>{t('recruiter.dashboard.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.dashboard.title')}</Text>

        {dashboard === null ? (
          error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.grid}>
            <StatCard label={t('recruiter.dashboard.totalLearners')} value={dashboard.totalLearners} />
            <StatCard label={t('recruiter.dashboard.verifiedLearners')} value={dashboard.verifiedLearners} />
            <StatCard label={t('recruiter.dashboard.totalApplications')} value={dashboard.totalApplications} />
            <StatCard
              label={t('recruiter.dashboard.learnersWithInternship')}
              value={dashboard.learnersWithInternship}
            />
            <StatCard
              label={t('recruiter.dashboard.completedInternships')}
              value={dashboard.completedInternships}
            />
            <StatCard
              label={t('recruiter.dashboard.insertionRate')}
              value={`${dashboard.insertionRate}%`}
              highlight
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <Card style={styles.statCard}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
      <Text style={typography.caption}>{label}</Text>
    </Card>
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
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    width: '47%',
    gap: spacing.xs,
  },
  statValue: {
    ...typography.h1,
    color: colors.primary,
  },
  statValueHighlight: {
    color: colors.accentDark,
  },
});
