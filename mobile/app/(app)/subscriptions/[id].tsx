import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { colors, ErrorText, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { spacing, typography } from '../../../components/theme';
import { api, ApiError, type Subscription, type SubscriptionStatus } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { formatAmountMinor } from '../../../lib/money';
import {
  SUBSCRIPTION_STATUS_TONE,
  useBillingCycleLabels,
  useSubscriptionPlanLabels,
  useSubscriptionStatusLabels,
} from '../../../lib/subscription-labels';

const CANCELLABLE_STATUSES = new Set<SubscriptionStatus>(['PENDING_PAYMENT', 'ACTIVE']);

export default function SubscriptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const statusLabels = useSubscriptionStatusLabels();
  const planLabels = useSubscriptionPlanLabels();
  const billingCycleLabels = useBillingCycleLabels();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setSubscription(await api.getSubscription(accessToken, id));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('subscriptions.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function handleCancel() {
    if (!accessToken || !id) return;
    setCancelError(null);
    setIsCancelling(true);
    try {
      await api.cancelSubscription(accessToken, id);
      await reload();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : t('subscriptions.detail.cancelError'));
    } finally {
      setIsCancelling(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !subscription || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('subscriptions.detail.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{planLabels[subscription.plan]}</Text>
          <Badge
            label={statusLabels[subscription.status]}
            tone={SUBSCRIPTION_STATUS_TONE[subscription.status]}
          />
        </View>

        <Section title={t('subscriptions.detail.planSection')}>
          <Text style={typography.body}>
            {formatAmountMinor(subscription.amountMinor, subscription.currency, i18n.language)}
            {' — '}
            {billingCycleLabels[subscription.billingCycle]}
          </Text>
          {!!subscription.startedAt && (
            <Text style={typography.caption}>
              {t('subscriptions.startedLabel', {
                date: new Date(subscription.startedAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
          {!!subscription.currentPeriodEnd && (
            <Text style={typography.caption}>
              {t('subscriptions.periodEndLabel', {
                date: new Date(subscription.currentPeriodEnd).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
          {!!subscription.cancelledAt && (
            <Text style={typography.caption}>
              {t('subscriptions.cancelledLabel', {
                date: new Date(subscription.cancelledAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          )}
        </Section>

        {subscription.status === 'PENDING_PAYMENT' && (
          <Section title={t('subscriptions.detail.paymentSection')}>
            <Text style={typography.body}>{t('subscriptions.detail.pendingNotice')}</Text>
            <SecondaryButton title={t('subscriptions.detail.refresh')} onPress={reload} />
          </Section>
        )}

        {CANCELLABLE_STATUSES.has(subscription.status) && (
          <Section title={t('subscriptions.detail.manageSection')}>
            <ErrorText>{cancelError}</ErrorText>
            <SecondaryButton
              title={t('subscriptions.detail.cancelButton')}
              onPress={handleCancel}
              loading={isCancelling}
            />
          </Section>
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
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h1,
    flexShrink: 1,
  },
});
