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
import { useTranslation } from 'react-i18next';
import { ChipSelect } from '../../../components/chip-select';
import { OpportunityCard } from '../../../components/opportunity-card';
import { colors, radius, spacing, typography } from '../../../components/theme';
import { FormInput } from '../../../components/form';
import { api, ApiError, type Opportunity, type OpportunityType } from '../../../lib/api';
import { useOpportunityTypeOptions } from '../../../lib/opportunity-labels';
import { useAuth } from '../../../lib/auth-context';
import { EmptyState } from '../../../components/empty-state';

export default function OpportunitiesSearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const opportunityTypeOptions = useOpportunityTypeOptions();

  // Les MOTS-CLÉS. Hors du panneau « Filtres », parce que c'est l'entrée
  // principale : chercher « développeur » est le geste attendu, filtrer par
  // pays est un raffinement.
  const [keywords, setKeywords] = useState('');

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
          q: keywords.trim() || undefined,
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
        setError(err instanceof ApiError ? err.message : t('opportunities.search.searchError'));
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [keywords, country, city, sector, type, t],
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
          <Text style={styles.title}>{t('nav.opportunities')}</Text>
          <Pressable onPress={() => router.push('/opportunities/alerts')} hitSlop={8}>
            <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          </Pressable>
        </View>

        {/*
          La recherche par mots-clés. Le moteur la traite en trois passes :
          plein texte, similarité (les fautes de frappe ne font pas perdre le
          résultat), et synonymes — « RH » trouve « ressources humaines ».

          `onSubmitEditing` plutôt qu'une recherche à chaque frappe : une
          requête par lettre coûte cher sur une connexion mobile africaine, et
          la plateforme est faite pour y fonctionner.
        */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <FormInput
            style={styles.searchField}
            placeholder={t('opportunities.search.keywordsPlaceholder')}
            value={keywords}
            onChangeText={setKeywords}
            onSubmitEditing={() => void runSearch(1, false)}
            returnKeyType="search"
            autoCorrect={false}
          />
          {keywords.length > 0 && (
            <Pressable
              onPress={() => {
                setKeywords('');
                void runSearch(1, false);
              }}
              hitSlop={8}
              accessibilityLabel={t('opportunities.search.clearKeywords')}
            >
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <Pressable style={styles.filterToggle} onPress={() => setIsFilterOpen((v) => !v)}>
          <Ionicons name="options-outline" size={18} color={colors.primaryDark} />
          <Text style={styles.filterToggleText}>{t('opportunities.search.filters')}</Text>
        </Pressable>

        {isFilterOpen && (
          <View style={styles.filters}>
            <FormInput
              placeholder={t('opportunities.search.countryPlaceholder')}
              value={country}
              onChangeText={setCountry}
            />
            <FormInput
              placeholder={t('opportunities.search.cityPlaceholder')}
              value={city}
              onChangeText={setCity}
            />
            <FormInput
              placeholder={t('opportunities.search.sectorPlaceholder')}
              value={sector}
              onChangeText={setSector}
            />
            <ChipSelect
              options={[
                { value: '__all__', label: t('opportunities.search.allTypes') },
                ...opportunityTypeOptions,
              ]}
              value={type ?? '__all__'}
              onChange={(value) =>
                setType(value === '__all__' ? null : (value as OpportunityType))
              }
            />
            <Pressable style={styles.searchButton} onPress={() => void runSearch(1, false)}>
              <Text style={styles.searchButtonText}>{t('opportunities.search.searchButton')}</Text>
            </Pressable>
          </View>
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : items.length === 0 ? (
          // Deux messages distincts : « aucune offre ne correspond à ces
          // critères » n'aide pas quelqu'un qui a tapé un mot. Le moteur
          // reconnaît déjà les synonymes et les fautes de frappe — s'il ne
          // trouve rien, c'est le mot lui-même qu'il faut changer, et il faut
          // le dire.
          <EmptyState
            message={
              keywords.trim()
                ? t('opportunities.search.emptyKeywords', { keywords: keywords.trim() })
                : t('opportunities.search.empty')
            }
          />
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
                  <Text style={styles.loadMoreText}>{t('opportunities.search.loadMore')}</Text>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.full,
  },
  searchField: {
    flex: 1,
    // Le champ hérite déjà du cadre arrondi de la rangée : un second cadre
    // ferait une boîte dans une boîte.
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
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
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  loadMoreText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
});
