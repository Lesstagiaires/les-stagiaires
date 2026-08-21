import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing, typography } from '../../components/theme';
import { OpportunityBand } from '../../components/opportunity-band';
import { EmptyState } from '../../components/empty-state';
import { api, type Opportunity, type UserIntent } from '../../lib/api';

// ============================================================================
// ACCUEIL PUBLIC — CE QU'UN VISITEUR VOIT AVANT D'AVOIR UN COMPTE
//
// POURQUOI LES OFFRES D'ABORD. Demander « qui êtes-vous ? » à quelqu'un qui ne
// sait pas encore ce qu'on lui propose est un péage gratuit. La bande montre la
// valeur du service en premier ; le choix d'orientation vient ensuite, et
// l'inscription seulement quand une action l'exige réellement.
//
// AUCUN COMPTE N'EST CRÉÉ ICI. Cet écran ne fait qu'orienter : six choix mènent
// à l'inscription en transmettant l'intention arrêtée en V6-1, deux mènent au
// formulaire public existant, qui ne crée aucun compte.
//
// LE PAYS N'EST PAS DEMANDÉ ICI, à dessein : il reste saisi UNE SEULE FOIS,
// dans le formulaire d'inscription, où il alimente déjà CountryPolicy. Aucun
// état temporaire de pays ne transite entre les écrans.
// ============================================================================

// Les huit orientations, dans l'ordre arrêté. Six portent une intention V6-1 ;
// deux sont des aiguillages publics — leur `intent` est nul, et c'est ce qui
// garantit qu'aucun compte ne peut naître de ces deux chemins.
const ORIENTATIONS: {
  cle: string;
  intent: UserIntent | null;
}[] = [
  { cle: 'academicInternship', intent: 'ACADEMIC_INTERNSHIP_SEARCH' },
  { cle: 'professionalInternship', intent: 'PROFESSIONAL_INTERNSHIP_SEARCH' },
  { cle: 'organization', intent: 'ORGANIZATION' },
  { cle: 'establishment', intent: 'ESTABLISHMENT' },
  { cle: 'guardian', intent: 'GUARDIAN' },
  { cle: 'ambassador', intent: 'AMBASSADOR' },
  { cle: 'partnership', intent: null },
  { cle: 'other', intent: null },
];

export default function PublicHomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Aucun jeton : la recherche d'offres est publique côté API, et le
        // classement fonctionne sans critères de profil — le même code, sans
        // branche particulière.
        const search = await api.searchOpportunities({ limit: 10 });
        if (!cancelled) setOpportunities(search.items);
      } catch {
        // Une bande qui ne charge pas ne doit jamais empêcher quelqu'un de
        // choisir son orientation : l'écran reste utilisable sans elle.
        if (!cancelled) setOpportunities([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function choisir(intent: UserIntent | null) {
    if (!intent) {
      // Partenariat et autre demande : formulaire public existant, aucun compte.
      router.push('/contact');
      return;
    }
    router.push({ pathname: '/(auth)/register', params: { initialIntent: intent } });
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Même dégradé que l'accueil connecté : un visiteur qui s'inscrit ne
            doit pas avoir l'impression de changer d'application (KORA). */}
        <LinearGradient
          colors={[colors.inkDeep, colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.eyebrow}>{t('publicHome.eyebrow')}</Text>
          <Text style={styles.title}>{t('publicHome.title')}</Text>
          <Text style={styles.subtitle}>{t('publicHome.subtitle')}</Text>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('publicHome.offersTitle')}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : opportunities.length === 0 ? (
          <EmptyState message={t('publicHome.offersEmpty')} />
        ) : (
          <OpportunityBand
            opportunities={opportunities}
            // Ni favoris ni jeton : l'action n'est pas offerte, jamais offerte
            // puis refusée.
            onPressOpportunity={(id) => router.push(`/opportunities/${id}`)}
          />
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('publicHome.orientationTitle')}</Text>
          <Text style={styles.sectionHint}>{t('publicHome.orientationHint')}</Text>
        </View>

        {/* Liste verticale, une ligne par choix : lisible sur un écran étroit,
            et sans grille d'icônes coûteuse à charger sur une connexion moyenne. */}
        <View style={styles.choices}>
          {ORIENTATIONS.map(({ cle, intent }) => (
            <Pressable
              key={cle}
              accessibilityRole="button"
              style={styles.choice}
              onPress={() => choisir(intent)}
            >
              <Text style={styles.choiceLabel}>{t(`publicHome.choices.${cle}`)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          style={styles.login}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={styles.loginText}>{t('publicHome.alreadyMember')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxl },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    gap: spacing.xs,
  },
  eyebrow: { ...typography.label, color: colors.primaryLight },
  title: { ...typography.h1, color: '#fff' },
  subtitle: { ...typography.body, color: colors.primaryLight, marginTop: spacing.xs },
  sectionHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  sectionTitle: { ...typography.h2, color: colors.text },
  sectionHint: { ...typography.caption, color: colors.textSecondary },
  loader: { marginTop: spacing.xl },
  choices: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  choice: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.mist,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  choiceLabel: { ...typography.body, color: colors.text },
  login: { alignItems: 'center', marginTop: spacing.xl },
  loginText: { ...typography.body, color: colors.primary },
});
