import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '../../../components/chip-select';
import { colors, ErrorText, PrimaryButton } from '../../../components/form';
import { spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  INDIVIDUAL_PLANS,
  type IndividualPlan,
  type SubscriptionBillingCycle,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import {
  useBillingCycleLabels,
  useSubscriptionPlanLabels,
} from '../../../lib/subscription-labels';

// Même tarification que l'auto-souscription individuelle : les deux formules sont
// annuelles (subscription-pricing.service.ts).
const BILLING_CYCLE_OPTIONS: SubscriptionBillingCycle[] = ['ANNUAL'];

export default function SponsorSubscriptionScreen() {
  const { id, beneficiaryUserId, label } = useLocalSearchParams<{
    id: string;
    beneficiaryUserId: string;
    label?: string;
  }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const billingCycleLabels = useBillingCycleLabels();

  const planLabels = useSubscriptionPlanLabels();

  const [plan, setPlan] = useState<IndividualPlan | null>(null);
  const [billingCycle, setBillingCycle] = useState<SubscriptionBillingCycle | null>('ANNUAL');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);

  const cycleOptions = BILLING_CYCLE_OPTIONS.map((value) => ({
    value,
    label: billingCycleLabels[value],
  }));
  const planOptions = INDIVIDUAL_PLANS.map((value) => ({
    value,
    label: planLabels[value],
  }));

  async function handleSubmit() {
    if (!accessToken || !id || !beneficiaryUserId || !plan || !billingCycle) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await api.sponsorSubscription(accessToken, id, beneficiaryUserId, {
        plan,
        billingCycle,
      });
      setInstructions(result.payment.instructions ?? t('subscriptions.new.defaultInstructions'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.sponsor.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!accessToken || !id || !beneficiaryUserId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{t('recruiter.sponsor.unavailable')}</ErrorText>
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
            title={t('recruiter.sponsor.backToLearners')}
            onPress={() => router.replace(`/recruiter/learners?id=${id}`)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.sponsor.title')}</Text>
        <Text style={styles.intro}>
          {t('recruiter.sponsor.intro', { name: label || beneficiaryUserId })}
        </Text>

        <View style={styles.field}>
          <Text style={typography.label}>{t('subscriptions.new.planLabel')}</Text>
          <ChipSelect
            options={planOptions}
            value={plan}
            onChange={(value) => setPlan(value as IndividualPlan)}
          />
        </View>

        <View style={styles.field}>
          <Text style={typography.label}>{t('subscriptions.new.billingCycleLabel')}</Text>
          <ChipSelect
            options={cycleOptions}
            value={billingCycle}
            onChange={(value) => setBillingCycle(value as SubscriptionBillingCycle)}
          />
        </View>

        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title={t('recruiter.sponsor.submit')}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={!plan || !billingCycle}
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
  field: {
    gap: spacing.sm,
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
