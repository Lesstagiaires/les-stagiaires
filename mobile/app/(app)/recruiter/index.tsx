import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../../components/badge';
import { Card, PressableCard } from '../../../components/card';
import { ChipSelect } from '../../../components/chip-select';
import { EmptyState } from '../../../components/empty-state';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import {
  ACQUISITION_SOURCES,
  api,
  ApiError,
  type HeldRole,
  type Organization,
  type OrganizationAcquisitionSource,
  type OrganizationInvitation,
} from '../../../lib/api';
import {
  useMemberRoleLabels,
  useOrganizationVerificationLabels,
  ORGANIZATION_VERIFICATION_TONE,
} from '../../../lib/organization-labels';
import { useAuth } from '../../../lib/auth-context';

export default function RecruiterHomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const organizationVerificationLabels = useOrganizationVerificationLabels();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [heldRoles, setHeldRoles] = useState<HeldRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [orgs, roles, myInvitations] = await Promise.all([
        api.listMyOrganizations(accessToken),
        api.getRoleHistory(accessToken),
        api.listMyInvitations(accessToken),
      ]);
      setOrganizations(orgs);
      setHeldRoles(roles.filter((entry) => entry.isActive));
      setInvitations(myInvitations);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('recruiter.home.loadError'));
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const isOrgEligible = heldRoles.some(
    (entry) => entry.role.name === 'ENTREPRISE' || entry.role.name === 'ETABLISSEMENT',
  );

  if (!accessToken || organizations === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.screenTitle}>{t('recruiter.home.title')}</Text>

        {invitations.length > 0 && (
          <InvitationsSection accessToken={accessToken} invitations={invitations} onChanged={reload} />
        )}

        {organizations.length === 0 && invitations.length === 0 && !isOrgEligible && (
          <EmptyState
            message={t('recruiter.home.noOrgNotice')}
            actionLabel={t('recruiter.home.addRoleButton')}
            onAction={() => router.push('/profile')}
          />
        )}

        {organizations.length > 0 && (
          <View style={styles.orgList}>
            {organizations.map((organization) => (
              <PressableCard
                key={organization.id}
                style={styles.orgCard}
                onPress={() => router.push(`/recruiter/organization?id=${organization.id}`)}
              >
                <View style={styles.orgHeader}>
                  <Text style={styles.orgName}>{organization.name}</Text>
                  <Badge
                    label={organizationVerificationLabels[organization.verificationStatus]}
                    tone={ORGANIZATION_VERIFICATION_TONE[organization.verificationStatus]}
                  />
                </View>
                {!!organization.orgId && (
                  <Text style={styles.orgId}>{organization.orgId}</Text>
                )}
                <Text style={styles.orgLocation}>
                  {organization.city}, {organization.country}
                </Text>
              </PressableCard>
            ))}
          </View>
        )}

        {organizations.length > 0 && (
          <View style={styles.quickLinks}>
            <PressableCard
              style={styles.quickLinkCard}
              onPress={() => router.push('/recruiter/opportunities')}
            >
              <Text style={styles.quickLinkTitle}>{t('recruiter.layout.myOpportunities')}</Text>
              <Text style={typography.caption}>{t('recruiter.home.myOpportunitiesHint')}</Text>
            </PressableCard>
            <PressableCard
              style={styles.quickLinkCard}
              onPress={() => router.push('/recruiter/applications')}
            >
              <Text style={styles.quickLinkTitle}>{t('recruiter.layout.receivedApplications')}</Text>
              <Text style={typography.caption}>{t('recruiter.home.receivedApplicationsHint')}</Text>
            </PressableCard>
          </View>
        )}

        {isOrgEligible && <CreateOrganizationSection accessToken={accessToken} onCreated={reload} />}

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function InvitationsSection({
  accessToken,
  invitations,
  onChanged,
}: {
  accessToken: string;
  invitations: OrganizationInvitation[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const memberRoleLabels = useMemberRoleLabels();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(invitation: OrganizationInvitation, accept: boolean) {
    setError(null);
    setBusyId(invitation.id);
    try {
      if (accept) {
        await api.acceptInvitation(accessToken, invitation.id);
      } else {
        await api.declineInvitation(accessToken, invitation.id);
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.home.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.invitationsList}>
      <Text style={typography.h3}>{t('recruiter.home.invitationsTitle')}</Text>
      {invitations.map((invitation) => (
        <Card key={invitation.id} style={styles.invitationCard}>
          <Text style={typography.bodyBold}>{invitation.organization.name}</Text>
          <Text style={typography.caption}>
            {t('recruiter.home.roleProposed', { role: memberRoleLabels[invitation.role] })}
          </Text>
          <View style={styles.invitationActions}>
            <View style={styles.invitationButton}>
              <PrimaryButton
                title={t('common.accept')}
                onPress={() => respond(invitation, true)}
                loading={busyId === invitation.id}
                disabled={busyId !== null && busyId !== invitation.id}
              />
            </View>
            <View style={styles.invitationButton}>
              <SecondaryButton
                title={t('common.decline')}
                onPress={() => respond(invitation, false)}
                loading={false}
                disabled={busyId !== null}
              />
            </View>
          </View>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function CreateOrganizationSection({
  accessToken,
  onCreated,
}: {
  accessToken: string;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [acquisitionSource, setAcquisitionSource] =
    useState<OrganizationAcquisitionSource | null>(null);
  const [ambassadorCode, setAmbassadorCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acquisitionSourceOptions = ACQUISITION_SOURCES.map((value) => ({
    value,
    label: t(`labels.acquisitionSource.${value}`),
  }));

  async function handleCreate() {
    setError(null);
    setIsSaving(true);
    try {
      await api.createOrganization(accessToken, {
        name,
        sector: sector || undefined,
        country,
        city,
        acquisitionSource: acquisitionSource ?? undefined,
        ambassadorCode: ambassadorCode.trim() || undefined,
      });
      setName('');
      setSector('');
      setCountry('');
      setCity('');
      setAcquisitionSource(null);
      setAmbassadorCode('');
      setIsOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('recruiter.home.createError'));
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <PrimaryButton title={t('recruiter.home.newOrgButton')} onPress={() => setIsOpen(true)} />
    );
  }

  return (
    <View style={styles.form}>
      <Text style={typography.h3}>{t('recruiter.home.newOrgTitle')}</Text>
      <FormInput
        placeholder={t('recruiter.home.orgNamePlaceholder')}
        value={name}
        onChangeText={setName}
      />
      <FormInput
        placeholder={t('recruiter.home.sectorPlaceholder')}
        value={sector}
        onChangeText={setSector}
      />
      <FormInput
        placeholder={t('recruiter.home.countryPlaceholder')}
        value={country}
        onChangeText={setCountry}
      />
      <FormInput
        placeholder={t('recruiter.home.cityPlaceholder')}
        value={city}
        onChangeText={setCity}
      />
      {/* Deux champs qui se ressemblent et ne doivent JAMAIS être confondus.
          Le premier est une statistique ; le second, et lui seul, crée un
          rattachement ouvrant droit à commission (points 9 à 11 des arbitrages du
          2026-07-31). Les libellés le disent explicitement à l'utilisateur. */}
      <Text style={typography.label}>{t('recruiter.home.acquisitionSourceLabel')}</Text>
      <ChipSelect
        options={acquisitionSourceOptions}
        value={acquisitionSource}
        onChange={(value) =>
          setAcquisitionSource(value as OrganizationAcquisitionSource)
        }
      />

      <Text style={typography.label}>{t('recruiter.home.ambassadorCodeLabel')}</Text>
      <FormInput
        placeholder={t('recruiter.home.ambassadorCodePlaceholder')}
        value={ambassadorCode}
        onChangeText={setAmbassadorCode}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={20}
      />
      <Text style={styles.ambassadorHint}>{t('recruiter.home.ambassadorCodeHint')}</Text>

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title={t('recruiter.home.createButton')}
        onPress={handleCreate}
        loading={isSaving}
        disabled={!name.trim() || !country.trim() || !city.trim()}
      />
      <Text style={styles.cancelText} onPress={() => setIsOpen(false)}>
        {t('common.cancel')}
      </Text>
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
    gap: spacing.lg,
  },
  screenTitle: {
    ...typography.h1,
  },
  orgList: {
    gap: spacing.md,
  },
  orgCard: {
    gap: spacing.xs,
  },
  orgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  orgName: {
    ...typography.h3,
    flexShrink: 1,
  },
  orgId: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  orgLocation: {
    ...typography.caption,
  },
  quickLinks: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  quickLinkCard: {
    flex: 1,
    gap: spacing.xs,
  },
  quickLinkTitle: {
    ...typography.bodyBold,
  },
  form: {
    gap: spacing.md,
  },
  cancelText: {
    ...typography.caption,
    textAlign: 'center',
  },
  ambassadorHint: {
    ...typography.caption,
    color: colors.muted,
  },
  invitationsList: {
    gap: spacing.sm,
  },
  invitationCard: {
    gap: spacing.xs,
  },
  invitationActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  invitationButton: {
    flex: 1,
  },
});
