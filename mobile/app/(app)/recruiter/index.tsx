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
import { Badge } from '../../../components/badge';
import { Card, PressableCard } from '../../../components/card';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { colors, spacing, typography } from '../../../components/theme';
import {
  api,
  ApiError,
  type HeldRole,
  type Organization,
  type OrganizationInvitation,
} from '../../../lib/api';
import {
  MEMBER_ROLE_LABELS,
  ORGANIZATION_VERIFICATION_LABELS,
  ORGANIZATION_VERIFICATION_TONE,
} from '../../../lib/organization-labels';
import { useAuth } from '../../../lib/auth-context';

export default function RecruiterHomeScreen() {
  const router = useRouter();
  const { accessToken, logout } = useAuth();
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
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, [accessToken, logout]);

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
        <Text style={styles.screenTitle}>Espace recruteur</Text>

        {invitations.length > 0 && (
          <InvitationsSection accessToken={accessToken} invitations={invitations} onChanged={reload} />
        )}

        {organizations.length === 0 && invitations.length === 0 && !isOrgEligible && (
          <View style={styles.emptyState}>
            <Text style={typography.body}>
              La création d'une organisation nécessite la casquette Entreprise ou
              Établissement.
            </Text>
            <PrimaryButton
              title="Ajouter cette casquette dans mon profil"
              onPress={() => router.push('/profile')}
            />
          </View>
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
                    label={ORGANIZATION_VERIFICATION_LABELS[organization.verificationStatus]}
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
              <Text style={styles.quickLinkTitle}>Mes offres</Text>
              <Text style={typography.caption}>Créer et gérer vos offres publiées.</Text>
            </PressableCard>
            <PressableCard
              style={styles.quickLinkCard}
              onPress={() => router.push('/recruiter/applications')}
            >
              <Text style={styles.quickLinkTitle}>Candidatures reçues</Text>
              <Text style={typography.caption}>Traiter les candidatures à vos offres.</Text>
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
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.invitationsList}>
      <Text style={typography.h3}>Invitations reçues</Text>
      {invitations.map((invitation) => (
        <Card key={invitation.id} style={styles.invitationCard}>
          <Text style={typography.bodyBold}>{invitation.organization.name}</Text>
          <Text style={typography.caption}>
            Rôle proposé : {MEMBER_ROLE_LABELS[invitation.role]}
          </Text>
          <View style={styles.invitationActions}>
            <View style={styles.invitationButton}>
              <PrimaryButton
                title="Accepter"
                onPress={() => respond(invitation, true)}
                loading={busyId === invitation.id}
                disabled={busyId !== null && busyId !== invitation.id}
              />
            </View>
            <View style={styles.invitationButton}>
              <SecondaryButton
                title="Refuser"
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
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setIsSaving(true);
    try {
      await api.createOrganization(accessToken, {
        name,
        sector: sector || undefined,
        country,
        city,
      });
      setName('');
      setSector('');
      setCountry('');
      setCity('');
      setIsOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <PrimaryButton title="+ Nouvelle organisation" onPress={() => setIsOpen(true)} />
    );
  }

  return (
    <View style={styles.form}>
      <Text style={typography.h3}>Nouvelle organisation</Text>
      <FormInput placeholder="Nom de l'organisation" value={name} onChangeText={setName} />
      <FormInput placeholder="Secteur (optionnel)" value={sector} onChangeText={setSector} />
      <FormInput placeholder="Pays" value={country} onChangeText={setCountry} />
      <FormInput placeholder="Ville" value={city} onChangeText={setCity} />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        title="Créer"
        onPress={handleCreate}
        loading={isSaving}
        disabled={!name.trim() || !country.trim() || !city.trim()}
      />
      <Text style={styles.cancelText} onPress={() => setIsOpen(false)}>
        Annuler
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
  emptyState: {
    gap: spacing.md,
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
