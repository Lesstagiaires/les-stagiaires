import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { DateInput } from '../../../components/date-input';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type InternshipCampaign } from '../../../lib/api';
import { useCampaignStatusLabels, CAMPAIGN_STATUS_TONE } from '../../../lib/establishment-labels';
import { useAuth } from '../../../lib/auth-context';
import { toIsoDateString } from '../../../lib/date';
import { EmptyState } from '../../../components/empty-state';

export default function CampaignsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState<InternshipCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setCampaigns(await api.listCampaigns(accessToken, id));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.campaigns.loadError'));
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
          <ErrorText>{t('recruiter.campaigns.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.campaigns.title')}</Text>

        {campaigns === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {campaigns.length === 0 ? (
              <EmptyState message={t('recruiter.campaigns.empty')} />
            ) : (
              campaigns.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  accessToken={accessToken}
                  establishmentId={id}
                  campaign={campaign}
                  onChanged={reload}
                />
              ))
            )}
          </View>
        )}

        <CreateCampaignSection accessToken={accessToken} establishmentId={id} onCreated={reload} />

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function CampaignRow({
  accessToken,
  establishmentId,
  campaign,
  onChanged,
}: {
  accessToken: string;
  establishmentId: string;
  campaign: InternshipCampaign;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const campaignStatusLabels = useCampaignStatusLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function transition(status: 'ACTIVE' | 'CLOSED') {
    setError(null);
    setBusy(true);
    try {
      await api.updateCampaignStatus(accessToken, establishmentId, campaign.id, status);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.campaigns.actionError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.campaignCard}>
      <View style={styles.campaignHeader}>
        <Text style={typography.bodyBold}>{campaign.name}</Text>
        <Badge label={campaignStatusLabels[campaign.status]} tone={CAMPAIGN_STATUS_TONE[campaign.status]} />
      </View>
      <Text style={typography.caption}>
        {new Date(campaign.startDate).toLocaleDateString(i18n.language)} —{' '}
        {new Date(campaign.endDate).toLocaleDateString(i18n.language)}
      </Text>
      {campaign.status === 'DRAFT' && (
        <SecondaryButton
          title={t('recruiter.campaigns.activate')}
          onPress={() => transition('ACTIVE')}
          loading={busy}
          disabled={busy}
        />
      )}
      {campaign.status === 'ACTIVE' && (
        <SecondaryButton
          title={t('recruiter.campaigns.close')}
          onPress={() => transition('CLOSED')}
          loading={busy}
          disabled={busy}
        />
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function CreateCampaignSection({
  accessToken,
  establishmentId,
  onCreated,
}: {
  accessToken: string;
  establishmentId: string;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!startDate || !endDate) return;
    setError(null);
    setIsSaving(true);
    try {
      await api.createCampaign(accessToken, establishmentId, {
        name,
        startDate: toIsoDateString(startDate),
        endDate: toIsoDateString(endDate),
      });
      setName('');
      setStartDate(null);
      setEndDate(null);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.campaigns.create.error'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title={t('recruiter.campaigns.create.title')}>
      <FormInput
        placeholder={t('recruiter.campaigns.create.namePlaceholder')}
        value={name}
        onChangeText={setName}
      />
      <DateInput
        placeholder={t('recruiter.campaigns.create.startDatePlaceholder')}
        value={startDate}
        onChange={setStartDate}
      />
      <DateInput
        placeholder={t('recruiter.campaigns.create.endDatePlaceholder')}
        value={endDate}
        onChange={setEndDate}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('recruiter.campaigns.create.submit')}
        onPress={handleCreate}
        loading={isSaving}
        disabled={!name.trim() || !startDate || !endDate}
      />
    </Section>
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
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  list: {
    gap: spacing.sm,
  },
  campaignCard: {
    gap: spacing.xs,
  },
  campaignHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
