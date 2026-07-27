import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PressableCard } from '../../components/card';
import { ErrorText } from '../../components/form';
import { colors, spacing, typography } from '../../components/theme';
import { api, ApiError, type AppNotification } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

// Un seul type de notification existe aujourd'hui (nouvelle demande de partenariat) ; un
// type inconnu (client plus ancien qu'une notification récente) retombe sur son identifiant
// brut plutôt que de faire planter l'écran.
function describeNotification(
  t: (key: string, options?: Record<string, unknown>) => string,
  notification: AppNotification,
): string {
  if (notification.type === 'PARTNERSHIP_REQUEST_NEW') {
    return t('notifications.partnershipRequestNew', {
      organizationName: notification.metadata?.organizationName ?? '',
    });
  }
  return notification.type;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      setNotifications(await api.listNotifications(accessToken));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : t('notifications.loadError'));
    }
  }, [accessToken, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function handlePress(notification: AppNotification) {
    if (!accessToken) return;
    if (!notification.readAt) {
      try {
        await api.markNotificationRead(accessToken, notification.id);
        void reload();
      } catch {
        // Erreur silencieuse : la navigation reste utile même si le marquage lu échoue,
        // l'utilisateur peut réessayer en revenant sur l'écran.
      }
    }
    if (notification.type === 'PARTNERSHIP_REQUEST_NEW' && notification.metadata?.requestId) {
      router.push(`/partnership-requests/${notification.metadata.requestId}`);
    }
  }

  if (!accessToken) return null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('notifications.title')}</Text>

        {notifications === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : notifications.length === 0 ? (
          <Text style={styles.emptyText}>{t('notifications.empty')}</Text>
        ) : (
          <View style={styles.list}>
            {notifications.map((notification) => (
              <PressableCard
                key={notification.id}
                style={styles.card}
                onPress={() => handlePress(notification)}
              >
                <Text style={notification.readAt ? typography.body : typography.bodyBold}>
                  {describeNotification(t, notification)}
                </Text>
                <Text style={typography.caption}>
                  {new Date(notification.createdAt).toLocaleString(i18n.language)}
                </Text>
              </PressableCard>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.xs,
  },
});
