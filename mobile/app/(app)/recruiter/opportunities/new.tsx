import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '../../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton } from '../../../../components/form';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Organization, type OpportunityType, type WorkMode } from '../../../../lib/api';
import { OPPORTUNITY_TYPE_OPTIONS } from '../../../../lib/opportunity-labels';
import { useAuth } from '../../../../lib/auth-context';

const WORK_MODE_OPTIONS: { value: WorkMode; label: string }[] = [
  { value: 'ON_SITE', label: 'Présentiel' },
  { value: 'REMOTE', label: 'Télétravail' },
  { value: 'HYBRID', label: 'Hybride' },
];

export default function NewOpportunityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const yesNoOptions = [
    { value: 'yes', label: t('common.yes') },
    { value: 'no', label: t('common.no') },
  ];
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<OpportunityType | null>(null);
  const [sector, setSector] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);
  const [relocationRequired, setRelocationRequired] = useState<boolean | null>(null);
  const [accommodationProvided, setAccommodationProvided] = useState<boolean | null>(null);
  const [mobilityBenefits, setMobilityBenefits] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;
      api
        .listMyOrganizations(accessToken)
        .then((orgs) => {
          setOrganizations(orgs);
          if (orgs.length === 1) setOrganizationId(orgs[0].id);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.statusCode === 401) {
            void logout();
            return;
          }
          setError(err instanceof ApiError ? err.message : t('recruiter.opportunityForm.loadError'));
        });
    }, [accessToken, logout, t]),
  );

  const canSubmit =
    !!accessToken &&
    !!organizationId &&
    !!title.trim() &&
    !!description.trim() &&
    !!type &&
    !!sector.trim() &&
    !!country.trim() &&
    !!city.trim();

  async function handleCreate() {
    if (!accessToken || !organizationId || !type) return;
    setError(null);
    setIsSaving(true);
    try {
      const created = await api.createOpportunity(accessToken, {
        organizationId,
        title,
        description,
        type,
        sector,
        country,
        city,
        workMode: workMode ?? undefined,
        relocationRequired: relocationRequired ?? undefined,
        accommodationProvided: accommodationProvided ?? undefined,
        mobilityBenefits: mobilityBenefits || undefined,
      });
      router.replace(`/recruiter/opportunities/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.opportunityForm.createError'));
    } finally {
      setIsSaving(false);
    }
  }

  if (organizations === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('recruiter.layout.newOpportunity')}</Text>

        {organizations.length > 1 && (
          <View style={styles.field}>
            <Text style={typography.label}>{t('recruiter.opportunityForm.organizationLabel')}</Text>
            <ChipSelect
              options={organizations.map((org) => ({ value: org.id, label: org.name }))}
              value={organizationId}
              onChange={setOrganizationId}
            />
          </View>
        )}

        <FormInput
          placeholder={t('recruiter.opportunityForm.titlePlaceholder')}
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

        <View style={styles.field}>
          <Text style={typography.label}>{t('recruiter.opportunityForm.typeLabel')}</Text>
          <ChipSelect options={OPPORTUNITY_TYPE_OPTIONS} value={type} onChange={(v) => setType(v as OpportunityType)} />
          {(type === 'SEASONAL' || type === 'VOLUNTEER' || type === 'TEMPORARY') && (
            <Text style={typography.caption}>{t('recruiter.opportunityForm.gatedTypeHint')}</Text>
          )}
        </View>

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

        <View style={styles.field}>
          <Text style={typography.label}>{t('recruiter.opportunityForm.workModeLabel')}</Text>
          <ChipSelect options={WORK_MODE_OPTIONS} value={workMode} onChange={(v) => setWorkMode(v as WorkMode)} />
        </View>

        <View style={styles.field}>
          <Text style={typography.label}>{t('recruiter.opportunityForm.relocationLabel')}</Text>
          <ChipSelect
            options={yesNoOptions}
            value={relocationRequired === null ? null : relocationRequired ? 'yes' : 'no'}
            onChange={(v) => setRelocationRequired(v === 'yes')}
          />
        </View>

        <View style={styles.field}>
          <Text style={typography.label}>{t('recruiter.opportunityForm.accommodationLabel')}</Text>
          <ChipSelect
            options={yesNoOptions}
            value={accommodationProvided === null ? null : accommodationProvided ? 'yes' : 'no'}
            onChange={(v) => setAccommodationProvided(v === 'yes')}
          />
        </View>

        <FormInput
          placeholder={t('recruiter.opportunityForm.mobilityBenefitsPlaceholder')}
          value={mobilityBenefits}
          onChangeText={setMobilityBenefits}
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title={t('recruiter.opportunityForm.submit')}
          onPress={handleCreate}
          loading={isSaving}
          disabled={!canSubmit}
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
  field: {
    gap: spacing.sm,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
