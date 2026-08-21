import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../components/theme';

export default function OpportunitiesLayout() {
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Le détail d'une offre a quitté ce groupe : sa consultation est publique
          (V6-2) et il vit désormais dans `app/opportunities/[id].tsx`, hors des
          groupes gardés. La recherche et les alertes, elles, restent ici — donc
          derrière le jeton. */}
      <Stack.Screen name="alerts" options={{ title: t('opportunities.alertsTitle') }} />
    </Stack>
  );
}
