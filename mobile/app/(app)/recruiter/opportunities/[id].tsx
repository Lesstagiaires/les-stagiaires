import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../../components/badge';
import { Card } from '../../../../components/card';
import { ChipSelect } from '../../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../../components/form';
import { Section } from '../../../../components/section';
import { colors, spacing, typography } from '../../../../components/theme';
import { api, ApiError, type Opportunity, type OpportunityType, type WorkMode } from '../../../../lib/api';
import { OPPORTUNITY_TYPE_LABELS, OPPORTUNITY_TYPE_OPTIONS } from '../../../../lib/opportunity-labels';
import {
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_TONE,
} from '../../../../lib/organization-labels';
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

export default function ManageOpportunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
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
      setLoadError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [id, accessToken, logout]);

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
          <ErrorText>{loadError ?? 'Offre indisponible.'}</ErrorText>
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
            label={OPPORTUNITY_STATUS_LABELS[opportunity.status]}
            tone={OPPORTUNITY_STATUS_TONE[opportunity.status]}
          />
        </View>
        <Text style={typography.caption}>{OPPORTUNITY_TYPE_LABELS[opportunity.type]}</Text>

        <LifecycleActions accessToken={accessToken} opportunity={opportunity} onChanged={reload} />

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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, call: () => Promise<unknown>) {
    setError(null);
    setBusyAction(action);
    try {
      await call();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusyAction(null);
    }
  }

  const actions: { key: string; title: string; onPress: () => void }[] = [];
  if (opportunity.status === 'DRAFT') {
    actions.push({
      key: 'publish',
      title: 'Publier',
      onPress: () => run('publish', () => api.publishOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'ACTIVE') {
    actions.push({
      key: 'pause',
      title: 'Mettre en pause',
      onPress: () => run('pause', () => api.pauseOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'PAUSED') {
    actions.push({
      key: 'resume',
      title: 'Reprendre',
      onPress: () => run('resume', () => api.resumeOpportunity(accessToken, opportunity.id)),
    });
  }
  if (opportunity.status === 'ACTIVE' || opportunity.status === 'PAUSED') {
    actions.push({
      key: 'fill',
      title: 'Marquer comme pourvue',
      onPress: () => run('fill', () => api.fillOpportunity(accessToken, opportunity.id)),
    });
  }
  if (['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED'].includes(opportunity.status)) {
    actions.push({
      key: 'cancel',
      title: 'Annuler',
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
  return (
    <Section title="Détails">
      <Text style={typography.body}>{opportunity.description}</Text>
      <Text style={typography.caption}>Secteur : {opportunity.sector}</Text>
      <Text style={typography.caption}>
        Lieu : {opportunity.city}, {opportunity.country}
      </Text>
      {!!opportunity.workMode && (
        <Text style={typography.caption}>
          Mode : {WORK_MODE_OPTIONS.find((o) => o.value === opportunity.workMode)?.label}
        </Text>
      )}
      <Text style={typography.caption}>
        Relocalisation requise : {opportunity.relocationRequired ? 'Oui' : 'Non'}
      </Text>
      <Text style={typography.caption}>
        Hébergement fourni : {opportunity.accommodationProvided ? 'Oui' : 'Non'}
      </Text>
      {!!opportunity.mobilityBenefits && (
        <Text style={typography.caption}>Avantages : {opportunity.mobilityBenefits}</Text>
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
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title="Modifier le brouillon">
      <FormInput placeholder="Titre" value={title} onChangeText={setTitle} />
      <FormInput
        placeholder="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
        style={styles.multiline}
      />
      <Text style={typography.label}>TYPE</Text>
      <ChipSelect options={OPPORTUNITY_TYPE_OPTIONS} value={type} onChange={(v) => setType(v as OpportunityType)} />
      <FormInput placeholder="Secteur" value={sector} onChangeText={setSector} />
      <FormInput placeholder="Pays" value={country} onChangeText={setCountry} />
      <FormInput placeholder="Ville" value={city} onChangeText={setCity} />
      <Text style={typography.label}>MODE DE TRAVAIL</Text>
      <ChipSelect options={WORK_MODE_OPTIONS} value={workMode} onChange={(v) => setWorkMode(v as WorkMode)} />
      <Text style={typography.label}>RELOCALISATION REQUISE</Text>
      <ChipSelect
        options={YES_NO_OPTIONS}
        value={relocationRequired ? 'yes' : 'no'}
        onChange={(v) => setRelocationRequired(v === 'yes')}
      />
      <Text style={typography.label}>HÉBERGEMENT FOURNI</Text>
      <ChipSelect
        options={YES_NO_OPTIONS}
        value={accommodationProvided ? 'yes' : 'no'}
        onChange={(v) => setAccommodationProvided(v === 'yes')}
      />
      <FormInput
        placeholder="Avantages liés à la mobilité (optionnel)"
        value={mobilityBenefits}
        onChangeText={setMobilityBenefits}
        multiline
        numberOfLines={3}
        style={styles.multiline}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title="Enregistrer" onPress={handleSave} loading={isSaving} />
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
