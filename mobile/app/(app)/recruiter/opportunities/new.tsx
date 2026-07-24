import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Oui' },
  { value: 'no', label: 'Non' },
];

export default function NewOpportunityScreen() {
  const router = useRouter();
  const { accessToken, logout } = useAuth();
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
          setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
        });
    }, [accessToken, logout]),
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
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
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
        <Text style={styles.title}>Nouvelle offre</Text>

        {organizations.length > 1 && (
          <View style={styles.field}>
            <Text style={typography.label}>ORGANISATION</Text>
            <ChipSelect
              options={organizations.map((org) => ({ value: org.id, label: org.name }))}
              value={organizationId}
              onChange={setOrganizationId}
            />
          </View>
        )}

        <FormInput placeholder="Titre de l'offre" value={title} onChangeText={setTitle} />
        <FormInput
          placeholder="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          style={styles.multiline}
        />

        <View style={styles.field}>
          <Text style={typography.label}>TYPE</Text>
          <ChipSelect options={OPPORTUNITY_TYPE_OPTIONS} value={type} onChange={(v) => setType(v as OpportunityType)} />
          {(type === 'SEASONAL' || type === 'VOLUNTEER' || type === 'TEMPORARY') && (
            <Text style={typography.caption}>
              Ce type nécessite une demande de besoin spécial approuvée avant publication
              (voir "Besoins spéciaux" sur la fiche de l'organisation).
            </Text>
          )}
        </View>

        <FormInput placeholder="Secteur" value={sector} onChangeText={setSector} />
        <FormInput placeholder="Pays" value={country} onChangeText={setCountry} />
        <FormInput placeholder="Ville" value={city} onChangeText={setCity} />

        <View style={styles.field}>
          <Text style={typography.label}>MODE DE TRAVAIL</Text>
          <ChipSelect options={WORK_MODE_OPTIONS} value={workMode} onChange={(v) => setWorkMode(v as WorkMode)} />
        </View>

        <View style={styles.field}>
          <Text style={typography.label}>RELOCALISATION REQUISE</Text>
          <ChipSelect
            options={YES_NO_OPTIONS}
            value={relocationRequired === null ? null : relocationRequired ? 'yes' : 'no'}
            onChange={(v) => setRelocationRequired(v === 'yes')}
          />
        </View>

        <View style={styles.field}>
          <Text style={typography.label}>HÉBERGEMENT FOURNI</Text>
          <ChipSelect
            options={YES_NO_OPTIONS}
            value={accommodationProvided === null ? null : accommodationProvided ? 'yes' : 'no'}
            onChange={(v) => setAccommodationProvided(v === 'yes')}
          />
        </View>

        <FormInput
          placeholder="Avantages liés à la mobilité (optionnel)"
          value={mobilityBenefits}
          onChangeText={setMobilityBenefits}
          multiline
          numberOfLines={3}
          style={styles.multiline}
        />

        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title="Créer en brouillon"
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
