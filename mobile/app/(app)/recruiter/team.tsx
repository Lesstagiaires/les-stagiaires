import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ChipSelect } from '../../../components/chip-select';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type OrganizationMember, type OrganizationMemberRole } from '../../../lib/api';
import {
  MEMBER_ROLE_LABELS,
  MEMBER_ROLE_OPTIONS,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUS_TONE,
} from '../../../lib/organization-labels';
import { useAuth } from '../../../lib/auth-context';

export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setMembers(await api.listTeam(accessToken, id));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, [id, accessToken, logout]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!accessToken || !id) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ErrorText>Organisation indisponible.</ErrorText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Équipe</Text>

        {members === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {members.length === 0 ? (
              <Text style={styles.emptyText}>Aucun membre pour l'instant.</Text>
            ) : (
              members.map((member) => (
                <MemberRow
                  key={member.id}
                  accessToken={accessToken}
                  organizationId={id}
                  member={member}
                  onChanged={reload}
                />
              ))
            )}
          </View>
        )}

        <InviteSection accessToken={accessToken} organizationId={id} onInvited={reload} />

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberRow({
  accessToken,
  organizationId,
  member,
  onChanged,
}: {
  accessToken: string;
  organizationId: string;
  member: OrganizationMember;
  onChanged: () => Promise<void>;
}) {
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setError(null);
    setIsRevoking(true);
    try {
      await api.revokeMember(accessToken, organizationId, member.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Révocation impossible.');
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <Card style={styles.memberCard}>
      <View style={styles.memberHeader}>
        <Text style={typography.bodyBold}>{member.user.lsId ?? member.userId}</Text>
        <Badge label={MEMBER_STATUS_LABELS[member.status]} tone={MEMBER_STATUS_TONE[member.status]} />
      </View>
      <Text style={typography.caption}>{MEMBER_ROLE_LABELS[member.role]}</Text>
      {member.status !== 'REVOKED' && (
        <Text style={styles.revokeText} onPress={isRevoking ? undefined : handleRevoke}>
          {isRevoking ? 'Révocation…' : "Révoquer l'accès"}
        </Text>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function InviteSection({
  accessToken,
  organizationId,
  onInvited,
}: {
  accessToken: string;
  organizationId: string;
  onInvited: () => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<OrganizationMemberRole>('RECRUITER');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    setError(null);
    setIsSaving(true);
    try {
      await api.inviteMember(accessToken, organizationId, { phone, role });
      setPhone('');
      await onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invitation impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title="Inviter un collaborateur">
      <Text style={typography.caption}>
        La personne doit déjà avoir un compte LES STAGIAIRES avec ce numéro.
      </Text>
      <FormInput
        placeholder="Téléphone (ex : +237670000000)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <ChipSelect options={MEMBER_ROLE_OPTIONS} value={role} onChange={(v) => setRole(v as OrganizationMemberRole)} />
      <ErrorText>{error}</ErrorText>
      <SecondaryButton
        title="Envoyer l'invitation"
        onPress={handleInvite}
        loading={isSaving}
        disabled={!phone.trim()}
      />
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
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  emptyText: {
    ...typography.caption,
  },
  list: {
    gap: spacing.sm,
  },
  memberCard: {
    gap: spacing.xs,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  revokeText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
});
