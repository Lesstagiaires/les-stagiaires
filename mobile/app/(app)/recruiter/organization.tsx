import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
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
      setLoadError(found ? null : 'Organisation introuvable.');
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setLoadError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, id, logout]);

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
          <ErrorText>{loadError ?? 'Organisation indisponible.'}</ErrorText>
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
            <Text style={typography.body}>
              Tant que cette organisation n'est pas vérifiée par l'équipe LES STAGIAIRES,
              vos offres ne peuvent pas être publiées ni reprises.
            </Text>
          </Card>
        )}

        <View style={styles.quickLinks}>
          <PressableCard
            style={styles.quickLinkCard}
            onPress={() => router.push(`/recruiter/team?id=${organization.id}`)}
          >
            <Text style={styles.quickLinkTitle}>Équipe</Text>
            <Text style={typography.caption}>Inviter et gérer les collaborateurs.</Text>
          </PressableCard>
          <PressableCard
            style={styles.quickLinkCard}
            onPress={() => router.push(`/recruiter/needs?id=${organization.id}`)}
          >
            <Text style={styles.quickLinkTitle}>Besoins spéciaux</Text>
            <Text style={typography.caption}>Saisonnier, bénévolat, temporaire.</Text>
          </PressableCard>
        </View>

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
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title="Page publique">
      <FormInput
        placeholder="Présentation de l'organisation"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        style={styles.multiline}
      />
      <FormInput placeholder="Site web (https://…)" value={website} onChangeText={setWebsite} />
      <FormInput placeholder="URL du logo (https://…)" value={logoUrl} onChangeText={setLogoUrl} />
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
