import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
import { OpportunityCard, OPPORTUNITY_CARD_STRIDE } from '../../components/opportunity-card';
import { api, ApiError, type Opportunity } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { EmptyState } from '../../components/empty-state';

// Défilement automatique du carrousel — jamais en scroll infini caché : une puce par
// offre, l'utilisateur voit toujours où il en est et combien il en reste (design
// comportemental, artifact "Le Passeport"). Le geste de l'utilisateur a toujours
// priorité — reprend seulement après une pause, sans jamais l'interrompre.
const AUTO_SCROLL_INTERVAL_MS = 4000;
const RESUME_AFTER_INTERACTION_MS = 6000;

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken, logout } = useAuth();
  const [fullName, setFullName] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const carouselRef = useRef<ScrollView>(null);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setIsReduceMotionEnabled);
    return () => {
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    };
  }, []);

  // Le rafraîchissement au focus (useFocusEffect ci-dessous) peut réduire la liste —
  // repartir de la première offre plutôt que garder un index devenu hors limites.
  useEffect(() => {
    setActiveIndex(0);
  }, [opportunities.length]);

  useEffect(() => {
    if (isReduceMotionEnabled || isAutoScrollPaused || opportunities.length < 2) return;
    const interval = setInterval(() => {
      setActiveIndex((current) => {
        const next = (current + 1) % opportunities.length;
        carouselRef.current?.scrollTo({ x: next * OPPORTUNITY_CARD_STRIDE, animated: true });
        return next;
      });
    }, AUTO_SCROLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isReduceMotionEnabled, isAutoScrollPaused, opportunities.length]);

  // L'utilisateur qui touche le carrousel reprend toujours la main immédiatement — le
  // défilement automatique ne reprend qu'après une pause, jamais en pleine interaction.
  function handleCarouselTouchStart() {
    setIsAutoScrollPaused(true);
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
  }

  function handleCarouselScrollEnd(offsetX: number) {
    setActiveIndex(Math.round(offsetX / OPPORTUNITY_CARD_STRIDE));
    resumeTimeoutRef.current = setTimeout(
      () => setIsAutoScrollPaused(false),
      RESUME_AFTER_INTERACTION_MS,
    );
  }

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
          <>
            <ScrollView
              ref={carouselRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carousel}
              onTouchStart={handleCarouselTouchStart}
              onMomentumScrollEnd={(event) =>
                handleCarouselScrollEnd(event.nativeEvent.contentOffset.x)
              }
              snapToInterval={OPPORTUNITY_CARD_STRIDE}
              decelerationRate="fast"
            >
              {opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  compact
                  isFavorite={favoriteIds.has(opportunity.id)}
                  onToggleFavorite={
                    accessToken ? () => toggleFavorite(opportunity.id) : undefined
                  }
                  onPress={() => router.push(`/opportunities/${opportunity.id}`)}
                />
              ))}
            </ScrollView>
            {opportunities.length > 1 && (
              <View style={styles.dots} accessibilityElementsHidden>
                {opportunities.map((opportunity, index) => (
                  <View
                    key={opportunity.id}
                    style={[styles.dot, index === activeIndex && styles.dotActive]}
                  />
                ))}
              </View>
            )}
          </>
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
  carousel: {
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.mistStrong,
  },
  dotActive: {
    width: 16,
    backgroundColor: colors.accent,
  },
  loader: {
    marginTop: spacing.xl,
  },
});
