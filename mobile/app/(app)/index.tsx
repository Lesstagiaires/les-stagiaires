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
import { LinearGradient } from 'expo-linear-gradient';
import { typography, colors, spacing } from '../../components/theme';
// Le carrousel vit désormais dans son propre composant, partagé avec l'accueil
// public (V6-2). Son comportement est inchangé : il a été déplacé, pas redessiné.
import { OpportunityBand } from '../../components/opportunity-band';
import { api, ApiError, type Opportunity } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { EmptyState } from '../../components/empty-state';

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [fullName, setFullName] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Les onglets restent montés en arrière-plan (comportement standard d'un tab
  // navigator) : sans refetch au focus, un nom modifié dans l'onglet Profil ne
  // se reflèterait jamais ici tant que l'app n'est pas rechargée.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        try {
          const searchPromise = api.searchOpportunities({ limit: 10 });
          const profilePromise = accessToken ? api.getMyProfile(accessToken) : null;
          const favoritesPromise = accessToken ? api.listFavorites(accessToken) : null;

          const [search, profile, favorites] = await Promise.all([
            searchPromise,
            profilePromise,
            favoritesPromise,
          ]);
          if (cancelled) return;
          setOpportunities(search.items);
          if (profile) setFullName(profile.fullName);
          if (favorites) {
            setFavoriteIds(new Set(favorites.map((entry) => entry.opportunityId)));
          }
        } catch (err) {
          if (err instanceof ApiError && err.statusCode === 401) {
            void logout();
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
    }, [accessToken, logout]),
  );

  async function toggleFavorite(opportunityId: string) {
    if (!accessToken) return;
    const isFavorite = favoriteIds.has(opportunityId);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorite) next.delete(opportunityId);
      else next.add(opportunityId);
      return next;
    });
    try {
      if (isFavorite) await api.removeFavorite(accessToken, opportunityId);
      else await api.addFavorite(accessToken, opportunityId);
    } catch {
      // Rollback optimiste silencieux : l'utilisateur peut simplement retenter.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFavorite) next.add(opportunityId);
        else next.delete(opportunityId);
        return next;
      });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient
          colors={[colors.inkDeep, colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.eyebrow}>{t('home.eyebrow')}</Text>
          <Text style={styles.title}>
            {fullName
              ? t('home.welcomeNamed', { name: fullName.split(' ')[0] })
              : t('home.welcome')}
          </Text>
          <Text style={styles.subtitle}>{t('home.subtitle')}</Text>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('home.sectionTitle')}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : opportunities.length === 0 ? (
          <EmptyState message={t('home.empty')} />
        ) : (
          <OpportunityBand
            opportunities={opportunities}
            favoriteIds={favoriteIds}
            onToggleFavorite={
              accessToken ? (id) => void toggleFavorite(id) : undefined
            }
            onPressOpportunity={(id) => router.push(`/opportunities/${id}`)}
          />
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
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primaryLight,
  },
  title: {
    ...typography.h1,
    color: '#fff',
  },
  subtitle: {
    ...typography.body,
    color: colors.primaryLight,
    marginTop: spacing.xs,
  },
  sectionHeader: {
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h2,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
