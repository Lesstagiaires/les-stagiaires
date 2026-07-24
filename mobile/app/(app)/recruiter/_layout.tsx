import { Stack } from 'expo-router';
import { colors } from '../../../components/theme';

export default function RecruiterLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="organization" options={{ title: 'Mon organisation' }} />
      <Stack.Screen name="opportunities/index" options={{ title: 'Mes offres' }} />
      <Stack.Screen name="opportunities/new" options={{ title: 'Nouvelle offre' }} />
      <Stack.Screen name="opportunities/[id]" options={{ title: "Gérer l'offre" }} />
      <Stack.Screen name="applications/index" options={{ title: 'Candidatures reçues' }} />
      <Stack.Screen name="applications/[id]" options={{ title: 'Candidature' }} />
    </Stack>
  );
}
