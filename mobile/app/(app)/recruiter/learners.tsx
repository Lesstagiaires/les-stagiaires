import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../../components/badge';
import { Card } from '../../../components/card';
import { ErrorText, FormInput, SecondaryButton } from '../../../components/form';
import { Section } from '../../../components/section';
import { colors, spacing, typography } from '../../../components/theme';
import { api, ApiError, type EstablishmentLearner } from '../../../lib/api';
import { LEARNER_STATUS_LABELS, LEARNER_STATUS_TONE } from '../../../lib/establishment-labels';
import { useAuth } from '../../../lib/auth-context';

export default function LearnersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken, logout } = useAuth();
  const [learners, setLearners] = useState<EstablishmentLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id || !accessToken) return;
    try {
      setLearners(await api.listLearners(accessToken, id));
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
        <Text style={styles.title}>Apprenants</Text>

        {learners === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {learners.length === 0 ? (
              <Text style={styles.emptyText}>Aucun apprenant pour l'instant.</Text>
            ) : (
              learners.map((learner) => (
                <LearnerRow
                  key={learner.id}
                  accessToken={accessToken}
                  establishmentId={id}
                  learner={learner}
                  onChanged={reload}
                />
              ))
            )}
          </View>
        )}

        <InviteLearnerSection accessToken={accessToken} establishmentId={id} onInvited={reload} />

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function LearnerRow({
  accessToken,
  establishmentId,
  learner,
  onChanged,
}: {
  accessToken: string;
  establishmentId: string;
  learner: EstablishmentLearner;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setError(null);
    setBusy(true);
    try {
      await api.verifyLearner(accessToken, establishmentId, learner.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setError(null);
    setBusy(true);
    try {
      await api.revokeLearner(accessToken, establishmentId, learner.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Révocation impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.learnerCard}>
      <View style={styles.learnerHeader}>
        <Text style={typography.bodyBold}>{learner.user.lsId ?? learner.userId}</Text>
        <Badge label={LEARNER_STATUS_LABELS[learner.status]} tone={LEARNER_STATUS_TONE[learner.status]} />
      </View>
      {learner.status === 'ACTIVE' && (
        <Text style={typography.caption}>
          {learner.verifiedAt ? 'Rattachement vérifié' : 'En attente de vérification'}
        </Text>
      )}
      <View style={styles.learnerActions}>
        {learner.status === 'ACTIVE' && !learner.verifiedAt && (
          <SecondaryButton title="Vérifier" onPress={handleVerify} loading={busy} disabled={busy} />
        )}
        {learner.status !== 'REVOKED' && (
          <Text style={styles.revokeText} onPress={busy ? undefined : handleRevoke}>
            Révoquer
          </Text>
        )}
      </View>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function InviteLearnerSection({
  accessToken,
  establishmentId,
  onInvited,
}: {
  accessToken: string;
  establishmentId: string;
  onInvited: () => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    setError(null);
    setIsSaving(true);
    try {
      await api.inviteLearner(accessToken, establishmentId, { phone });
      setPhone('');
      await onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invitation impossible.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Section title="Rattacher un apprenant">
      <Text style={typography.caption}>
        La personne doit déjà avoir un compte LES STAGIAIRES avec ce numéro.
      </Text>
      <FormInput
        placeholder="Téléphone (ex : +237670000000)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
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
  learnerCard: {
    gap: spacing.xs,
  },
  learnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  learnerActions: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  revokeText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '700',
  },
});
