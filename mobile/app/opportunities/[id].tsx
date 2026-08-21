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
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/badge';
import { ChipSelect } from '../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../components/form';
import { Card } from '../../components/card';
import { colors, spacing, typography } from '../../components/theme';
import {
  api,
  ApiError,
  type Opportunity,
  type ReportCategory,
} from '../../lib/api';
import { useOpportunityTypeLabels, useWorkModeLabels } from '../../lib/opportunity-labels';
import { useReportCategoryLabels } from '../../lib/report-labels';
import { useAuth } from '../../lib/auth-context';

export default function OpportunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const opportunityTypeLabels = useOpportunityTypeLabels();
  const workModeLabels = useWorkModeLabels();

  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFavoriteBusy, setIsFavoriteBusy] = useState(false);

  // CONSULTATION PUBLIQUE (V6-2). Le jeton n'est plus une condition d'entrée :
  // `getOpportunity` l'accepte déjà comme facultatif, et le serveur ne s'en sert
  // que pour ÉLARGIR la visibilité — un membre de l'organisation publiante voit
  // ses offres non publiées. Un visiteur, lui, n'obtient que les offres
  // publiquement visibles, sinon un 404 : la garde est fermée par défaut, côté
  // serveur, et rien ici ne peut l'ouvrir.
  //
  // Les favoris, eux, restent une donnée personnelle : on ne les demande que
  // lorsqu'il y a quelqu'un à qui ils appartiennent.
  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, favorites] = await Promise.all([
        // `?? undefined` : le contexte d'authentification rend `null` pour un
        // visiteur, quand la signature attend un jeton facultatif.
        api.getOpportunity(id, accessToken ?? undefined),
        accessToken ? api.listFavorites(accessToken) : Promise.resolve([]),
      ]);
      setOpportunity(detail);
      setIsFavorite(favorites.some((f) => f.opportunityId === id));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : t('common.connectionError'));
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

  // `!accessToken` a disparu de cette condition : une offre publiée se consulte
  // sans compte. Une offre introuvable — ou non publiée pour un visiteur — passe
  // toujours par ici, avec le même message.
  if (loadError || !opportunity || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('opportunities.detail.notFound')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Badge label={opportunityTypeLabels[opportunity.type]} tone="primary" />
          {/* Le favori est une donnée personnelle : sans compte, l'action n'est
              pas rendue. Jamais offerte puis refusée. */}
          {accessToken && (
            <Pressable onPress={handleToggleFavorite} disabled={isFavoriteBusy} hitSlop={8}>
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={26}
                color={isFavorite ? colors.accentDark : colors.muted}
              />
            </Pressable>
          )}
        </View>

        <Text style={styles.title}>{opportunity.title}</Text>
        <Text style={styles.organization}>
          {opportunity.organization.name}
          {opportunity.organization.verificationStatus === 'VERIFIED' && (
            <Text style={styles.verified}>  ✓ {t('opportunities.detail.verifiedOrg')}</Text>
          )}
        </Text>

        <Card style={styles.infoCard}>
          <InfoRow icon="location-outline" label={`${opportunity.city}, ${opportunity.country}`} />
          <InfoRow icon="briefcase-outline" label={workModeLabels[opportunity.workMode]} />
          <InfoRow icon="grid-outline" label={opportunity.sector} />
          {opportunity.relocationRequired && (
            <InfoRow icon="airplane-outline" label={t('opportunities.detail.relocationRequired')} />
          )}
          {opportunity.accommodationProvided && (
            <InfoRow icon="home-outline" label={t('opportunities.detail.accommodationProvided')} />
          )}
        </Card>

        <Text style={styles.sectionTitle}>{t('opportunities.detail.descriptionTitle')}</Text>
        <Text style={styles.description}>{opportunity.description}</Text>

        {!!opportunity.mobilityBenefits && (
          <>
            <Text style={styles.sectionTitle}>{t('opportunities.detail.mobilityBenefitsTitle')}</Text>
            <Text style={styles.description}>{opportunity.mobilityBenefits}</Text>
          </>
        )}

        {/* CANDIDATURE ET SIGNALEMENT — LA FRONTIÈRE DE V6-2.
            Consulter est public ; s'engager ne l'est pas. Sans jeton, ces deux
            sections ne sont pas rendues : elles cèdent la place à une invitation
            à rejoindre la plateforme. Aucune requête n'est tentée puis rejetée,
            et les routes serveur restent gardées de toute façon. */}
        {accessToken ? (
          <>
            <ApplySection
              accessToken={accessToken}
              opportunity={opportunity}
              onApplied={(applicationId) => router.push(`/applications/${applicationId}`)}
            />
            <ReportSection accessToken={accessToken} opportunityId={id} />
          </>
        ) : (
          <Card style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>{t('opportunities.detail.invite.title')}</Text>
            <Text style={styles.inviteBody}>{t('opportunities.detail.invite.body')}</Text>
            <PrimaryButton
              title={t('opportunities.detail.invite.register')}
              onPress={() => router.push('/(auth)/register')}
            />
            <SecondaryButton
              title={t('opportunities.detail.invite.login')}
              onPress={() => router.push('/(auth)/login')}
            />
          </Card>
        )}
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
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('opportunities.detail.apply.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <PrimaryButton title={t('opportunities.detail.apply.button')} onPress={() => setIsOpen(true)} />
    );
  }

  const canSubmit = !opportunity.relocationRequired || willingToRelocate !== null;
  const yesNoOptions = [
    { value: 'yes', label: t('common.yes') },
    { value: 'no', label: t('common.no') },
  ];

  return (
    <View style={styles.applyForm}>
      <Text style={styles.sectionTitle}>{t('opportunities.detail.apply.confirmTitle')}</Text>
      <Text style={styles.description}>{t('opportunities.detail.apply.confirmHint')}</Text>

      {opportunity.relocationRequired && (
        <>
          <Text style={typography.bodyBold}>
            {t('opportunities.detail.apply.relocateQuestion')}
          </Text>
          <ChipSelect
            options={yesNoOptions}
            value={willingToRelocate === null ? null : willingToRelocate ? 'yes' : 'no'}
            onChange={(value) => setWillingToRelocate(value === 'yes')}
          />
          <Text style={typography.bodyBold}>{t('opportunities.detail.apply.familyQuestion')}</Text>
          <ChipSelect
            options={yesNoOptions}
            value={
              hasFamilyInDestination === null ? null : hasFamilyInDestination ? 'yes' : 'no'
            }
            onChange={(value) => setHasFamilyInDestination(value === 'yes')}
          />
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('opportunities.detail.apply.submit')}
        onPress={handleSubmit}
        loading={isSubmitting}
        disabled={!canSubmit}
      />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
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
  const { t } = useTranslation();
  const reportCategoryLabels = useReportCategoryLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const categoryOptions = (
    Object.entries(reportCategoryLabels) as [ReportCategory, string][]
  ).map(([value, label]) => ({ value, label }));

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.reportOpportunity(accessToken, opportunityId, category, description);
      setIsSubmitted(true);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opportunities.detail.report.error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitted) {
    return (
      <Text style={styles.reportConfirmation}>{t('opportunities.detail.report.confirmation')}</Text>
    );
  }

  if (!isOpen) {
    return (
      <Pressable onPress={() => setIsOpen(true)}>
        <Text style={styles.reportLink}>{t('opportunities.detail.report.link')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.reportForm}>
      <Text style={styles.sectionTitle}>{t('opportunities.detail.report.link')}</Text>
      <ChipSelect
        options={categoryOptions}
        value={category}
        onChange={(value) => setCategory(value as ReportCategory)}
      />
      <FormInput
        placeholder={t('opportunities.detail.report.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
        style={styles.reportInput}
      />
      <ErrorText>{error}</ErrorText>
      <SecondaryButton
        title={t('opportunities.detail.report.submit')}
        onPress={handleSubmit}
        loading={isSubmitting}
        disabled={description.trim().length < 10}
      />
      <Pressable onPress={() => setIsOpen(false)}>
        <Text style={styles.cancelText}>{t('common.cancel')}</Text>
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
  inviteCard: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  inviteTitle: {
    ...typography.h3,
    color: colors.text,
  },
  inviteBody: {
    ...typography.body,
    color: colors.textSecondary,
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
