import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../../components/form';
import { colors, fonts, radius, spacing } from '../../../components/theme';
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
        <StatusBar style="light" />
        <View style={styles.centered}>
          <ErrorText>{t('recruiter.dashboard.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{t('recruiter.dashboard.eyebrow')}</Text>
        <Text style={styles.title}>{t('recruiter.dashboard.title')}</Text>

        {dashboard === null ? (
          error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.gold} style={styles.loader} />
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

// Esthétique "tableau des départs" (voir artifact de design system, section Écrans) : des
// chiffres qui comptent — jamais un graphique décoratif pour un tableau de bord dont le
// seul rôle est de répondre vite à "combien, sur quoi, avec quel résultat".
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
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.inkDeep,
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
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  title: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginTop: -spacing.xs,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  statCard: {
    width: '47%',
    gap: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statCardHighlight: {
    backgroundColor: 'rgba(255,194,77,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,194,77,0.4)',
  },
  statValue: {
    fontFamily: fonts.mono,
    fontSize: 26,
    fontWeight: '500',
    color: colors.gold,
    fontVariant: ['tabular-nums'],
  },
  statValueHighlight: {
    color: colors.gold,
  },
  statLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.65)',
  },
});
