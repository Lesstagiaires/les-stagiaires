import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { PressableCard } from '../../../components/card';
import { ErrorText } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type Application } from '../../../lib/api';
import { useApplicationStatusLabels, APPLICATION_STATUS_TONE } from '../../../lib/application-labels';
import { useAuth } from '../../../lib/auth-context';

export default function ApplicationsListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const applicationStatusLabels = useApplicationStatusLabels();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;
      api
        .listMyApplications(accessToken)
        .then(setApplications)
        .catch((err) => {
          if (err instanceof ApiError && err.statusCode === 401) {
            void logout();
            return;
          }
          setError(err instanceof ApiError ? err.message : t('applications.list.loadError'));
        })
        .finally(() => setIsLoading(false));
    }, [accessToken, logout, t]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('applications.list.title')}</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : applications.length === 0 ? (
          <Text style={styles.emptyText}>{t('applications.list.empty')}</Text>
        ) : (
          applications.map((application) => (
            <PressableCard
              key={application.id}
              style={styles.card}
              onPress={() => router.push(`/applications/${application.id}`)}
            >
              <View style={styles.cardHeader}>
                <Badge
                  label={applicationStatusLabels[application.status]}
                  tone={APPLICATION_STATUS_TONE[application.status]}
                />
                <Text style={styles.reference}>{application.reference}</Text>
              </View>
              <Text style={styles.opportunityTitle} numberOfLines={1}>
                {application.opportunity?.title ?? t('applications.list.spontaneous')}
              </Text>
              <Text style={styles.organization} numberOfLines={1}>
                {application.organization.name}
              </Text>
            </PressableCard>
          ))
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
    marginBottom: spacing.sm,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reference: {
    ...typography.caption,
  },
  opportunityTitle: {
    ...typography.h3,
    marginTop: spacing.xs,
  },
  organization: {
    ...typography.caption,
  },
});
