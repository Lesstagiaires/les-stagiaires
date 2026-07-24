import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge } from '../../../components/badge';
import { ChipSelect } from '../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { Card } from '../../../components/card';
import { colors, spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type Opportunity,
  type ReportCategory,
} from '../../../lib/api';
import { OPPORTUNITY_TYPE_LABELS, WORK_MODE_LABELS } from '../../../lib/opportunity-labels';
import { useAuth } from '../../../lib/auth-context';

const REPORT_CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harcèlement' },
  { value: 'ABUSE', label: 'Abus' },
  { value: 'DANGER', label: 'Danger' },
  { value: 'FRAUD', label: 'Fraude' },
  { value: 'OTHER', label: 'Autre' },
];

export default function OpportunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, logout } = useAuth();

  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFavoriteBusy, setIsFavoriteBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      const [detail, favorites] = await Promise.all([
        api.getOpportunity(id, accessToken),
        api.listFavorites(accessToken),
      ]);
      setOpportunity(detail);
      setIsFavorite(favorites.some((f) => f.opportunityId === id));
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

  async function handleToggleFavorite() {
    if (!accessToken || !id) return;
    setIsFavoriteBusy(true);
    try {
      if (isFavorite) await api.removeFavorite(accessToken, id);
      else await api.addFavorite(accessToken, id);
      setIsFavorite(!isFavorite);
    } catch {
      // Erreur silencieuse : l'état affiché ne change pas, l'utilisateur peut réessayer.
    } finally {
      setIsFavoriteBusy(false);
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
          <Badge label={OPPORTUNITY_TYPE_LABELS[opportunity.type]} tone="primary" />
          <Pressable onPress={handleToggleFavorite} disabled={isFavoriteBusy} hitSlop={8}>
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={26}
              color={isFavorite ? colors.accentDark : colors.muted}
            />
          </Pressable>
        </View>

        <Text style={styles.title}>{opportunity.title}</Text>
        <Text style={styles.organization}>
          {opportunity.organization.name}
          {opportunity.organization.verificationStatus === 'VERIFIED' && (
            <Text style={styles.verified}>  ✓ Organisation vérifiée</Text>
          )}
        </Text>

        <Card style={styles.infoCard}>
          <InfoRow icon="location-outline" label={`${opportunity.city}, ${opportunity.country}`} />
          <InfoRow icon="briefcase-outline" label={WORK_MODE_LABELS[opportunity.workMode]} />
          <InfoRow icon="grid-outline" label={opportunity.sector} />
          {opportunity.relocationRequired && (
            <InfoRow icon="airplane-outline" label="Déplacement requis" />
          )}
          {opportunity.accommodationProvided && (
            <InfoRow icon="home-outline" label="Hébergement fourni" />
          )}
        </Card>

        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.description}>{opportunity.description}</Text>

        {!!opportunity.mobilityBenefits && (
          <>
            <Text style={styles.sectionTitle}>Avantages liés à la mobilité</Text>
            <Text style={styles.description}>{opportunity.mobilityBenefits}</Text>
          </>
        )}

        <ApplySection
          accessToken={accessToken}
          opportunity={opportunity}
          onApplied={(applicationId) => router.push(`/applications/${applicationId}`)}
        />

        <ReportSection accessToken={accessToken} opportunityId={id} />
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={colors.primaryDark} />
      <Text style={styles.infoText}>{label}</Text>
    </View>
  );
}

function ApplySection({
  accessToken,
  opportunity,
  onApplied,
}: {
  accessToken: string;
  opportunity: Opportunity;
  onApplied: (applicationId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [willingToRelocate, setWillingToRelocate] = useState<boolean | null>(null);
  const [hasFamilyInDestination, setHasFamilyInDestination] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      const application = await api.createApplication(accessToken, {
        opportunityId: opportunity.id,
        willingToRelocate: opportunity.relocationRequired ? willingToRelocate ?? undefined : undefined,
        hasFamilyInDestination: opportunity.relocationRequired
          ? hasFamilyInDestination ?? undefined
          : undefined,
      });
      onApplied(application.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Candidature impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return <PrimaryButton title="Postuler" onPress={() => setIsOpen(true)} />;
  }

  const canSubmit = !opportunity.relocationRequired || willingToRelocate !== null;

  return (
    <View style={styles.applyForm}>
      <Text style={styles.sectionTitle}>Confirmer ma candidature</Text>
      <Text style={styles.description}>
        Votre dossier (profil, CV, langues, expériences) sera envoyé tel quel à
        l'organisation.
      </Text>

      {opportunity.relocationRequired && (
        <>
          <Text style={typography.bodyBold}>Êtes-vous prêt(e) à déménager ?</Text>
          <ChipSelect
            options={[
              { value: 'yes', label: 'Oui' },
              { value: 'no', label: 'Non' },
            ]}
            value={willingToRelocate === null ? null : willingToRelocate ? 'yes' : 'no'}
            onChange={(value) => setWillingToRelocate(value === 'yes')}
          />
          <Text style={typography.bodyBold}>Avez-vous de la famille sur place ?</Text>
          <ChipSelect
            options={[
              { value: 'yes', label: 'Oui' },
              { value: 'no', label: 'Non' },
            ]}
            value={
              hasFamilyInDestination === null ? null : hasFamilyInDestination ? 'yes' : 'no'
            }
            onChange={(value) => setHasFamilyInDestination(value === 'yes')}
          />
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Envoyer ma candidature"
        onPress={handleSubmit}
        loading={isSubmitting}
        disabled={!canSubmit}
      />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>Annuler</Text>
      </Pressable>
    </View>
  );
}

function ReportSection({
  accessToken,
  opportunityId,
}: {
  accessToken: string;
  opportunityId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.reportOpportunity(accessToken, opportunityId, category, description);
      setIsSubmitted(true);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitted) {
    return <Text style={styles.reportConfirmation}>Signalement envoyé, merci.</Text>;
  }

  if (!isOpen) {
    return (
      <Pressable onPress={() => setIsOpen(true)}>
        <Text style={styles.reportLink}>Signaler cette offre</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.reportForm}>
      <Text style={styles.sectionTitle}>Signaler cette offre</Text>
      <ChipSelect
        options={REPORT_CATEGORY_OPTIONS}
        value={category}
        onChange={(value) => setCategory(value as ReportCategory)}
      />
      <FormInput
        placeholder="Décrivez le problème (10 caractères minimum)"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        style={styles.reportInput}
      />
      <ErrorText>{error}</ErrorText>
      <SecondaryButton
        title="Envoyer le signalement"
        onPress={handleSubmit}
        loading={isSubmitting}
        disabled={description.trim().length < 10}
      />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>Annuler</Text>
      </Pressable>
    </View>
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
  },
  title: {
    ...typography.h1,
    marginTop: spacing.xs,
  },
  organization: {
    ...typography.body,
    color: colors.textSecondary,
  },
  verified: {
    color: colors.success,
    fontWeight: '700',
  },
  infoCard: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoText: {
    ...typography.body,
  },
  sectionTitle: {
    ...typography.h3,
    marginTop: spacing.md,
  },
  description: {
    ...typography.body,
    lineHeight: 22,
  },
  reportLink: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  reportConfirmation: {
    ...typography.caption,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  reportForm: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  applyForm: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reportInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
  },
});
