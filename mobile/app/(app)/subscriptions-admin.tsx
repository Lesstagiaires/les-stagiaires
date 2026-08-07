import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ChipSelect } from '../../components/chip-select';
import { colors, ErrorText } from '../../components/form';
import { spacing, typography } from '../../components/theme';
import { api, ApiError, type AdminSubscription, type SubscriptionStatus } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatAmountMinor } from '../../lib/money';
import {
  SUBSCRIPTION_STATUS_TONE,
  useBillingCycleLabels,
  useSubscriptionPlanLabels,
  useSubscriptionStatusLabels,
} from '../../lib/subscription-labels';
import { EmptyState } from '../../components/empty-state';

type StatusFilter = SubscriptionStatus | '__all__';

export default function SubscriptionsAdminScreen() {
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useSubscriptionStatusLabels();
  const planLabels = useSubscriptionPlanLabels();
  const billingCycleLabels = useBillingCycleLabels();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('__all__');
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusFilterOptions: { value: StatusFilter; label: string }[] = [
    { value: '__all__', label: t('subscriptionsAdmin.filterAll') },
    ...(Object.keys(statusLabels) as SubscriptionStatus[]).map((status) => ({
      value: status,
      label: statusLabels[status],
    })),
  ];

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const status = statusFilter === '__all__' ? undefined : statusFilter;
      setSubscriptions(await api.listAllSubscriptions(accessToken, { status }));
      setError(null);
    } catch (err) {
      // Toujours sortir de l'état "chargement" (subscriptions === null), même en erreur —
      // sinon le spinner tourne indéfiniment au lieu d'afficher le message d'erreur.
      setSubscriptions([]);
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      if (err instanceof ApiError && err.statusCode === 403) {
        setError(t('subscriptionsAdmin.unavailable'));
        return;
      }
      setError(err instanceof ApiError ? err.message : t('subscriptionsAdmin.loadError'));
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect
            options={statusFilterOptions}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
          />
        </ScrollView>

        {subscriptions === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : subscriptions.length === 0 ? (
          <EmptyState message={t('subscriptionsAdmin.empty')} />
        ) : (
          <View style={styles.list}>
            {subscriptions.map((subscription) => (
              <Card key={subscription.id} style={styles.card}>
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
                {!!subscription.beneficiaryUser && (
                  <Text style={typography.caption}>
                    {t('subscriptionsAdmin.beneficiaryUserLabel', {
                      name: subscription.beneficiaryUser.lsId ?? subscription.beneficiaryUser.id,
                    })}
                  </Text>
                )}
                {!!subscription.beneficiaryOrganization && (
                  <Text style={typography.caption}>
                    {t('subscriptionsAdmin.beneficiaryOrganizationLabel', {
                      name: subscription.beneficiaryOrganization.name,
                    })}
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
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
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
