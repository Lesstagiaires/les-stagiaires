import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFonts } from 'expo-font';
import { Unbounded_600SemiBold, Unbounded_700Bold, Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { colors } from '../components/theme';
import { initI18n } from '../lib/i18n';

// Alias vers les noms de famille utilisés dans components/theme.ts (fonts.*) — IBM Plex
// Sans Arabic est chargée dès maintenant même si aucun style ne la référence encore
// (voir tâche de suivi), pour éviter un second temps de chargement de police au moment
// où elle sera câblée.
function useAppFonts() {
  return useFonts({
    'Unbounded-SemiBold': Unbounded_600SemiBold,
    'Unbounded-Bold': Unbounded_700Bold,
    'Unbounded-ExtraBold': Unbounded_800ExtraBold,
    'PlexSans-Regular': IBMPlexSans_400Regular,
    'PlexSans-Medium': IBMPlexSans_500Medium,
    'PlexSans-SemiBold': IBMPlexSans_600SemiBold,
    'PlexSans-Bold': IBMPlexSans_700Bold,
    'PlexSansArabic-Regular': IBMPlexSansArabic_400Regular,
    'PlexSansArabic-Medium': IBMPlexSansArabic_500Medium,
    'PlexSansArabic-SemiBold': IBMPlexSansArabic_600SemiBold,
    'PlexSansArabic-Bold': IBMPlexSansArabic_700Bold,
    'PlexMono-Medium': IBMPlexMono_500Medium,
  });
}

function RootNavigator() {
  const { t } = useTranslation();
  const { accessToken, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1B2A4A" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!accessToken}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!accessToken}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      {/* Accessible sans compte : formulaire "Nous contacter" pour les partenaires
          (entreprises, ONG, administrations, universités...) qui n'ont pas nécessairement
          de compte candidat. */}
      <Stack.Screen name="contact" options={{ headerShown: true, title: t('contact.title') }} />
      {/* LE DÉTAIL D'UNE OFFRE — PUBLIC (V6-2), et hors des deux groupes gardés
          à dessein. La plateforme doit pouvoir montrer ce qu'elle propose avant
          de demander un compte, et l'API le permettait déjà : `GET
          /opportunities/:id` est public, et renvoie 404 sur une offre non
          publiée à qui n'a pas de titre à la voir.
          UNE SEULE implémentation existe pour cette route : le fichier a été
          DÉPLACÉ hors de `(app)`, jamais dupliqué. La recherche d'offres et les
          alertes, elles, restent dans `(app)` — donc derrière le jeton. */}
      <Stack.Screen
        name="opportunities/[id]"
        options={{
          headerShown: true,
          title: t('opportunities.detailTitle'),
          // Recopié du layout que cet écran vient de quitter
          // (`(app)/opportunities/_layout.tsx`) : sans ces deux options, le
          // détail aurait perdu la teinte KORA de son en-tête en devenant
          // public, et un même écran aurait eu deux apparences selon le chemin
          // emprunté pour y arriver.
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
        }}
      />

      {/* Hors des deux groupes protégés, et volontairement : la page destinée au
          parent ou tuteur doit s'ouvrir que le jeune soit connecté ou non. Elle
          ne lit aucune donnée de compte — c'est ce qui la rend montrable à un
          adulte sans rien lui exposer. */}
      <Stack.Screen
        name="parental-guide"
        options={{ headerShown: true, title: t('auth.parentalGuide.title') }}
      />

      {/* Changement réel de représentant légal. Protégé : la demande porte sur
          le compte de l'appelant, et le serveur la rejetterait sans jeton. */}
      <Stack.Protected guard={!!accessToken}>
        <Stack.Screen
          name="guardian-change"
          options={{ headerShown: true, title: t('auth.guardianChange.title') }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [isI18nReady, setIsI18nReady] = useState(false);
  const [fontsLoaded] = useAppFonts();

  useEffect(() => {
    void initI18n().then(() => setIsI18nReady(true));
  }, []);

  if (!isI18nReady || !fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1B2A4A" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
