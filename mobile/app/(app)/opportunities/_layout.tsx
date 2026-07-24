import { Stack } from 'expo-router';
import { colors } from '../../../components/theme';

export default function OpportunitiesLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: "Détail de l'offre" }} />
      <Stack.Screen name="alerts" options={{ title: 'Mes alertes' }} />
    </Stack>
  );
}
