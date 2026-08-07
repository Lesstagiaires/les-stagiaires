import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../../components/badge';
import { Card } from '../../../../components/card';
import { ChipSelect } from '../../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../../components/form';
import { OfferQualityPanel } from '../../../../components/offer-quality-panel';
import { Section } from '../../../../components/section';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Opportunity, type OpportunityType, type WorkMode } from '../../../../lib/api';
import {
  useOpportunityTypeLabels,
  useOpportunityTypeOptions,
  useWorkModeOptions,
} from '../../../../lib/opportunity-labels';
import {
  useOpportunityStatusLabels,
  OPPORTUNITY_STATUS_TONE,
} from '../../../../lib/organization-labels';
import { useAuth } from '../../../../lib/auth-context';

export default function ManageOpportunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const opportunityStatusLabels = useOpportunityStatusLabels();
  const opportunityTypeLabels = useOpportunityTypeLabels();
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setOpportunity(await api.getOpportunity(id, accessToken));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('recruiter.manageOpportunity.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !opportunity || !accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('recruiter.manageOpportunity.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{opportunity.title}</Text>
          <Badge
            label={opportunityStatusLabels[opportunity.status]}
            tone={OPPORTUNITY_STATUS_TONE[opportunity.status]}
          />
        </View>
        <Text style={typography.caption}>{opportunityTypeLabels[opportunity.type]}</Text>

        <LifecycleActions accessToken={accessToken} opportunity={opportunity} onChanged={reload} />

        {/*
          Le diagnostic AVANT le formulaire quand l'offre est encore en
          brouillon : il dit ce qui manque, et le formulaire est juste en
          dessous pour le corriger. Après publication il reste utile — c'est
          lui qui expliquera pourquoi une offre ne reçoit pas de candidature.
        */}
        <OfferQualityPanel opportunityId={opportunity.id} accessToken={accessToken} />

        {opportunity.status === 'DRAFT' ? (
          <EditForm accessToken={accessToken} opportunity={opportunity} onSaved={reload} />
        ) : (
          <ReadOnlySummary opportunity={opportunity} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LifecycleActions({
  accessToken,
  opportunity,
  onChanged,
}: {
  accessToken: string;
  opportunity: Opportunity;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, call: () => Promise<unknown>) {
    setError(null);
    setBusyAction(action);
    try {
      await call();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.manageOpportunity.actionError'));
    } finally {
      setBusyAction(null);
    }
  }

  const actions: { key: string; title: string; onPress: () => void }[] = [];
  if (opportunity.status === 'DRAFT') {
    actions.push({
      key: 'publish',
      title: t('recruiter.manageOpportunity.actions.publish'),
      onPress: () => run('publish', () => api.publishOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'ACTIVE') {
    actions.push({
      key: 'pause',
      title: t('recruiter.manageOpportunity.actions.pause'),
      onPress: () => run('pause', () => api.pauseOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'PAUSED') {
    actions.push({
      key: 'resume',
      title: t('recruiter.manageOpportunity.actions.resume'),
      onPress: () => run('resume', () => api.resumeOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'ACTIVE' || opportunity.status === 'PAUSED') {
    actions.push({
      key: 'fill',
      title: t('recruiter.manageOpportunity.actions.fill'),
      onPress: () => run('fill', () => api.fillOpportunity(accessToken, opportunity.id)),
    });
  }
  if (['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED'].includes(opportunity.status)) {
    actions.push({
      key: 'cancel',
      title: t('recruiter.manageOpportunity.actions.cancel'),
      onPress: () => run('cancel', () => api.cancelOpportunity(accessToken, opportunity.id)),
    });
  }

  if (actions.length === 0) return null;

  return (
    <Card style={styles.actionsCard}>
      {actions.map((action) => (
        <SecondaryButton
          key={action.key}
          title={action.title}
          onPress={action.onPress}
          loading={busyAction === action.key}
          disabled={busyAction !== null && busyAction !== action.key}
        />
      ))}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function ReadOnlySummary({ opportunity }: { opportunity: Opportunity }) {
  const { t } = useTranslation();
  const workModeOptions = useWorkModeOptions();
  return (
    <Section title={t('recruiter.manageOpportunity.detailsTitle')}>
      <Text style={typography.body}>{opportunity.description}</Text>
      <Text style={typography.caption}>
        {t('recruiter.manageOpportunity.sectorLabel', { sector: opportunity.sector })}
      </Text>
      <Text style={typography.caption}>
        {t('recruiter.manageOpportunity.locationLabel', {
          city: opportunity.city,
          country: opportunity.country,
        })}
      </Text>
      {!!opportunity.workMode && (
        <Text style={typography.caption}>
          {t('recruiter.manageOpportunity.modeLabel', {
            mode: workModeOptions.find((o) => o.value === opportunity.workMode)?.label,
          })}
        </Text>
      )}
      <Text style={typography.caption}>
        {t('recruiter.manageOpportunity.relocationLabel', {
          value: opportunity.relocationRequired ? t('common.yes') : t('common.no'),
        })}
      </Text>
      <Text style={typography.caption}>
        {t('recruiter.manageOpportunity.accommodationLabel', {
          value: opportunity.accommodationProvided ? t('common.yes') : t('common.no'),
        })}
      </Text>
      {!!opportunity.mobilityBenefits && (
        <Text style={typography.caption}>
          {t('recruiter.manageOpportunity.benefitsLabel', { benefits: opportunity.mobilityBenefits })}
        </Text>
      )}
    </Section>
  );
}

function EditForm({
  accessToken,
  opportunity,
  onSaved,
}: {
  accessToken: string;
  opportunity: Opportunity;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const opportunityTypeOptions = useOpportunityTypeOptions();
  const workModeOptions = useWorkModeOptions();
  const [title, setTitle] = useState(opportunity.title);
  const [description, setDescription] = useState(opportunity.description);
  const [type, setType] = useState<OpportunityType>(opportunity.type);
  const [sector, setSector] = useState(opportunity.sector);
  const [country, setCountry] = useState(opportunity.country);
  const [city, setCity] = useState(opportunity.city);
  const [workMode, setWorkMode] = useState<WorkMode | null>(opportunity.workMode);
  const [relocationRequired, setRelocationRequired] = useState(opportunity.relocationRequired);
  const [accommodationProvided, setAccommodationProvided] = useState(
    opportunity.accommodationProvided,
  );
  const [mobilityBenefits, setMobilityBenefits] = useState(opportunity.mobilityBenefits ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yesNoOptions = [
    { value: 'yes', label: t('common.yes') },
    { value: 'no', label: t('common.no') },
  ];

  useEffect(() => {
    setTitle(opportunity.title);
    setDescription(opportunity.description);
    setType(opportunity.type);
    setSector(opportunity.sector);
    setCountry(opportunity.country);
    setCity(opportunity.city);
    setWorkMode(opportunity.workMode);
    setRelocationRequired(opportunity.relocationRequired);
    setAccommodationProvided(opportunity.accommodationProvided);
    setMobilityBenefits(opportunity.mobilityBenefits ?? '');
  }, [opportunity]);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.updateOpportunity(accessToken, opportunity.id, {
        title,
        description,
        type,
        sector,
        country,
        city,
        workMode: workMode ?? undefined,
        relocationRequired,
        accommodationProvided,
        mobilityBenefits: mobilityBenefits || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.manageOpportunity.saveError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title={t('recruiter.manageOpportunity.editTitle')}>
      <FormInput
        placeholder={t('recruiter.manageOpportunity.titlePlaceholder')}
        value={title}
        onChangeText={setTitle}
      />
      <FormInput
        placeholder={t('recruiter.opportunityForm.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
        style={styles.multiline}
      />
      <Text style={typography.label}>{t('recruiter.opportunityForm.typeLabel')}</Text>
      <ChipSelect options={opportunityTypeOptions} value={type} onChange={(v) => setType(v as OpportunityType)} />
      <FormInput
        placeholder={t('recruiter.opportunityForm.sectorPlaceholder')}
        value={sector}
        onChangeText={setSector}
      />
      <FormInput
        placeholder={t('recruiter.opportunityForm.countryPlaceholder')}
        value={country}
        onChangeText={setCountry}
      />
      <FormInput
        placeholder={t('recruiter.opportunityForm.cityPlaceholder')}
        value={city}
        onChangeText={setCity}
      />
      <Text style={typography.label}>{t('recruiter.opportunityForm.workModeLabel')}</Text>
      <ChipSelect options={workModeOptions} value={workMode} onChange={(v) => setWorkMode(v as WorkMode)} />
      <Text style={typography.label}>{t('recruiter.opportunityForm.relocationLabel')}</Text>
      <ChipSelect
        options={yesNoOptions}
        value={relocationRequired ? 'yes' : 'no'}
        onChange={(v) => setRelocationRequired(v === 'yes')}
      />
      <Text style={typography.label}>{t('recruiter.opportunityForm.accommodationLabel')}</Text>
      <ChipSelect
        options={yesNoOptions}
        value={accommodationProvided ? 'yes' : 'no'}
        onChange={(v) => setAccommodationProvided(v === 'yes')}
      />
      <FormInput
        placeholder={t('recruiter.opportunityForm.mobilityBenefitsPlaceholder')}
        value={mobilityBenefits}
        onChangeText={setMobilityBenefits}
        multiline
        numberOfLines={3}
        style={styles.multiline}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('common.save')} onPress={handleSave} loading={isSaving} />
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
  actionsCard: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
