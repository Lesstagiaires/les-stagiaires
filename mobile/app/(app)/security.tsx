import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/badge';
import { Card } from '../../components/card';
import { ErrorText, FormInput, PrimaryButton, SecondaryButton } from '../../components/form';
import { Section } from '../../components/section';
import { colors, spacing, typography } from '../../components/theme';
import { api, ApiError, type Session } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function SecurityScreen() {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('common.connectionError'));
    }
  }, [accessToken, logout, t]);

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

        <Section title={t('security.devicesTitle')}>
          <Text style={typography.caption}>{t('security.devicesDescription')}</Text>
          {sessions.length === 0 ? (
            <Text style={typography.caption}>{t('security.noDevices')}</Text>
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
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('security.enableError'));
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
      setError(err instanceof ApiError ? err.message : t('security.disableError'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Section title={t('security.twoFactorTitle')}>
      <View style={styles.statusRow}>
        <Text style={typography.body}>{t('security.twoFactorDescription')}</Text>
        <Badge
          label={enabled ? t('security.enabled') : t('security.disabled')}
          tone={enabled ? 'success' : 'neutral'}
        />
      </View>

      {enabled ? (
        <>
          <FormInput
            placeholder={t('security.disablePasswordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <ErrorText>{error}</ErrorText>
          <SecondaryButton
            title={t('security.disable')}
            onPress={handleDisable}
            loading={isBusy}
            disabled={!password}
          />
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <PrimaryButton title={t('security.enable')} onPress={handleEnable} loading={isBusy} />
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
  const { t, i18n } = useTranslation();
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setError(null);
    setIsRevoking(true);
    try {
      await api.revokeSession(accessToken, session.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('security.revokeError'));
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <Card style={styles.sessionCard}>
      <Text style={typography.bodyBold}>{session.deviceLabel}</Text>
      <Text style={typography.caption}>
        {t('security.lastActivity', {
          date: new Date(session.lastUsedAt).toLocaleString(i18n.language),
        })}
      </Text>
      {isRevoking ? (
        <ActivityIndicator color={colors.error} />
      ) : (
        <Text style={styles.revokeText} onPress={handleRevoke}>
          {t('security.disconnectDevice')}
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
