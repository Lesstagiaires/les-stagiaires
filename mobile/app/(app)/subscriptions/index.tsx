import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { PressableCard } from '../../../components/card';
import { colors, ErrorText, PrimaryButton } from '../../../components/form';
import { spacing, typography } from '../../../components/theme';
import { api, ApiError, type Subscription } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';
import {
  SUBSCRIPTION_STATUS_TONE,
  useBillingCycleLabels,
  useSubscriptionPlanLabels,
  useSubscriptionStatusLabels,
} from '../../../lib/subscription-labels';
import { EmptyState } from '../../../components/empty-state';

export default function SubscriptionsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useSubscriptionStatusLabels();
  const planLabels = useSubscriptionPlanLabels();
  const billingCycleLabels = useBillingCycleLabels();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setSubscriptions(await api.listMySubscriptions(accessToken));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('subscriptions.loadError'));
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('subscriptions.intro')}</Text>

        <PrimaryButton
          title={t('subscriptions.newLink')}
          onPress={() => router.push('/subscriptions/new')}
        />

        {subscriptions === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : subscriptions.length === 0 ? (
          <EmptyState message={t('subscriptions.empty')} />
        ) : (
          <View style={styles.list}>
            {subscriptions.map((subscription) => (
              <PressableCard
                key={subscription.id}
                style={styles.card}
                onPress={() => router.push(`/subscriptions/${subscription.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Badge
                    label={statusLabels[subscription.status]}
                    tone={SUBSCRIPTION_STATUS_TONE[subscription.status]}
                  />
                  <Text style={typography.caption}>
                    {new Date(subscription.createdAt).toLocaleDateString(i18n.language)}
                  </Text>
                </View>
                <Text style={styles.planName}>{planLabels[subscription.plan]}</Text>
                <Text style={typography.caption}>
                  {formatAmountMinor(subscription.amountMinor, subscription.currency, i18n.language)}
                  {' — '}
                  {billingCycleLabels[subscription.billingCycle]}
                </Text>
                {/* V6-5 — L'ÉCHÉANCE PLUTÔT QUE RIEN.
                    La date en haut de carte est celle de la SOUSCRIPTION : elle
                    ne dit pas jusqu'à quand on est couvert, qui est la seule
                    information sur laquelle on peut agir. Une prestation à
                    l'acte n'a pas d'échéance et n'affiche donc pas cette ligne. */}
                {!!subscription.currentPeriodEnd && (
                  <Text style={typography.caption}>
                    {t(
                      subscription.status === 'EXPIRED'
                        ? 'subscriptions.endedOnLabel'
                        : 'subscriptions.periodEndLabel',
                      {
                        date: new Date(subscription.currentPeriodEnd).toLocaleDateString(
                          i18n.language,
                        ),
                      },
                    )}
                  </Text>
                )}
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
  intro: {
    ...typography.body,
    color: colors.textSecondary,
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
  planName: {
    ...typography.h3,
    marginTop: spacing.xs,
  },
});
