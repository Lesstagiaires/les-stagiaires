import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChipSelect } from '../../../components/chip-select';
import { OpportunityCard } from '../../../components/opportunity-card';
import { colors, radius, spacing, typography } from '../../../components/theme';
import { FormInput } from '../../../components/form';
import { api, ApiError, type Opportunity, type OpportunityType } from '../../../lib/api';
import { OPPORTUNITY_TYPE_OPTIONS } from '../../../lib/opportunity-labels';
import { useAuth } from '../../../lib/auth-context';

export default function OpportunitiesSearchScreen() {
  const router = useRouter();
  const { accessToken } = useAuth();

  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [sector, setSector] = useState('');
  const [type, setType] = useState<OpportunityType | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [items, setItems] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);
      try {
        const result = await api.searchOpportunities({
          country: country || undefined,
          city: city || undefined,
          sector: sector || undefined,
          type: type ?? undefined,
          page: nextPage,
          limit: 10,
        });
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
        setPage(result.page);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Recherche impossible.');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [country, city, sector, type],
  );

  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;
      api
        .listFavorites(accessToken)
        .then((favorites) => setFavoriteIds(new Set(favorites.map((f) => f.opportunityId))))
        .catch(() => undefined);
    }, [accessToken]),
  );

  useFocusEffect(
    useCallback(() => {
      void runSearch(1, false);
      // Volontairement déclenché uniquement au focus initial et lors d'une recherche
      // explicite (bouton) — pas à chaque frappe, pour éviter une requête par lettre.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
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
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFavorite) next.add(opportunityId);
        else next.delete(opportunityId);
        return next;
      });
    }
  }

  const hasMore = items.length < total;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.title}>Offres</Text>
          <Pressable onPress={() => router.push('/opportunities/alerts')} hitSlop={8}>
            <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          </Pressable>
        </View>

        <Pressable style={styles.filterToggle} onPress={() => setIsFilterOpen((v) => !v)}>
          <Ionicons name="options-outline" size={18} color={colors.primaryDark} />
          <Text style={styles.filterToggleText}>Filtres</Text>
        </Pressable>

        {isFilterOpen && (
          <View style={styles.filters}>
            <FormInput placeholder="Pays" value={country} onChangeText={setCountry} />
            <FormInput placeholder="Ville" value={city} onChangeText={setCity} />
            <FormInput placeholder="Secteur" value={sector} onChangeText={setSector} />
            <ChipSelect
              options={[{ value: '__all__', label: 'Tous les types' }, ...OPPORTUNITY_TYPE_OPTIONS]}
              value={type ?? '__all__'}
              onChange={(value) =>
                setType(value === '__all__' ? null : (value as OpportunityType))
              }
            />
            <Pressable style={styles.searchButton} onPress={() => void runSearch(1, false)}>
              <Text style={styles.searchButtonText}>Rechercher</Text>
            </Pressable>
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : items.length === 0 ? (
          <Text style={styles.emptyText}>Aucune offre ne correspond à ces critères.</Text>
        ) : (
          <View style={styles.list}>
            {items.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                isFavorite={favoriteIds.has(opportunity.id)}
                onToggleFavorite={
                  accessToken ? () => toggleFavorite(opportunity.id) : undefined
                }
                onPress={() => router.push(`/opportunities/${opportunity.id}`)}
              />
            ))}
            {hasMore && (
              <Pressable
                style={styles.loadMore}
                onPress={() => void runSearch(page + 1, true)}
              >
                {isLoadingMore ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.loadMoreText}>Voir plus d'offres</Text>
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.h1,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
  },
  filterToggleText: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  filters: {
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  list: {
    gap: spacing.md,
  },
  loader: {
    marginTop: spacing.xxl,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  emptyText: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
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
