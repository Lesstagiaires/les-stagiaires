import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../components/badge';
import { PressableCard } from '../../../../components/card';
import { ErrorText, PrimaryButton } from '../../../../components/form';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Opportunity } from '../../../../lib/api';
import { useOpportunityTypeLabels } from '../../../../lib/opportunity-labels';
import {
  useOpportunityStatusLabels,
  OPPORTUNITY_STATUS_TONE,
} from '../../../../lib/organization-labels';
import { useAuth } from '../../../../lib/auth-context';

export default function MyOpportunitiesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const opportunityStatusLabels = useOpportunityStatusLabels();
  const opportunityTypeLabels = useOpportunityTypeLabels();
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setOpportunities(await api.listMyOpportunities(accessToken));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.myOpportunities.loadError'));
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.layout.myOpportunities')}</Text>

        <PrimaryButton
          title={t('recruiter.myOpportunities.newLink')}
          onPress={() => router.push('/recruiter/opportunities/new')}
        />

        {opportunities === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : opportunities.length === 0 ? (
          <Text style={styles.emptyText}>{t('recruiter.myOpportunities.empty')}</Text>
        ) : (
          <View style={styles.list}>
            {opportunities.map((opportunity) => (
              <PressableCard
                key={opportunity.id}
                style={styles.card}
                onPress={() => router.push(`/recruiter/opportunities/${opportunity.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {opportunity.title}
                  </Text>
                  <Badge
                    label={opportunityStatusLabels[opportunity.status]}
                    tone={OPPORTUNITY_STATUS_TONE[opportunity.status]}
                  />
                </View>
                <Text style={typography.caption}>{opportunityTypeLabels[opportunity.type]}</Text>
                <Text style={typography.caption}>
                  {opportunity.city}, {opportunity.country}
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
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.h3,
    flexShrink: 1,
  },
});
