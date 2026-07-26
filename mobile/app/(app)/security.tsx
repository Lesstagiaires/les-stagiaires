import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../components/form';
import { Section } from '../../components/section';
import { colors, spacing, typography } from '../../components/theme';
import { api, ApiError, type Session } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function SecurityScreen() {
  const { accessToken, logout } = useAuth();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [status, sessionList] = await Promise.all([
        api.getTwoFactorStatus(accessToken),
        api.listSessions(accessToken),
      ]);
      setTwoFactorEnabled(status.enabled);
      setSessions(sessionList);
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

  if (!accessToken || twoFactorEnabled === null || sessions === null) {
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
        <TwoFactorSection
          accessToken={accessToken}
          enabled={twoFactorEnabled}
          onChanged={reload}
        />

        <Section title="Appareils connectés">
          <Text style={typography.caption}>
            Ces appareils ont accès à votre compte. Révoquez immédiatement tout appareil
            que vous ne reconnaissez pas.
          </Text>
          {sessions.length === 0 ? (
            <Text style={typography.caption}>Aucun appareil connecté.</Text>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                accessToken={accessToken}
                session={session}
                onChanged={reload}
              />
            ))
          )}
        </Section>

        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </SafeAreaView>
  );
}

function TwoFactorSection({
  accessToken,
  enabled,
  onChanged,
}: {
  accessToken: string;
  enabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setError(null);
    setIsBusy(true);
    try {
      await api.enableTwoFactor(accessToken);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Activation impossible.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDisable() {
    setError(null);
    setIsBusy(true);
    try {
      await api.disableTwoFactor(accessToken, password);
      setPassword('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Désactivation impossible.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Section title="Double authentification">
      <View style={styles.statusRow}>
        <Text style={typography.body}>
          Un code par SMS sera demandé à chaque connexion, en plus du mot de passe.
        </Text>
        <Badge label={enabled ? 'Activée' : 'Désactivée'} tone={enabled ? 'success' : 'neutral'} />
      </View>

      {enabled ? (
        <>
          <FormInput
            placeholder="Mot de passe (pour désactiver)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <ErrorText>{error}</ErrorText>
          <SecondaryButton
            title="Désactiver"
            onPress={handleDisable}
            loading={isBusy}
            disabled={!password}
          />
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <PrimaryButton title="Activer" onPress={handleEnable} loading={isBusy} />
        </>
      )}
    </Section>
  );
}

function SessionRow({
  accessToken,
  session,
  onChanged,
}: {
  accessToken: string;
  session: Session;
  onChanged: () => Promise<void>;
}) {
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setError(null);
    setIsRevoking(true);
    try {
      await api.revokeSession(accessToken, session.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Révocation impossible.');
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <Card style={styles.sessionCard}>
      <Text style={typography.bodyBold}>{session.deviceLabel}</Text>
      <Text style={typography.caption}>
        Dernière activité : {new Date(session.lastUsedAt).toLocaleString('fr-FR')}
      </Text>
      {isRevoking ? (
        <ActivityIndicator color={colors.error} />
      ) : (
        <Text style={styles.revokeText} onPress={handleRevoke}>
          Déconnecter cet appareil
        </Text>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sessionCard: {
    gap: spacing.xs,
  },
  revokeText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
});
