import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, ErrorText, PrimaryButton } from '../../../components/form';
import { spacing, typography } from '../../../components/theme';
import { api, ApiError, type Organization } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useSubscriptionPlanLabels } from '../../../lib/subscription-labels';

export default function OrganizationSubscribeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const planLabels = useSubscriptionPlanLabels();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      const organizations = await api.listMyOrganizations(accessToken);
      const found = organizations.find((entry) => entry.id === id) ?? null;
      setOrganization(found);
      setLoadError(found ? null : t('recruiter.organization.notFound'));
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('recruiter.organization.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function handleSubmit() {
    if (!accessToken || !id) return;
    setError(null);
    setIsSubmitting(true);
    try {
      // BUSINESS/INSTITUTION n'est aujourd'hui tarifé qu'en annuel (voir
      // subscription-pricing.service.ts côté API) — pas de choix à proposer.
      const result = await api.subscribeOrganization(accessToken, id, {
        billingCycle: 'ANNUAL',
      });
      setInstructions(result.payment.instructions ?? t('subscriptions.new.defaultInstructions'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.subscribe.error'));
    } finally {
      setIsSubmitting(false);
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

  if (loadError || !organization || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('recruiter.organization.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  if (instructions) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.successTitle}>{t('subscriptions.new.successTitle')}</Text>
          <Text style={styles.successBody}>{instructions}</Text>
          <PrimaryButton
            title={t('recruiter.subscribe.backToOrganization')}
            onPress={() => router.replace(`/recruiter/organization?id=${id}`)}
          />
        </View>
      </SafeAreaView>
    );
  }

  const plan = organization.type === 'ETABLISSEMENT' ? 'INSTITUTION' : 'BUSINESS';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.subscribe.title')}</Text>
        <Text style={styles.intro}>
          {t('recruiter.subscribe.intro', { plan: planLabels[plan] })}
        </Text>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title={t('recruiter.subscribe.submit')}
          onPress={handleSubmit}
          loading={isSubmitting}
        />
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
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
  },
  successTitle: {
    ...typography.h1,
    textAlign: 'center',
  },
  successBody: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
