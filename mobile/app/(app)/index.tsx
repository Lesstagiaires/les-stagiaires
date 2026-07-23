import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, PrimaryButton } from '../../components/form';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export default function HomeScreen() {
  const { accessToken, logout } = useAuth();
  const [fullName, setFullName] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    api
      .getMyProfile(accessToken)
      .then((profile) => setFullName(profile.fullName))
      .catch((err) => {
        // Token expiré/invalide (15 min) : renvoi silencieux vers la connexion plutôt
        // qu'un écran d'erreur — le refresh automatique viendra avec les prochains écrans.
        if (err instanceof ApiError && err.statusCode === 401) {
          void logout();
        }
      })
      .finally(() => setIsLoadingProfile(false));
  }, [accessToken, logout]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>LES STAGIAIRES</Text>
        {isLoadingProfile ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.welcome}>
            {fullName ? `Bienvenue, ${fullName}` : 'Bienvenue'}
          </Text>
        )}
        <Text style={styles.hint}>
          Le reste de l'application (profil, offres, candidatures) arrive au fur et à
          mesure des prochains modules.
        </Text>
        <PrimaryButton title="Se déconnecter" onPress={() => void logout()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  welcome: {
    fontSize: 18,
    color: colors.text,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
});
