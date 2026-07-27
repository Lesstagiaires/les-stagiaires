import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { initI18n } from '../lib/i18n';

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
    </Stack>
  );
}

export default function RootLayout() {
  const [isI18nReady, setIsI18nReady] = useState(false);

  useEffect(() => {
    void initI18n().then(() => setIsI18nReady(true));
  }, []);

  if (!isI18nReady) {
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
