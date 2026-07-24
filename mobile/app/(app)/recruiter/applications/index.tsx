import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../../components/badge';
import { ChipSelect } from '../../../../components/chip-select';
import { PressableCard } from '../../../../components/card';
import { ErrorText } from '../../../../components/form';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Application, type ApplicationStatus } from '../../../../lib/api';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUS_TONE } from '../../../../lib/application-labels';
import { useAuth } from '../../../../lib/auth-context';

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '__all__', label: 'Toutes' },
  ...(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((status) => ({
    value: status,
    label: APPLICATION_STATUS_LABELS[status],
  })),
];

export default function ReceivedApplicationsScreen() {
  const router = useRouter();
  const { accessToken, logout } = useAuth();
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
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, [accessToken, logout, statusFilter]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Candidatures reçues</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect options={STATUS_FILTER_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
        </ScrollView>

        {applications === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : applications.length === 0 ? (
          <Text style={styles.emptyText}>Aucune candidature pour ce filtre.</Text>
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
                    label={APPLICATION_STATUS_LABELS[application.status]}
                    tone={APPLICATION_STATUS_TONE[application.status]}
                  />
                  <Text style={typography.caption}>{application.reference}</Text>
                </View>
                <Text style={styles.opportunityTitle} numberOfLines={1}>
                  {application.opportunity?.title ?? 'Candidature spontanée'}
                </Text>
                <Text style={typography.caption}>
                  Candidat : {application.candidate?.lsId ?? '—'}
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
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
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
