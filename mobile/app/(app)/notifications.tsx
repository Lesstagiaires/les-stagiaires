import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge } from '../../components/badge';
import { ChipSelect } from '../../components/chip-select';
import { EmptyState } from '../../components/empty-state';
import { colors, ErrorText, FormInput } from '../../components/form';
import { radius, spacing, typography } from '../../components/theme';
import {
  api,
  ApiError,
  type AppNotification,
  type NotificationCategory,
  type NotificationCounts,
} from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import {
  CATEGORY_TONE,
  useCategoryLabels,
  useNotificationRenderer,
} from '../../lib/notification-labels';

// Les quatre vues du Centre. « Archivées » est une VUE et non une suppression :
// l'historique complet exigé par le promoteur interdit de perdre quoi que ce soit.
type CentreView = 'all' | 'unread' | 'starred' | 'archived';

const CATEGORIES: NotificationCategory[] = [
  'APPLICATIONS',
  'INTERVIEWS',
  'INTERNSHIPS',
  'AGREEMENTS',
  'ORGANIZATIONS',
  'AMBASSADORS',
  'PAYMENTS',
  'PARTNERSHIPS',
  'MENTORING',
  'LEGAL',
  'SUBSCRIPTIONS',
  'ADMINISTRATION',
  'SECURITY',
  'SYSTEM',
];

export default function NotificationCentreScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { accessToken, logout } = useAuth();
  const render = useNotificationRenderer();
  const categoryLabel = useCategoryLabels();

  const [view, setView] = useState<CentreView>('all');
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<NotificationCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const buildFilters = useCallback(
    (cursor?: string) => ({
      category: category ?? undefined,
      unreadOnly: view === 'unread' || undefined,
      starredOnly: view === 'starred' || undefined,
      includeArchived: view === 'archived' || undefined,
      // Sous deux caractères, le serveur ignore la recherche : inutile de la lui
      // envoyer.
      search: search.trim().length >= 2 ? search.trim() : undefined,
      cursor,
    }),
    [category, view, search],
  );

  const reload = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [page, freshCounts] = await Promise.all([
        api.listNotifications(accessToken, buildFilters()),
        api.notificationCounts(accessToken),
      ]);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setCounts(freshCounts);
      setError(null);
    } catch (err) {
      // Toujours sortir de l'état « chargement », même en erreur — sinon le
      // spinner tourne indéfiniment au lieu d'afficher le message.
      setItems([]);
      if (err instanceof ApiError && err.statusCode === 401) {
        void logout();
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : t('notificationCentre.loadError'),
      );
    }
  }, [accessToken, buildFilters, logout, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function loadMore() {
    if (!accessToken || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await api.listNotifications(
        accessToken,
        buildFilters(nextCursor),
      );
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Un échec de pagination ne doit pas effacer ce qui est déjà affiché.
      setNextCursor(null);
    } finally {
      setIsLoadingMore(false);
    }
  }

  // Mise à jour optimiste : l'action se voit immédiatement, puis le serveur
  // confirme. Sur une connexion lente — le cas courant de nos utilisateurs —
  // attendre l'aller-retour donnerait l'impression que rien ne s'est passé.
  function patchLocally(id: string, patch: Partial<AppNotification>) {
    setItems(
      (current) =>
        current?.map((item) => (item.id === id ? { ...item, ...patch } : item)) ??
        null,
    );
  }

  async function toggleStar(notification: AppNotification) {
    if (!accessToken) return;
    const starred = !notification.starredAt;
    patchLocally(notification.id, {
      starredAt: starred ? new Date().toISOString() : null,
    });
    try {
      await api.setNotificationStarred(accessToken, notification.id, starred);
    } catch {
      // En cas d'échec, on recharge : mieux vaut un aller-retour qu'un état
      // affiché qui ne correspond à rien en base.
      void reload();
    }
  }

  async function archive(notification: AppNotification) {
    if (!accessToken) return;
    try {
      await api.setNotificationArchived(
        accessToken,
        notification.id,
        !notification.archivedAt,
      );
    } finally {
      await reload();
    }
  }

  async function openNotification(notification: AppNotification) {
    if (!accessToken) return;
    if (!notification.readAt) {
      patchLocally(notification.id, { readAt: new Date().toISOString() });
      void api.markNotificationRead(accessToken, notification.id).catch(() => {
        /* la lecture se resynchronisera au prochain chargement */
      });
    }
    // Le chemin vient du serveur, calculé à la création de la notification.
    if (notification.linkPath) {
      router.push(notification.linkPath as never);
    }
  }

  async function markAllRead() {
    if (!accessToken) return;
    await api.markAllNotificationsRead(accessToken, category ?? undefined);
    await reload();
  }

  if (!accessToken) return null;

  const viewOptions = [
    { value: 'all', label: t('notificationCentre.all') },
    {
      value: 'unread',
      label: counts?.unreadTotal
        ? `${t('notificationCentre.unread')} (${counts.unreadTotal})`
        : t('notificationCentre.unread'),
    },
    { value: 'starred', label: t('notificationCentre.starred') },
    { value: 'archived', label: t('notificationCentre.archived') },
  ];

  const categoryOptions = [
    { value: '__all__', label: t('notificationCentre.all') },
    ...CATEGORIES.map((value) => {
      const unread = counts?.unreadByCategory?.[value] ?? 0;
      return {
        value,
        label: unread
          ? `${categoryLabel(value)} (${unread})`
          : categoryLabel(value),
      };
    }),
  ];

  const isFiltered = Boolean(category) || view !== 'all' || search.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ChipSelect
          options={viewOptions}
          value={view}
          onChange={(value) => setView(value as CentreView)}
        />

        {/* Le filtre par catégorie défile horizontalement : quatorze rubriques ne
            tiennent pas sur la largeur d'un téléphone, et les empiler mangerait
            l'écran avant la première notification. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ChipSelect
            options={categoryOptions}
            value={category ?? '__all__'}
            onChange={(value) =>
              setCategory(
                value === '__all__' ? null : (value as NotificationCategory),
              )
            }
          />
        </ScrollView>

        <FormInput
          placeholder={t('notificationCentre.searchPlaceholder')}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void reload()}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {(counts?.unreadTotal ?? 0) > 0 && (
          <Pressable onPress={() => void markAllRead()} hitSlop={8}>
            <Text style={styles.markAll}>
              {t('notificationCentre.markAllRead')}
            </Text>
          </Pressable>
        )}

        {error && <ErrorText>{error}</ErrorText>}

        {items === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : items.length === 0 ? (
          <EmptyState
            message={
              isFiltered
                ? t('notificationCentre.emptyFiltered')
                : t('notificationCentre.empty')
            }
          />
        ) : (
          <View style={styles.list}>
            {items.map((notification) => {
              const rendered = render(notification.type, notification.metadata);
              const unread = !notification.readAt;
              return (
                <View
                  key={notification.id}
                  style={[styles.card, unread && styles.cardUnread]}
                >
                  <Pressable onPress={() => void openNotification(notification)}>
                    <View style={styles.cardHeader}>
                      <Badge
                        label={categoryLabel(notification.category)}
                        tone={CATEGORY_TONE[notification.category]}
                      />
                      <Text style={typography.caption}>
                        {new Date(notification.createdAt).toLocaleDateString(
                          i18n.language,
                        )}
                      </Text>
                    </View>

                    <Text style={[styles.title, unread && styles.titleUnread]}>
                      {rendered.title}
                    </Text>
                    {rendered.body.length > 0 && (
                      <Text style={styles.body}>{rendered.body}</Text>
                    )}

                    {notification.attachments.length > 0 && (
                      <Text style={styles.attachments}>
                        <Ionicons name="attach-outline" size={13} />{' '}
                        {t('notificationCentre.attachments')} (
                        {notification.attachments.length})
                      </Text>
                    )}
                  </Pressable>

                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => void toggleStar(notification)}
                      hitSlop={10}
                    >
                      <Ionicons
                        name={notification.starredAt ? 'star' : 'star-outline'}
                        size={20}
                        color={
                          notification.starredAt ? colors.accent : colors.muted
                        }
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => void archive(notification)}
                      hitSlop={10}
                    >
                      <Ionicons
                        name={
                          notification.archivedAt
                            ? 'arrow-undo-outline'
                            : 'archive-outline'
                        }
                        size={20}
                        color={colors.muted}
                      />
                    </Pressable>
                    {notification.linkPath && (
                      <Pressable
                        onPress={() => void openNotification(notification)}
                        hitSlop={10}
                      >
                        <Ionicons
                          name="open-outline"
                          size={20}
                          color={colors.primary}
                        />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            {nextCursor && (
              <Pressable onPress={() => void loadMore()} style={styles.loadMore}>
                {isLoadingMore ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.loadMoreText}>
                    {t('notificationCentre.loadMore')}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  loader: { marginTop: spacing.xxl },
  markAll: {
    ...typography.caption,
    color: colors.primary,
    textAlign: 'right',
  },
  list: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  // Le non-lu se signale par une bordure teintée plutôt que par un fond coloré :
  // sur une liste longue, un fond par ligne rend l'écran illisible.
  cardUnread: {
    borderColor: colors.primary,
    borderLeftWidth: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.bodyBold,
    marginTop: spacing.xs,
  },
  titleUnread: { color: colors.primaryDark },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  attachments: {
    ...typography.caption,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  loadMoreText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
});
