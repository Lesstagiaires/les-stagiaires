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
      <Stack.Screen name="[id]" options={{ title: t('opportunities.detailTitle') }} />
      <Stack.Screen name="alerts" options={{ title: t('opportunities.alertsTitle') }} />
    </Stack>
  );
}
