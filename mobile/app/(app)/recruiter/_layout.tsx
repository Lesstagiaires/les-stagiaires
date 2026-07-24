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
      <Stack.Screen name="team" options={{ title: 'Équipe' }} />
      <Stack.Screen name="needs" options={{ title: 'Besoins spéciaux' }} />
      <Stack.Screen name="learners" options={{ title: 'Apprenants' }} />
      <Stack.Screen name="campaigns" options={{ title: 'Campagnes' }} />
      <Stack.Screen name="learner-applications" options={{ title: 'Conventions' }} />
      <Stack.Screen name="reports" options={{ title: 'Rapports de stage' }} />
      <Stack.Screen name="dashboard" options={{ title: 'Tableau de bord' }} />
      <Stack.Screen name="partners" options={{ title: 'Entreprises partenaires' }} />
      <Stack.Screen name="opportunities/index" options={{ title: 'Mes offres' }} />
      <Stack.Screen name="opportunities/new" options={{ title: 'Nouvelle offre' }} />
      <Stack.Screen name="opportunities/[id]" options={{ title: "Gérer l'offre" }} />
      <Stack.Screen name="applications/index" options={{ title: 'Candidatures reçues' }} />
      <Stack.Screen name="applications/[id]" options={{ title: 'Candidature' }} />
    </Stack>
  );
}
