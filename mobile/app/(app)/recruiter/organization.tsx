import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card, PressableCard } from '../../../components/card';
import { ErrorText, FormInput, PrimaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type Organization } from '../../../lib/api';
import {
  ORGANIZATION_VERIFICATION_LABELS,
  ORGANIZATION_VERIFICATION_TONE,
} from '../../../lib/organization-labels';
import { useAuth } from '../../../lib/auth-context';

export default function OrganizationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken || !id) return;
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
  }, [accessToken, id, logout, t]);

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

  if (loadError || !organization || !accessToken) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>{loadError ?? t('recruiter.organization.unavailable')}</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{organization.name}</Text>
          <Badge
            label={ORGANIZATION_VERIFICATION_LABELS[organization.verificationStatus]}
            tone={ORGANIZATION_VERIFICATION_TONE[organization.verificationStatus]}
          />
        </View>
        {!!organization.orgId && <Text style={styles.orgId}>{organization.orgId}</Text>}
        <Text style={typography.caption}>
          {organization.sector ? `${organization.sector} — ` : ''}
          {organization.city}, {organization.country}
        </Text>

        {organization.verificationStatus !== 'VERIFIED' && (
          <Card style={styles.noticeCard}>
            <Text style={typography.body}>{t('recruiter.organization.notVerifiedNotice')}</Text>
          </Card>
        )}

        <View style={styles.quickLinks}>
          <PressableCard
            style={styles.quickLinkCard}
            onPress={() => router.push(`/recruiter/team?id=${organization.id}`)}
          >
            <Text style={styles.quickLinkTitle}>{t('recruiter.layout.team')}</Text>
            <Text style={typography.caption}>{t('recruiter.organization.teamHint')}</Text>
          </PressableCard>
          <PressableCard
            style={styles.quickLinkCard}
            onPress={() => router.push(`/recruiter/needs?id=${organization.id}`)}
          >
            <Text style={styles.quickLinkTitle}>{t('recruiter.layout.needs')}</Text>
            <Text style={typography.caption}>{t('recruiter.organization.needsHint')}</Text>
          </PressableCard>
        </View>

        {organization.type === 'ETABLISSEMENT' && (
          <>
            <View style={styles.quickLinks}>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/learners?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.learners')}</Text>
                <Text style={typography.caption}>{t('recruiter.organization.learnersHint')}</Text>
              </PressableCard>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/campaigns?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.campaigns')}</Text>
                <Text style={typography.caption}>{t('recruiter.organization.campaignsHint')}</Text>
              </PressableCard>
            </View>
            <View style={styles.quickLinks}>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/learner-applications?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.learnerApplications')}</Text>
                <Text style={typography.caption}>
                  {t('recruiter.organization.learnerApplicationsHint')}
                </Text>
              </PressableCard>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/reports?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.reports')}</Text>
                <Text style={typography.caption}>{t('recruiter.organization.reportsHint')}</Text>
              </PressableCard>
            </View>
            <View style={styles.quickLinks}>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/dashboard?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.dashboard')}</Text>
                <Text style={typography.caption}>{t('recruiter.organization.dashboardHint')}</Text>
              </PressableCard>
              <PressableCard
                style={styles.quickLinkCard}
                onPress={() => router.push(`/recruiter/partners?id=${organization.id}`)}
              >
                <Text style={styles.quickLinkTitle}>{t('recruiter.layout.partners')}</Text>
                <Text style={typography.caption}>{t('recruiter.organization.partnersHint')}</Text>
              </PressableCard>
            </View>
          </>
        )}

        <PageForm accessToken={accessToken} organization={organization} onSaved={reload} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PageForm({
  accessToken,
  organization,
  onSaved,
}: {
  accessToken: string;
  organization: Organization;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(organization.description ?? '');
  const [website, setWebsite] = useState(organization.website ?? '');
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(organization.description ?? '');
    setWebsite(organization.website ?? '');
    setLogoUrl(organization.logoUrl ?? '');
  }, [organization]);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.updateOrganizationPage(accessToken, organization.id, {
        description: description || undefined,
        website: website || undefined,
        logoUrl: logoUrl || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.organization.page.saveError'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title={t('recruiter.organization.page.sectionTitle')}>
      <FormInput
        placeholder={t('recruiter.organization.page.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={styles.multiline}
      />
      <FormInput
        placeholder={t('recruiter.organization.page.websitePlaceholder')}
        value={website}
        onChangeText={setWebsite}
      />
      <FormInput
        placeholder={t('recruiter.organization.page.logoPlaceholder')}
        value={logoUrl}
        onChangeText={setLogoUrl}
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
  orgId: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  noticeCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.accentLight,
  },
  quickLinks: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  quickLinkCard: {
    flex: 1,
    gap: spacing.xs,
  },
  quickLinkTitle: {
    ...typography.bodyBold,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
});
